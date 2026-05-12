use std::ffi::OsStr;
use std::io;
use std::path::{Path, PathBuf};

use crate::mosaic::image::find_images;

/// Origin of a tile library: either a local filesystem directory or an
/// `s3://bucket/prefix/` URI. The S3 variant is currently a stub; the
/// raw-byte fetch and listing implementation lands in the next commit.
#[derive(Debug, Clone)]
pub enum TileSource {
    Local(PathBuf),
    #[allow(dead_code)]
    S3 {
        bucket: String,
        prefix: String,
    },
}

impl TileSource {
    /// Parse a string into either a Local path or an S3 URI. The
    /// `s3://bucket/key/prefix/` form is recognised; everything else is
    /// treated as a local filesystem path.
    #[allow(dead_code)]
    pub fn parse(s: &str) -> Self {
        if let Some(rest) = s.strip_prefix("s3://") {
            let (bucket, prefix) = rest.split_once('/').unwrap_or((rest, ""));
            TileSource::S3 {
                bucket: bucket.to_owned(),
                prefix: prefix.to_owned(),
            }
        } else {
            TileSource::Local(PathBuf::from(s))
        }
    }
}

/// Where the raw bytes of a particular tile live. Constructed per-tile
/// from a `TileSource` + `TileRef`; consumed by `prepare_tile` to decide
/// how to fetch the source image when the cache misses.
#[derive(Debug, Clone, Copy)]
pub enum TileLocator<'a> {
    Local(&'a Path),
    S3 {
        bucket: &'a str,
        key: &'a str,
        etag: &'a str,
    },
}

impl TileRef {
    /// Construct a TileLocator for this tile given the source it came from.
    pub fn locator_in<'a>(&'a self, source: &'a TileSource) -> TileLocator<'a> {
        match source {
            TileSource::Local(_) => TileLocator::Local(Path::new(&self.id)),
            TileSource::S3 { bucket, .. } => TileLocator::S3 {
                bucket,
                key: &self.id,
                etag: self.etag.as_deref().unwrap_or(""),
            },
        }
    }

    /// A best-effort short label for error/log lines: filename for Local
    /// sources, S3 key tail for S3 sources.
    #[allow(dead_code)]
    pub fn display_name(&self) -> &str {
        self.id.rsplit('/').next().unwrap_or(&self.id)
    }
}

/// A single tile in a tile set, opaque to the rendering pipeline.
///
/// `id` is an absolute local path for Local sources and an S3 key for S3
/// sources. `etag` is populated only for S3 sources and is used as the
/// cache-1 filename component when present (bypasses content MD5 hashing).
#[derive(Debug, Clone)]
pub struct TileRef {
    pub id: String,
    #[allow(dead_code)]
    pub size: u64,
    #[allow(dead_code)]
    pub etag: Option<String>,
}

impl TileRef {
    /// Treat the `id` as a local filesystem path. Valid for Local sources;
    /// for S3 sources the caller must dispatch on the source type before
    /// touching the filesystem.
    pub fn local_path(&self) -> PathBuf {
        PathBuf::from(&self.id)
    }
}

/// List the tiles in a tile source, applying an extension filter and
/// optionally excluding subfolders by name prefix.
///
/// `excluded_folders` matches the entrypoint.sh `EXCLUDED_FOLDERS` semantics:
/// each entry is a folder name; tiles whose path/key contains `/<name>/` (or
/// starts with `<name>/` for S3 keys) are dropped.
pub fn enumerate_tiles(
    source: &TileSource,
    extension: impl Fn(&OsStr) -> bool,
    excluded_folders: &[String],
) -> io::Result<Vec<TileRef>> {
    match source {
        TileSource::Local(root) => {
            let paths = find_images(root, extension)?;
            let refs = paths
                .into_iter()
                .filter(|p| !path_is_excluded(p, root, excluded_folders))
                .map(|p| {
                    let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                    TileRef {
                        id: p.to_string_lossy().into_owned(),
                        size,
                        etag: None,
                    }
                })
                .collect();
            Ok(refs)
        }
        TileSource::S3 { bucket, prefix } => enumerate_s3(bucket, prefix, extension, excluded_folders),
    }
}

fn enumerate_s3(
    bucket: &str,
    prefix: &str,
    extension: impl Fn(&OsStr) -> bool,
    excluded_folders: &[String],
) -> io::Result<Vec<TileRef>> {
    let h = crate::mosaic::tiles::utils::s3_handle_for_listing()
        .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "S3 client could not be initialised"))?;
    let mut refs: Vec<TileRef> = Vec::new();
    let mut continuation: Option<String> = None;
    loop {
        let mut req = h
            .client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix);
        if let Some(token) = &continuation {
            req = req.continuation_token(token);
        }
        let resp = h
            .runtime
            .block_on(async { req.send().await })
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("ListObjectsV2: {}", e)))?;
        if let Some(contents) = resp.contents {
            for obj in contents {
                let key = match obj.key {
                    Some(k) => k,
                    None => continue,
                };
                // Extension filter
                let ext = key.rsplit('.').next().unwrap_or("");
                if !extension(OsStr::new(ext)) {
                    continue;
                }
                // Excluded-folder filter: skip if `rel` matches an entry
                // — see `rel_is_excluded` for the two-mode semantics
                // (single-segment match vs path-prefix match).
                let rel = key.strip_prefix(prefix).unwrap_or(&key);
                if rel_is_excluded(rel, excluded_folders) {
                    continue;
                }
                refs.push(TileRef {
                    id: key,
                    size: obj.size.unwrap_or(0) as u64,
                    etag: obj.e_tag,
                });
            }
        }
        if resp.is_truncated.unwrap_or(false) {
            continuation = resp.next_continuation_token;
            if continuation.is_none() {
                break;
            }
        } else {
            break;
        }
    }
    Ok(refs)
}

fn path_is_excluded(path: &Path, root: &Path, excluded: &[String]) -> bool {
    if excluded.is_empty() {
        return false;
    }
    let rel = path.strip_prefix(root).unwrap_or(path);
    let rel_str = rel.to_string_lossy();
    rel_is_excluded(&rel_str, excluded)
}

/// Match a key (relative to the tile-source root, with `/` separators) against
/// a list of exclude patterns. Two modes, chosen per pattern by whether it
/// contains a `/`:
///
/// - **Segment match** (no slash, e.g. `"thumbs"`): excludes the key when
///   any path component equals the pattern. So `"thumbs"` excludes
///   `a/thumbs/x.jpg` and `thumbs/x.jpg` but not `a/thumbsup.jpg`.
/// - **Prefix match** (contains slash, e.g. `"Pilar/videos"`): excludes the
///   key when it starts with `pattern/` (or equals the pattern itself).
///   This is the entrypoint→binary equivalent of `aws s3 sync
///   --exclude pattern/*`, which is how the previous (sync-based) Fargate
///   flow handled nested folder exclusions.
fn rel_is_excluded(rel: &str, excluded: &[String]) -> bool {
    for e in excluded {
        if e.is_empty() {
            continue;
        }
        if e.contains('/') {
            // Prefix match. Treat the pattern as a directory boundary.
            let trimmed = e.trim_end_matches('/');
            if rel == trimmed || rel.starts_with(&format!("{}/", trimmed)) {
                return true;
            }
        } else if rel.split('/').any(|seg| seg == e) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::rel_is_excluded;

    #[test]
    fn segment_match() {
        let exc = &[String::from("thumbs")];
        assert!(rel_is_excluded("a/thumbs/x.jpg", exc));
        assert!(rel_is_excluded("thumbs/x.jpg", exc));
        assert!(!rel_is_excluded("a/thumbsup.jpg", exc));
        assert!(!rel_is_excluded("a/b/c.jpg", exc));
    }

    #[test]
    fn prefix_match() {
        let exc = &[String::from("Pilar/videos")];
        assert!(rel_is_excluded("Pilar/videos/clip.jpg", exc));
        assert!(rel_is_excluded("Pilar/videos/a/b.jpg", exc));
        assert!(!rel_is_excluded("Pilar/photo.jpg", exc));
        assert!(!rel_is_excluded("Other/Pilar/videos.jpg", exc));
    }

    #[test]
    fn trailing_slash_ok() {
        let exc = &[String::from("Pilar/videos/")];
        assert!(rel_is_excluded("Pilar/videos/clip.jpg", exc));
    }

    #[test]
    fn empty_pattern_ignored() {
        let exc = &[String::from("")];
        assert!(!rel_is_excluded("a/b.jpg", exc));
    }
}

use std::ffi::OsStr;
use std::fs::read_dir;
use std::io;
use std::path::{Path, PathBuf};


pub fn find_images(path: &Path, extension: impl Fn(&OsStr) -> bool) -> io::Result<Vec<PathBuf>> {
    let mut stack : Vec<PathBuf> = vec![path.to_owned()];
    let mut images_paths = vec![];
    while let Some(p) = stack.pop() {
        let entries = read_dir(p)?;
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().map_or(false, |ext| extension(ext)) {
                images_paths.push(path);
            }
        }
    }
    Ok(images_paths)
}

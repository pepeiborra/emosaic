
use std::path::PathBuf;

use derive_more::Display;

#[derive(Debug, Display)]
#[display(fmt = "{:?}: {}", path, error)]
pub(crate) struct ImageError {
    pub(crate) path: PathBuf,
    pub(crate) error: ::image::ImageError,
}
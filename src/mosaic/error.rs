
use std::path::PathBuf;

use derive_more::Display;

#[derive(Debug, Display)]
#[display(fmt = "{:?}: {}", path, error)]
pub struct ImageError {
    pub path: PathBuf,
    pub error: ::image::ImageError,
}

/// Errors that can occur during mosaic rendering
#[derive(Debug)]
pub enum RenderError {
    /// Image processing error
    Image(ImageError),
    /// Not enough tiles for the requested operation
    InsufficientTiles {
        required: usize,
        available: usize,
    },
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenderError::Image(e) => write!(f, "{}", e),
            RenderError::InsufficientTiles { required, available } => {
                write!(
                    f,
                    "INSUFFICIENT_TILES: need {} tiles but only have {} available",
                    required, available
                )
            }
        }
    }
}

impl std::error::Error for RenderError {}

impl From<ImageError> for RenderError {
    fn from(e: ImageError) -> Self {
        RenderError::Image(e)
    }
}
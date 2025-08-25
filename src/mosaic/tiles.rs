use typenum::U0;

// Re-export the main types and functions from the focused modules
pub use tile::Tile;
pub use tileset::TileSet;
pub use utils::{flipped_coords, prepare_tile, prepare_tile_with_date};

/// Representation type for computing distances between N-vectors
pub type SIZE = fixed::FixedU32<U0>;

// Module declarations
mod tile;
mod tileset;
mod utils;

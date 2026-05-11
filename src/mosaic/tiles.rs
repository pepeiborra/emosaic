use typenum::U0;

// Re-export the main types and functions from the focused modules
#[allow(unused_imports)]
pub use source::{enumerate_tiles, TileLocator, TileRef, TileSource};
pub use tile::Tile;
pub use tileset::TileSet;
pub use utils::{
    flipped_coords, persist_tile_index, phase_time_ns, prepare_tile, prepare_tile_with_date,
    s3_put_stats,
};

/// Representation type for computing distances between N-vectors
pub type SIZE = fixed::FixedU32<U0>;

// Module declarations
mod source;
mod tile;
mod tileset;
mod utils;

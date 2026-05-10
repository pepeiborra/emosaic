use typenum::U0;

// Re-export the main types and functions from the focused modules
pub use tile::Tile;
pub use tileset::{
    read_from_file as read_tileset_from_file, write_to_file as write_tileset_to_file, TileSet,
};
pub use utils::{
    flipped_coords, persist_tile_index, prepare_tile, prepare_tile_with_date, s3_put_stats,
};

/// Representation type for computing distances between N-vectors
pub type SIZE = fixed::FixedU32<U0>;

// Module declarations
mod tile;
mod tileset;
mod utils;

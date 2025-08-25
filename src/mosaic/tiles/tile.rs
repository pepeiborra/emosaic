use std::hash::{Hash, Hasher};

use ::image::Rgb;
use serde::ser::SerializeTuple;
use serde::{Deserialize, Serialize};
use super::utils::flipped_coords;
use super::SIZE;

/// Represents a single tile in a mosaic with its color data and metadata.
#[derive(Clone, Debug, Eq)]
pub struct Tile<T> {
    pub colors: T,
    pub idx: u16,
    pub flipped: bool,
    pub date_taken: Option<String>,
}

impl<T> PartialEq for Tile<T> {
    fn eq(&self, other: &Self) -> bool {
        self.idx == other.idx && self.flipped == other.flipped
    }
}

impl<T> Hash for Tile<T> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.idx.hash(state);
        self.flipped.hash(state);
    }
}


impl<T: Default> Default for Tile<T> {
    fn default() -> Self {
        Self::new(Default::default(), Default::default())
    }
}

impl<T> Serialize for Tile<T>
where
    T: Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut st = serializer.serialize_tuple(3)?;
        st.serialize_element(&self.colors)?;
        st.serialize_element(&self.idx)?;
        st.serialize_element(&self.date_taken)?;
        st.end()
    }
}

impl<'de, T> Deserialize<'de> for Tile<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let (colors, idx, date_taken): (T, u16, Option<String>) = Deserialize::deserialize(deserializer)?;
        Ok(Tile::new_with_date(idx, colors, date_taken))
    }
}

impl<T> Tile<T> {
    /// Create a tile from colors with index 0 (used for temporary tiles).
    pub fn from_colors(colors: T) -> Tile<T> {
        Tile::new(0, colors)
    }
    
    /// Create a new tile with the given index and colors.
    pub(crate) fn new(idx: u16, colors: T) -> Tile<T> {
        Tile {
            idx,
            colors,
            flipped: false,
            date_taken: None,
        }
    }
    
    /// Create a new tile with the given index, colors, and date.
    pub(crate) fn new_with_date(idx: u16, colors: T, date_taken: Option<String>) -> Tile<T> {
        Tile {
            idx,
            colors,
            flipped: false,
            date_taken,
        }
    }

    /// Transform the tile's colors using the provided function.
    pub fn map<T1>(self, f: impl FnOnce(T) -> T1) -> Tile<T1> {
        Tile {
            colors: f(self.colors),
            idx: self.idx,
            flipped: self.flipped,
            date_taken: self.date_taken,
        }
    }
}

impl<const N: usize> Tile<[Rgb<u8>; N]> {
    /// Convert the tile into a vectorial space for kd-tree operations.
    pub fn coords(&self) -> [SIZE; N * 3] {
        let mut result = [0u8.into(); N * 3];
        for i in 0..N {
            let color = self.colors[i];
            let i3 = i * 3;
            result[i3] = color[0].into();
            result[i3 + 1] = color[1].into();
            result[i3 + 2] = color[2].into();
        }
        if self.flipped {
            flipped_coords(&mut result);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tile_coords() {
        let tile: Tile<[Rgb<u8>; 1]> = Tile::from_colors([Rgb([1, 2, 3])]);
        let coords = tile.coords();
        assert_eq!(coords, [1, 2, 3]);

        let tile: Tile<[Rgb<u8>; 4]> = Tile::from_colors([
            Rgb([1, 2, 3]),
            Rgb([4, 5, 6]),
            Rgb([7, 8, 9]),
            Rgb([10, 11, 12]),
        ]);
        let coords = tile.coords();
        assert_eq!(coords, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }
}
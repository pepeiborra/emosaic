//! Utility functions for mosaic algorithms

use kiddo::NearestNeighbour;

/// Compare two sets of nearest neighbor matches for sorting
/// Returns ordering based on the distance of the worst (last) match in each set
pub fn compare_matches<B: Ord, C>(
    a: &[NearestNeighbour<B, C>],
    b: &[NearestNeighbour<B, C>],
) -> std::cmp::Ordering {
    b.last().unwrap().distance.cmp(&a.last().unwrap().distance)
}

#[cfg(test)]
mod tests {
    use super::*;
    use kiddo::NearestNeighbour;

    #[test]
    fn test_compare_matches() {
        let match_a = vec![NearestNeighbour { distance: 10, item: 1 }];
        let match_b = vec![NearestNeighbour { distance: 20, item: 2 }];
        
        let ordering = compare_matches(&match_a, &match_b);
        assert_eq!(ordering, std::cmp::Ordering::Greater);
    }
}
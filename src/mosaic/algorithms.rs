//! Utility functions for mosaic algorithms

use kiddo::NearestNeighbour;

/// Compare two sets of nearest neighbor reversed matches for sorting
pub fn compare_matches<B: Ord, C>(
    a: &[NearestNeighbour<B, C>],
    b: &[NearestNeighbour<B, C>],
) -> std::cmp::Ordering {
    match (a.last(), b.last()) {
        (Some(a_last), Some(b_last)) => a_last.distance.cmp(&b_last.distance),
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, None) => std::cmp::Ordering::Equal,
    }
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
        assert_eq!(ordering, std::cmp::Ordering::Less);
    }

    #[test]
    fn test_empty_matches_sorted_first_popped_last() {
        // This test verifies the sorting behavior in the context of how it's used
        // in render_nto1_no_repeat: we pop from the end, so empty matches should
        // be at the beginning (popped last, as a fallback when no tiles are available)
        let empty: Vec<NearestNeighbour<u32, i32>> = vec![];
        let good_match = vec![NearestNeighbour { distance: 5, item: 1 }];
        let bad_match = vec![NearestNeighbour { distance: 100, item: 2 }];

        let mut matches = vec![
            (0u32, good_match.clone()),
            (1u32, empty.clone()),
            (2u32, bad_match.clone()),
        ];

        // Sort like render_nto1_no_repeat does
        matches.sort_unstable_by(|(_, a), (_, b)| compare_matches(b, a));

        // After sorting:
        // - Empty matches should be FIRST (index 0) so they're popped last
        // - Good matches (small distance) should be LAST (index 2) so they're popped first
        // - Bad matches (large distance) should be in the middle

        // When popping from end, order should be: good, bad, empty
        let (n, _) = matches.pop().unwrap();
        assert_eq!(n, 0, "Good match (position 0) should be popped first");

        let (n, _) = matches.pop().unwrap();
        assert_eq!(n, 2, "Bad match (position 2) should be popped second");

        let (n, _) = matches.pop().unwrap();
        assert_eq!(n, 1, "Empty match (position 1) should be popped last");
    }
}
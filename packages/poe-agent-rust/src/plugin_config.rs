//! Configured plugin identity and UTF16 suggestion distance.
use std::collections::HashSet;
#[derive(Default)]
pub struct Names {
    names: HashSet<Vec<u16>>,
}
impl Names {
    pub fn contains(&self, name: &[u16]) -> bool {
        self.names.contains(name)
    }
    pub fn insert(&mut self, name: Vec<u16>) -> bool {
        self.names.insert(name)
    }
}
pub fn distance(left: &[u16], right: &[u16]) -> usize {
    let (long, short) = if left.len() >= right.len() {
        (left, right)
    } else {
        (right, left)
    };
    let mut row: Vec<_> = (0..=short.len()).collect();
    for (i, unit) in long.iter().enumerate() {
        let mut previous = row[0];
        row[0] = i + 1;
        for (j, other) in short.iter().enumerate() {
            let above = row[j + 1];
            row[j + 1] = (previous + usize::from(unit != other))
                .min(row[j] + 1)
                .min(above + 1);
            previous = above;
        }
    }
    row[short.len()]
}

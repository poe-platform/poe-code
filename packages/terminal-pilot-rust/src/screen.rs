//! Immutable public screen snapshot and UTF-16 lookup semantics.
use crate::strip_ansi;
pub struct Screen {
    pub lines: Vec<Vec<u16>>,
    pub raw_lines: Vec<Vec<u16>>,
    pub cursor: (f64, f64),
    pub size: (f64, f64),
}
impl Screen {
    pub fn new(
        lines: Vec<Vec<u16>>,
        raw_lines: Vec<Vec<u16>>,
        cursor: (f64, f64),
        size: (f64, f64),
    ) -> Self {
        Self {
            lines: lines.iter().map(|s| strip_ansi(s)).collect(),
            raw_lines,
            cursor,
            size,
        }
    }
    pub fn retained_bytes(&self) -> usize {
        std::mem::size_of::<Self>()
            + (self.lines.capacity() + self.raw_lines.capacity()) * std::mem::size_of::<Vec<u16>>()
            + self
                .lines
                .iter()
                .chain(&self.raw_lines)
                .map(|s| s.capacity() * std::mem::size_of::<u16>())
                .sum::<usize>()
    }
    pub fn text(&self) -> Vec<u16> {
        let mut text = vec![];
        for (i, line) in self.lines.iter().enumerate() {
            if i > 0 {
                text.push(10)
            }
            text.extend(line)
        }
        text
    }
    pub fn contains(&self, substring: &[u16]) -> bool {
        let text = self.text();
        substring.is_empty() || text.windows(substring.len()).any(|w| w == substring)
    }
    pub fn line(&self, index: f64) -> Option<&[u16]> {
        let normalized = if index < 0.0 {
            self.lines.len() as f64 + index
        } else {
            index
        };
        if !normalized.is_finite() || normalized.fract() != 0.0 || normalized < 0.0 {
            return None;
        }
        self.lines.get(normalized as usize).map(Vec::as_slice)
    }
}

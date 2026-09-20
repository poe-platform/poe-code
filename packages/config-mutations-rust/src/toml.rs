//! Own TOML configuration codec.
mod parser;
mod stringify;
pub use parser::parse;
use std::fmt;
pub use stringify::stringify;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub reason: String,
    pub offset: usize,
    pub line: usize,
    pub column: usize,
    pub codeblock: Vec<u16>,
}
impl Error {
    fn new(source: &[u16], offset: usize, reason: impl Into<String>) -> Self {
        let offset = offset.min(source.len());
        let mut lines = vec![];
        let mut start = 0;
        let mut pos = 0;
        while pos < source.len() {
            if matches!(source[pos], 10 | 13) {
                lines.push((start, pos));
                if source[pos] == 13 && source.get(pos + 1) == Some(&10) {
                    pos += 1;
                }
                start = pos + 1;
            }
            pos += 1;
        }
        lines.push((start, source.len()));
        let mut line: usize = 1;
        let mut column: usize = 1;
        let mut pos = 0;
        while pos < offset {
            if matches!(source[pos], 10 | 13) {
                line += 1;
                column = 1;
                if source[pos] == 13 && source.get(pos + 1) == Some(&10) && pos + 1 < offset {
                    pos += 1;
                }
            } else {
                column += 1;
            }
            pos += 1;
        }
        let width = (line + 1).to_string().len();
        let mut codeblock = vec![];
        for number in line.saturating_sub(1)..=line + 1 {
            if number == 0 {
                continue;
            }
            let Some(&(start, end)) = lines.get(number - 1) else {
                continue;
            };
            if start == end {
                continue;
            }
            codeblock.extend(format!("{number:<width$}:  ").encode_utf16());
            codeblock.extend_from_slice(&source[start..end]);
            codeblock.push(10);
            if number == line {
                codeblock.extend(std::iter::repeat_n(32, width + column + 2));
                codeblock.extend([94, 10]);
            }
        }
        Self {
            reason: reason.into(),
            offset,
            line,
            column,
            codeblock,
        }
    }
    pub fn message_utf16(&self) -> Vec<u16> {
        let mut message: Vec<_> = format!("Invalid TOML document: {}\n\n", self.reason)
            .encode_utf16()
            .collect();
        message.extend_from_slice(&self.codeblock);
        message
    }
    fn serialization(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
            offset: 0,
            line: 0,
            column: 0,
            codeblock: vec![],
        }
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.line == 0 {
            f.write_str(&self.reason)
        } else {
            f.write_str(&String::from_utf16_lossy(&self.message_utf16()))
        }
    }
}
impl std::error::Error for Error {}

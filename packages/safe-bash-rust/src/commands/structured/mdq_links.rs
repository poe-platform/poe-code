use super::mdq_decode_syntax;
use std::fmt::{self, Write};

#[derive(Clone, Debug, Default)]
pub(super) struct Target {
    pub url: String,
    pub title: String,
}

impl fmt::Display for Target {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.url)?;
        if !self.title.is_empty() {
            let quote = if self.title.contains('"') { '\'' } else { '"' };
            write!(f, " {quote}{}{quote}", self.title)?;
        }
        Ok(())
    }
}

fn skip_space(bytes: &[u8], start: usize) -> usize {
    start
        + bytes[start..]
            .iter()
            .take_while(|c| matches!(c, b' ' | b'\t' | b'\r' | b'\n'))
            .count()
}

fn destination(raw: &str) -> Option<(&str, usize)> {
    let bytes = raw.as_bytes();
    let angle = bytes.first() == Some(&b'<');
    let start = usize::from(angle);
    let mut i = start;
    let mut depth = 0;
    while let Some(&b) = bytes.get(i) {
        if b == b'\\' && bytes.get(i + 1).is_some_and(u8::is_ascii_punctuation) {
            i += 2;
            continue;
        }
        if angle {
            if b == b'>' {
                return Some((&raw[start..i], i + 1));
            }
            if matches!(b, b'<' | b'\n' | b'\r') {
                return None;
            }
        } else {
            if b.is_ascii_whitespace() || b == b')' && depth == 0 {
                break;
            }
            if b.is_ascii_control() {
                return None;
            }
            if b == b'(' {
                depth += 1;
            }
            if b == b')' {
                depth -= 1;
            }
        }
        i += 1;
    }
    (!angle && depth == 0).then(|| (&raw[..i], i))
}

fn title(raw: &str) -> Option<(&str, usize)> {
    let bytes = raw.as_bytes();
    let close = match bytes.first()? {
        b'\'' => b'\'',
        b'"' => b'"',
        b'(' => b')',
        _ => return None,
    };
    let mut i = 1;
    while let Some(&c) = bytes.get(i) {
        if c == close {
            return Some((&raw[1..i], i + 1));
        }
        if close == b')' && c == b'(' {
            return None;
        }
        i += if c == b'\\' && bytes.get(i + 1).is_some_and(u8::is_ascii_punctuation) {
            2
        } else {
            1
        };
    }
    None
}

impl Target {
    fn decode(url: &str, title: &str) -> Self {
        let mut encoded = String::new();
        for b in mdq_decode_syntax(url).bytes() {
            if b.is_ascii_alphanumeric() || b";/?:@&=+$,-_.!~*'()#%".contains(&b) {
                encoded.push(b as char);
            } else {
                write!(encoded, "%{b:02X}").unwrap();
            }
        }
        Self {
            url: encoded,
            title: mdq_decode_syntax(title),
        }
    }

    // The input starts just after the opening parenthesis.
    pub(super) fn inline(raw: &str) -> Option<(Self, usize)> {
        let bytes = raw.as_bytes();
        let begin = skip_space(bytes, 0);
        let with_title = |url, at| {
            let (value, used) = title(&raw[at..])?;
            let end = skip_space(bytes, at + used);
            (bytes.get(end) == Some(&b')')).then(|| (Self::decode(url, value), end + 1))
        };
        if let Some((url, used)) = destination(&raw[begin..]) {
            let after = begin + used;
            let gap = skip_space(bytes, after);
            if bytes.get(gap) == Some(&b')') {
                return Some((Self::decode(url, ""), gap + 1));
            }
            if gap > after
                && let Some(result) = with_title(url, gap)
            {
                return Some(result);
            }
        }
        if begin > 0 {
            with_title("", begin)
        } else {
            None
        }
    }
}

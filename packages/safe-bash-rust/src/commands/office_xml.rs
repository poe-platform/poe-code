// Lexical Office XML preserves raw text, attributes and permissive closing-tag
// selection used by the retained production readers.
use std::collections::BTreeMap;
const INVALID: &str = "Invalid XML lexical structure.";
pub(super) struct Attribute<'a> {
    pub name: &'a str,
    pub value: &'a str,
    pub double: bool,
}
pub(super) enum Token<'a> {
    Start {
        name: &'a str,
        empty: bool,
        body: usize,
        attributes: Vec<Attribute<'a>>,
    },
    End(&'a str, usize),
    Text(&'a str),
}

pub(in crate::commands) fn decode(bytes: &[u8]) -> Result<String, String> {
    let text = if bytes.starts_with(&[255, 254])
        || bytes.starts_with(&[60, 0])
        || bytes.starts_with(&[254, 255])
        || bytes.starts_with(&[0, 60])
    {
        if bytes.len() % 2 != 0 {
            return Err(INVALID.into());
        }
        let little = bytes.starts_with(&[255, 254]) || bytes.starts_with(&[60, 0]);
        let units: Vec<_> = bytes
            .chunks_exact(2)
            .map(|b| {
                if little {
                    u16::from_le_bytes([b[0], b[1]])
                } else {
                    u16::from_be_bytes([b[0], b[1]])
                }
            })
            .collect();
        String::from_utf16(&units).map_err(|_| INVALID)?
    } else {
        std::str::from_utf8(bytes).map_err(|_| INVALID)?.to_owned()
    };
    if !text.chars().all(|c| matches!(c,'\t'|'\n'|'\r'|' '..='\u{d7ff}'|'\u{e000}'..='\u{fffd}'|'\u{10000}'..='\u{10ffff}')) { return Err(INVALID.into()); }
    Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned())
}

pub(super) fn writer_name(name: &str) -> &str {
    name.split_once(':')
        .filter(|(prefix, local)| !prefix.is_empty() && !local.is_empty())
        .map_or(name, |(_, local)| local)
}

pub(super) fn tokens(source: &str) -> Result<Vec<Token<'_>>, String> {
    fn spaces(source: &str, pos: &mut usize) {
        while source
            .as_bytes()
            .get(*pos)
            .is_some_and(|b| matches!(b, b' ' | b'\t' | b'\r' | b'\n'))
        {
            *pos += 1;
        }
    }
    fn name<'a>(source: &'a str, pos: &mut usize) -> Result<&'a str, String> {
        let start = *pos;
        let valid = |b: u8| b.is_ascii_alphabetic() || matches!(b, b':' | b'_') || b >= 128;
        if !source.as_bytes().get(*pos).is_some_and(|&b| valid(b)) {
            return Err(INVALID.into());
        }
        *pos += 1;
        while source
            .as_bytes()
            .get(*pos)
            .is_some_and(|&b| valid(b) || b.is_ascii_digit() || matches!(b, b'-' | b'.'))
        {
            *pos += 1;
        }
        Ok(&source[start..*pos])
    }
    let mut result = Vec::new();
    let mut pos = 0;
    while pos < source.len() {
        if source.as_bytes()[pos] != b'<' {
            let end = source[pos..].find('<').map_or(source.len(), |i| pos + i);
            result.push(Token::Text(&source[pos..end]));
            pos = end;
            continue;
        }
        let tail = &source[pos..];
        if let Some(comment) = tail.strip_prefix("<!--") {
            let end = comment.find("-->").ok_or(INVALID)?;
            if comment[..end].contains("--") {
                return Err(INVALID.into());
            }
            pos += 4 + end + 3;
            continue;
        }
        if let Some(cdata) = tail.strip_prefix("<![CDATA[") {
            pos += 9 + cdata.find("]]>").ok_or(INVALID)? + 3;
            continue;
        }
        if let Some(instruction) = tail.strip_prefix("<?") {
            pos += 2 + instruction.find("?>").ok_or(INVALID)? + 2;
            continue;
        }
        let opening = pos;
        pos += 1;
        if source.as_bytes().get(pos) == Some(&b'/') {
            pos += 1;
            let tag = name(source, &mut pos)?;
            spaces(source, &mut pos);
            if source.as_bytes().get(pos) != Some(&b'>') {
                return Err(INVALID.into());
            }
            pos += 1;
            result.push(Token::End(tag, opening));
            continue;
        }
        let tag = name(source, &mut pos)?;
        let mut attributes = Vec::new();
        loop {
            let before = pos;
            spaces(source, &mut pos);
            let byte = source.as_bytes().get(pos).copied().ok_or(INVALID)?;
            if matches!(byte, b'/' | b'>') {
                let empty = byte == b'/';
                pos += usize::from(empty);
                if source.as_bytes().get(pos) != Some(&b'>') {
                    return Err(INVALID.into());
                }
                pos += 1;
                result.push(Token::Start {
                    name: tag,
                    empty,
                    body: pos,
                    attributes,
                });
                break;
            }
            if pos == before {
                return Err(INVALID.into());
            }
            let attribute = name(source, &mut pos)?;
            spaces(source, &mut pos);
            if source.as_bytes().get(pos) != Some(&b'=') {
                return Err(INVALID.into());
            }
            pos += 1;
            spaces(source, &mut pos);
            let quote = source
                .as_bytes()
                .get(pos)
                .copied()
                .filter(|b| matches!(b, b'\'' | b'"'))
                .ok_or(INVALID)?;
            pos += 1;
            let end = source[pos..]
                .bytes()
                .position(|b| b == quote || b == b'<')
                .ok_or(INVALID)?
                + pos;
            if source.as_bytes()[end] != quote {
                return Err(INVALID.into());
            }
            attributes.push(Attribute {
                name: attribute,
                value: &source[pos..end],
                double: quote == b'"',
            });
            pos = end + 1;
        }
    }
    Ok(result)
}

pub(super) fn entities(raw: &str) -> Result<String, String> {
    let mut value = raw.to_owned();
    for (prefix, base) in [("&#x", 16), ("&#", 10)] {
        let mut out = String::new();
        let mut rest = value.as_str();
        while let Some(at) = rest.find(prefix) {
            out.push_str(&rest[..at]);
            rest = &rest[at..];
            let digits = rest[prefix.len()..]
                .bytes()
                .take_while(|b| {
                    if base == 16 {
                        b.is_ascii_hexdigit()
                    } else {
                        b.is_ascii_digit()
                    }
                })
                .count();
            let end = prefix.len() + digits;
            if digits > 0 && rest.as_bytes().get(end) == Some(&b';') {
                let number = rest[prefix.len()..end].bytes().fold(0f64, |n, b| {
                    n * f64::from(base) + f64::from((b as char).to_digit(base).unwrap())
                });
                if number > 0x10ffff as f64 {
                    return Err(format!(
                        "Invalid code point {}",
                        if number.is_infinite() {
                            "Infinity".into()
                        } else {
                            number.to_string()
                        }
                    ));
                }
                out.push(char::from_u32(number as u32).unwrap_or('\u{fffd}'));
                rest = &rest[end + 1..];
            } else {
                out.push_str(&rest[..end]);
                rest = &rest[end..];
            }
        }
        out.push_str(rest);
        value = out;
    }
    for (from, to) in [
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", "\""),
        ("&apos;", "'"),
        ("&amp;", "&"),
    ] {
        value = value.replace(from, to);
    }
    Ok(value)
}

pub(super) struct Xml<'a> {
    source: &'a str,
    pub tokens: Vec<Token<'a>>,
    ends: Vec<usize>,
}
fn local(name: &str) -> &str {
    let mut parts = name.split(':');
    let first = parts.next().unwrap();
    let local = parts.next().unwrap_or(first);
    if parts.next().is_some()
        || local.len() > 32
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'_' | b'-'))
    {
        ""
    } else {
        local
    }
}
impl<'a> Xml<'a> {
    pub fn new(source: &'a str) -> Result<Self, String> {
        let tokens = tokens(source)?;
        let mut ends = vec![tokens.len(); tokens.len()];
        let mut next = BTreeMap::new();
        for (i, t) in tokens.iter().enumerate().rev() {
            match t {
                Token::End(name, _) => {
                    next.insert(*name, i);
                }
                Token::Start { name, empty, .. } => {
                    ends[i] = if *empty {
                        i
                    } else {
                        *next.get(name).unwrap_or(&tokens.len())
                    }
                }
                _ => {}
            }
        }
        Ok(Self {
            source,
            tokens,
            ends,
        })
    }
    pub fn end(&self, i: usize) -> usize {
        self.ends[i]
    }
    pub fn elements(&self, start: usize, end: usize, name: &str, open_only: bool) -> Vec<usize> {
        let mut out = Vec::new();
        let mut i = start;
        while i < end {
            if let Token::Start {
                name: tag, empty, ..
            } = &self.tokens[i]
            {
                if local(tag) == name {
                    if open_only {
                        out.push(i);
                    } else if !empty && self.ends[i] < end {
                        out.push(i);
                        i = self.ends[i];
                    }
                }
            }
            i += 1;
        }
        out
    }
    pub fn body(&self, i: usize) -> &'a str {
        match (&self.tokens[i], self.tokens.get(self.ends[i])) {
            (Token::Start { body, .. }, Some(Token::End(_, end))) => &self.source[*body..*end],
            _ => "",
        }
    }
    pub fn attr(&self, i: usize, name: &str) -> Option<(usize, &'a str)> {
        let Token::Start { attributes, .. } = &self.tokens[i] else {
            return None;
        };
        attributes
            .iter()
            .enumerate()
            .find(|(_, a)| a.double && local(a.name) == name)
            .map(|(i, a)| (i, a.value))
    }
    pub fn text(&self, i: usize) -> Result<String, String> {
        let mut text = String::new();
        for t in self.elements(i + 1, self.end(i), "t", false) {
            text.push_str(&entities(self.body(t))?);
        }
        Ok(text.trim_matches(super::office::space).to_owned())
    }
}

use super::JsonStrings;
use std::collections::HashMap;
pub use office_package_rust::xml::{Node, Element, Document, Parser, parse};

pub(super) fn to_json(nodes: &[Node], plus: bool) -> String {
    enum Part<'a> { Element(&'a Element), Key(&'a str), Text(String), Punctuation(char) }
    let mut out = String::from("{");
    let mut pending = Vec::new();
    let quote = JsonStrings::JavaScript;
    // A validated document has one root. Comments and instructions have no JSON value.
    for node in nodes {
        if let Node::Element(el) = node {
            pending.push(Part::Element(el));
            pending.push(Part::Key(&el.tag));
        }
    }
    while let Some(part) = pending.pop() {
        let el = match part {
            Part::Punctuation(c) => { out.push(c); continue; }
            Part::Text(s) => { quote.quote(s.trim_matches(xml_json_space), &mut out).unwrap(); continue; }
            Part::Key(key) => { quote.quote(key, &mut out).unwrap(); out.push(':'); continue; }
            Part::Element(el) => el,
        };
        let mut text = String::new();
        let mut groups: Vec<Vec<&Element>> = Vec::new();
        let mut indices = HashMap::new();
        for child in &el.children {
            match child {
                Node::Text(s, _) | Node::Cdata(s) => text.push_str(s),
                Node::Element(child) => {
                    let i = *indices.entry(&child.tag).or_insert_with(|| { groups.push(Vec::new()); groups.len() - 1 });
                    groups[i].push(child);
                }
                Node::Markup(_) => {}
            }
        }
        let trimmed = text.trim_matches(xml_json_space);
        if el.attrs.is_empty() && groups.is_empty() {
            if !plus && trimmed.is_empty() { out.push_str("null"); }
            else { quote.quote(trimmed, &mut out).unwrap(); }
            continue;
        }
        out.push('{');
        for (i, (key, val)) in el.attrs.iter().enumerate() {
            if i != 0 { out.push(','); }
            out.push_str(if plus { "\"+@" } else { "\"@" });
            out.push_str(key); // XML names cannot contain JSON string delimiters.
            out.push_str("\":");
            quote.quote(val, &mut out).unwrap();
        }
        pending.push(Part::Punctuation('}'));
        if !trimmed.is_empty() {
            pending.push(Part::Text(text));
            pending.push(Part::Key(if plus { "+content" } else { "#text" }));
            pending.push(Part::Punctuation(','));
        }
        for (i, group) in groups.into_iter().enumerate().rev() {
            let name = &group[0].tag;
            if group.len() == 1 { pending.push(Part::Element(group[0])); }
            else {
                pending.push(Part::Punctuation(']'));
                for (j, child) in group.into_iter().enumerate().rev() {
                    pending.push(Part::Element(child));
                    if j != 0 { pending.push(Part::Punctuation(',')); }
                }
                pending.push(Part::Punctuation('['));
            }
            pending.push(Part::Key(name));
            if i != 0 || !el.attrs.is_empty() { pending.push(Part::Punctuation(',')); }
        }
    }
    out.push('}');
    out
}

fn xml_json_space(c: char) -> bool {
    c == '\u{feff}' || c != '\u{85}' && c.is_whitespace()
}

#[derive(Clone, Copy)]
pub(in crate::commands) enum Escaping {
    Ascii,
    Unicode,
    Canonical,
    Utf16,
    SingleByte,
}

impl Escaping {
    pub fn text(self, value: &str, low: Option<u16>) -> String {
        let Some(unit) = low else { return self.escape(value, false) };
        let tail = &value[char::REPLACEMENT_CHARACTER.len_utf8()..];
        let prefix = match self {
            Self::Ascii => format!("&#x{unit:X};"),
            Self::SingleByte => format!("&#{unit};"),
            // XML cannot contain NUL. Preserve this raw UTF-16 unit across the
            // string serializer until the encoder writes it to the byte stream.
            Self::Utf16 => format!("\0{}", char::from_u32(u32::from(unit) - 0xdc00 + 1).unwrap()),
            Self::Unicode | Self::Canonical => char::REPLACEMENT_CHARACTER.to_string(),
        };
        prefix + &self.escape(tail, false)
    }

    pub fn escape(self, text: &str, attr: bool) -> String {
        use std::fmt::Write;
        let mut out = String::with_capacity(text.len());
        for c in text.chars() {
            match c {
                '&' => out.push_str("&amp;"),
                '<' => out.push_str("&lt;"),
                '>' if !attr || !matches!(self, Self::Canonical) => out.push_str("&gt;"),
                '"' if attr => out.push_str("&quot;"),
                '\r' | '\t' | '\n' if attr || c == '\r' => {
                    if matches!(self, Self::Canonical) {
                        write!(out, "&#x{:X};", c as u32).unwrap();
                    } else {
                        write!(out, "&#{};", c as u32).unwrap();
                    }
                }
                c if !c.is_ascii() && matches!(self, Self::Ascii) => {
                    write!(out, "&#x{:X};", c as u32).unwrap()
                }
                c => out.push(c),
            }
        }
        out
    }
}

pub(in crate::commands) struct EncodedOutput<'a> {
    pub bytes: Vec<u8>,
    pub encoding: Option<&'a str>,
    pub limit: usize,
}

impl std::fmt::Write for EncodedOutput<'_> {
    fn write_str(&mut self, text: &str) -> std::fmt::Result {
        let first = self.bytes.is_empty();
        let mut append = |part: &[u8]| {
            if part.len() > self.limit - self.bytes.len() { return Err(std::fmt::Error); }
            self.bytes.extend_from_slice(part);
            Ok(())
        };
        match self.encoding {
            Some(enc @ ("UTF-16" | "UTF-16LE" | "UTF-16BE")) => {
                if enc == "UTF-16" && first { append(&[0xff, 0xfe])?; }
                let mut units = text.encode_utf16();
                while let Some(unit) = units.next() {
                    let unit = if unit == 0 { 0xdc00 + units.next().unwrap() - 1 } else { unit };
                    let bytes = if enc == "UTF-16BE" { unit.to_be_bytes() } else { unit.to_le_bytes() };
                    append(&bytes)?;
                }
            }
            Some(enc @ ("US-ASCII" | "ISO-8859-1")) if !text.is_ascii() => {
                let ceiling = if enc == "US-ASCII" { 127 } else { 255 };
                for c in text.chars() {
                    if c as u32 <= ceiling { append(&[c as u8])?; }
                    else { append(format!("&#{};", c as u32).as_bytes())?; }
                }
            }
            _ => append(text.as_bytes())?,
        }
        Ok(())
    }
}

pub(super) fn resolve_output(fs: &dyn crate::vfs::SafeBashFs, path: &str) -> Result<String, String> {
    if crate::vfs::normalize_posix_path(path) != path { return Err(format!("EINVAL: invalid argument '{path}'")); }
    fs.access_path(path, true).map_err(|e| crate::commands::coreutils::stream_file_error(e, "prepareStagingResolution", path))
}

pub(super) fn write_output(fs: &dyn crate::vfs::SafeBashFs, path: &str, entry: &str, bytes: &[u8]) -> Result<(), String> {
    use crate::vfs::{VfsEntryKind, dirname_posix_path};
    let missing = |e: &str| e.starts_with("ENOENT:") || e.ends_with("(os error 2)");
    let resolution_error = |e| crate::commands::coreutils::stream_file_error(e, "prepareStagingResolution", path);
    let existing = match fs.lstat(entry) {
        Ok(st) if st.kind == VfsEntryKind::Directory => {
            let op = if entry == "/" { "" } else { ", writeStream" };
            return Err(format!("EISDIR: illegal operation on a directory{op} '{path}'"));
        }
        Ok(st) => Some(st),
        Err(e) if missing(&e) => None,
        Err(e) => return Err(e),
    };
    let parent = dirname_posix_path(entry);
    let directory = fs.stat(&parent).map_err(resolution_error)?;
    if directory.mode & 0o300 != 0o300 {
        return Err(format!("EACCES: permission denied, writeStream '{path}'"));
    }
    if let Some(st) = existing {
        if st.mode & 0o200 == 0 {
            return Err(format!("EACCES: permission denied, publishStagedFile '{entry}'"));
        }
        fs.write_file(entry, bytes)
    } else {
        fs.create_file(entry, bytes, 0o666)
    }.map_err(|e| crate::commands::coreutils::stream_file_error(e, "writeStream", path))
}

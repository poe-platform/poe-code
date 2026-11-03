use super::JVal;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug)]
pub(super) enum Node {
    Text(String),
    Cdata(String),
    Markup(String),
    Element(Element),
}

#[derive(Clone, Debug)]
pub(super) struct Element {
    pub tag: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<Node>,
}

fn space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r')
}

fn valid(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\r' | ' '..='\u{d7ff}' | '\u{e000}'..='\u{fffd}' | '\u{10000}'..)
}

fn name_start(c: char) -> bool {
    matches!(c, 'A'..='Z' | '_' | 'a'..='z' | '\u{c0}'..='\u{d6}' | '\u{d8}'..='\u{f6}'
        | '\u{f8}'..='\u{2ff}' | '\u{370}'..='\u{37d}' | '\u{37f}'..='\u{1fff}'
        | '\u{200c}'..='\u{200d}' | '\u{2070}'..='\u{218f}' | '\u{2c00}'..='\u{2fef}'
        | '\u{3001}'..='\u{d7ff}' | '\u{f900}'..='\u{fdcf}' | '\u{fdf0}'..='\u{fffd}'
        | '\u{10000}'..='\u{effff}')
}

fn name<'a>(input: &mut &'a str) -> Result<&'a str, &'static str> {
    let end = input
        .find(|c| space(c) || matches!(c, '/' | '=' | '>' | '?'))
        .unwrap_or(input.len());
    let (name, rest) = input.split_at(end);
    let mut parts = name.split(':');
    for part in parts.by_ref().take(2) {
        let mut chars = part.chars();
        if !chars.next().is_some_and(name_start) || !chars.all(|c| name_start(c) ||
            matches!(c, '-' | '.' | '0'..='9' | '\u{b7}' | '\u{300}'..='\u{36f}' | '\u{203f}'..='\u{2040}')) {
            return Err("invalid qualified name");
        }
    }
    if parts.next().is_some() {
        return Err("invalid qualified name");
    }
    *input = rest;
    Ok(name)
}

type Warnings<'a> = Option<&'a mut Vec<&'static str>>;

fn repair(warnings: &mut Warnings<'_>, message: &'static str) -> Result<(), &'static str> {
    let list = warnings.as_mut().ok_or(message)?;
    if !list.contains(&message) {
        list.push(message);
    }
    Ok(())
}

fn decode(mut s: &str, attr: bool, warnings: &mut Warnings<'_>) -> Result<String, &'static str> {
    let mut out = String::with_capacity(s.len());
    loop {
        let (raw, entity) = s.split_once('&').map_or((s, None), |(a, b)| (a, Some(b)));
        if attr && raw.contains(['\t', '\n']) {
            out.extend(
                raw.chars()
                    .map(|c| if matches!(c, '\t' | '\n') { ' ' } else { c }),
            );
        } else {
            out.push_str(raw);
        }
        let Some(entity) = entity else { return Ok(out) };
        let Some((token, rest)) = entity.split_once(';') else {
            repair(warnings, "unterminated entity")?;
            if attr {
                out.push_str(&entity.replace(['\n', '\t'], " "));
            } else {
                out.push_str(entity);
            }
            return Ok(out);
        };
        s = rest;
        out.push(match token {
            "amp" => '&',
            "lt" => '<',
            "gt" => '>',
            "quot" => '"',
            "apos" => '\'',
            _ => {
                let Some(n) = token.strip_prefix('#') else {
                    repair(warnings, "undeclared entity")?;
                    continue;
                };
                let (radix, digits) = n.strip_prefix('x').map_or((10, n), |s| (16, s));
                if digits.is_empty() {
                    repair(warnings, "undeclared entity")?;
                    continue;
                }
                let mut point = 0u32;
                for c in digits.chars() {
                    point = point * radix + c.to_digit(radix).ok_or("undeclared entity")?;
                    if point > 0x10ffff {
                        return Err("invalid character reference");
                    }
                }
                char::from_u32(point)
                    .filter(|&c| valid(c))
                    .ok_or("invalid character reference")?
            }
        });
    }
}

#[derive(Default)]
pub(super) struct Document {
    pub nodes: Vec<Node>,
    pub encoding: Option<String>,
    pub standalone: Option<String>,
}

fn declaration_field<'a>(s: &mut &'a str, key: &str) -> Option<&'a str> {
    let rest = s.trim_start_matches(space);
    if rest.len() == s.len() {
        return None;
    }
    let rest = rest
        .strip_prefix(key)?
        .trim_start_matches(space)
        .strip_prefix('=')?
        .trim_start_matches(space);
    let q = rest.chars().next().filter(|c| matches!(c, '\'' | '"'))?;
    let (value, tail) = rest[1..].split_once(q)?;
    *s = tail;
    Some(value)
}

fn declaration(
    mut body: &str,
    expected_encoding: Option<&str>,
) -> Option<(Option<String>, Option<String>)> {
    if declaration_field(&mut body, "version")? != "1.0" {
        return None;
    }
    let encoding = declaration_field(&mut body, "encoding");
    if let Some(enc) = encoding
        && (!["utf-8", "utf-16", "utf-16le", "utf-16be"]
            .iter()
            .any(|e| enc.eq_ignore_ascii_case(e))
            || expected_encoding.is_some_and(|e| !enc.eq_ignore_ascii_case(e)))
    {
        return None;
    }
    let standalone = declaration_field(&mut body, "standalone");
    if !matches!(standalone, None | Some("yes" | "no")) || !body.trim_matches(space).is_empty() {
        return None;
    }
    Some((encoding.map(str::to_owned), standalone.map(str::to_owned)))
}

fn diagnostic(error: &'static str) -> String {
    if error == "XML resource limit exceeded" {
        error.into()
    } else {
        format!("Invalid XML: {error}")
    }
}

const XML: &str = "http://www.w3.org/XML/1998/namespace";
const XMLNS: &str = "http://www.w3.org/2000/xmlns/";

pub(super) struct Parser<'a> {
    expected_encoding: Option<&'a str>,
    warnings: Warnings<'a>,
    retain_nodes: bool,
    first: bool,
    has_root: bool,
    doc: Document,
    stack: Vec<Element>,
    namespaces: HashMap<String, Vec<String>>,
    declarations: Vec<String>,
    scope_starts: Vec<usize>,
    pending: String,
    scanned: usize,
    quote: u8,
    after_cr: bool,
    started: bool,
}

impl<'a> Parser<'a> {
    pub fn new(
        expected_encoding: Option<&'a str>,
        warnings: Warnings<'a>,
        retain_nodes: bool,
    ) -> Self {
        Self {
            expected_encoding,
            warnings,
            retain_nodes,
            first: true,
            has_root: false,
            doc: Document::default(),
            stack: Vec::new(),
            namespaces: HashMap::from([("xml".into(), vec![XML.to_owned()])]),
            declarations: Vec::new(),
            scope_starts: Vec::new(),
            pending: String::new(),
            scanned: 0,
            quote: 0,
            after_cr: false,
            started: false,
        }
    }

    pub fn feed(&mut self, mut chunk: &str) -> Result<(), String> {
        if chunk.is_empty() {
            return Ok(());
        }
        if !self.started {
            chunk = chunk.strip_prefix('\u{feff}').unwrap_or(chunk);
            self.started = true;
        }
        if self.after_cr {
            chunk = chunk.strip_prefix('\n').unwrap_or(chunk);
        }
        self.after_cr = chunk.ends_with('\r');
        let normalized;
        let chunk = if chunk.contains('\r') {
            normalized = chunk.replace("\r\n", "\n").replace('\r', "\n");
            normalized.as_str()
        } else {
            chunk
        };
        if self.warnings.is_some() {
            // Recovery validates every input character before parsing.
            if !chunk.chars().all(valid) { return Err(diagnostic("invalid character")); }
            self.pending.push_str(chunk);
            return Ok(());
        }
        let mut start = 0;
        let mut units = 0;
        for (offset, c) in chunk.char_indices() {
            if !valid(c) { return Err(diagnostic("invalid character")); }
            units += c.len_utf16();
            if units >= 512 {
                let end = offset + c.len_utf8();
                self.consume_chunk(&chunk[start..end])?;
                start = end;
                units = 0;
            }
        }
        self.consume_chunk(&chunk[start..])
    }

    fn consume_chunk(&mut self, chunk: &str) -> Result<(), String> {
        if chunk.is_empty() { return Ok(()); }
        self.pending.push_str(chunk);
        let mut pending = std::mem::take(&mut self.pending);
        let mut rest = pending.as_str();
        while !rest.is_empty() {
            let end = if !rest.starts_with('<') {
                rest[self.scanned..].find('<').map(|n| n + self.scanned)
            } else if rest == "<"
                || ["<!--", "<![CDATA["]
                    .iter()
                    .any(|p| p.starts_with(rest) && *p != rest)
            {
                None
            } else if let Some((prefix, delimiter)) =
                [("<!--", "-->"), ("<![CDATA[", "]]>"), ("<?", "?>")]
                    .into_iter()
                    .find(|(p, _)| rest.starts_with(p))
            {
                if prefix == "<![CDATA[" && self.stack.is_empty() {
                    return Err(diagnostic("CDATA outside root"));
                }
                let start = self
                    .scanned
                    .saturating_sub(delimiter.len() - 1)
                    .max(prefix.len());
                rest.as_bytes()[start..]
                    .windows(delimiter.len())
                    .position(|s| s == delimiter.as_bytes())
                    .map(|n| start + n + delimiter.len())
            } else if rest.starts_with("<!") {
                return Err(diagnostic("DTD and entity declarations are forbidden"));
            } else {
                let mut end = None;
                for (i, &b) in rest.as_bytes().iter().enumerate().skip(self.scanned) {
                    if self.quote != 0 {
                        if b == self.quote {
                            self.quote = 0;
                        }
                    } else if matches!(b, b'\'' | b'"') {
                        self.quote = b;
                    } else if b == b'>' {
                        end = Some(i + 1);
                        break;
                    }
                }
                end
            };
            let Some(end) = end else { break };
            self.consume(&rest[..end]).map_err(diagnostic)?;
            rest = &rest[end..];
            self.scanned = 0;
        }
        self.scanned = rest.len();
        pending.drain(..pending.len() - rest.len());
        self.pending = pending;
        Ok(())
    }

    fn consume(&mut self, mut s: &str) -> Result<(), &'static str> {
        let Self {
            doc,
            warnings,
            stack,
            namespaces,
            declarations,
            scope_starts,
            has_root,
            ..
        } = self;
        while !s.is_empty() {
            let first = self.first;
            self.first = false;
            let node = if let Some(rest) = s.strip_prefix("<!--") {
                let (comment, tail) = rest.split_once("-->").ok_or("malformed comment")?;
                if comment.contains("--") || comment.ends_with('-') {
                    return Err("malformed comment");
                }
                s = tail;
                Node::Markup(format!("<!--{comment}-->"))
            } else if let Some(rest) = s.strip_prefix("<![CDATA[") {
                if stack.is_empty() {
                    return Err("CDATA outside root");
                }
                let (body, tail) = rest.split_once("]]>").ok_or("unterminated CDATA")?;
                s = tail;
                Node::Cdata(body.into())
            } else if s.starts_with("<!") {
                return Err("DTD and entity declarations are forbidden");
            } else if let Some(mut rest) = s.strip_prefix("<?") {
                let target = name(&mut rest)?;
                let (body, tail) = rest
                    .split_once("?>")
                    .ok_or("unterminated processing instruction")?;
                if target.eq_ignore_ascii_case("xml") {
                    if !first || target != "xml" {
                        return Err("unsupported XML declaration");
                    }
                    (doc.encoding, doc.standalone) = declaration(body, self.expected_encoding)
                        .ok_or("unsupported XML declaration")?;
                    s = tail;
                    continue;
                }
                if !body.is_empty() && !body.starts_with(space) {
                    return Err("invalid processing instruction");
                }
                s = tail;
                let data = body.trim_start_matches(space);
                Node::Markup(if data.is_empty() {
                    format!("<?{target}?>")
                } else {
                    format!("<?{target} {data}?>")
                })
            } else if let Some(mut rest) = s.strip_prefix("</") {
                let end = name(&mut rest)?;
                rest = rest.trim_start_matches(space);
                let closed = if let Some(tail) = rest.strip_prefix('>') {
                    s = tail;
                    stack.pop()
                } else {
                    s = rest.chars().next().map_or(rest, |c| &rest[c.len_utf8()..]);
                    None
                };
                if closed.as_ref().is_none_or(|el| el.tag != end) {
                    repair(warnings, "mismatched closing tag")?;
                }
                let Some(el) = closed else {
                    continue;
                };
                Node::Element(el)
            } else if let Some(rest) = s.strip_prefix('<') {
                s = rest;
                let tag = name(&mut s)?;
                let mut attrs = Vec::new();
                let mut names = HashSet::new();
                scope_starts.push(declarations.len());
                loop {
                    let rest = s.trim_start_matches(space);
                    if rest.starts_with(['/', '>']) || rest.is_empty() && warnings.is_some() {
                        s = rest;
                        break;
                    }
                    if s.len() == rest.len() {
                        return Err("attributes require whitespace");
                    }
                    s = rest;
                    let key = name(&mut s)?;
                    if !names.insert(key) {
                        return Err("duplicate attribute");
                    }
                    s = s
                        .trim_start_matches(space)
                        .strip_prefix('=')
                        .ok_or("missing attribute equals")?
                        .trim_start_matches(space);
                    let quote = s
                        .chars()
                        .next()
                        .filter(|c| matches!(c, '\'' | '"'))
                        .ok_or("unquoted attribute")?;
                    let (value, tail) = s[1..].split_once(quote).ok_or("unterminated attribute")?;
                    if value.contains('<') {
                        return Err("less-than in attribute");
                    }
                    let value = decode(value, true, warnings)?;
                    if key == "xmlns" || key.starts_with("xmlns:") {
                        let prefix = key.strip_prefix("xmlns:").unwrap_or("");
                        if prefix == "xmlns"
                            || value == XMLNS
                            || (prefix == "xml") != (value == XML)
                            || (!prefix.is_empty() && value.is_empty())
                        {
                            return Err("invalid namespace binding");
                        }
                        namespaces
                            .entry(prefix.to_owned())
                            .or_default()
                            .push(value.clone());
                        declarations.push(prefix.to_owned());
                    }
                    attrs.push((key.to_owned(), value));
                    s = tail;
                }
                let mut expanded = HashSet::new();
                for (key, _) in &attrs {
                    if let Some((prefix, local)) = key.split_once(':')
                        && prefix != "xmlns"
                    {
                        let uri = namespaces
                            .get(prefix)
                            .and_then(|bindings| bindings.last())
                            .ok_or("unbound attribute prefix")?;
                        if !expanded.insert((uri.as_str(), local)) {
                            return Err("duplicate expanded attribute");
                        }
                    }
                }
                if let Some((prefix, _)) = tag.split_once(':')
                    && !namespaces.contains_key(prefix)
                {
                    return Err("unbound element prefix");
                }
                if stack.is_empty() {
                    if *has_root {
                        return Err("multiple root elements");
                    }
                    *has_root = true;
                }
                // The DOM consumers recurse when rendering or dropping a tree.
                if self.retain_nodes && stack.len() >= 512 {
                    return Err("XML resource limit exceeded");
                }
                let el = Element {
                    tag: tag.into(),
                    attrs: if self.retain_nodes { attrs } else { Vec::new() },
                    children: Vec::new(),
                };
                let empty = s.starts_with('/');
                if empty {
                    s = &s[1..];
                }
                if let Some(tail) = s.strip_prefix('>') {
                    s = tail;
                } else {
                    repair(warnings, "unterminated start tag")?;
                    if let Some(c) = s.chars().next() {
                        s = &s[c.len_utf8()..];
                    }
                }
                if empty {
                    Node::Element(el)
                } else {
                    stack.push(el);
                    continue;
                }
            } else {
                let (text, tail) = s.split_at(s.find('<').unwrap_or(s.len()));
                s = tail;
                if text.contains("]]>") {
                    return Err("CDATA terminator in text");
                }
                if stack.is_empty() {
                    if !text.chars().all(space) {
                        return Err("text outside the root");
                    }
                    continue;
                }
                let decoded = decode(text, false, warnings)?;
                if decoded.is_empty() {
                    continue;
                }
                Node::Text(decoded)
            };
            if matches!(&node, Node::Element(_)) {
                for prefix in declarations.drain(scope_starts.pop().unwrap()..) {
                    let bindings = namespaces.get_mut(&prefix).unwrap();
                    bindings.pop();
                    if bindings.is_empty() {
                        namespaces.remove(&prefix);
                    }
                }
            }
            if !self.retain_nodes {
                continue;
            }
            if let Some(parent) = stack.last_mut() {
                parent.children.push(node);
            } else {
                doc.nodes.push(node);
            }
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<Document, String> {
        let pending = std::mem::take(&mut self.pending);
        self.consume(&pending).map_err(diagnostic)?;
        self.finish_document().map_err(diagnostic)
    }

    fn finish_document(mut self) -> Result<Document, &'static str> {
        if !self.has_root {
            return Err("incomplete document");
        }
        if !self.stack.is_empty() {
            repair(&mut self.warnings, "incomplete document")?;
            if !self.retain_nodes {
                return Ok(self.doc);
            }
            while let Some(el) = self.stack.pop() {
                if let Some(parent) = self.stack.last_mut() {
                    parent.children.push(Node::Element(el));
                } else {
                    self.doc.nodes.push(Node::Element(el));
                }
            }
        }
        Ok(self.doc)
    }
}

pub(super) fn parse(
    src: &str,
    expected_encoding: Option<&str>,
    warnings: Warnings<'_>,
    retain_nodes: bool,
) -> Result<Document, String> {
    let mut parser = Parser::new(expected_encoding, warnings, retain_nodes);
    let src = src.strip_prefix('\u{feff}').unwrap_or(src);
    if !src.chars().all(valid) { return Err(diagnostic("invalid character")); }
    let normalized;
    let src = if src.contains('\r') {
        normalized = src.replace("\r\n", "\n").replace('\r', "\n");
        &normalized
    } else { src };
    parser.consume(src).map_err(diagnostic)?;
    parser.finish_document().map_err(diagnostic)
}

pub(super) fn to_json(nodes: Vec<Node>, plus: bool) -> JVal {
    fn element(el: Element, plus: bool) -> (String, JVal) {
        let prefix = if plus { "+@" } else { "@" };
        let mut fields: Vec<_> = el
            .attrs
            .into_iter()
            .map(|(k, v)| (format!("{prefix}{k}"), JVal::Str(v)))
            .collect();
        let mut children = HashMap::<String, usize>::new();
        let mut text = String::new();
        for child in el.children {
            match child {
                Node::Text(s) | Node::Cdata(s) => text.push_str(&s),
                Node::Markup(_) => {}
                Node::Element(child) => {
                    let (key, value) = element(child, plus);
                    if let Some(&i) = children.get(&key) {
                        let old = &mut fields[i].1;
                        if let JVal::Array(a) = old {
                            a.push(value);
                        } else {
                            *old = JVal::Array(vec![std::mem::replace(old, JVal::Null), value]);
                        }
                    } else {
                        children.insert(key.clone(), fields.len());
                        fields.push((key, value));
                    }
                }
            }
        }
        let text =
            text.trim_matches(|c: char| c == '\u{feff}' || c != '\u{85}' && c.is_whitespace());
        let value = if fields.is_empty() {
            if text.is_empty() && !plus {
                JVal::Null
            } else {
                JVal::Str(text.into())
            }
        } else {
            if !text.is_empty() {
                fields.push((
                    if plus { "+content" } else { "#text" }.into(),
                    JVal::Str(text.into()),
                ));
            }
            JVal::Object(fields)
        };
        (el.tag, value)
    }
    JVal::Object(
        nodes
            .into_iter()
            .filter_map(|n| match n {
                Node::Element(el) => Some(element(el, plus)),
                _ => None,
            })
            .collect(),
    )
}

#[derive(Clone, Copy)]
pub(super) enum Escaping {
    Ascii,
    Unicode,
    Canonical,
}

impl Escaping {
    pub fn escape(self, text: &str, attr: bool) -> String {
        use std::fmt::Write;
        let mut out = String::with_capacity(text.len());
        for c in text.chars() {
            match c {
                '&' => out.push_str("&amp;"),
                '<' => out.push_str("&lt;"),
                '>' => out.push_str("&gt;"),
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

pub(super) fn encode(text: String, encoding: Option<&str>) -> Vec<u8> {
    use std::io::Write;
    match encoding {
        Some(enc @ ("UTF-16" | "UTF-16LE" | "UTF-16BE")) => {
            let mut bytes = Vec::with_capacity(text.len());
            if enc == "UTF-16" {
                bytes.extend([0xff, 0xfe]);
            }
            for unit in text.encode_utf16() {
                bytes.extend(if enc == "UTF-16BE" {
                    unit.to_be_bytes()
                } else {
                    unit.to_le_bytes()
                });
            }
            bytes
        }
        Some(enc @ ("US-ASCII" | "ISO-8859-1")) => {
            let ceiling = if enc == "US-ASCII" { 127 } else { 255 };
            let mut bytes = Vec::with_capacity(text.len());
            for c in text.chars() {
                if c as u32 <= ceiling {
                    bytes.push(c as u8);
                } else {
                    write!(bytes, "&#{};", c as u32).unwrap();
                }
            }
            bytes
        }
        _ => text.into_bytes(),
    }
}

pub(super) fn write_output(fs: &dyn crate::vfs::SafeBashFs, path: &str, bytes: &[u8]) -> Result<(), String> {
    use crate::vfs::{VfsEntryKind, dirname_posix_path, normalize_posix_path};
    if normalize_posix_path(path) != path {
        return Err(format!("EINVAL: invalid argument '{path}'"));
    }
    let missing = |e: &str| e.starts_with("ENOENT:") || e.ends_with("(os error 2)");
    let resolution_error = |e| crate::commands::coreutils::stream_file_error(e, "prepareStagingResolution", path);
    let entry = fs.access_path(path, true).map_err(resolution_error)?;
    let existing = match fs.lstat(&entry) {
        Ok(st) if st.kind == VfsEntryKind::Directory => {
            let op = if entry == "/" { "" } else { ", writeStream" };
            return Err(format!("EISDIR: illegal operation on a directory{op} '{path}'"));
        }
        Ok(st) => Some(st),
        Err(e) if missing(&e) => None,
        Err(e) => return Err(e),
    };
    let parent = dirname_posix_path(&entry);
    let directory = fs.stat(&parent).map_err(resolution_error)?;
    if directory.mode & 0o300 != 0o300 {
        return Err(format!("EACCES: permission denied, writeStream '{path}'"));
    }
    if let Some(st) = existing {
        if st.mode & 0o200 == 0 {
            return Err(format!("EACCES: permission denied, publishStagedFile '{entry}'"));
        }
        fs.write_file(&entry, bytes)
    } else {
        fs.create_file(&entry, bytes, 0o666)
    }.map_err(|e| crate::commands::coreutils::stream_file_error(e, "writeStream", path))
}

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

pub(super) fn parse(
    src: &str,
    expected_encoding: Option<&str>,
    warnings: Warnings<'_>,
) -> Result<Document, String> {
    let src = src.strip_prefix('\u{feff}').unwrap_or(src);
    if !src.chars().all(valid) {
        return Err("Invalid XML: invalid character".into());
    }
    let normalized;
    let src = if src.contains('\r') {
        normalized = src.replace("\r\n", "\n").replace('\r', "\n");
        &normalized
    } else {
        src
    };
    document(src, expected_encoding, warnings).map_err(|e| {
        if e == "XML resource limit exceeded" {
            e.into()
        } else {
            format!("Invalid XML: {e}")
        }
    })
}

fn document(
    mut s: &str,
    expected_encoding: Option<&str>,
    mut warnings: Warnings<'_>,
) -> Result<Document, &'static str> {
    let size = s.len();
    let mut doc = Document::default();
    let mut stack: Vec<Element> = Vec::new();
    let mut has_root = false;
    const XML: &str = "http://www.w3.org/XML/1998/namespace";
    const XMLNS: &str = "http://www.w3.org/2000/xmlns/";
    let mut namespaces = HashMap::from([("xml", vec![XML.to_owned()])]);
    let mut declarations = Vec::new();
    let mut scope_starts = Vec::new();
    while !s.is_empty() {
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
                if s.len() != size || target != "xml" {
                    return Err("unsupported XML declaration");
                }
                (doc.encoding, doc.standalone) =
                    declaration(body, expected_encoding).ok_or("unsupported XML declaration")?;
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
                repair(&mut warnings, "mismatched closing tag")?;
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
                let value = decode(value, true, &mut warnings)?;
                if key == "xmlns" || key.starts_with("xmlns:") {
                    let prefix = key.strip_prefix("xmlns:").unwrap_or("");
                    if prefix == "xmlns"
                        || value == XMLNS
                        || (prefix == "xml") != (value == XML)
                        || (!prefix.is_empty() && value.is_empty())
                    {
                        return Err("invalid namespace binding");
                    }
                    namespaces.entry(prefix).or_default().push(value.clone());
                    declarations.push(prefix);
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
                if has_root {
                    return Err("multiple root elements");
                }
                has_root = true;
            }
            // The DOM consumers recurse when rendering or dropping a tree.
            if stack.len() >= 512 {
                return Err("XML resource limit exceeded");
            }
            let el = Element {
                tag: tag.into(),
                attrs,
                children: Vec::new(),
            };
            let empty = s.starts_with('/');
            if empty {
                s = &s[1..];
            }
            if let Some(tail) = s.strip_prefix('>') {
                s = tail;
            } else {
                repair(&mut warnings, "unterminated start tag")?;
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
            let decoded = decode(text, false, &mut warnings)?;
            if decoded.is_empty() {
                continue;
            }
            Node::Text(decoded)
        };
        if matches!(&node, Node::Element(_)) {
            for prefix in declarations.drain(scope_starts.pop().unwrap()..) {
                let bindings = namespaces.get_mut(prefix).unwrap();
                bindings.pop();
                if bindings.is_empty() {
                    namespaces.remove(prefix);
                }
            }
        }
        if let Some(parent) = stack.last_mut() {
            parent.children.push(node);
        } else {
            doc.nodes.push(node);
        }
    }
    if !has_root {
        return Err("incomplete document");
    }
    if !stack.is_empty() {
        repair(&mut warnings, "incomplete document")?;
        while let Some(el) = stack.pop() {
            if let Some(parent) = stack.last_mut() {
                parent.children.push(Node::Element(el));
            } else {
                doc.nodes.push(Node::Element(el));
            }
        }
    }
    Ok(doc)
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

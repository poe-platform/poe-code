use super::{HtmlElement, HtmlNode, JVal};
use std::collections::{HashMap, HashSet};

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

fn decode(mut s: &str, attr: bool) -> Result<String, &'static str> {
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
        let (token, rest) = entity.split_once(';').ok_or("unterminated entity")?;
        out.push(match token {
            "amp" => '&',
            "lt" => '<',
            "gt" => '>',
            "quot" => '"',
            "apos" => '\'',
            _ => {
                let n = token.strip_prefix('#').ok_or("undeclared entity")?;
                let (radix, digits) = n.strip_prefix('x').map_or((10, n), |s| (16, s));
                if digits.is_empty() {
                    return Err("undeclared entity");
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
        s = rest;
    }
}

pub(super) fn parse(src: &str) -> Result<Vec<HtmlNode>, String> {
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
    document(src).map_err(|e| {
        if e == "XML resource limit exceeded" {
            e.into()
        } else {
            format!("Invalid XML: {e}")
        }
    })
}

fn document(mut s: &str) -> Result<Vec<HtmlNode>, &'static str> {
    let mut roots = Vec::new();
    let mut stack: Vec<HtmlElement> = Vec::new();
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
            continue;
        } else if let Some(rest) = s.strip_prefix("<![CDATA[") {
            if stack.is_empty() {
                return Err("CDATA outside root");
            }
            let (body, tail) = rest.split_once("]]>").ok_or("unterminated CDATA")?;
            s = tail;
            HtmlNode::Text(body.into())
        } else if s.starts_with("<!") {
            return Err("DTD and entity declarations are forbidden");
        } else if let Some(mut rest) = s.strip_prefix("<?") {
            name(&mut rest)?;
            let (body, tail) = rest
                .split_once("?>")
                .ok_or("unterminated processing instruction")?;
            if !body.is_empty() && !body.starts_with(space) {
                return Err("invalid processing instruction");
            }
            s = tail;
            continue;
        } else if let Some(mut rest) = s.strip_prefix("</") {
            let end = name(&mut rest)?;
            s = rest
                .trim_start_matches(space)
                .strip_prefix('>')
                .ok_or("mismatched closing tag")?;
            let el = stack
                .pop()
                .filter(|e| e.tag == end)
                .ok_or("mismatched closing tag")?;
            HtmlNode::Element(el)
        } else if let Some(rest) = s.strip_prefix('<') {
            s = rest;
            let tag = name(&mut s)?;
            let mut attrs = Vec::new();
            let mut names = HashSet::new();
            scope_starts.push(declarations.len());
            loop {
                let rest = s.trim_start_matches(space);
                if rest.starts_with(['/', '>']) {
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
                let value = decode(value, true)?;
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
            let el = HtmlElement {
                tag: tag.into(),
                attrs,
                children: Vec::new(),
            };
            if let Some(tail) = s.strip_prefix("/>") {
                s = tail;
                HtmlNode::Element(el)
            } else {
                s = s.strip_prefix('>').ok_or("unterminated start tag")?;
                stack.push(el);
                continue;
            }
        } else {
            let (text, tail) = s.split_at(s.find('<').unwrap_or(s.len()));
            s = tail;
            if text.contains("]]>") {
                return Err("CDATA terminator in text");
            }
            if stack.is_empty() && !text.chars().all(space) {
                return Err("text outside the root");
            }
            HtmlNode::Text(decode(text, false)?)
        };
        if matches!(&node, HtmlNode::Element(_)) {
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
            roots.push(node);
        }
    }
    if !has_root || !stack.is_empty() {
        return Err("incomplete document");
    }
    Ok(roots)
}

pub(super) fn to_json(nodes: Vec<HtmlNode>, plus: bool) -> JVal {
    fn element(el: HtmlElement, plus: bool) -> (String, JVal) {
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
                HtmlNode::Text(s) => text.push_str(&s),
                HtmlNode::Element(child) => {
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
                HtmlNode::Element(el) => Some(element(el, plus)),
                _ => None,
            })
            .collect(),
    )
}

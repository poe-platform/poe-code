//! Owned HTML token/tree processing and Markdown formatting for web tools.
//! This bounded parser is not a complete implementation of HTML5 tree construction.
use crate::html_entities::ENTITIES;
use mcp_protocol_rust::strings::trim_ecmascript;
#[derive(Default)]
struct Node {
    tag: String,
    attrs: Vec<(String, Vec<u16>)>,
    text: Vec<u16>,
    children: Vec<usize>,
    parent: usize,
}
fn ascii(value: &[u16]) -> String {
    String::from_utf16_lossy(value).to_ascii_lowercase()
}
fn ws(unit: u16) -> bool {
    trim_ecmascript(&[unit]).is_empty()
}
fn ascii_ws(unit: u16) -> bool {
    [32, 9, 10, 13, 12].contains(&unit)
}
fn block(tag: &str) -> bool {
    [
        "address",
        "article",
        "aside",
        "audio",
        "blockquote",
        "body",
        "canvas",
        "center",
        "dd",
        "dir",
        "div",
        "dl",
        "dt",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "frameset",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hgroup",
        "hr",
        "html",
        "isindex",
        "li",
        "main",
        "menu",
        "nav",
        "noframes",
        "noscript",
        "ol",
        "output",
        "p",
        "pre",
        "section",
        "table",
        "tbody",
        "td",
        "tfoot",
        "th",
        "thead",
        "tr",
        "ul",
    ]
    .contains(&tag)
}
fn void(tag: &str) -> bool {
    [
        "area", "base", "br", "col", "command", "embed", "hr", "img", "input", "keygen", "link",
        "meta", "param", "source", "track", "wbr",
    ]
    .contains(&tag)
}
fn meaningful(tag: &str) -> bool {
    [
        "a", "table", "thead", "tbody", "tfoot", "th", "td", "iframe", "script", "audio", "video",
    ]
    .contains(&tag)
}
fn units(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn append(out: &mut Vec<u16>, value: &str) {
    out.extend(value.encode_utf16());
}
fn numeric(code: u32) -> Vec<u16> {
    let special = [
        0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039,
        0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
        0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
    ];
    let code = if (128..160).contains(&code) {
        special[(code - 128) as usize]
    } else {
        code
    };
    let c = char::from_u32(code)
        .filter(|_| code != 0)
        .unwrap_or('\u{fffd}');
    c.encode_utf16(&mut [0; 2]).to_vec()
}
fn entities(input: &[u16], attribute: bool) -> Vec<u16> {
    let mut out = vec![];
    let mut i = 0;
    while i < input.len() {
        if input[i] != 38 {
            out.push(input[i]);
            i += 1;
            continue;
        }
        let start = i;
        i += 1;
        if input.get(i) == Some(&35) {
            i += 1;
            let hex = input.get(i).is_some_and(|u| *u == 120 || *u == 88);
            if hex {
                i += 1;
            }
            let digits = i;
            while input.get(i).is_some_and(|u| {
                u8::try_from(*u).is_ok_and(|c| {
                    if hex {
                        c.is_ascii_hexdigit()
                    } else {
                        c.is_ascii_digit()
                    }
                })
            }) {
                i += 1;
            }
            if i > digits {
                let value = String::from_utf16_lossy(&input[digits..i]);
                let code =
                    u32::from_str_radix(&value, if hex { 16 } else { 10 }).unwrap_or(u32::MAX);
                out.extend(numeric(code));
                if input.get(i) == Some(&59) {
                    i += 1;
                }
                continue;
            }
            i = start + 1;
            out.push(38);
            continue;
        }
        let mut end = i;
        while end < input.len()
            && end - i < 32
            && u8::try_from(input[end]).is_ok_and(|c| c.is_ascii_alphanumeric())
        {
            end += 1;
        }
        if input.get(end) == Some(&59) {
            end += 1;
        }
        let mut found = None;
        for stop in (i + 1..=end).rev() {
            let name = String::from_utf16_lossy(&input[i..stop]);
            if let Ok(index) = ENTITIES.binary_search_by(|(key, _)| key.cmp(&name.as_str())) {
                let terminated = input[stop - 1] == 59;
                if !terminated
                    && attribute
                    && input.get(stop).is_some_and(|u| {
                        *u == 61 || u8::try_from(*u).is_ok_and(|c| c.is_ascii_alphanumeric())
                    })
                {
                    break;
                }
                found = Some((stop, ENTITIES[index].1));
                break;
            }
        }
        if let Some((stop, value)) = found {
            out.extend(value);
            i = stop;
        } else {
            out.push(38);
            i = start + 1;
        }
    }
    out
}
fn parse(input: &[u16]) -> Result<Vec<Node>, String> {
    if input.len() > 200000 {
        return Err("HTML input exceeds 200000 UTF16 units".into());
    }
    let mut nodes = vec![Node::default()];
    let mut stack = vec![0];
    let mut i = 0;
    while i < input.len() {
        let parent = *stack.last().unwrap();
        if ["script", "style", "textarea", "title"].contains(&nodes[parent].tag.as_str()) {
            let raw_start = i;
            let closing = units(&format!("</{}", nodes[parent].tag));
            while i < input.len()
                && !input[i..]
                    .iter()
                    .zip(&closing)
                    .all(|(a, b)| (if (65..=90).contains(a) { *a + 32 } else { *a }) == *b)
            {
                i += 1;
            }
            let text = if ["textarea", "title"].contains(&nodes[parent].tag.as_str()) {
                entities(&input[raw_start..i], false)
            } else {
                input[raw_start..i].to_vec()
            };
            if !text.is_empty() {
                let index = nodes.len();
                nodes.push(Node {
                    text,
                    parent,
                    ..Node::default()
                });
                nodes[parent].children.push(index);
            }
            if i == input.len() {
                break;
            }
        }
        if input[i..].starts_with(&[60, 33, 45, 45]) {
            i += 4;
            while i < input.len() && !input[i..].starts_with(&[45, 45, 62]) {
                i += 1;
            }
            i = (i + 3).min(input.len());
            continue;
        }
        if input[i] == 60 && input.get(i + 1).is_some_and(|u| *u == 33 || *u == 63) {
            while i < input.len() && input[i] != 62 {
                i += 1;
            }
            i = (i + 1).min(input.len());
            continue;
        }
        let closing = input[i..].starts_with(&[60, 47]);
        let name_start = i + if closing { 2 } else { 1 };
        if input[i] == 60
            && input
                .get(name_start)
                .is_some_and(|u| u8::try_from(*u).is_ok_and(|c| c.is_ascii_alphabetic()))
        {
            let mut cursor = name_start;
            while cursor < input.len()
                && !ascii_ws(input[cursor])
                && ![47, 62].contains(&input[cursor])
            {
                cursor += 1;
            }
            let tag = ascii(&input[name_start..cursor]);
            let mut attrs = vec![];
            let mut self_close = false;
            while cursor < input.len() && input[cursor] != 62 {
                if ascii_ws(input[cursor]) {
                    cursor += 1;
                    continue;
                }
                if input[cursor] == 47 {
                    self_close = true;
                    cursor += 1;
                    continue;
                }
                let start = cursor;
                while cursor < input.len()
                    && !ascii_ws(input[cursor])
                    && ![61, 47, 62].contains(&input[cursor])
                {
                    cursor += 1;
                }
                if start == cursor {
                    cursor += 1;
                    continue;
                }
                let key = ascii(&input[start..cursor]);
                while cursor < input.len() && ascii_ws(input[cursor]) {
                    cursor += 1;
                }
                let mut value = vec![];
                if input.get(cursor) == Some(&61) {
                    cursor += 1;
                    while cursor < input.len() && ascii_ws(input[cursor]) {
                        cursor += 1;
                    }
                    let quote = input.get(cursor).copied().filter(|u| *u == 34 || *u == 39);
                    if quote.is_some() {
                        cursor += 1;
                    }
                    let start = cursor;
                    while cursor < input.len()
                        && if let Some(q) = quote {
                            input[cursor] != q
                        } else {
                            !ascii_ws(input[cursor]) && input[cursor] != 62
                        }
                    {
                        cursor += 1;
                    }
                    value = entities(&input[start..cursor], true);
                    if quote.is_some() && cursor < input.len() {
                        cursor += 1;
                    }
                }
                if !attrs.iter().any(|(old, _)| old == &key) {
                    attrs.push((key, value));
                }
            }
            i = (cursor + 1).min(input.len());
            if closing {
                if let Some(pos) = stack.iter().rposition(|index| nodes[*index].tag == tag) {
                    stack.truncate(pos.max(1));
                }
                continue;
            }
            if tag == "li" && nodes[*stack.last().unwrap()].tag == "li" {
                stack.pop();
            }
            if block(&tag) && tag != "p" && nodes[*stack.last().unwrap()].tag == "p" {
                stack.pop();
            }
            if tag == "p" && nodes[*stack.last().unwrap()].tag == "p" {
                stack.pop();
            }
            let parent = *stack.last().unwrap();
            let index = nodes.len();
            nodes.push(Node {
                tag: tag.clone(),
                attrs,
                parent,
                ..Node::default()
            });
            nodes[parent].children.push(index);
            if !void(&tag) && !self_close {
                if stack.len() >= 129 {
                    return Err("HTML nesting exceeds 128 levels".into());
                }
                stack.push(index);
            }
        } else {
            let start = i;
            i += 1;
            while i < input.len() && input[i] != 60 {
                i += 1;
            }
            let mut text = entities(&input[start..i], false);
            let mut normalized = vec![];
            let mut n = 0;
            while n < text.len() {
                let c = text[n];
                normalized.push(if c == 13 {
                    10
                } else if c == 0 {
                    0xfffd
                } else {
                    c
                });
                if c == 13 && text.get(n + 1) == Some(&10) {
                    n += 1;
                }
                n += 1;
            }
            text = normalized;
            let index = nodes.len();
            nodes.push(Node {
                text,
                parent,
                ..Node::default()
            });
            nodes[parent].children.push(index);
        }
    }
    Ok(nodes)
}
fn collapse(nodes: &mut [Node]) {
    let mut frames = vec![(0, false)];
    let mut previous = None;
    let mut keep = false;
    while let Some((index, exit)) = frames.pop() {
        if nodes[index].tag.is_empty() && index != 0 {
            let mut text = vec![];
            let mut space = false;
            for c in &nodes[index].text {
                if [32, 13, 10, 9].contains(c) {
                    if !space {
                        text.push(32);
                    }
                    space = true;
                } else {
                    text.push(*c);
                    space = false;
                }
            }
            if text.first() == Some(&32)
                && !keep
                && previous.is_none_or(|p: usize| nodes[p].text.last() == Some(&32))
            {
                text.remove(0);
            }
            nodes[index].text = text;
            if !nodes[index].text.is_empty() {
                previous = Some(index);
            }
            continue;
        }
        if block(&nodes[index].tag) || nodes[index].tag == "br" {
            if let Some(p) = previous
                && nodes[p].text.last() == Some(&32)
            {
                nodes[p].text.pop();
            }
            previous = None;
            keep = false;
        } else if void(&nodes[index].tag) || nodes[index].tag == "pre" {
            previous = None;
            keep = true;
        } else if previous.is_some() {
            keep = false;
        }
        if !exit && nodes[index].tag != "pre" {
            frames.push((index, true));
            for child in nodes[index].children.iter().rev() {
                frames.push((*child, false));
            }
        }
    }
    if let Some(p) = previous
        && nodes[p].text.last() == Some(&32)
    {
        nodes[p].text.pop();
    }
    let removed: Vec<_> = nodes
        .iter()
        .enumerate()
        .map(|(i, n)| i != 0 && n.tag.is_empty() && n.text.is_empty())
        .collect();
    for n in nodes {
        n.children.retain(|i| !removed[*i]);
    }
}
fn join(out: &mut Vec<u16>, value: &[u16]) {
    let trailing = out.iter().rev().take_while(|u| **u == 10).count();
    let leading = value.iter().take_while(|u| **u == 10).count();
    out.truncate(out.len() - trailing);
    out.extend(std::iter::repeat_n(10, trailing.max(leading).min(2)));
    out.extend(&value[leading..]);
}
fn escape(value: &[u16]) -> Vec<u16> {
    let mut out = vec![];
    for (i, c) in value.iter().enumerate() {
        if [92, 42, 96, 91, 93, 95].contains(c) || (i == 0 && [45, 62].contains(c)) {
            out.push(92);
        }
        out.push(*c);
    }
    if value.first() == Some(&43) && value.get(1) == Some(&32)
        || value.first() == Some(&61)
        || value.starts_with(&[126, 126, 126])
    {
        out.insert(0, 92);
    }
    let hashes = value.iter().take_while(|u| **u == 35).count();
    if (1..=6).contains(&hashes) && value.get(hashes) == Some(&32) {
        out.insert(0, 92);
    }
    let digits = value.iter().take_while(|u| (48..=57).contains(*u)).count();
    if digits > 0 && value.get(digits) == Some(&46) && value.get(digits + 1) == Some(&32) {
        out.insert(digits, 92);
    }
    out
}
fn attribute<'a>(node: &'a Node, key: &str) -> &'a [u16] {
    node.attrs
        .iter()
        .find(|(name, _)| name == key)
        .map_or(&[], |(_, value)| value)
}
fn clean_attr(value: &[u16]) -> Vec<u16> {
    let mut result = vec![];
    let mut i = 0;
    while i < value.len() {
        result.push(value[i]);
        if value[i] == 10 {
            i += 1;
            while i < value.len() && ws(value[i]) {
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    result
}
fn destination(value: &[u16]) -> Vec<u16> {
    let mut out = vec![];
    for c in value {
        if [60, 62, 40, 41].contains(c) {
            out.push(92);
        }
        out.push(*c);
    }
    if out.contains(&32) {
        out.insert(0, 60);
        out.push(62);
    }
    out
}
fn titled(out: &mut Vec<u16>, title: &[u16]) {
    let title = clean_attr(title);
    if !title.is_empty() {
        append(out, " \"");
        for c in title {
            if c == 34 {
                out.push(92);
            }
            out.push(c);
        }
        out.push(34);
    }
}
fn surrounded(content: &[u16]) -> Vec<u16> {
    let mut out = vec![10, 10];
    out.extend(content);
    out.extend([10, 10]);
    out
}
fn trim_newlines(value: &[u16]) -> &[u16] {
    let start = value.iter().take_while(|u| **u == 10).count();
    let end = value.len() - value.iter().rev().take_while(|u| **u == 10).count();
    &value[start.min(end)..end]
}
pub fn convert(input: &[u16]) -> Result<Vec<u16>, String> {
    let mut nodes = parse(input)?;
    collapse(&mut nodes);
    let mut texts: Vec<Vec<u16>> = vec![vec![]; nodes.len()];
    let mut outputs: Vec<Vec<u16>> = vec![vec![]; nodes.len()];
    let mut special = vec![false; nodes.len()];
    for index in (0..nodes.len()).rev() {
        let node = &nodes[index];
        let mut text = node.text.clone();
        let mut contains = void(&node.tag) || meaningful(&node.tag);
        for child in &node.children {
            text.extend(&texts[*child]);
            contains |= special[*child];
        }
        special[index] = contains;
        texts[index] = text.clone();
    }
    for index in (0..nodes.len()).rev() {
        let node = &nodes[index];
        let text = texts[index].clone();
        let contains = special[index];
        let mut content = vec![];
        for child in &node.children {
            join(&mut content, &outputs[*child]);
        }
        if node.tag.is_empty() && index != 0 {
            let mut ancestor = node.parent;
            let mut code = false;
            while ancestor != 0 {
                code |= nodes[ancestor].tag == "code";
                ancestor = nodes[ancestor].parent;
            }
            outputs[index] = if code { text } else { escape(&text) };
            continue;
        }
        let parent = &nodes[node.parent];
        let blank = !contains && text.iter().all(|u| ws(*u));
        let (mut leading, mut trailing) = (vec![], vec![]);
        if !block(&node.tag) && index != 0 {
            let start = text.iter().take_while(|u| ws(**u)).count();
            let end = text.len() - text.iter().rev().take_while(|u| ws(**u)).count();
            leading.extend(&text[..start]);
            if start < text.len() {
                trailing.extend(&text[end..]);
            }
            let position = parent
                .children
                .iter()
                .position(|child| *child == index)
                .unwrap();
            if position > 0 {
                let sibling = parent.children[position - 1];
                if !block(&nodes[sibling].tag) && texts[sibling].last() == Some(&32) {
                    leading.retain(|u| ![32, 9, 13, 10].contains(u));
                }
            }
            if let Some(sibling) = parent.children.get(position + 1)
                && !block(&nodes[*sibling].tag)
                && texts[*sibling].first() == Some(&32)
            {
                trailing.retain(|u| ![32, 9, 13, 10].contains(u));
            }
            if !leading.is_empty() || !trailing.is_empty() {
                content = trim_ecmascript(&content).to_vec();
            }
        }
        let replacement = if blank {
            if block(&node.tag) {
                vec![10, 10]
            } else {
                vec![]
            }
        } else {
            match node.tag.as_str() {
                "p" => surrounded(&content),
                "br" => vec![32, 32, 10],
                "hr" => surrounded(&units("* * *")),
                "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                    let mut out = vec![35; node.tag.as_bytes()[1] as usize - 48];
                    out.push(32);
                    out.extend(&content);
                    surrounded(&out)
                }
                "blockquote" => {
                    let mut out = units("> ");
                    for c in trim_newlines(&content) {
                        out.push(*c);
                        if *c == 10 {
                            append(&mut out, "> ");
                        }
                    }
                    surrounded(&out)
                }
                "ul" | "ol" => {
                    if parent.tag == "li"
                        && parent
                            .children
                            .iter()
                            .rev()
                            .find(|c| !nodes[**c].tag.is_empty())
                            == Some(&index)
                    {
                        let mut out = vec![10];
                        out.extend(&content);
                        out
                    } else {
                        surrounded(&content)
                    }
                }
                "li" => {
                    let prefix = if parent.tag == "ol" {
                        let start = attribute(parent, "start");
                        let number = if start.is_empty() {
                            1.0
                        } else {
                            String::from_utf16_lossy(trim_ecmascript(start))
                                .parse::<f64>()
                                .unwrap_or(f64::NAN)
                        };
                        let pos = parent
                            .children
                            .iter()
                            .filter(|c| !nodes[**c].tag.is_empty())
                            .position(|c| *c == index)
                            .unwrap();
                        units(&format!("{}.  ", number + pos as f64))
                    } else {
                        units("*   ")
                    };
                    let mut body = trim_newlines(&content).to_vec();
                    if content.last() == Some(&10) {
                        body.push(10);
                    }
                    let mut out = prefix.clone();
                    for c in body {
                        out.push(c);
                        if c == 10 {
                            out.extend(std::iter::repeat_n(32, prefix.len()));
                        }
                    }
                    if parent.children.last() != Some(&index) {
                        out.push(10);
                    }
                    out
                }
                "em" | "i" | "strong" | "b" => {
                    if trim_ecmascript(&content).is_empty() {
                        vec![]
                    } else {
                        let delimiter = if node.tag == "em" || node.tag == "i" {
                            units("_")
                        } else {
                            units("**")
                        };
                        let mut out = delimiter.clone();
                        out.extend(&content);
                        out.extend(delimiter);
                        out
                    }
                }
                "a" if !attribute(node, "href").is_empty() => {
                    let mut out = vec![91];
                    out.extend(&content);
                    append(&mut out, "](");
                    out.extend(destination(attribute(node, "href")));
                    titled(&mut out, attribute(node, "title"));
                    out.push(41);
                    out
                }
                "img" => {
                    let source = attribute(node, "src");
                    if source.is_empty() {
                        vec![]
                    } else {
                        let mut out = units("![");
                        out.extend(escape(&clean_attr(attribute(node, "alt"))));
                        append(&mut out, "](");
                        out.extend(destination(source));
                        titled(&mut out, attribute(node, "title"));
                        out.push(41);
                        out
                    }
                }
                "pre"
                    if node
                        .children
                        .first()
                        .is_some_and(|c| nodes[*c].tag == "code") =>
                {
                    let child = node.children[0];
                    let code = &texts[child];
                    let mut fence = 3;
                    for line in code.split(|u| *u == 10) {
                        let count = line.iter().take_while(|u| **u == 96).count();
                        if count >= fence {
                            fence = count + 1;
                        }
                    }
                    let mut out = vec![96; fence];
                    let class = attribute(&nodes[child], "class");
                    let marker = units("language-");
                    if let Some(pos) = class.windows(marker.len()).position(|w| w == marker) {
                        let rest = &class[pos + marker.len()..];
                        out.extend(rest.iter().take_while(|u| !ws(**u)));
                    }
                    out.push(10);
                    out.extend(if code.last() == Some(&10) {
                        &code[..code.len() - 1]
                    } else {
                        code
                    });
                    out.push(10);
                    out.extend(std::iter::repeat_n(96, fence));
                    surrounded(&out)
                }
                "code" if parent.tag != "pre" || parent.children.len() > 1 => {
                    let body: Vec<_> = content
                        .iter()
                        .map(|c| if *c == 10 || *c == 13 { 32 } else { *c })
                        .collect();
                    if body.is_empty() {
                        vec![]
                    } else {
                        let runs: Vec<_> = body.split(|u| *u != 96).map(<[u16]>::len).collect();
                        let mut length = 1;
                        while runs.contains(&length) {
                            length += 1;
                        }
                        let padding = body.first() == Some(&96)
                            || body.last() == Some(&96)
                            || body.first() == Some(&32)
                                && body.last() == Some(&32)
                                && body.iter().any(|c| *c != 32);
                        let mut out = vec![96; length];
                        if padding {
                            out.push(32);
                        }
                        out.extend(body);
                        if padding {
                            out.push(32);
                        }
                        out.extend(std::iter::repeat_n(96, length));
                        out
                    }
                }
                _ => {
                    if block(&node.tag) {
                        surrounded(&content)
                    } else {
                        content
                    }
                }
            }
        };
        let mut out = leading;
        out.extend(replacement);
        out.extend(trailing);
        if out.len() > 8_388_608 {
            return Err("HTML Markdown output exceeds 8388608 UTF16 units".into());
        }
        outputs[index] = out;
    }
    Ok(trim_ecmascript(&outputs[0]).to_vec())
}

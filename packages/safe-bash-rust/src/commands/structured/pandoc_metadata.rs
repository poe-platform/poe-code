//! Markdown frontmatter uses the existing YAML codec and canonical metadata tags.
use super::{
    JVal, MdqDefinitions, PandocPipeTables, pandoc_inlines_to_json, pandoc_list, pandoc_notes,
    parse_pandoc_md_inlines,
};
use config_mutations_rust::{value::Value, yaml};

fn tag(kind: &str, content: JVal) -> JVal {
    JVal::Object(vec![
        ("t".into(), JVal::Str(kind.into())),
        ("c".into(), content),
    ])
}

fn whitespace(ch: char) -> bool {
    ch.is_whitespace() || ch == '\u{feff}'
}

// Match the existing reader's envelope, including ordinary-Markdown fallback.
// A blank line, unindented comment, quoted key, or missing body is not metadata.
fn envelope(source: &str) -> Option<(&str, &str)> {
    fn marker(line: &str, closing: bool) -> bool {
        let line = line
            .strip_suffix('\r')
            .unwrap_or(line)
            .trim_end_matches([' ', '\t']);
        line == "---" || closing && line == "..."
    }
    let (first, rest) = source.split_once('\n')?;
    if !marker(first, false) {
        return None;
    }
    let mut offset = source.len() - rest.len();
    let start = offset;
    for line in rest.split_inclusive('\n') {
        let line = line.strip_suffix('\n')?;
        if marker(line, true) {
            let body = &source[offset + line.len() + 1..];
            return (offset > start && body.chars().any(|ch| !whitespace(ch)))
                .then_some((&source[start..offset], body));
        }
        if !line.starts_with([' ', '\t']) {
            let mut bytes = line.bytes();
            if !bytes
                .next()
                .is_some_and(|ch| ch.is_ascii_alphabetic() || ch == b'_')
            {
                return None;
            }
            let key = line
                .bytes()
                .take_while(|ch| ch.is_ascii_alphanumeric() || matches!(ch, b'_' | b'-'))
                .count();
            if !line[key..].trim_start_matches([' ', '\t']).starts_with(':') {
                return None;
            }
        }
        offset += line.len() + 1;
    }
    None
}

fn charge(
    value: &JVal,
    nodes: &mut usize,
    bytes: &mut usize,
    depth: usize,
) -> Result<(), &'static str> {
    if depth > 64 {
        return Err("E_LIMIT: Metadata nesting limit exceeded");
    }
    *nodes = nodes
        .checked_sub(1)
        .ok_or("E_LIMIT: Metadata node limit exceeded")?;
    let size = std::mem::size_of::<JVal>()
        + match value {
            JVal::Str(text) => text.len(),
            _ => 0,
        };
    *bytes = bytes
        .checked_sub(size)
        .ok_or("E_LIMIT: Metadata memory limit exceeded")?;
    match value {
        JVal::Array(values) => {
            for value in values {
                charge(value, nodes, bytes, depth + 1)?;
            }
        }
        JVal::Object(fields) => {
            for (key, value) in fields {
                *bytes = bytes
                    .checked_sub(key.len())
                    .ok_or("E_LIMIT: Metadata memory limit exceeded")?;
                charge(value, nodes, bytes, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn lower(
    value: Value,
    defs: &MdqDefinitions,
    raw_html: bool,
    depth: usize,
    nodes: &mut usize,
    bytes: &mut usize,
) -> Result<Option<JVal>, &'static str> {
    if depth > 64 {
        return Err("E_LIMIT: Metadata nesting limit exceeded");
    }
    *nodes = nodes
        .checked_sub(1)
        .ok_or("E_LIMIT: Metadata node limit exceeded")?;
    *bytes = bytes
        .checked_sub(std::mem::size_of::<JVal>() * 3)
        .ok_or("E_LIMIT: Metadata memory limit exceeded")?;
    Ok(Some(match value {
        Value::Null | Value::Undefined | Value::Symbol(_) | Value::Unsupported(_) => {
            return Ok(None);
        }
        Value::Bool(value) => tag("MetaBool", JVal::Bool(value)),
        Value::Number(value) => tag(
            "MetaString",
            JVal::Str(mcp_protocol_rust::numbers::format(value)),
        ),
        Value::String(value) | Value::BigInt(value) => {
            let text =
                String::from_utf16(&value).map_err(|_| "E_ENCODING: Invalid Unicode metadata")?;
            *bytes = bytes
                .checked_sub(text.len())
                .ok_or("E_LIMIT: Metadata memory limit exceeded")?;
            let text = text
                .split('\n')
                .map(|line| line.trim_matches(whitespace))
                .collect::<Vec<_>>()
                .join("\n");
            let mut inlines = parse_pandoc_md_inlines(&text, Some(defs), raw_html)
                .ok_or("E_LIMIT: Metadata inline nesting limit exceeded")?;
            let sources = std::collections::HashMap::new();
            let mut resolver = pandoc_notes::Resolver {
                sources: &sources,
                definitions: defs,
                tables: PandocPipeTables::Disabled,
                tasks: pandoc_list::Tasks::Disabled,
                raw_html,
                nodes: *nodes,
                bytes: *bytes,
                active: Default::default(),
            };
            if resolver.inlines(&mut inlines, depth).is_none() {
                return Err(if resolver.nodes == 0 {
                    "E_LIMIT: Metadata node limit exceeded"
                } else {
                    "E_LIMIT: Metadata inline nesting or expansion limit exceeded"
                });
            }
            *nodes = resolver.nodes;
            *bytes = resolver.bytes;
            let inlines = pandoc_inlines_to_json(&inlines);
            charge(&inlines, nodes, bytes, depth)?;
            tag("MetaInlines", inlines)
        }
        Value::Array(values) => {
            let mut items = Vec::new();
            for value in values {
                if let Some(value) = lower(value, defs, raw_html, depth + 1, nodes, bytes)? {
                    items.push(value);
                }
            }
            tag("MetaList", JVal::Array(items))
        }
        Value::Object(fields) => {
            let mut entries = Vec::new();
            for (key, value) in fields {
                if let Some(value) = lower(value, defs, raw_html, depth + 1, nodes, bytes)? {
                    let key = String::from_utf16(&key)
                        .map_err(|_| "E_ENCODING: Invalid Unicode metadata key")?;
                    *bytes = bytes
                        .checked_sub(key.len())
                        .ok_or("E_LIMIT: Metadata memory limit exceeded")?;
                    entries.push((key, value));
                }
            }
            tag("MetaMap", JVal::Object(entries))
        }
        Value::Date(_) | Value::DateLiteral(_) => tag("MetaMap", JVal::Object(Vec::new())),
    }))
}

pub(super) fn read<'a>(
    source: &'a str,
    defs: &MdqDefinitions,
    raw_html: bool,
    limits: &crate::ShellLimits,
) -> Result<(&'a str, Vec<(String, JVal)>), &'static str> {
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    let Some((header, body)) = envelope(source) else {
        return Ok((source, Vec::new()));
    };
    if source.len() > limits.max_input_bytes {
        return Err("E_LIMIT: Metadata source byte limit exceeded");
    }
    if header.len() > limits.max_parse_units {
        return Err("E_LIMIT: Metadata source work limit exceeded");
    }
    let mut bytes = limits
        .max_memory_bytes
        .checked_sub(header.len().saturating_mul(2))
        .ok_or("E_LIMIT: Metadata memory limit exceeded")?;
    let Ok(parsed) = yaml::parse_with_options(
        &header.encode_utf16().collect::<Vec<_>>(),
        None,
        yaml::ParseOptions {
            object_root: false,
            max_alias_count: 32,
            ..Default::default()
        },
    ) else {
        return Ok((source, Vec::new()));
    };
    if !matches!(parsed.value, Value::Object(_)) {
        return Ok((source, Vec::new()));
    }
    let mut nodes = limits.max_parse_units;
    let Some(JVal::Object(mut tagged)) =
        lower(parsed.value, defs, raw_html, 0, &mut nodes, &mut bytes)?
    else {
        return Ok((source, Vec::new()));
    };
    let (_, JVal::Object(metadata)) = tagged.pop().unwrap() else {
        return Ok((source, Vec::new()));
    };
    Ok((body, metadata))
}

pub(super) fn overrides(
    metadata: &mut Vec<(String, JVal)>,
    values: &std::collections::BTreeMap<String, String>,
) {
    for (key, value) in values {
        let value = tag("MetaString", JVal::Str(value.clone()));
        if let Some((_, prior)) = metadata.iter_mut().find(|(name, _)| name == key) {
            *prior = value;
        } else {
            metadata.push((key.clone(), value));
        }
    }
}

// Select the document head from the existing DOM. Title is RCDATA in that DOM,
// and meta content is already decoded attribute text; neither is Markdown.
pub(super) fn html(
    nodes: &mut Vec<super::HtmlNode>,
    limits: &crate::ShellLimits,
) -> Result<Vec<(String, JVal)>, &'static str> {
    use super::{HtmlNode, PandocInline, pandoc_blocks};
    fn envelope(
        nodes: Vec<HtmlNode>,
        head: &mut bool,
        values: &mut Vec<(String, String)>,
        base: &mut Option<String>,
    ) -> Vec<HtmlNode> {
        let mut body = Vec::new();
        for mut node in nodes {
            let HtmlNode::Element(element) = &mut node else {
                let HtmlNode::Text(text) = &node else {
                    unreachable!()
                };
                if *head
                    && text
                        .chars()
                        .all(|ch| matches!(ch, ' ' | '\t' | '\n' | '\r' | '\u{000c}'))
                {
                    continue;
                }
                *head = false;
                body.push(node);
                continue;
            };
            match element.tag.as_str() {
                "html" => {
                    element.children =
                        envelope(std::mem::take(&mut element.children), head, values, base);
                    body.push(node);
                }
                "head" => body.extend(envelope(
                    std::mem::take(&mut element.children),
                    head,
                    values,
                    base,
                )),
                "base" if *head => {
                    if base.is_none() {
                        *base = element
                            .attrs
                            .iter()
                            .find(|(key, _)| key.eq_ignore_ascii_case("href"))
                            .map(|(_, value)| value.clone());
                    }
                }
                "title" | "meta" if *head => {
                    let value = if element.tag == "title" {
                        Some((
                            "title",
                            element
                                .children
                                .iter()
                                .filter_map(|node| match node {
                                    HtmlNode::Text(text) => Some(text.as_str()),
                                    _ => None,
                                })
                                .collect::<String>(),
                        ))
                    } else if element.attrs.iter().any(|(key, value)| {
                        key.eq_ignore_ascii_case("name") && value.eq_ignore_ascii_case("author")
                    }) {
                        Some((
                            "author",
                            element
                                .attrs
                                .iter()
                                .find(|(key, _)| key.eq_ignore_ascii_case("content"))
                                .map(|(_, value)| value.clone())
                                .unwrap_or_default(),
                        ))
                    } else {
                        None
                    };
                    if let Some((key, value)) = value {
                        if let Some((_, prior)) = values.iter_mut().find(|(name, _)| name == key) {
                            *prior = value;
                        } else {
                            values.push((key.into(), value));
                        }
                    }
                }
                "basefont" | "bgsound" | "link" | "noscript" | "noframes" | "style" | "script"
                | "template"
                    if *head => {}
                _ => {
                    *head = false;
                    if element.tag == "body" {
                        element.children =
                            envelope(std::mem::take(&mut element.children), head, values, base);
                    }
                    body.push(node);
                }
            }
        }
        body
    }
    let mut count = limits.max_parse_units;
    let mut bytes = limits.max_memory_bytes;
    let mut pending: Vec<_> = nodes.iter().collect();
    while let Some(node) = pending.pop() {
        count = count
            .checked_sub(1)
            .ok_or("E_LIMIT: HTML node limit exceeded")?;
        let size = match node {
            HtmlNode::Text(text) => text.len(),
            HtmlNode::Element(element) => {
                pending.extend(&element.children);
                element.tag.len()
                    + element
                        .attrs
                        .iter()
                        .map(|(key, value)| key.len() + value.len())
                        .sum::<usize>()
            }
        };
        bytes = bytes
            .checked_sub(size + std::mem::size_of::<HtmlNode>())
            .ok_or("E_LIMIT: HTML memory limit exceeded")?;
    }
    let mut values = Vec::new();
    let mut base = None;
    *nodes = envelope(std::mem::take(nodes), &mut true, &mut values, &mut base);
    if let Some(base) = base {
        let mut pending: Vec<_> = nodes.iter_mut().collect();
        while let Some(node) = pending.pop() {
            if let HtmlNode::Element(element) = node {
                for (key, value) in &mut element.attrs {
                    if (element.tag == "a" && key.eq_ignore_ascii_case("href"))
                        || (element.tag == "img" && key.eq_ignore_ascii_case("src"))
                    {
                        let resolved = super::resolve_relative_url(&base, value);
                        bytes = bytes
                            .checked_sub(resolved.len().saturating_sub(value.len()))
                            .ok_or("E_LIMIT: HTML memory limit exceeded")?;
                        *value = resolved;
                    }
                }
                pending.extend(&mut element.children);
            }
        }
    }
    let mut metadata = Vec::new();
    for (key, value) in values {
        let mut inlines = Vec::new();
        pandoc_blocks::html_inline(&HtmlNode::Text(value), &mut inlines, None, false)
            .ok_or("E_CAPABILITY: Unsupported HTML metadata")?;
        while matches!(inlines.last(), Some(PandocInline::Space)) {
            inlines.pop();
        }
        let start = inlines
            .iter()
            .position(|node| !matches!(node, PandocInline::Space))
            .unwrap_or(inlines.len());
        inlines.drain(..start);
        let value = tag("MetaInlines", pandoc_inlines_to_json(&inlines));
        charge(&value, &mut count, &mut bytes, 0)?;
        metadata.push((key, value));
    }
    Ok(metadata)
}

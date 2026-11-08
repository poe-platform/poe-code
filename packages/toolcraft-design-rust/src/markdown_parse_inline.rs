use crate::markdown_delimiter::{self as delimiter, CharacterClass, Delimiter, Pair};
use crate::markdown_scan as scan;

pub trait Host {
    type Error;
    fn class(&mut self, unit: Option<u16>) -> Result<CharacterClass, Self::Error>;
    fn range(
        &mut self,
        offsets: usize,
        start: usize,
        end: usize,
        delimiter: bool,
    ) -> Result<usize, Self::Error>;
    fn slice_offsets(
        &mut self,
        offsets: usize,
        start: usize,
        end: usize,
        source: &[u16],
    ) -> Result<usize, Self::Error>;
    fn merge_ranges(&mut self, left: usize, right: usize) -> Result<usize, Self::Error>;
    fn wrapper_range(
        &mut self,
        left: usize,
        right: usize,
        opener: usize,
        closer: usize,
    ) -> Result<usize, Self::Error>;
    fn footnote(&mut self, label: &[u16]) -> Result<bool, Self::Error>;
    fn too_deep(&mut self) -> Self::Error;
}

#[derive(Debug)]
pub struct Node {
    pub kind: &'static str,
    pub fields: Vec<(&'static str, Vec<u16>)>,
    pub children: Option<Vec<Node>>,
    pub range: usize,
}

impl Node {
    fn text(value: Vec<u16>, range: usize) -> Self {
        Self {
            kind: "text",
            fields: vec![("value", value)],
            children: None,
            range,
        }
    }
}

fn flush<H: Host>(
    nodes: &mut Vec<Node>,
    buffer: &mut Vec<u16>,
    start: usize,
    end: usize,
    offsets: usize,
    host: &mut H,
) -> Result<(), H::Error> {
    if !buffer.is_empty() {
        nodes.push(Node::text(
            std::mem::take(buffer),
            host.range(offsets, start, end, false)?,
        ));
    }
    Ok(())
}

fn autolink<H: Host>(
    input: &[u16],
    start: usize,
    link: scan::Autolink,
    offsets: usize,
    host: &mut H,
) -> Result<(Node, usize), H::Error> {
    let child = Node::text(
        input[link.text_start..link.text_end].to_vec(),
        host.range(offsets, link.text_start, link.text_end, false)?,
    );
    Ok((
        Node {
            kind: "link",
            fields: vec![("url", link.url)],
            children: Some(vec![child]),
            range: host.range(offsets, start, link.end, false)?,
        },
        link.end,
    ))
}

fn candidate<H: Host>(
    input: &[u16],
    index: usize,
    options: Options,
    host: &mut H,
    depth: usize,
) -> Result<Option<(Node, usize)>, H::Error> {
    let offsets = options.offsets;
    let unit = input[index];
    if unit == 96
        && let Some(code) = scan::inline_code(input, index)
    {
        return Ok(Some((
            Node {
                kind: "inlineCode",
                fields: vec![("value", code.value)],
                children: None,
                range: host.range(offsets, index, code.end, false)?,
            },
            code.end,
        )));
    }
    if unit == 91 && options.footnotes && index + 3 < input.len() && input[index + 1] == 94 {
        let mut end = index + 2;
        while end < input.len()
            && (scan::ascii_letter(input[end])
                || scan::digit(input[end])
                || matches!(input[end], 45 | 95))
        {
            end += 1;
        }
        if end > index + 2
            && input.get(end) == Some(&93)
            && host.footnote(&input[index + 2..end])?
        {
            return Ok(Some((
                Node {
                    kind: "footnoteReference",
                    fields: vec![("label", input[index + 2..end].to_vec())],
                    children: None,
                    range: host.range(offsets, index, end + 1, false)?,
                },
                end + 1,
            )));
        }
    }
    let image = unit == 33 && input.get(index + 1) == Some(&91);
    if (unit == 91 || image)
        && let Some(label) = scan::bracketed_label(input, index + usize::from(image))
        && input.get(label.end) == Some(&40)
        && let Some(destination) = scan::link_destination(input, label.end)
    {
        let mut fields = vec![("url", destination.url)];
        if image {
            fields.push((
                "alt",
                scan::decode_escapes(&input[label.content_start..label.end - 1]),
            ));
        }
        if let Some(title) = destination.title {
            fields.push(("title", title));
        }
        let children = if image {
            None
        } else {
            let child_offsets = host.slice_offsets(
                offsets,
                label.content_start,
                label.end - 1,
                &input[label.content_start..label.end - 1],
            )?;
            Some(parse(
                &input[label.content_start..label.end - 1],
                Options {
                    offsets: child_offsets,
                    literal: false,
                    ..options
                },
                host,
                depth + 1,
            )?)
        };
        return Ok(Some((
            Node {
                kind: if image { "image" } else { "link" },
                fields,
                children,
                range: host.range(offsets, index, destination.end, false)?,
            },
            destination.end,
        )));
    }
    if unit == 60 {
        if let Some(link) = scan::angle_autolink(input, index) {
            return autolink(input, index, link, offsets, host).map(Some);
        }
        if let Some(end) = scan::inline_html_end(input, index) {
            return Ok(Some((
                Node {
                    kind: "html",
                    fields: vec![("value", input[index..end].to_vec())],
                    children: None,
                    range: host.range(offsets, index, end, false)?,
                },
                end,
            )));
        }
    }
    Ok(None)
}

#[derive(Clone, Copy)]
pub struct Options {
    pub offsets: usize,
    pub footnotes: bool,
    pub literal: bool,
}

pub fn parse<H: Host>(
    input: &[u16],
    options: Options,
    host: &mut H,
    depth: usize,
) -> Result<Vec<Node>, H::Error> {
    if depth >= 128 {
        return Err(host.too_deep());
    }
    let mut nodes = Vec::new();
    let mut delimiters = Vec::new();
    let mut buffer = Vec::new();
    let mut text_start = 0;
    let mut index = 0;
    while index < input.len() {
        let unit = input[index];
        if unit == 92 && input.get(index + 1).copied().is_some_and(scan::escapable) {
            if buffer.is_empty() {
                text_start = index;
            }
            buffer.push(input[index + 1]);
            index += 2;
            continue;
        }
        if let Some((node, end)) = candidate(input, index, options, host, depth)? {
            flush(
                &mut nodes,
                &mut buffer,
                text_start,
                index,
                options.offsets,
                host,
            )?;
            nodes.push(node);
            index = end;
            continue;
        }
        if unit == 10 {
            let mut trim = if buffer.last() == Some(&92) { 1 } else { 0 };
            if trim == 0 {
                let spaces = buffer
                    .iter()
                    .rev()
                    .take_while(|unit| matches!(unit, 32 | 9))
                    .count();
                if spaces >= 2 {
                    trim = spaces;
                }
            }
            if trim > 0 {
                buffer.truncate(buffer.len() - trim);
                flush(
                    &mut nodes,
                    &mut buffer,
                    text_start,
                    index - trim,
                    options.offsets,
                    host,
                )?;
                nodes.push(Node {
                    kind: "break",
                    fields: vec![],
                    children: None,
                    range: host.range(options.offsets, index, index + 1, false)?,
                });
                index += 1;
                continue;
            }
        }
        if options.literal
            && let Some(link) = scan::literal_autolink(input, index)
        {
            let (node, end) = autolink(input, index, link, options.offsets, host)?;
            flush(
                &mut nodes,
                &mut buffer,
                text_start,
                index,
                options.offsets,
                host,
            )?;
            nodes.push(node);
            index = end;
            continue;
        }
        if matches!(unit, 42 | 95 | 126) {
            let length = scan::run_length(input, index, unit);
            let before = host.class(index.checked_sub(1).map(|position| input[position]))?;
            let after = host.class(input.get(index + length).copied())?;
            if let Some(mut delimiter) = delimiter::admit(unit, length, before, after, 0) {
                flush(
                    &mut nodes,
                    &mut buffer,
                    text_start,
                    index,
                    options.offsets,
                    host,
                )?;
                delimiter.position = nodes.len();
                delimiters.push(delimiter);
                nodes.push(Node::text(
                    input[index..index + length].to_vec(),
                    host.range(options.offsets, index, index + length, true)?,
                ));
                index += length;
                continue;
            }
        }
        if buffer.is_empty() {
            text_start = index;
        }
        buffer.push(unit);
        index += 1;
    }
    flush(
        &mut nodes,
        &mut buffer,
        text_start,
        index,
        options.offsets,
        host,
    )?;
    if !delimiters.is_empty() {
        let pairs = delimiter::match_pairs(&mut delimiters);
        if !pairs.is_empty() {
            nodes = assemble(nodes, &delimiters, &pairs, host)?;
        }
    }
    normalize(nodes, host, 0)
}

struct Frame {
    pair: Option<usize>,
    node: Node,
}

fn assemble<H: Host>(
    nodes: Vec<Node>,
    delimiters: &[Delimiter],
    pairs: &[Pair],
    host: &mut H,
) -> Result<Vec<Node>, H::Error> {
    let mut entries: Vec<Option<usize>> = vec![None; nodes.len()];
    let mut opens = vec![Vec::new(); delimiters.len()];
    let mut closes = vec![Vec::new(); delimiters.len()];
    for (index, delimiter) in delimiters.iter().enumerate() {
        entries[delimiter.position] = Some(index);
    }
    for (index, pair) in pairs.iter().enumerate() {
        opens[pair.opener].push(index);
        closes[pair.closer].push(index);
    }
    let ranges: Vec<_> = delimiters
        .iter()
        .map(|delimiter| nodes[delimiter.position].range)
        .collect();
    let mut stack = vec![Frame {
        pair: None,
        node: Node {
            kind: "root",
            fields: vec![],
            children: Some(Vec::new()),
            range: 0,
        },
    }];
    for (position, node) in nodes.into_iter().enumerate() {
        let Some(entry) = entries[position] else {
            stack
                .last_mut()
                .unwrap()
                .node
                .children
                .as_mut()
                .unwrap()
                .push(node);
            continue;
        };
        for pair in &closes[entry] {
            if let Some(frame) = stack.pop_if(|frame| frame.pair == Some(*pair)) {
                stack
                    .last_mut()
                    .unwrap()
                    .node
                    .children
                    .as_mut()
                    .unwrap()
                    .push(frame.node);
            }
        }
        let delimiter = delimiters[entry];
        if delimiter.length > 0 {
            stack
                .last_mut()
                .unwrap()
                .node
                .children
                .as_mut()
                .unwrap()
                .push(Node::text(
                    vec![delimiter.marker; delimiter.length],
                    node.range,
                ));
        }
        for pair_id in opens[entry].iter().rev() {
            if stack.len() >= 128 {
                return Err(host.too_deep());
            }
            let pair = pairs[*pair_id];
            stack.push(Frame {
                pair: Some(*pair_id),
                node: Node {
                    kind: pair.kind,
                    fields: vec![],
                    children: Some(Vec::new()),
                    range: host.wrapper_range(
                        ranges[pair.opener],
                        ranges[pair.closer],
                        delimiters[pair.opener].position,
                        delimiters[pair.closer].position,
                    )?,
                },
            });
        }
    }
    while stack.len() > 1 {
        let frame = stack.pop().unwrap();
        stack
            .last_mut()
            .unwrap()
            .node
            .children
            .as_mut()
            .unwrap()
            .push(frame.node);
    }
    Ok(stack.pop().unwrap().node.children.unwrap())
}

fn normalize<H: Host>(nodes: Vec<Node>, host: &mut H, depth: usize) -> Result<Vec<Node>, H::Error> {
    if depth >= 128 {
        return Err(host.too_deep());
    }
    let mut normalized: Vec<Node> = Vec::new();
    for mut node in nodes {
        if node.kind == "text" && node.fields[0].1.is_empty() {
            continue;
        }
        if let Some(children) = node.children.take() {
            node.children = Some(normalize(children, host, depth + 1)?);
        }
        if node.kind == "text"
            && let Some(previous) = normalized.last_mut()
            && previous.kind == "text"
        {
            previous.fields[0].1.extend_from_slice(&node.fields[0].1);
            previous.range = host.merge_ranges(previous.range, node.range)?;
        } else {
            normalized.push(node);
        }
    }
    Ok(normalized)
}

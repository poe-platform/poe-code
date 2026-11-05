use super::{
    MdqBlock, MdqDefinitions, mdq_decode_syntax, mdq_fence, mdq_heading, mdq_html_block_end,
    mdq_interrupts_paragraph, mdq_links, mdq_list_marker, mdq_pipe_row, mdq_setext,
    mdq_thematic_break,
};
use std::borrow::Cow;

// Markers and indentation are measured in expanded columns; inline and literal
// content keep the original bytes, including any unconsumed portion of a tab.
struct Line<'a> {
    raw: &'a str,
    text: Cow<'a, str>,
    tabs: Vec<(usize, usize, usize)>, // expanded start/end and original byte
}
impl<'a> Line<'a> {
    fn new(raw: &'a str) -> Self {
        if !raw.contains('\t') {
            return Self {
                raw,
                text: raw.into(),
                tabs: Vec::new(),
            };
        }
        let mut text = String::new();
        let mut tabs = Vec::new();
        let mut col = 0;
        for (i, c) in raw.char_indices() {
            if c == '\t' {
                let width = 4 - col % 4;
                tabs.push((text.len(), text.len() + width, i));
                text.extend(std::iter::repeat_n(' ', width));
                col += width;
            } else {
                text.push(c);
                col += c.len_utf16();
            }
        }
        Self {
            raw,
            text: text.into(),
            tabs,
        }
    }
    fn raw_from(&self, at: usize) -> Cow<'a, str> {
        let i = self.tabs.partition_point(|&(lo, _, _)| lo < at);
        if i == 0 {
            return self.raw[at..].into();
        }
        let (_, end, raw) = self.tabs[i - 1];
        if at < end {
            return (" ".repeat(end - at) + &self.raw[raw + 1..]).into();
        }
        self.raw[raw + 1 + at - end..].into()
    }
}

fn spaces(s: &str) -> usize {
    s.as_bytes().iter().take_while(|c| **c == b' ').count()
}

enum Container {
    Root,
    Quote,
    Footnote,
    List(u8),
    Item {
        indent: usize,
        empty: bool,
        blank: bool,
    },
}
struct Frame {
    kind: Container,
    node: MdqBlock,
}

fn sections(nodes: Vec<MdqBlock>) -> Vec<MdqBlock> {
    let mut root = Vec::new();
    let mut active: Vec<MdqBlock> = Vec::new();
    for n in nodes {
        if n.kind == "section" {
            while active.last().is_some_and(|prev| prev.level >= n.level) {
                let prev = active.pop().unwrap();
                active
                    .last_mut()
                    .map(|n| &mut n.children)
                    .unwrap_or(&mut root)
                    .push(prev);
            }
            active.push(n);
        } else {
            active
                .last_mut()
                .map(|n| &mut n.children)
                .unwrap_or(&mut root)
                .push(n);
        }
    }
    while let Some(n) = active.pop() {
        active
            .last_mut()
            .map(|n| &mut n.children)
            .unwrap_or(&mut root)
            .push(n);
    }
    root
}

fn close(stack: &mut Vec<Frame>, keep: usize, defs: &mut MdqDefinitions) {
    while stack.len() > keep {
        let Frame { kind, mut node } = stack.pop().unwrap();
        if matches!(kind, Container::Item { .. })
            && let Some(first) = node.children.first_mut()
            && first.kind == "paragraph"
            && let [b'[', state @ (b' ' | b'x' | b'X'), b']', b' ' | b'\t', ..] =
                first.inline.text.as_bytes()
        {
            node.checked = Some(*state != b' ');
            first.inline.text = first.inline.text[3..].trim_start().to_owned();
        }
        if !matches!(kind, Container::List(_)) {
            node.children = sections(node.children);
        }
        if matches!(kind, Container::Footnote) {
            defs.notes.insert(node.text, node.children);
        } else {
            stack.last_mut().unwrap().node.children.push(node);
        }
    }
}

enum Leaf {
    Paragraph(String),
    Fence {
        block: MdqBlock,
        marker: u8,
        width: usize,
        indent: usize,
    },
    Code(Vec<String>),
    Html {
        value: String,
        ends: &'static [&'static str],
    },
    Table(MdqBlock),
}

fn finish(
    leaf: &mut Option<Leaf>,
    frame: &mut Frame,
    defs: &mut MdqDefinitions,
    level: Option<usize>,
) -> bool {
    let Some(leaf) = leaf.take() else {
        return false;
    };
    let node = match leaf {
        Leaf::Paragraph(s) => {
            let text = mdq_links::extract(s.trim_end_matches([' ', '\t']), defs);
            if text.is_empty() {
                return false;
            }
            if let Some(level) = level {
                MdqBlock {
                    kind: "section".into(),
                    inline: super::MdqContent::source(text.into()),
                    level,
                    ..Default::default()
                }
            } else {
                MdqBlock {
                    kind: "paragraph".into(),
                    inline: super::MdqContent::source(text.into()),
                    ..Default::default()
                }
            }
        }
        Leaf::Fence { mut block, .. } => {
            block.text.pop();
            block
        }
        Leaf::Code(mut lines) => {
            while lines
                .last()
                .is_some_and(|s| s.trim_matches([' ', '\t']).is_empty())
            {
                lines.pop();
            }
            MdqBlock {
                kind: "code".into(),
                text: lines.join("\n"),
                ..Default::default()
            }
        }
        Leaf::Html { mut value, .. } => {
            value.truncate(value.trim_end().len());
            MdqBlock {
                kind: "html".into(),
                text: value,
                ..Default::default()
            }
        }
        Leaf::Table(b) => b,
    };
    frame.node.children.push(node);
    true
}

fn table(head: &str, line: &str) -> Option<MdqBlock> {
    let header = mdq_pipe_row(head)?;
    let delimiter = mdq_pipe_row(line)?;
    if header.len() != delimiter.len() {
        return None;
    }
    let aligns = delimiter
        .iter()
        .map(|s| {
            Some(match super::pipe_cell_alignment(s)? {
                std::fmt::Alignment::Center => "center",
                std::fmt::Alignment::Right => "right",
                std::fmt::Alignment::Left if s.starts_with(':') => "left",
                _ => "none",
            }.into())
        })
        .collect::<Option<Vec<_>>>()?;
    Some(MdqBlock {
        kind: "table".into(),
        table_rows: vec![header.into_iter().map(super::MdqContent::source).collect()],
        table_aligns: aligns,
        ..Default::default()
    })
}

pub(super) fn parse(defs: &mut MdqDefinitions, input: &str) -> Result<Vec<MdqBlock>, String> {
    let mut lines = input.lines().skip_while(|s| s.trim().is_empty()).peekable();
    let Some(first) = lines.next() else {
        return Ok(Vec::new());
    };
    let first = first.strip_prefix('\u{feff}').unwrap_or(first);
    let mut stack = vec![Frame {
        kind: Container::Root,
        node: MdqBlock::default(),
    }];
    let mut all = std::iter::once(first).chain(lines);
    let marker = first.trim_end();
    if matches!(marker, "---" | "+++") {
        let mut probe = all.clone().skip(1);
        if let Some(n) = probe.position(|s| s.trim_end() == marker) {
            all.next();
            let text = all.by_ref().take(n).collect::<Vec<_>>().join("\n");
            all.next();
            stack[0].node.children.push(MdqBlock {
                kind: "frontmatter".into(),
                lang: if marker == "---" { "yaml" } else { "toml" }.into(),
                text,
                ..Default::default()
            });
        }
    }
    let mut leaf = None;
    for raw in all {
        let line = Line::new(raw);
        let mut offset = 0;
        let mut matched = 1;
        while matched < stack.len() {
            let tail = &line.text[offset..];
            let indent = spaces(tail);
            match &mut stack[matched].kind {
                Container::List(_) => {}
                Container::Quote if indent <= 3 && tail[indent..].starts_with('>') => {
                    offset += indent + 1;
                    offset += usize::from(line.text[offset..].starts_with(' '));
                }
                Container::Footnote if indent >= 4 || indent == tail.len() => {
                    offset += indent.min(4);
                }
                Container::Item {
                    indent: needed,
                    empty,
                    blank,
                } if !(*empty && *blank) => {
                    if indent >= *needed {
                        offset += *needed;
                    } else if indent == tail.len() {
                        offset += indent;
                    } else {
                        break;
                    }
                    if !line.text[offset..].trim_start_matches(' ').is_empty() {
                        *empty = false;
                    }
                }
                _ => break,
            }
            matched += 1;
        }
        let tail = &line.text[offset..];
        let indent = spaces(tail);
        let blank = indent == tail.len();
        if matched < stack.len() {
            let sibling = matches!(stack[matched].kind, Container::Item { .. })
                && mdq_list_marker(tail).is_some();
            if let Some(Leaf::Paragraph(s)) = &mut leaf
                && !blank
                && !sibling
                && !(matches!(stack[matched].kind, Container::Footnote)
                    && tail[indent..].starts_with("[^")
                    && tail[indent..].contains("]:"))
                && !mdq_interrupts_paragraph(tail)
            {
                s.push('\n');
                s.push_str(&line.raw_from(offset + indent));
                continue;
            }
            finish(&mut leaf, stack.last_mut().unwrap(), defs, None);
            close(&mut stack, matched, defs);
        }
        match &mut leaf {
            Some(Leaf::Fence {
                block,
                marker,
                width,
                indent: opening,
            }) => {
                if mdq_fence(tail)
                    .is_some_and(|(_, m, n, info)| m == *marker && n >= *width && info.is_empty())
                {
                    finish(&mut leaf, stack.last_mut().unwrap(), defs, None);
                } else {
                    block
                        .text
                        .push_str(&line.raw_from(offset + indent.min(*opening)));
                    block.text.push('\n');
                }
                continue;
            }
            Some(Leaf::Html { value, ends }) if !ends.is_empty() || !blank => {
                value.push('\n');
                value.push_str(&line.raw_from(offset));
                if !ends.is_empty() && ends.iter().any(|s| tail.to_ascii_lowercase().contains(s)) {
                    finish(&mut leaf, stack.last_mut().unwrap(), defs, None);
                }
                continue;
            }
            Some(Leaf::Code(code)) if blank || indent >= 4 => {
                code.push(line.raw_from(offset + indent.min(4)).into_owned());
                continue;
            }
            Some(Leaf::Table(b)) if !blank && !mdq_interrupts_paragraph(tail) => {
                if let Some(row) = mdq_pipe_row(&line.raw_from(offset)) {
                    b.table_rows
                        .push(row.into_iter().map(super::MdqContent::source).collect());
                    continue;
                }
            }
            _ => {}
        }
        if blank {
            finish(&mut leaf, stack.last_mut().unwrap(), defs, None);
            if let Container::Item { blank, .. } = &mut stack.last_mut().unwrap().kind {
                *blank = true;
            }
            continue;
        }
        if let Some(Leaf::Paragraph(s)) = &mut leaf {
            if !s.contains('\n')
                && let Some(t) = table(s, &line.raw_from(offset))
            {
                leaf = Some(Leaf::Table(t));
                continue;
            }
            if let Some(level) = mdq_setext(tail) {
                if finish(&mut leaf, stack.last_mut().unwrap(), defs, Some(level)) {
                    continue;
                }
            } else if !mdq_interrupts_paragraph(tail) {
                s.push('\n');
                s.push_str(&line.raw_from(offset + indent));
                continue;
            }
        }
        let was_para = matches!(leaf, Some(Leaf::Paragraph(_)));
        finish(&mut leaf, stack.last_mut().unwrap(), defs, None);
        loop {
            let tail = &line.text[offset..];
            let indent = spaces(tail);
            let at = offset + indent;
            if indent <= 3
                && let Some(rest) = line.text[at..].strip_prefix("[^")
                && let Some((label, after)) = rest.split_once("]:")
                && !label.is_empty()
                && !label.contains(' ')
            {
                if defs.notes.insert(label.to_owned(), Vec::new()).is_some() {
                    return Err(format!(
                        "Markdown parse error:\nfound multiple definitions for link/image/footnote: {label}\n\n"
                    ));
                }
                defs.note_keys.insert(mdq_links::normalized(label));
                stack.push(Frame {
                    kind: Container::Footnote,
                    node: MdqBlock {
                        text: label.into(),
                        ..Default::default()
                    },
                });
                offset = line.text.len() - after.len() + spaces(after);
                continue;
            }
            let item = if !mdq_thematic_break(tail) {
                mdq_list_marker(tail)
            } else {
                None
            };
            if let Container::List(previous) = stack.last().unwrap().kind
                && item.is_none_or(|(m, _, _)| m != previous)
            {
                let len = stack.len();
                close(&mut stack, len - 1, defs);
            }
            if indent <= 3 && line.text[at..].starts_with('>') {
                stack.push(Frame {
                    kind: Container::Quote,
                    node: MdqBlock {
                        kind: "quote".into(),
                        ..Default::default()
                    },
                });
                offset = at + 1 + usize::from(line.text[at + 1..].starts_with(' '));
                continue;
            }
            if let Some((m, start, body)) = item
                && (!was_para || !body.is_empty() && matches!(start, None | Some(1)))
            {
                let empty = body.is_empty();
                let end = at
                    + line.text[at..]
                        .bytes()
                        .take_while(u8::is_ascii_digit)
                        .count()
                    + 1;
                let padding = spaces(&line.text[end..]);
                let consume = if empty || padding > 4 { 1 } else { padding };
                if !matches!(stack.last().unwrap().kind, Container::List(_)) {
                    stack.push(Frame {
                        kind: Container::List(m),
                        node: MdqBlock {
                            kind: "list".into(),
                            index: start,
                            ..Default::default()
                        },
                    });
                }
                let list = &stack.last().unwrap().node;
                let index = list.index.map(|i| i + list.children.len());
                stack.push(Frame {
                    kind: Container::Item {
                        indent: end - offset + consume,
                        empty,
                        blank: false,
                    },
                    node: MdqBlock {
                        kind: "list_item".into(),
                        index,
                        ..Default::default()
                    },
                });
                if empty {
                    break;
                }
                offset = end + consume;
                continue;
            }
            if let Some((level, _)) = mdq_heading(tail) {
                let raw = line.raw_from(at);
                let (_, title) = mdq_heading(&raw).unwrap();
                stack.last_mut().unwrap().node.children.push(MdqBlock {
                    kind: "section".into(),
                    inline: super::MdqContent::source(title.into()),
                    level,
                    ..Default::default()
                });
            } else if mdq_thematic_break(tail) {
                stack.last_mut().unwrap().node.children.push(MdqBlock {
                    kind: "break".into(),
                    ..Default::default()
                });
            } else if let Some((indent, marker, width, _)) = mdq_fence(tail) {
                let info = mdq_decode_syntax(line.raw_from(at + width).trim());
                let (lang, meta) = info
                    .trim()
                    .split_once([' ', '\t'])
                    .unwrap_or((info.trim(), ""));
                leaf = Some(Leaf::Fence {
                    block: MdqBlock {
                        kind: "code".into(),
                        lang: lang.into(),
                        metadata: meta.trim_start().into(),
                        ..Default::default()
                    },
                    indent,
                    marker,
                    width,
                });
            } else if let Some(ends) = mdq_html_block_end(tail, false) {
                leaf = Some(Leaf::Html {
                    value: line.raw_from(offset).into_owned(),
                    ends,
                });
                if ends.iter().any(|s| tail.to_ascii_lowercase().contains(s)) {
                    finish(&mut leaf, stack.last_mut().unwrap(), defs, None);
                }
            } else if indent >= 4 {
                leaf = Some(Leaf::Code(vec![line.raw_from(offset + 4).into_owned()]));
            } else if at < line.text.len() {
                leaf = Some(Leaf::Paragraph(line.raw_from(at).into_owned()));
            }
            break;
        }
    }
    finish(&mut leaf, stack.last_mut().unwrap(), defs, None);
    close(&mut stack, 1, defs);
    Ok(sections(stack.pop().unwrap().node.children))
}

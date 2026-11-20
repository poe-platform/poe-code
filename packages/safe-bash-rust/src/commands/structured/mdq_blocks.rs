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
    NativeDiv,
    Footnote(usize),
    List {
        marker: u8,
        blank: bool,
    },
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

fn push(frame: &mut Frame, node: MdqBlock) {
    let pending_blank = match &mut frame.kind {
        Container::Item { blank, .. } | Container::List { blank, .. } => std::mem::take(blank),
        _ => false,
    };
    frame.node.loose |= pending_blank && !frame.node.children.is_empty()
        || node.loose && matches!(frame.kind, Container::List { .. });
    frame.node.children.push(node);
}

fn close(stack: &mut Vec<Frame>, keep: usize, defs: &mut MdqDefinitions, native: bool) {
    while stack.len() > keep {
        let Frame { kind, mut node } = stack.pop().unwrap();
        if !native
            && matches!(kind, Container::Item { .. })
            && let Some(first) = node.children.first_mut()
            && first.kind == "paragraph"
            && let [b'[', state @ (b' ' | b'x' | b'X'), b']', b' ' | b'\t', ..] =
                first.inline.text.as_bytes()
        {
            node.checked = Some(*state != b' ');
            first.inline.text = first.inline.text[3..].trim_start().to_owned();
        }
        if let Container::Item { blank, .. } = kind {
            node.blank_after = blank;
        }
        if !matches!(kind, Container::List { .. }) {
            node.children = sections(node.children);
        }
        if matches!(kind, Container::Footnote(_)) {
            defs.notes.insert(node.text, node.children);
        } else {
            let parent = stack.last_mut().unwrap();
            push(parent, node);
            match (kind, &mut parent.kind) {
                (Container::Item { blank, .. }, Container::List { blank: pending, .. })
                | (Container::List { blank, .. }, Container::Item { blank: pending, .. }) => {
                    *pending = blank
                }
                _ => {}
            }
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
        closed: bool,
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
    native: bool,
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
        Leaf::Fence {
            mut block, closed, ..
        } => {
            if !native || closed {
                block.text.pop();
            }
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
            if native {
                value.push('\n');
            } else {
                value.truncate(value.trim_end().len());
            }
            MdqBlock {
                kind: "html".into(),
                text: value,
                ..Default::default()
            }
        }
        Leaf::Table(b) => b,
    };
    push(frame, node);
    true
}

fn table(head: &str, line: &str, tables: super::PandocPipeTables) -> Option<MdqBlock> {
    if tables == super::PandocPipeTables::Disabled {
        return None;
    }
    let mut header = mdq_pipe_row(head)?;
    let delimiter = mdq_pipe_row(line)?;
    if delimiter.is_empty()
        || tables == super::PandocPipeTables::CommonMark && header.len() != delimiter.len()
    {
        return None;
    }
    header.resize_with(delimiter.len(), String::new);
    let aligns = delimiter
        .iter()
        .map(|s| {
            Some(
                match super::pipe_cell_alignment(s)? {
                    std::fmt::Alignment::Center => "center",
                    std::fmt::Alignment::Right => "right",
                    std::fmt::Alignment::Left if s.starts_with(':') => "left",
                    _ => "none",
                }
                .into(),
            )
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
    parse_inner(
        defs,
        input,
        true,
        None,
        Mode {
            native: false,
            tables: super::PandocPipeTables::CommonMark,
            raw_html: true,
            native_divs: false,
        },
    )
}

#[derive(Clone, Copy)]
struct Mode {
    native: bool,
    tables: super::PandocPipeTables,
    raw_html: bool,
    native_divs: bool,
}

pub(super) fn pandoc(
    defs: &mut MdqDefinitions,
    input: &str,
    footnotes: bool,
    tables: super::PandocPipeTables,
    raw_html: bool,
    native_divs: bool,
) -> Result<Vec<MdqBlock>, String> {
    parse_inner(
        defs,
        input,
        footnotes,
        None,
        Mode {
            native: true,
            tables,
            raw_html,
            native_divs,
        },
    )
}

// Keep source slices for Pandoc so extracting definitions does not normalize
// lists, code, raw HTML, or dialect-specific syntax before its reader sees them.
pub(super) fn note_sources(
    defs: &mut MdqDefinitions,
    input: &str,
    enabled: bool,
    tables: super::PandocPipeTables,
    raw_html: bool,
    native_divs: bool,
) -> Result<(String, std::collections::HashMap<String, String>), String> {
    let mode = Mode {
        native: true,
        tables,
        raw_html,
        native_divs,
    };
    if !enabled {
        parse_inner(defs, input, false, None, mode)?;
        return Ok((input.to_owned(), Default::default()));
    }
    let mut sources = vec![(String::new(), String::new())];
    parse_inner(defs, input, enabled, Some(&mut sources), mode)?;
    let mut sources = sources.into_iter();
    let document = sources.next().unwrap().1;
    let mut notes = std::collections::HashMap::new();
    for (label, source) in sources {
        notes.entry(label).or_insert(source);
    }
    Ok((document, notes))
}

fn parse_inner(
    defs: &mut MdqDefinitions,
    input: &str,
    footnotes: bool,
    mut sources: Option<&mut Vec<(String, String)>>,
    mode: Mode,
) -> Result<Vec<MdqBlock>, String> {
    defs.footnotes = footnotes;
    let mut lines = input.lines().skip_while(|s| s.trim().is_empty()).peekable();
    let Some(first) = lines.next() else {
        return Ok(Vec::new());
    };
    // The Pandoc reader already removed one BOM at the input boundary.
    let first = if mode.native {
        first
    } else {
        first.strip_prefix('\u{feff}').unwrap_or(first)
    };
    let mut stack = vec![Frame {
        kind: Container::Root,
        node: MdqBlock::default(),
    }];
    let mut all = std::iter::once(first).chain(lines);
    let marker = first.trim_end();
    if !mode.native && matches!(marker, "---" | "+++") {
        let mut probe = all.clone().skip(1);
        if let Some(n) = probe.position(|s| s.trim_end() == marker) {
            all.next();
            let text = all.by_ref().take(n).collect::<Vec<_>>().join("\n");
            all.next();
            if let Some(sources) = sources.as_mut() {
                sources[0]
                    .1
                    .push_str(&format!("{marker}\n{text}\n{marker}\n"));
            }
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
        let mut pieces = if sources.is_some() {
            vec![(0, 0, line.text.len())]
        } else {
            Vec::new()
        };
        let enter_note = |pieces: &mut Vec<(usize, usize, usize)>, id, boundary, start| {
            let Some(last) = pieces.last_mut() else {
                return;
            };
            last.2 = boundary;
            pieces.push((id, start, line.text.len()));
        };
        'line: {
            let mut offset = 0;
            let mut matched = 1;
            while matched < stack.len() {
                let tail = &line.text[offset..];
                let indent = spaces(tail);
                match &mut stack[matched].kind {
                    Container::List { .. } | Container::NativeDiv => {}
                    Container::Quote if indent <= 3 && tail[indent..].starts_with('>') => {
                        offset += indent + 1;
                        offset += usize::from(line.text[offset..].starts_with(' '));
                    }
                    Container::Footnote(id) if indent >= 4 || indent == tail.len() => {
                        enter_note(&mut pieces, *id, offset, offset + indent.min(4));
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
                    && !(matches!(stack[matched].kind, Container::Footnote(_))
                        && tail[indent..].starts_with("[^")
                        && tail[indent..].contains("]:"))
                    && !mdq_interrupts_paragraph(tail, mode.raw_html)
                {
                    if let Container::Footnote(id) = stack[matched].kind {
                        enter_note(&mut pieces, id, offset, offset + indent);
                    }
                    s.push('\n');
                    s.push_str(&line.raw_from(offset + indent));
                    break 'line;
                }
                finish(
                    &mut leaf,
                    stack.last_mut().unwrap(),
                    defs,
                    None,
                    mode.native,
                );
                close(&mut stack, matched, defs, mode.native);
            }
            match &mut leaf {
                Some(Leaf::Fence {
                    block,
                    marker,
                    width,
                    indent: opening,
                    closed,
                }) => {
                    if mdq_fence(tail).is_some_and(|(_, m, n, info)| {
                        m == *marker && n >= *width && info.is_empty()
                    }) {
                        *closed = true;
                        finish(
                            &mut leaf,
                            stack.last_mut().unwrap(),
                            defs,
                            None,
                            mode.native,
                        );
                    } else {
                        block
                            .text
                            .push_str(&line.raw_from(offset + indent.min(*opening)));
                        block.text.push('\n');
                    }
                    break 'line;
                }
                Some(Leaf::Html { value, ends }) if !ends.is_empty() || !blank => {
                    value.push('\n');
                    value.push_str(&line.raw_from(offset));
                    if !ends.is_empty()
                        && ends.iter().any(|s| tail.to_ascii_lowercase().contains(s))
                    {
                        finish(
                            &mut leaf,
                            stack.last_mut().unwrap(),
                            defs,
                            None,
                            mode.native,
                        );
                    }
                    break 'line;
                }
                Some(Leaf::Code(code)) if blank || indent >= 4 => {
                    code.push(line.raw_from(offset + indent.min(4)).into_owned());
                    break 'line;
                }
                Some(Leaf::Table(b))
                    if !blank && !mdq_interrupts_paragraph(tail, mode.raw_html) =>
                {
                    if let Some(row) = mdq_pipe_row(&line.raw_from(offset)) {
                        b.table_rows
                            .push(row.into_iter().map(super::MdqContent::source).collect());
                        break 'line;
                    }
                }
                _ => {}
            }
            if mode.native_divs
                && indent <= 3
                && tail.trim().eq_ignore_ascii_case("</div>")
                && let Some(index) = stack
                    .iter()
                    .rposition(|frame| matches!(frame.kind, Container::NativeDiv))
            {
                finish(
                    &mut leaf,
                    stack.last_mut().unwrap(),
                    defs,
                    None,
                    mode.native,
                );
                close(&mut stack, index, defs, mode.native);
                break 'line;
            }
            if blank {
                finish(
                    &mut leaf,
                    stack.last_mut().unwrap(),
                    defs,
                    None,
                    mode.native,
                );
                if let Container::Item { blank, .. } = &mut stack.last_mut().unwrap().kind {
                    *blank = true;
                }
                break 'line;
            }
            if let Some(Leaf::Paragraph(s)) = &mut leaf {
                if !s.contains('\n')
                    && let Some(t) = table(s, &line.raw_from(offset), mode.tables)
                {
                    leaf = Some(Leaf::Table(t));
                    break 'line;
                }
                if let Some(level) = mdq_setext(tail) {
                    if finish(
                        &mut leaf,
                        stack.last_mut().unwrap(),
                        defs,
                        Some(level),
                        mode.native,
                    ) {
                        break 'line;
                    }
                } else if !mdq_interrupts_paragraph(tail, mode.raw_html) {
                    s.push('\n');
                    s.push_str(&line.raw_from(offset + indent));
                    break 'line;
                }
            }
            let was_para = matches!(leaf, Some(Leaf::Paragraph(_)));
            finish(
                &mut leaf,
                stack.last_mut().unwrap(),
                defs,
                None,
                mode.native,
            );
            loop {
                let tail = &line.text[offset..];
                let indent = spaces(tail);
                let at = offset + indent;
                if footnotes
                    && indent <= 3
                    && let Some(rest) = line.text[at..].strip_prefix("[^")
                    && let Some((label, after)) = rest.split_once("]:")
                    && !label.is_empty()
                    && !label.contains(' ')
                {
                    if defs.notes.insert(label.to_owned(), Vec::new()).is_some()
                        && sources.is_none()
                    {
                        return Err(format!(
                            "Markdown parse error:\nfound multiple definitions for link/image/footnote: {label}\n\n"
                        ));
                    }
                    defs.note_keys.insert(mdq_links::normalized(label));
                    let id = if let Some(sources) = sources.as_mut() {
                        let id = sources.len();
                        sources.push((label.to_owned(), String::new()));
                        id
                    } else {
                        0
                    };
                    let start = line.text.len() - after.len() + spaces(after);
                    enter_note(&mut pieces, id, at, start);
                    stack.push(Frame {
                        kind: Container::Footnote(id),
                        node: MdqBlock {
                            text: label.into(),
                            ..Default::default()
                        },
                    });
                    offset = start;
                    continue;
                }
                let item = if !mdq_thematic_break(tail) {
                    mdq_list_marker(tail)
                } else {
                    None
                };
                if let Container::List {
                    marker: previous, ..
                } = stack.last().unwrap().kind
                    && item.is_none_or(|(m, _, _)| m != previous)
                {
                    let len = stack.len();
                    close(&mut stack, len - 1, defs, mode.native);
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
                    if !matches!(stack.last().unwrap().kind, Container::List { .. }) {
                        stack.push(Frame {
                            kind: Container::List {
                                marker: m,
                                blank: false,
                            },
                            node: MdqBlock {
                                kind: "list".into(),
                                index: start,
                                list_marker: m,
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
                    let (_, title) = if mode.native {
                        super::pandoc_headings::atx(&raw)
                    } else {
                        mdq_heading(&raw)
                    }
                    .unwrap();
                    push(
                        stack.last_mut().unwrap(),
                        MdqBlock {
                            kind: "section".into(),
                            inline: super::MdqContent::source(title.into()),
                            level,
                            ..Default::default()
                        },
                    );
                } else if mdq_thematic_break(tail) {
                    push(
                        stack.last_mut().unwrap(),
                        MdqBlock {
                            kind: "break".into(),
                            ..Default::default()
                        },
                    );
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
                        closed: false,
                    });
                } else if mode.native_divs
                    && indent <= 3
                    && super::pandoc_blocks::div_opening(&line.text[at..])
                {
                    stack.push(Frame {
                        kind: Container::NativeDiv,
                        node: MdqBlock {
                            kind: "div".into(),
                            text: line.raw_from(at).into_owned(),
                            ..Default::default()
                        },
                    });
                } else if mode.raw_html
                    && let Some(ends) = mdq_html_block_end(tail, false)
                {
                    leaf = Some(Leaf::Html {
                        value: line.raw_from(offset).into_owned(),
                        ends,
                    });
                    if ends.iter().any(|s| tail.to_ascii_lowercase().contains(s)) {
                        finish(
                            &mut leaf,
                            stack.last_mut().unwrap(),
                            defs,
                            None,
                            mode.native,
                        );
                    }
                } else if indent >= 4 {
                    leaf = Some(Leaf::Code(vec![line.raw_from(offset + 4).into_owned()]));
                } else if at < line.text.len() {
                    leaf = Some(Leaf::Paragraph(line.raw_from(at).into_owned()));
                }
                break;
            }
        }
        if let Some(sources) = sources.as_mut() {
            for (id, start, end) in pieces {
                let tail = line.raw_from(start);
                let end_tail = line.raw_from(end);
                sources[id].1.push_str(&tail[..tail.len() - end_tail.len()]);
                sources[id].1.push('\n');
            }
        }
    }
    finish(
        &mut leaf,
        stack.last_mut().unwrap(),
        defs,
        None,
        mode.native,
    );
    close(&mut stack, 1, defs, mode.native);
    Ok(sections(stack.pop().unwrap().node.children))
}

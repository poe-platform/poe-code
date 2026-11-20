use super::*;

pub(super) fn has_scripts(nodes: &[PandocInline]) -> bool {
    nodes.iter().any(|node| match node {
        PandocInline::Subscript(_) | PandocInline::Superscript(_) => true,
        PandocInline::Strong(children)
        | PandocInline::Emph(children)
        | PandocInline::Strikeout(children)
        | PandocInline::SmallCaps(children)
        | PandocInline::Quoted(_, children)
        | PandocInline::Span(_, children)
        | PandocInline::Link(_, children, _, _)
        | PandocInline::Image(_, children, _, _) => has_scripts(children),
        PandocInline::Note(blocks) => blocks_have_scripts(blocks),
        _ => false,
    })
}

pub(super) fn blocks_have_scripts(blocks: &[PandocBlock]) -> bool {
    blocks.iter().any(|block| match block {
        PandocBlock::Para(nodes) | PandocBlock::Plain(nodes) | PandocBlock::Header(_, _, nodes) => {
            has_scripts(nodes)
        }
        PandocBlock::Figure(_, short, caption, children) => {
            short.as_ref().is_some_and(|nodes| has_scripts(nodes))
                || blocks_have_scripts(caption)
                || blocks_have_scripts(children)
        }
        PandocBlock::BlockQuote(blocks) | PandocBlock::Div(_, blocks) => {
            blocks_have_scripts(blocks)
        }
        PandocBlock::List(_, items) => items.iter().any(|blocks| blocks_have_scripts(blocks)),
        PandocBlock::Table(table) => table
            .head
            .iter()
            .chain(&table.body)
            .flatten()
            .any(|cell| blocks_have_scripts(&cell.blocks)),
        _ => false,
    })
}

pub(super) fn parse(
    s: &str,
    definitions: Option<&MdqDefinitions>,
    raw_html: bool,
) -> Option<Vec<PandocInline>> {
    let empty = MdqDefinitions::default();
    let defs = definitions.unwrap_or(&empty);
    // Retain original image labels and their child atoms instead of mdq's plain descriptions.
    parse_inner(
        s,
        definitions,
        raw_html,
        mdq_inline_atoms(defs, s, false, false),
        0,
    )
}

// A source-proportional work bound prevents malformed, overlapping attributes
// from repeatedly scanning the same unclosed quoted suffix.
pub(super) fn bracketed_attributes(
    s: &str,
    start: usize,
    work: &mut usize,
) -> Option<(PandocAttr, usize)> {
    let bytes = s.as_bytes();
    if bytes.get(start) != Some(&b'{') {
        return None;
    }
    let mut end = start + 1;
    let mut quote = None;
    while end < bytes.len() {
        *work = work.checked_sub(1)?;
        let byte = bytes[end];
        if let Some(delimiter) = quote {
            if byte == b'\\' {
                end += 2;
                continue;
            }
            if byte == delimiter {
                quote = None;
            }
        } else if byte == b'}' {
            return pandoc_headings::attributes(&s[start..end + 1]).map(|attr| (attr, end + 1));
        } else if matches!(byte, b'\'' | b'"') && bytes[end - 1] == b'=' {
            quote = Some(byte);
        }
        end += 1;
    }
    None
}

struct NativeSpan {
    open_end: usize,
    close_start: usize,
    end: usize,
    attr: PandocAttr,
    smallcaps: usize,
}

// Pair tags before resolving emphasis so delimiters cannot cross span edges.
// Bracket identity includes unmatched brackets; link destinations stay opaque.
fn native_spans(
    s: &str,
    atoms: &MdqAtoms<'_>,
    defs: &MdqDefinitions,
) -> Option<(BTreeMap<usize, NativeSpan>, BTreeSet<usize>)> {
    let mut skip = BTreeMap::new();
    let mut pending = vec![(0, atoms)];
    while let Some((base, atoms)) = pending.pop() {
        for (range, atom) in atoms {
            match atom {
                MdqInlineAtom::Link {
                    image,
                    display,
                    children,
                    target,
                    ..
                } => {
                    if target.auto.is_some() {
                        skip.insert(base + range.start, base + range.end);
                    } else {
                        let start = base + range.start + if *image { 2 } else { 1 };
                        let suffix = start + display.len() + 1;
                        if suffix < base + range.end {
                            skip.insert(suffix, base + range.end);
                        }
                        pending.push((start, children));
                    }
                }
                MdqInlineAtom::Footnote(_) => {
                    skip.insert(base + range.start, base + range.end);
                }
                _ => {}
            }
        }
    }
    let mut attribute_work = s.len().saturating_mul(4);
    let mut pairs = BTreeMap::new();
    let mut openers = BTreeSet::new();
    let mut spans = Vec::new();
    let mut brackets = Vec::new();
    let bytes = s.as_bytes();
    let ticks = mdq_backtick_runs(bytes);
    let mut at = 0;
    while at < bytes.len() {
        if let Some(&end) = skip.get(&at) {
            at = end;
            continue;
        }
        if bytes[at] == b'\\' && bytes.get(at + 1).is_some_and(u8::is_ascii_punctuation) {
            at += 2;
            continue;
        }
        if bytes[at] == b'`' {
            let (width, close) = mdq_code_delimiters(bytes, at, &ticks);
            at = close.unwrap_or(at) + width;
            continue;
        }
        if bytes[at] == b'<'
            && let Some(len) = mdq_inline_html_len(&s[at..])
        {
            let tag = &s[at..at + len];
            if defs.pandoc_native_spans
                && let Some(attr) = pandoc_blocks::native_attr(tag, "span")
            {
                spans.push((at, at + len, attr, brackets.last().copied()));
                openers.insert(at);
            } else if tag
                .strip_prefix("</")
                .and_then(|tag| tag.strip_suffix('>'))
                .is_some_and(|tag| tag.trim_ascii().eq_ignore_ascii_case("span"))
                && spans
                    .last()
                    .is_some_and(|(_, _, _, bracket)| *bracket == brackets.last().copied())
            {
                let (start, open_end, attr, _) = spans.pop().unwrap();
                pairs.insert(
                    start,
                    NativeSpan {
                        open_end,
                        close_start: at,
                        end: at + len,
                        attr,
                        smallcaps: 0,
                    },
                );
            }
            at += len;
            continue;
        }
        match bytes[at] {
            b'!' if bytes.get(at + 1) == Some(&b'[') => {
                brackets.push((at + 1, true));
                at += 2;
                continue;
            }
            b'[' => brackets.push((at, false)),
            b']' => {
                if let Some((start, false)) = brackets.pop()
                    && defs.pandoc_bracketed_spans
                    && bytes.get(at + 1) == Some(&b'{')
                {
                    if let Some((mut attr, end)) =
                        bracketed_attributes(s, at + 1, &mut attribute_work)
                    {
                        let smallcaps = attr
                            .classes
                            .iter()
                            .filter(|class| *class == "smallcaps")
                            .count();
                        attr.classes.retain(|class| class != "smallcaps");
                        pairs.insert(
                            start,
                            NativeSpan {
                                open_end: start + 1,
                                close_start: at,
                                end,
                                attr,
                                smallcaps,
                            },
                        );
                        at = end;
                        continue;
                    }
                }
            }
            _ => {}
        }
        at += 1;
    }
    if attribute_work == 0 {
        return None;
    }
    Some((pairs, openers))
}

fn emphasis(
    s: &str,
    atoms: &MdqAtoms<'_>,
    spans: &BTreeMap<usize, NativeSpan>,
    defs: &MdqDefinitions,
    strikeout: bool,
    depth: usize,
) -> Option<BTreeMap<usize, mdq_emphasis::Marks>> {
    let mut pending = vec![(0..s.len(), depth)];
    let mut marks = BTreeMap::new();
    while let Some((scope, depth)) = pending.pop() {
        if depth > 64 {
            return None;
        }
        let mut opaque = Vec::new();
        let mut at = scope.start;
        while at < scope.end {
            let span = spans.range(at..scope.end).next();
            let atom = atoms
                .get(atoms.partition_point(|(range, _)| range.start < at))
                .filter(|(range, _)| range.start < scope.end);
            if let Some((&start, span)) =
                span.filter(|(start, _)| atom.is_none_or(|(range, _)| **start <= range.start))
            {
                opaque.push(start - scope.start..span.end - scope.start);
                pending.push((span.open_end..span.close_start, depth + 1));
                at = span.end;
            } else if let Some((range, _)) = atom {
                opaque.push(range.start - scope.start..range.end - scope.start);
                at = range.end;
            } else {
                break;
            }
        }
        marks.extend(
            mdq_emphasis::resolve(
                &s[scope.clone()],
                opaque.iter(),
                strikeout,
                false,
                defs.pandoc_subscript,
                defs.pandoc_superscript,
                defs.pandoc_smart,
            )
            .into_iter()
            .map(|(at, mark)| (at + scope.start, mark)),
        );
    }
    Some(marks)
}

fn parse_inner(
    s: &str,
    definitions: Option<&MdqDefinitions>,
    raw_html: bool,
    mut atoms: MdqAtoms<'_>,
    depth: usize,
) -> Option<Vec<PandocInline>> {
    if depth > 64 {
        return None;
    }
    let mut out: Vec<PandocInline> = Vec::new();
    let mut cur = String::new();
    let mut i = 0usize;
    let bytes = s.as_bytes();
    let ticks = mdq_backtick_runs(bytes);
    let empty = MdqDefinitions::default();
    let defs = definitions.unwrap_or(&empty);
    atoms.retain(|(_, atom)| match atom {
        MdqInlineAtom::Link { target, .. } if target.auto.is_some() => {
            definitions.is_some()
                && (target.auto == Some(mdq_links::Auto::Bracketed) || defs.pandoc_bare_autolinks)
        }
        _ => true,
    });
    let (mut spans, span_openers) = if defs.pandoc_native_spans && s.contains('<')
        || defs.pandoc_bracketed_spans && s.contains('[')
    {
        native_spans(s, &atoms, defs)?
    } else {
        Default::default()
    };
    let mut marks = emphasis(
        s,
        &atoms,
        &spans,
        defs,
        definitions.is_none() || defs.pandoc_strikeout,
        depth,
    )?;
    let mut containers = Vec::new();
    let mut active_spans = Vec::new();
    let mut links = atoms
        .into_iter()
        .filter(|(_, atom)| {
            matches!(atom, MdqInlineAtom::Footnote(label) if defs.notes.contains_key(*label))
                || matches!(atom, MdqInlineAtom::Link { .. })
        })
        .peekable();
    while i < bytes.len() {
        if active_spans
            .last()
            .is_some_and(|span: &NativeSpan| span.close_start == i)
        {
            if !cur.is_empty() {
                out.push(PandocInline::Text(std::mem::take(&mut cur)));
            }
            let span = active_spans.pop().unwrap();
            let mut children = std::mem::take(&mut out);
            out = containers.pop().expect("matched span opener");
            if depth + containers.len() + span.smallcaps >= 64 {
                return None;
            }
            for _ in 0..span.smallcaps {
                children = vec![PandocInline::SmallCaps(children)];
            }
            if span.smallcaps > 0
                && span.attr.id.is_empty()
                && span.attr.classes.is_empty()
                && span.attr.properties.is_empty()
            {
                out.extend(children);
            } else {
                out.push(PandocInline::Span(span.attr, children));
            }
            i = span.end;
            continue;
        }
        if let Some(span) = spans.remove(&i) {
            if !cur.is_empty() {
                out.push(PandocInline::Text(std::mem::take(&mut cur)));
            }
            if depth + containers.len() >= 64 {
                return None;
            }
            containers.push(std::mem::take(&mut out));
            i = span.open_end;
            active_spans.push(span);
            continue;
        }
        if let Some(run) = marks.remove(&i) {
            if !run.closing.is_empty() && !cur.is_empty() {
                out.push(PandocInline::Text(std::mem::take(&mut cur)));
            }
            for marker in run.closing {
                let children = std::mem::take(&mut out);
                out = containers.pop().expect("matched emphasis opener");
                out.push(match marker {
                    "**" => PandocInline::Strong(children),
                    "~~" => PandocInline::Strikeout(children),
                    "~" => PandocInline::Subscript(children),
                    "^" => PandocInline::Superscript(children),
                    "'" => PandocInline::Quoted("SingleQuote", children),
                    "\"" => PandocInline::Quoted("DoubleQuote", children),
                    _ => PandocInline::Emph(children),
                });
            }
            cur.extend(std::iter::repeat_n(
                run.quote.unwrap_or(bytes[i] as char),
                run.remaining,
            ));
            if !run.opening.is_empty() && !cur.is_empty() {
                out.push(PandocInline::Text(std::mem::take(&mut cur)));
            }
            for _ in run.opening.into_iter().rev() {
                if depth + containers.len() >= 64 {
                    return None;
                }
                containers.push(std::mem::take(&mut out));
            }
            i += run.width;
            continue;
        }
        if bytes[i] == b'\n' || bytes[i] == b'\\' && bytes.get(i + 1) == Some(&b'\n') {
            if !cur.is_empty() {
                out.push(PandocInline::Text(std::mem::take(&mut cur)));
            }
            let spaces = out
                .iter()
                .rev()
                .take_while(|node| matches!(node, PandocInline::Space))
                .count();
            out.truncate(out.len() - spaces);
            let hard = bytes[i] == b'\\' || spaces >= 2;
            out.push(if hard {
                PandocInline::LineBreak
            } else {
                PandocInline::SoftBreak
            });
            i += if bytes[i] == b'\\' { 2 } else { 1 };
            while bytes.get(i).is_some_and(|b| matches!(b, b' ' | b'\t')) {
                i += 1;
            }
            continue;
        }
        if definitions.is_some()
            && bytes[i] == b'\\'
            && bytes.get(i + 1).is_some_and(|byte| {
                byte.is_ascii_punctuation()
                    || *byte == b' ' && (defs.pandoc_subscript || defs.pandoc_superscript)
            })
        {
            if bytes[i + 1] == b' ' {
                if !cur.is_empty() {
                    out.push(PandocInline::Text(std::mem::take(&mut cur)));
                }
                out.push(PandocInline::Space);
            } else {
                cur.push(bytes[i + 1] as char);
            }
            i += 2;
            continue;
        }
        if definitions.is_some() && bytes[i] == b'&' {
            if let Some(width) = mdq_decode_escape(&s[i..], &mut cur) {
                i += width;
                continue;
            }
        }
        if bytes[i] == b'<'
            && let Some(len) = mdq_inline_html_len(&s[i..])
        {
            let tag = &s[i..i + len];
            if raw_html || span_openers.contains(&i) {
                if !cur.is_empty() {
                    out.push(PandocInline::Text(std::mem::take(&mut cur)));
                }
                out.push(PandocInline::Raw("html".into(), tag.into()));
            } else {
                // A disabled raw tag is literal text, not another Markdown input.
                // Keep its entities and punctuation as authored.
                for (index, part) in tag.split(' ').enumerate() {
                    if index != 0 {
                        if !cur.is_empty() {
                            out.push(PandocInline::Text(std::mem::take(&mut cur)));
                        }
                        out.push(PandocInline::Space);
                    }
                    cur.push_str(part);
                }
            }
            i += len;
            continue;
        }
        while links.peek().is_some_and(|(range, _)| range.start < i) {
            links.next();
        }
        if links.peek().is_some_and(|(range, _)| range.start == i) {
            let (range, atom) = links.next().unwrap();
            if !cur.is_empty() {
                out.push(PandocInline::Text(std::mem::take(&mut cur)));
            }
            match atom {
                MdqInlineAtom::Footnote(label) => {
                    out.push(PandocInline::NoteReference(label.into()))
                }
                MdqInlineAtom::Link {
                    image,
                    display,
                    target,
                    children,
                    attributes,
                } => {
                    if target.auto.is_some() {
                        let email = !target.url.contains(':') && target.url.contains('@');
                        let url = MdqTarget::encode_uri(&target.url);
                        let url = if email { format!("mailto:{url}") } else { url };
                        let mut attributes = PandocAttr::default();
                        if defs.pandoc_autolink_classes {
                            attributes
                                .classes
                                .push(if email { "email" } else { "uri" }.into());
                        }
                        out.push(PandocInline::Link(
                            attributes,
                            vec![PandocInline::Text(display.into_owned())],
                            url,
                            target.title,
                        ));
                        i = range.end;
                        continue;
                    }
                    let children = parse_inner(
                        &display,
                        definitions,
                        raw_html,
                        children,
                        depth + containers.len() + 1,
                    )?;
                    out.push(if image {
                        PandocInline::Image(attributes.ok()?, children, target.url, target.title)
                    } else {
                        PandocInline::Link(attributes.ok()?, children, target.url, target.title)
                    });
                }
                _ => unreachable!(),
            }
            i = range.end;
            continue;
        }
        if bytes[i] == b'`' {
            let (width, close) = mdq_code_delimiters(bytes, i, &ticks);
            i += width;
            if let Some(close) = close {
                if !cur.is_empty() {
                    out.push(PandocInline::Text(std::mem::take(&mut cur)));
                }
                let content = s[i..close].replace('\n', " ");
                let text = if content.starts_with(' ')
                    && content.ends_with(' ')
                    && content.bytes().any(|b| b != b' ')
                {
                    &content[1..content.len() - 1]
                } else {
                    &content
                };
                out.push(PandocInline::Code(PandocAttr::default(), text.to_owned()));
                i = close + width;
                if width == 2 && s[i..].starts_with("\\ ") {
                    out.push(PandocInline::Space);
                    i += 2;
                }
            } else {
                cur.extend(std::iter::repeat_n('`', width));
            }
            continue;
        }
        if bytes[i] == b' ' {
            if !cur.is_empty() {
                out.push(PandocInline::Text(std::mem::take(&mut cur)));
            }
            out.push(PandocInline::Space);
            i += 1;
            continue;
        }
        if defs.pandoc_smart && matches!(bytes[i], b'-' | b'.') {
            let marker = bytes[i];
            let start = i;
            while bytes.get(i) == Some(&marker) {
                i += 1;
            }
            let mut count = i - start;
            if marker == b'.' {
                cur.extend(std::iter::repeat_n('…', count / 3));
                cur.extend(std::iter::repeat_n('.', count % 3));
            } else {
                if count >= 3 && count % 2 != 0 {
                    cur.push('—');
                    count -= 3;
                }
                if count % 3 == 0 {
                    cur.extend(std::iter::repeat_n('—', count / 3));
                } else {
                    cur.extend(std::iter::repeat_n('–', count / 2));
                    cur.extend(std::iter::repeat_n('-', count % 2));
                }
            }
            continue;
        }
        let ch = s[i..].chars().next().unwrap();
        cur.push(ch);
        i += ch.len_utf8();
    }
    if !cur.is_empty() {
        out.push(PandocInline::Text(cur));
    }
    Some(out)
}

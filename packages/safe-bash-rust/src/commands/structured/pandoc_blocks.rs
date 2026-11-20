use super::{
    MdqBlock, MdqDefinitions, PandocAttr, PandocBlock, pandoc_headings,
    pandoc_list::{self, Tasks},
    pandoc_table, parse_pandoc_md_inlines,
};

pub(super) fn lower(
    nodes: &[MdqBlock],
    defs: &MdqDefinitions,
    tasks: Tasks,
    raw_html: bool,
    depth: usize,
) -> Option<Vec<PandocBlock>> {
    if depth > 64 {
        return None;
    }
    let mut out = Vec::new();
    for node in nodes {
        match node.kind.as_str() {
            "paragraph" => {
                let inlines = parse_pandoc_md_inlines(&node.inline.text, Some(defs), raw_html)?;
                if defs.pandoc_implicit_figures
                    && let [super::PandocInline::Image(_, caption, _, _)] = inlines.as_slice()
                    && !caption.is_empty()
                {
                    out.push(PandocBlock::Figure(
                        PandocAttr::default(),
                        None,
                        vec![PandocBlock::Plain(caption.clone())],
                        vec![PandocBlock::Plain(inlines)],
                    ));
                } else {
                    out.push(PandocBlock::Para(inlines));
                }
            }
            "section" => {
                out.push(pandoc_headings::read(
                    node.level,
                    &node.inline.text,
                    defs,
                    raw_html,
                )?);
                out.extend(lower(&node.children, defs, tasks, raw_html, depth)?);
            }
            "quote" => out.push(PandocBlock::BlockQuote(lower(
                &node.children,
                defs,
                tasks,
                raw_html,
                depth + 1,
            )?)),
            "div" => out.push(PandocBlock::Div(
                native_attr(&node.text, "div")?,
                lower(&node.children, defs, tasks, raw_html, depth + 1)?,
            )),
            "break" => out.push(PandocBlock::HorizontalRule),
            "code" => out.push(PandocBlock::CodeBlock(
                PandocAttr {
                    classes: node
                        .lang
                        .split_whitespace()
                        .take(1)
                        .map(str::to_owned)
                        .collect(),
                    ..Default::default()
                },
                node.text.clone(),
            )),
            "html" => {
                if defs.pandoc_native_divs
                    && let Some(blocks) = native_div_html(&node.text)
                {
                    out.extend(blocks);
                } else {
                    out.push(PandocBlock::Raw("html".into(), node.text.clone()));
                }
            }
            "table" => {
                let width = node.table_aligns.len();
                let mut rows = node.table_rows.iter().map(|row| {
                    let mut row: Vec<_> = row.iter().map(|cell| cell.text.clone()).collect();
                    row.resize_with(width, String::new);
                    row
                });
                let header = rows.next()?;
                let align = node
                    .table_aligns
                    .iter()
                    .map(|value| match value.as_str() {
                        "left" => Some(std::fmt::Alignment::Left),
                        "center" => Some(std::fmt::Alignment::Center),
                        "right" => Some(std::fmt::Alignment::Right),
                        _ => None,
                    })
                    .collect();
                out.push(PandocBlock::Table(pandoc_table::Table::simple(
                    header,
                    rows.collect(),
                    Some(align),
                    Some(defs),
                    raw_html,
                )?));
            }
            "list" => {
                let numbering = node.index.map(|start| pandoc_list::Numbering {
                    start: start as i64,
                    style: "Decimal".into(),
                    delimiter: if node.list_marker == b')' {
                        "OneParen"
                    } else {
                        "Period"
                    }
                    .into(),
                });
                let mut items = Vec::new();
                let mut task_group = None;
                let mut group_loose = false;
                let mut previous_blank = false;
                for item in &node.children {
                    let first = item
                        .children
                        .first()
                        .filter(|node| node.kind == "paragraph")
                        .map(|node| node.inline.text.as_str())
                        .unwrap_or("");
                    let task = if tasks == Tasks::Disabled
                        || tasks == Tasks::CommonMark && node.index.is_some()
                    {
                        None
                    } else {
                        first
                            .get(..3)
                            .and_then(|prefix| match prefix {
                                "[x]" | "[X]" => Some("☒"),
                                "[ ]" => Some("☐"),
                                _ => None,
                            })
                            .filter(|_| {
                                first[3..].starts_with([' ', '\t'])
                                    || tasks == Tasks::CommonMark && first.len() == 3
                            })
                    };
                    if tasks == Tasks::CommonMark
                        && task_group
                            .replace(task.is_some())
                            .is_some_and(|previous| previous != task.is_some())
                    {
                        finish_list(
                            &mut out,
                            numbering.clone(),
                            std::mem::take(&mut items),
                            group_loose,
                        );
                        group_loose = false;
                        previous_blank = false;
                    }
                    group_loose |= item.loose || previous_blank;
                    previous_blank = item.blank_after;
                    let mut blocks = lower(&item.children, defs, tasks, raw_html, depth + 1)?;
                    if let Some(mark) = task {
                        let tail = first[3..].trim_start_matches([' ', '\t']);
                        let source = format!(
                            "{mark}{}{tail}",
                            if !tail.is_empty() && !tail.starts_with('\n') {
                                " "
                            } else {
                                ""
                            }
                        );
                        blocks[0] = PandocBlock::Para(parse_pandoc_md_inlines(
                            &source,
                            Some(defs),
                            raw_html,
                        )?);
                    }
                    items.push(blocks);
                }
                finish_list(
                    &mut out,
                    numbering,
                    items,
                    if tasks == Tasks::CommonMark {
                        group_loose
                    } else {
                        node.loose
                    },
                );
            }
            _ => return None,
        }
    }
    Some(out)
}

// Both native Markdown containers use the existing HTML tokenizer and attribute
// decoder, including first-duplicate-wins and attribute entity rules.
pub(super) fn native_attr(tag: &str, name: &str) -> Option<PandocAttr> {
    use document_converter_rust::html::dom::{HtmlNode, bounded_html_dom};
    let nodes = bounded_html_dom(tag)?;
    let HtmlNode::Element(element) = nodes.first()? else {
        return None;
    };
    if element.tag != name {
        return None;
    }
    Some(html_attr(&element.attrs))
}

fn html_attr(attrs: &[(String, String)]) -> PandocAttr {
    let mut attr = PandocAttr::default();
    for (name, value) in attrs {
        match name.to_ascii_lowercase().as_str() {
            "id" => attr.id = value.clone(),
            "class" => {
                attr.classes = value
                    .split([' ', '\t', '\n', '\r', '\u{000c}'])
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
                    .collect()
            }
            _ => attr
                .properties
                .push((name.to_ascii_lowercase(), value.clone())),
        }
    }
    attr
}

pub(super) fn div_opening(source: &str) -> bool {
    let source = source.trim_end_matches([' ', '\t']);
    source
        .get(..4)
        .is_some_and(|s| s.eq_ignore_ascii_case("<div"))
        && source
            .as_bytes()
            .get(4)
            .is_some_and(|c| matches!(c, b'>' | b' ' | b'\t'))
        && !source.ends_with("/>")
        && super::mdq_inline_html_len(source) == Some(source.len())
}

fn finish_list(
    out: &mut Vec<PandocBlock>,
    numbering: Option<pandoc_list::Numbering>,
    mut items: Vec<Vec<PandocBlock>>,
    loose: bool,
) {
    if !loose {
        for blocks in &mut items {
            for block in blocks {
                if let PandocBlock::Para(inlines) = block {
                    *block = PandocBlock::Plain(std::mem::take(inlines));
                }
            }
        }
    }
    out.push(PandocBlock::List(numbering, items));
}

fn native_div_html(source: &str) -> Option<Vec<PandocBlock>> {
    use document_converter_rust::html::dom::bounded_html_dom;
    let opening = source.trim_start();
    if !opening
        .get(..4)
        .is_some_and(|s| s.eq_ignore_ascii_case("<div"))
        || !opening
            .as_bytes()
            .get(4)
            .is_some_and(|b| matches!(b, b'>' | b'/' | b' ' | b'\t' | b'\n' | b'\r'))
    {
        return None;
    }
    super::mdq_inline_html_len(opening)?;
    html_blocks(&bounded_html_dom(source)?, None, false)
}

pub(super) fn html_blocks(
    nodes: &[document_converter_rust::html::dom::HtmlNode],
    notes: Option<&document_converter_rust::html::HtmlNotes<'_>>,
    in_note: bool,
) -> Option<Vec<PandocBlock>> {
    use document_converter_rust::html::dom::HtmlNode;
    let mut out = Vec::new();
    let mut pending = Vec::new();
    fn flush(out: &mut Vec<PandocBlock>, pending: &mut Vec<super::PandocInline>) {
        while matches!(pending.last(), Some(super::PandocInline::Space)) {
            pending.pop();
        }
        let first = pending
            .iter()
            .position(|n| !matches!(n, super::PandocInline::Space))
            .unwrap_or(pending.len());
        pending.drain(..first);
        if !pending.is_empty() {
            out.push(PandocBlock::Plain(std::mem::take(pending)));
        }
    }
    for node in nodes {
        if let HtmlNode::Element(element) = node {
            if notes.is_some()
                && element
                    .attrs
                    .iter()
                    .any(|(key, value)| key.eq_ignore_ascii_case("role") && value == "doc-endnotes")
            {
                flush(&mut out, &mut pending);
                for element in
                    std::iter::once(element).chain(element.children.iter().filter_map(|child| {
                        if let HtmlNode::Element(element) = child {
                            Some(element)
                        } else {
                            None
                        }
                    }))
                {
                    let attr = html_attr(&element.attrs);
                    if !attr.id.is_empty() {
                        out.push(PandocBlock::Div(
                            PandocAttr {
                                id: attr.id,
                                ..Default::default()
                            },
                            Vec::new(),
                        ));
                    }
                }
                continue;
            }
            let block = match element.tag.as_str() {
                "div" => Some(PandocBlock::Div(
                    html_attr(&element.attrs),
                    html_blocks(&element.children, notes, in_note)?,
                )),
                "html" | "body" => {
                    flush(&mut out, &mut pending);
                    let children = html_blocks(&element.children, notes, in_note)?;
                    let attr = html_attr(&element.attrs);
                    if element.tag == "body"
                        && (!attr.id.is_empty()
                            || !attr.classes.is_empty()
                            || !attr.properties.is_empty())
                    {
                        out.push(PandocBlock::Div(attr, children));
                    } else {
                        out.extend(children);
                    }
                    continue;
                }
                "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                    let mut content = Vec::new();
                    for child in &element.children {
                        html_inline(child, &mut content, notes, in_note)?;
                    }
                    let mut blocks = Vec::new();
                    flush(&mut blocks, &mut content);
                    let content = match blocks.pop() {
                        Some(PandocBlock::Plain(c)) => c,
                        _ => Vec::new(),
                    };
                    let attr = html_attr(&element.attrs);
                    if element.tag != "p" {
                        flush(&mut out, &mut pending);
                        out.push(PandocBlock::Header(
                            (element.tag.as_bytes()[1] - b'0') as usize,
                            attr,
                            content,
                        ));
                        continue;
                    }
                    let paragraph = PandocBlock::Para(content);
                    Some(
                        if attr.id.is_empty()
                            && attr.classes.is_empty()
                            && attr.properties.is_empty()
                        {
                            paragraph
                        } else {
                            PandocBlock::Div(attr, vec![paragraph])
                        },
                    )
                }
                "blockquote" => Some(PandocBlock::BlockQuote(html_blocks(
                    &element.children,
                    notes,
                    in_note,
                )?)),
                "hr" => Some(PandocBlock::HorizontalRule),
                "pre" => Some(PandocBlock::CodeBlock(
                    html_attr(&element.attrs),
                    html_literal(&element.children),
                )),
                "ul" | "ol" => {
                    let numbering = (element.tag == "ol").then(|| pandoc_list::Numbering {
                        start: element
                            .attrs
                            .iter()
                            .find(|(k, _)| k.eq_ignore_ascii_case("start"))
                            .and_then(|(_, v)| v.parse().ok())
                            .unwrap_or(1),
                        style: "DefaultStyle".into(),
                        delimiter: "DefaultDelim".into(),
                    });
                    let items = element
                        .children
                        .iter()
                        .filter_map(|n| match n {
                            HtmlNode::Element(e) if e.tag == "li" => {
                                Some(html_blocks(&e.children, notes, in_note))
                            }
                            _ => None,
                        })
                        .collect::<Option<Vec<_>>>()?;
                    Some(PandocBlock::List(numbering, items))
                }
                _ => None,
            };
            if let Some(block) = block {
                flush(&mut out, &mut pending);
                out.push(block);
                continue;
            }
        }
        html_inline(node, &mut pending, notes, in_note)?;
    }
    flush(&mut out, &mut pending);
    Some(out)
}

fn html_literal(nodes: &[document_converter_rust::html::dom::HtmlNode]) -> String {
    use document_converter_rust::html::dom::HtmlNode;
    nodes
        .iter()
        .map(|node| match node {
            HtmlNode::Text(text) => text.clone(),
            HtmlNode::Element(element) => html_literal(&element.children),
        })
        .collect()
}

pub(super) fn html_inline(
    node: &document_converter_rust::html::dom::HtmlNode,
    out: &mut Vec<super::PandocInline>,
    notes: Option<&document_converter_rust::html::HtmlNotes<'_>>,
    in_note: bool,
) -> Option<()> {
    use super::PandocInline as I;
    use document_converter_rust::html::dom::HtmlNode;
    let HtmlNode::Element(element) = node else {
        let HtmlNode::Text(text) = node else {
            unreachable!()
        };
        for part in text.split_inclusive([' ', '\t', '\n', '\r', '\u{000c}']) {
            let word = part.trim_end_matches([' ', '\t', '\n', '\r', '\u{000c}']);
            if !word.is_empty() {
                if let Some(I::Text(prior)) = out.last_mut() {
                    prior.push_str(word);
                } else {
                    out.push(I::Text(word.into()));
                }
            }
            if word.len() != part.len() && !matches!(out.last(), Some(I::Space)) {
                out.push(I::Space);
            }
        }
        return Some(());
    };
    if matches!(
        element.tag.as_str(),
        "script" | "style" | "head" | "meta" | "link"
    ) {
        return Some(());
    }
    let role = element
        .attrs
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("role"))
        .map(|(_, value)| value.as_str());
    if notes.is_some() && in_note && role == Some("doc-backlink") {
        return Some(());
    }
    if let Some(notes) = notes
        && role == Some("doc-noteref")
    {
        let id = document_converter_rust::html::note_id(element, notes).ok()?;
        let (definition, style, direction, alignment) = &notes[id];
        let mut blocks = html_blocks(&definition.children, Some(notes), true)?;
        // Keep the attributes represented by the shared HTML adapter without
        // carrying reference-marker link/superscript styles into the note.
        if style.code
            || style.underline
            || style.strike
            || style.sup
            || style.sub
            || style.link.is_some()
        {
            return None;
        }
        let mut attr = html_attr(&definition.attrs);
        if attr.id.is_empty() {
            attr.id = id.to_string();
        }
        let mut css = String::new();
        if style.bold {
            css.push_str("font-weight:bold;");
        }
        if style.italic {
            css.push_str("font-style:italic;");
        }
        if let Some(color) = &style.color {
            css.push_str(&format!("color:#{color};"));
        }
        if let Some(color) = &style.highlight {
            css.push_str(&format!("background-color:#{color};"));
        }
        match alignment {
            document_ast_rust::Align::Left => css.push_str("text-align:left;"),
            document_ast_rust::Align::Center => css.push_str("text-align:center;"),
            document_ast_rust::Align::Right => css.push_str("text-align:right;"),
            _ => {}
        }
        if let Some((_, original)) = attr.properties.iter().find(|(key, _)| key == "style") {
            css.push_str(original);
        }
        attr.properties
            .retain(|(key, _)| key != "style" && (direction.is_none() || key != "dir"));
        if !css.is_empty() {
            attr.properties.push(("style".into(), css));
        }
        if let Some(direction) = direction {
            attr.properties.push((
                "dir".into(),
                match direction {
                    document_ast_rust::Direction::Ltr => "ltr",
                    document_ast_rust::Direction::Rtl => "rtl",
                }
                .into(),
            ));
        }
        blocks = vec![PandocBlock::Div(attr, blocks)];
        let note = I::Note(blocks);
        let attr = html_attr(&element.attrs);
        out.push(if attr.id.is_empty() {
            note
        } else {
            I::Span(
                PandocAttr {
                    id: attr.id,
                    ..Default::default()
                },
                vec![note],
            )
        });
        return Some(());
    }
    if element.tag == "title" {
        for child in &element.children {
            html_inline(child, out, notes, in_note)?;
        }
        return Some(());
    }
    let mut children = Vec::new();
    for child in &element.children {
        html_inline(child, &mut children, notes, in_note)?;
    }
    let mut attr = html_attr(&element.attrs);
    let take = |attr: &mut PandocAttr, key: &str| {
        attr.properties
            .iter()
            .position(|(k, _)| k == key)
            .map(|i| attr.properties.remove(i).1)
            .unwrap_or_default()
    };
    let inline = match element.tag.as_str() {
        "span" => I::Span(attr, children),
        "strong" | "b" => I::Strong(children),
        "em" | "i" => I::Emph(children),
        "del" | "s" | "strike" => I::Strikeout(children),
        "sub" => I::Subscript(children),
        "sup" => I::Superscript(children),
        "code" | "tt" | "samp" | "var" => I::Code(attr, html_literal(&element.children)),
        "br" => I::LineBreak,
        "a" => {
            let href = take(&mut attr, "href");
            let title = take(&mut attr, "title");
            I::Link(attr, children, href, title)
        }
        "img" => {
            let src = take(&mut attr, "src");
            let title = take(&mut attr, "title");
            let alt = take(&mut attr, "alt");
            let mut label = Vec::new();
            html_inline(&HtmlNode::Text(alt), &mut label, None, false)?;
            I::Image(attr, label, src, title)
        }
        _ => return None,
    };
    out.push(inline);
    Some(())
}

// Native legacy text writers must not silently discard container attributes.
// DOCX/PDF use the shared canonical writer and retain the full attributes.
pub(super) fn check_writer(
    blocks: &[PandocBlock],
    target: &str,
    bracketed_spans: bool,
) -> Result<(), &'static str> {
    use super::PandocInline as I;
    fn attrs(
        attr: &PandocAttr,
        target: &str,
        span: bool,
        bracketed: bool,
    ) -> Result<(), &'static str> {
        let present =
            !attr.id.is_empty() || !attr.classes.is_empty() || !attr.properties.is_empty();
        match target {
            "markdown" | "md" | "gfm" | "commonmark" | "commonmark_x"
                if present && !(span && bracketed) =>
            {
                Err("E_UNSUPPORTED_FEATURE: Markdown cannot represent attributes\n")
            }
            "rtf" if present => {
                Err("E_UNSUPPORTED_FEATURE: Unsupported RTF container attributes\n")
            }
            "latex" if present => {
                Err("E_UNSUPPORTED_FEATURE: Unsupported native LaTeX container attributes\n")
            }
            "rst" if span => Err("E_UNSUPPORTED_FEATURE: Projected unsupported Span to text\n"),
            "rst" if !attr.properties.is_empty() => {
                Err("E_UNSUPPORTED_FEATURE: Unsupported RST container attributes\n")
            }
            "rst"
                if attr.classes.iter().any(|name| {
                    name.is_empty()
                        || name
                            .chars()
                            .any(|c| !c.is_ascii_alphanumeric() && !matches!(c, '-' | '_'))
                }) =>
            {
                Err("E_UNSUPPORTED_FEATURE: Unsupported RST container class\n")
            }
            _ => Ok(()),
        }
    }
    fn inlines(nodes: &[I], target: &str, bracketed: bool) -> Result<(), &'static str> {
        for node in nodes {
            match node {
                I::Span(attr, children) => {
                    attrs(attr, target, true, bracketed)?;
                    inlines(children, target, bracketed)?;
                }
                I::SmallCaps(children) => {
                    if matches!(
                        target,
                        "markdown" | "md" | "gfm" | "commonmark" | "commonmark_x" | "rst"
                    ) {
                        return Err(
                            "E_UNSUPPORTED_FEATURE: Unsupported SmallCaps in this writer\n",
                        );
                    }
                    inlines(children, target, bracketed)?;
                }
                I::Strong(children)
                | I::Emph(children)
                | I::Strikeout(children)
                | I::Subscript(children)
                | I::Superscript(children)
                | I::Quoted(_, children)
                | I::Link(_, children, _, _)
                | I::Image(_, children, _, _) => inlines(children, target, bracketed)?,
                I::Note(blocks) => check_writer(blocks, target, bracketed)?,
                _ => {}
            }
        }
        Ok(())
    }
    for block in blocks {
        match block {
            PandocBlock::Vector(_) if !matches!(target, "json" | "docx" | "pdf") => return Err("E_UNSUPPORTED_FEATURE: Vector requires JSON, DOCX, or PDF output\n"),
            PandocBlock::Figure(attr, short, caption, children) => {
                attrs(attr, target, false, bracketed_spans)?;
                if let Some(short) = short {
                    inlines(short, target, bracketed_spans)?;
                }
                check_writer(caption, target, bracketed_spans)?;
                check_writer(children, target, bracketed_spans)?;
            }
            PandocBlock::Div(attr, children) => {
                attrs(attr, target, false, bracketed_spans)?;
                check_writer(children, target, bracketed_spans)?;
            }
            PandocBlock::BlockQuote(children) => check_writer(children, target, bracketed_spans)?,
            PandocBlock::List(_, items) => {
                for item in items {
                    check_writer(item, target, bracketed_spans)?;
                }
            }
            PandocBlock::Table(table) => {
                for cell in table.head.iter().chain(&table.body).flatten() {
                    check_writer(&cell.blocks, target, bracketed_spans)?;
                }
            }
            PandocBlock::Header(_, _, children)
            | PandocBlock::Para(children)
            | PandocBlock::Plain(children) => inlines(children, target, bracketed_spans)?,
            _ => {}
        }
    }
    Ok(())
}

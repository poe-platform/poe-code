use super::{
    PandocBlock, PandocInline, PandocPipeTables, XmlElement, XmlNode, inlines_plain_text,
    pandoc_list, pandoc_slug, parse_pandoc_markdown, xml,
};
use crate::commands::codecs::zip_directory;
use std::{borrow::Cow, collections::HashMap};

type Error = (i32, &'static str);
const INVALID: Error = (63, "couldn't parse docx file: DocxError\n");
const UNSUPPORTED: Error = (1, "pandoc: unsupported Word document content\n");
const INPUT_LIMIT: Error = (1, "pandoc: DOCX input limit exceeded\n");
const WORD: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

fn root(bytes: &[u8]) -> Result<XmlElement, Error> {
    let doc = xml::parse(std::str::from_utf8(bytes).map_err(|_| INVALID)?, None, None)
        .map_err(|_| INVALID)?;
    doc.nodes
        .into_iter()
        .find_map(|node| {
            if let XmlNode::Element(e) = node {
                Some(e)
            } else {
                None
            }
        })
        .ok_or(INVALID)
}

fn attr<'a>(element: &'a XmlElement, name: &str) -> Option<&'a str> {
    element
        .attrs
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

fn children(element: &XmlElement) -> impl Iterator<Item = &XmlElement> {
    element.children.iter().filter_map(|node| match node {
        XmlNode::Element(e) if attr(e, "xmlns:w").is_none_or(|uri| uri == WORD) => Some(e),
        _ => None,
    })
}

fn child<'a>(element: &'a XmlElement, tag: &str) -> Option<&'a XmlElement> {
    children(element).find(|e| e.tag == tag)
}

// Word may split a single word across runs. Join neighboring runs with the
// same formatting before constructing Pandoc's word and space inlines.
fn read_inlines(
    element: &XmlElement,
    links: &HashMap<String, String>,
    remaining: &mut usize,
    in_link: bool,
) -> Result<Vec<PandocInline>, Error> {
    let mut out = Vec::new();
    let mut text = String::new();
    let mut properties = (false, false, false, false);
    let mut space = false;
    let flush = |text: &mut String,
                 (bold, italic, strike, code),
                 out: &mut Vec<PandocInline>,
                 space: &mut bool| {
        if text.is_empty() {
            return;
        }
        let mut words = text.split_whitespace();
        if code || !text.trim().is_empty() {
            if !out.is_empty() && (*space || !code && text.starts_with(char::is_whitespace)) {
                out.push(PandocInline::Space);
            }
            let mut content = if code {
                vec![PandocInline::Code(Default::default(), text.clone())]
            } else {
                let mut content = vec![PandocInline::Text(words.next().unwrap().into())];
                for word in words {
                    content.push(PandocInline::Space);
                    content.push(PandocInline::Text(word.into()));
                }
                content
            };
            if strike {
                content = vec![PandocInline::Strikeout(content)];
            }
            if bold {
                content = vec![PandocInline::Strong(content)];
            }
            if italic {
                content = vec![PandocInline::Emph(content)];
            }
            out.append(&mut content);
            *space = !code && text.ends_with(char::is_whitespace);
        } else {
            *space |= !text.is_empty();
        }
        text.clear();
    };
    for run in children(element) {
        match run.tag.as_str() {
            "w:pPr" | "w:bookmarkStart" | "w:bookmarkEnd" | "w:proofErr" => continue,
            "w:hyperlink" if !in_link => {
                flush(&mut text, properties, &mut out, &mut space);
                if space && !out.is_empty() {
                    out.push(PandocInline::Space);
                }
                space = false;
                let mut target = if let Some(id) = attr(run, "r:id") {
                    let url = links.get(id).ok_or(INVALID)?;
                    *remaining = remaining.checked_sub(url.len()).ok_or(INPUT_LIMIT)?;
                    url.clone()
                } else {
                    String::new()
                };
                if let Some(anchor) = attr(run, "w:anchor") {
                    target.push('#');
                    target.push_str(anchor);
                }
                let content = read_inlines(run, links, remaining, true)?;
                if target.is_empty() {
                    out.extend(content);
                } else {
                    out.push(PandocInline::Link(
                        Default::default(),
                        content,
                        target,
                        String::new(),
                    ));
                }
                continue;
            }
            "w:r" => {}
            _ => return Err(UNSUPPORTED),
        }
        let props = child(run, "w:rPr");
        let on = |tag| {
            props
                .and_then(|pr| child(pr, tag))
                .is_some_and(|e| !matches!(attr(e, "w:val"), Some("0" | "off" | "false")))
        };
        let next = (
            on("w:b"),
            on("w:i"),
            on("w:strike"),
            props
                .and_then(|p| child(p, "w:rStyle"))
                .and_then(|s| attr(s, "w:val"))
                == Some("VerbatimChar"),
        );
        if next != properties {
            flush(&mut text, properties, &mut out, &mut space);
            properties = next;
        }
        run_text(run, &mut text, false)?;
    }
    flush(&mut text, properties, &mut out, &mut space);
    Ok(out)
}

fn run_text(run: &XmlElement, text: &mut String, literal: bool) -> Result<(), Error> {
    for part in children(run) {
        match part.tag.as_str() {
            "w:t" => {
                for node in &part.children {
                    match node {
                        XmlNode::Text(s, _) | XmlNode::Cdata(s) => text.push_str(s),
                        XmlNode::Markup(_) => {}
                        XmlNode::Element(_) => return Err(INVALID),
                    }
                }
            }
            "w:tab" if literal => text.push('\t'),
            "w:br" | "w:cr" if literal => text.push('\n'),
            "w:rPr" | "w:lastRenderedPageBreak" => {}
            _ => return Err(UNSUPPORTED),
        }
    }
    Ok(())
}

fn paragraph(
    element: &XmlElement,
    style: &str,
    links: &HashMap<String, String>,
    remaining: &mut usize,
) -> Result<Option<PandocBlock>, Error> {
    let content = || {
        children(element).filter(|e| {
            !matches!(
                e.tag.as_str(),
                "w:pPr" | "w:proofErr" | "w:bookmarkStart" | "w:bookmarkEnd"
            )
        })
    };
    let mut nodes = content();
    if let Some(run) = nodes.next()
        && nodes.next().is_none()
        && run.tag == "w:r"
        && let Some(pict) = child(run, "w:pict")
        && let Some(rect) = child(pict, "v:rect")
        && matches!(attr(rect, "o:hr"), Some("t" | "true" | "1"))
        && children(run).all(|node| matches!(node.tag.as_str(), "w:rPr" | "w:pict"))
    {
        return Ok(Some(PandocBlock::HorizontalRule));
    }
    if style == "source code" {
        let mut code = String::new();
        for run in content() {
            if run.tag != "w:r" {
                return Err(UNSUPPORTED);
            }
            run_text(run, &mut code, true)?;
        }
        return Ok(Some(PandocBlock::CodeBlock(Default::default(), code)));
    }
    let out = read_inlines(element, links, remaining, false)?;
    if let Some(level) = style.strip_prefix("heading ").and_then(|n| n.parse().ok())
        && (1..=9).contains(&level)
    {
        return Ok(Some(PandocBlock::Header(
            level,
            pandoc_slug(&inlines_plain_text(&out)),
            out,
        )));
    }
    Ok((!out.is_empty()).then_some(PandocBlock::Para(out)))
}

fn value<'a>(element: &'a XmlElement, tag: &str) -> Option<&'a str> {
    child(element, tag).and_then(|e| attr(e, "w:val"))
}

fn finish_list(stack: &mut Vec<(usize, &str, PandocBlock)>, blocks: &mut Vec<PandocBlock>) {
    let (_, _, list) = stack.pop().unwrap();
    if let Some((_, _, PandocBlock::List(_, items))) = stack.last_mut()
        && let Some(item) = items.last_mut()
    {
        item.push(list);
    } else {
        blocks.push(list);
    }
}

pub(super) fn read(data: &[u8], mut remaining: usize) -> Result<Vec<PandocBlock>, Error> {
    let (members, _) =
        zip_directory(data.len(), |r| Ok(Cow::Borrowed(&data[r]))).map_err(|_| INVALID)?;
    let mut part = |path: &str| -> Result<Option<Cow<'_, [u8]>>, Error> {
        let mut matches = members.iter().filter(|m| m.name == path);
        let Some(m) = matches.next() else {
            return Ok(None);
        };
        if matches.next().is_some() || !matches!(m.method, 0 | 8) {
            return Err(INVALID);
        }
        remaining = remaining.checked_sub(m.size).ok_or(INPUT_LIMIT)?;
        m.decode(Cow::Borrowed(&data[m.payload.clone()]), None)
            .map(Some)
            .map_err(|_| INVALID)
    };
    let Some(rels) = part("_rels/.rels")? else {
        // Older safe-bash exports contained only the original Markdown and an HTML preview.
        let legacy = part("__pandoc_source.md")?.ok_or(INVALID)?;
        return parse_pandoc_markdown(
            std::str::from_utf8(&legacy).map_err(|_| INVALID)?,
            false,
            PandocPipeTables::Markdown,
            0,
            pandoc_list::Tasks::Markdown,
        )
        .ok_or(INVALID);
    };
    let rels = root(&rels)?;
    if rels.tag != "Relationships"
        || attr(&rels, "xmlns")
            != Some("http://schemas.openxmlformats.org/package/2006/relationships")
    {
        return Err(INVALID);
    }
    let target = children(&rels).find(|e| e.tag == "Relationship" && attr(e,"Type") == Some("http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument") && attr(e,"TargetMode") != Some("External")).and_then(|e|attr(e,"Target")).ok_or(INVALID)?;
    let document = root(&part(target.trim_start_matches('/'))?.ok_or(INVALID)?)?;
    if document.tag != "w:document" || attr(&document, "xmlns:w") != Some(WORD) {
        return Err(INVALID);
    }
    let (directory, file) = target
        .trim_start_matches('/')
        .rsplit_once('/')
        .unwrap_or(("", target.trim_start_matches('/')));
    let mut links = HashMap::new();
    let mut numbering = None;
    let mut styles_path = String::from("word/styles.xml");
    let rels_path = format!("{directory}/_rels/{file}.rels");
    if let Some(bytes) = part(rels_path.trim_start_matches('/'))? {
        let rels = root(&bytes)?;
        if rels.tag != "Relationships" || attr(&rels, "xmlns") != Some(PACKAGE_REL) {
            return Err(INVALID);
        }
        for r in children(&rels).filter(|e| e.tag == "Relationship") {
            let (Some(id), Some(target), Some(kind)) =
                (attr(r, "Id"), attr(r, "Target"), attr(r, "Type"))
            else {
                continue;
            };
            let Some(kind) = kind.strip_prefix(REL).and_then(|s| s.strip_prefix('/')) else {
                continue;
            };
            if kind == "hyperlink" {
                links.insert(id.to_owned(), target.to_owned());
            } else if matches!(kind, "numbering" | "styles")
                && attr(r, "TargetMode") != Some("External")
            {
                let path = super::resolve_posix_path(&format!("/{directory}"), target);
                let path = path.trim_start_matches('/');
                if kind == "styles" {
                    styles_path = path.to_owned();
                } else if let Some(bytes) = part(path)? {
                    numbering = Some(root(&bytes)?);
                }
            }
        }
    }
    let mut style_names = HashMap::new();
    if let Some(styles) = part(&styles_path)? {
        let styles = root(&styles)?;
        if styles.tag != "w:styles" || attr(&styles, "xmlns:w") != Some(WORD) {
            return Err(INVALID);
        }
        for style in children(&styles)
            .filter(|e| e.tag == "w:style" && attr(e, "w:type") == Some("paragraph"))
        {
            if let Some(id) = attr(style, "w:styleId")
                && let Some(name) = child(style, "w:name").and_then(|e| attr(e, "w:val"))
            {
                style_names.insert(id.to_owned(), name.to_ascii_lowercase());
            }
        }
    }
    let mut levels = HashMap::new();
    let mut instances = HashMap::new();
    let mut starts = HashMap::new();
    if let Some(ref nums) = numbering {
        for def in children(nums) {
            if def.tag == "w:abstractNum"
                && let Some(id) = attr(def, "w:abstractNumId")
            {
                for lvl in children(def).filter(|e| e.tag == "w:lvl") {
                    if let Some(depth) = attr(lvl, "w:ilvl").and_then(|n| n.parse::<usize>().ok()) {
                        levels.insert((id, depth), lvl);
                    }
                }
            } else if def.tag == "w:num"
                && let Some(id) = attr(def, "w:numId")
                && let Some(key) = value(def, "w:abstractNumId")
            {
                instances.insert(id, key);
                for lvl in children(def).filter(|e| e.tag == "w:lvlOverride") {
                    if let Some(depth) = attr(lvl, "w:ilvl").and_then(|n| n.parse::<usize>().ok())
                        && let Some(start) =
                            value(lvl, "w:startOverride").and_then(|n| n.parse::<i64>().ok())
                    {
                        starts.insert((id, depth), start);
                    }
                }
            }
        }
    }
    let body = child(&document, "w:body").ok_or(INVALID)?;
    let text_width = child(body, "w:sectPr")
        .and_then(|pr| {
            let width = attr(child(pr, "w:pgSz")?, "w:w")?.parse::<i32>().ok()? as f64;
            let mar = child(pr, "w:pgMar")?;
            ["w:left", "w:right", "w:gutter"]
                .iter()
                .try_fold(width, |w, k| {
                    Some(w - attr(mar, k)?.parse::<i32>().ok()? as f64)
                })
        })
        .unwrap_or(9360.);
    BodyReader {
        style_names: &style_names,
        instances: &instances,
        levels: &levels,
        starts: &starts,
        links: &links,
        text_width,
        remaining,
    }
    .blocks(body, 0)
}

struct BodyReader<'a> {
    style_names: &'a HashMap<String, String>,
    instances: &'a HashMap<&'a str, &'a str>,
    levels: &'a HashMap<(&'a str, usize), &'a XmlElement>,
    starts: &'a HashMap<(&'a str, usize), i64>,
    links: &'a HashMap<String, String>,
    text_width: f64,
    remaining: usize,
}

impl BodyReader<'_> {
    fn table(&mut self, tbl: &XmlElement, depth: usize) -> Result<Option<PandocBlock>, Error> {
        use super::pandoc_table::{Cell, Table};
        let mut table = Table::default();
        if let Some(grid) = child(tbl, "w:tblGrid") {
            for col in children(grid).filter(|e| e.tag == "w:gridCol") {
                table.cols.push((
                    None,
                    attr(col, "w:w")
                        .and_then(|s| s.parse::<i32>().ok())
                        .unwrap_or(0) as f64,
                ));
            }
        }
        let available = self.text_width - 10. * (table.cols.len() as f64 - 1.);
        if available <= 0. {
            return Err(UNSUPPORTED);
        }
        let mut total = 0.;
        for (_, w) in &mut table.cols {
            *w /= available;
            total += *w;
        }
        if total > 1. {
            for (_, w) in &mut table.cols {
                *w /= total;
            }
        }
        let first_header = child(tbl, "w:tblPr")
            .and_then(|pr| child(pr, "w:tblLook"))
            .is_some_and(|look| {
                attr(look, "w:firstRow").map_or_else(
                    || {
                        attr(look, "w:val")
                            .and_then(|v| u32::from_str_radix(v, 16).ok())
                            .is_some_and(|v| v & 32 != 0)
                    },
                    |v| v == "1",
                )
            });
        let mut head = Vec::new();
        let mut body = Vec::new();
        let continuing = |tc: &XmlElement| {
            child(tc, "w:tcPr")
                .and_then(|p| child(p, "w:vMerge"))
                .is_some_and(|v| attr(v, "w:val") != Some("restart"))
        };
        let mut previous_header = false;
        for (i, tr) in children(tbl).filter(|e| e.tag == "w:tr").enumerate() {
            let header = i == 0 && first_header
                || child(tr, "w:trPr")
                    .and_then(|p| child(p, "w:tblHeader"))
                    .is_some_and(|p| attr(p, "w:val") != Some("0"))
                || previous_header && children(tr).filter(|e| e.tag == "w:tc").any(continuing);
            if header {
                if head.is_empty() {
                    head.append(&mut body);
                }
                head.push(tr);
            } else {
                body.push(tr);
            }
            previous_header = header;
        }
        // A Word continuation extends whichever cell covers the same column above it.
        // Scan physical cells, not every grid slot covered by their spans.
        for (source, target) in [(head, &mut table.head), (body, &mut table.body)] {
            let mut below: Vec<(usize, usize)> = Vec::new();
            for tr in source.into_iter().rev() {
                let mut row = Vec::new();
                let mut next = Vec::new();
                let mut lower = below.iter().peekable();
                let mut column = 0usize;
                for tc in children(tr).filter(|e| e.tag == "w:tc") {
                    let props = child(tc, "w:tcPr");
                    let span = props
                        .and_then(|p| value(p, "w:gridSpan"))
                        .map_or(Some(1), |v| v.parse::<usize>().ok())
                        .filter(|n| *n > 0)
                        .ok_or(INVALID)?;
                    let start = column;
                    column = column.checked_add(span).ok_or(INVALID)?;
                    while lower.peek().is_some_and(|(end, _)| *end <= start) {
                        lower.next();
                    }
                    let height = 1 + lower.peek().map_or(0, |(_, rows)| *rows);
                    let merged = continuing(tc);
                    next.push((column, if merged { height } else { 0 }));
                    if merged {
                        continue;
                    }
                    let align = children(tc)
                        .find(|p| p.tag != "w:tcPr")
                        .filter(|p| p.tag == "w:p")
                        .and_then(|p| child(p, "w:pPr"))
                        .and_then(|p| value(p, "w:jc"))
                        .and_then(|v| match v {
                            "both" | "left" => Some(fmt::Alignment::Left),
                            "right" => Some(fmt::Alignment::Right),
                            "center" => Some(fmt::Alignment::Center),
                            _ => None,
                        });
                    let mut blocks = self.blocks(tc, depth + 1)?;
                    if blocks.len() == 1
                        && let PandocBlock::Para(nodes) = &mut blocks[0]
                    {
                        blocks[0] = PandocBlock::Plain(std::mem::take(nodes));
                    }
                    row.push(Cell {
                        align,
                        span: (height, span),
                        column: start,
                        blocks,
                    });
                }
                target.push(row);
                below = next;
            }
            target.reverse();
        }
        if let Some(row) = table.head.first().or(table.body.first()) {
            if table.cols.is_empty() {
                let count = row
                    .iter()
                    .try_fold(0usize, |n, c| n.checked_add(c.span.0))
                    .ok_or(INPUT_LIMIT)?;
                if count > self.remaining {
                    return Err(INPUT_LIMIT);
                }
                table.cols.resize(count, (None, 0.));
            }
            if let Some(first) = row.first() {
                for col in table.cols.iter_mut().take(first.span.1) {
                    col.0 = first.align;
                }
            }
        }
        Ok((!table.head.is_empty() || !table.body.is_empty()).then_some(PandocBlock::Table(table)))
    }

    fn blocks(&mut self, parent: &XmlElement, depth: usize) -> Result<Vec<PandocBlock>, Error> {
        if depth > 32 {
            return Err(INPUT_LIMIT);
        }
        let mut lists: Vec<(usize, &str, PandocBlock)> = Vec::new();
        let mut blocks = Vec::new();
        for e in children(parent) {
            match e.tag.as_str() {
                "w:p" => {
                    let props = child(e, "w:pPr");
                    let style = props
                        .and_then(|p| value(p, "w:pStyle"))
                        .and_then(|id| self.style_names.get(id))
                        .map_or("", String::as_str);
                    let num = props.and_then(|p| child(p, "w:numPr"));
                    if let Some((id, depth)) = num.and_then(|n| {
                        Some((
                            value(n, "w:numId")?,
                            value(n, "w:ilvl").unwrap_or("0").parse::<usize>().ok()?,
                        ))
                    }) && id != "0"
                    {
                        if depth > 8 {
                            return Err(UNSUPPORTED);
                        }
                        while lists
                            .last()
                            .is_some_and(|(d, key, _)| *d > depth || *d == depth && *key != id)
                        {
                            finish_list(&mut lists, &mut blocks);
                        }
                        if lists.last().is_none_or(|(d, _, _)| *d < depth) {
                            let lvl = self
                                .instances
                                .get(id)
                                .and_then(|key| self.levels.get(&(*key, depth)))
                                .ok_or(UNSUPPORTED)?;
                            let fmt = value(lvl, "w:numFmt").ok_or(UNSUPPORTED)?;
                            let number = if fmt == "bullet" {
                                None
                            } else {
                                let style = match fmt {
                                    "decimal" => "Decimal",
                                    "lowerLetter" => "LowerAlpha",
                                    "upperLetter" => "UpperAlpha",
                                    "lowerRoman" => "LowerRoman",
                                    "upperRoman" => "UpperRoman",
                                    _ => return Err(UNSUPPORTED),
                                };
                                let pattern = value(lvl, "w:lvlText").unwrap_or(".");
                                let delimiter =
                                    if pattern.starts_with('(') && pattern.ends_with(')') {
                                        "TwoParens"
                                    } else if pattern.ends_with(')') {
                                        "OneParen"
                                    } else {
                                        "Period"
                                    };
                                Some(pandoc_list::Numbering {
                                    start: self
                                        .starts
                                        .get(&(id, depth))
                                        .copied()
                                        .or_else(|| {
                                            value(lvl, "w:start").and_then(|n| n.parse().ok())
                                        })
                                        .unwrap_or(1),
                                    style: style.into(),
                                    delimiter: delimiter.into(),
                                })
                            };
                            lists.push((depth, id, PandocBlock::List(number, Vec::new())));
                        }
                        let Some((_, _, PandocBlock::List(_, items))) = lists.last_mut() else {
                            unreachable!()
                        };
                        let inlines = read_inlines(e, self.links, &mut self.remaining, false)?;
                        items.push(if style == "compact" {
                            vec![PandocBlock::Plain(inlines)]
                        } else {
                            vec![PandocBlock::Para(inlines)]
                        });
                    } else {
                        while !lists.is_empty() {
                            finish_list(&mut lists, &mut blocks);
                        }
                        if let Some(block) = paragraph(e, style, self.links, &mut self.remaining)? {
                            if style == "block text" {
                                if let Some(PandocBlock::BlockQuote(inner)) = blocks.last_mut() {
                                    inner.push(block);
                                } else {
                                    blocks.push(PandocBlock::BlockQuote(vec![block]));
                                }
                            } else if parent.tag == "w:tc"
                                && style == "compact"
                                && let PandocBlock::Para(nodes) = block
                            {
                                blocks.push(PandocBlock::Plain(nodes));
                            } else {
                                blocks.push(block);
                            }
                        }
                    }
                }
                "w:tbl" => {
                    while !lists.is_empty() {
                        finish_list(&mut lists, &mut blocks);
                    }
                    if let Some(table) = self.table(e, depth)? {
                        blocks.push(table);
                    }
                }
                "w:tcPr" if parent.tag == "w:tc" => {}
                "w:bookmarkStart" | "w:bookmarkEnd" | "w:sectPr" => {}
                _ => return Err(UNSUPPORTED),
            }
        }
        while !lists.is_empty() {
            finish_list(&mut lists, &mut blocks);
        }
        Ok(blocks)
    }
}

use std::fmt::{self, Write};
use xml::EncodedOutput;
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL: &str = "http://schemas.openxmlformats.org/package/2006/relationships";

struct Writer {
    document: EncodedOutput<'static>,
    relationships: EncodedOutput<'static>,
    numbering: EncodedOutput<'static>,
    links: usize,
    lists: usize,
    bookmarks: usize,
}

impl Writer {
    fn inlines(&mut self, mut nodes: &[PandocInline], properties: &str) -> fmt::Result {
        while let Some((node, rest)) = nodes.split_first() {
            nodes = rest;
            match node {
                PandocInline::Strong(children)
                | PandocInline::Emph(children)
                | PandocInline::Strikeout(children) => {
                    let tag = match node {
                        PandocInline::Strong(_) => "<w:b/>",
                        PandocInline::Emph(_) => "<w:i/>",
                        _ => "<w:strike/>",
                    };
                    self.inlines(children, &(properties.to_owned() + tag))?;
                }
                PandocInline::Link(_, children, url, _) => {
                    if let Some(anchor) = url.strip_prefix('#') {
                        write!(
                            self.document,
                            "<w:hyperlink w:anchor=\"{}\">",
                            super::xml_escape_text(anchor)
                        )?;
                    } else {
                        self.links += 1;
                        write!(
                            self.relationships,
                            r#"<Relationship Id="link{}" Type="{REL}/hyperlink" Target="{}" TargetMode="External"/>"#,
                            self.links,
                            super::xml_escape_text(url)
                        )?;
                        write!(self.document, r#"<w:hyperlink r:id="link{}">"#, self.links)?;
                    }
                    self.inlines(children, properties)?;
                    self.document.write_str("</w:hyperlink>")?;
                }
                PandocInline::Code(_, code) => {
                    write!(
                        self.document,
                        r#"<w:r><w:rPr><w:rStyle w:val="VerbatimChar"/>{properties}</w:rPr><w:t xml:space="preserve">{}</w:t></w:r>"#,
                        super::xml_escape_text(code)
                    )?;
                }
                PandocInline::Text(_) | PandocInline::Space => {
                    self.document.write_str("<w:r>")?;
                    if !properties.is_empty() {
                        write!(self.document, "<w:rPr>{properties}</w:rPr>")?;
                    }
                    self.document.write_str(r#"<w:t xml:space="preserve">"#)?;
                    let mut current = node;
                    loop {
                        if let PandocInline::Text(text) = current {
                            self.document.write_str(&super::xml_escape_text(text))?;
                        } else {
                            self.document.write_char(' ')?;
                        }
                        let Some((next @ (PandocInline::Space | PandocInline::Text(_)), rest)) =
                            nodes.split_first()
                        else {
                            break;
                        };
                        current = next;
                        nodes = rest;
                    }
                    self.document.write_str("</w:t></w:r>")?;
                }
            }
        }
        Ok(())
    }

    fn blocks(
        &mut self,
        blocks: &[PandocBlock],
        style: &str,
        depth: usize,
        mut marker: &str,
    ) -> fmt::Result {
        for block in blocks {
            match block {
                PandocBlock::Para(nodes) | PandocBlock::Plain(nodes) | PandocBlock::Header(_, _, nodes) => {
                    let heading;
                    let style = if let PandocBlock::Header(level, _, _) = block {
                        heading = format!("Heading{}", level.clamp(&1,&9)); &heading
                    } else {style};
                    self.document.write_str("<w:p><w:pPr>")?;
                    if !style.is_empty() {write!(self.document, r#"<w:pStyle w:val="{style}"/>"#)?;}
                    write!(self.document, "{marker}</w:pPr>")?;
                    marker = "";
                    let bookmark = if let PandocBlock::Header(_, id, _) = block && !id.is_empty() {
                        self.bookmarks += 1;
                        write!(self.document, r#"<w:bookmarkStart w:id="{}" w:name="{}"/>"#, self.bookmarks, super::xml_escape_text(id))?;
                        Some(self.bookmarks)
                    } else {None};
                    self.inlines(nodes,"")?;
                    if let Some(id) = bookmark {write!(self.document, r#"<w:bookmarkEnd w:id="{id}"/>"#)?;}
                    self.document.write_str("</w:p>")?;
                }
                PandocBlock::BlockQuote(inner) => self.blocks(inner, "BlockText", depth, std::mem::take(&mut marker))?,
                PandocBlock::CodeBlock(_, code) => {
                    write!(self.document, r#"<w:p><w:pPr><w:pStyle w:val="SourceCode"/>{marker}</w:pPr>"#)?;
                    marker = "";
                    for (i,line) in code.split('\n').enumerate() {
                        if i != 0 {self.document.write_str("<w:r><w:br/></w:r>")?;}
                        write!(self.document, r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r>"#, super::xml_escape_text(line))?;
                    }
                    self.document.write_str("</w:p>")?;
                }
                PandocBlock::HorizontalRule => self.document.write_str(r#"<w:p><w:r><w:pict><v:rect style="width:0;height:1.5pt" o:hralign="center" o:hrstd="t" o:hr="t"/></w:pict></w:r></w:p>"#)?,
                PandocBlock::List(numbering, items) => {
                    self.lists += 1;
                    let id = self.lists;
                    let level = depth.min(8);
                    let (start, fmt, pattern) = if let Some(n) = numbering {
                        let fmt = match n.style.as_str() {"LowerAlpha"=>"lowerLetter", "UpperAlpha"=>"upperLetter", "LowerRoman"=>"lowerRoman", "UpperRoman"=>"upperRoman", _=>"decimal"};
                        let index = level+1;
                        let pattern = match n.delimiter.as_str() {"OneParen"=>format!("%{index})"),"TwoParens"=>format!("(%{index})"),_=>format!("%{index}.")};
                        (n.start,fmt,pattern)
                    } else {(1,"bullet","•".into())};
                    write!(self.numbering, r#"<w:abstractNum w:abstractNumId="{id}"><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="{level}"><w:start w:val="{start}"/><w:numFmt w:val="{fmt}"/><w:lvlText w:val="{pattern}"/><w:pPr><w:ind w:left="{}" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>"#, 720*(level+1))?;
                    let num = format!(r#"<w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="{id}"/></w:numPr>"#);
                    for item in items {self.blocks(item, if matches!(item.first(),Some(PandocBlock::Plain(_))) {"Compact"} else {""}, depth+1, &num)?;}
                }
                PandocBlock::Table(table) => {
                    let cols = table.cols.len().max(1);
                    let fraction: f64 = table.cols.iter().map(|(_, w)| w).sum();
                    let kind = if fraction == 0. {"auto"} else {"pct"};
                    write!(self.document, r#"<w:tbl><w:tblPr><w:tblW w:type="{kind}" w:w="{}"/><w:tblLook w:firstRow="{}"/></w:tblPr><w:tblGrid>"#, (fraction * 5000.).round_ties_even(), usize::from(!table.head.is_empty()))?;
                    for (_,w) in &table.cols {
                        let width = if fraction == 0. {1. / cols as f64} else {*w};
                        write!(self.document, r#"<w:gridCol w:w="{}"/>"#, (7920. * width).floor())?;
                    }
                    self.document.write_str("</w:tblGrid>")?;
                    let mut continuing = std::collections::BTreeMap::<usize,(usize,usize)>::new();
                    for (i,row) in table.head.iter().chain(&table.body).enumerate() {
                        self.document.write_str("<w:tr>")?;
                        if i<table.head.len() {self.document.write_str(r#"<w:trPr><w:tblHeader w:val="on"/></w:trPr>"#)?;}
                        let mut previous = std::mem::take(&mut continuing).into_iter().peekable();
                        let mut starts = row.iter().peekable();
                        while previous.peek().is_some() || starts.peek().is_some() {
                            let carry = previous.peek().is_some_and(|(col,_)| starts.peek().is_none_or(|c| *col<c.column));
                            let (col,width,end,cell) = if carry {
                                let (col,(width,end)) = previous.next().unwrap();
                                (col,width,end,None)
                            } else {
                                let cell = starts.next().unwrap();
                                (cell.column,cell.span.1,i+cell.span.0,Some(cell))
                            };
                            self.document.write_str("<w:tc>")?;
                            if width>1 || carry || end>i+1 {
                                self.document.write_str("<w:tcPr>")?;
                                if width>1 {write!(self.document,r#"<w:gridSpan w:val="{width}"/>"#)?;}
                                if carry {self.document.write_str("<w:vMerge/>")?;}
                                else if end>i+1 {self.document.write_str(r#"<w:vMerge w:val="restart"/>"#)?;}
                                self.document.write_str("</w:tcPr>")?;
                            }
                            if end>i+1 {continuing.insert(col,(width,end));}
                            if let Some(cell) = cell {
                                let jc = match cell.align.or_else(||table.cols.get(col).and_then(|c|c.0)) {
                                    Some(fmt::Alignment::Center)=>r#"<w:jc w:val="center"/>"#,Some(fmt::Alignment::Right)=>r#"<w:jc w:val="right"/>"#,Some(fmt::Alignment::Left)=>r#"<w:jc w:val="left"/>"#,None=>""};
                                if cell.blocks.is_empty() {write!(self.document,"<w:p><w:pPr>{jc}</w:pPr></w:p>")?;}
                                else {self.blocks(&cell.blocks,"Compact",depth,jc)?;}
                            } else {self.document.write_str("<w:p/>")?;}
                            self.document.write_str("</w:tc>")?;
                        }
                        self.document.write_str("</w:tr>")?;
                    }
                    self.document.write_str("</w:tbl>")?;
                }
            }
        }
        Ok(())
    }
}

pub(super) fn write(blocks: &[PandocBlock], limit: usize) -> Option<Vec<u8>> {
    let part = || EncodedOutput {
        bytes: Vec::new(),
        encoding: None,
        limit,
    };
    let mut w = Writer {
        document: part(),
        relationships: part(),
        numbering: part(),
        links: 0,
        lists: 0,
        bookmarks: 0,
    };
    write!(w.document, r#"<w:document xmlns:w="{WORD}" xmlns:r="{REL}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body>"#).ok()?;
    write!(w.relationships, r#"<Relationships xmlns="{PACKAGE_REL}"><Relationship Id="styles" Type="{REL}/styles" Target="styles.xml"/>"#).ok()?;
    write!(w.numbering, r#"<w:numbering xmlns:w="{WORD}">"#).ok()?;
    w.blocks(blocks, "", 0, "").ok()?;
    w.document
        .write_str("<w:sectPr/></w:body></w:document>")
        .ok()?;
    let mut types = String::from(
        r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>"#,
    );
    if w.lists > 0 {
        types.push_str(r#"<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>"#);
        write!(
            w.relationships,
            r#"<Relationship Id="numbers" Type="{REL}/numbering" Target="numbering.xml"/>"#
        )
        .ok()?;
        for id in 1..=w.lists {
            write!(
                w.numbering,
                r#"<w:num w:numId="{id}"><w:abstractNumId w:val="{id}"/></w:num>"#
            )
            .ok()?;
        }
        w.numbering.write_str("</w:numbering>").ok()?;
    }
    types.push_str("</Types>");
    w.relationships.write_str("</Relationships>").ok()?;
    let mut styles = format!(r#"<w:styles xmlns:w="{WORD}">"#);
    for level in 1..=9 {
        write!(styles,r#"<w:style w:type="paragraph" w:styleId="Heading{level}"><w:name w:val="heading {level}"/><w:pPr><w:outlineLvl w:val="{}"/></w:pPr></w:style>"#, level-1).ok()?;
    }
    for (id, name, kind) in [
        ("Compact", "Compact", "paragraph"),
        ("BlockText", "Block Text", "paragraph"),
        ("SourceCode", "Source Code", "paragraph"),
        ("VerbatimChar", "Verbatim Char", "character"),
    ] {
        write!(
            styles,
            r#"<w:style w:type="{kind}" w:styleId="{id}"><w:name w:val="{name}"/></w:style>"#
        )
        .ok()?;
    }
    styles.push_str("</w:styles>");
    let mut parts = vec![
        ("[Content_Types].xml", types.as_bytes()),
        ("_rels/.rels", include_bytes!("../docx-root.rels")),
        ("word/document.xml", &w.document.bytes),
        ("word/styles.xml", styles.as_bytes()),
        ("word/_rels/document.xml.rels", &w.relationships.bytes),
    ];
    if w.lists > 0 {
        parts.push(("word/numbering.xml", &w.numbering.bytes));
    }
    let size = parts.iter().try_fold(22usize, |n, (name, bytes)| {
        n.checked_add(76 + 2 * name.len())?.checked_add(bytes.len())
    })?;
    (size <= limit && size <= u32::MAX as usize).then(|| super::write_zip_stored(&parts))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_links_cannot_expand_beyond_the_document_budget() {
        let text = r#"<w:hyperlink r:id="link"><w:r><w:t>here</w:t></w:r></w:hyperlink>"#;
        let document = format!(
            r#"<w:document xmlns:w="{WORD}" xmlns:r="{REL}"><w:body><w:p>{}</w:p></w:body></w:document>"#,
            text.repeat(20)
        );
        let rels = format!(
            r#"<Relationships xmlns="{PACKAGE_REL}"><Relationship Id="link" Type="{REL}/hyperlink" TargetMode="External" Target="https://example.org/{}"/></Relationships>"#,
            "x".repeat(1024)
        );
        let packed = super::super::write_zip_stored(&[
            ("_rels/.rels", include_bytes!("../docx-root.rels")),
            ("word/document.xml", document.as_bytes()),
            ("word/_rels/document.xml.rels", rels.as_bytes()),
        ]);
        assert!(matches!(read(&packed, 8192), Err((1, _))));
        assert!(read(&packed, 32768).is_ok());
    }
}

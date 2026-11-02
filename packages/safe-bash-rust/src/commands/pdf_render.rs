// Static HTML block layout, matching the production wkhtmltopdf renderer.
use super::{
    CP1252, PdfDoc,
    pdf_copy::{literal, write_objects},
};
use crate::commands::{
    codecs::zlib_compress,
    structured::{HtmlNode, bounded_html_dom},
};
use std::{fmt::Write as _, io::Write};

#[derive(Default)]
enum BlockKind {
    #[default]
    Paragraph,
    Heading(usize),
    ListItem {
        depth: usize,
        last: bool,
    },
    Table(Vec<TableRow>),
    Code,
    Quote,
    Rule,
}

struct TableRow {
    header: bool,
    cells: Vec<(f64, Vec<String>)>,
}

#[derive(Default)]
struct Block {
    kind: BlockKind,
    text: String,
    links: Vec<String>,
}

fn html_blocks(html: &str) -> Option<Vec<Block>> {
    fn flush(current: &mut Block, blocks: &mut Vec<Block>) {
        if !current.text.trim().is_empty() {
            blocks.push(std::mem::take(current));
        } else {
            *current = Block::default();
        }
    }
    fn block_text(nodes: &[HtmlNode], text: &mut String) {
        for node in nodes {
            match node {
                HtmlNode::Text(value) => text.push_str(value),
                HtmlNode::Element(el) => match el.tag.as_str() {
                    "head" | "script" | "style" | "template" => {}
                    "br" => text.push('\n'),
                    "td" | "th" => {
                        block_text(&el.children, text);
                        text.push('\t');
                    }
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "pre" | "ul" | "ol" | "dl"
                    | "table" | "svg" | "hr" | "img" | "blockquote" | "div" | "section"
                    | "article" | "li" | "dt" | "dd" | "tr" => {
                        text.push('\n');
                        block_text(&el.children, text);
                        text.push('\n');
                    }
                    _ => block_text(&el.children, text),
                },
            }
        }
    }
    fn visit(
        nodes: &[HtmlNode],
        depth: usize,
        current: &mut Block,
        blocks: &mut Vec<Block>,
    ) -> Option<()> {
        for node in nodes {
            let HtmlNode::Element(el) = node else {
                if let HtmlNode::Text(text) = node {
                    current.text.push_str(text);
                }
                continue;
            };
            match el.tag.as_str() {
                "head" | "title" | "script" | "style" | "template" => {}
                "br" => current.text.push('\n'),
                "hr" => {
                    flush(current, blocks);
                    blocks.push(Block {
                        kind: BlockKind::Rule,
                        ..Block::default()
                    });
                }
                "pre" | "blockquote" => {
                    flush(current, blocks);
                    current.kind = if el.tag == "pre" {
                        BlockKind::Code
                    } else {
                        BlockKind::Quote
                    };
                    block_text(&el.children, &mut current.text);
                    flush(current, blocks);
                }
                "ul" | "ol" => {
                    flush(current, blocks);
                    let mut ordinal = 0;
                    for item in &el.children {
                        let HtmlNode::Element(li) = item else {
                            continue;
                        };
                        if li.tag != "li" {
                            continue;
                        }
                        ordinal += 1;
                        let mut start = 0;
                        let mut marked = false;
                        for end in 0..=li.children.len() {
                            let nested = li.children.get(end);
                            if nested.is_some()
                                && !matches!(nested, Some(HtmlNode::Element(e)) if matches!(e.tag.as_str(), "ul" | "ol" | "table"))
                            {
                                continue;
                            }
                            let mut fragment = String::new();
                            block_text(&li.children[start..end], &mut fragment);
                            if !marked || !fragment.trim().is_empty() {
                                let mut text = if marked {
                                    String::new()
                                } else if el.tag == "ol" {
                                    format!("{ordinal}. ")
                                } else {
                                    "• ".into()
                                };
                                text.push_str(fragment.trim());
                                blocks.push(Block {
                                    kind: BlockKind::ListItem { depth, last: true },
                                    text,
                                    links: Vec::new(),
                                });
                                marked = true;
                            }
                            if let Some(nested) = nested {
                                visit(std::slice::from_ref(nested), depth + 1, current, blocks)?;
                                start = end + 1;
                            }
                        }
                    }
                }
                "dl" => {
                    flush(current, blocks);
                    let mut term = String::new();
                    let start = blocks.len();
                    for item in &el.children {
                        let HtmlNode::Element(el) = item else {
                            continue;
                        };
                        match el.tag.as_str() {
                            "dt" => {
                                term.clear();
                                block_text(&el.children, &mut term);
                            }
                            "dd" => {
                                let mut text = String::from("• ");
                                if !term.trim().is_empty() {
                                    text.push_str(term.trim());
                                    text.push_str(": ");
                                }
                                block_text(&el.children, &mut text);
                                blocks.push(Block {
                                    kind: BlockKind::ListItem { depth, last: false },
                                    text,
                                    links: Vec::new(),
                                });
                                term.clear();
                            }
                            _ => {}
                        }
                    }
                    if let Some(item) = blocks[start..].last_mut() {
                        item.kind = BlockKind::ListItem { depth, last: true };
                    }
                }
                "table" => {
                    flush(current, blocks);
                    let mut rows = Vec::new();
                    let mut pending: Vec<_> = el.children.iter().rev().collect();
                    while let Some(node) = pending.pop() {
                        let HtmlNode::Element(row) = node else {
                            continue;
                        };
                        if row.tag != "tr" {
                            if row.tag != "table" {
                                pending.extend(row.children.iter().rev());
                            }
                            continue;
                        }
                        let mut header = false;
                        let mut cells = Vec::new();
                        for node in &row.children {
                            let HtmlNode::Element(cell) = node else {
                                continue;
                            };
                            if !matches!(cell.tag.as_str(), "th" | "td") {
                                continue;
                            }
                            header |= cell.tag == "th";
                            let span = cell
                                .attrs
                                .iter()
                                .find(|(k, _)| k == "colspan")
                                .map_or(1., |(_, v)| super::super::js_number(v, 0.))
                                .max(1.);
                            let mut text = String::new();
                            block_text(&cell.children, &mut text);
                            let mut lines: Vec<_> = text
                                .split('\n')
                                .map(str::trim)
                                .filter(|l| !l.is_empty())
                                .map(|l| l.replace('\t', "   "))
                                .collect();
                            if lines.is_empty() {
                                lines.push(String::new());
                            }
                            cells.push((span, lines));
                        }
                        rows.push(TableRow { header, cells });
                    }
                    if !rows.is_empty() {
                        blocks.push(Block {
                            kind: BlockKind::Table(rows),
                            ..Block::default()
                        });
                    }
                }
                "svg" | "img" => {
                    return None;
                }
                "p" | "div" | "section" | "article" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                    flush(current, blocks);
                    current.kind = el
                        .tag
                        .strip_prefix('h')
                        .and_then(|n| n.parse().ok())
                        .map_or(BlockKind::Paragraph, BlockKind::Heading);
                    visit(&el.children, depth, current, blocks)?;
                    flush(current, blocks);
                }
                "a" => {
                    let start = current.text.len();
                    visit(&el.children, depth, current, blocks)?;
                    if current
                        .text
                        .get(start..)
                        .is_some_and(|s| !s.trim().is_empty())
                        && let Some(href) = el
                            .attrs
                            .iter()
                            .find(|(k, _)| k.eq_ignore_ascii_case("href"))
                            .map(|(_, v)| v.trim())
                        && !href.is_empty()
                    {
                        current.links.push(href.to_owned());
                    }
                }
                _ => visit(&el.children, depth, current, blocks)?,
            }
        }
        Some(())
    }
    let mut blocks = Vec::new();
    let mut current = Block::default();
    visit(&bounded_html_dom(html)?, 0, &mut current, &mut blocks)?;
    flush(&mut current, &mut blocks);
    Some(blocks)
}

enum PageResource {
    Font(&'static str),
    Link(Vec<u8>),
}

pub(super) fn win_ansi(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| {
            u8::try_from(c as u32).unwrap_or_else(|_| {
                CP1252
                    .iter()
                    .position(|&v| v == c && c != '�')
                    .map_or(b'?', |i| 128 + i as u8)
            })
        })
        .collect()
}

fn coordinate(value: f64) -> String {
    if !value.is_finite() {
        return "0".into();
    }
    if value.fract() == 0. {
        return value.to_string();
    }
    let text = format!("{value:.6}");
    let trimmed = text.trim_end_matches('0').trim_end_matches('.');
    if trimmed == "-0" {
        "0".into()
    } else {
        trimmed.into()
    }
}

fn page_font(
    family: &'static str,
    fonts: &mut Vec<&'static str>,
    objects: &mut Vec<PageResource>,
) -> usize {
    fonts.iter().position(|&f| f == family).unwrap_or_else(|| {
        objects.push(PageResource::Font(family));
        fonts.push(family);
        fonts.len() - 1
    }) + 1
}

fn draw_text(
    stream: &mut Vec<u8>,
    text: &str,
    [x, y]: [f64; 2],
    font: usize,
    size: f64,
    color: &str,
    limit: usize,
) -> Result<(), ()> {
    if !stream.is_empty() {
        stream.push(b'\n');
    }
    write!(
        stream,
        "q\n{color} rg\nBT\n/F{font} {size} Tf\n1 0 0 1 {} {} Tm\n",
        coordinate(x),
        coordinate(y)
    )
    .unwrap();
    literal(&win_ansi(text), stream);
    stream.extend_from_slice(b" Tj\nET\nQ");
    (stream.len() <= limit).then_some(()).ok_or(())
}

pub(in super::super) fn render_html(
    doc: &PdfDoc,
    [top, right, bottom, left]: [f64; 4],
    copies: usize,
    collate: bool,
    grayscale: bool,
    settings: impl Fn(usize) -> (usize, bool),
) -> Result<Option<Vec<u8>>, ()> {
    let limit = crate::budget::ShellLimits::default().max_output_bytes;
    let rgb = |[r, g, b]: [f64; 3]| {
        if grayscale {
            let gray = ((0.299 * r + 0.587 * g + 0.114 * b) * 1000.).round() / 1000.;
            format!("{gray} {gray} {gray}")
        } else {
            format!("{r} {g} {b}")
        }
    };
    let mut bodies = vec![
        b"<<\n/Type /Catalog\n/Pages 2 0 R\n>>".to_vec(),
        vec![],
        vec![],
    ];
    let mut info = b"<<\n/Producer (@poe-code/pdf-ast)\n/Title ".to_vec();
    let title = if doc.title.chars().all(|c| c as u32 <= 127) {
        doc.title.as_bytes().to_vec()
    } else {
        [0xfe, 0xff]
            .into_iter()
            .chain(doc.title.encode_utf16().flat_map(u16::to_be_bytes))
            .collect()
    };
    literal(&title, &mut info);
    info.extend_from_slice(b"\n/Creator (wkhtmltopdf \\(pdf-ast-static\\))\n>>");
    bodies[2] = info;
    let mut pages = Vec::new();
    let mut outlines = Vec::new();
    let mut remaining = limit;
    let width = doc.page_w;
    let height = doc.page_h;
    let content_width = (width - left - right).max(72.);
    let media_width = coordinate(width);
    let media_height = coordinate(height);
    let x = coordinate(left);
    let mut remaining_links_budget = limit;
    let mut sheets = Vec::new();
    let mut finish_page = |stream: &mut Vec<u8>,
                           objects: &mut Vec<PageResource>,
                           headings: &mut Vec<(usize, String)>|
     -> Result<(), ()> {
        let compressed = zlib_compress(stream);
        let mut body = format!(
            "<<\n/Filter /FlateDecode\n/Length {}\n>>\nstream\n",
            compressed.len()
        )
        .into_bytes();
        body.extend(compressed);
        body.extend_from_slice(b"\nendstream");
        let sheet_bytes = objects
            .iter()
            .try_fold(body.len() + 160, |size, resource| {
                size.checked_add(match resource {
                    PageResource::Font(_) => 80,
                    PageResource::Link(bytes) => bytes.len(),
                })
            })
            .ok_or(())?;
        remaining = remaining
            .checked_sub(sheet_bytes.checked_mul(copies).ok_or(())?)
            .ok_or(())?;
        sheets.push((body, std::mem::take(objects), std::mem::take(headings)));
        stream.clear();
        Ok(())
    };
    for (page_index, page) in doc.pages.iter().enumerate() {
        let Some(blocks) = html_blocks(&page.html) else {
            return Ok(None);
        };
        let mut stream = Vec::new();
        let mut y = height - top;
        let mut objects = Vec::new();
        let mut fonts = Vec::new();
        let (outline_depth, external_links) = settings(page_index);
        let mut headings = Vec::new();
        for Block {
            kind,
            text: block,
            links,
        } in blocks
        {
            let (size, pitch, family, offset, color, padding) = match kind {
                BlockKind::Table(rows) => {
                    let columns = rows
                        .iter()
                        .map(|r| r.cells.iter().map(|(span, _)| span).sum::<f64>())
                        .fold(1., f64::max);
                    let col_width = content_width / columns;
                    let border = rgb([0.7, 0.73, 0.78]);
                    let fill = rgb([0.91, 0.93, 0.96]);
                    let ink = rgb([0.1, 0.1, 0.12]);
                    for row in rows {
                        let row_height = row
                            .cells
                            .iter()
                            .map(|(_, lines)| lines.len() * 13 + 7)
                            .max()
                            .unwrap_or(0)
                            .max(20) as f64;
                        if y - row_height < bottom && !stream.is_empty() {
                            finish_page(&mut stream, &mut objects, &mut headings)?;
                            fonts.clear();
                            y = height - top;
                        }
                        let row_bottom = y - row_height;
                        let mut column = 0.;
                        for (span, lines) in row.cells {
                            if column >= columns {
                                break;
                            }
                            let span = span.min(columns - column);
                            let cell_x = left + column * col_width;
                            if !stream.is_empty() {
                                stream.push(b'\n');
                            }
                            stream.extend_from_slice(b"q\n");
                            if row.header {
                                writeln!(stream, "{fill} rg").unwrap();
                            }
                            let paint = if row.header { "B" } else { "S" };
                            write!(
                                stream,
                                "{border} RG\n0.6 w\n{} {} {} {} re\n{paint}\nQ",
                                coordinate(cell_x),
                                coordinate(row_bottom),
                                coordinate(span * col_width),
                                coordinate(row_height)
                            )
                            .unwrap();
                            let font = page_font(
                                if row.header {
                                    "Helvetica-Bold"
                                } else {
                                    "Helvetica"
                                },
                                &mut fonts,
                                &mut objects,
                            );
                            for (i, line) in lines.iter().enumerate() {
                                draw_text(
                                    &mut stream,
                                    line,
                                    [cell_x + 5., row_bottom + row_height - 14. - i as f64 * 13.],
                                    font,
                                    9.5,
                                    &ink,
                                    limit,
                                )?;
                            }
                            column += span;
                        }
                        y = row_bottom;
                    }
                    y -= 8.;
                    continue;
                }
                BlockKind::Paragraph => (
                    11.,
                    15.,
                    "Helvetica",
                    0.,
                    if links.is_empty() {
                        [0.12, 0.12, 0.12]
                    } else {
                        [0.05, 0.28, 0.72]
                    },
                    6.,
                ),
                BlockKind::Heading(level) => {
                    let size = match level {
                        1 => 20.,
                        2 => 16.,
                        3 => 14.,
                        _ => 12.,
                    };
                    (
                        size,
                        1.35 * size,
                        "Helvetica-Bold",
                        0.,
                        [0.1, 0.12, 0.18],
                        10.,
                    )
                }
                BlockKind::ListItem { depth, .. } => (
                    11.,
                    15.,
                    "Helvetica",
                    depth as f64 * 18. + 10.,
                    [0.12; 3],
                    2.,
                ),
                BlockKind::Code => (9.5, 13., "Courier", 6., [0.15, 0.15, 0.2], 12.),
                BlockKind::Quote => (10.5, 14.5, "Helvetica-Oblique", 14., [0.25, 0.27, 0.32], 6.),
                BlockKind::Rule => (0., 0., "", 0., [0.; 3], 12.),
            };
            let max_chars = match kind {
                BlockKind::ListItem { depth, .. } => ((content_width - 14. - depth as f64 * 18.)
                    / 5.8)
                    .floor()
                    .max(20.),
                BlockKind::Quote => ((content_width - 18.) / (size * 0.52)).floor().max(20.),
                BlockKind::Heading(_) => (content_width / (size * 0.55)).floor().max(15.),
                _ => (content_width / (11. * 0.52)).floor().max(20.),
            } as usize;
            let mut lines: Vec<String> = vec![];
            let mut len = 0usize;
            if matches!(kind, BlockKind::Code) {
                lines.extend(block.trim().split('\n').map(str::to_owned));
            } else {
                for word in block.split_whitespace() {
                    let n = word.encode_utf16().count();
                    if let Some(line) = lines.last_mut()
                        && len + 1 + n <= max_chars
                    {
                        line.push(' ');
                        line.push_str(word);
                        len += 1 + n;
                    } else {
                        lines.push(word.into());
                        len = n;
                    }
                }
            }
            let needed = pitch * lines.len() as f64 + padding;
            if y - needed < bottom && !stream.is_empty() {
                finish_page(&mut stream, &mut objects, &mut headings)?;
                fonts.clear();
                y = height - top;
            }
            if matches!(kind, BlockKind::Code | BlockKind::Quote | BlockKind::Rule)
                && !stream.is_empty()
            {
                stream.push(b'\n');
            }
            match kind {
                BlockKind::Heading(level) => {
                    y -= 4.;
                    if level <= outline_depth {
                        headings.push((
                            level,
                            block.split_whitespace().collect::<Vec<_>>().join(" "),
                        ));
                    }
                }
                BlockKind::Code => {
                    let h = needed - 4.;
                    write!(
                        stream,
                        "q\n{} rg\n{} RG\n0.5 w\n{x} {} {} {} re\nB\nQ",
                        rgb([0.95, 0.96, 0.97]),
                        rgb([0.82, 0.84, 0.87]),
                        coordinate(y - h),
                        coordinate(content_width),
                        coordinate(h)
                    )
                    .unwrap();
                    y -= 6.;
                }
                BlockKind::Quote => {
                    let bar_x = coordinate(left + 4.);
                    write!(
                        stream,
                        "q\n{} RG\n2.2 w\n{bar_x} {} m\n{bar_x} {} l\nS\nQ",
                        rgb([0.45, 0.5, 0.6]),
                        coordinate(y - 2.),
                        coordinate(y - needed + 4.)
                    )
                    .unwrap();
                }
                BlockKind::Rule => {
                    let bar_y = coordinate(y - 6.);
                    write!(
                        stream,
                        "q\n{} RG\n0.75 w\n{x} {bar_y} m\n{} {bar_y} l\nS\nQ",
                        rgb([0.75, 0.75, 0.78]),
                        coordinate(left + content_width)
                    )
                    .unwrap();
                    if stream.len() > limit {
                        return Err(());
                    }
                    y -= 12.;
                    continue;
                }
                _ => {}
            }
            let block_top = y;
            let font = page_font(family, &mut fonts, &mut objects);
            let mut text_x = left + offset;
            let color = rgb(color);
            for (i, line) in lines.into_iter().enumerate() {
                if i == 1 && matches!(kind, BlockKind::ListItem { .. }) {
                    text_x += 12.;
                }
                draw_text(
                    &mut stream,
                    &line,
                    [text_x, y - size],
                    font,
                    size,
                    &color,
                    limit,
                )?;
                y -= pitch;
            }
            if external_links {
                for uri in links {
                    let mut body = format!("<<\n/Type /Annot\n/Subtype /Link\n/Rect [ {x} {} {} {} ]\n/Border [ 0 0 0 ]\n/A <<\n/Type /Action\n/S /URI\n/URI ",coordinate(y),coordinate(left+content_width.min(220.)),coordinate(block_top)).into_bytes();
                    super::pdf_rewrite::encode(&super::pdf_string::encode(&uri), &mut body)
                        .map_err(|_| ())?;
                    body.extend_from_slice(b"\n>>\n>>");
                    remaining_links_budget =
                        remaining_links_budget.checked_sub(body.len()).ok_or(())?;
                    objects.push(PageResource::Link(body));
                }
            }
            y -= match kind {
                BlockKind::Code => 8.,
                BlockKind::ListItem { last: true, .. } => 4.,
                BlockKind::ListItem { last: false, .. } => 0.,
                _ => 6.,
            };
        }
        finish_page(&mut stream, &mut objects, &mut headings)?;
    }
    for i in 0..sheets.len().checked_mul(copies).ok_or(())? {
        let (sheet, first_copy) = if collate {
            (i % sheets.len(), i < sheets.len())
        } else {
            (i / copies, i % copies == 0)
        };
        let (body, objects, headings) = &sheets[sheet];
        let content = bodies.len() + 1;
        let page = content + 1;
        bodies.push(body.clone());
        let mut resources = String::from("<<\n/Font <<");
        let mut annots = String::new();
        let mut fonts = 0;
        for (i, obj) in objects.iter().enumerate() {
            let id = page + i + 1;
            match obj {
                PageResource::Font(_) => {
                    fonts += 1;
                    write!(resources, "\n/F{fonts} {id} 0 R").unwrap();
                }
                PageResource::Link(_) => write!(annots, "{id} 0 R ").unwrap(),
            }
        }
        resources.push_str("\n>>\n>>");
        let annots = if annots.is_empty() {
            annots
        } else {
            format!("\n/Annots [ {annots}]")
        };
        bodies.push(format!("<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [ 0 0 {media_width} {media_height} ]\n/Resources {resources}\n/Contents {content} 0 R{annots}\n>>").into_bytes());
        for obj in objects {
            bodies.push(match obj {
                PageResource::Font(font) => {
                    format!("<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /{font}\n/Encoding /WinAnsiEncoding\n>>").into_bytes()
                }
                PageResource::Link(body) => body.clone(),
            });
        }
        if first_copy {
            outlines.extend(
                headings
                    .iter()
                    .map(|(level, title)| (*level, title.clone(), (page, 0))),
            );
        }
        pages.push(format!("{page} 0 R"));
    }
    bodies[1] = format!(
        "<<\n/Type /Pages\n/Count {}\n/Kids [ {} ]\n>>",
        pages.len(),
        pages.join(" ")
    )
    .into_bytes();
    if !outlines.is_empty() {
        let root = bodies.len() + 1;
        write_outlines(root, &mut bodies, outlines)?;
        bodies[0] =
            format!("<<\n/Type /Catalog\n/Pages 2 0 R\n/Outlines {root} 0 R\n>>").into_bytes();
    }
    write_objects(&bodies, limit).map(Some).ok_or(())
}

pub(super) fn write_outlines(
    root: usize,
    bodies: &mut Vec<Vec<u8>>,
    outlines: Vec<(usize, String, super::ObjectId)>,
) -> Result<(), ()> {
    use super::{
        Value,
        pdf_rewrite::{encode, set},
        pdf_string,
    };
    let mut dicts = vec![vec![(
        b"Type".as_slice().into(),
        Value::Word(b"/Outlines".as_slice().into()),
    )]];
    let mut stack = vec![(0, 0, 0)];
    for (level, title, page) in outlines {
        stack.truncate(level);
        while stack.len() < level {
            let last = stack.last().ok_or(())?.1;
            if last == 0 {
                break;
            }
            stack.push((last, 0, 0));
        }
        let (parent, last, count) = stack.last_mut().ok_or(())?;
        let index = dicts.len();
        let reference = Value::Ref((root + index, 0));
        let null = Value::Word(b"null".as_slice().into());
        let mut dict = vec![
            (b"Title".as_slice().into(), pdf_string::encode(&title)),
            (b"Parent".into(), Value::Ref((root + *parent, 0))),
            (
                b"Dest".into(),
                Value::Array(vec![
                    Value::Ref(page),
                    Value::Word(b"/XYZ".as_slice().into()),
                    null.clone(),
                    null.clone(),
                    null,
                ]),
            ),
        ];
        if *last != 0 {
            set(&mut dicts[*last], b"Next", reference.clone());
            dict.push((b"Prev".into(), Value::Ref((root + *last, 0))));
        } else {
            set(&mut dicts[*parent], b"First", reference.clone());
        }
        set(&mut dicts[*parent], b"Last", reference);
        *count += 1;
        set(
            &mut dicts[*parent],
            b"Count",
            Value::Word(count.to_string().into_bytes().into()),
        );
        *last = index;
        dicts.push(dict);
    }
    for dict in dicts {
        let mut body = vec![];
        encode(&Value::Dict(dict), &mut body).map_err(|_| ())?;
        bodies.push(body);
    }
    Ok(())
}

pub(in crate::commands) fn image_pdf(
    pixels: &[[u8; 4]],
    w: usize,
    h: usize,
    page_w: f64,
    page_h: f64,
    limit: usize,
) -> Option<Vec<u8>> {
    fn stream(mut dict: String, raw: &[u8]) -> Vec<u8> {
        let data = zlib_compress(raw);
        dict.push_str(&format!(
            "/Filter /FlateDecode\n/Length {}\n>>\nstream\n",
            data.len()
        ));
        let mut b = dict.into_bytes();
        b.extend(data);
        b.extend_from_slice(b"\nendstream");
        b
    }
    let page_w = super::super::svg_format_num(page_w, 6);
    let page_h = super::super::svg_format_num(page_h, 6);
    let alpha = pixels.iter().any(|p| p[3] != 255);
    let image = if alpha { 7 } else { 6 };
    let mut bodies=vec![
        b"<<\n/Type /Catalog\n/Pages 2 0 R\n>>".to_vec(),
        b"<<\n/Type /Pages\n/Count 1\n/Kids [ 5 0 R ]\n>>".to_vec(),
        b"<<\n/Producer (@poe-code/pdf-ast)\n>>".to_vec(),
        stream("<<\n".into(),format!("q\n{page_w} 0 0 {page_h} 0 0 cm\n/Im1 Do\nQ").as_bytes()),
        format!("<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [ 0 0 {page_w} {page_h} ]\n/Resources <<\n/Font <<\n>>\n/XObject <<\n/Im1 {image} 0 R\n>>\n>>\n/Contents 4 0 R\n>>").into_bytes(),
    ];
    let dict = |color: &str| {
        format!(
            "<<\n/Type /XObject\n/Subtype /Image\n/Width {w}\n/Height {h}\n/ColorSpace /Device{color}\n/BitsPerComponent 8\n"
        )
    };
    if alpha {
        bodies.push(stream(
            dict("Gray"),
            &pixels.iter().map(|p| p[3]).collect::<Vec<_>>(),
        ));
    }
    let mut rgb = dict("RGB");
    if alpha {
        rgb.push_str("/SMask 6 0 R\n");
    }
    bodies.push(stream(
        rgb,
        &pixels
            .iter()
            .flat_map(|p| &p[..3])
            .copied()
            .collect::<Vec<_>>(),
    ));
    write_objects(&bodies, limit)
}

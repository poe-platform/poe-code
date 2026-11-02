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
    PageBreak,
    Heading(usize),
    ListItem {
        depth: usize,
        last: bool,
    },
    Table(Vec<TableRow>),
    Image {
        png: Vec<u8>,
        dimensions: [f64; 2],
    },
    Svg {
        height: f64,
        shapes: Vec<SvgShape>,
    },
    Code,
    Quote,
    Rule,
}

fn default(n: f64, fallback: f64) -> f64 {
    if n == 0. || n.is_nan() { fallback } else { n }
}

enum SvgShape {
    Rect([f64; 4]),
    Text([f64; 2], String),
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
    fn block_tag(tag: &str) -> bool {
        matches!(
            tag,
            "h1" | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "p"
                | "pre"
                | "ul"
                | "ol"
                | "dl"
                | "table"
                | "svg"
                | "hr"
                | "img"
                | "blockquote"
                | "div"
                | "section"
                | "article"
                | "li"
                | "dt"
                | "dd"
                | "tr"
        )
    }
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
                    tag if block_tag(tag) => {
                        text.push('\n');
                        block_text(&el.children, text);
                        text.push('\n');
                    }
                    _ => block_text(&el.children, text),
                },
            }
        }
    }
    fn attr(el: &crate::commands::structured::HtmlElement, name: &str) -> f64 {
        el.attrs
            .iter()
            .find(|(k, _)| k == name)
            .map_or(0., |(_, v)| super::super::js_number(v, 0.))
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
            let mut after = false;
            if block_tag(&el.tag) {
                flush(current, blocks);
                let mut before = false;
                let mut class_break = false;
                for (name, value) in &el.attrs {
                    if name == "class" {
                        class_break = value.split_whitespace().any(|c| c == "page-break");
                    }
                    if name != "style" {
                        continue;
                    }
                    for decl in value.split(';') {
                        let Some((k, v)) = decl.split_once(':') else {
                            continue;
                        };
                        if k.trim().eq_ignore_ascii_case("page-break-before") {
                            before = v.trim().eq_ignore_ascii_case("always");
                        }
                        if k.trim().eq_ignore_ascii_case("page-break-after") {
                            after = v.trim().eq_ignore_ascii_case("always");
                        }
                    }
                }
                if before || class_break {
                    blocks.push(Block {
                        kind: BlockKind::PageBreak,
                        ..Block::default()
                    });
                }
            }
            match el.tag.as_str() {
                "head" | "title" | "script" | "style" | "template" => {}
                "br" => current.text.push('\n'),
                "hr" => {
                    blocks.push(Block {
                        kind: BlockKind::Rule,
                        ..Block::default()
                    });
                }
                "pre" | "blockquote" => {
                    current.kind = if el.tag == "pre" {
                        BlockKind::Code
                    } else {
                        BlockKind::Quote
                    };
                    block_text(&el.children, &mut current.text);
                    flush(current, blocks);
                }
                "ul" | "ol" => {
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
                "svg" => {
                    let height = default(attr(el, "height"), 100.);
                    let mut shapes = Vec::new();
                    let mut pending: Vec<_> = el.children.iter().rev().collect();
                    while let Some(node) = pending.pop() {
                        let HtmlNode::Element(child) = node else {
                            continue;
                        };
                        match child.tag.as_str() {
                            "rect" => shapes.push(SvgShape::Rect([
                                attr(child, "x"),
                                attr(child, "y"),
                                default(attr(child, "width"), 40.),
                                default(attr(child, "height"), 20.),
                            ])),
                            "text" => {
                                let mut text = String::new();
                                block_text(&child.children, &mut text);
                                if !text.trim().is_empty() {
                                    shapes.push(SvgShape::Text(
                                        [
                                            default(attr(child, "x"), 8.),
                                            default(attr(child, "y"), 16.),
                                        ],
                                        text.trim().to_owned(),
                                    ));
                                }
                            }
                            _ => {}
                        }
                        pending.extend(child.children.iter().rev());
                    }
                    blocks.push(Block {
                        kind: BlockKind::Svg { height, shapes },
                        ..Block::default()
                    });
                }
                "img" => {
                    if let Some(src) = el
                        .attrs
                        .iter()
                        .find(|(k, _)| k == "src")
                        .and_then(|(_, v)| v.strip_prefix("data:image/png;base64,"))
                        && let Ok(png) = crate::commands::archive::base64_decode(src)
                        && png.starts_with(b"\x89PNG\r\n\x1a\n")
                    {
                        blocks.push(Block {
                            kind: BlockKind::Image {
                                png,
                                dimensions: [attr(el, "width"), attr(el, "height")],
                            },
                            ..Block::default()
                        });
                    }
                }
                "p" | "div" | "section" | "article" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
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
                _ => {
                    visit(&el.children, depth, current, blocks)?;
                    if block_tag(&el.tag) {
                        flush(current, blocks);
                    }
                }
            }
            if after {
                blocks.push(Block {
                    kind: BlockKind::PageBreak,
                    ..Block::default()
                });
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
    Image(PdfBitmap),
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

const OUTPUT_LIMIT: &str = "wkhtmltopdf: PDF output exceeds resource limits\n";

fn draw_rect(
    stream: &mut Vec<u8>,
    [x, y, w, h]: [f64; 4],
    fill: Option<&str>,
    border: &str,
    stroke_width: f64,
    limit: usize,
) -> Result<(), &'static str> {
    if !stream.is_empty() {
        stream.push(b'\n');
    }
    stream.extend_from_slice(b"q\n");
    if let Some(fill) = fill {
        writeln!(stream, "{fill} rg").unwrap();
    }
    let paint = if fill.is_some() { "B" } else { "S" };
    write!(
        stream,
        "{border} RG\n{stroke_width} w\n{} {} {} {} re\n{paint}\nQ",
        coordinate(x),
        coordinate(y),
        coordinate(w),
        coordinate(h)
    )
    .unwrap();
    (stream.len() <= limit).then_some(()).ok_or(OUTPUT_LIMIT)
}

fn draw_text(
    stream: &mut Vec<u8>,
    text: &str,
    [x, y]: [f64; 2],
    font: usize,
    size: f64,
    color: &str,
    limit: usize,
) -> Result<(), &'static str> {
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
    (stream.len() <= limit).then_some(()).ok_or(OUTPUT_LIMIT)
}

pub(in super::super) fn render_html(
    doc: &PdfDoc,
    [top, right, bottom, left]: [f64; 4],
    copies: usize,
    collate: bool,
    grayscale: bool,
    sources: &[super::super::wkhtmltopdf::Source],
    page_offset: i32,
) -> Result<Option<Vec<u8>>, &'static str> {
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
    let mut remaining_resources = limit;
    let mut sheets = Vec::new();
    let mut logical_page = 1 + i64::from(page_offset);
    for (page, source) in doc.pages.iter().zip(sources) {
        let Some(blocks) = html_blocks(&page.html) else {
            return Ok(None);
        };
        let [header, footer] = &source.furniture;
        let header_font = usize::from(header.has_text());
        let page_top = height - top - if header.has_text() { 24. } else { 0. };
        let page_bottom = bottom + if footer.has_text() { 24. } else { 0. };
        let mut stream = Vec::new();
        let mut y = page_top;
        let mut objects = Vec::new();
        let mut fonts = Vec::new();
        if header.has_text() {
            page_font("Helvetica", &mut fonts, &mut objects);
        }
        let mut occupied = false;
        let mut flushed = false;
        let mut image_count = 0;
        let outline_depth = source.outline_depth;
        let external_links = source.links;
        let mut finish_page = |stream: &mut Vec<u8>,
                               objects: &mut Vec<PageResource>,
                               headings: &mut Vec<(usize, String)>|
         -> Result<(), &'static str> {
            let compressed = zlib_compress(stream);
            if footer.has_text()
                && !objects
                    .iter()
                    .any(|r| matches!(r, PageResource::Font("Helvetica")))
            {
                objects.push(PageResource::Font("Helvetica"));
            }
            let sheet_bytes = objects
                .iter()
                .try_fold(compressed.len() + 208, |size, resource| {
                    size.checked_add(match resource {
                        PageResource::Font(_) => 80,
                        PageResource::Link(bytes) => bytes.len(),
                        PageResource::Image(image) => image.rgb.len() + image.mask.len() + 128,
                    })
                })
                .ok_or(OUTPUT_LIMIT)?;
            remaining = remaining
                .checked_sub(sheet_bytes.checked_mul(copies).ok_or(OUTPUT_LIMIT)?)
                .ok_or(OUTPUT_LIMIT)?;
            sheets.push((
                compressed,
                std::mem::take(objects),
                std::mem::take(headings),
                source,
                logical_page,
            ));
            if !source.uncounted {
                logical_page += 1;
            }
            if header.has_text() {
                objects.push(PageResource::Font("Helvetica"));
            }
            stream.clear();
            Ok(())
        };
        let mut headings = Vec::new();
        for Block {
            kind,
            text: block,
            links,
        } in blocks
        {
            let (size, pitch, family, offset, color, padding) = match kind {
                BlockKind::PageBreak => {
                    flushed = true;
                    finish_page(&mut stream, &mut objects, &mut headings)?;
                    fonts.truncate(header_font);
                    image_count = 0;
                    y = page_top;
                    occupied = false;
                    continue;
                }
                BlockKind::Image {
                    png,
                    dimensions: [w, h],
                } => {
                    let raster = match super::super::png_pixels::Raster::decode(&png, limit) {
                        Ok(raster) => raster,
                        Err("image exceeds memory budget") => return Err(OUTPUT_LIMIT),
                        Err(_) => continue,
                    };
                    let w = default(w, raster.width.min(240) as f64);
                    let h = default(h, raster.height.min(180) as f64);
                    if y - (h + 8.) < page_bottom && occupied {
                        finish_page(&mut stream, &mut objects, &mut headings)?;
                        fonts.truncate(header_font);
                        image_count = 0;
                        y = page_top;
                    }
                    if !w.is_finite() || !h.is_finite() || !(y - h).is_finite() {
                        return Err("shell: line 1: internal error\n");
                    }
                    let image = PdfBitmap::new(&raster.pixels, raster.width, raster.height);
                    remaining_resources = remaining_resources
                        .checked_sub(image.rgb.len() + image.mask.len())
                        .ok_or(OUTPUT_LIMIT)?;
                    objects.push(PageResource::Image(image));
                    image_count += 1;
                    occupied = true;
                    if !stream.is_empty() {
                        stream.push(b'\n');
                    }
                    write!(
                        stream,
                        "q\n{} 0 0 {} {x} {} cm\n/Im{image_count} Do\nQ",
                        coordinate(w),
                        coordinate(h),
                        coordinate(y - h)
                    )
                    .unwrap();
                    if stream.len() > limit {
                        return Err(OUTPUT_LIMIT);
                    }
                    y -= h + 8.;
                    continue;
                }
                BlockKind::Svg { height: h, shapes } => {
                    if y - (h + 8.) < page_bottom && occupied {
                        finish_page(&mut stream, &mut objects, &mut headings)?;
                        fonts.truncate(header_font);
                        image_count = 0;
                        y = page_top;
                    }
                    occupied = true;
                    let fill = rgb([0.92, 0.94, 0.98]);
                    let border = rgb([0.3, 0.4, 0.6]);
                    let ink = rgb([0.1, 0.12, 0.18]);
                    for shape in shapes {
                        match shape {
                            SvgShape::Rect([x, dy, w, rh]) => draw_rect(
                                &mut stream,
                                [left + x, y - dy - rh, w, rh],
                                Some(&fill),
                                &border,
                                0.8,
                                limit,
                            )?,
                            SvgShape::Text([x, dy], text) => {
                                let font = page_font("Helvetica", &mut fonts, &mut objects);
                                draw_text(
                                    &mut stream,
                                    &text,
                                    [left + x, y - dy],
                                    font,
                                    10.,
                                    &ink,
                                    limit,
                                )?;
                            }
                        }
                    }
                    y -= h + 8.;
                    continue;
                }
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
                        if y - row_height < page_bottom && occupied {
                            finish_page(&mut stream, &mut objects, &mut headings)?;
                            fonts.truncate(header_font);
                            image_count = 0;
                            occupied = false;
                            y = page_top;
                        }
                        let row_bottom = y - row_height;
                        let mut column = 0.;
                        for (span, lines) in row.cells {
                            if column >= columns {
                                break;
                            }
                            let span = span.min(columns - column);
                            let cell_x = left + column * col_width;
                            draw_rect(
                                &mut stream,
                                [cell_x, row_bottom, span * col_width, row_height],
                                row.header.then_some(fill.as_str()),
                                &border,
                                0.6,
                                limit,
                            )?;
                            occupied = true;
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
            if y - needed < page_bottom && occupied {
                finish_page(&mut stream, &mut objects, &mut headings)?;
                fonts.truncate(header_font);
                image_count = 0;
                y = page_top;
            }
            occupied = true;
            if matches!(kind, BlockKind::Quote | BlockKind::Rule) && !stream.is_empty() {
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
                    draw_rect(
                        &mut stream,
                        [left, y - h, content_width, h],
                        Some(&rgb([0.95, 0.96, 0.97])),
                        &rgb([0.82, 0.84, 0.87]),
                        0.5,
                        limit,
                    )?;
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
                        return Err(OUTPUT_LIMIT);
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
                        .map_err(|_| OUTPUT_LIMIT)?;
                    body.extend_from_slice(b"\n>>\n>>");
                    remaining_resources = remaining_resources
                        .checked_sub(body.len())
                        .ok_or(OUTPUT_LIMIT)?;
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
        if occupied || !flushed {
            finish_page(&mut stream, &mut objects, &mut headings)?;
        }
    }
    let total = logical_page - 1;
    let mut finished = Vec::with_capacity(sheets.len());
    for (compressed, objects, headings, source, number) in sheets {
        let [header, footer] = &source.furniture;
        let compressed = if header.has_text() || footer.has_text() || header.line || footer.line {
            // Page totals are known only after all inputs have been laid out. Keep
            // completed sheets compressed and decorate each once, before copies.
            let (content, _) =
                crate::commands::codecs::inflate_raw_bounded(&compressed[2..], limit)
                    .map_err(|_| OUTPUT_LIMIT)?;
            let font = objects
                .iter()
                .filter_map(|r| {
                    if let PageResource::Font(f) = r {
                        Some(*f)
                    } else {
                        None
                    }
                })
                .position(|f| f == "Helvetica")
                .map_or(0, |i| i + 1);
            let mut stream = Vec::new();
            for (i, item) in source.furniture.iter().enumerate() {
                if i == 1 && !content.is_empty() {
                    if !stream.is_empty() {
                        stream.push(b'\n');
                    }
                    stream.extend_from_slice(&content);
                }
                let y = if i == 0 {
                    height - (top * 0.6).max(18.)
                } else {
                    (bottom * 0.5).max(12.)
                };
                for (slot, template) in item.text.iter().enumerate() {
                    if template.is_empty() {
                        continue;
                    }
                    let text = source.substitute(template, number, total);
                    let n = text.encode_utf16().count() as f64;
                    let x = match slot {
                        1 => left.max((width - n * 4.5) / 2.),
                        2 => left.max(width - right - n * 4.8),
                        _ => left,
                    };
                    draw_text(
                        &mut stream,
                        &text,
                        [x, y],
                        font,
                        f64::from(item.size.unwrap_or(10).min(10)),
                        &rgb([0.35, 0.35, 0.38]),
                        limit,
                    )?;
                }
                if item.line {
                    if !stream.is_empty() {
                        stream.push(b'\n');
                    }
                    let line_y = coordinate(y + if i == 0 { -4. } else { 11. });
                    write!(
                        stream,
                        "q\n{} RG\n0.5 w\n{x} {line_y} m\n{} {line_y} l\nS\nQ",
                        rgb([0.7, 0.7, 0.74]),
                        coordinate(width - right)
                    )
                    .unwrap();
                }
            }
            if stream.len() > limit {
                return Err(OUTPUT_LIMIT);
            }
            let decorated = zlib_compress(&stream);
            remaining = remaining
                .checked_sub(
                    decorated
                        .len()
                        .saturating_sub(compressed.len())
                        .checked_mul(copies)
                        .ok_or(OUTPUT_LIMIT)?,
                )
                .ok_or(OUTPUT_LIMIT)?;
            decorated
        } else {
            compressed
        };
        finished.push((flate_stream("<<\n", &compressed), objects, headings));
    }
    for i in 0..finished.len().checked_mul(copies).ok_or(OUTPUT_LIMIT)? {
        let (sheet, first_copy) = if collate {
            (i % finished.len(), i < finished.len())
        } else {
            (i / copies, i % copies == 0)
        };
        let (body, objects, headings) = &finished[sheet];
        let content = bodies.len() + 1;
        let page = content + 1;
        bodies.push(body.clone());
        bodies.push(Vec::new());
        let mut resources = String::from("<<\n/Font <<");
        let mut images = String::new();
        let mut annots = String::new();
        let mut fonts = 0;
        let mut image_count = 0;
        for obj in objects {
            let id = bodies.len() + 1;
            match obj {
                PageResource::Font(font) => {
                    fonts += 1;
                    write!(resources, "\n/F{fonts} {id} 0 R").unwrap();
                    bodies.push(format!("<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /{font}\n/Encoding /WinAnsiEncoding\n>>").into_bytes());
                }
                PageResource::Link(body) => {
                    write!(annots, "{id} 0 R ").unwrap();
                    bodies.push(body.clone());
                }
                PageResource::Image(image) => {
                    image_count += 1;
                    image.write(&mut bodies);
                    write!(images, "\n/Im{image_count} {} 0 R", bodies.len()).unwrap();
                }
            }
        }
        resources.push_str("\n>>");
        if !images.is_empty() {
            write!(resources, "\n/XObject <<{images}\n>>").unwrap();
        }
        resources.push_str("\n>>");
        let annots = if annots.is_empty() {
            annots
        } else {
            format!("\n/Annots [ {annots}]")
        };
        bodies[page-1] = format!("<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [ 0 0 {media_width} {media_height} ]\n/Resources {resources}\n/Contents {content} 0 R{annots}\n>>").into_bytes();
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
        write_outlines(root, &mut bodies, outlines).map_err(|_| OUTPUT_LIMIT)?;
        bodies[0] =
            format!("<<\n/Type /Catalog\n/Pages 2 0 R\n/Outlines {root} 0 R\n>>").into_bytes();
    }
    write_objects(&bodies, limit).map(Some).ok_or(OUTPUT_LIMIT)
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

fn flate_stream(dict: &str, data: &[u8]) -> Vec<u8> {
    let mut body = format!(
        "{dict}/Filter /FlateDecode\n/Length {}\n>>\nstream\n",
        data.len()
    )
    .into_bytes();
    body.extend_from_slice(data);
    body.extend_from_slice(b"\nendstream");
    body
}

struct PdfBitmap {
    w: usize,
    h: usize,
    rgb: Vec<u8>,
    mask: Vec<u8>,
}

impl PdfBitmap {
    fn new(pixels: &[[u8; 4]], w: usize, h: usize) -> Self {
        let mask = if pixels.iter().any(|p| p[3] != 255) {
            zlib_compress(&pixels.iter().map(|p| p[3]).collect::<Vec<_>>())
        } else {
            Vec::new()
        };
        Self {
            w,
            h,
            mask,
            rgb: zlib_compress(
                &pixels
                    .iter()
                    .flat_map(|p| &p[..3])
                    .copied()
                    .collect::<Vec<_>>(),
            ),
        }
    }
    fn write(&self, bodies: &mut Vec<Vec<u8>>) {
        let dict = |color| {
            format!(
                "<<\n/Type /XObject\n/Subtype /Image\n/Width {}\n/Height {}\n/ColorSpace /Device{color}\n/BitsPerComponent 8\n",
                self.w, self.h
            )
        };
        let mut rgb = dict("RGB");
        if !self.mask.is_empty() {
            bodies.push(flate_stream(&dict("Gray"), &self.mask));
            writeln!(rgb, "/SMask {} 0 R", bodies.len()).unwrap();
        }
        bodies.push(flate_stream(&rgb, &self.rgb));
    }
}

pub(in crate::commands) fn image_pdf(
    pixels: &[[u8; 4]],
    w: usize,
    h: usize,
    page_w: f64,
    page_h: f64,
    limit: usize,
) -> Option<Vec<u8>> {
    let page_w = super::super::svg_format_num(page_w, 6);
    let page_h = super::super::svg_format_num(page_h, 6);
    let bitmap = PdfBitmap::new(pixels, w, h);
    let image = if bitmap.mask.is_empty() { 6 } else { 7 };
    let mut bodies=vec![
        b"<<\n/Type /Catalog\n/Pages 2 0 R\n>>".to_vec(),
        b"<<\n/Type /Pages\n/Count 1\n/Kids [ 5 0 R ]\n>>".to_vec(),
        b"<<\n/Producer (@poe-code/pdf-ast)\n>>".to_vec(),
        flate_stream("<<\n",&zlib_compress(format!("q\n{page_w} 0 0 {page_h} 0 0 cm\n/Im1 Do\nQ").as_bytes())),
        format!("<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [ 0 0 {page_w} {page_h} ]\n/Resources <<\n/Font <<\n>>\n/XObject <<\n/Im1 {image} 0 R\n>>\n>>\n/Contents 4 0 R\n>>").into_bytes(),
    ];
    bitmap.write(&mut bodies);
    write_objects(&bodies, limit)
}

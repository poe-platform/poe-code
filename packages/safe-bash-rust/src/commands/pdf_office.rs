// Writer and Calc text and table layout for Office PDF export.
use super::super::office::Block;
use super::{
    PageOutput, PageSource,
    pdf_copy::{literal, write_objects},
    pdf_render::win_ansi,
};
use crate::commands::{
    codecs::zlib_compress,
    structured::{JVal, parse_json_stream},
};
use std::io::Write;

#[derive(Default)]
struct Page {
    stream: Vec<u8>,
    fonts: Vec<&'static str>,
    images: Vec<(super::super::png_pixels::Raster, f64, f64, f64)>,
}
impl Page {
    fn text(&mut self, runs: &[(&str, &'static str)], x: f64, y: f64, size: u8, rgb: &str) {
        writeln!(self.stream, "q\n{rgb} rg\nBT").unwrap();
        let mut first = true;
        let mut runs = runs.iter().peekable();
        while let Some(&(text, name)) = runs.next() {
            let mut text = text.to_owned();
            while let Some(&&(next, font)) = runs.peek() {
                if font != name {
                    break;
                }
                text.push_str(next);
                runs.next();
            }
            let font = self
                .fonts
                .iter()
                .position(|&font| font == name)
                .unwrap_or_else(|| {
                    self.fonts.push(name);
                    self.fonts.len() - 1
                })
                + 1;
            writeln!(self.stream, "/F{font} {size} Tf").unwrap();
            if first {
                writeln!(
                    self.stream,
                    "1 0 0 1 {} {y} Tm",
                    super::super::svg_format_num(x, 6)
                )
                .unwrap();
                first = false;
            }
            let bytes: Vec<_> = win_ansi(&text).into_iter().map(|b| if b < 32 { b'?' } else { b }).collect();
            literal(&bytes, &mut self.stream);
            self.stream.extend_from_slice(b" Tj\n");
        }
        self.stream.extend_from_slice(b"ET\nQ\n");
    }
}
pub(in super::super) fn render_office(
    blocks: Vec<Block>,
    title: &str,
    filter: Option<&str>,
    limit: usize,
) -> Option<Vec<u8>> {
    render_blocks(
        blocks
            .into_iter()
            .map(|block| match block {
                Block::Text(text, heading) => LayoutBlock::Text(text, heading, Vec::new()),
                Block::Table(rows) => LayoutBlock::Table(rows),
                Block::Preformatted(text) => LayoutBlock::Preformatted(text),
            })
            .collect(),
        title,
        filter,
        limit,
        (612., 792.),
    )
}

pub(super) struct TextStyle {
    pub start: usize,
    pub end: usize,
    pub bold: bool,
    pub italic: bool,
}
pub(super) enum LayoutBlock {
    Preformatted(String),
    Text(String, bool, Vec<TextStyle>),
    Table(Vec<Vec<String>>),
    Image(super::super::png_pixels::Raster, f64, f64),
    PageBreak(bool),
}
pub(super) fn render_blocks(
    blocks: Vec<LayoutBlock>,
    title: &str,
    filter: Option<&str>,
    limit: usize,
    (width, height): (f64, f64),
) -> Option<Vec<u8>> {
    let content_width = (width - 108.).max(1.);
    let mut pages = vec![Page::default()];
    let mut y = height - 72.;
    let mut finished = 0usize;
    let space = |pages: &mut Vec<Page>, y: &mut f64, finished: &mut usize, needed| -> Option<()> {
        if *y - needed < 54. {
            *finished = finished.checked_add(pages.last()?.stream.len())?;
            pages.push(Page::default());
            *y = height - 72.;
        }
        (*finished + pages.last()?.stream.len() <= limit).then_some(())
    };
    for block in blocks {
        match block {
            LayoutBlock::Text(t, heading, styles) => {
                let mut style_index = 0;
                let max = (content_width * if heading { 48. / 504. } else { 84. / 504. })
                    .floor()
                    .max(1.) as usize;
                for segment in t.split('\n') {
                    let mut words = segment.split_whitespace().peekable();
                    loop {
                        let first = words.next().unwrap_or("");
                        let mut line = vec![first];
                        let mut length = first.encode_utf16().count();
                        while let Some(&w) = words.peek() {
                            let n = w.encode_utf16().count();
                            if length + 1 + n > max {
                                break;
                            }
                            line.push(w);
                            length += 1 + n;
                            words.next();
                        }
                        space(
                            &mut pages,
                            &mut y,
                            &mut finished,
                            if heading { 26. } else { 16. },
                        )?;
                        let mut runs = Vec::new();
                        let mut font = if heading {
                            "Helvetica-Bold"
                        } else {
                            "Helvetica"
                        };
                        for (index, word) in line.iter().enumerate() {
                            if index > 0 {
                                runs.push((" ", font));
                            }
                            if word.is_empty() {
                                runs.push(("", font));
                                continue;
                            }
                            let mut offset = word.as_ptr() as usize - t.as_ptr() as usize;
                            let limit = offset + word.len();
                            while offset < limit {
                                while styles
                                    .get(style_index)
                                    .is_some_and(|style| style.end <= offset)
                                {
                                    style_index += 1;
                                }
                                let style = styles.get(style_index);
                                let active = style.filter(|style| style.start <= offset);
                                let end = limit.min(active.map_or_else(
                                    || style.map_or(limit, |style| style.start),
                                    |style| style.end,
                                ));
                                font = match (
                                    heading || active.is_some_and(|style| style.bold),
                                    active.is_some_and(|style| style.italic),
                                ) {
                                    (true, true) => "Helvetica-BoldOblique",
                                    (true, false) => "Helvetica-Bold",
                                    (false, true) => "Helvetica-Oblique",
                                    (false, false) => "Helvetica",
                                };
                                runs.push((&t[offset..end], font));
                                offset = end;
                            }
                        }
                        pages.last_mut()?.text(
                            &runs,
                            54.,
                            y,
                            if heading { 18 } else { 11 },
                            if heading {
                                "0.1 0.15 0.28"
                            } else {
                                "0.15 0.15 0.15"
                            },
                        );
                        y -= if heading { 24. } else { 15. };
                        if words.peek().is_none() {
                            break;
                        }
                    }
                }
                y -= if heading { 4. } else { 5. };
            }
            LayoutBlock::Preformatted(text) => {
                for line in text.split('\n') {
                    space(&mut pages, &mut y, &mut finished, 16.)?;
                    pages.last_mut()?.text(&[(line, "Courier")], 54., y, 11, "0.15 0.15 0.15");
                    y -= 15.;
                }
                y -= 5.;
            }
            LayoutBlock::Table(rows) => {
                let width =
                    content_width / rows.iter().map(Vec::len).max().unwrap_or(1).max(1) as f64;
                for (i, row) in rows.into_iter().enumerate() {
                    space(&mut pages, &mut y, &mut finished, 28.)?;
                    let page = pages.last_mut()?;
                    let bottom = y - 22.;
                    let stroke = "0.7 0.72 0.75 RG\n0.5 w";
                    if i == 0 {
                        writeln!(page.stream,"q\n0.92 0.94 0.97 rg\n0.5 0.55 0.62 RG\n0.75 w\n54 {bottom} {content_width} 22 re\nB\nQ").ok()?;
                    } else {
                        writeln!(
                            page.stream,
                            "q\n{stroke}\n54 {bottom} {content_width} 22 re\nS\nQ"
                        )
                        .ok()?;
                    }
                    for (j, c) in row.into_iter().enumerate() {
                        if page.stream.len() > limit {
                            return None;
                        }
                        let x = 54. + j as f64 * width;
                        if j > 0 {
                            let n = super::super::svg_format_num(x, 6);
                            writeln!(page.stream, "q\n{stroke}\n{n} {bottom} m\n{n} {y} l\nS\nQ")
                                .ok()?;
                        }
                        page.text(
                            &[(
                                &c,
                                if i == 0 {
                                    "Helvetica-Bold"
                                } else {
                                    "Helvetica"
                                },
                            )],
                            x + 6.,
                            bottom + 6.,
                            10,
                            "0 0 0",
                        );
                    }
                    y = bottom;
                }
                y -= 14.;
            }
            LayoutBlock::PageBreak(before) => {
                if !before || y != height - 72. {
                    finished = finished.checked_add(pages.last()?.stream.len())?;
                    if finished > limit {
                        return None;
                    }
                    pages.push(Page::default());
                    y = height - 72.;
                }
            }
            LayoutBlock::Image(image, width, height) => {
                space(&mut pages, &mut y, &mut finished, (height + 12.).ceil())?;
                pages.last_mut()?.images.push((image, width, height, y));
                y -= (height + 12.).ceil();
            }
        }
    }
    let mut info = b"<<\n/Producer (@poe-code/pdf-ast)\n/Title ".to_vec();
    let title = if title.is_ascii() {
        title.as_bytes().to_vec()
    } else {
        [0xfe, 0xff]
            .into_iter()
            .chain(title.encode_utf16().flat_map(u16::to_be_bytes))
            .collect()
    };
    literal(&title, &mut info);
    info.extend_from_slice(
        br"
/Creator (LibreOffice 24.8 \(@poe-code/pdf-ast\))
>>",
    );
    let mut bodies = vec![
        b"<<\n/Type /Catalog\n/Pages 2 0 R\n>>".to_vec(),
        vec![],
        info,
    ];
    let mut kids = Vec::new();
    for mut page in pages {
        let mut resources = String::new();
        for (index, (image, width, height, y)) in page.images.into_iter().enumerate() {
            super::pdf_render::PdfBitmap::new(&image.pixels, image.width, image.height)
                .write(&mut bodies);
            resources.push_str(&format!("/Im{index} {} 0 R ", bodies.len()));
            writeln!(
                page.stream,
                "q\n{width} 0 0 {height} 54 {} cm\n/Im{index} Do\nQ",
                y - height
            )
            .ok()?;
        }
        page.stream.pop();
        let stream = zlib_compress(&page.stream);
        let content = bodies.len() + 1;
        let id = content + 1;
        let mut body = format!(
            "<<\n/Filter /FlateDecode\n/Length {}\n>>\nstream\n",
            stream.len()
        )
        .into_bytes();
        body.extend(stream);
        body.extend_from_slice(b"\nendstream");
        bodies.push(body);
        kids.push(format!("{id} 0 R"));
        let fonts = page
            .fonts
            .iter()
            .enumerate()
            .map(|(i, _)| format!("/F{} {} 0 R\n", i + 1, id + i + 1))
            .collect::<String>();
        let resources = if resources.is_empty() {
            String::new()
        } else {
            format!("/XObject << {resources} >>\n")
        };
        bodies.push(format!("<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [ 0 0 {width} {height} ]\n/Resources <<\n/Font <<\n{fonts}>>\n{resources}>>\n/Contents {content} 0 R\n>>").into_bytes());
        for font in page.fonts {
            // Helvetica oblique variants share their upright advance widths.
            let widths = super::pdf_copy::WIDTHS[usize::from(font.contains("Bold"))][32..]
                .iter()
                .map(|width| if font == "Courier" { "600".to_owned() } else { width.to_string() })
                .collect::<Vec<_>>()
                .join(" ");
            bodies.push(format!("<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /{font}\n/Encoding /WinAnsiEncoding\n/FirstChar 32\n/LastChar 255\n/Widths [ {widths} ]\n>>").into_bytes());
        }
    }
    bodies[1] = format!(
        "<<\n/Type /Pages\n/Count {}\n/Kids [ {} ]\n>>",
        kids.len(),
        kids.join(" ")
    )
    .into_bytes();
    apply_filters(write_objects(&bodies, limit)?, filter, kids.len(), limit)
}

pub(super) fn apply_filters(
    mut pdf: Vec<u8>,
    filter: Option<&str>,
    count: usize,
    limit: usize,
) -> Option<Vec<u8>> {
    if let Some(filter) = filter
        && filter.trim_start().starts_with('{')
        && let Ok(values) = parse_json_stream(filter)
        && let [JVal::Object(opts)] = values.as_slice()
    {
        let option = |k: &str| {
            opts.iter()
                .rev()
                .find(|(key, _)| key == k)
                .map(|(_, v)| match v {
                    JVal::Object(obj) => obj
                        .iter()
                        .find(|(key, _)| key == "value")
                        .map_or(v, |(_, v)| v),
                    _ => v,
                })
        };
        if let Some(JVal::Str(r)) = option("PageRange") {
            let (a, b) = r.trim().split_once('-').unwrap_or((r.trim(), r.trim()));
            let a = a.trim().parse::<usize>().unwrap_or(1).max(1);
            let b = b
                .trim()
                .parse::<usize>()
                .ok()
                .filter(|n| *n > 0)
                .unwrap_or(a)
                .min(count);
            if a <= b && b - a + 1 < count {
                let mut src = PageSource::open(&pdf, "").ok()?;
                pdf = PageOutput::selected(&mut src, a - 1..b, limit)?;
            }
        }
        if let Some(JVal::Number(v, _)) = option("SelectPdfVersion") {
            let ver = match *v {
                15. => b"1.5",
                16. => b"1.6",
                20. => b"2.0",
                _ => b"1.7",
            };
            pdf[5..8].copy_from_slice(ver);
        }
    }
    Some(pdf)
}

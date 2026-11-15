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
    fonts: Vec<bool>,
    images: Vec<(super::super::png_pixels::Raster, f64, f64, f64)>,
}
impl Page {
    fn text(&mut self, s: &str, x: f64, y: f64, size: u8, bold: bool, rgb: &str) {
        let font = self
            .fonts
            .iter()
            .position(|&b| b == bold)
            .unwrap_or_else(|| {
                self.fonts.push(bold);
                self.fonts.len() - 1
            })
            + 1;
        writeln!(
            self.stream,
            "q\n{rgb} rg\nBT\n/F{font} {size} Tf\n1 0 0 1 {} {y} Tm",
            super::super::svg_format_num(x, 6)
        )
        .unwrap();
        literal(&win_ansi(s), &mut self.stream);
        self.stream.extend_from_slice(b" Tj\nET\nQ\n");
    }
}
pub(in super::super) fn render_office(
    blocks: Vec<Block>,
    title: &str,
    filter: Option<&str>,
    limit: usize,
) -> Option<Vec<u8>> {
    render_blocks(
        blocks.into_iter().map(LayoutBlock::Office).collect(),
        title,
        filter,
        limit,
        (612., 792.),
    )
}

pub(super) enum LayoutBlock {
    Office(Block),
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
            LayoutBlock::Office(Block::Text(t, bold)) => {
                let max = (content_width * if bold { 48. / 504. } else { 84. / 504. })
                    .floor()
                    .max(1.) as usize;
                for segment in t.split('\n') {
                    let mut words = segment.split_whitespace().peekable();
                    loop {
                        let mut line = words.next().unwrap_or("").to_string();
                        let mut length = line.encode_utf16().count();
                        while let Some(&w) = words.peek() {
                            let n = w.encode_utf16().count();
                            if length + 1 + n > max {
                                break;
                            }
                            line.push(' ');
                            line.push_str(w);
                            length += 1 + n;
                            words.next();
                        }
                        space(
                            &mut pages,
                            &mut y,
                            &mut finished,
                            if bold { 26. } else { 16. },
                        )?;
                        pages.last_mut()?.text(
                            &line,
                            54.,
                            y,
                            if bold { 18 } else { 11 },
                            bold,
                            if bold {
                                "0.1 0.15 0.28"
                            } else {
                                "0.15 0.15 0.15"
                            },
                        );
                        y -= if bold { 24. } else { 15. };
                        if words.peek().is_none() {
                            break;
                        }
                    }
                }
                y -= if bold { 4. } else { 5. };
            }
            LayoutBlock::Office(Block::Table(rows)) => {
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
                        page.text(&c, x + 6., bottom + 6., 10, i == 0, "0 0 0");
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
        for bold in page.fonts {
            let font = if bold { "Helvetica-Bold" } else { "Helvetica" };
            bodies.push(format!("<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /{font}\n/Encoding /WinAnsiEncoding\n>>").into_bytes());
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

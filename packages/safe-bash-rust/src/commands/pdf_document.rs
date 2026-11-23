// PDF output for the retained Office path (uncompressed streams and inline fonts).
use super::super::{
    office::{DocumentBlock as Block, space},
    png_pixels::Raster,
    svg_format_num,
};
use super::{pdf_copy::literal, pdf_render::win_ansi};
use crate::commands::structured::{JVal, parse_json_stream};
use std::collections::BTreeSet;
use std::io::Write;
#[path = "pdf_slides.rs"]
mod pdf_slides;
pub(in super::super) use pdf_slides::render_slides;

#[derive(Default)]
struct Page {
    stream: Vec<u8>,
    images: Vec<usize>,
}
struct Image {
    width: usize,
    height: usize,
    channels: usize,
    jpeg: bool,
    bytes: Vec<u8>,
    alpha: Vec<u8>,
}
impl Image {
    fn read(bytes: &[u8], limit: usize) -> Result<Option<Self>, ()> {
        if bytes.starts_with(b"\x89PNG") {
            let image = match Raster::decode(bytes, limit) {
                Ok(image) => image,
                Err("image exceeds memory budget") => return Err(()),
                Err(_) => return Ok(None),
            };
            let alpha = if image.pixels.iter().any(|p| p[3] != 255) {
                image.pixels.iter().map(|p| p[3]).collect()
            } else {
                Vec::new()
            };
            Ok(Some(Self {
                width: image.width,
                height: image.height,
                channels: 3,
                jpeg: false,
                bytes: image
                    .pixels
                    .iter()
                    .flat_map(|p| p[..3].iter().copied())
                    .collect(),
                alpha,
            }))
        } else if bytes.len() > 3 && bytes.starts_with(b"\xff\xd8") {
            let mut image = Self {
                width: 1,
                height: 1,
                channels: 3,
                jpeg: true,
                bytes: bytes.to_vec(),
                alpha: Vec::new(),
            };
            let mut pos = 2;
            while pos + 1 < bytes.len() {
                if bytes[pos] != 255 {
                    pos += 1;
                    continue;
                }
                while bytes.get(pos) == Some(&255) {
                    pos += 1;
                }
                let Some(&marker) = bytes.get(pos) else { break };
                pos += 1;
                if matches!(marker, 217 | 218) {
                    break;
                }
                if matches!(marker, 1 | 208..=216) {
                    continue;
                }
                let Some(length) = bytes.get(pos..pos + 2) else {
                    break;
                };
                let length = usize::from(u16::from_be_bytes(length.try_into().unwrap()));
                if length < 2 || pos + length > bytes.len() {
                    break;
                }
                if matches!(marker, 192..=194) && length >= 8 {
                    image.height =
                        usize::from(u16::from_be_bytes([bytes[pos + 3], bytes[pos + 4]])).max(1);
                    image.width =
                        usize::from(u16::from_be_bytes([bytes[pos + 5], bytes[pos + 6]])).max(1);
                    image.channels = usize::from(bytes[pos + 7]);
                    break;
                }
                pos += length;
            }
            Ok(Some(image))
        } else {
            Ok(None)
        }
    }
}
struct Pdf {
    pages: Vec<Page>,
    images: Vec<Image>,
    unicode: BTreeSet<char>,
    mappings: Vec<u8>,
    y: f64,
    page_height: f64,
    explicit_widths: bool,
    retained: usize,
    limit: usize,
}
impl Pdf {
    fn space(&mut self, height: f64) -> Option<()> {
        if self.y - height < 54. {
            self.retained = self
                .retained
                .checked_add(self.pages.last_mut().unwrap().stream.len())?;
            self.pages.push(Page::default());
            self.y = self.page_height - 72.;
        }
        (self.retained + self.pages.last_mut().unwrap().stream.len() <= self.limit).then_some(())
    }
    fn text(&mut self, value: &str, bold: bool, size: u8, italic: bool) {
        // The retained source decodes fixed 16 KiB byte chunks. A partial UTF-8
        // scalar carries into the next chunk; each decoded chunk is a PDF run.
        let mut start = 0;
        for boundary in (16384..value.len() + 16384).step_by(16384) {
            let mut end = boundary.min(value.len());
            while !value.is_char_boundary(end) {
                end -= 1;
            }
            self.text_chunk(&value[start..end], bold, size, italic);
            start = end;
        }
    }
    fn text_chunk(&mut self, value: &str, bold: bool, size: u8, italic: bool) {
        let font = match (bold, italic) {
            (false, false) => "Body",
            (true, false) => "Heading",
            (false, true) => "Italic",
            (true, true) => "BoldItalic",
        };
        writeln!(self.pages.last_mut().unwrap().stream, "/{font} {size} Tf").unwrap();
        let mut runs: Vec<(bool, Vec<u8>)> = Vec::new();
        for c in value.chars() {
            let mut encoded = win_ansi(&c.to_string())[0];
            if c < ' ' {
                encoded = b'?';
            }
            let unicode = c >= '\u{a0}' && encoded == b'?';
            if runs.last().is_none_or(|(u, _)| *u != unicode) {
                runs.push((unicode, Vec::new()));
            }
            if unicode {
                let mut units = [0; 2];
                let units = c.encode_utf16(&mut units);
                runs.last_mut()
                    .unwrap()
                    .1
                    .extend(units.iter().flat_map(|u| u.to_be_bytes()));
                if self.unicode.insert(c) {
                    let hex: String = units.iter().map(|u| format!("{u:04x}")).collect();
                    writeln!(self.mappings, "1 beginbfchar\n<{hex}> <{hex}>\nendbfchar").unwrap();
                }
            } else {
                runs.last_mut().unwrap().1.push(encoded);
            }
        }
        for (unicode, bytes) in runs {
            if unicode {
                writeln!(self.pages.last_mut().unwrap().stream, "/Unicode {size} Tf").unwrap();
            }
            literal(&bytes, &mut self.pages.last_mut().unwrap().stream);
            self.pages
                .last_mut()
                .unwrap()
                .stream
                .extend_from_slice(b" Tj\n");
            if unicode {
                writeln!(self.pages.last_mut().unwrap().stream, "/{font} {size} Tf").unwrap();
            }
        }
    }
    fn save(
        self,
        title: Option<&str>,
        filter: Option<&str>,
        dimensions: [f64; 2],
        creator: &str,
    ) -> Option<Vec<u8>> {
        let mut first = 0;
        let mut count = self.pages.len();
        let mut version = "1.7";
        if let Some(filter) = filter
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
            let mut valid = true;
            if let Some(JVal::Str(range)) = option("PageRange")
                && !range.trim().is_empty()
            {
                let mut parts = range.trim().split('-');
                let a = parts.next().unwrap();
                let b = parts.next().unwrap_or(a);
                let a = a
                    .trim()
                    .parse::<f64>()
                    .ok()
                    .filter(|v| *v != 0. && !v.is_nan())
                    .unwrap_or(1.)
                    .max(1.);
                let b = b
                    .trim()
                    .parse::<f64>()
                    .ok()
                    .filter(|v| *v != 0. && !v.is_nan())
                    .unwrap_or(a)
                    .min(count as f64);
                let n = if b >= a { (b - a).floor() + 1. } else { 0. };
                if n > 0. && n < count as f64 {
                    if a.fract() == 0. {
                        first = a as usize - 1;
                        count = n as usize;
                    } else {
                        valid = false;
                    }
                }
            }
            if valid && let Some(JVal::Number(n, _)) = option("SelectPdfVersion") {
                version = match *n {
                    15.0 => "1.5",
                    16.0 => "1.6",
                    20.0 => "2.0",
                    _ => "1.7",
                };
            }
        }
        let italic = 6 + count * 2 + self.images.len() * 2;
        let unicode = italic + 2;
        let mut bodies: Vec<Option<Vec<u8>>> =
            vec![None; italic + 1 + if self.unicode.is_empty() { 0 } else { 4 }];
        bodies[0] = Some(b"<<\n/Type /Catalog\n/Pages 2 0 R\n>>".to_vec());
        bodies[1] = Some(
            format!(
                "<< /Type /Pages /Count {count} /Kids [{}] >>",
                (0..count)
                    .map(|i| format!("{} 0 R ", 6 + i * 2))
                    .collect::<String>()
            )
            .into_bytes(),
        );
        let mut info = b"<<\n/Producer (@poe-code/pdf-ast)".to_vec();
        if count == self.pages.len() {
            if let Some(title) = title {
                info.extend_from_slice(b"\n/Title ");
                // PDF metadata strings use UTF-16BE with a signature outside ASCII.
                let title = if title.is_ascii() {
                    title.as_bytes().to_vec()
                } else {
                    [0xfe, 0xff]
                        .into_iter()
                        .chain(title.encode_utf16().flat_map(u16::to_be_bytes))
                        .collect()
                };
                literal(&title, &mut info);
            }
            info.extend_from_slice(b"\n/Creator ");
            literal(creator.as_bytes(), &mut info);
        }
        info.extend_from_slice(b"\n>>");
        bodies[2] = Some(info);
        for (number, name) in [
            (4, "Helvetica"),
            (5, "Helvetica-Bold"),
            (italic, "Helvetica-Oblique"),
            (italic + 1, "Helvetica-BoldOblique"),
        ] {
            let widths = super::pdf_copy::WIDTHS[usize::from(name.contains("Bold"))][32..]
                .iter().map(|n| n.to_string()).collect::<Vec<_>>().join(" ");
            let widths = if self.explicit_widths {
                format!("/FirstChar 32\n/LastChar 255\n/Widths [ {widths} ]\n")
            } else { String::new() };
            bodies[number-1]=Some(format!("<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /{name}\n/Encoding /WinAnsiEncoding\n{widths}>>").into_bytes());
        }
        let [width, height] = dimensions;
        for (i, page) in self.pages.into_iter().skip(first).take(count).enumerate() {
            let unicode_ref = if self.unicode.is_empty() {
                String::new()
            } else {
                format!("/Unicode {unicode} 0 R ")
            };
            let images = page
                .images
                .iter()
                .map(|image| format!("/Image{image} {} 0 R ", 6 + count * 2 + image * 2))
                .collect::<String>();
            bodies[5+i*2]=Some(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Resources << /Font << /Body 4 0 R /Heading 5 0 R /Italic {italic} 0 R /BoldItalic {} 0 R {unicode_ref}>> /XObject << {images}>> >> /Contents {} 0 R >>",italic+1,7+i*2).into_bytes());
            bodies[6 + i * 2] = Some(stream("", &page.stream));
        }
        for (i, image) in self.images.into_iter().enumerate() {
            let number = 6 + count * 2 + i * 2;
            let common = format!(
                "/Type /XObject\n/Subtype /Image\n/Width {}\n/Height {}\n/BitsPerComponent 8\n",
                image.width, image.height
            );
            let color = match image.channels {
                1 => "DeviceGray",
                4 => "DeviceCMYK",
                _ => "DeviceRGB",
            };
            let filter = if image.jpeg {
                "/Filter /DCTDecode\n"
            } else {
                ""
            };
            let mask = if image.alpha.is_empty() {
                String::new()
            } else {
                format!("/SMask {} 0 R\n", number + 1)
            };
            bodies[number - 1] = Some(stream(
                &format!("{common}/ColorSpace /{color}\n{filter}{mask}"),
                &image.bytes,
            ));
            if !image.alpha.is_empty() {
                bodies[number] = Some(stream(
                    &(common + "/ColorSpace /DeviceGray\n"),
                    &image.alpha,
                ));
            }
        }
        if !self.unicode.is_empty() {
            bodies[unicode-1]=Some(format!("<<\n/Type /Font\n/Subtype /Type0\n/BaseFont /HeiseiMin-W3\n/Encoding /UniJIS-UTF16-H\n/DescendantFonts [ {} 0 R ]\n/ToUnicode {} 0 R\n>>",unicode+1,unicode+3).into_bytes());
            bodies[unicode]=Some(format!("<<\n/Type /Font\n/Subtype /CIDFontType0\n/BaseFont /HeiseiMin-W3\n/CIDSystemInfo <<\n/Registry (Adobe)\n/Ordering (Japan1)\n/Supplement 6\n>>\n/FontDescriptor {} 0 R\n/DW 1000\n>>",unicode+2).into_bytes());
            bodies[unicode+1]=Some(b"<<\n/Type /FontDescriptor\n/FontName /HeiseiMin-W3\n/Flags 6\n/FontBBox [ -123 -257 1001 910 ]\n/ItalicAngle 0\n/Ascent 880\n/Descent -120\n/CapHeight 880\n/StemV 80\n>>".to_vec());
            let mut map = b"/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Unicode def\n/CMapType 2 def\n3 begincodespacerange\n<0000> <D7FF>\n<E000> <FFFF>\n<D800DC00> <DBFFDFFF>\nendcodespacerange\n".to_vec();
            map.extend_from_slice(&self.mappings);
            map.extend_from_slice(
                b"endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n",
            );
            bodies[unicode + 2] = Some(stream("", &map));
        }
        // Opaque images still reserve their mask object number. Emit free xref
        // entries for those gaps, as the retained serializer does.
        let mut out = format!("%PDF-{version}\n%\u{81}\u{81}\u{81}\u{81}\n\n").into_bytes();
        let mut xref = format!("xref\n0 {}\n0000000000 65535 f \n", bodies.len() + 1).into_bytes();
        for (i, body) in bodies.iter().enumerate() {
            let Some(body) = body else {
                xref.extend_from_slice(b"0000000000 65535 f \n");
                continue;
            };
            if body.len() > self.limit.checked_sub(out.len() + xref.len() + 32)? {
                return None;
            }
            writeln!(xref, "{:010} 00000 n ", out.len()).ok()?;
            writeln!(out, "{} 0 obj", i + 1).ok()?;
            out.extend_from_slice(body);
            out.extend_from_slice(b"\nendobj\n\n");
        }
        let offset = out.len();
        out.extend_from_slice(&xref);
        write!(
            out,
            "trailer\n<<\n/Size {}\n/Root 1 0 R\n/Info 3 0 R\n>>\n\nstartxref\n{offset}\n%%EOF",
            bodies.len() + 1
        )
        .ok()?;
        (out.len() <= self.limit).then_some(out)
    }
}
fn stream(dict: &str, bytes: &[u8]) -> Vec<u8> {
    let mut out = format!("<<\n{dict}/Length {}\n>>\nstream\n", bytes.len()).into_bytes();
    out.extend_from_slice(bytes);
    out.extend_from_slice(b"\nendstream");
    out
}
pub(in super::super) fn render_layout(
    layout: Vec<super::pdf_office::LayoutBlock>, title: &str, filter: Option<&str>,
    limit: usize, (width, height): (f64, f64),
) -> Option<Vec<u8>> {
    use super::pdf_office::LayoutBlock;
    use super::super::office::{DocumentText, TextStyle};
    let text = |value| DocumentText { value, html: String::new(), styles: Vec::new() };
    let mut blocks = vec![Block::PageSize([width, height])];
    for block in layout {
        blocks.push(match block {
            LayoutBlock::Text(value, heading, styles) => Block::Paragraph {
                text: DocumentText { value, html: String::new(), styles: styles.into_iter()
                    .map(|s| TextStyle { start: s.start, end: s.end, bold: s.bold, italic: s.italic }).collect() },
                heading, list: None,
            },
            LayoutBlock::Preformatted(value) => Block::Paragraph { text: text(value), heading: false, list: None },
            LayoutBlock::Table(rows) => Block::Table(rows.into_iter().map(|row| row.into_iter().map(text).collect()).collect()),
            LayoutBlock::Image(image, width, height) => Block::Image {
                bytes: super::super::frame_output::encode(&image, "png", 90., 72, limit).ok()?, width, height,
            },
            LayoutBlock::PageBreak(before) => Block::PageBreak(before),
        });
    }
    render_document(&blocks, title, filter, limit)
}

pub(in super::super) fn render_document(
    blocks: &[Block],
    title: &str,
    filter: Option<&str>,
    limit: usize,
) -> Option<Vec<u8>> {
    let dimensions = blocks.iter().find_map(|block| match block { Block::PageSize(size) => Some(*size), _ => None }).unwrap_or([612., 792.]);
    let content_width = (dimensions[0] - 108.).max(1.);
    let mut pdf = Pdf {
        pages: vec![Page::default()],
        images: Vec::new(),
        unicode: BTreeSet::new(),
        mappings: Vec::new(),
        y: dimensions[1] - 72.,
        page_height: dimensions[1],
        explicit_widths: blocks.iter().any(|block| matches!(block, Block::PageSize(_))),
        retained: 0,
        limit,
    };
    for block in blocks {
        match block {
            Block::PageSize(_) => {},
            Block::PageBreak(before) => {
                if !before || pdf.y != dimensions[1] - 72. {
                    pdf.retained = pdf.retained.checked_add(pdf.pages.last()?.stream.len())?;
                    pdf.pages.push(Page::default());
                    pdf.y = dimensions[1] - 72.;
                }
            }
            Block::Image {
                bytes,
                width,
                height,
            } => {
                if let Some(image) = Image::read(
                    bytes,
                    limit.checked_sub(pdf.retained + pdf.pages.last().unwrap().stream.len())?,
                )
                .ok()?
                {
                    pdf.space(height + 12.)?;
                    let y = pdf.y - height;
                    let index = pdf.images.len();
                    writeln!(
                        pdf.pages.last_mut().unwrap().stream,
                        "q\n{} 0 0 {} 54 {} cm\n/Image{index} Do\nQ",
                        svg_format_num(*width, 6),
                        svg_format_num(*height, 6),
                        svg_format_num(y, 6)
                    )
                    .ok()?;
                    pdf.pages.last_mut().unwrap().images.push(index);
                    pdf.retained = pdf
                        .retained
                        .checked_add(image.bytes.len() + image.alpha.len())?;
                    pdf.images.push(image);
                    pdf.y -= height + 12.;
                }
            }
            Block::Table(rows) => {
                let columns = rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
                let width = content_width / columns as f64;
                for (row, cells) in rows.iter().enumerate() {
                    pdf.space(28.)?;
                    let y = pdf.y;
                    let bottom = y - 22.;
                    if row == 0 {
                        writeln!(pdf.pages.last_mut().unwrap().stream,"q\n0.92 0.94 0.97 rg\n0.5 0.55 0.62 RG\n0.75 w\n54 {bottom} {content_width} 22 re\nB\nQ").ok()?;
                    } else {
                        writeln!(
                            pdf.pages.last_mut().unwrap().stream,
                            "q\n0.7 0.72 0.75 RG\n0.5 w\n54 {bottom} {content_width} 22 re\nS\nQ"
                        )
                        .ok()?;
                    }
                    for (cell, text) in cells.iter().enumerate() {
                        let x = 54. + cell as f64 * width;
                        if cell > 0 {
                            writeln!(
                                pdf.pages.last_mut().unwrap().stream,
                                "q\n0.7 0.72 0.75 RG\n0.5 w\n{x} {bottom} m\n{x} {y} l\nS\nQ"
                            )
                            .ok()?;
                        }
                        writeln!(
                            pdf.pages.last_mut().unwrap().stream,
                            "q\n0 0 0 rg\nBT\n/{} 10 Tf\n1 0 0 1 {} {} Tm",
                            if row == 0 { "Heading" } else { "Body" },
                            x + 6.,
                            bottom + 6.
                        )
                        .ok()?;
                        if !text.value.is_empty() {
                            pdf.text(&text.value, row == 0, 10, false);
                        } else if pdf.explicit_widths {
                            pdf.pages.last_mut().unwrap().stream.extend_from_slice(b"() Tj\n");
                        }
                        pdf.pages
                            .last_mut()
                            .unwrap()
                            .stream
                            .extend_from_slice(b"ET\nQ\n");
                    }
                    pdf.y = bottom;
                    if pdf.pages.last_mut().unwrap().stream.len() + pdf.retained > limit {
                        return None;
                    }
                }
                pdf.y -= 14.;
            }
            Block::Paragraph { text, heading, .. } => {
                let explicit_lines = pdf.explicit_widths;
                for segment in text.value.split(|c| explicit_lines && c == '\n') {
                let words: Vec<_> = segment
                    .split(space)
                    .filter(|s| !s.is_empty())
                    .map(|s| (s.as_ptr() as usize - text.value.as_ptr() as usize, s))
                    .collect();
                let mut first = 0;
                let mut style = 0;
                loop {
                    let mut end = first;
                    let mut units = 0;
                    while end < words.len() {
                        let next = words[end].1.encode_utf16().count();
                        if end > first && units + 1 + next > (content_width * if *heading { 48. / 504. } else { 84. / 504. }).floor().max(1.) as usize {
                            break;
                        }
                        units += usize::from(end > first) + next;
                        end += 1;
                    }
                    pdf.space(if *heading { 26. } else { 16. })?;
                    let y = pdf.y;
                    let size = if *heading { 18 } else { 11 };
                    writeln!(
                        pdf.pages.last_mut().unwrap().stream,
                        "q\n{} rg\nBT\n/{} {size} Tf\n1 0 0 1 54 {y} Tm",
                        if *heading {
                            "0.1 0.15 0.28"
                        } else {
                            "0.15 0.15 0.15"
                        },
                        if *heading { "Heading" } else { "Body" }
                    )
                    .ok()?;
                    for (word, (offset, value)) in words[first..end].iter().enumerate() {
                        if word > 0 {
                            pdf.pages
                                .last_mut()
                                .unwrap()
                                .stream
                                .extend_from_slice(b"( ) Tj\n");
                        }
                        let mut offset = *offset;
                        let end = offset + value.len();
                        while offset < end {
                            while style < text.styles.len() && text.styles[style].end <= offset {
                                style += 1;
                            }
                            let active = text.styles.get(style).filter(|s| s.start <= offset);
                            let next = end.min(active.map_or_else(
                                || text.styles.get(style).map_or(end, |s| s.start),
                                |s| s.end,
                            ));
                            pdf.text(
                                &text.value[offset..next],
                                *heading || active.is_some_and(|s| s.bold),
                                size,
                                active.is_some_and(|s| s.italic),
                            );
                            offset = next;
                        }
                    }
                    if first == end {
                        pdf.pages
                            .last_mut()
                            .unwrap()
                            .stream
                            .extend_from_slice(b"() Tj\n");
                    }
                    pdf.pages
                        .last_mut()
                        .unwrap()
                        .stream
                        .extend_from_slice(b"ET\nQ\n");
                    pdf.y -= if *heading { 24. } else { 15. };
                    first = end;
                    if pdf.pages.last_mut().unwrap().stream.len() + pdf.retained > limit {
                        return None;
                    }
                    if first == words.len() {
                        break;
                    }
                }
                }
                pdf.y -= if *heading { 4. } else { 5. };
            }
        }
        if pdf.retained + pdf.pages.last_mut().unwrap().stream.len() > limit {
            return None;
        }
    }
    pdf.save(
        Some(title),
        filter,
        dimensions,
        "LibreOffice 24.8 (@poe-code/pdf-ast)",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decoded_docx_images_cannot_silently_exceed_the_pdf_budget() {
        let image = Raster {
            width: 64,
            height: 64,
            alpha: false,
            gray: false,
            density: 72,
            orientation: None,
            pixels: vec![[120, 30, 80, 255]; 64 * 64],
        };
        let blocks = [Block::Image {
            bytes: image.png(),
            width: 100.,
            height: 100.,
        }];
        assert!(render_document(&blocks, "image", None, 4096).is_none());
        assert!(render_document(&blocks, "image", None, 65536).is_some());
    }
}

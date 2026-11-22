//! Add a searchable text layer while retaining original PDF pages and resources.
use crate::{Limits, Options, Recognition, recognize, remaining_time, validate_options};
use lopdf::{Dictionary, Document, Object, ObjectId, Stream, dictionary};
use safe_bash_rust::{
    ExecOptions, MemoryVfs, MemoryVfsLimits, SafeBashFs, Shell, ShellLimits, ShellOptions,
};
use std::{collections::BTreeMap, fmt::Write, sync::Arc, time::Instant};

pub struct PdfOptions {
    pub skip_text: bool,
    pub max_pages: usize,
}
impl Default for PdfOptions {
    fn default() -> Self {
        Self {
            skip_text: false,
            max_pages: 100,
        }
    }
}

#[derive(Debug)]
pub struct PdfRecognition {
    pub pdf: Vec<u8>,
    pub text: String,
    pub pages: usize,
}

pub fn recognize_pdf(
    bytes: &[u8],
    options: &Options<'_>,
    pdf_options: &PdfOptions,
) -> Result<PdfRecognition, String> {
    validate_options(options)?;
    let started = Instant::now();
    if bytes.len() > options.limits.max_input_bytes {
        return Err("PDF input byte limit exceeded".into());
    }
    if pdf_options.max_pages == 0 {
        return Err("PDF page limit must be positive".into());
    }
    if !(70..=600).contains(&options.dpi) {
        return Err("PDF OCR DPI must be between 70 and 600".into());
    }
    let mut doc = Document::load_mem(bytes).map_err(|e| format!("Invalid PDF: {e}"))?;
    if doc.is_encrypted() {
        return Err("Encrypted PDFs must be decrypted before OCR".into());
    }
    let pages = doc.get_pages();
    if pages.is_empty() || pages.len() > pdf_options.max_pages {
        return Err("PDF page limit exceeded or document has no pages".into());
    }
    let fs = Arc::new(MemoryVfs::with_limits(MemoryVfsLimits {
        max_total_bytes: options.limits.max_input_bytes.saturating_mul(3),
        max_file_bytes: options.limits.max_input_bytes,
        max_entries: 16,
        ..Default::default()
    }));
    fs.write_file("/input.pdf", bytes)?;
    let mut shell = Shell::new(fs.clone(), ShellOptions::default());
    shell.set_limits(ShellLimits {
        max_input_bytes: options.limits.max_input_bytes,
        max_output_bytes: options.limits.max_input_bytes,
        max_memory_bytes: options.limits.max_pixels.saturating_mul(16),
        ..Default::default()
    });
    let mut results = Vec::new();
    let mut layout_bytes = 0_usize;
    let mut text = String::new();
    for (&number, &id) in &pages {
        remaining_time(options, started)?;
        let existing = doc
            .extract_text(&[number])
            .map_err(|e| format!("Cannot inspect PDF text: {e}"))?;
        if !existing.trim().is_empty() {
            if !pdf_options.skip_text {
                return Err(format!(
                    "Page {number} already contains text; use --skip-text to preserve it"
                ));
            }
            text.push_str(&existing);
            text.push('\x0c');
            if text.len() > options.limits.max_output_bytes {
                return Err("PDF text output limit exceeded".into());
            }
            continue;
        }
        let geometry = geometry(&doc, id)?;
        let pixel_width = ((geometry[2] - geometry[0]) * f64::from(options.dpi) / 72.).ceil();
        let pixel_height = ((geometry[3] - geometry[1]) * f64::from(options.dpi) / 72.).ceil();
        if pixel_width * pixel_height > options.limits.max_pixels as f64 {
            return Err("PDF page pixel limit exceeded".into());
        }
        // Only generated numeric arguments enter this fixed command. All files live in MemoryVfs.
        let rendered = shell.exec_with_options(
            &format!(
                "pdftoppm -f {number} -l {number} -singlefile -r {} -png /input.pdf /page",
                options.dpi
            ),
            ExecOptions {
                timeout_ms: Some(u64::from(remaining_time(options, started)?)),
                ..Default::default()
            },
        )?;
        if rendered.exit_code != 0 {
            return Err(format!(
                "PDF page {number} rendering failed: {}",
                rendered.stderr
            ));
        }
        let image = fs.read_file("/page.png")?;
        fs.remove_path("/page.png")?;
        let mut recognition = recognize(
            &image,
            &Options {
                model: options.model,
                psm: options.psm,
                dpi: options.dpi,
                limits: Limits {
                    timeout_ms: remaining_time(options, started)?,
                    ..options.limits
                },
                cancellation: options.cancellation,
            },
        )?;
        text.push_str(&recognition.text);
        text.push('\x0c');
        if text.len() > options.limits.max_output_bytes {
            return Err("PDF text output limit exceeded".into());
        }
        // Only TSV is needed to build the overlay. Bound retained layout across
        // the whole document instead of accumulating each page's full OCR output.
        layout_bytes = layout_bytes.saturating_add(recognition.tsv.len());
        if layout_bytes.saturating_add(text.len()) > options.limits.max_output_bytes {
            return Err("PDF layout output limit exceeded".into());
        }
        recognition.text.clear();
        recognition.hocr = String::new();
        results.push((id, geometry, recognition));
    }
    if !results.is_empty() {
        let font = PdfFont::new(&mut doc, &text)?;
        for (id, rect, result) in results {
            remaining_time(options, started)?;
            let rotation = inherited(&doc, id, b"Rotate")?
                .map(|value| value.as_i64())
                .transpose()
                .map_err(|e| e.to_string())?
                .unwrap_or(0)
                .rem_euclid(360);
            if ![0, 90, 180, 270].contains(&rotation) {
                return Err("Unsupported PDF page rotation".into());
            }
            let mut resources = inherited(&doc, id, b"Resources")?
                .map(|value| value.as_dict().cloned())
                .transpose()
                .map_err(|e| e.to_string())?
                .unwrap_or_default();
            let mut fonts = resources
                .get(b"Font")
                .ok()
                .map(|value| {
                    doc.dereference(value)
                        .and_then(|(_, v)| v.as_dict())
                        .cloned()
                })
                .transpose()
                .map_err(|e| e.to_string())?
                .unwrap_or_default();
            let mut suffix = 0;
            while fonts.has(format!("PoeOCR{suffix}").as_bytes()) {
                suffix += 1;
            }
            let font_name = format!("PoeOCR{suffix}");
            fonts.set(font_name.as_bytes(), font.id);
            resources.set("Font", fonts);
            doc.get_object_mut(id)
                .and_then(Object::as_dict_mut)
                .map_err(|e| e.to_string())?
                .set("Resources", resources);
            // PDF streams share graphics state. Preserve the original streams while
            // restoring the initial page transform and clipping state before the overlay.
            let prefix = doc.add_object(Stream::new(Dictionary::new(), b"q\n".to_vec()));
            let mut content = b"\nQ\n".to_vec();
            content.extend(font.overlay(&font_name, &result, rect, rotation, options.dpi)?);
            let suffix = doc.add_object(Stream::new(Dictionary::new(), content));
            let mut contents = vec![Object::Reference(prefix)];
            contents.extend(doc.get_page_contents(id).into_iter().map(Object::Reference));
            contents.push(Object::Reference(suffix));
            doc.get_object_mut(id)
                .and_then(Object::as_dict_mut)
                .map_err(|e| e.to_string())?
                .set("Contents", contents);
        }
    }
    remaining_time(options, started)?;
    let mut output = PdfOutput {
        bytes: Vec::new(),
        remaining: options.limits.max_output_bytes.saturating_sub(text.len()),
    };
    doc.save_to(&mut output).map_err(|e| e.to_string())?;
    remaining_time(options, started)?;
    Ok(PdfRecognition {
        pdf: output.bytes,
        text,
        pages: pages.len(),
    })
}

struct PdfOutput {
    bytes: Vec<u8>,
    remaining: usize,
}

impl std::io::Write for PdfOutput {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.remaining {
            return Err(std::io::Error::other("PDF output byte limit exceeded"));
        }
        self.bytes.extend_from_slice(bytes);
        self.remaining -= bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn inherited<'a>(
    doc: &'a Document,
    mut id: ObjectId,
    key: &[u8],
) -> Result<Option<&'a Object>, String> {
    for _ in 0..128 {
        let page = doc.get_dictionary(id).map_err(|e| e.to_string())?;
        if let Ok(value) = page.get(key) {
            return doc
                .dereference(value)
                .map(|(_, v)| Some(v))
                .map_err(|e| e.to_string());
        }
        match page.get(b"Parent") {
            Ok(parent) => id = parent.as_reference().map_err(|e| e.to_string())?,
            Err(_) => return Ok(None),
        }
    }
    Err("PDF page tree exceeds depth limit".into())
}

fn geometry(doc: &Document, id: ObjectId) -> Result<[f64; 4], String> {
    let value = inherited(doc, id, b"MediaBox")?.ok_or("PDF page has no MediaBox")?;
    let values = value.as_array().map_err(|e| e.to_string())?;
    if values.len() != 4 {
        return Err("Invalid PDF MediaBox".into());
    }
    let mut rect = [0.; 4];
    for (i, v) in values.iter().enumerate() {
        rect[i] = f64::from(v.as_float().map_err(|e| e.to_string())?);
    }
    if !rect.iter().all(|v| v.is_finite()) || rect[2] <= rect[0] || rect[3] <= rect[1] {
        return Err("Invalid PDF page dimensions".into());
    }
    if inherited(doc, id, b"UserUnit")?.is_some_and(|v| v.as_float().ok() != Some(1.)) {
        return Err("PDF UserUnit values other than 1 are not supported".into());
    }
    Ok(rect)
}

struct PdfFont {
    id: ObjectId,
    characters: BTreeMap<char, (u16, f64)>,
}
impl PdfFont {
    fn new(doc: &mut Document, text: &str) -> Result<Self, String> {
        let data = include_bytes!("../../pdf-ast-rust/src/fonts/DejaVuSans.ttf");
        let face = ttf_parser::Face::parse(data, 0).map_err(|e| e.to_string())?;
        let mut characters = BTreeMap::new();
        for c in text.chars().chain(std::iter::once(' ')) {
            characters.entry(c).or_insert((0, 0.));
        }
        if characters.len() >= u16::MAX as usize {
            return Err("PDF OCR character limit exceeded".into());
        }
        let mut gids = vec![0_u8, 0];
        let mut widths = Vec::<Object>::new();
        let mut mappings = Vec::new();
        for (i, (c, value)) in characters.iter_mut().enumerate() {
            let cid = (i + 1) as u16;
            let glyph = face.glyph_index(*c).unwrap_or(ttf_parser::GlyphId(0));
            let width = f64::from(face.glyph_hor_advance(glyph).unwrap_or(face.units_per_em()))
                * 1000.
                / f64::from(face.units_per_em());
            *value = (cid, width);
            gids.extend_from_slice(&glyph.0.to_be_bytes());
            widths.push((width as i64).into());
            let mut utf16 = [0; 2];
            let unicode = c
                .encode_utf16(&mut utf16)
                .iter()
                .map(|v| format!("{v:04X}"))
                .collect::<String>();
            mappings.push(format!("<{cid:04X}> <{unicode}>\n"));
        }
        let mut cmap = String::from(
            "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /PoeOCR def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n",
        );
        for chunk in mappings.chunks(100) {
            writeln!(cmap, "{} beginbfchar", chunk.len()).unwrap();
            for row in chunk {
                cmap.push_str(row);
            }
            cmap.push_str("endbfchar\n");
        }
        cmap.push_str("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
        let font_file = doc.add_object(Stream::new(
            dictionary! { "Length1" => data.len() as i64 },
            data.to_vec(),
        ));
        let unicode = doc.add_object(Stream::new(Dictionary::new(), cmap.into_bytes()));
        let gid_map = doc.add_object(Stream::new(Dictionary::new(), gids));
        let descriptor = doc.add_object(dictionary! { "Type" => "FontDescriptor", "FontName" => "DejaVuSans", "Flags" => 32, "FontBBox" => vec![(-1021).into(),(-463).into(),1793.into(),1232.into()], "ItalicAngle" => 0, "Ascent" => 928, "Descent" => -236, "CapHeight" => 729, "StemV" => 80, "FontFile2" => font_file });
        let cid_font = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "CIDFontType2", "BaseFont" => "DejaVuSans", "CIDSystemInfo" => dictionary! { "Registry" => Object::string_literal("Adobe"), "Ordering" => Object::string_literal("Identity"), "Supplement" => 0 }, "FontDescriptor" => descriptor, "CIDToGIDMap" => gid_map, "W" => vec![1.into(),Object::Array(widths)] });
        let id = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type0", "BaseFont" => "DejaVuSans", "Encoding" => "Identity-H", "DescendantFonts" => vec![Object::Reference(cid_font)], "ToUnicode" => unicode });
        Ok(Self { id, characters })
    }

    fn overlay(
        &self,
        name: &str,
        result: &Recognition,
        rect: [f64; 4],
        rotation: i64,
        dpi: u32,
    ) -> Result<Vec<u8>, String> {
        let mut content = String::from("q\nBT\n3 Tr\n");
        let scale = 72. / f64::from(dpi);
        let mut previous_line = None;
        for row in result.tsv.lines().skip(1) {
            let fields: Vec<_> = row.splitn(12, '\t').collect();
            if fields.len() != 12 || fields[0] != "5" || fields[11].trim().is_empty() {
                continue;
            }
            let line = [fields[1], fields[2], fields[3], fields[4]];
            if previous_line.is_some_and(|previous| previous != line) {
                content.push_str("ET\nBT\n");
            }
            previous_line = Some(line);
            let number = |i: usize| {
                fields[i]
                    .parse::<f64>()
                    .map_err(|_| "Invalid OCR word coordinates")
            };
            let (left, top, width, height) = (number(6)?, number(7)?, number(8)?, number(9)?);
            let size = height * scale;
            if size <= 0. || width <= 0. {
                continue;
            }
            let mut encoded = String::new();
            let mut advance = 0.;
            for c in fields[11].chars() {
                let (cid, width) = self
                    .characters
                    .get(&c)
                    .ok_or("OCR text and layout disagree")?;
                write!(encoded, "{cid:04X}").unwrap();
                advance += width;
            }
            let dx = left * scale;
            let dy = (f64::from(result.height) - top - height) * scale;
            let (a, b, c, d, x, y) = match rotation {
                90 => (0., 1., -1., 0., rect[2] - dy, rect[1] + dx),
                180 => (-1., 0., 0., -1., rect[2] - dx, rect[3] - dy),
                270 => (0., -1., 1., 0., rect[0] + dy, rect[3] - dx),
                _ => (1., 0., 0., 1., rect[0] + dx, rect[1] + dy),
            };
            let stretch = width * scale * 100_000. / (advance * size);
            // Absolute word positions preserve layout; a real space keeps simple
            // PDF text extractors from concatenating adjacent words.
            write!(encoded, "{:04X}", self.characters[&' '].0).unwrap();
            writeln!(content, "/{name} {size:.5} Tf\n{stretch:.5} Tz\n{a} {b} {c} {d} {x:.5} {y:.5} Tm\n<{encoded}> Tj").unwrap();
        }
        content.push_str("ET\nQ\n");
        Ok(content.into_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unicode_text_and_rotated_word_positions_survive_pdf_encoding() {
        for rotation in [0, 90, 180, 270] {
            let mut doc = Document::with_version("1.7");
            let font = PdfFont::new(&mut doc, "中文 한국어").unwrap();
            let result = Recognition {
                text: "中文 한국어".into(),
                tsv: "header\n5\t1\t1\t1\t1\t1\t10\t20\t50\t10\t95\t中文\n5\t1\t1\t1\t1\t2\t70\t20\t50\t10\t95\t한국어\n".into(),
                hocr: String::new(),
                width: if rotation == 90 || rotation == 270 {110} else {600},
                height: if rotation == 90 || rotation == 270 {600} else {110},
                confidence: 95,
            };
            let overlay = font
                .overlay("OCR", &result, [0., 0., 600., 110.], rotation, 72)
                .unwrap();
            let operations = lopdf::content::Content::decode(&overlay).unwrap();
            let position = operations
                .operations
                .iter()
                .find(|op| op.operator == "Tm")
                .unwrap();
            let x = f64::from(position.operands[4].as_float().unwrap());
            let y = f64::from(position.operands[5].as_float().unwrap());
            // Invert each PDF page rotation to check the rendered word baseline.
            let device = match rotation {
                90 => [y, x],
                180 => [600. - x, y],
                270 => [110. - y, 600. - x],
                _ => [x, 110. - y],
            };
            assert_eq!(device, [10., 30.]);
            let pages = doc.new_object_id();
            let contents = doc.add_object(Stream::new(Dictionary::new(), overlay));
            let page = doc.add_object(dictionary! {"Type" => "Page", "Parent" => pages, "MediaBox" => vec![0.into(), 0.into(), 600.into(), 110.into()], "Contents" => contents, "Resources" => dictionary! {"Font" => dictionary! {"OCR" => font.id}}});
            doc.objects.insert(pages, dictionary! {"Type" => "Pages", "Count" => 1, "Kids" => vec![Object::Reference(page)]}.into());
            let catalog = doc.add_object(dictionary! {"Type" => "Catalog", "Pages" => pages});
            doc.trailer.set("Root", catalog);
            assert!(doc.extract_text(&[1]).unwrap().contains("中文 한국어"));
        }
    }
}

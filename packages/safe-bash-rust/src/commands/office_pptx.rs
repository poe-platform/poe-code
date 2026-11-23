use super::{
    office::Block,
    office_xml::{Xml, decode},
};
use crate::commands::codecs::zip_directory;
use std::{borrow::Cow, collections::BTreeMap};

pub(super) struct TextBox {
    pub first: usize,
    pub count: usize,
    pub x: f64,
    pub top: f64,
    pub width: f64,
    pub size: f64,
}
pub(super) struct SlideImage {
    pub bytes: Vec<u8>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
pub(super) struct SlideTable {
    pub rows: Vec<Vec<String>>,
    pub x: f64,
    pub top: f64,
    pub width: f64,
}
#[derive(Default)]
pub(super) struct Slide {
    pub dimensions: [f64; 2],
    pub paragraphs: Vec<String>,
    pub boxes: Vec<TextBox>,
    pub images: Vec<SlideImage>,
    pub tables: Vec<SlideTable>,
}
fn number(s: &str, signed: bool) -> Option<f64> {
    let digits = if signed {
        s.strip_prefix('-').unwrap_or(s)
    } else {
        s
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(s.parse().unwrap_or(if s.starts_with('-') {
        f64::NEG_INFINITY
    } else {
        f64::INFINITY
    }))
}
fn pair(
    xml: &Xml<'_>,
    first: usize,
    end: usize,
    name: &str,
    a: &str,
    b: &str,
    signed: bool,
) -> Option<(f64, f64)> {
    for i in xml.elements(first, end, name, true) {
        if let (Some((_, a)), Some((_, b))) = (xml.attr(i, a), xml.attr(i, b)) {
            if let (Some(a), Some(b)) = (number(a, signed), number(b, signed)) {
                return Some((a, b));
            }
        }
    }
    None
}

pub(super) fn read(bytes: &[u8], pdf: bool, limit: usize) -> Result<Vec<Slide>, String> {
    let read = || -> Result<Vec<Slide>, String> {
        let (members, _) = zip_directory(bytes.len(), |r| Ok(Cow::Borrowed(&bytes[r])))?;
        let mut resources = BTreeMap::new();
        let mut slides = Vec::new();
        let mut names = BTreeMap::new();
        let mut remaining = limit;
        for member in members {
            remaining = remaining
                .checked_sub(member.size)
                .ok_or("document exceeds byte limit")?;
            if !matches!(member.method, 0 | 8) {
                return Err("ZIP unsupported compression method".into());
            }
            let value = member.decode(Cow::Borrowed(&bytes[member.payload.clone()]), None)?;
            let selected = member
                .name
                .strip_prefix("ppt/slides/slide")
                .and_then(|n| n.strip_suffix(".xml"))
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
            if selected {
                if let Some(&i) = names.get(&member.name) {
                    slides[i] = (member.name.clone(), value.clone());
                } else {
                    names.insert(member.name.clone(), slides.len());
                    slides.push((member.name.clone(), value.clone()));
                }
            }
            resources.insert(member.name, value);
        }
        slides.sort_by(|(a, _), (b, _)| {
            let a = a[16..a.len() - 4].trim_start_matches('0');
            let b = b[16..b.len() - 4].trim_start_matches('0');
            a.len().cmp(&b.len()).then_with(|| a.cmp(b))
        });
        let (mut cx, mut cy) = (12192000., 6858000.);
        if let Some(p) = resources.get("ppt/presentation.xml") {
            let source = decode(p)?;
            let xml = Xml::new(&source)?;
            if let Some((x, y)) = pair(&xml, 0, xml.tokens.len(), "sldSz", "cx", "cy", false) {
                if !x.is_finite() || !y.is_finite() || x <= 0. || y <= 0. {
                    return Err("Invalid PPTX slide size".into());
                }
                cx = x;
                cy = y;
            }
        }
        if let Some(manifest) = resources.get("ppt/presentation.xml") {
            let source = decode(manifest)?;
            let xml = Xml::new(&source)?;
            if let Some(&list) = xml.elements(0, xml.tokens.len(), "sldIdLst", true).first() {
                crate::commands::structured::xml::parse(&source, None, None)
                    .map_err(|_| "Invalid retained XML document.")?;
                let mut targets = BTreeMap::new();
                if let Some(rels) = resources.get("ppt/_rels/presentation.xml.rels") {
                    let source = decode(rels)?;
                    let rels = Xml::new(&source)?;
                    for rel in rels.elements(0, rels.tokens.len(), "Relationship", true) {
                        if rels.attr(rel, "TargetMode").is_some_and(|(_, v)| v == "External") { continue; }
                        if let (Some((_, id)), Some((_, target))) = (rels.attr(rel, "Id"), rels.attr(rel, "Target")) {
                            targets.insert(id.to_owned(), crate::vfs::resolve_posix_path("/ppt", target).trim_start_matches('/').to_owned());
                        }
                    }
                }
                slides.clear();
                for id in xml.elements(list + 1, xml.end(list), "sldId", true) {
                    let relationship = match &xml.tokens[id] {
                        super::office_xml::Token::Start { attributes, .. } => attributes.iter()
                            .find(|a| a.name.split_once(':').is_some_and(|(_, local)| local == "id"))
                            .map(|a| a.value),
                        _ => None,
                    };
                    let target = relationship.and_then(|id| targets.get(id))
                        .ok_or("Missing referenced PPTX slide")?;
                    let source = resources.get(target).ok_or("Missing referenced PPTX slide")?;
                    crate::commands::structured::xml::parse(&decode(source)?, None, None)
                        .map_err(|_| "Invalid retained XML document.")?;
                    slides.push((target.clone(), source.clone()));
                }
            }
        }
        let mut result = Vec::new();
        let mut retained = limit;
        for (index, (name, bytes)) in slides.into_iter().enumerate() {
            let source = decode(&bytes)?;
            let xml = Xml::new(&source)?;
            let mut slide = Slide { dimensions: [cx / 12700., cy / 12700.], ..Default::default() };
            let mut shapes = 0;
            for s in xml.elements(0, xml.tokens.len(), "sp", false) {
                let first = slide.paragraphs.len();
                let mut size = 1800.;
                for p in xml.elements(s + 1, xml.end(s), "p", false) {
                    if pdf {
                        for i in p..xml.end(p) {
                            if let Some((_, value)) = xml.attr(i, "sz") {
                                if let Some(n) = number(value, false) {
                                    if n > 0. {
                                        size = n;
                                    }
                                }
                            }
                        }
                    }
                    let value = xml.text(p)?;
                    if !value.is_empty() {
                        slide.paragraphs.push(value);
                    }
                }
                if slide.paragraphs.len() > first {
                    if pdf && shapes > 0 {
                        if let Some((ox, oy)) = pair(&xml, s + 1, xml.end(s), "off", "x", "y", true)
                        {
                            let extent = pair(&xml, s + 1, xml.end(s), "ext", "cx", "cy", false);
                            let x = (ox / cx * 720.).clamp(24., 660.);
                            let width = (extent.map_or((cx * 0.85).round(), |p| p.0) / cx * 720.)
                                .min(720. - x - 24.)
                                .max(120.);
                            let size = (size / 100. * 0.65).round().clamp(10., 15.);
                            let top = (405. - oy / cy * 405. - size).clamp(28., 330.);
                            slide.boxes.push(TextBox {
                                first,
                                count: slide.paragraphs.len() - first,
                                x,
                                top,
                                width,
                                size,
                            });
                        }
                    }
                    shapes += 1;
                }
            }
            if !pdf && slide.paragraphs.is_empty() {
                slide.paragraphs.push(format!("Slide {}", index + 1));
            }
            if pdf {
                let mut relationships = BTreeMap::new();
                if let Some(rels) = resources.get(&format!("ppt/slides/_rels/{}.rels", &name[11..]))
                {
                    let text = decode(rels)?;
                    let rels = Xml::new(&text)?;
                    for r in rels.elements(0, rels.tokens.len(), "Relationship", true) {
                        if let (Some((_, id)), Some((_, target))) =
                            (rels.attr(r, "Id"), rels.attr(r, "Target"))
                        {
                            if !id.is_empty() && !target.is_empty() {
                                let path = if let Some(t) = target.strip_prefix('/') {
                                    t.to_owned()
                                } else if let Some(t) = target.strip_prefix("../") {
                                    format!("ppt/{t}")
                                } else {
                                    format!("ppt/slides/{target}")
                                };
                                relationships.insert(id.to_owned(), path);
                            }
                        }
                    }
                }
                for pic in xml.elements(0, xml.tokens.len(), "pic", false) {
                    let target = (pic..xml.end(pic))
                        .find_map(|i| xml.attr(i, "embed"))
                        .and_then(|(_, id)| relationships.get(id));
                    let bytes = target.and_then(|path| resources.get(path))
                        .ok_or("Missing referenced PPTX image")?;
                    let (ox, oy) = pair(&xml, pic + 1, xml.end(pic), "off", "x", "y", true)
                        .ok_or("Invalid PPTX picture placement")?;
                    let (w, h) = pair(&xml, pic + 1, xml.end(pic), "ext", "cx", "cy", false)
                        .ok_or("Invalid PPTX picture placement")?;
                    if ![ox, oy, w, h].iter().all(|n| n.is_finite()) || w <= 0. || h <= 0. {
                        return Err("Invalid PPTX picture placement".into());
                    }
                    super::png_pixels::Raster::decode(bytes, limit)
                        .map_err(|_| "Invalid referenced PPTX image")?;
                    let (width, height, x, y) = (w / 12700., h / 12700., ox / 12700., (cy - oy - h) / 12700.);
                    retained = retained
                        .checked_sub(bytes.len())
                        .ok_or("document exceeds byte limit")?;
                    slide.images.push(SlideImage {
                        bytes: bytes.to_vec(),
                        x,
                        y,
                        width,
                        height,
                    });
                }
            }
            for frame in xml.elements(0, xml.tokens.len(), "graphicFrame", false) {
                if let Some(table) = xml
                    .elements(frame + 1, xml.end(frame), "tbl", false)
                    .first()
                {
                    let mut rows = Vec::new();
                    for row in xml.elements(table + 1, xml.end(*table), "tr", false) {
                        let cells = xml
                            .elements(row + 1, xml.end(row), "tc", false)
                            .into_iter()
                            .map(|c| xml.text(c))
                            .collect::<Result<Vec<_>, _>>()?;
                        if !cells.is_empty() {
                            slide.paragraphs.push(cells.join("\t"));
                            rows.push(cells);
                        }
                    }
                    if pdf && rows.iter().any(|r| !r.is_empty()) {
                        let (ox, oy) = pair(&xml, frame + 1, xml.end(frame), "off", "x", "y", true)
                            .unwrap_or(((cx * 0.08).round(), (cy * 0.22).round()));
                        let w = pair(&xml, frame + 1, xml.end(frame), "ext", "cx", "cy", false)
                            .map_or((cx * 0.84).round(), |p| p.0);
                        let x = (ox / cx * 720.).clamp(24., 640.);
                        let width = (w / cx * 720.).min(720. - x - 24.).max(180.);
                        let top = (405. - oy / cy * 405.).clamp(60., 325.);
                        slide.tables.push(SlideTable {
                            rows,
                            x,
                            top,
                            width,
                        });
                    }
                }
            }
            if slide.paragraphs.is_empty() {
                slide.paragraphs.push(if pdf { String::new() } else { format!("Slide {}", index + 1) });
            }
            for p in &slide.paragraphs {
                retained = retained
                    .checked_sub(p.len())
                    .ok_or("document exceeds byte limit")?;
            }
            for t in &slide.tables {
                for c in t.rows.iter().flatten() {
                    retained = retained
                        .checked_sub(c.len())
                        .ok_or("document exceeds byte limit")?;
                }
            }
            result.push(slide);
        }
        Ok(result)
    };
    read().map_err(|e| {
        format!(
            "Error: conversion failed: {}\n",
            if e == "ZIP missing end record" {
                "ZIP truncated or missing end of central directory"
            } else {
                &e
            }
        )
    })
}
pub(super) fn blocks(slides: &[Slide]) -> Vec<Block> {
    slides
        .iter()
        .flat_map(|s| {
            s.paragraphs
                .iter()
                .enumerate()
                .map(|(i, p)| Block::Text(p.clone(), i == 0))
        })
        .collect()
}
pub(super) fn text(slides: &[Slide], conversion: bool) -> String {
    let mut out = String::new();
    for (i, slide) in slides.iter().enumerate() {
        if i > 0 {
            out.push_str("\n\n");
        }
        out.push_str(&slide.paragraphs.join("\n"));
        if conversion && slide.paragraphs.len() == 1 {
            out.push('\n');
        }
    }
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::structured::write_zip_stored;

    #[test]
    fn presentation_accounts_for_unused_archive_members_and_pdf_output() {
        let bytes = write_zip_stored(&[
            (
                "ppt/slides/slide1.xml",
                b"<p:sp><a:p><a:r><a:t>Title</a:t></a:r></a:p></p:sp>",
            ),
            ("unused", &[0; 2048]),
        ]);
        for pdf in [false, true] {
            assert_eq!(
                read(&bytes, pdf, 1024).err().unwrap(),
                "Error: conversion failed: document exceeds byte limit\n"
            );
        }
        let slides = read(&bytes, true, 4096).unwrap();
        assert!(super::super::pdf_reader::render_slides(&slides, None, 1024).is_none());
        assert!(super::super::pdf_reader::render_slides(&slides, None, 4096).is_some());
    }
}

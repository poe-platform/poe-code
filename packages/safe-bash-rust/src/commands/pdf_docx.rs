use super::super::{office::Block, png_pixels::Raster};
use super::{
    pdf_office::{LayoutBlock, render_blocks},
    pdf_pptx::{archive, document, elements, relationships},
};
use crate::commands::structured::xml;

fn attr<'a>(element: &'a xml::Element, name: &str) -> Option<&'a str> {
    element
        .attrs
        .iter()
        .find(|(key, _)| key.rsplit(':').next() == Some(name))
        .map(|(_, value)| value.as_str())
}
fn flush(text: &mut String, blocks: &mut Vec<LayoutBlock>) {
    if !text.trim().is_empty() {
        blocks.push(LayoutBlock::Office(Block::Text(
            text.trim().to_owned(),
            false,
        )));
    }
    text.clear();
}
pub(in super::super) fn render_docx(
    bytes: &[u8],
    title: &str,
    filter: Option<&str>,
    limit: usize,
) -> Option<Vec<u8>> {
    let entries = archive(bytes, limit)?;
    let doc = document(&entries, "word/document.xml")?;
    let mut page_size = (612., 792.);
    if let Some(section) = elements(&doc.nodes, "sectPr").last()
        && let Some(xml::Node::Element(size)) = section.children.iter().find(|node| {
            matches!(node, xml::Node::Element(e) if e.tag.rsplit(':').next() == Some("pgSz"))
        })
    {
        let dimension = |name, fallback| {
            let points = match attr(size, name) {
                Some(value) => {
                    let value = value.trim();
                    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) { return None; }
                    value.parse::<f64>().ok()? / 20.
                },
                None => fallback,
            };
            (points.is_finite() && points > 0. && points <= 14400.).then_some(points)
        };
        page_size = (dimension("w", 612.)?, dimension("h", 792.)?);
    }
    let content_width = (page_size.0 - 108.).max(1.);
    let targets = relationships(&entries, "word/document.xml")?;
    let mut blocks = Vec::new();
    let mut retained = 0usize;
    for paragraph in elements(&doc.nodes, "p") {
        for properties in elements(&paragraph.children, "pPr") {
            for before in elements(&properties.children, "pageBreakBefore") {
                if matches!(attr(before, "val"), None | Some("1" | "true" | "on")) {
                    blocks.push(LayoutBlock::PageBreak(true));
                }
            }
        }
        let mut text = String::new();
        let mut pending: Vec<_> = paragraph.children.iter().rev().collect();
        while let Some(node) = pending.pop() {
            let xml::Node::Element(element) = node else {
                continue;
            };
            match element.tag.rsplit(':').next()? {
                "pPr" | "rPr" => {}
                "t" => {
                    for node in &element.children {
                        if let xml::Node::Text(value, _) | xml::Node::Cdata(value) = node {
                            text.push_str(value);
                        }
                    }
                }
                "tab" => text.push('\t'),
                "br" if attr(element, "type") == Some("page") => {
                    flush(&mut text, &mut blocks);
                    blocks.push(LayoutBlock::PageBreak(false));
                }
                "br" | "cr" => text.push(' '),
                "drawing" | "pict" => {
                    flush(&mut text, &mut blocks);
                    let blips = elements(&element.children, "blip");
                    let Some(blip) = blips.first() else {
                        continue;
                    };
                    let image = entries.get(targets.get(attr(blip, "embed")?)?)?;
                    if !image.starts_with(b"\x89PNG\r\n\x1a\n") && !image.starts_with(b"\xff\xd8") {
                        return None;
                    }
                    let raster = Raster::decode(image, limit).ok()?;
                    retained = retained.checked_add(raster.pixels.len().checked_mul(4)?)?;
                    if retained > limit {
                        return None;
                    }
                    let extent = elements(&element.children, "extent")
                        .into_iter()
                        .chain(elements(&element.children, "ext"))
                        .next();
                    let dimension = |name, default| -> Option<f64> {
                        let value = match extent.and_then(|e| attr(e, name)) {
                            Some(v) => {
                                if v.len() > 64 {
                                    return None;
                                }
                                let v = v.trim();
                                if v.is_empty() || !v.bytes().all(|byte| byte.is_ascii_digit()) {
                                    return None;
                                }
                                v.parse::<f64>().ok()? / 12700.
                            }
                            None => default,
                        };
                        (value.is_finite() && value > 0.).then_some(value)
                    };
                    let mut width = dimension("cx", 432.)?;
                    let mut height = dimension("cy", 226.8)?;
                    if width > content_width {
                        height *= content_width / width;
                        width = content_width;
                    }
                    blocks.push(LayoutBlock::Image(raster, width, height));
                }
                _ => pending.extend(element.children.iter().rev()),
            }
        }
        flush(&mut text, &mut blocks);
    }
    render_blocks(blocks, title, filter, limit, page_size)
}

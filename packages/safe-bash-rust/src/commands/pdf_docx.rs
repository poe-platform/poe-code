use super::super::png_pixels::Raster;
use super::{
    pdf_office::{LayoutBlock, TextStyle, render_blocks},
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
fn flush(text: &mut String, styles: &mut Vec<TextStyle>, blocks: &mut Vec<LayoutBlock>) {
    if !text.trim_matches(|c: char| c != '\n' && c.is_whitespace()).is_empty() {
        blocks.push(LayoutBlock::Text(std::mem::take(text), false, std::mem::take(styles)));
    }
    text.clear();
    styles.clear();
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
        let first_block = blocks.len();
        let mut text = String::new();
        let mut styles = Vec::new();
        let mut pending: Vec<_> = paragraph.children.iter().rev().map(|node| (node, false, false)).collect();
        while let Some((node, mut bold, mut italic)) = pending.pop() {
            let xml::Node::Element(element) = node else {
                continue;
            };
            if element.tag.rsplit(':').next() == Some("r") {
                bold = false;
                italic = false;
                for properties in &element.children {
                    if let xml::Node::Element(properties) = properties
                        && properties.tag.rsplit(':').next() == Some("rPr") {
                        for property in &properties.children {
                            if let xml::Node::Element(property) = property {
                                let enabled = matches!(attr(property, "val"), None | Some("1" | "true" | "on"));
                                match property.tag.rsplit(':').next() {
                                    Some("b") => bold = enabled,
                                    Some("i") => italic = enabled,
                                    _ => {},
                                }
                            }
                        }
                    }
                }
            }
            match element.tag.rsplit(':').next()? {
                "pPr" | "rPr" => {}
                "t" => {
                    for node in &element.children {
                        if let xml::Node::Text(value, _) | xml::Node::Cdata(value) = node {
                            if bold || italic {
                                styles.push(TextStyle { start: text.len(), end: text.len() + value.len(), bold, italic });
                            }
                            text.push_str(value);
                        }
                    }
                }
                "tab" => text.push('\t'),
                "br" if attr(element, "type") == Some("page") => {
                    flush(&mut text, &mut styles, &mut blocks);
                    blocks.push(LayoutBlock::PageBreak(false));
                }
                "br" | "cr" => text.push('\n'),
                "drawing" | "pict" => {
                    flush(&mut text, &mut styles, &mut blocks);
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
                _ => pending.extend(element.children.iter().rev().map(|node| (node, bold, italic))),
            }
        }
        flush(&mut text, &mut styles, &mut blocks);
        if blocks.len() == first_block {
            blocks.push(LayoutBlock::Text(String::new(), false, Vec::new()));
        }
    }
    render_blocks(blocks, title, filter, limit, page_size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::PageSource;

    #[test]
    fn preserves_empty_paragraphs() {
        let paragraph = |text| format!("<w:p><w:r><w:t>{text}</w:t></w:r></w:p>");
        for (blank, count) in [
            ("<w:p/>", 1), ("<w:p></w:p>", 1), ("<w:p><w:r/></w:p>", 1),
            ("<w:p><w:r><w:t></w:t></w:r></w:p>", 1),
            (r#"<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>"#, 1),
            ("<w:p/><w:p/>", 2),
        ] {
            for placement in ["middle", "leading", "overflow", "trailing"] {
                let body = match placement {
                    "middle" => paragraph("FIRST") + blank + &paragraph("SECOND"),
                    "leading" => blank.to_owned() + &paragraph("SECOND"),
                    "overflow" => paragraph("Filler").repeat(31) + &paragraph("FIRST") + blank + &paragraph("SECOND"),
                    _ => paragraph("Filler").repeat(32) + &paragraph("FIRST") + blank,
                };
                let convert = |body| {
                    let xml = format!(r#"<w:document xmlns:w="w"><w:body>{body}</w:body></w:document>"#);
                    let input = crate::commands::structured::write_zip_stored(&[("word/document.xml", xml.as_bytes())]);
                    render_docx(&input, "doc", None, 1 << 20).unwrap()
                };
                let bytes = convert(body);
                let mut pdf = PageSource::open(&bytes, "").unwrap();
                let pages = if placement == "overflow" || placement == "trailing" { 2 } else { 1 };
                assert_eq!(pdf.len(), pages, "{blank}, {placement}");
                let lines = pdf.text_lines(pages, None).unwrap();
                if placement == "trailing" {
                    assert!(lines.iter().all(|line| line.text.is_empty()));
                } else {
                    let second = lines.iter().find(|line| line.text.contains("SECOND")).unwrap();
                    let control = convert(paragraph("SECOND"));
                    let mut control = PageSource::open(&control, "").unwrap();
                    let control = control.text_lines(1, None).unwrap();
                    let offset = match placement { "middle" => -20 * (count + 1), "leading" => -20 * count, _ => -20 * (count - 1) };
                    assert!((second.bounds[1] - control[0].bounds[1] - f64::from(offset)).abs() < 0.001, "{blank}, {placement}");
                }
            }
        }
    }
}

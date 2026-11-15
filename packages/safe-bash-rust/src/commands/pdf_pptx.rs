use super::{pdf_copy::write_objects, pdf_render::PdfBitmap};
use crate::commands::{codecs, structured::xml};
use std::{borrow::Cow, collections::BTreeMap, io::Write};

fn elements<'a>(nodes: &'a [xml::Node], name: &str) -> Vec<&'a xml::Element> {
    let mut pending: Vec<_> = nodes.iter().rev().collect();
    let mut found = Vec::new();
    while let Some(node) = pending.pop() {
        if let xml::Node::Element(element) = node {
            if element.tag.rsplit(':').next() == Some(name) {
                found.push(element);
            }
            pending.extend(element.children.iter().rev());
        }
    }
    found
}
fn attr<'a>(element: &'a xml::Element, name: &str) -> Option<&'a str> {
    element
        .attrs
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}
fn number(element: &xml::Element, name: &str) -> Option<f64> {
    let value = attr(element, name)?.parse::<f64>().ok()?;
    value.is_finite().then_some(value / 12700.)
}
fn document(entries: &BTreeMap<String, Vec<u8>>, name: &str) -> Option<xml::Document> {
    xml::parse(std::str::from_utf8(entries.get(name)?).ok()?, None, None).ok()
}
fn relationships(
    entries: &BTreeMap<String, Vec<u8>>,
    owner: &str,
) -> Option<BTreeMap<String, String>> {
    let (directory, file) = owner.rsplit_once('/')?;
    let name = format!("{directory}/_rels/{file}.rels");
    if !entries.contains_key(&name) {
        return Some(BTreeMap::new());
    }
    let doc = document(entries, &name)?;
    let mut targets = BTreeMap::new();
    for rel in elements(&doc.nodes, "Relationship") {
        if attr(rel, "TargetMode") == Some("External") {
            continue;
        }
        let target = crate::vfs::resolve_posix_path(&format!("/{directory}"), attr(rel, "Target")?);
        targets.insert(
            attr(rel, "Id")?.to_owned(),
            target.trim_start_matches('/').to_owned(),
        );
    }
    Some(targets)
}

pub(in super::super) fn render_pptx(
    bytes: &[u8],
    filter: Option<&str>,
    limit: usize,
) -> Option<Vec<u8>> {
    let (members, _) =
        codecs::zip_directory(bytes.len(), |range| Ok(Cow::Borrowed(&bytes[range]))).ok()?;
    let mut entries = BTreeMap::new();
    let mut remaining = limit;
    for member in members {
        remaining = remaining.checked_sub(member.size)?;
        let data = member
            .decode(Cow::Borrowed(&bytes[member.payload.clone()]), None)
            .ok()?
            .into_owned();
        if entries.insert(member.name, data).is_some() {
            return None;
        }
    }
    let presentation = document(&entries, "ppt/presentation.xml")?;
    let sizes = elements(&presentation.nodes, "sldSz");
    let size = *sizes.first()?;
    let width = number(size, "cx")?;
    let height = number(size, "cy")?;
    if width <= 0. || height <= 0. {
        return None;
    }
    let targets = relationships(&entries, "ppt/presentation.xml")?;
    let mut bodies = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        Vec::new(),
        b"<< /Producer (@poe-code/pdf-ast) >>".to_vec(),
    ];
    let mut kids = Vec::new();
    let mut retained = 0usize;
    let lists = elements(&presentation.nodes, "sldIdLst");
    for id in elements(&lists.first()?.children, "sldId") {
        let relationship = id
            .attrs
            .iter()
            .find(|(name, _)| name.contains(':') && name.ends_with(":id"))?
            .1
            .as_str();
        let path = targets.get(relationship)?;
        let slide = document(&entries, path)?;
        let images = relationships(&entries, path)?;
        let mut stream = Vec::new();
        let mut resources = String::new();
        for (index, pic) in elements(&slide.nodes, "pic").iter().enumerate() {
            let blips = elements(&pic.children, "blip");
            let blip = *blips.first()?;
            let embed = blip
                .attrs
                .iter()
                .find(|(name, _)| name.rsplit(':').next() == Some("embed"))?
                .1
                .as_str();
            let image = entries.get(images.get(embed)?)?;
            if !image.starts_with(b"\x89PNG\r\n\x1a\n") && !image.starts_with(b"\xff\xd8") {
                return None;
            }
            let raster = super::super::png_pixels::Raster::decode(image, limit).ok()?;
            let offsets = elements(&pic.children, "off");
            let extents = elements(&pic.children, "ext");
            let off = *offsets.first()?;
            let ext = *extents.first()?;
            let x = number(off, "x")?;
            let top = number(off, "y")?;
            let w = number(ext, "cx")?;
            let h = number(ext, "cy")?;
            if w <= 0. || h <= 0. {
                return None;
            }
            let before = bodies.len();
            PdfBitmap::new(&raster.pixels, raster.width, raster.height).write(&mut bodies);
            for body in &bodies[before..] {
                retained = retained.checked_add(body.len())?;
            }
            if retained > limit {
                return None;
            }
            resources.push_str(&format!("/Im{index} {} 0 R ", bodies.len()));
            let n = |value| super::super::svg_format_num(value, 6);
            writeln!(
                stream,
                "q\n{} 0 0 {} {} {} cm\n/Im{index} Do\nQ",
                n(w),
                n(h),
                n(x),
                n(height - top - h)
            )
            .ok()?;
        }
        // Preserve actual slide text without inventing a title or a colored header.
        let mut y = height - 40.;
        for text in elements(&slide.nodes, "t") {
            let value = text
                .children
                .iter()
                .filter_map(|node| match node {
                    xml::Node::Text(t, _) | xml::Node::Cdata(t) => Some(t.as_str()),
                    _ => None,
                })
                .collect::<String>();
            if value.is_empty() {
                continue;
            }
            writeln!(stream, "BT /Body 18 Tf 1 0 0 1 40 {y} Tm").ok()?;
            super::pdf_copy::literal(&super::pdf_render::win_ansi(&value), &mut stream);
            stream.extend_from_slice(b" Tj ET\n");
            y -= 24.;
        }
        let content = bodies.len() + 1;
        let mut body = format!("<< /Length {} >>\nstream\n", stream.len()).into_bytes();
        body.extend_from_slice(&stream);
        body.extend_from_slice(b"endstream");
        bodies.push(body);
        kids.push(format!("{} 0 R", bodies.len() + 1));
        bodies.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Resources << /Font << /Body << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> >> /XObject << {resources} >> >> /Contents {content} 0 R >>").into_bytes());
        retained = retained.checked_add(stream.len())?;
        if retained > limit {
            return None;
        }
    }
    if kids.is_empty() {
        return None;
    }
    bodies[1] = format!(
        "<< /Type /Pages /Count {} /Kids [{}] >>",
        kids.len(),
        kids.join(" ")
    )
    .into_bytes();
    let pdf = write_objects(&bodies, limit)?;
    super::pdf_office::apply_filters(pdf, filter, kids.len(), limit)
}

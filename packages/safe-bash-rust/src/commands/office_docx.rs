use super::office_xml::writer_name;
// DOCX semantics of the production asynchronous/filesystem Office reader.
use super::office_xml::{Token, Xml as LexicalXml, entities};
use super::{
    html_escape_str,
    office::{
        DocumentBlock as Block, DocumentList as List, DocumentText as Text, TextStyle as Span,
        space,
    },
};
use crate::commands::codecs::zip_directory;
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

struct Xml<'a> {
    xml: LexicalXml<'a>,
}
impl<'a> Xml<'a> {
    fn new(source: &'a str) -> Result<Self, String> {
        LexicalXml::new(source)
            .map(|xml| Self { xml })
            .map_err(|error| format!("Error: conversion failed: {error}\n"))
    }
    fn name(&self, i: usize) -> &str {
        match &self.xml.tokens[i] {
            Token::Start { name, .. } => writer_name(name),
            _ => "",
        }
    }
    fn elements(&self, start: usize, end: usize, names: &[&str], empty: bool) -> Vec<usize> {
        let mut result = Vec::new();
        let mut i = start;
        while i < end {
            if names.contains(&self.name(i)) && self.xml.end(i) < end {
                if empty || self.xml.end(i) > i {
                    result.push(i);
                }
                i = self.xml.end(i);
            }
            i += 1;
        }
        result
    }
    fn children(&self, i: usize, names: &[&str], empty: bool) -> Vec<usize> {
        self.elements(i + 1, self.xml.end(i), names, empty)
    }
    fn attr(&self, i: usize, name: &str) -> Option<&str> {
        self.xml.attr(i, name).map(|(_, value)| value)
    }
    fn property(&self, i: usize, name: &str) -> Option<&str> {
        self.children(i, &[name], true)
            .into_iter()
            .find_map(|i| self.attr(i, "val"))
    }
    fn size(&self, i: usize) -> u64 {
        self.children(i, &["sz"], true)
            .into_iter()
            .find_map(|i| self.attr(i, "val")?.parse().ok())
            .unwrap_or(0)
    }
    fn style(&self, i: usize) -> (bool, bool) {
        let mut bold = false;
        let mut italic = false;
        for properties in self.children(i, &["rPr"], false) {
            for child in self.children(properties, &["b", "i"], true) {
                let enabled = self
                    .attr(child, "val")
                    .is_none_or(|v| matches!(v, "1" | "true" | "on"));
                if self.name(child) == "b" {
                    bold = enabled;
                } else {
                    italic = enabled;
                }
            }
        }
        (bold, italic)
    }
    fn text(&self, i: usize) -> Result<Text, String> {
        let mut value = String::new();
        let mut styles = Vec::new();
        let owners = self.children(i, &["r"], false);
        let owner_styles: Vec<_> = owners.iter().map(|&i| self.style(i)).collect();
        let mut owner = 0;
        for child in self.children(i, &["t", "tab", "br", "cr"], true) {
            let name = self.name(child);
            let start = value.len();
            if name == "t" {
                value.push_str(
                    &entities(self.xml.body(child))
                        .map_err(|error| format!("Error: conversion failed: {error}\n"))?,
                );
            } else if self.xml.end(child) == child {
                value.push(if name == "tab" { '\t' } else { ' ' });
            }
            while owner < owners.len() && self.xml.end(owners[owner]) < child {
                owner += 1;
            }
            if let Some(&o) = owners.get(owner)
                && o < child
            {
                let (bold, italic) = owner_styles[owner];
                if (bold || italic) && value.len() > start {
                    styles.push(Span {
                        start,
                        end: value.len(),
                        bold,
                        italic,
                    });
                }
            }
        }
        let trim = value.len() - value.trim_start_matches(space).len();
        let end = value.trim_end_matches(space).len().max(trim);
        styles = styles
            .into_iter()
            .filter_map(|s| {
                let start = s.start.max(trim).min(end) - trim;
                let end = s.end.min(end).saturating_sub(trim);
                (start < end).then_some(Span {
                    start,
                    end,
                    bold: s.bold,
                    italic: s.italic,
                })
            })
            .collect();
        let mut html = String::new();
        for (owner, (bold, italic)) in owners.into_iter().zip(owner_styles) {
            if bold {
                html.push_str("<b>");
            }
            if italic {
                html.push_str("<i>");
            }
            for child in self.children(owner, &["t", "tab", "br", "cr"], true) {
                let name = self.name(child);
                if name == "t" {
                    html.push_str(&html_escape_str(
                        &entities(self.xml.body(child))
                            .map_err(|error| format!("Error: conversion failed: {error}\n"))?,
                    ));
                } else if self.xml.end(child) == child {
                    html.push(if name == "tab" { '\t' } else { ' ' });
                }
            }
            if italic {
                html.push_str("</i>");
            }
            if bold {
                html.push_str("</b>");
            }
        }
        Ok(Text {
            value: value[trim..end].into(),
            html,
            styles,
        })
    }
}

struct Numbering<'a> {
    xml: Xml<'a>,
    abstracts: BTreeMap<String, usize>,
    instances: BTreeMap<String, usize>,
    counts: BTreeMap<String, Vec<Option<i64>>>,
}
impl<'a> Numbering<'a> {
    fn new(source: &'a str) -> Result<Self, String> {
        let xml = Xml::new(source)?;
        let mut abstracts = BTreeMap::new();
        let mut instances = BTreeMap::new();
        for i in xml.elements(0, xml.xml.tokens.len(), &["abstractNum", "num"], false) {
            if let Some(id) = xml.attr(i, "abstractNumId") {
                abstracts.insert(id.into(), i);
            } else if let Some(id) = xml.attr(i, "numId") {
                instances.insert(id.into(), i);
            }
        }
        Ok(Self {
            xml,
            abstracts,
            instances,
            counts: BTreeMap::new(),
        })
    }
    fn next(&mut self, owner: &Xml<'_>, paragraph: usize) -> Option<List> {
        let properties = *owner.children(paragraph, &["numPr"], false).first()?;
        let id = owner.property(properties, "numId")?;
        if id == "0" {
            return None;
        }
        let instance = *self.instances.get(id)?;
        let level: usize = owner
            .property(properties, "ilvl")
            .unwrap_or("0")
            .parse()
            .ok()?;
        if level > 8 {
            return None;
        }
        let mut definition = None;
        let mut start_override = None;
        for child in self.xml.children(instance, &["lvlOverride"], false) {
            if self
                .xml
                .attr(child, "ilvl")
                .unwrap_or("0")
                .parse::<usize>()
                .ok()
                != Some(level)
            {
                continue;
            }
            start_override = self.xml.property(child, "startOverride");
            definition = self.xml.children(child, &["lvl"], false).last().copied();
        }
        if definition.is_none()
            && let Some(abstract_id) = self.xml.property(instance, "abstractNumId")
            && let Some(&abstract_num) = self.abstracts.get(abstract_id)
        {
            definition = self
                .xml
                .children(abstract_num, &["lvl"], false)
                .into_iter()
                .find(|&i| {
                    self.xml
                        .attr(i, "ilvl")
                        .unwrap_or("0")
                        .parse::<usize>()
                        .ok()
                        == Some(level)
                });
        }
        let definition = definition?;
        let format = self.xml.property(definition, "numFmt").unwrap_or("");
        let template = entities(self.xml.property(definition, "lvlText").unwrap_or("")).ok()?;
        let start: i64 = start_override
            .unwrap_or_else(|| {
                self.xml
                    .property(definition, "start")
                    .filter(|s| !s.is_empty())
                    .unwrap_or("1")
            })
            .parse()
            .ok()?;
        if start.unsigned_abs() > 9_007_199_254_740_991 {
            return None;
        }
        let counts = self.counts.entry(id.into()).or_default();
        counts.resize(level + 1, None);
        let number = counts[level].map_or(Some(start), |n| n.checked_add(1))?;
        counts[level] = Some(number);
        let ordered = !matches!(format, "bullet" | "none");
        let mut marker = if template.is_empty() {
            if ordered {
                format!("%{}.", level + 1)
            } else {
                "•".into()
            }
        } else {
            template.into()
        };
        if ordered {
            for i in 0..9 {
                marker = marker.replace(
                    &format!("%{}", i + 1),
                    &counts.get(i).copied().flatten().unwrap_or(1).to_string(),
                );
            }
        }
        if format == "bullet"
            && marker
                .chars()
                .any(|c| ('\u{e000}'..='\u{f8ff}').contains(&c))
        {
            marker = "•".into();
        }
        if format == "none" {
            marker.clear();
        }
        Some(List {
            id: id.into(),
            level,
            ordered,
            number,
            marker,
        })
    }
}

pub(super) fn paragraph_markers(source: &str, numbering: &str) -> Result<Vec<String>, String> {
    let doc = Xml::new(source)?;
    let mut numbering = Numbering::new(numbering)?;
    Ok(doc.elements(0, doc.xml.tokens.len(), &["p"], false).into_iter()
        .map(|paragraph| numbering.next(&doc, paragraph)
            .map_or_else(String::new, |list| list.marker)).collect())
}

pub(super) fn read(bytes: &[u8], target: &str, limit: usize) -> Result<Vec<Block>, String> {
    let entries = (|| -> Result<BTreeMap<String, Vec<u8>>, String> {
        let (members, _) = zip_directory(bytes.len(), |range| Ok(Cow::Borrowed(&bytes[range])))?;
        let mut entries = BTreeMap::new();
        let mut remaining = limit;
        for member in members {
            remaining = remaining
                .checked_sub(member.size)
                .ok_or("document exceeds byte limit")?;
            if !matches!(member.method, 0 | 8) {
                return Err("ZIP unsupported compression method".into());
            }
            let decoded = member.decode(Cow::Borrowed(&bytes[member.payload.clone()]), None)?;
            entries.insert(member.name, decoded.into_owned());
        }
        Ok(entries)
    })()
    .map_err(|error| {
        let message = if error == "ZIP missing end record" {
            "ZIP truncated or missing end of central directory"
        } else {
            &error
        };
        format!("Error: conversion failed: {message}\n")
    })?;
    if !entries.contains_key("word/document.xml") {
        return Ok(Vec::new());
    }
    let parse = |name| -> Result<String, String> {
        entries.get(name).map_or_else(
            || Ok(String::new()),
            |bytes| {
                super::office_xml::decode(bytes)
                    .map_err(|error| format!("Error: conversion failed: {error}\n"))
            },
        )
    };
    let doc = parse("word/document.xml")?;
    let styles = if matches!(target, "html" | "docx" | "pdf") {
        parse("word/styles.xml")?
    } else {
        String::new()
    };
    let styles = Xml::new(&styles)?;
    let nums = parse("word/numbering.xml")?;
    let mut nums = Numbering::new(&nums)?;
    let rels = parse("word/_rels/document.xml.rels")?;
    let rels = Xml::new(&rels)?;
    let mut relationships = BTreeMap::new();
    for i in rels.elements(0, rels.xml.tokens.len(), &["Relationship"], true) {
        if let (Some(id), Some(target)) = (rels.attr(i, "Id"), rels.attr(i, "Target")) {
            let target = target.trim_start_matches('/');
            let target = if let Some(t) = target.strip_prefix("../") {
                t.into()
            } else if target.starts_with("word/") {
                target.into()
            } else {
                format!("word/{target}")
            };
            relationships.insert(id, target);
        }
    }
    let mut headings = BTreeSet::new();
    for i in styles.elements(0, styles.xml.tokens.len(), &["style"], false) {
        let Some(id) = styles.attr(i, "styleId") else {
            continue;
        };
        let id = id.to_lowercase();
        if id == "normal" {
            continue;
        }
        let name = styles.property(i, "name").unwrap_or("").to_lowercase();
        if id.starts_with("heading")
            || id == "title"
            || name.starts_with("heading")
            || name.contains("section")
            || matches!(name.as_str(), "title" | "subtitle")
            || styles.size(i) >= 26
            || styles.size(i) >= 24 && !styles.children(i, &["b"], true).is_empty()
        {
            headings.insert(id);
        }
    }
    let doc = Xml::new(&doc)?;
    let mut blocks = Vec::new();
    let mut retained = 0usize;
    for i in doc.elements(0, doc.xml.tokens.len(), &["p", "tbl"], false) {
        if doc.name(i) == "tbl" {
            let mut rows = Vec::new();
            for row in doc.children(i, &["tr"], false) {
                let cells: Vec<_> = doc
                    .children(row, &["tc"], false)
                    .into_iter()
                    .map(|cell| doc.text(cell))
                    .collect::<Result<_, _>>()?;
                for cell in &cells {
                    retained = retained.saturating_add(cell.value.len() + cell.html.len());
                }
                if !cells.is_empty() {
                    rows.push(cells);
                }
            }
            if !rows.is_empty() {
                blocks.push(Block::Table(rows));
            }
        } else {
            let mut text = doc.text(i)?;
            let list = nums.next(&doc, i);
            if !text.value.is_empty() || list.is_some() {
                let style = doc.property(i, "pStyle").unwrap_or("").to_lowercase();
                let heading = style.starts_with("heading")
                    || matches!(style.as_str(), "title" | "subtitle")
                    || headings.contains(&style)
                    || doc.size(i) >= 28;
                if let Some(list) = &list
                    && !list.marker.is_empty()
                {
                    let prefix = list.marker.clone() + " ";
                    for span in &mut text.styles {
                        span.start += prefix.len();
                        span.end += prefix.len();
                    }
                    text.value.insert_str(0, &prefix);
                }
                retained = retained.saturating_add(text.value.len() + text.html.len());
                blocks.push(Block::Paragraph {
                    text,
                    heading,
                    list,
                });
            }
            for drawing in doc.children(i, &["drawing", "pict"], false) {
                let image = (drawing..doc.xml.end(drawing)).find_map(|j| doc.attr(j, "embed"));
                if target == "pdf" && image.is_some() && image.and_then(|id| relationships.get(id)).and_then(|path| entries.get(path)).is_none() {
                    return Err("Error: conversion failed: Missing referenced DOCX image\n".into());
                }
                if let Some(image_path) = image.and_then(|id| relationships.get(id))
                    && let Some(bytes) = entries.get(image_path)
                {
                    let mut width: f64 = 432.;
                    let mut height: f64 = 226.8;
                    if let Some(extent) = doc.children(drawing, &["extent", "ext"], true).into_iter().next() {
                        let number = |name, fallback| -> Result<f64, String> {
                            let Some(value) = doc.attr(extent, name) else { return Ok(fallback); };
                            let value = value.trim();
                            let number = value.parse::<f64>().ok().filter(|v| v.is_finite() && *v > 0.);
                            if target != "pdf" {
                                return Ok(value.parse::<f64>().unwrap_or(fallback * 12700.).max(1.) / 12700.);
                            }
                            if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) || number.is_none() {
                                return Err("Error: conversion failed: Invalid DOCX image dimension\n".into());
                            }
                            Ok(number.unwrap() / 12700.)
                        };
                        width = number("cx", 432.)?;
                        height = number("cy", 226.8)?;
                    }
                    if width > 504. {
                        height *= 504. / width;
                        width = 504.;
                    }
                    if !width.is_finite() || !height.is_finite() {
                        return Err(
                            "Error: conversion failed: image dimensions exceed resource limits\n"
                                .into(),
                        );
                    }
                    if target == "pdf" && super::png_pixels::Raster::decode(bytes, limit).is_err() {
                        let message = if bytes.starts_with(b"\xff\xd8") { "Invalid JPEG dimensions" } else { "Invalid referenced DOCX image" };
                        return Err(format!("Error: conversion failed: {message}\n"));
                    }
                    retained = retained.saturating_add(bytes.len());
                    if retained > limit {
                        return Err(
                            "Error: conversion failed: document exceeds byte limit\n".into()
                        );
                    }
                    blocks.push(Block::Image {
                        bytes: bytes.clone(),
                        width,
                        height,
                    });
                }
            }
        }
        if retained > limit {
            return Err("Error: conversion failed: document exceeds byte limit\n".into());
        }
    }
    Ok(blocks)
}

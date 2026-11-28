//! Retain SpreadsheetML text runs in the editable workbook's existing representation.
use super::super::model::TextRun;
use super::{LIMIT, attr, colors::Palette, elements, text, xml};
use std::sync::Arc;

pub(super) fn read(
    nodes: &[xml::Node],
    colors: &Palette,
    remaining: &mut usize,
) -> Result<Option<Arc<Vec<TextRun>>>, String> {
    if !nodes.iter().any(
        |node| matches!(node, xml::Node::Element(el) if el.tag.rsplit(':').next() == Some("r")),
    ) {
        return Ok(None);
    }
    *remaining = remaining.checked_sub(64).ok_or(LIMIT)?;
    let mut runs = Vec::new();
    for node in nodes {
        let xml::Node::Element(run) = node else {
            continue;
        };
        let kind = run.tag.rsplit(':').next().unwrap_or("");
        if !matches!(kind, "r" | "t") {
            continue; // Phonetic guides are not part of the cell's displayed text.
        }
        *remaining = remaining
            .checked_sub(std::mem::size_of::<TextRun>() + 64)
            .ok_or(LIMIT)?;
        let mut attributes = Vec::new();
        for props in elements(&run.children, "rPr") {
            for node in &props.children {
                let xml::Node::Element(prop) = node else {
                    continue;
                };
                let name = prop.tag.rsplit(':').next().unwrap_or("");
                let value = attr(prop, "val");
                let pair = match name {
                    "b" | "i" | "strike" | "outline" | "shadow" => {
                        let key = match name {
                            "b" => "bold",
                            "i" => "italic",
                            "strike" => "strikethrough",
                            "outline" => "outline",
                            _ => "shadow",
                        };
                        match value {
                            None | Some("1" | "true" | "on") => Some((key, "1".into())),
                            Some("0" | "false" | "off") => Some((key, "0".into())),
                            _ => None,
                        }
                    }
                    "sz" => value
                        .and_then(|v| v.parse::<f64>().ok())
                        .map(|n| n * 1024.)
                        .filter(|n| n.is_finite() && *n > 0.)
                        .map(|n| ("size", n.to_string())),
                    "rFont" => value.map(|v| ("family", super::super::xlsx_string::decode(v))),
                    "family" | "charset" => value.and_then(|v| v.parse::<u8>().ok()).map(|n| {
                        (
                            if name == "family" {
                                "font-family-class"
                            } else {
                                "font-charset"
                            },
                            n.to_string(),
                        )
                    }),
                    "color" => colors.resolve(prop).map(|v| ("color", v)),
                    "u" => match value.unwrap_or("single") {
                        v @ ("single" | "double" | "singleAccounting" | "doubleAccounting"
                        | "none") => Some(("underline", v.into())),
                        _ => None,
                    },
                    "vertAlign" => match value {
                        Some("subscript") => Some(("subscript", "1".into())),
                        Some("superscript") => Some(("superscript", "1".into())),
                        _ => None,
                    },
                    _ => None,
                };
                if let Some((key, value)) = pair {
                    *remaining = remaining.checked_sub(value.len() + 64).ok_or(LIMIT)?;
                    attributes.push((key, value));
                }
            }
        }
        let mut value = String::new();
        let portions = if kind == "t" {
            vec![run]
        } else {
            elements(&run.children, "t")
        };
        for portion in portions {
            let content = super::super::xlsx_string::decode(&text(portion));
            *remaining = remaining.checked_sub(content.len()).ok_or(LIMIT)?;
            value.push_str(&content);
        }
        runs.push(TextRun {
            text: value,
            attributes: Arc::new(attributes),
        });
    }
    Ok(Some(Arc::new(runs)))
}

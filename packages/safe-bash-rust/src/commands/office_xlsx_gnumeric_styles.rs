use super::{attr, boolean, elements, index, number, text};
use crate::commands::structured::{
    xlsx::{Style, TextRun},
    xml::{Element, Node},
};
use std::{collections::BTreeMap, sync::Arc};

fn put(values: &mut Vec<(&'static str, String)>, key: &'static str, value: String) {
    if let Some((_, old)) = values.iter_mut().find(|(k, _)| *k == key) {
        *old = value;
    } else {
        values.push((key, value));
    }
}
fn tint(rgb: &str, amount: f64) -> String {
    if amount.abs() < 0.005 {
        return rgb.to_ascii_uppercase();
    }
    let [r, g, b] =
        [0, 2, 4].map(|i| i32::from_str_radix(rgb.get(i..i + 2).unwrap_or(""), 16).unwrap_or(0));
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    let sum = max + min;
    let mut light = (sum * 240 + 255) / 510;
    let mut saturation = 0;
    let mut hue = 0;
    if delta != 0 {
        saturation = if light <= 120 {
            (delta * 240 + sum / 2) / sum
        } else {
            (delta * 240 + (510 - sum) / 2) / (510 - sum)
        };
        hue = if max == r {
            (g - b) * 240 / (6 * delta)
        } else if max == g {
            80 + (b - r) * 240 / (6 * delta)
        } else {
            160 + (r - g) * 240 / (6 * delta)
        };
        hue = hue.rem_euclid(240);
    }
    let amount = amount.clamp(-1., 1.);
    light = if amount < 0. {
        f64::from(light) * (1. + amount)
    } else {
        f64::from(light) * (1. - amount) + 240. * amount
    } as i32;
    if saturation == 0 {
        return format!("{:02X}", light * 255 / 240).repeat(3);
    }
    let m2 = if light <= 120 {
        (light * (240 + saturation) + 120) / 240
    } else {
        light + saturation - (light * saturation + 120) / 240
    };
    let m1 = 2 * light - m2;
    let channel = |mut h| {
        if h < 0 {
            h += 240;
        }
        if h > 240 {
            h -= 240;
        }
        // Match xlsx-ast's integer tint arithmetic, including the descending
        // channel's rounding term and wrapping of the resulting byte.
        let value = if h < 40 {
            m1 + ((m2 - m1) * h + 20) / 40
        } else if h < 120 {
            m2
        } else if h < 160 {
            m1 + (m2 - m1) * (160 - h + 20) / 40
        } else {
            m1
        };
        ((value * 255 + 120) / 240) as u8
    };
    format!(
        "{:02X}{:02X}{:02X}",
        channel(hue + 80),
        channel(hue),
        channel(hue - 80)
    )
}
fn color(el: &Element, theme: &[String], rich: bool) -> Result<Option<String>, String> {
    let numeric = |key| {
        let n = crate::commands::js_number(attr(el, key).unwrap_or("0"), 0.);
        if n.is_finite() {
            Ok(n)
        } else {
            Err("Error: conversion failed: E Invalid XLSX: invalid style number\n".to_owned())
        }
    };
    let rgb = if let Some(rgb) = attr(el, "rgb") {
        if rgb.len() != 8 || !rgb.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("Error: conversion failed: E Invalid XLSX: invalid style color\n".into());
        }
        &rgb[2..]
    } else if attr(el, "indexed").is_some() {
        let index = numeric("indexed")?;
        let colors = [
            "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
            "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
            "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
            "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
            "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
            "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
            "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
        ];
        if index == 65. {
            "FFFFFF"
        } else if index == 80. {
            "FFFF00"
        } else if (0. ..64.).contains(&index) && index.fract() == 0. {
            colors[if index < 8. {
                index as usize
            } else {
                index as usize - 8
            }]
        } else {
            "000000"
        }
    } else if !rich && attr(el, "theme").is_some() {
        let index = numeric("theme")?;
        if index >= 0. && index < theme.len() as f64 && index.fract() == 0. {
            &theme[index as usize]
        } else {
            "000000"
        }
    } else if rich {
        "000000"
    } else {
        return Ok(None);
    };
    Ok(Some(format!(
        "FF{}",
        if rich {
            rgb.to_ascii_uppercase()
        } else {
            tint(rgb, numeric("tint")?)
        }
    )))
}
pub(super) fn string(nodes: &[Node]) -> Result<(String, Option<Arc<Vec<TextRun>>>), String> {
    let portions = elements(nodes, "r");
    if portions.is_empty() {
        return Ok((
            elements(nodes, "t")
                .iter()
                .map(|e| super::super::xlsx_string::decode(&text(e)))
                .collect(),
            None,
        ));
    }
    let mut runs = Vec::new();
    let mut value = String::new();
    for portion in portions {
        let content: String = elements(&portion.children, "t")
            .iter()
            .map(|e| super::super::xlsx_string::decode(&text(e)))
            .collect();
        let mut attributes = Vec::new();
        if let Some(props) = elements(&portion.children, "rPr").first() {
            for node in &props.children {
                if let Node::Element(p) = node {
                    let val = attr(p, "val");
                    match p.tag.rsplit(':').next().unwrap() {
                        "b" => put(
                            &mut attributes,
                            "bold",
                            u8::from(val.is_none() || boolean(val)).to_string(),
                        ),
                        "i" => put(
                            &mut attributes,
                            "italic",
                            u8::from(val.is_none() || boolean(val)).to_string(),
                        ),
                        "strike" => put(
                            &mut attributes,
                            "strikethrough",
                            u8::from(val.is_none() || boolean(val)).to_string(),
                        ),
                        "rFont" => {
                            if let Some(val) = val {
                                put(
                                    &mut attributes,
                                    "family",
                                    super::super::xlsx_string::decode(val),
                                );
                            }
                        }
                        "sz" => put(
                            &mut attributes,
                            "size",
                            (number(p, "val").unwrap_or(0.).clamp(0., 1000.) * 1024.)
                                .trunc()
                                .to_string(),
                        ),
                        "color" => {
                            if let Some(rgb) = color(p, &[], true)? {
                                put(&mut attributes, "color", rgb);
                            }
                        }
                        "u" => put(&mut attributes, "underline", val.unwrap_or("single").into()),
                        "vertAlign" => match val {
                            Some("subscript") => put(&mut attributes, "subscript", "1".into()),
                            Some("superscript") => put(&mut attributes, "superscript", "1".into()),
                            _ => {}
                        },
                        _ => {}
                    }
                }
            }
        }
        value.push_str(&content);
        runs.push(TextRun {
            text: content,
            attributes: Arc::new(attributes),
        });
    }
    Ok((value, Some(Arc::new(runs))))
}
pub(super) fn read(nodes: &[Node], theme: &[Node]) -> Result<Vec<(String, Arc<Style>)>, String> {
    let scheme = elements(theme, "clrScheme");
    let colors: Vec<_> = [
        "lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5",
        "accent6", "hlink", "folHlink",
    ]
    .iter()
    .map(|name| {
        scheme
            .first()
            .and_then(|s| elements(&s.children, name).first().copied())
            .and_then(|e| {
                e.children.iter().find_map(|n| {
                    if let Node::Element(e) = n {
                        Some(e)
                    } else {
                        None
                    }
                })
            })
            .and_then(|e| {
                attr(
                    e,
                    if e.tag.rsplit(':').next() == Some("sysClr") {
                        "lastClr"
                    } else {
                        "val"
                    },
                )
            })
            .unwrap_or(if *name == "lt1" { "FFFFFF" } else { "000000" })
            .to_owned()
    })
    .collect();
    let fonts = elements(nodes, "fonts")
        .first()
        .map(|e| elements(&e.children, "font"))
        .unwrap_or_default();
    let fills = elements(nodes, "fills")
        .first()
        .map(|e| elements(&e.children, "fill"))
        .unwrap_or_default();
    let borders = elements(nodes, "borders")
        .first()
        .map(|e| elements(&e.children, "border"))
        .unwrap_or_default();
    let mut formats: BTreeMap<usize, String> = BTreeMap::new();
    for fmt in elements(nodes, "numFmts")
        .first()
        .into_iter()
        .flat_map(|table| elements(&table.children, "numFmt"))
    {
        if let (Some(id), Some(code)) = (index(fmt, "numFmtId"), attr(fmt, "formatCode")) {
            formats.insert(id, code.into());
        }
    }
    let materialize = |xf: &Element, parent: Option<&(String, Arc<Style>)>| {
        let mut style = parent.map_or_else(
            || Style {
                attributes: vec![
                    ("HAlign", "general"),
                    ("VAlign", "bottom"),
                    ("WrapText", "0"),
                    ("ShrinkToFit", "0"),
                    ("Rotation", "0"),
                    ("Shade", "0"),
                    ("Indent", "0"),
                    ("Locked", "1"),
                    ("Hidden", "0"),
                    ("Fore", "FF000000"),
                    ("Back", "FFFFFFFF"),
                    ("PatternColor", "FF000000"),
                ]
                .into_iter()
                .map(|(k, v)| (k, v.into()))
                .collect(),
                font: vec![
                    ("Unit", "10"),
                    ("Bold", "0"),
                    ("Italic", "0"),
                    ("Underline", "0"),
                    ("StrikeThrough", "0"),
                    ("Script", "0"),
                ]
                .into_iter()
                .map(|(k, v)| (k, v.into()))
                .collect(),
                family: "Sans".into(),
                borders: Vec::new(),
                hyperlink: Vec::new(),
                text: String::new(),
            },
            |(_, s)| s.as_ref().clone(),
        );
        let format = index(xf, "numFmtId")
            .and_then(|id| {
                formats.get(&id).cloned().or_else(|| match id {
                    12 => Some("# ?/?".into()),
                    13 => Some("# ??/??".into()),
                    14 => Some("[$-f8f2]m/d/yy".into()),
                    15 => Some("d-mmm-yy".into()),
                    16 => Some("d-mmm".into()),
                    17 => Some("mmm-yy".into()),
                    47 => Some("mmss.0".into()),
                    _ => super::super::dates::builtin(id).map(str::to_owned),
                })
            })
            .or_else(|| parent.map(|p| p.0.clone()))
            .unwrap_or_else(|| "General".into());
        if let Some(font) = index(xf, "fontId").and_then(|i| fonts.get(i)) {
            for node in &font.children {
                if let Node::Element(p) = node {
                    let val = attr(p, "val");
                    match p.tag.rsplit(':').next().unwrap() {
                        "name" => {
                            if let Some(val) = val {
                                style.family = super::super::xlsx_string::decode(val)
                            }
                        }
                        "sz" => put(
                            &mut style.font,
                            "Unit",
                            number(p, "val").unwrap_or(0.).to_string(),
                        ),
                        "b" => put(
                            &mut style.font,
                            "Bold",
                            u8::from(val.is_none() || boolean(val)).to_string(),
                        ),
                        "i" => put(
                            &mut style.font,
                            "Italic",
                            u8::from(val.is_none() || boolean(val)).to_string(),
                        ),
                        "strike" => put(
                            &mut style.font,
                            "StrikeThrough",
                            u8::from(val.is_none() || boolean(val)).to_string(),
                        ),
                        "u" => put(
                            &mut style.font,
                            "Underline",
                            match val {
                                Some("none") => "0",
                                Some("double") => "2",
                                Some("singleAccounting") => "3",
                                Some("doubleAccounting") => "4",
                                _ => "1",
                            }
                            .into(),
                        ),
                        "vertAlign" => put(
                            &mut style.font,
                            "Script",
                            match val {
                                Some("superscript") => "1",
                                Some("subscript") => "-1",
                                _ => "0",
                            }
                            .into(),
                        ),
                        "color" => {
                            if let Some(rgb) = color(p, &colors, false)? {
                                put(&mut style.attributes, "Fore", rgb);
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        if let Some(fill) = index(xf, "fillId").and_then(|i| fills.get(i))
            && let Some(pattern) = elements(&fill.children, "patternFill").first()
        {
            let patterns = [
                "none",
                "solid",
                "darkGray",
                "mediumGray",
                "lightGray",
                "gray125",
                "gray0625",
                "darkHorizontal",
                "darkVertical",
                "darkUp",
                "darkDown",
                "darkGrid",
                "darkTrellis",
                "lightHorizontal",
                "lightVertical",
                "lightDown",
                "lightUp",
                "lightGrid",
                "lightTrellis",
            ];
            put(
                &mut style.attributes,
                "Shade",
                patterns
                    .iter()
                    .position(|v| Some(*v) == attr(pattern, "patternType"))
                    .unwrap_or(1)
                    .to_string(),
            );
            for (key, source) in [("Back", "fgColor"), ("PatternColor", "bgColor")] {
                if let Some(rgb) = elements(&pattern.children, source)
                    .first()
                    .map(|p| color(p, &colors, false))
                    .transpose()?
                    .flatten()
                {
                    put(&mut style.attributes, key, rgb);
                }
            }
        }
        if let Some(border) = index(xf, "borderId").and_then(|i| borders.get(i)) {
            style.borders.clear();
            for (source, target) in [
                ("top", "Top"),
                ("bottom", "Bottom"),
                ("left", "Left"),
                ("right", "Right"),
            ] {
                if let Some(edge) = elements(&border.children, source).first() {
                    let styles = [
                        "none",
                        "thin",
                        "medium",
                        "dashed",
                        "dotted",
                        "thick",
                        "double",
                        "hair",
                        "mediumDashed",
                        "dashDot",
                        "mediumDashDot",
                        "dashDotDot",
                        "mediumDashDotDot",
                        "slantDashDot",
                    ];
                    let line = styles
                        .iter()
                        .position(|s| Some(*s) == attr(edge, "style"))
                        .unwrap_or(0) as u8;
                    if line > 0 {
                        style.borders.push((
                            target,
                            line,
                            elements(&edge.children, "color")
                                .first()
                                .map(|e| color(e, &colors, false))
                                .transpose()?
                                .flatten()
                                .unwrap_or_else(|| "FF000000".into()),
                        ));
                    }
                }
            }
        }
        if let Some(align) = elements(&xf.children, "alignment").first() {
            for (source, key, default) in [
                ("horizontal", "HAlign", "general"),
                ("vertical", "VAlign", "bottom"),
            ] {
                put(
                    &mut style.attributes,
                    key,
                    attr(align, source).unwrap_or(default).into(),
                );
            }
            for (source, key) in [("wrapText", "WrapText"), ("shrinkToFit", "ShrinkToFit")] {
                put(
                    &mut style.attributes,
                    key,
                    u8::from(boolean(attr(align, source))).to_string(),
                );
            }
            put(
                &mut style.attributes,
                "Rotation",
                number(align, "textRotation").unwrap_or(0.).to_string(),
            );
            put(
                &mut style.attributes,
                "Indent",
                number(align, "indent").unwrap_or(0.).to_string(),
            );
        }
        if let Some(protection) = elements(&xf.children, "protection").first() {
            for (source, key) in [("locked", "Locked"), ("hidden", "Hidden")] {
                let val = attr(protection, source);
                put(
                    &mut style.attributes,
                    key,
                    u8::from(val.is_none() || boolean(val)).to_string(),
                );
            }
        }
        Ok((format, Arc::new(style)))
    };
    let parents: Vec<_> = elements(nodes, "cellStyleXfs")
        .first()
        .map(|el| elements(&el.children, "xf"))
        .unwrap_or_default()
        .iter()
        .map(|xf| materialize(xf, None))
        .collect::<Result<_, String>>()?;
    elements(nodes, "cellXfs")
        .first()
        .map(|el| elements(&el.children, "xf"))
        .unwrap_or_default()
        .iter()
        .map(|xf| materialize(xf, index(xf, "xfId").and_then(|i| parents.get(i))))
        .collect()
}

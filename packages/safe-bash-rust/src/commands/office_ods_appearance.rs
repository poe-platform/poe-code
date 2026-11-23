use super::{LIMIT, attr, js_number};
use crate::commands::structured::{
    xlsx::Style,
    xml::{Element, Node},
};
use std::sync::Arc;

pub(super) fn set(
    values: &mut Vec<(&'static str, String)>,
    name: &'static str,
    value: impl Into<String>,
) {
    if let Some((_, old)) = values.iter_mut().find(|(k, _)| *k == name) {
        *old = value.into();
    } else {
        values.push((name, value.into()));
    }
}
pub(super) fn color(value: Option<&str>) -> Option<String> {
    let rgb = value?.strip_prefix('#')?;
    (rgb.len() == 6 && rgb.bytes().all(|c| c.is_ascii_hexdigit()))
        .then(|| format!("FF{}", rgb.to_ascii_uppercase()))
}
pub(super) fn distance(value: Option<&str>) -> Option<f64> {
    let value = value?;
    let split = value.len().checked_sub(2)?;
    let unit = match value.get(split..)? {
        "cm" => 72. / 2.54,
        "mm" => 72. / 25.4,
        "in" => 72.,
        "pt" => 1.,
        "pc" => 12.,
        _ => return None,
    };
    js_number(
        value
            .get(..split)?
            .trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}'),
    )
    .filter(|v| *v >= 0.)
    .map(|v| v * unit)
}
pub(super) fn read(
    node: &Element,
    generic: bool,
    parent: Option<&Style>,
    remaining: &mut usize,
) -> Result<Arc<Style>, String> {
    if parent.is_some_and(|p| p.retained_bytes() > *remaining) {
        return Err(LIMIT.into());
    }
    let mut style = parent.cloned().unwrap_or_else(|| Style {
        family: "Sans".into(),
        ..Default::default()
    });
    for node in &node.children {
        let Node::Element(p) = node else { continue };
        if !p.tag.starts_with("style:")
            && p.tag != "{http://openoffice.org/2000/style}table-properties"
            || !p.tag.ends_with("properties")
            || p.tag == "style:properties" && !generic
        {
            continue;
        }
        if let Some(c) = color(attr(p, "fo:background-color")) {
            set(&mut style.attributes, "Back", c);
            set(&mut style.attributes, "Shade", "1");
        }
        if let Some(c) = color(attr(p, "gnm:background-colour")) {
            set(&mut style.attributes, "Back", c);
        }
        if let Some(c) = color(attr(p, "gnm:pattern-colour")) {
            set(&mut style.attributes, "PatternColor", c);
        }
        if let Some(n) = attr(p, "gnm:pattern")
            .and_then(js_number)
            .filter(|n| *n > 0. && n.fract() == 0.)
        {
            set(&mut style.attributes, "Shade", n.to_string());
        }
        if let Some(v) = attr(p, "fo:wrap-option") {
            set(
                &mut style.attributes,
                "WrapText",
                if v == "wrap" { "1" } else { "0" },
            );
        }
        if let Some(v) = attr(p, "style:cell-protect") {
            set(
                &mut style.attributes,
                "Locked",
                if v.contains("protected") && v != "unprotected" {
                    "1"
                } else {
                    "0"
                },
            );
            if v.contains("formula-hidden") {
                set(&mut style.attributes, "Hidden", "1");
            }
        }
        if let Some(c) = color(attr(p, "fo:color")) {
            set(&mut style.attributes, "Fore", c);
        }
        if let Some(v) = attr(p, "fo:text-align").and_then(|v| match v {
            "start" | "left" => Some("left"),
            "end" | "right" => Some("right"),
            "center" => Some("center"),
            "justify" => Some("justify"),
            _ => None,
        }) {
            set(&mut style.attributes, "HAlign", v);
        }
        if let Some(v) = attr(p, "style:vertical-align").and_then(|v| match v {
            "top" => Some("top"),
            "middle" => Some("center"),
            "bottom" => Some("bottom"),
            "justify" => Some("justify"),
            _ => None,
        }) {
            set(&mut style.attributes, "VAlign", v);
        }
        if let Some(n) = attr(p, "style:rotation-angle").and_then(js_number) {
            set(
                &mut style.attributes,
                "Rotation",
                if n == 0. { "0".into() } else { n.to_string() },
            );
        }
        if let Some(v) = attr(p, "style:shrink-to-fit") {
            set(
                &mut style.attributes,
                "ShrinkToFit",
                if v == "true" { "1" } else { "0" },
            );
        }
        if let Some(v) = distance(attr(p, "fo:font-size")) {
            set(
                &mut style.font,
                "Unit",
                if v.is_infinite() {
                    "Infinity".into()
                } else {
                    v.to_string()
                },
            );
        }
        if let Some(v) = attr(p, "fo:font-weight") {
            set(
                &mut style.font,
                "Bold",
                if v == "bold"
                    || matches!(v.trim(), "Infinity" | "+Infinity")
                    || js_number(v).is_some_and(|n| n >= 600.)
                {
                    "1"
                } else {
                    "0"
                },
            );
        }
        if let Some(v) = attr(p, "fo:font-style") {
            set(
                &mut style.font,
                "Italic",
                if matches!(v, "italic" | "oblique") {
                    "1"
                } else {
                    "0"
                },
            );
        }
        if let Some(v) = attr(p, "style:text-underline-style") {
            let kind = attr(p, "style:text-underline-type");
            let double =
                kind == Some("double") || attr(p, "style:text-underline-width") == Some("bold");
            let underline = if v == "none" || kind == Some("none") {
                0
            } else {
                (if double { 2 } else { 1 })
                    + if attr(p, "gnm:text-underline-placement") == Some("low") {
                        2
                    } else {
                        0
                    }
            };
            set(&mut style.font, "Underline", underline.to_string());
        }
        if let Some(v) = attr(p, "style:text-line-through-style") {
            set(
                &mut style.font,
                "StrikeThrough",
                if v == "none" { "0" } else { "1" },
            );
        }
        if let Some(v) = attr(p, "style:text-position") {
            let token = v.trim().split([' ', '\t', '\r', '\n']).next().unwrap_or("");
            let script = match token {
                "sub" => Some("-1"),
                "super" => Some("1"),
                _ => token
                    .strip_suffix('%')
                    .filter(|s| !s.is_empty())
                    .and_then(js_number)
                    .filter(|n| *n == 0.)
                    .map(|_| "0"),
            };
            if let Some(v) = script {
                set(&mut style.font, "Script", v);
            }
        }
        if let Some(v) = attr(p, "fo:font-family").or_else(|| attr(p, "style:font-name")) {
            style.family = v.into();
        }
        for (side, target) in [
            ("fo:border-top", "Top"),
            ("fo:border-bottom", "Bottom"),
            ("fo:border-left", "Left"),
            ("fo:border-right", "Right"),
        ] {
            let Some(border) = attr(p, side)
                .or_else(|| attr(p, "fo:border"))
                .filter(|s| !s.is_empty())
            else {
                continue;
            };
            let parts: Vec<_> = border.split(' ').filter(|s| !s.is_empty()).collect();
            let width = distance(parts.first().copied());
            let line = if border == "none" {
                Some("none")
            } else {
                parts.get(1).copied()
            };
            let kind = match line {
                Some("none") => Some(0),
                Some("double") => Some(6),
                Some("dashed") => Some(4),
                Some("dotted") => Some(7),
                _ => width.map(|w| {
                    if w > 2.5 {
                        5
                    } else if w > 1. {
                        2
                    } else {
                        1
                    }
                }),
            };
            if let Some(kind) = kind {
                let c = color(parts.get(2).copied()).unwrap_or("FF000000".into());
                if let Some(edge) = style.borders.iter_mut().find(|(s, _, _)| *s == target) {
                    edge.1 = kind;
                    edge.2 = c;
                } else {
                    style.borders.push((target, kind, c));
                }
            }
        }
        if style.retained_bytes() > *remaining {
            return Err(LIMIT.into());
        }
    }
    *remaining = remaining.checked_sub(style.retained_bytes()).ok_or(LIMIT)?;
    Ok(Arc::new(style))
}

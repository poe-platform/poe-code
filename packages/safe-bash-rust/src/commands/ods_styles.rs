use super::escaped;
use crate::commands::structured::xlsx::{Print, Scale, Style, display_number};
use std::fmt::Write;

pub(super) fn cell(style: Option<&Style>, number: bool, name: &str, extended: bool) -> String {
    let mut out = format!(r#"<style:style style:name="{name}" style:family="table-cell""#);
    if number {
        write!(out, r#" style:data-style-name="N{name}""#).unwrap();
    }
    out.push_str("><style:table-cell-properties");
    let default = Style::default();
    let style = style.unwrap_or(&default);
    let a = |key| {
        style
            .attributes
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.as_str())
    };
    let f = |key| {
        style
            .font
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.as_str())
    };
    let color = |s: &str| format!("#{}", s.get(2..).unwrap_or(s).to_ascii_lowercase());
    let attribute = |out: &mut String, key: &str, value: &str| {
        write!(out, " {key}=\"{}\"", escaped(value)).unwrap();
    };
    if a("Shade").is_some_and(|s| s != "0") {
        if let Some(c) = a("Back") {
            attribute(&mut out, "fo:background-color", &color(c));
        }
    }
    if extended {
        if let Some(shade) = a("Shade") {
            attribute(&mut out, "gnm:pattern", shade);
            for (key, target) in [
                ("Back", "gnm:background-colour"),
                ("PatternColor", "gnm:pattern-colour"),
            ] {
                if let Some(c) = a(key) {
                    attribute(&mut out, target, &color(c));
                }
            }
        }
    }
    if let Some(v) = a("WrapText") {
        attribute(
            &mut out,
            "fo:wrap-option",
            if v == "0" { "no-wrap" } else { "wrap" },
        );
    }
    if let Some(v) = a("ShrinkToFit") {
        attribute(
            &mut out,
            "style:shrink-to-fit",
            if v == "0" { "false" } else { "true" },
        );
    }
    if let Some(v) = a("Rotation") {
        attribute(&mut out, "style:rotation-angle", v);
    }
    if a("Locked").is_some() || a("Hidden").is_some() {
        attribute(
            &mut out,
            "style:cell-protect",
            match (
                a("Hidden").is_some_and(|v| v != "0"),
                a("Locked").is_some_and(|v| v != "0"),
            ) {
                (true, true) => "formula-hidden protected",
                (true, false) => "formula-hidden",
                (false, true) => "protected",
                (false, false) => "none",
            },
        );
    }
    if let Some(v) = a("VAlign").and_then(|v| match v {
        "top" | "1" | "GNM_VALIGN_TOP" => Some("top"),
        "bottom" | "2" | "GNM_VALIGN_BOTTOM" => Some("bottom"),
        "center" | "4" | "GNM_VALIGN_CENTER" => Some("middle"),
        _ => None,
    }) {
        attribute(&mut out, "style:vertical-align", v);
    }
    for (side, line, c) in &style.borders {
        let side = match *side {
            "Top" => "top",
            "Bottom" => "bottom",
            "Left" => "left",
            "Right" => "right",
            _ => continue,
        };
        let i = usize::from(*line);
        let width = [0., 1., 2., 1., 1., 3., 1., 0.5, 2., 1., 2., 1., 2.]
            .get(i)
            .copied()
            .unwrap_or(1.);
        let line = [
            "none",
            "solid",
            "solid",
            "dashed",
            "dotted",
            "solid",
            "double",
            "solid",
            "dashed",
            "dash-dot",
            "dash-dot",
            "dash-dot-dot",
            "dash-dot-dot",
        ]
        .get(i)
        .copied()
        .unwrap_or("solid");
        attribute(
            &mut out,
            &format!("fo:border-{side}"),
            &format!(
                "{}pt {line} {}",
                display_number(width),
                color(if c.is_empty() { "FF000000" } else { c })
            ),
        );
    }
    out.push_str("/><style:paragraph-properties");
    if let Some(v) = a("HAlign").and_then(|v| match v {
        "left" | "2" | "GNM_HALIGN_LEFT" => Some("start"),
        "right" | "4" | "GNM_HALIGN_RIGHT" => Some("end"),
        "center" | "8" | "GNM_HALIGN_CENTER" => Some("center"),
        "justify" | "GNM_HALIGN_JUSTIFY" => Some("justify"),
        _ => None,
    }) {
        attribute(&mut out, "fo:text-align", v);
    }
    out.push_str("/><style:text-properties");
    if let Some(c) = a("Fore") {
        attribute(&mut out, "fo:color", &color(c));
    }
    if !style.font.is_empty() {
        attribute(&mut out, "fo:font-family", &style.family);
        if let Some(v) = f("Unit") {
            attribute(&mut out, "fo:font-size", &format!("{v}pt"));
        }
        if let Some(v) = f("Bold") {
            attribute(
                &mut out,
                "fo:font-weight",
                if v == "0" { "normal" } else { "bold" },
            );
        }
        if let Some(v) = f("Italic") {
            attribute(
                &mut out,
                "fo:font-style",
                if v == "0" { "normal" } else { "italic" },
            );
        }
        if let Some(v) = f("Underline") {
            attribute(
                &mut out,
                "style:text-underline-style",
                if v == "0" { "none" } else { "solid" },
            );
            attribute(
                &mut out,
                "style:text-underline-type",
                match v {
                    "0" => "none",
                    "2" | "4" => "double",
                    _ => "single",
                },
            );
            attribute(&mut out, "style:text-underline-width", "auto");
            attribute(&mut out, "style:text-underline-color", "font-color");
            attribute(&mut out, "style:text-underline-mode", "continuous");
            if extended && matches!(v, "3" | "4") {
                attribute(&mut out, "gnm:text-underline-placement", "low");
            }
        }
        if let Some(v) = f("StrikeThrough") {
            attribute(
                &mut out,
                "style:text-line-through-style",
                if v == "0" { "none" } else { "solid" },
            );
        }
        if let Some(v) = f("Script") {
            attribute(
                &mut out,
                "style:text-position",
                match v {
                    "-1" => "sub 80%",
                    "0" => "0% 100%",
                    _ => "super 80%",
                },
            );
        }
    }
    out.push_str("/></style:style>");
    out
}

pub(super) fn print<'a>(
    print: Option<&Print>,
    records: impl Iterator<Item = &'a super::super::xml::Element>,
    extended: bool,
) -> String {
    use super::super::{ssconvert::gnumeric_read::attr, xlsx::attribute_number, xml::Node};
    let mut records = records.peekable();
    if records.peek().is_some() {
        let mut attributes = Vec::<(String, String)>::new();
        let mut set = |key: String, value: String| {
            if let Some((_, old)) = attributes.iter_mut().find(|(name, _)| *name == key) {
                *old = value;
            } else {
                attributes.push((key, value));
            }
        };
        for record in records {
            for node in &record.children {
                let Node::Element(node) = node else { continue };
                match node.tag.rsplit(':').next().unwrap() {
                    "orientation" => set(
                        "style:print-orientation".into(),
                        crate::commands::archive::office::xml_text(node),
                    ),
                    "Margins" => {
                        for margin in &node.children {
                            let Node::Element(margin) = margin else {
                                continue;
                            };
                            let side = margin.tag.rsplit(':').next().unwrap();
                            if matches!(side, "top" | "bottom" | "left" | "right")
                                && let Some(points) =
                                    attr(margin, "Points").filter(|s| !s.is_empty())
                            {
                                set(format!("fo:margin-{side}"), format!("{points}pt"));
                            }
                        }
                    }
                    "Scale" if attr(node, "type") == Some("fit") => {
                        let cols = attr(node, "cols").unwrap_or("");
                        let rows = attr(node, "rows").unwrap_or("");
                        if extended {
                            for (axis, value) in [("X", cols), ("Y", rows)] {
                                if crate::commands::js_number(value, 0.) > 0. {
                                    set(format!("gnm:scale-to-{axis}"), value.into());
                                }
                            }
                        } else {
                            let cols = crate::commands::js_number(cols, 0.);
                            let rows = crate::commands::js_number(rows, 0.);
                            if cols > 0. && rows > 0. {
                                set("style:scale-to-pages".into(), attribute_number(cols * rows));
                            }
                        }
                    }
                    "Scale" => {
                        if let Some(scale) = attr(node, "percentage").filter(|s| !s.is_empty()) {
                            set("style:scale-to".into(), format!("{scale}%"));
                        }
                    }
                    _ => {}
                }
            }
        }
        return attributes
            .into_iter()
            .map(|(key, value)| format!(" {key}=\"{}\"", escaped(&value)))
            .collect();
    }
    let mut out = String::new();
    if let Some(print) = print {
        if let Some(margins) = print.margins {
            for (side, value) in [
                ("top", margins[2]),
                ("bottom", margins[3]),
                ("left", margins[0]),
                ("right", margins[1]),
            ] {
                if let Some(value) = value {
                    write!(out, r#" fo:margin-{side}="{}pt""#, display_number(value)).unwrap();
                }
            }
        }
        match print.scale {
            Some(Scale::Percentage(n)) => {
                write!(out, r#" style:scale-to="{}%""#, display_number(n)).unwrap()
            }
            Some(Scale::Fit(cols, rows)) if extended => {
                for (axis, n) in [("X", cols), ("Y", rows)] {
                    if n > 0. {
                        write!(out, r#" gnm:scale-to-{axis}="{}""#, display_number(n)).unwrap();
                    }
                }
            }
            Some(Scale::Fit(cols, rows)) if cols > 0. && rows > 0. => write!(
                out,
                r#" style:scale-to-pages="{}""#,
                display_number(cols * rows)
            )
            .unwrap(),
            _ => {}
        }
        if let Some(orientation) = print.orientation {
            write!(out, r#" style:print-orientation="{orientation}""#).unwrap();
        }
    }
    out
}

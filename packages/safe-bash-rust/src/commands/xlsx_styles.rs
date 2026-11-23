use super::{SS, XML, builtin_format, escaped};
use std::{collections::BTreeMap, fmt::Write};

pub(super) const FILL_PATTERNS: [&str; 25] = [
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
    "lightVertical",
    "darkHorizontal",
    "lightGray",
    "lightGray",
    "darkGray",
    "solid",
];

// Field order and XML text are part of imported style identity, even when the
// explicit/default fields and inherited properties render identically.
#[derive(Clone, Default, Eq, PartialEq, Ord, PartialOrd)]
pub(in crate::commands) struct Style {
    pub attributes: Vec<(&'static str, String)>,
    pub font: Vec<(&'static str, String)>,
    pub family: String,
    pub borders: Vec<(&'static str, u8, String)>,
    pub hyperlink: Vec<(&'static str, String)>,
    pub text: String,
}
// XLSX serializes hyperlinks separately from styles. ODS retains the complete
// imported hyperlink record.
type Key<'a> = (
    &'a str,
    Option<(
        &'a [(&'static str, String)],
        &'a [(&'static str, String)],
        &'a str,
        &'a [(&'static str, u8, String)],
        &'a str,
    )>,
);
pub(super) fn key<'a>((format, style): (&'a str, Option<&'a Style>)) -> Key<'a> {
    (
        format,
        style.map(|s| {
            (
                s.attributes.as_slice(),
                s.font.as_slice(),
                s.family.as_str(),
                s.borders.as_slice(),
                s.text.as_str(),
            )
        }),
    )
}
impl Style {
    pub fn retained_bytes(&self) -> usize {
        std::mem::size_of::<Self>()
            + self.family.len()
            + self.text.len()
            + self
                .attributes
                .iter()
                .chain(&self.font)
                .chain(&self.hyperlink)
                .map(|(_, v)| std::mem::size_of::<(&str, String)>() + v.len())
                .sum::<usize>()
            + self
                .borders
                .iter()
                .map(|(_, _, c)| std::mem::size_of::<(&str, u8, String)>() + c.len())
                .sum::<usize>()
    }
    pub fn fill_pattern(&self) -> Option<&'static str> {
        let shade = self
            .attributes
            .iter()
            .find(|(k, _)| *k == "Shade")
            .map_or(Some(0), |(_, v)| v.parse::<usize>().ok())?;
        FILL_PATTERNS.get(shade).copied()
    }
}
pub(super) fn write(
    styles: &[(&str, Option<&Style>)],
    xlsx_2006: bool,
    differentials: &str,
    limit: usize,
) -> Option<String> {
    let default = Style::default();
    let mut custom = Vec::new();
    let mut custom_ids = BTreeMap::new();
    let mut fonts = BTreeMap::new();
    let mut fills = BTreeMap::from([
        (
            "<fill><patternFill patternType=\"none\"/></fill>".to_owned(),
            0,
        ),
        (
            "<fill><patternFill patternType=\"gray125\"/></fill>".to_owned(),
            1,
        ),
    ]);
    let mut borders = BTreeMap::new();
    let mut xfs = String::new();
    let mut default_xf = String::new();
    let mut remaining = limit;
    let mut intern = |s: String, values: &mut BTreeMap<String, usize>| -> Option<usize> {
        if let Some(&i) = values.get(&s) {
            return Some(i);
        }
        remaining = remaining.checked_sub(s.len() + std::mem::size_of::<(String, usize)>() + 32)?;
        let id = values.len();
        values.insert(s, id);
        Some(id)
    };
    for (index, &(format, style)) in styles.iter().enumerate() {
        let style = style.unwrap_or(&default);
        let a = |key, default| {
            style
                .attributes
                .iter()
                .find(|(k, _)| *k == key)
                .map_or(default, |(_, v)| v.as_str())
        };
        let f = |key, default| {
            style
                .font
                .iter()
                .find(|(k, _)| *k == key)
                .map_or(default, |(_, v)| v.as_str())
        };
        let underline = match f("Underline", "0") {
            "1" => "single",
            "2" => "double",
            "3" => "singleAccounting",
            "4" => "doubleAccounting",
            _ => "none",
        };
        let script = match f("Script", "0") {
            "1" => "superscript",
            "-1" => "subscript",
            _ => "baseline",
        };
        let name = if style.family.is_empty() {
            "Sans"
        } else {
            &style.family
        };
        let font = format!(
            r#"<font><b val="{}"/><i val="{}"/><u val="{underline}"/><color rgb="{}"/><name val="{}"/><vertAlign val="{script}"/><sz val="{}"/><strike val="{}"/></font>"#,
            f("Bold", "0"),
            f("Italic", "0"),
            a("Fore", "FF000000"),
            escaped(name),
            f("Unit", "10"),
            f("StrikeThrough", "0")
        );
        let font_id = intern(font, &mut fonts)?;
        let pattern = style.fill_pattern()?;
        let colors = if a("Shade", "0") != "0"
            || style
                .attributes
                .iter()
                .any(|(k, _)| matches!(*k, "Back" | "PatternColor"))
        {
            format!(
                r#"><fgColor rgb="{}"/><bgColor rgb="{}"/></patternFill>"#,
                a("Back", "FFFFFFFF"),
                a("PatternColor", "FF000000")
            )
        } else {
            "/>".into()
        };
        let fill_id = intern(
            format!(r#"<fill><patternFill patternType="{pattern}"{colors}</fill>"#),
            &mut fills,
        )?;
        let mut border = format!(
            "<border diagonalUp=\"{}\" diagonalDown=\"{}\">",
            u8::from(
                style
                    .borders
                    .iter()
                    .any(|(name, _, _)| *name == "Rev-Diagonal")
            ),
            u8::from(style.borders.iter().any(|(name, _, _)| *name == "Diagonal")),
        );
        for (source, target) in [
            ("Left", if xlsx_2006 { "left" } else { "start" }),
            ("Right", if xlsx_2006 { "right" } else { "end" }),
            ("Top", "top"),
            ("Bottom", "bottom"),
            ("Diagonal", "diagonal"),
            ("Rev-Diagonal", "diagonal"),
        ] {
            let edge = style.borders.iter().find(|(name, _, _)| *name == source);
            if edge.is_none() && target == "diagonal" {
                continue;
            }
            let line = [
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
            ]
            .get(edge.map_or(0, |(_, n, _)| *n as usize))
            .copied()
            .unwrap_or("none");
            let color = edge
                .filter(|(_, _, color)| !color.is_empty())
                .map_or("FFC7C7C7", |(_, _, color)| color.as_str());
            write!(
                border,
                r#"<{target} style="{line}"><color rgb="{color}"/></{target}>"#
            )
            .ok()?;
        }
        border.push_str("</border>");
        let border_id = intern(border, &mut borders)?;
        let format_id = builtin_format(format).unwrap_or_else(|| {
            *custom_ids.entry(format).or_insert_with(|| {
                let id = 100 + custom.len();
                custom.push(format);
                id
            })
        });
        let attrs = format!(
            r#"fontId="{font_id}" fillId="{fill_id}" borderId="{border_id}" numFmtId="{format_id}""#
        );
        let rotation = a("Rotation", "0").parse::<f64>().ok()?;
        let rotation = if rotation < 0. {
            90. - rotation
        } else {
            rotation
        };
        let properties = format!(
            r#"<alignment horizontal="{}" vertical="{}" wrapText="{}" shrinkToFit="{}" textRotation="{rotation}" indent="0"/><protection locked="{}" hidden="{}"/>"#,
            a("HAlign", "general"),
            a("VAlign", "bottom"),
            a("WrapText", "0"),
            a("ShrinkToFit", "0"),
            a("Locked", "1"),
            a("Hidden", "0")
        );
        if index == 0 {
            default_xf = format!("<xf {attrs}>{properties}</xf>");
        }
        write!(xfs,r#"<xf applyAlignment="1" applyBorder="1" applyFont="1" applyFill="1" applyNumberFormat="1" {attrs} xfId="0">{properties}</xf>"#).ok()?;
        if xfs.len() > limit {
            return None;
        }
    }
    let mut out = format!("{XML}<styleSheet xmlns=\"{SS}\">");
    if !custom.is_empty() {
        write!(out, "<numFmts count=\"{}\">", custom.len()).ok()?;
        for (i, format) in custom.iter().enumerate() {
            write!(
                out,
                "<numFmt formatCode=\"{}\" numFmtId=\"{}\"/>",
                escaped(format),
                100 + i
            )
            .ok()?;
        }
        out.push_str("</numFmts>");
    }
    for (name, parts) in [("fonts", fonts), ("fills", fills), ("borders", borders)] {
        write!(out, "<{name} count=\"{}\">", parts.len()).ok()?;
        let mut parts: Vec<_> = parts.into_iter().collect();
        parts.sort_unstable_by_key(|(_, id)| *id);
        for (part, _) in parts {
            out.push_str(&part);
            if out.len() > limit {
                return None;
            }
        }
        write!(out, "</{name}>").ok()?;
    }
    write!(out,r#"<cellStyleXfs count="1">{default_xf}</cellStyleXfs><cellXfs count="{}">{xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>{differentials}</styleSheet>"#,styles.len()).ok()?;
    out.push('\n');
    (out.len() <= limit).then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stylesheet_limit_includes_escaped_font_and_number_format() {
        let style = Style {
            family: "&".repeat(1024),
            ..Default::default()
        };
        let format = "\"<\"".repeat(1024);
        for styles in [
            vec![("General", None), ("General", Some(&style))],
            vec![("General", None), (format.as_str(), None)],
        ] {
            let xml = write(&styles, false, "", 32_768).unwrap();
            assert!(xml.contains("&amp;") || xml.contains("&lt;"));
            assert!(write(&styles, false, "", xml.len() - 1).is_none());
            assert_eq!(
                write(&styles, false, "", xml.len()).as_deref(),
                Some(xml.as_str())
            );
            assert!(write(&styles, false, "", 4096).is_none());
        }
    }
}

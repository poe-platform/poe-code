use super::{SS, XML, builtin_format, escaped};
use std::{collections::BTreeMap, fmt::Write};

// Field order is retained. Complete Excel styles normalize default empty border
// edges on import; differential styles retain explicit removals for overlays.
#[derive(Clone, Default, Eq, PartialEq, Ord, PartialOrd)]
pub struct Style {
    pub attributes: Vec<(&'static str, String)>,
    pub font: Vec<(&'static str, String)>,
    pub family: String,
    pub borders: Vec<(&'static str, u8, String)>,
}
impl Style {
    pub fn retained_bytes(&self) -> usize {
        std::mem::size_of::<Self>()
            + self.family.len()
            + self
                .attributes
                .iter()
                .chain(&self.font)
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
        [
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
        ]
        .get(shade)
        .copied()
    }
}
pub(super) fn write(
    styles: &[(&str, Option<&Style>)],
    conditional: &[super::super::ConditionalFormat],
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
        let implicit = style.is_none();
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
        // An explicit style with no color means automatic/inherited foreground.
        // Keep the legacy default font for cells with no authored style at all.
        let color = match style.attributes.iter().find(|(k, _)| *k == "Fore") {
            Some((_, value)) => format!(r#"<color rgb="{}"/>"#, escaped(value)),
            None if implicit => r#"<color rgb="FF000000"/>"#.into(),
            None => String::new(),
        };
        let font = format!(
            r#"<font><b val="{}"/><i val="{}"/><u val="{underline}"/>{color}<name val="{}"/><vertAlign val="{script}"/><sz val="{}"/><strike val="{}"/></font>"#,
            f("Bold", "0"),
            f("Italic", "0"),
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
        let mut border = String::from("<border diagonalUp=\"0\" diagonalDown=\"0\">");
        for (source, target) in [
            ("Left", "start"),
            ("Right", "end"),
            ("Top", "top"),
            ("Bottom", "bottom"),
        ] {
            let Some((_, kind, color)) = style.borders.iter().find(|(name, _, _)| *name == source)
            else {
                write!(border, "<{target}/>").ok()?;
                continue;
            };
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
            .get(*kind as usize)
            .copied()
            .unwrap_or("none");
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
    write!(out,r#"<cellStyleXfs count="1">{default_xf}</cellStyleXfs><cellXfs count="{}">{xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>"#,styles.len()).ok()?;
    if !conditional.is_empty() {
        write!(out, "<dxfs count=\"{}\">", conditional.len()).ok()?;
        for (i, rule) in conditional.iter().enumerate() {
            out.push_str(&differential(
                &rule.style,
                rule.format.as_deref(),
                (100 + custom.len()).max(164) + i,
                limit.checked_sub(out.len())?,
            )?);
        }
        out.push_str("</dxfs>");
    }
    out.push_str("</styleSheet>");
    out.push('\n');
    (out.len() <= limit).then_some(out)
}

fn differential(
    style: &Style,
    format: Option<&str>,
    format_id: usize,
    limit: usize,
) -> Option<String> {
    // A dxf is an overlay: omitted properties must remain omitted. Reusing the
    // fully defaulted cell-XF writer would reset higher/lower-priority styling.
    let mut out = String::from("<dxf>");
    let mut font = String::new();
    for (key, value) in &style.font {
        let (tag, value) = match *key {
            "Bold" => ("b", value.as_str()),
            "Italic" => ("i", value.as_str()),
            "StrikeThrough" => ("strike", value.as_str()),
            "Unit" => ("sz", value.as_str()),
            "Underline" => (
                "u",
                match value.as_str() {
                    "1" => "single",
                    "2" => "double",
                    "3" => "singleAccounting",
                    "4" => "doubleAccounting",
                    _ => "none",
                },
            ),
            "Script" => (
                "vertAlign",
                match value.as_str() {
                    "1" => "superscript",
                    "-1" => "subscript",
                    _ => "baseline",
                },
            ),
            _ => continue,
        };
        write!(font, "<{tag} val=\"{}\"/>", escaped(value)).ok()?;
    }
    if !style.family.is_empty() {
        write!(font, "<name val=\"{}\"/>", escaped(&style.family)).ok()?;
    }
    if let Some((_, color)) = style.attributes.iter().find(|(k, _)| *k == "Fore") {
        write!(font, "<color rgb=\"{}\"/>", escaped(color)).ok()?;
    }
    if !font.is_empty() {
        write!(out, "<font>{font}</font>").ok()?;
    }
    if let Some(format) = format {
        write!(
            out,
            "<numFmt numFmtId=\"{format_id}\" formatCode=\"{}\"/>",
            escaped(format)
        )
        .ok()?;
    }
    if style
        .attributes
        .iter()
        .any(|(k, _)| matches!(*k, "Shade" | "Back" | "PatternColor"))
    {
        write!(
            out,
            "<fill><patternFill patternType=\"{}\">",
            style.fill_pattern()?
        )
        .ok()?;
        for (key, tag) in [("Back", "fgColor"), ("PatternColor", "bgColor")] {
            if let Some((_, color)) = style.attributes.iter().find(|(k, _)| *k == key) {
                write!(out, "<{tag} rgb=\"{}\"/>", escaped(color)).ok()?;
            }
        }
        out.push_str("</patternFill></fill>");
    }
    let mut alignment = String::new();
    let mut protection = String::new();
    for (key, value) in &style.attributes {
        let name = match *key {
            "HAlign" => "horizontal",
            "VAlign" => "vertical",
            "WrapText" => "wrapText",
            "ShrinkToFit" => "shrinkToFit",
            "Rotation" => "textRotation",
            "Locked" => "locked",
            "Hidden" => "hidden",
            _ => continue,
        };
        let value = if *key == "Rotation" {
            let n = value.parse::<f64>().ok().filter(|n| n.is_finite())?;
            if n < 0. {
                (90. - n).to_string()
            } else {
                value.clone()
            }
        } else {
            value.clone()
        };
        write!(
            if matches!(*key, "Locked" | "Hidden") {
                &mut protection
            } else {
                &mut alignment
            },
            " {name}=\"{}\"",
            escaped(&value)
        )
        .ok()?;
    }
    if !alignment.is_empty() {
        write!(out, "<alignment{alignment}/>").ok()?;
    }
    if !style.borders.is_empty() {
        out.push_str("<border>");
        for (key, line, color) in &style.borders {
            let tag = match *key {
                "Left" => "left",
                "Right" => "right",
                "Top" => "top",
                "Bottom" => "bottom",
                _ => continue,
            };
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
            .get(*line as usize)?;
            write!(
                out,
                "<{tag} style=\"{line}\"><color rgb=\"{}\"/></{tag}>",
                escaped(color)
            )
            .ok()?;
        }
        out.push_str("</border>");
    }
    if !protection.is_empty() {
        write!(out, "<protection{protection}/>").ok()?;
    }
    out.push_str("</dxf>");
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
            let xml = write(&styles, &[], 32_768).unwrap();
            assert!(xml.contains("&amp;") || xml.contains("&lt;"));
            assert!(write(&styles, &[], xml.len() - 1).is_none());
            assert_eq!(
                write(&styles, &[], xml.len()).as_deref(),
                Some(xml.as_str())
            );
            assert!(write(&styles, &[], 4096).is_none());
        }
    }
}

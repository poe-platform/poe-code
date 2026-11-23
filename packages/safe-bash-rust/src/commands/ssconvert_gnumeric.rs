use super::{Workbook, xlsx};
use crate::commands::archive::{
    office::{formulas, xml_attribute as attr, xml_elements as elements},
    office_ods::formula,
};
use std::fmt::Write;
#[path = "ssconvert_gnumeric_xlsx.rs"]
mod metadata;
#[path = "ssconvert_gnumeric_records.rs"]
mod records;

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\r', "&#13;")
}
fn element(name: &str, attrs: &[(&str, String)], text: &str, nested: &str, depth: usize) -> String {
    let indent = "  ".repeat(depth);
    let mut out = format!("{indent}<gnm:{name}");
    for (key, value) in attrs {
        write!(
            out,
            " {key}=\"{}\"",
            escape(value).replace('\n', "&#10;").replace('\t', "&#9;")
        )
        .unwrap();
    }
    if !nested.is_empty() {
        write!(out, ">\n{nested}{indent}</gnm:{name}>\n").unwrap();
    } else if !text.is_empty() {
        writeln!(out, ">{}</gnm:{name}>", escape(text)).unwrap();
    } else {
        out.push_str("/>\n");
    }
    out
}
fn precision(n: f64) -> String {
    if n == 0. {
        return "0".into();
    }
    let scientific = format!("{n:.3e}");
    let (mantissa, exp) = scientific.split_once('e').unwrap();
    let exp: i32 = exp.parse().unwrap();
    if !(-4..4).contains(&exp) {
        format!(
            "{}e{}{:02}",
            mantissa.trim_end_matches('0').trim_end_matches('.'),
            if exp < 0 { "-" } else { "+" },
            exp.abs()
        )
    } else {
        let text = format!("{n:.precision$}", precision = (3 - exp).max(0) as usize);
        if text.contains('.') {
            text.trim_end_matches('0').trim_end_matches('.').into()
        } else {
            text
        }
    }
}
fn color(s: &str) -> String {
    let s = s.strip_prefix("FF").filter(|_| s.len() == 8).unwrap_or(s);
    if s.len() != 6 {
        return s.into();
    }
    (0..3)
        .map(|i| {
            u8::from_str_radix(&s[i * 2..i * 2 + 2], 16)
                .map(|n| format!("{:X}", u16::from(n) * 257))
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(":")
}
fn rich_text(runs: &[xlsx::TextRun]) -> Result<Option<String>, String> {
    let mut out = String::from("@");
    let mut start = 0;
    for run in runs {
        let end = start + run.text.len();
        if start != end {
            for (key, value) in run.attributes.iter() {
                let value = match *key {
                    "underline" => match value.as_str() {
                        "double" | "doubleAccounting" | "none" => value.clone(),
                        "singleAccounting" => "low".into(),
                        _ => "single".into(),
                    },
                    "color" => value.as_bytes()[value.len().saturating_sub(6)..]
                        .chunks(2)
                        .map(|v| String::from_utf8_lossy(v))
                        .collect::<Vec<_>>()
                        .join("x"),
                    _ => value.clone(),
                };
                if value.contains(':') {
                    return Err(
                        "E Invalid Gnumeric XML: invalid rich text attribute value\n".into(),
                    );
                }
                write!(out, "[{key}={value}:{start}:{end}]").unwrap();
            }
        }
        start = end;
    }
    Ok((out.len() > 1).then_some(out))
}
fn style(style: Option<&xlsx::Style>, format: Option<&str>, links: &str) -> String {
    let mut attrs = Vec::new();
    let mut nested = String::new();
    if let Some(style) = style {
        for (key, value) in &style.attributes {
            if *key == "Format" {
                continue;
            }
            let value = match *key {
                "HAlign" | "VAlign" if value.bytes().any(|b| b.is_ascii_lowercase()) => format!(
                    "GNM_{}ALIGN_{}",
                    if *key == "HAlign" { "H" } else { "V" },
                    value
                        .to_ascii_uppercase()
                        .replace("CENTERCONTINUOUS", "CENTER_ACROSS_SELECTION")
                ),
                "Fore" | "Back" | "PatternColor" => color(value),
                _ => value.clone(),
            };
            attrs.push((*key, value));
        }
        if !style.font.is_empty() || !style.family.is_empty() {
            nested.push_str(&element(
                "Font",
                &style.font,
                if style.family.is_empty() {
                    "Sans"
                } else {
                    &style.family
                },
                "",
                6,
            ));
        }
        let borders = style
            .borders
            .iter()
            .map(|(key, value, color_value)| {
                element(
                    key,
                    &[("Style", value.to_string()), ("Color", color(color_value))],
                    "",
                    "",
                    7,
                )
            })
            .collect::<String>();
        if !borders.is_empty() {
            nested.push_str(&element("StyleBorder", &[], "", &borders, 6));
        }
    }
    if let Some(format) = format.filter(|f| !f.starts_with("@[")) {
        attrs.push(("Format", format.into()));
    }
    nested.push_str(links);
    element("Style", &attrs, "", &nested, 5)
}
fn names(
    book: &Workbook,
    sheet: Option<usize>,
    work: &mut usize,
    depth: usize,
) -> Result<String, String> {
    let mut out = String::new();
    for (index, name) in book
        .properties
        .names
        .iter()
        .enumerate()
        .filter(|(_, n)| n.sheet == sheet)
    {
        let source = name.openformula.as_deref().unwrap_or(&name.expression);
        let (value, relative_sheets) = formula::gnumeric_text(source, true, work)?;
        let position = format!(
            "{}{}",
            super::xlsx_idx_to_col_ref(name.position.2.max(0) as usize),
            name.position.1.max(0) + 1
        );
        let body = element("name", &[], &name.name, "", depth + 2)
            + &element(
                "value",
                &[],
                value.strip_prefix('=').unwrap_or(&value),
                "",
                depth + 2,
            )
            + &element("position", &[], &position, "", depth + 2);
        let mut attrs = Vec::new();
        if book.properties.array_string_names.contains(&index) {
            attrs.extend([
                ("xmlns:ssc", "urn:poe-code:ssconvert:formulas:1".into()),
                ("ssc:array-string-literals", "1".into()),
            ]);
        }
        if let Some(source) = &name.openformula
            && (book.properties.odf.is_none() || relative_sheets)
        {
            if attrs.is_empty() {
                attrs.push(("xmlns:ssc", "urn:poe-code:ssconvert:formulas:1".into()));
            }
            attrs.push(("ssc:openformula", source.clone()));
            let (sheet, row, column) = name.position;
            let sheet = super::super::JVal::Str(book.sheets[sheet].name.clone())
                .to_json_string(true, false, 0);
            attrs.push((
                "ssc:openformula-origin",
                format!("[{sheet},{row},{column}]"),
            ));
        }
        out.push_str(&element("Name", &attrs, "", &body, depth + 1));
    }
    Ok(if out.is_empty() {
        out
    } else {
        element("Names", &[], "", &out, depth)
    })
}
pub(in super::super) fn write(
    book: &Workbook,
    shortest: bool,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let failure = "ssconvert: Gnumeric XML output exceeds byte limit\n";
    let props = &book.properties;
    let mut work = limit;
    let mut body = element(
        "Version",
        &[
            ("Epoch", "1".into()),
            ("Major", "12".into()),
            ("Minor", "61".into()),
            ("Full", "1.12.61".into()),
        ],
        "",
        "",
        1,
    );
    if let Some(root) = &props.gnumeric {
        body.push_str(&records::parts(root, "Attributes", 1));
    }
    body.push_str(&crate::commands::archive::office::xlsx_gnumeric::properties::gnumeric(props)?);
    if props.date1904 {
        body.push_str(&element("DateConvention", &[], "1904", "", 1));
    }
    let iteration = props.iteration.as_ref();
    let mut calc = vec![
        ("ManualRecalc", u8::from(props.manual).to_string()),
        (
            "EnableIteration",
            u8::from(iteration.is_none_or(|i| i.enabled)).to_string(),
        ),
        (
            "MaxIterations",
            iteration.map_or(100, |i| i.maximum).to_string(),
        ),
        (
            "IterationTolerance",
            super::super::xlsx::attribute_number(iteration.map_or(0.001, |i| i.tolerance)),
        ),
    ];
    if props.date1904 {
        calc.push(("gnm:DateConvention", "Apple:1904".into()));
    }
    calc.extend([("FloatRadix", "2".into()), ("FloatDigits", "53".into())]);
    body.push_str(&element("Calculation", &calc, "", "", 1));
    let mut index = String::new();
    for (i, sheet) in book.sheets.iter().enumerate() {
        let size = props.sheet_sizes.get(i).copied().unwrap_or((65536, 256));
        index.push_str(&element(
            "SheetName",
            &[
                ("gnm:Cols", size.1.to_string()),
                ("gnm:Rows", size.0.to_string()),
            ],
            &sheet.name,
            "",
            2,
        ));
    }
    body.push_str(&element("SheetNameIndex", &[], "", &index, 1));
    body.push_str(&names(book, None, &mut work, 1)?);
    if let Some(root) = &props.gnumeric {
        body.push_str(&records::parts(root, "Geometry", 1));
    }
    let mut sheets = String::new();
    for (i, sheet) in book.sheets.iter().enumerate() {
        let typed = sheet.typed.as_ref().ok_or(failure)?;
        let gnumeric = super::gnumeric_read::source_sheet(props.gnumeric.as_ref(), &sheet.name);
        let source = book.source.as_ref().and_then(|s| s.sheets.get(i));
        let raw = source.map(Vec::as_slice).unwrap_or(&[]);
        let mut attrs = [
            ("DisplayFormulas", "0"),
            ("HideZero", "0"),
            ("HideGrid", "0"),
            ("HideColHeader", "0"),
            ("HideRowHeader", "0"),
            ("DisplayOutlines", "1"),
            ("OutlineSymbolsBelow", "1"),
            ("OutlineSymbolsRight", "1"),
        ]
        .map(|(k, v)| (k, v.into()))
        .to_vec();
        if source.is_some() {
            metadata::view(raw, &mut attrs);
        } else if props.odf.is_some() && typed.view.iter().any(|(key, _)| *key == "rightToLeft") {
            attrs.push((
                "RTL_Layout",
                u8::from(typed.view.contains(&("rightToLeft", true))).to_string(),
            ));
        }
        if let Some(r1c1) = typed.sylk_r1c1 {
            attrs.push((
                "ExprConvention",
                format!("gnumeric:{}", if r1c1 { "R1C1" } else { "A1" }),
            ));
        }
        let visibility = book
            .source
            .as_ref()
            .and_then(|s| {
                elements(&s.workbook, "sheet")
                    .get(i)
                    .and_then(|e| attr(e, "state"))
            })
            .unwrap_or("");
        attrs.push((
            "Visibility",
            format!(
                "GNM_SHEET_VISIBILITY_{}",
                match visibility {
                    "hidden" => "HIDDEN",
                    "veryHidden" => "VERY_HIDDEN",
                    _ => "VISIBLE",
                }
            ),
        ));
        if let Some(source) = gnumeric {
            let visibility = attrs.pop().unwrap();
            for (key, value) in &source.attrs {
                let key = match key.as_str() {
                    "DisplayFormulas" => "DisplayFormulas",
                    "HideZero" => "HideZero",
                    "HideGrid" => "HideGrid",
                    "HideColHeader" => "HideColHeader",
                    "HideRowHeader" => "HideRowHeader",
                    "DisplayOutlines" => "DisplayOutlines",
                    "OutlineSymbolsBelow" => "OutlineSymbolsBelow",
                    "OutlineSymbolsRight" => "OutlineSymbolsRight",
                    "RTL_Layout" => "RTL_Layout",
                    "Protected" => "Protected",
                    "ExprConvention" => "ExprConvention",
                    "Visibility" => "Visibility",
                    _ => continue,
                };
                if let Some((_, old)) = attrs.iter_mut().find(|(k, _)| *k == key) {
                    *old = value.clone();
                } else {
                    attrs.push((key, value.clone()));
                }
            }
            if !attrs.iter().any(|(key, _)| *key == "Visibility") {
                attrs.push(visibility);
            }
        }
        let (row, col) = typed
            .cells
            .keys()
            .fold((0, 0), |(r, c), &(y, x)| (r.max(y), c.max(x)));
        let zoom = crate::commands::archive::office::xlsx_gnumeric::sheet_view(raw)
            .and_then(|e| super::gnumeric_read::attr(e, "zoomScale"))
            .map(|s| crate::commands::js_number(s, 0.))
            .map_or(1., |n| n / 100.);
        let zoom = gnumeric
            .and_then(|s| super::gnumeric_read::children(s, "Zoom").next())
            .map(crate::commands::archive::office::xml_text)
            .map(|s| crate::commands::js_number(&s, 0.))
            .unwrap_or(zoom);
        let mut content = element("Name", &[], &sheet.name, "", 3)
            + &element("MaxCol", &[], &col.to_string(), "", 3)
            + &element("MaxRow", &[], &row.to_string(), "", 3)
            + &element("Zoom", &[], &precision(zoom), "", 3);
        content.push_str(&names(book, Some(i), &mut work, 3)?);
        if source.is_some() {
            content.push_str(&metadata::print(raw));
        }
        if let Some(source) = gnumeric {
            content.push_str(&records::parts(source, "PrintInformation", 3));
        }
        if let Some(print) = props
            .odf
            .as_ref()
            .and_then(|source| source.print.get(&sheet.name))
        {
            content.push_str(&records::record(print, 3, ["", ""]));
        }
        let relations = book.source.as_ref().and_then(|s| s.relations.get(i));
        let links = metadata::hyperlinks(raw, relations.map(Vec::as_slice).unwrap_or(&[]));
        let mut regions: String = gnumeric
            .and_then(|s| super::gnumeric_read::children(s, "Styles").next())
            .map(|n| {
                super::gnumeric_read::children(n, "StyleRegion")
                    .map(|r| records::record(r, 4, ["", ""]))
                    .collect()
            })
            .unwrap_or_default();
        for (bounds, link) in &links {
            regions.push_str(&element(
                "StyleRegion",
                &[
                    ("startCol", bounds[1].to_string()),
                    ("startRow", bounds[0].to_string()),
                    ("endCol", bounds[3].to_string()),
                    ("endRow", bounds[2].to_string()),
                ],
                "",
                &style(None, None, link),
                4,
            ));
        }
        for (&(r, c), cell) in &typed.cells {
            let original = gnumeric.and_then(|s| super::gnumeric_read::source_style(s, r, c));
            if original.is_some_and(|s| records::matches(s, cell)) {
                continue;
            }
            let format = cell.format.as_deref();
            let cell_links: String = links
                .iter()
                .filter(|(b, _)| r >= b[0] && r <= b[2] && c >= b[1] && c <= b[3])
                .map(|(_, link)| link.as_str())
                .collect();
            if format.is_none() && cell.style.is_none() {
                continue;
            }
            regions.push_str(&element(
                "StyleRegion",
                &[
                    ("startCol", c.to_string()),
                    ("startRow", r.to_string()),
                    ("endCol", c.to_string()),
                    ("endRow", r.to_string()),
                ],
                "",
                &style(cell.style.as_deref(), format, &cell_links),
                4,
            ));
        }
        if !regions.is_empty() {
            content.push_str(&element("Styles", &[], "", &regions, 3));
        }
        if let Some(source) = gnumeric {
            content.push_str(&records::axes(typed, source));
            content.push_str(&records::parts(source, "Selections", 3));
            content.push_str(&records::parts(source, "Objects", 3));
        } else {
            content.push_str(&metadata::axes(typed, raw)?);
        }
        let mut comments = String::new();
        for comment in typed.comments.iter().filter(|_| gnumeric.is_none()) {
            let mut attrs = vec![
                (
                    "ObjectBound",
                    format!(
                        "{}{}",
                        super::xlsx_idx_to_col_ref(comment.column),
                        comment.row + 1
                    ),
                ),
                ("ObjectOffset", "1 0 1 0".into()),
                ("Direction", "17".into()),
                ("Print", "1".into()),
            ];
            if let Some(author) = &comment.author {
                attrs.push(("Author", author.clone()));
            }
            attrs.push((
                "Text",
                comment.runs.iter().map(|r| r.text.as_str()).collect(),
            ));
            if let Ok(Some(format)) = rich_text(&comment.runs) {
                attrs.push(("TextFormat", format));
            }
            comments.push_str(&element("CellComment", &attrs, "", "", 4));
        }
        if !comments.is_empty() {
            content.push_str(&element("Objects", &[], "", &comments, 3));
        }
        let mut cells = String::new();
        for (&(row, col), cell) in &typed.cells {
            if cell.formula.is_none() && matches!(cell.value, None | Some(xlsx::Value::Empty)) {
                continue;
            }
            let group = typed.arrays.iter().find(|g| {
                row >= g.range[0]
                    && row < g.range[0] + g.range[3]
                    && col >= g.range[1]
                    && col < g.range[1] + g.range[2]
            });
            if group.is_some_and(|g| (row, col) != (g.range[0], g.range[1])) {
                continue;
            }
            let formula_text = if let Some(source) = &cell.formula {
                Some(if sheet.delimited || gnumeric.is_some() {
                    let (text, _) = formula::gnumeric_text(
                        cell.formula_display.as_ref().unwrap_or(source),
                        true,
                        &mut work,
                    )?;
                    (format!("={text}"), true)
                } else {
                    let (text, relative) = formula::gnumeric_text(
                        cell.openformula.as_deref().unwrap_or(source),
                        false,
                        &mut work,
                    )?;
                    (format!("={text}"), relative)
                })
            } else {
                None
            };
            let mut attrs = vec![("Row", row.to_string()), ("Col", col.to_string())];
            if props.array_string_cells.contains(&(i, row, col)) {
                attrs.extend([
                    ("xmlns:ssc", "urn:poe-code:ssconvert:formulas:1".into()),
                    ("ssc:array-string-literals", "1".into()),
                ]);
            }
            if let Some(source) = &cell.openformula
                && (props.odf.is_none()
                    || formula_text.as_ref().is_some_and(|(_, relative)| *relative))
            {
                if !attrs.iter().any(|(k, _)| *k == "xmlns:ssc") {
                    attrs.push(("xmlns:ssc", "urn:poe-code:ssconvert:formulas:1".into()));
                }
                attrs.push(("ssc:openformula", source.clone()));
            }
            if let Some(g) = group {
                attrs.extend([
                    ("Rows", g.range[3].to_string()),
                    ("Cols", g.range[2].to_string()),
                ]);
            }
            let text = if let Some((text, _)) = formula_text {
                text
            } else {
                let (kind, text) = match cell.value.as_ref().unwrap_or(&xlsx::Value::Empty) {
                    xlsx::Value::Empty => (10, String::new()),
                    xlsx::Value::Number(n) => (
                        40,
                        if shortest {
                            formulas::Value::Number(*n).cached()
                        } else {
                            xlsx::number(*n)
                        },
                    ),
                    xlsx::Value::Text(s) => (60, s.clone()),
                    xlsx::Value::Error(s) => (50, s.clone()),
                    xlsx::Value::Bool(b) => (20, if *b { "TRUE" } else { "FALSE" }.into()),
                };
                attrs.push(("ValueType", kind.to_string()));
                if gnumeric.is_some() && cell.value_format.is_some() {
                    attrs.push(("ValueFormat", cell.value_format.clone().unwrap()));
                } else if let Some(format) = cell
                    .rich_text
                    .as_ref()
                    .map(|r| rich_text(r))
                    .transpose()?
                    .flatten()
                {
                    attrs.push(("ValueFormat", format));
                } else if !sheet.delimited {
                    if let Some(f) = &cell.value_format {
                        attrs.push(("ValueFormat", f.clone()));
                    }
                }
                text
            };
            cells.push_str(&element("Cell", &attrs, &text, "", 4));
            if cells.len() + content.len() + sheets.len() + body.len() > limit {
                return Err(failure.into());
            }
        }
        content.push_str(&element("Cells", &[], "", &cells, 3));
        let merges = typed
            .merges
            .iter()
            .map(|r| {
                element(
                    "Merge",
                    &[],
                    &format!(
                        "{}{}:{}{}",
                        super::xlsx_idx_to_col_ref(r[1]),
                        r[0] + 1,
                        super::xlsx_idx_to_col_ref(r[1] + r[2] - 1),
                        r[0] + r[3]
                    ),
                    "",
                    4,
                )
            })
            .collect::<String>();
        if !merges.is_empty() {
            content.push_str(&element("MergedRegions", &[], "", &merges, 3));
        }
        if source.is_some() {
            content.push_str(&metadata::layout(raw));
            content.push_str(&metadata::filters(raw));
        }
        if let Some(source) = gnumeric {
            for kind in ["SheetLayout", "Filters", "Solver", "Scenarios"] {
                content.push_str(&records::parts(source, kind, 3));
            }
        }
        sheets.push_str(&element("Sheet", &attrs, "", &content, 2));
        if sheets.len() + body.len() > limit {
            return Err(failure.into());
        }
    }
    body.push_str(&element("Sheets", &[], "", &sheets, 1));
    body.push_str(&element(
        "UIData",
        &[("SelectedTab", props.active_sheet.to_string())],
        "",
        "",
        1,
    ));
    let out = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n{}",
        element(
            "Workbook",
            &[
                ("xmlns:gnm", "http://www.gnumeric.org/v10.dtd".into()),
                (
                    "xmlns:xsi",
                    "http://www.w3.org/2001/XMLSchema-instance".into()
                ),
                (
                    "xsi:schemaLocation",
                    "http://www.gnumeric.org/v9.xsd".into()
                )
            ],
            "",
            &body,
            0
        )
    );
    if out.len() > limit {
        return Err(failure.into());
    }
    Ok(out.into_bytes())
}

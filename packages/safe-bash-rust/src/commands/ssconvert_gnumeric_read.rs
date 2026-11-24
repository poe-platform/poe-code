use super::xlsx;
use crate::commands::{
    archive::office::{coordinate, xlsx_gnumeric, xml_text as text},
    structured::xml::{self, Element, Node},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
#[path = "ssconvert_gnumeric_rich.rs"]
mod rich;
#[path = "ssconvert_gnumeric_schema.rs"]
mod schema;
#[path = "ssconvert_gnumeric_styles.rs"]
mod styles;
use xlsx::{
    ArrayFormula, Axis, Iteration, NamedExpression, Sheet, Style, TypedCell, Value, Workbook,
};

pub(super) fn namespace(value: &str) -> bool {
    value == "http://www.gnome.org/gnumeric/"
        || (2..=7).any(|v| value == format!("http://www.gnome.org/gnumeric/v{v}"))
        || (8..=14).any(|v| value == format!("http://www.gnumeric.org/v{v}.dtd"))
}
pub(in super::super) fn children<'a>(
    node: &'a Element,
    name: &'a str,
) -> impl Iterator<Item = &'a Element> {
    node.children.iter().filter_map(move |n| match n {
        Node::Element(e) if e.tag.rsplit(':').next() == Some(name) && namespace(&e.namespace) => {
            Some(e)
        }
        _ => None,
    })
}
pub(in super::super) fn attr<'a>(node: &'a Element, name: &str) -> Option<&'a str> {
    node.attrs
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.as_str())
}
pub(in super::super) fn source_sheet<'a>(
    root: Option<&'a Element>,
    name: &str,
) -> Option<&'a Element> {
    children(root?, "Sheets")
        .next()?
        .children
        .iter()
        .find_map(|n| match n {
            Node::Element(e)
                if e.tag.rsplit(':').next() == Some("Sheet")
                    && children(e, "Name").next().is_some_and(|n| text(n) == name) =>
            {
                Some(e)
            }
            _ => None,
        })
}
pub(in super::super) fn source_style(node: &Element, row: usize, col: usize) -> Option<&Element> {
    let regions = children(node, "Styles").next()?;
    children(regions, "StyleRegion")
        .filter(|r| {
            let number = |key| {
                attr(r, key)
                    .and_then(|v| v.parse::<usize>().ok())
                    .unwrap_or(0)
            };
            row >= number("startRow")
                && row <= number("endRow")
                && col >= number("startCol")
                && col <= number("endCol")
        })
        .last()
        .and_then(|r| children(r, "Style").next())
}
pub(in super::super) fn source_axis<'a>(
    node: &'a Element,
    kind: &'a str,
    index: usize,
) -> Option<&'a Element> {
    children(node, if kind == "RowInfo" { "Rows" } else { "Cols" })
        .flat_map(|n| children(n, kind))
        .filter(|n| {
            let start = number(n, "No", -1.);
            start >= 0. && index as f64 >= start && (index as f64) < start + number(n, "Count", 1.)
        })
        .last()
}
pub(in super::super) fn number(node: &Element, name: &str, fallback: f64) -> f64 {
    attr(node, name).map_or(fallback, |v| {
        let n = crate::commands::js_number(v, f64::NAN);
        if n.is_finite() { n } else { fallback }
    })
}
fn boolean(node: &Element, name: &str, fallback: bool) -> bool {
    attr(node, name).map_or(fallback, |v| v != "0" && !v.eq_ignore_ascii_case("false"))
}
fn invalid(message: &str) -> String {
    format!("E Invalid Gnumeric XML: {message}\n")
}
pub(super) fn document(bytes: &[u8], limit: usize) -> Result<Element, String> {
    let decoded;
    let bytes = if bytes.starts_with(&[31, 139]) {
        decoded = crate::commands::codecs::gzip_decompress_bounded(bytes, limit)
            .map_err(|_| invalid("invalid gzip stream"))?;
        decoded.as_slice()
    } else {
        bytes
    };
    let header = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]);
    let declaration = header
        .strip_prefix("<?xml")
        .and_then(|s| s.split_once("?>"))
        .map(|(body, _)| xml::parse(&format!("<declaration{body}/>"), None, None))
        .transpose()
        .map_err(|e| invalid(&e))?;
    let encoding = declaration.as_ref().and_then(|d| {
        d.nodes.iter().find_map(|n| match n {
            Node::Element(e) => attr(e, "encoding"),
            _ => None,
        })
    });
    let source = if let Some(encoding) =
        encoding.filter(|e| !e.eq_ignore_ascii_case("UTF-8") && !e.eq_ignore_ascii_case("UTF8"))
    {
        let name = encoding.to_ascii_lowercase();
        let tables = super::encoding::tables::DECODING;
        let name = super::encoding::tables::ALIASES
            .binary_search_by_key(&name.as_str(), |r| r.0)
            .ok()
            .map_or(name.as_str(), |i| super::encoding::tables::ALIASES[i].1);
        let table = tables
            .binary_search_by_key(&name, |r| r.0)
            .ok()
            .map(|i| tables[i].1)
            .ok_or_else(|| format!("Unsupported ssconvert feature: XML encoding {encoding}\n"))?;
        let source: String = bytes
            .iter()
            .map(|b| {
                (table[usize::from(*b)] != 0xffff)
                    .then(|| char::from_u32(u32::from(table[usize::from(*b)])))
                    .flatten()
            })
            .collect::<Option<_>>()
            .ok_or_else(|| invalid("invalid encoded XML byte"))?;
        source.replacen(encoding, "UTF-8", 1)
    } else {
        let source = crate::commands::archive::office_xml::decode(bytes)
            .map_err(|_| invalid("invalid encoded XML byte"))?;
        if let Some(encoding) = encoding.filter(|e| e.eq_ignore_ascii_case("UTF8")) {
            source.replacen(encoding, "UTF-8", 1)
        } else {
            source
        }
    };
    let document = xml::parse(&source, None, None).map_err(|e| invalid(&e))?;
    document
        .nodes
        .into_iter()
        .find_map(|n| match n {
            Node::Element(e) => Some(e),
            _ => None,
        })
        .ok_or_else(|| invalid("missing document element"))
}
pub(super) fn probe(bytes: &[u8], limit: usize) -> bool {
    document(bytes, limit)
        .is_ok_and(|e| e.tag.rsplit(':').next() == Some("Workbook") && namespace(&e.namespace))
}
fn value(kind: Option<&str>, value: &str) -> Result<Value<String>, String> {
    Ok(match kind {
        Some("10") => Value::Empty,
        Some("20") => Value::Bool(value.eq_ignore_ascii_case("TRUE") || value == "1"),
        Some("40") => {
            let n = crate::commands::js_number(value, f64::NAN);
            if !n.is_finite() {
                return Err(invalid(&format!("invalid numeric value '{value}'")));
            }
            Value::Number(n)
        }
        Some("50") => Value::Error(value.into()),
        _ => Value::Text(value.into()),
    })
}
fn color(source: &str) -> String {
    let parts: Option<Vec<_>> = source
        .split(':')
        .map(|s| u16::from_str_radix(s, 16).ok())
        .collect();
    parts.filter(|p| p.len() == 3).map_or_else(
        || source.into(),
        |p| format!("FF{:02X}{:02X}{:02X}", p[0] / 257, p[1] / 257, p[2] / 257),
    )
}
pub(super) fn style(node: &Element) -> Arc<Style> {
    let mut result = Style {
        text: styles::text(node),
        ..Style::default()
    };
    for key in [
        "HAlign",
        "VAlign",
        "WrapText",
        "ShrinkToFit",
        "Rotation",
        "Shade",
        "Indent",
        "Locked",
        "Hidden",
        "Fore",
        "Back",
        "PatternColor",
        "Format",
    ] {
        if let Some(value) = attr(node, key) {
            let value = match key {
                "HAlign" => value.strip_prefix("GNM_HALIGN_").map_or_else(
                    || value.into(),
                    |v| {
                        if v == "CENTER_ACROSS_SELECTION" {
                            "centerContinuous".into()
                        } else {
                            v.to_ascii_lowercase()
                        }
                    },
                ),
                "VAlign" => value
                    .strip_prefix("GNM_VALIGN_")
                    .unwrap_or(value)
                    .to_ascii_lowercase(),
                "Fore" | "Back" | "PatternColor" => color(value),
                _ => value.into(),
            };
            result.attributes.push((key, value));
        }
    }
    if let Some(font) = children(node, "Font").next() {
        result.family = text(font);
        for key in [
            "Unit",
            "Bold",
            "Italic",
            "Underline",
            "StrikeThrough",
            "Script",
        ] {
            if let Some(value) = attr(font, key) {
                result.font.push((key, value.into()));
            }
        }
    }
    if let Some(borders) = children(node, "StyleBorder").next() {
        for edge in &borders.children {
            let Node::Element(edge) = edge else { continue };
            if let Some(key) = ["Top", "Bottom", "Left", "Right", "Diagonal", "Rev-Diagonal"]
                .into_iter()
                .find(|key| edge.tag.rsplit(':').next() == Some(key) && namespace(&edge.namespace))
            {
                let line = number(edge, "Style", 0.);
                result.borders.push((
                    key,
                    if line.fract() == 0. {
                        line as u8
                    } else {
                        u8::MAX
                    },
                    attr(edge, "Color").map(color).unwrap_or_default(),
                ));
            }
        }
    }
    if let Some(link) = children(node, "HyperLink").next() {
        for key in ["type", "target", "tip"] {
            if let Some(value) = attr(link, key) {
                result.hyperlink.push((key, value.into()));
            }
        }
    }
    Arc::new(result)
}
fn name_field(entry: &Element, key: &str) -> Option<String> {
    entry.children.iter().find_map(|n| match n {
        Node::Element(e)
            if e.tag.rsplit(':').next() == Some(key)
                && (e.namespace.is_empty() || namespace(&e.namespace)) =>
        {
            Some(text(e))
        }
        _ => None,
    })
}
fn names(node: &Element, sheet: Option<usize>, book: &mut Workbook) {
    for group in children(node, "Names") {
        for entry in children(group, "Name") {
            let (Some(name), Some(expression)) =
                (name_field(entry, "name"), name_field(entry, "value"))
            else {
                continue;
            };
            if name.is_empty() {
                continue;
            }
            let (row, col) = name_field(entry, "position")
                .as_deref()
                .and_then(coordinate)
                .unwrap_or((0, 0));
            book.names.push(NamedExpression {
                name,
                expression,
                sheet,
                openformula: None,
                position: (sheet.unwrap_or(0), row as i64, col as i64),
                compiled: None,
            });
        }
    }
}
fn axes(
    node: &Element,
    kind: &str,
    maximum: usize,
    diagnostics: &mut String,
) -> Result<BTreeMap<usize, Axis>, String> {
    let mut result = BTreeMap::new();
    for container in children(node, if kind == "RowInfo" { "Rows" } else { "Cols" }) {
        for axis in children(container, kind) {
            let start = number(axis, "No", -1.);
            let count = number(axis, "Count", 1.);
            if start < 0.
                || count < 1.
                || start.fract() != 0.
                || count.fract() != 0.
                || start + count > maximum as f64
            {
                return Err(invalid("invalid axis interval"));
            }
            let size = number(axis, "Unit", -1.);
            if size <= -1. {
                diagnostics.push_str("File is most likely corrupted.\nThe problem was detected in xml_sax_colrow.\nThe failed check was: size > -1\n");
                continue;
            }
            for index in start as usize..(start + count) as usize {
                result.insert(
                    index,
                    Axis {
                        size: Some(if size > 0. {
                            size
                        } else {
                            number(
                                container,
                                "DefaultSizePts",
                                if kind == "RowInfo" { 12.75 } else { 48. },
                            )
                        }),
                        hidden: number(axis, "Hidden", 0.) != 0.,
                        level: number(axis, "OutlineLevel", 0.) as usize,
                        style: None,
                    },
                );
            }
        }
    }
    Ok(result)
}
pub(in super::super) fn read(
    bytes: &[u8],
    limit: usize,
    diagnostics: &mut String,
) -> Result<(Vec<Sheet<String>>, Workbook), String> {
    let mut root = document(bytes, limit)?;
    if root.tag.rsplit(':').next() != Some("Workbook") || !namespace(&root.namespace) {
        return Err(invalid("unsupported workbook namespace"));
    }
    schema::read(&mut root, &mut Vec::new(), diagnostics);
    let mut version = root
        .attrs
        .iter()
        .filter(|(k, _)| matches!(k.as_str(), "xmlns:gnm" | "xmlns:gmr"))
        .find_map(|(_, value)| {
            (1..=14).find(|v| {
                *value
                    == match v {
                        1 => "http://www.gnome.org/gnumeric/".into(),
                        2..=7 => format!("http://www.gnome.org/gnumeric/v{v}"),
                        _ => format!("http://www.gnumeric.org/v{v}.dtd"),
                    }
            })
        })
        .unwrap_or(0);
    let mut available = Vec::new();
    for node in &root.children {
        let Node::Element(node) = node else { continue };
        if !namespace(&node.namespace) {
            continue;
        }
        match node.tag.rsplit(':').next() {
            Some("Version") => version = 11,
            Some("SheetNameIndex") => available.extend(children(node, "SheetName").map(text)),
            Some("Sheets") => {
                for sheet in children(node, "Sheet") {
                    let name = children(sheet, "Name").next().map(text).unwrap_or_default();
                    if version >= 7 && !available.contains(&name) {
                        return Err("E File has inconsistent SheetNameIndex element.\n".into());
                    }
                }
                available.extend(
                    children(node, "Sheet")
                        .map(|sheet| children(sheet, "Name").next().map(text).unwrap_or_default()),
                );
            }
            _ => {}
        }
    }
    styles::read(&mut root, (3..=5).contains(&version));
    let index: Vec<_> = children(&root, "SheetNameIndex")
        .next()
        .into_iter()
        .flat_map(|n| children(n, "SheetName"))
        .collect();
    let data: Vec<_> = children(&root, "Sheets")
        .next()
        .into_iter()
        .flat_map(|n| children(n, "Sheet"))
        .collect();
    let sheet_name = |s: &Element| children(s, "Name").next().map(text);
    let ordered: Vec<_> = if index.is_empty() {
        data.clone()
    } else {
        index
            .iter()
            .map(|n| {
                data.iter()
                    .rfind(|s| sheet_name(s) == Some(text(n)))
                    .copied()
                    .unwrap_or(*n)
            })
            .chain(
                data.iter()
                    .copied()
                    .filter(|s| !index.iter().any(|n| Some(text(n)) == sheet_name(s))),
            )
            .collect()
    };
    let mut book = Workbook {
        case_insensitive: true,
        recalculate: true,
        iteration: Some(Iteration {
            enabled: true,
            maximum: 100,
            tolerance: 0.001,
        }),
        ..Workbook::default()
    };
    for node in &root.children {
        let Node::Element(node) = node else { continue };
        if !namespace(&node.namespace) {
            continue;
        }
        match node.tag.rsplit(':').next().unwrap() {
            "DateConvention" => book.date1904 = text(node) == "1904",
            "Calculation" => {
                book.manual = boolean(node, "ManualRecalc", false);
                book.iteration = Some(Iteration {
                    enabled: boolean(node, "EnableIteration", true),
                    maximum: number(node, "MaxIterations", 100.) as u64,
                    tolerance: number(node, "IterationTolerance", 0.001),
                });
                match attr(node, "DateConvention") {
                    Some("Apple:1904") => book.date1904 = true,
                    Some("Lotus:1900") => book.date1904 = false,
                    _ => {}
                }
            }
            _ => {}
        }
    }
    names(&root, None, &mut book);
    let mut sheets = BTreeMap::new();
    let mut formula_bindings = BTreeMap::new();
    let mut sheet_names = Vec::new();
    let mut shared: BTreeMap<String, (String, (usize, usize, usize), Vec<Option<usize>>)> =
        BTreeMap::new();
    let mut work = limit;
    for (i, node) in ordered.iter().enumerate() {
        let name = sheet_name(node)
            .or_else(|| index.get(i).map(|n| text(n)))
            .unwrap_or_else(|| format!("Sheet{}", i + 1));
        let indexed = index.iter().find(|n| text(n) == name);
        let dimension = |key, default| {
            indexed
                .and_then(|n| {
                    n.attrs
                        .iter()
                        .find(|(k, _)| k.rsplit(':').next() == Some(key))
                        .map(|(_, v)| crate::commands::js_number(v, f64::NAN))
                })
                .unwrap_or(default)
        };
        let (rows, cols) = (dimension("Rows", 65536.), dimension("Cols", 256.));
        if rows < 1.
            || rows > 1048576.
            || cols < 1.
            || cols > 16384.
            || rows.fract() != 0.
            || cols.fract() != 0.
        {
            return Err(invalid("invalid sheet dimensions"));
        }
        book.sheet_sizes.push((rows as usize, cols as usize));
        names(node, Some(i), &mut book);
        for (key, expression) in [
            ("Sheet_Title", format!("\"{}\"", name.replace('"', "\"\""))),
            ("Print_Area", "#REF!".into()),
        ] {
            if !book
                .names
                .iter()
                .any(|n| n.sheet == Some(i) && n.name == key)
            {
                book.names.push(NamedExpression {
                    name: key.into(),
                    expression,
                    sheet: Some(i),
                    openformula: None,
                    position: (i, 0, 0),
                    compiled: None,
                });
            }
        }
        sheet_names.push(name);
    }
    crate::commands::archive::office::formulas::live_names::reject_cycles(
        &mut book,
        &sheet_names,
        &mut work,
        diagnostics,
    )
    .ok_or("ssconvert: formula calculation exceeds input limit\n")?;
    let mut visible_names = BTreeSet::new();
    let mut visible_sheets = BTreeSet::new();
    for node in &root.children {
        let Node::Element(node) = node else { continue };
        if !namespace(&node.namespace) {
            continue;
        }
        if node.tag.rsplit(':').next() == Some("Sheets") {
            break;
        }
        if node.tag.rsplit(':').next() == Some("SheetNameIndex") {
            for entry in children(node, "SheetName") {
                let name = text(entry);
                if let Some(i) = sheet_names
                    .iter()
                    .position(|s| crate::commands::archive::office::case_fold::same_name(s, &name))
                {
                    visible_sheets.insert(i);
                }
            }
        }
        if node.tag.rsplit(':').next() == Some("Names") {
            for entry in children(node, "Name") {
                if let Some(name) = name_field(entry, "name")
                    && name_field(entry, "value").is_some()
                {
                    visible_names.insert((None, name));
                }
            }
        }
    }
    for (i, _) in ordered.iter().enumerate() {
        for name in ["Sheet_Title", "Print_Area"] {
            visible_names.insert((Some(i), name.to_owned()));
        }
    }
    let mut import_order: Vec<_> = ordered.iter().enumerate().collect();
    import_order.sort_by_key(|(_, node)| {
        data.iter()
            .position(|source| std::ptr::eq(*source, **node))
            .unwrap_or(usize::MAX)
    });
    for (i, node) in import_order {
        visible_sheets.insert(i);
        for child in &node.children {
            let Node::Element(child) = child else {
                continue;
            };
            if !namespace(&child.namespace) {
                continue;
            }
            if child.tag.rsplit(':').next() == Some("Cells") {
                break;
            }
            if child.tag.rsplit(':').next() == Some("Names") {
                for entry in children(child, "Name") {
                    if let Some(name) = name_field(entry, "name")
                        && name_field(entry, "value").is_some()
                    {
                        visible_names.insert((Some(i), name));
                    }
                }
            }
        }
        let (rows, cols) = book.sheet_sizes[i];
        let (rows, cols) = (rows as f64, cols as f64);
        let mut sheet = Sheet {
            name: sheet_names[i].clone(),
            view: [
                ("DisplayFormulas", "showFormulas", false),
                ("HideZero", "showZeros", true),
                ("HideGrid", "showGridLines", true),
                ("HideColHeader", "showRowColHeaders", true),
                ("DisplayOutlines", "showOutlineSymbols", false),
                ("RTL_Layout", "rightToLeft", false),
            ]
            .into_iter()
            .filter_map(|(source, target, inverted)| {
                attr(node, source).map(|value| {
                    let value = crate::commands::js_number(value, 0.);
                    (target, (value != 0. && !value.is_nan()) != inverted)
                })
            })
            .collect(),
            sylk_r1c1: None,
            sylk_hide_zero: false,
            print: xlsx::Print::default(),
            filter: None,
            cells: BTreeMap::new(),
            rows: axes(node, "RowInfo", rows as usize, diagnostics)?,
            columns: axes(node, "ColInfo", cols as usize, diagnostics)?,
            merges: vec![],
            arrays: vec![],
            comments: vec![],
            style_regions: vec![],
            empty_headers: true,
        };
        if let Some(print) = children(node, "PrintInformation").next() {
            sheet.print.margins = children(print, "Margins").next().map(|m| {
                ["left", "right", "top", "bottom"]
                    .map(|key| children(m, key).next().map(|n| number(n, "Points", 0.)))
            });
            sheet.print.orientation =
                children(print, "orientation")
                    .next()
                    .and_then(|n| match text(n).as_str() {
                        "landscape" => Some("landscape"),
                        "portrait" => Some("portrait"),
                        _ => None,
                    });
            sheet.print.scale = children(print, "Scale").next().map(|n| {
                if matches!(attr(n, "type"), Some("fit" | "size_fit")) {
                    xlsx::Scale::Fit(number(n, "cols", 0.), number(n, "rows", 0.))
                } else {
                    xlsx::Scale::Percentage(number(n, "percentage", 100.))
                }
            });
        }
        let regions: Vec<_> = children(node, "Styles")
            .next()
            .into_iter()
            .flat_map(|n| children(n, "StyleRegion"))
            .filter_map(|r| {
                let style = children(r, "Style").next()?;
                Some((
                    [
                        number(r, "startRow", 0.) as usize,
                        number(r, "startCol", 0.) as usize,
                        number(r, "endRow", 0.) as usize,
                        number(r, "endCol", 0.) as usize,
                    ],
                    style,
                ))
            })
            .collect();
        for (bounds, style_node) in &regions {
            if bounds[2] >= bounds[0] && bounds[3] >= bounds[1] {
                sheet.style_regions.push((*bounds, style(style_node)));
            }
        }
        for container in children(node, "Cells").take(1) {
            for cell in children(container, "Cell") {
                let row = number(cell, "Row", -1.);
                let col = number(cell, "Col", -1.);
                if row < 0.
                    || col < 0.
                    || row >= rows
                    || col >= cols
                    || row.fract() != 0.
                    || col.fract() != 0.
                {
                    return Err(invalid("invalid cell position"));
                }
                let (row, col) = (row as usize, col as usize);
                let text = children(cell, "Content")
                    .next()
                    .map(text)
                    .unwrap_or_else(|| text(cell));
                let kind = attr(cell, "ValueType");
                let cached = attr(cell, "Value");
                let mut formula = (text.starts_with('=') && (kind.is_none() || cached.is_some()))
                    .then(|| text[1..].to_owned());
                let mut bindings = Vec::new();
                let mut inherited = false;
                if let Some(id) = attr(cell, "ExprID")
                    && let Some((source, (origin, r, c), original_bindings)) =
                        shared.get(id).filter(|_| text.is_empty())
                {
                    inherited = true;
                    let mut source = source.clone();
                    if !original_bindings.is_empty()
                        && let Some(mut parsed) =
                            crate::commands::archive::office_ods::formula::convert(
                                true,
                                &format!("={source}"),
                                false,
                                work,
                                true,
                            )
                            .map_err(invalid)?
                        && let Some(display) = parsed
                            .bind_imported_names(
                                original_bindings,
                                *origin,
                                &sheet_names,
                                |scope, name| {
                                    visible_names.contains(&(Some(scope), name.to_owned()))
                                },
                                &mut work,
                            )
                            .map_err(invalid)?
                    {
                        source = display;
                    }
                    formula = Some(xlsx_gnumeric::translate_formula(
                        &source,
                        (row as i64 - *r as i64, col as i64 - *c as i64),
                        true,
                        &mut work,
                    )?);
                }
                let v = if formula.is_some() {
                    cached.map(|s| value(kind, s)).transpose()?
                } else {
                    Some(value(kind, &text)?)
                };
                let openformula = cell
                    .attrs
                    .iter()
                    .find(|(k, _)| k.rsplit(':').next() == Some("openformula"))
                    .map(|(_, v)| v.clone());
                if cell
                    .attrs
                    .iter()
                    .any(|(k, v)| k.rsplit(':').next() == Some("array-string-literals") && v == "1")
                {
                    book.array_string_cells.insert((i, row, col));
                }
                let vf = attr(cell, "ValueFormat").map(str::to_owned);
                let effective = regions
                    .iter()
                    .rev()
                    .find(|(b, _)| row >= b[0] && row <= b[2] && col >= b[1] && col <= b[3])
                    .map(|(_, s)| *s);
                let rich_text = vf
                    .as_deref()
                    .and_then(|f| rich::read(&text, f))
                    .map(Arc::new);
                let format = effective
                    .and_then(|s| attr(s, "Format"))
                    .map(str::to_owned)
                    .or_else(|| vf.clone().filter(|_| rich_text.is_none()));
                let mut array = false;
                if let Some(f) = &formula {
                    if attr(cell, "Rows").is_some() && attr(cell, "Cols").is_some() {
                        let height = number(cell, "Rows", 1.);
                        let width = number(cell, "Cols", 1.);
                        if height > 0. && width > 0. {
                            if height.fract() != 0.
                                || width.fract() != 0.
                                || row as f64 + height > rows
                                || col as f64 + width > cols
                            {
                                return Err(invalid("invalid array dimensions"));
                            }
                            array = true;
                            sheet.arrays.push(ArrayFormula {
                                range: [row, col, width as usize, height as usize],
                                expression: f.clone(),
                                openformula: None,
                                formula_display: None,
                            });
                        }
                    }
                }
                let id = attr(cell, "ExprID");
                let mut cell = TypedCell {
                    value: v,
                    formula,
                    openformula,
                    formula_display: None,
                    format,
                    value_format: vf,
                    style: effective.map(style),
                    rich_text,
                };
                if let Some(source) = &cell.formula
                    && let Some(parsed) = crate::commands::archive::office_ods::formula::convert(
                        true,
                        &format!("={source}"),
                        false,
                        work,
                        true,
                    )
                    .map_err(invalid)?
                {
                    let mut rejected = false;
                    for (requested, name, global, spelling) in parsed
                        .entry_names(&sheet_names, &book.sheet_sizes, &mut work)
                        .map_err(invalid)?
                        .unwrap_or_default()
                    {
                        let rejection = if global && !visible_names.contains(&(None, name.clone()))
                        {
                            Some(format!("Name '{name}' does not exist in workbook"))
                        } else if let Some(scope) = requested
                            && !visible_sheets.contains(&scope)
                        {
                            Some(format!(
                                "Unknown sheet '{}'",
                                spelling.as_deref().unwrap_or(&sheet_names[scope])
                            ))
                        } else {
                            None
                        };
                        if let Some(reason) = rejection {
                            bindings.clear();
                            // Only ordinary input cells recover rejected names
                            // as strings; arrays and shared copies keep formulas.
                            if !array && !inherited {
                                rejected = true;
                                diagnostics.push_str(&format!(
                                    "Unparsable expression for {}{}: ={source} ({reason})\n",
                                    crate::commands::structured::xlsx_idx_to_col_ref(col),
                                    row + 1
                                ));
                            }
                            break;
                        }
                        if global {
                            bindings.push(None);
                            continue;
                        }
                        let scope = if visible_names
                            .contains(&(Some(requested.unwrap_or(i)), name.clone()))
                        {
                            Some(requested.unwrap_or(i))
                        } else if visible_names.contains(&(None, name.clone())) {
                            None
                        } else {
                            requested
                        };
                        visible_names.insert((scope, name.clone()));
                        if !book
                            .names
                            .iter()
                            .any(|n| n.name == name && n.sheet == scope)
                        {
                            book.names.push(NamedExpression {
                                name,
                                sheet: scope,
                                expression: "#NAME?".into(),
                                openformula: None,
                                position: (scope.unwrap_or(0), row as i64, col as i64),
                                compiled: None,
                            });
                        }
                        bindings.push(scope);
                    }
                    if rejected {
                        bindings.clear();
                        cell.value = Some(Value::Text(source.clone()));
                        cell.formula_display = Some(format!(
                            "\"{}\"",
                            source.replace('\\', "\\\\").replace('"', "\\\"")
                        ));
                        cell.formula = Some(format!("\"{}\"", source.replace('"', "\"\"")));
                    } else if parsed.native_diagnostic.is_none() {
                        cell.formula_display = cell.formula.clone();
                        cell.formula = Some(parsed.excel);
                    } else {
                        bindings.clear();
                    }
                }
                if let Some(id) = id
                    && let Some(source) = cell.formula_display.as_ref().or(cell.formula.as_ref())
                {
                    shared.entry(id.into()).or_insert((
                        source.clone(),
                        (i, row, col),
                        bindings.clone(),
                    ));
                }
                formula_bindings.remove(&(i, row, col));
                if !bindings.is_empty() {
                    formula_bindings.insert((i, row, col), bindings);
                }
                sheet.cells.insert((row, col), cell);
            }
        }
        for merge in children(node, "MergedRegions")
            .next()
            .into_iter()
            .flat_map(|n| children(n, "Merge"))
        {
            let source = text(merge);
            let (a, b) = source.split_once(':').unwrap_or((&source, &source));
            let (Some((r, c)), Some((rr, cc))) = (coordinate(a), coordinate(b)) else {
                return Err(invalid(&format!("invalid range '{source}'")));
            };
            if rr >= r && cc >= c {
                sheet.merges.push([r, c, cc - c + 1, rr - r + 1]);
            }
        }
        for object in children(node, "Objects")
            .next()
            .into_iter()
            .flat_map(|n| children(n, "CellComment"))
        {
            let Some((row, column)) = attr(object, "ObjectBound")
                .and_then(|s| coordinate(s.split(':').next().unwrap_or(s)))
            else {
                continue;
            };
            let content = attr(object, "Text").unwrap_or("");
            let runs = attr(object, "TextFormat")
                .and_then(|s| rich::read(content, s))
                .unwrap_or_else(|| {
                    vec![xlsx::TextRun {
                        text: content.into(),
                        attributes: Arc::new(vec![]),
                    }]
                });
            sheet.comments.push(xlsx::Comment {
                print: !matches!(attr(object, "Print"), Some("0" | "false" | "f")),
                row,
                column,
                author: attr(object, "Author").map(str::to_owned),
                runs,
            });
        }
        for name in book.names.iter().filter(|name| name.sheet == Some(i)) {
            visible_names.insert((Some(i), name.name.clone()));
        }
        sheets.insert(i, sheet);
    }
    let mut sheets: Vec<_> = sheets.into_values().collect();
    for ((i, row, col), bindings) in formula_bindings {
        let sheet = &mut sheets[i];
        let cell = sheet.cells.get_mut(&(row, col)).unwrap();
        let source = cell
            .formula_display
            .as_ref()
            .or(cell.formula.as_ref())
            .unwrap();
        if let Some(mut parsed) = crate::commands::archive::office_ods::formula::convert(
            true,
            &format!("={source}"),
            false,
            work,
            true,
        )
        .map_err(invalid)?
            && let Some(display) = parsed
                .bind_imported_names(
                    &bindings,
                    i,
                    &sheet_names,
                    |scope, name| {
                        book.names
                            .iter()
                            .any(|n| n.sheet == Some(scope) && n.name == name)
                    },
                    &mut work,
                )
                .map_err(invalid)?
        {
            for group in sheet
                .arrays
                .iter_mut()
                .filter(|g| g.range[0] == row && g.range[1] == col)
            {
                group.expression.clone_from(&parsed.excel);
                group.formula_display = Some(display.clone());
            }
            cell.formula_display = Some(display);
            cell.formula = Some(parsed.excel);
        }
    }
    book.active_sheet = children(&root, "UIData")
        .next()
        .map_or(0, |n| number(n, "SelectedTab", 0.) as usize)
        .min(sheets.len().saturating_sub(1));
    for node in ordered {
        if let Some(zoom) = children(node, "Zoom").next()
            && !crate::commands::js_number(&text(zoom), 0.).is_finite()
        {
            return Err("Nonfinite workbook number\n".into());
        }
    }
    xlsx_gnumeric::properties::read_gnumeric(&root, &mut book)?;
    book.gnumeric = Some(root);
    Ok((sheets, book))
}

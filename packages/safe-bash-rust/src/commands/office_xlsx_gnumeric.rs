// Public ODS conversion detects XLSX content and uses the Gnumeric importer.
// Calc's cache invalidation and package-preserving exporter are a separate path.
use super::{
    coordinate, formulas, xml_attribute as attr, xml_elements as elements, xml_text as text,
};
use crate::commands::{
    codecs,
    structured::{
        self,
        xlsx::{
            self, ArrayFormula, Axis, Comment, Dialect, Iteration, Sheet, TypedCell, Value,
            Workbook,
        },
        xml::{self, Element, Node},
    },
};
use std::{borrow::Cow, collections::BTreeMap, fmt::Write, sync::Arc};

#[path = "office_xlsx_gnumeric_comments.rs"]
mod comments;
#[path = "office_xlsx_gnumeric_names.rs"]
mod names;
#[path = "office_xlsx_gnumeric_properties.rs"]
pub(in crate::commands) mod properties;
#[path = "office_xlsx_gnumeric_styles.rs"]
mod styles;
const LIMIT: &str = "Error: conversion failed: document exceeds byte limit\n";

fn parse(entries: &BTreeMap<String, Vec<u8>>, path: &str) -> Result<Vec<Node>, String> {
    let bytes = entries.get(path.trim_start_matches('/')).ok_or_else(|| {
        format!(
            "Error: conversion failed: E Invalid XLSX: missing part '{}'\n",
            path.trim_start_matches('/')
        )
    })?;
    let source = super::super::office_xml::decode(bytes)
        .map_err(|_| "Error: conversion failed: invalid worksheet XML\n")?;
    xml::parse(&source, None, None)
        .map(|doc| doc.nodes)
        .map_err(|_| "Error: conversion failed: invalid worksheet XML\n".into())
}
fn relationships(entries: &BTreeMap<String, Vec<u8>>, path: &str) -> Result<Vec<Node>, String> {
    let (directory, file) = path.rsplit_once('/').unwrap_or(("", path));
    let rel = format!("{directory}/_rels/{file}.rels");
    if entries.contains_key(rel.trim_start_matches('/')) {
        parse(entries, &rel)
    } else {
        Ok(Vec::new())
    }
}
fn related(rels: &[Node], path: &str, kind: &str) -> Option<String> {
    elements(rels, "Relationship")
        .into_iter()
        .find(|el| {
            attr(el, "Type").and_then(|s| s.rsplit('/').next()) == Some(kind)
                && attr(el, "TargetMode") != Some("External")
        })
        .and_then(|el| attr(el, "Target"))
        .map(|target| {
            crate::vfs::resolve_posix_path(path.rsplit_once('/').map_or("/", |p| p.0), target)
                .trim_start_matches('/')
                .into()
        })
}
fn boolean(value: Option<&str>) -> bool {
    matches!(value, Some("1" | "true" | "on"))
}
fn number(el: &Element, key: &str) -> Option<f64> {
    attr(el, key)?.parse().ok().filter(|n: &f64| n.is_finite())
}
fn index(el: &Element, key: &str) -> Option<usize> {
    attr(el, key)?.parse().ok()
}
fn range(source: &str) -> Option<[usize; 4]> {
    let (a, b) = source.split_once(':').unwrap_or((source, source));
    let (r, c) = coordinate(a)?;
    let (y, x) = coordinate(b)?;
    Some([r.min(y), c.min(x), c.abs_diff(x) + 1, r.abs_diff(y) + 1])
}
fn child_mut<'a>(nodes: &'a mut [Node], name: &str) -> Option<&'a mut Element> {
    nodes.iter_mut().find_map(|n| match n {
        Node::Element(e) if e.tag.rsplit(':').next() == Some(name) => Some(e),
        _ => None,
    })
}
pub(in crate::commands) fn sheet_view(nodes: &[Node]) -> Option<&Element> {
    let root = elements(nodes, "worksheet").into_iter().next()?;
    let views = root.children.iter().find_map(|node| match node {
        Node::Element(e) if e.tag.rsplit(':').next() == Some("sheetViews") => Some(e),
        _ => None,
    })?;
    views.children.iter().find_map(|node| match node {
        Node::Element(e) if e.tag.rsplit(':').next() == Some("sheetView") => Some(e),
        _ => None,
    })
}
fn set(el: &mut Element, key: &str, value: String) {
    if let Some((_, old)) = el.attrs.iter_mut().find(|(k, _)| k == key) {
        *old = value;
    } else {
        el.attrs.push((key.into(), value));
    }
}

fn format_width(node: &Element) -> Option<f64> {
    let value = |key| {
        node.attrs
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| crate::commands::js_number(value, 0.))
            .filter(|n| *n > 0.)
    };
    value("defaultColWidth")
        .map(|n| n * ((130. / 18.5703125) * (72. / 96.)))
        .or_else(|| value("baseColWidth").map(|n| n * ((130. / 18.5703125) * (72. / 96.)) + 3.75))
}

pub(in crate::commands) fn default_dimensions(nodes: &[Node]) -> Result<[Option<f64>; 2], String> {
    let mut dimensions = [None, None];
    for node in elements(nodes, "sheetFormatPr") {
        for key in ["defaultColWidth", "baseColWidth", "defaultRowHeight"] {
            if let Some((_, value)) = node.attrs.iter().find(|(name, _)| name == key) {
                let number = crate::commands::js_number(value, 0.);
                if !number.is_finite() {
                    return Err(format!(
                        "Error: conversion failed: E Invalid XLSX: invalid number '{value}'\n"
                    ));
                }
                if number < 0. {
                    return Err(
                        "Error: conversion failed: E Invalid XLSX: negative default dimension\n"
                            .into(),
                    );
                }
                if key == "defaultRowHeight" && number > 0. {
                    dimensions[1] = Some(number);
                }
            }
        }
        if let Some(width) = format_width(node) {
            dimensions[0] = Some(width);
        }
    }
    if dimensions.iter().flatten().any(|n| !n.is_finite()) {
        return Err("Error: conversion failed: Nonfinite workbook number\n".into());
    }
    Ok(dimensions)
}

fn sheet_format(nodes: &[Node]) -> Option<Element> {
    let mut records = elements(nodes, "sheetFormatPr").into_iter();
    let mut result = canonical(records.next()?);
    for node in records {
        let mut node = canonical(node);
        for (key, value) in node.attrs.drain(..) {
            set(&mut result, &key, value);
        }
        result.children.retain(|n| matches!(n, Node::Element(_)));
        result.children.append(&mut node.children);
    }
    Some(result)
}
fn serialize(nodes: &[Node], limit: usize) -> Result<Vec<u8>, String> {
    fn write(nodes: &[Node], out: &mut xml::EncodedOutput) -> std::fmt::Result {
        for node in nodes {
            match node {
                Node::Element(el) => {
                    write!(out, "<{}", el.tag)?;
                    for (key, value) in &el.attrs {
                        write!(
                            out,
                            " {key}=\"{}\"",
                            super::html_escape_str(value)
                                .replace('\t', "&#9;")
                                .replace('\n', "&#10;")
                                .replace('\r', "&#13;")
                        )?;
                    }
                    if el
                        .children
                        .iter()
                        .all(|n| matches!(n,Node::Text(t,_) if t.is_empty()))
                    {
                        out.write_str("/>")?;
                    } else {
                        out.write_char('>')?;
                        write(&el.children, out)?;
                        write!(out, "</{}>", el.tag)?;
                    }
                }
                Node::Text(value, _) | Node::Cdata(value) => {
                    out.write_str(&super::html_escape_str(value).replace('\r', "&#13;"))?
                }
                Node::Markup(_) => {}
            }
        }
        Ok(())
    }
    let mut out = xml::EncodedOutput {
        bytes: Vec::new(),
        encoding: None,
        limit,
    };
    out.write_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        .map_err(|_| LIMIT)?;
    for node in nodes {
        if matches!(node, Node::Element(_)) {
            write(std::slice::from_ref(node), &mut out).map_err(|_| LIMIT)?;
        }
    }
    out.write_char('\n').map_err(|_| LIMIT)?;
    Ok(out.bytes)
}
fn canonical(el: &Element) -> Element {
    let mut el = el.clone();
    el.tag = el.tag.rsplit(':').next().unwrap().into();
    el.attrs
        .retain(|(k, _)| k != "xmlns" && !k.starts_with("xmlns:"));
    for (key, _) in &mut el.attrs {
        if key.ends_with(":id") {
            *key = "r:id".into();
        }
    }
    let nested = el.children.iter().any(|n| matches!(n, Node::Element(_)));
    el.children = el
        .children
        .iter()
        .filter_map(|node| match node {
            Node::Element(e) => Some(Node::Element(canonical(e))),
            Node::Text(t, _) if nested && t.trim().is_empty() => None,
            node => Some(node.clone()),
        })
        .collect();
    el
}

fn retained_metadata(el: &Element, differential: bool) -> Result<Element, String> {
    // The XLSX importer recognizes unprefixed metadata descendants in the
    // worksheet namespace, without rescanning their default declarations.
    if el.tag.contains(':')
        && el.namespace != "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        || el.attrs.iter().any(|(key, _)| {
            key != "xmlns" && !key.starts_with("xmlns:") && key.contains(':') && key != "xml:space"
        })
    {
        return Err(if differential {
            "Unsupported XLSX differential style namespace or relationship\n"
        } else {
            "Unsupported ssconvert feature: XLSX metadata namespace or relationship\n"
        }
        .into());
    }
    let mut result = canonical(el);
    // Metadata stores direct text before its child elements, including indentation.
    result.children.clear();
    for node in &el.children {
        if matches!(node, Node::Text(..) | Node::Cdata(_)) {
            result.children.push(node.clone());
        }
    }
    for node in &el.children {
        if let Node::Element(child) = node {
            result
                .children
                .push(Node::Element(retained_metadata(child, differential)?));
        }
    }
    Ok(result)
}

// Workbook and container declarations are scanned; definedName declarations are not.
fn recognize_workbook(root: &mut Element, diagnostics: &mut String) {
    use std::{collections::BTreeSet, fmt::Write};
    let mut prefix = None;
    let mut seen = BTreeSet::new();
    let mut unknown = BTreeSet::new();
    let root_attrs = &root.attrs;
    root.children.retain_mut(|node| {
        let Node::Element(node) = node else {
            return true;
        };
        let mut default_main = true;
        for (key, value) in root_attrs.iter().chain(&node.attrs) {
            if key == "xmlns" {
                if let Some(main) = workbook_namespace(value) {
                    default_main = main;
                }
            } else if let Some(key) = key.strip_prefix("xmlns:") {
                match workbook_namespace(value) {
                    Some(main) => {
                        if seen.insert(key.to_owned()) && main && prefix.is_none() {
                            prefix = Some(key.to_owned());
                        }
                    }
                    None => {
                        unknown.insert(key.to_owned());
                    }
                }
            }
        }
        if !matches!(node.tag.rsplit(':').next(), Some("definedNames" | "calcPr")) {
            return true;
        }
        let accepts = |tag: &str| {
            tag.split_once(':')
                .map_or(default_main, |(key, _)| prefix.as_deref() == Some(key))
        };
        let ignored = |tag: &str| {
            tag.split_once(':')
                .is_some_and(|(key, _)| unknown.contains(key))
        };
        if !accepts(&node.tag) {
            if !ignored(&node.tag) {
                writeln!(
                    diagnostics,
                    "Unexpected element '{}' in state : \n\tworkbook",
                    node.tag
                )
                .unwrap();
            }
            return false;
        }
        node.children.retain(|child| {
            let Node::Element(child) = child else {
                return true;
            };
            if accepts(&child.tag) {
                return true;
            }
            if !ignored(&child.tag) {
                writeln!(
                    diagnostics,
                    "Unexpected element '{}' in state : \n\tworkbook -> {}",
                    child.tag,
                    node.tag.rsplit(':').next().unwrap()
                )
                .unwrap();
            }
            false
        });
        read_metadata(node, &mut vec!["workbook".into()], diagnostics);
        true
    });
}

fn workbook_namespace(value: &str) -> Option<bool> {
    match value {
        "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        | "http://schemas.openxmlformats.org/spreadsheetml/2006/7/main"
        | "http://schemas.openxmlformats.org/spreadsheetml/2006/5/main"
        | "http://schemas.microsoft.com/office/excel/2006/2"
        | "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" => Some(true),
        "http://schemas.microsoft.com/office/excel/2006/main"
        | "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
        | "http://schemas.openxmlformats.org/drawingml/2006/3/spreadsheetDrawing"
        | "http://schemas.openxmlformats.org/drawingml/2006/3/chart"
        | "http://schemas.openxmlformats.org/drawingml/2006/chart"
        | "http://schemas.openxmlformats.org/drawingml/2006/chartDrawing"
        | "http://schemas.openxmlformats.org/drawingml/2006/3/main"
        | "http://schemas.openxmlformats.org/drawingml/2006/main"
        | "http://www.gnumeric.org/ext/spreadsheetml"
        | "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        | "http://schemas.openxmlformats.org/package/2006/relationships"
        | "urn:schemas-microsoft-com:office:office"
        | "urn:schemas-microsoft-com:office:excel"
        | "urn:schemas-microsoft-com:vml"
        | "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
        | "http://purl.org/dc/elements/1.1/"
        | "http://purl.org/dc/dcmitype"
        | "http://purl.org/dc/terms/"
        | "http://www.w3.org/2001/XMLSchema-instance"
        | "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
        | "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
        | "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" => Some(false),
        _ => None,
    }
}

fn read_metadata(node: &mut Element, path: &mut Vec<String>, diagnostics: &mut String) {
    let kind = node.tag.rsplit(':').next().unwrap();
    if kind == "ext" {
        return;
    }
    let accepted: &[&str] = match kind {
        "conditionalFormatting" => &["extLst", "cfRule"],
        "cfRule" => &["formula", "colorScale", "dataBar", "iconSet"],
        "colorScale" => &["cfvo", "color"],
        "iconSet" => &["cfvo"],
        "extLst" => &["ext"],
        "rowBreaks" | "colBreaks" => &["brk"],
        "sheetPr" => &["tabColor", "outlinePr", "pageSetUpPr"],
        "sheetViews" => &["sheetView"],
        "definedNames" => &["definedName"],
        "sheetView" => &["pane", "selection", "pivotSelection"],
        "pivotSelection" => &["pivotArea"],
        "pivotArea" => &["references"],
        "references" => &["reference"],
        "headerFooter" => &[
            "oddHeader",
            "oddFooter",
            "evenHeader",
            "evenFooter",
            "firstHeader",
            "firstFooter",
        ],
        _ => &[],
    };
    path.push(kind.into());
    node.children.retain_mut(|child| {
        let Node::Element(child) = child else {
            return true;
        };
        if matches!(
            path.get(1).map(String::as_str),
            Some(
                "rowBreaks"
                    | "colBreaks"
                    | "sheetPr"
                    | "printOptions"
                    | "pageMargins"
                    | "pageSetup"
                    | "headerFooter"
            )
        ) && child.tag.contains(':')
            && child.namespace != "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        {
            return false;
        }
        if !accepted.contains(&child.tag.rsplit(':').next().unwrap())
            || path.get(1).is_some_and(|s| s == "sheetViews")
                && child.tag.contains(':')
                && child.namespace != "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        {
            writeln!(
                diagnostics,
                "Unexpected element '{}' in state : \n\t{}",
                child.tag,
                path.join(" -> ")
            )
            .unwrap();
            return false;
        }
        read_metadata(child, path, diagnostics);
        true
    });
    path.pop();
}

fn sheet_setting(source: &Element, sheet: &str, diagnostics: &mut String) -> Element {
    let mut result = canonical(source);
    let fields: &[&str] = match result.tag.as_str() {
        "sheetPr" => &[
            "syncHorizontal",
            "syncVertical",
            "syncRef",
            "transitionEvaluation",
            "transitionEntry",
            "published",
            "codeName",
            "filterMode",
            "enableFormatConditionsCalculation",
        ],
        "tabColor" => &["auto", "indexed", "rgb", "theme", "tint"],
        "outlinePr" => &[
            "applyStyles",
            "summaryBelow",
            "summaryRight",
            "showOutlineSymbols",
        ],
        "pageSetUpPr" => &["autoPageBreaks", "fitToPage"],
        "sheetFormatPr" => &[
            "baseColWidth",
            "defaultColWidth",
            "defaultRowHeight",
            "customHeight",
            "zeroHeight",
            "thickTop",
            "thickBottom",
            "outlineLevelRow",
            "outlineLevelCol",
        ],
        "printOptions" => &[
            "headings",
            "gridLines",
            "gridLinesSet",
            "horizontalCentered",
            "verticalCentered",
        ],
        "pageMargins" => &["left", "right", "top", "bottom", "header", "footer"],
        "pageSetup" => &[
            "paperSize",
            "paperHeight",
            "paperWidth",
            "scale",
            "firstPageNumber",
            "fitToWidth",
            "fitToHeight",
            "pageOrder",
            "orientation",
            "usePrinterDefaults",
            "blackAndWhite",
            "draft",
            "cellComments",
            "useFirstPageNumber",
            "errors",
            "horizontalDpi",
            "verticalDpi",
            "copies",
        ],
        "headerFooter" => &[
            "differentOddEven",
            "differentFirst",
            "scaleWithDoc",
            "alignWithMargins",
        ],
        _ => &["xml:space"],
    };
    result.attrs.retain(|(name, _)| {
        if fields.contains(&name.as_str()) {
            true
        } else {
            writeln!(
                diagnostics,
                "XLSX writer does not export sheet '{sheet}' metadata attribute '{}.{name}'",
                result.tag
            )
            .unwrap();
            false
        }
    });
    result.children = source
        .children
        .iter()
        .filter(|n| matches!(n, Node::Text(..) | Node::Cdata(_)))
        .cloned()
        .collect();
    for node in &source.children {
        if let Node::Element(child) = node {
            result
                .children
                .push(Node::Element(sheet_setting(child, sheet, diagnostics)));
        }
    }
    result
}

pub(in crate::commands) fn translate_formula(
    mut source: &str,
    offset: (i64, i64),
    gnumeric: bool,
    remaining: &mut usize,
) -> Result<String, String> {
    let mut output = String::new();
    while let Some(first) = source.chars().next() {
        if let Some((name, rest)) = formulas::live_names::global_name(source) {
            *remaining = remaining
                .checked_sub(source.len() - rest.len() + 16)
                .ok_or(LIMIT)?;
            output.push_str("[]");
            output.push_str(name);
            source = rest;
            continue;
        }
        if let Some((mut name, rest)) = formulas::live_names::LiveName::parse(source, true) {
            *remaining = remaining
                .checked_sub(source.len() - rest.len() + 64)
                .ok_or(LIMIT)?;
            name.translate(offset);
            output.push_str(&name.render(true));
            source = rest;
            continue;
        }
        if let Some((prefix, rest)) = formulas::label_prefix(source) {
            *remaining = remaining.checked_sub(prefix.len() + 17).ok_or(LIMIT)?;
            output.push_str(prefix);
            output.push(':');
            source = rest;
            continue;
        }
        let mut end = first.len_utf8();
        if matches!(first, '\'' | '"') {
            while let Some(next) = source[end..].chars().next() {
                end += next.len_utf8();
                if gnumeric && next == '\\' {
                    if let Some(escaped) = source[end..].chars().next() {
                        end += escaped.len_utf8();
                    }
                } else if next == first {
                    if !gnumeric && source[end..].starts_with(first) {
                        end += first.len_utf8();
                    } else {
                        break;
                    }
                }
            }
        } else if first.is_alphanumeric() || matches!(first, '_' | '.' | '$') {
            end = source
                .chars()
                .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '$'))
                .map(char::len_utf8)
                .sum();
        }
        *remaining = remaining.checked_sub(end + 16).ok_or(LIMIT)?;
        let word = &source[..end];
        let tail = &source[end..];
        let absolute_column = word.starts_with('$');
        let bare = word.strip_prefix('$').unwrap_or(word);
        let letters = bare.bytes().take_while(u8::is_ascii_alphabetic).count();
        let rest = &bare[letters..];
        let absolute_row = rest.starts_with('$');
        let row = rest.strip_prefix('$').unwrap_or(rest);
        let axis = tail.starts_with(':') || output.ends_with(':');
        let reference = !tail.starts_with(['!', '('])
            && (letters > 0 && !row.is_empty() && row.bytes().all(|c| c.is_ascii_digit())
                || axis
                    && (letters == bare.len()
                        || letters == 0 && row.bytes().all(|c| c.is_ascii_digit())));
        if reference {
            let column = bare[..letters].bytes().try_fold(0i64, |n, c| {
                n.checked_mul(26)?
                    .checked_add(i64::from(c.to_ascii_uppercase() - b'A' + 1))
            });
            let mut rendered = String::new();
            let mut invalid_reference = false;
            if letters > 0
                && let Some(column) = column
            {
                let column = column + if absolute_column { 0 } else { offset.1 };
                if absolute_column {
                    rendered.push('$');
                }
                if column > 0 {
                    rendered.push_str(&structured::xlsx_idx_to_col_ref(column as usize - 1));
                } else {
                    invalid_reference = true;
                }
            }
            if !row.is_empty()
                && let Ok(row) = row.parse::<i64>()
            {
                let absolute = if letters == 0 {
                    absolute_column
                } else {
                    absolute_row
                };
                let row = row + if absolute { 0 } else { offset.0 };
                if absolute {
                    rendered.push('$');
                }
                if row > 0 {
                    write!(rendered, "{row}").map_err(|_| LIMIT)?;
                } else {
                    invalid_reference = true;
                }
            }
            if invalid_reference {
                output.push_str("#REF!");
            } else if !rendered.is_empty() {
                output.push_str(&rendered);
            } else {
                output.push_str(word);
            }
        } else {
            output.push_str(word);
        }
        source = tail;
    }
    Ok(output)
}

pub(in crate::commands) struct Source {
    pub(in crate::commands) workbook: Vec<Node>,
    theme: Vec<Node>,
    differential_styles: Option<Element>,
    pub(in crate::commands) sheets: Vec<Vec<Node>>,
    pub(in crate::commands) relations: Vec<Vec<Node>>,
    drawings: Vec<Vec<Node>>,
    remaining: usize,
}

pub(in crate::commands) fn read(
    bytes: &[u8],
    filename: &str,
    limit: usize,
    diagnostics: &mut String,
) -> Result<(Vec<Sheet<String>>, Workbook, Source), String> {
    let (members, _) = codecs::zip_directory(bytes.len(), |r| Ok(Cow::Borrowed(&bytes[r])))
        .map_err(|_| "Error: conversion failed: invalid XLSX package\n")?;
    let mut remaining = limit;
    let mut entries = BTreeMap::new();
    for member in members {
        if entries.contains_key(&member.name) {
            return Err(format!(
                "Error: conversion failed: E Unsupported file format for file \"{filename}\"\n"
            ));
        }
        remaining = remaining
            .checked_sub(member.size + member.name.len() + 128)
            .ok_or(LIMIT)?;
        let data = member
            .decode(Cow::Borrowed(&bytes[member.payload.clone()]), None)
            .map_err(|_| "Error: conversion failed: invalid XLSX package\n")?;
        entries.insert(member.name, data.into_owned());
    }
    if !entries.contains_key("xl/workbook.xml") {
        return Err(format!(
            "Error: conversion failed: E Unsupported file format for file \"{filename}\"\n"
        ));
    }
    let root_rels = relationships(&entries, "")?;
    let path = related(&root_rels, "", "officeDocument")
        .ok_or("Error: conversion failed: E No workbook stream found.\n")?;
    let mut workbook = parse(&entries, &path)?;
    if let Some(root) = child_mut(&mut workbook, "workbook") {
        recognize_workbook(root, diagnostics);
    }
    let rels = relationships(&entries, &path)?;
    let style_doc = related(&rels, &path, "styles")
        .map(|p| parse(&entries, &p))
        .transpose()?
        .unwrap_or_default();
    let theme = related(&rels, &path, "theme")
        .map(|p| parse(&entries, &p))
        .transpose()?
        .unwrap_or_default();
    let cell_styles = styles::read(&style_doc, &theme)?;
    let shared = related(&rels, &path, "sharedStrings")
        .map(|p| parse(&entries, &p))
        .transpose()?
        .unwrap_or_default();
    let shared: Vec<_> = elements(&shared, "si")
        .into_iter()
        .map(|el| styles::string(&el.children))
        .collect::<Result<_, _>>()?;
    let mut book = Workbook::default();
    book.date1904 = elements(&workbook, "workbookPr")
        .first()
        .is_some_and(|el| boolean(attr(el, "date1904")));
    if let Some(root) = child_mut(&mut workbook, "workbook")
        && let Some(calc) = child_mut(&mut root.children, "calcPr")
    {
        let attribute = |key| {
            calc.attrs
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value.as_str())
        };
        let number = |key, fallback| {
            let Some(source) = attribute(key) else {
                return Ok(fallback);
            };
            let value = crate::commands::js_number(source, 0.);
            if !value.is_finite() {
                return Err(format!(
                    "Error: conversion failed: E Invalid XLSX: invalid number '{source}'\n"
                ));
            }
            Ok(value)
        };
        let maximum = number("iterateCount", 100.)?;
        if maximum < 0. || maximum.fract() != 0. || maximum > 9_007_199_254_740_991. {
            return Err(
                "Error: conversion failed: E Invalid XLSX: invalid nonnegative integer\n".into(),
            );
        }
        let tolerance = number("iterateDelta", 0.001)?;
        if tolerance < 0. {
            return Err("Invalid iteration settings\n".into());
        }
        book.manual = attribute("calcMode") == Some("manual");
        book.iteration = Some(Iteration {
            enabled: matches!(attribute("iterate"), Some("1" | "true")),
            maximum: maximum as u64,
            tolerance,
        });
    }
    let mut sheets = Vec::new();
    let mut sources = Vec::new();
    let mut sheet_rels = Vec::new();
    let mut sheet_drawings = Vec::new();
    for source in elements(&workbook, "sheet") {
        let Some(name) = attr(source, "name") else {
            continue;
        };
        let rel = elements(&rels, "Relationship")
            .into_iter()
            .find(|r| attr(r, "Id") == attr(source, "id"))
            .ok_or("Error: conversion failed: E Invalid XLSX: missing worksheet relationship\n")?;
        let path = crate::vfs::resolve_posix_path(
            path.rsplit_once('/').map_or("/", |p| p.0),
            attr(rel, "Target").unwrap_or(""),
        );
        let mut doc = parse(&entries, &path)?;
        if let Some(worksheet) = child_mut(&mut doc, "worksheet") {
            fn attr<'a>(node: &'a Element, name: &str) -> Option<&'a str> {
                node.attrs
                    .iter()
                    .find(|(key, _)| key == name)
                    .map(|(_, value)| value.as_str())
            }
            worksheet.children.retain_mut(|node| {
                if let Node::Element(node) = node
                    && matches!(
                        node.tag.rsplit(':').next(),
                        Some(
                            "conditionalFormatting"
                                | "rowBreaks"
                                | "colBreaks"
                                | "sheetPr"
                                | "printOptions"
                                | "pageMargins"
                                | "pageSetup"
                                | "headerFooter"
                                | "sheetViews"
                                | "sheetFormatPr"
                        )
                    )
                {
                    if node.tag.contains(':')
                        && node.namespace
                            != "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                        && node.tag.rsplit(':').next() != Some("conditionalFormatting")
                    {
                        return false;
                    }
                    read_metadata(node, &mut vec!["worksheet".into()], diagnostics);
                }
                true
            });
            let print_number = |value: Option<&str>, fallback: f64| {
                let value = value.map_or(fallback, |s| crate::commands::js_number(s, 0.));
                if value.is_finite() {
                    Ok(value)
                } else {
                    Err(
                        "Error: conversion failed: E Invalid XLSX: invalid print number\n"
                            .to_owned(),
                    )
                }
            };
            if let Some(margins) = elements(&worksheet.children, "pageMargins").first() {
                for key in ["top", "bottom", "left", "right", "header", "footer"] {
                    print_number(attr(margins, key), 0.)?;
                }
            }
            if let Some(setup) = elements(&worksheet.children, "pageSetup").first() {
                for (key, required, error) in [
                    ("copies", false, "print copies"),
                    (
                        "firstPageNumber",
                        matches!(attr(setup, "useFirstPageNumber"), Some("1" | "true")),
                        "first page number",
                    ),
                ] {
                    if required || attr(setup, key).is_some() {
                        let value = print_number(attr(setup, key), 1.)?;
                        if value.fract() != 0. || !(0. ..=4294967295.).contains(&value) {
                            return Err(format!(
                                "Error: conversion failed: E Invalid XLSX: invalid {error}\n"
                            ));
                        }
                    }
                }
                let fit = elements(&worksheet.children, "pageSetUpPr")
                    .first()
                    .is_some_and(|n| matches!(attr(n, "fitToPage"), Some("1" | "true")));
                if fit {
                    print_number(attr(setup, "fitToHeight"), 1.)?;
                    print_number(attr(setup, "fitToWidth"), 1.)?;
                } else {
                    print_number(attr(setup, "scale"), 100.)?;
                }
            }
            for kind in ["rowBreaks", "colBreaks"] {
                if let Some(record) = child_mut(&mut worksheet.children, kind) {
                    for node in &record.children {
                        if let Node::Element(node) = node
                            && !crate::commands::js_number(attr(node, "id").unwrap_or("0"), 0.)
                                .is_finite()
                        {
                            return Err(
                                "Error: conversion failed: E Invalid XLSX: invalid print number\n"
                                    .into(),
                            );
                        }
                    }
                }
            }
        }
        let dimensions = default_dimensions(&doc)?;
        let relations = relationships(&entries, &path)?;
        let mut drawings = Vec::new();
        for drawing in elements(&doc, "legacyDrawing") {
            if let Some(rel) = elements(&relations, "Relationship").into_iter().find(|r| {
                attr(r, "Id") == attr(drawing, "id")
                    && attr(r, "Type").is_some_and(|t| t.ends_with("/vmlDrawing"))
                    && attr(r, "TargetMode") != Some("External")
            }) && let Some(target) = attr(rel, "Target")
            {
                let target = crate::vfs::resolve_posix_path(
                    path.rsplit_once('/').map_or("/", |p| p.0),
                    target,
                );
                drawings.extend(parse(&entries, &target)?);
            }
        }
        sheet_drawings.push(drawings);
        let mut sheet = Sheet {
            style_regions: vec![],
            name: name.into(),
            view: Vec::new(),
            sylk_r1c1: None,
            sylk_hide_zero: false,
            print: Default::default(),
            filter: None,
            cells: BTreeMap::new(),
            rows: BTreeMap::new(),
            columns: BTreeMap::new(),
            merges: Vec::new(),
            arrays: Vec::new(),
            comments: Vec::new(),
            empty_headers: true,
        };
        if let Some(margins) = elements(&doc, "pageMargins").first() {
            sheet.print.margins = Some(
                ["left", "right", "top", "bottom"]
                    .map(|side| number(margins, side).map(|n| n * 72.)),
            );
        }
        if let Some(setup) = elements(&doc, "pageSetup").first() {
            sheet.print.orientation = match attr(setup, "orientation") {
                Some("portrait") => Some("portrait"),
                Some("landscape") => Some("landscape"),
                _ => None,
            };
            sheet.print.scale = number(setup, "scale").map(xlsx::Scale::Percentage);
        }
        for col in elements(&doc, "col") {
            let start = index(col, "min").unwrap_or(1).saturating_sub(1);
            let end = index(col, "max").unwrap_or(start + 1).min(16384);
            for c in start..end {
                sheet.columns.insert(
                    c,
                    Axis {
                        size: number(col, "width").map(|w| w * ((130. / 18.5703125) * (72. / 96.))),
                        hidden: boolean(attr(col, "hidden")),
                        level: index(col, "outlineLevel").unwrap_or(0),
                        style: None,
                    },
                );
            }
        }
        let mut shared_formulas = BTreeMap::<usize, ((usize, usize), String)>::new();
        let mut shared_ranges = BTreeMap::new();
        let mut shared_members = BTreeMap::new();
        let mut next_row = 0;
        let mut row_height = 12.75;
        for root in elements(&doc, "worksheet") {
            for section in &root.children {
                let Node::Element(section) = section else {
                    continue;
                };
                if section.tag.rsplit(':').next() == Some("sheetFormatPr") {
                    if let Some((_, value)) = section
                        .attrs
                        .iter()
                        .find(|(key, _)| key == "defaultRowHeight")
                    {
                        let height = crate::commands::js_number(value, 0.);
                        if height > 0. {
                            row_height = height;
                        }
                    }
                }
                if section.tag.rsplit(':').next() != Some("sheetData") {
                    continue;
                }
                for row in elements(&section.children, "row") {
                    let r = index(row, "r").unwrap_or(next_row + 1).saturating_sub(1);
                    next_row = r + 1;
                    sheet.rows.insert(
                        r,
                        Axis {
                            size: number(row, "ht").filter(|n| *n > 0.).or_else(|| {
                                (row_height != dimensions[1].unwrap_or(12.75)
                                    && (boolean(attr(row, "hidden"))
                                        || index(row, "outlineLevel").is_some()
                                        || !elements(&row.children, "c").is_empty()))
                                .then_some(row_height)
                            }),
                            hidden: boolean(attr(row, "hidden")),
                            level: index(row, "outlineLevel").unwrap_or(0),
                            style: None,
                        },
                    );
                    let mut next_column = 0;
                    for cell in elements(&row.children, "c") {
                        let (r, c) = attr(cell, "r")
                            .and_then(coordinate)
                            .unwrap_or((r, next_column));
                        next_column = c + 1;
                        let raw = elements(&cell.children, "v").first().map(|el| text(el));
                        let mut rich = None;
                        let value = match attr(cell, "t") {
                            Some("inlineStr") => {
                                let (value, runs) = styles::string(&cell.children)?;
                                rich = runs;
                                Some(Value::Text(value))
                            }
                            Some("s") => raw
                                .as_deref()
                                .and_then(|s| s.trim().parse::<usize>().ok())
                                .and_then(|i| shared.get(i))
                                .map(|(s, r)| {
                                    rich = r.clone();
                                    Value::Text(s.clone())
                                }),
                            Some("str") => raw.map(|s| Value::Text(super::xlsx_string::decode(&s))),
                            Some("b") => raw.map(|s| Value::Bool(!s.starts_with('0'))),
                            Some("e") => raw.map(Value::Error),
                            _ => raw
                                .filter(|s| !s.is_empty())
                                .map(|s| Value::Number(s.parse().unwrap_or(0.))),
                        };
                        shared_members.remove(&(r, c));
                        let mut formula = None;
                        let mut openformula = None;
                        if let Some(f) = elements(&cell.children, "f").first() {
                            let mut expression = super::xlsx_string::decode(&text(f));
                            if attr(f, "t") == Some("shared")
                                && let Some(id) = index(f, "si")
                            {
                                shared_members.insert((r, c), id);
                                if let Some(area) = attr(f, "ref").and_then(range) {
                                    shared_ranges.insert(id, (area, (r, c), expression.clone()));
                                }
                                if let Some(&(origin, ref source)) = shared_formulas.get(&id)
                                    && attr(f, "ref").is_none()
                                {
                                    expression = translate_formula(
                                        source,
                                        (r as i64 - origin.0 as i64, c as i64 - origin.1 as i64),
                                        false,
                                        &mut remaining,
                                    )?;
                                } else {
                                    shared_formulas.insert(id, ((r, c), expression.clone()));
                                }
                            }
                            if expression.trim_matches(' ').is_empty() {
                                expression = "ERROR(\"\")".into();
                            }
                            openformula = attr(f, "openformula").map(str::to_owned);
                            if attr(f, "t") == Some("array")
                                && let Some(area) = attr(f, "ref").and_then(range)
                            {
                                for row in area[0]..area[0] + area[3] {
                                    sheet.rows.entry(row).or_default();
                                }
                                sheet.arrays.push(ArrayFormula {
                                    range: area,
                                    expression: expression.clone(),
                                    openformula: openformula.clone(),
                                    formula_display: None,
                                });
                            }
                            formula = Some(expression);
                        }
                        let inherited = index(row, "s")
                            .filter(|_| boolean(attr(row, "customFormat")))
                            .or_else(|| {
                                elements(&doc, "col")
                                    .into_iter()
                                    .rev()
                                    .find(|el| {
                                        index(el, "min").is_some_and(|v| c + 1 >= v)
                                            && index(el, "max").is_some_and(|v| c < v)
                                    })
                                    .and_then(|el| index(el, "style"))
                            });
                        let style = index(cell, "s")
                            .or(inherited)
                            .and_then(|i| cell_styles.get(i))
                            .or_else(|| cell_styles.first());
                        remaining = remaining
                            .checked_sub(256 + formula.as_ref().map_or(0, String::len))
                            .ok_or(LIMIT)?;
                        sheet.cells.insert(
                            (r, c),
                            TypedCell {
                                value,
                                formula,
                                openformula,
                                formula_display: None,
                                format: style.map(|(f, _)| f.clone()),
                                value_format: None,
                                style: style.map(|(_, s)| Arc::clone(s)),
                                rich_text: rich,
                            },
                        );
                    }
                }
            }
        }
        for merge in elements(&doc, "mergeCell") {
            if let Some(area) = attr(merge, "ref").and_then(range) {
                sheet.merges.push(area);
            }
        }
        if let Some(comment_path) = related(&relations, &path, "comments") {
            let comments = parse(&entries, &comment_path)?;
            let authors: Vec<_> = elements(&comments, "author")
                .iter()
                .map(|el| super::xlsx_string::decode(&text(el)))
                .collect();
            for comment in elements(&comments, "comment") {
                if let Some((row, column)) = attr(comment, "ref").and_then(coordinate) {
                    let (value, runs) = styles::string(&comment.children)?;
                    sheet.comments.push(Comment {
                        print: true,
                        row,
                        column,
                        author: authors
                            .get(index(comment, "authorId").unwrap_or(0))
                            .cloned(),
                        runs: runs.map(|r| r.as_ref().clone()).unwrap_or_else(|| {
                            vec![xlsx::TextRun {
                                text: value,
                                attributes: Arc::new(Vec::new()),
                            }]
                        }),
                    });
                }
            }
        }
        if let Some(view) = sheet_view(&doc) {
            let field = |key| {
                view.attrs
                    .iter()
                    .find(|(name, _)| name == key)
                    .map(|(_, value)| value.as_str())
            };
            if let Some(value) = field("zoomScale")
                && !crate::commands::js_number(value, 0.).is_finite()
            {
                return Err(format!(
                    "Error: conversion failed: E Invalid XLSX: invalid number '{value}'\n"
                ));
            }
            for key in [
                "showFormulas",
                "showZeros",
                "showGridLines",
                "showRowColHeaders",
                "showOutlineSymbols",
                "rightToLeft",
            ] {
                if let Some(value) = field(key) {
                    sheet.view.push((key, matches!(value, "1" | "true")));
                }
            }
        }
        for (id, (range, origin, expression)) in shared_ranges {
            let [r, c, w, h] = range;
            let members: std::collections::BTreeSet<_> = shared_members
                .iter()
                .filter_map(|(&(row, col), &member)| {
                    (member == id && (r..r + h).contains(&row) && (c..c + w).contains(&col))
                        .then_some((row, col))
                })
                .collect();
            if w.checked_mul(h) == Some(members.len()) {
                book.shared_formulas.push(xlsx::SharedFormula {
                    sheet: sheets.len(),
                    range,
                    origin,
                    expression,
                    members,
                });
            }
        }
        book.sheet_sizes.push((1048576, 16384));
        sources.push(doc);
        sheet_rels.push(relations);
        sheets.push(sheet);
    }
    names::read(
        &mut workbook,
        &sheets,
        &mut book,
        &mut remaining,
        diagnostics,
    )?;
    if let Some(value) = elements(&workbook, "workbookView")
        .first()
        .and_then(|view| attr(view, "activeTab"))
    {
        let active = crate::commands::js_number(value, 0.);
        if !active.is_finite() {
            return Err(format!(
                "Error: conversion failed: E Invalid XLSX: invalid number '{value}'\n"
            ));
        }
        if !(0. ..=9_007_199_254_740_991.).contains(&active) || active.fract() != 0. {
            return Err(
                "Error: conversion failed: E Invalid XLSX: invalid nonnegative integer\n".into(),
            );
        }
        if active < sheets.len() as f64 {
            book.active_sheet = active as usize;
        }
    }
    properties::read(&entries, &root_rels, &mut book, &mut remaining, diagnostics)?;
    Ok((
        sheets,
        book,
        Source {
            workbook,
            theme,
            differential_styles: elements(&style_doc, "dxfs").first().map(|n| (*n).clone()),
            sheets: sources,
            relations: sheet_rels,
            drawings: sheet_drawings,
            remaining,
        },
    ))
}

pub(in crate::commands) fn prepare_xlsx(
    sheets: &mut [Sheet<String>],
    book: &mut Workbook,
    mut remaining: usize,
) -> Result<(), String> {
    let mut missing = std::collections::BTreeSet::new();
    for (index, sheet) in sheets.iter().enumerate() {
        for (&(row, col), cell) in &sheet.cells {
            if cell.formula.is_none() || cell.value.is_some() {
                continue;
            }
            // A surviving shared group replaces the edited member during
            // calculation without marking its replacement formula dirty.
            let grouped = book.shared_formulas.iter().any(|group| {
                let [r, c, w, h] = group.range;
                group.sheet == index
                    && !group.members.is_empty()
                    && !group.members.contains(&(row, col))
                    && (r..r + h).contains(&row)
                    && (c..c + w).contains(&col)
            });
            if !grouped {
                missing.insert((index, row, col));
            }
        }
    }
    if !missing.is_empty() {
        book.calculation_cells = Some(missing);
        let result = formulas::cache(Dialect::Gnumeric, sheets, book, None, remaining);
        book.calculation_cells = None;
        result.map_err(|error| match error {
            formulas::Failure::Limit => LIMIT.to_owned(),
            formulas::Failure::Unsupported(message) => format!("{message}\n"),
        })?;
    }
    let sheet_names: Vec<_> = sheets.iter().map(|s| s.name.clone()).collect();
    for (sheet, source, openformula, named) in sheets
        .iter_mut()
        .enumerate()
        .flat_map(|(i, s)| {
            s.cells
                .values_mut()
                .filter_map(move |c| c.formula.as_mut().map(|f| (i, f, &mut c.openformula, None)))
                .chain(
                    s.arrays
                        .iter_mut()
                        .map(move |g| (i, &mut g.expression, &mut g.openformula, None)),
                )
        })
        .chain(book.names.iter_mut().enumerate().map(|(index, n)| {
            (
                n.position.0,
                &mut n.expression,
                &mut n.openformula,
                Some(index),
            )
        }))
    {
        if openformula.is_none() {
            if let Some(mut parsed) = crate::commands::archive::office_ods::formula::convert(
                true,
                &format!("={source}"),
                false,
                remaining,
                true,
            )? {
                if named.is_some() {
                    parsed
                        .public_expression(&mut remaining)
                        .map_err(str::to_owned)?;
                }
                *source = parsed
                    .native_xlsx(&sheet_names, &mut remaining)
                    .map_err(|e| {
                        if e.ends_with('\n') {
                            e.to_owned()
                        } else {
                            format!("Error: conversion failed: {e}\n")
                        }
                    })?;
            }
        } else {
            crate::commands::archive::office_ods::formula::export_public_xlsx(
                source,
                openformula,
                &sheet_names,
                sheet,
                &mut book.external_links,
                named.is_some_and(|index| book.array_string_names.contains(&index)),
                &mut remaining,
            )
            .map_err(|e| {
                if e.ends_with('\n') {
                    e.to_owned()
                } else {
                    format!("Error: conversion failed: {e}\n")
                }
            })?;
        }
    }
    Ok(())
}

pub(in crate::commands) fn convert(
    bytes: &[u8],
    filename: &str,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let (mut sheets, mut book, source) = read(bytes, filename, limit, &mut String::new())?;
    let remaining = source.remaining;
    formulas::cache(Dialect::Gnumeric, &mut sheets, &book, None, remaining).map_err(
        |e| match e {
            formulas::Failure::Limit => LIMIT.into(),
            formulas::Failure::Unsupported(s) => format!("Error: conversion failed: {s}\n"),
        },
    )?;
    prepare_xlsx(&mut sheets, &mut book, remaining)?;
    let output = xlsx::write_cells(Dialect::Gnumeric, &sheets, &book, limit).ok_or(LIMIT)?;
    source.write(output, limit)
}

impl Source {
    pub(in crate::commands) fn diagnostics(&self) -> String {
        let mut output = String::new();
        let names = elements(&self.workbook, "sheet");
        for (index, source) in self.sheets.iter().enumerate() {
            let name = names
                .get(index)
                .and_then(|sheet| attr(sheet, "name"))
                .unwrap_or("");
            for kind in [
                "sheetPr",
                "printOptions",
                "pageMargins",
                "pageSetup",
                "headerFooter",
            ] {
                if let Some(node) = elements(source, kind).first() {
                    sheet_setting(node, name, &mut output);
                }
            }
            if let Some(format) = sheet_format(source) {
                sheet_setting(&format, name, &mut output);
            }
            for root in elements(source, "worksheet") {
                let mut print_records = std::collections::BTreeSet::new();
                for node in &root.children {
                    let Node::Element(node) = node else { continue };
                    let kind = node.tag.rsplit(':').next().unwrap();
                    if matches!(
                        kind,
                        "sheetPr" | "printOptions" | "pageMargins" | "pageSetup" | "headerFooter"
                    ) && !print_records.insert(kind)
                    {
                        writeln!(
                            output,
                            "XLSX writer does not export sheet '{name}' record '{kind}'"
                        )
                        .unwrap();
                        continue;
                    }
                    if node.namespace != "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                        || matches!(
                            kind,
                            "sheetData"
                                | "cols"
                                | "dimension"
                                | "mergeCells"
                                | "sheetViews"
                                | "sheetPr"
                                | "sheetFormatPr"
                                | "sheetProtection"
                                | "printOptions"
                                | "pageMargins"
                                | "pageSetup"
                                | "headerFooter"
                                | "rowBreaks"
                                | "colBreaks"
                                | "autoFilter"
                                | "conditionalFormatting"
                                | "dataValidations"
                        )
                    {
                        continue;
                    }
                    let name = names
                        .get(index)
                        .and_then(|sheet| attr(sheet, "name"))
                        .unwrap_or("");
                    writeln!(
                        output,
                        "XLSX writer does not export sheet '{name}' record '{kind}'"
                    )
                    .unwrap();
                }
            }
        }
        output
    }

    pub(in crate::commands) fn write(
        &self,
        output: Vec<u8>,
        limit: usize,
    ) -> Result<Vec<u8>, String> {
        let Self {
            workbook,
            theme,
            differential_styles,
            sheets: sources,
            relations: sheet_rels,
            drawings: sheet_drawings,
            ..
        } = self;
        let mut output = structured::read_office_archive(&output);
        let retained = differential_styles.as_ref().map(|table| {
            if table.attrs.iter().any(|(k, _)| k != "count" && k != "xmlns" && !k.starts_with("xmlns:"))
                || table.children.iter().any(|n| matches!(n, Node::Element(e) if e.tag.rsplit(':').next() != Some("dxf"))) {
                return Err("Unsupported XLSX differential style table\n".to_owned());
            }
            table.children.iter().filter_map(|n| if let Node::Element(e) = n { Some(e) } else { None }).map(|e| retained_metadata(e, true)).collect::<Result<Vec<_>, _>>()
        }).transpose()?.unwrap_or_default();
        if !retained.is_empty() {
            let mut styles = parse(&output, "xl/styles.xml")?;
            let root = child_mut(&mut styles, "styleSheet").ok_or(LIMIT)?;
            let mut table = differential_styles.as_ref().unwrap().clone();
            table.tag = "dxfs".into();
            table.attrs = vec![("count".into(), retained.len().to_string())];
            table.children = retained.iter().cloned().map(Node::Element).collect();
            root.children.push(Node::Element(table));
            output.insert("xl/styles.xml".into(), serialize(&styles, limit)?);
        }

        for (i, source) in sources.iter().enumerate() {
            let path = format!("xl/worksheets/sheet{}.xml", i + 1);
            let mut target = parse(&output, &path)?;
            let root = child_mut(&mut target, "worksheet").ok_or(LIMIT)?;
            if let Some(value) = sheet_view(source).and_then(|v| {
                v.attrs
                    .iter()
                    .find(|(key, _)| key == "zoomScale")
                    .map(|(_, value)| value)
            }) && let Some(value) = xlsx::zoom(crate::commands::js_number(value, 0.) / 100.)
                && let Some(views) = child_mut(&mut root.children, "sheetViews")
                && let Some(view) = child_mut(&mut views.children, "sheetView")
            {
                view.attrs.insert(1, ("zoomScale".into(), value));
            }
            for key in [
                "sheetPr",
                "printOptions",
                "pageMargins",
                "pageSetup",
                "headerFooter",
            ] {
                if let Some(retained) = elements(source, key).first()
                    && let Some(slot) = root
                        .children
                        .iter_mut()
                        .find(|n| matches!(n,Node::Element(e) if e.tag==key))
                {
                    *slot = Node::Element(sheet_setting(retained, "", &mut String::new()));
                }
            }
            let dimensions = default_dimensions(source)?;
            if let Some(settings) = sheet_format(source)
                && let Some(dest) = child_mut(&mut root.children, "sheetFormatPr")
            {
                let mut retained = sheet_setting(&settings, "", &mut String::new());
                let width = format_width(&settings);
                let height = settings
                    .attrs
                    .iter()
                    .find(|(key, _)| key == "defaultRowHeight")
                    .map_or(12.75, |(_, value)| crate::commands::js_number(value, 0.));
                for (key, before, after) in [
                    (
                        "defaultColWidth",
                        width.map(|n| n / ((130. / 18.5703125) * (72. / 96.))),
                        dimensions[0]
                            .or(width)
                            .map(|n| n / ((130. / 18.5703125) * (72. / 96.))),
                    ),
                    (
                        "defaultRowHeight",
                        Some(height),
                        Some(dimensions[1].unwrap_or(height)),
                    ),
                ] {
                    if before != after
                        && let Some(value) = after
                    {
                        set(&mut retained, key, xlsx::attribute_number(value));
                    }
                }
                for key in ["outlineLevelRow", "outlineLevelCol"] {
                    if let Some(value) = attr(dest, key) {
                        set(&mut retained, key, value.into());
                    } else {
                        retained.attrs.retain(|(name, _)| name != key);
                    }
                }
                *dest = retained;
            }
            // Width-only column records contribute to the imported used extent.
            if let Some(data) = child_mut(&mut root.children, "sheetData") {
                for node in &mut data.children {
                    if let Node::Element(row) = node {
                        if let Some(original) = elements(source, "row")
                            .into_iter()
                            .find(|el| attr(el, "r") == attr(row, "r"))
                            && !boolean(attr(original, "customHeight"))
                        {
                            row.attrs.retain(|(k, _)| k != "customHeight");
                        }
                    }
                }
            }
            if let Some(cols) = child_mut(&mut root.children, "cols") {
                let default = xlsx::attribute_number(
                    dimensions[0].unwrap_or(48.) / ((130. / 18.5703125) * (72. / 96.)),
                );
                for node in &mut cols.children {
                    if let Node::Element(col) = node {
                        if !col.attrs.iter().any(|(k, _)| k == "customWidth") {
                            set(col, "width", default.clone());
                        } else if let Some(origin) = elements(source, "col")
                            .into_iter()
                            .find(|el| index(el, "min") == index(col, "min"))
                        {
                            if let Some(width) = attr(origin, "width") {
                                set(col, "width", width.into());
                            }
                            if !boolean(attr(origin, "customWidth")) {
                                col.attrs.retain(|(k, _)| k != "customWidth");
                            }
                        }
                    }
                }
                // Imported default-width runs do not introduce extra output styles.
                let mut merged: Vec<Node> = Vec::new();
                for node in std::mem::take(&mut cols.children) {
                    if let Node::Element(current) = &node
                        && let Some(Node::Element(previous)) = merged.last_mut()
                        && previous
                            .attrs
                            .iter()
                            .filter(|(k, _)| k != "min" && k != "max")
                            .eq(current
                                .attrs
                                .iter()
                                .filter(|(k, _)| k != "min" && k != "max"))
                    {
                        set(previous, "max", attr(current, "max").unwrap().into());
                        continue;
                    }
                    merged.push(node);
                }
                cols.children = merged;
            }
            if let Some(links) = elements(source, "hyperlinks").first() {
                let mut links = canonical(links);
                let rel_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", i + 1);
                let mut rel_doc = if output.contains_key(&rel_path) {
                    parse(&output, &rel_path)?
                } else {
                    xml::parse("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"/>",None,None).map_err(|_|LIMIT)?.nodes
                };
                let rel_root = child_mut(&mut rel_doc, "Relationships").ok_or(LIMIT)?;
                for node in &mut links.children {
                    if let Node::Element(link) = node {
                        if let Some(rel) = elements(&sheet_rels[i], "Relationship")
                            .into_iter()
                            .find(|r| attr(r, "Id") == attr(link, "id"))
                        {
                            let id = format!("rId{}", rel_root.children.len() + 1);
                            set(link, "r:id", id.clone());
                            let mut rel = canonical(rel);
                            set(&mut rel, "Id", id);
                            rel_root.children.push(Node::Element(rel));
                        }
                    }
                }
                let at = root
                    .children
                    .iter()
                    .position(|n| matches!(n,Node::Element(e) if e.tag=="printOptions"))
                    .unwrap_or(root.children.len());
                root.children.insert(at, Node::Element(links));
                output.insert(rel_path, serialize(&rel_doc, limit)?);
            }
            if let Some(worksheet) = elements(source, "worksheet").first() {
                for kind in ["rowBreaks", "colBreaks"] {
                    if let Some(record) = worksheet.children.iter().find_map(|node| match node {
                        Node::Element(record) if record.tag.rsplit(':').next() == Some(kind) => {
                            Some(record)
                        }
                        _ => None,
                    }) && record
                        .children
                        .iter()
                        .any(|node| matches!(node, Node::Element(_)))
                    {
                        let at = root.children.iter().position(|node| matches!(node, Node::Element(e) if matches!(e.tag.as_str(), "legacyDrawing" | "tableParts"))).unwrap_or(root.children.len());
                        root.children
                            .insert(at, Node::Element(retained_metadata(record, false)?));
                    }
                }
                for kind in ["conditionalFormatting", "dataValidations"] {
                    for node in &worksheet.children {
                        if let Node::Element(record) = node
                            && record.tag.rsplit(':').next() == Some(kind)
                            && record.namespace
                                == "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                        {
                            if kind == "conditionalFormatting" {
                                for node in &record.children {
                                    if let Node::Element(rule) = node
                                        && let Some(id) = attr(rule, "dxfId")
                                    {
                                        let number = crate::commands::js_number(id, f64::NAN);
                                        if id.trim().is_empty()
                                            || !number.is_finite()
                                            || number.fract() != 0.
                                            || number < 0.
                                            || number >= retained.len() as f64
                                        {
                                            return Err(
                                                "Unsupported XLSX differential style reference\n"
                                                    .into(),
                                            );
                                        }
                                    }
                                }
                            }
                            let at = root.children.iter().position(|n| matches!(n, Node::Element(e) if matches!(e.tag.as_str(), "dataValidations" | "hyperlinks" | "printOptions") && (kind == "conditionalFormatting" || e.tag != "dataValidations"))).unwrap_or(root.children.len());
                            root.children
                                .insert(at, Node::Element(retained_metadata(record, false)?));
                        }
                    }
                }
            }
            let drawing_path = format!("xl/drawings/vmlDrawing{}.vml", i + 1);
            if output.contains_key(&drawing_path) {
                let mut doc = parse(&output, &drawing_path)?;
                comments::restore(&mut doc, &sheet_drawings[i]);
                output.insert(drawing_path, serialize(&doc, limit)?);
            }
            output.insert(path, serialize(&target, limit)?);
        }
        let mut result = parse(&output, "xl/workbook.xml")?;
        let root = child_mut(&mut result, "workbook").ok_or(LIMIT)?;
        names::restore(workbook, &mut root.children);
        if let Some(protection) = elements(&workbook, "workbookProtection").first() {
            let at = root
                .children
                .iter()
                .position(|n| matches!(n,Node::Element(e) if e.tag=="bookViews"))
                .unwrap_or(0);
            root.children
                .insert(at, Node::Element(canonical(protection)));
        }
        output.insert("xl/workbook.xml".into(), serialize(&result, limit)?);
        if let Some(theme) = elements(&theme, "theme").first() {
            let mut root = canonical(theme);
            root.attrs.insert(
                0,
                (
                    "xmlns".into(),
                    "http://schemas.openxmlformats.org/drawingml/2006/main".into(),
                ),
            );
            output.insert(
                "xl/theme/theme1.xml".into(),
                serialize(&[Node::Element(root)], limit)?,
            );
            let mut rels = parse(&output, "xl/_rels/workbook.xml.rels")?;
            let root = child_mut(&mut rels, "Relationships").ok_or(LIMIT)?;
            let id = elements(&root.children, "Relationship").len() + 1;
            let rel=xml::parse(&format!("<Relationship Id=\"rId{id}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"theme/theme1.xml\"/>"),None,None).map_err(|_|LIMIT)?.nodes.remove(0);
            root.children.insert(0, rel);
            output.insert(
                "xl/_rels/workbook.xml.rels".into(),
                serialize(&rels, limit)?,
            );
            let mut types = parse(&output, "[Content_Types].xml")?;
            let root = child_mut(&mut types, "Types").ok_or(LIMIT)?;
            let at = root
                .children
                .iter()
                .position(
                    |n| matches!(n,Node::Element(e) if attr(e,"PartName")==Some("/xl/styles.xml")),
                )
                .unwrap_or(root.children.len());
            let node=xml::parse("<Override PartName=\"/xl/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>",None,None).map_err(|_|LIMIT)?.nodes.remove(0);
            root.children.insert(at, node);
            output.insert("[Content_Types].xml".into(), serialize(&types, limit)?);
        }
        let entries: Vec<_> = output
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect();
        if entries
            .iter()
            .map(|(k, v)| 76 + k.len() * 2 + v.len())
            .sum::<usize>()
            .saturating_add(22)
            > limit
        {
            return Err(LIMIT.into());
        }
        Ok(structured::write_zip_stored(&entries))
    }
}

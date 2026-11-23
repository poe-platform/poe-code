use super::super::formula_arguments::Syntax;
use super::{LIMIT, Value, attr, cell_position, coordinate, elements, read, row_position, xml};
use crate::commands::spreadsheet::office_xml::decode;
use crate::commands::{codecs, structured};
use std::{borrow::Cow, collections::BTreeMap, fmt::Write};

const INVALID: &str = "Error: conversion failed: invalid XLSX package\n";

#[path = "office_xlsx_formats.rs"]
mod formats;

#[path = "office_xlsx_names.rs"]
mod names;

#[path = "office_xlsx_metadata.rs"]
mod metadata;

fn cached(
    cell: &mut xml::Element,
    typed: Option<&crate::commands::spreadsheet::model::TypedCell<String>>,
    work: &mut usize,
) -> Result<(), String> {
    let (kind, value) = match typed.and_then(|c| c.value.as_ref()) {
        Some(Value::Number(n))
            if matches!(*n, 0. | 1.)
                && typed.and_then(|c| c.value_format.as_deref()) == Some("BOOLEAN") =>
        {
            ("b", u8::from(*n != 0.).to_string())
        }
        // Stored numeric values must round-trip exactly; display formatting
        // rounds to 15 digits and can collapse distinct cells and caches.
        Some(Value::Number(n)) => ("n", super::super::model::number(*n)),
        Some(Value::Bool(b)) => ("b", u8::from(*b).to_string()),
        Some(Value::Text(s)) => (
            "str",
            super::super::xlsx_string::encode(s, work).ok_or(LIMIT)?,
        ),
        Some(Value::Error(s)) => ("e", crate::commands::spreadsheet::model::error(s).into()),
        Some(Value::Empty) | None => ("n", "0".into()),
    };
    cell.attrs.retain(|(k, _)| k != "t");
    if kind != "n" {
        cell.attrs.push(("t".into(), kind.into()));
    }
    cell.children.retain(|n| {
        !matches!(n, xml::Node::Element(el) if matches!(el.tag.rsplit(':').next(), Some("v" | "is")))
    });
    let prefix = cell.tag.strip_suffix('c').unwrap();
    let cached = xml::Node::Element(xml::Element {
        namespace: String::new(),
        self_closing: false,
        tag: format!("{prefix}v"),
        attrs: Vec::new(),
        children: vec![xml::Node::Text(value, None)],
    });
    // The schema puts the cache before extLst; retain formula and extension nodes.
    let at = cell
        .children
        .iter()
        .position(
            |n| matches!(n, xml::Node::Element(el) if el.tag.rsplit(':').next() == Some("extLst")),
        )
        .unwrap_or(cell.children.len());
    cell.children.insert(at, cached);
    Ok(())
}

fn worksheet(
    doc: &mut xml::Document,
    imported: &super::Imported,
    sheet_index: usize,
    names: &mut names::Names,
    formats: &mut formats::Formats,
    work: &mut usize,
) -> Result<(), String> {
    let sheet = &imported.sheets[sheet_index];
    let book = &imported.book;
    let mut missing = std::collections::BTreeSet::new();
    let mut compiled_names = std::collections::BTreeSet::new();
    for array in &sheet.arrays {
        let [r, c, w, h] = array.range;
        for row in r..r + h {
            for col in c..c + w {
                missing.insert((row, col));
            }
        }
    }
    let Some(xml::Node::Element(root)) = doc
        .nodes
        .iter_mut()
        .find(|n| matches!(n, xml::Node::Element(_)))
    else {
        return Err(INVALID.into());
    };
    for node in &mut root.children {
        if let xml::Node::Element(el) = node
            && el.tag.rsplit(':').next() == Some("dimension")
            && let Some((_, range)) = el.attrs.iter_mut().find(|(k, _)| k == "ref")
        {
            let (first, last) = range.split_once(':').unwrap_or((range, range));
            if let (Some(mut first), Some(mut last)) = (coordinate(first), coordinate(last)) {
                for &(r, c) in sheet.cells.keys() {
                    first = (first.0.min(r), first.1.min(c));
                    last = (last.0.max(r), last.1.max(c));
                }
                if !missing.is_empty() {
                    let a = format!(
                        "{}{}",
                        structured::xlsx_idx_to_col_ref(first.1),
                        first.0 + 1
                    );
                    let b = format!("{}{}", structured::xlsx_idx_to_col_ref(last.1), last.0 + 1);
                    *range = if first == last { a } else { format!("{a}:{b}") };
                }
            }
        }
    }
    let Some(data) = root.children.iter_mut().find_map(|n| match n {
        xml::Node::Element(el) if el.tag.rsplit(':').next() == Some("sheetData") => Some(el),
        _ => None,
    }) else {
        return if sheet.cells.is_empty() {
            Ok(())
        } else {
            Err(INVALID.into())
        };
    };
    // Retain the original compiled sources before rewriting any cells. Reuse
    // can cross gaps or reversed XML rows, and retains whitespace token counts.
    let mut sources = BTreeMap::new();
    let mut row_index = -1;
    for row in elements(&data.children, "row") {
        row_index = row_position(row, row_index);
        let mut column_index = -1;
        for cell in elements(&row.children, "c") {
            if let Some(position) = cell_position(cell, row_index, &mut column_index)
                && let Some(formula) = elements(&cell.children, "f").first()
                && attr(formula, "t").is_none_or(|t| matches!(t, "normal" | "shared"))
            {
                let source = super::text(formula);
                *work = work.checked_sub(source.len() + 64).ok_or(LIMIT)?;
                sources.insert(position, source);
            }
        }
    }
    let mut row_index = -1;
    for node in &mut data.children {
        let xml::Node::Element(row) = node else {
            continue;
        };
        if row.tag.rsplit(':').next() != Some("row") {
            continue;
        }
        row_index = row_position(row, row_index);
        let mut column_index = -1;
        for node in &mut row.children {
            let xml::Node::Element(cell) = node else {
                continue;
            };
            if cell.tag.rsplit(':').next() != Some("c") {
                continue;
            }
            let Some(position) = cell_position(cell, row_index, &mut column_index) else {
                continue;
            };
            if missing.contains(&position)
                && sheet
                    .cells
                    .get(&position)
                    .is_some_and(|cell| cell.openformula.is_none())
            {
                cell.children.retain(|node| {
                    !matches!(node, xml::Node::Element(el) if el.tag.rsplit(':').next() == Some("f"))
                });
            }
            // Calc imports Boolean and error literals as formula cells.
            if matches!(attr(cell, "t"), Some("b" | "e"))
                && elements(&cell.children, "f").is_empty()
                && let Some(formula) = sheet
                    .cells
                    .get(&position)
                    .and_then(|cell| cell.formula.as_ref())
            {
                *work = work.checked_sub(formula.len() + 128).ok_or(LIMIT)?;
                cell.children.insert(
                    0,
                    xml::Node::Element(xml::Element {
                        namespace: String::new(),
                        self_closing: false,
                        tag: format!("{}f", cell.tag.strip_suffix('c').unwrap()),
                        attrs: Vec::new(),
                        children: vec![xml::Node::Text(formula.clone(), None)],
                    }),
                );
            }
            for node in &mut cell.children {
                if let xml::Node::Element(el) = node
                    && el.tag.rsplit(':').next() == Some("f")
                {
                    if attr(el, "t") == Some("array")
                        && let Some((_, range)) = el.attrs.iter_mut().find(|(key, _)| key == "ref")
                        && !range.contains(':')
                        && coordinate(range).is_some()
                    {
                        *work = work
                            .checked_sub(
                                range
                                    .len()
                                    .checked_mul(2)
                                    .and_then(|len| len.checked_add(1))
                                    .ok_or(LIMIT)?,
                            )
                            .ok_or(LIMIT)?;
                        *range = format!("{range}:{range}");
                    }
                    let source = super::text(el);
                    let origin = book
                        .formula_origins
                        .get(&(sheet_index, position.0, position.1));
                    let inherited = origin.and_then(|&(_, row, col)| {
                        sheet
                            .cells
                            .get(&position)
                            .and_then(|cell| cell.openformula.as_deref())
                            .and_then(|source| source.strip_prefix("msoxl:="))
                            .or_else(|| sources.get(&(row, col)).map(String::as_str))
                            .map(|source| (source, row, col))
                    });
                    let (code, offset) =
                        inherited.map_or((source.as_str(), (0, 0)), |(code, row, col)| {
                            (
                                code,
                                (
                                    position.0 as i64 - row as i64,
                                    position.1 as i64 - col as i64,
                                ),
                            )
                        });
                    let mut output = super::formula_tokens(
                        code,
                        names.labels,
                        &imported.sources,
                        (Some(sheet_index), Some(sheet_index)),
                        offset,
                        Syntax::Xlsx,
                        work,
                    )
                    .ok_or(LIMIT)?;
                    if output.text.is_empty() && attr(el, "t") != Some("array") {
                        *work = work.checked_sub(8).ok_or(LIMIT)?;
                        output.text = Cow::Borrowed("#ERR520!");
                    }
                    if !output.names.is_empty() {
                        *work = work.checked_sub(64).ok_or(LIMIT)?;
                        // Calc emits one compiled formula per column group, including
                        // each column of an imported two-dimensional shared group.
                        let group = (position.1, origin.map_or(position.0, |origin| origin.1));
                        if compiled_names.insert(group) {
                            for index in output.names {
                                *work = work
                                    .checked_sub(std::mem::size_of::<(usize, usize)>())
                                    .ok_or(LIMIT)?;
                                names.used.push((sheet_index, index));
                            }
                        }
                    }
                    if inherited.is_some() && attr(el, "t") == Some("shared") {
                        el.attrs
                            .retain(|(key, _)| !matches!(key.as_str(), "t" | "si" | "ref"));
                    }
                    let output =
                        super::super::xlsx_string::encode(&output.text, work).ok_or(LIMIT)?;
                    if output != source {
                        el.children = vec![xml::Node::Text(output, None)];
                    }
                }
            }
            let array = missing.remove(&position);
            if !array
                && elements(&cell.children, "f").is_empty()
                && let Some(Value::Text(text)) = sheet
                    .cells
                    .get(&position)
                    .and_then(|typed| typed.value.as_ref())
                && (attr(cell, "t") == Some("str") || text.is_empty())
            {
                // Literal strings are exported through the string table (or
                // its inline equivalent). Empty rich strings become plain text.
                let encoded = super::super::xlsx_string::encode(text, work).ok_or(LIMIT)?;
                let prefix = cell.tag.strip_suffix('c').unwrap();
                let value = cell
                    .children
                    .iter_mut()
                    .find_map(|node| match node {
                        xml::Node::Element(el)
                            if matches!(el.tag.rsplit(':').next(), Some("v" | "is")) =>
                        {
                            Some(el)
                        }
                        _ => None,
                    })
                    .ok_or(INVALID)?;
                *work = work.checked_sub(value.tag.len() + 128).ok_or(LIMIT)?;
                let tag = format!("{prefix}t");
                value.tag = format!("{prefix}is");
                value.attrs.clear();
                value.children = vec![xml::Node::Element(xml::Element {
                    namespace: String::new(),
                    self_closing: false,
                    tag,
                    attrs: vec![("xml:space".into(), "preserve".into())],
                    children: vec![xml::Node::Text(encoded, None)],
                })];
                cell.attrs.iter_mut().find(|(k, _)| k == "t").unwrap().1 = "inlineStr".into();
            }
            if (array || !elements(&cell.children, "f").is_empty())
                && let Some(typed) = sheet.cells.get(&position)
            {
                cached(cell, Some(typed), work)?;
                if let Some(format) = typed.value_format.as_deref()
                    && !format.eq_ignore_ascii_case("General")
                    && format != "BOOLEAN"
                    && Some(format) != typed.format.as_deref()
                {
                    let base = attr(cell, "s").and_then(|s| s.parse().ok()).unwrap_or(0);
                    let index = formats.index(base, format)?;
                    cell.attrs.retain(|(key, _)| key != "s");
                    cell.attrs.push(("s".into(), index.to_string()));
                }
            }
            // Inserting matrix cells must not move implicitly addressed cells.
            if !sheet.arrays.is_empty() && attr(cell, "r").is_none_or(str::is_empty) {
                cell.attrs.retain(|(k, _)| k != "r");
                cell.attrs.push((
                    "r".into(),
                    format!(
                        "{}{}",
                        structured::xlsx_idx_to_col_ref(position.1),
                        position.0 + 1
                    ),
                ));
            }
        }
        if !sheet.arrays.is_empty() && (0..1_048_576).contains(&row_index) {
            if let Some((_, r)) = row.attrs.iter_mut().find(|(k, _)| k == "r") {
                *r = (row_index + 1).to_string();
            } else {
                row.attrs.push(("r".into(), (row_index + 1).to_string()));
            }
        }
    }
    if missing.is_empty() {
        return Ok(());
    }
    let prefix = data.tag.strip_suffix("sheetData").unwrap();
    let mut rows = BTreeMap::<usize, BTreeMap<usize, xml::Node>>::new();
    for (r, c) in missing {
        let mut cell = xml::Element {
            namespace: String::new(),
            self_closing: false,
            tag: format!("{prefix}c"),
            attrs: vec![(
                "r".into(),
                format!("{}{}", structured::xlsx_idx_to_col_ref(c), r + 1),
            )],
            children: Vec::new(),
        };
        cached(&mut cell, sheet.cells.get(&(r, c)), work)?;
        rows.entry(r)
            .or_default()
            .insert(c, xml::Node::Element(cell));
    }
    // Merge sparse matrix cells into existing rows without rebuilding their metadata.
    for node in &mut data.children {
        let xml::Node::Element(row) = node else {
            continue;
        };
        if row.tag.rsplit(':').next() != Some("row") {
            continue;
        }
        let r = row_position(row, -1);
        let Some(mut cells) = usize::try_from(r).ok().and_then(|r| rows.remove(&r)) else {
            continue;
        };
        let mut children = Vec::new();
        let mut column_index = -1;
        for node in std::mem::take(&mut row.children) {
            if let xml::Node::Element(cell) = &node
                && cell.tag.rsplit(':').next() == Some("c")
                && let Some((_, c)) = cell_position(cell, r, &mut column_index)
            {
                while cells.first_key_value().is_some_and(|(&col, _)| col < c) {
                    children.push(cells.pop_first().unwrap().1);
                }
            }
            children.push(node);
        }
        children.extend(cells.into_values());
        row.children = children;
    }
    let mut rows = rows
        .into_iter()
        .map(|(r, cells)| {
            (
                r,
                xml::Node::Element(xml::Element {
                    namespace: String::new(),
                    self_closing: false,
                    tag: format!("{prefix}row"),
                    attrs: vec![("r".into(), (r + 1).to_string())],
                    children: cells.into_values().collect(),
                }),
            )
        })
        .peekable();
    let mut children = Vec::new();
    for node in std::mem::take(&mut data.children) {
        if let xml::Node::Element(row) = &node
            && row.tag.rsplit(':').next() == Some("row")
        {
            let r = row_position(row, -1);
            while rows.peek().is_some_and(|(next, _)| (*next as i64) < r) {
                children.push(rows.next().unwrap().1);
            }
        }
        children.push(node);
    }
    children.extend(rows.map(|(_, row)| row));
    data.children = children;
    Ok(())
}

fn serialize(doc: &xml::Document, limit: usize) -> Result<Vec<u8>, String> {
    let mut output = xml::EncodedOutput {
        bytes: Vec::new(),
        encoding: None,
        limit,
    };
    output
        .write_str("<?xml version=\"1.0\" encoding=\"UTF-8\"")
        .map_err(|_| LIMIT)?;
    if let Some(standalone) = &doc.standalone {
        write!(output, " standalone=\"{standalone}\"").map_err(|_| LIMIT)?;
    }
    output.write_str("?>").map_err(|_| LIMIT)?;
    for node in &doc.nodes {
        match node {
            xml::Node::Element(el) => structured::serialize_xml_pretty(
                el,
                false,
                false,
                xml::Escaping::Unicode,
                &mut output,
            ),
            xml::Node::Text(s, low) => output.write_str(&xml::Escaping::Unicode.text(s, *low)),
            xml::Node::Markup(s) => output.write_str(s),
            xml::Node::Cdata(s) => write!(output, "<![CDATA[{s}]]>"),
        }
        .map_err(|_| LIMIT)?;
    }
    Ok(output.bytes)
}

pub(in crate::commands) fn export_xlsx(bytes: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    let limit = limit.min(u32::MAX as usize);
    if bytes.len() > limit {
        return Err(LIMIT.into());
    }
    let (members, _) = codecs::zip_directory(bytes.len(), |range| Ok(Cow::Borrowed(&bytes[range])))
        .map_err(|_| INVALID)?;
    if members.len() > usize::from(u16::MAX) {
        return Err(LIMIT.into());
    }
    let mut entries = BTreeMap::new();
    let mut remaining = limit;
    let mut size = 22usize;
    for member in members {
        if !matches!(member.method, 0 | 8) || entries.contains_key(&member.name) {
            return Err(INVALID.into());
        }
        if member.name.len() > usize::from(u16::MAX) {
            return Err(LIMIT.into());
        }
        remaining = remaining
            .checked_sub(member.size)
            .and_then(|n| n.checked_sub(member.name.len() + 128))
            .ok_or(LIMIT)?;
        size = size
            .checked_add(member.size)
            .and_then(|n| n.checked_add(76 + member.name.len() * 2))
            .filter(|&n| n <= limit)
            .ok_or(LIMIT)?;
        let value = member
            .decode(Cow::Borrowed(&bytes[member.payload.clone()]), None)
            .map_err(|_| INVALID)?;
        entries.insert(member.name, value.into_owned());
    }
    let imported = read(&entries, remaining, false)?;
    if imported.sources.is_empty() {
        return crate::commands::spreadsheet::model::write_cells(
            crate::commands::spreadsheet::model::Dialect::LibreOffice,
            &imported.sheets,
            &imported.book,
            imported.remaining,
            None,
        )
        .ok_or_else(|| LIMIT.into());
    }
    let style_path = imported.style_path.clone().unwrap_or_else(|| {
        let (directory, _) = imported.workbook_path.rsplit_once('/').unwrap();
        format!("{directory}/styles.xml")
    });
    let mut formats = formats::Formats::new(
        entries
            .get(style_path.trim_start_matches('/'))
            .map(Vec::as_slice),
        imported.remaining,
    )?;
    let mut work = imported.remaining;
    metadata::write(&mut entries, imported.app_path.as_deref(), &mut work, limit)?;
    size = entries
        .iter()
        .try_fold(22usize, |size, (name, bytes)| {
            size.checked_add(76 + name.len() * 2)?
                .checked_add(bytes.len())
        })
        .filter(|&size| size <= limit)
        .ok_or(LIMIT)?;
    let mut names = names::Names {
        labels: &imported.book.names,
        used: Vec::new(),
    };
    for (sheet_index, (_, path)) in imported.sources.iter().enumerate() {
        let source = entries.get(path).ok_or(INVALID)?;
        let mut doc =
            xml::parse(&decode(source).map_err(|_| INVALID)?, None, None).map_err(|_| INVALID)?;
        worksheet(
            &mut doc,
            &imported,
            sheet_index,
            &mut names,
            &mut formats,
            &mut work,
        )?;
        let other = size - source.len();
        let output = serialize(&doc, limit - other)?;
        size = other + output.len();
        entries.insert(path.clone(), output);
    }
    if formats.changed() {
        formats.write(&mut entries, &imported.workbook_path, &style_path, limit)?;
    }
    // Calc exports automatic calculation even when the input used manual mode.
    // Keeping manual mode makes its next import zero nonnumeric cached values.
    let path = imported.workbook_path.trim_start_matches('/');
    if let Some(source) = entries.get(path) {
        let mut doc =
            xml::parse(&decode(source).map_err(|_| INVALID)?, None, None).map_err(|_| INVALID)?;
        let mut changed =
            super::normalize_names(&mut doc.nodes, imported.sources.len(), &mut work)?;
        for node in &mut doc.nodes {
            if let xml::Node::Element(root) = node {
                for node in &mut root.children {
                    if let xml::Node::Element(el) = node
                        && el.tag.rsplit(':').next() == Some("definedNames")
                    {
                        names.export(el, &imported.sources, &mut work)?;
                        changed = true;
                    }
                    if let xml::Node::Element(el) = node
                        && el.tag.rsplit(':').next() == Some("calcPr")
                    {
                        el.attrs.retain(|(key, _)| {
                            if key == "calcMode" {
                                changed = true;
                                false
                            } else {
                                true
                            }
                        });
                    }
                }
            }
        }
        if changed {
            let other = size - source.len();
            let output = serialize(&doc, limit - other)?;
            *entries.get_mut(path).unwrap() = output;
        }
    }
    if entries.len() > usize::from(u16::MAX) {
        return Err(LIMIT.into());
    }
    entries
        .iter()
        .try_fold(22usize, |size, (name, bytes)| {
            size.checked_add(76 + name.len() * 2)?
                .checked_add(bytes.len())
        })
        .filter(|&size| size <= limit)
        .ok_or(LIMIT)?;
    Ok(structured::write_zip_stored(
        &entries
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect::<Vec<_>>(),
    ))
}

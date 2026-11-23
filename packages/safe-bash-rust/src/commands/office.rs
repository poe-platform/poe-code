use super::html_escape_str;
use crate::commands::structured::{
    HtmlNode, bounded_html_dom, write_zip_stored, xlsx_idx_to_col_ref,
};
use std::collections::BTreeSet;
use std::fmt::Write;

pub(super) const SOURCE_LOAD_ERROR: &str = "Error: source file could not be loaded\n";

#[path = "office_ods_case_fold.rs"]
pub(in crate::commands) mod case_fold;
#[path = "office_collation.rs"]
pub(super) mod collation;
#[path = "office_csv.rs"]
pub(super) mod csv;
#[path = "office_dates.rs"]
pub(in crate::commands) mod dates;
#[path = "office_format.rs"]
pub(super) mod format;
#[path = "office_formula_arguments.rs"]
pub(super) mod formula_arguments;
#[path = "office_formulas.rs"]
pub(in crate::commands) mod formulas;
#[path = "office_function_names.rs"]
pub(super) mod function_names;
#[cfg(test)]
#[path = "office_name_order.rs"]
pub(super) mod name_order;
#[path = "office_number_format.rs"]
pub(super) mod number_format;
#[path = "office_formula_sheet_name.rs"]
pub(super) mod sheet_name;
#[path = "office_xlsx_gnumeric.rs"]
pub(in crate::commands) mod xlsx_gnumeric;
#[path = "office_xlsx_references.rs"]
pub(super) mod xlsx_references;
#[path = "office_xlsx_string.rs"]
pub(in crate::commands) mod xlsx_string;
pub(in crate::commands) fn coordinate(reference: &str) -> Option<(usize, usize)> {
    let reference = reference.strip_prefix('$').unwrap_or(reference);
    let letters = reference
        .bytes()
        .take_while(u8::is_ascii_alphabetic)
        .count();
    let column = reference[..letters].bytes().try_fold(0usize, |n, b| {
        n.checked_mul(26)?
            .checked_add(usize::from(b.to_ascii_uppercase() - b'A' + 1))
    })?;
    let row = reference[letters..]
        .strip_prefix('$')
        .unwrap_or(&reference[letters..])
        .parse::<usize>()
        .ok()?;
    ((1..=1_048_576).contains(&row) && (1..=16_384).contains(&column))
        .then(|| (row - 1, column - 1))
}

pub(super) fn valid_sheet_name(name: &str) -> bool {
    !name.is_empty()
}
pub(super) struct TextStyle {
    pub start: usize,
    pub end: usize,
    pub bold: bool,
    pub italic: bool,
}
pub(super) struct DocumentText {
    pub value: String,
    pub html: String,
    pub styles: Vec<TextStyle>,
}
pub(super) enum DocumentBlock {
    PageSize([f64; 2]),
    PageBreak(bool),
    Paragraph {
        text: DocumentText,
        heading: bool,
        list: Option<DocumentList>,
    },
    Table(Vec<Vec<DocumentText>>),
    Image {
        bytes: Vec<u8>,
        width: f64,
        height: f64,
    },
}
pub(super) struct DocumentList {
    pub id: String,
    pub level: usize,
    pub ordered: bool,
    pub number: i64,
    pub marker: String,
}

pub(super) fn space(c: char) -> bool {
    c == '\u{feff}' || c != '\u{85}' && c.is_whitespace()
}

pub(super) fn plain_blocks(blocks: &[DocumentBlock]) -> Vec<Block> {
    blocks
        .iter()
        .map(|b| match b {
            DocumentBlock::Paragraph { text, heading, .. } => {
                Block::Text(text.value.clone(), *heading)
            }
            DocumentBlock::Table(rows) => Block::Table(
                rows.iter()
                    .map(|r| r.iter().map(|c| c.value.clone()).collect())
                    .collect(),
            ),
            DocumentBlock::Image { .. } | DocumentBlock::PageSize(_) | DocumentBlock::PageBreak(_) => Block::Text(String::new(), false),
        })
        .collect()
}
pub(super) fn document_html(blocks: &[DocumentBlock], title: &str) -> String {
    let mut out = format!(
        "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"><title>{}</title></head><body>\n",
        html_escape_str(title)
    );
    let mut lists: Vec<&DocumentList> = Vec::new();
    let close = |lists: &mut Vec<&DocumentList>, level: Option<usize>, out: &mut String| {
        while lists
            .last()
            .is_some_and(|l| level.is_none_or(|level| l.level > level))
        {
            let list = lists.pop().unwrap();
            writeln!(out, "</li>\n</{}>", if list.ordered { "ol" } else { "ul" }).unwrap();
        }
    };
    for block in blocks {
        match block {
            DocumentBlock::Paragraph {
                text,
                list: Some(list),
                ..
            } => {
                close(&mut lists, Some(list.level), &mut out);
                if lists.last().is_some_and(|l| {
                    l.level == list.level && (l.id != list.id || l.ordered != list.ordered)
                }) {
                    close(&mut lists, list.level.checked_sub(1), &mut out);
                }
                if lists.last().is_some_and(|l| l.level == list.level) {
                    out.push_str("</li>\n");
                } else {
                    if list.ordered {
                        writeln!(out, "<ol start=\"{}\">", list.number).unwrap();
                    } else {
                        out.push_str("<ul>\n");
                    }
                    lists.push(list);
                }
                if list.ordered {
                    write!(out, "<li value=\"{}\">", list.number).unwrap();
                } else {
                    out.push_str("<li>");
                }
                out.push_str(&text.html);
            }
            DocumentBlock::Paragraph { text, heading, .. } => {
                close(&mut lists, None, &mut out);
                let tag = if *heading { "h1" } else { "p" };
                writeln!(out, "<{tag}>{}</{tag}>", text.html).unwrap();
            }
            DocumentBlock::Table(rows) => {
                close(&mut lists, None, &mut out);
                out.push_str("<table>\n");
                for row in rows {
                    out.push_str("  <tr>");
                    for cell in row {
                        write!(out, "<td>{}</td>", cell.html).unwrap();
                    }
                    out.push_str("</tr>\n");
                }
                out.push_str("</table>\n");
            }
            DocumentBlock::Image { .. } | DocumentBlock::PageSize(_) | DocumentBlock::PageBreak(_) => {}
        }
    }
    close(&mut lists, None, &mut out);
    out.push_str("</body></html>\n");
    out
}

pub(super) enum Block {
    Text(String, bool),
    Preformatted(String),
    Table(Vec<Vec<String>>),
}
fn html_blocks(source: &str) -> Option<Vec<Block>> {
    #[derive(Default)]
    struct Table {
        rows: Vec<Vec<String>>,
        row: Vec<String>,
        cell: Option<String>,
    }
    let source = source.replace("\r\n", "\n").replace('\r', "\n");
    let dom = bounded_html_dom(&source)?;
    let mut blocks = Vec::new();
    let mut tables: Vec<Table> = Vec::new();
    let mut buf = String::new();
    let mut heading = false;
    let mut preformatted = false;
    let mut pre_start = false;
    let mut body_started = false;
    let mut lists: Vec<Option<usize>> = Vec::new();
    let mut marker = String::new();
    let flush =
        |blocks: &mut Vec<Block>, buf: &mut String, heading, preformatted, marker: &mut String| {
            let value = if preformatted {
                std::mem::take(buf)
            } else {
                buf.split('\n')
                    .map(|line| {
                        line.split_ascii_whitespace()
                            .collect::<Vec<_>>()
                            .join(" ")
                            .trim()
                            .to_owned()
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            if !value.is_empty() {
                let text = std::mem::take(marker) + &value;
                blocks.push(if preformatted {
                    Block::Preformatted(text)
                } else {
                    Block::Text(text, heading)
                });
            }
            buf.clear();
        };
    let mut stack: Vec<_> = dom.iter().rev().map(|n| (n, false)).collect();
    while let Some((node, exit)) = stack.pop() {
        let el = match node {
            HtmlNode::Text(t) => {
                body_started |= !t.trim().is_empty();
                let text = if preformatted {
                    let text = if pre_start {
                        t.strip_prefix('\n').unwrap_or(t)
                    } else {
                        t
                    };
                    pre_start = false;
                    text.to_owned()
                } else {
                    t.chars()
                        .map(|c| {
                            if matches!(c, '\t' | '\n' | '\r' | '\u{c}' | ' ') {
                                ' '
                            } else {
                                c
                            }
                        })
                        .collect()
                };
                if let Some(tbl) = tables.last_mut() {
                    if let Some(c) = &mut tbl.cell {
                        c.push_str(&text);
                    }
                } else {
                    buf.push_str(&text);
                }
                continue;
            }
            HtmlNode::Element(el) => el,
        };
        let tag = el.tag.as_str();
        if matches!(tag, "head" | "script" | "style" | "template")
            || tag == "title" && !body_started
        {
            continue;
        }
        body_started |= !matches!(tag, "html" | "meta" | "link" | "base");
        let title = matches!(tag, "h1" | "h2" | "h3" | "h4" | "h5" | "h6");
        let boundary = title
            || matches!(
                tag,
                "p" | "div"
                    | "section"
                    | "article"
                    | "header"
                    | "footer"
                    | "main"
                    | "aside"
                    | "blockquote"
                    | "li"
                    | "ul"
                    | "ol"
                    | "pre"
                    | "dl"
                    | "dt"
                    | "dd"
            );
        if tag == "table" {
            if !exit {
                if tables.is_empty() {
                    flush(&mut blocks, &mut buf, heading, preformatted, &mut marker);
                }
                tables.push(Table::default());
            } else {
                let rows = tables.pop().unwrap().rows;
                if let Some(parent) = tables.last_mut() {
                    if let Some(cell) = &mut parent.cell {
                        cell.push_str(
                            &rows
                                .into_iter()
                                .map(|row| row.join(" "))
                                .collect::<Vec<_>>()
                                .join(" "),
                        );
                    }
                } else {
                    blocks.push(Block::Table(rows));
                }
            }
        } else if let Some(t) = tables.last_mut() {
            match (tag, exit) {
                ("tr", false) => t.row.clear(),
                ("tr", true) => t.rows.push(std::mem::take(&mut t.row)),
                ("td" | "th", false) => t.cell = Some(String::new()),
                ("td" | "th", true) => t.row.push(
                    t.cell
                        .take()
                        .unwrap_or_default()
                        .split_ascii_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ")
                        .trim()
                        .to_owned(),
                ),
                _ if boundary || tag == "br" => {
                    if let Some(c) = &mut t.cell {
                        c.push(' ');
                    }
                }
                _ => {}
            }
        } else if tag == "pre" {
            flush(&mut blocks, &mut buf, heading, preformatted, &mut marker);
            preformatted = !exit;
            pre_start = !exit;
            heading = false;
        } else if preformatted {
            if tag == "br" && !exit {
                buf.push('\n');
            }
        } else if boundary {
            flush(&mut blocks, &mut buf, heading, preformatted, &mut marker);
            heading = title && !exit;
            if matches!(tag, "ul" | "ol") {
                if exit {
                    lists.pop();
                } else {
                    lists.push((tag == "ol").then_some(1));
                }
            } else if tag == "li" {
                marker.clear();
                if !exit && let Some(list) = lists.last_mut() {
                    if let Some(next) = list {
                        marker = format!("{next}. ");
                        *next += 1;
                    } else {
                        marker.push_str("• ");
                    }
                }
            }
        } else if tag == "br" && !exit {
            buf.push('\n');
        }
        if !exit {
            stack.push((node, true));
            stack.extend(el.children.iter().rev().map(|n| (n, false)));
        }
    }
    flush(&mut blocks, &mut buf, heading, preformatted, &mut marker);
    Some(blocks)
}

pub(super) fn delimited(
    source: &str,
    separator: char,
    mut numeric: Option<&mut BTreeSet<(usize, usize)>>,
) -> Result<Vec<Vec<String>>, &'static str> {
    let mut input = source
        .strip_prefix('\u{feff}')
        .unwrap_or(source)
        .chars()
        .peekable();
    let (mut rows, mut row, mut field) = (Vec::new(), Vec::new(), String::new());
    let mut quoted = false;
    let mut was_quoted = false;
    let mut active = false;
    let mut cell = |r, row: &mut Vec<String>, field: &mut String, was_quoted: &mut bool| {
        if let Some(numeric) = numeric.as_mut() {
            if !*was_quoted && field.len() < 4096 && decimal(field).is_some() {
                numeric.insert((r, row.len()));
            }
        }
        row.push(std::mem::take(field));
        *was_quoted = false;
    };
    while let Some(c) = input.next() {
        active = true;
        if c == '"' {
            if quoted && input.next_if_eq(&'"').is_some() {
                field.push('"');
            } else if quoted || field.is_empty() {
                quoted = !quoted;
                was_quoted = true;
            } else {
                field.push(c);
            }
        } else if !quoted && c == separator {
            cell(rows.len(), &mut row, &mut field, &mut was_quoted);
        } else if !quoted && matches!(c, '\r' | '\n') {
            if c == '\r' {
                input.next_if_eq(&'\n');
            }
            cell(rows.len(), &mut row, &mut field, &mut was_quoted);
            rows.push(std::mem::take(&mut row));
            active = false;
        } else {
            field.push(c);
        }
    }
    if quoted {
        return Err("Error: conversion failed: Invalid CSV: unterminated quoted field\n");
    }
    if active {
        cell(rows.len(), &mut row, &mut field, &mut was_quoted);
        rows.push(row);
    }
    Ok(rows)
}

fn decimal(source: &str) -> Option<f64> {
    let mut chars = source.bytes().peekable();
    if chars.peek().is_some_and(|b| matches!(b, b'+' | b'-')) {
        chars.next();
    }
    let mut digits = 0;
    while chars.peek().is_some_and(u8::is_ascii_digit) {
        chars.next();
        digits += 1;
    }
    if chars.next_if_eq(&b'.').is_some() {
        while chars.peek().is_some_and(u8::is_ascii_digit) {
            chars.next();
            digits += 1;
        }
    }
    if digits == 0 {
        return None;
    }
    if chars.peek().is_some_and(|b| matches!(b, b'e' | b'E')) {
        chars.next();
        if chars.peek().is_some_and(|b| matches!(b, b'+' | b'-')) {
            chars.next();
        }
        digits = 0;
        while chars.peek().is_some_and(u8::is_ascii_digit) {
            chars.next();
            digits += 1;
        }
        if digits == 0 {
            return None;
        }
    }
    if chars.next().is_some() {
        return None;
    }
    source.parse::<f64>().ok().filter(|n| n.is_finite())
}

fn date_serial(source: &str) -> Option<i64> {
    if source.len() != 10
        || !source.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 4 | 7) {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
    {
        return None;
    }
    let year = source[..4].parse::<i64>().ok()?;
    let month = source[5..7].parse::<i64>().ok()?;
    let day = source[8..].parse::<i64>().ok()?;
    if year < 1900 || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let days = crate::commands::coreutils::days_from_civil(year, month, day);
    if crate::commands::coreutils::civil_from_days(days) != (year, month as u32, day as u32) {
        return None;
    }
    Some(
        days - crate::commands::coreutils::days_from_civil(1899, 12, 31)
            + i64::from(source >= "1900-03-01"),
    )
}

pub(in crate::commands) fn xml_elements<'a>(
    nodes: &'a [crate::commands::structured::xml::Node],
    name: &str,
) -> Vec<&'a crate::commands::structured::xml::Element> {
    use crate::commands::structured::xml::Node;
    let mut result = Vec::new();
    let mut pending: Vec<_> = nodes.iter().rev().collect();
    while let Some(node) = pending.pop() {
        if let Node::Element(el) = node {
            if el.tag.rsplit(':').next() == Some(name) {
                result.push(el);
            }
            pending.extend(el.children.iter().rev());
        }
    }
    result
}

pub(in crate::commands) fn xml_attribute<'a>(
    el: &'a crate::commands::structured::xml::Element,
    name: &str,
) -> Option<&'a str> {
    el.attrs
        .iter()
        .find(|(key, _)| key.rsplit(':').next() == Some(name))
        .map(|(_, v)| v.as_str())
}

pub(in crate::commands) fn xml_text(el: &crate::commands::structured::xml::Element) -> String {
    use crate::commands::structured::xml::Node;
    let mut text = String::new();
    let mut pending: Vec<_> = el.children.iter().rev().collect();
    while let Some(node) = pending.pop() {
        match node {
            Node::Text(t, _) | Node::Cdata(t) => text.push_str(t),
            Node::Element(e) => pending.extend(e.children.iter().rev()),
            _ => {}
        }
    }
    text
}

#[path = "office_xlsx.rs"]
mod xlsx_import;
pub(super) use xlsx_import::export_csv;
pub(super) use xlsx_import::number_token;
#[cfg(test)]
use xlsx_import::read_xlsx;
pub(super) use xlsx_import::text_export::read as read_xlsx_text;
pub(super) fn blocks(
    source: &str,
    format: &str,
    paragraphs: &[String],
    rows: Option<&[Vec<String>]>,
) -> Option<Vec<Block>> {
    if matches!(format, "html" | "htm") {
        return html_blocks(source);
    }
    if matches!(format, "xlsx" | "ods" | "csv") {
        return Some(vec![Block::Table(rows.unwrap_or_default().to_vec())]);
    }
    if matches!(format, "rtf" | "pptx" | "pdf") {
        return Some(
            paragraphs
                .iter()
                .enumerate()
                .map(|(i, t)| Block::Text(t.clone(), i == 0))
                .collect(),
        );
    }
    Some(
        source
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| match l.strip_prefix("# ") {
                Some(t) => Block::Text(t.trim().to_owned(), true),
                None => Block::Text(l.to_owned(), false),
            })
            .collect(),
    )
}
pub(super) fn text(blocks: &[Block], separator: &str) -> String {
    let lines = blocks
        .iter()
        .map(|b| match b {
            Block::Text(t, _) | Block::Preformatted(t) => t.clone(),
            Block::Table(rows) => rows
                .iter()
                .map(|r| r.join("\t"))
                .collect::<Vec<_>>()
                .join("\n"),
        })
        .collect::<Vec<_>>();
    lines.join(separator) + "\n"
}
pub(super) fn html(blocks: &[Block], title: &str) -> String {
    let mut out = format!(
        "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"><title>{}</title></head><body>\n",
        html_escape_str(title)
    );
    for b in blocks {
        match b {
            Block::Preformatted(t) => {
                writeln!(out, "<pre>{}</pre>", html_escape_str(t)).unwrap();
            }
            Block::Text(t, h) => {
                let tag = if *h { "h1" } else { "p" };
                writeln!(out, "<{tag}>{}</{tag}>", html_escape_str(t)).unwrap();
            }
            Block::Table(rows) => {
                out.push_str("<table>\n");
                for row in rows {
                    out.push_str("  <tr>");
                    for c in row {
                        write!(out, "<td>{}</td>", html_escape_str(c)).unwrap();
                    }
                    out.push_str("</tr>\n");
                }
                out.push_str("</table>\n");
            }
        }
    }
    out.push_str("</body></html>\n");
    out
}
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub(super) fn docx(blocks: &[Block], limit: usize) -> Option<Vec<u8>> {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>"#,
    );
    for block in blocks {
        let heading = matches!(block, Block::Text(_, true));
        match block {
            Block::Text(t, _) | Block::Preformatted(t) => {
                xml.push_str("<w:p>");
                if heading {
                    xml.push_str(r#"<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>"#);
                }
                write!(xml, "<w:r><w:t>{}</w:t></w:r></w:p>", escape(t)).ok()?;
            }
            Block::Table(rows) => {
                xml.push_str("<w:tbl>");
                for row in rows {
                    xml.push_str("<w:tr>");
                    for c in row {
                        write!(
                            xml,
                            "<w:tc><w:p><w:r><w:t>{}</w:t></w:r></w:p></w:tc>",
                            escape(c)
                        )
                        .ok()?;
                        if xml.len() > limit {
                            return None;
                        }
                    }
                    xml.push_str("</w:tr>");
                }
                xml.push_str("</w:tbl>");
            }
        }
        if xml.len() > limit {
            return None;
        }
    }
    xml.push_str(r#"</w:body></w:document>"#);
    let entries: &[(&str,&[u8])]=&[
("[Content_Types].xml",br#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#),
("_rels/.rels",include_bytes!("docx-root.rels")),
("word/document.xml",xml.as_bytes())];
    let bytes = write_zip_stored(entries);
    (bytes.len() <= limit).then_some(bytes)
}

pub(super) fn xlsx(
    rows: &[Vec<String>],
    numeric: Option<&BTreeSet<(usize, usize)>>,
    limit: usize,
) -> Option<Vec<u8>> {
    let calculated = match numeric {
        Some(numeric) => formulas::calculate(rows, numeric, limit)?,
        None => Default::default(),
    };
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#,
    );
    for (i, row) in rows.iter().enumerate() {
        let r = i + 1;
        write!(xml, r#"<row r="{r}">"#).ok()?;
        for (j, c) in row.iter().enumerate() {
            write!(xml, r#"<c r="{}{r}" "#, xlsx_idx_to_col_ref(j)).ok()?;
            if let Some(value) = calculated.get(&(i, j)) {
                let kind = match value {
                    formulas::Value::Text(_) | formulas::Value::UninternedText(_) => "str",
                    formulas::Value::Bool(_) => "b",
                    formulas::Value::Error(_) => "e",
                    _ => "n",
                };
                write!(xml, "t=\"{kind}\"><f>{}</f>", escape(&c[1..])).ok()?;
                if !matches!(
                    value,
                    formulas::Value::Blank | formulas::Value::FunctionEmpty
                ) {
                    let cached = match value {
                        formulas::Value::Number(n) if *n == 0. => "0".into(),
                        _ => value.cached(),
                    };
                    let cached = if matches!(value, formulas::Value::Error(_)) {
                        crate::commands::structured::xlsx::error(&cached)
                    } else {
                        &cached
                    };
                    write!(xml, "<v>{}</v>", escape(cached)).ok()?;
                }
                xml.push_str("</c>");
            } else if numeric.is_some()
                && let Some(date) = date_serial(c)
            {
                write!(xml, "s=\"1\" t=\"n\"><v>{date}</v></c>").ok()?;
            } else if numeric.is_some_and(|cells| cells.contains(&(i, j))) {
                write!(xml, "t=\"n\"><v>{}</v></c>", c).ok()?;
            } else {
                write!(xml, "t=\"inlineStr\"><is><t>{}</t></is></c>", escape(c)).ok()?;
            }
            if xml.len() > limit {
                return None;
            }
        }
        xml.push_str("</row>");
    }
    xml.push_str(r#"</sheetData></worksheet>"#);
    let entries: &[(&str,&[u8])]=&[
("[Content_Types].xml",br#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>"#),
("_rels/.rels",br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#),
("xl/workbook.xml",br#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>"#),
("xl/_rels/workbook.xml.rels",br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#),
("xl/styles.xml",include_bytes!("office-xlsx-styles.xml")),
("xl/worksheets/sheet1.xml",xml.as_bytes())];
    let bytes = write_zip_stored(entries);
    (bytes.len() <= limit).then_some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delimited_nul_bytes_preserve_public_field_text() {
        let mut numeric = BTreeSet::new();
        let rows = delimited(
            "A\0B,1\0.5,\"a\"\0\"b\"\r\0\nx,y\n\0",
            ',',
            Some(&mut numeric),
        )
        .unwrap();
        assert_eq!(
            rows,
            vec![
                vec!["A\0B", "1\0.5", "a\0\"b\""],
                vec!["\0"],
                vec!["x", "y"],
                vec!["\0"]
            ]
        );
        assert!(numeric.is_empty());
        assert_eq!(delimited("\0", ',', None).unwrap(), vec![vec!["\0"]]);
    }

    #[test]
    fn csv_xlsx_preserves_formula_text_without_expanding_sheet_names() {
        use crate::{MemoryVfs, MemoryVfsLimits, SafeBashFs};
        let name = "quoted'".repeat(20);
        let input = format!("/{name}.csv");
        let source = format!("1\n=SUM({})\n", vec!["Sheet1.A1"; 64].join(";"));
        for limit in [4096, 65_536] {
            let fs = MemoryVfs::with_limits(MemoryVfsLimits {
                max_file_bytes: limit,
                ..Default::default()
            });
            let output = format!("/output/{name}.xlsx");
            fs.write_file(&input, source.as_bytes()).unwrap();
            fs.mkdir_all("/output").unwrap();
            fs.write_file(&output, b"old").unwrap();
            fs.write_file("/unrelated", b"saved").unwrap();
            let result = super::super::try_run_archive_command(
                "soffice",
                &["--convert-to", "xlsx", "--outdir", "/output", &input].map(String::from),
                "",
                "/",
                &Default::default(),
                &fs,
            )
            .unwrap();
            assert_eq!(result.exit_code, 0, "xlsx: {}", result.stderr);
            let parts =
                crate::commands::structured::read_office_archive(&fs.read_file(&output).unwrap());
            let sheet = std::str::from_utf8(&parts["xl/worksheets/sheet1.xml"]).unwrap();
            assert!(sheet.contains(&format!(
                "<f>{}</f>",
                source.lines().nth(1).unwrap().trim_start_matches('=')
            )));
            assert_eq!(fs.read_file(&input).unwrap(), source.as_bytes());
            assert_eq!(fs.read_file("/unrelated").unwrap(), b"saved");
            assert_eq!(fs.list_dir("/output").unwrap().len(), 1);
        }
    }

    #[test]
    fn unsupported_csv_syntax_leaves_all_formula_caches_empty() {
        let rows = vec![vec!["=1+2".into(), "=SUM(Sheet1.A1:A1)".into()]];
        let result = formulas::calculate(&rows, &BTreeSet::new(), 65_536).unwrap();
        assert_eq!(result.len(), 2);
        assert!(
            result
                .values()
                .all(|value| matches!(value, formulas::Value::Blank))
        );
    }

    #[test]
    fn csv_formula_exports_match_public_packages() {
        use crate::commands::structured::{JVal, parse_json_stream, read_office_archive};
        let mut failures = Vec::new();
        for source in [
            include_str!("../../tests/fixtures/soffice-sumproduct-production.json"),
            include_str!("../../tests/fixtures/soffice-csv-address-quotes-production.json"),
            include_str!("../../tests/fixtures/soffice-csv-lookup-search-production.json"),
            include_str!("../../tests/fixtures/soffice-csv-lookup-shapes-production.json"),
            include_str!("../../tests/fixtures/soffice-csv-indirect-production.json"),
            include_str!("../../tests/fixtures/soffice-csv-information-production.json"),
            include_str!("../../tests/fixtures/soffice-financial-csv-production.json"),
            include_str!("../../tests/fixtures/soffice-annuity-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-payment-depreciation-native.json"),
            include_str!("../../tests/fixtures/soffice-cumulative-depreciation-native.json"),
            include_str!("../../tests/fixtures/soffice-rate-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-rate-search-production.json"),
            include_str!("../../tests/fixtures/soffice-dated-cashflows-native.json"),
            include_str!("../../tests/fixtures/soffice-dated-cashflows-production.json"),
            include_str!("../../tests/fixtures/soffice-securities-production.json"),
            include_str!("../../tests/fixtures/soffice-bonds-production.json"),
            include_str!("../../tests/fixtures/soffice-coupon-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-bond-price-native.json"),
            include_str!("../../tests/fixtures/soffice-duration-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-odd-last-native.json"),
            include_str!("../../tests/fixtures/soffice-treasury-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-discount-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-maturity-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-accrued-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-schedule-dollar-native.json"),
        ] {
            let JVal::Object(fixture) = parse_json_stream(source).unwrap().remove(0) else {
                panic!("fixture")
            };
            let field = |key: &str| &fixture.iter().find(|(k, _)| k == key).unwrap().1;
            let JVal::Object(inputs) = field("inputs") else {
                panic!("inputs")
            };
            let JVal::Array(exports) = field("xlsx") else {
                panic!("exports")
            };
            for export in exports {
                let JVal::Object(export) = export else {
                    panic!("export")
                };
                let field = |key: &str| &export.iter().find(|(k, _)| k == key).unwrap().1;
                let JVal::Str(input) = field("input") else {
                    panic!("input")
                };
                if !input.ends_with(".csv") {
                    continue;
                }
                let JVal::Str(csv) = &inputs.iter().find(|(k, _)| k == input).unwrap().1 else {
                    panic!("CSV")
                };
                let JVal::Object(expected) = field("parts") else {
                    panic!("parts")
                };
                let mut numeric = BTreeSet::new();
                let rows = delimited(csv, ',', Some(&mut numeric)).unwrap();
                let bytes = xlsx(&rows, Some(&numeric), 64 * 1024 * 1024).unwrap();
                let parts = read_office_archive(&bytes);
                assert_eq!(parts.len(), expected.len(), "{input}");
                for (name, content) in expected {
                    let JVal::Str(content) = content else {
                        panic!("part")
                    };
                    let actual = std::str::from_utf8(&parts[name]).unwrap();
                    if actual != content {
                        failures.push(format!("{input} {name}: package differs"));
                        // Keep cell failures readable even in large workbooks.
                        for (actual, expected) in actual.split("</c>").zip(content.split("</c>")) {
                            if actual != expected {
                                failures.push(format!("{input} {name}: {actual} != {expected}"));
                            }
                        }
                    }
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn spreadsheet_exports_match_public_packages_and_diagnostics() {
        use crate::commands::structured::{JVal, parse_json_stream, read_office_archive};
        use crate::{MemoryVfs, SafeBashFs};
        for source in [
            include_str!("../../tests/fixtures/soffice-csv-sheet-references-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-formula-boundaries-native.json"),
            include_str!("../../tests/fixtures/soffice-formula-precision-production.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-control-text-native.json"),
            include_str!("../../tests/fixtures/soffice-archive-detection-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-ranges-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-chains-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-token-limits-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-string-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-deep-formulas-native.json"),
            include_str!("../../tests/fixtures/soffice-logical-caches-native.json"),
            include_str!("../../tests/fixtures/soffice-function-names-native.json"),
            include_str!("../../tests/fixtures/soffice-optional-arguments-native.json"),
            include_str!("../../tests/fixtures/soffice-array-call-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-array-call-errors-native.json"),
            include_str!("../../tests/fixtures/soffice-rounding-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-unicode-string-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-summation-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-normal-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-annuity-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-payment-depreciation-native.json"),
            include_str!("../../tests/fixtures/soffice-cumulative-depreciation-native.json"),
            include_str!("../../tests/fixtures/soffice-rate-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-cashflow-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-schedule-dollar-native.json"),
            include_str!("../../tests/fixtures/soffice-dated-cashflows-native.json"),
            include_str!("../../tests/fixtures/soffice-treasury-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-discount-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-maturity-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-accrued-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-amortization-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-coupon-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-duration-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-bond-price-native.json"),
            include_str!("../../tests/fixtures/soffice-odd-last-native.json"),
            include_str!("../../tests/fixtures/soffice-gamma-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-euroconvert-native.json"),
            include_str!("../../tests/fixtures/soffice-combinatorial-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-database-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-database-import-native.json"),
            include_str!("../../tests/fixtures/soffice-matrix-strings-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-import-rules-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-compiled-cache-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-shared-references-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-named-references-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-name-import-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-name-budget-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-separator-rpn-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-name-errors-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-signed-arrays-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-matrix-caches-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-array-error-caches-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-error-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-hash-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-numeric-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-symbol-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-whitespace-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-unicode-spaces-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-formula-groups-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-partial-ranges-native.json"),
            include_str!("../../tests/fixtures/soffice-conditional-references-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-broken-references-native.json"),
            include_str!("../../tests/fixtures/soffice-msoxl-unions-native.json"),
            include_str!("../../tests/fixtures/soffice-msoxl-separators-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-name-scopes-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-name-export-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-qualified-ranges-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-reference-sets-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-unions-native.json"),
            include_str!("../../tests/fixtures/soffice-reference-list-order-native.json"),
            include_str!("../../tests/fixtures/soffice-export-metadata-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-booleans-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-cache-types-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-function-names-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-numeric-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-matrix-unions-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-formula-groups-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-token-groups-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-name-binding-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-definition-binding-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-relative-name-export-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-reversed-ranges-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-microsoft-recompile-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-recompiled-numbers-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-union-groups-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-microsoft-brackets-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-name-adjacency-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-external-prefixes-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-qualified-names-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-marked-names-native.json"),
            include_str!("../../tests/fixtures/soffice-reference-wrappers-native.json"),
            include_str!("../../tests/fixtures/soffice-index-limits-native.json"),
            include_str!("../../tests/fixtures/soffice-separator-unions-native.json"),
        ] {
            let JVal::Object(fixture) = parse_json_stream(source).unwrap().remove(0) else {
                panic!("fixture")
            };
            let field = |key| &fixture.iter().find(|(k, _)| k == key).unwrap().1;
            let JVal::Object(inputs) = field("inputs") else {
                panic!("inputs")
            };
            let JVal::Array(cases) = field("xlsx") else {
                panic!("cases")
            };
            for case in cases {
                let JVal::Object(fields) = case else {
                    panic!("case")
                };
                let field = |key| &fields.iter().find(|(k, _)| k == key).unwrap().1;
                let text = |key| match field(key) {
                    JVal::Str(s) => s.as_str(),
                    _ => panic!("text"),
                };
                let input = text("input");
                let source = match &inputs.iter().find(|(name, _)| name == input).unwrap().1 {
                    JVal::Str(text) => text.as_bytes().to_vec(),
                    JVal::Object(parts) => write_zip_stored(
                        &parts
                            .iter()
                            .map(|(name, value)| {
                                let JVal::Str(text) = value else {
                                    panic!("part")
                                };
                                (name.as_str(), text.as_bytes())
                            })
                            .collect::<Vec<_>>(),
                    ),
                    _ => panic!("source"),
                };
                let fs = MemoryVfs::new();
                let path = format!("/{input}");
                let dest = format!(
                    "/output/{}.xlsx",
                    input.rsplit_once('.').map_or(input, |(stem, _)| stem)
                );
                fs.write_file(&path, &source).unwrap();
                fs.mkdir_all("/output").unwrap();
                fs.write_file(&dest, b"existing output").unwrap();
                let result = super::super::cmd_soffice(
                    &["--convert-to", "xlsx", "--outdir", "/output", &path].map(String::from),
                    "/",
                    &fs,
                );
                let JVal::Number(code, _) = field("exitCode") else {
                    panic!("exitCode")
                };
                assert_eq!(result.exit_code, *code as i32, "{input}: {}", result.stderr);
                assert_eq!(result.stdout, text("stdout"), "{input}");
                assert_eq!(result.stderr, text("stderr"), "{input}");
                assert_eq!(fs.read_file(&path).unwrap(), source);
                let exported = fs.read_file(&dest).unwrap();
                if let Some((_, JVal::Object(expected))) = fields.iter().find(|(k, _)| k == "parts")
                {
                    let expected = expected
                        .iter()
                        .map(|(name, value)| {
                            let JVal::Str(value) = value else {
                                panic!("part")
                            };
                            (name.clone(), value.as_bytes().to_vec())
                        })
                        .collect();
                    assert_eq!(read_office_archive(&exported), expected, "{input}");
                } else {
                    assert_eq!(exported, text("output").as_bytes(), "{input}");
                }
            }
        }
    }

    #[test]
    fn spreadsheet_numeric_cells_and_caches_retain_production_precision_after_reopening() {
        use crate::commands::structured::{JVal, parse_json_stream, read_office_archive};
        use crate::{MemoryVfs, SafeBashFs};
        for source in [
            include_str!("../../tests/fixtures/soffice-numeric-cell-precision-production.json"),
            include_str!("../../tests/fixtures/soffice-portable-power-production.json"),
            include_str!("../../tests/fixtures/soffice-rate-precision-production.json"),
            include_str!("../../tests/fixtures/soffice-annuity-precision-production.json"),
            include_str!("../../tests/fixtures/soffice-math-functions-production.json"),
            include_str!("../../tests/fixtures/soffice-elementary-functions-production.json"),
            include_str!("../../tests/fixtures/soffice-math-operations-production.json"),
            include_str!("../../tests/fixtures/soffice-sumsq-production.json"),
            include_str!("../../tests/fixtures/soffice-sumsq-reference-types-production.json"),
            include_str!("../../tests/fixtures/soffice-database-exports-production.json"),
        ] {
            let JVal::Object(fixture) = parse_json_stream(source).unwrap().remove(0) else {
                panic!("fixture")
            };
            let field = |key: &str| &fixture.iter().find(|(k, _)| k == key).unwrap().1;
            let JVal::Str(input) = field("input") else {
                panic!("input")
            };
            let JVal::Array(outputs) = field("publicExports") else {
                panic!("exports")
            };
            assert_eq!(outputs.len(), 4);
            let fs = MemoryVfs::new();
            fs.write_file("/precision.csv", input.as_bytes()).unwrap();
            let JVal::Object(ods) = field("odsInput") else {
                panic!("ODS input")
            };
            let parts = ods
                .iter()
                .map(|(name, value)| {
                    let JVal::Str(text) = value else {
                        panic!("ODS part")
                    };
                    (name.as_str(), text.as_bytes())
                })
                .collect::<Vec<_>>();
            fs.write_file("/precision.ods", &write_zip_stored(&parts))
                .unwrap();
            fs.mkdir_all("/output").unwrap();
            let mut failures = Vec::new();
            for (source, expected) in [
                "/precision.csv",
                "/precision.xlsx",
                "/precision.ods",
                "/precision.xlsx",
            ]
            .into_iter()
            .zip(outputs)
            {
                let result = super::super::try_run_archive_command(
                    "soffice",
                    &["--convert-to", "xlsx", "--outdir", "/output", source].map(String::from),
                    "",
                    "/",
                    &Default::default(),
                    &fs,
                )
                .unwrap();
                assert_eq!(result.exit_code, 0, "{}", result.stderr);
                let exported = fs.read_file("/output/precision.xlsx").unwrap();
                let parts = read_office_archive(&exported);
                let JVal::Object(fields) = expected else {
                    panic!("export")
                };
                let JVal::Object(expected) = &fields.iter().find(|(k, _)| k == "parts").unwrap().1
                else {
                    panic!("parts")
                };
                let expected = expected
                    .iter()
                    .map(|(name, value)| {
                        let JVal::Str(value) = value else {
                            panic!("part")
                        };
                        (name.clone(), value.as_bytes().to_vec())
                    })
                    .collect();
                if parts != expected {
                    failures.push(format!(
                        "{source}: exported package differs from public command"
                    ));
                }
                fs.write_file("/precision.xlsx", &exported).unwrap();
            }
            assert!(failures.is_empty(), "{}", failures.join("\n"));
        }
    }

    #[test]
    fn formula_exports_and_reopening_match_production() {
        use crate::commands::structured::{JVal, parse_json_stream, read_office_archive};
        use crate::{MemoryVfs, SafeBashFs};
        fn field<'a>(value: &'a JVal, name: &str) -> &'a JVal {
            let JVal::Object(fields) = value else {
                panic!("object")
            };
            &fields.iter().find(|(key, _)| key == name).unwrap().1
        }
        fn string(value: &JVal) -> &str {
            let JVal::Str(value) = value else {
                panic!("string")
            };
            value
        }
        for source in [
            include_str!("../../tests/fixtures/soffice-floor-ceiling-exports-production.json"),
            include_str!("../../tests/fixtures/soffice-boolean-comparisons-production.json"),
            include_str!("../../tests/fixtures/soffice-small-literals-production.json"),
            include_str!("../../tests/fixtures/soffice-sum-average-production.json"),
        ] {
            let fixture = parse_json_stream(source).unwrap().remove(0);
            let fs = MemoryVfs::new();
            fs.mkdir_all("/output").unwrap();
            fs.write_file("/rounding.csv", string(field(&fixture, "input")).as_bytes())
                .unwrap();
            let JVal::Object(parts) = field(&fixture, "odsInput") else {
                panic!("ODS input")
            };
            let parts = parts
                .iter()
                .map(|(name, text)| (name.as_str(), string(text).as_bytes()))
                .collect::<Vec<_>>();
            fs.write_file("/rounding.ods", &write_zip_stored(&parts))
                .unwrap();
            let mut formats = vec!["csv", "ods"];
            if let JVal::Object(fields) = &fixture
                && let Some((_, JVal::Object(parts))) =
                    fields.iter().find(|(key, _)| key == "xlsxInput")
            {
                let parts = parts
                    .iter()
                    .map(|(name, text)| (name.as_str(), string(text).as_bytes()))
                    .collect::<Vec<_>>();
                fs.write_file("/rounding.xlsx", &write_zip_stored(&parts))
                    .unwrap();
                formats.push("xlsx");
            }
            let JVal::Array(outputs) = field(&fixture, "publicExports") else {
                panic!("exports")
            };
            assert_eq!(outputs.len(), formats.len() * 2);
            let mut outputs = outputs.iter();
            let mut failures = Vec::new();
            for format in formats {
                for source in [format!("/rounding.{format}"), "/reopened.xlsx".into()] {
                    let destination = if source == "/reopened.xlsx" {
                        "/output/reopened.xlsx"
                    } else {
                        "/output/rounding.xlsx"
                    };
                    if fs.exists(destination) {
                        fs.remove_path(destination).unwrap();
                    }
                    let result = super::super::try_run_archive_command(
                        "soffice",
                        &["--convert-to", "xlsx", "--outdir", "/output", &source].map(String::from),
                        "",
                        "/",
                        &Default::default(),
                        &fs,
                    )
                    .unwrap();
                    assert_eq!(result.exit_code, 0, "{}: {}", source, result.stderr);
                    assert!(result.stderr.is_empty(), "{}: {}", source, result.stderr);
                    let bytes = fs.read_file(destination).unwrap();
                    let parts = read_office_archive(&bytes);
                    let JVal::Object(expected) = field(outputs.next().unwrap(), "parts") else {
                        panic!("parts")
                    };
                    let expected = expected
                        .iter()
                        .map(|(name, value)| (name.clone(), string(value).as_bytes().to_vec()))
                        .collect();
                    if parts != expected {
                        failures.push(format!(
                            "{format} {source}: exported package differs from public command"
                        ));
                    }
                    fs.write_file("/reopened.xlsx", &bytes).unwrap();
                }
            }
            assert!(failures.is_empty(), "{}", failures.join("\n"));
        }
    }

    #[test]
    fn formula_numbers_roundtrip_without_changing_their_value() {
        let mut bits = 1u64;
        for value in [
            f64::from_bits(1),
            f64::MIN_POSITIVE,
            f64::MAX,
            0.9999999999999998,
            1.0000000000000002,
        ]
        .into_iter()
        .chain((0..2048).map(|_| {
            bits = bits.wrapping_mul(6364136223846793005).wrapping_add(1);
            f64::from_bits(bits)
        }))
        .filter(|value| value.is_finite())
        {
            let literal = number_format::exact(value);
            assert_eq!(literal.parse::<f64>(), Ok(value), "{literal}");
        }
    }

    #[test]
    fn quoted_csv_numbers_remain_text_for_formulas_and_preserve_files_on_rejection() {
        use crate::commands::structured::{JVal, parse_json_stream, read_office_archive, xml};
        use crate::{MemoryVfs, MemoryVfsLimits, SafeBashFs};
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-csv-quoted-production.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &fixture.iter().find(|(key, _)| key == "cases").unwrap().1 else {
            panic!("cases")
        };
        for case in cases {
            let JVal::Object(fields) = case else {
                panic!("case")
            };
            let field = |key: &str| &fields.iter().find(|(name, _)| name == key).unwrap().1;
            let JVal::Str(source) = field("input") else {
                panic!("input")
            };
            let JVal::Array(expected) = field("cells") else {
                panic!("cells")
            };
            let fs = MemoryVfs::new();
            fs.write_file("/input.csv", source.as_bytes()).unwrap();
            let result = super::super::try_run_archive_command(
                "soffice",
                &["--convert-to", "xlsx", "/input.csv"].map(String::from),
                "",
                "/",
                &Default::default(),
                &fs,
            )
            .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let parts = read_office_archive(&fs.read_file("/input.xlsx").unwrap());
            let doc = xml::parse(
                std::str::from_utf8(&parts["xl/worksheets/sheet1.xml"]).unwrap(),
                None,
                None,
            )
            .unwrap();
            let actual = xml_elements(&doc.nodes, "c");
            assert_eq!(actual.len(), expected.len());
            for expected in expected {
                let JVal::Object(fields) = expected else {
                    panic!("cell")
                };
                let text = |key: &str| match &fields.iter().find(|(name, _)| name == key).unwrap().1
                {
                    JVal::Str(value) => Some(value.as_str()),
                    JVal::Null => None,
                    _ => panic!("text"),
                };
                let cell = actual
                    .iter()
                    .find(|c| xml_attribute(c, "r") == text("position"))
                    .unwrap();
                assert_eq!(
                    xml_attribute(cell, "t"),
                    text("type"),
                    "{source} {:?}",
                    text("position")
                );
                let value = if text("type") == Some("inlineStr") {
                    xml_text(cell)
                } else {
                    xml_text(xml_elements(&cell.children, "v")[0])
                };
                if text("type") == Some("n") {
                    assert_eq!(
                        value.parse::<f64>().unwrap(),
                        text("value").unwrap().parse::<f64>().unwrap(),
                        "{source}"
                    );
                } else {
                    assert_eq!(Some(value.as_str()), text("value"), "{source}");
                }
            }
            assert_eq!(fs.read_file("/input.csv").unwrap(), source.as_bytes());
        }
        for target in ["csv", "xlsx"] {
            let fs = MemoryVfs::with_limits(MemoryVfsLimits {
                max_file_bytes: 8,
                ..Default::default()
            });
            fs.write_file("/input.csv", b"a\"\"\"b\n").unwrap();
            fs.mkdir_all("/out").unwrap();
            let output = format!("/out/input.{target}");
            fs.write_file(&output, b"old").unwrap();
            fs.write_file("/out/keep", b"other").unwrap();
            let result = super::super::try_run_archive_command(
                "soffice",
                &["--convert-to", target, "--outdir", "/out", "/input.csv"].map(String::from),
                "",
                "/",
                &Default::default(),
                &fs,
            )
            .unwrap();
            assert_ne!(result.exit_code, 0, "{target}");
            assert_eq!(fs.read_file(&output).unwrap(), b"old");
            assert_eq!(fs.read_file("/input.csv").unwrap(), b"a\"\"\"b\n");
            assert_eq!(fs.read_file("/out/keep").unwrap(), b"other");
        }
    }

    #[test]
    fn csv_long_numbers_preserve_text_and_stop_numeric_inference() {
        for size in [
            4095, 4096, 4097, 8192, 32767, 32768, 65533, 65534, 65535, 65536,
        ] {
            let zeros = "0".repeat(size);
            let suffix = format!("{zeros}42");
            let source = format!("{zeros},\"{zeros}\",{suffix},\"{suffix}\"\n");
            let mut numeric = BTreeSet::new();
            let rows = delimited(&source, ',', Some(&mut numeric)).unwrap();
            assert_eq!(
                rows,
                vec![vec![
                    zeros.as_str(),
                    zeros.as_str(),
                    suffix.as_str(),
                    suffix.as_str()
                ]],
                "{size}"
            );
            assert_eq!(
                numeric,
                if size < 4096 {
                    BTreeSet::from([(0, 0)])
                } else {
                    BTreeSet::new()
                },
                "{size}"
            );
        }
    }

    #[test]
    fn csv_empty_fields_remain_strings_in_calculation_and_xlsx() {
        use crate::commands::structured::{read_office_archive, xml};
        // Public CSV import retains empty fields as string cells.
        let source = "\"\",,=COUNTA(A1:B1),=COUNTBLANK(A1:B1),=ISBLANK(A1),=ISTEXT(A1),=A1\n\"\",text,=COUNTA(A2:B2),=COUNTBLANK(A2:B2),=ISBLANK(A2),=ISTEXT(A2),=B1\n42,true,,=SUM(A3:C3),=COUNT(A3:C3),=COUNTA(A3:C3),=A3+1\n";
        let mut numeric = BTreeSet::new();
        let rows = delimited(source, ',', Some(&mut numeric)).unwrap();
        let book = xlsx(&rows, Some(&numeric), 1_000_000).unwrap();
        let parts = read_office_archive(&book);
        let doc = xml::parse(
            std::str::from_utf8(&parts["xl/worksheets/sheet1.xml"]).unwrap(),
            None,
            None,
        )
        .unwrap();
        let cells = xml_elements(&doc.nodes, "c");
        for position in ["A1", "B1", "A2", "C3"] {
            let cell = cells
                .iter()
                .find(|c| xml_attribute(c, "r") == Some(position))
                .unwrap();
            assert_eq!(xml_attribute(cell, "t"), Some("inlineStr"));
            assert_eq!(xml_text(cell), "");
        }
        for (position, expected) in [
            ("C1", "2"),
            ("D1", "2"),
            ("E1", "0"),
            ("F1", "1"),
            ("G1", ""),
            ("C2", "2"),
            ("D2", "1"),
            ("E2", "0"),
            ("F2", "1"),
            ("G2", ""),
            ("D3", "42"),
            ("E3", "1"),
            ("F3", "3"),
            ("G3", "43"),
        ] {
            let cell = cells
                .iter()
                .find(|c| xml_attribute(c, "r") == Some(position))
                .unwrap();
            assert_eq!(
                xml_text(xml_elements(&cell.children, "v")[0]),
                expected,
                "{position}"
            );
        }
    }

    #[test]
    fn ods_csv_uses_the_input_filename_for_all_sheet_names() {
        use crate::{MemoryVfs, SafeBashFs};
        for name in ["a%2Fb", "%2F..%2F..%2Foutside", "%00outside"] {
            let content = format!(
                r#"<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="{name}"><table:table-row><table:table-cell office:value-type="float" office:value="2"/></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>"#
            );
            let input = write_zip_stored(&[
                ("content.xml", content.as_bytes()),
                ("META-INF/manifest.xml", br#"<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/></manifest:manifest>"#),
            ]);
            let fs = MemoryVfs::new();
            fs.write_file("/input.ods", &input).unwrap();
            fs.write_file("/outside.csv", b"outside output").unwrap();
            fs.mkdir_all("/out").unwrap();
            fs.write_file("/out/input.csv", b"default output").unwrap();
            let spec =
                "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,1";
            let result = super::super::try_run_archive_command(
                "soffice",
                &["--convert-to", spec, "--outdir", "/out", "/input.ods"].map(String::from),
                "",
                "/",
                &Default::default(),
                &fs,
            )
            .unwrap();
            assert_eq!(result.exit_code, 0, "{name}: {}", result.stderr);
            assert_eq!(fs.read_file("/outside.csv").unwrap(), b"outside output");
            assert_eq!(fs.read_file("/out/input.csv").unwrap(), b"2\n");
            assert_eq!(fs.read_file("/input.ods").unwrap(), input);
        }
    }

    #[test]
    fn spreadsheet_csv_sheets_match_native_libreoffice() {
        use crate::commands::structured::{JVal, parse_json_stream};
        use crate::{MemoryVfs, SafeBashFs};
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-csv-sheets-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let field = |key: &str| &fixture.iter().find(|(k, _)| k == key).unwrap().1;
        let JVal::Object(inputs) = field("inputs") else {
            panic!("inputs")
        };
        let JVal::Array(cases) = field("cases") else {
            panic!("cases")
        };
        for case in cases {
            let JVal::Object(fields) = case else {
                panic!("case")
            };
            let field = |key: &str| &fields.iter().find(|(k, _)| k == key).unwrap().1;
            let JVal::Str(name) = field("name") else {
                panic!("name")
            };
            let JVal::Str(input) = field("input") else {
                panic!("input")
            };
            let JVal::Bool(success) = field("success") else {
                panic!("success")
            };
            let JVal::Object(outputs) = field("outputs") else {
                panic!("outputs")
            };
            let JVal::Object(parts) = &inputs.iter().find(|(n, _)| n == input).unwrap().1 else {
                panic!("parts")
            };
            let bytes = write_zip_stored(
                &parts
                    .iter()
                    .map(|(name, value)| {
                        let JVal::Str(value) = value else {
                            panic!("part")
                        };
                        (name.as_str(), value.as_bytes())
                    })
                    .collect::<Vec<_>>(),
            );
            let fs = MemoryVfs::new();
            let source = format!("/{input}");
            fs.write_file(&source, &bytes).unwrap();
            fs.mkdir_all("/output").unwrap();
            fs.write_file("/output/keep", b"existing file").unwrap();
            let spec = match field("options") {
                JVal::Str(options) => format!("csv:Text - txt - csv (StarCalc):{options}"),
                _ => "csv".into(),
            };
            let result = super::super::try_run_archive_command(
                "soffice",
                &["--convert-to", &spec, "--outdir", "/output", &source].map(String::from),
                "",
                "/",
                &Default::default(),
                &fs,
            )
            .unwrap();
            assert_eq!(result.exit_code == 0, *success, "{name}: {}", result.stderr);
            assert_eq!(
                fs.read_file(&source).unwrap(),
                bytes,
                "{name}: source changed"
            );
            assert_eq!(fs.read_file("/output/keep").unwrap(), b"existing file");
            assert_eq!(
                fs.list_dir("/output").unwrap().len(),
                outputs.len() + 1,
                "{name}: unexpected outputs"
            );
            for (path, expected) in outputs {
                let JVal::Str(expected) = expected else {
                    panic!("output")
                };
                assert_eq!(
                    fs.read_file(&format!("/output/{path}")).unwrap(),
                    expected.as_bytes(),
                    "{name}: {path}"
                );
            }
        }
    }

    #[test]
    fn csv_expansion_preserves_files_on_output_limit() {
        use crate::{MemoryVfs, MemoryVfsLimits, SafeBashFs};
        for (quote, source, limit) in [
            (34, "a\"\"\"b\n", 8),
            (55357, "😀\n", 8),
            (56832, "😀\n", 8),
        ] {
            let fs = MemoryVfs::with_limits(MemoryVfsLimits {
                max_file_bytes: limit,
                ..Default::default()
            });
            fs.write_file("/source.csv", source.as_bytes()).unwrap();
            fs.mkdir_all("/output").unwrap();
            fs.write_file("/output/source.csv", b"old").unwrap();
            let result = super::super::try_run_archive_command(
                "soffice",
                &[
                    "--convert-to",
                    &format!("csv:Text - txt - csv (StarCalc):44,{quote},76"),
                    "--outdir",
                    "/output",
                    "/source.csv",
                ]
                .map(String::from),
                "",
                "/",
                &Default::default(),
                &fs,
            )
            .unwrap();
            assert_ne!(result.exit_code, 0);
            assert_eq!(fs.read_file("/source.csv").unwrap(), source.as_bytes());
            assert_eq!(fs.read_file("/output/source.csv").unwrap(), b"old");
            assert_eq!(fs.list_dir("/output").unwrap().len(), 1);
        }
    }

    #[test]
    fn csv_comparisons_bound_calculation_work() {
        let rows = vec![vec![format!(
            "=\"{}\"<\"{}\"",
            "é".repeat(512),
            "z".repeat(512)
        )]];
        let values = formulas::calculate(&rows, &BTreeSet::new(), 1_000_000).unwrap();
        assert_eq!(values[&(0, 0)].cached(), "0");
        assert!(formulas::calculate(&rows, &BTreeSet::new(), 4096).is_none());
    }

    #[test]
    fn spreadsheet_csv_encodings_match_native_libreoffice() {
        use crate::commands::structured::{JVal, parse_json_stream};
        use crate::{MemoryVfs, SafeBashFs};
        for source in [
            include_str!("../../tests/fixtures/soffice-csv-encoding-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-multibyte-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-dbcs-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-gb18030-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-jis-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-encoding-ids-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-delimiters-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-symbols-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-java-utf8-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-utf7-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-iso2022jp-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-iscii-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-iso2022kr-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-iso2022cn-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-numeric-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-formulas-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-formula-boundaries-native.json"),
            include_str!("../../tests/fixtures/soffice-formula-precision-production.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-control-text-native.json"),
            include_str!("../../tests/fixtures/soffice-archive-detection-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-syntax-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-sheet-references-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-ranges-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-chains-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-token-limits-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-string-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-csv-raw-formulas-native.json"),
            include_str!("../../tests/fixtures/soffice-comparisons-native.json"),
            include_str!("../../tests/fixtures/soffice-deep-formulas-native.json"),
            include_str!("../../tests/fixtures/soffice-logical-caches-native.json"),
            include_str!("../../tests/fixtures/soffice-function-names-native.json"),
            include_str!("../../tests/fixtures/soffice-optional-arguments-native.json"),
            include_str!("../../tests/fixtures/soffice-array-call-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-array-call-errors-native.json"),
            include_str!("../../tests/fixtures/soffice-rounding-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-unicode-string-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-summation-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-normal-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-annuity-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-payment-depreciation-native.json"),
            include_str!("../../tests/fixtures/soffice-cumulative-depreciation-native.json"),
            include_str!("../../tests/fixtures/soffice-rate-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-cashflow-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-schedule-dollar-native.json"),
            include_str!("../../tests/fixtures/soffice-dated-cashflows-native.json"),
            include_str!("../../tests/fixtures/soffice-treasury-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-discount-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-maturity-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-accrued-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-amortization-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-coupon-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-duration-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-bond-price-native.json"),
            include_str!("../../tests/fixtures/soffice-odd-last-native.json"),
            include_str!("../../tests/fixtures/soffice-gamma-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-euroconvert-native.json"),
            include_str!("../../tests/fixtures/soffice-combinatorial-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-database-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-database-import-native.json"),
            include_str!("../../tests/fixtures/soffice-matrix-strings-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-import-rules-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-compiled-cache-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-shared-references-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-named-references-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-name-import-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-name-budget-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-separator-rpn-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-name-errors-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-signed-arrays-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-matrix-caches-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-array-error-caches-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-error-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-hash-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-numeric-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-symbol-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-whitespace-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-unicode-spaces-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-formula-groups-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-partial-ranges-native.json"),
            include_str!("../../tests/fixtures/soffice-conditional-references-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-broken-references-native.json"),
            include_str!("../../tests/fixtures/soffice-msoxl-unions-native.json"),
            include_str!("../../tests/fixtures/soffice-msoxl-separators-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-name-scopes-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-name-export-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-qualified-ranges-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-reference-sets-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-unions-native.json"),
            include_str!("../../tests/fixtures/soffice-reference-list-order-native.json"),
            include_str!("../../tests/fixtures/soffice-export-metadata-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-booleans-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-cache-types-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-function-names-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-numeric-tokens-native.json"),
            include_str!("../../tests/fixtures/soffice-matrix-unions-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-formula-groups-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-token-groups-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-name-binding-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-definition-binding-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-relative-name-export-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-reversed-ranges-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-microsoft-recompile-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-recompiled-numbers-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-union-groups-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-microsoft-brackets-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-name-adjacency-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-external-prefixes-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-qualified-names-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-marked-names-native.json"),
            include_str!("../../tests/fixtures/soffice-reference-wrappers-native.json"),
            include_str!("../../tests/fixtures/soffice-index-limits-native.json"),
            include_str!("../../tests/fixtures/soffice-separator-unions-native.json"),
            include_str!("../../tests/fixtures/soffice-range-operands-native.json"),
        ] {
            let JVal::Object(fixture) = parse_json_stream(source).unwrap().remove(0) else {
                panic!("fixture")
            };
            let field = |key: &str| &fixture.iter().find(|(k, _)| k == key).unwrap().1;
            let JVal::Object(inputs) = field("inputs") else {
                panic!("inputs")
            };
            let JVal::Array(cases) = field("cases") else {
                panic!("cases")
            };
            let fs = MemoryVfs::new();
            for (name, parts) in inputs {
                let input = match parts {
                    JVal::Str(text) => text.as_bytes().to_vec(),
                    JVal::Object(parts) => write_zip_stored(
                        &parts
                            .iter()
                            .map(|(name, value)| {
                                let JVal::Str(value) = value else {
                                    panic!("part")
                                };
                                (name.as_str(), value.as_bytes())
                            })
                            .collect::<Vec<_>>(),
                    ),
                    _ => panic!("parts"),
                };
                fs.write_file(&format!("/{name}"), &input).unwrap();
            }
            fs.mkdir_all("/output").unwrap();
            fs.write_file("/output/keep", b"unrelated").unwrap();
            for case in cases {
                let JVal::Object(fields) = case else {
                    panic!("case")
                };
                let field = |key: &str| &fields.iter().find(|(k, _)| k == key).unwrap().1;
                let JVal::Str(name) = field("name") else {
                    panic!("name")
                };
                let JVal::Str(input) = field("input") else {
                    panic!("input")
                };
                let JVal::Str(expected) = field("hex") else {
                    panic!("hex")
                };
                let spec = match field("options") {
                    JVal::Str(options) => format!("csv:Text - txt - csv (StarCalc):{options}"),
                    _ => "csv".into(),
                };
                let source = format!("/{input}");
                let output = format!(
                    "/output/{}.csv",
                    input
                        .rsplit_once('.')
                        .map(|(stem, _)| stem)
                        .unwrap_or(input)
                );
                fs.write_file(&output, b"old").unwrap();
                let before = fs.read_file(&source).unwrap();
                let result = super::super::try_run_archive_command(
                    "soffice",
                    &["--convert-to", &spec, "--outdir", "/output", &source].map(String::from),
                    "",
                    "/",
                    &Default::default(),
                    &fs,
                )
                .unwrap();
                let success = !matches!(
                    fields.iter().find(|(k, _)| k == "success").map(|(_, v)| v),
                    Some(JVal::Bool(false))
                );
                assert_eq!(result.exit_code == 0, success, "{name}: {}", result.stderr);
                if let Some((_, JVal::Str(stderr))) = fields.iter().find(|(key, _)| key == "stderr")
                {
                    assert_eq!(&result.stderr, stderr, "{name}");
                    assert!(result.stdout.is_empty(), "{name}");
                }

                assert_eq!(fs.read_file("/output/keep").unwrap(), b"unrelated");
                assert_eq!(
                    fs.read_file(&source).unwrap(),
                    before,
                    "{name}: source changed"
                );
                let expected: Vec<u8> = expected
                    .as_bytes()
                    .chunks_exact(2)
                    .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
                    .collect();
                assert_eq!(fs.read_file(&output).unwrap(), expected, "{name}");
            }
        }
    }

    #[test]
    fn spreadsheet_csv_options_match_native_libreoffice() {
        use crate::commands::structured::{JVal, parse_json_stream};
        use crate::{MemoryVfs, SafeBashFs};
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-csv-options-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let field = |key: &str| &fixture.iter().find(|(k, _)| k == key).unwrap().1;
        let JVal::Object(inputs) = field("inputs") else {
            panic!("inputs")
        };
        let JVal::Array(cases) = field("cases") else {
            panic!("cases")
        };
        let fs = MemoryVfs::new();
        for (name, parts) in inputs {
            let JVal::Object(parts) = parts else {
                panic!("parts")
            };
            let input = write_zip_stored(
                &parts
                    .iter()
                    .map(|(name, value)| {
                        let JVal::Str(value) = value else {
                            panic!("part")
                        };
                        (name.as_str(), value.as_bytes())
                    })
                    .collect::<Vec<_>>(),
            );
            fs.write_file(&format!("/{name}"), &input).unwrap();
        }
        fs.mkdir_all("/output").unwrap();
        for case in cases {
            let JVal::Object(fields) = case else {
                panic!("case")
            };
            let field = |key: &str| &fields.iter().find(|(k, _)| k == key).unwrap().1;
            let JVal::Str(name) = field("name") else {
                panic!("name")
            };
            let JVal::Str(input) = field("input") else {
                panic!("input")
            };
            let JVal::Str(expected) = field("csv") else {
                panic!("csv")
            };
            let spec = match field("options") {
                JVal::Str(options) => format!("csv:Text - txt - csv (StarCalc):{options}"),
                _ => "csv".into(),
            };
            let source = format!("/{input}");
            let before = fs.read_file(&source).unwrap();
            let result = super::super::try_run_archive_command(
                "soffice",
                &["--convert-to", &spec, "--outdir", "/output", &source].map(String::from),
                "",
                "/",
                &Default::default(),
                &fs,
            )
            .unwrap();
            assert_eq!(result.exit_code, 0, "{name}: {}", result.stderr);
            assert_eq!(
                fs.read_file(&source).unwrap(),
                before,
                "{name}: source changed"
            );
            assert_eq!(
                String::from_utf8(
                    fs.read_file(&format!(
                        "/output/{}.csv",
                        input.rsplit_once('.').unwrap().0
                    ))
                    .unwrap()
                )
                .unwrap(),
                *expected,
                "{name}"
            );
        }
    }

    #[test]
    fn spreadsheet_csv_matches_native_libreoffice() {
        use crate::commands::structured::{JVal, parse_json_stream};
        use crate::{MemoryVfs, SafeBashFs};
        for source in [
            include_str!("../../tests/fixtures/soffice-xlsx-sparse-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-calculation-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-relationships-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-formats-native.json"),
            include_str!("../../tests/fixtures/soffice-xlsx-formula-text-native.json"),
            include_str!("../../tests/fixtures/soffice-address-native.json"),
            include_str!("../../tests/fixtures/soffice-invalid-references-native.json"),
            include_str!("../../tests/fixtures/soffice-information-native.json"),
            include_str!("../../tests/fixtures/soffice-value-info-native.json"),
            include_str!("../../tests/fixtures/soffice-arity-native.json"),
            include_str!("../../tests/fixtures/soffice-date-functions-native.json"),
            include_str!("../../tests/fixtures/soffice-result-formats-native.json"),
            include_str!("../../tests/fixtures/soffice-arithmetic-formats-native.json"),
        ] {
            let JVal::Object(fixture) = parse_json_stream(source).unwrap().remove(0) else {
                panic!("fixture")
            };
            let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "cases").unwrap().1 else {
                panic!("cases")
            };
            let mut failures = Vec::new();
            for case in cases {
                let JVal::Object(fields) = case else {
                    panic!("case")
                };
                let field = |name: &str| &fields.iter().find(|(k, _)| k == name).unwrap().1;
                let JVal::Str(name) = field("name") else {
                    panic!("name")
                };
                let JVal::Object(parts) = field("parts") else {
                    panic!("parts")
                };
                let input = write_zip_stored(
                    &parts
                        .iter()
                        .map(|(name, value)| {
                            let JVal::Str(value) = value else {
                                panic!("part")
                            };
                            (name.as_str(), value.as_bytes())
                        })
                        .collect::<Vec<_>>(),
                );
                let JVal::Str(expected) = field("csv") else {
                    panic!("csv")
                };
                let fs = MemoryVfs::new();
                let source = if name.ends_with(".ods") {
                    "/input.ods"
                } else {
                    "/input.xlsx"
                };
                fs.write_file(source, &input).unwrap();
                let result = super::super::try_run_archive_command(
                    "soffice",
                    &["--convert-to", "csv", source].map(String::from),
                    "",
                    "/",
                    &Default::default(),
                    &fs,
                )
                .unwrap();
                let success = !matches!(
                    fields
                        .iter()
                        .find(|(key, _)| key == "success")
                        .map(|(_, value)| value),
                    Some(JVal::Bool(false))
                );
                if let Some((_, JVal::Str(stderr))) = fields.iter().find(|(key, _)| key == "stderr")
                {
                    assert_eq!(&result.stderr, stderr, "{name}");
                }
                if (result.exit_code == 0) != success
                    || fs.read_file("/input.csv").unwrap_or_default() != expected.as_bytes()
                {
                    failures.push(format!("{name}: {}", result.stderr));
                    let actual = fs.read_file("/input.csv").unwrap_or_default();
                    for (r, (expected, actual)) in expected
                        .lines()
                        .zip(String::from_utf8_lossy(&actual).lines())
                        .enumerate()
                        .filter(|(_, (a, b))| a != b)
                        .take(16)
                    {
                        failures.push(format!(
                            "row {}: expected {expected:?}; actual {actual:?}",
                            r + 1
                        ));
                    }
                }
                assert_eq!(fs.read_file(source).unwrap(), input);
            }
            assert!(failures.is_empty(), "{}", failures.join("\n"));
        }
    }

    #[test]
    fn sparse_xlsx_bounds_the_complete_output_before_allocation() {
        use crate::{MemoryVfs, SafeBashFs};
        for cells in [
            "<row r=\"1048576\"><c r=\"A1048576\"><v>1</v></c></row>",
            "<row r=\"1\"><c r=\"XFD1\"><v>1</v></c></row><row r=\"256\"><c r=\"A256\"><v>2</v></c></row>",
        ] {
            let sheet = format!(
                "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>{cells}</sheetData></worksheet>"
            );
            let bytes = write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),("xl/worksheets/sheet1.xml", sheet.as_bytes())]);
            assert!(read_xlsx(&bytes, "xlsx", 1_000_000).is_err());
        }
        let sheet = "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"10\"><c r=\"J10\"><v>1</v></c></row></sheetData></worksheet>";
        let bytes = write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),("xl/worksheets/sheet1.xml", sheet.as_bytes())]);
        assert!(read_xlsx(&bytes, "xlsx", 1024).is_err());
        let rows = read_xlsx(&bytes, "xlsx", 16384).unwrap();
        assert_eq!(rows.len(), 10);
        assert!(rows.iter().all(|r| r.len() == 10));
        assert_eq!(rows[9][9], "1");

        let sheet = "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\"><c r=\"XFD1\"><v>1</v></c></row><row r=\"1048576\"><c r=\"A1048576\"><v>2</v></c></row></sheetData></worksheet>";
        let input = write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),
            ("xl/worksheets/sheet1.xml", sheet.as_bytes()),
        ]);
        let fs = MemoryVfs::new();
        fs.write_file("/input.xlsx", &input).unwrap();
        fs.write_file("/input.csv", b"preserved output").unwrap();
        let result = super::super::try_run_archive_command(
            "soffice",
            &["--convert-to", "csv", "/input.xlsx"].map(String::from),
            "",
            "/",
            &Default::default(),
            &fs,
        )
        .unwrap();
        assert_eq!(result.exit_code, 0);
        assert_eq!(
            fs.read_file("/input.csv").unwrap(),
            format!("{}1\n2\n", ",".repeat(16383)).as_bytes()
        );
        assert_eq!(fs.read_file("/input.xlsx").unwrap(), input);
    }

    #[test]
    fn xlsx_cached_exports_do_not_expand_legacy_arrays_or_names() {
        use crate::{MemoryVfs, SafeBashFs};
        let sheet = br#"<worksheet><sheetData><row r="1"><c r="A1"><f t="array" ref="A1:XFD1048576">1</f></c></row></sheetData></worksheet>"#;
        let input = write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),
            ("xl/worksheets/sheet1.xml", sheet),
        ]);
        let fs = MemoryVfs::new();
        fs.write_file("/input.xlsx", &input).unwrap();
        fs.write_file("/input.csv", b"preserved output").unwrap();
        let result = super::super::try_run_archive_command(
            "soffice",
            &["--convert-to", "csv", "/input.xlsx"].map(String::from),
            "",
            "/",
            &Default::default(),
            &fs,
        )
        .unwrap();
        assert_eq!(result.exit_code, 0);
        assert_eq!(fs.read_file("/input.csv").unwrap(), b"\n");
        assert_eq!(fs.read_file("/input.xlsx").unwrap(), input);

        let names = (0..64)
            .map(|n| format!("<definedName name=\"imported_named_value_{n}\">1</definedName>"))
            .collect::<String>();
        let workbook = format!(
            "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"sheet\"/></sheets><definedNames>{names}</definedNames></workbook>"
        );
        let sheet = br#"<worksheet><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>"#;
        let input = write_zip_stored(&[
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),
            ("xl/workbook.xml", workbook.as_bytes()),
            ("xl/worksheets/sheet1.xml", sheet),
        ]);
        assert!(input.len() < 8192);
        assert!(read_xlsx(&input, "xlsx", 8192).is_err());
        assert_eq!(read_xlsx(&input, "xlsx", 65536).unwrap(), vec![vec!["1"]]);

        let names = "<definedName name=\"duplicate\">1</definedName>".repeat(512);
        let workbook = format!(
            "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"sheet\"/></sheets><definedNames>{names}</definedNames></workbook>"
        );
        let input = write_zip_stored(&[
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),
            ("xl/workbook.xml", workbook.as_bytes()),
            ("xl/worksheets/sheet1.xml", sheet),
        ]);
        for format in ["csv", "xlsx"] {
            // The public cached-cell route does not import unused definitions.
            // Exercise the private Calc import limit directly, rather than
            // treating the shell's former bridge-only rejection as evidence.
            assert!(read_xlsx(&input, format, 65536).is_err());
            let (mut shell, fs) = crate::shell::Shell::with_memory_fs();
            shell.set_limits(crate::budget::ShellLimits {
                max_input_bytes: 65536,
                ..Default::default()
            });
            fs.mkdir_all("/output").unwrap();
            fs.write_file("/input.xlsx", &input).unwrap();
            let destination = format!("/output/input.{format}");
            fs.write_file(&destination, b"preserved output").unwrap();
            let result = shell
                .exec(&format!(
                    "soffice --convert-to {format} --outdir /output /input.xlsx"
                ))
                .unwrap();
            assert_eq!(result.exit_code, 0, "{format}: {}", result.stderr);
            let output = fs.read_file(&destination).unwrap();
            let csv = if format == "csv" {
                output
            } else {
                export_csv(&output, None, 65536).unwrap().remove(0).bytes
            };
            assert_eq!(csv, b"1\n");
            assert_eq!(fs.read_file("/input.xlsx").unwrap(), input);
        }
        assert_eq!(
            read_xlsx(&input, "csv", 1_000_000).unwrap(),
            vec![vec!["1"]]
        );
    }

    #[test]
    fn unused_defined_name_scopes_do_not_affect_retained_exports() {
        use crate::commands::structured::{JVal, parse_json_stream};
        use crate::{MemoryVfs, SafeBashFs};
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-xlsx-name-scopes-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let JVal::Object(inputs) = &fixture.iter().find(|(key, _)| key == "inputs").unwrap().1
        else {
            panic!("inputs")
        };
        for format in ["csv", "xlsx", "txt", "pdf", "cat"] {
            let fs = MemoryVfs::new();
            fs.mkdir_all("/output").unwrap();
            for (path, name) in [
                ("/bad.xlsx", "scope-2.xlsx"),
                ("/good.xlsx", "scope-0.xlsx"),
            ] {
                let JVal::Object(parts) = &inputs.iter().find(|(key, _)| key == name).unwrap().1
                else {
                    panic!("parts")
                };
                let source = write_zip_stored(
                    &parts
                        .iter()
                        .map(|(name, value)| {
                            let JVal::Str(value) = value else {
                                panic!("part")
                            };
                            (name.as_str(), value.as_bytes())
                        })
                        .collect::<Vec<_>>(),
                );
                fs.write_file(path, &source).unwrap();
            }
            let bad = fs.read_file("/bad.xlsx").unwrap();
            let good = fs.read_file("/good.xlsx").unwrap();
            let destination = format!("/output/bad.{format}");
            fs.write_file(&destination, b"preserved output").unwrap();
            let args = if format == "cat" {
                vec!["--cat", "/bad.xlsx", "/good.xlsx"]
            } else {
                vec![
                    "--convert-to",
                    format,
                    "--outdir",
                    "/output",
                    "/bad.xlsx",
                    "/good.xlsx",
                ]
            };
            let result = super::super::try_run_archive_command(
                "soffice",
                &args.into_iter().map(String::from).collect::<Vec<_>>(),
                "",
                "/",
                &Default::default(),
                &fs,
            )
            .unwrap();
            assert_eq!(result.exit_code, 0, "{format}: {}", result.stderr);
            assert_eq!(result.stderr, "", "{format}");
            assert!(!result.stdout.is_empty(), "{format}");
            assert_eq!(
                result.stdout.contains("/bad"),
                matches!(format, "csv" | "xlsx" | "txt" | "pdf"),
                "{format}"
            );
            if format == "pdf" {
                assert!(fs.read_file(&destination).unwrap().starts_with(b"%PDF-"));
            } else if format == "xlsx" {
                assert_eq!(
                    fs.read_file(&destination).unwrap(),
                    fs.read_file("/output/good.xlsx").unwrap()
                );
            } else {
                assert_eq!(
                    fs.read_file(&destination).unwrap(),
                    match format {
                        "csv" => b",\n".as_slice(),
                        "txt" => b"\t\n",
                        _ => b"preserved output",
                    }
                );
            }
            assert_eq!(fs.read_file("/bad.xlsx").unwrap(), bad);
            assert_eq!(fs.read_file("/good.xlsx").unwrap(), good);
            if format != "cat" {
                assert!(
                    !fs.read_file(&format!("/output/good.{format}"))
                        .unwrap()
                        .is_empty()
                );
            }
        }
    }

    #[test]
    fn shared_strings_are_bounded_when_expanded_into_cells() {
        let shared = format!("<sst><si><t>{}</t></si></sst>", "x".repeat(512));
        let sheet = format!(
            "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row>{}</row></sheetData></worksheet>",
            "<c t=\"s\"><v>0</v></c>".repeat(32)
        );
        let bytes = write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="shared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),
            ("xl/sharedStrings.xml", shared.as_bytes()),
            ("xl/worksheets/sheet1.xml", sheet.as_bytes()),
        ]);
        assert!(bytes.len() < 4096);
        assert!(read_xlsx(&bytes, "xlsx", 4096).is_err());
        let rows = read_xlsx(&bytes, "xlsx", 65536).unwrap();
        assert_eq!(rows[0], vec!["x".repeat(512); 32]);
    }
}

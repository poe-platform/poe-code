use super::html_escape_str;
use crate::commands::structured::{
    HtmlNode, bounded_html_dom, write_zip_stored, xlsx_idx_to_col_ref,
};
use std::fmt::Write;
pub(super) enum Block {
    Text(String, bool),
    Table(Vec<Vec<String>>),
}
fn html_blocks(source: &str) -> Option<Vec<Block>> {
    #[derive(Default)]
    struct Table {
        rows: Vec<Vec<String>>,
        row: Vec<String>,
        cell: Option<String>,
    }
    let dom = bounded_html_dom(source)?;
    let mut blocks = Vec::new();
    let mut tables: Vec<Table> = Vec::new();
    let mut buf = String::new();
    let mut heading = false;
    let flush = |blocks: &mut Vec<Block>, buf: &mut String, heading| {
        if !buf.trim().is_empty() {
            blocks.push(Block::Text(
                buf.split_ascii_whitespace().collect::<Vec<_>>().join(" "),
                heading,
            ));
        }
        buf.clear();
    };
    let mut stack: Vec<_> = dom.iter().rev().map(|n| (n, false)).collect();
    while let Some((node, exit)) = stack.pop() {
        let el = match node {
            HtmlNode::Text(t) => {
                if let Some(tbl) = tables.last_mut() {
                    if let Some(c) = &mut tbl.cell {
                        c.push_str(t);
                    }
                } else {
                    buf.push_str(t);
                }
                continue;
            }
            HtmlNode::Element(el) => el,
        };
        let tag = el.tag.as_str();
        if matches!(tag, "head" | "script" | "style" | "template") {
            continue;
        }
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
                    flush(&mut blocks, &mut buf, heading);
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
                ("tr", true) => t.rows.push(std::mem::take(&mut t.row)),
                ("td" | "th", false) => t.cell = Some(String::new()),
                ("td" | "th", true) => t.row.push(
                    t.cell
                        .take()
                        .unwrap_or_default()
                        .split_ascii_whitespace()
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
                _ if boundary || tag == "br" => {
                    if let Some(c) = &mut t.cell {
                        c.push(' ');
                    }
                }
                _ => {}
            }
        } else if boundary {
            flush(&mut blocks, &mut buf, heading);
            heading = title && !exit;
        } else if tag == "br" {
            buf.push(' ');
        }
        if !exit {
            stack.push((node, true));
            stack.extend(el.children.iter().rev().map(|n| (n, false)));
        }
    }
    flush(&mut blocks, &mut buf, heading);
    Some(blocks)
}

pub(super) fn delimited(source: &str, separator: char) -> Result<Vec<Vec<String>>, &'static str> {
    let mut input = source
        .strip_prefix('\u{feff}')
        .unwrap_or(source)
        .chars()
        .peekable();
    let (mut rows, mut row, mut field) = (Vec::new(), Vec::new(), String::new());
    let mut quoted = false;
    let mut active = false;
    while let Some(c) = input.next() {
        active = true;
        if c == '"' {
            if quoted && input.next_if_eq(&'"').is_some() {
                field.push('"');
            } else if quoted || field.is_empty() {
                quoted = !quoted;
            } else {
                field.push(c);
            }
        } else if !quoted && c == separator {
            row.push(std::mem::take(&mut field));
        } else if !quoted && matches!(c, '\r' | '\n') {
            if c == '\r' {
                input.next_if_eq(&'\n');
            }
            row.push(std::mem::take(&mut field));
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
        row.push(field);
        rows.push(row);
    }
    Ok(rows)
}
pub(super) fn blocks(
    source: &str,
    filename: &str,
    paragraphs: &[String],
    rows: Option<&[Vec<String>]>,
) -> Option<Vec<Block>> {
    if filename.ends_with(".html") || filename.ends_with(".htm") {
        return html_blocks(source);
    }
    if matches!(filename.rsplit('.').next(), Some("xlsx" | "ods" | "csv")) {
        return Some(vec![Block::Table(rows.unwrap_or_default().to_vec())]);
    }
    if matches!(
        filename.rsplit('.').next(),
        Some("rtf" | "docx" | "odt" | "odp" | "pptx" | "pdf")
    ) {
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
pub(super) fn text(blocks: &[Block]) -> String {
    let lines = blocks
        .iter()
        .map(|b| match b {
            Block::Text(t, _) => t.clone(),
            Block::Table(rows) => rows
                .iter()
                .map(|r| r.join("\t"))
                .collect::<Vec<_>>()
                .join("\n"),
        })
        .collect::<Vec<_>>();
    lines.join("\n\n") + "\n"
}
pub(super) fn html(blocks: &[Block], title: &str) -> String {
    let mut out = format!(
        "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"><title>{}</title></head><body>\n",
        html_escape_str(title)
    );
    for b in blocks {
        match b {
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
        match block {
            Block::Text(t, h) => {
                xml.push_str("<w:p>");
                if *h {
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

pub(super) fn xlsx(rows: &[Vec<String>], limit: usize) -> Option<Vec<u8>> {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#,
    );
    for (i, row) in rows.iter().enumerate() {
        let r = i + 1;
        write!(xml, r#"<row r="{r}">"#).ok()?;
        for (j, c) in row.iter().enumerate() {
            write!(
                xml,
                r#"<c r="{}{r}" t="inlineStr"><is><t>{}</t></is></c>"#,
                xlsx_idx_to_col_ref(j),
                escape(c)
            )
            .ok()?;
            if xml.len() > limit {
                return None;
            }
        }
        xml.push_str("</row>");
    }
    xml.push_str(r#"</sheetData></worksheet>"#);
    let entries: &[(&str,&[u8])]=&[
("[Content_Types].xml",br#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#),
("_rels/.rels",br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#),
("xl/workbook.xml",br#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>"#),
("xl/_rels/workbook.xml.rels",br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
("xl/worksheets/sheet1.xml",xml.as_bytes())];
    let bytes = write_zip_stored(entries);
    (bytes.len() <= limit).then_some(bytes)
}

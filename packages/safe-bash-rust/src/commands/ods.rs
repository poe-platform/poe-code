// Default OpenDocument spreadsheet parts and sparse table serialization.
use super::{
    WorkbookSheet, format_ss_number, parse_cell_coord,
    xlsx::{Cell, value},
};
use crate::commands::{archive::TarEntry, codecs::encode_zip_members};
use std::fmt::Write;

fn escaped(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\r', "&#13;")
        .replace('\n', "&#10;")
        .replace('\t', "&#9;")
}

fn text(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(at) = rest.find([' ', '\t', '\n']) {
        out.push_str(&escaped(&rest[..at]));
        rest = &rest[at..];
        if rest.starts_with(' ') {
            let n = rest.bytes().take_while(|b| *b == b' ').count();
            if n == 1 {
                out.push_str("<text:s/>")
            } else {
                write!(out, r#"<text:s text:c="{n}"/>"#).unwrap();
            }
            rest = &rest[n..];
        } else {
            out.push_str(if rest.starts_with('\t') {
                "<text:tab/>"
            } else {
                "<text:line-break/>"
            });
            rest = &rest[1..];
        }
    }
    out.push_str(&escaped(rest));
    out
}

// OpenFormula encloses cell references (and both ends of a range) in brackets.
fn formula(s: &str) -> String {
    let mut out = String::from("of:=");
    let mut rest = s;
    while !rest.is_empty() {
        let c = rest.chars().next().unwrap();
        if c == '"' {
            let end = rest[1..].find('"').map_or(rest.len(), |i| i + 2);
            out.push_str(&rest[..end]);
            rest = &rest[end..];
            continue;
        }
        if c.is_ascii_alphanumeric() || matches!(c, '$' | '_') {
            let end = rest
                .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '$' | '_' | '.')))
                .unwrap_or(rest.len());
            let token = &rest[..end];
            rest = &rest[end..];
            if parse_cell_coord(token).is_some() && !rest.starts_with('(') {
                write!(out, "[.{token}").unwrap();
                if let Some(next) = rest.strip_prefix(':') {
                    let end = next
                        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '$'))
                        .unwrap_or(next.len());
                    if parse_cell_coord(&next[..end]).is_some() {
                        write!(out, ":.{}", &next[..end]).unwrap();
                        rest = &next[end..];
                    }
                }
                out.push(']');
            } else {
                out.push_str(token);
            }
        } else {
            out.push(if c == ',' { ';' } else { c });
            rest = &rest[c.len_utf8()..];
        }
    }
    escaped(&out)
}
fn blanks(xml: &mut String, cols: usize, rows: usize) {
    if rows > 0 {
        xml.push_str("<table:table-row");
        if rows > 1 {
            write!(xml, r#" table:number-rows-repeated="{rows}""#).unwrap();
        }
        xml.push('>');
    }
    if cols > 1 {
        write!(
            xml,
            r#"<table:table-cell table:number-columns-repeated="{cols}"/>"#
        )
        .unwrap();
    } else if cols == 1 {
        xml.push_str("<table:table-cell/>");
    }
    if rows > 0 {
        xml.push_str("</table:table-row>");
    }
}

pub(super) fn write(sheets: &[WorkbookSheet], limit: usize) -> Option<Vec<u8>> {
    let namespaces = include_str!("ods/namespaces.txt");
    let mut tables = String::new();
    for sheet in sheets {
        let cols = sheet
            .rows
            .iter()
            .filter_map(|r| r.iter().rposition(|v| !v.is_empty()))
            .max()
            .map_or(256, |i| (i + 1).max(256));
        let cached = sheet.cached_formulas();
        write!(tables,r#"<table:table table:name="{}" table:style-name="ta0"><table:table-column table:number-columns-repeated="{cols}"/>"#,escaped(&sheet.name)).ok()?;
        let mut next_row = 0;
        for (i, row) in sheet.rows.iter().enumerate() {
            if row.iter().all(String::is_empty) {
                continue;
            }
            if i > next_row {
                blanks(&mut tables, cols, i - next_row);
            }
            tables.push_str("<table:table-row>");
            let mut next_col = 0;
            for (j, raw) in row.iter().enumerate().filter(|(_, s)| !s.is_empty()) {
                blanks(&mut tables, j - next_col, 0);
                tables.push_str("<table:table-cell");
                let mut cell = value(raw, sheet.delimited);
                let mut computed = false;
                if let Cell::Formula(f) = cell {
                    computed = true;
                    write!(tables, r#" table:formula="{}""#, formula(f)).ok()?;
                    let v = &cached.as_ref()?.rows[i][j];
                    cell = match value(v, true) {
                        Cell::Formula(_) => Cell::Text(""),
                        other => other,
                    };
                }
                match cell {
                    Cell::Number(n) => {
                        let n = format_ss_number(n);
                        write!(
                            tables,
                            r#" office:value-type="float" office:value="{n}"><text:p>{n}</text:p>"#
                        )
                        .ok()?;
                    }
                    Cell::Bool(b) => {
                        write!(tables,r#" office:value-type="boolean" office:boolean-value="{b}"><text:p>{}</text:p>"#,if b{"TRUE"}else{"FALSE"}).ok()?;
                    }
                    Cell::Text(s) => {
                        tables.push_str(r#" office:value-type="string""#);
                        if computed {
                            write!(tables, r#" office:string-value="{}""#, escaped(s)).ok()?;
                        }
                        if s.is_empty() {
                            tables.push_str("><text:p/>");
                        } else {
                            write!(tables, "><text:p>{}</text:p>", text(s)).ok()?;
                        }
                    }
                    Cell::Formula(_) => unreachable!(),
                }
                tables.push_str("</table:table-cell>");
                next_col = j + 1;
                if tables.len() > limit {
                    return None;
                }
            }
            blanks(&mut tables, cols - next_col, 0);
            tables.push_str("</table:table-row>");
            next_row = i + 1;
        }
        if next_row < 65536 {
            blanks(&mut tables, cols, 65536 - next_row);
        }
        tables.push_str("<table:named-expressions/></table:table>");
    }
    let active = escaped(&sheets.first()?.name);
    let mut entries = Vec::new();
    let mut remaining = limit;
    for (name, content) in [
        (
            "mimetype",
            "application/vnd.oasis.opendocument.spreadsheet".to_owned(),
        ),
        (
            "content.xml",
            format!(
                include_str!("ods/content.xml"),
                namespaces = namespaces,
                tables = tables
            ),
        ),
        (
            "styles.xml",
            format!(include_str!("ods/styles.xml"), namespaces = namespaces),
        ),
        (
            "meta.xml",
            format!(include_str!("ods/meta.xml"), namespaces = namespaces),
        ),
        (
            "settings.xml",
            format!(
                include_str!("ods/settings.xml"),
                namespaces = namespaces,
                active = active
            ),
        ),
        (
            "META-INF/manifest.xml",
            include_str!("ods/manifest.xml").to_owned(),
        ),
    ] {
        remaining = remaining.checked_sub(content.len() + name.len() + 64)?;
        entries.push(TarEntry {
            name: name.into(),
            typeflag: b'0',
            mode: 0o644,
            mtime: 946684800.,
            atime: None,
            uid: 0,
            gid: 0,
            linkname: String::new(),
            content: content.into_bytes(),
        });
    }
    Some(encode_zip_members(&entries, 6, &["mimetype"], true, |_,_,_,_| {}))
}

use super::{extract_xml_attr, read_office_archive, unescape_xml_entities};

fn repeat(tag: &str, name: &str) -> Option<usize> {
    extract_xml_attr(tag, name).map_or(Some(1), |s| s.parse().ok().filter(|n| *n > 0))
}

fn cell_text(xml: &str, limit: usize) -> Option<String> {
    let mut out = String::new();
    let mut rest = xml;
    let mut paragraph = false;
    while let Some(start) = rest.find("<text:p") {
        let tag = &rest[start..];
        let gt = tag.find('>')?;
        if paragraph {
            out.push('\n');
        }
        paragraph = true;
        rest = &tag[gt + 1..];
        if tag[..=gt].ends_with("/>") {
            continue;
        }
        let (mut body, after) = rest.split_once("</text:p>")?;
        rest = after;
        while let Some(at) = body.find('<') {
            out.push_str(&unescape_xml_entities(&body[..at]));
            let gt = body[at..].find('>')? + at;
            let tag = &body[at..=gt];
            body = &body[gt + 1..];
            match tag.split([' ', '/', '>']).next()? {
                "<text:s" => {
                    let n = repeat(tag, "text:c")?;
                    if out.len().checked_add(n)? > limit {
                        return None;
                    }
                    out.extend(std::iter::repeat_n(' ', n));
                }
                "<text:tab" => out.push('\t'),
                "<text:line-break" => out.push('\n'),
                _ => {}
            }
        }
        out.push_str(&unescape_xml_entities(body));
        if out.len() > limit {
            return None;
        }
    }
    Some(out)
}
pub(super) fn read(
    bytes: &[u8],
    fallback_name: &str,
    mut budget: usize,
) -> Option<Vec<WorkbookSheet>> {
    let entries = read_office_archive(bytes);
    let content_xml = entries
        .get("content.xml")
        .map(|b| String::from_utf8_lossy(b).into_owned())
        .unwrap_or_default();
    let mut sheets = Vec::new();
    let mut tscan = content_xml.as_str();
    while let Some(tpos) = tscan.find("<table:table") {
        let tafter = &tscan[tpos..];
        let Some(first_ch) = tafter["<table:table".len()..].chars().next() else {
            break;
        };
        if first_ch != '>' && !first_ch.is_ascii_whitespace() {
            tscan = &tafter["<table:table".len()..];
            continue;
        }
        let Some(tgt) = tafter.find('>') else {
            break;
        };
        let t_open = &tafter[..=tgt];
        let sname = extract_xml_attr(t_open, "table:name")
            .or_else(|| extract_xml_attr(t_open, "name"))
            .unwrap_or_else(|| fallback_name.to_string());
        let Some(tend) = tafter.find("</table:table>") else {
            break;
        };
        let t_body = &tafter[tgt + 1..tend];
        let mut rows = Vec::new();
        let mut next_row = 0usize;
        let mut rscan = t_body;
        while let Some(rpos) = rscan.find("<table:table-row") {
            let rafter = &rscan[rpos..];
            let rgt = rafter.find('>')?;
            let tag = &rafter[..=rgt];
            let count = repeat(tag, "table:number-rows-repeated")?;
            let start = next_row;
            next_row = next_row.checked_add(count)?;
            if tag.ends_with("/>") {
                rscan = &rafter[rgt + 1..];
                continue;
            }
            let (mut body, rest) = rafter[rgt + 1..].split_once("</table:table-row>")?;
            rscan = rest;
            let mut row = Vec::new();
            let mut next_col = 0usize;
            let mut strings = 0usize;
            while let Some(cpos) = body.find("<table:table-cell") {
                let cell = &body[cpos..];
                let gt = cell.find('>')?;
                let tag = &cell[..=gt];
                let n = repeat(tag, "table:number-columns-repeated")?;
                let col = next_col;
                next_col = next_col.checked_add(n)?;
                body = &cell[gt + 1..];
                if tag.ends_with("/>") {
                    continue;
                }
                let (inside, rest) = body.split_once("</table:table-cell>")?;
                body = rest;
                let val = cell_text(inside, budget)?;
                if val.is_empty() {
                    continue;
                }
                strings = strings.checked_add(val.len().checked_mul(n)?)?;
                if (next_col
                    .checked_mul(size_of::<String>())?
                    .checked_add(strings)?)
                .checked_mul(count)?
                    > budget
                {
                    return None;
                }
                row.resize(col, String::new());
                row.resize(next_col, val);
            }
            if !row.is_empty() {
                let allocated = next_row
                    .checked_sub(rows.len())?
                    .checked_mul(size_of::<Vec<String>>())?
                    .checked_add(
                        count.checked_mul(
                            row.len()
                                .checked_mul(size_of::<String>())?
                                .checked_add(strings)?,
                        )?,
                    )?;
                budget = budget.checked_sub(allocated)?;
                rows.resize(start, Vec::new());
                rows.resize(next_row, row);
            }
        }
        sheets.push(WorkbookSheet {
            delimited: false,
            name: sname,
            rows,
        });
        tscan = &tafter[tend + 14..];
    }
    Some(sheets)
}

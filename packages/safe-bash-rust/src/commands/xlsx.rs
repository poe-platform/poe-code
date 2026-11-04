// XLSX default workbook parts and cell serialization used by ssconvert.
use super::{
    WorkbookSheet, format_ss_number, xlsx_idx_to_col_ref, xml_escape_text,
};
use crate::commands::{archive::TarEntry, codecs::encode_zip_members};
use std::{collections::BTreeMap, fmt::Write};

pub(super) enum Cell<'a> {
    Text(&'a str),
    Number(f64),
    Bool(bool),
    Formula(&'a str),
}
pub(super) fn value(s: &str, delimited: bool) -> Cell<'_> {
    if delimited {
        if let Some(f) = s.strip_prefix('=')
            && !f.is_empty()
        {
            return Cell::Formula(f);
        }
        let trimmed = s.trim();
        if trimmed.eq_ignore_ascii_case("true") {
            return Cell::Bool(true);
        }
        if trimmed.eq_ignore_ascii_case("false") {
            return Cell::Bool(false);
        }
        if let Ok(n) = trimmed.parse::<f64>()
            && n.is_finite()
        {
            return Cell::Number(n);
        }
    }
    Cell::Text(s)
}
fn escaped(s: &str) -> String {
    let mut out = String::new();
    for (i, c) in s.char_indices() {
        if (c as u32) < 32 && !matches!(c, '\t' | '\n') {
            write!(out, "_x{:04X}_", c as u32).unwrap();
        } else if c == '_'
            && s.as_bytes().get(i + 1..i + 7).is_some_and(|v| {
                v[0] == b'x' && v[1..5].iter().all(u8::is_ascii_hexdigit) && v[5] == b'_'
            })
        {
            out.push_str("_x005F_");
        } else {
            out.push(c);
        }
    }
    xml_escape_text(&out)
}
fn text(s: &str) -> String {
    format!(
        "<t{}>{}</t>",
        if s.starts_with(char::is_whitespace) || s.ends_with(char::is_whitespace) {
            r#" xml:space="preserve""#
        } else {
            ""
        },
        escaped(s)
    )
}
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
const SS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
pub(super) fn write(sheets: &[WorkbookSheet], limit: usize) -> Option<Vec<u8>> {
    let mut counts = BTreeMap::new();
    for sh in sheets {
        for cell in sh.rows.iter().flatten().filter(|s| !s.is_empty()) {
            if let Cell::Text(s) = value(cell, sh.delimited) {
                *counts.entry(s).or_insert(0usize) += 1;
            }
        }
    }
    let mut ids = BTreeMap::new();
    let mut strings = String::new();
    let mut references = 0;
    let mut entries = vec![];
    let mut remaining = limit;
    let mut add = |name: String, content: Vec<u8>| {
        remaining = remaining.checked_sub(content.len() + name.len() + 64)?;
        entries.push(TarEntry {
            name,
            typeflag: b'0',
            mode: 0o644,
            mtime: 946684800.,
            atime: None,
            uid: 0,
            gid: 0,
            linkname: String::new(),
            content,
        });
        Some(())
    };
    let mut sheet_types = Vec::new();
    let mut rels = vec![];
    let mut nodes = String::new();
    let mut names = String::new();
    for (idx, sh) in sheets.iter().enumerate() {
        let cached = sh.cached_formulas();
        let mut first_row = usize::MAX;
        let mut first_col = usize::MAX;
        let (mut end_row, mut end_col) = (0, 0);
        for (i, row) in sh.rows.iter().enumerate() {
            for (j, c) in row.iter().enumerate() {
                if !c.is_empty() {
                    first_row = first_row.min(i);
                    first_col = first_col.min(j);
                    end_row = i;
                    end_col = end_col.max(j);
                }
            }
        }
        if first_row == usize::MAX {
            first_row = 0;
            first_col = 0;
        }
        let mut dimension = format!("{}{}", xlsx_idx_to_col_ref(first_col), first_row + 1);
        if (first_row, first_col) != (end_row, end_col) {
            write!(
                dimension,
                ":{}{}",
                xlsx_idx_to_col_ref(end_col),
                end_row + 1
            )
            .ok()?;
        }
        let mut rows = String::new();
        for (i, row) in sh.rows.iter().enumerate() {
            if row.iter().all(String::is_empty) {
                continue;
            }
            write!(
                rows,
                r#"<row r="{}" spans="{}:{}">"#,
                i + 1,
                first_col + 1,
                end_col + 1
            )
            .ok()?;
            for (j, raw) in row.iter().enumerate() {
                if raw.is_empty() {
                    continue;
                }
                write!(rows, r#"<c r="{}{}""#, xlsx_idx_to_col_ref(j), i + 1).ok()?;
                match value(raw, sh.delimited) {
                    Cell::Text(s) if counts.get(s).copied().unwrap_or(0) > 1 => {
                        references += 1;
                        let len = ids.len();
                        let id = ids.entry(s).or_insert_with(|| {
                            write!(strings, "<si>{}</si>", text(s)).unwrap();
                            len
                        });
                        write!(rows, r#" t="s"><v>{id}</v></c>"#).ok()?;
                    }
                    Cell::Text(s) => {
                        write!(rows, r#" t="inlineStr"><is>{}</is></c>"#, text(s)).ok()?
                    }
                    Cell::Bool(b) => write!(rows, r#" t="b"><v>{}</v></c>"#, u8::from(b)).ok()?,
                    Cell::Number(n) => write!(rows, "><v>{}</v></c>", format_ss_number(n)).ok()?,
                    Cell::Formula(f) => {
                        let v = &cached.as_ref()?.rows[i][j];
                        if v == raw {
                            write!(rows, "><f>{}</f></c>", escaped(f)).ok()?;
                        } else {
                            let kind = if v.parse::<f64>().is_ok() {
                                ""
                            } else {
                                r#" t="str""#
                            };
                            write!(
                                rows,
                                "{kind}><f>{}</f><v>{}</v></c>",
                                escaped(f),
                                escaped(v)
                            )
                            .ok()?;
                        }
                    }
                }
                if rows.len().saturating_add(strings.len()) > limit {
                    return None;
                }
            }
            rows.push_str("</row>");
        }
        let rows = if rows.is_empty() {
            "<sheetData/>".to_owned()
        } else {
            format!("<sheetData>{rows}</sheetData>")
        };
        let columns = (end_col + 1).max(256);
        let selected = if idx == 0 { r#" tabSelected="1""# } else { "" };
        let file = format!(
            include_str!("xlsx/worksheet.xml"),
            dimension = dimension,
            rows = rows,
            columns = columns,
            selected = selected
        );
        let n = idx + 1;
        let name = xml_escape_text(&sh.name);
        add(format!("xl/worksheets/sheet{n}.xml"), file.into_bytes())?;
        sheet_types.push(format!(r#"<Override PartName="/xl/worksheets/sheet{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#));
        rels.push(format!(
            r#"<Relationship Id="rId{n}" Type="{REL}/worksheet" Target="worksheets/sheet{n}.xml"/>"#
        ));
        write!(
            nodes,
            r#"<sheet name="{name}" sheetId="{n}" r:id="rId{n}"/>"#
        )
        .ok()?;
        write!(names,r#"<definedName name="_xlnm.Sheet_Title" localSheetId="{idx}">&quot;{}&quot;</definedName><definedName name="_xlnm.Print_Area" localSheetId="{idx}">#REF!</definedName>"#,escaped(&sh.name.replace('"',"\"\""))).ok()?;
    }
    let mut shared = "";
    if !ids.is_empty() {
        let xml = format!(
            "{XML}<sst xmlns=\"{SS}\" uniqueCount=\"{}\" count=\"{references}\">{strings}</sst>\n",
            ids.len()
        );
        add("xl/sharedStrings.xml".into(), xml.into_bytes())?;
        rels.push(format!(
            r#"<Relationship Id="rId{}" Type="{REL}/sharedStrings" Target="sharedStrings.xml"/>"#,
            rels.len() + 1
        ));
        shared = r#"<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>"#;
    }
    rels.push(format!(
        r#"<Relationship Id="rId{}" Type="{REL}/styles" Target="styles.xml"/>"#,
        rels.len() + 1
    ));
    for (name, data) in [
        (
            "xl/styles.xml",
            include_bytes!("xlsx/styles.xml").as_slice(),
        ),
        ("docProps/app.xml", include_bytes!("xlsx/app.xml")),
        ("docProps/core.xml", include_bytes!("xlsx/core.xml")),
        ("docProps/custom.xml", include_bytes!("xlsx/custom.xml")),
    ] {
        add(name.into(), data.to_vec())?;
    }
    add(
        "xl/workbook.xml".into(),
        format!(
            include_str!("xlsx/workbook.xml"),
            nodes = nodes,
            names = names
        )
        .into_bytes(),
    )?;
    rels.reverse();
    add("xl/_rels/workbook.xml.rels".into(),format!("{XML}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{}</Relationships>\n",rels.join("")).into_bytes())?;
    sheet_types.reverse();
    add(
        "[Content_Types].xml".into(),
        format!(
            include_str!("xlsx/content-types.xml"),
            shared = shared,
            sheets = sheet_types.join("")
        )
        .into_bytes(),
    )?;
    add(
        "_rels/.rels".into(),
        include_bytes!("xlsx/root.rels").to_vec(),
    )?;
    Some(encode_zip_members(&entries, 6, &[], true, false, &Default::default(), |_,_,_,_| {}))
}

use super::super::super::office_xml::{Token, decode, entities, tokens};
use super::super::dates;
use crate::commands::codecs::zip_directory;
use std::{borrow::Cow, collections::BTreeMap};

const LIMIT: &str = "worksheet exceeds byte limit";

// The public XLSX reader exports cached cell text in file order. It does not
// import a calculation workbook or use row numbers to fill missing rows.
fn field(
    source: &str,
    tokens: &[Token<'_>],
    position: &mut usize,
    exact: bool,
) -> Result<Option<String>, String> {
    let Token::Start {
        name, empty, body, ..
    } = &tokens[*position - 1]
    else {
        unreachable!()
    };
    if *empty {
        return Ok(None);
    }
    while let Some(token) = tokens.get(*position) {
        *position += 1;
        if let Token::End(end_name, end) = token {
            if end_name == name {
                if exact && !source[..*body].ends_with("<v>") {
                    return Ok(None);
                }
                return entities(&source[*body..*end]).map(Some);
            }
        }
    }
    Ok(None)
}

fn index(value: &str) -> Option<usize> {
    let value = if value.len() <= 16 { value } else { "" };
    let number = crate::commands::js_number(value, 0.);
    (number.is_finite() && number >= 0. && number.fract() == 0. && number <= 9_007_199_254_740_991.)
        .then_some(number as usize)
}

fn column(value: &str) -> Result<Option<usize>, String> {
    let mut column = 0u64;
    let mut letters = 0;
    let mut digits = 0;
    for byte in value.bytes() {
        if byte.is_ascii_alphabetic() && digits == 0 {
            column = column
                .checked_mul(26)
                .and_then(|v| v.checked_add(u64::from(byte.to_ascii_uppercase() - b'A' + 1)))
                .ok_or("Column index exceeds safe storage addressing")?;
            letters += 1;
        } else if byte.is_ascii_digit() && letters > 0 {
            digits += 1;
        } else {
            return Ok(None);
        }
    }
    if letters == 0 || digits == 0 {
        return Ok(None);
    }
    if column > 9_007_199_254_740_991 {
        return Err("Column index exceeds safe storage addressing".into());
    }
    Ok(Some(usize::try_from(column - 1).map_err(|_| LIMIT)?))
}

fn shared_index(value: &str) -> Option<usize> {
    let value =
        value.trim_start_matches(|c: char| c == '\u{feff}' || c != '\u{85}' && c.is_whitespace());
    let digits = value.strip_prefix(['+', '-']).unwrap_or(value);
    let count = digits.bytes().take_while(u8::is_ascii_digit).count();
    if count == 0 {
        return None;
    }
    let n = value[..value.len() - digits.len() + count]
        .parse::<f64>()
        .ok()?;
    (n >= 0. && n <= 9_007_199_254_740_991.).then_some(n as usize)
}

pub(in crate::commands) fn read(
    bytes: &[u8],
    display_dates: bool,
    limit: usize,
) -> Result<Vec<Vec<String>>, String> {
    let (members, _) = zip_directory(bytes.len(), |range| Ok(Cow::Borrowed(&bytes[range])))
        .map_err(|error| {
            if error == "ZIP missing end record" {
                "ZIP truncated or missing end of central directory".into()
            } else {
                error
            }
        })?;
    let mut parts = BTreeMap::new();
    let mut fallback = None;
    let mut remaining = limit;
    for member in members {
        remaining = remaining.checked_sub(member.size).ok_or(LIMIT)?;
        if !matches!(member.method, 0 | 8) {
            return Err("ZIP unsupported compression method".into());
        }
        let decoded = member.decode(Cow::Borrowed(&bytes[member.payload.clone()]), None)?;
        if fallback.is_none() && member.name.starts_with("xl/worksheets/sheet") {
            fallback = Some(member.name.clone());
        }
        if matches!(
            member.name.as_str(),
            "xl/styles.xml"
                | "xl/workbook.xml"
                | "xl/sharedStrings.xml"
                | "xl/worksheets/sheet1.xml"
        ) || fallback.as_ref() == Some(&member.name)
        {
            parts.insert(member.name, decoded);
        }
    }
    let mut date1904 = false;
    if display_dates && let Some(bytes) = parts.get("xl/workbook.xml") {
        let source = decode(bytes)?;
        for token in tokens(&source)? {
            if let Token::Start {
                name: "workbookPr",
                attributes,
                ..
            } = token
            {
                for attr in attributes {
                    if attr.name == "date1904" {
                        date1904 = matches!(attr.value, "1" | "true" | "on");
                    }
                }
            }
        }
    }
    let mut formats = BTreeMap::new();
    let mut styles = Vec::new();
    if display_dates && let Some(bytes) = parts.get("xl/styles.xml") {
        let source = decode(bytes)?;
        let mut in_cells = false;
        for token in tokens(&source)? {
            match token {
                Token::Start {
                    name: "cellXfs",
                    empty,
                    ..
                } => in_cells = !empty,
                Token::End("cellXfs", _) => in_cells = false,
                Token::Start {
                    name: "numFmt",
                    attributes,
                    ..
                } => {
                    let mut id = None;
                    let mut value = None;
                    for attr in attributes {
                        if attr.name == "numFmtId" {
                            id = index(attr.value);
                        }
                        if attr.name == "formatCode" {
                            value = Some(entities(attr.value)?);
                        }
                    }
                    if let (Some(id), Some(value)) = (id, value) {
                        formats.insert(id, value);
                    }
                }
                Token::Start {
                    name: "xf",
                    attributes,
                    ..
                } if in_cells => {
                    let mut id = Some(0);
                    for attr in attributes {
                        if attr.name == "numFmtId" {
                            id = index(attr.value);
                        }
                    }
                    styles.push(id.unwrap_or(0));
                }
                _ => {}
            }
        }
    }
    let mut shared = Vec::new();
    if let Some(bytes) = parts.get("xl/sharedStrings.xml") {
        let source = decode(bytes)?;
        let tokens = tokens(&source)?;
        let mut position = 0;
        while let Some(token) = tokens.get(position) {
            position += 1;
            if !matches!(
                token,
                Token::Start {
                    name: "si",
                    empty: false,
                    ..
                }
            ) {
                continue;
            }
            let mut value = String::new();
            while let Some(token) = tokens.get(position) {
                position += 1;
                match token {
                    Token::End("si", _) => break,
                    Token::Start { name: "t", .. } => {
                        if let Some(text) = field(&source, &tokens, &mut position, false)? {
                            value.push_str(&text);
                        }
                    }
                    _ => {}
                }
            }
            remaining = remaining
                .checked_sub(value.len() + std::mem::size_of::<String>())
                .ok_or(LIMIT)?;
            shared.push(value);
        }
    }
    let selected = parts
        .get("xl/worksheets/sheet1.xml")
        .or_else(|| parts.get(fallback.as_deref()?));
    let mut rows = Vec::new();
    let mut work = limit;
    if let Some(bytes) = selected {
        let source = decode(bytes)?;
        let tokens = tokens(&source)?;
        let mut position = 0;
        while let Some(token) = tokens.get(position) {
            position += 1;
            if !matches!(
                token,
                Token::Start {
                    name: "row",
                    empty: false,
                    ..
                }
            ) {
                continue;
            }
            let mut row = Vec::new();
            while let Some(token) = tokens.get(position) {
                position += 1;
                if matches!(token, Token::End("row", _)) {
                    break;
                }
                let Token::Start {
                    name: "c",
                    empty,
                    attributes,
                    ..
                } = token
                else {
                    continue;
                };
                let mut style = Some(0);
                let mut kind = None;
                let mut target = None;
                for attr in attributes {
                    if attr.name == "s" {
                        style = index(attr.value);
                    }
                    if !attr.double || attr.name.len() > 16 {
                        continue;
                    }
                    let local = attr.name.rsplit(':').next().unwrap();
                    if local == "t" && kind.is_none() && !attr.value.is_empty() {
                        kind = Some(if attr.value.len() <= 16 {
                            attr.value
                        } else {
                            ""
                        });
                    } else if local.eq_ignore_ascii_case("r") && target.is_none() {
                        target = column(attr.value)?;
                    }
                }
                let mut value = None;
                let mut inline = None;
                if !empty {
                    while let Some(token) = tokens.get(position) {
                        position += 1;
                        match token {
                            Token::End("c", _) => break,
                            Token::Start { name: "v", .. } if value.is_none() => {
                                value = field(&source, &tokens, &mut position, true)?
                            }
                            Token::Start { name: "t", .. } if inline.is_none() => {
                                inline = field(&source, &tokens, &mut position, false)?
                            }
                            _ => {}
                        }
                    }
                }
                if kind == Some("inlineStr") {
                    value = inline;
                } else if kind == Some("s") {
                    value =
                        value.and_then(|v| shared_index(&v).and_then(|i| shared.get(i).cloned()));
                }
                if let Some(raw) = &value {
                    if display_dates && matches!(kind, None | Some("" | "n")) && raw.len() <= 64 {
                        if let Some(style) = style {
                            let id = styles.get(style).copied().unwrap_or(0);
                            let pattern = formats
                                .get(&id)
                                .filter(|s| !s.is_empty())
                                .map(String::as_str)
                                .or_else(|| dates::builtin(id));
                            if let Some(pattern) = pattern {
                                if let Some(text) = dates::text(
                                    raw, pattern, date1904, false, "-", limit, &mut work,
                                )? {
                                    value = Some(text);
                                }
                            }
                        }
                    } else if kind == Some("b") && raw.len() <= 5 {
                        value = Some(
                            if matches!(raw.as_str(), "1" | "true") {
                                "TRUE"
                            } else {
                                "FALSE"
                            }
                            .into(),
                        );
                    }
                }
                let width = row.len().max(target.unwrap_or(0));
                let allocated = (width - row.len() + 1)
                    .checked_mul(std::mem::size_of::<String>())
                    .ok_or(LIMIT)?;
                let value = value.unwrap_or_default();
                remaining = remaining
                    .checked_sub(allocated)
                    .and_then(|n| n.checked_sub(value.len()))
                    .ok_or(LIMIT)?;
                row.resize(width, String::new());
                row.push(value);
            }
            if !row.is_empty() {
                remaining = remaining
                    .checked_sub(std::mem::size_of::<Vec<String>>())
                    .ok_or(LIMIT)?;
                rows.push(row);
            }
        }
    }
    Ok(rows)
}

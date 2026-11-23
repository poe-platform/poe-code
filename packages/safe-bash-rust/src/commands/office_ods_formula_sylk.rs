use super::{Expr, Parser, Syntax, finish, reference};

pub(in crate::commands) fn read(
    source: &str,
    position: (usize, usize),
    names: &mut Vec<(Option<usize>, String)>,
    work: &mut usize,
) -> Result<Option<String>, &'static str> {
    let source = source.strip_prefix('=').unwrap_or(source);
    let parser = Parser {
        sylk: Some(position),
        discovered_names: Some(names),
        invalid_public_syntax: false,
        native: true,
        native_diagnostic: None,
        gnumeric: true,
        source,
        pos: 0,
        nodes: (*work / std::mem::size_of::<Expr>()).min(8192),
        limited: false,
        work: *work,
        sheet_separator: '!',
        legacy: false,
        excel: true,
        normalized: false,
        arrays: 0,
        in_array: false,
        has_bindings: false,
        separators: false,
        error: None,
    };
    let Some(mut parsed) = finish(parser, true)? else {
        return Ok(None);
    };
    if parsed.error.is_some()
        || parsed.native_diagnostic.is_some()
        || !parsed.public_expression(work)?
    {
        return Ok(None);
    }
    let Some(_) = parsed.entry_names(&["Sheet1".into()], &[(1_048_576, 16_384)], work)? else {
        return Ok(None);
    };
    let text = parsed
        .expression
        .as_ref()
        .unwrap()
        .render(Syntax::Gnumeric, work)?;
    Ok(Some(text))
}

fn axis(source: &str, marker: u8, origin: usize, maximum: usize) -> Option<(usize, String)> {
    if source.as_bytes().first().map(u8::to_ascii_uppercase) != Some(marker) {
        return None;
    }
    let relative = source.as_bytes().get(1) == Some(&b'[');
    let end = if relative {
        source.find(']')? + 1
    } else {
        1 + source[1..].bytes().take_while(u8::is_ascii_digit).count()
    };
    let raw = if relative {
        &source[2..end - 1]
    } else {
        &source[1..end]
    };
    let value = if raw.is_empty() && !relative {
        origin as i64
    } else {
        let n = raw.parse::<i64>().ok()?;
        if relative {
            (origin as i64).checked_add(n)?
        } else {
            n.checked_sub(1)?
        }
    };
    if value < 0 || value >= maximum as i64 {
        return relative.then(|| (end, "#REF!".into()));
    }
    let address = if marker == b'R' {
        (value + 1).to_string()
    } else {
        crate::commands::structured::xlsx_idx_to_col_ref(value as usize)
    };
    Some((
        end,
        format!(
            "{}{}",
            if relative || raw.is_empty() { "" } else { "$" },
            address
        ),
    ))
}
fn cell(source: &str, position: (usize, usize)) -> Option<(usize, String, bool)> {
    let row = axis(source, b'R', position.0, 1_048_576);
    let start = row.as_ref().map_or(0, |v| v.0);
    let col = axis(&source[start..], b'C', position.1, 16_384);
    if row.is_none() && col.is_none() {
        return None;
    }
    let end = start + col.as_ref().map_or(0, |v| v.0);
    let whole = row.is_none() || col.is_none();
    Some((
        end,
        format!(
            "{}{}",
            col.map_or(String::new(), |v| v.1),
            row.map_or(String::new(), |v| v.1)
        ),
        whole,
    ))
}
impl Parser<'_> {
    pub(super) fn record_sylk_name(&mut self, raw: &str) {
        let Some(names) = self.discovered_names.as_mut() else {
            return;
        };
        let (scope, name) = if let Some((sheet, name)) = super::qualified(raw, '!') {
            if !sheet.trim_matches('\'').eq_ignore_ascii_case("Sheet1") {
                return;
            }
            (Some(0), name)
        } else {
            (None, raw)
        };
        if !names
            .iter()
            .any(|(s, n)| *s == scope && n.eq_ignore_ascii_case(name))
        {
            names.push((scope, name.into()));
        }
    }

    pub(super) fn sylk_reference(&mut self) -> Option<Expr> {
        let position = self.sylk?;
        let source = &self.source[self.pos..];
        let mut quoted = false;
        let mut prefix = 0;
        for (i, c) in source.char_indices() {
            if c == '\'' {
                quoted = !quoted;
            } else if c == '!' && !quoted {
                prefix = i + 1;
                break;
            } else if !quoted && !(c.is_alphanumeric() || "_.$".contains(c)) {
                break;
            }
        }
        let Some((mut end, mut address, whole)) = cell(&source[prefix..], position) else {
            if prefix == 0 {
                return None;
            }
            let tail = &source[prefix..];
            let count = tail
                .chars()
                .take_while(|c| c.is_alphanumeric() || "_.".contains(*c))
                .map(char::len_utf8)
                .sum::<usize>();
            let name = &tail[..count];
            if count == 0
                || tail[count..].trim_start().starts_with('(')
                || !super::super::super::office::formulas::valid_native_name(name)
            {
                return None;
            }
            let sheet = source[..prefix - 1].trim_matches('\'');
            let name = format!("'{}'!{name}", sheet.replace('\'', "''"));
            self.pos += prefix + count;
            self.record_sylk_name(&name);
            return Some(Expr::Name(name));
        };
        end += prefix;
        if prefix > 0 {
            let sheet = source[..prefix - 1].trim_matches('\'');
            address = format!("$'{}'!{address}", sheet.replace('\'', "''"));
        }
        if source[end..].starts_with(':') {
            if let Some((length, last, _)) = cell(&source[end + 1..], position) {
                end += length + 1;
                address.push(':');
                address.push_str(&last);
            } else if whole {
                return None;
            }
        } else if whole {
            return None;
        }
        if source[end..]
            .chars()
            .next()
            .is_some_and(|c| c.is_alphanumeric() || "_.[".contains(c))
            || source[end..].trim_start().starts_with('(')
        {
            return None;
        }
        let result = if address.contains("#REF!") {
            Expr::Literal("#REF!".into())
        } else {
            reference(&address, '!', &[], true)?
        };
        self.work = self.work.checked_sub(address.len() * 8 + 256).or_else(|| {
            self.limited = true;
            None
        })?;
        self.pos += end;
        self.has_bindings = true;
        Some(result)
    }
}

pub(in crate::commands) fn write(
    source: &str,
    position: (usize, usize),
    work: &mut usize,
) -> Result<String, String> {
    let invalid = || format!("Invalid SYLK formula: {source}\n");
    let input = format!("={}", source.strip_prefix('=').unwrap_or(source));
    let parsed = super::convert(true, &input, false, *work, true)
        .map_err(str::to_owned)?
        .ok_or_else(invalid)?;
    if parsed.error.is_some() || parsed.native_diagnostic.is_some() {
        return Err(invalid());
    }
    parsed
        .expression
        .as_ref()
        .ok_or_else(invalid)?
        .render(Syntax::Sylk(position.0, position.1), work)
        .map_err(str::to_owned)
}

pub(super) fn write_reference(source: &str, position: (usize, usize)) -> String {
    use super::{endpoint, range_split};
    use crate::commands::archive::office::sheet_name::quote_gnumeric_sheet;
    use std::fmt::Write;
    let (first, last) =
        range_split(source).map_or((source, None), |i| (&source[..i], Some(&source[i + 1..])));
    let parts = std::iter::once(first)
        .chain(last)
        .filter_map(|p| endpoint(p, '.', true))
        .collect::<Vec<_>>();
    let Some(first) = parts.first() else {
        return source.into();
    };
    let address = |cell: &str| {
        if parts.len() == 1 && first.position.is_none() {
            return cell.to_owned();
        }
        let raw = cell.strip_prefix('$').unwrap_or(cell);
        let letters = raw.bytes().take_while(u8::is_ascii_alphabetic).count();
        let row = raw[letters..].strip_prefix('$').unwrap_or(&raw[letters..]);
        if row.bytes().any(|b| !b.is_ascii_digit()) {
            return cell.to_owned();
        }
        let mut out = String::new();
        for (marker, value, absolute, origin) in [
            (
                'R',
                row.parse::<i64>().ok(),
                raw[letters..].starts_with('$') || letters == 0 && cell.starts_with('$'),
                position.0,
            ),
            (
                'C',
                (letters > 0).then(|| {
                    raw[..letters].bytes().fold(0_i64, |n, b| {
                        n * 26 + i64::from(b.to_ascii_uppercase() - b'A' + 1)
                    })
                }),
                cell.starts_with('$'),
                position.1,
            ),
        ] {
            if let Some(value) = value {
                out.push(marker);
                if absolute {
                    write!(out, "{value}").unwrap();
                } else {
                    let offset = value - 1 - origin as i64;
                    if offset != 0 {
                        write!(out, "[{offset}]").unwrap();
                    }
                }
            }
        }
        out
    };
    let mut out = String::new();
    if let Some(book) = &first.workbook {
        write!(
            out,
            "[\"{}\"]",
            book.replace('\\', "\\\\").replace('"', "\\\"")
        )
        .unwrap();
    }
    let last_sheet = parts
        .last()
        .and_then(|p| p.sheet.as_ref())
        .or(first.sheet.as_ref());
    if let Some(sheet) = &first.sheet {
        out.push_str(&quote_gnumeric_sheet(sheet));
        if let Some(last) = last_sheet.filter(|last| *last != sheet) {
            out.push(':');
            out.push_str(&quote_gnumeric_sheet(last));
        }
        out.push('!');
    }
    let a = address(&first.cell);
    out.push_str(&a);
    if let Some(last) = parts.get(1) {
        let b = address(&last.cell);
        if a != b {
            out.push(':');
            out.push_str(&b);
        }
    }
    out
}

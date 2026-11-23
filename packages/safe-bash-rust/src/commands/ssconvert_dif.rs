// Gnumeric 1.12.61 plugins/dif/dif.c (GPL-2.0-or-later); see LICENSE.GNUMERIC.
use super::{WorkbookSheet, updates, xlsx};
use crate::commands::archive::office_ods::formula;
use std::{collections::BTreeMap, fmt::Write};
use xlsx::{Sheet, TypedCell, Value, Workbook};

struct Lines<'a> {
    bytes: &'a [u8],
    line: usize,
}
impl Lines<'_> {
    fn next(&mut self, phase: &str) -> Result<String, String> {
        if self.bytes.is_empty() {
            return Err(format!(
                "E Error while reading DIF file.\n  E Unexpected end of file at line {} while reading {phase}.\n",
                self.line + 1
            ));
        }
        let end = self
            .bytes
            .iter()
            .position(|b| matches!(b, 10 | 13))
            .unwrap_or(self.bytes.len());
        let line = &self.bytes[..end];
        let skip = if self.bytes.get(end..end + 2) == Some(b"\r\n") {
            2
        } else {
            1
        };
        self.bytes = &self.bytes[(end + skip).min(self.bytes.len())..];
        self.line += 1;
        Ok(line
            .iter()
            .take_while(|&&b| b != 0)
            .map(|&b| char::from(b))
            .collect())
    }
}

fn prefix(source: &str, integer: bool) -> f64 {
    let bytes = source.as_bytes();
    let mut end = usize::from(bytes.first().is_some_and(|b| matches!(b, b'+' | b'-')));
    while bytes.get(end).is_some_and(u8::is_ascii_digit) {
        end += 1;
    }
    if !integer && bytes.get(end) == Some(&b'.') {
        end += 1;
        while bytes.get(end).is_some_and(u8::is_ascii_digit) {
            end += 1;
        }
    }
    if !integer && bytes.get(end).is_some_and(|b| matches!(b, b'e' | b'E')) {
        let exponent = end;
        end += 1;
        if bytes.get(end).is_some_and(|b| matches!(b, b'+' | b'-')) {
            end += 1;
        }
        let start = end;
        while bytes.get(end).is_some_and(u8::is_ascii_digit) {
            end += 1;
        }
        if start == end {
            end = exponent;
        }
    }
    source[..end].parse().unwrap_or(0.)
}

pub(in super::super) fn read(
    bytes: &[u8],
    limit: usize,
    diagnostics: &mut String,
) -> Result<(Sheet<String>, Workbook), String> {
    let mut input = Lines { bytes, line: 0 };
    loop {
        let topic = input.next("header")?;
        input.next("header")?;
        input.next("header")?;
        if topic == "DATA" {
            break;
        }
    }
    let book = Workbook {
        sheet_sizes: vec![(65536, 256)],
        // DIF entered formulas start with an uncalculated, blank cache.
        calculation_cells: Some(Default::default()),
        ..Workbook::default()
    };
    let mut cells = BTreeMap::new();
    let (mut row, mut col) = (-1i32, 0usize);
    let (mut too_many_rows, mut too_many_columns) = (false, false);
    let mut work = limit;
    loop {
        let line = input.next("data")?;
        let kind = prefix(
            line.trim_start_matches(|c: char| {
                c.is_whitespace() && c != '\u{85}' || c == '\u{feff}'
            }),
            true,
        );
        let mut cell = TypedCell {
            value: None,
            formula: None,
            openformula: None,
            formula_display: None,
            format: None,
            value_format: None,
            style: None,
            rich_text: None,
        };
        if kind == 0. {
            let Some((_, source)) = line.split_once(',') else {
                writeln!(
                    diagnostics,
                    "Syntax error at line {}. Ignoring.",
                    input.line + 1
                )
                .unwrap();
                continue;
            };
            if col > 256 {
                too_many_columns = true;
                break;
            }
            let source = source.trim_start_matches(|c| " \t\r\n\x0b\x0c".contains(c));
            let lower = source.to_ascii_lowercase();
            let unsigned = lower.strip_prefix(['+', '-']).unwrap_or(&lower);
            let n = if unsigned.starts_with("nan") {
                f64::NAN
            } else if unsigned.starts_with("inf") {
                if source.starts_with('-') {
                    f64::NEG_INFINITY
                } else {
                    f64::INFINITY
                }
            } else {
                prefix(source, false)
            };
            let marker = input.next("data")?;
            cell.value = match marker.as_str() {
                "V" => Some(if n.is_finite() {
                    Value::Number(n)
                } else {
                    Value::Error("#NUM!".into())
                }),
                "NA" => Some(Value::Error("#N/A".into())),
                "TRUE" | "FALSE" => Some(Value::Bool(marker == "TRUE")),
                "ERROR" => {
                    writeln!(
                        diagnostics,
                        "Unknown value type 'ERROR' at line {}. Ignoring.",
                        input.line + 1
                    )
                    .unwrap();
                    None
                }
                _ => None,
            };
        } else if kind == 1. {
            let text = input.next("data")?;
            if col > 256 {
                too_many_columns = true;
                continue;
            }
            let text = text
                .strip_prefix('"')
                .and_then(|s| s.strip_suffix('"'))
                .unwrap_or(&text);
            if text.starts_with('=') {
                let normalized = formula::expression_text(text, true, &mut work)
                    .map_err(|e| format!("ssconvert: {e}\n"))?;
                if let Some(parsed) = normalized
                    .as_deref()
                    .map(|s| formula::convert(true, s, false, work, true))
                    .transpose()
                    .map_err(|e| format!("ssconvert: {e}\n"))?
                    .flatten()
                    .filter(|p| p.error.is_none() && p.native_diagnostic.is_none())
                    && let Some(_) = parsed
                        .entry_names(&["Sheet1".into()], &book.sheet_sizes, &mut work)
                        .map_err(|e| format!("ssconvert: {e}\n"))?
                {
                    cell.formula = normalized.map(|s| s.strip_prefix('=').unwrap_or(&s).to_owned());
                }
            }
            let (value, format) = if cell.formula.is_some() {
                (Value::Empty, None)
            } else if matches!(
                text,
                "#NULL!" | "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A"
            ) {
                (Value::Error(text.into()), None)
            } else {
                updates::infer(text, false)
            };
            cell.value = (!matches!(value, Value::Empty)).then_some(value);
            cell.value_format = format.map(|s| match s.as_str() {
                "0%" => "0.00%".into(),
                "yyyy-mm-dd" => "yyyy-mmm-dd".into(),
                _ => s,
            });
        } else if kind == -1. {
            let marker = input.next("data")?;
            if marker == "EOD" {
                break;
            }
            if marker == "BOT" {
                row += 1;
                col = 0;
                if row > 65536 {
                    too_many_rows = true;
                    break;
                }
            } else {
                writeln!(
                    diagnostics,
                    "Unknown data value \"{marker}\" at line {}. Ignoring.",
                    input.line + 1
                )
                .unwrap();
            }
            continue;
        } else {
            writeln!(
                diagnostics,
                "Unknown value type {kind} at line {}. Ignoring.",
                input.line + 1
            )
            .unwrap();
            let _ = input.next("data");
            continue;
        }
        if (0..65536).contains(&row) && col < 256 && (cell.value.is_some() || kind == 1.) {
            work = work
                .checked_sub(256 + line.len())
                .ok_or("ssconvert DIF cells limit exceeded\n")?;
            cells.insert((row as usize, col), cell);
        }
        col += 1;
    }
    if too_many_rows {
        diagnostics.push_str(
            "DIF file has more than the maximum number of rows 65536. Ignoring remaining rows.\n",
        );
    }
    if too_many_columns {
        diagnostics.push_str("DIF file has more than the maximum number of columns 256. Ignoring remaining columns.\n");
    }
    Ok((
        Sheet {
            style_regions: vec![],
            name: "Sheet1".into(),
            view: vec![],
            sylk_r1c1: None,
            sylk_hide_zero: false,
            print: xlsx::Print::default(),
            filter: None,
            cells,
            rows: BTreeMap::new(),
            columns: BTreeMap::new(),
            merges: vec![],
            arrays: vec![],
            comments: vec![],
            empty_headers: true,
        },
        book,
    ))
}

fn number(n: f64) -> String {
    if n == 0. {
        return "0".into();
    }
    let scientific = format!("{:.5e}", n.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap();
    let exponent: i32 = exponent.parse().unwrap();
    let digits = mantissa.replace('.', "").trim_end_matches('0').to_owned();
    let mut out = if n < 0. { "-".into() } else { String::new() };
    if !(-4..6).contains(&exponent) {
        out.push_str(&digits[..1]);
        if digits.len() > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        write!(
            out,
            "e{}{:02}",
            if exponent < 0 { '-' } else { '+' },
            exponent.abs()
        )
        .unwrap();
    } else if exponent < 0 {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-exponent - 1) as usize));
        out.push_str(&digits);
    } else {
        let point = exponent as usize + 1;
        out.push_str(&digits[..point.min(digits.len())]);
        if point < digits.len() {
            out.push('.');
            out.push_str(&digits[point..]);
        } else {
            out.extend(std::iter::repeat_n('0', point - digits.len()));
        }
    }
    out
}

pub(in super::super) fn write(
    sheet: &WorkbookSheet,
    book: &Workbook,
    limit: usize,
) -> Option<Vec<u8>> {
    let typed = sheet.typed.as_ref()?;
    let (r, c, y, x) = super::extent(sheet, true);
    if (y - r + 1).saturating_mul(x - c + 1) > limit {
        return None;
    }
    let mut out = format!(
        "TABLE\n0,1\n\"GNUMERIC\"\nVECTORS\n0,{}\n\"\"\nTUPLES\n0,{}\n\"\"\nDATA\n0,0\n\"\"\n",
        x + 1,
        y + 1
    );
    let mut work = limit;
    let text = super::TextOptions {
        format: "preserve",
        ..super::TextOptions::default()
    };
    for row in r..=y {
        out.push_str("-1,0\nBOT\n");
        for col in c..=x {
            let cell = typed.cells.get(&(row, col));
            match cell.and_then(|cell| cell.value.as_ref()) {
                None | Some(Value::Empty) => out.push_str("1,0\n\"\"\n"),
                Some(Value::Bool(value)) => out.push_str(if *value {
                    "0,1\nTRUE\n"
                } else {
                    "0,0\nFALSE\n"
                }),
                Some(Value::Error(value)) => out.push_str(if value == "#N/A" {
                    "0,0\nNA\n"
                } else {
                    "0,0\nERROR\n"
                }),
                Some(Value::Number(value)) => write!(out, "0,{}\nV\n", number(*value)).ok()?,
                Some(Value::Text(_)) => write!(
                    out,
                    "1,0\n\"{}\"\n",
                    text.cell(cell.unwrap(), book.date1904, &mut work)?
                )
                .ok()?,
            }
            if out.len() > limit {
                return None;
            }
        }
    }
    out.push_str("-1,0\nEOD\n");
    (out.len() <= limit).then(|| out.into_bytes())
}

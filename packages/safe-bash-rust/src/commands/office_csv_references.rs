use super::super::{coordinate, sheet_name::quote_sheet};
use crate::commands::structured::xlsx_idx_to_col_ref;

use super::super::function_names;

#[derive(Clone, Copy, PartialEq)]
pub(in super::super) enum FormulaMode {
    Csv,
    Xlsx,
    Calculate,
}

struct Token<'a> {
    raw: &'a str,
    sheet: Option<&'a str>,
    address: &'a str,
}
impl Token<'_> {
    fn known_sheet(&self) -> bool {
        self.sheet.is_none_or(|name| {
            let name = name.strip_prefix('$').unwrap_or(name);
            name.strip_prefix('\'')
                .and_then(|s| s.strip_suffix('\''))
                .unwrap_or(name)
                .eq_ignore_ascii_case("Sheet1")
        })
    }
    fn prefix(&self, sheet: &str, excel: bool) -> String {
        self.sheet.map_or_else(String::new, |name| {
            format!(
                "{}{}{}",
                if !excel && name.starts_with('$') {
                    "$"
                } else {
                    ""
                },
                sheet,
                if excel { "!" } else { "." }
            )
        })
    }
}
fn token(source: &str) -> Token<'_> {
    let start = usize::from(source.starts_with('$'));
    let mut end;
    let mut split = None;
    if source[start..].starts_with('\'') {
        end = start + 1;
        loop {
            let Some(next) = source[end..].find('\'') else {
                end = source.len();
                break;
            };
            end += next + 1;
            if source[end..].starts_with('\'') {
                end += 1;
            } else {
                break;
            }
        }
        if source[start + 1..end].ends_with('\'') && source[end..].starts_with('.') {
            split = Some(end);
            end += 1;
            end += source[end..]
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '$')
                .map(char::len_utf8)
                .sum::<usize>();
        }
    } else {
        end = source
            .chars()
            .take_while(|c| c.is_alphanumeric() || "_$.".contains(*c))
            .map(char::len_utf8)
            .sum();
        split = source[..end].rfind('.');
    }
    Token {
        raw: &source[..end],
        sheet: split.map(|i| &source[..i]),
        address: split.map_or(&source[..end], |i| &source[i + 1..end]),
    }
}

#[derive(Clone, Copy)]
struct Address {
    column: Option<(usize, bool)>,
    row: Option<(usize, bool)>,
}
impl Address {
    fn parse(text: &str) -> Option<Self> {
        let column_absolute = text.starts_with('$');
        let bare = text.strip_prefix('$').unwrap_or(text);
        if let Some((row, column)) = coordinate(text) {
            return Some(Self {
                column: Some((column, column_absolute)),
                row: Some((row, bare.contains('$'))),
            });
        }
        if bare.bytes().all(|b| b.is_ascii_digit()) {
            let row = bare.parse::<usize>().ok()?.checked_sub(1)?;
            return (row < 1_048_576).then_some(Self {
                column: None,
                row: Some((row, column_absolute)),
            });
        }
        let column = bare
            .bytes()
            .try_fold(0usize, |n, b| {
                if !b.is_ascii_alphabetic() {
                    return None;
                }
                n.checked_mul(26)?
                    .checked_add(usize::from(b.to_ascii_uppercase() - b'A' + 1))
            })?
            .checked_sub(1)?;
        (column < 16_384).then_some(Self {
            column: Some((column, column_absolute)),
            row: None,
        })
    }
    fn cell(self) -> bool {
        self.column.is_some() && self.row.is_some()
    }
    fn text(self, columns: bool, rows: bool) -> String {
        let mut out = String::new();
        if columns && let Some((column, absolute)) = self.column {
            if absolute {
                out.push('$');
            }
            out.push_str(&xlsx_idx_to_col_ref(column));
        }
        if rows && let Some((row, absolute)) = self.row {
            if absolute {
                out.push('$');
            }
            out.push_str(&(row + 1).to_string());
        }
        out
    }
}
fn reference(
    source: &str,
    sheet: &str,
    excel: bool,
    calculate: bool,
    available: usize,
) -> Option<(usize, String, usize)> {
    let mut first = token(source);
    if !first.known_sheet() {
        return None;
    }
    let mut a = Address::parse(first.address)?;
    let mut end = first.raw.len();
    let mut b = a;
    let mut last = None;
    let mut tokens = 1;
    if source[end..].starts_with(':') {
        let second = token(&source[end + 1..]);
        if let Some(address) = Address::parse(second.address)
            && a.row.is_some() == address.row.is_some()
            && a.column.is_some() == address.column.is_some()
            && (second.known_sheet()
                || first.sheet.is_none() && second.sheet.is_some() && a.row.is_some())
        {
            end += 1 + second.raw.len();
            if first.sheet.is_none() && second.sheet.is_some() && a.row.is_some() {
                return Some((end, source[..end].to_lowercase(), tokens));
            }
            b = address;
            last = Some(second);
            // Exports preserve endpoint pairs and fold only a trailing single cell.
            // Calculation can fold whole valid chains without growing its syntax tree.
            // Additional standalone axes remain ordinary range operators.
            if a.cell() {
                while source[end..].starts_with(':') {
                    let next = token(&source[end + 1..]);
                    let Some(address) = Address::parse(next.address) else {
                        break;
                    };
                    if !next.known_sheet() || !address.cell() || tokens + 2 > available {
                        break;
                    }
                    let following = source[end + 1 + next.raw.len()..]
                        .strip_prefix(':')
                        .and_then(|rest| {
                            let following = token(rest);
                            let address = Address::parse(following.address)?;
                            address.cell().then_some((following, address))
                        });
                    if following.as_ref().is_some_and(|(following, _)| {
                        !calculate
                            || !following.known_sheet()
                            || next.sheet.is_none() && following.sheet.is_some()
                    }) {
                        break;
                    }
                    // A final single cell folds only after its operator and token fit.
                    // Another endpoint pair remains two additional stored tokens.
                    if following.is_some() {
                        tokens += 2;
                    }
                    for (next, address) in std::iter::once((next, address)).chain(following) {
                        for (left, right, value) in [
                            (&mut a.column, &mut b.column, address.column),
                            (&mut a.row, &mut b.row, address.row),
                        ] {
                            if left.unwrap().0 > right.unwrap().0 {
                                std::mem::swap(left, right);
                            }
                            if value.unwrap().0 < left.unwrap().0 {
                                *left = value;
                            }
                            if value.unwrap().0 > right.unwrap().0 {
                                *right = value;
                            }
                        }
                        if next.sheet.is_some() {
                            first.sheet = first.sheet.or(next.sheet);
                            if let Some(last) = &mut last {
                                last.sheet = last.sheet.and(next.sheet);
                            }
                        }
                        end += 1 + next.raw.len();
                    }
                }
            }
        }
    }
    let Some(last) = last else {
        return a.cell().then(|| {
            (
                end,
                format!("{}{}", first.prefix(sheet, excel), a.text(true, true)),
                tokens,
            )
        });
    };
    let row_range = a.column.is_none();
    for (left, right, maximum) in [
        (&mut a.column, &mut b.column, 16_383),
        (&mut a.row, &mut b.row, 1_048_575),
    ] {
        if left.is_none() {
            *left = Some((0, true));
            *right = Some((maximum, true));
        } else if left.unwrap().0 > right.unwrap().0 {
            std::mem::swap(left, right);
        }
    }
    let whole_columns = a.row?.0 == 0 && b.row?.0 == 1_048_575;
    let whole_rows = a.column?.0 == 0 && b.column?.0 == 16_383;
    if whole_columns && !row_range {
        a.row.as_mut()?.1 = true;
        b.row.as_mut()?.1 = true;
    }
    let columns = !whole_rows || whole_columns && !excel;
    let rows = !whole_columns || whole_rows && excel;
    let left = a.text(columns, rows);
    let right = b.text(columns, rows);
    let prefix = first.prefix(sheet, excel);
    Some((
        end,
        if excel && !calculate && columns && rows && left == right {
            format!("{prefix}{left}")
        } else {
            format!(
                "{prefix}{left}:{}{right}",
                if excel {
                    String::new()
                } else {
                    last.prefix(sheet, false)
                }
            )
        },
        tokens,
    ))
}

fn number_end(source: &str) -> Option<usize> {
    let raw = source.as_bytes();
    let mut end = 0;
    while raw
        .get(end)
        .is_some_and(|b| b.is_ascii_digit() || *b == b'.')
    {
        end += 1;
    }
    if raw.get(end).is_some_and(|b| matches!(b, b'e' | b'E')) {
        end += 1;
        if raw.get(end).is_some_and(|b| matches!(b, b'+' | b'-')) {
            end += 1;
        }
        while raw.get(end).is_some_and(u8::is_ascii_digit) {
            end += 1;
        }
    }
    source[..end].parse::<f64>().ok()?;
    (!source[end..]
        .chars()
        .next()
        .is_some_and(|c| c.is_alphanumeric() || "_$.".contains(c)))
    .then_some(end)
}

// Calc's token buffer counts decoded UTF-16 units, including both string quotes.
fn string_token(source: &str) -> (usize, String, bool, Option<u16>) {
    let mut units = [0u16; 1024];
    units[0] = u16::from(b'"');
    let mut length = 1;
    let mut chars = source.char_indices().peekable();
    chars.next();
    let mut end = 1;
    let mut overflow = false;
    while let Some((index, c)) = chars.next() {
        end = index + c.len_utf8();
        if overflow {
            // Recovery consumes one quote, even if it belongs to an escaped pair.
            if c == '"' {
                break;
            }
            continue;
        }
        let closing = if c == '"' && chars.peek().is_some_and(|(_, next)| *next == '"') {
            end = chars.next().unwrap().0 + 1;
            false
        } else {
            c == '"'
        };
        for &unit in c.encode_utf16(&mut [0; 2]).iter() {
            if length == units.len() {
                overflow = true;
                break;
            }
            units[length] = unit;
            length += 1;
        }
        if closing && !overflow {
            break;
        }
    }
    if !overflow {
        return (end, source[..end].into(), false, None);
    }
    let quoted = units[length - 1] == u16::from(b'"');
    let split = (0xd800..=0xdbff)
        .contains(&units[length - 1])
        .then_some(units[length - 1]);
    let text = if quoted {
        let text = String::from_utf16(&units[1..length - 1]).unwrap();
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        String::from_utf16(&units[..length - usize::from(split.is_some())])
            .unwrap()
            .to_lowercase()
    };
    (end, text, true, split)
}

pub(in super::super) fn formula(
    source: &str,
    sheet: &str,
    mode: FormulaMode,
    work: &mut usize,
) -> Option<Vec<u16>> {
    let excel = mode != FormulaMode::Csv;
    *work = work.checked_sub(source.len().checked_add(sheet.len())?)?;
    let units: Vec<_> = sheet
        .encode_utf16()
        .take(if excel { 31 } else { usize::MAX })
        .collect();
    let quoted_sheet = match String::from_utf16(&units) {
        Ok(name) if name.starts_with('\'') && name.ends_with('\'') => {
            format!("'{}'", name.replace('\'', "''"))
        }
        Ok(name) => quote_sheet(&name),
        // Native formula XML replaces a split surrogate and consumes the following quote.
        Err(_) => format!(
            "'{}?",
            char::decode_utf16(units)
                .filter_map(Result::ok)
                .collect::<String>()
                .replace('\'', "''")
        ),
    };
    let mut output = Vec::new();
    let mut rest = source;
    if let Some(source) = rest.strip_prefix('=') {
        *work = work.checked_sub(2)?;
        output.push(u16::from(b'='));
        rest = source;
    }
    if rest
        .strip_prefix('=')
        .filter(|_| mode == FormulaMode::Csv)
        .unwrap_or(rest)
        .trim_matches([' ', '\t'])
        .is_empty()
    {
        let error = if mode == FormulaMode::Xlsx {
            "#ERR520!"
        } else {
            "Err:520"
        };
        *work = work.checked_sub(error.len() * 2)?;
        return Some(error.encode_utf16().collect());
    }
    // Calc reserves one of its 8,192 token slots for the stop token.
    let mut available = 8191;
    let mut arrays = Vec::new();
    let mut in_array = false;
    let mut parentheses = 0usize;
    let mut error = None;
    let mut operators = if mode == FormulaMode::Xlsx {
        super::formulas::xlsx_operators(rest, std::iter::once("Sheet1"), &[], None, work)?
    } else {
        Vec::new()
    };
    while !rest.is_empty() {
        if available == 0 {
            error.get_or_insert("Err:512");
            break;
        }
        let mut tokens = 1;
        let first = rest.chars().next()?;
        let mut end = first.len_utf8();
        let replacement;
        let mut split_surrogate = None;
        if let Some(&(remaining, length, operator)) = operators.last()
            && remaining == rest.len()
        {
            operators.pop();
            end = length;
            replacement = if operator == '~' {
                "~".into()
            } else {
                rest[..length].into()
            };
        } else if first == '"' {
            let (length, text, overflow, split) = string_token(rest);
            end = length;
            replacement = text;
            split_surrogate = split;
            if overflow {
                error.get_or_insert("Err:513");
            }
        } else if first == '#' {
            end = [
                "#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#NUM!", "#N/A", "#NULL!",
            ]
            .into_iter()
            .find(|s| rest.starts_with(s))
            .map_or(1, str::len);
            replacement = rest[..end].to_owned();
        } else if first == ' '
            || matches!(first, '\t' | '\r' | '\n')
                && arrays.last().is_some_and(|&(_, constant)| constant)
        {
            end = rest.chars().take_while(|c| *c == first).count();
            replacement = if arrays.last().is_some_and(|&(_, constant)| constant) {
                String::new()
            } else {
                rest[..end.min(255)].to_owned()
            };
        } else if first.is_alphanumeric() || matches!(first, '_' | '$' | '.' | '\'') {
            if (first.is_ascii_alphabetic() || matches!(first, '_' | '$'))
                && rest
                    .bytes()
                    .take(1025)
                    .take_while(|b| b.is_ascii_alphanumeric() || b"_$.".contains(b))
                    .count()
                    == 1025
            {
                // ASCII identifier overflow consumes the first unit that does not fit.
                end = 1025;
                replacement = rest[..1024].to_lowercase();
                error.get_or_insert("Err:513");
            } else {
                let word = token(rest);
                let call = rest[word.raw.len()..].trim_start().starts_with('(');
                let upper = if call {
                    super::super::collation::uppercase(word.raw, work)?
                } else {
                    String::new()
                };
                if let Some(name) = function_names::name(&upper, mode == FormulaMode::Xlsx) {
                    let name = if mode == FormulaMode::Xlsx
                        && name == "LOGNORMDIST"
                        && super::super::formula_arguments::argument_count(
                            &rest[word.raw.len()..],
                            in_array,
                            work,
                        )? == 4
                    {
                        "_xlfn.LOGNORM.DIST"
                    } else {
                        name
                    };
                    // Names such as LOG10 and ATAN2 take precedence over cell references.
                    end = word.raw.len();
                    replacement = if matches!(name, "AND" | "OR") && rest[end..].starts_with(' ') {
                        format!(" {name}")
                    } else {
                        end += rest[end..].len() - rest[end..].trim_start().len();
                        name.into()
                    };
                } else if let Some((len, text, count)) = reference(
                    rest,
                    &quoted_sheet,
                    excel,
                    mode == FormulaMode::Calculate,
                    available,
                ) {
                    end = len;
                    replacement = text;
                    tokens = count;
                } else if let Some(len) = number_end(rest) {
                    end = len;
                    replacement = match rest[..end].parse::<f64>() {
                        Ok(n) if mode != FormulaMode::Calculate => {
                            let n = if n.is_infinite() { f64::MAX } else { n };
                            super::super::number_format::exact(n)
                        }
                        _ => rest[..end].to_owned(),
                    };
                } else {
                    end = word.raw.len();
                    replacement = if call {
                        *work = work.checked_sub(word.raw.len().checked_mul(4)?)?;
                        function_names::unknown(word.raw)
                    } else if word.raw.eq_ignore_ascii_case("TRUE") {
                        if in_array { "TRUE" } else { "1" }.into()
                    } else if word.raw.eq_ignore_ascii_case("FALSE") {
                        if in_array { "FALSE" } else { "0" }.into()
                    } else if first.is_ascii_digit() || first == '.' {
                        word.raw.into()
                    } else {
                        word.raw.to_lowercase()
                    };
                }
            }
        } else {
            if matches!(&rest.as_bytes()[..rest.len().min(2)], b"<=" | b">=" | b"<>") {
                end = 2;
            }
            replacement = if first == '+' && arrays.last().is_some_and(|&(_, constant)| constant) {
                String::new()
            } else if first == '!' && excel {
                " ".into()
            } else {
                rest[..end].to_owned()
            };
        }
        if first == '(' {
            parentheses += 1;
        } else if first == ')' {
            parentheses = parentheses.saturating_sub(1);
        }
        if first == '{' {
            in_array = true;
            *work = work.checked_sub(std::mem::size_of::<(usize, bool)>())?;
            arrays.push((
                available,
                super::super::xlsx_import::matrix_constant(&rest[1..], work)?,
            ));
        }
        available -= tokens;
        if first == '}' {
            in_array = false;
        }
        if first == '}'
            && let Some((before, _)) = arrays.pop()
        {
            // A closed literal matrix replaces its component tokens with one token.
            available = before - 1;
        }
        *work = work.checked_sub(replacement.encode_utf16().count().checked_mul(2)?)?;
        output.extend(replacement.encode_utf16());
        if let Some(unit) = split_surrogate {
            *work = work.checked_sub(2)?;
            output.push(unit);
        }
        rest = &rest[end..];
    }
    if error == Some("Err:513") {
        // Overflow recovery can consume closing tokens previously inserted on import.
        if !arrays.is_empty() && available > 0 {
            *work = work.checked_sub(2)?;
            output.push(u16::from(b'}'));
            available -= 1;
        }
        for _ in 0..parentheses.min(available) {
            *work = work.checked_sub(2)?;
            output.push(u16::from(b')'));
        }
    }
    if mode == FormulaMode::Calculate
        && let Some(error) = error
    {
        *work = work.checked_sub(error.len().checked_mul(2)?)?;
        return Some(error.encode_utf16().collect());
    }
    Some(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::structured::{JVal, parse_json_stream};

    #[test]
    fn function_spellings_match_native_catalog_exports() {
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-function-names-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &fixture
            .iter()
            .find(|(k, _)| k == "serialization")
            .unwrap()
            .1
        else {
            panic!("serialization")
        };
        for case in cases {
            let JVal::Object(fields) = case else {
                panic!("case")
            };
            let text = |key| match &fields.iter().find(|(k, _)| k == key).unwrap().1 {
                JVal::Str(s) => s.as_str(),
                _ => panic!("text"),
            };
            for (key, mode) in [("csv", FormulaMode::Csv), ("xlsx", FormulaMode::Xlsx)] {
                let source = if mode == FormulaMode::Csv {
                    text("input")
                } else {
                    text("input").strip_prefix('=').unwrap()
                };
                let actual = formula(source, "catalog", mode, &mut 65_536).unwrap();
                assert_eq!(
                    String::from_utf16(&actual).unwrap(),
                    text(key),
                    "{source} {key}"
                );
                assert!(formula(source, "catalog", mode, &mut source.len()).is_none());
            }
        }
    }
}

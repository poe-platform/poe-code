//! Gnumeric's two-pass text column inference, shared by delimited imports.
use super::{updates, xlsx};
use crate::commands::{
    archive::office_ods::formula,
    coreutils::{civil_from_days, days_from_civil},
};
use std::collections::BTreeMap;
use xlsx::{Sheet, TypedCell, Value, Workbook};

fn trim(text: &str) -> &str {
    text.trim_matches(|c: char| c.is_whitespace() && c != '\u{85}' || c == '\u{feff}')
}

fn number(text: &str, decimal: char) -> Option<f64> {
    let mut source = trim(text);
    let negative = source.starts_with('(') && source.ends_with(')');
    if negative {
        source = trim(&source[1..source.len() - 1]);
    }
    if let Some(s) = source.strip_prefix('$') {
        source = trim(s);
    }
    if let Some(s) = source.strip_suffix('$') {
        source = trim(s);
    }
    let percent = source.ends_with('%');
    if percent {
        source = trim(&source[..source.len() - 1]);
    }
    if negative && (percent || source.starts_with(['+', '-']) || source.ends_with(['+', '-'])) {
        return None;
    }
    let signed;
    if source.ends_with(['+', '-']) && !source.contains(['e', 'E']) {
        signed = format!(
            "{}{}",
            &source[source.len() - 1..],
            trim(&source[..source.len() - 1])
        );
        source = &signed;
    }
    let thousand = if decimal == '.' { ',' } else { '.' };
    let mut normalized = String::new();
    let (mut seen_decimal, mut exponent, mut previous_digit) = (false, false, false);
    for (index, c) in source.char_indices() {
        if c == thousand
            && previous_digit
            && !seen_decimal
            && !exponent
            && source
                .as_bytes()
                .get(index + 1..index + 4)
                .is_some_and(|s| s.iter().all(u8::is_ascii_digit))
        {
            continue;
        }
        if c == decimal && !seen_decimal && !exponent {
            seen_decimal = true;
            normalized.push('.');
            previous_digit = false;
            continue;
        }
        if matches!(c, 'e' | 'E') {
            if exponent {
                return None;
            }
            exponent = true;
        } else if !c.is_ascii_digit() && !matches!(c, '+' | '-') {
            return None;
        }
        normalized.push(c);
        previous_digit = c.is_ascii_digit();
    }
    let value = normalized.parse::<f64>().ok()?;
    value
        .is_finite()
        .then_some(value * if negative { -1. } else { 1. } / if percent { 100. } else { 1. })
}

#[derive(Clone, Copy)]
enum DateOrder {
    Dmy,
    Mdy,
    Ymd,
}
impl DateOrder {
    fn format(self) -> &'static str {
        match self {
            Self::Dmy => "d-mmm-yyyy",
            Self::Mdy => "m/d/yyyy",
            Self::Ymd => "yyyy-mm-dd",
        }
    }
}
fn date(text: &str, order: DateOrder) -> Option<f64> {
    let source = trim(text);
    let separator = if source.contains('/') {
        '/'
    } else if source.contains('-') {
        '-'
    } else {
        '.'
    };
    let mut parts: Vec<_> = source.split(separator).map(str::to_owned).collect();
    let months = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
    ];
    let month = |s: &str| {
        months
            .iter()
            .position(|m| m.eq_ignore_ascii_case(s) || m[..3].eq_ignore_ascii_case(s))
    };
    let words: Vec<_> = source
        .replace(',', "")
        .split(' ')
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();
    if words.len() == 3 && month(&words[0]).is_some() {
        parts = words;
    }
    if parts.len() != 3 {
        return None;
    }
    let mi = if matches!(order, DateOrder::Mdy) {
        0
    } else {
        1
    };
    if let Some(m) = month(&parts[mi]) {
        parts[mi] = (m + 1).to_string();
    }
    if parts
        .iter()
        .any(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let yi = if matches!(order, DateOrder::Ymd) {
        0
    } else {
        2
    };
    if parts[yi].len() > 4 || yi == 0 && parts[0].len() != 4 {
        return None;
    }
    let mut year = parts[yi].parse::<i64>().ok()?;
    if year < 100 {
        year += if year < 30 { 2000 } else { 1900 };
    }
    let m = parts[mi].parse::<i64>().ok()?;
    let d = parts[if matches!(order, DateOrder::Dmy) {
        0
    } else if matches!(order, DateOrder::Mdy) {
        1
    } else {
        2
    }]
    .parse::<i64>()
    .ok()?;
    if year < 1900 || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let days = days_from_civil(year, m, d);
    if civil_from_days(days) != (year, m as u32, d as u32) {
        return None;
    }
    Some((days - days_from_civil(1899, 12, 31) + i64::from(year > 1900 || m > 2)) as f64)
}

fn general(text: &str) -> Result<(Value<String>, Option<String>), String> {
    let original = updates::infer(text, false);
    if text.starts_with(['\'', '=']) {
        return Ok(original);
    }
    if matches!(
        text,
        "#NULL!" | "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A"
    ) {
        return Ok((Value::Error(text.into()), None));
    }
    let normalized: String = text
        .chars()
        .map(|c| {
            if c == '−' {
                return '-';
            }
            let point = c as u32;
            let index = DIGITS.partition_point(|&(start, _)| start <= point);
            if index > 0 && point <= DIGITS[index - 1].1 {
                char::from(b'0' + ((point - DIGITS[index - 1].0) % 10) as u8)
            } else {
                c
            }
        })
        .collect();
    if let Some(n) = number(&normalized, '.') {
        return Ok((Value::Number(n), original.1));
    }
    for order in [DateOrder::Ymd, DateOrder::Mdy, DateOrder::Dmy] {
        if let Some(n) = date(text, order) {
            return Ok((Value::Number(n), Some(order.format().into())));
        }
    }
    let source = trim(text);
    let parts: Vec<_> = source.split('/').collect();
    if parts.len() == 2
        && parts
            .iter()
            .all(|s| !s.is_empty() && s.len() <= 2 && s.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err("ssconvert text dates require an explicit clock\n".into());
    }
    let time: Vec<_> = source.split(':').collect();
    if matches!(time.len(), 2 | 3)
        && time
            .iter()
            .all(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit() || b == b'.'))
    {
        if let Some(values) = time
            .iter()
            .map(|s| s.parse::<f64>().ok())
            .collect::<Option<Vec<_>>>()
        {
            let (hour, minute, second) =
                (values[0], values[1], values.get(2).copied().unwrap_or(0.));
            if hour >= 0. && (0. ..60.).contains(&minute) && (0. ..60.).contains(&second) {
                return Ok((
                    Value::Number((hour * 3600. + minute * 60. + second) / 86400.),
                    Some(format!(
                        "{}{}",
                        if hour >= 24. { "[h]" } else { "h" },
                        if time.len() == 3 { ":mm:ss" } else { ":mm" }
                    )),
                ));
            }
        }
    }
    let mixed: Vec<_> = source.split(' ').filter(|s| !s.is_empty()).collect();
    if mixed.len() == 2 {
        let fraction: Vec<_> = mixed[1].split('/').collect();
        if fraction.len() == 2
            && mixed[0]
                .bytes()
                .filter(|&b| b != b'-')
                .chain(fraction.concat().bytes())
                .all(|b| b.is_ascii_digit())
        {
            let whole = mixed[0].parse::<f64>().unwrap_or(f64::NAN);
            let numerator = if fraction[0].is_empty() {
                0.
            } else {
                fraction[0].parse::<f64>().unwrap_or(f64::NAN)
            };
            let denominator = fraction[1].parse::<f64>().unwrap_or(0.);
            if denominator > 0. {
                let n = whole.abs() + numerator / denominator;
                if !n.is_finite() {
                    return Err("Nonfinite workbook number\n".into());
                }
                let places = "?".repeat(fraction[1].len().min(5));
                return Ok((
                    Value::Number(if whole < 0. { -n } else { n }),
                    Some(format!("# {places}/{places}")),
                ));
            }
        }
    }
    Ok(original)
}

struct Column {
    decimal: Option<char>,
    date: Option<DateOrder>,
    format: Option<String>,
}
fn column<'a>(values: impl Iterator<Item = &'a str>) -> Column {
    let mut dates = vec![DateOrder::Dmy, DateOrder::Mdy, DateOrder::Ymd];
    let mut decimals = vec!['.', ','];
    let mut precision = BTreeMap::new();
    let (mut seen_dot, mut seen_comma) = (false, false);
    for value in values {
        if value.is_empty() || value.starts_with(['\'', '=']) {
            continue;
        }
        dates.retain(|&order| date(value, order).is_some());
        let (dot, comma) = (value.find('.'), value.find(','));
        if decimals.len() == 2 {
            if let (Some(dot), Some(comma)) = (dot, comma) {
                decimals.retain(|&c| c == if dot > comma { '.' } else { ',' });
            } else if dot.is_some_and(|i| value[i + 1..].contains('.')) {
                decimals.retain(|&c| c != '.');
            } else if comma.is_some_and(|i| value[i + 1..].contains(',')) {
                decimals.retain(|&c| c != ',');
            }
            seen_dot |= dot.is_some();
            seen_comma |= comma.is_some();
        }
        decimals.retain(|&decimal| {
            let thousand = if decimal == '.' { ',' } else { '.' };
            let prefix: Option<Vec<_>> = value
                .find(thousand)
                .map(|i| value[..i].bytes().filter(u8::is_ascii_digit).collect());
            if number(value, decimal).is_none()
                || prefix
                    .is_some_and(|digits| !digits.iter().any(|&d| d != b'0') || digits.len() > 3)
            {
                return false;
            }
            let count = value.find(decimal).map_or(0, |i| {
                value[i + 1..]
                    .bytes()
                    .take_while(u8::is_ascii_digit)
                    .count()
            }) as i64;
            precision
                .entry(decimal)
                .and_modify(|p| {
                    if *p != count {
                        *p = -2;
                    }
                })
                .or_insert(count);
            true
        });
    }
    if decimals.len() == 2 {
        if !seen_comma {
            decimals.retain(|&c| c != ',');
        } else if !seen_dot {
            decimals.clear();
        }
    }
    let mut result = Column {
        decimal: None,
        date: None,
        format: None,
    };
    if dates.len() == 1 && decimals.is_empty() {
        result.date = Some(dates[0]);
        result.format = Some(dates[0].format().into());
    } else if dates.is_empty() && decimals.len() == 1 {
        let decimal = decimals[0];
        result.decimal = Some(decimal);
        if let Some(&count) = precision.get(&decimal).filter(|&&n| n > 0) {
            result.format = Some(format!(
                "{}{}",
                if if decimal == '.' { seen_comma } else { seen_dot } {
                    "#,##0."
                } else {
                    "0."
                },
                "0".repeat(count as usize)
            ));
        }
    }
    result
}

pub(in super::super) fn read(
    name: &str,
    rows: &[Vec<String>],
    limit: usize,
) -> Result<(Sheet<String>, Workbook), String> {
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    let formats: Vec<_> = (0..width)
        .map(|c| {
            column(
                rows.iter()
                    .skip(usize::from(rows.len() > 1))
                    .filter_map(|row| row.get(c))
                    .map(String::as_str),
            )
        })
        .collect();
    let mut book = Workbook {
        sheet_sizes: vec![(
            rows.len().max(65536).next_power_of_two().min(1_048_576),
            width.max(256).next_power_of_two().min(16_384),
        )],
        ..Workbook::default()
    };
    let mut cells = BTreeMap::new();
    let mut work = limit;
    for (row, values) in rows.iter().enumerate() {
        for (col, text) in values.iter().enumerate().filter(|(_, s)| !s.is_empty()) {
            let mut expression = None;
            if text.starts_with('=') && text.len() > 1 {
                let normalized = formula::expression_text(text, true, &mut work)
                    .map_err(|e| format!("ssconvert: {e}\n"))?;
                if let Some(parsed) = normalized
                    .as_deref()
                    .map(|s| formula::convert(true, s, false, work, true))
                    .transpose()
                    .map_err(|e| format!("ssconvert: {e}\n"))?
                    .flatten()
                    .filter(|p| p.error.is_none() && p.native_diagnostic.is_none())
                {
                    let names = parsed
                        .entry_names(&[name.to_owned()], &book.sheet_sizes, &mut work)
                        .map_err(|e| format!("ssconvert: {e}\n"))?;
                    if names.is_some_and(|names| names.is_empty()) {
                        expression = Some(text[1..].to_owned());
                    }
                }
            }
            let format = &formats[col];
            let (value, inferred) = if expression.is_some() {
                (Value::Empty, None)
            } else if let Some(decimal) = format.decimal.filter(|_| !text.starts_with(['\'', '=']))
            {
                (
                    number(text, decimal).map_or_else(|| Value::Text(text.clone()), Value::Number),
                    None,
                )
            } else if let Some(order) = format.date.filter(|_| !text.starts_with('\'')) {
                if let Some(n) = date(text, order) {
                    (Value::Number(n), None)
                } else {
                    general(text)?
                }
            } else {
                general(text)?
            };
            let format = if expression.is_some() {
                None
            } else {
                format.format.clone().or(inferred.clone())
            };
            book.recalculate |= expression.is_some();
            cells.insert(
                (row, col),
                TypedCell {
                    value: (!matches!(value, Value::Empty)).then_some(value),
                    formula: expression,
                    openformula: None,
                    formula_display: None,
                    format,
                    value_format: inferred,
                    style: None,
                    rich_text: None,
                },
            );
        }
    }
    Ok((
        Sheet {
            style_regions: vec![],
            name: name.into(),
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

// Unicode 17.0 decimal-number ranges. See LICENSE.UNICODE.
#[rustfmt::skip]
const DIGITS: &[(u32, u32)] = &[
    (0x30, 0x39), (0x660, 0x669), (0x6f0, 0x6f9), (0x7c0, 0x7c9), (0x966, 0x96f),
    (0x9e6, 0x9ef), (0xa66, 0xa6f), (0xae6, 0xaef), (0xb66, 0xb6f), (0xbe6, 0xbef),
    (0xc66, 0xc6f), (0xce6, 0xcef), (0xd66, 0xd6f), (0xde6, 0xdef), (0xe50, 0xe59),
    (0xed0, 0xed9), (0xf20, 0xf29), (0x1040, 0x1049), (0x1090, 0x1099), (0x17e0, 0x17e9),
    (0x1810, 0x1819), (0x1946, 0x194f), (0x19d0, 0x19d9), (0x1a80, 0x1a89), (0x1a90, 0x1a99),
    (0x1b50, 0x1b59), (0x1bb0, 0x1bb9), (0x1c40, 0x1c49), (0x1c50, 0x1c59), (0xa620, 0xa629),
    (0xa8d0, 0xa8d9), (0xa900, 0xa909), (0xa9d0, 0xa9d9), (0xa9f0, 0xa9f9), (0xaa50, 0xaa59),
    (0xabf0, 0xabf9), (0xff10, 0xff19), (0x104a0, 0x104a9), (0x10d30, 0x10d39), (0x10d40, 0x10d49),
    (0x11066, 0x1106f), (0x110f0, 0x110f9), (0x11136, 0x1113f), (0x111d0, 0x111d9), (0x112f0, 0x112f9),
    (0x11450, 0x11459), (0x114d0, 0x114d9), (0x11650, 0x11659), (0x116c0, 0x116c9), (0x116d0, 0x116e3),
    (0x11730, 0x11739), (0x118e0, 0x118e9), (0x11950, 0x11959), (0x11bf0, 0x11bf9), (0x11c50, 0x11c59),
    (0x11d50, 0x11d59), (0x11da0, 0x11da9), (0x11de0, 0x11de9), (0x11f50, 0x11f59), (0x16130, 0x16139),
    (0x16a60, 0x16a69), (0x16ac0, 0x16ac9), (0x16b50, 0x16b59), (0x16d70, 0x16d79), (0x1ccf0, 0x1ccf9),
    (0x1d7ce, 0x1d7ff), (0x1e140, 0x1e149), (0x1e2f0, 0x1e2f9), (0x1e4f0, 0x1e4f9), (0x1e5f1, 0x1e5fa),
    (0x1e950, 0x1e959), (0x1fbf0, 0x1fbf9),
];

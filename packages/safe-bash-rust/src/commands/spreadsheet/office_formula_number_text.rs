// Contracts adapted from IronCalc f936620 text/string_format.rs (MIT,
// LICENSE.IronCalc) and Univer 4767b3b text/{numbervalue,fixed,dollar}
// (Apache-2.0, LICENSE.Univer). Decimal rendering reuses Poe Code's formatter.
use super::super::number_format;
use super::{Value, lookup::number};
use std::borrow::Cow;

fn first(value: &Value) -> Option<char> {
    match value {
        Value::Text(s) | Value::UninternedText(s) => s.chars().next(),
        Value::Blank | Value::Empty => None,
        Value::Bool(b) => Some(if *b { 'T' } else { 'F' }),
        _ => value.text().chars().next(),
    }
}

pub(super) fn calculate(
    name: &str,
    args: &[&Value],
    date1904: bool,
    decimals_omitted: bool,
    work: &mut usize,
) -> Option<Value> {
    for value in args {
        if let Value::Error(e) | Value::LiteralError(e) = value {
            return Some(Value::Error(e));
        }
    }
    if name == "VALUE" {
        return Some(match args[0] {
            Value::Number(n) => Value::Number(*n),
            Value::Blank | Value::Empty => Value::Number(0.),
            Value::Text(text) | Value::UninternedText(text) => {
                *work = work.checked_sub(text.len().checked_mul(4)?.checked_add(128)?)?;
                parse_value(text, date1904).map_or(Value::Error("#VALUE!"), Value::Number)
            }
            _ => Value::Error("#VALUE!"),
        });
    }
    if name == "NUMBERVALUE" {
        let decimal = if let Some(v) = args.get(1) {
            first(v)
        } else {
            Some('.')
        };
        let group = if let Some(v) = args.get(2) {
            first(v)
        } else {
            Some(',')
        };
        let Some(decimal) = decimal else {
            return Some(Value::Error("#VALUE!"));
        };
        if group == Some(decimal) {
            return Some(Value::Error("#VALUE!"));
        }
        let source = match args[0] {
            Value::Bool(b) => Cow::Borrowed(if *b { "TRUE" } else { "FALSE" }),
            Value::Text(s) | Value::UninternedText(s) => Cow::Borrowed(s.as_str()),
            _ => Cow::Owned(args[0].text()),
        };
        *work = work.checked_sub(source.len().checked_mul(4)?.checked_add(128)?)?;
        let space = |c: char| matches!(c, ' ' | '\t'..='\r');
        let normalized: String = if group.is_some() {
            source.chars().filter(|&c| !space(c)).collect()
        } else {
            source.trim_matches(space).into()
        };
        let mut body = normalized.as_str();
        let mut percents = 0;
        while let Some(rest) = body.strip_suffix('%') {
            body = rest.trim_end_matches(space);
            percents += 1;
        }
        if body.is_empty() {
            return Some(Value::Number(0.));
        }
        let mut cleaned = String::with_capacity(body.len());
        let mut decimal_seen = false;
        for c in body.chars() {
            if c == decimal {
                if decimal_seen {
                    return Some(Value::Error("#VALUE!"));
                }
                decimal_seen = true;
                cleaned.push('.');
            } else if group == Some(c) {
                if decimal_seen {
                    return Some(Value::Error("#VALUE!"));
                }
            } else {
                cleaned.push(c);
            }
        }
        let Some(mut value) = cleaned.parse::<f64>().ok().filter(|v| v.is_finite()) else {
            return Some(Value::Error("#VALUE!"));
        };
        for _ in 0..percents {
            value /= 100.;
        }
        return Some(Value::Number(value));
    }
    let mut values = [0., 2., 0.];
    for (i, v) in args.iter().enumerate() {
        if i == 1 && decimals_omitted {
            continue;
        }
        values[i] = match v {
            Value::Text(s) | Value::UninternedText(s) => {
                if i != 2
                    && (s.trim().eq_ignore_ascii_case("true")
                        || s.trim().eq_ignore_ascii_case("false"))
                {
                    None
                } else {
                    number::parse(s, date1904)
                }
            }
            _ => v.numeric(),
        }
        .filter(|v| v.is_finite())
        .unwrap_or(f64::NAN);
        if values[i].is_nan() {
            return Some(Value::Error("#VALUE!"));
        }
    }
    let [value, places, no_commas] = values;
    let places = places.trunc();
    if places > 127. {
        return Some(Value::Error("#VALUE!"));
    }
    let precision = places.max(0.) as usize;
    *work = work.checked_sub(1024 + precision * 4)?;
    let pattern = if precision == 0 {
        "0".into()
    } else {
        format!("0.{}", "0".repeat(precision))
    };
    let mut digits = number_format::text(
        if places < 0. {
            value.abs().trunc()
        } else {
            value.abs()
        },
        &pattern,
        date1904,
        number_format::Mode::Display,
        work,
    )?;
    if places < 0. {
        // Round the decimal string before grouping. There is no integer cast
        // or floating-point multiply, including a carry beyond f64::MAX.
        let cut = (-places).min(310.) as usize;
        if cut > digits.len() {
            digits = "0".into();
        } else {
            let keep = digits.len() - cut;
            let up = digits.as_bytes()[keep] >= b'5';
            let mut bytes = digits.into_bytes();
            bytes.truncate(keep);
            if up {
                let mut carry = true;
                for digit in bytes.iter_mut().rev() {
                    if *digit == b'9' {
                        *digit = b'0';
                    } else {
                        *digit += 1;
                        carry = false;
                        break;
                    }
                }
                if carry {
                    bytes.insert(0, b'1');
                }
            }
            if bytes.is_empty() {
                digits = "0".into();
            } else {
                bytes.extend(std::iter::repeat_n(b'0', cut));
                digits = String::from_utf8(bytes).ok()?;
            }
        }
    }
    let grouping = name == "DOLLAR" || no_commas == 0.;
    let integer = digits.find('.').unwrap_or(digits.len());
    let size = digits.len()
        + if grouping {
            integer.saturating_sub(1) / 3
        } else {
            0
        }
        + 3;
    *work = work.checked_sub(size)?;
    let mut result = String::with_capacity(size);
    let negative = value < 0.;
    if name == "DOLLAR" {
        if negative {
            result.push('(');
        }
        result.push('$');
    } else if negative {
        result.push('-');
    }
    for (i, c) in digits.char_indices() {
        if grouping && i > 0 && i < integer && (integer - i) % 3 == 0 {
            result.push(',');
        }
        result.push(c);
    }
    if name == "DOLLAR" && negative {
        result.push(')');
    }
    Some(Value::Text(result))
}

// VALUE follows IronCalc's formatted-number rules and Univer's accounting
// negatives. Reuse the editor's date parser so dates keep the workbook epoch
// and the same month-first convention as DATEVALUE; XLSX has no author locale.
fn parse_value(source: &str, date1904: bool) -> Option<f64> {
    let text = source.trim();
    let accounting = text.starts_with('(') && text.ends_with(')');
    let mut body = if accounting {
        text[1..text.len() - 1].trim()
    } else {
        text
    };
    let mut scale = if accounting { -1. } else { 1. };
    let mut decorated = accounting;
    if let Some(rest) = body.strip_suffix('%') {
        body = rest.trim_end();
        scale /= 100.;
        decorated = true;
    } else {
        // A sign can precede or follow a currency, but cannot occur twice.
        for currency in ["$", "€"] {
            if let Some(rest) = body
                .strip_prefix('-')
                .and_then(|s| s.strip_prefix(currency))
            {
                if accounting || rest.trim_start().starts_with(['+', '-']) {
                    return None;
                }
                scale = -scale;
                body = rest.trim_start();
                decorated = true;
                break;
            }
            if let Some(rest) = body
                .strip_prefix(currency)
                .or_else(|| body.strip_suffix(currency))
            {
                body = rest.trim();
                decorated = true;
                break;
            }
        }
    }
    if accounting && body.starts_with(['+', '-']) {
        return None;
    }
    let unsigned = body.strip_prefix(['+', '-']).unwrap_or(body);
    let integer = unsigned.split(['.', 'e', 'E']).next()?;
    let mut groups = integer.split(',');
    let first = groups.next()?;
    let grouped = integer.contains(',');
    let valid_groups = !grouped
        || (!first.is_empty()
            && first.len() <= 3
            && first.bytes().all(|b| b.is_ascii_digit())
            && groups.all(|g| g.len() == 3 && g.bytes().all(|b| b.is_ascii_digit())));
    let suffix = &unsigned[integer.len()..];
    if valid_groups
        && !suffix.contains(',')
        && body
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'+' | b'-' | b'.' | b'e' | b'E' | b','))
    {
        let normalized = if grouped {
            Cow::Owned(body.replace(',', ""))
        } else {
            Cow::Borrowed(body)
        };
        if let Ok(number) = normalized.parse::<f64>() {
            return number
                .is_finite()
                .then_some(number * scale)
                .filter(|n| n.is_finite());
        }
    }
    if decorated {
        return None;
    }
    super::date_text::parse(text, date1904).map(|(day, fraction)| day as f64 + fraction)
}

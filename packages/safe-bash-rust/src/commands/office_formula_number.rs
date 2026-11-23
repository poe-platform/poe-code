use super::super::decimal;
use crate::commands::coreutils::{civil_from_days, days_from_civil};

pub(in super::super) fn parse_production(source: &str, date1904: bool) -> Option<f64> {
    if source.eq_ignore_ascii_case("true") {
        return Some(1.);
    }
    if source.eq_ignore_ascii_case("false") {
        return Some(0.);
    }
    let mut text = source.trim();
    let mut sign = 1.;
    if let Some(inner) = text.strip_prefix('(').and_then(|s| s.strip_suffix(')')) {
        sign = -1.;
        text = inner.trim();
    }
    if let Some(rest) = text.strip_prefix('$') {
        text = rest.trim();
    }
    let mut parts = text.split('.');
    let integer = parts.next()?;
    let fraction = parts.next();
    if parts.next().is_some() {
        return temporal(source, date1904, true, true);
    }
    let groups: Vec<_> = integer.split(',').collect();
    if groups.len() > 1 && (groups[0].len() > 4 || groups[1..].iter().any(|s| s.len() != 3)) {
        return None;
    }
    let mut number = groups.join("");
    if let Some(fraction) = fraction {
        number.push('.');
        number.push_str(fraction);
    }
    let number = number.trim();
    let (number, scale) = number
        .strip_suffix('%')
        .map_or((number, 1.), |n| (n.trim(), 0.01));
    decimal(number)
        .map(|n| n * scale * sign)
        .filter(|n| n.is_finite())
        .or_else(|| temporal(source, date1904, true, true))
}

// C-locale format matching used by typed numeric function arguments.
// It is intentionally separate from INDEX's plain numeric coercion.
pub(in super::super) fn parse(source: &str, date1904: bool) -> Option<f64> {
    if source.encode_utf16().take(309).count() > 308 {
        return None;
    }
    let source = source.trim();
    if source.eq_ignore_ascii_case("true") {
        return Some(1.);
    }
    if source.eq_ignore_ascii_case("false") {
        return Some(0.);
    }
    let mut text = source.trim();
    let mut sign = 1.;
    if let Some(inner) = text.strip_prefix('(').and_then(|s| s.strip_suffix(')')) {
        sign = -1.;
        text = inner.trim();
    }
    if let Some(rest) = text.strip_prefix('$') {
        text = rest.trim();
    }
    let mut parts = text.split('.');
    let integer = parts.next()?;
    let fraction = parts.next();
    if parts.next().is_some() {
        return temporal(source, date1904, true, false);
    }
    let groups: Vec<_> = integer.split(',').collect();
    if groups.len() > 1 && (groups[0].len() > 4 || groups[1..].iter().any(|s| s.len() != 3)) {
        return None;
    }
    let mut number = groups.join("");
    if let Some(fraction) = fraction {
        number.push('.');
        number.push_str(fraction);
    }
    let number = number.trim();
    let (number, scale) = number
        .strip_suffix('%')
        .map_or((number, 1.), |n| (n.trim(), 0.01));
    let scientific = number.contains(['e', 'E']);
    if scientific && scale != 1. {
        return None;
    }
    if let Some(n) = decimal(number).map(|n| n * scale).filter(|n| n.is_finite()) {
        return if n.is_subnormal() {
            scientific.then_some(0.)
        } else {
            Some(n * sign)
        };
    }
    if scientific && number.parse::<f64>().is_ok_and(|n| n.is_infinite()) {
        return Some(f64::MAX);
    }
    temporal(source, date1904, true, false)
}
fn digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}
fn temporal(source: &str, date1904: bool, date_allowed: bool, production: bool) -> Option<f64> {
    let mut text = source.trim();
    let mut position = 0;
    let mut parts = Vec::new();
    for index in 0..3 {
        let start = position;
        while text
            .as_bytes()
            .get(position)
            .is_some_and(u8::is_ascii_digit)
        {
            position += 1;
        }
        parts.push(&text[start..position]);
        if index < 2 {
            if text
                .as_bytes()
                .get(position)
                .is_some_and(|b| matches!(b, b'-' | b'/') || production && *b == b'.')
            {
                position += 1;
            } else {
                break;
            }
        }
    }
    if date_allowed && parts.len() == 3 && parts.iter().all(|s| digits(s)) {
        if !production
            && text.as_bytes()[parts[0].len()]
                != text.as_bytes()[parts[0].len() + parts[1].len() + 1]
        {
            return None;
        }
        let year_first = parts[0].len() == 4;
        let year_text = parts[if year_first { 0 } else { 2 }];
        let month_text = parts[if year_first { 1 } else { 0 }];
        let day_text = parts[if year_first { 2 } else { 1 }];
        if year_text.len() > 4 || month_text.len() > 2 || day_text.len() > 2 {
            return None;
        }
        let mut year: i64 = year_text.parse().ok()?;
        if year_first && year < 1582 {
            return None;
        }
        if year <= 29 {
            year += 2000;
        } else if year <= 99 {
            year += 1900;
        }
        let month: i64 = month_text.parse().ok()?;
        let day: i64 = day_text.parse().ok()?;
        if !(1582..=9999).contains(&year) || !(1..=12).contains(&month) || !(1..=31).contains(&day)
        {
            return None;
        }
        let days = days_from_civil(year, month, day);
        if civil_from_days(days) != (year, month as u32, day as u32) {
            return None;
        }
        let mut serial = (days
            - if date1904 {
                days_from_civil(1904, 1, 1)
            } else {
                days_from_civil(1899, 12, 30)
            }) as f64;
        if production && !date1904 && serial < 61. {
            serial -= 1.;
        }
        let rest = &text[position..];
        if !rest.is_empty() {
            let iso = year_first && text.as_bytes()[parts[0].len()] == b'-';
            let rest = if production {
                rest.trim()
            } else if iso && rest.starts_with(['T', 't']) {
                &rest[1..]
            } else if iso {
                rest.trim().strip_prefix('-').unwrap_or(rest.trim()).trim()
            } else {
                rest.trim()
            };
            serial += temporal(rest, date1904, false, production)?;
        }
        return Some(serial);
    }
    let lower = text.to_lowercase();
    let meridiem = if lower.ends_with("am") {
        Some(false)
    } else if lower.ends_with("pm") {
        Some(true)
    } else {
        None
    };
    if !date_allowed && text.starts_with(['-', '+', '−']) {
        return None;
    }
    let mut sign = 1.;
    if meridiem.is_some() {
        text = text[..text.len() - 2].trim();
    }
    if !production || meridiem.is_none() {
        if let Some(rest) = text.strip_prefix('+') {
            text = rest;
        } else if let Some(rest) = text.strip_prefix('-').or_else(|| text.strip_prefix('−')) {
            sign = -1.;
            text = rest;
        }
    }
    let mut parts: Vec<_> = text
        .split(':')
        .map(|s| if production { s } else { s.trim() })
        .collect();
    if production && !date_allowed && meridiem.is_none() && parts.len() == 1 {
        let clock = text.split('.').next()?;
        if matches!(clock.len(), 4 | 6) && digits(clock) {
            parts = if clock.len() == 6 {
                vec![&text[..2], &text[2..4], &text[4..]]
            } else {
                vec![&text[..2], &text[2..]]
            };
        }
    }
    if !production && !date_allowed && parts.len() < 2 {
        return None;
    }
    let fractional = parts
        .last()?
        .split_once('.')
        .is_some_and(|(_, s)| production || !s.is_empty());
    if meridiem.is_some() && fractional && parts.len() < if production { 3 } else { 2 } {
        return None;
    }
    if parts.len() > 3 || parts.len() < 2 && meridiem.is_none() && !fractional {
        return None;
    }
    for (i, part) in parts.iter().enumerate() {
        if i + 1 == parts.len() && part.contains('.') {
            let (first, last) = part.split_once('.')?;
            if !digits(first) || !last.is_empty() && !digits(last) {
                return None;
            }
        } else if !digits(part) {
            return None;
        }
        if !production {
            let integer = part.split('.').next()?;
            let n = integer.parse::<i32>().ok()?;
            if n == 0 && integer != "0" && integer != "00" {
                return None;
            }
        }
    }
    let values: Vec<f64> = parts
        .iter()
        .map(|s| s.parse().ok())
        .collect::<Option<_>>()?;
    let (mut hour, minute, second) = if values.len() == 3 {
        (values[0], values[1], values[2])
    } else if values.len() == 1 && fractional && meridiem.is_none() {
        (0., 0., values[0])
    } else if fractional && (!production || meridiem.is_none()) {
        (0., values[0], values[1])
    } else {
        (values[0], values.get(1).copied().unwrap_or(0.), 0.)
    };
    let duration = hour == 0. && meridiem.is_none();
    if let Some(pm) = meridiem {
        if !(if production { 1. } else { 0. }..=12.).contains(&hour) {
            return None;
        }
        hour = hour % 12. + if pm { 12. } else { 0. };
    }
    if production {
        return (hour.is_finite()
            && (minute < 60. || fractional && parts.len() == 2)
            && second < 60.
            && (date_allowed || hour < 24. && minute < 60.))
            .then_some(sign * (hour * 3600. + minute * 60. + second) / 86400.);
    }
    if minute >= 60. && !duration
        || second >= 60.
            && !(duration && minute == 0. || hour == 23. && minute == 59. && second.trunc() == 60.)
    {
        return None;
    }
    Some(sign * (hour * 3600. + minute * 60. + second) / 86400.)
}

#[cfg(test)]
mod tests {
    use super::parse;
    use crate::commands::structured::{JVal, parse_json_stream};

    #[test]
    fn typed_numbers_match_native_format_conversion() {
        let fixture = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-ods-numbers-native.json"
        ))
        .unwrap()
        .remove(0);
        let JVal::Object(fields) = fixture else {
            panic!("fixture")
        };
        let JVal::Array(numbers) = &fields.iter().find(|(k, _)| k == "numbers").unwrap().1 else {
            panic!("numbers")
        };
        let mut failures = Vec::new();
        for number in numbers {
            let JVal::Object(fields) = number else {
                panic!("number")
            };
            let field = |key| &fields.iter().find(|(k, _)| k == key).unwrap().1;
            let JVal::Str(source) = field("source") else {
                panic!("source")
            };
            let actual = parse(source, matches!(field("date1904"), JVal::Bool(true)));
            let same = match (actual, field("value")) {
                (None, JVal::Null) => true,
                (Some(a), JVal::Number(e, _)) if *e == 0. => a == 0.,
                (Some(a), JVal::Number(e, _)) => (a - e).abs() <= e.abs() * 1e-14,
                _ => false,
            };
            if !same {
                failures.push(format!("{source:?}: {actual:?} != {:?}", field("value")));
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }
}

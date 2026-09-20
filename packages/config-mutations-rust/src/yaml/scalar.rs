use super::syntax::{
    parser::Tag,
    scanner::{Marker, TScalarStyle},
};
pub(super) fn is_core_string(text: &str) -> bool {
    !matches!(
        text,
        "" | "~"
            | "null"
            | "Null"
            | "NULL"
            | "true"
            | "True"
            | "TRUE"
            | "false"
            | "False"
            | "FALSE"
    ) && numeric(text).is_none()
}
use super::{Error, error, units};
use crate::{
    temporal::{self, Temporal},
    value::Value,
};
fn numeric11(text: &str) -> Option<f64> {
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    let sign = if text.starts_with('-') { -1.0 } else { 1.0 };
    for (prefix, radix) in [("0b", 2), ("0x", 16), ("0", 8)] {
        if let Some(digits) = unsigned.strip_prefix(prefix)
            && !digits.is_empty()
            && digits.chars().all(|ch| ch == '_' || ch.is_digit(radix))
        {
            if digits.chars().all(|ch| ch == '_') {
                return Some(f64::NAN);
            }
            let mut value = 0.0;
            for ch in digits.chars().filter(|ch| *ch != '_') {
                value = value * f64::from(radix) + f64::from(ch.to_digit(radix)?);
            }
            return Some(sign * value);
        }
    }
    if unsigned.contains(':') {
        let mut parts = unsigned.split(':');
        let first = parts.next()?;
        if !first.starts_with(|ch: char| ch.is_ascii_digit())
            || !first.chars().all(|ch| ch.is_ascii_digit() || ch == '_')
        {
            return None;
        }
        let mut value = first.replace('_', "").parse::<f64>().ok()?;
        let rest: Vec<_> = parts.collect();
        for (index, part) in rest.iter().enumerate() {
            let (integer, fraction) = part
                .split_once('.')
                .map_or((*part, None), |(a, b)| (a, Some(b)));
            if integer.is_empty()
                || integer.len() > 2
                || !integer.chars().all(|ch| ch.is_ascii_digit())
                || integer.parse::<u8>().ok()? > 59
            {
                return None;
            }
            if let Some(fraction) = fraction
                && (index != rest.len() - 1
                    || !fraction.chars().all(|ch| ch.is_ascii_digit() || ch == '_'))
            {
                return None;
            }
            value = value * 60.0 + part.replace('_', "").parse::<f64>().ok()?;
        }
        return Some(sign * value);
    }
    if unsigned.starts_with("0o") {
        return None;
    }
    let clean = text.replace('_', "");
    let mantissa = clean.strip_prefix(['+', '-']).unwrap_or(&clean);
    if mantissa == "." {
        return Some(f64::NAN);
    }
    if let Some((base, exp)) = mantissa.split_once(['e', 'E'])
        && matches!(base, "" | ".")
    {
        let exp = exp.strip_prefix(['+', '-']).unwrap_or(exp);
        if !exp.is_empty() && exp.chars().all(|ch| ch.is_ascii_digit()) {
            return Some(f64::NAN);
        }
    }
    if text.contains('_') {
        let mantissa = text.split(['e', 'E']).next()?;
        if !mantissa
            .strip_prefix(['+', '-'])
            .unwrap_or(mantissa)
            .starts_with(|ch: char| ch.is_ascii_digit() || ch == '.')
        {
            return None;
        }
        if text
            .split(['e', 'E'])
            .skip(1)
            .any(|part| part.contains('_'))
        {
            return None;
        }
    }
    numeric(&text.replace('_', ""))
}
fn timestamp(text: &str) -> Option<Temporal> {
    let bytes = text.as_bytes();
    let mut at = 0;
    fn digits(bytes: &[u8], at: &mut usize, min: usize, max: usize) -> Option<i64> {
        let start = *at;
        let mut value = 0;
        while *at < bytes.len() && *at - start < max && bytes[*at].is_ascii_digit() {
            value = value * 10 + i64::from(bytes[*at] - b'0');
            *at += 1;
        }
        (*at - start >= min).then_some(value)
    }
    fn take(bytes: &[u8], at: &mut usize, ch: u8) -> Option<()> {
        if bytes.get(*at) != Some(&ch) {
            return None;
        }
        *at += 1;
        Some(())
    }
    let mut year = digits(bytes, &mut at, 4, 4)?;
    take(bytes, &mut at, b'-')?;
    let month = digits(bytes, &mut at, 1, 2)?;
    take(bytes, &mut at, b'-')?;
    let day = digits(bytes, &mut at, 1, 2)?;
    let mut hour = 0;
    let mut minute = 0;
    let mut second = 0;
    let mut millis = 0;
    let mut zone = 0;
    if at < bytes.len() {
        if matches!(bytes.get(at), Some(b't' | b'T')) {
            at += 1;
        } else {
            let start = at;
            while matches!(bytes.get(at), Some(b' ' | b'\t')) {
                at += 1;
            }
            if start == at {
                return None;
            }
        }
        hour = digits(bytes, &mut at, 1, 2)?;
        take(bytes, &mut at, b':')?;
        minute = digits(bytes, &mut at, 1, 2)?;
        take(bytes, &mut at, b':')?;
        second = digits(bytes, &mut at, 1, 2)?;
        if bytes.get(at) == Some(&b'.') {
            at += 1;
            let start = at;
            let mut width = 0;
            while bytes.get(at).is_some_and(u8::is_ascii_digit) {
                if width < 3 {
                    millis = millis * 10 + i64::from(bytes[at] - b'0');
                    width += 1;
                }
                at += 1;
            }
            if start == at {
                return None;
            }
            for _ in width..3 {
                millis *= 10;
            }
        }
        while matches!(bytes.get(at), Some(b' ' | b'\t')) {
            at += 1;
        }
        if bytes.get(at) == Some(&b'Z') {
            at += 1;
        } else if matches!(bytes.get(at), Some(b'+' | b'-')) {
            let sign = if bytes[at] == b'-' { -1 } else { 1 };
            at += 1;
            let start = at;
            let offset = digits(bytes, &mut at, 1, 2)?;
            if at - start == 2 && offset > 29 {
                return None;
            }
            zone = offset;
            if bytes.get(at) == Some(&b':') {
                at += 1;
                zone = zone * 60 + digits(bytes, &mut at, 2, 2)?;
            }
            if zone < 30 {
                zone *= 60;
            }
            zone *= sign;
        }
    }
    if at != bytes.len() {
        return None;
    }
    if year <= 99 {
        year += 1900;
    }
    let zero_month = month - 1;
    year += zero_month.div_euclid(12);
    let month = zero_month.rem_euclid(12) + 1;
    Some(Temporal {
        epoch_millis: temporal::civil_days(year, month, day) * 86400000
            + hour * 3600000
            + minute * 60000
            + second * 1000
            + millis
            - zone * 60000,
        has_date: true,
        has_time: true,
        offset: Some(units("Z")),
    })
}
fn binary(text: &str) -> Value {
    let mut bits = 0u32;
    let mut width = 0;
    let mut output = vec![];
    for ch in text.chars() {
        let digit = match ch {
            'A'..='Z' => ch as u32 - 65,
            'a'..='z' => ch as u32 - 97 + 26,
            '0'..='9' => ch as u32 - 48 + 52,
            '+' | '-' => 62,
            '/' | '_' => 63,
            '=' => break,
            _ => continue,
        };
        bits = (bits << 6) | digit;
        width += 6;
        if width >= 8 {
            width -= 8;
            output.push((
                units(&output.len().to_string()),
                Value::Number(f64::from((bits >> width) & 255)),
            ));
        }
    }
    Value::Object(output)
}
pub(super) fn resolve(
    text: &str,
    style: TScalarStyle,
    tag: Option<&Tag>,
    mark: Marker,
    yaml11: bool,
) -> Result<Value, Error> {
    let tag = tag.map(|tag| {
        let mut name = tag.handle.clone();
        name.extend_from_slice(&tag.suffix);
        String::from_utf16_lossy(&name)
    });
    let kind = tag
        .as_deref()
        .and_then(|tag| tag.strip_prefix("tag:yaml.org,2002:"));
    if kind == Some("merge") {
        return Ok(Value::Symbol(units("<<")));
    }
    if kind == Some("timestamp") {
        return timestamp(text)
            .map(Value::Date)
            .ok_or_else(|| error("!!timestamp expects a date, starting with yyyy-mm-dd", mark));
    }
    if kind == Some("binary") {
        return Ok(binary(text));
    }
    let string = || Value::String(units(text));
    if kind == Some("str")
        || tag.is_some() && kind.is_none()
        || tag.is_none() && style != TScalarStyle::Plain
    {
        return Ok(string());
    }
    if matches!(text, "" | "~" | "null" | "Null" | "NULL") && matches!(kind, None | Some("null")) {
        return Ok(Value::Null);
    }
    let boolean = match text {
        "true" | "True" | "TRUE" => Some(true),
        "false" | "False" | "FALSE" => Some(false),
        "Y" | "y" | "Yes" | "yes" | "YES" | "On" | "on" | "ON" if yaml11 => Some(true),
        "N" | "n" | "No" | "no" | "NO" | "Off" | "off" | "OFF" if yaml11 => Some(false),
        _ => None,
    };
    if matches!(kind, None | Some("bool"))
        && let Some(value) = boolean
    {
        return Ok(Value::Bool(value));
    }
    if matches!(kind, None | Some("int" | "float"))
        && let Some(value) = if yaml11 {
            numeric11(text)
        } else {
            numeric(text)
        }
    {
        let float = text.contains(['.', 'e', 'E'])
            && !text
                .strip_prefix(['+', '-'])
                .unwrap_or(text)
                .starts_with("0x");
        if kind.is_none() || kind == Some(if float { "float" } else { "int" }) {
            return Ok(Value::Number(value));
        }
    }
    if tag.is_none()
        && yaml11
        && let Some(date) = timestamp(text)
    {
        return Ok(Value::Date(date));
    }
    Ok(string())
}
fn numeric(text: &str) -> Option<f64> {
    if matches!(text, ".nan" | ".NaN" | ".NAN") {
        return Some(f64::NAN);
    }
    let sign = if text.starts_with('-') { -1.0 } else { 1.0 };
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    if matches!(unsigned, ".inf" | ".Inf" | ".INF") {
        return Some(sign * f64::INFINITY);
    }
    for (prefix, radix) in [("0o", 8), ("0x", 16)] {
        if let Some(digits) = text.strip_prefix(prefix) {
            if digits.is_empty() {
                return None;
            }
            let mut value = 0.0;
            for ch in digits.chars() {
                value = value * f64::from(radix) + f64::from(ch.to_digit(radix)?);
            }
            return Some(value);
        }
    }
    let mut before = 0;
    let mut after = 0;
    let mut exponent = false;
    let mut dot = false;
    let mut iter = unsigned.chars().peekable();
    while let Some(ch) = iter.next() {
        match ch {
            '0'..='9' => {
                if dot {
                    after += 1
                } else {
                    before += 1
                }
            }
            '.' if !dot => dot = true,
            'e' | 'E' => {
                exponent = true;
                if matches!(iter.peek(), Some('+' | '-')) {
                    iter.next();
                }
                let mut digits = 0;
                for ch in iter {
                    if !ch.is_ascii_digit() {
                        return None;
                    }
                    digits += 1;
                }
                if digits == 0 {
                    return None;
                }
                break;
            }
            _ => return None,
        }
    }
    if before + after == 0 || (!dot && !exponent && before == 0) {
        return None;
    }
    text.parse().ok()
}

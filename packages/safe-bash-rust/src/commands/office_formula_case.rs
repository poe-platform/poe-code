// C-locale casing follows GLib 2.84.4 guniprop.c, copyright 1999 Tom Tromey
// and 2000 Red Hat, Inc. LGPL-2.1-or-later; see LICENSE.GLIB.
// TRIM and EXACT follow Gnumeric 1.12.61; see LICENSE.GNUMERIC.
use super::{Value, text::rendered};
#[path = "office_formula_string_unicode.rs"]
mod data;

pub(super) fn character(value: &Value) -> Value {
    let n = match value {
        Value::Error(e) | Value::LiteralError(e) => return Value::Error(e),
        Value::Number(n) => *n,
        _ => return Value::Error("#VALUE!"),
    };
    if !(1.0..256.0).contains(&n) {
        return Value::Error("#VALUE!");
    }
    let mut point = n as u32;
    if (128..160).contains(&point) {
        point = [
            0x20ac, 0, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039,
            0x152, 0, 0x17d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc,
            0x2122, 0x161, 0x203a, 0x153, 0, 0x17e, 0x178,
        ][point as usize - 128];
    }
    if point == 0 {
        Value::Error("#VALUE!")
    } else {
        Value::Text(char::from_u32(point).unwrap().to_string())
    }
}

pub(super) fn calculate(name: &str, args: &[&Value], work: &mut usize) -> Option<Value> {
    for value in args {
        if let Value::Error(error) | Value::LiteralError(error) = value {
            return Some(Value::Error(error));
        }
    }
    let left = rendered(args[0]);
    *work = work.checked_sub(left.len())?;
    let left = left.split('\0').next()?;
    if name == "EXACT" {
        let right = rendered(args[1]);
        *work = work.checked_sub(right.len())?;
        let right = right.split('\0').next()?;
        let first = left.bytes().zip(right.bytes()).position(|(a, b)| a != b);
        return Some(Value::Bool(match first {
            None => left.len() == right.len(),
            Some(i) if left.as_bytes()[i].is_ascii() && right.as_bytes()[i].is_ascii() => false,
            _ => normalized(left, work)? == normalized(right, work)?,
        }));
    }
    let source = left;
    if name == "TRIM" {
        let mut result = String::with_capacity(source.len());
        for word in source.split(' ').filter(|word| !word.is_empty()) {
            if !result.is_empty() {
                result.push(' ');
            }
            result.push_str(word);
        }
        return Some(Value::Text(result));
    }
    let uppercase = name == "UPPER";
    let cases = if uppercase { data::UPPER } else { data::LOWER };
    let mut result = String::new();
    let mut chars = source.chars().peekable();
    while let Some(c) = chars.next() {
        if !uppercase && c == 'Σ' {
            result.push(if chars.peek().is_some_and(|&next| property(next, 1)) {
                'σ'
            } else {
                'ς'
            });
        } else if uppercase && c == '\u{345}' {
            while chars.peek().is_some_and(|&next| property(next, 2)) {
                result.push(chars.next()?);
            }
            result.push('Ι');
        } else if let Ok(index) = cases.binary_search_by_key(&(c as u32), |entry| entry.0) {
            result.push_str(cases[index].1);
        } else {
            result.push(c);
        }
    }
    Some(Value::Text(result))
}

fn property(c: char, flag: u8) -> bool {
    let index = data::PROPERTIES.partition_point(|entry| entry.0 <= c as u32);
    index > 0
        && c as u32 <= data::PROPERTIES[index - 1].1
        && data::PROPERTIES[index - 1].2 & flag != 0
}

fn normalized(text: &str, work: &mut usize) -> Option<Vec<char>> {
    let mut points = Vec::new();
    let mut start = 0;
    let mut emit = |c: char| -> Option<()> {
        *work = work.checked_sub(32)?;
        let class = data::CLASSES
            .binary_search_by_key(&(c as u32), |entry| entry.0)
            .map_or(0, |index| data::CLASSES[index].1);
        if class == 0 {
            points[start..].sort_by_key(|&(_, class)| class);
            start = points.len() + 1;
        }
        points.push((c, class));
        Some(())
    };
    for c in text.chars() {
        let point = c as u32;
        if (0xac00..=0xd7a3).contains(&point) {
            let syllable = point - 0xac00;
            emit(char::from_u32(0x1100 + syllable / 588)?)?;
            emit(char::from_u32(0x1161 + syllable % 588 / 28)?)?;
            if syllable % 28 != 0 {
                emit(char::from_u32(0x11a7 + syllable % 28)?)?;
            }
        } else if let Ok(index) = data::DECOMPOSE.binary_search_by_key(&point, |entry| entry.0) {
            for c in data::DECOMPOSE[index].1.chars() {
                emit(c)?;
            }
        } else {
            emit(c)?;
        }
    }
    points[start..].sort_by_key(|&(_, class)| class);
    Some(points.into_iter().map(|(c, _)| c).collect())
}

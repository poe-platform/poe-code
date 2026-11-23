use std::cmp::Ordering;
use std::collections::VecDeque;
#[path = "office_collation_data.rs"]
mod data;

pub(in crate::commands) fn uppercase(text: &str, work: &mut usize) -> Option<String> {
    if text.is_ascii() {
        *work = work.checked_sub(text.len().checked_mul(2)?)?;
        return Some(text.to_ascii_uppercase());
    }
    *work = work.checked_sub(text.len().checked_mul(32)?)?;
    let mut result = String::new();
    for c in text.chars() {
        match data::UPPER.binary_search_by_key(&(c as u32), |entry| entry.0) {
            Ok(i) => result.push_str(data::UPPER[i].1),
            Err(_) => result.push(c),
        }
    }
    Some(result)
}

// Leading and trailing combining classes of the canonical decomposition.
fn class(c: char) -> u16 {
    data::CLASSES
        .binary_search_by_key(&(c as u32), |entry| entry.0)
        .map_or(0, |i| data::CLASSES[i].1)
}

fn element(
    value: u32,
    primary: &mut Vec<u8>,
    secondary: &mut Vec<u8>,
    tertiary: &mut Vec<u8>,
    sensitive: bool,
    work: &mut usize,
) -> Option<()> {
    *work = work.checked_sub(8)?;
    for byte in [(value >> 24) as u8, (value >> 16) as u8] {
        if byte != 0 {
            primary.push(byte);
        }
    }
    if (value >> 8) as u8 != 0 {
        secondary.push((value >> 8) as u8);
    }
    let weight = if value & 192 == 192 {
        value as u8 & 63
    } else {
        value as u8
    };
    if sensitive && weight != 0 {
        tertiary.push(weight);
    }
    Some(())
}

fn scalar(
    c: char,
    primary: &mut Vec<u8>,
    secondary: &mut Vec<u8>,
    tertiary: &mut Vec<u8>,
    sensitive: bool,
    work: &mut usize,
) -> Option<()> {
    *work = work.checked_sub(16)?;
    let point = c as u32;
    let index = data::SPANS.partition_point(|entry| entry.0 <= point);
    if index > 0 && point <= data::SPANS[index - 1].1 {
        let (start, _, offset, length, step) = data::SPANS[index - 1];
        let values = &data::ELEMENTS[offset as usize..offset as usize + length as usize];
        for (i, &value) in values.iter().enumerate() {
            let value = if i + 1 == values.len() {
                (i64::from(value) + i64::from(point - start) * step) as u32
            } else {
                value
            };
            element(value, primary, secondary, tertiary, sensitive, work)?;
        }
    } else {
        // UCA 15.1 unassigned primaries reserve 18 final-byte weights and
        // 254 third-byte weights; assigned scalars are covered by SPANS.
        let point = point + 1;
        let low = 2 + (point % 18) * 14;
        let point = point / 18;
        let third = 2 + point % 254;
        let second = 4 + (point / 254) % 251;
        element(
            ((0xfe00 + second) * 256 + 5) * 256 + 5,
            primary,
            secondary,
            tertiary,
            sensitive,
            work,
        )?;
        element(
            (third * 256 + low) * 65536 + 192,
            primary,
            secondary,
            tertiary,
            sensitive,
            work,
        )?;
    }
    Some(())
}

pub(super) fn key(
    text: &str,
    sensitive: bool,
    work: &mut usize,
) -> Option<(Vec<u8>, Vec<u8>, Vec<u8>)> {
    *work = work.checked_sub(text.len().checked_mul(8)?)?;
    let mut chars: VecDeque<_> = text.chars().collect();
    let (mut primary, mut secondary, mut tertiary) = (Vec::new(), Vec::new(), Vec::new());
    let mut previous_char = None;
    while let Some(&first) = chars.front() {
        *work = work.checked_sub(32)?;
        if let Some(previous) = previous_char
            && let Ok(index) = data::PREFIXES
                .binary_search_by_key(&(previous as u32, first as u32), |entry| (entry.0, entry.1))
        {
            let (_, _, offset, length) = data::PREFIXES[index];
            for &value in &data::ELEMENTS[offset as usize..offset as usize + length as usize] {
                element(
                    value,
                    &mut primary,
                    &mut secondary,
                    &mut tertiary,
                    sensitive,
                    work,
                )?;
            }
            previous_char = chars.pop_front();
            continue;
        }
        let begin =
            data::CONTRACTIONS.partition_point(|entry| entry.0.chars().next() < Some(first));
        let end = data::CONTRACTIONS.partition_point(|entry| entry.0.chars().next() <= Some(first));
        let mut group = &data::CONTRACTIONS[begin..end];
        let (mut cursor, mut prefix, mut previous) = (1, 1, 0);
        let mut skipped = Vec::new();
        let mut matched = None;
        while !group.is_empty() && cursor < chars.len() {
            *work = work.checked_sub(48)?;
            let next = chars[cursor];
            let current = class(next);
            let a = group.partition_point(|entry| entry.0.chars().nth(prefix) < Some(next));
            let b = group.partition_point(|entry| entry.0.chars().nth(prefix) <= Some(next));
            if a < b && (previous == 0 || previous < current >> 8) {
                cursor += 1;
                prefix += 1;
                group = &group[a..b];
                if group[0].0.chars().count() == prefix {
                    matched = Some((group[0], cursor, skipped.len()));
                    group = &group[1..];
                }
            } else {
                if current <= 0xff {
                    break;
                }
                previous = current & 0xff;
                skipped.push(next);
                cursor += 1;
            }
        }
        if let Some(((_, offset, length), cursor, skip_count)) = matched {
            for &value in &data::ELEMENTS[offset as usize..offset as usize + length as usize] {
                element(
                    value,
                    &mut primary,
                    &mut secondary,
                    &mut tertiary,
                    sensitive,
                    work,
                )?;
            }
            previous_char = chars.get(cursor - 1).copied();
            chars.drain(..cursor);
            // Skipped marks can contract with one another or following text.
            // Reuse the same scanner without growing the remaining input.
            for &c in skipped[..skip_count].iter().rev() {
                chars.push_front(c);
            }
        } else {
            scalar(
                first,
                &mut primary,
                &mut secondary,
                &mut tertiary,
                sensitive,
                work,
            )?;
            previous_char = chars.pop_front();
        }
    }
    Some((primary, secondary, tertiary))
}

pub(super) fn compare(
    left: &str,
    right: &str,
    sensitive: bool,
    work: &mut usize,
) -> Option<Ordering> {
    let left = key(left, sensitive, work)?;
    let right = key(right, sensitive, work)?;
    Some(left.cmp(&right))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::structured::{JVal, parse_json_stream};

    #[test]
    fn collation_elements_match_native_icu() {
        let JVal::Object(fixture) =
            parse_json_stream(include_str!("fixtures/soffice-collation-icu.json"))
                .unwrap()
                .remove(0)
        else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "cases").unwrap().1 else {
            panic!("cases")
        };
        for case in cases {
            let JVal::Array(fields) = case else {
                panic!("case")
            };
            let field = |i: usize| match &fields[i] {
                JVal::Str(s) => s.as_str(),
                _ => panic!("text"),
            };
            let actual = key(field(0), true, &mut 1_000_000).unwrap();
            for (index, bytes) in [(1, actual.0), (2, actual.1), (3, actual.2)] {
                let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
                assert_eq!(hex, field(index), "{:?}", field(0));
            }
        }
        let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "comparisons").unwrap().1
        else {
            panic!("comparisons")
        };
        for case in cases {
            let JVal::Array(fields) = case else {
                panic!("case")
            };
            let field = |i: usize| match &fields[i] {
                JVal::Str(s) => s.as_str(),
                _ => panic!("text"),
            };
            for sensitive in [false, true] {
                let expected = field(2 + usize::from(sensitive))
                    .parse::<i32>()
                    .unwrap()
                    .cmp(&0);
                assert_eq!(
                    compare(field(0), field(1), sensitive, &mut 1_000_000).unwrap(),
                    expected,
                    "{:?}, {:?}, sensitive={sensitive}",
                    field(0),
                    field(1)
                );
            }
        }
    }

    #[test]
    fn collation_bounds_discontiguous_search_and_output() {
        let text = format!("ྲ{}ཱྀ", "\u{301}".repeat(1000));
        let mut work = 20_000;
        assert!(key(&text, false, &mut work).is_none());
        assert!(work < 48);
        assert!(key(&text, false, &mut 1_000_000).is_some());
        assert!(uppercase("ﬀ", &mut 32).is_none());
        assert_eq!(uppercase("ﬀ", &mut 96).as_deref(), Some("FF"));
    }
}

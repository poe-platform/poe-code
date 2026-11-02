use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

fn scalar(out: &mut String, value: &str, quoted: bool) {
    if !quoted {
        let token = value.strip_suffix('\n').unwrap_or(value);
        if token.eq_ignore_ascii_case("true") || token.eq_ignore_ascii_case("false") {
            out.push_str(&value.to_ascii_lowercase());
            return;
        }
        let number = token.strip_prefix('-').unwrap_or(token);
        let (mantissa, exponent) = number
            .split_once(['e', 'E'])
            .map_or((number, None), |(m, e)| (m, Some(e)));
        let (integer, fraction) = mantissa
            .split_once('.')
            .map_or((mantissa, None), |(i, f)| (i, Some(f)));
        let digits =
            |s: &str, max| (1..=max).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit());
        if digits(integer, 15)
            && (integer.len() == 1 || !integer.starts_with('0'))
            && fraction.is_none_or(|s| digits(s, 16))
            && exponent.is_none_or(|s| digits(s.strip_prefix(['+', '-']).unwrap_or(s), 3))
        {
            out.push_str(value);
            return;
        }
    }
    out.push('"');
    for c in value.chars() {
        match c {
            '\0' => (),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if c.is_ascii_control() => write!(out, "\\u{:04X}", c as u32).unwrap(),
            c => out.push(c),
        }
    }
    out.push('"');
}

pub(super) fn record(
    file: &str,
    map: &BTreeMap<String, Vec<String>>,
    keys: &[String],
    copies: bool,
    missing: bool,
    quote: bool,
) -> String {
    let mut out = String::from("{\n  \"SourceFile\": ");
    scalar(&mut out, file, true);
    let mut seen = BTreeSet::from(["\"SourceFile\"".to_owned()]);
    let mut field = |name: &str, value: &str, quoted| {
        let mut token = String::new();
        scalar(&mut token, name, true);
        if !seen.insert(token.clone()) {
            return;
        }
        out.push_str(",\n  ");
        out.push_str(&token);
        out.push_str(": ");
        scalar(&mut out, value, quoted);
    };
    for key in keys {
        let Some(values) = map.get(key) else {
            continue;
        };
        let quoted = quote
            || matches!(
                key.as_str(),
                "Artist"
                    | "Copyright"
                    | "Title"
                    | "Author"
                    | "Subject"
                    | "Description"
                    | "ImageDescription"
                    | "Comment"
                    | "UserComment"
                    | "Creator"
                    | "Producer"
                    | "Software"
                    | "Make"
                    | "Model"
                    | "LensModel"
                    | "Keywords"
                    | "ModifyDate"
                    | "DateTimeOriginal"
                    | "CreateDate"
                    | "FileName"
                    | "Directory"
            );
        if copies {
            for (i, value) in values.iter().enumerate() {
                let name = if i + 1 == values.len() {
                    format!(":{key}")
                } else {
                    format!("Copy{}:{key}", i + 1)
                };
                field(&name, value, quoted);
            }
        } else if let Some(value) = values.last() {
            field(key, value, quoted);
        }
    }
    if missing {
        for key in keys.iter().filter(|k| !map.contains_key(*k)) {
            if copies {
                field(&format!(":{key}"), "-", true);
            } else {
                field(key, "-", true);
            }
        }
    }
    out.push_str("\n}");
    out
}

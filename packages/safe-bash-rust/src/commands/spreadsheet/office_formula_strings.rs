use super::{Value, lookup::number, rounding};
use std::borrow::Cow;

// Character mappings and text operations adapted from IronCalc's
// functions/text/{char_code,string_format,common}.rs (MIT, LICENSE.IronCalc,
// f93662006b8fb1c401dc870bbda26c5d60ac6037). The CSV converter deliberately
// substitutes unsupported characters; CODE must reject them instead.
const WINDOWS_1252: [char; 32] = [
    '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}',
    '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}', 'ž', 'Ÿ',
];

// IronCalc number_format::number_to_text: 15 significant digits, with plain
// notation while its unsigned spelling fits 20 characters (21 for complex
// components). Keep digits on the
// stack; the formatted number and final output are each at most 24 ASCII bytes.
pub(super) fn number_to_text(value: f64, width: i32) -> String {
    use std::fmt::Write;
    if !value.is_finite() {
        return value.to_string();
    }
    if value == 0. {
        return "0".into();
    }
    let formatted = format!("{:.14e}", value.abs());
    let (mantissa, exponent) = formatted.split_once('e').unwrap();
    let exponent: i32 = exponent.parse().unwrap();
    let mut buffer = [0u8; 15];
    for (index, digit) in mantissa.bytes().filter(|&b| b != b'.').enumerate() {
        buffer[index] = digit;
    }
    let count = buffer.iter().rposition(|&b| b != b'0').unwrap() + 1;
    let digits = std::str::from_utf8(&buffer[..count]).unwrap();
    let plain_len = if exponent >= 0 {
        if count as i32 <= exponent + 1 {
            exponent + 1
        } else {
            count as i32 + 1
        }
    } else {
        count as i32 - exponent + 1
    };
    let mut result = String::with_capacity(24);
    if value < 0. {
        result.push('-');
    }
    if plain_len > width {
        result.push_str(&digits[..1]);
        if count > 1 {
            result.push('.');
            result.push_str(&digits[1..]);
        }
        write!(
            result,
            "E{}{:02}",
            if exponent < 0 { '-' } else { '+' },
            exponent.unsigned_abs()
        )
        .unwrap();
    } else if exponent < 0 {
        result.push_str("0.");
        result.extend(std::iter::repeat_n('0', (-exponent - 1) as usize));
        result.push_str(digits);
    } else {
        let whole = exponent as usize + 1;
        if count <= whole {
            result.push_str(digits);
            result.extend(std::iter::repeat_n('0', whole - count));
        } else {
            result.push_str(&digits[..whole]);
            result.push('.');
            result.push_str(&digits[whole..]);
        }
    }
    result
}

pub(super) fn string(value: &Value) -> Cow<'_, str> {
    match value {
        Value::Number(n) => Cow::Owned(number_to_text(*n, 20)),
        Value::Bool(true) => Cow::Borrowed("TRUE"),
        Value::Bool(false) => Cow::Borrowed("FALSE"),
        Value::Text(text) | Value::UninternedText(text) => Cow::Borrowed(text),
        value => Cow::Owned(value.text()),
    }
}

// SEARCH's wildcard language follows IronCalc text/common.rs and the unchanged
// FIND_SEARCH.xlsx fixture. A trailing escape matches empty text. Work and memory
// are bounded; two reusable rows avoid recursive wildcard backtracking. Original
// Unicode characters retain their positions even when lowercase expands them.
fn search(pattern: &str, text: &str, work: &mut usize) -> Option<Option<usize>> {
    *work = work.checked_sub(
        pattern
            .len()
            .checked_mul(8)?
            .checked_add(text.len().checked_mul(6)?)?
            .checked_add(2)?,
    )?;
    let mut input = Vec::with_capacity(text.len());
    input.extend(text.chars());
    let mut tokens = Vec::with_capacity(pattern.len());
    let mut chars = pattern.chars();
    while let Some(c) = chars.next() {
        if c == '~' {
            if let Some(c) = chars.next() {
                tokens.push((c, true));
            }
        } else {
            tokens.push((c, false));
        }
    }
    let mut previous = vec![true; input.len() + 1];
    let mut next = vec![false; input.len() + 1];
    for (token, literal) in tokens.into_iter().rev() {
        next[input.len()] = !literal && token == '*' && previous[input.len()];
        for i in (0..input.len()).rev() {
            *work = work.checked_sub(1)?;
            let any = !matches!(input[i], '\n' | '\r' | '\u{2028}' | '\u{2029}');
            next[i] = if !literal && token == '*' {
                previous[i] || any && next[i + 1]
            } else if !literal && token == '?' {
                any && previous[i + 1]
            } else {
                previous[i + 1] && token.to_lowercase().eq(input[i].to_lowercase())
            };
        }
        std::mem::swap(&mut previous, &mut next);
    }
    Some(previous[..input.len()].iter().position(|&matched| matched))
}

// CONCATENATE uses scalar text coercion from IronCalc text/common.rs, with
// broadcasting supplied by the existing editor evaluator. Borrow text inputs.
pub(super) fn concatenate<'a>(
    args: impl Iterator<Item = &'a Value> + Clone,
    work: &mut usize,
) -> Option<Value> {
    for arg in args.clone() {
        if let Value::Error(e) | Value::LiteralError(e) = arg {
            return Some(Value::Error(e));
        }
    }
    let mut output = String::new();
    let mut length = 0usize;
    for arg in args {
        let text = string(arg);
        *work = work.checked_sub(text.len())?;
        length = length.checked_add(text.encode_utf16().count())?;
        if length > 32767 {
            return Some(Value::Error("#VALUE!"));
        }
        output.push_str(&text);
    }
    Some(Value::Text(output))
}

pub(super) fn text(name: &str, args: &[&Value], work: &mut usize) -> Option<Value> {
    for arg in args {
        if let Value::Error(e) | Value::LiteralError(e) = arg {
            return Some(Value::Error(e));
        }
    }
    if matches!(name, "CHAR" | "UNICHAR") {
        let Some(n) = args[0].numeric() else {
            return Some(Value::Error("#VALUE!"));
        };
        let n = n.floor();
        let maximum = if name == "CHAR" {
            255.
        } else {
            0x10ffff as f64
        };
        if !(1. ..=maximum).contains(&n) {
            return Some(Value::Error("#VALUE!"));
        }
        let c = if name == "CHAR" && (128. ..=159.).contains(&n) {
            Some(WINDOWS_1252[n as usize - 128])
        } else {
            char::from_u32(n as u32)
        };
        *work = work.checked_sub(4)?;
        return Some(c.map_or(Value::Error("#VALUE!"), |c| Value::Text(c.to_string())));
    }
    let text = string(args[0]);
    if matches!(name, "ASC" | "DBCS" | "JIS") {
        return super::width::convert(&text, name == "ASC", work);
    }
    if name == "LEN" {
        *work = work.checked_sub(text.len())?;
        return Some(Value::Number(text.chars().count() as f64));
    }
    if matches!(name, "LEFT" | "RIGHT" | "MID") {
        // Excel character positions, distinct from Calc's integer overflow and
        // error-priority rules in calculate(). Never collect a Vec<char>.
        let mut positions = [1usize; 2];
        for (index, arg) in args.iter().enumerate().skip(1) {
            let minimum = if name == "MID" && index == 1 { 1. } else { 0. };
            let Some(n) = arg.numeric().filter(|n| n.is_finite() && *n >= minimum) else {
                return Some(Value::Error("#VALUE!"));
            };
            let offset = usize::from(name == "MID" && index == 1);
            // Huge counts take the remaining text; huge starts return empty.
            // Clamp before casting for the browser's 32-bit address space.
            positions[index - 1] = (n - offset as f64).min(text.len() as f64) as usize;
        }
        *work = work.checked_sub(text.len())?;
        let length = positions[usize::from(name == "MID")];
        let start = match name {
            "RIGHT" => text.chars().count().saturating_sub(length),
            "MID" => positions[0],
            _ => 0,
        };
        let first = text
            .char_indices()
            .nth(start)
            .map_or(text.len(), |(p, _)| p);
        let last = text[first..]
            .char_indices()
            .nth(length)
            .map_or(text.len(), |(p, _)| first + p);
        *work = work.checked_sub(last - first)?;
        return Some(Value::Text(text[first..last].to_owned()));
    }
    if name == "TRIM" {
        // Univer text/trim, PR #8330 (Apache-2.0; LICENSE.Univer), verified
        // against Excel 16.0: trim ASCII and ideographic spaces, preserving
        // the first character of an inner run. Other whitespace stays intact.
        *work = work.checked_sub(text.len())?;
        let characters = || {
            let mut previous_space = false;
            text.trim_matches([' ', '\u{3000}'])
                .chars()
                .filter(move |c| {
                    let space = matches!(c, ' ' | '\u{3000}');
                    let keep = !space || !previous_space;
                    previous_space = space;
                    keep
                })
        };
        let (mut length, mut units) = (0usize, 0usize);
        for c in characters() {
            length = length.checked_add(c.len_utf8())?;
            units = units.checked_add(c.len_utf16())?;
        }
        if units > 32767 {
            return Some(Value::Error("#VALUE!"));
        }
        *work = work.checked_sub(length)?;
        let mut result = String::with_capacity(length);
        for c in characters() {
            result.push(c);
        }
        return Some(Value::Text(result));
    }
    if name == "EXACT" {
        // Value::text already uses Excel's 15-significant-digit number renderer.
        return Some(Value::Bool(text == string(args[1])));
    }
    if matches!(name, "FIND" | "FINDB" | "SEARCH" | "SEARCHB") {
        let within = string(args[1]);
        let start = if args.len() == 3 {
            args[2].numeric()
        } else {
            Some(1.)
        };
        let Some(start) = start.filter(|n| n.is_finite() && *n >= 1.) else {
            return Some(Value::Error("#VALUE!"));
        };
        // Validate before converting to usize (32-bit in Wasm).
        *work = work.checked_sub(within.len())?;
        if start.trunc() > within.chars().count() as f64 {
            return Some(Value::Error("#VALUE!"));
        }
        let start = start as usize - 1;
        let byte = within.char_indices().nth(start)?.0;
        let suffix = &within[byte..];
        let position = if matches!(name, "SEARCH" | "SEARCHB") {
            search(&text, suffix, work)?
        } else {
            *work = work.checked_sub(text.len().checked_add(suffix.len())?)?;
            suffix
                .find(text.as_ref())
                .map(|p| suffix[..p].chars().count())
        };
        return Some(position.map_or(Value::Error("#VALUE!"), |p| {
            Value::Number((start + p + 1) as f64)
        }));
    }
    if name == "SUBSTITUTE" {
        let old = string(args[1]);
        let new = string(args[2]);
        let instance = if args.len() == 4 {
            let Some(n) = args[3].numeric().filter(|n| n.is_finite() && *n >= 1.) else {
                return Some(Value::Error("#VALUE!"));
            };
            Some(n as usize)
        } else {
            None
        };
        *work = work.checked_sub(text.len().checked_add(old.len())?.checked_add(new.len())?)?;
        // Count non-overlapping replacements first, then allocate exactly once.
        let mut selected = None;
        let count = if old.is_empty() {
            0
        } else if let Some(n) = instance {
            selected = text.match_indices(old.as_ref()).nth(n - 1).map(|(p, _)| p);
            usize::from(selected.is_some())
        } else {
            text.matches(old.as_ref()).count()
        };
        let length = text
            .len()
            .checked_sub(old.len().checked_mul(count)?)?
            .checked_add(new.len().checked_mul(count)?)?;
        let units = text
            .encode_utf16()
            .count()
            .checked_sub(old.encode_utf16().count().checked_mul(count)?)?
            .checked_add(new.encode_utf16().count().checked_mul(count)?)?;
        if units > 32767 {
            return Some(Value::Error("#VALUE!"));
        }
        *work = work.checked_sub(length.checked_add(text.len())?)?;
        let mut result = String::with_capacity(length);
        if let Some(p) = selected {
            result.push_str(&text[..p]);
            result.push_str(&new);
            result.push_str(&text[p + old.len()..]);
        } else if count == 0 {
            result.push_str(&text);
        } else {
            let mut last = 0;
            for (p, _) in text.match_indices(old.as_ref()) {
                result.push_str(&text[last..p]);
                result.push_str(&new);
                last = p + old.len();
            }
            result.push_str(&text[last..]);
        }
        return Some(Value::Text(result));
    }
    if name == "ENCODEURL" {
        // IronCalc text/encodeurl.rs and Univer web/encodeurl, with Excel's
        // escaped tilde. Borrow UTF-8 input; bound output before allocation.
        let text = if matches!(args[0], Value::Number(_))
            && let Some((mantissa, exponent)) = text.split_once('E')
        {
            let exponent: i32 = exponent.parse().ok()?;
            Cow::Owned(format!("{mantissa}E{exponent:+}"))
        } else {
            text
        };
        *work = work.checked_sub(text.len())?;
        let unescaped = |b: u8| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_');
        let mut length = 0;
        for b in text.bytes() {
            length += if unescaped(b) { 1 } else { 3 };
            if length > 32766 {
                return Some(Value::Error("#VALUE!"));
            }
        }
        *work = work.checked_sub(length)?;
        let mut result = String::with_capacity(length);
        for b in text.bytes() {
            if unescaped(b) {
                result.push(b as char);
            } else {
                result.push('%');
                result.push(b"0123456789ABCDEF"[(b >> 4) as usize] as char);
                result.push(b"0123456789ABCDEF"[(b & 15) as usize] as char);
            }
        }
        return Some(Value::Text(result));
    }
    if name == "REPT" {
        let Some(count) = args[1].numeric() else {
            return Some(Value::Error("#VALUE!"));
        };
        if !count.is_finite() || count < 0. {
            return Some(Value::Error("#VALUE!"));
        }
        if text.is_empty() || count < 1. {
            return Some(Value::Text(String::new()));
        }
        let units = text.encode_utf16().count();
        if count.trunc() > (32767 / units) as f64 {
            return Some(Value::Error("#VALUE!"));
        }
        let count = count as usize;
        let bytes = text.len().checked_mul(count)?;
        *work = work.checked_sub(bytes)?;
        return Some(Value::Text(text.repeat(count)));
    }
    if matches!(name, "CODE" | "UNICODE") {
        let Some(c) = text.chars().next() else {
            return Some(Value::Error("#VALUE!"));
        };
        let code = c as u32;
        return Some(
            if name == "UNICODE" || matches!(code, 1..=127 | 160..=255) {
                Value::Number(code as f64)
            } else {
                WINDOWS_1252
                    .iter()
                    .position(|&v| v == c)
                    .map_or(Value::Error("#VALUE!"), |i| Value::Number((128 + i) as f64))
            },
        );
    }
    if name == "REPLACE" {
        let (Some(start), Some(count)) = (args[1].numeric(), args[2].numeric()) else {
            return Some(Value::Error("#VALUE!"));
        };
        if !start.is_finite() || !count.is_finite() || start < 1. || count < 0. {
            return Some(Value::Error("#VALUE!"));
        }
        let replacement = string(args[3]);
        // Clamp before casting: usize is 32 bits in Wasm, and huge positions
        // mean append/end-of-text. Walk UTF-8 boundaries without a Vec<char>.
        let start = (start - 1.).min(text.len() as f64) as usize;
        let count = count.min(text.len() as f64) as usize;
        let first = text
            .char_indices()
            .nth(start)
            .map_or(text.len(), |(i, _)| i);
        let last = text[first..]
            .char_indices()
            .nth(count)
            .map_or(text.len(), |(i, _)| first + i);
        let length = first
            .checked_add(replacement.len())?
            .checked_add(text.len() - last)?;
        *work = work.checked_sub(length)?;
        if text[..first].encode_utf16().count()
            + replacement.encode_utf16().count()
            + text[last..].encode_utf16().count()
            > 32767
        {
            return Some(Value::Error("#VALUE!"));
        }
        let mut result = String::with_capacity(length);
        result.push_str(&text[..first]);
        result.push_str(&replacement);
        result.push_str(&text[last..]);
        return Some(Value::Text(result));
    }
    let mut result = String::new();
    let mut capitalize = true;
    let mut length = 0usize;
    for c in text.chars() {
        if name == "CLEAN" && c < ' ' {
            continue;
        }
        // Unicode case mappings can expand one character into several.
        let mut mapped = ['\0'; 3];
        let count = if name == "PROPER" && c.is_alphabetic() {
            let mut count = 0;
            if capitalize {
                for c in c.to_uppercase() {
                    mapped[count] = c;
                    count += 1;
                }
            } else {
                for c in c.to_lowercase() {
                    mapped[count] = c;
                    count += 1;
                }
            }
            capitalize = false;
            count
        } else {
            capitalize = true;
            mapped[0] = c;
            1
        };
        for &c in &mapped[..count] {
            *work = work.checked_sub(c.len_utf8())?;
            length += c.len_utf16();
            if length > 32767 {
                return Some(Value::Error("#VALUE!"));
            }
            result.push(c);
        }
    }
    Some(Value::Text(result))
}

pub(super) fn calculate(name: &str, args: &[&Value], date1904: bool) -> Value {
    let mut positions = [1i32; 2];
    let mut error = None;
    for (index, value) in args.iter().enumerate().skip(1).rev() {
        let number = match value {
            Value::LiteralError(value) => {
                error = Some(*value);
                Some(0.)
            }
            Value::Error(value) => {
                error.get_or_insert(*value);
                Some(0.)
            }
            Value::Text(text) | Value::UninternedText(text) => number::parse(text, date1904),
            _ => value.numeric(),
        };
        let number = number.unwrap_or_else(|| {
            error.get_or_insert("#VALUE!");
            0.
        });
        let number = rounding::approximate(number).floor();
        positions[index - 1] = if (0. ..=i32::MAX as f64).contains(&number) {
            number as i32
        } else {
            error.get_or_insert("Err:502");
            -1
        };
    }
    if matches!(name, "LEFT" | "RIGHT") && positions[0] < 0 {
        return Value::Error(error.unwrap_or("Err:502"));
    }
    match args[0] {
        Value::LiteralError(value) => error = Some(value),
        Value::Error(value) => {
            error.get_or_insert(value);
        }
        _ => {}
    }
    if name == "MID" {
        if positions[0] < 1 || positions[1] < 0 {
            error.get_or_insert("Err:502");
        } else if positions.iter().any(|n| *n > i32::MAX / 8) {
            error.get_or_insert("Err:513");
        }
    }
    if let Some(error) = error {
        return Value::Error(error);
    }
    let text = args[0].text();
    if name == "LEN" {
        return Value::Number(text.chars().count() as f64);
    }
    let length = positions[usize::from(name == "MID")] as usize;
    let start = match name {
        "RIGHT" => text.chars().count().saturating_sub(length),
        "MID" => positions[0] as usize - 1,
        _ => 0,
    };
    Value::Text(text.chars().skip(start).take(length).collect())
}

impl super::Calculation<'_> {
    pub(super) fn concat(
        &mut self,
        args: &[super::Expr],
        pos: super::Coord,
        depth: usize,
    ) -> Option<Value> {
        if args.is_empty() {
            return Some(Value::Error("#VALUE!"));
        }
        let mut output = String::new();
        let mut length = 0usize;
        for arg in args {
            let mut pending = vec![self.eval(arg, pos, depth + 1, true)?];
            while let Some(value) = pending.pop() {
                self.tick(depth)?;
                match value {
                    Value::Single(coord) => pending.push(self.cell(coord, depth + 1)?),
                    Value::Range(a, b) => {
                        self.read_spill_range(a, b)?;
                        // Sparse traversal avoids materializing a whole-column range.
                        self.work = self.work.checked_sub(
                            self.values
                                .len()
                                .checked_add(self.expressions.len())?
                                .checked_mul(32)?,
                        )?;
                        let cells: std::collections::BTreeSet<_> = self
                            .values
                            .keys()
                            .chain(self.expressions.keys())
                            .copied()
                            .filter(|c| {
                                (a.0.min(b.0)..=a.0.max(b.0)).contains(&c.0)
                                    && (a.1.min(b.1)..=a.1.max(b.1)).contains(&c.1)
                                    && (a.2.min(b.2)..=a.2.max(b.2)).contains(&c.2)
                            })
                            .collect();
                        pending.extend(cells.into_iter().rev().map(Value::Single));
                    }
                    Value::Matrix(rows) => {
                        pending.extend(rows.into_iter().rev().flat_map(|row| row.into_iter().rev()))
                    }
                    Value::Set(values) => pending.extend(values.into_iter().rev()),
                    Value::InvalidReference | Value::InvalidRange(..) => {
                        return Some(Value::Error("#REF!"));
                    }
                    Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
                    Value::Blank | Value::Empty => {}
                    value => {
                        let text = if self.dynamic.is_some() {
                            string(&value)
                        } else if let Value::Bool(b) = value {
                            Cow::Borrowed(if b { "TRUE" } else { "FALSE" })
                        } else {
                            Cow::Owned(value.text())
                        };
                        self.work = self.work.checked_sub(text.len())?;
                        length = length.checked_add(text.encode_utf16().count())?;
                        if length > 32767 {
                            return Some(Value::Error("#VALUE!"));
                        }
                        output.push_str(&text);
                    }
                }
            }
        }
        Some(Value::Text(output))
    }
}

#[test]
fn text_output_growth_and_unicode_expansion_obey_limits() {
    let old = Value::Text("a".repeat(32767));
    let empty = Value::Text(String::new());
    let suffix = Value::Text("😀".into());
    let at_end = Value::Number(1e100);
    let zero = Value::Number(0.);
    assert!(matches!(
        text("REPLACE", &[&old, &at_end, &zero, &suffix], &mut 1_000_000),
        Some(Value::Error("#VALUE!"))
    ));
    assert!(
        matches!(text("REPLACE", &[&old, &at_end, &zero, &empty], &mut 1_000_000), Some(Value::Text(s)) if s.len() == 32767)
    );
    let expanding = Value::Text("İ".repeat(32767));
    assert!(matches!(
        text("PROPER", &[&expanding], &mut 1_000_000),
        Some(Value::Error("#VALUE!"))
    ));
    assert!(text("PROPER", &[&expanding], &mut 4).is_none());
    assert!(text("REPLACE", &[&old, &at_end, &zero, &empty], &mut 4).is_none());
}

#[test]
fn url_encoding_checks_budget_before_allocating_output() {
    let input = Value::Text("😀".into());
    assert!(text("ENCODEURL", &[&input], &mut 15).is_none());
    assert!(
        matches!(text("ENCODEURL", &[&input], &mut 16), Some(Value::Text(s)) if s == "%F0%9F%98%80")
    );
    let oversized = Value::Text(" ".repeat(10923));
    assert!(matches!(
        text("ENCODEURL", &[&oversized], &mut 10923),
        Some(Value::Error("#VALUE!"))
    ));
}

#[test]
fn search_bounds_allocations_and_every_wildcard_step() {
    assert!(search("?", "😀", &mut 33).is_none());
    assert_eq!(search("?", "😀", &mut 35), Some(Some(0)));
    let pattern = "a*".repeat(100) + "b";
    let input = "a".repeat(200);
    assert!(search(&pattern, &input, &mut 5000).is_none());
    assert_eq!(search(&pattern, &input, &mut 100_000), Some(None));
    for (pattern, input, expected) in [
        ("x", "İx", Some(1)),
        ("?x", "İx", Some(0)),
        ("?b", "😀b", Some(0)),
        ("B", "ßB", Some(1)),
        ("*c", "abc", Some(0)),
    ] {
        assert_eq!(search(pattern, input, &mut 1000), Some(expected));
    }
    let input = Value::Text("a".repeat(100));
    let old = Value::Text("a".into());
    let new = Value::Text("bb".into());
    assert!(text("SUBSTITUTE", &[&input, &old, &new], &mut 402).is_none());
    assert!(
        matches!(text("SUBSTITUTE", &[&input,&old,&new], &mut 403),Some(Value::Text(s)) if s.len()==200)
    );
}

#[test]
fn character_slices_and_trim_charge_before_allocating() {
    let input = Value::Text("é😀x".into());
    let two = Value::Number(2.);
    let one = Value::Number(1.);
    assert!(text("LEFT", &[&input, &two], &mut 12).is_none());
    assert!(matches!(text("LEFT",&[&input,&two],&mut 13),Some(Value::Text(s)) if s=="é😀"));
    assert!(text("RIGHT", &[&input, &two], &mut 11).is_none());
    assert!(matches!(text("RIGHT",&[&input,&two],&mut 12),Some(Value::Text(s)) if s=="😀x"));
    assert!(text("MID", &[&input, &two, &one], &mut 10).is_none());
    assert!(matches!(text("MID",&[&input,&two,&one],&mut 11),Some(Value::Text(s)) if s=="😀"));
    let spaced = Value::Text(" a  b ".into());
    assert!(text("TRIM", &[&spaced], &mut 8).is_none());
    assert!(matches!(text("TRIM",&[&spaced],&mut 9),Some(Value::Text(s)) if s=="a b"));
    let oversized = Value::Text("a".repeat(32768));
    assert!(matches!(
        text("TRIM", &[&oversized], &mut 32768),
        Some(Value::Error("#VALUE!"))
    ));
}

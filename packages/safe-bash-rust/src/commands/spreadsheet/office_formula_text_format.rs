use super::super::{dates, number_format};
use super::{Value, date_text, lookup::number};
use std::borrow::Cow;

// Coercion/broadcast rules adapt IronCalc functions/text/common.rs and Univer
// functions/text/text/index.ts. Number and date rendering use Poe Code's formatter.
pub(super) fn calculate(
    value: &Value,
    format: &Value,
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    for argument in [value, format] {
        if let Value::Error(error) | Value::LiteralError(error) = argument {
            return Some(Value::Error(error));
        }
    }
    if matches!(format, Value::Bool(_)) {
        return Some(Value::Error("#VALUE!"));
    }
    if let Value::Bool(value) = value {
        return Some(Value::Bool(*value));
    }
    let mut pattern = match format {
        Value::Text(text) | Value::UninternedText(text) => Cow::Borrowed(text.as_str()),
        Value::Blank | Value::Empty => Cow::Borrowed(""),
        _ => Cow::Owned(format.text()),
    };
    *work = work.checked_sub(pattern.len().checked_mul(32)?.checked_add(512)?)?;
    if pattern.encode_utf16().count() > 32767 {
        return Some(Value::Error("#VALUE!"));
    }
    if pattern.contains('Å') {
        let mut normalized = String::new();
        let mut chars = pattern.chars().peekable();
        let mut quoted = false;
        while let Some(c) = chars.next() {
            if c == '\"' {
                quoted = !quoted;
                normalized.push(c);
            } else if c == '\\' && !quoted {
                normalized.push(c);
                if let Some(c) = chars.next() {
                    normalized.push(c);
                }
            } else if c == 'Å' && !quoted {
                let mut count = 1;
                while chars.peek() == Some(&'Å') {
                    chars.next();
                    count += 1;
                }
                normalized.push_str(if count >= 4 { "dddd" } else { "ddd" });
            } else {
                normalized.push(c);
            }
        }
        pattern = Cow::Owned(normalized);
    }
    let sections = match dates::sections(&pattern, false) {
        Ok(sections) => sections,
        Err(_) => return Some(Value::Error("#VALUE!")),
    };
    let numeric = match value {
        Value::Number(n) => Some(*n),
        Value::Blank | Value::Empty => Some(0.),
        Value::Text(text) | Value::UninternedText(text)
            if !text.trim().eq_ignore_ascii_case("true")
                && !text.trim().eq_ignore_ascii_case("false") =>
        {
            *work = work.checked_sub(text.len().checked_mul(2)?)?;
            date_text::parse(text, date1904)
                .map(|(day, time)| day as f64 + time)
                .or_else(|| number::parse(text, date1904))
        }
        _ => None,
    };
    let Some(n) = numeric else {
        let text = value.text();
        let Some(section) = sections.get(3) else {
            return Some(if text.encode_utf16().count() > 32767 {
                Value::Error("#VALUE!")
            } else {
                Value::Text(if pattern.is_empty() {
                    text.trim_end().into()
                } else {
                    text
                })
            });
        };
        let tokens = dates::tokens(&section.pattern, work).ok()?;
        let mut result = String::new();
        let mut units = 0;
        for token in tokens {
            let piece = if !token.escaped && token.text == "@" {
                &text
            } else {
                token.text
            };
            units += piece.encode_utf16().count();
            if units > 32767 {
                return Some(Value::Error("#VALUE!"));
            }
            *work = work.checked_sub(piece.len())?;
            result.push_str(piece);
        }
        return Some(Value::Text(result));
    };
    let Some((selected, magnitude)) = dates::select(&sections, n) else {
        return Some(Value::Text("######".into()));
    };
    let tokens = dates::tokens(selected, work).ok()?;
    let kind = number_format::format_kind(&tokens, false);
    let result = if matches!(
        kind,
        number_format::FormatKind::Date
            | number_format::FormatKind::Time
            | number_format::FormatKind::DateTime
    ) {
        if n < 0. && !date1904 {
            return Some(Value::Text("######".into()));
        }
        match dates::text(&n.to_string(), &pattern, date1904, false, *work, work) {
            Ok(Some(result)) => result,
            Err(error) if error == "worksheet exceeds byte limit" => return None,
            _ => return Some(Value::Error("#VALUE!")),
        }
    } else {
        let general = selected.eq_ignore_ascii_case("General");
        let mut result = number_format::text(
            if general && magnitude { n.abs() } else { n },
            if general { "General" } else { &pattern },
            date1904,
            number_format::Mode::Display,
            work,
        )?;
        if n < 0.
            && !magnitude
            && !selected.eq_ignore_ascii_case("General")
            && !tokens
                .iter()
                .any(|token| !token.escaped && matches!(token.text, "0" | "#" | "?" | "@"))
        {
            result.insert(0, '-');
        }
        result
    };
    Some(if result.encode_utf16().count() > 32767 {
        Value::Error("#VALUE!")
    } else {
        Value::Text(result)
    })
}

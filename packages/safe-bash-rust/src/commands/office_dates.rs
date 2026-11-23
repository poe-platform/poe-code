use super::decimal;
use crate::commands::coreutils::{civil_from_days, days_from_civil};

pub(super) use crate::commands::structured::xlsx::display_number;

pub(super) fn builtin(id: usize) -> Option<&'static str> {
    Some(match id {
        1 => "0",
        2 => "0.00",
        3 => "#,##0",
        4 => "#,##0.00",
        9 => "0%",
        10 => "0.00%",
        11 => "0.00E+00",
        14 => "m/d/yy",
        15 => "d-mmm-yy",
        16 => "d-mmm",
        17 => "mmm-yy",
        18 => "h:mm AM/PM",
        19 => "h:mm:ss AM/PM",
        20 => "h:mm",
        21 => "h:mm:ss",
        22 => "m/d/yy h:mm",
        45 => "mm:ss",
        46 => "[h]:mm:ss",
        47 => "mmss.0",
        49 => "@",
        _ => return None,
    })
}

#[derive(Default)]
pub(in crate::commands) struct Section {
    pub(in crate::commands) pattern: String,
    pub(super) currency: bool,
    condition: Option<(&'static str, f64)>,
}

pub(in crate::commands) fn sections(pattern: &str, calc: bool) -> Result<Vec<Section>, String> {
    let mut sections = Vec::new();
    let mut section = Section::default();
    let mut quoted = false;
    let mut chars = pattern.chars();
    while let Some(c) = chars.next() {
        if c == '\\' && !quoted {
            section.pattern.push(c);
            if let Some(c) = chars.next() {
                section.pattern.push(c);
            }
        } else if c == '"' {
            quoted = !quoted;
            section.pattern.push(c);
        } else if quoted {
            section.pattern.push(c);
        } else if c == ';' {
            sections.push(std::mem::take(&mut section));
            if calc && sections.len() == 4 {
                return Ok(sections);
            }
        } else if matches!(c, '_' | '*') {
            if chars.next().is_none() {
                if calc {
                    break;
                }
                return Err("Incomplete spacing token".into());
            }
            if c == '_' {
                section.pattern.push_str("\" \"");
            }
        } else if c != '[' {
            section.pattern.push(c);
        } else {
            let mut tag = String::new();
            loop {
                match chars.next() {
                    Some(']') => break,
                    Some(c) => tag.push(c),
                    None => return Err("Unclosed format tag".into()),
                }
            }
            let lower = tag.to_lowercase();
            let color = lower
                .strip_prefix("color")
                .map(|n| crate::commands::js_number(n, 0.));
            if matches!(
                lower.as_str(),
                "black" | "blue" | "cyan" | "green" | "magenta" | "red" | "white" | "yellow"
            ) || color.is_some_and(|n| n.fract() == 0. && (calc || (1. ..=56.).contains(&n)))
            {
                continue;
            } else if tag.starts_with(['<', '=', '>']) {
                let op = ["<=", ">=", "<>", "<", ">", "="]
                    .into_iter()
                    .find(|op| tag.starts_with(op))
                    .unwrap();
                let raw = tag[op.len()..].trim();
                let value = if let Some(raw) = raw.strip_suffix('%') {
                    decimal(raw.trim()).map(|n| n * 0.01)
                } else {
                    decimal(raw)
                };
                let value = value
                    .or_else(|| calc.then_some(0.))
                    .ok_or("Invalid format condition")?;
                if section.condition.replace((op, value)).is_some() {
                    return Err("Invalid format condition".into());
                }
            } else if let Some(currency) = tag.strip_prefix('$') {
                let currency = currency.rsplit_once('-').map_or(currency, |(c, _)| c);
                section.currency |= !currency.is_empty();
                section.pattern.push('"');
                section.pattern.push_str(currency);
                section.pattern.push('"');
            } else if lower.starts_with(['h', 'm', 's'])
                && lower.bytes().all(|b| b == lower.as_bytes()[0])
            {
                section.pattern.push('[');
                section.pattern.push_str(&lower);
                section.pattern.push(']');
            } else {
                return Err(format!("Unsupported ssconvert feature: format tag [{tag}]"));
            }
        }
    }
    if quoted && calc {
        section.pattern.push('"');
    } else if quoted {
        return Err("Invalid format sections".into());
    }
    if sections.len() >= 4 {
        return Err("Invalid format sections".into());
    }
    sections.push(section);
    Ok(sections)
}

pub(in crate::commands) fn select(sections: &[Section], value: f64) -> Option<(&str, bool)> {
    if !sections.iter().any(|s| s.condition.is_some()) {
        let index = if value < 0. && sections.len() > 1 {
            1
        } else if value == 0. && sections.len() > 2 {
            2
        } else {
            0
        };
        return Some((&sections[index].pattern, index == 1));
    }
    let no_zero = sections.len() <= 2 || sections[2].condition.is_some();
    let negative_explicit = sections.get(1).is_some_and(|s| s.condition.is_some());
    let mut magnitude = false;
    let mut previous_implicit = false;
    let mut last_implicit = None;
    for (index, section) in sections.iter().take(3).enumerate() {
        let implicit = section.condition.is_none();
        if implicit {
            last_implicit = Some(section);
        } else {
            if previous_implicit {
                magnitude = false;
            }
            last_implicit = None;
        }
        previous_implicit = implicit;
        let (op, threshold) = section.condition.unwrap_or((
            match index {
                0 if no_zero && !negative_explicit => ">=",
                0 => ">",
                1 if no_zero => "any",
                1 => "<",
                _ => "=",
            },
            0.,
        ));
        let matches = match op {
            "<" => value < threshold,
            "<=" => value <= threshold,
            ">" => value > threshold,
            ">=" => value >= threshold,
            "=" => value == threshold,
            "<>" => value != threshold,
            _ => true,
        };
        let true_inhibits =
            op == "<" && threshold <= 0. || matches!(op, "<=" | "=") && threshold < 0.;
        let mut false_inhibits =
            matches!(op, ">" | ">=") && threshold <= 0. || op == "<>" && threshold < 0.;
        if index == 0 && no_zero && !negative_explicit && true_inhibits {
            false_inhibits = true;
        }
        if matches {
            return Some((&section.pattern, magnitude || true_inhibits));
        }
        magnitude |= false_inhibits;
    }
    last_implicit.map(|s| (s.pattern.as_str(), false))
}

pub(super) struct Token<'a> {
    pub(super) text: &'a str,
    pub(super) literal: bool,
    pub(super) escaped: bool,
}
pub(super) fn tokens<'a>(pattern: &'a str, work: &mut usize) -> Result<Vec<Token<'a>>, String> {
    let mut source = pattern;
    let mut tokens = Vec::new();
    while !source.is_empty() {
        let c = source.chars().next().unwrap();
        let (text, len, literal, escaped) = if c == '"' {
            let Some(end) = source[1..].find('"').map(|i| i + 1) else {
                return Ok(Vec::new());
            };
            (&source[1..end], end + 1, true, true)
        } else if c == '\\' {
            let count = source[1..].chars().next().map_or(0, char::len_utf8);
            (&source[1..1 + count], 1 + count, true, true)
        } else if source
            .get(..5)
            .is_some_and(|s| s.eq_ignore_ascii_case("AM/PM"))
        {
            (&source[..5], 5, false, false)
        } else if source
            .get(..3)
            .is_some_and(|s| s.eq_ignore_ascii_case("A/P"))
        {
            (&source[..3], 3, false, false)
        } else if c == '['
            && let Some(end) = source.find(']')
            && end > 1
            && matches!(source.as_bytes()[1], b'h' | b'm' | b's')
            && source[1..end].bytes().all(|b| b == source.as_bytes()[1])
        {
            (&source[..end + 1], end + 1, false, false)
        } else if c == '.' && source.as_bytes().get(1) == Some(&b'0') {
            let len = 1 + source[1..].bytes().take_while(|b| *b == b'0').count();
            (&source[..len], len, false, false)
        } else if c.is_ascii() && "ymdhs".contains(c.to_ascii_lowercase()) {
            let len = source
                .bytes()
                .take_while(|b| b.eq_ignore_ascii_case(&(c as u8)))
                .count();
            (&source[..len], len, false, false)
        } else {
            (&source[..c.len_utf8()], c.len_utf8(), true, false)
        };
        *work = work
            .checked_sub(size_of::<Token>())
            .ok_or("worksheet exceeds byte limit")?;
        tokens.push(Token {
            text,
            literal,
            escaped,
        });
        source = &source[len..];
    }
    Ok(tokens)
}

pub(super) fn has_date(tokens: &[Token<'_>]) -> bool {
    let mut has_date = false;
    let mut minutes = false;
    let mut trigger = true;
    for (index, token) in tokens.iter().enumerate() {
        if token.literal {
            continue;
        }
        let lower = token.text.as_bytes()[0].to_ascii_lowercase();
        if matches!(lower, b'y' | b'd') {
            has_date = true;
        } else if lower == b'h' || token.text.starts_with("[h") {
            minutes = true;
        } else if lower == b's' || token.text.starts_with("[s") {
            if trigger {
                minutes = true;
            }
            trigger = false;
        } else if token.text.starts_with("[m") {
            minutes = false;
        } else if lower == b'm' {
            let next = tokens[index + 1..]
                .iter()
                .find(|t| !t.literal)
                .map(|t| t.text.as_bytes()[0].to_ascii_lowercase());
            if token.text.len() <= 2 && (minutes || next == Some(b's')) {
                minutes = false;
                trigger = false;
            } else {
                has_date = true;
            }
        }
    }
    has_date
}

// Matches the production C-locale date/time formatter, including its one-ULP
// rounding adjustment, contextual month/minute tokens and section sign rules.
pub(super) fn text(
    raw: &str,
    pattern: &str,
    date1904: bool,
    odf: bool,
    minus: &str,
    limit: usize,
    work: &mut usize,
) -> Result<Option<String>, String> {
    let source = raw.trim_matches(|c: char| c == '\u{feff}' || c != '\u{85}' && c.is_whitespace());
    if pattern.is_empty() || source.is_empty() {
        return Ok(None);
    }
    let value = crate::commands::js_number(source, f64::NAN);
    if !value.is_finite() {
        return Ok(None);
    }
    *work = work
        .checked_sub(pattern.len())
        .ok_or("worksheet exceeds byte limit")?;
    let sections = sections(pattern, odf)?;
    let Some((pattern, magnitude)) = select(&sections, value) else {
        return Ok(None);
    };
    let value = if magnitude { value.abs() } else { value };
    let tokens = tokens(pattern, work)?;
    if !tokens.iter().any(|t| {
        !t.literal
            && t.text
                .chars()
                .any(|c| "ymdhs".contains(c.to_ascii_lowercase()))
    }) {
        return Ok(None);
    }
    if tokens.iter().any(|t| !t.escaped && t.text == "@")
        && !tokens
            .iter()
            .any(|t| !t.escaped && (t.text.starts_with(".0") || "0#?".contains(t.text)))
    {
        return Ok(Some(display_number(value)));
    }
    if tokens
        .iter()
        .any(|t| t.literal && !t.escaped && t.text.chars().any(|c| "[]_*?@Ee0#".contains(c)))
    {
        return Err(format!(
            "Unsupported ssconvert feature: TEXT date format {pattern}"
        ));
    }
    let elapsed: Vec<_> = tokens
        .iter()
        .filter(|t| !t.literal && t.text.starts_with('['))
        .collect();
    let ampm = tokens.iter().any(|t| {
        !t.literal && (t.text.eq_ignore_ascii_case("AM/PM") || t.text.eq_ignore_ascii_case("A/P"))
    });
    let digits = tokens
        .iter()
        .filter(|t| !t.literal && t.text.starts_with('.'))
        .map(|t| t.text.len() - 1)
        .max()
        .unwrap_or(0);
    if digits > if odf { 7 } else { 3 } || elapsed.len() > 1 || !elapsed.is_empty() && ampm {
        return Ok(None);
    }
    let unit = elapsed.first().map(|t| t.text.as_bytes()[1]);
    let has_date = has_date(&tokens);
    let scale = 10i64.pow(digits as u32);
    let absolute = value.abs();
    let next = if absolute == 0. {
        0.
    } else {
        f64::from_bits(absolute.to_bits() + 1)
    };
    let rounded = if odf && unit.is_none() {
        // Calc extracts clocks in the calendar's 1970 epoch and removes the
        // day with its 15-significant-digit approximate floor.
        let epoch = if has_date {
            days_from_civil(
                if date1904 { 1904 } else { 1899 },
                if date1904 { 1 } else { 12 },
                if date1904 { 1 } else { 30 },
            ) as f64
        } else {
            0.
        };
        let time = value + epoch;
        let factor = if time == 0. {
            1.
        } else {
            10f64.powi(14 - time.abs().log10().floor() as i32)
        };
        let day = if time == 0. || !factor.is_finite() || time.abs() > (1u64 << 41) as f64 {
            time.floor()
        } else {
            ((time * factor).round() / factor).floor()
        };
        let fraction = time - day;
        let seconds = if fraction <= 0. || fraction >= 1. {
            0.
        } else {
            let precision = if time.abs() >= 1. {
                (10 - time.abs().log10().ceil() as i32).clamp(2, 9)
            } else {
                9
            };
            let factor = 10f64.powi(precision);
            let raw = fraction * 86400.;
            let rounded = (raw * factor).round() / factor;
            let seconds = if rounded >= 86400. { raw } else { rounded };
            let fraction = (seconds.fract() * scale as f64).round();
            seconds.floor() * scale as f64
                + if fraction >= scale as f64 {
                    (seconds.fract() * scale as f64).floor()
                } else {
                    fraction
                }
        };
        let serial = if has_date {
            // The calendar's date fields are rounded to milliseconds.
            (time * 86400000.).round().div_euclid(86400000.) - epoch
        } else {
            value.floor()
        };
        serial * (86400 * scale) as f64 + seconds
    } else if odf {
        value.signum() * (absolute * 86400. * scale as f64).round()
    } else {
        value.signum() * (next * (86400 * scale) as f64).round()
    };
    if !rounded.is_finite() || rounded.abs() > 9_007_199_254_740_991. {
        return Ok(None);
    }
    let rounded = rounded as i64;
    let seconds = rounded.div_euclid(scale);
    let clock = seconds.rem_euclid(86400);
    let serial = seconds.div_euclid(86400);
    if has_date && !odf && !date1904 && serial == 60 {
        return Ok(None);
    }
    let days = if date1904 {
        days_from_civil(1904, 1, 1)
    } else {
        days_from_civil(1899, 12, if odf { 30 } else { 31 })
    } + serial
        - i64::from(!odf && !date1904 && serial > 60);
    let (year, month, day) = if odf && days < days_from_civil(1582, 10, 15) {
        // Calc's ICU Gregorian calendar uses Julian dates before its cutover.
        let c = days + 2_440_588 + 32_082;
        let d = (4 * c + 3).div_euclid(1461);
        let e = c - (1461 * d).div_euclid(4);
        let m = (5 * e + 2).div_euclid(153);
        (
            d - 4800 + m.div_euclid(10),
            (m + 3 - 12 * m.div_euclid(10)) as u32,
            (e - (153 * m + 2).div_euclid(5) + 1) as u32,
        )
    } else {
        civil_from_days(days)
    };
    if has_date && !(if odf { -32768..=32767 } else { 1..=9999 }).contains(&year) {
        return Ok(None);
    }
    let absolute_seconds = rounded.abs() / scale;
    let hour = if unit == Some(b'h') {
        absolute_seconds / 3600
    } else {
        clock / 3600
    };
    let minute = if unit == Some(b'm') {
        absolute_seconds / 60
    } else {
        (if unit.is_some() {
            absolute_seconds
        } else {
            clock
        }) / 60
            % 60
    };
    let second = if unit == Some(b's') {
        absolute_seconds
    } else {
        (if unit.is_some() {
            absolute_seconds
        } else {
            clock
        }) % 60
    };
    let months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    let weekdays = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];
    let mut result = String::new();
    let mut minutes = false;
    let mut trigger = true;
    for (index, token) in tokens.iter().enumerate() {
        let mut piece = String::new();
        if token.literal {
            piece.push_str(token.text);
        } else if token.text.starts_with('.') {
            let fraction = if unit.is_some() {
                rounded.abs() % scale
            } else {
                rounded.rem_euclid(scale)
            };
            let text = format!("{fraction:0digits$}");
            piece.push('.');
            piece.push_str(&text[..token.text.len() - 1]);
        } else if token.text.eq_ignore_ascii_case("AM/PM") {
            piece.push_str(if hour >= 12 { "PM" } else { "AM" });
        } else if token.text.eq_ignore_ascii_case("A/P") {
            piece.push(token.text.as_bytes()[if hour >= 12 { 2 } else { 0 }] as char);
        } else {
            let elapsed = token.text.starts_with('[');
            let c = token.text.as_bytes()[usize::from(elapsed)].to_ascii_lowercase();
            let count = token.text.len() - if elapsed { 2 } else { 0 };
            if elapsed {
                let number = match c {
                    b'h' => hour,
                    b'm' => minute,
                    _ => second,
                };
                if count > limit.saturating_sub(result.len()) {
                    return Err("worksheet exceeds byte limit".into());
                }
                if rounded < 0 && (absolute_seconds > 0 || odf) {
                    piece.push_str(minus);
                }
                piece.push_str(&format!("{number:0count$}"));
                minutes = c == b'h' || c == b's' && trigger;
                if c == b's' {
                    trigger = false;
                }
            } else {
                let number = match c {
                    b'y' if odf && count >= 4 => {
                        piece.push_str(&format!("{year:04}"));
                        None
                    }
                    b'y' => Some(if count <= 2 { year % 100 } else { year }),
                    b'd' if count > 2 => {
                        let name = weekdays[(days + 4).rem_euclid(7) as usize];
                        piece.push_str(if count == 3 { &name[..3] } else { name });
                        None
                    }
                    b'd' => Some(day as i64),
                    b'h' => {
                        minutes = true;
                        Some(if ampm {
                            if hour % 12 == 0 { 12 } else { hour % 12 }
                        } else {
                            hour
                        })
                    }
                    b's' => {
                        if trigger {
                            minutes = true;
                            trigger = false;
                        }
                        Some(second)
                    }
                    _ => {
                        let next = tokens[index + 1..]
                            .iter()
                            .find(|t| !t.literal)
                            .map(|t| t.text.as_bytes()[0].to_ascii_lowercase());
                        if count <= 2 && (minutes || next == Some(b's')) {
                            minutes = false;
                            trigger = false;
                            Some(minute)
                        } else if count > 2 {
                            let name = months[month as usize - 1];
                            piece.push_str(match count {
                                3 => &name[..3],
                                5 => &name[..1],
                                _ => name,
                            });
                            None
                        } else {
                            minutes = false;
                            Some(month as i64)
                        }
                    }
                };
                if let Some(number) = number {
                    let width = if c == b'y' {
                        if count <= 2 { 2 } else { 1 }
                    } else if count == 1 {
                        1
                    } else {
                        2
                    };
                    piece.push_str(&format!("{number:0width$}"));
                }
            }
        }
        if piece.len() > limit.saturating_sub(result.len()) {
            return Err("worksheet exceeds byte limit".into());
        }
        result.push_str(&piece);
    }
    Ok(Some(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formatting_accounts_for_token_storage_and_output_width() {
        let pattern = format!("{}yyyy", " ".repeat(128));
        assert!(text("45292", &pattern, false, false, "-", 4096, &mut 512).is_err());
        assert!(
            text("45292", &pattern, false, false, "-", 4096, &mut 16384)
                .unwrap()
                .is_some()
        );
        let pattern = format!("[{}]", "h".repeat(128));
        assert!(text("45292", &pattern, false, false, "-", 32, &mut 16384).is_err());
    }
}

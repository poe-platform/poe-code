// Parsing rules adapt IronCalc functions/date_and_time.rs (MIT,
// f93662006b8fb1c401dc870bbda26c5d60ac6037) and Univer date/{datevalue,timevalue}
// (Apache-2.0, 4767b3b309467c283bbd52b725536ca73861e0fc). See LICENSE files.
use super::Value;
use crate::commands::coreutils::{civil_from_days, days_from_civil};

pub(super) fn calculate(
    name: &str,
    value: &Value,
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    if let Value::Error(error) | Value::LiteralError(error) = value {
        return Some(Value::Error(error));
    }
    let (Value::Text(text) | Value::UninternedText(text)) = value else {
        return Some(Value::Error("#VALUE!"));
    };
    *work = work.checked_sub(text.len().checked_mul(2)?)?;
    Some(
        parse(text, date1904).map_or(Value::Error("#VALUE!"), |(day, time)| {
            Value::Number(if name == "DATEVALUE" {
                day as f64
            } else {
                time
            })
        }),
    )
}

// Callers charge two input lengths before this scan and its normalization buffer.
// Keep the time separate from the day so TIMEVALUE retains fractional precision.
pub(super) fn parse(source: &str, date1904: bool) -> Option<(i64, f64)> {
    let mut text = String::with_capacity(source.len());
    let mut space = false;
    for c in source.trim().chars() {
        if c.is_whitespace() {
            space = true;
            continue;
        }
        if space
            && !text.is_empty()
            && !text.ends_with(['/', '-', ':', ','])
            && !matches!(c, '/' | '-' | ':' | ',')
        {
            text.push(' ');
        }
        text.push(c);
        space = false;
    }
    if let Some((parts, time)) = date_parts(&text) {
        let year_index = parts
            .iter()
            .position(|s| s.len() == 4 && digits(s))
            .unwrap_or(2);
        let year_text = parts[year_index];
        if !matches!(year_text.len(), 2 | 4) || !digits(year_text) {
            return None;
        }
        let mut year = year_text.parse::<i64>().ok()?;
        if year_text.len() == 2 {
            year += if year < 30 { 2000 } else { 1900 };
        }
        if !(1900..=9999).contains(&year) {
            return None;
        }
        let (a, b) = match year_index {
            0 => (parts[1], parts[2]),
            1 => (parts[0], parts[2]),
            _ => (parts[0], parts[1]),
        };
        let (month_text, day_text) = if year_index == 0 || !digits(a) {
            (a, b)
        } else if !digits(b) || a.parse::<u32>().ok()? > 12 && b.parse::<u32>().ok()? <= 12 {
            (b, a)
        } else {
            (a, b)
        };
        let month = month(month_text)?;
        if day_text.len() > 2 || !digits(day_text) {
            return None;
        }
        let day = day_text.parse::<u32>().ok()?;
        if day == 0 || day > 31 {
            return None;
        }
        let fictitious = !date1904 && (year, month, day) == (1900, 2, 29);
        let civil = days_from_civil(year, month.into(), day.into());
        if !fictitious && civil_from_days(civil) != (year, month, day) {
            return None;
        }
        let epoch = if date1904 {
            days_from_civil(1904, 1, 1)
        } else {
            days_from_civil(1899, 12, 31)
        };
        let serial = if fictitious {
            60
        } else {
            civil - epoch + i64::from(!date1904 && (year, month, day) >= (1900, 3, 1))
        };
        let (carry, fraction) = if time.is_empty() {
            (0, 0.)
        } else {
            clock(time, true)?
        };
        let serial = serial.checked_add(carry)?;
        let maximum = if date1904 { 2_957_003 } else { 2_958_465 };
        return (serial <= maximum).then_some((serial, fraction));
    }
    clock(&text, false)
}

fn digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit())
}

fn date_parts(source: &str) -> Option<([&str; 3], &str)> {
    let leading_digits = source.bytes().take_while(u8::is_ascii_digit).count();
    let compact = leading_digits > 0
        && source
            .as_bytes()
            .get(leading_digits)
            .is_some_and(u8::is_ascii_alphabetic);
    let mut parts = [""; 3];
    let mut rest = source;
    let mut separator = b' ';
    for (index, part) in parts.iter_mut().enumerate() {
        let length = rest
            .bytes()
            .take_while(|b| {
                if compact && index == 1 {
                    b.is_ascii_alphabetic()
                } else if index == 2 || compact {
                    b.is_ascii_digit()
                } else {
                    b.is_ascii_alphanumeric()
                }
            })
            .count();
        if length == 0 {
            return None;
        }
        *part = &rest[..length];
        rest = &rest[length..];
        if index < 2 && !compact {
            let next = *rest.as_bytes().first()?;
            if index == 0 {
                if !matches!(next, b'/' | b'-' | b' ') {
                    return None;
                }
                separator = next;
            } else if next != separator && !(separator == b' ' && next == b',') {
                return None;
            }
            rest = &rest[1..];
        }
    }
    if !rest.is_empty() {
        if !rest.starts_with([' ', 'T', 't']) {
            return None;
        }
        rest = &rest[1..];
        if rest.is_empty() {
            return None;
        }
    }
    Some((parts, rest))
}

fn month(text: &str) -> Option<u32> {
    if digits(text) {
        if text.len() > 2 {
            return None;
        }
        let month = text.parse().ok()?;
        return (1..=12).contains(&month).then_some(month);
    }
    if text.eq_ignore_ascii_case("Sept") {
        return Some(9);
    }
    [
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
    ]
    .iter()
    .position(|month| month.eq_ignore_ascii_case(text) || month[..3].eq_ignore_ascii_case(text))
    .map(|i| i as u32 + 1)
}

fn clock(source: &str, has_date: bool) -> Option<(i64, f64)> {
    let (body, meridiem) = if let Some((body, suffix)) = source.rsplit_once(' ') {
        let suffix = suffix.strip_suffix('.').unwrap_or(suffix);
        if suffix.eq_ignore_ascii_case("AM") {
            (body, Some(false))
        } else if suffix.eq_ignore_ascii_case("PM") {
            (body, Some(true))
        } else {
            return None;
        }
    } else {
        (source, None)
    };
    let mut parts = body.split(':');
    let hour_text = parts.next()?;
    if !digits(hour_text) {
        return None;
    }
    let mut hour = hour_text.parse::<u32>().ok()?;
    let minute = if let Some(text) = parts.next() {
        if !digits(text) {
            return None;
        }
        text.parse::<u32>().ok()?
    } else if meridiem.is_some() {
        0
    } else {
        return None;
    };
    let second = if let Some(text) = parts.next() {
        let (whole, fractional) = text
            .split_once('.')
            .map_or((text, None), |(a, b)| (a, Some(b)));
        if !digits(whole) || fractional.is_some_and(|s| !digits(s)) {
            return None;
        }
        text.parse::<f64>().ok().filter(|n| n.is_finite())?
    } else {
        0.
    };
    if parts.next().is_some() {
        return None;
    }
    if let Some(pm) = meridiem {
        if !(1..=12).contains(&hour) || minute > 59 || second >= 60. {
            return None;
        }
        hour = hour % 12 + if pm { 12 } else { 0 };
    } else {
        let normal = minute < 60 && second < 60. && (has_date || hour <= 24);
        let overflow =
            hour == 23 && (minute == 60 && second < 60. || minute == 59 && second == 60.);
        if !normal && !overflow {
            return None;
        }
    }
    let seconds = f64::from(hour) * 3600. + f64::from(minute) * 60. + second;
    Some((
        (seconds / 86400.).floor() as i64,
        seconds.rem_euclid(86400.) / 86400.,
    ))
}

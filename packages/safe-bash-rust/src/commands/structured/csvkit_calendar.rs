use crate::commands::coreutils::days_from_civil;
use std::fmt::Write;

pub(super) struct Calendar {
    pub instant: i64,
    pub aware: bool,
    pub value: String,
}

fn digits(s: &str, width: std::ops::RangeInclusive<usize>) -> Option<i32> {
    if width.contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()) {
        s.parse().ok()
    } else {
        None
    }
}

pub(super) fn parse_iso(s: &str) -> Option<Calendar> {
    let s = s.trim();
    let (date, time) = s
        .split_once(['T', ' '])
        .map_or((s, None), |(d, t)| (d, Some(t)));
    let mut fields = date.split('-');
    let mut year = digits(fields.next()?, 4..=4)?;
    let width = if time.is_some() { 2..=2 } else { 1..=2 };
    let mut month = digits(fields.next()?, width.clone())?;
    let mut day = digits(fields.next()?, width)?;
    if fields.next().is_some() {
        return None;
    }
    if time.is_none() {
        // parsedatetime reads a leading four-digit value <= 31 as the month.
        if year <= 31 {
            (year, month, day) = (day, year, month);
        }
        year += if year < 50 {
            2000
        } else if year < 100 {
            1900
        } else {
            0
        };
    }
    if year == 0
        || !(1..=12).contains(&month)
        || !(1..=super::days_in_month(year, month)).contains(&day)
    {
        return None;
    }
    let mut value = format!("{year:04}-{month:02}-{day:02}");
    let days = days_from_civil(year.into(), month.into(), day.into());
    let mut instant = days * 86_400_000_000;
    let mut aware = false;
    if let Some(time) = time {
        let (clock, zone) = time.split_at(time.find(['+', '-', 'Z']).unwrap_or(time.len()));
        let mut parts = clock.split(':');
        let hour = digits(parts.next()?, 2..=2)?;
        let minute = digits(parts.next()?, 2..=2)?;
        let seconds = parts.next().unwrap_or("00");
        let (whole, frac) = seconds
            .split_once(['.', ','])
            .map_or((seconds, None), |(s, f)| (s, Some(f)));
        let second = digits(whole, 2..=2)?;
        if parts.next().is_some() || hour >= 24 || minute >= 60 || second >= 60 {
            return None;
        }
        let mut micros = 0;
        if let Some(f) = frac {
            if f.is_empty() || !f.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            for i in 0..6 {
                micros = micros * 10 + i64::from(f.as_bytes().get(i).map_or(0, |b| b - b'0'));
            }
        }
        instant += i64::from(hour * 3600 + minute * 60 + second) * 1_000_000 + micros;
        write!(value, " {hour:02}:{minute:02}:{second:02}").unwrap();
        if micros != 0 {
            write!(value, ".{micros:06}").unwrap();
        }
        if !zone.is_empty() {
            aware = true;
            let (mut sign, zh, zm) = if zone == "Z" {
                ('+', 0, 0)
            } else {
                let offset = zone.get(1..)?;
                let h = digits(offset.get(..2)?, 2..=2)?;
                let tail = offset.get(2..)?;
                let m = digits(tail.strip_prefix(':').unwrap_or(tail), 2..=2)?;
                let sign = zone.chars().next()?;
                if !matches!(sign, '+' | '-') || h > 23 || m > 59 {
                    return None;
                }
                (sign, h, m)
            };
            if zh == 0 && zm == 0 {
                sign = '+';
            }
            instant -=
                i64::from(zh * 60 + zm) * (if sign == '+' { 60_000_000 } else { -60_000_000 });
            write!(value, "{sign}{zh:02}:{zm:02}").unwrap();
        }
    }
    Some(Calendar {
        instant,
        aware,
        value,
    })
}

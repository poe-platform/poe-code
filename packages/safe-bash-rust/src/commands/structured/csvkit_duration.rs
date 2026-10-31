use std::borrow::Cow;

const DAY: i128 = 86_400_000_000;
const UNITS: [i128; 5] = [604800, 86400, 3600, 60, 1];

pub(super) fn in_range(value: i128) -> bool {
    (-999_999_999..=999_999_999).contains(&value.div_euclid(DAY))
}

fn fields(mut s: &str) -> Option<[Option<&str>; 5]> {
    let mut out = [None; 5];
    let mut next = 0;
    while !s.is_empty() {
        let end = s
            .bytes()
            .take_while(|b| b.is_ascii_digit() || *b == b'.')
            .count();
        let (n, tail) = s.split_at(end);
        let tail = tail.trim_start();
        let letters = tail.bytes().take_while(u8::is_ascii_alphabetic).count();
        if letters == 0 {
            break;
        }
        let (unit, rest) = tail.split_at(letters);
        let index = match unit.to_ascii_lowercase().as_str() {
            "w" | "wk" | "wks" | "week" | "weeks" => 0,
            "d" | "dy" | "dys" | "day" | "days" => 1,
            "h" | "hr" | "hrs" | "hour" | "hours" => 2,
            "m" | "min" | "mins" | "minute" | "minutes" => 3,
            "s" | "sec" | "secs" | "second" | "seconds" => 4,
            _ => return None,
        };
        if n.is_empty() || index < next {
            return None;
        }
        out[index] = Some(n);
        next = index + 1;
        s = rest.trim_start();
        if index != 4
            && let Some(rest) = s.strip_prefix([',', '/'])
        {
            s = rest.trim_start();
        }
    }
    if s.is_empty() {
        return (next != 0).then_some(out);
    }
    let mut clock = s.split(':');
    let a = clock.next()?;
    let b = clock.next()?;
    let c = clock.next();
    let d = clock.next();
    if clock.next().is_some() {
        return None;
    }
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let pair = |s: &str| s.len() == 2 && digits(s);
    let seconds = match (c, d) {
        (None, None) if next == 0 && (a.is_empty() || a.len() <= 2 && digits(a)) => {
            out[3] = (!a.is_empty()).then_some(a);
            b
        }
        (Some(c), None) if next <= 2 && digits(a) && pair(b) => {
            out[2] = Some(a);
            out[3] = Some(b);
            c
        }
        (Some(c), Some(d)) if next == 0 && digits(a) && pair(b) && pair(c) => {
            out[1] = Some(a);
            out[2] = Some(b);
            out[3] = Some(c);
            d
        }
        _ => return None,
    };
    let (whole, fraction) = seconds
        .split_once('.')
        .map_or((seconds, None), |(w, f)| (w, Some(f)));
    if !pair(whole) || fraction.is_some_and(|f| !digits(f)) {
        return None;
    }
    out[4] = Some(seconds);
    Some(out)
}

pub(super) fn parse(text: &str) -> Result<Option<i128>, (i32, String)> {
    // Python's Unicode 16 decimal digits and case-insensitive ASCII unit names.
    const ZEROES: &[u32] = &[
        48, 1632, 1776, 1984, 2406, 2534, 2662, 2790, 2918, 3046, 3174, 3302, 3430, 3558, 3664,
        3792, 3872, 4160, 4240, 6112, 6160, 6470, 6608, 6784, 6800, 6992, 7088, 7232, 7248, 42528,
        43216, 43264, 43472, 43504, 43600, 44016, 65296, 66720, 68912, 68928, 69734, 69872, 69942,
        70096, 70384, 70736, 70864, 71248, 71360, 71376, 71386, 71472, 71904, 72016, 72688, 72784,
        73040, 73120, 73552, 90416, 92768, 92864, 93008, 93552, 118000, 120782, 120792, 120802,
        120812, 120822, 123200, 123632, 124144, 124401, 125264, 130032,
    ];
    let text: Cow<'_, str> = if text.is_ascii() {
        text.into()
    } else {
        text.chars()
            .map(|c| {
                let n = u32::from(c);
                match c {
                    'ſ' => 's',
                    'İ' | 'ı' => 'i',
                    'K' => 'k',
                    _ if c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c) => ' ',
                    _ => ZEROES
                        .partition_point(|z| *z <= n)
                        .checked_sub(1)
                        .and_then(|i| char::from_digit(n - ZEROES[i], 10))
                        .unwrap_or(c),
                }
            })
            .collect::<String>()
            .into()
    };
    let text = text.trim();
    let sign = if text.starts_with('-') { -1 } else { 1 };
    let unsigned = text.strip_prefix(['-', '+', '|']).unwrap_or(text).trim();
    let Some(fields) = fields(unsigned) else {
        return Ok(None);
    };
    let overflow = || {
        (
            1,
            "OverflowError: Python int too large to convert to C int\n".to_owned(),
        )
    };
    let value = if fields.iter().flatten().all(|n| !n.contains('.')) {
        let mut total = 0i128;
        for (n, mul) in fields.into_iter().zip(UNITS) {
            if let Some(n) = n {
                let part = n
                    .parse::<i128>()
                    .ok()
                    .and_then(|n| n.checked_mul(mul))
                    .ok_or_else(overflow)?;
                total = total.checked_add(part).ok_or_else(overflow)?;
            }
        }
        total.checked_mul(sign * 1_000_000).ok_or_else(overflow)?
    } else {
        let mut parts = [0.0; 5];
        for (i, n) in fields.iter().enumerate() {
            if let Some(n) = n {
                parts[i] = n.parse::<f64>().map_err(|_| {
                    (
                        1,
                        format!("ValueError: could not convert string to float: '{n}'\n"),
                    )
                })? * UNITS[i] as f64;
            }
        }
        // pytimeparse truncates higher units and signs them separately when seconds are integral.
        let seconds = if fields[4].is_some_and(|n| n.contains('.')) {
            sign as f64 * parts.iter().sum::<f64>()
        } else {
            sign as f64 * parts[..4].iter().sum::<f64>().trunc() + parts[4]
        };
        if !seconds.is_finite() || (seconds * 1e6).abs() > 9_007_199_254_740_991.0 {
            return Err((
                78,
                "csvkit: unsupported or unqualified: timedelta float range\n".into(),
            ));
        }
        seconds.trunc() as i128 * 1_000_000 + (seconds.fract() * 1e6).round_ties_even() as i128
    };
    if !in_range(value) {
        return Err(overflow());
    }
    Ok(Some(value))
}

pub(super) fn text(value: i128) -> String {
    let days = value.div_euclid(DAY);
    let rem = value.rem_euclid(DAY);
    let seconds = rem / 1_000_000;
    let mut out = if days == 0 {
        String::new()
    } else {
        format!("{days} day{}, ", if days.abs() == 1 { "" } else { "s" })
    };
    use std::fmt::Write;
    write!(
        out,
        "{}:{:02}:{:02}",
        seconds / 3600,
        seconds / 60 % 60,
        seconds % 60
    )
    .unwrap();
    if rem % 1_000_000 != 0 {
        write!(out, ".{:06}", rem % 1_000_000).unwrap();
    }
    out
}

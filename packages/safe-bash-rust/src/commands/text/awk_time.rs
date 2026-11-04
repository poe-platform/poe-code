use super::{AwkState, Scalar};
use crate::commands::coreutils::{civil_from_days, days_from_civil, render_date_format};

enum Zone<'a> {
    Fixed(i64, &'static str),
    Named(&'a str),
}

impl<'a> Zone<'a> {
    fn new(name: &'a str) -> Option<Self> {
        let name = name.strip_prefix(':').unwrap_or(name);
        let label = if name.starts_with("GMT") || name == "Etc/GMT" {
            "GMT"
        } else {
            "UTC"
        };
        if matches!(
            name,
            "" | "UTC" | "GMT" | "UTC0" | "GMT0" | "Etc/UTC" | "Etc/GMT" | "Z"
        ) {
            return Some(Self::Fixed(0, label));
        }
        if let Some(spec) = name
            .strip_prefix("GMT")
            .or_else(|| name.strip_prefix("UTC"))
            && spec.starts_with(['+', '-'])
        {
            let mut parts = spec[1..].split(':');
            let parse = |s: &str, min| {
                (s.len() >= min && s.len() <= 2 && s.bytes().all(|b| b.is_ascii_digit()))
                    .then(|| s.parse::<i64>().ok())
                    .flatten()
            };
            let h = parse(parts.next()?, 1)?;
            let m = parse(parts.next().unwrap_or("00"), 2)?;
            let s = parse(parts.next().unwrap_or("00"), 2)?;
            if parts.next().is_some() || h > 23 || m > 59 || s > 59 {
                return None;
            }
            return Some(Self::Fixed(
                (h * 3600 + m * 60 + s) * if spec.starts_with('+') { -1 } else { 1 },
                label,
            ));
        }
        if !name
            .as_bytes()
            .first()
            .is_some_and(|b| b.is_ascii_alphabetic() || b"_+-".contains(b))
            || !name.split('/').all(|part| {
                !part.is_empty()
                    && part
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_+.-".contains(&b))
            })
        {
            return None;
        }
        crate::intl::zone_fields(name, 0)?;
        Some(Self::Named(name))
    }

    fn fields(&self, sec: i64) -> Option<(i64, String)> {
        if sec.unsigned_abs() > 8_640_000_000_000 {
            return None;
        }
        let (offset, label) = match self {
            Self::Fixed(offset, label) => (*offset, (*label).to_owned()),
            Self::Named(name) => crate::intl::zone_fields(name, sec)?,
        };
        let (year, _, _) = civil_from_days((sec + offset).div_euclid(86400));
        ((-9999..=9999).contains(&year)).then_some((offset, label))
    }

    fn mktime(&self, spec: &str) -> Option<i64> {
        let mut fields = spec.split_whitespace();
        let mut number = || fields.next()?.parse::<i64>().ok().map(i128::from);
        let (year, month, day) = (number()?, number()? - 1, number()?);
        let clock = number()? * 3600 + number()? * 60 + number()?;
        let daylight = fields.next().unwrap_or("-1");
        let digits = daylight.strip_prefix(['+', '-']).unwrap_or(daylight);
        if digits.is_empty() || !digits.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let daylight = daylight.parse::<f64>().ok()?;
        if fields.next().is_some() {
            return None;
        }
        // JavaScript normalizes the calendar date before setting the clock.
        let year = year + month.div_euclid(12);
        let days = year.div_euclid(400) * 146097
            + i128::from(days_from_civil(
                year.rem_euclid(400) as i64,
                (month.rem_euclid(12) + 1) as i64,
                1,
            ))
            + day
            - 1;
        if days.abs() > 100_000_000 {
            return None;
        }
        let wall = i64::try_from(days * 86400 + clock).ok()?;
        if wall.unsigned_abs() > 8_640_000_000_000 {
            return None;
        }
        let mut offsets = [0; 5];
        for (slot, days) in offsets.iter_mut().zip([-183, -2, 0, 2, 183]) {
            *slot = self.fields(wall + days * 86400)?.0;
        }
        offsets.sort_unstable();
        let mut offset = if daylight > 0.0 {
            offsets[4]
        } else {
            offsets[0]
        };
        if daylight < 0.0 {
            for candidate in offsets.into_iter().rev() {
                if self.fields(wall - candidate)?.0 == candidate {
                    offset = candidate;
                    break;
                }
            }
        }
        Some(wall - offset)
    }
}

pub(super) fn evaluate(name: &str, args: &[Scalar], state: &mut AwkState) -> Option<Scalar> {
    let format = name == "strftime";
    let utc = args
        .get(if format { 2 } else { 1 })
        .is_some_and(|v| v.number() != 0.0);
    let first = args
        .first()
        .map(|v| state.formatted(v.text(Some(&state.convfmt))));
    let zone = Zone::new(if utc { "UTC" } else { &state.timezone })?;
    if !format {
        return Some(Scalar::Number(
            zone.mktime(first.as_deref()?).unwrap_or(-1) as f64
        ));
    }
    let sec = args.get(1).map_or_else(
        || (crate::vfs::now_ms() / 1000.0).floor(),
        |v| v.number().trunc(),
    );
    if !sec.is_finite() {
        state.runtime_err = Some("awk: invalid strftime timestamp\n".into());
        return None;
    }
    let sec = sec as i64;
    let (offset, label) = zone.fields(sec)?;
    let mut result = render_date_format(
        first.as_deref().unwrap_or("%a %b %e %H:%M:%S %Z %Y"),
        sec,
        0,
        offset,
        &label,
    )
    .ok()?;
    result.pop(); // date adds its own output newline.
    Some(Scalar::Text(result))
}

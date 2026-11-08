//! UTF-16 spawn-log metadata and deterministic catalog ordering.
const EXTENSION: &[u16] = &[46, 106, 115, 111, 110, 108];
pub struct Metadata {
    pub parsed: bool,
    pub agent: Option<Vec<u16>>,
    pub timestamp: Option<i64>,
}
fn digits(text: &[u16], length: usize) -> Option<i64> {
    if text.len() != length || !text.iter().all(|unit| (48..=57).contains(unit)) {
        return None;
    }
    Some(
        text.iter()
            .fold(0, |value, unit| value * 10 + i64::from(unit - 48)),
    )
}
fn timestamp(day: &[u16], time: &[u16], millis: &[u16]) -> Option<i64> {
    digits(day, 8)?;
    digits(time, 6)?;
    let (year, month, date) = (
        digits(&day[..4], 4)?,
        digits(&day[4..6], 2)?,
        digits(&day[6..], 2)?,
    );
    let (hours, minutes, seconds, millis) = (
        digits(&time[..2], 2)?,
        digits(&time[2..4], 2)?,
        digits(&time[4..], 2)?,
        digits(millis, 3)?,
    );
    if year < 100
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&date)
        || hours > 23
        || minutes > 59
        || seconds > 59
    {
        return None;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    if date > days {
        return None;
    }
    let y = year - i64::from(month <= 2);
    let era = y / 400;
    let yoe = y - era * 400;
    let adjusted = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * adjusted + 2) / 5 + date - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some((((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000 + millis)
}
pub fn parse_filename(filename: &[u16]) -> Metadata {
    let empty = || Metadata {
        parsed: false,
        agent: None,
        timestamp: None,
    };
    if !filename.ends_with(EXTENSION) {
        return empty();
    }
    let parts: Vec<_> = filename[..filename.len() - EXTENSION.len()]
        .split(|unit| *unit == 45)
        .collect();
    if parts.len() < 4 {
        return empty();
    }
    let mut agent = Vec::new();
    for (index, part) in parts[3..].iter().enumerate() {
        if index > 0 {
            agent.push(45);
        }
        agent.extend(*part);
    }
    Metadata {
        parsed: true,
        agent: (!agent.is_empty()).then_some(agent),
        timestamp: timestamp(parts[0], parts[1], parts[2]),
    }
}
pub fn normalize_limit(limit: f64) -> f64 {
    if !limit.is_finite() || limit < 0. {
        80.
    } else {
        limit.floor()
    }
}
pub fn sorted_indices(names: &[Vec<u16>]) -> Vec<u32> {
    let mut indices: Vec<_> = (0..names.len() as u32).collect();
    indices.sort_by(|a, b| names[*b as usize].cmp(&names[*a as usize]));
    indices
}
pub fn latest(names: &[Vec<u16>], timestamps: &[Option<i64>]) -> Option<u32> {
    let mut best = None;
    for (index, stamp) in timestamps.iter().enumerate() {
        let Some(stamp) = stamp else {
            continue;
        };
        if best.is_none_or(|old: usize| {
            *stamp > timestamps[old].unwrap()
                || *stamp == timestamps[old].unwrap() && names[index] > names[old]
        }) {
            best = Some(index);
        }
    }
    best.or_else(|| (!names.is_empty()).then_some(0))
        .map(|index| index as u32)
}

use super::super::{Value, dates::addin_calendar, lookup::number};

pub(super) fn basis(value: &Value, date1904: bool) -> Result<i32, &'static str> {
    // Any arguments are parsed after typed operands, without approximate rounding.
    let basis = match value {
        Value::Text(s) | Value::UninternedText(s) if s.is_empty() => 0.,
        Value::Text(s) | Value::UninternedText(s) => number::parse(s, date1904).ok_or("Err:502")?,
        _ => value.numeric().ok_or("Err:502")?,
    }
    .trunc();
    if (0. ..=4.).contains(&basis) {
        Ok(basis as i32)
    } else {
        Err("Err:502")
    }
}

fn leap(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

pub(super) fn year_fraction(
    start: i32,
    end: i32,
    basis: i32,
    epoch: i64,
) -> Result<f64, &'static str> {
    if start == end {
        return Ok(0.);
    }
    let (start, end) = (start.min(end), start.max(end));
    let (y1, m1, mut d1) = addin_calendar(start, epoch)?;
    let (y2, m2, mut d2) = addin_calendar(end, epoch)?;
    let days = if matches!(basis, 0 | 4) {
        if d1 == 31 {
            d1 = 30;
        }
        if basis == 4 || d1 == 30 && d2 == 31 {
            d2 = d2.min(30);
        } else if m1 == 2 && d1 == if leap(y1) { 29 } else { 28 } {
            d1 = 30;
            if m2 == 2 && d2 == if leap(y2) { 29 } else { 28 } {
                d2 = 30;
            }
        }
        ((y2 - y1) * 360 + (i64::from(m2) - i64::from(m1)) * 30 + i64::from(d2) - i64::from(d1))
            as f64
    } else {
        f64::from(end.wrapping_sub(start))
    };
    let year = match basis {
        0 | 2 | 4 => 360.,
        3 => 365.,
        1 if y1 != y2 && (y2 != y1 + 1 || (m1, d1) < (m2, d2)) => {
            let before = y1 - 1;
            let leaps = y2.div_euclid(4) - y2.div_euclid(100) + y2.div_euclid(400)
                - before.div_euclid(4)
                + before.div_euclid(100)
                - before.div_euclid(400);
            ((y2 - y1 + 1) * 365 + leaps) as f64 / (y2 - y1 + 1) as f64
        }
        1 => {
            if y1 == y2 && leap(y1)
                || y1 != y2 && (leap(y1) && m1 <= 2 || leap(y2) && (m2 > 2 || m2 == 2 && d2 == 29))
            {
                366.
            } else {
                365.
            }
        }
        _ => return Err("Err:502"),
    };
    Ok(days / year)
}

pub(super) fn year_diff(start: i32, end: i32, basis: i32, epoch: i64) -> Result<f64, &'static str> {
    match basis {
        0 | 4 => {
            let (y1, m1, d1) = addin_calendar(start, epoch)?;
            let (y2, m2, d2) = addin_calendar(end, epoch)?;
            let mut days = ((y2 - y1) * 12 + i64::from(m2) - i64::from(m1)) * 30 + i64::from(d2)
                - i64::from(d1);
            if basis == 0 && m1 == 2 && m2 != 2 && y1 == y2 {
                days -= if leap(y1) { 1 } else { 2 };
            }
            Ok(days as f64 / 360.)
        }
        1 => {
            let (year, _, _) = addin_calendar(start, epoch)?;
            Ok(f64::from(end.wrapping_sub(start)) / if leap(year) { 366. } else { 365. })
        }
        2 => Ok(f64::from(end.wrapping_sub(start)) / 360.),
        3 => Ok(f64::from(end.wrapping_sub(start)) / 365.),
        _ => Err("Err:502"),
    }
}

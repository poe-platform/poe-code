// Calendar differences adapted from IronCalc functions/date_and_time.rs
// (MIT, f93662006b8fb1c401dc870bbda26c5d60ac6037, LICENSE.IronCalc).
// DATEDIF array arguments use their top-left values, matching Univer date/datedif
// (Apache-2.0, 4767b3b309467c283bbd52b725536ca73861e0fc, LICENSE.Univer).
use super::{Calculation, Coord, Expr, Value, date_text, lookup::number};
use crate::commands::coreutils::{civil_from_days, days_from_civil};

pub(super) fn serial(
    value: &Value,
    date1904: bool,
    round_seconds: bool,
    work: &mut usize,
) -> Option<Result<i64, &'static str>> {
    let number = match value {
        Value::Error(e) | Value::LiteralError(e) => return Some(Err(e)),
        Value::Text(text) | Value::UninternedText(text) => {
            *work = work.checked_sub(text.len().checked_mul(2)?)?;
            if text.trim().eq_ignore_ascii_case("true") || text.trim().eq_ignore_ascii_case("false")
            {
                return Some(Err("#VALUE!"));
            }
            date_text::parse(text, date1904)
                .map(|(day, time)| day as f64 + if round_seconds { time } else { 0. })
                .or_else(|| number::parse(text, date1904))
        }
        _ => value.numeric(),
    };
    let number = number.map(|n| {
        if round_seconds {
            (n * 86400.).round() / 86400.
        } else {
            n
        }
    });
    Some(match number {
        None => Err("#VALUE!"),
        Some(n)
            if !n.is_finite()
                || n.floor() < 0.
                || n.floor() > if date1904 { 2_957_003. } else { 2_958_465. } =>
        {
            Err("#NUM!")
        }
        Some(n) => Ok(n.floor() as i64),
    })
}

pub(super) fn calendar(serial: i64, date1904: bool) -> (i64, u32, u32) {
    if date1904 {
        civil_from_days(days_from_civil(1904, 1, 1) + serial)
    } else if serial == 0 {
        (1900, 1, 0)
    } else if serial == 60 {
        (1900, 2, 29)
    } else {
        civil_from_days(days_from_civil(1899, 12, 31) + serial - i64::from(serial > 60))
    }
}

fn days_in_month(year: i64, month: u32, date1904: bool) -> u32 {
    if !date1904 && (year, month) == (1900, 2) {
        return 29;
    }
    (days_from_civil(year + i64::from(month == 12), i64::from(month % 12 + 1), 1)
        - days_from_civil(year, month.into(), 1)) as u32
}

fn shifted(year: i64, month: u32, day: u32, date1904: bool) -> i64 {
    let day = day.min(days_in_month(year, month, date1904));
    if !date1904 && (year, month, day) == (1900, 2, 29) {
        60
    } else if date1904 {
        days_from_civil(year, month.into(), day.into()) - days_from_civil(1904, 1, 1)
    } else {
        days_from_civil(year, month.into(), day.into()) - days_from_civil(1899, 12, 31)
            + i64::from((year, month, day) >= (1900, 3, 1))
    }
}

impl Calculation<'_> {
    pub(super) fn datedif(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if args.len() != 3 {
            return Some(Value::Error("#ERROR!"));
        }
        let mut dates = [0; 2];
        for (arg, date) in args.iter().zip(&mut dates) {
            let value = self.eval(arg, pos, depth + 1, true)?;
            let value = self.scalar(value, pos, depth + 1)?;
            *date = match serial(&value, self.book.date1904, false, &mut self.work)? {
                Ok(day) => day,
                Err(e) => return Some(Value::Error(e)),
            };
        }
        let [start, end] = dates;
        if start > end {
            return Some(Value::Error("#NUM!"));
        }
        let value = self.eval(&args[2], pos, depth + 1, true)?;
        let value = self.scalar(value, pos, depth + 1)?;
        if let Value::Error(e) | Value::LiteralError(e) = value {
            return Some(Value::Error(e));
        }
        let (Value::Text(unit) | Value::UninternedText(unit)) = &value else {
            return Some(Value::Error("#NUM!"));
        };
        self.work = self.work.checked_sub(64)?;
        let date1904 = self.book.date1904;
        let (y1, m1, d1) = calendar(start, date1904);
        let (y2, m2, d2) = calendar(end, date1904);
        let months = (y2 - y1) * 12 + i64::from(m2) - i64::from(m1) - i64::from(d2 < d1);
        let result = if unit.eq_ignore_ascii_case("Y") {
            y2 - y1 - i64::from((m2, d2) < (m1, d1))
        } else if unit.eq_ignore_ascii_case("M") {
            months
        } else if unit.eq_ignore_ascii_case("D") {
            end - start
        } else if unit.eq_ignore_ascii_case("YM") {
            months.rem_euclid(12)
        } else if unit.eq_ignore_ascii_case("YD") {
            let mut anniversary = shifted(y2, m1, d1, date1904);
            if anniversary > end {
                anniversary = shifted(y2 - 1, m1, d1, date1904);
            }
            end - anniversary
        } else if unit.eq_ignore_ascii_case("MD") {
            let month = y1 * 12 + i64::from(m1) - 1 + months;
            end - shifted(
                month.div_euclid(12),
                (month.rem_euclid(12) + 1) as u32,
                d1,
                date1904,
            )
        } else {
            return Some(Value::Error("#NUM!"));
        };
        Some(Value::Number(result as f64))
    }
}

fn leap(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

impl Calculation<'_> {
    pub(super) fn yearfrac(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if !(2..=3).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        if args[..2]
            .iter()
            .any(|arg| matches!(arg, Expr::Value(Value::Blank)))
        {
            return Some(Value::Error("#N/A"));
        }
        let mut numbers = [0.; 3];
        for (index, arg) in args.iter().enumerate() {
            let value = self.eval(arg, pos, depth + 1, true)?;
            // YEARFRAC accepts a single value, including a one-cell array.
            if matches!(&value, Value::Matrix(rows) if rows.len() != 1 || rows[0].len() != 1)
                || matches!(&value, Value::Range(a, b) if a != b)
            {
                return Some(Value::Error("#VALUE!"));
            }
            let value = self.scalar(value, pos, depth + 1)?;
            match &value {
                Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
                Value::Bool(_) => return Some(Value::Error("#VALUE!")),
                _ => {}
            }
            numbers[index] = if index < 2 {
                match serial(&value, self.book.date1904, false, &mut self.work)? {
                    Ok(day) => day as f64,
                    Err(e) => return Some(Value::Error(e)),
                }
            } else {
                let n = match &value {
                    Value::Text(text) | Value::UninternedText(text) => {
                        self.work = self.work.checked_sub(text.len().checked_mul(2)?)?;
                        if text.trim().eq_ignore_ascii_case("true")
                            || text.trim().eq_ignore_ascii_case("false")
                        {
                            return Some(Value::Error("#VALUE!"));
                        }
                        number::parse(text, self.book.date1904)
                    }
                    _ => value.numeric(),
                };
                let Some(n) = n else {
                    return Some(Value::Error("#VALUE!"));
                };
                if !n.is_finite() || !(0. ..=4.).contains(&n.trunc()) {
                    return Some(Value::Error("#NUM!"));
                }
                n.trunc()
            };
        }
        self.work = self.work.checked_sub(128)?;
        let [start, end, basis] = numbers;
        Some(Value::number(year_fraction(
            start as i64,
            end as i64,
            basis as u32,
            self.book.date1904,
        )))
    }
}

// Shared by YEARFRAC and securities after argument/date validation.
pub(super) fn year_fraction(start: i64, end: i64, basis: u32, date1904: bool) -> f64 {
    let (start, end) = (start.min(end), start.max(end));
    let (y1, m1, d1) = calendar(start, date1904);
    let (y2, m2, d2) = calendar(end, date1904);
    let actual = (end - start) as f64;
    let result = match basis {
        0 | 4 => {
            let (mut day1, mut day2) = (d1, d2);
            if basis == 0 {
                // Financial US 30/360 tests the original start day before
                // normalizing February ends; DAYS360 has different rules.
                let feb1 = m1 == 2 && d1 == if leap(y1) { 29 } else { 28 };
                let feb2 = m2 == 2 && d2 == if leap(y2) { 29 } else { 28 };
                if feb1 && feb2 {
                    day2 = 30;
                }
                if day2 == 31 && day1 >= 30 {
                    day2 = 30;
                }
                if day1 == 31 || feb1 {
                    day1 = 30;
                }
            } else {
                day1 = day1.min(30);
                day2 = day2.min(30);
            }
            ((y2 - y1) * 360 + (i64::from(m2) - i64::from(m1)) * 30 + i64::from(day2)
                - i64::from(day1)) as f64
                / 360.
        }
        1 => {
            let within_year = y1 == y2 || y2 == y1 + 1 && (m1, d1) >= (m2, d2);
            let denominator = if !within_year {
                // Count Gregorian days arithmetically, without iterating
                // through every year. The fictitious 1900 day is excluded.
                (days_from_civil(y2 + 1, 1, 1) - days_from_civil(y1, 1, 1)) as f64
                    / (y2 - y1 + 1) as f64
            } else {
                let feb29 = (y1 == y2 && leap(y1))
                    || (m2, d2) == (2, 29)
                    || (y2 == y1 + 1 && (leap(y1) && m1 <= 2 || leap(y2) && m2 > 2));
                if feb29 { 366. } else { 365. }
            };
            actual / denominator
        }
        2 => actual / 360.,
        _ => actual / 365.,
    };
    result.abs()
}

pub(super) fn day_count(
    name: &str,
    args: &[&Value],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    let nasd = name == "DAYS360";
    let mut dates = [0; 2];
    for (arg, date) in args.iter().zip(&mut dates) {
        *date = match serial(arg, date1904, nasd, work)? {
            Ok(day) => day,
            Err(e) => return Some(Value::Error(e)),
        };
    }
    if !nasd {
        // DAYS takes the end date first.
        return Some(Value::Number((dates[0] - dates[1]) as f64));
    }
    let european = match args.get(2).copied().unwrap_or(&Value::Blank) {
        Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
        Value::Text(text) | Value::UninternedText(text) => {
            if text.eq_ignore_ascii_case("true") {
                true
            } else if text.eq_ignore_ascii_case("false") {
                false
            } else {
                return Some(Value::Error("#VALUE!"));
            }
        }
        value => match value.numeric() {
            Some(n) => n != 0.,
            None => return Some(Value::Error("#VALUE!")),
        },
    };
    *work = work.checked_sub(64)?;
    let (y1, m1, mut d1) = calendar(dates[0], date1904);
    let (y2, m2, mut d2) = calendar(dates[1], date1904);
    if european {
        d1 = d1.min(30);
        d2 = d2.min(30);
    } else {
        // Preserve argument order. US 30/360 is not antisymmetric at month ends.
        // Only the starting February month end advances to day 30.
        if d1 == 31 || m1 == 2 && d1 == days_in_month(y1, 2, date1904) {
            d1 = 30;
        }
        if d2 == 31 && d1 == 30 {
            d2 = 30;
        }
    }
    Some(Value::Number(
        ((y2 - y1) * 360 + (i64::from(m2) - i64::from(m1)) * 30 + i64::from(d2) - i64::from(d1))
            as f64,
    ))
}

// EDATE/EOMONTH use Gregorian target-month lengths, even for February 1900.
// The input calendar still includes serial zero and Excel's fictitious leap day.
pub(super) fn month_shift(
    name: &str,
    args: &[&Value],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    if matches!(args[0], Value::Bool(_)) {
        return Some(Value::Error("#VALUE!"));
    }
    let start = match serial(args[0], date1904, false, work)? {
        Ok(day) => day,
        Err(e) => return Some(Value::Error(e)),
    };
    let months = match args[1] {
        Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
        Value::Bool(_) => return Some(Value::Error("#VALUE!")),
        Value::Text(text) | Value::UninternedText(text) => {
            *work = work.checked_sub(text.len().checked_mul(2)?)?;
            if text.trim().eq_ignore_ascii_case("true") || text.trim().eq_ignore_ascii_case("false")
            {
                return Some(Value::Error("#VALUE!"));
            }
            number::parse(text, date1904)
        }
        value => value.numeric(),
    };
    let Some(months) = months else {
        return Some(Value::Error("#VALUE!"));
    };
    if !months.is_finite() || !(-2147483648. ..=2147483647.).contains(&months.trunc()) {
        return Some(Value::Error("#NUM!"));
    }
    let (year, month, day) = calendar(start, date1904);
    let shifted = year * 12 + i64::from(month) - 1 + months.trunc() as i64;
    let year = shifted.div_euclid(12);
    let month = shifted.rem_euclid(12) + 1;
    if !(if date1904 { 1904 } else { 1900 }..=9999).contains(&year) {
        return Some(Value::Error("#NUM!"));
    }
    let first = days_from_civil(year, month, 1);
    let next = days_from_civil(year + i64::from(month == 12), month % 12 + 1, 1);
    let day = if name == "EOMONTH" {
        next - first
    } else {
        i64::from(day).min(next - first)
    };
    let serial = if date1904 {
        first - days_from_civil(1904, 1, 1)
    } else {
        first - days_from_civil(1899, 12, 31) + i64::from((year, month) >= (1900, 3))
    } + day
        - 1;
    Some(if serial < 0 {
        Value::Error("#NUM!")
    } else {
        Value::Number(serial as f64)
    })
}

use super::{Calculation, Coord, Expr, Value, date_difference, date_text, lookup::number};
use crate::commands::coreutils::{civil_from_days, days_from_civil};

pub(super) fn arguments(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "DATE" | "TIME" => (3, 3),
        "YEAR" | "MONTH" | "DAY" | "HOUR" | "MINUTE" | "SECOND" | "ISOWEEKNUM" => (1, 1),
        "WEEKDAY" | "WEEKNUM" => (1, 2),
        "WEEKNUM_OOO" | "WEEKNUM_EXCEL2003" => (2, 2),
        "_XLFN.DAYS" | "EDATE" | "EOMONTH" => (2, 2),
        _ => return None,
    })
}

fn approximate(n: f64) -> f64 {
    if n == 0. || n.abs() > 2199023255552. || (n * 2048.).fract() == 0. {
        return n;
    }
    let scale = 10f64.powi(14 - n.abs().log10().floor() as i32);
    let scaled = n * scale;
    if scaled.is_finite() {
        scaled.round() / scale
    } else {
        n
    }
}

fn integer(n: f64, bits: u32, floor: bool) -> Result<i64, &'static str> {
    let n = approximate(n);
    let n = if floor { n.floor() } else { n.trunc() };
    let bound = (1u64 << (bits - 1)) as f64;
    if !(-bound..bound).contains(&n) {
        Err("Err:502")
    } else {
        Ok(n as i64)
    }
}

fn calendar(serial: f64, epoch: i64) -> Result<(i64, u32, u32), &'static str> {
    // Calc's date class adds signed 32-bit day counts and clamps its year range.
    let days = (integer(serial, 32, true)? as i32).wrapping_add((epoch + 719163) as i32);
    Ok(civil_from_days(
        i64::from(days.clamp(-11968265, 11967900)) - 719163,
    ))
}

fn week(year: i64, month: u32, day: u32, start: i64, iso: bool) -> i64 {
    let first = days_from_civil(year, 1, 1);
    let current = days_from_civil(year, month.into(), day.into());
    // Native weekday arithmetic retains the signed remainder for BC dates.
    let offset = ((first + 719162) % 7 + 7 - start) % 7;
    let ordinal = current - first;
    if !iso {
        let week = (ordinal + offset) / 7 + 1;
        let next = days_from_civil((year + 1).min(32767), 1, 1);
        let next_offset = ((next + 719162) % 7 + 7 - start) % 7;
        if week == 54
            || week == 53 && ordinal > days_from_civil(year + 1, 1, 1) - first - next_offset - 1
        {
            1
        } else {
            week
        }
    } else {
        let first_week = if offset < 4 { -offset } else { 7 - offset };
        if ordinal < first_week {
            let previous = days_from_civil((year - 1).max(-32767), 1, 1);
            let offset = ((previous + 719162) % 7 + 7 - start) % 7;
            if offset == 3 || offset == 2 && first - previous == 366 {
                53
            } else {
                52
            }
        } else {
            let week = (ordinal - first_week) / 7 + 1;
            let next = days_from_civil(year + 1, 1, 1);
            let next_offset = ((next + 719162) % 7 + 7 - start) % 7;
            if week == 53 && next_offset < 4 && current >= next - next_offset {
                1
            } else {
                week
            }
        }
    }
}

impl Calculation<'_> {
    pub(super) fn date_function(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let name = if name == "WEEKNUM_EXCEL2003" {
            "WEEKNUM"
        } else {
            name
        };
        let excel_week =
            self.dynamic.is_some() && matches!(name, "WEEKDAY" | "WEEKNUM" | "ISOWEEKNUM");
        let sequential = excel_week && name != "ISOWEEKNUM";
        let maximum_serial = if self.book.date1904 {
            2_957_003.
        } else {
            2_958_465.
        };
        let invalid_method = if excel_week { "#NUM!" } else { "Err:502" };
        let mut values = [Value::Blank, Value::Blank, Value::Blank];
        if !sequential {
            for (index, arg) in args.iter().enumerate() {
                let value = self.eval(arg, pos, depth + 1, true)?;
                let value = self.scalar(value, pos, depth + 1)?;
                if matches!(value, Value::Error(_)) {
                    return Some(value);
                }
                values[index] = value;
            }
        }
        let mut numbers = [0.; 3];
        for step in 0..args.len() {
            let index = if sequential {
                step
            } else {
                args.len() - step - 1
            };
            if sequential {
                // Excel coerces the date before propagating return_type errors.
                let value = self.eval(&args[index], pos, depth + 1, true)?;
                values[index] = self.scalar(value, pos, depth + 1)?;
            }
            let value = &values[index];
            if excel_week && name == "WEEKNUM" && matches!(value, Value::Bool(_)) {
                return Some(Value::Error("#VALUE!"));
            }
            let number = match value {
                Value::Text(text) | Value::UninternedText(text) => {
                    if self.dynamic.is_some()
                        && index == 0
                        && matches!(
                            name,
                            "YEAR" | "MONTH" | "DAY" | "WEEKDAY" | "WEEKNUM" | "ISOWEEKNUM"
                        )
                    {
                        self.work = self.work.checked_sub(text.len().checked_mul(2)?)?;
                        date_text::parse(text, self.book.date1904)
                            .map(|(day, time)| day as f64 + time)
                            .or_else(|| number::parse(text, self.book.date1904))
                    } else {
                        number::parse(text, self.book.date1904)
                    }
                }
                Value::Error(error) | Value::LiteralError(error) => {
                    return Some(Value::Error(error));
                }
                _ => value.numeric(),
            };
            let Some(number) = number else {
                return Some(Value::Error("#VALUE!"));
            };
            // WEEKNUM checks the date's domain before reading return_type.
            // WEEKDAY only checks that domain after coercing both arguments.
            if excel_week
                && name == "WEEKNUM"
                && index == 0
                && (!number.is_finite() || !(0. ..=maximum_serial).contains(&number.floor()))
            {
                return Some(Value::Error("#NUM!"));
            }
            let bits = if name == "DATE" && self.dynamic.is_none()
                || matches!(name, "WEEKDAY" | "WEEKNUM" | "WEEKNUM_OOO") && index == 1
            {
                Some(16)
            } else if matches!(name, "EDATE" | "EOMONTH") {
                Some(32)
            } else {
                None
            };
            numbers[index] = if let Some(bits) = bits {
                match integer(number, bits, false) {
                    Ok(n) => n as f64,
                    Err(e) => return Some(Value::Error(if excel_week { "#NUM!" } else { e })),
                }
            } else {
                number
            };
        }
        let epoch = if self.book.date1904 {
            days_from_civil(1904, 1, 1)
        } else {
            days_from_civil(1899, 12, 30)
        };
        let result = (|| -> Result<f64, &'static str> {
            let [a, b, c] = numbers;
            Ok(match name {
                "DATE" => {
                    if self.dynamic.is_some() {
                        // IronCalc's Excel calendar checks year, then rolled month,
                        // then day. Add days in serial space to include 1900-02-29.
                        let offset = if self.book.date1904 { 1904 } else { 1900 };
                        let year = a.floor();
                        if !year.is_finite()
                            || !(0. ..=9999.).contains(&year)
                            || !(-32767. ..=32766.).contains(&b.floor())
                            || !c.is_finite()
                        {
                            return Err("#NUM!");
                        }
                        let year = year as i64;
                        let year = if year < offset { year + offset } else { year };
                        if year > 9999 {
                            return Err("#NUM!");
                        }
                        let month = b.floor() as i64;
                        let year = year + (month - 1).div_euclid(12);
                        let month = (month - 1).rem_euclid(12) + 1;
                        if !(offset..=9999).contains(&year) {
                            return Err("#NUM!");
                        }
                        let day = if (-32768. ..=32767.).contains(&c.floor()) {
                            c.floor() as i64
                        } else {
                            32767
                        };
                        let first = days_from_civil(year, month, 1);
                        let serial = if self.book.date1904 {
                            first - days_from_civil(1904, 1, 1)
                        } else {
                            first - days_from_civil(1899, 12, 31)
                                + i64::from((year, month) >= (1900, 3))
                        } + day
                            - 1;
                        let maximum = if self.book.date1904 {
                            2_957_003
                        } else {
                            2_958_465
                        };
                        if !(0..=maximum).contains(&serial) {
                            return Err("#NUM!");
                        }
                        return Ok(serial as f64);
                    }
                    let day = integer(c, 16, false)?;
                    let month = integer(b, 16, false)?;
                    if matches!(args[0], Expr::Value(Value::Blank)) {
                        return Err("Err:511");
                    }
                    let mut year = integer(a, 16, false)?;
                    if year < 0 {
                        return Err("Err:502");
                    }
                    if year < 100 {
                        year += if year < 30 { 2000 } else { 1900 };
                    }
                    year = (year + (month - 1).div_euclid(12)) as i16 as i64;
                    let month = (month - 1).rem_euclid(12) + 1;
                    let date = days_from_civil(year, month, 1) + day - 1;
                    if date < days_from_civil(1582, 10, 15) {
                        return Err("#VALUE!");
                    }
                    (date.min(days_from_civil(32767, 12, 31)) - epoch) as f64
                }
                "TIME" => {
                    if self.dynamic.is_some() {
                        // Excel discards component fractions before normalizing.
                        // Negative components may offset positive ones, provided
                        // their total is nonnegative (IronCalc fn_time).
                        let [hour, minute, second] = [a.floor(), b.floor(), c.floor()];
                        let total = hour * 3600. + minute * 60. + second;
                        if [hour, minute, second].iter().any(|&n| n > 32767.)
                            || !total.is_finite()
                            || total < 0.
                        {
                            return Err("#NUM!");
                        }
                        return Ok(total.rem_euclid(86400.) / 86400.);
                    }
                    let time = (a * 3600. + b * 60. + c) % 86400. / 86400.;
                    if time < 0. {
                        return Err("Err:502");
                    }
                    time
                }
                "_XLFN.DAYS" => a - b,
                "HOUR" | "MINUTE" | "SECOND" => {
                    if self.dynamic.is_some() {
                        if !a.is_finite() || a < 0. && !self.book.date1904 {
                            return Err("#NUM!");
                        }
                        let value = a.abs();
                        let maximum = if self.book.date1904 {
                            2_957_003.
                        } else {
                            2_958_465.
                        };
                        let seconds = (value.fract() * 86400.).round();
                        if value >= maximum + 1. || value.floor() == maximum && seconds >= 86400. {
                            return Err("#NUM!");
                        }
                        // All three components share the same rounded clock,
                        // including carries across minutes, hours and midnight.
                        let seconds = seconds as u32 % 86400;
                        return Ok(match name {
                            "HOUR" => seconds / 3600,
                            "MINUTE" => seconds / 60 % 60,
                            _ => seconds % 60,
                        } as f64);
                    }
                    let fraction = a - approximate(a).floor();
                    if fraction <= 0. || fraction >= 1. {
                        return Ok(0.);
                    }
                    let decimals = if a.abs() >= 1. {
                        (10 - a.abs().log10().ceil() as i32).clamp(2, 9)
                    } else {
                        9
                    };
                    let factor = 10f64.powi(decimals);
                    let raw = fraction * 86400.;
                    let rounded = (raw * factor).round() / factor;
                    let seconds = if rounded >= 86400. { raw } else { rounded };
                    match name {
                        "HOUR" => (seconds / 3600.).floor(),
                        "MINUTE" => (seconds / 60.).floor() % 60.,
                        _ => seconds.round() % 60.,
                    }
                }
                "EDATE" | "EOMONTH" => {
                    if args
                        .iter()
                        .any(|arg| matches!(arg, Expr::Value(Value::Blank)))
                    {
                        return Err("Err:502");
                    }
                    let serial = integer(a, 32, false)?;
                    let months = integer(b, 32, false)?;
                    let days = (serial as i32).wrapping_add((epoch + 719163) as i32);
                    if days < 0 {
                        return Err("Err:502");
                    }
                    // The month-shift calendar counts day zero as 0000-12-30,
                    // and starts year zero one day after the Gregorian epoch.
                    let (year, month, day) = if days == 0 {
                        (0, 12, 30)
                    } else {
                        civil_from_days(i64::from(days) - 719163)
                    };
                    let shifted = (month as i32).wrapping_add(months as i32) as i64;
                    let target_year = year + (shifted - 1).div_euclid(12);
                    if name == "EDATE" && !(0..=32767).contains(&target_year) {
                        return Err("Err:502");
                    }
                    let target_year = if name == "EOMONTH" {
                        target_year as u16 as i64
                    } else {
                        target_year
                    };
                    let target_month = (shifted - 1).rem_euclid(12) + 1;
                    let first = days_from_civil(target_year, target_month, 1);
                    let next = if target_month == 12 {
                        days_from_civil(target_year + 1, 1, 1)
                    } else {
                        days_from_civil(target_year, target_month + 1, 1)
                    };
                    (first
                        + if name == "EOMONTH" {
                            next - first
                        } else {
                            i64::from(day).min(next - first)
                        }
                        - 1
                        - epoch
                        + i64::from(target_year == 0)) as f64
                }
                _ => {
                    if excel_week
                        && name != "WEEKNUM"
                        && (!a.is_finite() || !(0. ..=maximum_serial).contains(&a.floor()))
                    {
                        return Err("#NUM!");
                    }
                    let (year, month, day) =
                        if self.dynamic.is_some() && matches!(name, "YEAR" | "MONTH" | "DAY") {
                            let maximum = if self.book.date1904 {
                                2_957_003.
                            } else {
                                2_958_465.
                            };
                            if !a.is_finite() || !(0. ..=maximum).contains(&a.floor()) {
                                return Err("#NUM!");
                            }
                            date_difference::calendar(a.floor() as i64, self.book.date1904)
                        } else {
                            calendar(a, epoch)?
                        };
                    match name {
                        "YEAR" => (if year <= 0 { year - 1 } else { year }) as f64,
                        "MONTH" => month as f64,
                        "DAY" => day as f64,
                        _ => {
                            let method = if args.len() == 1
                                || name == "WEEKNUM" && matches!(args[1], Expr::Value(Value::Blank))
                            {
                                1
                            } else {
                                integer(b, 16, false)?
                            };
                            if name == "WEEKNUM_OOO" {
                                return Ok(week(
                                    year,
                                    month,
                                    day,
                                    if method == 1 { 6 } else { 0 },
                                    true,
                                ) as f64);
                            }
                            let start = match method {
                                1 | 17 => 6,
                                2 | 3 | 11 | 21 => 0,
                                150 if !excel_week => 0,
                                12..=16 => method - 11,
                                _ => return Err(invalid_method),
                            };
                            if name == "WEEKDAY" {
                                if matches!(method, 21 | 150) {
                                    return Err(invalid_method);
                                }
                                let weekday =
                                    (days_from_civil(year, month.into(), day.into()) + 719162) % 7;
                                (if method == 1 {
                                    if weekday == 6 { 1 } else { weekday + 2 }
                                } else if method == 2 {
                                    weekday + 1
                                } else if method == 3 {
                                    weekday
                                } else {
                                    (weekday - start).rem_euclid(7) + 1
                                }) as f64
                            } else {
                                if method == 3 && name == "WEEKNUM" {
                                    return Err(invalid_method);
                                }
                                if name == "WEEKNUM"
                                    && self.dynamic.is_some()
                                    && !matches!(method, 21 | 150)
                                {
                                    // Excel's non-ISO weeks stay in the calendar year,
                                    // including week 54. Calc rolls its last week into 1.
                                    let serial = a.floor() as i64;
                                    let (year, _, _) =
                                        date_difference::calendar(serial, self.book.date1904);
                                    let first = if self.book.date1904 {
                                        days_from_civil(year, 1, 1) - epoch
                                    } else {
                                        days_from_civil(year, 1, 1) - days_from_civil(1899, 12, 31)
                                            + i64::from(year > 1900)
                                    };
                                    let offset = (first + epoch + 719162 - start).rem_euclid(7);
                                    return Ok(((serial - first + offset).div_euclid(7) + 1) as f64);
                                }
                                week(
                                    year,
                                    month,
                                    day,
                                    if name == "ISOWEEKNUM" { 0 } else { start },
                                    name == "ISOWEEKNUM" || matches!(method, 21 | 150),
                                ) as f64
                            }
                        }
                    }
                }
            })
        })();
        Some(match result {
            Ok(n) => Value::number(n),
            Err(error) => Value::Error(error),
        })
    }
}

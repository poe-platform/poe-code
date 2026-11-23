use super::{Calculation, Coord, Expr, Value, financial::odd_first, lookup::number, production};
use crate::commands::coreutils::{civil_from_days, days_from_civil};

pub(super) fn arguments(name: &str, gnumeric: bool) -> Option<(usize, usize)> {
    Some(match name {
        "DATE" | "TIME" => (3, 3),
        "ODF.TIME" if gnumeric => (3, 3),
        "DATEVALUE" | "TIMEVALUE" | "ISOYEAR" if gnumeric => (1, 1),
        "DAYS360" if gnumeric => (2, 3),
        "DATEDIF" if gnumeric => (3, 3),
        "WORKDAY" | "NETWORKDAYS" if gnumeric => (2, 4),
        "YEAR" | "MONTH" | "DAY" | "HOUR" | "MINUTE" | "SECOND" | "ISOWEEKNUM" => (1, 1),
        "WEEKDAY" | "WEEKNUM" => (1, 2),
        "WEEKNUM_OOO" | "WEEKNUM_EXCEL2003" if !gnumeric => (2, 2),
        "EOMONTH" if gnumeric => (1, 2),
        "_XLFN.DAYS" | "EDATE" | "EOMONTH" => (2, 2),
        _ => return None,
    })
}

pub(super) fn public_date(name: &str, args: &[&Value], mac: bool) -> Value {
    let mut numbers = [0.; 3];
    if matches!(name, "WEEKDAY" | "WEEKNUM") {
        numbers[1] = 1.;
    }
    for (index, value) in args.iter().enumerate() {
        if name == "DATEDIF" && index == 2 {
            if let Value::Error(e) | Value::LiteralError(e) = value {
                return Value::Error(e);
            }
            continue;
        }
        numbers[index] = match production::operand(value, mac) {
            Ok(n) => n,
            Err(e) => return Value::Error(e),
        };
    }
    let [a, b, c] = numbers;
    let result = (|| -> Result<f64, &'static str> {
        Ok(match name {
            "DATEVALUE" => {
                if !(-2147483648. ..2147483647.).contains(&a) {
                    2147483647.
                } else {
                    (a + 0.5 / 86400.).floor()
                }
            }
            "TIMEVALUE" => a - a.trunc(),
            "DAYS360" => {
                let from = odd_first::date(a, mac).ok_or("#VALUE!")?;
                let to = odd_first::date(b, mac).ok_or("#VALUE!")?;
                odd_first::day_count(
                    from,
                    to,
                    if c.floor() == 0. {
                        0
                    } else if c.floor() == 2. {
                        6
                    } else {
                        4
                    },
                )
            }
            "DATEDIF" => {
                if a.floor() > b.floor() {
                    return Err("#NUM!");
                }
                let from = odd_first::date(a.floor(), mac).ok_or("#VALUE!")?;
                let to = odd_first::date(b.floor(), mac).ok_or("#VALUE!")?;
                let unit = match args[2] {
                    Value::Text(unit) | Value::UninternedText(unit) => unit.as_str(),
                    _ => return Err("#VALUE!"),
                };
                let (y1, m1, d1) = civil_from_days(from);
                let (y2, m2, d2) = civil_from_days(to);
                let months = (y2 - y1) * 12 + i64::from(m2) - i64::from(m1) - i64::from(d2 < d1);
                let years = months.div_euclid(12);
                match unit {
                    "d" => (to - from) as f64,
                    "m" => months as f64,
                    "y" => years as f64,
                    "ym" => (months % 12) as f64,
                    "md" | "yd" => {
                        let adjusted = odd_first::shift(
                            from,
                            if unit == "md" { months } else { years * 12 },
                            false,
                        );
                        let (year, month, day) = civil_from_days(adjusted);
                        let base = 2004 + (year & 3);
                        let start = days_from_civil(base, month.into(), day.into())
                            + if unit == "md" {
                                i64::from(d1) - i64::from(day)
                            } else {
                                0
                            };
                        let end = days_from_civil(base + y2 - year, m2.into(), d2.into());
                        (end - start) as f64
                    }
                    _ => return Err("#VALUE!"),
                }
            }
            "DATE" => {
                let month = b.floor();
                if !(0. ..10000.).contains(&a) || month.abs() > 120000. {
                    return Err("#NUM!");
                }
                let year = (if a < 1000. { a + 1900. } else { a }).trunc() as i64;
                let day = c.floor();
                let day = if !(-32768. ..32768.).contains(&day) {
                    32767
                } else {
                    day as i64
                };
                let month = month as i64 - 1;
                let date =
                    days_from_civil(year + month.div_euclid(12), month.rem_euclid(12) + 1, 1) + day
                        - 1;
                if !(1582..11900).contains(&civil_from_days(date).0) {
                    return Err("#NUM!");
                }
                odd_first::serial(date, mac)
            }
            "TIME" => {
                let hour = a % 24.;
                if hour < 0. || b < 0. || c < 0. {
                    return Err("#NUM!");
                }
                let time = (hour * 3600. + b * 60. + c) / 86400.;
                time - time.floor()
            }
            "ODF.TIME" => (a * 3600. + b * 60. + c) / 86400.,
            "HOUR" | "MINUTE" | "SECOND" => {
                if !(-2147483648. ..2147483647.).contains(&a) {
                    return Err("#NUM!");
                }
                let seconds = ((a - a.floor()) * 86400.).round() % 86400.;
                match name {
                    "HOUR" => (seconds / 3600.).floor(),
                    "MINUTE" => (seconds / 60.).floor() % 60.,
                    _ => seconds % 60.,
                }
            }
            "_XLFN.DAYS" => {
                let to = odd_first::date(a.floor(), mac).ok_or("#VALUE!")?;
                let from = odd_first::date(b.floor(), mac).ok_or("#VALUE!")?;
                (to - from) as f64
            }
            _ => {
                let date = odd_first::date(a, mac).ok_or(
                    if matches!(name, "EOMONTH" | "WEEKNUM" | "ISOWEEKNUM" | "ISOYEAR") {
                        "#VALUE!"
                    } else {
                        "#NUM!"
                    },
                )?;
                let (year, month, day) = civil_from_days(date);
                match name {
                    "YEAR" => year as f64,
                    "MONTH" => month as f64,
                    "DAY" => day as f64,
                    "ISOYEAR" => civil_from_days(date + 3 - (date + 3).rem_euclid(7)).0 as f64,
                    "EDATE" | "EOMONTH" => {
                        if name == "EDATE" && a < 0. || b.abs() > 1073741823. {
                            return Err("#NUM!");
                        }
                        let shifted = odd_first::shift(date, b.trunc() as i64, name == "EOMONTH");
                        if !(1900..=9999).contains(&civil_from_days(shifted).0) {
                            return Err("#NUM!");
                        }
                        odd_first::serial(shifted, mac)
                    }
                    "WEEKDAY" => {
                        let method = b.trunc();
                        if ![1., 2., 3., 11., 12., 13., 14., 15., 16., 17.].contains(&method) {
                            return Err("#NUM!");
                        }
                        let start = if method == 1. || method == 17. {
                            0
                        } else if method <= 3. {
                            1
                        } else {
                            method as i64 - 10
                        };
                        ((date + 4 - start).rem_euclid(7) + i64::from(method != 3.)) as f64
                    }
                    _ => {
                        let method = if name == "ISOWEEKNUM" { 21. } else { b.floor() };
                        if ![1., 2., 21., 150.].contains(&method) {
                            return Err("#VALUE!");
                        }
                        if method > 2. {
                            let thursday = date + 3 - (date + 3).rem_euclid(7);
                            (1 + (thursday - days_from_civil(civil_from_days(thursday).0, 1, 1))
                                / 7) as f64
                        } else {
                            let first = days_from_civil(year, 1, 1);
                            let offset = (first + if method == 1. { 4 } else { 3 }).rem_euclid(7);
                            (1 + (date - first + offset) / 7) as f64
                        }
                    }
                }
            }
        })
    })();
    match result {
        Ok(n) => Value::number(n),
        Err(e) => Value::Error(e),
    }
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

pub(super) fn addin_calendar(serial: i32, epoch: i64) -> Result<(i64, u32, u32), &'static str> {
    let days = serial.wrapping_add((epoch + 719163) as i32);
    if days < 0 {
        return Err("Err:502");
    }
    // The add-in calendar places days zero and one in year zero before
    // resuming the Gregorian calendar at 0001-01-02.
    Ok(if days <= 1 {
        (0, 12, days as u32 + 30)
    } else {
        civil_from_days(i64::from(days) - 719163)
    })
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
    pub(super) fn public_workday(
        &mut self,
        name: &str,
        args: &[&Value],
        depth: usize,
    ) -> Option<Value> {
        let mut numbers = [0.; 2];
        for (index, value) in args.iter().take(2).enumerate() {
            numbers[index] = match production::operand(value, self.book.date1904) {
                Ok(n) => n,
                Err(e) => return Some(Value::Error(e)),
            };
        }
        let [start, input] = numbers;
        let start = (start + 0.5 / 86400.).floor();
        let end = (input + 0.5 / 86400.).floor();
        let network = name == "NETWORKDAYS";
        if network && (start <= 0. || end <= 0.) {
            return Some(Value::Error("#NUM!"));
        }
        let Some(mut date) = odd_first::date(start, self.book.date1904) else {
            return Some(Value::Error("#VALUE!"));
        };
        let other = odd_first::date(end, self.book.date1904);
        if network && other.is_none() {
            return Some(Value::Error("#VALUE!"));
        }
        if !network && input.abs() > 1073741823. {
            return Some(Value::Error("#NUM!"));
        }
        let mut weekend = if args.len() == 4 {
            Vec::new()
        } else {
            vec![1., 0., 0., 0., 0., 0., 1.]
        };
        let mut holidays = std::collections::BTreeSet::new();
        // Weekend masks are consumed before holidays, including the early
        // result for a calendar with no working weekdays.
        for index in [3, 2] {
            if let Some(value) = args.get(index) {
                let mut pending = vec![(*value).clone()];
                while let Some(value) = pending.pop() {
                    self.tick(depth)?;
                    if let Value::Set(values) = value {
                        pending.extend(values.into_iter().rev());
                        continue;
                    }
                    for value in self.matrix(value, depth + 1)?.into_iter().flatten() {
                        self.tick(depth)?;
                        if matches!(
                            value,
                            Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                        ) || index == 2 && matches!(value, Value::Bool(_))
                        {
                            continue;
                        }
                        if let Value::Error(e) | Value::LiteralError(e) = value {
                            return Some(Value::Error(e));
                        }
                        let n = value.numeric().unwrap_or(f64::NAN);
                        if index == 3 {
                            weekend.push(n);
                        } else {
                            if n < 0. || odd_first::date(n.trunc(), self.book.date1904).is_none() {
                                return Some(Value::Error("#VALUE!"));
                            }
                            self.work = self.work.checked_sub(std::mem::size_of::<i64>())?;
                            holidays.insert(n.trunc() as i64);
                        }
                    }
                }
            }
            if index == 3 {
                if weekend.len() != 7 || weekend.iter().any(|n| n.is_nan()) {
                    return Some(Value::Error("#VALUE!"));
                }
                if weekend.iter().all(|n| *n != 0.) {
                    return Some(if network {
                        Value::Number(0.)
                    } else if input.trunc() != 0. {
                        Value::Error("#VALUE!")
                    } else {
                        Value::Number(odd_first::serial(date, self.book.date1904))
                    });
                }
            }
        }
        let weekday = |date: i64| (date + 4).rem_euclid(7) as usize;
        if network {
            let other = other?;
            let (first, last) = (date.min(other), date.max(other));
            let weeks = (last - first + 1) / 7;
            let mut count = weeks * weekend.iter().filter(|n| **n == 0.).count() as i64;
            for day in first + weeks * 7..=last {
                self.tick(depth)?;
                count += i64::from(weekend[weekday(day)] == 0.);
            }
            for serial in holidays {
                self.tick(depth)?;
                let day = odd_first::date(serial as f64, self.book.date1904)?;
                if day >= first && day <= last && weekend[weekday(day)] == 0. {
                    count -= 1;
                }
            }
            return Some(Value::Number(count as f64));
        }
        let mut remaining = input.trunc().abs() as i64;
        let step = if input < 0. { -1 } else { 1 };
        if remaining > 0 {
            while weekend[weekday(date)] != 0. {
                self.tick(depth)?;
                date -= step;
            }
        }
        while remaining > 0 {
            self.tick(depth)?;
            date += step;
            if weekend[weekday(date)] == 0.
                && !holidays.contains(&(odd_first::serial(date, self.book.date1904) as i64))
            {
                remaining -= 1;
            }
        }
        Some(if !(1900..=9999).contains(&civil_from_days(date).0) {
            Value::Error("#NUM!")
        } else {
            Value::Number(odd_first::serial(date, self.book.date1904))
        })
    }

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
        let mut values = [Value::Blank, Value::Blank, Value::Blank];
        for (index, arg) in args.iter().enumerate() {
            let value = self.eval(arg, pos, depth + 1, true)?;
            let mut value = self.scalar(value, pos, depth + 1)?;
            if self.csv && matches!(name, "EDATE" | "EOMONTH") {
                value = match production::operand(&value, self.book.date1904) {
                    Ok(n) => Value::Number(n),
                    Err(e) => return Some(Value::Error(e)),
                };
            }
            if matches!(value, Value::Error(_)) {
                return Some(value);
            }
            values[index] = value;
        }
        let mut numbers = [0.; 3];
        for index in (0..args.len()).rev() {
            let value = &values[index];
            let number = match value {
                Value::Text(text) | Value::UninternedText(text) => {
                    number::parse(text, self.book.date1904)
                }
                Value::LiteralError(error) => return Some(Value::Error(error)),
                _ => value.numeric(),
            };
            let Some(number) = number else {
                return Some(Value::Error("#VALUE!"));
            };
            let bits = if name == "DATE"
                || matches!(name, "WEEKDAY" | "WEEKNUM" | "WEEKNUM_OOO") && index == 1
            {
                Some(16)
            } else if !self.csv && matches!(name, "EDATE" | "EOMONTH") {
                Some(32)
            } else {
                None
            };
            numbers[index] = if let Some(bits) = bits {
                match integer(number, bits, false) {
                    Ok(n) => n as f64,
                    Err(e) => return Some(Value::Error(e)),
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
                    let time = (a * 3600. + b * 60. + c) % 86400. / 86400.;
                    if time < 0. {
                        return Err("Err:502");
                    }
                    time
                }
                "_XLFN.DAYS" => a - b,
                "HOUR" | "MINUTE" | "SECOND" => {
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
                "EDATE" | "EOMONTH" if self.csv => {
                    let date = odd_first::date(a, self.book.date1904)
                        .ok_or(if name == "EDATE" { "#NUM!" } else { "#VALUE!" })?;
                    if name == "EDATE" && a < 0. || b.abs() > 1073741823. {
                        return Err("#NUM!");
                    }
                    let shifted = odd_first::shift(date, b.trunc() as i64, name == "EOMONTH");
                    if !(1900..=9999).contains(&civil_from_days(shifted).0) {
                        return Err("#NUM!");
                    }
                    odd_first::serial(shifted, self.book.date1904)
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
                    let (year, month, day) = addin_calendar(serial as i32, epoch)?;
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
                    let (year, month, day) = calendar(a, epoch)?;
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
                                2 | 3 | 11 | 21 | 150 => 0,
                                12..=16 => method - 11,
                                _ => return Err("Err:502"),
                            };
                            if name == "WEEKDAY" {
                                if matches!(method, 21 | 150) {
                                    return Err("Err:502");
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
                                    return Err("Err:502");
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

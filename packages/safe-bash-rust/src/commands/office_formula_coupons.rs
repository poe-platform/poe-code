use super::{
    super::{Value, dates::addin_calendar},
    daycount, odd_first,
};
use crate::commands::coreutils::days_from_civil;

pub(super) fn calculate_csv(
    name: &str,
    numbers: [f64; 8],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    let [settlement, maturity, frequency, basis, end, ..] = numbers;
    let (Some(settlement), Some(maturity)) = (
        odd_first::date(settlement, date1904),
        odd_first::date(maturity, date1904),
    ) else {
        return Some(Value::Error("#VALUE!"));
    };
    let frequency = frequency.trunc();
    if settlement >= maturity || !matches!(frequency, 1. | 2. | 4.) || !(0. ..6.).contains(&basis) {
        return Some(Value::Error("#NUM!"));
    }
    let basis = basis as i32;
    let (previous, next, days, count) =
        odd_first::coupon(settlement, maturity, frequency, basis, end != 0., work)?;
    Some(Value::number(match name {
        "COUPDAYBS" => odd_first::day_count(previous, settlement, basis),
        "COUPDAYS" => days,
        "COUPDAYSNC" => odd_first::day_count(settlement, next, basis),
        "COUPNCD" => odd_first::serial(next, date1904),
        "COUPPCD" => odd_first::serial(previous, date1904),
        "COUPNUM" => count,
        _ => unreachable!(),
    }))
}

pub(super) fn calculate(
    name: &str,
    settlement: i32,
    maturity: i32,
    frequency: i32,
    basis: &Value,
    date1904: bool,
) -> Result<f64, &'static str> {
    let basis = daycount::basis(basis, date1904)?;
    if settlement >= maturity || !matches!(frequency, 1 | 2 | 4) {
        return Err("Err:502");
    }
    if name == "COUPDAYS" && basis != 1 {
        return Ok(if basis == 3 { 365. } else { 360. } / f64::from(frequency));
    }
    let epoch = if date1904 {
        days_from_civil(1904, 1, 1)
    } else {
        days_from_civil(1899, 12, 30)
    };
    let settlement = Date::new(settlement, basis, epoch)?;
    let maturity = Date::new(maturity, basis, epoch)?;
    let next = name == "COUPNCD" || name == "COUPDAYSNC" && !matches!(basis, 0 | 4);
    let mut coupon = maturity;
    coupon.year = settlement.year;
    if next && coupon.key() > settlement.key() {
        coupon.shift(-12)?;
    } else if !next && coupon.key() < settlement.key() {
        coupon.shift(12)?;
    }
    while if next {
        coupon.key() <= settlement.key()
    } else {
        coupon.key() > settlement.key()
    } {
        coupon.shift(if next { 12 } else { -12 } / frequency)?;
    }
    Ok(match name {
        "COUPPCD" | "COUPNCD" => coupon.serial(epoch) as f64,
        "COUPNUM" => {
            let months = ((maturity.year - coupon.year) * 12 + i64::from(maturity.month)
                - i64::from(coupon.month)) as u16;
            f64::from(i32::from(months) * frequency / 12)
        }
        "COUPDAYBS" => difference(coupon, settlement)? as f64,
        "COUPDAYSNC" if next => difference(settlement, coupon)? as f64,
        "COUPDAYSNC" => 360. / f64::from(frequency) - difference(coupon, settlement)? as f64,
        "COUPDAYS" => {
            let mut following = coupon;
            following.shift(12 / frequency)?;
            difference(coupon, following)? as f64
        }
        _ => unreachable!(),
    })
}

#[derive(Clone, Copy)]
struct Date {
    year: i64,
    month: u32,
    original: u32,
    last: bool,
    basis: i32,
}

impl Date {
    fn new(serial: i32, basis: i32, epoch: i64) -> Result<Self, &'static str> {
        let (year, month, original) = addin_calendar(serial, epoch)?;
        Ok(Self {
            year,
            month,
            original,
            last: original >= month_days(year, month),
            basis,
        })
    }

    fn day(self) -> u32 {
        let last = month_days(self.year, self.month);
        if matches!(self.basis, 0 | 4) {
            if self.last || self.original.min(30) >= last {
                30
            } else {
                self.original.min(30)
            }
        } else if self.last {
            last
        } else {
            self.original.min(last)
        }
    }

    fn key(self) -> (i64, u32, u32, bool, u32) {
        (
            self.year,
            self.month,
            self.day(),
            self.last,
            if self.last { 0 } else { self.original },
        )
    }

    fn shift(&mut self, months: i32) -> Result<(), &'static str> {
        let month = self.month as i32 - 1 + months;
        let year = self.year + i64::from(month.div_euclid(12));
        if year != self.year && !(0..=32767).contains(&year) {
            return Err("Err:502");
        }
        self.year = year;
        self.month = month.rem_euclid(12) as u32 + 1;
        Ok(())
    }

    fn serial(self, epoch: i64) -> i64 {
        let last = month_days(self.year, self.month);
        let day = if self.last {
            last
        } else {
            self.original.min(last)
        };
        // The add-in's year-zero date count uses truncating division.
        days_from_civil(self.year, self.month.into(), day.into()) - epoch
            + i64::from(self.year == 0)
    }
}

fn month_days(year: i64, month: u32) -> u32 {
    let next = if month == 12 {
        days_from_civil(year + 1, 1, 1)
    } else {
        days_from_civil(year, (month + 1).into(), 1)
    };
    (next - days_from_civil(year, month.into(), 1)) as u32
}

fn difference(mut from: Date, mut to: Date) -> Result<i64, &'static str> {
    if from.key() > to.key() {
        std::mem::swap(&mut from, &mut to);
    }
    if from.year != to.year && to.year > 32767 {
        return Err("Err:502");
    }
    let (mut start, mut end) = (from.day(), to.day());
    if to.basis == 0 {
        if (from.month == 2 || start < 30) && to.original == 31 {
            end = 31;
        } else if to.month == 2 && to.last {
            end = month_days(to.year, 2);
        }
    } else if to.basis == 4 {
        if from.month == 2 && start == 30 {
            start = month_days(from.year, 2);
        }
        if to.month == 2 && end == 30 {
            end = month_days(to.year, 2);
        }
    }
    let days = if matches!(to.basis, 0 | 4) {
        (to.year - from.year) * 360
            + (i64::from(to.month) - i64::from(from.month)) * 30
            + i64::from(end)
            - i64::from(start)
    } else {
        days_from_civil(to.year, to.month.into(), end.into())
            - days_from_civil(from.year, from.month.into(), start.into())
    };
    Ok(days.max(0))
}

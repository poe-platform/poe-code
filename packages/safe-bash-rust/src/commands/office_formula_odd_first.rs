use super::power;
use crate::commands::coreutils::{civil_from_days, days_from_civil};

pub(in super::super) fn date(serial: f64, mac: bool) -> Option<i64> {
    if !(-2147483648. ..2147483647.).contains(&serial) {
        return None;
    }
    let day = (serial + 0.5 / 86400.).floor() as i64;
    if !mac && day == 60 {
        return None;
    }
    let days = day
        - if mac {
            24107
        } else if day < 60 {
            25568
        } else {
            25569
        };
    (1..=65535)
        .contains(&civil_from_days(days).0)
        .then_some(days)
}

pub(in super::super) fn serial(date: i64, mac: bool) -> f64 {
    (date
        + if mac {
            24107
        } else if date < -25508 {
            25568
        } else {
            25569
        }) as f64
}

pub(in super::super) fn shift(date: i64, months: i64, end: bool) -> i64 {
    let (year, month, day) = civil_from_days(date);
    let month = i64::from(month) - 1 + months;
    let year = year + month.div_euclid(12);
    let month = month.rem_euclid(12) + 1;
    let first = days_from_civil(year, month, 1);
    let next = days_from_civil(year + i64::from(month == 12), month % 12 + 1, 1);
    first
        + if end {
            next - first
        } else {
            i64::from(day).min(next - first)
        }
        - 1
}

pub(in super::super) fn day_count(from: i64, to: i64, basis: i32) -> f64 {
    if from > to {
        return -day_count(to, from, basis);
    }
    if matches!(basis, 1..=3) {
        return (to - from) as f64;
    }
    let (y1, m1, mut d1) = civil_from_days(from);
    let (y2, mut m2, mut d2) = civil_from_days(to);
    if basis == 4 {
        d1 = d1.min(30);
        d2 = d2.min(30);
    } else if basis == 5 {
        if d1 == 31 {
            d1 = 30;
        }
        if d2 == 31 {
            d2 = 1;
            m2 += 1;
        }
    } else if basis == 6 {
        if m1 == 2 && from == shift(from, 0, true) {
            d1 = 30;
        }
        if m2 == 2 && to == shift(to, 0, true) {
            d2 = 30;
        }
        if d2 == 31 && d1 >= 30 {
            d2 = 30;
        }
        if d1 == 31 {
            d1 = 30;
        }
    } else {
        if d1 == 31 {
            d1 = 30;
        }
        if d2 == 31 && d1 == 30 {
            d2 = 30;
        }
        if m1 == 2 && from == shift(from, 0, true) {
            if m2 == 2 && to == shift(to, 0, true) {
                d2 = 30;
            }
            d1 = 30;
        }
    }
    ((y2 - y1) * 360 + (i64::from(m2) - i64::from(m1)) * 30 + i64::from(d2) - i64::from(d1)) as f64
}

// Shared production coupon calendar, including basis 5 and optional month ends.
pub(super) fn coupon(
    from: i64,
    anchor: i64,
    frequency: f64,
    basis: i32,
    end: bool,
    work: &mut usize,
) -> Option<(i64, i64, f64, f64)> {
    let (y1, m1, _) = civil_from_days(from);
    let (y2, m2, _) = civil_from_days(anchor);
    let months = (y2 - y1) * 12 + i64::from(m2) - i64::from(m1);
    let step = 12 / frequency as i64;
    let end = end && anchor == shift(anchor, 0, true);
    let mut count = months.div_euclid(step).max(1);
    let mut previous = shift(anchor, -count * step, end);
    while previous > from {
        *work = work.checked_sub(1)?;
        count += 1;
        previous = shift(anchor, -count * step, end);
    }
    let next = shift(anchor, -(count - 1) * step, end);
    let days = if basis == 1 {
        day_count(previous, next, 1)
    } else {
        (if basis == 3 { 365. } else { 360. }) / frequency
    };
    Some((previous, next, days, count as f64))
}

pub(super) fn ratio(
    from: i64,
    to: i64,
    anchor: i64,
    frequency: f64,
    basis: i32,
    work: &mut usize,
) -> Option<f64> {
    let (_, next, days, _) = coupon(from, anchor, frequency, basis, true, work)?;
    if next >= to {
        return Some(day_count(from, to, basis) / days);
    }
    let mut result = day_count(from, next, basis) / days;
    let mut previous = next;
    loop {
        *work = work.checked_sub(1)?;
        let next = shift(previous, 12 / frequency as i64, false);
        let days = if basis == 1 {
            day_count(previous, next, 1)
        } else {
            (if basis == 3 { 365. } else { 360. }) / frequency
        };
        if next >= to {
            return Some(result + day_count(previous, to, basis) / days);
        }
        result += 1.;
        previous = next;
    }
}

pub(in super::super) fn calculate(
    name: &str,
    n: [f64; 13],
    mac: bool,
    work: &mut usize,
) -> Option<Result<f64, &'static str>> {
    let [
        settle,
        mature,
        issue,
        first,
        rate,
        amount,
        redemption,
        frequency,
        basis,
        ..,
    ] = n;
    let (Some(settle), Some(mature), Some(issue), Some(first)) = (
        date(settle, mac),
        date(mature, mac),
        date(issue, mac),
        date(first, mac),
    ) else {
        return Some(Err("#VALUE!"));
    };
    let frequency = frequency.trunc();
    if !(0. ..6.).contains(&basis)
        || !matches!(frequency, 1. | 2. | 4.)
        || issue > settle
        || settle > mature
        || settle > first
        || first > mature
        || rate < 0.
        || amount < 0.
        || redemption <= 0.
        || name == "ODDFYIELD" && amount == 0.
    {
        return Some(Err("#NUM!"));
    }
    let basis = basis as i32;
    let mut a = day_count(issue, settle, basis);
    let mut ds = day_count(settle, first, basis);
    let mut df = day_count(issue, first, basis);
    let (_, _, e, mut count) = coupon(settle, mature, frequency, basis, true, work)?;
    if ds > e {
        if matches!(basis, 0 | 4) {
            count = 1. + (day_count(first, mature, basis) / e).ceil();
        } else {
            let mut d = first;
            count = 0.;
            loop {
                *work = work.checked_sub(1)?;
                let next = shift(d, 12 / frequency as i64, false);
                if next >= mature {
                    let days = if basis == 1 {
                        day_count(d, next, 1)
                    } else {
                        (if basis == 3 { 365. } else { 360. }) / frequency
                    };
                    count += (day_count(d, mature, basis) / days).ceil() + 1.;
                    break;
                }
                count += 1.;
                d = next;
            }
            a = e * ratio(issue, settle, first, frequency, basis, work)?;
            ds = e * ratio(settle, first, first, frequency, basis, work)?;
            df = e * ratio(issue, first, first, frequency, basis, work)?;
        }
    }
    let price = |yield_rate: f64| {
        let scale = 100. * rate / frequency;
        let f = 1. + yield_rate / frequency;
        let term1 = redemption / power::pow(f, count - 1. + ds / e);
        let term2 = (df / e) / power::pow(f, ds / e);
        let sum = power::pow(f, -ds / e) * (power::pow(f, -count) - 1. / f) / (1. / f - 1.);
        term1 + scale * (term2 + sum - a / e)
    };
    let result = if name == "ODDFPRICE" {
        price(amount)
    } else {
        solve(|r, _| Some(price(r) - amount), work)?
    };
    Some(if result.is_finite() {
        Ok(result)
    } else {
        Err("#NUM!")
    })
}

pub(super) fn solve(f: impl Fn(f64, &mut usize) -> Option<f64>, work: &mut usize) -> Option<f64> {
    let mut s = super::goal_seek::Solver::new(f, work, 0., 1000., None);
    if s.newton(0.1)? {
        return Some(s.root);
    }
    let mut point = 1e-10;
    while point < 1000. {
        s.point(point)?;
        point *= 2.;
    }
    Some(if s.bisect()? { s.root } else { f64::NAN })
}

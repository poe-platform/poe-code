// Regular coupon schedules, prices and duration adapted from IronCalc's
// financial/{calendar,financial_bonds}.rs (MIT, f93662006b8fb1c401dc870bbda26c5d60ac6037,
// LICENSE.IronCalc). Single-period YIELD follows Univer financial/yield/index.ts
// (Apache-2.0, 4767b3b309467c283bbd52b725536ca73861e0fc, LICENSE.Univer).
// Calendar dates are anchored on maturity. Price uses a geometric sum rather
// than allocating cash flows; yield solves in log-discount space with bounded work.
use super::super::date_difference::{calendar, serial};
use super::{Value, number};
use crate::commands::coreutils::days_from_civil;

fn last_day(year: i64, month: u32) -> u32 {
    (days_from_civil(year + i64::from(month == 12), i64::from(month % 12 + 1), 1)
        - days_from_civil(year, month.into(), 1)) as u32
}

pub(super) fn month_end(day: i64, date1904: bool) -> bool {
    let (y, m, d) = calendar(day, date1904);
    d == if !date1904 && (y, m) == (1900, 2) {
        29
    } else {
        last_day(y, m)
    }
}

pub(super) fn shift(day: i64, months: i64, end: bool, date1904: bool) -> i64 {
    let (year, month, day) = calendar(day, date1904);
    let month = year * 12 + i64::from(month) - 1 + months;
    let (year, month) = (month.div_euclid(12), (month.rem_euclid(12) + 1) as u32);
    // Month arithmetic clamps to the Gregorian month length, including 1900.
    let day = if end {
        last_day(year, month)
    } else {
        day.min(last_day(year, month))
    };
    let days = days_from_civil(year, month.into(), day.into());
    if date1904 {
        days - days_from_civil(1904, 1, 1)
    } else {
        days - days_from_civil(1899, 12, 31) + i64::from((year, month, day) >= (1900, 3, 1))
    }
}

pub(super) fn schedule(
    settlement: i64,
    maturity: i64,
    frequency: i64,
    date1904: bool,
) -> (i64, i64, i64) {
    let (sy, sm, _) = calendar(settlement, date1904);
    let (my, mm, _) = calendar(maturity, date1904);
    let months = 12 / frequency;
    let end = month_end(maturity, date1904);
    let mut count = ((my - sy) * 12 + i64::from(mm) - i64::from(sm)) / months;
    let mut prev = if count == 0 {
        maturity
    } else {
        shift(maturity, -count * months, end, date1904)
    };
    if prev > settlement {
        count += 1;
        prev = shift(maturity, -count * months, end, date1904);
    }
    let next = if count == 1 {
        maturity
    } else {
        shift(maturity, -(count - 1) * months, end, date1904)
    };
    (prev, next, count)
}

pub(super) fn days(start: i64, end: i64, basis: i64, both: bool, date1904: bool) -> f64 {
    if (1..=3).contains(&basis) {
        return (end - start) as f64;
    }
    let (y1, m1, d1) = calendar(start, date1904);
    let (y2, m2, d2) = calendar(end, date1904);
    let (mut a, mut b) = (d1, d2);
    if basis == 4 {
        a = a.min(30);
        b = b.min(30);
    } else {
        let first_feb = m1 == 2 && d1 == last_day(y1, 2);
        let last_feb = m2 == 2 && d2 == last_day(y2, 2);
        if last_feb && (both || first_feb) || b == 31 && (both || a >= 30) {
            b = 30;
        }
        if a == 31 || first_feb {
            a = 30;
        }
    }
    (360 * (y2 - y1) + 30 * (i64::from(m2) - i64::from(m1)) + i64::from(b) - i64::from(a)) as f64
}

pub(super) fn dirty_price(coupon: f64, redemption: f64, n: f64, q: f64, x: f64) -> f64 {
    let coupons = if coupon == 0. {
        0.
    } else if x == 0. {
        coupon * n
    } else if x > 0. {
        coupon * (-q * x).exp() * (-n * x).exp_m1() / (-x).exp_m1()
    } else {
        coupon * (-(q + n - 1.) * x).exp() * (n * x).exp_m1() / x.exp_m1()
    };
    coupons + redemption * (-(q + n - 1.) * x).exp()
}

pub(super) fn calculate(
    name: &str,
    args: &[&Value],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    *work = work.checked_sub(128)?;
    let mut values = [0.; 7];
    for (i, arg) in args.iter().enumerate() {
        match arg {
            Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
            Value::Bool(_) => return Some(Value::Error("#VALUE!")),
            _ => {}
        }
        if i < 2 {
            values[i] = match serial(arg, date1904, false, work)? {
                Ok(v) => v as f64,
                Err(e) => return Some(Value::Error(e)),
            };
        } else {
            let n = match arg {
                Value::Text(s) | Value::UninternedText(s) => {
                    *work = work.checked_sub(s.len().checked_mul(2)?)?;
                    if s.trim().eq_ignore_ascii_case("true")
                        || s.trim().eq_ignore_ascii_case("false")
                    {
                        return Some(Value::Error("#VALUE!"));
                    }
                    number::parse(s, date1904)
                }
                _ => arg.numeric(),
            };
            let Some(n) = n.filter(|n| n.is_finite()) else {
                return Some(Value::Error("#VALUE!"));
            };
            values[i] = n;
        }
    }
    let (settlement, maturity) = (values[0] as i64, values[1] as i64);
    let coupon_fn = name.starts_with("COUP");
    let duration = matches!(name, "DURATION" | "MDURATION");
    let index = if coupon_fn {
        2
    } else if duration {
        4
    } else {
        5
    };
    let (frequency, basis) = (values[index].floor(), values[index + 1].floor());
    if !matches!(frequency, 1. | 2. | 4.) || !(0. ..=4.).contains(&basis) || settlement >= maturity
    {
        return Some(Value::Error("#NUM!"));
    }
    let (frequency, basis) = (frequency as i64, basis as i64);
    let (prev, next, n) = schedule(settlement, maturity, frequency, date1904);
    let e = match basis {
        1 => (next - prev) as f64,
        3 => 365. / frequency as f64,
        _ => 360. / frequency as f64,
    };
    let a = days(prev.max(0), settlement, basis, false, date1904);
    if coupon_fn {
        let value = match name {
            "COUPPCD" => prev.max(0) as f64,
            "COUPNCD" => next as f64,
            "COUPNUM" => {
                if prev < 0 {
                    return Some(Value::Error("#NUM!"));
                } else {
                    n as f64
                }
            }
            "COUPDAYBS" => a,
            "COUPDAYSNC" => {
                if basis == 0 {
                    days(prev.max(0), next, 0, true, date1904) - a
                } else {
                    days(settlement, next, basis, false, date1904)
                }
            }
            "COUPDAYS" => {
                if basis == 1 {
                    // Excel's COUPDAYS actual/actual deliberately uses a drifting
                    // schedule, unlike the anchored period used by PRICE/DURATION.
                    let mut date = maturity;
                    loop {
                        *work = work.checked_sub(64)?;
                        let earlier = shift(date, -12 / frequency, false, date1904);
                        if earlier <= settlement {
                            break;
                        }
                        date = earlier;
                    }
                    let (p, n, _) = schedule(settlement, date, frequency, date1904);
                    (n - p) as f64
                } else {
                    e
                }
            }
            _ => unreachable!(),
        };
        return Some(Value::Number(value));
    }
    let (rate, yld, redemption) = (
        values[2],
        values[3],
        if duration { 100. } else { values[4] },
    );
    if prev < 0
        || rate < 0.
        || yld < 0.
        || redemption <= 0.
        || name == "YIELD" && yld == 0.
        || !date1904 && settlement == 0
    {
        return Some(Value::Error("#NUM!"));
    }
    let f = frequency as f64;
    let q = (e - a) / e;
    // Scale coupon/redemption before multiplying by par; duration and yield
    // ratios remain finite even when an intermediate unscaled price overflows.
    let scale = rate
        .max(redemption / 100.)
        .max(if name == "YIELD" { yld / 100. } else { 0. })
        .max(1.);
    let coupon = rate / scale / f;
    let redemption = redemption / 100. / scale;
    let accrued = coupon * (a / e);
    let result = if duration {
        let last = q + n as f64 - 1.;
        let value = if rate == 0. {
            last / f
        } else {
            *work = work.checked_sub((n as usize).checked_mul(32)?)?;
            let discount = 1. / (1. + yld / f);
            let (mut weight, mut total, mut weighted) = (1., 0., 0.);
            for k in 0..n {
                let flow = coupon * weight + if k == n - 1 { redemption * weight } else { 0. };
                total += flow;
                weighted += (q + k as f64) * flow;
                weight *= discount;
            }
            weighted / total / f
        };
        if name == "MDURATION" {
            value / (1. + yld / f)
        } else {
            value
        }
    } else if name == "PRICE" {
        let dirty = if n == 1 {
            (redemption + coupon) / (1. + q * yld / f)
        } else {
            dirty_price(coupon, redemption, n as f64, q, (yld / f).ln_1p())
        };
        (dirty - accrued) * scale * 100.
    } else {
        let target = yld / 100. / scale + accrued;
        if n == 1 {
            let remaining = days(settlement, maturity, basis, false, date1904);
            ((redemption + coupon - target) / target) * f * e / remaining
        } else {
            let (mut lo, mut hi) = (-36., 710.);
            if q < 0. && coupon > 0. {
                // Actual/360 can put the next payment a little before time
                // zero. Price is then convex but no longer decreasing at all
                // yields. Locate its minimum and solve on the decreasing side.
                let (mut left, mut right) = (0., hi);
                for _ in 0..100 {
                    *work = work.checked_sub(128)?;
                    let a = left + (right - left) / 3.;
                    let b = right - (right - left) / 3.;
                    if dirty_price(coupon, redemption, n as f64, q, a)
                        < dirty_price(coupon, redemption, n as f64, q, b)
                    {
                        right = b;
                    } else {
                        left = a;
                    }
                }
                hi = (left + right) / 2.;
            }
            if dirty_price(coupon, redemption, n as f64, q, lo) < target
                || dirty_price(coupon, redemption, n as f64, q, hi) > target
            {
                return Some(Value::Error("#NUM!"));
            }
            for _ in 0..100 {
                *work = work.checked_sub(64)?;
                let mid = (lo + hi) / 2.;
                if dirty_price(coupon, redemption, n as f64, q, mid) > target {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            ((lo + hi) / 2.).exp_m1() * f
        }
    };
    Some(if result.is_finite() {
        Value::Number(result)
    } else {
        Value::Error("#NUM!")
    })
}

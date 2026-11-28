// Depreciation schedules adapted from IronCalc financial_depreciation.rs
// (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc) and Univer
// financial/{vdb,amorlinc,amordegrc}/index.ts (4767b3b309467c283bbd52b725536ca73861e0fc,
// Apache-2.0, LICENSE.Univer).
use super::Value;
use crate::commands::coreutils::{civil_from_days, days_from_civil};

pub(super) fn declining(cost: f64, salvage: f64, life: f64, period: f64, factor: f64) -> f64 {
    let period = period.max(1.);
    let rate = (factor / life).min(1.);
    let old = if rate == 1. {
        if period == 1. { cost } else { 0. }
    } else {
        cost * (1. - rate).powf(period - 1.)
    };
    let new = cost * (1. - rate).powf(period);
    (old - new.max(salvage)).max(0.)
}

fn total(
    cost: f64,
    salvage: f64,
    life: f64,
    start: f64,
    end: f64,
    factor: f64,
    work: &mut usize,
) -> Option<f64> {
    let mut result = 0.;
    let mut rest = cost - salvage;
    for period in 0..end.ceil() as usize {
        *work = work.checked_sub(64)?;
        let elapsed = period as f64;
        let ddb = declining(cost, salvage, life, elapsed + 1., factor);
        let straight = rest / (life - elapsed);
        if straight > ddb {
            // The straight-line rate is constant after switching.
            return Some(result + straight * (end - start.max(elapsed)));
        }
        // Partial periods retain the original schedule's depreciation rate.
        let share = (end.min(elapsed + 1.) - start.max(elapsed)).max(0.);
        result += ddb * share;
        rest -= ddb;
    }
    Some(result)
}

fn vdb(
    [cost, salvage, life, start, end, factor, no_switch]: [f64; 7],
    work: &mut usize,
) -> Option<Value> {
    if cost < 0.
        || salvage < 0.
        || life < 0.
        || start < 0.
        || end < start
        || end > life
        || factor < 0.
    {
        return Some(Value::Error("#NUM!"));
    }
    if life == 0. {
        return Some(Value::Error("#DIV/0!"));
    }
    if start == end || cost == salvage {
        return Some(Value::Number(0.));
    }
    if cost < salvage {
        return Some(Value::number(if start >= 1. || no_switch != 0. {
            0.
        } else {
            -(salvage - cost) * (end - start).min(1.)
        }));
    }
    if no_switch == 0. {
        return Some(Value::number(total(
            cost, salvage, life, start, end, factor, work,
        )?));
    }
    let count = end.ceil() - start.floor();
    if count > (*work / 64) as f64 {
        return None;
    }
    let mut result = 0.;
    for index in 0..count as usize {
        *work = work.checked_sub(64)?;
        let period = start.floor() + index as f64;
        let share = end.min(period + 1.) - start.max(period);
        result += declining(cost, salvage, life, period + 1., factor) * share;
    }
    Some(Value::number(result))
}

fn leap(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn first_fraction(
    start: f64,
    end: f64,
    basis: f64,
    degressive: bool,
    date1904: bool,
) -> Result<f64, &'static str> {
    let maximum = 2_958_465. - if date1904 { 1462. } else { 0. };
    let (start, end) = (start.floor(), end.floor());
    if start < 0. || end > maximum || start > end {
        return Err("#NUM!");
    }
    let epoch = if date1904 {
        days_from_civil(1904, 1, 1)
    } else {
        days_from_civil(1899, 12, 30)
    };
    let (year1, month1, mut day1) = civil_from_days(epoch + start as i64);
    let (year2, month2, mut day2) = civil_from_days(epoch + end as i64);
    if matches!(basis, 1. | 3.) {
        let mut days = end - start;
        if degressive {
            if leap(year1) && month1 == 2 && day1 >= 28 {
                days += f64::from(day1 - 28);
            }
            if leap(year2) && month2 == 2 && day2 >= 28 {
                days -= f64::from(day2 - 28);
            }
        }
        return Ok(days
            / if basis == 1. && leap(year1) {
                366.
            } else {
                365.
            });
    }
    if basis == 0. {
        let feb1 = month1 == 2 && day1 == if leap(year1) { 29 } else { 28 };
        let feb2 = month2 == 2 && day2 == if leap(year2) { 29 } else { 28 };
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
    Ok(
        ((year2 - year1) * 360 + (i64::from(month2) - i64::from(month1)) * 30 + i64::from(day2)
            - i64::from(day1)) as f64
            / 360.,
    )
}

fn rounded(value: f64) -> f64 {
    if value == 0. || !value.is_finite() {
        return value;
    }
    // Excel rounds these results after retaining fifteen significant digits.
    let scale = 10_f64.powf(14. - value.abs().log10().floor());
    if scale.is_finite() && (value * scale).is_finite() {
        (value * scale).round() / scale
    } else {
        value
    }
    .round()
}

pub(super) fn calculate(
    name: &str,
    numbers: [f64; 7],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    if name == "VDB" {
        return vdb(numbers, work);
    }
    *work = work.checked_sub(256)?;
    let [cost, purchase, first, salvage, period, rate, basis] = numbers;
    let basis = basis.floor();
    let degressive = name == "AMORDEGRC";
    if cost <= 0.
        || salvage < 0.
        || cost < salvage
        || period < 0.
        || rate <= 0.
        || !matches!(basis, 0. | 1. | 3. | 4.)
        || degressive && rate >= 0.5
    {
        return Some(Value::Error("#NUM!"));
    }
    let fraction = match first_fraction(purchase, first, basis, degressive, date1904) {
        Ok(fraction) => fraction,
        Err(error) => return Some(Value::Error(error)),
    };
    if cost == salvage {
        return Some(Value::Number(0.));
    }
    if !degressive {
        let annual = cost * rate;
        let first = annual * fraction;
        let life = ((cost - salvage) / annual - fraction).ceil();
        let period = if period > 1. {
            period.floor()
        } else {
            period.ceil()
        };
        let result = if life < 0. || period > life {
            0.
        } else if period == 0. {
            first
        } else {
            (cost - salvage - first - annual * (period - 1.))
                .min(annual)
                .max(0.)
        };
        return Some(Value::number(result));
    }
    let life = (1. / rate).ceil();
    let factor = if life <= 4. {
        1.5
    } else if life <= 6. {
        2.
    } else {
        2.5
    };
    let rate = rate * factor;
    let prorated = fraction * rate * cost;
    let first = rounded(
        (if prorated == 0. {
            cost * rate
        } else {
            prorated
        })
        .min(cost - salvage),
    );
    if period == 0. {
        return Some(Value::number(first));
    }
    let period = period.floor();
    if period == 0. {
        return Some(Value::Number(0.));
    }
    // Round each charge before reducing the book value. The final half-balance
    // charge is triggered by crossing salvage, not by a fixed asset-life cutoff.
    let mut balance = cost - first;
    if balance < salvage {
        return Some(Value::Number(0.));
    }
    let mut charge = 0.;
    let mut index = 0.;
    while index < period {
        *work = work.checked_sub(64)?;
        charge = rounded(balance * rate);
        if balance - charge < salvage {
            return Some(Value::number(if period - index == 1. {
                rounded(balance / 2.)
            } else {
                0.
            }));
        }
        if charge == 0. {
            return Some(Value::Number(0.));
        }
        balance -= charge;
        index += 1.;
    }
    Some(Value::number(charge))
}

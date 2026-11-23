// Odd coupon prices and yields adapted from IronCalc financial_bonds.rs
// (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc).
// First-coupon date ordering follows Univer oddfprice/oddfyield
// (4767b3b309467c283bbd52b725536ca73861e0fc, Apache-2.0, LICENSE.Univer).
// Keep quasi-coupon dates separate from the maturity-anchored regular schedule.
// Geometric sums and a bounded log-discount solve avoid payment allocations and
// repeated calendar work during yield solving.
use super::super::date_difference::{calendar, serial};
use super::{
    Value,
    bonds::{days, dirty_price, month_end, schedule, shift},
    number,
    securities::product,
};

pub(super) fn calculate(
    name: &str,
    args: &[&Value],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    *work = work.checked_sub(512)?;
    let first = matches!(name, "ODDFPRICE" | "ODDFYIELD");
    let yield_function = matches!(name, "ODDFYIELD" | "ODDLYIELD");
    let date_count = if first { 4 } else { 3 };
    let mut values = [0.; 9];
    for (i, arg) in args.iter().enumerate() {
        match arg {
            Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
            Value::Bool(_) => return Some(Value::Error("#VALUE!")),
            _ => {}
        }
        values[i] = if i < date_count {
            match serial(arg, date1904, false, work)? {
                Ok(n) => n as f64,
                Err(e) => return Some(Value::Error(e)),
            }
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
            n
        };
    }
    let (settlement, maturity, interest) = (values[0] as i64, values[1] as i64, values[2] as i64);
    let (rate, amount, redemption) = (
        values[date_count],
        values[date_count + 1],
        values[date_count + 2],
    );
    let (frequency, basis) = (
        values[date_count + 3].floor(),
        values[date_count + 4].floor(),
    );
    if settlement >= maturity
        || interest >= maturity
        || rate < 0.
        || amount < 0.
        || yield_function && amount == 0.
        || redemption <= 0.
        || !matches!(frequency, 1. | 2. | 4.)
        || !(0. ..=4.).contains(&basis)
    {
        return Some(Value::Error("#NUM!"));
    }
    let (f, basis) = (frequency as i64, basis as i64);
    let months = 12 / f;
    let max_date = if date1904 { 2_957_003 } else { 2_958_465 };
    let scale = rate
        .max(redemption)
        .max(if yield_function { amount } else { 0. })
        .max(1.);
    let coupon = (rate / scale) * (100. / frequency);
    let redemption_scaled = redemption / scale;
    let result = if !first {
        let (previous, _, count) = schedule(interest, maturity, f, date1904);
        if previous < 0 {
            return Some(Value::Error("#NUM!"));
        }
        *work = work.checked_sub((count as usize).checked_mul(256)?)?;
        let (mut front, mut total, mut accrued, mut remaining) = (interest, 0., 0., 0.);
        for index in 1..=count {
            let late = shift(front, months, false, date1904);
            if late > max_date {
                return Some(Value::Error("#NUM!"));
            }
            let length = days(front, late, basis, true, date1904).max(0.);
            let contribution = if index < count {
                length
            } else {
                days(front, maturity, basis, true, date1904).max(0.)
            };
            let a = if late < settlement {
                contribution
            } else if front < settlement {
                days(front, settlement, basis, false, date1904).max(0.)
            } else {
                0.
            };
            let dsc = days(
                settlement.max(front),
                maturity.min(late),
                basis,
                false,
                date1904,
            )
            .max(0.);
            total += contribution / length;
            accrued += a / length;
            remaining += dsc / length;
            front = late;
        }
        let accrued_amount = coupon * accrued;
        if yield_function {
            let target = amount / scale + accrued_amount;
            let gain = (redemption - amount) / scale + coupon * (total - accrued);
            // Apply a reducing time factor before division: gain / target can
            // overflow even when the annualized yield remains finite.
            if remaining >= frequency {
                (gain * (frequency / remaining)) / target
            } else {
                (gain / target) * (frequency / remaining)
            }
        } else {
            let factor = remaining / frequency;
            let denominator = 1. + factor * amount;
            let discount = if denominator.is_infinite() {
                (1. / amount) / factor
            } else {
                1. / denominator
            };
            product(redemption_scaled + coupon * total, discount, scale) - accrued_amount * scale
        }
    } else {
        let first_coupon = values[3] as i64;
        // Excel/Univer require issue < settlement < first coupon < maturity.
        // In addition, the first coupon must lie on maturity's coupon schedule.
        if interest >= settlement
            || settlement >= first_coupon
            || first_coupon >= maturity
            || schedule(first_coupon, maturity, f, date1904).0 != first_coupon
        {
            return Some(Value::Error("#NUM!"));
        }
        let (previous, next, _) = schedule(settlement, first_coupon, f, date1904);
        if previous < 0 || schedule(interest, maturity, f, date1904).0 < 0 {
            return Some(Value::Error("#NUM!"));
        }
        let e = match basis {
            1 => (next - previous) as f64,
            3 => 365. / frequency,
            _ => 360. / frequency,
        };
        let first_days = days(interest, first_coupon, basis, false, date1904).max(0.);
        let (n, time, first_factor, accrued_factor) = if first_days < e {
            let (_, _, count) = schedule(settlement, maturity, f, date1904);
            (
                count - 1,
                days(settlement, first_coupon, basis, false, date1904).max(0.) / e,
                first_days / e,
                days(interest, settlement, basis, false, date1904).max(0.) / e,
            )
        } else {
            let (prev, _, count) = schedule(interest, first_coupon, f, date1904);
            if prev < 0 {
                return Some(Value::Error("#NUM!"));
            }
            *work = work.checked_sub((count as usize).checked_mul(256)?)?;
            let (mut late, mut total, mut accrued) = (first_coupon, 0., 0.);
            for index in (1..=count).rev() {
                let early = shift(late, -months, false, date1904);
                if early < 0 {
                    return Some(Value::Error("#NUM!"));
                }
                let length = if basis == 1 { (late - early) as f64 } else { e };
                let contribution = if index > 1 {
                    length
                } else {
                    days(interest, late, basis, false, date1904).max(0.)
                };
                total += contribution / length;
                accrued += days(
                    interest.max(early),
                    settlement.min(late),
                    basis,
                    false,
                    date1904,
                )
                .max(0.)
                    / length;
                late = early;
            }
            let dsc = if matches!(basis, 2 | 3) {
                days(settlement, next, basis, false, date1904).max(0.)
            } else {
                e - days(previous, settlement, basis, false, date1904)
            };
            let (_, m, d) = calendar(first_coupon, date1904);
            let mut end = month_end(first_coupon, date1904);
            if !end && m != 2 && d > 28 {
                end = month_end(settlement, date1904);
            }
            let start = shift(settlement, 0, end, date1904);
            let mut count = if settlement < start { 1. } else { 0. };
            let mut front = shift(start, months, end, date1904);
            while front < first_coupon {
                *work = work.checked_sub(128)?;
                count += 1.;
                front = shift(front, months, end, date1904);
            }
            if front > max_date {
                return Some(Value::Error("#NUM!"));
            }
            let (_, _, regular) = schedule(first_coupon, maturity, f, date1904);
            (regular, count + dsc / e, total, accrued)
        };
        let accrued = coupon * accrued_factor;
        let first_payment = coupon * first_factor;
        let price = |x: f64| {
            dirty_price(coupon, redemption_scaled, n as f64, time + 1., x)
                + if first_payment == 0. {
                    0.
                } else {
                    first_payment * (-time * x).exp()
                }
        };
        let log_coupon = rate.ln() + (100. / frequency).ln();
        let log_redemption = redemption.ln();
        let log_price = |x: f64| {
            // Sum positive payments in logarithms only when ordinary scaling
            // would discard a tiny coupon or discount. All three terms remain
            // finite even when their corresponding normalized values vanish.
            let geometric = if x == 0. {
                (n as f64).ln()
            } else if x > 0. {
                (-(-(n as f64) * x).exp_m1()).ln() - (-(-x).exp_m1()).ln()
            } else {
                -(n as f64 - 1.) * x + (-(n as f64 * x).exp_m1()).ln() - (-x.exp_m1()).ln()
            };
            let regular = log_coupon - (time + 1.) * x + geometric;
            let first = log_coupon + first_factor.ln() - time * x;
            let redemption = log_redemption - (time + n as f64) * x;
            let largest = regular.max(first).max(redemption);
            largest
                + ((regular - largest).exp()
                    + (first - largest).exp()
                    + (redemption - largest).exp())
                .ln()
        };
        if rate == 0. {
            // A zero-coupon bond has one payment. Combine logarithms before
            // exponentiation so a representable price cannot underflow merely
            // because redemption was normalized during the general solve.
            let periods = time + n as f64;
            if yield_function {
                let change = (redemption - amount) / amount;
                let ratio = if change.abs() < 0.5 {
                    change.ln_1p()
                } else {
                    redemption.ln() - amount.ln()
                };
                (ratio / periods).exp_m1() * frequency
            } else if amount == 0. {
                redemption
            } else {
                (redemption.ln() - periods * (amount / frequency).ln_1p()).exp()
            }
        } else if !yield_function {
            let x = (amount / frequency).ln_1p();
            let dirty = price(x);
            if coupon < f64::MIN_POSITIVE || dirty < f64::MIN_POSITIVE {
                log_price(x).exp() - product(rate, 100. / frequency, accrued_factor)
            } else {
                (dirty - accrued) * scale
            }
        } else {
            let target = amount / scale + accrued;
            let logarithmic = coupon < f64::MIN_POSITIVE || target < f64::MIN_POSITIVE;
            let target = if logarithmic {
                let a = amount.ln();
                let b = log_coupon + accrued_factor.ln();
                let largest = a.max(b);
                largest + ((a - largest).exp() + (b - largest).exp()).ln()
            } else {
                target
            };
            let evaluate = |x| if logarithmic { log_price(x) } else { price(x) };
            let (mut lo, mut hi) = (-36., 710.);
            if time < 0. && first_factor > 0. {
                let (mut left, mut right) = (0., hi);
                for _ in 0..100 {
                    *work = work.checked_sub(128)?;
                    let a = left + (right - left) / 3.;
                    let b = right - (right - left) / 3.;
                    if evaluate(a) < evaluate(b) {
                        right = b;
                    } else {
                        left = a;
                    }
                }
                hi = (left + right) / 2.;
            }
            if evaluate(lo) < target || evaluate(hi) > target {
                return Some(Value::Error("#NUM!"));
            }
            for _ in 0..100 {
                *work = work.checked_sub(64)?;
                let mid = (lo + hi) / 2.;
                if evaluate(mid) > target {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            ((lo + hi) / 2.).exp_m1() * frequency
        }
    };
    Some(if result.is_finite() {
        Value::Number(result)
    } else {
        Value::Error("#NUM!")
    })
}

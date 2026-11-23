// Periodic accrued interest adapted from IronCalc financial/accrint.rs
// (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc).
// Keep the drifting first-interest schedule and settlement denominator: these
// differ from regular bond pricing for long first coupons. No coupon vector.
use super::super::date_difference::serial;
use super::{
    Value,
    bonds::{days, month_end, shift},
    number,
    securities::product,
};

pub(super) fn calculate(args: &[&Value], date1904: bool, work: &mut usize) -> Option<Value> {
    *work = work.checked_sub(256)?;
    let mut values = [0.; 8];
    values[7] = 1.;
    for (i, arg) in args.iter().enumerate() {
        match arg {
            Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
            Value::Bool(_) if i != 7 => return Some(Value::Error("#VALUE!")),
            _ => {}
        }
        values[i] = if i < 3 {
            match serial(arg, date1904, false, work)? {
                Ok(n) => n as f64,
                Err(e) => return Some(Value::Error(e)),
            }
        } else {
            let n = match arg {
                Value::Text(s) | Value::UninternedText(s) => {
                    *work = work.checked_sub(s.len().checked_mul(2)?)?;
                    let boolean = s.trim().eq_ignore_ascii_case("true")
                        || s.trim().eq_ignore_ascii_case("false");
                    if boolean && i != 7 {
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
    let [
        issue,
        first,
        settlement,
        rate,
        par,
        frequency,
        basis,
        method,
    ] = values;
    let (frequency, basis) = (frequency.floor(), basis.floor());
    if issue >= settlement
        || !date1904 && issue == 0.
        || rate <= 0.
        || par <= 0.
        || !matches!(frequency, 1. | 2. | 4.)
        || !(0. ..=4.).contains(&basis)
    {
        return Some(Value::Error("#NUM!"));
    }
    let (issue, first, settlement, basis) =
        (issue as i64, first as i64, settlement as i64, basis as i64);
    let months = 12 / frequency as i64;
    let end = month_end(first, date1904);
    let regular = shift(first, -months, end, date1904);
    if regular < 0 {
        return Some(Value::Error("#NUM!"));
    }
    let mut previous = regular;
    if settlement > first && method != 0. {
        let mut front = first;
        while front < settlement {
            *work = work.checked_sub(128)?;
            previous = front;
            front = shift(front, months, end, date1904);
            if front > if date1904 { 2_957_003 } else { 2_958_465 } {
                return Some(Value::Error("#NUM!"));
            }
        }
    }
    let denominator = match basis {
        1 => (first - regular) as f64,
        3 => 365. / frequency,
        _ => 360. / frequency,
    };
    let mut accrued = days(issue.max(previous), settlement, basis, false, date1904) / denominator;
    let mut front = previous;
    while front > issue {
        *work = work.checked_sub(128)?;
        let period_end = front;
        front = shift(front, -months, end, date1904);
        if front < 0 {
            return Some(Value::Error("#NUM!"));
        }
        if issue <= front {
            accrued += if method == 0. { 0. } else { 1. };
        } else {
            let numerator = days(issue, period_end, basis, false, date1904);
            let denominator = match basis {
                2 => 360. / frequency,
                3 => 365. / frequency,
                _ => days(front, period_end, basis, true, date1904),
            };
            accrued += numerator / denominator;
        }
    }
    let result = product(par, rate, accrued / frequency);
    Some(if result.is_finite() {
        Value::Number(result)
    } else {
        Value::Error("#NUM!")
    })
}

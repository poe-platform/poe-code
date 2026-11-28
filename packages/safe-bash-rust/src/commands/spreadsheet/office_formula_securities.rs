// Securities and Treasury bills adapted from IronCalc financial/mod.rs
// (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc) and Univer
// financial/tbill*/index.ts (4767b3b309467c283bbd52b725536ca73861e0fc,
// Apache-2.0, LICENSE.Univer). Reuses the workbook's YEARFRAC calendars.
use super::super::date_difference::{calendar, serial, year_fraction};
use super::{Value, number};

// Multiply the smallest and largest magnitudes first to avoid overflowing or
// underflowing a partial product when the complete result is representable.
pub(super) fn product(a: f64, b: f64, c: f64) -> f64 {
    let mut factors = [a, b, c];
    factors.sort_by(|a, b| a.abs().total_cmp(&b.abs()));
    (factors[0] * factors[2]) * factors[1]
}

pub(super) fn calculate(
    name: &str,
    args: &[&Value],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    *work = work.checked_sub(256)?;
    let maturity_interest = matches!(name, "PRICEMAT" | "YIELDMAT");
    let bill = name.starts_with("TBILL");
    let mut values = [0.; 6];
    if name == "ACCRINTM" {
        values[3] = 1000.;
    }
    for (i, arg) in args.iter().enumerate() {
        match arg {
            Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
            Value::Bool(_) => return Some(Value::Error("#VALUE!")),
            _ => {}
        }
        if i < 2 || maturity_interest && i == 2 {
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
    let (start, end) = (values[0] as i64, values[1] as i64);
    if start >= end {
        return Some(Value::Error("#NUM!"));
    }
    let result = if bill {
        let (sy, sm, sd) = calendar(start, date1904);
        let (ey, em, ed) = calendar(end, date1904);
        let days = (end - start) as f64;
        let amount = values[2];
        if amount <= 0. || days >= 365. && !(ey == sy || ey == sy + 1 && (em, ed) <= (sm, sd)) {
            return Some(Value::Error("#NUM!"));
        }
        if name == "TBILLYIELD" {
            ((100. - amount) / amount) * (360. / days)
        } else {
            let reduction = amount * (days / 360.);
            let price = 1. - reduction;
            if price < 0. {
                return Some(Value::Error("#NUM!"));
            }
            if name == "TBILLPRICE" {
                price * 100.
            } else {
                if price == 0. {
                    return Some(Value::Error("#DIV/0!"));
                }
                if days < 183. {
                    amount * (365. / 360.) / price
                } else {
                    let year = if days == 366. { 366. } else { 365. };
                    let t = days / year;
                    let gain = reduction / price;
                    // Positive quadratic root, rationalized to preserve tiny
                    // discount rates instead of subtracting two near-equal terms.
                    2. * gain / (t + (t * t + 2. * (t - 0.5) * gain).sqrt())
                }
            }
        }
    } else {
        let basis = values[if maturity_interest { 5 } else { 4 }].floor();
        if !(0. ..=4.).contains(&basis) {
            return Some(Value::Error("#NUM!"));
        }
        let basis = basis as u32;
        if maturity_interest {
            let issue = values[2] as i64;
            let (rate, amount) = (values[3], values[4]);
            if issue >= start || rate < 0. || amount < 0. || name == "YIELDMAT" && amount == 0. {
                return Some(Value::Error("#NUM!"));
            }
            let accrued = year_fraction(issue, start, basis, date1904);
            // All factors share the issue-to-settlement year's denominator.
            let term = if basis == 1 {
                (end - issue) as f64 * accrued / (start - issue) as f64
            } else {
                year_fraction(issue, end, basis, date1904)
            };
            let remaining = term - accrued;
            if name == "PRICEMAT" {
                if remaining == 0. {
                    100.
                } else {
                    let discounted = if amount == 0. {
                        remaining
                    } else {
                        1. / (1. / remaining + amount)
                    };
                    let fraction = discounted * amount;
                    100. / (1. + amount * remaining)
                        + product(100., rate, discounted - accrued * fraction)
                }
            } else {
                if remaining == 0. {
                    return Some(Value::Error("#DIV/0!"));
                }
                let price = amount / 100.;
                let scale = price.max(rate).max(1.);
                let rate = rate / scale;
                let price = price / scale;
                ((1. / scale - price) + rate * remaining) / (price + rate * accrued) / remaining
            }
        } else {
            let (a, b) = (values[2], values[3]);
            if a <= 0. || b <= 0. {
                return Some(Value::Error("#NUM!"));
            }
            let fraction = if name == "INTRATE" {
                // INTRATE uses unadjusted calendar days in 30-day months,
                // unlike YEARFRAC, and anchors actual/actual to settlement.
                let (y1, m1, d1) = calendar(start, date1904);
                let (y2, m2, d2) = calendar(end, date1904);
                let leap = y1 % 4 == 0 && (y1 % 100 != 0 || y1 % 400 == 0);
                match basis {
                    0 | 4 => {
                        let mut days =
                            (y2 - y1) * 360 + (i64::from(m2) - i64::from(m1)) * 30 + i64::from(d2)
                                - i64::from(d1);
                        if basis == 0 && m1 == 2 && m2 != 2 && y1 == y2 {
                            days -= if leap { 1 } else { 2 };
                        }
                        days as f64 / 360.
                    }
                    1 => (end - start) as f64 / if leap { 366. } else { 365. },
                    2 => (end - start) as f64 / 360.,
                    _ => (end - start) as f64 / 365.,
                }
            } else {
                year_fraction(start, end, basis, date1904)
            };
            match name {
                "ACCRINTM" => product(a, b, fraction),
                "PRICEDISC" => {
                    let factor = 1. - a * fraction;
                    if factor.is_finite() {
                        b * factor
                    } else {
                        b - product(a, b, fraction)
                    }
                }
                "RECEIVED" => {
                    let factor = 1. - b * fraction;
                    if factor <= 0. {
                        return Some(Value::Error("#NUM!"));
                    }
                    a / factor
                }
                _ => {
                    if fraction == 0. {
                        return Some(Value::Error("#DIV/0!"));
                    }
                    let base = if name == "DISC" { b } else { a };
                    if fraction >= 1. {
                        (b - a) / fraction / base
                    } else {
                        (b - a) / base / fraction
                    }
                }
            }
        }
    };
    Some(if result.is_finite() {
        Value::Number(result)
    } else {
        Value::Error("#NUM!")
    })
}

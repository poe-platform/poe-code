use super::{
    super::{Value, rounding},
    daycount,
};
use crate::commands::coreutils::days_from_civil;

pub(super) fn calculate_public(
    name: &str,
    numbers: [f64; 8],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    let [
        mut cost,
        purchase,
        first,
        salvage,
        period,
        mut rate,
        basis,
        _,
    ] = numbers;
    let (Some(purchase), Some(first)) = (
        super::odd_first::date(purchase, date1904),
        super::odd_first::date(first, date1904),
    ) else {
        return Some(Value::Error("#NUM!"));
    };
    if rate < 0. || !(0. ..6.).contains(&basis) {
        return Some(Value::Error("#NUM!"));
    }
    let fraction = super::discount::year_fraction(purchase, first, basis as i32);
    let period = period.trunc();
    if name == "AMORLINC" {
        let annual = cost * rate;
        let initial = fraction * annual;
        let full = ((cost - salvage - initial) / annual).trunc();
        return Some(Value::number(if period == 0. {
            initial
        } else if period <= full {
            annual
        } else if period == full + 1. {
            cost - salvage - annual * full - initial
        } else {
            0.
        }));
    }
    let life = 1. / rate;
    rate *= if life < 3. {
        1.
    } else if life < 5. {
        1.5
    } else if life <= 6. {
        2.
    } else {
        2.5
    };
    let mut depreciation = (fraction * rate * cost).round_ties_even();
    cost -= depreciation;
    let mut remaining = cost - salvage;
    let mut index = 0.;
    while index < period {
        *work = work.checked_sub(1)?;
        depreciation = (rate * cost).round_ties_even();
        remaining -= depreciation;
        if remaining < 0. {
            return Some(Value::number(if period - index <= 1. {
                (cost / 2.).round_ties_even()
            } else {
                0.
            }));
        }
        if depreciation == 0. {
            return Some(Value::Number(0.));
        }
        cost -= depreciation;
        index += 1.;
    }
    Some(Value::number(depreciation))
}

pub(super) fn calculate(
    name: &str,
    numbers: [f64; 7],
    basis: &Value,
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    let [mut cost, purchase, first, salvage, period, mut rate, _] = numbers;
    if purchase > first || rate <= 0. || salvage > cost || cost <= 0. || salvage < 0. || period < 0.
    {
        return Some(Value::Error("Err:502"));
    }
    let basis = match daycount::basis(basis, date1904) {
        Ok(basis) => basis,
        Err(error) => return Some(Value::Error(error)),
    };
    let epoch = if date1904 {
        days_from_civil(1904, 1, 1)
    } else {
        days_from_civil(1899, 12, 30)
    };
    let fraction = match daycount::year_fraction(purchase as i32, first as i32, basis, epoch) {
        Ok(fraction) => fraction,
        Err(error) => return Some(Value::Error(error)),
    };
    // Native add-in periods truncate and narrow through a signed 64-bit conversion.
    let unsigned = |value: f64| {
        if (i64::MIN as f64..-(i64::MIN as f64)).contains(&value) {
            value as i64 as u32
        } else {
            0
        }
    };
    let period = unsigned(period);
    let result = if name == "AMORLINC" {
        let annual = cost * rate;
        let initial = fraction * rate * cost;
        let full = unsigned((cost - salvage - initial) / annual);
        let result = if period == 0 {
            initial
        } else if period <= full {
            annual
        } else if period == full.wrapping_add(1) {
            cost - salvage - annual * f64::from(full) - initial
        } else {
            0.
        };
        if result > 0. { result } else { 0. }
    } else {
        let life = 1. / rate;
        rate *= if life < 3. {
            1.
        } else if life < 5. {
            1.5
        } else if life <= 6. {
            2.
        } else {
            2.5
        };
        let mut charge = rounding::decimal(fraction * rate * cost, 0, "ROUND");
        cost -= charge;
        let mut remaining = cost - salvage;
        for index in 0..period {
            *work = work.checked_sub(1)?;
            charge = rounding::decimal(rate * cost, 0, "ROUND");
            remaining -= charge;
            if remaining < 0. {
                charge = if period - index == 1 {
                    rounding::decimal(cost * 0.5, 0, "ROUND")
                } else {
                    0.
                };
                break;
            }
            cost -= charge;
        }
        charge
    };
    Some(if result.is_finite() {
        Value::Number(result)
    } else {
        Value::Error("Err:502")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_depreciation_finishes_after_payments_round_to_zero() {
        for period in [1000., 1e308] {
            assert!(matches!(
                calculate_public(
                    "AMORDEGRC",
                    [2400., 43831., 44196., 0., period, 0.15, 0., 0.],
                    false,
                    &mut 100,
                ),
                Some(Value::Number(0.))
            ));
        }
    }
}

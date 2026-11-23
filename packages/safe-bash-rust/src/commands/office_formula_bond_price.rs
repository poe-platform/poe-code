use super::{
    super::{Value, approximately_equal},
    coupons, growth, growth_delta, odd_first, power,
};
use crate::commands::coreutils::civil_from_days;

pub(super) fn calculate_csv(
    name: &str,
    numbers: [f64; 8],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    let [settlement, maturity, rate, amount, ..] = numbers;
    let duration = matches!(name, "DURATION" | "MDURATION");
    let (Some(settlement), Some(maturity)) = (
        odd_first::date(settlement, date1904),
        odd_first::date(maturity, date1904),
    ) else {
        return Some(Value::Error(if name == "YIELD" || duration {
            "#NUM!"
        } else {
            "#VALUE!"
        }));
    };
    let redemption = if duration { 100. } else { numbers[4] };
    let frequency = numbers[if duration { 4 } else { 5 }].trunc();
    let basis = numbers[if duration { 5 } else { 6 }];
    if !duration && (settlement > maturity || rate < 0. || redemption <= 0.)
        || !matches!(frequency, 1. | 2. | 4.)
        || !(0. ..6.).contains(&basis)
    {
        return Some(Value::Error("#NUM!"));
    }
    if duration {
        let (y1, m1, d1) = civil_from_days(settlement);
        let (y2, m2, _) = civil_from_days(maturity);
        let mut months = (y2 - y1) * 12 + i64::from(m2) - i64::from(m1);
        let date = odd_first::shift(
            maturity,
            -months,
            name == "DURATION" && maturity == odd_first::shift(maturity, 0, true),
        );
        if d1 >= civil_from_days(date).2 {
            months -= 1;
        }
        let count = 1. + (months as f64 / (12. / frequency)).trunc();
        let mut weighted = 0.;
        let mut total = 0.;
        let mut t = 1.;
        while t < count {
            *work = work.checked_sub(1)?;
            let pv = 100. * rate / frequency / power::pow(1. + amount / frequency, t);
            total += pv;
            weighted += pv * t;
            t += 1.;
        }
        let last = (100. * rate / frequency + 100.) / power::pow(1. + amount / frequency, count);
        total += last;
        weighted += last * count;
        return Some(Value::number(
            weighted
                / total
                / frequency
                / if name == "MDURATION" {
                    1. + amount / frequency
                } else {
                    1.
                },
        ));
    }
    let basis = basis as i32;
    let (previous, next, days, count) =
        odd_first::coupon(settlement, maturity, frequency, basis, true, work)?;
    let elapsed = odd_first::day_count(previous, settlement, basis);
    let remaining = odd_first::day_count(settlement, next, basis);
    if amount < 0. {
        return Some(Value::Error("#NUM!"));
    }
    let price = |yield_rate: f64, work: &mut usize| {
        let den = 100. * rate / frequency;
        let base = yield_rate / frequency;
        let exponent = remaining / days;
        if count == 1. {
            return Some((redemption + den) / (1. + exponent * base) - elapsed / days * den);
        }
        *work = work.checked_sub(1)?;
        let sum = den * growth(base, 1. - count - exponent) * growth_delta(base, count) / base;
        Some(redemption / growth(base, count - 1. + exponent) + sum - elapsed / days * den)
    };
    Some(Value::number(if name == "PRICE" {
        price(amount, work)?
    } else if count <= 1. {
        let den = amount / 100. + elapsed / days * rate / frequency;
        ((redemption / 100. + rate / frequency) - den) / den * frequency * days / remaining
    } else {
        odd_first::solve(|r, work| Some(price(r, work)? - amount), work)?
    }))
}

pub(super) fn calculate(
    name: &str,
    numbers: [f64; 7],
    basis: &Value,
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    let [settlement, maturity, rate, amount, redemption, frequency, _] = numbers;
    if rate < 0.
        || amount < 0.
        || name == "YIELD" && amount == 0.
        || redemption <= 0.
        || settlement >= maturity
        || !matches!(frequency, 1. | 2. | 4.)
    {
        return Some(Value::Error("Err:502"));
    }
    let mut schedule = [0.; 4];
    for (function, value) in ["COUPDAYS", "COUPDAYSNC", "COUPNUM", "COUPDAYBS"]
        .into_iter()
        .zip(&mut schedule)
    {
        *value = match coupons::calculate(
            function,
            settlement as i32,
            maturity as i32,
            frequency as i32,
            basis,
            date1904,
        ) {
            Ok(value) => value,
            Err(error) => return Some(Value::Error(error)),
        };
    }
    let [days, remaining, count, elapsed] = schedule;
    let fraction = remaining / days;
    let price = |yield_rate: f64, work: &mut usize| {
        let factor = 1. + yield_rate / frequency;
        let mut value = redemption / power::pow(factor, count - 1. + fraction);
        value -= 100. * rate / frequency * elapsed / days;
        let payment = 100. * rate / frequency;
        for period in 0..count as u32 {
            *work = work.checked_sub(1)?;
            value += payment / power::pow(factor, f64::from(period) + fraction);
        }
        Some(value)
    };
    let result = if name == "PRICE" {
        price(amount, work)?
    } else {
        'solve: {
            let mut current = 0.;
            let mut lower = 0.;
            let mut upper = 1.;
            let mut lower_price = price(lower, work)?;
            let mut upper_price = price(upper, work)?;
            let mut guess = 0.5;
            for _ in 0..100 {
                if approximately_equal(current, amount) {
                    break;
                }
                *work = work.checked_sub(1)?;
                current = price(guess, work)?;
                if approximately_equal(amount, lower_price) {
                    break 'solve lower;
                } else if approximately_equal(amount, upper_price) {
                    break 'solve upper;
                } else if approximately_equal(amount, current) {
                    break 'solve guess;
                } else if amount < upper_price {
                    upper *= 2.;
                    upper_price = price(upper, work)?;
                    guess = (upper - lower) * 0.5;
                } else {
                    if amount < current {
                        lower = guess;
                        lower_price = current;
                    } else {
                        upper = guess;
                        upper_price = current;
                    }
                    guess = upper
                        - (upper - lower) * ((amount - upper_price) / (lower_price - upper_price));
                }
            }
            if (amount - current).abs() > amount / 100. {
                return Some(Value::Error("Err:502"));
            }
            guess
        }
    };
    Some(if result.is_finite() {
        Value::Number(result)
    } else {
        Value::Error("Err:502")
    })
}

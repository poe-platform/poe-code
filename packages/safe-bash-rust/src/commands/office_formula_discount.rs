use super::{super::Value, daycount, odd_first};
use crate::commands::coreutils::{civil_from_days, days_from_civil};

pub(super) fn calculate_csv(name: &str, n: [f64; 8], date1904: bool, omitted_basis: bool) -> Value {
    if matches!(name, "TBILLEQ" | "TBILLPRICE" | "TBILLYIELD") {
        return super::treasury::calculate_csv(name, n[0], n[1], n[2]);
    }
    let (Some(from), Some(to)) = (
        odd_first::date(n[0], date1904),
        odd_first::date(n[1], date1904),
    ) else {
        return Value::Error(if name == "ACCRINT" {
            "#VALUE!"
        } else {
            "#NUM!"
        });
    };
    let maturity = matches!(name, "PRICEMAT" | "YIELDMAT");
    if name == "YEARFRAC" {
        return if !(0. ..5.).contains(&n[2]) {
            Value::Error("#NUM!")
        } else {
            Value::number(year_fraction(from, to, n[2] as i32))
        };
    }
    let basis = n[if name == "ACCRINT" {
        6
    } else if maturity {
        5
    } else {
        4
    }];
    if name == "ACCRINT" {
        let Some(settle) = odd_first::date(n[2], date1904) else {
            return Value::Error("#VALUE!");
        };
        if !(0. ..6.).contains(&basis)
            || n[3] <= 0.
            || n[4] <= 0.
            || !matches!(n[5].trunc(), 1. | 2. | 4.)
            || from >= settle
        {
            return Value::Error("#NUM!");
        }
        let start = if to >= settle || basis != 0. || omitted_basis {
            from
        } else {
            to
        };
        let days = monthly_days(start, settle, basis as i32, date1904);
        if days < 0. {
            return Value::Error("#NUM!");
        }
        return Value::number(n[4] * n[3] * days / year_days(settle, basis as i32));
    }
    if !(0. ..6.).contains(&basis) {
        return Value::Error("#NUM!");
    }
    let basis = basis as i32;
    if maturity {
        let Some(issue) = odd_first::date(n[2], date1904) else {
            return Value::Error("#NUM!");
        };
        if name == "YIELDMAT" {
            if n[3] < 0. {
                return Value::Error("#NUM!");
            }
            return Value::number(
                ((1. + year_fraction(issue, to, basis) * n[3])
                    / (n[4] / 100. + year_fraction(issue, from, basis) * n[3])
                    - 1.)
                    / year_fraction(from, to, basis),
            );
        }
        let year = year_days(from, basis);
        let remaining = monthly_days(from, to, basis, date1904);
        let whole = monthly_days(issue, to, basis, date1904);
        let accrued = monthly_days(issue, from, basis, date1904);
        let denominator = 1. + remaining / year * n[4];
        if remaining <= 0. || whole <= 0. || accrued <= 0. || denominator == 0. {
            return Value::Error("#NUM!");
        }
        return Value::number(
            (100. + whole / year * n[3] * 100.) / denominator - accrued / year * n[3] * 100.,
        );
    }
    let (x, y) = (n[2], n[3]);
    if name == "YIELDDISC" {
        return if x <= 0. || y <= 0. || from >= to {
            Value::Error("#NUM!")
        } else {
            Value::number((y / x - 1.) / year_fraction(from, to, basis))
        };
    }
    let days = monthly_days(from, to, basis, date1904);
    let year = year_days(from, basis);
    if days < 0. || days == 0. && name != "ACCRINTM" {
        return Value::Error("#NUM!");
    }
    Value::number(match name {
        "ACCRINTM" => {
            if x <= 0. || y <= 0. {
                return Value::Error("#NUM!");
            }
            x * y * days / year
        }
        "INTRATE" => {
            if x == 0. {
                return Value::Error("#NUM!");
            }
            (y - x) / x * year / days
        }
        "RECEIVED" => {
            let denominator = 1. - y * days / year;
            if denominator == 0. {
                return Value::Error("#NUM!");
            }
            x / denominator
        }
        "PRICEDISC" => y * (1. - x * days / year),
        "DISC" => {
            if y == 0. {
                return Value::Error("#NUM!");
            }
            (y - x) / y * year / days
        }
        _ => unreachable!(),
    })
}

fn leap(year: i64) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn monthly_days(from: i64, to: i64, basis: i32, date1904: bool) -> f64 {
    if matches!(basis, 1..=3) {
        return odd_first::serial(to, date1904) - odd_first::serial(from, date1904);
    }
    if !matches!(basis, 0 | 4) {
        return -1.;
    }
    let (y1, m1, d1) = civil_from_days(from);
    let (y2, m2, d2) = civil_from_days(to);
    let adjust = if basis == 0 && m1 == 2 && m2 != 2 && y1 == y2 {
        if leap(y1) { 1 } else { 2 }
    } else {
        0
    };
    (((y2 - y1) * 12 + i64::from(m2) - i64::from(m1)) * 30 + i64::from(d2) - i64::from(d1) - adjust)
        as f64
}

fn year_days(date: i64, basis: i32) -> f64 {
    match basis {
        1 => {
            if leap(civil_from_days(date).0) {
                366.
            } else {
                365.
            }
        }
        3 => 365.,
        _ => 360.,
    }
}

pub(super) fn year_fraction(from: i64, to: i64, basis: i32) -> f64 {
    let (from, to) = (from.min(to), from.max(to));
    let days = odd_first::day_count(from, to, basis);
    if basis != 1 {
        return days
            / match basis {
                3 => 365.,
                0 | 2 | 4 => 360.,
                _ => -1.,
            };
    }
    let (y1, m1, _) = civil_from_days(from);
    let (y2, m2, d2) = civil_from_days(to);
    let denominator = if to > odd_first::shift(from, 12, false) {
        (days_from_civil(y2 + 1, 1, 1) - days_from_civil(y1, 1, 1)) as f64 / (y2 + 1 - y1) as f64
    } else {
        365. + f64::from(leap(y1) && m1 < 3 || leap(y2) && (m2 > 2 || m2 == 2 && d2 >= 29))
    };
    days / denominator
}

pub(super) fn calculate(
    name: &str,
    numbers: [f64; 7],
    basis: &Value,
    date1904: bool,
) -> Result<f64, &'static str> {
    let [settlement, maturity, amount, redemption, ..] = numbers;
    let invalid = match name {
        "YEARFRAC" => false,
        "ACCRINT" => {
            settlement >= numbers[2]
                || numbers[3] <= 0.
                || numbers[4] <= 0.
                || !matches!(numbers[5], 1. | 2. | 4.)
        }
        "PRICEMAT" => settlement >= maturity || numbers[3] < 0. || numbers[4] < 0.,
        "YIELDMAT" => {
            settlement >= maturity || settlement < numbers[2] || numbers[3] < 0. || numbers[4] <= 0.
        }
        "ODDLPRICE" | "ODDLYIELD" => {
            settlement >= maturity
                || settlement <= numbers[2]
                || numbers[3] <= 0.
                || numbers[4] < 0.
                || name == "ODDLYIELD" && numbers[4] == 0.
                || numbers[5] <= 0.
                || !matches!(numbers[6], 1. | 2. | 4.)
        }
        _ => settlement >= maturity || amount <= 0. || redemption <= 0.,
    };
    if invalid {
        return Err("Err:502");
    }
    let basis = daycount::basis(basis, date1904)?;
    let epoch = if date1904 {
        days_from_civil(1904, 1, 1)
    } else {
        days_from_civil(1899, 12, 30)
    };
    let result = if matches!(name, "ACCRINT" | "ACCRINTM") {
        let (end, rate, par) = if name == "ACCRINT" {
            (numbers[2], numbers[3], numbers[4])
        } else {
            (maturity, amount, redemption)
        };
        par * rate * daycount::year_diff(settlement as i32, end as i32, basis, epoch)?
    } else if matches!(name, "PRICEMAT" | "YIELDMAT") {
        let [_, _, issue, rate, price, ..] = numbers;
        let issue_maturity = daycount::year_fraction(issue as i32, maturity as i32, basis, epoch)?;
        let issue_settlement =
            daycount::year_fraction(issue as i32, settlement as i32, basis, epoch)?;
        let settlement_maturity =
            daycount::year_fraction(settlement as i32, maturity as i32, basis, epoch)?;
        let mut result = 1. + issue_maturity * rate;
        if name == "PRICEMAT" {
            result /= 1. + settlement_maturity * price;
            result -= issue_settlement * rate;
            result *= 100.;
        } else {
            result /= price / 100. + issue_settlement * rate;
            result -= 1.;
            result /= settlement_maturity;
        }
        result
    } else if matches!(name, "ODDLPRICE" | "ODDLYIELD") {
        let [_, _, last, rate, amount, redemption, frequency] = numbers;
        let coupon =
            daycount::year_fraction(last as i32, maturity as i32, basis, epoch)? * frequency;
        let remaining =
            daycount::year_fraction(settlement as i32, maturity as i32, basis, epoch)? * frequency;
        let accrued =
            daycount::year_fraction(last as i32, settlement as i32, basis, epoch)? * frequency;
        let mut result = redemption + coupon * 100. * rate / frequency;
        if name == "ODDLPRICE" {
            result /= remaining * amount / frequency + 1.;
            result -= accrued * 100. * rate / frequency;
        } else {
            result /= amount + accrued * 100. * rate / frequency;
            result -= 1.;
            result *= frequency / remaining;
        }
        result
    } else {
        let fraction = if matches!(name, "DISC" | "YIELDDISC" | "YEARFRAC") {
            daycount::year_fraction(settlement as i32, maturity as i32, basis, epoch)?
        } else {
            daycount::year_diff(settlement as i32, maturity as i32, basis, epoch)?
        };
        match name {
            "YEARFRAC" => fraction,
            "DISC" => (1. - amount / redemption) / fraction,
            "INTRATE" | "YIELDDISC" => (redemption / amount - 1.) / fraction,
            "RECEIVED" => amount / (1. - redemption * fraction),
            "PRICEDISC" => redemption * (1. - amount * fraction),
            _ => unreachable!(),
        }
    };
    if result.is_finite() {
        Ok(result)
    } else {
        Err("Err:502")
    }
}

use super::super::dates::addin_calendar;
use crate::commands::coreutils::days_from_civil;

pub(super) fn calculate_csv(
    name: &str,
    settlement: f64,
    maturity: f64,
    amount: f64,
) -> super::super::Value {
    use super::super::Value;
    let days = maturity.floor() - settlement.floor();
    if !(0. ..=365.).contains(&days)
        || amount < 0.
        || name == "TBILLYIELD" && (days == 0. || amount == 0.)
    {
        return Value::Error("#NUM!");
    }
    Value::number(match name {
        "TBILLPRICE" => 100. * (1. - amount * days / 360.),
        "TBILLYIELD" => (100. - amount) / amount * 360. / days,
        _ => {
            let denominator = 360. - amount * days;
            if denominator == 0. {
                return Value::Error("#DIV/0!");
            }
            365. * amount / denominator
        }
    })
}

pub(super) fn calculate(
    name: &str,
    settlement: i32,
    maturity: i32,
    amount: f64,
    date1904: bool,
) -> Result<f64, &'static str> {
    let price = name == "TBILLPRICE";
    let yield_rate = name == "TBILLYIELD";
    if amount <= 0. || price && settlement > maturity {
        return Err("Err:502");
    }
    let end = if yield_rate {
        maturity
    } else {
        maturity.wrapping_add(1)
    };
    let epoch = if date1904 {
        days_from_civil(1904, 1, 1)
    } else {
        days_from_civil(1899, 12, 30)
    };
    let result = if price {
        let fraction = super::daycount::year_fraction(settlement, end, 0, epoch)?;
        if fraction.fract() == 0. {
            return Err("Err:502");
        }
        100. * (1. - amount * fraction)
    } else {
        let (y1, m1, mut d1) = addin_calendar(settlement, epoch)?;
        let (mut y2, mut m2, mut d2) = addin_calendar(end, epoch)?;
        let leap1 = y1 % 4 == 0 && (y1 % 100 != 0 || y1 % 400 == 0);
        if d1 == 31 || m1 == 2 && d1 == if leap1 { 29 } else { 28 } {
            d1 = 30;
        }
        if d2 == 31 {
            if d1 == 30 {
                d2 = 30;
            } else {
                d2 = 1;
                if m2 == 12 {
                    m2 = 1;
                    y2 = (y2 as u16).wrapping_add(1).into();
                } else {
                    m2 += 1;
                }
            }
        }
        let days = ((y2 - y1) * 360 + (i64::from(m2) - i64::from(m1)) * 30 + i64::from(d2)
            - i64::from(d1)) as f64
            + f64::from(yield_rate);
        if settlement >= end || days > 360. {
            return Err("Err:502");
        }
        if yield_rate {
            ((100. / amount - 1.) / days) * 360.
        } else {
            (365. * amount) / (360. - amount * days)
        }
    };
    if result.is_finite() {
        Ok(result)
    } else {
        Err("Err:502")
    }
}

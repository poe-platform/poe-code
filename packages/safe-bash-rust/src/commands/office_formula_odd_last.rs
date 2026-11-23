use super::{super::Value, odd_first};

pub(super) fn calculate(
    name: &str,
    numbers: [f64; 8],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    let [
        settlement,
        maturity,
        anchor,
        rate,
        amount,
        redemption,
        frequency,
        basis,
    ] = numbers;
    let (Some(settlement), Some(maturity), Some(anchor)) = (
        odd_first::date(settlement, date1904),
        odd_first::date(maturity, date1904),
        odd_first::date(anchor, date1904),
    ) else {
        return Some(Value::Error("#VALUE!"));
    };
    let frequency = frequency.trunc();
    if !(0. ..6.).contains(&basis)
        || !matches!(frequency, 1. | 2. | 4.)
        || anchor > settlement
        || settlement > maturity
        || rate < 0.
        || amount < 0.
        || redemption <= 0.
        || name == "ODDLYIELD" && amount == 0.
    {
        return Some(Value::Error("#NUM!"));
    }
    let basis = basis as i32;
    let mut date = anchor;
    loop {
        *work = work.checked_sub(1)?;
        date = odd_first::shift(date, 12 / frequency as i64, false);
        if date >= maturity {
            break;
        }
    }
    let x1 = odd_first::ratio(anchor, settlement, date, frequency, basis, work)?;
    let x2 = odd_first::ratio(anchor, maturity, date, frequency, basis, work)?;
    let x3 = odd_first::ratio(settlement, maturity, date, frequency, basis, work)?;
    Some(Value::number(if name == "ODDLPRICE" {
        (redemption * frequency + 100. * rate * (x2 - x1 * (1. + amount * x3 / frequency)))
            / (amount * x3 + frequency)
    } else {
        (frequency * (redemption - amount) + 100. * rate * (x2 - x1))
            / (x3 * amount + 100. * rate * x1 * x3 / frequency)
    }))
}

#[path = "office_formula_amortization.rs"]
mod amortization;

#[path = "office_formula_bond_price.rs"]
mod bond_price;

#[path = "office_formula_cashflows.rs"]
mod cashflows;

#[path = "office_formula_coupons.rs"]
mod coupons;

#[path = "office_formula_dated_cashflows.rs"]
mod dated_cashflows;

#[path = "office_formula_daycount.rs"]
mod daycount;

#[path = "office_formula_exponential.rs"]
mod exponential;

#[path = "office_formula_goal_seek.rs"]
mod goal_seek;

#[path = "office_formula_discount.rs"]
mod discount;

#[path = "office_formula_treasury.rs"]
mod treasury;

#[path = "office_formula_options.rs"]
pub(super) mod options;

#[path = "office_formula_odd_first.rs"]
pub(super) mod odd_first;

#[path = "office_formula_odd_last.rs"]
mod odd_last;

use super::{
    Calculation, Coord, Value, approximately_equal, lookup::number, power, rounding, summation::Sum,
};

impl Calculation<'_> {
    pub(super) fn addin_value(&mut self, value: Value, pos: Coord, depth: usize) -> Option<Value> {
        if matches!(value, Value::Set(_)) {
            return Some(Value::Error("Err:504"));
        }
        if matches!(
            value,
            Value::Range(..) | Value::LabelRange(..) | Value::Matrix(_)
        ) {
            let reference = matches!(value, Value::Range(..) | Value::LabelRange(..));
            let rows = self.matrix(value, depth + 1)?;
            for value in rows.iter().flatten() {
                if let Value::Error(e) | Value::LiteralError(e) = value {
                    return Some(Value::Error(if reference { "Err:504" } else { e }));
                }
            }
            return Some(Value::Matrix(rows));
        }
        let reference = matches!(value, Value::Single(_));
        let value = self.scalar(value, pos, depth + 1)?;
        Some(
            if reference
                && matches!(
                    value,
                    Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                )
            {
                Value::Number(0.)
            } else {
                value
            },
        )
    }
}

pub(super) fn date_function(name: &str) -> bool {
    matches!(
        name,
        "TBILLEQ"
            | "TBILLPRICE"
            | "TBILLYIELD"
            | "DISC"
            | "INTRATE"
            | "RECEIVED"
            | "PRICEDISC"
            | "YIELDDISC"
            | "ACCRINT"
            | "ACCRINTM"
            | "PRICEMAT"
            | "YIELDMAT"
            | "YEARFRAC"
            | "COUPDAYBS"
            | "COUPDAYS"
            | "COUPDAYSNC"
            | "COUPNCD"
            | "COUPNUM"
            | "COUPPCD"
            | "PRICE"
            | "YIELD"
            | "DURATION"
            | "MDURATION"
            | "ODDLPRICE"
            | "ODDLYIELD"
            | "AMORLINC"
            | "AMORDEGRC"
    )
}

pub(super) fn arguments(name: &str, csv: bool) -> Option<(usize, usize)> {
    Some(match name {
        "PV" | "FV" | "PMT" | "NPER" => (3, 5),
        "RATE" => (3, 6),
        "EFFECT" | "NOMINAL" => (2, 2),
        "DOLLARDE" | "DOLLARFR" => (2, 2),
        "TBILLEQ" | "TBILLPRICE" | "TBILLYIELD" => (3, 3),
        "DISC" | "INTRATE" | "RECEIVED" | "PRICEDISC" | "YIELDDISC" => (4, 5),
        "PRICEMAT" | "YIELDMAT" => (5, 6),
        "ACCRINT" if csv => (4, 8),
        "ACCRINT" => (6, 7),
        "ACCRINTM" => (3, 5),
        "AMORLINC" | "AMORDEGRC" if csv => (7, 7),
        "AMORLINC" | "AMORDEGRC" => (6, 7),
        "PRICE" | "YIELD" => (6, 7),
        "ODDLPRICE" | "ODDLYIELD" if csv => (8, 8),
        "ODDLPRICE" | "ODDLYIELD" => (7, 8),
        "DURATION" | "MDURATION" => (5, 6),
        "COUPDAYBS" | "COUPDAYS" | "COUPDAYSNC" | "COUPNCD" | "COUPNUM" | "COUPPCD" => {
            (3, if csv { 5 } else { 4 })
        }
        "YEARFRAC" => (2, 3),
        "RRI" | "PDURATION" | "G_DURATION" => (3, 3),
        "IPMT" | "PPMT" => (4, 6),
        "CUMIPMT" | "CUMPRINC" => (6, 6),
        "ISPMT" | "SYD" => (4, 4),
        "SLN" => (3, 3),
        "DDB" | "DB" => (4, 5),
        "VDB" => (5, 7),
        _ => return None,
    })
}

pub(super) fn calculate(
    name: &str,
    args: &[&Value],
    date1904: bool,
    csv: bool,
    work: &mut usize,
) -> Option<Value> {
    let coupon = matches!(
        name,
        "COUPDAYBS" | "COUPDAYS" | "COUPDAYSNC" | "COUPNCD" | "COUPNUM" | "COUPPCD"
    );
    if csv && date_function(name) {
        let mut numbers = [0.; 8];
        if coupon {
            numbers[4] = 1.;
        }
        if name == "ACCRINT" {
            numbers[4] = 1000.;
        }
        if name == "ACCRINTM" {
            numbers[3] = 1000.;
        }
        let minimum = arguments(name, csv)?.0;
        for (index, value) in args.iter().enumerate() {
            if index >= minimum
                && matches!(
                    value,
                    Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                )
            {
                continue;
            }
            numbers[index] = match super::production::operand(value, date1904) {
                Ok(n) => n,
                Err(e) => return Some(Value::Error(e)),
            };
        }
        return if matches!(name, "AMORLINC" | "AMORDEGRC") {
            amortization::calculate_public(name, numbers, date1904, work)
        } else if coupon {
            coupons::calculate_csv(name, numbers, date1904, work)
        } else if matches!(name, "PRICE" | "YIELD" | "DURATION" | "MDURATION") {
            bond_price::calculate_csv(name, numbers, date1904, work)
        } else if matches!(name, "ODDLPRICE" | "ODDLYIELD") {
            odd_last::calculate(name, numbers, date1904, work)
        } else {
            Some(discount::calculate_csv(
                name,
                numbers,
                date1904,
                args.get(6).is_none_or(|v| {
                    matches!(
                        v,
                        Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                    )
                }),
            ))
        };
    }
    let dollar = !csv && matches!(name, "DOLLARDE" | "DOLLARFR");
    let treasury = matches!(name, "TBILLEQ" | "TBILLPRICE" | "TBILLYIELD");
    let maturity_security = matches!(name, "PRICEMAT" | "YIELDMAT");
    let amortization = matches!(name, "AMORLINC" | "AMORDEGRC");
    let duration = matches!(name, "DURATION" | "MDURATION");
    let bond = matches!(name, "PRICE" | "YIELD");
    let discount = matches!(
        name,
        "DISC"
            | "INTRATE"
            | "RECEIVED"
            | "PRICEDISC"
            | "YIELDDISC"
            | "YEARFRAC"
            | "PRICEMAT"
            | "YIELDMAT"
            | "ACCRINT"
            | "ACCRINTM"
            | "ODDLPRICE"
            | "ODDLYIELD"
    );
    let basis_index = match name {
        "YEARFRAC" => 2,
        "PRICEMAT" | "YIELDMAT" | "DURATION" | "MDURATION" => 5,
        "ACCRINT" | "AMORLINC" | "AMORDEGRC" | "PRICE" | "YIELD" => 6,
        "ODDLPRICE" | "ODDLYIELD" => 7,
        _ if coupon => 3,
        _ => 4,
    };
    let par_index = match name {
        "ACCRINT" => Some(4),
        "ACCRINTM" => Some(3),
        _ => None,
    };
    let mut numbers = [0.; 7];
    if name == "DDB" {
        numbers[4] = 2.;
    } else if name == "DB" {
        numbers[4] = 12.;
    } else if name == "VDB" {
        numbers[5] = 2.;
    } else if name == "RATE" {
        numbers[5] = 0.1;
    }
    let mut error = None;
    for (index, value) in args.iter().enumerate().rev() {
        if csv
            && index >= arguments(name, csv)?.0
            && matches!(
                value,
                Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
            )
        {
            continue;
        }
        if (discount || amortization || coupon || duration || bond) && index == basis_index
            || par_index == Some(index)
        {
            if let Value::Error(error) | Value::LiteralError(error) = value {
                return Some(Value::Error(error));
            }
            continue;
        }
        let value = match value {
            Value::LiteralError(e) => {
                error = Some(*e);
                Some(0.)
            }
            Value::Error(e) => {
                error.get_or_insert(*e);
                Some(0.)
            }
            Value::Text(text) | Value::UninternedText(text) => number::parse(text, date1904),
            _ => value.numeric(),
        };
        numbers[index] = value.unwrap_or_else(|| {
            error.get_or_insert("#VALUE!");
            0.
        });
        if dollar || treasury || discount || amortization || coupon || duration || bond {
            // Add-in argument conversion stops at the first error, from right to left.
            if let Some(error) = error {
                return Some(Value::Error(error));
            }
            if dollar && index == 1
                || (treasury || discount) && index < 2
                || maturity_security && index == 2
                || matches!(name, "ODDLPRICE" | "ODDLYIELD") && matches!(index, 2 | 6)
                || name == "ACCRINT" && matches!(index, 2 | 5)
                || amortization && matches!(index, 1 | 2)
                || coupon && index < 3
                || duration && (index < 2 || index == 4)
                || bond && (index < 2 || index == 5)
            {
                numbers[index] = rounding::approximate(numbers[index]).trunc();
                if numbers[index] < i32::MIN as f64 || numbers[index] > i32::MAX as f64 {
                    return Some(Value::Error("Err:502"));
                }
            }
        }
    }
    if let Some(error) = error {
        return Some(Value::Error(error));
    }
    if let Some(index) = par_index {
        let value = args.get(index).copied().unwrap_or(&Value::Blank);
        let par = match value {
            Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty => Some(1000.),
            Value::Text(s) | Value::UninternedText(s) if s.is_empty() => Some(1000.),
            Value::Text(s) | Value::UninternedText(s) => number::parse(s, date1904),
            _ => value.numeric(),
        };
        let Some(par) = par else {
            return Some(Value::Error("Err:502"));
        };
        numbers[index] = par;
    }
    let [rate, periods, amount, future, timing, _, _] = numbers;
    let advance = timing != 0.;
    let result = match name {
        "PRICE" | "YIELD" => {
            return bond_price::calculate(
                name,
                numbers,
                args.get(basis_index).copied().unwrap_or(&Value::Blank),
                date1904,
                work,
            );
        }
        "DURATION" | "MDURATION" => {
            let [settlement, maturity, coupon, yield_rate, frequency, ..] = numbers;
            if coupon < 0. || yield_rate < 0. {
                return Some(Value::Error("Err:502"));
            }
            let basis = args.get(basis_index).copied().unwrap_or(&Value::Blank);
            let count = match coupons::calculate(
                "COUPNUM",
                settlement as i32,
                maturity as i32,
                frequency as i32,
                basis,
                date1904,
            ) {
                Ok(count) => count,
                Err(error) => return Some(Value::Error(error)),
            };
            let fraction = match discount::calculate("YEARFRAC", numbers, basis, date1904) {
                Ok(fraction) => fraction,
                Err(error) => return Some(Value::Error(error)),
            };
            let payment = coupon * (100. / frequency);
            let yield_factor = yield_rate / frequency + 1.;
            let offset = fraction * frequency - count;
            let mut duration = 0.;
            let mut price = 0.;
            for period in 1..count as u32 {
                *work = work.checked_sub(1)?;
                let time = f64::from(period) + offset;
                let discount = power::pow(yield_factor, time);
                duration += time * payment / discount;
                price += payment / discount;
            }
            let time = count + offset;
            let discount = power::pow(yield_factor, time);
            duration += time * (payment + 100.) / discount;
            price += (payment + 100.) / discount;
            duration /= price;
            duration /= frequency;
            if name == "MDURATION" {
                duration /= yield_factor;
            }
            if !duration.is_finite() {
                return Some(Value::Error("Err:502"));
            }
            duration
        }
        "COUPDAYBS" | "COUPDAYS" | "COUPDAYSNC" | "COUPNCD" | "COUPNUM" | "COUPPCD" => {
            match coupons::calculate(
                name,
                rate as i32,
                periods as i32,
                amount as i32,
                args.get(basis_index).copied().unwrap_or(&Value::Blank),
                date1904,
            ) {
                Ok(result) => result,
                Err(error) => return Some(Value::Error(error)),
            }
        }
        "AMORLINC" | "AMORDEGRC" => {
            return amortization::calculate(
                name,
                numbers,
                args.get(basis_index).copied().unwrap_or(&Value::Blank),
                date1904,
                work,
            );
        }
        "DISC" | "INTRATE" | "RECEIVED" | "PRICEDISC" | "YIELDDISC" | "YEARFRAC" | "PRICEMAT"
        | "YIELDMAT" | "ACCRINT" | "ACCRINTM" | "ODDLPRICE" | "ODDLYIELD" => {
            match discount::calculate(
                name,
                numbers,
                args.get(basis_index).copied().unwrap_or(&Value::Blank),
                date1904,
            ) {
                Ok(result) => result,
                Err(error) => return Some(Value::Error(error)),
            }
        }
        "TBILLEQ" | "TBILLPRICE" | "TBILLYIELD" => {
            match treasury::calculate(name, rate as i32, periods as i32, amount, date1904) {
                Ok(result) => result,
                Err(error) => return Some(Value::Error(error)),
            }
        }
        "DOLLARDE" | "DOLLARFR" if csv => {
            let denominator = periods.floor();
            if denominator < 0. {
                return Some(Value::Error("#NUM!"));
            }
            if denominator == 0. {
                return Some(Value::Error("#DIV/0!"));
            }
            let digits = 1. + super::math::logarithm::log(denominator - 0.5, 10).floor();
            let whole = rate.abs().floor();
            let fraction = rate.abs() - whole;
            let power = power::pow(10., digits);
            rate.signum()
                * (whole
                    + fraction
                        * if name == "DOLLARDE" {
                            power / denominator
                        } else {
                            denominator / power
                        })
        }
        "DOLLARDE" | "DOLLARFR" => {
            let [amount, fraction, ..] = numbers;
            if fraction <= 0. {
                return Some(Value::Error("Err:502"));
            }
            let digits = fraction.log10().ceil();
            if name == "DOLLARDE" {
                amount.fract() / fraction * power::pow(10., digits) + amount.trunc()
            } else {
                amount.fract() * fraction * power::pow(10., -digits) + amount.trunc()
            }
        }
        "RATE" if csv => {
            let [periods, payment, present, future, timing, guess, _] = numbers;
            let periods = periods.trunc();
            if periods <= 0. {
                return Some(Value::Error("#NUM!"));
            }
            let timing = f64::from(timing != 0.);
            let limit = 1e10_f64.min(power::pow(f64::MAX / 1e10, 1. / periods) - 1.);
            let derivative = |rate| {
                if rate > -1. && rate != 0. {
                    -payment * annuity(rate, periods) / rate
                        + growth(rate, periods - 1.)
                            * periods
                            * (present + payment * (timing + 1. / rate))
                } else {
                    f64::NAN
                }
            };
            let mut solver = goal_seek::Solver::new(
                |rate, _| {
                    Some(if rate > -1. && rate != 0. {
                        present * growth(rate, periods)
                            + payment * (1. + rate * timing) * annuity(rate, periods)
                            + future
                    } else {
                        f64::NAN
                    })
                },
                work,
                -limit,
                limit,
                Some(&derivative),
            );
            if solver.newton(guess)? {
                return Some(Value::number(solver.root));
            }
            let mut factor = 2.;
            while !solver.bracketed() && factor < 100. {
                solver.point(guess * factor)?;
                solver.point(guess / factor)?;
                factor *= 2.;
            }
            if solver.bisect()? {
                solver.root
            } else {
                f64::NAN
            }
        }
        "RATE" => {
            let [periods, payment, present, future, timing, guess, _] = numbers;
            if periods <= 0. {
                return Some(Value::Error("Err:502"));
            }
            let mut cash = [periods, payment, present, future];
            if timing != 0. {
                cash[2] += payment;
                cash[3] -= payment;
            }
            let mut result = rate_iteration(cash, guess, work)?;
            if result.is_none() && args.len() < 6 {
                for step in 2..=10 {
                    result = rate_iteration(cash, guess * step as f64, work)?;
                    if result.is_none() {
                        result = rate_iteration(cash, guess / step as f64, work)?;
                    }
                    if result.is_some() {
                        break;
                    }
                }
            }
            let Some(result) = result else {
                return Some(Value::Error("Err:523"));
            };
            result
        }
        "EFFECT" | "NOMINAL" => {
            if csv && rate <= 0. {
                return Some(Value::Error("#NUM!"));
            }
            if periods < 1. || rate < 0. || name == "NOMINAL" && rate == 0. {
                return Some(Value::Error("Err:502"));
            }
            let periods = if csv {
                periods.floor()
            } else {
                rounding::approximate(periods).floor()
            };
            if name == "NOMINAL" {
                ((1. / periods) * rate.ln_1p()).exp_m1() * periods
            } else if rate == 0. {
                0.
            } else {
                (periods * (rate / periods).ln_1p()).exp_m1()
            }
        }
        "RRI" => {
            let [periods, present, future, ..] = numbers;
            if csv && periods >= 0. && (periods == 0. || present == 0.) {
                return Some(Value::Error("#DIV/0!"));
            }
            if periods <= 0. || present == 0. {
                return Some(Value::Error("Err:502"));
            }
            power::pow(future / present, 1. / periods) - 1.
        }
        "G_DURATION" => {
            let [rate, present, future, ..] = numbers;
            if rate <= 0. || present == 0. || future == 0. {
                return Some(Value::Error("#DIV/0!"));
            }
            let ratio = future / present;
            if ratio < 0. {
                return Some(Value::Error("#VALUE!"));
            }
            if ratio == 0. || !ratio.is_finite() {
                return Some(Value::Error("#NUM!"));
            }
            super::math::logarithm::log(ratio, 0) / rate.ln_1p()
        }
        "PDURATION" => {
            let [rate, present, future, ..] = numbers;
            if rate <= 0. || present <= 0. || future <= 0. {
                return Some(Value::Error("Err:502"));
            }
            (future / present).ln() / rate.ln_1p()
        }
        "PV" => {
            let factor = growth(rate, periods);
            if factor == 0. {
                return Some(Value::Error("#DIV/0!"));
            }
            (-future - amount * if advance { 1. + rate } else { 1. } * annuity(rate, periods))
                / factor
        }
        "FV" => future_value(rate, periods, amount, future, advance),
        "PMT" => payment(rate, periods, amount, future, advance),
        // For NPER the second argument is the payment, the third the present value.
        "NPER" if csv => {
            if rate == 0. {
                return Some(if periods == 0. {
                    Value::Error("#DIV/0!")
                } else {
                    Value::number(-(future + amount) / periods)
                });
            }
            if rate <= -1. {
                return Some(Value::Error("#NUM!"));
            }
            let payment = periods * (1. + rate * f64::from(advance));
            let ratio = (payment - future * rate) / (amount * rate + payment);
            if ratio <= 0. {
                return Some(Value::Error("#VALUE!"));
            }
            if !ratio.is_finite() {
                return Some(Value::Error("#NUM!"));
            }
            super::math::logarithm::log(ratio, 0) / rate.ln_1p()
        }
        "NPER" if amount + future == 0. => 0.,
        "NPER" if rate == 0. => -(amount + future) / periods,
        "NPER" => {
            let payment = if advance {
                periods * (1. + rate)
            } else {
                periods
            };
            (-(rate * future - payment) / (rate * amount + payment)).ln() / rate.ln_1p()
        }
        "IPMT" | "PPMT" => {
            let [rate, period, periods, present, future, timing, _] = numbers;
            if period < 1. || period >= periods + 1. {
                return Some(Value::Error("#NUM!"));
            }
            let advance = timing != 0.;
            let interest = interest(rate, period, periods, present, future, advance);
            if name == "IPMT" {
                interest
            } else {
                payment(rate, periods, present, future, advance) - interest
            }
        }
        "CUMIPMT" | "CUMPRINC" => {
            let [rate, periods, present, start, end, timing, _] = numbers;
            let periods = periods.trunc();
            let start = start.trunc();
            let end = end.trunc();
            if start < 1.
                || end < start
                || rate <= 0.
                || end > periods
                || periods <= 0.
                || present <= 0.
            {
                return Some(Value::Error("#NUM!"));
            }
            let advance = timing != 0.;
            let principal = name == "CUMPRINC";
            let payment = payment(rate, periods, present, 0., advance);
            let mut sum = 0.;
            let count = (end - start + 1.) as usize;
            *work = work.checked_sub(count)?;
            for offset in 0..count {
                let period = start + offset as f64;
                let interest = if advance && period == 1. {
                    0.
                } else {
                    interest(rate, period, periods, present, 0., advance)
                };
                sum += if principal {
                    payment - interest
                } else {
                    interest
                };
            }
            sum
        }
        "ISPMT" => {
            let [rate, period, periods, investment, _, _, _] = numbers;
            if csv {
                let period = period.trunc();
                let periods = periods.trunc();
                if period < 1. || period >= periods + 1. {
                    return Some(Value::Error("#NUM!"));
                }
                -investment * rate * (1. - period / periods)
            } else {
                investment * rate * (period / periods - 1.)
            }
        }
        "SLN" => {
            let [cost, salvage, life, _, _, _, _] = numbers;
            if csv && life <= 0. {
                return Some(Value::Error("#NUM!"));
            }
            if life == 0. {
                return Some(Value::Error("#DIV/0!"));
            }
            (cost - salvage) / life
        }
        "SYD" => {
            let [cost, salvage, life, period, _, _, _] = numbers;
            if csv {
                if life <= 0. {
                    return Some(Value::Error("#NUM!"));
                }
                (cost - salvage) * (life - period + 1.) * 2. / (life * (life + 1.))
            } else {
                ((cost - salvage) * (life - period + 1.)) / ((life * (life + 1.)) / 2.)
            }
        }
        "DDB" if csv => {
            let [cost, salvage, life, period, factor, _, _] = numbers;
            if cost < 0.
                || salvage < 0.
                || life <= 0.
                || period <= 0.
                || period > life
                || factor <= 0.
            {
                return Some(Value::Error("#NUM!"));
            }
            if salvage >= cost {
                return Some(Value::Number(0.));
            }
            if period < 1. && life < 1. {
                return Some(Value::number(cost - salvage));
            }
            let fraction = factor / life;
            let prior = -cost * growth_delta(-fraction, period.max(1.) - 1.);
            if !prior.is_finite() {
                return Some(Value::Error("#NUM!"));
            }
            let remaining = cost - prior;
            (remaining * fraction).min((remaining - salvage).max(0.))
        }
        "DDB" => {
            let [cost, salvage, life, period, factor, _, _] = numbers;
            if cost < 0.
                || salvage < 0.
                || factor <= 0.
                || salvage > cost
                || period < 1.
                || period > life
            {
                return Some(Value::Error("Err:502"));
            }
            declining(cost, salvage, life, period, factor, false)
        }
        "DB" if csv => {
            let [cost, salvage, life, period, months, _, _] = numbers;
            if cost == 0. || life <= 0. || salvage / cost < 0. {
                return Some(Value::Error("#NUM!"));
            }
            let rate = ((1. - power::pow(salvage / cost, 1. / life)) * 1000. + 0.5).floor() / 1000.;
            let mut total = cost * rate * months / 12.;
            if period == 1. {
                return Some(Value::number(total));
            }
            let mut i = 1.;
            while i < life {
                *work = work.checked_sub(1)?;
                if i == period - 1. {
                    return Some(Value::number((cost - total) * rate));
                }
                total += (cost - total) * rate;
                i += 1.;
            }
            (cost - total) * rate * (12. - months) / 12.
        }
        "DB" => {
            let [cost, salvage, life, period, months, _, _] = numbers;
            let months = rounding::approximate(months).floor();
            if !(1. ..=12.).contains(&months)
                || life > 1200.
                || salvage < 0.
                || period > life + 1.
                || salvage > cost
                || cost <= 0.
                || life <= 0.
                || period <= 0.
            {
                return Some(Value::Error("Err:502"));
            }
            let rate = 1. - power::pow(salvage / cost, 1. / life);
            let rate = rounding::approximate(rate * 1000. + 0.5).floor() / 1000.;
            let first = cost * rate * months / 12.;
            if rounding::approximate(period).floor() == 1. {
                first
            } else {
                let mut sum = Sum::default();
                sum.add(first);
                let end = rounding::approximate(life.min(period)).floor() as usize;
                *work = work.checked_sub(end.saturating_sub(1))?;
                let mut result = 0.;
                for _ in 2..=end {
                    let mut balance = sum;
                    balance.add(-cost);
                    result = -balance.total() * rate;
                    sum.add(result);
                }
                if period > life {
                    sum.add(-cost);
                    result = -sum.total() * rate * (12. - months) / 12.;
                }
                result
            }
        }
        "VDB" => {
            let [cost, salvage, life, start, end, factor, _] = numbers;
            if start < 0.
                || end < start
                || end > life
                || cost < 0.
                || salvage > cost
                || factor <= 0.
            {
                return Some(Value::Error("Err:502"));
            }
            if csv
                && numbers[6].trunc() != 0.
                && (end.ceil() > 2147483647. || end.ceil() - start.floor() > 10000.)
            {
                return Some(Value::Error("#VALUE!"));
            }
            variable_depreciation(numbers, csv, work)?
        }
        _ => unreachable!(),
    };
    Some(Value::number(result))
}

fn rate_iteration(cash: [f64; 4], guess: f64, work: &mut usize) -> Option<Option<f64>> {
    let [periods, payment, present, future] = cash;
    let integer = periods.fract() == 0.;
    let mut rate = if !integer && guess < -1. { -1. } else { guess };
    for _ in 0..150 {
        *work = work.checked_sub(1)?;
        let previous = power::pow(1. + rate, periods - 1.);
        let power = if integer {
            previous * (1. + rate)
        } else {
            power::pow(1. + rate, periods)
        };
        let (series, derivative) = if rate == 0. {
            (periods, periods * (periods - 1.) / 2.)
        } else {
            let series = (power - 1.) / rate;
            (series, periods * previous / rate - series / rate)
        };
        let residual = future + present * power + payment * series;
        let slope = present * periods * previous + payment * derivative;
        if residual.abs() < 1e-14 {
            return Some((!integer || rate > -1.).then_some(rate));
        }
        let next = if slope == 0. {
            rate + 1.1 * 1e-7
        } else {
            rate - residual / slope
        };
        let found = (next - rate).abs() < 1e-7;
        rate = next;
        if !integer && (rate < -1. || rate.is_nan()) {
            return Some(None);
        }
        if found {
            return Some((!integer || rate > -1.).then_some(rate));
        }
    }
    Some(None)
}

fn declining(cost: f64, salvage: f64, life: f64, period: f64, factor: f64, csv: bool) -> f64 {
    let rate = factor / life;
    let (rate, previous) = if rate >= 1. {
        (1., if period == 1. { cost } else { 0. })
    } else {
        (
            rate,
            cost * if csv {
                growth(-rate, period - 1.)
            } else {
                power::pow(1. - rate, period - 1.)
            },
        )
    };
    let next = cost
        * if csv {
            growth(-rate, period)
        } else {
            power::pow(1. - rate, period)
        };
    (previous - if next < salvage { salvage } else { next }).max(0.)
}

#[allow(clippy::too_many_arguments)]
fn depreciation_integral(
    cost: f64,
    salvage: f64,
    life: f64,
    remaining_life: f64,
    period: f64,
    factor: f64,
    csv: bool,
    work: &mut usize,
) -> Option<f64> {
    let end = if csv {
        period
    } else {
        rounding::approximate(period)
    }
    .ceil();
    let count = end as usize;
    *work = work.checked_sub(count)?;
    let mut remaining = cost - salvage;
    let mut straight = 0.;
    let mut switched = false;
    let mut sum = Sum::default();
    let mut total = 0.;
    for i in 1..=count {
        let mut term = if switched {
            straight
        } else {
            let declining = declining(cost, salvage, life, i as f64, factor, csv);
            straight = remaining
                / if csv {
                    remaining_life - i as f64 + 1.
                } else {
                    remaining_life - (i - 1) as f64
                };
            if straight > declining {
                switched = true;
                straight
            } else {
                remaining -= declining;
                declining
            }
        };
        if i == count {
            term *= period + 1. - end;
        }
        if csv {
            total += term;
        } else {
            sum.add(term);
        }
    }
    Some(if csv { total } else { sum.total() })
}

fn variable_depreciation(numbers: [f64; 7], csv: bool, work: &mut usize) -> Option<f64> {
    let [mut cost, salvage, life, start, end, factor, no_switch] = numbers;
    let first = if csv {
        start
    } else {
        rounding::approximate(start)
    }
    .floor();
    let last = if csv { end } else { rounding::approximate(end) }.ceil();
    let mut sum = Sum::default();
    if (if csv { no_switch.trunc() } else { no_switch }) != 0. {
        let mut total = 0.;
        let count = (last - first) as usize;
        *work = work.checked_sub(count)?;
        for offset in 1..=count {
            let mut term = declining(cost, salvage, life, first + offset as f64, factor, csv);
            if offset == 1 {
                term *= end.min(first + 1.) - start;
            } else if offset == count {
                term *= end + 1. - last;
            }
            if csv {
                total += term;
            } else {
                sum.add(term);
            }
        }
        return Some(if csv { total } else { sum.total() });
    } else {
        let mut part = 0.;
        if if csv {
            start > first
        } else {
            !approximately_equal(start, first)
        } {
            let value =
                cost - depreciation_integral(cost, salvage, life, life, first, factor, csv, work)?;
            part += (start - first)
                * depreciation_integral(value, salvage, life, life - first, 1., factor, csv, work)?;
        }
        if if csv {
            end < last
        } else {
            !approximately_equal(end, last)
        } {
            let previous = last - 1.;
            let value = cost
                - depreciation_integral(cost, salvage, life, life, previous, factor, csv, work)?;
            part += (last - end)
                * depreciation_integral(
                    value,
                    salvage,
                    life,
                    life - previous,
                    1.,
                    factor,
                    csv,
                    work,
                )?;
        }
        cost -= depreciation_integral(cost, salvage, life, life, first, factor, csv, work)?;
        let integral = depreciation_integral(
            cost,
            salvage,
            life,
            life - first,
            last - first,
            factor,
            csv,
            work,
        )?;
        if csv {
            return Some(integral - part);
        }
        sum.add(integral);
        sum.add(-part);
    }
    Some(sum.total())
}

fn payment(rate: f64, periods: f64, present: f64, future: f64, advance: bool) -> f64 {
    (-present * growth(rate, periods) - future)
        / (if advance { 1. + rate } else { 1. } * annuity(rate, periods))
}

fn future_value(rate: f64, periods: f64, payment: f64, present: f64, advance: bool) -> f64 {
    -present * growth(rate, periods)
        - if advance { 1. + rate } else { 1. } * payment * annuity(rate, periods)
}

fn growth(rate: f64, periods: f64) -> f64 {
    if (rate + 1.) - 1. == rate || rate.abs() > 0.5 {
        power::pow(1. + rate, periods)
    } else {
        exponential::exp(periods * rate.ln_1p())
    }
}

fn growth_delta(rate: f64, periods: f64) -> f64 {
    if rate <= -1. {
        power::pow(1. + rate, periods) - 1.
    } else {
        (periods * rate.ln_1p()).exp_m1()
    }
}

fn annuity(rate: f64, periods: f64) -> f64 {
    if rate == 0. {
        periods
    } else {
        growth_delta(rate, periods) / rate
    }
}

fn interest(rate: f64, period: f64, periods: f64, present: f64, future: f64, advance: bool) -> f64 {
    let payment = payment(rate, periods, present, future, false);
    -(present * growth(rate, period - 1.) * rate + payment * growth_delta(rate, period - 1.))
        / if advance { 1. + rate } else { 1. }
}

#[cfg(test)]
mod tests {
    use super::{Value, calculate};

    #[test]
    fn zero_interest_has_the_production_positive_zero_value() {
        // Public runSofficeCli: IPMT(0,12,12,1000,100,0) stores positive zero.
        let args = [0., 12., 12., 1000., 100., 0.].map(Value::Number);
        let Value::Number(value) =
            calculate("IPMT", &args.each_ref(), false, false, &mut 1000).unwrap()
        else {
            panic!("numeric interest")
        };
        assert_eq!(value.to_bits(), 0.0_f64.to_bits());
    }
}

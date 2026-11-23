// Annuity, growth and depreciation formulas adapted from IronCalc
// financial/{mod,financial_util,financial_depreciation}.rs at
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT; LICENSE.IronCalc).
// ln_1p/exp_m1 preserve small rates; cumulative calculations charge their
// bounded work before iterating, and DB uses the geometric balance directly.
use super::{Value, lookup::number};
#[path = "office_formula_accrint.rs"]
mod accrint;
#[path = "office_formula_bonds.rs"]
mod bonds;
#[path = "office_formula_depreciation.rs"]
mod depreciation;
#[path = "office_formula_odd_bonds.rs"]
mod odd_bonds;
#[path = "office_formula_securities.rs"]
mod securities;

pub(super) fn arguments(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "PMT" | "PV" | "FV" | "NPER" => (3, 5),
        "RATE" => (3, 6),
        "IPMT" | "PPMT" => (4, 6),
        "ISPMT" | "SYD" => (4, 4),
        "RRI" | "SLN" | "PDURATION" => (3, 3),
        "NOMINAL" | "EFFECT" | "DOLLARDE" | "DOLLARFR" => (2, 2),
        "CUMIPMT" | "CUMPRINC" => (6, 6),
        "DB" | "DDB" => (4, 5),
        "VDB" => (5, 7),
        "AMORLINC" | "AMORDEGRC" => (6, 7),
        "COUPDAYBS" | "COUPDAYS" | "COUPDAYSNC" | "COUPNCD" | "COUPNUM" | "COUPPCD" => (3, 4),
        "PRICE" | "YIELD" => (6, 7),
        "ACCRINTM" => (3, 5),
        "ACCRINT" => (6, 8),
        "ODDFPRICE" | "ODDFYIELD" => (8, 9),
        "ODDLPRICE" | "ODDLYIELD" => (7, 8),
        "DISC" | "INTRATE" | "PRICEDISC" | "RECEIVED" | "YIELDDISC" => (4, 5),
        "PRICEMAT" | "YIELDMAT" => (5, 6),
        "TBILLEQ" | "TBILLPRICE" | "TBILLYIELD" => (3, 3),
        "DURATION" | "MDURATION" => (5, 6),
        _ => return None,
    })
}

fn annuity(rate: f64, n: f64) -> (f64, f64, f64) {
    if rate == 0. {
        return (1., n, n * (n - 1.) / 2.);
    }
    let growth = if rate > -1. {
        (n * rate.ln_1p()).exp()
    } else {
        (1. + rate).powf(n)
    };
    let difference = if rate > -1. {
        (n * rate.ln_1p()).exp_m1()
    } else {
        growth - 1.
    };
    let factor = difference / rate;
    let derivative = if (rate * n).abs() < 1e-4 && rate.abs() < 1e-4 {
        n * (n - 1.) * (0.5 + (n - 2.) * rate / 3. + (n - 2.) * (n - 3.) * rate * rate / 8.)
    } else {
        (n * rate * growth / (1. + rate) - difference) / (rate * rate)
    };
    (growth, factor, derivative)
}

fn payment(rate: f64, n: f64, pv: f64, fv: f64, start: bool) -> Result<f64, &'static str> {
    if n == 0. || rate <= -1. {
        return Err("#NUM!");
    }
    let (growth, factor, _) = annuity(rate, n);
    let when = if start { 1. + rate } else { 1. };
    let result = if growth.is_infinite() && rate > 0. && n > 0. {
        let discount = (-n * rate.ln_1p()).exp();
        -(pv + fv * discount) * rate / ((1. - discount) * when)
    } else {
        -(pv * growth + fv) / (factor * when)
    };
    if result.is_finite() {
        Ok(result)
    } else {
        Err("#NUM!")
    }
}

fn future(rate: f64, n: f64, pmt: f64, pv: f64, start: bool) -> Result<f64, &'static str> {
    if rate == -1. && n < 0. {
        return Err("#DIV/0!");
    }
    let (growth, factor, _) = annuity(rate, n);
    let when = if start { 1. + rate } else { 1. };
    let result = if growth > 1e6 && rate != 0. {
        let payment_balance = pmt * when / rate;
        let coefficient = pv + payment_balance;
        if coefficient == 0. {
            payment_balance
        } else {
            -coefficient * growth + payment_balance
        }
    } else {
        -pv * growth - pmt * when * factor
    };
    if result.is_nan() {
        Err("#NUM!")
    } else if result.is_infinite() {
        Err("#DIV/0!")
    } else {
        Ok(result)
    }
}

fn interest(rate: f64, period: f64, pmt: f64, pv: f64, start: bool) -> Result<f64, &'static str> {
    if rate == 0. || start && period == 1. {
        return Ok(0.);
    }
    let balance = future(rate, period - if start { 2. } else { 1. }, pmt, pv, start)?;
    Ok((balance - if start { pmt } else { 0. }) * rate)
}

fn solve_rate(
    n: f64,
    pmt: f64,
    pv: f64,
    fv: f64,
    start: bool,
    guess: f64,
    work: &mut usize,
) -> Option<Value> {
    if guess <= -1. {
        return Some(Value::Error("#VALUE!"));
    }
    let scale = pmt.abs().max(pv.abs()).max(fv.abs()).max(1.);
    let (pmt, pv, fv) = (pmt / scale, pv / scale, fv / scale);
    let when = if start { 1. } else { 0. };
    let mut rate = guess;
    for _ in 0..100 {
        *work = work.checked_sub(64)?;
        let (growth, a, derivative) = annuity(rate, n);
        let f = pv * growth + pmt * (1. + when * rate) * a + fv;
        let fp = pv * n * growth / (1. + rate) + pmt * (when * a + (1. + when * rate) * derivative);
        if f == 0. && fp != 0. {
            return Some(Value::number(rate));
        }
        if !f.is_finite() || !fp.is_finite() || fp == 0. {
            break;
        }
        let mut next = rate - f / fp;
        if !next.is_finite() {
            break;
        }
        if next <= -1. {
            next = (rate - 1.) / 2.;
        }
        if (next - rate).abs() < 1e-12 && f.abs() < 1e-9 {
            return Some(Value::number(next));
        }
        rate = next;
    }
    Some(Value::Error("#NUM!"))
}

fn log_ratio(value: f64, base: f64) -> f64 {
    let change = (value - base) / base;
    if change.abs() < 0.5 {
        change.ln_1p()
    } else {
        value.ln() - base.ln()
    }
}

pub(super) fn calculate(
    name: &str,
    args: &[&Value],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    if matches!(name, "ODDFPRICE" | "ODDFYIELD" | "ODDLPRICE" | "ODDLYIELD") {
        return odd_bonds::calculate(name, args, date1904, work);
    }
    if name == "ACCRINT" {
        return accrint::calculate(args, date1904, work);
    }
    if matches!(
        name,
        "COUPDAYBS"
            | "COUPDAYS"
            | "COUPDAYSNC"
            | "COUPNCD"
            | "COUPNUM"
            | "COUPPCD"
            | "PRICE"
            | "YIELD"
            | "DURATION"
            | "MDURATION"
    ) {
        return bonds::calculate(name, args, date1904, work);
    }
    if matches!(
        name,
        "ACCRINTM"
            | "DISC"
            | "INTRATE"
            | "PRICEDISC"
            | "RECEIVED"
            | "YIELDDISC"
            | "PRICEMAT"
            | "YIELDMAT"
            | "TBILLEQ"
            | "TBILLPRICE"
            | "TBILLYIELD"
    ) {
        return securities::calculate(name, args, date1904, work);
    }
    let mut numbers = [0.; 7];
    match name {
        "RATE" => numbers[5] = 0.1,
        "DB" => numbers[4] = 12.,
        "DDB" => numbers[4] = 2.,
        "VDB" => numbers[5] = 2.,
        _ => {}
    }
    for (i, arg) in args.iter().enumerate() {
        if name == "VDB" && i == 5 && matches!(arg, Value::Blank) {
            continue;
        }
        if let Value::Error(e) | Value::LiteralError(e) = arg {
            return Some(Value::Error(e));
        }
        let strict = matches!(
            name,
            "NOMINAL"
                | "EFFECT"
                | "DOLLARDE"
                | "DOLLARFR"
                | "CUMIPMT"
                | "CUMPRINC"
                | "AMORLINC"
                | "AMORDEGRC"
        ) || i == 4 && matches!(name, "DB" | "DDB");
        if strict && matches!(arg, Value::Bool(_)) {
            return Some(Value::Error("#VALUE!"));
        }
        let value = match arg {
            Value::Text(s) | Value::UninternedText(s) => number::parse(s, date1904),
            _ => arg.numeric(),
        };
        let Some(value) = value.filter(|n| n.is_finite()) else {
            return Some(Value::Error("#VALUE!"));
        };
        numbers[i] = value;
    }
    if matches!(name, "VDB" | "AMORLINC" | "AMORDEGRC") {
        return depreciation::calculate(name, numbers, date1904, work);
    }
    let [a, b, c, d, e, f, _] = numbers;
    if name == "RATE" {
        return solve_rate(a, b, c, d, e != 0., f, work);
    }
    if matches!(name, "CUMIPMT" | "CUMPRINC") {
        let (first, last) = (d.ceil(), e.trunc());
        if a <= 0.
            || b <= 0.
            || c <= 0.
            || first < 1.
            || first > last
            || last > b
            || !matches!(f, 0. | 1.)
        {
            return Some(Value::Error("#NUM!"));
        }
        let count = last - first + 1.;
        if count > (*work / 64) as f64 {
            return None;
        }
        *work = work.checked_sub((count as usize).checked_mul(64)?)?;
        let pmt = match payment(a, b, c, 0., f != 0.) {
            Ok(v) => v,
            Err(e) => return Some(Value::Error(e)),
        };
        let (mut total, mut correction) = (0., 0.);
        for i in 0..count as usize {
            let v = match interest(a, first + i as f64, pmt, c, f != 0.) {
                Ok(v) => v,
                Err(e) => return Some(Value::Error(e)),
            };
            let v = if name == "CUMIPMT" { v } else { pmt - v };
            let next = v - correction;
            let sum = total + next;
            correction = (sum - total) - next;
            total = sum;
        }
        return Some(Value::number(total));
    }
    let result = (|| -> Result<f64, &'static str> {
        Ok(match name {
            "PMT" => payment(a, b, c, d, e != 0.)?,
            "FV" => future(a, b, c, d, e != 0.)?,
            "PV" => {
                if a == -1. {
                    return Err("#DIV/0!");
                }
                if a == 0. {
                    -d - c * b
                } else if a > -1. {
                    let x = -b * a.ln_1p();
                    -d * x.exp() + c * (if e != 0. { 1. + a } else { 1. }) * x.exp_m1() / a
                } else {
                    let (g, factor, _) = annuity(a, b);
                    (-d - c * (if e != 0. { 1. + a } else { 1. }) * factor) / g
                }
            }
            "NPER" => {
                if a == 0. {
                    if b == 0. {
                        return Err("#DIV/0!");
                    }
                    -(c + d) / b
                } else {
                    if a <= -1. {
                        return Err("#NUM!");
                    }
                    let divisor = b * (if e != 0. { 1. + a } else { 1. }) + c * a;
                    if divisor == 0. {
                        return Err("#NUM!");
                    }
                    let x = -(c + d) * a / divisor;
                    if x <= -1. {
                        return Err("#NUM!");
                    }
                    x.ln_1p() / a.ln_1p()
                }
            }
            "IPMT" | "PPMT" => {
                if b < 1. || b >= c + 1. {
                    return Err("#NUM!");
                }
                let pmt = payment(a, c, d, e, f != 0.)?;
                let ipmt = interest(a, b, pmt, d, f != 0.)?;
                if name == "IPMT" { ipmt } else { pmt - ipmt }
            }
            "ISPMT" => {
                if c == 0. {
                    return Err("#DIV/0!");
                }
                d * a * (b / c - 1.)
            }
            "RRI" => {
                if a <= 0. {
                    return Err("#NUM!");
                }
                if b == c {
                    0.
                } else {
                    if b == 0. {
                        return Err("#NUM!");
                    }
                    if b.signum() == c.signum() {
                        (log_ratio(c.abs(), b.abs()) / a).exp_m1()
                    } else {
                        (c / b).powf(1. / a) - 1.
                    }
                }
            }
            "SLN" => {
                if c == 0. {
                    return Err("#DIV/0!");
                }
                (a - b) / c
            }
            "SYD" => {
                if c <= 0. || d <= 0. || d > c {
                    return Err("#NUM!");
                }
                (a - b) * (c - d + 1.) * 2. / (c * (c + 1.))
            }
            "PDURATION" => {
                if a <= 0. || b <= 0. || c <= 0. {
                    return Err("#NUM!");
                }
                log_ratio(c, b) / a.ln_1p()
            }
            "NOMINAL" | "EFFECT" => {
                let n = b.floor();
                if a <= 0. || n < 1. {
                    return Err("#NUM!");
                }
                if name == "NOMINAL" {
                    (a.ln_1p() / n).exp_m1() * n
                } else {
                    (n * (a / n).ln_1p()).exp_m1()
                }
            }
            "DOLLARDE" | "DOLLARFR" => {
                if b < 0. {
                    return Err("#NUM!");
                }
                let base = b.trunc();
                if base < 1. {
                    return Err("#DIV/0!");
                }
                let exponent = base.log10().ceil();
                let scale = if exponent > 308. {
                    (1e308 / base) * 10.
                } else {
                    10_f64.powf(exponent) / base
                };
                let whole = a.trunc();
                whole
                    + (a - whole)
                        * if name == "DOLLARDE" {
                            scale
                        } else {
                            1. / scale
                        }
            }
            "DDB" => {
                if a < 0. || b < 0. || c <= 0. || d <= 0. || d > c || e <= 0. {
                    return Err("#NUM!");
                }
                depreciation::declining(a, b, c, d, e)
            }
            "DB" => {
                let months = e.trunc();
                if a < 0.
                    || b < 0.
                    || c <= 0.
                    || d <= 0.
                    || d > c + 1.
                    || months <= 0.
                    || months > 12.
                    || months == 12. && d > c
                {
                    return Err("#NUM!");
                }
                if a == 0. {
                    0.
                } else {
                    let rate = ((1. - (b / a).powf(1. / c)) * 1000.).round() / 1000.;
                    let first = a * rate * (months / 12.);
                    let period = d.trunc();
                    if period <= 1. {
                        first
                    } else {
                        let balance = (a - first) * (1. - rate).powf(period - 2.);
                        balance
                            * rate
                            * if period == c.trunc() + 1. {
                                (12. - months) / 12.
                            } else {
                                1.
                            }
                    }
                }
            }
            _ => return Err("#NAME?"),
        })
    })();
    Some(match result {
        Ok(n) => Value::number(n),
        Err(e) => Value::Error(e),
    })
}

// Cash-flow formulas adapted from IronCalc financial/{mod,financial_util}.rs,
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT; LICENSE.IronCalc).
// Direct NPV coercion and array rates follow Univer's financial functions,
// 4767b3b309467c283bbd52b725536ca73861e0fc (Apache-2.0; LICENSE.Univer).
// The solver uses log rates and scaled terms so long schedules cannot create
// false roots by underflowing the entire present-value sum to zero.
use super::{Calculation, Coord, Expr, Value, lookup::number};
use std::collections::BTreeSet;

fn numeric(value: &Value, date1904: bool, strict: bool) -> Result<f64, &'static str> {
    match value {
        Value::Error(e) | Value::LiteralError(e) => Err(e),
        Value::Bool(_) if strict => Err("#VALUE!"),
        Value::Text(s) | Value::UninternedText(s) => number::parse(s, date1904).ok_or("#VALUE!"),
        _ => value.numeric().ok_or("#VALUE!"),
    }
}

// Neumaier compensation without approximate cancellation: a one-unit cash flow
// between large opposite payments must not disappear.
fn add(sum: &mut (f64, f64), value: f64) {
    let next = sum.0 + value;
    sum.1 += if sum.0.abs() >= value.abs() {
        (sum.0 - next) + value
    } else {
        (value - next) + sum.0
    };
    sum.0 = next;
}

fn present(rate: f64, values: &[f64], dates: Option<&[f64]>, work: &mut usize) -> Option<Value> {
    if rate == -1. {
        return Some(Value::Error("#DIV/0!"));
    }
    let mut sum = (0., 0.);
    let (mut scaled, mut scale) = ((0., 0.), 0.);
    for (i, &value) in values.iter().enumerate() {
        *work = work.checked_sub(32)?;
        if value == 0. {
            continue;
        }
        let time = dates.map_or((i + 1) as f64, |dates| (dates[i] - dates[0]) / 365.);
        let term = if rate > -1. {
            let exponent = -time * rate.ln_1p();
            let term = value * exponent.exp();
            if term.is_finite() && term != 0. {
                term
            } else {
                (value.abs().ln() + exponent).exp().copysign(value)
            }
        } else {
            value / (1. + rate).powi((i + 1) as i32)
        };
        if !term.is_finite() {
            return Some(Value::Error("#NUM!"));
        }
        if term.abs() > scale {
            scaled.0 *= scale / term.abs();
            scaled.1 *= scale / term.abs();
            scale = term.abs();
        }
        if scale > 0. {
            add(&mut scaled, term / scale);
        }
        add(&mut sum, term);
    }
    let total = sum.0 + sum.1;
    Some(Value::number(if total.is_finite() {
        total
    } else {
        (scaled.0 + scaled.1) * scale
    }))
}

fn residual(terms: &[(f64, f64, f64)], y: f64, work: &mut usize) -> Option<(f64, f64, f64)> {
    *work = work.checked_sub(terms.len().checked_mul(64)?)?;
    let scale = terms
        .iter()
        .map(|&(_, log, t)| log - t * y)
        .fold(f64::NEG_INFINITY, f64::max);
    let (mut f, mut derivative, mut mass) = ((0., 0.), (0., 0.), 0.);
    for &(sign, log, t) in terms {
        let value = sign * (log - t * y - scale).exp();
        add(&mut f, value);
        add(&mut derivative, -t * value);
        mass += value.abs();
    }
    Some((f.0 + f.1, derivative.0 + derivative.1, mass))
}

fn return_rate(
    values: &[f64],
    dates: Option<&[f64]>,
    guess: f64,
    work: &mut usize,
) -> Option<Value> {
    if guess <= -1. {
        return Some(Value::Error("#VALUE!"));
    }
    if !values.iter().any(|&n| n > 0.) || !values.iter().any(|&n| n < 0.) {
        return Some(Value::Error("#NUM!"));
    }
    *work = work.checked_sub(values.len().checked_mul(24)?)?;
    let mut terms: Vec<_> = values
        .iter()
        .enumerate()
        .filter(|&(_, v)| *v != 0.)
        .map(|(i, &v)| {
            (
                v.signum(),
                v.abs().ln(),
                dates.map_or(i as f64, |d| (d[i] - d[0]) / 365.),
            )
        })
        .collect();
    let first = terms
        .iter()
        .map(|&(_, _, t)| t)
        .fold(f64::INFINITY, f64::min);
    for (_, _, t) in &mut terms {
        *t -= first;
    }
    if terms.iter().all(|&(_, _, t)| t == 0.) {
        return Some(Value::Error("#NUM!"));
    }
    let low = (-1. + f64::EPSILON / 2.).ln_1p();
    let high = f64::MAX.ln();
    let initial = guess.ln_1p();
    let mut y = initial;
    for _ in 0..100 {
        let (f, derivative, mass) = residual(&terms, y, work)?;
        if f.abs() <= 1e-13 * mass {
            return Some(Value::number(y.exp_m1()));
        }
        if derivative == 0. || !derivative.is_finite() {
            break;
        }
        let next = (y - (f / derivative).clamp(-4., 4.)).clamp(low, high);
        if next == y {
            break;
        }
        y = next;
    }
    // Fallback brackets in log-rate space span every finite representable rate.
    // Prefer a bracket near the guess when the cash flows have multiple roots.
    let mut points = vec![
        low, -32., -16., -8., -4., -2., -1., -0.5, -0.25, -0.1, 0., 0.1, 0.25, 0.5, 1., 2., 4., 8.,
        16., 32., 64., 128., 256., 512., high, initial,
    ];
    points.sort_by(f64::total_cmp);
    let mut bracket = None;
    let mut previous: Option<(f64, f64)> = None;
    let mut distance = f64::INFINITY;
    for y in points {
        let (f, _, mass) = residual(&terms, y, work)?;
        if f.abs() <= 1e-13 * mass {
            return Some(Value::number(y.exp_m1()));
        }
        if let Some((x, old)) = previous {
            if f64::is_sign_positive(f) != f64::is_sign_positive(old) {
                let d = (initial - (x + y) / 2.).abs();
                if d < distance {
                    bracket = Some((x, y, old));
                    distance = d;
                }
            }
        }
        previous = Some((y, f));
    }
    if let Some((mut left, mut right, mut fl)) = bracket {
        for _ in 0..100 {
            let mid = (left + right) / 2.;
            let (f, _, mass) = residual(&terms, mid, work)?;
            if f.abs() <= 1e-13 * mass || right - left < 1e-13 {
                return Some(Value::number(mid.exp_m1()));
            }
            if f.is_sign_positive() == fl.is_sign_positive() {
                left = mid;
                fl = f;
            } else {
                right = mid;
            }
        }
    }
    Some(Value::Error("#NUM!"))
}

fn log_cashflow_sum(values: &[f64], rate: f64, future: bool, work: &mut usize) -> Option<f64> {
    *work = work.checked_sub(values.len().checked_mul(64)?)?;
    let log_rate = rate.ln_1p();
    let term = |i: usize, v: f64| {
        v.abs().ln()
            + if future {
                (values.len() - 1 - i) as f64 * log_rate
            } else {
                -(i as f64) * log_rate
            }
    };
    let maximum = values
        .iter()
        .enumerate()
        .filter(|&(_, v)| if future { *v > 0. } else { *v < 0. })
        .map(|(i, &v)| term(i, v))
        .fold(f64::NEG_INFINITY, f64::max);
    let mut sum = (0., 0.);
    for (i, &value) in values.iter().enumerate() {
        if if future { value > 0. } else { value < 0. } {
            add(&mut sum, (term(i, value) - maximum).exp());
        }
    }
    Some(maximum + (sum.0 + sum.1).ln())
}

fn modified(values: &[f64], finance: f64, reinvest: f64, work: &mut usize) -> Option<Value> {
    if values.len() < 2 || !values.iter().any(|&n| n < 0.) || !values.iter().any(|&n| n > 0.) {
        return Some(Value::Error("#DIV/0!"));
    }
    let last = values.len() - 1;
    let (mut future, mut present) = ((0., 0.), (0., 0.));
    for (i, &value) in values.iter().enumerate() {
        *work = work.checked_sub(32)?;
        if value > 0. {
            add(&mut future, value * (1. + reinvest).powi((last - i) as i32));
        }
        if value < 0. {
            if finance == -1. && i > 0 {
                return Some(Value::Number(-1.));
            }
            add(&mut present, -value / (1. + finance).powi(i as i32));
        }
    }
    let ratio = (future.0 + future.1) / (present.0 + present.1);
    if ratio.is_finite() && ratio != 0. || finance <= -1. || reinvest <= -1. {
        return Some(Value::number(ratio.powf(1. / last as f64) - 1.));
    }
    let log_future = log_cashflow_sum(values, reinvest, true, work)?;
    let log_present = log_cashflow_sum(values, finance, false, work)?;
    Some(Value::number(
        ((log_future - log_present) / last as f64).exp_m1(),
    ))
}

fn growth(principal: f64, rates: &[f64], work: &mut usize) -> Option<Value> {
    let mut product = principal;
    for &rate in rates {
        *work = work.checked_sub(8)?;
        if rate == -1. {
            return Some(Value::Number(0.));
        }
        product *= 1. + rate;
    }
    if product.is_finite() && product != 0. || principal == 0. {
        return Some(Value::number(product));
    }
    let mut log = (principal.abs().ln(), 0.);
    let mut sign = principal.signum();
    for &rate in rates {
        *work = work.checked_sub(16)?;
        if rate < -1. {
            sign = -sign;
            add(&mut log, (-(1. + rate)).ln());
        } else {
            add(&mut log, rate.ln_1p());
        }
    }
    Some(Value::number(sign * (log.0 + log.1).exp()))
}

impl Calculation<'_> {
    fn cashflow_series(
        &mut self,
        value: Value,
        name: &str,
        dates: bool,
        depth: usize,
    ) -> Option<Result<Vec<f64>, &'static str>> {
        let mut numbers = Vec::new();
        if matches!(name, "XNPV" | "XIRR") {
            if name == "XIRR" && matches!(value, Value::Number(_)) {
                return Some(Err("#VALUE!"));
            }
            let matrix = self.matrix(value, depth + 1)?;
            for row in matrix {
                for value in row {
                    self.tick(depth)?;
                    let n = match value {
                        Value::Number(n) => n,
                        Value::Blank | Value::Empty if name == "XIRR" => 0.,
                        Value::Blank | Value::Empty => return Some(Err("#NUM!")),
                        Value::Error(e) | Value::LiteralError(e) => return Some(Err(e)),
                        _ => {
                            return Some(Err(if dates || name == "XIRR" {
                                "#VALUE!"
                            } else {
                                "#NUM!"
                            }));
                        }
                    };
                    self.work = self.work.checked_sub(8)?;
                    numbers.push(n);
                }
            }
            return Some(Ok(numbers));
        }
        let mut pending = vec![(value, false)];
        while let Some((mut value, mut reference)) = pending.pop() {
            self.tick(depth)?;
            match value {
                Value::InvalidReference | Value::InvalidRange(..) => return Some(Err("#REF!")),
                Value::Single(c) => {
                    value = self.cell(c, depth + 1)?;
                    reference = true;
                }
                Value::Range(a, b) if a.0 == b.0 => {
                    self.read_spill_range(a, b)?;
                    let (start, end) = (
                        (a.0, a.1.min(b.1), a.2.min(b.2)),
                        (a.0, a.1.max(b.1), a.2.max(b.2)),
                    );
                    let mut cells = BTreeSet::new();
                    for &c in self
                        .values
                        .range(start..=end)
                        .map(|(c, _)| c)
                        .chain(self.expressions.range(start..=end).map(|(c, _)| c))
                    {
                        self.work = self.work.checked_sub(1)?;
                        if (start.2..=end.2).contains(&c.2) {
                            self.work = self.work.checked_sub(96)?;
                            cells.insert(c);
                        }
                    }
                    pending.extend(cells.into_iter().rev().map(|c| (Value::Single(c), true)));
                    continue;
                }
                Value::Range(..) | Value::Set(_) => return Some(Err("#VALUE!")),
                Value::Matrix(rows) => {
                    let count = rows.iter().map(Vec::len).sum::<usize>();
                    self.work = self
                        .work
                        .checked_sub(count.checked_mul(std::mem::size_of::<(Value, bool)>())?)?;
                    pending.extend(
                        rows.into_iter()
                            .rev()
                            .flat_map(|r| r.into_iter().rev())
                            .map(|v| (v, true)),
                    );
                    continue;
                }
                _ => {}
            }
            let n = match value {
                Value::Error(e) | Value::LiteralError(e) => return Some(Err(e)),
                Value::Number(n) => n,
                Value::Blank | Value::Empty => continue,
                _ if name == "NPV" && !reference => {
                    match numeric(&value, self.book.date1904, false) {
                        Ok(n) => n,
                        Err(e) => return Some(Err(e)),
                    }
                }
                _ if name == "FVSCHEDULE" => return Some(Err("#VALUE!")),
                _ => continue,
            };
            self.work = self.work.checked_sub(8)?;
            numbers.push(n);
        }
        Some(Ok(numbers))
    }

    pub(super) fn cashflow(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let (minimum, maximum) = match name {
            "NPV" => (2, 255),
            "IRR" => (1, 2),
            "XIRR" => (2, 3),
            "FVSCHEDULE" => (2, 2),
            _ => (3, 3),
        };
        if !(minimum..=maximum).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let mut numbers = Vec::new();
        let mut dates = Vec::new();
        let mut scalars = Vec::new();
        let (mut height, mut width) = (1, 1);
        for (i, arg) in args.iter().enumerate() {
            let value = self.eval(arg, pos, depth + 1, true)?;
            if let Value::Error(e) = value {
                return Some(Value::Error(e));
            }
            let scalar = match name {
                "NPV" | "FVSCHEDULE" | "XNPV" => i == 0,
                "IRR" | "MIRR" => i > 0,
                _ => i == 2,
            };
            if scalar {
                let rows = self.matrix(value, depth + 1)?;
                height = height.max(rows.len());
                width = width.max(rows.first()?.len());
                scalars.push(rows);
            } else {
                let is_date = name == "XNPV" && i == 2 || name == "XIRR" && i == 1;
                let series = match self.cashflow_series(value, name, is_date, depth + 1)? {
                    Ok(v) => v,
                    Err(e) => return Some(Value::Error(e)),
                };
                if is_date {
                    dates = series;
                } else {
                    numbers.extend(series);
                }
            }
        }
        if scalars.is_empty() {
            scalars.push(vec![vec![Value::Number(0.1)]]);
        }
        let dated = matches!(name, "XNPV" | "XIRR");
        if dated {
            if numbers.is_empty() || dates.len() != numbers.len() {
                return Some(Value::Error("#NUM!"));
            }
            for n in &mut dates {
                *n = n.floor();
            }
            let maximum = 2_958_465. - if self.book.date1904 { 1462. } else { 0. };
            if dates.iter().any(|&d| d < 0. || d > maximum || d < dates[0]) {
                return Some(Value::Error("#NUM!"));
            }
        }
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?,
        )?;
        let mut output = Vec::new();
        for r in 0..height {
            let mut row = Vec::new();
            for c in 0..width {
                self.tick(depth)?;
                let mut parameters = [0.; 2];
                let mut error = None;
                for (i, matrix) in scalars.iter().enumerate() {
                    let value = matrix
                        .get(if matrix.len() == 1 { 0 } else { r })
                        .and_then(|row| row.get(if row.len() == 1 { 0 } else { c }))
                        .unwrap_or(&Value::Error("#N/A"));
                    self.charge_value(value)?;
                    match numeric(value, self.book.date1904, dated) {
                        Ok(n) => parameters[i] = n,
                        Err(e) => {
                            error = Some(e);
                            break;
                        }
                    }
                }
                let value = if let Some(e) = error {
                    Value::Error(e)
                } else {
                    match name {
                        "NPV" => present(parameters[0], &numbers, None, &mut self.work)?,
                        "XNPV" if parameters[0] < 0. => Value::Error("#NUM!"),
                        "XNPV" => present(parameters[0], &numbers, Some(&dates), &mut self.work)?,
                        "IRR" | "XIRR" => return_rate(
                            &numbers,
                            dated.then_some(dates.as_slice()),
                            parameters[0],
                            &mut self.work,
                        )?,
                        "MIRR" => modified(&numbers, parameters[0], parameters[1], &mut self.work)?,
                        _ => growth(parameters[0], &numbers, &mut self.work)?,
                    }
                };
                row.push(value);
            }
            output.push(row);
        }
        self.result_format = None;
        Some(if height == 1 && width == 1 {
            output.pop()?.pop()?
        } else {
            Value::Matrix(output)
        })
    }
}

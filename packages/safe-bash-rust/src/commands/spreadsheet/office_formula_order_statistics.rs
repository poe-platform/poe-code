// Order statistics adapted from IronCalc statistical/{percentile,quartile,
// mode_functions,frequency,trimmean,rank_eq_avg,count_and_average}.rs at
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT; LICENSE.IronCalc).
// Sparse range collection and bounded scalar-parameter broadcasting use the
// existing evaluator. Sorting never copies the dataset for each output cell.
use super::{Calculation, Coord, Expr, Value, lookup};
use std::collections::{BTreeSet, HashMap};

fn numeric(value: &Value, date1904: bool) -> Result<f64, &'static str> {
    match value {
        Value::Number(n) => Ok(*n),
        Value::Bool(b) => Ok(f64::from(*b)),
        Value::Blank | Value::Empty => Ok(0.),
        Value::Text(t) | Value::UninternedText(t) => {
            lookup::number::parse(t, date1904).ok_or("#VALUE!")
        }
        Value::Error(e) | Value::LiteralError(e) => Err(e),
        _ => Err("#VALUE!"),
    }
}

fn sort_work(n: usize) -> Option<usize> {
    n.checked_mul(2 * (n.checked_ilog2().unwrap_or(0) as usize + 1))
}

fn interpolate(a: f64, b: f64, fraction: f64) -> f64 {
    // Opposite signs can overflow b-a; equal signs cannot. Preserve exact
    // endpoints and small/subnormal values instead of always halving them.
    if fraction == 0. || a == b {
        return a;
    }
    if fraction == 1. {
        return b;
    }
    if a.is_sign_negative() != b.is_sign_negative() {
        (1. - fraction) * a + fraction * b
    } else {
        a + fraction * (b - a)
    }
}

pub(super) fn percentile(sorted: &[f64], k: f64, exclusive: bool) -> Value {
    let n = sorted.len();
    if n == 0
        || !(0. ..=1.).contains(&k)
        || exclusive && (k < 1. / (n + 1) as f64 || k > n as f64 / (n + 1) as f64)
    {
        return Value::Error("#NUM!");
    }
    let rank = if exclusive {
        k * (n + 1) as f64 - 1.
    } else {
        k * (n - 1) as f64
    };
    // Roundoff at an exclusive endpoint must not become an out-of-range index.
    let rank = rank.clamp(0., (n - 1) as f64);
    let low = rank.floor() as usize;
    Value::number(interpolate(
        sorted[low],
        sorted[(low + 1).min(n - 1)],
        rank - low as f64,
    ))
}

fn statistic(name: &str, sorted: &[f64], p: [f64; 2], work: &mut usize) -> Option<Value> {
    let n = sorted.len();
    let exclusive = name.ends_with(".EXC");
    Some(match name {
        "PERCENTILE" | "PERCENTILE.INC" | "PERCENTILE.EXC" => percentile(sorted, p[0], exclusive),
        "QUARTILE" | "QUARTILE.INC" | "QUARTILE.EXC" => {
            let quart = p[0].floor();
            if exclusive && !(1. ..=3.).contains(&quart) {
                Value::Error("#NUM!")
            } else {
                percentile(sorted, quart / 4., exclusive)
            }
        }
        "MEDIAN" => percentile(sorted, 0.5, false),
        "LARGE" | "SMALL" => {
            let k = p[0].floor();
            if k < 1. || k > n as f64 {
                Value::Error("#NUM!")
            } else {
                Value::number(
                    sorted[if name == "LARGE" {
                        n - k as usize
                    } else {
                        k as usize - 1
                    }],
                )
            }
        }
        "RANK" | "RANK.EQ" | "RANK.AVG" => {
            *work = work.checked_sub(2 * (n.checked_ilog2().unwrap_or(0) as usize + 1))?;
            let first = sorted.partition_point(|&v| v < p[0]);
            let last = sorted.partition_point(|&v| v <= p[0]);
            if first == last {
                Value::Error("#N/A")
            } else {
                let better = if p[1] == 0. { n - last } else { first };
                Value::number(
                    better as f64
                        + if name == "RANK.AVG" {
                            (last - first + 1) as f64 / 2.
                        } else {
                            1.
                        },
                )
            }
        }
        "PERCENTRANK" | "PERCENTRANK.INC" | "PERCENTRANK.EXC" => {
            if n == 0 || !exclusive && n < 2 || p[0] < sorted[0] || p[0] > sorted[n - 1] {
                return Some(Value::Error("#N/A"));
            }
            let significance = p[1].floor();
            if significance < 1. {
                return Some(Value::Error("#NUM!"));
            }
            *work = work.checked_sub(n.checked_ilog2().unwrap_or(0) as usize + 1)?;
            let k = sorted.partition_point(|&v| v < p[0]);
            let position = if sorted[k] == p[0] {
                k as f64
            } else {
                let (a, b) = (sorted[k - 1], sorted[k]);
                let distance = b - a;
                let fraction = if distance.is_finite() {
                    (p[0] - a) / distance
                } else {
                    (p[0] / 2. - a / 2.) / (b / 2. - a / 2.)
                };
                k as f64 - 1. + fraction
            };
            let rank = if exclusive {
                (position + 1.) / (n + 1) as f64
            } else {
                position / (n - 1) as f64
            };
            // More digits than f64 carries need no decimal truncation; avoid
            // saturating casts and overflowing 10^significance from upstream.
            Value::number(if significance >= 16. {
                rank
            } else {
                let factor = 10_f64.powi(significance as i32);
                (rank * factor).floor() / factor
            })
        }
        "TRIMMEAN" => {
            if n == 0 || !(0. ..1.).contains(&p[0]) {
                return Some(Value::Error("#NUM!"));
            }
            let trim = (n as f64 * p[0] / 2.).floor() as usize;
            let values = &sorted[trim..n - trim];
            // First sum without scaling to retain subnormals. Only retry with
            // pre-divided terms when the intermediate sum overflows. Neumaier
            // compensation preserves small terms across large cancellation.
            let mut answer = 0.;
            for divisor in [1., 2. * values.len() as f64] {
                *work = work.checked_sub(values.len())?;
                let (mut sum, mut correction) = (0_f64, 0_f64);
                for &v in values {
                    let v = v / divisor;
                    let next = sum + v;
                    correction += if sum.abs() >= v.abs() {
                        (sum - next) + v
                    } else {
                        (v - next) + sum
                    };
                    sum = next;
                }
                answer = sum + correction;
                if divisor == 1. && answer.is_finite() {
                    answer /= values.len() as f64;
                    break;
                }
                if divisor != 1. {
                    // Leave headroom even when rounded pre-divided terms sum
                    // just past f64::MAX. A mean stays inside the data bounds.
                    answer = (answer * 2.).clamp(values[0], values[values.len() - 1]);
                }
            }
            Value::number(answer)
        }
        _ => return None,
    })
}

impl Calculation<'_> {
    fn order_values(
        &mut self,
        value: Value,
        name: &str,
        numbers: &mut Vec<f64>,
        depth: usize,
    ) -> Option<Result<(), &'static str>> {
        let mut pending = vec![(value, false)];
        while let Some((mut value, mut reference)) = pending.pop() {
            self.tick(depth)?;
            match value {
                Value::InvalidReference | Value::InvalidRange(..) => return Some(Err("#REF!")),
                Value::Single(c) => {
                    value = self.cell(c, depth + 1)?;
                    reference = true;
                }
                Value::Range(a, b) => {
                    self.read_spill_range(a, b)?;
                    let start = (a.0.min(b.0), a.1.min(b.1), a.2.min(b.2));
                    let end = (a.0.max(b.0), a.1.max(b.1), a.2.max(b.2));
                    let mut cells = BTreeSet::new();
                    for &c in self
                        .values
                        .range(start..=end)
                        .map(|(c, _)| c)
                        .chain(self.expressions.range(start..=end).map(|(c, _)| c))
                    {
                        self.work = self.work.checked_sub(1)?;
                        if (start.1..=end.1).contains(&c.1) && (start.2..=end.2).contains(&c.2) {
                            self.work = self.work.checked_sub(96)?;
                            cells.insert(c);
                        }
                    }
                    pending.extend(cells.into_iter().rev().map(|c| (Value::Single(c), true)));
                    continue;
                }
                Value::Matrix(rows) => {
                    self.work = self.work.checked_sub(
                        rows.iter()
                            .map(Vec::len)
                            .sum::<usize>()
                            .checked_mul(std::mem::size_of::<(Value, bool)>())?,
                    )?;
                    pending.extend(
                        rows.into_iter()
                            .rev()
                            .flat_map(|r| r.into_iter().rev())
                            .map(|v| (v, true)),
                    );
                    continue;
                }
                Value::Set(values) => {
                    self.work = self.work.checked_sub(
                        values
                            .len()
                            .checked_mul(std::mem::size_of::<(Value, bool)>())?,
                    )?;
                    pending.extend(values.into_iter().rev().map(|v| (v, reference)));
                    continue;
                }
                _ => {}
            }
            let n = match value {
                Value::Number(n) => n,
                Value::Error(e) | Value::LiteralError(e) => return Some(Err(e)),
                Value::Blank | Value::Empty => continue,
                _ if !reference => {
                    self.charge_value(&value)?;
                    // MODE ignores direct booleans/numeric text, but rejects
                    // unconvertible text and propagates errors (Univer cases).
                    let ignored = matches!(
                        name,
                        "MODE"
                            | "MODE.SNGL"
                            | "MODE.MULT"
                            | "FREQUENCY"
                            | "RANK"
                            | "RANK.EQ"
                            | "RANK.AVG"
                    );
                    match numeric(&value, self.book.date1904) {
                        Ok(_) if ignored => continue,
                        Ok(n) => n,
                        Err(e) => return Some(Err(e)),
                    }
                }
                _ => continue,
            };
            self.work = self.work.checked_sub(16)?;
            numbers.push(n);
        }
        Some(Ok(()))
    }

    pub(super) fn order_statistics(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let variadic = matches!(name, "MEDIAN" | "MODE" | "MODE.SNGL" | "MODE.MULT");
        let rank = matches!(name, "RANK" | "RANK.EQ" | "RANK.AVG");
        let percentrank = matches!(name, "PERCENTRANK" | "PERCENTRANK.INC" | "PERCENTRANK.EXC");
        let (minimum, maximum) = if variadic {
            (1, 255)
        } else if rank || percentrank {
            (2, 3)
        } else {
            (2, 2)
        };
        if !(minimum..=maximum).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let mut data = Vec::new();
        let mut bins = Vec::new();
        let mut parameters = Vec::new();
        let (mut height, mut width) = (1, 1);
        for (i, arg) in args.iter().enumerate() {
            let value = self.eval(arg, pos, depth + 1, true)?;
            if variadic || i == usize::from(rank) || name == "FREQUENCY" {
                let numbers = if name == "FREQUENCY" && i == 1 {
                    &mut bins
                } else {
                    &mut data
                };
                if let Err(e) = self.order_values(value, name, numbers, depth + 1)? {
                    return Some(Value::Error(e));
                }
            } else {
                let value =
                    if percentrank && i == 2 && matches!(value, Value::Empty | Value::Omitted) {
                        Value::Number(3.)
                    } else {
                        value
                    };
                let matrix = self.matrix(value, depth + 1)?;
                height = height.max(matrix.len());
                width = width.max(matrix.first().map_or(0, Vec::len));
                parameters.push(matrix);
            }
        }
        self.result_format = None;
        if name == "FREQUENCY" {
            self.work = self
                .work
                .checked_sub(sort_work(bins.len())?.checked_add(bins.len().checked_mul(16)?)?)?;
            let mut indexed: Vec<_> = bins.into_iter().enumerate().map(|(i, b)| (b, i)).collect();
            indexed.sort_unstable_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.cmp(&b.1)));
            self.work =
                self.work.checked_sub((indexed.len() + 1).checked_mul(
                    std::mem::size_of::<Value>() + std::mem::size_of::<Vec<Value>>(),
                )?)?;
            let mut output = vec![vec![Value::Number(0.)]; indexed.len() + 1];
            for v in data {
                self.work = self
                    .work
                    .checked_sub(indexed.len().checked_ilog2().unwrap_or(0) as usize + 1)?;
                let k = indexed.partition_point(|&(b, _)| b < v);
                let i = indexed.get(k).map_or(indexed.len(), |&(_, i)| i);
                if let Value::Number(n) = &mut output[i][0] {
                    *n += 1.;
                }
            }
            return Some(Value::Matrix(output));
        }
        if matches!(name, "MODE" | "MODE.SNGL" | "MODE.MULT") {
            self.work = self.work.checked_sub(data.len().checked_mul(64)?)?;
            let mut counts = HashMap::new();
            let key = |v: f64| if v == 0. { 0 } else { v.to_bits() };
            let mut maximum = 0;
            for &v in &data {
                let count = counts.entry(key(v)).or_insert(0);
                *count += 1;
                maximum = maximum.max(*count);
            }
            if maximum < 2 {
                return Some(Value::Error("#N/A"));
            }
            let mut output = Vec::new();
            for v in data {
                self.tick(depth)?;
                if counts.remove(&key(v)) == Some(maximum) {
                    if name != "MODE.MULT" {
                        return Some(Value::number(v));
                    }
                    self.work = self.work.checked_sub(
                        std::mem::size_of::<Value>() + std::mem::size_of::<Vec<Value>>(),
                    )?;
                    output.push(vec![Value::number(v)]);
                }
            }
            return Some(Value::Matrix(output));
        }
        self.work = self.work.checked_sub(sort_work(data.len())?)?;
        data.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap());
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
                let mut p = [0., if percentrank { 3. } else { 0. }];
                let mut error = None;
                for (i, matrix) in parameters.iter().enumerate() {
                    let value = matrix
                        .get(if matrix.len() == 1 { 0 } else { r })
                        .and_then(|row| row.get(if row.len() == 1 { 0 } else { c }))
                        .unwrap_or(&Value::Error("#N/A"));
                    self.charge_value(value)?;
                    match numeric(value, self.book.date1904) {
                        Ok(n) => p[i] = n,
                        Err(e) => {
                            error = Some(e);
                            break;
                        }
                    }
                }
                row.push(if let Some(e) = error {
                    Value::Error(e)
                } else {
                    statistic(name, &data, p, &mut self.work)?
                });
            }
            output.push(row);
        }
        Some(if height == 1 && width == 1 {
            output.pop()?.pop()?
        } else {
            Value::Matrix(output)
        })
    }
}

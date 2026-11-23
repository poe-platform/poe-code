// Contracts adapted from IronCalc f936620 math_and_trigonometry/seriessum.rs
// (MIT, LICENSE.IronCalc) and Univer 4767b3b math/seriessum (Apache-2.0,
// LICENSE.Univer). Scalar parameters and coefficient types follow Univer.
// Read range/transpose coefficients directly; blanks retain their term index.
use super::{Calculation, Coord, Expr, Value, lookup, matrix_functions::shape};

fn number(value: &Value, date1904: bool, work: &mut usize) -> Option<Result<f64, &'static str>> {
    Some(match value {
        Value::Error(e) | Value::LiteralError(e) => Err(e),
        Value::Number(n) => Ok(*n),
        Value::Blank | Value::Empty | Value::Omitted => Ok(0.),
        Value::Text(text) | Value::UninternedText(text) => {
            *work = work.checked_sub(text.len().checked_mul(2)?)?;
            if text.trim().eq_ignore_ascii_case("true") || text.trim().eq_ignore_ascii_case("false")
            {
                Err("#VALUE!")
            } else {
                lookup::number::parse(text, date1904).ok_or("#VALUE!")
            }
        }
        _ => Err("#VALUE!"),
    })
}

impl Calculation<'_> {
    pub(super) fn series_sum(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if args.len() != 4 {
            return Some(Value::Error("#ERROR!"));
        }
        if args
            .iter()
            .any(|arg| matches!(arg, Expr::Value(Value::Blank)))
        {
            return Some(Value::Error("#N/A"));
        }
        let mut parameters = [0.; 3];
        for (arg, parameter) in args.iter().zip(&mut parameters) {
            let mut value = self.eval(arg, pos, depth + 1, true)?;
            if !self.array && !matches!(value, Value::Matrix(_)) {
                value = self.implicit_invalid_range(arg, value, pos)?;
                value = self.scalar(value, pos, depth + 1)?;
            }
            match shape(&value, false) {
                Ok((1, 1)) => {}
                Ok(_) => return Some(Value::Error("#VALUE!")),
                Err(e) => return Some(Value::Error(e)),
            }
            let value = self.scalar(value, pos, depth + 1)?;
            *parameter = match number(&value, self.book.date1904, &mut self.work)? {
                Ok(n) => n,
                Err(e) => return Some(Value::Error(e)),
            };
        }
        let [x, n, m] = parameters;
        let (source, transposed) = self.matrix_source(&args[3], pos, depth + 1)?;
        let (height, width) = match shape(&source, transposed) {
            Ok(s) => s,
            Err(e) => return Some(Value::Error(e)),
        };
        if let Value::Range(a, b) = &source {
            self.read_spill_range(*a, *b)?;
        }
        let (mut sum, mut correction) = (0_f64, 0_f64);
        let mut invalid_power = false;
        for row in 0..height {
            for column in 0..width {
                self.tick(depth)?;
                self.work = self.work.checked_sub(4)?;
                let (r, c) = if transposed {
                    (column, row)
                } else {
                    (row, column)
                };
                let read;
                let value = match &source {
                    Value::Range(a, b) => {
                        let coord = (a.0, a.1.min(b.1) + r, a.2.min(b.2) + c);
                        // The complete range was registered above, including
                        // blanks later filled by spills. Avoid one allocation
                        // and dependency record per absent coefficient cell.
                        read = if self.formula_sources.contains_key(&coord)
                            || self.expressions.contains_key(&coord)
                            || self.results.contains_key(&coord)
                            || self
                                .values
                                .get(&coord)
                                .is_some_and(|v| !matches!(v, Value::Blank | Value::Empty))
                        {
                            self.cell(coord, depth + 1)?
                        } else {
                            Value::Blank
                        };
                        &read
                    }
                    Value::Matrix(rows) => &rows[r][c],
                    value => value,
                };
                let coefficient = match number(value, self.book.date1904, &mut self.work)? {
                    Ok(n) => n,
                    Err(e) => return Some(Value::Error(e)),
                };
                // Validate every coefficient before returning a numeric-domain
                // failure, so an input error remains visible (Univer's order).
                if invalid_power {
                    continue;
                }
                let exponent = n + (row * width + column) as f64 * m;
                // Rust defines 0^0 as one; spreadsheet powers report #NUM!.
                if x == 0. && exponent == 0. {
                    invalid_power = true;
                    continue;
                }
                let term = coefficient * x.powf(exponent);
                if !term.is_finite() {
                    invalid_power = true;
                    continue;
                }
                // Neumaier summation retains small terms between large opposing
                // coefficients without allocating the full series.
                let next = sum + term;
                correction += if sum.abs() >= term.abs() {
                    (sum - next) + term
                } else {
                    (term - next) + sum
                };
                sum = next;
            }
        }
        self.result_format = None;
        Some(if invalid_power {
            Value::Error("#NUM!")
        } else {
            Value::number(sum + correction)
        })
    }
}

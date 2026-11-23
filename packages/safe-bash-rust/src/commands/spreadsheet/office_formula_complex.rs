// Complex formulas adapt IronCalc engineering/complex.rs, f936620 (MIT,
// LICENSE.IronCalc). Parsing/coercion and suffix rules adapt Univer basics/complex
// and engineering functions, 4767b3b (Apache-2.0, LICENSE.Univer).
// Keep components in f64 throughout a calculation; only format the final value.
use super::{Calculation, Coord, Expr, Value, lookup::number, strings};
use std::collections::BTreeSet;

#[derive(Clone, Copy)]
struct Complex {
    x: f64,
    y: f64,
    suffix: Option<char>,
}

pub(super) fn arguments(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "COMPLEX" => (2, 3),
        "IMDIV" | "IMSUB" | "IMPOWER" => (2, 2),
        "IMABS" | "IMAGINARY" | "IMARGUMENT" | "IMCONJUGATE" | "IMCOS" | "IMCOSH" | "IMCOT"
        | "IMCSC" | "IMCSCH" | "IMEXP" | "IMLN" | "IMLOG10" | "IMLOG2" | "IMREAL" | "IMSEC"
        | "IMSECH" | "IMSIN" | "IMSINH" | "IMSQRT" | "IMTAN" => (1, 1),
        _ => return None,
    })
}

fn part(text: &str, date1904: bool) -> Option<f64> {
    let text = text.trim();
    // Rust accepts NaN/inf, while the general numeric coercion deliberately
    // clamps overflow and underflow. Complex components must be finite and
    // retain very small scientific values instead.
    if let Ok(n) = text.parse::<f64>() {
        return n.is_finite().then_some(n);
    }
    if text.eq_ignore_ascii_case("true") || text.eq_ignore_ascii_case("false") {
        return None;
    }
    number::parse(text, date1904).filter(|n| n.is_finite())
}

fn numeric(value: &Value, date1904: bool) -> Result<f64, &'static str> {
    let n = match value {
        Value::Error(e) | Value::LiteralError(e) => return Err(e),
        Value::Bool(_) => return Err("#VALUE!"),
        Value::Text(s) | Value::UninternedText(s) => part(s, date1904),
        _ => value.numeric(),
    }
    .ok_or("#VALUE!")?;
    if n.is_finite() { Ok(n) } else { Err("#NUM!") }
}

impl Complex {
    fn parse(value: &Value, date1904: bool) -> Result<Self, &'static str> {
        let text = match value {
            Value::Number(x) => {
                return if x.is_finite() {
                    Ok(Self {
                        x: *x,
                        y: 0.,
                        suffix: None,
                    })
                } else {
                    Err("#NUM!")
                };
            }
            Value::Blank | Value::Empty | Value::Omitted => {
                return Ok(Self {
                    x: 0.,
                    y: 0.,
                    suffix: None,
                });
            }
            Value::Text(s) | Value::UninternedText(s) => s.trim(),
            Value::Error(e) | Value::LiteralError(e) => return Err(e),
            _ => return Err("#VALUE!"),
        };
        if text.is_empty() {
            return Err("#NUM!");
        }
        let suffix = text.chars().last().filter(|c| matches!(c, 'i' | 'j'));
        let body = if suffix.is_some() {
            &text[..text.len() - 1]
        } else {
            text
        };
        let separator = body
            .as_bytes()
            .windows(2)
            .position(|pair| matches!(pair[1], b'+' | b'-') && !matches!(pair[0], b'e' | b'E'))
            .map(|i| i + 1);
        if suffix.is_none() {
            if separator.is_some() {
                return Err("#NUM!");
            }
            return Ok(Self {
                x: part(body, date1904).ok_or("#NUM!")?,
                y: 0.,
                suffix,
            });
        }
        let (x, imaginary, sign) = if let Some(index) = separator {
            (
                part(&body[..index], date1904).ok_or("#NUM!")?,
                &body[index + 1..],
                if body.as_bytes()[index] == b'-' {
                    -1.
                } else {
                    1.
                },
            )
        } else {
            (0., body, 1.)
        };
        let y = match imaginary.trim() {
            "" | "+" => 1.,
            "-" => -1.,
            text => part(text, date1904).ok_or("#NUM!")?,
        } * sign;
        Ok(Self { x, y, suffix })
    }

    fn suffix(self, other: Self) -> Result<Option<char>, &'static str> {
        if self.suffix.is_some() && other.suffix.is_some() && self.suffix != other.suffix {
            Err("#NUM!")
        } else {
            Ok(self.suffix.or(other.suffix))
        }
    }

    fn value(self, work: &mut usize) -> Option<Value> {
        if !self.x.is_finite() || !self.y.is_finite() {
            return Some(Value::Error("#NUM!"));
        }
        // Each formatted component is at most 24 bytes. Budget before allocating.
        *work = work.checked_sub(100)?;
        let mut text = if self.x != 0. || self.y == 0. {
            strings::number_to_text(self.x, 21)
        } else {
            String::new()
        };
        if self.y != 0. {
            if self.x != 0. && self.y > 0. {
                text.push('+');
            }
            let coefficient = strings::number_to_text(self.y, 21);
            match coefficient.as_str() {
                "1" => {}
                "-1" => text.push('-'),
                _ => text.push_str(&coefficient),
            }
            text.push(self.suffix.unwrap_or('i'));
        }
        Some(Value::Text(text))
    }

    fn div(self, other: Self) -> Self {
        // Keep components independent for an axis-aligned divisor. Normalizing
        // a numerator whose components differ by more than 324 decimal orders
        // would otherwise erase its smaller component even when dividing by 1.
        if other.y == 0. {
            return Self {
                x: self.x / other.x,
                y: self.y / other.x,
                ..self
            };
        }
        if other.x == 0. {
            return Self {
                x: self.y / other.y,
                y: -self.x / other.y,
                ..self
            };
        }
        // Normalize both operands so squaring large or subnormal components
        // cannot overflow or underflow the denominator.
        let n = self.x.abs().max(self.y.abs());
        let d = other.x.abs().max(other.y.abs());
        if n == 0. {
            return self;
        }
        let (a, b, c, d0) = (self.x / n, self.y / n, other.x / d, other.y / d);
        let denominator = c * c + d0 * d0;
        let scale = |v: f64| {
            if (n / d).is_finite() {
                v * (n / d)
            } else {
                (v * n) / d
            }
        };
        Self {
            x: scale((a * c + b * d0) / denominator),
            y: scale((b * c - a * d0) / denominator),
            ..self
        }
    }

    fn ln_abs(self) -> f64 {
        let largest = self.x.abs().max(self.y.abs());
        let smallest = self.x.abs().min(self.y.abs());
        if largest == 0. {
            f64::NEG_INFINITY
        } else {
            largest.ln() + (smallest / largest).powi(2).ln_1p() / 2.
        }
    }

    fn sqrt(self) -> Self {
        let scale = self.x.abs().max(self.y.abs());
        if scale == 0. {
            return self;
        }
        // Solve u²-v²=x and 2uv=y without resolving an angle near pi.
        // Scaling before hypot/addition also handles subnormal components and
        // roots whose input magnitude is larger than f64::MAX.
        let x = self.x / scale;
        let y = self.y / scale;
        let large = scale.sqrt() * ((x.hypot(y) + x.abs()) * 0.5).sqrt();
        if self.x >= 0. {
            Self {
                x: large,
                y: self.y / (2. * large),
                ..self
            }
        } else {
            Self {
                x: self.y.abs() / (2. * large),
                y: large.copysign(self.y),
                ..self
            }
        }
    }
}

// A polar magnitude can exceed f64::MAX while its projected components fit.
// Keep the ordinary exp product unchanged; combine logarithms only at overflow.
fn exp_times(exponent: f64, factor: f64) -> f64 {
    if factor == 0. {
        return factor;
    }
    let magnitude = exponent.exp();
    if magnitude.is_finite() {
        magnitude * factor
    } else {
        (exponent + factor.abs().ln()).exp().copysign(factor)
    }
}

pub(super) fn calculate(
    name: &str,
    args: &[&Value],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    macro_rules! get {
        ($expression:expr) => {
            match $expression {
                Ok(v) => v,
                Err(e) => return Some(Value::Error(e)),
            }
        };
    }
    if name == "COMPLEX" {
        let x = get!(numeric(args[0], date1904));
        let y = get!(numeric(args[1], date1904));
        let suffix = if let Some(value) = args.get(2) {
            match value {
                Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
                Value::Blank | Value::Empty | Value::Omitted => 'i',
                Value::Text(s) | Value::UninternedText(s) => match s.as_str() {
                    "" | "i" => 'i',
                    "j" => 'j',
                    _ => return Some(Value::Error("#VALUE!")),
                },
                _ => return Some(Value::Error("#VALUE!")),
            }
        } else {
            'i'
        };
        return Complex {
            x,
            y,
            suffix: Some(suffix),
        }
        .value(work);
    }
    let mut z = get!(Complex::parse(args[0], date1904));
    let (x, y) = (z.x, z.y);
    let (real, imaginary) = match name {
        "IMABS" => return Some(Value::number(x.hypot(y))),
        "IMREAL" => return Some(Value::Number(x)),
        "IMAGINARY" => return Some(Value::Number(y)),
        "IMARGUMENT" => {
            return Some(if x == 0. && y == 0. {
                Value::Error("#DIV/0!")
            } else {
                Value::Number(y.atan2(x))
            });
        }
        "IMCONJUGATE" => (x, -y),
        "IMSUB" | "IMDIV" => {
            let other = get!(Complex::parse(args[1], date1904));
            z.suffix = get!(z.suffix(other));
            if name == "IMSUB" {
                (x - other.x, y - other.y)
            } else {
                let result = z.div(other);
                (result.x, result.y)
            }
        }
        "IMSIN" | "IMCOS" => {
            let cosh = y.cosh();
            let sinh = y.sinh();
            if cosh.is_infinite() {
                let exponent = y.abs() - std::f64::consts::LN_2;
                if name == "IMSIN" {
                    (
                        exp_times(exponent, x.sin()),
                        exp_times(exponent, x.cos() * y.signum()),
                    )
                } else {
                    (
                        exp_times(exponent, x.cos()),
                        exp_times(exponent, -x.sin() * y.signum()),
                    )
                }
            } else if name == "IMSIN" {
                (x.sin() * cosh, x.cos() * sinh)
            } else {
                (x.cos() * cosh, -x.sin() * sinh)
            }
        }
        "IMSINH" | "IMCOSH" => {
            let cosh = x.cosh();
            let sinh = x.sinh();
            if cosh.is_infinite() {
                let exponent = x.abs() - std::f64::consts::LN_2;
                if name == "IMSINH" {
                    (
                        exp_times(exponent, y.cos() * x.signum()),
                        exp_times(exponent, y.sin()),
                    )
                } else {
                    (
                        exp_times(exponent, y.cos()),
                        exp_times(exponent, y.sin() * x.signum()),
                    )
                }
            } else if name == "IMSINH" {
                (sinh * y.cos(), cosh * y.sin())
            } else {
                (cosh * y.cos(), sinh * y.sin())
            }
        }
        "IMEXP" => (exp_times(x, y.cos()), exp_times(x, y.sin())),
        "IMLN" | "IMLOG10" | "IMLOG2" => {
            let scale = match name {
                "IMLOG10" => std::f64::consts::LOG10_E,
                "IMLOG2" => std::f64::consts::LOG2_E,
                _ => 1.,
            };
            (z.ln_abs() * scale, y.atan2(x) * scale)
        }
        "IMPOWER" | "IMSQRT" => {
            let power = if name == "IMSQRT" {
                0.5
            } else {
                get!(numeric(args[1], date1904))
            };
            if power == 1. {
                return z.value(work);
            }
            // Excel preserves the polar residual on the negative real axis.
            // Off that axis, avoid losing a nonzero component near the branch cut.
            if power == 0.5 && !(x < 0. && y == 0.) {
                return z.sqrt().value(work);
            }
            let radius = x.hypot(y);
            let magnitude = if radius.is_finite() {
                radius.powf(power)
            } else {
                (z.ln_abs() * power).exp()
            };
            let angle = y.atan2(x) * power;
            if magnitude.is_infinite() {
                let exponent = z.ln_abs() * power;
                (
                    exp_times(exponent, angle.cos()),
                    exp_times(exponent, angle.sin()),
                )
            } else {
                (magnitude * angle.cos(), magnitude * angle.sin())
            }
        }
        "IMTAN" | "IMCOT" => {
            if y == 0. {
                (
                    if name == "IMTAN" {
                        x.tan()
                    } else {
                        1. / x.tan()
                    },
                    0.,
                )
            } else if x == 0. {
                (
                    0.,
                    if name == "IMTAN" {
                        y.tanh()
                    } else {
                        -1. / y.tanh()
                    },
                )
            } else {
                // Divide through by exp(2|y|): retains tiny real components
                // when tanh(y) rounds to one and never computes cosh(2y).
                let e = (-2. * y.abs()).exp();
                let t = -(-2. * y.abs()).exp_m1();
                let trigonometric = if name == "IMTAN" { x.cos() } else { x.sin() };
                let denominator = t * t + 4. * e * trigonometric * trigonometric;
                if denominator < f64::MIN_POSITIVE {
                    // Squaring tiny sine/sinh components loses the denominator.
                    // Divide the unsquared complex cosine and sine instead.
                    let sine = Complex {
                        x: x.sin() * y.cosh(),
                        y: x.cos() * y.sinh(),
                        ..z
                    };
                    let cosine = Complex {
                        x: x.cos() * y.cosh(),
                        y: -x.sin() * y.sinh(),
                        ..z
                    };
                    let result = if name == "IMCOT" {
                        cosine.div(sine)
                    } else {
                        sine.div(cosine)
                    };
                    (result.x, result.y)
                } else {
                    (
                        4. * e * x.sin() * x.cos() / denominator,
                        y.signum()
                            * if name == "IMTAN" { 1. } else { -1. }
                            * -(-4. * y.abs()).exp_m1()
                            / denominator,
                    )
                }
            }
        }
        "IMSEC" | "IMCSC" | "IMSECH" | "IMCSCH" => {
            // Scale the trigonometric denominator by exp(-|hyperbolic part|).
            // Reciprocals tend to zero at large magnitudes; cosh/sinh themselves
            // overflow there even though these final results are finite.
            let hyperbolic = if matches!(name, "IMSEC" | "IMCSC") {
                y
            } else {
                x
            };
            let angle = if matches!(name, "IMSEC" | "IMCSC") {
                x
            } else {
                y
            };
            let e = (-hyperbolic.abs()).exp();
            let cosh = 1. + e * e;
            let sinh = hyperbolic.signum() * -(-2. * hyperbolic.abs()).exp_m1();
            let (a, b) = match name {
                "IMSEC" => (angle.cos() * cosh, -angle.sin() * sinh),
                "IMCSC" => (angle.sin() * cosh, angle.cos() * sinh),
                "IMSECH" => (angle.cos() * cosh, angle.sin() * sinh),
                _ => (angle.cos() * sinh, angle.sin() * cosh),
            };
            let result = Complex {
                x: 2. * e,
                y: 0.,
                ..z
            }
            .div(Complex { x: a, y: b, ..z });
            (result.x, result.y)
        }
        _ => return None,
    };
    Complex {
        x: real,
        y: imaginary,
        ..z
    }
    .value(work)
}

impl Calculation<'_> {
    pub(super) fn complex_aggregate(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if !(1..=255).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let product = name == "IMPRODUCT";
        let mut result = Complex {
            x: if product { 1. } else { 0. },
            y: 0.,
            suffix: None,
        };
        let mut count = 0;
        for arg in args {
            self.work = self.work.checked_sub(std::mem::size_of::<Value>())?;
            let mut pending = vec![self.eval(arg, pos, depth + 1, true)?];
            while let Some(mut value) = pending.pop() {
                self.tick(depth)?;
                match value {
                    Value::Single(coord) => {
                        value = self.cell(coord, depth + 1)?;
                    }
                    Value::Range(a, b) => {
                        if a.0 != b.0 {
                            return Some(Value::Error("#VALUE!"));
                        }
                        self.read_spill_range(a, b)?;
                        let start = (a.0, a.1.min(b.1), a.2.min(b.2));
                        let end = (a.0, a.1.max(b.1), a.2.max(b.2));
                        let mut cells = BTreeSet::new();
                        for &coord in self
                            .values
                            .range(start..=end)
                            .map(|(c, _)| c)
                            .chain(self.expressions.range(start..=end).map(|(c, _)| c))
                        {
                            self.work = self.work.checked_sub(1)?;
                            if (start.1..=end.1).contains(&coord.1)
                                && (start.2..=end.2).contains(&coord.2)
                            {
                                self.work = self.work.checked_sub(192)?;
                                cells.insert(coord);
                            }
                        }
                        let size = (end.1 - start.1 + 1) as u64 * (end.2 - start.2 + 1) as u64;
                        // Empty referenced cells are zero, including missing cells
                        // in a sparse range. Still visit stored cells for errors.
                        if product && size > cells.len() as u64 {
                            result.x = 0.;
                            result.y = 0.;
                        }
                        pending.extend(cells.into_iter().rev().map(Value::Single));
                        continue;
                    }
                    Value::Matrix(rows) => {
                        for row in rows.into_iter().rev() {
                            self.work = self.work.checked_sub(
                                row.len().checked_mul(std::mem::size_of::<Value>())?,
                            )?;
                            pending.extend(row.into_iter().rev());
                        }
                        continue;
                    }
                    Value::Set(values) => {
                        self.work = self
                            .work
                            .checked_sub(values.len().checked_mul(std::mem::size_of::<Value>())?)?;
                        pending.extend(values.into_iter().rev());
                        continue;
                    }
                    Value::InvalidReference | Value::InvalidRange(..) => {
                        return Some(Value::Error("#REF!"));
                    }
                    _ => {}
                }
                self.charge_value(&value)?;
                let z = match Complex::parse(&value, self.book.date1904) {
                    Ok(z) => z,
                    Err(e) => return Some(Value::Error(e)),
                };
                result.suffix = match result.suffix(z) {
                    Ok(s) => s,
                    Err(_) => return Some(Value::Error("#VALUE!")),
                };
                let (mut x, mut y) = if product {
                    (
                        result.x * z.x - result.y * z.y,
                        result.x * z.y + result.y * z.x,
                    )
                } else {
                    (result.x + z.x, result.y + z.y)
                };
                if product {
                    let both_terms = result.x != 0. && result.y != 0. && z.x != 0. && z.y != 0.;
                    let rescale_x = !x.is_finite()
                        || (both_terms
                            && (result.x * z.x).abs().max((result.y * z.y).abs())
                                < f64::MIN_POSITIVE);
                    let rescale_y = !y.is_finite()
                        || (both_terms
                            && (result.x * z.y).abs().max((result.y * z.x).abs())
                                < f64::MIN_POSITIVE);
                    if rescale_x || rescale_y {
                        // Combine normalized terms before rounding tiny products
                        // to zero or overflowing. Restore each component's scale
                        // separately, leaving ordinary components unchanged.
                        let n = result.x.abs().max(result.y.abs());
                        let m = z.x.abs().max(z.y.abs());
                        let (a, b, c, d) = (result.x / n, result.y / n, z.x / m, z.y / m);
                        if rescale_x {
                            x = ((a * c - b * d) * n) * m;
                        }
                        if rescale_y {
                            y = ((a * d + b * c) * n) * m;
                        }
                    }
                }
                result.x = x;
                result.y = y;
                count += 1;
                if !x.is_finite() || !y.is_finite() {
                    return Some(Value::Error("#NUM!"));
                }
            }
        }
        if count == 0 {
            result.x = 0.;
        }
        result.value(&mut self.work)
    }
}

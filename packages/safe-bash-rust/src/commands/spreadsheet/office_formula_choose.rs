// CHOOSE scalar/reference selection adapts IronCalc lookup_and_reference/mod.rs
// (f936620, MIT, LICENSE.IronCalc). Array expansion adapts Univer lookup/choose
// (4767b3b, Apache-2.0, LICENSE.Univer), reading ranges without expanded copies.
use super::{Calculation, Coord, Expr, Value, lookup};

impl Calculation<'_> {
    pub(super) fn choose(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if !(2..=255).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let index = |value: &Value| -> Result<usize, &'static str> {
            if let Value::Error(error) | Value::LiteralError(error) = value {
                return Err(error);
            }
            let n = value.numeric().ok_or("#VALUE!")?.trunc();
            if !(1. ..args.len() as f64).contains(&n) {
                return Err("#VALUE!");
            }
            Ok(n as usize - 1)
        };
        let selector = self.eval(&args[0], pos, depth + 1, true)?;
        let array = matches!(selector, Value::Matrix(_))
            || self.array && matches!(selector, Value::Range(a,b) if a != b);
        if !array {
            // Legacy references intersect at the consuming cell. A scalar
            // selector evaluates only its chosen arm and preserves references.
            let selector = self.scalar(selector, pos, depth + 1)?;
            return match index(&selector) {
                Ok(i) => Some(match self.eval(&args[i + 1], pos, depth + 1, true)? {
                    Value::Blank | Value::Empty => Value::Number(0.),
                    value => value,
                }),
                Err(e) => Some(Value::Error(e)),
            };
        }
        let selector = selector.into_range();
        if matches!(selector, Value::Range(a,b) if a.0 != b.0) {
            return Some(Value::Error("#VALUE!"));
        }
        let (ih, iw) = lookup::dimensions(&selector);
        let (mut height, mut width) = (ih, iw);
        self.work = self
            .work
            .checked_sub((args.len() - 1).checked_mul(std::mem::size_of::<Value>())?)?;
        let mut choices = Vec::with_capacity(args.len() - 1);
        for arg in &args[1..] {
            // Evaluate each arm once. References remain borrowed reads during
            // output construction; arrays retain just their original shape.
            let value = self.eval(arg, pos, depth + 1, true)?.into_range();
            let value = if matches!(value, Value::Range(a,b) if a.0 != b.0) {
                Value::Error("#VALUE!")
            } else {
                value
            };
            let (h, w) = lookup::dimensions(&value);
            height = height.max(h);
            width = width.max(w);
            choices.push(value);
        }
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?
                .checked_add(height.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
        )?;
        let mut result = Vec::with_capacity(height);
        for r in 0..height {
            let mut row = Vec::with_capacity(width);
            for c in 0..width {
                self.tick(depth)?;
                let (ir, ic) = (if ih == 1 { 0 } else { r }, if iw == 1 { 0 } else { c });
                let selector = if ir >= ih || ic >= iw {
                    Value::Error("#N/A")
                } else {
                    self.lookup_entry(&selector, ir, ic, pos, depth + 1)?
                };
                let value = match index(&selector) {
                    Err(e) => Value::Error(e),
                    Ok(i) => {
                        let value = &choices[i];
                        let (h, w) = lookup::dimensions(value);
                        let (vr, vc) = (if h == 1 { 0 } else { r }, if w == 1 { 0 } else { c });
                        if vr >= h || vc >= w {
                            Value::Error("#N/A")
                        } else {
                            self.lookup_entry(value, vr, vc, pos, depth + 1)?
                        }
                    }
                };
                row.push(match value {
                    Value::Blank | Value::Empty => Value::Number(0.),
                    Value::LiteralError(e) => Value::Error(e),
                    other => other,
                });
            }
            result.push(row);
        }
        self.result_format = None;
        Some(Value::Matrix(result))
    }
}

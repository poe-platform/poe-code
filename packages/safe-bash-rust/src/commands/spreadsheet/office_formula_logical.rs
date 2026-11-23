// Copyright 2023-present DreamNum Co., Ltd. (array broadcasting).
// Copyright 2023 EqualTo GmbH; 2023-present IronCalc contributors; 2026-present IronCalc GmbH.
// Scalar selection follows IronCalc logical/{mod,switch}.rs (f936620, MIT).
// Array broadcasting follows Univer logical/{ifs,switch} (4767b3b, Apache-2.0).
// See LICENSE.IronCalc and LICENSE.Univer. Excel caches take precedence where
// unused error arguments differ from Univer's eager error propagation.
use super::{Calculation, Coord, Expr, Value, lookup};

impl Calculation<'_> {
    pub(super) fn logical_cases(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let switch = name == "SWITCH";
        if if switch {
            !(3..=255).contains(&args.len())
        } else {
            !(2..=254).contains(&args.len()) || args.len() % 2 != 0
        } {
            return Some(Value::Error("#ERROR!"));
        }
        self.work = self
            .work
            .checked_sub(args.len().checked_mul(std::mem::size_of::<Value>())?)?;
        let mut values = Vec::with_capacity(args.len());
        let (mut height, mut width, mut array) = (1, 1, false);
        for arg in args {
            // Retain original array shapes and read ranges on demand. Expanding
            // every arm would multiply memory use by up to 127 result choices.
            let mut value = self.eval(arg, pos, depth + 1, true)?;
            if self.dynamic.is_none() && !self.array && !matches!(value, Value::Matrix(_)) {
                value = self.scalar(value, pos, depth + 1)?;
            }
            array |= matches!(value, Value::Matrix(_) | Value::Range(..));
            value = value.into_range();
            if matches!(value, Value::Range(a,b) if a.0 != b.0) {
                value = Value::Error("#VALUE!");
            }
            let (h, w) = lookup::dimensions(&value);
            height = height.max(h);
            width = width.max(w);
            values.push(value);
        }
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?
                .checked_add(height.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
        )?;
        let start = usize::from(switch);
        let end = if switch && args.len() % 2 == 0 {
            args.len() - 1
        } else {
            args.len()
        };
        let mut result = Vec::with_capacity(height);
        for r in 0..height {
            let mut row = Vec::with_capacity(width);
            for c in 0..width {
                self.tick(depth)?;
                let item = |calc: &mut Self, index: usize| {
                    let value = &values[index];
                    let (h, w) = lookup::dimensions(value);
                    let (vr, vc) = (if h == 1 { 0 } else { r }, if w == 1 { 0 } else { c });
                    if vr >= h || vc >= w {
                        Some(Value::Error("#N/A"))
                    } else {
                        calc.lookup_entry(value, vr, vc, pos, depth + 1)
                    }
                };
                let expression = if switch { item(self, 0)? } else { Value::Blank };
                let mut selected = None;
                let mut value = Value::Error("#N/A");
                if let Value::Error(e) | Value::LiteralError(e) = expression {
                    value = Value::Error(e);
                } else {
                    for i in (start..end).step_by(2) {
                        let condition = item(self, i)?;
                        if let Value::Error(e) | Value::LiteralError(e) = condition {
                            value = Value::Error(e);
                            break;
                        }
                        let matches = if switch {
                            // Excel compares types: TRUE is not 1 and "1" is
                            // not 1. Blank references retain normal zero rules.
                            if matches!(
                                (&expression, &condition),
                                (Value::Bool(_), Value::Number(_))
                                    | (Value::Number(_), Value::Bool(_))
                            ) {
                                false
                            } else {
                                self.charge_value(&expression)?;
                                matches!(
                                    self.binary("=", expression.clone(), condition)?,
                                    Value::Bool(true)
                                )
                            }
                        } else {
                            match lookup::boolean(&condition) {
                                Some(value) => value,
                                None => {
                                    value = Value::Error("#VALUE!");
                                    break;
                                }
                            }
                        };
                        if matches {
                            selected = Some(i + 1);
                            break;
                        }
                        if i + 2 == end && end < args.len() {
                            selected = Some(end);
                        }
                    }
                    if let Some(index) = selected {
                        value = item(self, index)?;
                    }
                }
                row.push(match value {
                    Value::Blank | Value::Empty => Value::Number(0.),
                    Value::LiteralError(e) => Value::Error(e),
                    value => value,
                });
            }
            result.push(row);
        }
        self.result_format = None;
        Some(if array {
            Value::Matrix(result)
        } else {
            result.pop()?.pop()?
        })
    }
}

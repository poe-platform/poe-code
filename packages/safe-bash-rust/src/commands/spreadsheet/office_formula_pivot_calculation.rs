//! Relative pivot aggregates. LibreOffice abf91474804c dptabres.cxx
//! (MPL-2.0, LICENSE.LibreOffice) supplies item/total/running-total contracts.
//! Cache original aggregates separately: visiting a comparison item must never
//! observe a value already converted into a percentage or running total.
use super::{Calculation, Coord, Expr, Groups, Key, Value};
use crate::commands::spreadsheet::pivot::{PivotItem, PivotTable, selected_key};
use std::{collections::BTreeMap, ops::Bound};

type Cell = (Option<usize>, Option<usize>);
type CacheKey = (Cell, usize, String);

pub(super) struct Values<'a> {
    pub groups: &'a BTreeMap<Cell, Vec<usize>>,
    pub axes: [&'a Groups; 2],
    pub keys: [Vec<&'a [Key]>; 2],
    pub source: (usize, usize),
    pub pos: Coord,
    pub depth: usize,
    pub empty: Value,
    pub pivot: &'a PivotTable,
    pub original: BTreeMap<CacheKey, Value>,
    pub relative: BTreeMap<CacheKey, Value>,
}

fn numeric(value: Value) -> Result<f64, Value> {
    match value {
        Value::Number(n) => Ok(n),
        Value::Blank | Value::Empty | Value::Text(_) => Ok(0.),
        error => Err(error),
    }
}
fn number(value: f64) -> Value {
    if value.is_finite() {
        Value::Number(value)
    } else {
        Value::Error("#NUM!")
    }
}
fn divide(value: Value, denominator: Value) -> Value {
    match (numeric(value), numeric(denominator)) {
        (Err(error), _) | (_, Err(error)) => error,
        (_, Ok(0.)) => Value::Error("#DIV/0!"),
        (Ok(a), Ok(b)) => number(a / b),
    }
}
fn blank(value: &Value) -> bool {
    matches!(value, Value::Blank | Value::Empty) || matches!(value, Value::Text(s) if s.is_empty())
}

impl Values<'_> {
    fn aggregate(
        &mut self,
        calc: &mut Calculation<'_>,
        cell: Cell,
        measure: usize,
        name: &str,
    ) -> Option<Value> {
        calc.work = calc.work.checked_sub(96 + name.len())?;
        let key = (cell, measure, name.to_owned());
        if let Some(value) = self.original.get(&key) {
            calc.charge_value(value)?;
            return Some(value.clone());
        }
        let rows = self.groups.get(&cell).map_or(&[][..], Vec::as_slice);
        calc.work = calc.work.checked_sub(rows.len().checked_mul(64)?)?;
        let mut values = Vec::with_capacity(rows.len());
        for &row in rows {
            values.push(calc.cell(
                (
                    self.source.0,
                    row,
                    self.source.1 + self.pivot.values[measure].field,
                ),
                self.depth + 1,
            )?);
        }
        let result = match name {
            "COUNT" => Value::Number(
                values
                    .iter()
                    .filter(|v| matches!(v, Value::Number(_)))
                    .count() as f64,
            ),
            "COUNTA" => Value::Number(
                values
                    .iter()
                    .filter(|v| !matches!(v, Value::Blank | Value::Empty))
                    .count() as f64,
            ),
            _ if values.is_empty() => self.empty.clone(),
            _ => calc.aggregate_excel(
                name,
                &[Expr::Value(Value::Matrix(vec![values]))],
                self.pos,
                self.depth + 1,
            )?,
        };
        calc.charge_value(&result)?;
        self.original.insert(key, result.clone());
        Some(result)
    }

    pub fn get(
        &mut self,
        calc: &mut Calculation<'_>,
        cell: Cell,
        measure: usize,
        name: &str,
    ) -> Option<Value> {
        let value = self.aggregate(calc, cell, measure, name)?;
        let Some(show) = &self.pivot.values[measure].calculation else {
            return Some(value);
        };
        calc.work = calc.work.checked_sub(128 + name.len())?;
        let cache_key = (cell, measure, name.to_owned());
        if let Some(value) = self.relative.get(&cache_key) {
            calc.charge_value(value)?;
            return Some(value.clone());
        }
        let kind = show.kind.as_str();
        if matches!(kind, "totalPercent" | "rowPercent" | "colPercent" | "index") {
            if blank(&value) {
                return Some(value);
            }
            let denominator = match kind {
                "rowPercent" => (cell.0, None),
                "colPercent" => (None, cell.1),
                _ => (None, None),
            };
            let total = self.aggregate(calc, denominator, measure, name)?;
            if kind == "index" {
                let row = self.aggregate(calc, (cell.0, None), measure, name)?;
                let column = self.aggregate(calc, (None, cell.1), measure, name)?;
                return Some(
                    match (
                        numeric(value),
                        numeric(total),
                        numeric(row),
                        numeric(column),
                    ) {
                        (Err(e), _, _, _)
                        | (_, Err(e), _, _)
                        | (_, _, Err(e), _)
                        | (_, _, _, Err(e)) => e,
                        (_, _, Ok(0.), _) | (_, _, _, Ok(0.)) => Value::Error("#DIV/0!"),
                        (Ok(v), Ok(t), Ok(r), Ok(c)) => {
                            let numerator = v * t;
                            let denominator = r * c;
                            let result = if numerator.is_finite()
                                && denominator.is_finite()
                                && denominator != 0.
                                && (numerator != 0. || v == 0. || t == 0.)
                            {
                                numerator / denominator
                            } else {
                                let result = (v / r) * (t / c);
                                if result.is_finite() && result != 0. {
                                    result
                                } else {
                                    (v / c) * (t / r)
                                }
                            };
                            number(result)
                        }
                    },
                );
            }
            return Some(divide(value, total));
        }
        let fields = [&self.pivot.rows, &self.pivot.columns];
        let (axis, base) = match kind {
            "percentOfParentRow" => (0, None),
            "percentOfParentCol" => (1, None),
            _ => {
                let Some(field) = show.base_field else {
                    return Some(Value::Error("#REF!"));
                };
                let Some((axis, index)) = fields
                    .iter()
                    .enumerate()
                    .find_map(|(a, f)| f.iter().position(|&f| f == field).map(|i| (a, i)))
                else {
                    return Some(Value::Error("#REF!"));
                };
                (axis, Some(index))
            }
        };
        let id = if axis == 0 { cell.0 } else { cell.1 };
        let current = id.map_or(&[][..], |id| self.keys[axis][id]);
        let at = |id| {
            if axis == 0 {
                (id, cell.1)
            } else {
                (cell.0, id)
            }
        };
        if matches!(
            kind,
            "percentOfParentRow" | "percentOfParentCol" | "percentOfParent"
        ) {
            if blank(&value) {
                return Some(value);
            }
            let length = base
                .unwrap_or_else(|| current.len().saturating_sub(1))
                .min(current.len());
            let parent = if length == 0 {
                None
            } else {
                Some(self.axes[axis].get(&current[..length])?.1)
            };
            let denominator = self.aggregate(calc, at(parent), measure, name)?;
            return Some(divide(value, denominator));
        }
        let base = base?;
        if current.len() <= base {
            return Some(self.empty.clone());
        }
        // Same ancestors and descendants, ordered by the displayed base field.
        // Compute the whole sibling series once for running totals and ranking.
        let mut siblings = Vec::new();
        for (key, (_, id)) in
            self.axes[axis].range::<[Key], _>((Bound::Included(&current[..base]), Bound::Unbounded))
        {
            if !key.starts_with(&current[..base]) {
                break;
            }
            calc.work = calc.work.checked_sub(64 + key.len().checked_mul(32)?)?;
            if key.len() == current.len()
                && key[..base] == current[..base]
                && key[base + 1..] == current[base + 1..]
            {
                siblings.push((key, *id));
            }
        }
        let mut values = Vec::with_capacity(siblings.len());
        for (_, id) in &siblings {
            values.push(self.aggregate(calc, at(Some(*id)), measure, name)?);
        }
        if matches!(kind, "difference" | "percent" | "percentDiff") {
            let named = if let Some(PivotItem::Value(value)) = &show.base_item {
                let key = selected_key(value, &mut calc.work)?;
                siblings.iter().position(|(k, _)| k[base] == key)
            } else {
                None
            };
            for (index, ((_, id), value)) in siblings.iter().zip(&values).enumerate() {
                calc.work = calc.work.checked_sub(160 + name.len())?;
                let other = match show.base_item.as_ref()? {
                    PivotItem::Value(_) => named,
                    PivotItem::Previous => index.checked_sub(1),
                    PivotItem::Next => index.checked_add(1).filter(|&i| i < values.len()),
                };
                let result = if let Some(other) = other {
                    if other == index && kind != "percent" {
                        self.empty.clone()
                    } else if kind == "percent" {
                        divide(value.clone(), values[other].clone())
                    } else {
                        match (numeric(value.clone()), numeric(values[other].clone())) {
                            (Err(e), _) | (_, Err(e)) => e,
                            (Ok(a), Ok(b)) => {
                                let difference = number(a - b);
                                if kind == "difference" {
                                    difference
                                } else {
                                    divide(difference, values[other].clone())
                                }
                            }
                        }
                    }
                } else if matches!(show.base_item, Some(PivotItem::Value(_))) {
                    Value::Error("#N/A")
                } else {
                    self.empty.clone()
                };
                calc.charge_value(&result)?;
                self.relative
                    .insert((at(Some(*id)), measure, name.into()), result);
            }
            return self.relative.get(&cache_key).cloned();
        }
        if matches!(kind, "rankAscending" | "rankDescending") {
            calc.work = calc.work.checked_sub(
                values
                    .len()
                    .checked_mul(128 + values.len().max(1).ilog2() as usize * 16)?,
            )?;
            let mut ordered: Vec<_> = values
                .iter()
                .filter_map(|v| {
                    if let Value::Number(n) = v {
                        Some(*n)
                    } else {
                        None
                    }
                })
                .collect();
            ordered.sort_by(f64::total_cmp);
            for ((_, id), value) in siblings.iter().zip(values) {
                let result = match value {
                    Value::Number(n) => Value::Number(
                        1. + if kind == "rankAscending" {
                            ordered.partition_point(|v| *v < n) as f64
                        } else {
                            (ordered.len() - ordered.partition_point(|v| *v <= n)) as f64
                        },
                    ),
                    value => value,
                };
                self.relative
                    .insert((at(Some(*id)), measure, name.into()), result);
            }
        } else {
            let mut total = Value::Number(0.);
            let mut running = Vec::with_capacity(values.len());
            for value in values {
                total = match (numeric(total), numeric(value)) {
                    (Err(e), _) | (_, Err(e)) => e,
                    (Ok(a), Ok(b)) => number(a + b),
                };
                calc.work = calc.work.checked_sub(128 + name.len())?;
                calc.charge_value(&total)?;
                running.push(total.clone());
            }
            for ((_, id), value) in siblings.iter().zip(running) {
                let result = if kind == "percentOfRunningTotal" {
                    divide(value, total.clone())
                } else {
                    value
                };
                self.relative
                    .insert((at(Some(*id)), measure, name.into()), result);
            }
        }
        self.relative.get(&cache_key).cloned()
    }
}

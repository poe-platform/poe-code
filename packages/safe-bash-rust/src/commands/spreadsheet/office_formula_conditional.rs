// Conditional aggregate semantics adapted from IronCalc's statistical/if_ifs.rs
// and functions/util.rs (f93662006b8fb1c401dc870bbda26c5d60ac6037).
// MIT license: LICENSE.IronCalc. Sparse offsets avoid materializing empty ranges.
use super::{Calculation, Coord, Expr, Value, lookup, summation::Sum};
use std::{cmp::Ordering, collections::BTreeSet};

struct Criterion {
    operator: &'static str,
    value: Value,
}

impl Criterion {
    fn new(value: Value, date1904: bool, work: &mut usize) -> Option<Self> {
        let mut operator = "=";
        let value = match value {
            Value::Text(text) | Value::UninternedText(text) => {
                *work = work.checked_sub(text.len().checked_mul(4)?.checked_add(64)?)?;
                let mut source = text.as_str();
                for op in ["<=", ">=", "<>", "<", ">", "="] {
                    if let Some(rest) = source.strip_prefix(op) {
                        operator = op;
                        source = rest;
                        break;
                    }
                }
                if source.eq_ignore_ascii_case("true") {
                    Value::Bool(true)
                } else if source.eq_ignore_ascii_case("false") {
                    Value::Bool(false)
                } else if let Some(error) = [
                    "#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A",
                ]
                .into_iter()
                .find(|e| source.eq_ignore_ascii_case(e))
                {
                    Value::Error(error)
                } else if let Some(n) = lookup::number::parse(source, date1904) {
                    Value::Number(n)
                } else {
                    Value::UninternedText(source.to_lowercase())
                }
            }
            Value::Blank | Value::Empty => Value::Number(0.),
            other => other,
        };
        Some(Self { operator, value })
    }

    fn matches(&self, value: &Value, work: &mut usize) -> Option<bool> {
        *work = work.checked_sub(1)?;
        let equality = matches!(self.operator, "=" | "<>");
        // COUNTIF's not-empty criterion counts a typed empty string, while an
        // empty-string equality criterion also matches genuinely blank cells.
        if self.operator == "<>"
            && matches!(&self.value, Value::UninternedText(text) if text.is_empty())
        {
            return Some(!matches!(value, Value::Blank | Value::Empty));
        }
        let order = match (&self.value, value) {
            (Value::Number(a), Value::Number(b)) => b.partial_cmp(a),
            (Value::Number(a), Value::Text(b) | Value::UninternedText(b)) if equality => {
                *work = work.checked_sub(b.len())?;
                b.trim()
                    .parse::<f64>()
                    .ok()
                    .filter(|n| n.is_finite())
                    .and_then(|b| b.partial_cmp(a))
            }
            (Value::Bool(a), Value::Bool(b)) => Some(b.cmp(a)),
            (
                Value::Error(a) | Value::LiteralError(a),
                Value::Error(b) | Value::LiteralError(b),
            ) => Some(b.cmp(a)),
            (Value::UninternedText(a), Value::Text(b) | Value::UninternedText(b)) => {
                if equality {
                    let matched = super::super::wildcard::matches(a, b, true, true, work)?;
                    return Some(if self.operator == "<>" {
                        !matched
                    } else {
                        matched
                    });
                }
                *work = work.checked_sub(b.len().checked_mul(4)?)?;
                if a.is_empty() {
                    return Some(false);
                }
                Some(b.to_lowercase().cmp(a))
            }
            (Value::UninternedText(a), Value::Blank | Value::Empty) if equality => {
                // A blank cell is not text for wildcard matching, even for '*'.
                return Some(if self.operator == "<>" {
                    !a.is_empty()
                } else {
                    a.is_empty()
                });
            }
            _ => None,
        };
        Some(match (self.operator, order) {
            ("<>", order) => order != Some(Ordering::Equal),
            ("=", order) => order == Some(Ordering::Equal),
            ("<", Some(order)) => order.is_lt(),
            (">", Some(order)) => order.is_gt(),
            ("<=", Some(order)) => !order.is_gt(),
            (">=", Some(order)) => !order.is_lt(),
            _ => false,
        })
    }
}

fn range(value: Value) -> Result<(Coord, Coord), Value> {
    match value {
        Value::Single(c) => Ok((c, c)),
        Value::Range(a, b) if a.0 == b.0 => Ok((
            (a.0, a.1.min(b.1), a.2.min(b.2)),
            (b.0, a.1.max(b.1), a.2.max(b.2)),
        )),
        Value::Error(e) | Value::LiteralError(e) => Err(Value::Error(e)),
        Value::InvalidReference | Value::InvalidRange(..) => Err(Value::Error("#REF!")),
        _ => Err(Value::Error("#VALUE!")),
    }
}

impl Calculation<'_> {
    pub(super) fn conditional_aggregate(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let count = matches!(name, "COUNTIF" | "COUNTIFS");
        let single = matches!(name, "SUMIF" | "AVERAGEIF" | "COUNTIF");
        if args.len() > 255
            || if single {
                args.len() < 2 || args.len() > if count { 2 } else { 3 }
            } else if count {
                args.len() < 2 || args.len() % 2 != 0
            } else {
                args.len() < 3 || args.len() % 2 != 1
            }
        {
            return Some(Value::Error("#VALUE!"));
        }
        let target_index = if single && args.len() == 3 { 2 } else { 0 };
        let target = self.eval(&args[target_index], pos, depth + 1, true)?;
        let mut target = match range(target) {
            Ok(range) => range,
            Err(error) => return Some(error),
        };
        let first = usize::from(!single && !count);
        let end = if single { 2 } else { args.len() };
        let mut ranges = Vec::new();
        let mut criteria = Vec::new();
        let (mut height, mut width) = (1usize, 1usize);
        for index in (first..end).step_by(2) {
            let value = self.eval(&args[index], pos, depth + 1, true)?;
            let source = match range(value) {
                Ok(range) => range,
                Err(error) => return Some(error),
            };
            if single {
                target.1.1 = target.0.1.checked_add(source.1.1 - source.0.1)?;
                target.1.2 = target.0.2.checked_add(source.1.2 - source.0.2)?;
                if target.1.1 >= 1_048_576 || target.1.2 >= 16_384 {
                    return Some(Value::Error("#REF!"));
                }
            } else if source.1.1 - source.0.1 != target.1.1 - target.0.1
                || source.1.2 - source.0.2 != target.1.2 - target.0.2
            {
                return Some(Value::Error("#VALUE!"));
            }
            let value = self.eval(&args[index + 1], pos, depth + 1, true)?;
            let matrix = self.matrix(value, depth + 1)?;
            let h = matrix.len();
            let w = matrix.first()?.len();
            if (height != h && height != 1 && h != 1) || (width != w && width != 1 && w != 1) {
                return Some(Value::Error("#VALUE!"));
            }
            height = height.max(h);
            width = width.max(w);
            let mut compiled = Vec::new();
            for row in matrix {
                let mut result = Vec::new();
                for value in row {
                    self.work = self.work.checked_sub(std::mem::size_of::<Criterion>())?;
                    result.push(Criterion::new(value, self.book.date1904, &mut self.work)?);
                }
                compiled.push(result);
            }
            ranges.push(source);
            criteria.push(compiled);
        }
        // Union the occupied offsets of every participating range. Empty offsets
        // can then be counted in one step, including whole-sheet COUNTIFS.
        let mut offsets = BTreeSet::new();
        for &(a, b) in ranges.iter().chain(std::iter::once(&target)) {
            self.read_spill_range(a, b)?;
            for &coord in self
                .values
                .range(a..=b)
                .map(|(c, _)| c)
                .chain(self.expressions.range(a..=b).map(|(c, _)| c))
            {
                self.work = self.work.checked_sub(1)?;
                if (a.2..=b.2).contains(&coord.2) {
                    self.work = self.work.checked_sub(64)?;
                    offsets.insert((coord.1 - a.1, coord.2 - a.2));
                }
            }
        }
        let area = (target.1.1 - target.0.1 + 1) as u64 * (target.1.2 - target.0.2 + 1) as u64;
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?,
        )?;
        let mut result = Vec::new();
        for row in 0..height {
            let mut values = Vec::new();
            for col in 0..width {
                let mut predicates = Vec::new();
                for matrix in &criteria {
                    self.work = self.work.checked_sub(std::mem::size_of::<&Criterion>())?;
                    let row = &matrix[if matrix.len() == 1 { 0 } else { row }];
                    predicates.push(&row[if row.len() == 1 { 0 } else { col }]);
                }
                values.push(self.conditional_result(
                    name,
                    target.0,
                    &ranges,
                    &predicates,
                    &offsets,
                    area,
                    depth + 1,
                )?);
            }
            result.push(values);
        }
        if height == 1 && width == 1 {
            Some(result.pop()?.pop()?)
        } else {
            Some(Value::Matrix(result))
        }
    }

    fn conditional_result(
        &mut self,
        name: &str,
        target: Coord,
        ranges: &[(Coord, Coord)],
        criteria: &[&Criterion],
        offsets: &BTreeSet<(usize, usize)>,
        area: u64,
        depth: usize,
    ) -> Option<Value> {
        let counts = matches!(name, "COUNTIF" | "COUNTIFS");
        let average = matches!(name, "AVERAGEIF" | "AVERAGEIFS");
        let mut count = 0u64;
        let mut sum = Sum::default();
        let mut minimum = f64::INFINITY;
        let mut maximum = f64::NEG_INFINITY;
        let mut blank_matches = true;
        for criterion in criteria {
            blank_matches &= criterion.matches(&Value::Blank, &mut self.work)?;
        }
        if blank_matches && area > offsets.len() as u64 {
            if counts {
                count = area - offsets.len() as u64;
            }
            minimum = 0.;
            maximum = 0.;
        }
        for &(row, col) in offsets {
            self.tick(depth)?;
            let mut matched = true;
            for (&(start, _), criterion) in ranges.iter().zip(criteria) {
                let value = self.cell((start.0, start.1 + row, start.2 + col), depth + 1)?;
                if !criterion.matches(&value, &mut self.work)? {
                    matched = false;
                    break;
                }
            }
            if !matched {
                continue;
            }
            if counts {
                count += 1;
                continue;
            }
            let value = self.cell((target.0, target.1 + row, target.2 + col), depth + 1)?;
            let n = match value {
                Value::Number(n) => n,
                Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
                Value::Blank | Value::Empty if !average => 0.,
                _ => continue,
            };
            count += 1;
            sum.add(n);
            minimum = minimum.min(n);
            maximum = maximum.max(n);
        }
        Some(if counts {
            Value::Number(count as f64)
        } else if average && count == 0 {
            Value::Error("#DIV/0!")
        } else if average {
            Value::number(sum.total() / count as f64)
        } else if name == "MINIFS" {
            Value::number(if minimum.is_infinite() { 0. } else { minimum })
        } else if name == "MAXIFS" {
            Value::number(if maximum.is_infinite() { 0. } else { maximum })
        } else {
            Value::number(sum.total())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::calculate;
    use std::collections::BTreeSet;

    #[test]
    fn conditional_criteria_broadcasting_and_repeated_sparse_scans_are_bounded() {
        let mut rows = vec![vec!["category".to_owned(), "7".into()]];
        rows.extend((0..32).map(|_| vec!["=COUNTIFS(A1:B1,\"*a*\")".into()]));
        assert!(calculate(&rows, &BTreeSet::from([(0, 1)]), "Sheet1", 4096).is_none());
        assert!(calculate(&rows, &BTreeSet::from([(0, 1)]), "Sheet1", 65536).is_some());
        for formula in [
            "=SUMIF(A1:A2,C1:C4096,B1:B2)",
            "=SUM(SUMIFS(B1:B2,A1:A2,C1:C100,A1:A2,D1:CY1))",
        ] {
            let rows = vec![vec!["x".into(), "2".into(), formula.into()]];
            assert!(
                calculate(&rows, &BTreeSet::from([(0, 1)]), "Sheet1", 4096).is_none(),
                "{formula}"
            );
            assert!(
                calculate(&rows, &BTreeSet::from([(0, 1)]), "Sheet1", 8_000_000).is_some(),
                "{formula}"
            );
        }
    }
}

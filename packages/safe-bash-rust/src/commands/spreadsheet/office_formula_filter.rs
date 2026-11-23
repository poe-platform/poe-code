// FILTER semantics follow IronCalc spill_functions.rs (f93662006b8fb1c401dc870bbda26c5d60ac6037,
// MIT, LICENSE.IronCalc). Keep references sparse until selecting the output.
use super::{Calculation, Coord, Expr, Value, lookup, strings};
use std::collections::BTreeSet;
use std::ops::Range;

// A FILTER predicate keeps references and operations until an output position
// is needed. Each operation retains its own broadcast/truncation dimensions.
enum Mask {
    Input(Value),
    Binary(&'static str, Box<[Mask; 2]>, (usize, usize)),
}

// Reuse traversal storage across selected positions instead of allocating
// temporary stacks for every cell in a dense predicate.
struct MaskEvaluation<'a> {
    pending: Vec<(&'a Mask, Option<(usize, usize)>, bool, &'static str)>,
    values: Vec<Value>,
}

impl Mask {
    fn dimensions(&self) -> (usize, usize) {
        match self {
            Self::Input(value) => lookup::dimensions(value),
            Self::Binary(_, _, size) => *size,
        }
    }
}

// Recognize coordinate reductions in the AST, never by formula text. Limit
// the reference argument to direct references or already-evaluated local values.
pub(super) fn coordinate_product(expr: &Expr) -> Option<(&Expr, bool, Option<&Expr>)> {
    fn group(mut expr: &Expr) -> &Expr {
        while let Expr::Group(inner) = expr {
            expr = inner;
        }
        expr
    }
    fn coordinate(expr: &Expr) -> Option<(&Expr, bool)> {
        let Expr::Call(name, args) = group(expr) else {
            return None;
        };
        if matches!(name.as_str(), "ROW" | "COLUMN")
            && args.len() == 1
            && matches!(
                group(&args[0]),
                Expr::Ref(_) | Expr::Range(..) | Expr::Local(_)
            )
        {
            Some((&args[0], name == "ROW"))
        } else {
            None
        }
    }
    let expr = group(expr);
    if let Some((source, vertical)) = coordinate(expr) {
        return Some((source, vertical, None));
    }
    if let Expr::Binary("*", left, right) = expr {
        if let Some((source, vertical)) = coordinate(left) {
            return Some((source, vertical, Some(right)));
        }
        if let Some((source, vertical)) = coordinate(right) {
            return Some((source, vertical, Some(left)));
        }
    }
    None
}

fn keep(ranges: &mut Vec<Range<usize>>, start: usize, end: usize, work: &mut usize) -> Option<()> {
    if start == end {
        return Some(());
    }
    if let Some(last) = ranges.last_mut().filter(|last| last.end == start) {
        last.end = end;
    } else {
        *work = work.checked_sub(std::mem::size_of::<Range<usize>>())?;
        ranges.push(start..end);
    }
    Some(())
}

fn truth(value: Value) -> Result<bool, &'static str> {
    match value {
        Value::Bool(b) => Ok(b),
        Value::Number(n) => Ok(n != 0.),
        Value::Blank | Value::Empty => Ok(false),
        Value::Error(e) | Value::LiteralError(e) => Err(e),
        _ => Err("#VALUE!"),
    }
}

impl Calculation<'_> {
    // Preserve referenced blanks as matrix() does. The entire range has already
    // been registered as a spill dependency, so empty cells need no repeated read.
    fn filter_entry(
        &mut self,
        value: &Value,
        r: usize,
        c: usize,
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if let Value::Range(a, b) = value {
            let coord = (a.0, a.1.min(b.1) + r, a.2.min(b.2) + c);
            self.tick(depth)?;
            if !self.values.contains_key(&coord)
                && !self.expressions.contains_key(&coord)
                && !self.visiting.contains(&coord)
            {
                return Some(Value::Empty);
            }
            let value = self.cell(coord, depth + 1)?;
            return Some(
                if matches!(value, Value::Blank)
                    || matches!(value, Value::Number(0.))
                        && matches!(
                            self.results.get(&coord).or_else(|| self.values.get(&coord)),
                            Some(Value::Blank | Value::Empty)
                        )
                {
                    Value::Empty
                } else {
                    value
                },
            );
        }
        self.lookup_entry(value, r, c, pos, depth)
    }

    fn filter_array_input(&mut self, input: Mask, depth: usize) -> Option<Mask> {
        Some(match input {
            Mask::Input(Value::Range(a, b)) if a.0 == b.0 => {
                self.read_spill_range(a, b)?;
                Mask::Input(Value::Range(a, b))
            }
            Mask::Input(value) => Mask::Input(Value::Matrix(self.matrix(value, depth + 1)?)),
            input => input,
        })
    }

    fn filter_expression(
        &mut self,
        expr: &Expr,
        pos: Coord,
        depth: usize,
    ) -> Option<(Mask, usize)> {
        // Use an explicit stack: long left-associative chains do not consume
        // the evaluator's recursive call budget.
        let mut nodes = 0;
        let mut pending = vec![(expr, None)];
        let mut inputs = Vec::new();
        while let Some((mut expr, operation)) = pending.pop() {
            self.tick(depth)?;
            nodes += 1;
            if let Some(op) = operation {
                let right = inputs.pop()?;
                let left = inputs.pop()?;
                if op == "EXACT" && [&left, &right].iter().all(|value| matches!(value, Mask::Input(value) if !matches!(value, Value::Range(..) | Value::Matrix(_)))) {
                    let (Mask::Input(left), Mask::Input(right)) = (left, right) else {return None;};
                    let left = self.matrix(left, depth + 1)?.pop()?.pop()?;
                    let right = self.matrix(right, depth + 1)?.pop()?.pop()?;
                    inputs.push(Mask::Input(strings::text("EXACT", &[&left, &right], &mut self.work)?));
                    continue;
                }
                if op != "EXACT" {
                    let values = [&left, &right];
                    if values
                        .iter()
                        .any(|value| matches!(value, Mask::Input(Value::Set(_))))
                    {
                        let error = values
                            .iter()
                            .find_map(|value| match value {
                                Mask::Input(Value::Error(e) | Value::LiteralError(e)) => Some(*e),
                                _ => None,
                            })
                            .unwrap_or("#REF!");
                        inputs.push(Mask::Input(Value::Error(error)));
                        continue;
                    }
                    if values.iter().all(|value| matches!(value, Mask::Input(value) if !matches!(value, Value::Range(..) | Value::Matrix(_)))) {
                        let (Mask::Input(left), Mask::Input(right)) = (left, right) else {return None;};
                        let left = self.scalar(left, pos, depth + 1)?;
                        let right = self.scalar(right, pos, depth + 1)?;
                        inputs.push(Mask::Input(self.binary(op, left, right)?));
                        continue;
                    }
                }
                let left = self.filter_array_input(left, depth)?;
                let right = self.filter_array_input(right, depth)?;
                let (a, b) = (left.dimensions(), right.dimensions());
                let dimension = |a: usize, b: usize| {
                    if a == 1 {
                        b
                    } else if b == 1 {
                        a
                    } else if matches!(op, "EXACT" | "=" | "<>" | "<" | ">" | "<=" | ">=") {
                        a.max(b)
                    } else {
                        a.min(b)
                    }
                };
                self.work = self.work.checked_sub(2 * std::mem::size_of::<Mask>())?;
                inputs.push(Mask::Binary(
                    op,
                    Box::new([left, right]),
                    (dimension(a.0, b.0), dimension(a.1, b.1)),
                ));
                continue;
            }
            while let Expr::Group(inner) = expr {
                self.tick(depth)?;
                expr = inner;
            }
            let operation = if self.dynamic.is_some() && self.array {
                match expr {
                    Expr::Call(name, args) if name == "EXACT" && args.len() == 2 => {
                        Some(("EXACT", &args[0], &args[1]))
                    }
                    Expr::Binary(op, left, right)
                        if matches!(
                            *op,
                            "=" | "<>" | "<" | ">" | "<=" | ">=" | "+" | "-" | "*" | "/" | "^"
                        ) =>
                    {
                        Some((*op, left.as_ref(), right.as_ref()))
                    }
                    _ => None,
                }
            } else {
                None
            };
            if let Some((op, left, right)) = operation {
                self.work = self
                    .work
                    .checked_sub(3 * std::mem::size_of::<(&Expr, Option<&str>)>())?;
                pending.push((expr, Some(op)));
                pending.push((right, None));
                pending.push((left, None));
            } else {
                self.work = self.work.checked_sub(std::mem::size_of::<Mask>())?;
                inputs.push(Mask::Input(self.eval(expr, pos, depth + 1, true)?));
            }
        }
        Some((self.filter_array_input(inputs.pop()?, depth)?, nodes))
    }

    fn filter_mask_value<'a>(
        &mut self,
        mask: &'a Mask,
        position: Option<(usize, usize)>,
        evaluation: &mut MaskEvaluation<'a>,
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let MaskEvaluation { pending, values } = evaluation;
        pending.clear();
        values.clear();
        pending.push((mask, position, false, "#VALUE!"));
        while let Some((mask, mut position, finish, padding)) = pending.pop() {
            self.tick(depth)?;
            if finish {
                let right = values.pop()?;
                let left = values.pop()?;
                let Mask::Binary(op, _, _) = mask else {
                    return None;
                };
                values.push(if *op == "EXACT" {
                    strings::text("EXACT", &[&left, &right], &mut self.work)?
                } else {
                    self.binary(op, left, right)?
                });
                continue;
            }
            let size = mask.dimensions();
            if let Some((r, c)) = position {
                let (r, c) = (
                    if size.0 == 1 { 0 } else { r },
                    if size.1 == 1 { 0 } else { c },
                );
                if r >= size.0 || c >= size.1 {
                    values.push(Value::Error(padding));
                    continue;
                }
                position = Some((r, c));
            }
            match mask {
                Mask::Input(value) => {
                    values.push(if position.is_none() && size != (1, 1) {
                        Value::Empty
                    } else {
                        let (r, c) = position.unwrap_or((0, 0));
                        self.filter_entry(value, r, c, pos, depth + 1)?
                    });
                }
                Mask::Binary(op, children, _) => {
                    let padding = if *op == "EXACT" { "#N/A" } else { "#VALUE!" };
                    pending.push((mask, position, true, padding));
                    pending.push((&children[1], position, false, padding));
                    pending.push((&children[0], position, false, padding));
                }
            }
        }
        values.pop()
    }

    fn filter_positions(
        &mut self,
        predicate: &Mask,
        depth: usize,
    ) -> Option<(BTreeSet<usize>, bool)> {
        let (height, width) = predicate.dimensions();
        let mut positions = BTreeSet::new();
        let mut dense = false;
        let mut pending = vec![predicate];
        while let Some(input) = pending.pop() {
            self.tick(depth)?;
            let size = input.dimensions();
            if size == (1, 1) {
                continue;
            }
            if size != (height, width) {
                dense = true;
                break;
            }
            match input {
                Mask::Input(Value::Range(a, b)) => {
                    let start = (a.0, a.1.min(b.1), a.2.min(b.2));
                    let end = (a.0, a.1.max(b.1), a.2.max(b.2));
                    for &coord in self
                        .values
                        .range(start..=end)
                        .map(|(p, _)| p)
                        .chain(self.expressions.range(start..=end).map(|(p, _)| p))
                        .chain(self.visiting.range(start..=end))
                    {
                        self.work = self.work.checked_sub(1)?;
                        if (start.2..=end.2).contains(&coord.2) {
                            self.work = self.work.checked_sub(64)?;
                            positions.insert((coord.1 - start.1) * width + coord.2 - start.2);
                        }
                    }
                }
                Mask::Binary(_, children, _) => {
                    self.work = self.work.checked_sub(2 * std::mem::size_of::<&Mask>())?;
                    pending.extend(children.iter());
                }
                _ => {
                    dense = true;
                    break;
                }
            }
        }
        Some((positions, dense))
    }

    pub(super) fn coordinate_extrema(
        &mut self,
        original: &Expr,
        source: &Expr,
        vertical: bool,
        mask: Option<&Expr>,
        maximum: bool,
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let Value::Range(a, b) = self.eval(source, pos, depth + 1, true)?.into_range() else {
            // References and bound local values have no volatile evaluation to repeat. Let the
            // normal ROW/COLUMN path retain its invalid-reference/error rules.
            return self.eval(original, pos, depth + 1, true);
        };
        let (first, count) = if vertical {
            (a.1.min(b.1) + 1, a.1.abs_diff(b.1) + 1)
        } else {
            (a.2.min(b.2) + 1, a.2.abs_diff(b.2) + 1)
        };
        let Some(mask) = mask else {
            return Some(Value::Number(
                (if maximum { first + count - 1 } else { first }) as f64,
            ));
        };
        let (predicate, nodes) = self.filter_expression(mask, pos, depth + 1)?;
        self.work = self.work.checked_sub(nodes.checked_mul(
            std::mem::size_of::<(&Mask, Option<(usize, usize)>, bool, &str)>()
                + std::mem::size_of::<Value>(),
        )?)?;
        let mut evaluation = MaskEvaluation {
            pending: Vec::with_capacity(nodes),
            values: Vec::with_capacity(nodes),
        };
        let shape = predicate.dimensions();
        let size = if vertical { (count, 1) } else { (1, count) };
        let dimension = |a: usize, b: usize| {
            if a == 1 {
                b
            } else if b == 1 {
                a
            } else {
                a.min(b)
            }
        };
        let output = (dimension(shape.0, size.0), dimension(shape.1, size.1));
        let length = output.0.checked_mul(output.1)?;
        let (positions, mut dense) = self.filter_positions(&predicate, depth)?;
        dense |= shape != (1, 1) && (shape != size || output != size);
        if dense {
            self.work = self.work.checked_sub(length)?;
        }
        let mut result = if maximum {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
        let coordinate = |index: usize| {
            let offset = if count == 1 {
                0
            } else if vertical {
                index / output.1
            } else {
                index % output.1
            };
            Value::Number((first + offset) as f64)
        };
        let mut reduce = |value: Value| match value {
            Value::Number(n) => {
                result = if maximum {
                    result.max(n)
                } else {
                    result.min(n)
                };
                Ok(())
            }
            value => Err(value),
        };
        let default = if dense {
            None
        } else {
            Some(self.filter_mask_value(&predicate, None, &mut evaluation, pos, depth + 1)?)
        };
        let mut next = 0;
        let mut positions = positions.into_iter();
        for index in 0..if dense { length } else { positions.len() } {
            let index = if dense { index } else { positions.next()? };
            self.tick(depth)?;
            if index > next {
                // With referenced blanks fixed, mask * ROW/COLUMN is linear.
                // Its endpoints contain both extrema, even for negative masks.
                for endpoint in [next, index - 1] {
                    if let Err(error) =
                        reduce(self.binary("*", default.as_ref()?.clone(), coordinate(endpoint))?)
                    {
                        return Some(error);
                    }
                }
            }
            let value = self.filter_mask_value(
                &predicate,
                Some((index / output.1, index % output.1)),
                &mut evaluation,
                pos,
                depth + 1,
            )?;
            if let Err(error) = reduce(self.binary("*", value, coordinate(index))?) {
                return Some(error);
            }
            next = index + 1;
        }
        if next < length {
            for endpoint in [next, length - 1] {
                if let Err(error) =
                    reduce(self.binary("*", default.as_ref()?.clone(), coordinate(endpoint))?)
                {
                    return Some(error);
                }
            }
        }
        Some(Value::number(result))
    }

    fn filter_mask(
        &mut self,
        expr: &Expr,
        shape: (usize, usize),
        pos: Coord,
        depth: usize,
    ) -> Option<Result<(Vec<Range<usize>>, bool), &'static str>> {
        let (predicate, nodes) = self.filter_expression(expr, pos, depth + 1)?;
        self.work = self.work.checked_sub(nodes.checked_mul(
            std::mem::size_of::<(&Mask, Option<(usize, usize)>, bool, &str)>()
                + std::mem::size_of::<Value>(),
        )?)?;
        let mut evaluation = MaskEvaluation {
            pending: Vec::with_capacity(nodes),
            values: Vec::with_capacity(nodes),
        };
        let (height, width) = predicate.dimensions();
        let (data_height, data_width) = shape;
        let rows = if height == data_height && width == 1 || height == 1 && width == data_height {
            true
        } else if height == 1 && width == data_width || height == data_width && width == 1 {
            false
        } else {
            return Some(Err("#VALUE!"));
        };
        let length = height.checked_mul(width)?;
        let (positions, dense) = self.filter_positions(&predicate, depth)?;
        let default =
            truth(self.filter_mask_value(&predicate, None, &mut evaluation, pos, depth + 1)?);
        // Store consecutive selections as runs. Even a whole column of matching
        // blanks is one run; validate the output budget before allocating cells.
        let mut mask = Vec::new();
        let mut next = 0;
        let mut positions = positions.into_iter();
        for index in 0..if dense { length } else { positions.len() } {
            let index = if dense { index } else { positions.next()? };
            self.tick(depth)?;
            if index > next {
                match default {
                    Ok(true) => keep(&mut mask, next, index, &mut self.work)?,
                    Ok(false) => {}
                    Err(e) => return Some(Err(e)),
                }
            }
            let (r, c) = (index / width, index % width);
            let value =
                self.filter_mask_value(&predicate, Some((r, c)), &mut evaluation, pos, depth + 1)?;
            match truth(value) {
                Ok(true) => keep(&mut mask, index, index + 1, &mut self.work)?,
                Ok(false) => {}
                Err(e) => return Some(Err(e)),
            }
            next = index + 1;
        }
        if next < length {
            match default {
                Ok(true) => keep(&mut mask, next, length, &mut self.work)?,
                Ok(false) => {}
                Err(e) => return Some(Err(e)),
            }
        }
        Some(Ok((mask, rows)))
    }

    pub(super) fn filter(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if !(2..=3).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let data = self.eval(&args[0], pos, depth + 1, true)?;
        if let Value::Error(e) | Value::LiteralError(e) = data {
            return Some(Value::Error(e));
        }
        let data = match data {
            Value::Range(a, b) if a.0 == b.0 => {
                self.read_spill_range(a, b)?;
                Value::Range(a, b)
            }
            value => Value::Matrix(self.matrix(value, depth + 1)?),
        };
        let (height, width) = lookup::dimensions(&data);
        if height == 0 || width == 0 {
            return Some(Value::Error("#CALC!"));
        }
        let (mask, rows) = match self.filter_mask(&args[1], (height, width), pos, depth + 1)? {
            Ok(mask) => mask,
            Err(e) => return Some(Value::Error(e)),
        };
        self.work = self.work.checked_sub(mask.len())?;
        let count = mask.iter().map(Range::len).sum();
        if count == 0 {
            if let Some(fallback) = args.get(2) {
                let value = self.eval(fallback, pos, depth + 1, true)?;
                return Some(match value {
                    Value::Blank => Value::Error("#CALC!"),
                    value @ (Value::Range(..) | Value::Single(_)) => {
                        Value::Matrix(self.matrix(value, depth + 1)?)
                    }
                    value => value,
                });
            }
            return Some(Value::Error("#CALC!"));
        }
        if matches!(data, Value::Range(..)) {
            let (h, w) = if rows {
                (count, width)
            } else {
                (height, count)
            };
            self.work = self.work.checked_sub(
                h.checked_mul(w)?
                    .checked_mul(std::mem::size_of::<Value>())?
                    .checked_add(h.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
            )?;
            let mut result = Vec::with_capacity(h);
            let mut selected_rows = mask.iter().cloned().flatten();
            for r in 0..h {
                let r = if rows { selected_rows.next()? } else { r };
                let mut row = Vec::with_capacity(w);
                let mut selected_columns = mask.iter().cloned().flatten();
                for c in 0..w {
                    let c = if rows { c } else { selected_columns.next()? };
                    row.push(self.filter_entry(&data, r, c, pos, depth + 1)?);
                }
                result.push(row);
            }
            return Some(Value::Matrix(result));
        }
        let Value::Matrix(data) = data else {
            return None;
        };
        // Move retained dense values, including strings, without cloning them.
        let h = if rows { count } else { height };
        self.work = self
            .work
            .checked_sub(h.checked_mul(std::mem::size_of::<Vec<Value>>())?)?;
        let mut result = Vec::with_capacity(h);
        if rows {
            let mut data = data.into_iter();
            let mut end = 0;
            for range in mask {
                self.work = self.work.checked_sub(range.end - end)?;
                result.extend(data.by_ref().skip(range.start - end).take(range.len()));
                end = range.end;
            }
        } else {
            self.work = self.work.checked_sub(height.checked_mul(
                width.checked_add(count.checked_mul(std::mem::size_of::<Value>())?)?,
            )?)?;
            for row in data {
                let mut data = row.into_iter();
                let mut row = Vec::with_capacity(count);
                let mut end = 0;
                for range in &mask {
                    row.extend(data.by_ref().skip(range.start - end).take(range.len()));
                    end = range.end;
                }
                result.push(row);
            }
        }
        Some(Value::Matrix(result))
    }
}

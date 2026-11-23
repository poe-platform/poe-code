// Adapted from IronCalc math_and_trigonometry/{sumproduct,matrix,mmult}.rs
// (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc).
// Numeric ranges go straight into flat f64 buffers. TRANSPOSE is read as a view,
// SUMPRODUCT stays sparse, and allocation/cubic work is charged before execution.
use super::{Calculation, Coord, Expr, Value, lookup, summation::Sum};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn shape(value: &Value, transposed: bool) -> Result<(usize, usize), &'static str> {
    match value {
        Value::Error(e) | Value::LiteralError(e) => return Err(e),
        Value::InvalidReference | Value::InvalidRange(..) => return Err("#REF!"),
        Value::Set(_) => return Err("#VALUE!"),
        Value::Range(a, b) if a.0 != b.0 => return Err("#VALUE!"),
        _ => {}
    }
    let (r, c) = lookup::dimensions(value);
    if r == 0
        || c == 0
        || matches!(value, Value::Matrix(rows) if rows.iter().any(|row| row.len()!=c))
    {
        return Err("#VALUE!");
    }
    Ok(if transposed { (c, r) } else { (r, c) })
}

impl Calculation<'_> {
    pub(super) fn matrix_source(
        &mut self,
        mut expr: &Expr,
        pos: Coord,
        mut depth: usize,
    ) -> Option<(Value, bool)> {
        let mut transposed = false;
        while let Expr::Call(name, args) = expr {
            if name != "TRANSPOSE" || args.len() != 1 {
                break;
            }
            self.tick(depth)?;
            depth += 1;
            transposed = !transposed;
            expr = &args[0];
        }
        Some((
            self.eval(expr, pos, depth + 1, true)?.into_range(),
            transposed,
        ))
    }

    pub(super) fn numeric_matrix(
        &mut self,
        source: &Value,
        transposed: bool,
        depth: usize,
    ) -> Option<Result<Vec<f64>, &'static str>> {
        let (rows, cols) = match shape(&source, transposed) {
            Ok(shape) => shape,
            Err(e) => return Some(Err(e)),
        };
        self.work = self
            .work
            .checked_sub(rows.checked_mul(cols)?.checked_mul(8)?)?;
        if let Value::Range(a, b) = source {
            self.read_spill_range(*a, *b)?;
        }
        let mut numbers = Vec::with_capacity(rows * cols);
        for r in 0..rows {
            for c in 0..cols {
                self.tick(depth)?;
                let (r, c) = if transposed { (c, r) } else { (r, c) };
                let read;
                let value = match &source {
                    Value::Range(a, b) => {
                        let coord = (a.0, a.1.min(b.1) + r, a.2.min(b.2) + c);
                        read = self.cell(coord, depth + 1)?;
                        if matches!(
                            self.results.get(&coord).or_else(|| self.values.get(&coord)),
                            Some(Value::Empty | Value::Blank)
                        ) {
                            return Some(Err("#VALUE!"));
                        }
                        &read
                    }
                    Value::Matrix(data) => &data[r][c],
                    value => value,
                };
                match value {
                    Value::Number(n) if n.is_finite() => numbers.push(*n),
                    Value::Number(_) => return Some(Err("#NUM!")),
                    Value::Error(e) | Value::LiteralError(e) => return Some(Err(e)),
                    _ => return Some(Err("#VALUE!")),
                }
            }
        }
        Some(Ok(numbers))
    }

    fn product_entries(
        &mut self,
        source: Value,
        depth: usize,
    ) -> Option<Result<BTreeMap<(usize, usize), f64>, &'static str>> {
        let (_, width) = match shape(&source, false) {
            Ok(s) => s,
            Err(e) => return Some(Err(e)),
        };
        let mut entries = BTreeMap::new();
        let mut add = |index, value: Value, work: &mut usize| {
            match value {
                Value::Error(e) | Value::LiteralError(e) => return Some(Err(e)),
                Value::Number(n) if n != 0. => {
                    *work = work.checked_sub(64)?;
                    entries.insert(index, n);
                }
                _ => {}
            }
            Some(Ok(()))
        };
        match source {
            Value::Range(a, b) => {
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
                    if (start.2..=end.2).contains(&coord.2) {
                        self.work = self.work.checked_sub(64)?;
                        cells.insert(coord);
                    }
                }
                for coord in cells {
                    let n = self.cell(coord, depth + 1)?;
                    let index = (coord.1 - start.1, coord.2 - start.2);
                    if let Err(e) = add(index, n, &mut self.work)? {
                        return Some(Err(e));
                    }
                }
            }
            Value::Matrix(rows) => {
                for (index, value) in rows.into_iter().flatten().enumerate() {
                    self.tick(depth)?;
                    if let Err(e) = add((index / width, index % width), value, &mut self.work)? {
                        return Some(Err(e));
                    }
                }
            }
            value => {
                if let Err(e) = add((0, 0), value, &mut self.work)? {
                    return Some(Err(e));
                }
            }
        }
        Some(Ok(entries))
    }

    pub(super) fn sumproduct(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if args.is_empty() || args.len() > 255 {
            return Some(Value::Error("#ERROR!"));
        }
        let mut dimensions = None;
        let mut products = BTreeMap::<(usize, usize), f64>::new();
        for (i, arg) in args.iter().enumerate() {
            let value = self.eval(arg, pos, depth + 1, true)?.into_range();
            let size = match shape(&value, false) {
                Ok(s) => s,
                Err(e) => return Some(Value::Error(e)),
            };
            if dimensions.is_some_and(|s| s != size) {
                return Some(Value::Error("#VALUE!"));
            }
            dimensions = Some(size);
            let entries = match self.product_entries(value, depth + 1)? {
                Ok(v) => v,
                Err(e) => return Some(Value::Error(e)),
            };
            if i == 0 {
                products = entries;
            } else {
                self.work = self.work.checked_sub(products.len().checked_mul(16)?)?;
                products.retain(|index, product| {
                    if let Some(n) = entries.get(index) {
                        *product *= n;
                        true
                    } else {
                        false
                    }
                });
                if products.values().any(|n| !n.is_finite()) {
                    return Some(Value::Error("#NUM!"));
                }
            }
        }
        let mut total = Sum::default();
        for n in products.into_values() {
            self.tick(depth)?;
            total.add(n);
        }
        Some(Value::number(total.total()))
    }

    // Univer math/sumx{2my2,2py2,my2} (4767b3b, Apache-2.0,
    // LICENSE.Univer): pair flattened positions, excluding nonnumeric pairs.
    // Reuse sparse statistics inputs, including their error/dependency handling.
    pub(super) fn squared_pairs(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if args.len() != 2 {
            return Some(Value::Error("#ERROR!"));
        }
        let (left, lt) = self.matrix_source(&args[0], pos, depth + 1)?;
        let (right, rt) = self.matrix_source(&args[1], pos, depth + 1)?;
        let ls = match shape(&left, lt) {
            Ok(s) => s,
            Err(e) => return Some(Value::Error(e)),
        };
        let rs = match shape(&right, rt) {
            Ok(s) => s,
            Err(e) => return Some(Value::Error(e)),
        };
        let count = ls.0.checked_mul(ls.1)?;
        if count != rs.0.checked_mul(rs.1)? {
            return Some(Value::Error("#N/A"));
        }
        let pair = |x: f64, y: f64| match name {
            "SUMX2PY2" => x * x + y * y,
            // Avoid infinity minus infinity for equal, finite magnitudes.
            "SUMX2MY2" => {
                if x == y || x == -y {
                    0.
                } else {
                    (x - y) * (x + y)
                }
            }
            _ => (x - y) * (x - y),
        };
        if count == 1 {
            let values = [
                self.matrix(left, depth + 1)?.pop()?.pop()?,
                self.matrix(right, depth + 1)?.pop()?.pop()?,
            ];
            for value in &values {
                if let Value::Error(e) | Value::LiteralError(e) = value {
                    return Some(Value::Error(e));
                }
            }
            if values
                .iter()
                .any(|v| matches!(v, Value::Blank | Value::Empty))
            {
                return Some(Value::Error("#VALUE!"));
            }
            let mut numbers = [0.; 2];
            for (i, value) in values.into_iter().enumerate() {
                self.charge_value(&value)?;
                numbers[i] = match value {
                    Value::Number(n) => n,
                    Value::Text(t) | Value::UninternedText(t) => {
                        match t.trim().parse::<f64>().ok().filter(|n| n.is_finite()) {
                            Some(n) => n,
                            None => return Some(Value::Error("#DIV/0!")),
                        }
                    }
                    _ => return Some(Value::Error("#DIV/0!")),
                };
            }
            return Some(Value::number(pair(numbers[0], numbers[1])));
        }
        let left = match self.paired_entries(left, lt, depth + 1)? {
            Ok(v) => v,
            Err(e) => return Some(Value::Error(e)),
        };
        let right = match self.paired_entries(right, rt, depth + 1)? {
            Ok(v) => v,
            Err(e) => return Some(Value::Error(e)),
        };
        self.work = self
            .work
            .checked_sub(left.len().checked_add(right.len())?)?;
        // Errors propagate even opposite an ignored text or blank. The first
        // input wins a tie, matching the existing paired-statistics contract.
        if let Some((_, e)) = left
            .iter()
            .chain(&right)
            .filter_map(|(&i, v)| v.as_ref().err().map(|&e| (i, e)))
            .min_by_key(|(i, _)| *i)
        {
            return Some(Value::Error(e));
        }
        let mut total = Sum::default();
        let mut matched = false;
        for (index, x) in left {
            self.tick(depth)?;
            if let (Ok(x), Some(Ok(y))) = (x, right.get(&index)) {
                let value = pair(x, *y);
                if !value.is_finite() {
                    return Some(Value::Error("#NUM!"));
                }
                total.add(value);
                matched = true;
            }
        }
        Some(if matched {
            Value::number(total.total())
        } else {
            Value::Error("#DIV/0!")
        })
    }

    pub(super) fn matrix_function(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if args.len() != if name == "MMULT" { 2 } else { 1 } {
            return Some(Value::Error("#ERROR!"));
        }
        if name == "MUNIT" {
            let value = self.eval(&args[0], pos, depth + 1, true)?;
            let value = self.scalar(value, pos, depth + 1)?;
            if let Value::Error(e) | Value::LiteralError(e) = value {
                return Some(Value::Error(e));
            }
            let Some(n) = value.numeric().filter(|n| n.is_finite()).map(f64::trunc) else {
                return Some(Value::Error("#VALUE!"));
            };
            if !(1. ..=16384.).contains(&n) {
                return Some(Value::Error("#VALUE!"));
            }
            let n = n as usize;
            self.work = self.work.checked_sub(
                n.checked_mul(n)?
                    .checked_mul(std::mem::size_of::<Value>())?
                    .checked_add(n.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
            )?;
            return Some(Value::Matrix(
                (0..n)
                    .map(|r| (0..n).map(|c| Value::Number(f64::from(r == c))).collect())
                    .collect(),
            ));
        }
        let (a, ta) = self.matrix_source(&args[0], pos, depth + 1)?;
        let (m, k) = match shape(&a, ta) {
            Ok(s) => s,
            Err(e) => return Some(Value::Error(e)),
        };
        if name == "MMULT" {
            let (b, tb) = self.matrix_source(&args[1], pos, depth + 1)?;
            let (k2, n) = match shape(&b, tb) {
                Ok(s) => s,
                Err(e) => return Some(Value::Error(e)),
            };
            if k != k2 {
                return Some(Value::Error("#VALUE!"));
            }
            let a = match self.numeric_matrix(&a, ta, depth + 1)? {
                Ok(v) => v,
                Err(e) => return Some(Value::Error(e)),
            };
            let b = match self.numeric_matrix(&b, tb, depth + 1)? {
                Ok(v) => v,
                Err(e) => return Some(Value::Error(e)),
            };
            self.work = self
                .work
                .checked_sub(m.checked_mul(n)?.checked_mul(k)?.checked_mul(8)?)?;
            self.work = self.work.checked_sub(
                m.checked_mul(n)?
                    .checked_mul(std::mem::size_of::<Value>())?
                    .checked_add(m.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
            )?;
            // Walk B row by row so each inner loop accesses contiguous memory.
            self.work = self.work.checked_sub(n.checked_mul(8)?)?;
            let mut sums = vec![0.; n];
            let mut output = Vec::with_capacity(m);
            for row in a.chunks(k) {
                sums.fill(0.);
                for (x, brow) in row.iter().zip(b.chunks(n)) {
                    for (sum, y) in sums.iter_mut().zip(brow) {
                        *sum += x * y;
                    }
                }
                if sums.iter().any(|n| !n.is_finite()) {
                    return Some(Value::Error("#NUM!"));
                }
                output.push(sums.iter().copied().map(Value::number).collect());
            }
            return Some(Value::Matrix(output));
        }
        if m != k {
            return Some(Value::Error("#VALUE!"));
        }
        let n = m;
        let mut matrix = match self.numeric_matrix(&a, ta, depth + 1)? {
            Ok(v) => v,
            Err(e) => return Some(Value::Error(e)),
        };
        self.work = self.work.checked_sub(
            n.checked_mul(n)?
                .checked_mul(n)?
                .checked_mul(if name == "MINVERSE" { 16 } else { 8 })?,
        )?;
        self.work = self.work.checked_sub(n.checked_mul(32)?)?;
        // Keep the original scale when possible: normalizing a row containing
        // both 1e308 and 1e-200 would erase its small, meaningful coefficient.
        let mut scales = vec![1.; n];
        let mut factorization = lu(&mut matrix, n);
        if matches!(factorization, Err(FactorError::Overflow)) {
            self.work = self
                .work
                .checked_sub(n.checked_mul(n)?.checked_mul(n)?.checked_mul(8)?)?;
            matrix = match self.numeric_matrix(&a, ta, depth + 1)? {
                Ok(v) => v,
                Err(e) => return Some(Value::Error(e)),
            };
            for (row, scale) in matrix.chunks_mut(n).zip(&mut scales) {
                *scale = row.iter().map(|n| n.abs()).fold(0., f64::max);
                if *scale != 0. {
                    for n in row {
                        *n /= *scale;
                    }
                }
            }
            factorization = lu(&mut matrix, n);
        }
        let (sign, swaps) = match factorization {
            Ok(factors) => factors,
            Err(FactorError::Singular) if name == "MDETERM" => return Some(Value::Number(0.)),
            Err(_) => return Some(Value::Error("#NUM!")),
        };
        if name == "MDETERM" {
            let mut factors = scales;
            factors.extend((0..n).map(|i| matrix[i * n + i]));
            factors.sort_unstable_by(|a, b| a.abs().total_cmp(&b.abs()));
            let (mut lo, mut hi) = (0, factors.len());
            let mut det = sign;
            while lo < hi {
                // Balance small and large factors instead of overflowing a partial
                // product whose final determinant is still representable.
                det *= if det.abs() < 1. {
                    hi -= 1;
                    factors[hi]
                } else {
                    let v = factors[lo];
                    lo += 1;
                    v
                };
            }
            return Some(Value::number(det));
        }
        self.work = self.work.checked_sub(
            n.checked_mul(n)?
                .checked_mul(std::mem::size_of::<Value>())?
                .checked_add(n.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
        )?;
        let mut inverse = vec![vec![Value::Number(0.); n]; n];
        let mut column = vec![0.; n];
        for c in 0..n {
            column.fill(0.);
            column[c] = 1. / scales[c];
            for (i, &swap) in swaps.iter().enumerate() {
                column.swap(i, swap);
            }
            for i in 1..n {
                for k in 0..i {
                    column[i] -= matrix[i * n + k] * column[k];
                }
            }
            for i in (0..n).rev() {
                let numerator = column[i];
                let pivot = matrix[i * n + i];
                for k in i + 1..n {
                    column[i] -= matrix[i * n + k] * column[k];
                }
                column[i] /= pivot;
                if !column[i].is_finite() {
                    // A large numerator can overflow before division by a large
                    // pivot, even when the solved coefficient is finite.
                    column[i] = numerator / pivot;
                    for k in i + 1..n {
                        column[i] -= (matrix[i * n + k] / pivot) * column[k];
                    }
                    if !column[i].is_finite() {
                        return Some(Value::Error("#NUM!"));
                    }
                }
            }
            for r in 0..n {
                inverse[r][c] = Value::number(column[r]);
            }
        }
        Some(Value::Matrix(inverse))
    }
}

enum FactorError {
    Singular,
    Overflow,
}

fn lu(matrix: &mut [f64], n: usize) -> Result<(f64, Vec<usize>), FactorError> {
    let mut swaps = Vec::with_capacity(n);
    let mut sign = 1.;
    for col in 0..n {
        let row = (col..n)
            .max_by(|&a, &b| {
                matrix[a * n + col]
                    .abs()
                    .total_cmp(&matrix[b * n + col].abs())
            })
            .ok_or(FactorError::Singular)?;
        // A fixed epsilon incorrectly classifies small nonsingular matrices.
        if matrix[row * n + col] == 0. {
            return Err(FactorError::Singular);
        }
        swaps.push(row);
        if row != col {
            for k in 0..n {
                matrix.swap(row * n + k, col * n + k);
            }
            sign = -sign;
        }
        let pivot = matrix[col * n + col];
        for row in col + 1..n {
            matrix[row * n + col] /= pivot;
            for k in col + 1..n {
                matrix[row * n + k] -= matrix[row * n + col] * matrix[col * n + k];
                if !matrix[row * n + k].is_finite() {
                    return Err(FactorError::Overflow);
                }
            }
        }
    }
    Ok((sign, swaps))
}

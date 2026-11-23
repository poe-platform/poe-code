use super::{
    Calculation, Coord, Expr, Value,
    financial::{odd_first, options},
    lookup::number,
    math, trigonometry,
};

impl Calculation<'_> {
    pub(super) fn sum_product(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        self.result_format = None;
        let mut matrices = Vec::new();
        for arg in args {
            let value = self.eval(arg, pos, depth + 1, true)?;
            matrices.push(self.matrix(value, depth + 1)?);
        }
        let Some(first) = matrices.first() else {
            return Some(Value::Error("#VALUE!"));
        };
        let height = first.len();
        let width = first.first().map_or(0, Vec::len);
        if matrices
            .iter()
            .any(|m| m.len() != height || m.iter().any(|row| row.len() != width))
        {
            return Some(Value::Error("#VALUE!"));
        }
        let mut terms = Vec::new();
        for row in 0..height {
            for column in 0..width {
                let mut term = 1.;
                for matrix in &matrices {
                    self.tick(depth)?;
                    term *= match matrix[row][column] {
                        Value::Number(n) => n,
                        Value::Bool(b) if name == "ODF.SUMPRODUCT" => f64::from(b),
                        Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
                        _ => 0.,
                    };
                }
                terms.push(term);
            }
        }
        Some(Value::number(Expansion::sum(&terms, &mut self.work)?))
    }

    pub(super) fn sum_squares(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        self.result_format = None;
        let mut numbers = Vec::new();
        for arg in args {
            self.aggregate = true;
            let value = self.eval(arg, pos, depth + 1, true)?;
            self.aggregate = false;
            let mut pending = vec![value];
            while let Some(value) = pending.pop() {
                self.tick(depth)?;
                if let Value::Set(mut set) = value {
                    set.reverse();
                    pending.extend(set);
                    continue;
                }
                for row in self.matrix(value, depth + 1)? {
                    for value in row {
                        self.tick(depth)?;
                        match value {
                            Value::Error(e) | Value::LiteralError(e) => {
                                return Some(Value::Error(e));
                            }
                            Value::Number(n) => numbers.push(n * n),
                            _ => {}
                        }
                    }
                }
            }
        }
        Some(Value::number(Expansion::sum(&numbers, &mut self.work)?))
    }

    pub(super) fn production_numeric(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        self.result_format = None;
        let odd_first = matches!(name, "ODDFPRICE" | "ODDFYIELD");
        let trig_count = trigonometry::arguments(name);
        let math_count = math::arguments(name);
        let text_count = if name == "OPT_BINOMIAL" {
            2
        } else if odd_first
            || trig_count.is_some()
            || math_count.is_some()
            || matches!(
                name,
                "OPT_BS_GAMMA"
                    | "OPT_BS_VEGA"
                    | "OPT_SIMPLE_CHOOSER"
                    | "OPT_COMPLEX_CHOOSER"
                    | "CUM_BIV_NORM_DIST"
                    | "OPT_RGW"
                    | "OPT_EURO_EXCHANGE"
                    | "OPT_AMER_EXCHANGE"
            )
        {
            0
        } else {
            1
        };
        let (minimum, maximum) = if let Some(count) = math_count {
            count
        } else if let Some(count) = trig_count {
            (count, count)
        } else if name == "CUM_BIV_NORM_DIST" {
            (3, 3)
        } else if name == "OPT_MILTERSEN_SCHWARTZ" {
            (14, 14)
        } else if name == "OPT_2_ASSET_CORRELATION" {
            (12, 12)
        } else if matches!(name, "OPT_EURO_EXCHANGE" | "OPT_AMER_EXCHANGE") {
            (11, 11)
        } else if name == "OPT_BINOMIAL" {
            (8, 9)
        } else if name == "OPT_TIME_SWITCH" {
            (10, 10)
        } else if odd_first
            || matches!(
                name,
                "OPT_SPREAD_APPROX"
                    | "OPT_FIXED_STRK_LKBK"
                    | "OPT_EXTENDIBLE_WRITER"
                    | "OPT_COMPLEX_CHOOSER"
                    | "OPT_ON_OPTIONS"
            )
        {
            (9, 9)
        } else if matches!(
            name,
            "OPT_GARMAN_KOHLHAGEN"
                | "OPT_SIMPLE_CHOOSER"
                | "OPT_RGW"
                | "OPT_BJER_STENS"
                | "OPT_BAW_AMER"
        ) {
            (7, 7)
        } else if matches!(
            name,
            "OPT_FRENCH"
                | "OPT_JUMP_DIFF"
                | "OPT_EXEC"
                | "OPT_FORWARD_START"
                | "OPT_FLOAT_STRK_LKBK"
        ) {
            (8, 8)
        } else if text_count != 0 {
            (6, 7)
        } else {
            (5, 6)
        };
        if !(minimum..=maximum).contains(&args.len()) {
            return Some(Value::Error("#N/A"));
        }
        let mut operands = Vec::new();
        let mut shape = None;
        let mut text_matrices = [false; 2];
        let mut omitted = [false; 3];
        for (index, arg) in args.iter().enumerate() {
            let value = self.eval(arg, pos, depth + 1, true)?;
            let rows = if self.array && matches!(value, Value::Matrix(_) | Value::Range(..) | Value::LabelRange(..)) {
                if index < text_count {
                    text_matrices[index] = true;
                }
                let rows = self.matrix(value, depth + 1)?;
                let size = (rows.len(), rows.first()?.len());
                if shape.is_some_and(|s| s != size) {
                    return Some(Value::Error("#VALUE!"));
                }
                shape = Some(size);
                rows
            } else {
                let value = self.scalar(value, pos, depth + 1)?;
                if math_count.is_some() && index >= minimum && matches!(value, Value::Blank) {
                    omitted[index] = true;
                }
                let value = if index < text_count {
                    if let Value::Error(e) | Value::LiteralError(e) = value {
                        return Some(Value::Error(e));
                    }
                    value
                } else {
                    match operand(&value, self.book.date1904) {
                        Ok(n) => Value::Number(n),
                        Err(e) => return Some(Value::Error(e)),
                    }
                };
                vec![vec![value]]
            };
            operands.push(rows);
        }
        let (height, width) = shape.unwrap_or((1, 1));
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?,
        )?;
        let mut result = Vec::new();
        for row in 0..height {
            let mut values = Vec::new();
            for column in 0..width {
                self.tick(depth)?;
                let mut numbers = [0.; 13];
                let mut error = None;
                let mut flags = [""; 2];
                for (index, matrix) in operands.iter().enumerate() {
                    let value = &matrix[if matrix.len() == 1 { 0 } else { row }]
                        [if matrix[0].len() == 1 { 0 } else { column }];
                    if index < text_count {
                        match value {
                            Value::Error(e) | Value::LiteralError(e) => {
                                error = Some(*e);
                                break;
                            }
                            Value::Text(s) | Value::UninternedText(s) => {
                                flags[index] = s;
                            }
                            Value::Blank
                            | Value::Empty
                            | Value::FunctionEmpty
                            | Value::MatrixEmpty => {}
                            _ if text_matrices[index] => {
                                error = Some("#VALUE!");
                                break;
                            }
                            _ => {}
                        }
                        continue;
                    }
                    match operand(value, self.book.date1904) {
                        Ok(n) => numbers[index - text_count] = n,
                        Err(e) => {
                            error = Some(e);
                            break;
                        }
                    }
                }
                values.push(if let Some(e) = error {
                    Value::Error(e)
                } else {
                    match if math_count.is_some() {
                        if name == "LOG" && (args.len() < 2 || omitted[1]) {
                            numbers[1] = 10.;
                        }
                        if matches!(name, "FLOOR" | "CEILING" | "FLOOR.XCL" | "CEILING.XCL")
                            && (args.len() < 2 || omitted[1])
                        {
                            numbers[1] = if numbers[0] > 0. { 1. } else { -1. };
                        }
                        if name == "POWER" && (args.len() < 3 || omitted[2]) {
                            numbers[2] = 1.;
                        }
                        math::calculate(name, numbers[0], numbers[1], numbers[2])
                    } else if trig_count.is_some() {
                        trigonometry::calculate(name, numbers[0], numbers[1])
                    } else if odd_first {
                        odd_first::calculate(name, numbers, self.book.date1904, &mut self.work)?
                    } else {
                        options::calculate(name, numbers, flags, &mut self.work)?
                    } {
                        Ok(n) => Value::Number(n),
                        Err(e) => Value::Error(e),
                    }
                });
            }
            result.push(values);
        }
        Some(if shape.is_some() {
            Value::Matrix(result)
        } else {
            result.pop()?.pop()?
        })
    }
}

pub(super) fn operand(value: &Value, date1904: bool) -> Result<f64, &'static str> {
    match value {
        Value::Error(e) | Value::LiteralError(e) => Err(e),
        Value::Text(s) | Value::UninternedText(s) => {
            number::parse_production(s, date1904).ok_or("#VALUE!")
        }
        _ => value.numeric().ok_or("#VALUE!"),
    }
}

// GOffice partial expansion is shared by aggregate functions and database statistics.
#[derive(Default)]
pub(super) struct Expansion {
    partials: Vec<f64>,
}

impl Expansion {
    pub(super) fn add(&mut self, mut x: f64, work: &mut usize) -> Option<()> {
        *work = work.checked_sub(1)?;
        let mut retained = 0;
        for index in 0..self.partials.len() {
            *work = work.checked_sub(1)?;
            let mut y = self.partials[index];
            if x.abs() < y.abs() {
                std::mem::swap(&mut x, &mut y);
            }
            let high = x + y;
            if !high.is_finite() {
                x = high;
                retained = 0;
                break;
            }
            let low = y - (high - x);
            if low != 0. {
                self.partials[retained] = low;
                retained += 1;
            }
            x = high;
        }
        self.partials.truncate(retained);
        self.partials.push(x);
        Some(())
    }

    pub(super) fn total(&self, work: &mut usize) -> Option<f64> {
        let mut result = 0.;
        for &part in &self.partials {
            *work = work.checked_sub(1)?;
            result += part;
        }
        Some(result)
    }

    pub(super) fn sum(values: &[f64], work: &mut usize) -> Option<f64> {
        let mut result = Self::default();
        for &value in values.iter().rev() {
            result.add(value, work)?;
        }
        result.total(work)
    }
}

// Delimited text operations adapted from IronCalc text/{textsplit,common}.rs,
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT; LICENSE.IronCalc), and Univer
// text/{textbefore,textafter}, 4767b3b309467c283bbd52b725536ca73861e0fc
// (Apache-2.0; LICENSE.Univer). Matching uses original UTF-8 boundaries:
// lowercasing a whole string can change its byte offsets.
use super::strings::string;
use super::{Calculation, Coord, Expr, Value, lookup};

fn find(
    text: &str,
    delimiters: &[String],
    insensitive: bool,
    reverse: bool,
    work: &mut usize,
) -> Option<Option<(usize, usize)>> {
    let mut positions = text.char_indices();
    while let Some((start, _)) = if reverse {
        positions.next_back()
    } else {
        positions.next()
    } {
        *work = work.checked_sub(1)?;
        for delimiter in delimiters {
            if !insensitive {
                *work = work.checked_sub(delimiter.len().min(text.len() - start) + 1)?;
                if text[start..].starts_with(delimiter) {
                    return Some(Some((start, start + delimiter.len())));
                }
            } else {
                let mut expected = delimiter.chars().flat_map(char::to_lowercase).peekable();
                'characters: for (offset, c) in text[start..].char_indices() {
                    for folded in c.to_lowercase() {
                        *work = work.checked_sub(1)?;
                        if expected.next() != Some(folded) {
                            break 'characters;
                        }
                    }
                    if expected.peek().is_none() {
                        return Some(Some((start, start + offset + c.len_utf8())));
                    }
                }
            }
        }
    }
    Some(None)
}

fn parts<'a>(
    text: &'a str,
    delimiters: &[String],
    insensitive: bool,
    work: &mut usize,
) -> Option<Vec<&'a str>> {
    let mut output = Vec::new();
    let mut start = 0;
    if !delimiters.is_empty() {
        while let Some((a, b)) = find(&text[start..], delimiters, insensitive, false, work)? {
            *work = work.checked_sub(std::mem::size_of::<&str>())?;
            output.push(&text[start..start + a]);
            start += b;
        }
    }
    *work = work.checked_sub(std::mem::size_of::<&str>())?;
    output.push(&text[start..]);
    Some(output)
}

impl Calculation<'_> {
    pub(super) fn text_delimiters(
        &mut self,
        arg: &Expr,
        pos: Coord,
        depth: usize,
        split: bool,
    ) -> Option<Result<Vec<String>, &'static str>> {
        let value = self.eval(arg, pos, depth + 1, true)?;
        let mut output = Vec::new();
        for value in self.matrix(value, depth + 1)?.into_iter().flatten() {
            self.tick(depth)?;
            match value {
                Value::Error(e) | Value::LiteralError(e) => return Some(Err(e)),
                Value::Empty | Value::Blank if split => continue,
                value => {
                    self.work = self.work.checked_sub(std::mem::size_of::<String>())?;
                    self.charge_value(&value)?;
                    output.push(match value {
                        Value::Text(s) | Value::UninternedText(s) => s,
                        value => string(&value).into_owned(),
                    });
                }
            }
        }
        Some(Ok(output))
    }

    pub(super) fn text_split(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if !(2..=6).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let value = self.eval(&args[0], pos, depth + 1, true)?;
        let value = self.scalar(value, pos, depth + 1)?;
        if let Value::Error(e) | Value::LiteralError(e) = value {
            return Some(Value::Error(e));
        }
        let text = string(&value);
        let columns = match self.text_delimiters(&args[1], pos, depth + 1, true)? {
            Ok(v) => v,
            Err(e) => return Some(Value::Error(e)),
        };
        let rows = if let Some(arg) = args.get(2) {
            match self.text_delimiters(arg, pos, depth + 1, true)? {
                Ok(v) => v,
                Err(e) => return Some(Value::Error(e)),
            }
        } else {
            Vec::new()
        };
        if columns.iter().chain(&rows).any(String::is_empty)
            || columns.is_empty() && rows.is_empty()
        {
            return Some(Value::Error("#VALUE!"));
        }
        let (mut ignore, mut insensitive) = (false, false);
        for i in 3..args.len().min(5) {
            let v = self.eval(&args[i], pos, depth + 1, true)?;
            let v = self.scalar(v, pos, depth + 1)?;
            if let Value::Error(e) | Value::LiteralError(e) = v {
                return Some(Value::Error(e));
            }
            if i == 3 {
                let Some(b) = lookup::boolean(&v) else {
                    return Some(Value::Error("#VALUE!"));
                };
                ignore = b;
            } else {
                insensitive = match v.numeric() {
                    Some(0.) => false,
                    Some(1.) => true,
                    _ => return Some(Value::Error("#VALUE!")),
                };
            }
        }
        let mut output = Vec::new();
        let mut width = 0;
        for row in parts(&text, &rows, insensitive, &mut self.work)? {
            if ignore && row.is_empty() {
                continue;
            }
            self.work = self.work.checked_sub(std::mem::size_of::<Vec<Value>>())?;
            let mut cells = Vec::new();
            for cell in parts(row, &columns, insensitive, &mut self.work)? {
                if ignore && cell.is_empty() {
                    continue;
                }
                self.work = self
                    .work
                    .checked_sub(std::mem::size_of::<Value>().checked_add(cell.len())?)?;
                cells.push(Value::Text(cell.into()));
            }
            width = width.max(cells.len());
            output.push(cells);
        }
        if width == 0 || output.is_empty() {
            return Some(Value::Error("#VALUE!"));
        }
        let pad = if let Some(arg) = args
            .get(5)
            .filter(|arg| !matches!(arg, Expr::Value(Value::Blank)))
        {
            let v = self.eval(arg, pos, depth + 1, true)?;
            let mut matrix = self.matrix(v, depth + 1)?;
            if matrix.len() != 1 || matrix[0].len() != 1 {
                return Some(Value::Error("#VALUE!"));
            }
            matrix.pop()?.pop()?
        } else {
            Value::Error("#N/A")
        };
        for row in &mut output {
            self.work = self
                .work
                .checked_sub((width - row.len()).checked_mul(std::mem::size_of::<Value>())?)?;
            while row.len() < width {
                self.charge_value(&pad)?;
                row.push(pad.clone());
            }
        }
        Some(Value::Matrix(output))
    }

    pub(super) fn text_boundary(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if !(2..=6).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let delimiters = self.text_delimiters(&args[1], pos, depth + 1, false)?;
        let mut values = Vec::new();
        let mut shape = None;
        for i in [0, 2, 3, 4, 5] {
            let value = if let Some(arg) = args.get(i) {
                if matches!(arg, Expr::Value(Value::Blank)) && i == 2 {
                    Value::Number(1.)
                } else {
                    self.eval(arg, pos, depth + 1, true)?
                }
            } else {
                match i {
                    2 => Value::Number(1.),
                    5 => Value::Error("#N/A"),
                    _ => Value::Number(0.),
                }
            };
            let matrix = matches!(value, Value::Matrix(_) | Value::Range(..));
            let rows = self.matrix(value, depth + 1)?;
            if matrix {
                let dims = (rows.len(), rows.first()?.len());
                shape = Some(shape.map_or(dims, |(h, w): (usize, usize)| {
                    (h.max(dims.0), w.max(dims.1))
                }));
            }
            values.push(rows);
        }
        let (height, width) = shape.unwrap_or((1, 1));
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?
                .checked_add(height.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
        )?;
        let mut output = Vec::with_capacity(height);
        for r in 0..height {
            let mut row = Vec::with_capacity(width);
            for c in 0..width {
                self.tick(depth)?;
                let item = |i: usize| {
                    let matrix = &values[i];
                    matrix
                        .get(if matrix.len() == 1 { 0 } else { r })
                        .and_then(|row| row.get(if row.len() == 1 { 0 } else { c }))
                        .unwrap_or(&Value::Error("#N/A"))
                };
                row.push(boundary(
                    name,
                    &[item(0), item(1), item(2), item(3), item(4)],
                    delimiters.as_deref().map_err(|e| *e),
                    &mut self.work,
                )?);
            }
            output.push(row);
        }
        Some(if shape.is_some() {
            Value::Matrix(output)
        } else {
            output.pop()?.pop()?
        })
    }
}

fn boundary(
    name: &str,
    args: &[&Value; 5],
    delimiters: Result<&[String], &'static str>,
    work: &mut usize,
) -> Option<Value> {
    for value in &args[..4] {
        if let Value::Error(e) | Value::LiteralError(e) = value {
            return Some(Value::Error(e));
        }
    }
    let delimiters = match delimiters {
        Ok(v) => v,
        Err(e) => return Some(Value::Error(e)),
    };
    let text = string(args[0]);
    let Some(instance) = args[1]
        .numeric()
        .filter(|n| n.is_finite())
        .map(f64::floor)
        .filter(|n| *n != 0.)
    else {
        return Some(Value::Error("#VALUE!"));
    };
    let insensitive = match args[2].numeric() {
        Some(0.) => false,
        Some(1.) => true,
        _ => return Some(Value::Error("#VALUE!")),
    };
    let match_end = match args[3].numeric() {
        Some(0.) => false,
        Some(1.) => true,
        _ => return Some(Value::Error("#VALUE!")),
    };
    let before = name == "TEXTBEFORE";
    let reverse = instance < 0.;
    let selected = if delimiters.iter().any(String::is_empty) {
        Some(if before == reverse { text.as_ref() } else { "" })
    } else {
        *work = work.checked_sub(text.len())?;
        if instance.abs() > text.chars().count() as f64 {
            return Some(Value::Error("#VALUE!"));
        }
        let mut left = 0;
        let mut right = text.len();
        let mut remaining = instance.abs() as usize;
        let mut selected = None;
        while remaining > 0 {
            match find(&text[left..right], delimiters, insensitive, reverse, work)? {
                Some((a, b)) => {
                    remaining -= 1;
                    let (a, b) = (left + a, left + b);
                    if remaining == 0 {
                        selected = Some(if before { &text[..a] } else { &text[b..] });
                        break;
                    }
                    if reverse {
                        right = a;
                    } else {
                        left = b;
                    }
                }
                None => {
                    if match_end && remaining == 1 {
                        selected = Some(if before != reverse { text.as_ref() } else { "" });
                    }
                    break;
                }
            }
        }
        selected
    };
    if let Some(text) = selected {
        *work = work.checked_sub(text.len())?;
        return Some(Value::Text(text.into()));
    }
    let fallback = args[4];
    *work = work.checked_sub(match fallback {
        Value::Text(s) | Value::UninternedText(s) => s.len(),
        _ => 0,
    })?;
    Some(match fallback {
        Value::Blank | Value::Empty => Value::Text(String::new()),
        value => value.clone(),
    })
}

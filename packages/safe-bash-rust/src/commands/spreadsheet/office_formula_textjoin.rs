// TEXTJOIN coercion and flattening adapt IronCalc f936620 text/common.rs;
// cycling delimiters and ignore_empty arrays adapt Univer 4767b3b text/textjoin.
// MIT, LICENSE.IronCalc; Apache-2.0, LICENSE.Univer.
use super::{Calculation, Coord, Expr, Value, lookup, strings};
use std::collections::BTreeSet;

#[derive(Default)]
struct Joined {
    output: String,
    units: u64,
    items: u64,
    error: Option<&'static str>,
}

impl Joined {
    // Advance over a run of empty items without allocating or visiting cells.
    fn empty(&mut self, count: u64, delimiters: &[(String, u64)], work: &mut usize) -> Option<()> {
        if count == 0 || self.error.is_some() {
            return Some(());
        }
        let separators = count - u64::from(self.items == 0);
        let start = self.items.saturating_sub(1) % delimiters.len() as u64;
        self.items = self.items.checked_add(count)?;
        let cycles = separators / delimiters.len() as u64;
        let remaining = separators % delimiters.len() as u64;
        let (mut units, mut bytes) = (0u64, 0u64);
        if cycles > 0 {
            *work = work.checked_sub(delimiters.len())?;
            for (text, length) in delimiters {
                units = units.checked_add(*length)?;
                bytes = bytes.checked_add(text.len() as u64)?;
            }
            units = units.checked_mul(cycles)?;
            bytes = bytes.checked_mul(cycles)?;
        }
        *work = work.checked_sub(remaining as usize)?;
        for i in 0..remaining {
            let (text, length) = &delimiters[((start + i) % delimiters.len() as u64) as usize];
            units = units.checked_add(*length)?;
            bytes = bytes.checked_add(text.len() as u64)?;
        }
        self.units = self.units.checked_add(units)?;
        if self.units > 32767 {
            self.error = Some("#VALUE!");
            return Some(());
        }
        // Nonempty output is bounded by the UTF-16 limit before allocation.
        if bytes > 0 {
            *work = work.checked_sub(usize::try_from(bytes.checked_add(separators)?).ok()?)?;
            self.output.reserve(bytes as usize);
            for i in 0..separators {
                self.output
                    .push_str(&delimiters[((start + i) % delimiters.len() as u64) as usize].0);
            }
        }
        Some(())
    }

    fn push(&mut self, text: &str, delimiters: &[(String, u64)], work: &mut usize) -> Option<()> {
        self.empty(1, delimiters, work)?;
        if self.error.is_some() {
            return Some(());
        }
        *work = work.checked_sub(text.len())?;
        self.units = self.units.checked_add(text.encode_utf16().count() as u64)?;
        if self.units > 32767 {
            self.error = Some("#VALUE!");
        } else {
            *work = work.checked_sub(text.len())?;
            self.output.push_str(text);
        }
        Some(())
    }
}

impl Calculation<'_> {
    pub(super) fn textjoin(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if !(3..=255).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let delimiters = self.text_delimiters(&args[0], pos, depth + 1, false)?;
        let flags = self.eval(&args[1], pos, depth + 1, true)?;
        let mut flags = self.matrix(flags, depth + 1)?;
        let mut needed = [false; 2];
        for flag in flags.iter_mut().flatten() {
            self.tick(depth)?;
            self.charge_value(flag)?;
            *flag = match &*flag {
                Value::Error(e) | Value::LiteralError(e) => Value::Error(e),
                value => match lookup::boolean(value) {
                    Some(b) => {
                        needed[usize::from(b)] = true;
                        Value::Bool(b)
                    }
                    None => Value::Error("#VALUE!"),
                },
            };
        }
        let delimiter_error = delimiters.as_ref().err().copied();
        let mut failure = delimiter_error;
        let mut joined = [Joined::default(), Joined::default()];
        if failure.is_none() && needed.iter().any(|&n| n) {
            let texts = delimiters.ok()?;
            if texts.is_empty() {
                return Some(Value::Error("#VALUE!"));
            }
            self.work = self.work.checked_sub(
                texts
                    .len()
                    .checked_mul(std::mem::size_of::<(String, u64)>())?,
            )?;
            let mut delimiters = Vec::with_capacity(texts.len());
            for text in texts {
                self.work = self.work.checked_sub(text.len())?;
                let units = text.encode_utf16().count() as u64;
                delimiters.push((text, units));
            }
            'arguments: for arg in &args[2..] {
                self.work = self.work.checked_sub(std::mem::size_of::<(Value, u64)>())?;
                let mut pending = vec![(self.eval(arg, pos, depth + 1, true)?, 1u64)];
                while let Some((value, count)) = pending.pop() {
                    self.tick(depth)?;
                    match value {
                        Value::Single(coord) => {
                            let mut value = self.cell(coord, depth + 1)?;
                            if matches!(value, Value::Number(0.))
                                && matches!(
                                    self.results.get(&coord).or_else(|| self.values.get(&coord)),
                                    Some(Value::Blank | Value::Empty)
                                )
                            {
                                value = Value::Empty;
                            }
                            pending.push((value, 1));
                        }
                        Value::Range(a, b) => {
                            if a.0 != b.0 {
                                failure = Some("#VALUE!");
                                break 'arguments;
                            }
                            self.read_spill_range(a, b)?;
                            let (r, c) = (a.1.min(b.1), a.2.min(b.2));
                            let (height, width) =
                                (a.1.abs_diff(b.1) as u64 + 1, a.2.abs_diff(b.2) as u64 + 1);
                            self.work = self.work.checked_sub(
                                self.values
                                    .len()
                                    .checked_add(self.expressions.len())?
                                    .checked_mul(192)?,
                            )?;
                            let cells: BTreeSet<_> = self
                                .values
                                .keys()
                                .chain(self.expressions.keys())
                                .copied()
                                .filter(|&(s, row, col)| {
                                    s == a.0
                                        && (r..=a.1.max(b.1)).contains(&row)
                                        && (c..=a.2.max(b.2)).contains(&col)
                                })
                                .collect();
                            let mut end = height.checked_mul(width)?;
                            for coord in cells.into_iter().rev() {
                                let index = (coord.1 - r) as u64 * width + (coord.2 - c) as u64;
                                if needed[0] && end > index + 1 {
                                    pending.push((Value::Blank, end - index - 1));
                                }
                                pending.push((Value::Single(coord), 1));
                                end = index;
                            }
                            if needed[0] && end > 0 {
                                pending.push((Value::Blank, end));
                            }
                        }
                        Value::Matrix(rows) => {
                            for row in rows.into_iter().rev() {
                                self.work = self.work.checked_sub(
                                    row.len().checked_mul(std::mem::size_of::<(Value, u64)>())?,
                                )?;
                                pending.extend(row.into_iter().rev().map(|v| (v, 1)));
                            }
                        }
                        Value::Set(values) => {
                            self.work = self.work.checked_sub(
                                values
                                    .len()
                                    .checked_mul(std::mem::size_of::<(Value, u64)>())?,
                            )?;
                            pending.extend(values.into_iter().rev().map(|v| (v, 1)));
                        }
                        Value::Blank | Value::Empty | Value::Omitted => {
                            if needed[0] {
                                joined[0].empty(count, &delimiters, &mut self.work)?;
                            }
                        }
                        Value::Error(e) | Value::LiteralError(e) => {
                            failure = Some(e);
                            break 'arguments;
                        }
                        Value::InvalidReference | Value::InvalidRange(..) => {
                            failure = Some("#REF!");
                            break 'arguments;
                        }
                        Value::Lambda(_) => {
                            failure = Some("#CALC!");
                            break 'arguments;
                        }
                        value => {
                            let text = strings::string(&value);
                            for (index, result) in joined.iter_mut().enumerate() {
                                if needed[index] && (index == 0 || !text.is_empty()) {
                                    result.push(&text, &delimiters, &mut self.work)?;
                                }
                            }
                        }
                    }
                }
            }
        }
        for flag in flags.iter_mut().flatten() {
            if let Some(e) = delimiter_error {
                *flag = Value::Error(e);
            } else if let Value::Bool(b) = flag {
                let result = &joined[usize::from(*b)];
                *flag = if let Some(e) = failure.or(result.error) {
                    Value::Error(e)
                } else {
                    self.work = self.work.checked_sub(result.output.len())?;
                    Value::Text(result.output.clone())
                };
            }
        }
        Some(if flags.len() == 1 && flags[0].len() == 1 {
            flags.pop()?.pop()?
        } else {
            Value::Matrix(flags)
        })
    }
}

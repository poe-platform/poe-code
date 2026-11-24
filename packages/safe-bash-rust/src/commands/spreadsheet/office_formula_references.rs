use super::super::case_fold::{same_name, sheet_key};
use super::{Calculation, Coord, Expr, Parser, Value};

#[derive(Clone, Copy, PartialEq)]
pub(super) struct Axis {
    value: i64,
    relative: bool,
}
#[derive(Clone, Copy, PartialEq)]
pub(in crate::commands::spreadsheet) struct Reference {
    pub(super) sheet: Axis,
    // Excel imports unknown sheet tokens as names; Calc keeps single references.
    pub(super) unknown_name: bool,
    wrap: bool,
    row: Axis,
    column: Axis,
}
impl Reference {
    pub(super) fn table_a1(self, row: usize, sheet: Option<&str>) -> String {
        let mut result = sheet
            .map(|name| format!("{}!", super::super::sheet_name::quote_sheet(name)))
            .unwrap_or_default();
        result.push('$');
        result.push_str(&crate::commands::structured::xlsx_idx_to_col_ref(
            self.column.value as usize,
        ));
        if !self.row.relative {
            result.push('$');
        }
        result.push_str(
            &(self.row.value + if self.row.relative { row as i64 } else { 0 } + 1).to_string(),
        );
        result
    }

    pub(super) fn table(sheet: usize, row: usize, column: usize, relative_row: bool) -> Self {
        Self {
            sheet: Axis {
                value: sheet as i64,
                relative: false,
            },
            row: Axis {
                value: row as i64,
                relative: relative_row,
            },
            column: Axis {
                value: column as i64,
                relative: false,
            },
            unknown_name: false,
            wrap: false,
        }
    }
}
impl<'a, S> Parser<'a, S>
where
    S: Iterator<Item = &'a str> + Clone,
{
    pub(super) fn xlsx_reference(&mut self) -> Option<Expr> {
        let token = super::super::xlsx_references::parse(self.source, self.sheets.clone())?;
        if token.unknown && self.source[token.end..].trim_ascii_start().starts_with('(') {
            return None;
        }
        if self.source.starts_with('\'') && self.source[token.end..].trim_ascii_end() == ":" {
            self.error.get_or_insert("Err:501");
        }
        self.source = &self.source[token.end..];
        if self.editor && token.missing_sheet {
            return Some(Expr::Value(Value::Error("#REF!")));
        }
        if token.unknown {
            return Some(Expr::Value(Value::Error("#NAME?")));
        }
        let reference = |address: super::super::xlsx_references::Address| Reference {
            sheet: Axis {
                value: address.sheet.map_or(0, |s| {
                    s as i64
                        - if address.relative_sheet {
                            self.position.0 as i64
                        } else {
                            0
                        }
                }),
                relative: address.relative_sheet,
            },
            row: Axis {
                value: address.row.0 as i64 - if address.row.1 { 0 } else { self.position.1 },
                relative: !address.row.1,
            },
            column: Axis {
                value: address.column.0 as i64
                    - if address.column.1 || address.column.0 == 16_384 {
                        0
                    } else {
                        self.position.2
                    },
                relative: !address.column.1 && address.column.0 != 16_384,
            },
            unknown_name: false,
            wrap: false,
        };
        let first = reference(token.first);
        Some(if token.range {
            Expr::Range(first, reference(token.last))
        } else {
            Expr::Ref(first)
        })
    }

    fn sheet(&self, name: &str) -> Option<usize> {
        let name = name.strip_prefix('$').unwrap_or(name);
        let unquoted = name
            .strip_prefix('\'')
            .and_then(|s| s.strip_suffix('\''))
            .map(|s| s.replace("''", "'"));
        let key = sheet_key(unquoted.as_deref().unwrap_or(name));
        self.sheets.clone().position(|s| sheet_key(s) == key)
    }
    pub(super) fn reference(&self, sheet: Option<&str>, cell: &str) -> Option<Reference> {
        let (row, column) = if self.r1c1 {
            let (row, column) = r1c1(cell, self.position)?;
            (
                row.unwrap_or(Axis {
                    value: 0,
                    relative: false,
                }),
                column.unwrap_or(Axis {
                    value: 0,
                    relative: false,
                }),
            )
        } else {
            let column_relative = !cell.starts_with('$');
            let cell = cell.strip_prefix('$').unwrap_or(cell);
            let count = cell.bytes().take_while(u8::is_ascii_alphabetic).count();
            if count == 0 {
                return None;
            }
            let column = cell[..count].bytes().try_fold(0i64, |n, b| {
                n.checked_mul(26)?
                    .checked_add(i64::from(b.to_ascii_uppercase() - b'A' + 1))
            })? - 1;
            let row_relative = !cell[count..].starts_with('$');
            let row = cell[count..].strip_prefix('$').unwrap_or(&cell[count..]);
            if row.is_empty() || !row.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let row = row.parse::<i64>().ok()? - 1;
            if !(0..1_048_576).contains(&row) || !(0..16384).contains(&column) {
                return None;
            }
            (
                Axis {
                    value: row - if row_relative { self.position.1 } else { 0 },
                    relative: row_relative,
                },
                Axis {
                    value: column - if column_relative { self.position.2 } else { 0 },
                    relative: column_relative,
                },
            )
        };
        let sheet = match sheet.filter(|s| !s.is_empty()) {
            None => Axis {
                value: 0,
                relative: true,
            },
            Some(raw) => {
                let relative = self.odf && !raw.starts_with('$');
                match self.sheet(raw) {
                    Some(index) => Axis {
                        value: index as i64 - if relative { self.position.0 as i64 } else { 0 },
                        relative,
                    },
                    None => Axis {
                        value: -1,
                        relative: false,
                    },
                }
            }
        };
        Some(Reference {
            unknown_name: !self.editor && !self.odf && !sheet.relative && sheet.value < 0,
            wrap: !self.xlsx,
            sheet,
            row,
            column,
        })
    }
    pub(super) fn reference_or_name(&mut self, sheet: Option<&str>, name: &str) -> Expr {
        if sheet.is_none()
            && let Some(index) = self.bindings.and_then(|bindings| bindings.get(name))
        {
            let index = *index;
            if let Some(tokens) = &mut self.name_tokens {
                tokens.push((self.source.len() + name.len(), name.len(), index));
            }
            return index.map_or(Expr::Value(Value::Error("#NAME?")), Expr::Name);
        }
        if sheet != Some("[0]") && let Some(reference) = self.reference(sheet, name) {
            if self.r1c1 {
                let sizes = self.sizes;
                let (row, column) = r1c1(name, self.position).unwrap();
                if row.is_none() || column.is_none() {
                    let index = reference.sheet.value
                        + if reference.sheet.relative {
                            self.position.0 as i64
                        } else {
                            0
                        };
                    let Some(&(height, width)) =
                        usize::try_from(index).ok().and_then(|i| sizes.get(i))
                    else {
                        return Expr::Value(Value::Error("#REF!"));
                    };
                    let mut last = reference;
                    if row.is_none() {
                        last.row = Axis {
                            value: height as i64 - 1,
                            relative: false,
                        };
                    }
                    if column.is_none() {
                        last.column = Axis {
                            value: width as i64 - 1,
                            relative: false,
                        };
                    }
                    return Expr::Range(reference, last);
                }
            }
            return Expr::Ref(reference);
        }
        if sheet.is_none() && matches!(name.to_ascii_uppercase().as_str(), "TRUE" | "FALSE") {
            return Expr::Value(Value::Bool(name.eq_ignore_ascii_case("TRUE")));
        }
        let scope = match sheet {
            None => self.scope.or_else(|| self.xlsx.then_some(self.position.0)),
            Some("[0]") => None,
            Some(name) => match self.sheet(name) {
                Some(index) => Some(index),
                None => return Expr::Value(Value::Error("#NAME?")),
            },
        };
        let index = self
            .names
            .iter()
            .position(|n| same_name(&n.name, name) && n.sheet == scope)
            .or_else(|| {
                (!self.xlsx || sheet.is_none())
                    .then(|| {
                        self.names
                            .iter()
                            .position(|n| same_name(&n.name, name) && n.sheet.is_none())
                    })
                    .flatten()
            });
        if let (Some(tokens), Some(index)) = (&mut self.name_tokens, index) {
            tokens.push((self.source.len() + name.len(), name.len(), Some(index)));
        }
        index.map_or(Expr::Value(Value::Error("#NAME?")), Expr::Name)
    }
    pub(super) fn sheet_span(&mut self, first_sheet: &str) -> Option<Expr> {
        let source = self.source;
        let result = (|| {
            self.source = self.source.strip_prefix(':')?;
            if self.source.chars().next().is_some_and(char::is_whitespace) {
                return None;
            }
            let last_sheet = if self.source.trim_start().starts_with('\'') {
                self.space();
                self.string('\'')?
            } else {
                self.word().to_owned()
            };
            if !self.take("!") {
                return None;
            }
            let cell = self.word();
            let first = self.reference(Some(first_sheet), cell)?;
            let last = if self.take(":") {
                let cell = self.word();
                self.reference(Some(&last_sheet), cell)?
            } else {
                self.reference(Some(&last_sheet), cell)?
            };
            Some(Expr::Range(first, last))
        })();
        if result.is_none() {
            self.source = source;
        }
        result
    }
    pub(super) fn bracket_reference(&mut self) -> Option<Expr> {
        self.source = self.source.strip_prefix('[')?;
        let mut quoted = false;
        let end = self.source.char_indices().find_map(|(i, c)| {
            if c == '\'' {
                quoted = !quoted;
            }
            (c == ']' && !quoted).then_some(i)
        })?;
        let raw = &self.source[..end];
        self.source = &self.source[end + 1..];
        let mut quoted = false;
        let split = raw.char_indices().find_map(|(i, c)| {
            if c == '\'' {
                quoted = !quoted;
            }
            (c == ':' && !quoted).then_some(i)
        });
        let (first, last) = split.map_or((raw, None), |i| (&raw[..i], Some(&raw[i + 1..])));
        let (sheet, cell) = first.rsplit_once('.').unwrap_or(("", first));
        let Some(first) = self.reference(Some(sheet), cell) else {
            return Some(Expr::Value(Value::Error("#NAME?")));
        };
        match last {
            None => Some(Expr::Ref(first)),
            Some(last) => {
                let (sheet, cell) = last.rsplit_once('.').unwrap_or(("", last));
                let Some(mut last) = self.reference(Some(sheet), cell) else {
                    return Some(Expr::Value(Value::Error("#NAME?")));
                };
                if sheet.is_empty() {
                    last.sheet = first.sheet;
                }
                if [first.sheet, last.sheet]
                    .iter()
                    .any(|s| !s.relative && s.value < 0)
                {
                    return Some(Expr::Value(Value::Error("#NAME?")));
                }
                Some(Expr::Range(first, last))
            }
        }
    }
}
impl Calculation<'_> {
    pub(super) fn intersection(&mut self, a: Value, b: Value, depth: usize) -> Option<Value> {
        self.tick(depth)?;
        match (a.into_range(), b.into_range()) {
            (Value::Error(e) | Value::LiteralError(e), _)
            | (_, Value::Error(e) | Value::LiteralError(e)) => Some(Value::Error(e)),
            (Value::Set(values), other) | (other, Value::Set(values)) => {
                let mut intersections = Vec::new();
                for value in values {
                    self.charge_value(&other)?;
                    let value = self.intersection(value, other.clone(), depth + 1)?;
                    match value {
                        Value::Error("#NULL!") => {}
                        Value::Error(_) | Value::LiteralError(_) => return Some(value),
                        value => {
                            self.work = self.work.checked_sub(std::mem::size_of::<Value>())?;
                            intersections.push(value);
                        }
                    }
                }
                Some(if intersections.is_empty() {
                    Value::Error("#NULL!")
                } else if intersections.len() == 1 {
                    intersections.pop()?
                } else {
                    Value::Set(intersections)
                })
            }
            (Value::Range(a, b), Value::Range(c, d)) => {
                let first = (
                    a.0.min(b.0).max(c.0.min(d.0)),
                    a.1.min(b.1).max(c.1.min(d.1)),
                    a.2.min(b.2).max(c.2.min(d.2)),
                );
                let last = (
                    a.0.max(b.0).min(c.0.max(d.0)),
                    a.1.max(b.1).min(c.1.max(d.1)),
                    a.2.max(b.2).min(c.2.max(d.2)),
                );
                Some(
                    if first.0 > last.0 || first.1 > last.1 || first.2 > last.2 {
                        Value::Error("#NULL!")
                    } else if first == last {
                        Value::Single(first)
                    } else {
                        Value::Range(first, last)
                    },
                )
            }
            _ => Some(Value::Error("Err:502")),
        }
    }

    pub(super) fn range_list(&mut self, value: Value, depth: usize) -> Option<Value> {
        let Value::Set(values) = value else {
            return Some(value);
        };
        let mut pending = values;
        let mut bounds = None::<(Coord, Coord)>;
        while let Some(value) = pending.pop() {
            self.tick(depth)?;
            match value.into_range() {
                Value::Set(values) => pending.extend(values),
                Value::Range(a, b) => {
                    let (first, last) = bounds.get_or_insert((a, b));
                    first.0 = first.0.min(a.0).min(b.0);
                    last.0 = last.0.max(a.0).max(b.0);
                    first.1 = first.1.min(a.1).min(b.1);
                    first.2 = first.2.min(a.2).min(b.2);
                    last.1 = last.1.max(a.1).max(b.1);
                    last.2 = last.2.max(a.2).max(b.2);
                }
                Value::InvalidReference | Value::InvalidRange(..) => {
                    return Some(Value::Error("#REF!"));
                }
                value @ (Value::Error(_) | Value::LiteralError(_)) => return Some(value),
                _ => return Some(Value::Error("#VALUE!")),
            }
        }
        Some(bounds.map_or(Value::Error("#VALUE!"), |(a, b)| Value::Range(a, b)))
    }

    pub(super) fn implicit_invalid_range(
        &mut self,
        mut expression: &Expr,
        value: Value,
        position: Coord,
    ) -> Option<Value> {
        let Value::InvalidRange(a, b) = value else {
            return Some(value);
        };
        if self.array {
            return Some(value);
        }
        while let Expr::Group(child) = expression {
            self.work = self.work.checked_sub(1)?;
            expression = child;
        }
        let Expr::Range(first, last) = expression else {
            return Some(value);
        };
        if !first.row.relative && !last.row.relative {
            return Some(value);
        }
        // Calc's compiler intersects the original -1 column before runtime
        // dereferencing would reset that axis to zero and raise #REF!.
        let column = |value| {
            if value == usize::MAX {
                -1
            } else {
                value as i64
            }
        };
        let columns = (column(a.2).min(column(b.2)), column(a.2).max(column(b.2)));
        Some(
            if a.0 == b.0 && a.1 == b.1 && (columns.0..=columns.1).contains(&(position.2 as i64)) {
                Value::Single((a.0, a.1, position.2))
            } else {
                value
            },
        )
    }

    pub(super) fn range(
        &self,
        a: &Reference,
        b: &Reference,
        position: Coord,
        named: Option<Coord>,
    ) -> Value {
        let compiled = named.filter(|_| !a.wrap && !b.wrap);
        let base = compiled.unwrap_or(position);
        let endpoint = |reference: &Reference| -> Option<Coord> {
            let sheet = reference.sheet.value
                + if reference.sheet.relative {
                    named.unwrap_or(base).0 as i64
                } else {
                    0
                };
            let sheet = if (reference.wrap || compiled.is_some()) && reference.sheet.relative {
                sheet.rem_euclid(self.sizes.len() as i64)
            } else {
                sheet
            };
            let sheet = usize::try_from(sheet).ok()?;
            let &(rows, columns) = self.sizes.get(sheet)?;
            let axis = |axis: Axis, origin: usize, maximum: usize| -> Option<usize> {
                let mut value = axis.value + if axis.relative { origin as i64 } else { 0 };
                if axis.relative {
                    if reference.wrap {
                        value = value.rem_euclid(maximum as i64);
                    } else if compiled.is_some() && !(0..maximum as i64).contains(&value) {
                        // toAbs marks an invalid axis as -1; MoveRelWrap then
                        // maps that sentinel to the last row/column.
                        value = maximum as i64 - 1;
                    }
                }
                (0..maximum as i64)
                    .contains(&value)
                    .then_some(value as usize)
            };
            Some((
                sheet,
                axis(reference.row, base.1, rows)?,
                if reference.column.value == 16_384 && !reference.column.relative {
                    usize::MAX
                } else {
                    axis(reference.column, base.2, columns)?
                },
            ))
        };
        let (Some(first), Some(last)) = (endpoint(a), endpoint(b)) else {
            return Value::Error("#REF!");
        };
        if first.2 == usize::MAX || last.2 == usize::MAX {
            return Value::InvalidRange(first, last);
        }
        if let Some(origin) = compiled {
            // MoveRelWrap orders the resolved range, retaining each token's
            // relative flags before a compiled formula is reused elsewhere.
            let start = (
                first.0.min(last.0),
                first.1.min(last.1),
                first.2.min(last.2),
            );
            let end = (
                first.0.max(last.0),
                first.1.max(last.1),
                first.2.max(last.2),
            );
            let shifted =
                |coord: Coord, reference: &Reference| -> Option<Coord> {
                    let row = coord.1 as i64
                        + if reference.row.relative {
                            position.1 as i64 - origin.1 as i64
                        } else {
                            0
                        };
                    let col = coord.2 as i64
                        + if reference.column.relative {
                            position.2 as i64 - origin.2 as i64
                        } else {
                            0
                        };
                    let &(rows, cols) = self.sizes.get(coord.0)?;
                    ((0..rows as i64).contains(&row) && (0..cols as i64).contains(&col))
                        .then_some((coord.0, row as usize, col as usize))
                };
            return match (shifted(start, a), shifted(end, b)) {
                (Some(a), Some(b)) => Value::Range(a, b),
                _ => Value::Error("#REF!"),
            };
        }
        Value::Range(first, last)
    }
}

fn r1c1(mut source: &str, position: (usize, i64, i64)) -> Option<(Option<Axis>, Option<Axis>)> {
    fn axis(source: &mut &str, marker: u8, origin: i64) -> Option<Option<Axis>> {
        if source.as_bytes().first().map(u8::to_ascii_uppercase) != Some(marker) {
            return Some(None);
        }
        *source = &source[1..];
        let relative = source.starts_with('[');
        let raw = if relative {
            *source = &source[1..];
            let end = source.find(']')?;
            let raw = &source[..end];
            *source = &source[end + 1..];
            raw
        } else {
            let end = source.bytes().take_while(u8::is_ascii_digit).count();
            let raw = &source[..end];
            *source = &source[end..];
            if raw.is_empty() {
                return Some(Some(Axis {
                    value: 0,
                    relative: true,
                }));
            }
            raw
        };
        let digits = raw.strip_prefix(['+', '-']).unwrap_or(raw);
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let Ok(number) = raw.parse::<i64>() else {
            return None;
        };
        if number.unsigned_abs() > 9007199254740991
            || relative && (number + origin).unsigned_abs() > 9007199254740991
        {
            return None;
        }
        if !relative && number < 1 {
            return None;
        }
        Some(Some(Axis {
            value: number - i64::from(!relative),
            relative,
        }))
    }
    let row = axis(&mut source, b'R', position.1)?;
    let column = axis(&mut source, b'C', position.2)?;
    (source.is_empty() && (row.is_some() || column.is_some())).then_some((row, column))
}

impl<'a, S> Parser<'a, S>
where
    S: Iterator<Item = &'a str> + Clone,
{
    pub(super) fn whole_axis_range(&mut self) -> Option<Expr> {
        if self.odf || self.r1c1 {
            return None;
        }
        let saved = self.source;
        let result = (|| {
            fn endpoint<'a, S>(parser: &mut Parser<'a, S>) -> Option<(Option<String>, String)>
            where
                S: Iterator<Item = &'a str> + Clone,
            {
                parser.space();
                let first = if parser.source.starts_with('\'') {
                    parser.string('\'')?
                } else {
                    parser.word().to_owned()
                };
                if parser.take("!") {
                    Some((Some(first), parser.word().to_owned()))
                } else {
                    Some((None, first))
                }
            }
            fn axis(raw: &str) -> Option<(bool, Axis)> {
                let relative = !raw.starts_with('$');
                let raw = raw.strip_prefix('$').unwrap_or(raw);
                if raw.is_empty() {
                    return None;
                }
                let row = raw.bytes().all(|b| b.is_ascii_digit());
                let value = if row {
                    raw.parse::<i64>().ok()?
                } else {
                    raw.bytes().try_fold(0i64, |n, b| {
                        if !b.is_ascii_alphabetic() {
                            return None;
                        }
                        n.checked_mul(26)?
                            .checked_add(i64::from(b.to_ascii_uppercase() - b'A' + 1))
                    })?
                };
                if value < 1 || value > if row { 1_048_576 } else { 16384 } {
                    return None;
                }
                Some((
                    row,
                    Axis {
                        value: value - 1,
                        relative,
                    },
                ))
            }
            let (first_sheet, first) = endpoint(self)?;
            self.source = self.source.strip_prefix(':')?;
            if self.source.chars().next().is_some_and(char::is_whitespace) {
                return None;
            }
            let (last_sheet, last) = endpoint(self)?;
            let (row, a) = axis(&first)?;
            let (last_row, b) = axis(&last)?;
            if row != last_row {
                return None;
            }
            let first = first_sheet
                .as_deref()
                .map_or(Some(self.position.0), |s| self.sheet(s));
            let last = last_sheet.as_deref().map_or(first, |s| self.sheet(s));
            let (Some(first), Some(last)) = (first, last) else {
                let external = first_sheet
                    .iter()
                    .chain(last_sheet.iter())
                    .any(|s| s.contains('['));
                return self.editor.then_some(Expr::Value(Value::Error(if external {
                    "#NAME?"
                } else {
                    "#REF!"
                })));
            };
            let reference = |sheet: usize, mut axis: Axis, end: bool| {
                if axis.relative {
                    axis.value -= if row {
                        self.position.1
                    } else {
                        self.position.2
                    };
                }
                let (height, width) = self
                    .sizes
                    .get(sheet)
                    .copied()
                    .unwrap_or((1_048_576, 16_384));
                let other = Axis {
                    value: if end {
                        if row { width } else { height }
                    } else {
                        1
                    } as i64
                        - 1,
                    relative: false,
                };
                Reference {
                    unknown_name: false,
                    wrap: !self.xlsx,
                    sheet: Axis {
                        value: sheet as i64,
                        relative: false,
                    },
                    row: if row { axis } else { other },
                    column: if row { other } else { axis },
                }
            };
            Some(Expr::Range(
                reference(first, a, false),
                reference(last, b, true),
            ))
        })();
        if result.is_none() {
            self.source = saved;
        }
        result
    }
}

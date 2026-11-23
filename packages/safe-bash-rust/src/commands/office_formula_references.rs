use super::super::case_fold::{same_name, sheet_key};
use super::{Calculation, Coord, Dialect, Expr, Parser, Value};

pub(in crate::commands) fn label_prefix(source: &str) -> Option<(&str, &str)> {
    let range = source.starts_with("@range");
    let mut tail = source
        .strip_prefix("@column")
        .or_else(|| source.strip_prefix("@row"))
        .or_else(|| source.strip_prefix("@range"))?;
    if let Some(rest) = tail.strip_prefix(".value") {
        tail = rest;
    } else if range {
        tail = tail.strip_prefix(".array").unwrap_or(tail);
    }
    tail = tail
        .strip_prefix(if range { ".multi" } else { ".odf" })
        .unwrap_or(tail);
    tail = tail.strip_prefix(".quoted").unwrap_or(tail);
    let rest = tail.strip_prefix(':')?;
    Some((&source[..source.len() - tail.len()], rest))
}

#[derive(Clone, PartialEq)]
pub(in crate::commands::archive::office) struct RadicalLabel {
    pub(super) anchors: Vec<Reference>,
    pub(super) data: Option<(Reference, Reference)>,
    pub(super) multiple: bool,
    pub(super) scalar: bool,
}

#[derive(Clone, Copy, PartialEq)]
pub(super) struct Axis {
    value: i64,
    relative: bool,
}
#[derive(Clone, Copy, PartialEq)]
pub(in crate::commands::archive::office) struct Reference {
    pub(super) sheet: Axis,
    // Excel imports unknown sheet tokens as names; Calc keeps single references.
    pub(super) unknown_name: bool,
    wrap: bool,
    whole_axis: Option<bool>,
    collapse_range: bool,
    row: Axis,
    column: Axis,
}
impl Reference {
    pub(super) fn relocate(
        &mut self,
        position: (usize, i64, i64),
        relocation: &super::live_names::Relocation,
        sheets: &[String],
    ) -> bool {
        let origin = self.sheet.value
            + if self.sheet.relative {
                position.0 as i64
            } else {
                0
            };
        let Some(target) = usize::try_from(origin)
            .ok()
            .and_then(|i| relocation.target(i, sheets))
        else {
            return false;
        };
        self.sheet = Axis {
            value: target as i64,
            relative: false,
        };
        for (axis, anchor, offset, whole) in [
            (
                &mut self.row,
                position.1,
                relocation.row,
                self.whole_axis == Some(false),
            ),
            (
                &mut self.column,
                position.2,
                relocation.column,
                self.whole_axis == Some(true),
            ),
        ] {
            if whole {
                continue;
            }
            axis.value += if axis.relative { anchor } else { 0 };
            axis.value += offset;
            axis.relative = false;
        }
        self.wrap = false;
        true
    }

    pub(super) fn label_anchor(
        self,
        position: Coord,
        named: Option<Coord>,
        sizes: &[(usize, usize)],
    ) -> Option<Coord> {
        let sheet = usize::try_from(
            self.sheet.value
                + if self.sheet.relative {
                    named.unwrap_or(position).0 as i64
                } else {
                    0
                },
        )
        .ok()?;
        let row = usize::try_from(
            self.row.value
                + if self.row.relative {
                    position.1 as i64
                } else {
                    0
                },
        )
        .ok()?;
        let column = usize::try_from(
            self.column.value
                + if self.column.relative {
                    position.2 as i64
                } else {
                    0
                },
        )
        .ok()?;
        let size = sizes.get(sheet)?;
        (row < size.0 && column < size.1).then_some((sheet, row, column))
    }
    pub(super) fn public_singleton(self, last: Self) -> bool {
        self.collapse_range
            && last.collapse_range
            && self.sheet == last.sheet
            && self.row == last.row
            && self.column == last.column
    }
}
fn axis(raw: &str, xlsx: bool) -> Option<(bool, Axis)> {
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
    if value < 1
        || value
            > if xlsx {
                if row { 1_048_576 } else { 16384 }
            } else {
                9_007_199_254_740_991
            }
    {
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
impl<'a, S> Parser<'a, S>
where
    S: Iterator<Item = &'a str> + Clone,
{
    pub(super) fn radical_data(&mut self, depth: usize) -> Option<(Reference, Reference)> {
        match self.expression(12, depth, true)? {
            Expr::Range(first, last) => Some((first, last)),
            Expr::Ref(first) => {
                if !self.take(":") {
                    return Some((first, first));
                }
                let Expr::Ref(mut last) = self.expression(12, depth, true)? else {
                    return None;
                };
                if !self.odf && last.sheet.relative {
                    last.sheet = first.sheet;
                }
                Some((first, last))
            }
            _ => None,
        }
    }

    pub(super) fn xlsx_reference(&mut self) -> Option<Expr> {
        let token = super::super::xlsx_references::parse(self.source, self.sheets.clone())?;
        if token.unknown && self.source[token.end..].trim_ascii_start().starts_with('(') {
            return None;
        }
        if self.source.starts_with('\'') && self.source[token.end..].trim_ascii_end() == ":" {
            self.error.get_or_insert("Err:501");
        }
        self.source = &self.source[token.end..];
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
            whole_axis: None,
            collapse_range: false,
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
        let name = unquoted.as_deref().unwrap_or(name);
        if name.starts_with('[') || name.contains(':') {
            return None;
        }
        let key = sheet_key(name);
        self.sheets.clone().position(|s| sheet_key(s) == key)
    }
    pub(super) fn reference(&self, sheet: Option<&str>, cell: &str) -> Option<Reference> {
        let collapse_range = self.odf && sheet.is_none_or(|s| s.is_empty() || s.starts_with('$'));
        let (row, column) = if self.r1c1 {
            let (row, column) = r1c1(cell, self.position, self.csv)?;
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
            let (rows, columns) = if self.xlsx {
                (1_048_576, 16_384)
            } else {
                (9_007_199_254_740_991, 9_007_199_254_740_991)
            };
            if !(0..rows).contains(&row) || !(0..columns).contains(&column) {
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
            unknown_name: self.dialect == Dialect::LibreOffice
                && !self.odf
                && !self.csv
                && !sheet.relative
                && sheet.value < 0,
            wrap: !self.xlsx,
            whole_axis: None,
            collapse_range,
            sheet,
            row,
            column,
        })
    }
    pub(super) fn reference_or_name(&self, sheet: Option<&str>, name: &str) -> Expr {
        if sheet.is_none()
            && let Some(index) = self.bindings.and_then(|bindings| bindings.get(name))
        {
            return index.map_or(Expr::Value(Value::Error("#NAME?")), Expr::Name);
        }
        if let Some(reference) = self.reference(sheet, name) {
            if self.r1c1 {
                let sizes = self.sizes;
                let (row, column) = r1c1(name, self.position, self.csv).unwrap();
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
            Some(name) => match self.sheet(name) {
                Some(index) => Some(index),
                None => return Expr::Value(Value::Error("#NAME?")),
            },
        };
        let index = self
            .names
            .iter()
            .position(|n| {
                (if self.dialect == super::Dialect::Gnumeric {
                    n.name == name
                } else {
                    same_name(&n.name, name)
                }) && n.sheet == scope
            })
            .or_else(|| {
                (!self.xlsx || sheet.is_none())
                    .then(|| {
                        self.names.iter().position(|n| {
                            (if self.dialect == super::Dialect::Gnumeric {
                                n.name == name
                            } else {
                                same_name(&n.name, name)
                            }) && n.sheet.is_none()
                        })
                    })
                    .flatten()
            });
        index.map_or(Expr::Value(Value::Error("#NAME?")), Expr::Name)
    }
    pub(super) fn sheet_span(&mut self, first_sheet: &str) -> Option<Expr> {
        let source = self.source;
        let result = (|| {
            if self.csv
                && let Some((first, last)) = first_sheet
                    .strip_prefix('\'')
                    .and_then(|s| s.strip_suffix('\''))
                    .and_then(|s| s.split_once(':'))
                && self.take("!")
            {
                let cell = self.word();
                let first = self.reference(Some(&format!("'{first}'")), cell)?;
                let cell = if self.take(":") { self.word() } else { cell };
                let last = self.reference(Some(&format!("'{last}'")), cell)?;
                return Some(Expr::Range(first, last));
            }
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
        let external = if self.dialect == super::Dialect::Gnumeric && raw.starts_with('\'') {
            raw.char_indices().find_map(|(i, c)| {
                if c == '\'' {
                    quoted = !quoted;
                }
                (c == '#' && !quoted).then(|| (&raw[..i], &raw[i + 1..]))
            })
        } else {
            None
        };
        let raw = external.map_or(raw, |(_, tail)| tail);
        let mut quoted = false;
        let split = raw.char_indices().find_map(|(i, c)| {
            if c == '\'' {
                quoted = !quoted;
            }
            (c == ':' && !quoted).then_some(i)
        });
        let (first, last) = split.map_or((raw, None), |i| (&raw[..i], Some(&raw[i + 1..])));
        let (sheet, cell) = if self.dialect == super::Dialect::Gnumeric {
            let mut quoted = false;
            first.char_indices().find_map(|(i, c)| {
                if c == '\'' {
                    quoted = !quoted;
                }
                (c == '.' && !quoted).then(|| (&first[..i], &first[i + 1..]))
            })
        } else {
            first.rsplit_once('.')
        }
        .unwrap_or(("", first));
        let raw_sheet = sheet.strip_prefix('$').unwrap_or(sheet);
        let raw_sheet = raw_sheet
            .strip_prefix('\'')
            .and_then(|s| s.strip_suffix('\''))
            .map_or_else(|| raw_sheet.to_owned(), |s| s.replace("''", "'"));
        if let Some((book, _)) = external {
            return Some(Expr::Value(Value::Error(
                if book == "''" && raw_sheet.is_empty() {
                    "#NAME?"
                } else {
                    "#REF!"
                },
            )));
        }
        if let Some((book, sheet)) = raw_sheet.strip_prefix('[').and_then(|s| s.split_once(']')) {
            return Some(Expr::Value(Value::Error(
                if book.is_empty() && sheet.is_empty() {
                    "#NAME?"
                } else {
                    "#REF!"
                },
            )));
        }
        if let Some((start, end)) = raw_sheet.split_once(':') {
            let qualifier = |name: &str| {
                format!(
                    "{}'{}'",
                    if sheet.starts_with('$') { "$" } else { "" },
                    name.replace('\'', "''")
                )
            };
            let first = self.reference(Some(&qualifier(start)), cell)?;
            let last_cell = last.map_or(cell, |s| s.rsplit_once('.').map_or(s, |(_, cell)| cell));
            let last = self.reference(Some(&qualifier(end)), last_cell)?;
            return Some(Expr::Range(first, last));
        }
        if let Some(last) = last
            && let Some((row, a)) = axis(cell, self.xlsx)
        {
            let (last_sheet, last_cell) = last.rsplit_once('.').unwrap_or(("", last));
            if let Some((last_row, b)) = axis(last_cell, self.xlsx)
                && row == last_row
            {
                let first = self.reference(Some(sheet), "A1")?.sheet;
                let last = if last_sheet.is_empty() {
                    first
                } else {
                    self.reference(Some(last_sheet), "A1")?.sheet
                };
                return Some(Expr::Range(
                    self.axis_reference(first, row, a, false),
                    self.axis_reference(last, row, b, true),
                ));
            }
        }
        let Some(first) = self.reference(Some(sheet), cell) else {
            if self.dialect == super::Dialect::Gnumeric && last.is_none() {
                return Some(self.reference_or_name((!sheet.is_empty()).then_some(sheet), cell));
            }
            return Some(Expr::Value(Value::Error("#NAME?")));
        };
        match last {
            None => Some(Expr::Ref(first)),
            Some(last) => {
                let (sheet, cell) = last.rsplit_once('.').unwrap_or(("", last));
                let last_reference = self.reference(Some(sheet), cell).or_else(|| {
                    if self.dialect != super::Dialect::Gnumeric {
                        return None;
                    }
                    let (row, axis) = axis(cell, false)?;
                    let sheet = self.reference(Some(sheet), "A1")?.sheet;
                    Some(self.axis_reference(sheet, row, axis, true))
                });
                let Some(mut last) = last_reference else {
                    return Some(Expr::Value(Value::Error("#NAME?")));
                };
                if sheet.is_empty() {
                    last.sheet = first.sheet;
                }
                if self.dialect != super::Dialect::Gnumeric
                    && [first.sheet, last.sheet]
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
    pub(super) fn radical_range(
        &self,
        label: &RadicalLabel,
        position: Coord,
        named: Option<Coord>,
        work: &mut usize,
    ) -> Option<Value> {
        let invalid = Value::Error("#REF!");
        let Some(anchor) = label
            .anchors
            .last()
            .and_then(|a| a.label_anchor(position, named, &self.sizes))
        else {
            return Some(invalid);
        };
        for reference in &label.anchors {
            *work = work.checked_sub(1)?;
            if !reference
                .label_anchor(position, named, &self.sizes)
                .is_some_and(|c| c.0 == anchor.0)
            {
                return Some(invalid);
            }
        }
        let Some((first, last)) = label.data else {
            return Some(invalid);
        };
        let (Some(first), Some(last)) = (
            first.label_anchor(position, named, &self.sizes),
            last.label_anchor(position, named, &self.sizes),
        ) else {
            return Some(invalid);
        };
        if first.0 != anchor.0 || last.0 != anchor.0 {
            return Some(invalid);
        }
        let mut low = (first.0, first.1.min(last.1), first.2.min(last.2));
        let mut high = (first.0, first.1.max(last.1), first.2.max(last.2));
        let row = low.1 == high.1
            && anchor.1 == low.1
            && (anchor.2.checked_add(1) == Some(low.2) || high.2.checked_add(1) == Some(anchor.2));
        let column = low.2 == high.2
            && anchor.2 == low.2
            && (anchor.1.checked_add(1) == Some(low.1) || high.1.checked_add(1) == Some(anchor.1));
        if row == column || label.multiple && !column {
            return Some(invalid);
        }
        if label.scalar {
            if row {
                if !(low.2..=high.2).contains(&position.2) {
                    return Some(invalid);
                }
                low.2 = position.2;
                high.2 = position.2;
            } else {
                if !(low.1..=high.1).contains(&position.1) {
                    return Some(invalid);
                }
                low.1 = position.1;
                high.1 = position.1;
            }
        }
        Some(Value::Range(low, high))
    }

    pub(super) fn label_range(
        &self,
        anchor: &Reference,
        column: bool,
        openformula: bool,
        position: Coord,
        named: Option<Coord>,
        work: &mut usize,
    ) -> Option<Value> {
        let Some((sheet, row, col)) = anchor.label_anchor(position, named, &self.sizes) else {
            return Some(Value::Error("#REF!"));
        };
        let declared = self
            .book
            .label_ranges
            .get(sheet)
            .into_iter()
            .flatten()
            .find(|pair| {
                pair.column == column
                    && (pair.labels[0]..=pair.labels[2]).contains(&row)
                    && (pair.labels[1]..=pair.labels[3]).contains(&col)
            });
        let own = if column { position.1 } else { position.2 };
        let same = sheet == position.0
            && if column {
                col == position.2
            } else {
                row == position.1
            };
        let (data_sheet, start, end, scalar) = if let Some(pair) = declared {
            let size = self.sizes[pair.data_sheet];
            if if column { col >= size.1 } else { row >= size.0 } {
                return Some(Value::Error("#REF!"));
            }
            let (start, end) = if column {
                (pair.data[0], pair.data[2])
            } else {
                (pair.data[1], pair.data[3])
            };
            (pair.data_sheet, start, end, (start..=end).contains(&own))
        } else {
            if !self.book.automatic_label_lookup {
                return Some(Value::Error("#NAME?"));
            }
            let value = self
                .results
                .get(&(sheet, row, col))
                .or_else(|| self.values.get(&(sheet, row, col)));
            if !matches!(
                value,
                None | Some(Value::Blank | Value::Text(_) | Value::UninternedText(_))
            ) {
                return Some(Value::Error("#NAME?"));
            }
            let maximum = if column {
                self.sizes[sheet].0
            } else {
                self.sizes[sheet].1
            } - 1;
            let first = if column { row } else { col } + 1;
            let mut start = first;
            if same && own == start {
                start += 1;
            }
            if start > maximum {
                return Some(Value::Error("#REF!"));
            }
            let limit = if same && own > start {
                maximum.min(own - 1)
            } else {
                maximum
            };
            if openformula {
                let occupied = |axis| {
                    let coord = if column {
                        (sheet, axis, col)
                    } else {
                        (sheet, row, axis)
                    };
                    coord != position
                        && (self.formula_sources.contains_key(&coord)
                            || self.expressions.contains_key(&coord)
                            || self
                                .values
                                .get(&coord)
                                .is_some_and(|v| !matches!(v, Value::Blank)))
                };
                if !occupied(start) && start < limit && occupied(start + 1) {
                    start += 1;
                }
                let mut end = start;
                if occupied(start) {
                    while end < limit && occupied(end + 1) {
                        end += 1;
                    }
                }
                (sheet, start, end, !same && (first..=maximum).contains(&own))
            } else {
                let mut end = limit;
                // Calc applies all declared data intervals, including remote sheets.
                for pair in self.book.label_ranges.iter().flatten() {
                    *work = work.checked_sub(1)?;
                    if pair.column != column {
                        continue;
                    }
                    let (aligned, next) = if column {
                        ((pair.data[1]..=pair.data[3]).contains(&col), pair.data[0])
                    } else {
                        ((pair.data[0]..=pair.data[2]).contains(&row), pair.data[1])
                    };
                    if aligned && start < next && next <= end {
                        end = next - 1;
                    }
                }
                if start > end {
                    return Some(Value::Error("#REF!"));
                }
                let scalar = (start..=end).contains(&own);
                if start != end {
                    // GetDataArea expands horizontal edges before vertical edges.
                    // Index both axes so each perimeter check avoids a full scan.
                    let mut rows = std::collections::BTreeSet::new();
                    let mut columns = std::collections::BTreeSet::new();
                    for &coord @ (owner, r, c) in self
                        .values
                        .keys()
                        .chain(self.formula_sources.keys())
                        .chain(self.expressions.keys())
                    {
                        *work = work.checked_sub(1)?;
                        if owner != sheet
                            || !self.formula_sources.contains_key(&coord)
                                && !self.expressions.contains_key(&coord)
                                && self
                                    .values
                                    .get(&coord)
                                    .is_none_or(|v| matches!(v, Value::Blank))
                        {
                            continue;
                        }
                        if rows.insert((r, c)) {
                            *work = work.checked_sub(64)?;
                            columns.insert((c, r));
                        }
                    }
                    let mut occupied = |index: &std::collections::BTreeSet<(usize, usize)>,
                                        axis: Option<usize>,
                                        low: usize,
                                        high: usize| {
                        *work = work.checked_sub(1)?;
                        Some(axis.is_some_and(|axis| {
                            index.range((axis, low)..=(axis, high)).next().is_some()
                        }))
                    };
                    let (mut left, mut top) = if column { (col, start) } else { (start, row) };
                    let (mut right, mut bottom) = (left, top);
                    loop {
                        let extend_left = occupied(
                            &columns,
                            left.checked_sub(1),
                            top.saturating_sub(1),
                            bottom + 1,
                        )?;
                        let extend_right = occupied(
                            &columns,
                            right.checked_add(1),
                            top.saturating_sub(1),
                            bottom + 1,
                        )?;
                        if extend_left {
                            left -= 1;
                        }
                        if extend_right {
                            right += 1;
                        }
                        let extend_top = occupied(&rows, top.checked_sub(1), left, right)?;
                        let extend_bottom = occupied(&rows, bottom.checked_add(1), left, right)?;
                        if extend_top {
                            top -= 1;
                        }
                        if extend_bottom {
                            bottom += 1;
                        }
                        if !extend_left && !extend_right && !extend_top && !extend_bottom {
                            break;
                        }
                    }
                    end = end.min(if column { bottom } else { right });
                }
                (sheet, start, end, scalar)
            }
        };
        let first = if column {
            (data_sheet, start, col)
        } else {
            (data_sheet, row, start)
        };
        let last = if column {
            (data_sheet, end, col)
        } else {
            (data_sheet, row, end)
        };
        let scalar = scalar.then_some(if column {
            (data_sheet, own, col)
        } else {
            (data_sheet, row, own)
        });
        Some(Value::LabelRange(first, last, scalar))
    }

    pub(super) fn intersection(&mut self, a: Value, b: Value, depth: usize) -> Option<Value> {
        self.tick(depth)?;
        match (a.into_range(), b.into_range()) {
            (Value::Error(e) | Value::LiteralError(e), _)
            | (_, Value::Error(e) | Value::LiteralError(e))
                if self.dialect != super::Dialect::Gnumeric =>
            {
                Some(Value::Error(e))
            }
            (Value::Set(values), other) | (other, Value::Set(values))
                if self.dialect != super::Dialect::Gnumeric =>
            {
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
                if self.dialect == super::Dialect::Gnumeric
                    && (a.0 != b.0 || a.0 != c.0 || a.0 != d.0)
                {
                    return Some(Value::Error("#VALUE!"));
                }
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
            _ => Some(Value::Error(if self.dialect == super::Dialect::Gnumeric {
                "#VALUE!"
            } else {
                "Err:502"
            })),
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
                Value::Range(a, b) | Value::LabelRange(a, b, _) => {
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
            let sheet = if self.dialect != crate::commands::structured::xlsx::Dialect::Gnumeric
                && (reference.wrap || compiled.is_some())
                && reference.sheet.relative
            {
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

fn r1c1(
    mut source: &str,
    position: (usize, i64, i64),
    gnumeric: bool,
) -> Option<(Option<Axis>, Option<Axis>)> {
    fn axis(source: &mut &str, marker: u8, origin: i64, gnumeric: bool) -> Option<Option<Axis>> {
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
            return gnumeric.then_some(None);
        };
        if number.unsigned_abs() > 9007199254740991
            || relative && (number + origin).unsigned_abs() > 9007199254740991
        {
            return gnumeric.then_some(None);
        }
        if !relative && number < 1 {
            return gnumeric.then_some(None);
        }
        Some(Some(Axis {
            value: number - i64::from(!relative),
            relative,
        }))
    }
    let row = axis(&mut source, b'R', position.1, gnumeric)?;
    let column = axis(&mut source, b'C', position.2, gnumeric)?;
    (source.is_empty() && (row.is_some() || column.is_some())).then_some((row, column))
}

impl<'a, S> Parser<'a, S>
where
    S: Iterator<Item = &'a str> + Clone,
{
    fn axis_reference(&self, sheet: Axis, row: bool, mut axis: Axis, end: bool) -> Reference {
        if axis.relative {
            axis.value -= if row {
                self.position.1
            } else {
                self.position.2
            };
        }
        let index = sheet.value
            + if sheet.relative {
                self.position.0 as i64
            } else {
                0
            };
        let (height, width) = usize::try_from(index)
            .ok()
            .and_then(|i| self.sizes.get(i))
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
            whole_axis: (self.dialect == Dialect::Gnumeric).then_some(row),
            collapse_range: false,
            sheet,
            row: if row { axis } else { other },
            column: if row { other } else { axis },
        }
    }

    pub(super) fn whole_axis_range(&mut self) -> Option<Expr> {
        if self.odf || self.r1c1 && !self.csv {
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
            let (first_sheet, first) = endpoint(self)?;
            self.source = self.source.strip_prefix(':')?;
            if self.source.chars().next().is_some_and(char::is_whitespace) {
                return None;
            }
            let (last_sheet, last) = endpoint(self)?;
            if self.r1c1 {
                let first = match self.reference_or_name(first_sheet.as_deref(), &first) {
                    Expr::Ref(first) | Expr::Range(first, _) => first,
                    _ => return None,
                };
                let last = match self
                    .reference_or_name(last_sheet.as_deref().or(first_sheet.as_deref()), &last)
                {
                    Expr::Ref(last) | Expr::Range(_, last) => last,
                    _ => return None,
                };
                return Some(Expr::Range(first, last));
            }
            let (row, a) = axis(&first, self.xlsx)?;
            let (last_row, b) = axis(&last, self.xlsx)?;
            if row != last_row {
                return None;
            }
            let first = first_sheet
                .as_deref()
                .map_or(Some(self.position.0), |s| self.sheet(s))?;
            let last = last_sheet
                .as_deref()
                .map_or(Some(first), |s| self.sheet(s))?;
            let reference = |sheet: usize, axis: Axis, end: bool| {
                self.axis_reference(
                    Axis {
                        value: sheet as i64,
                        relative: false,
                    },
                    row,
                    axis,
                    end,
                )
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

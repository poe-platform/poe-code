use super::{
    Spreadsheet, formula_arguments::Syntax, formulas, model, xlsx_import, xlsx_references,
};

#[derive(Clone, Copy)]
pub(super) struct AxisEdit {
    pub sheet: usize,
    pub columns: bool,
    pub start: usize,
    pub delta: i32,
}

impl AxisEdit {
    pub fn maximum(self) -> usize {
        if self.columns { 16_384 } else { 1_048_576 }
    }
    pub fn count(self) -> usize {
        self.delta.unsigned_abs() as usize
    }
    pub fn point(self, value: usize) -> Option<usize> {
        if value < self.start {
            return Some(value);
        }
        if self.delta > 0 {
            value
                .checked_add(self.count())
                .filter(|v| *v < self.maximum())
        } else if value < self.start + self.count() {
            None
        } else {
            Some(value - self.count())
        }
    }
    /// Inclusive range: insertions at the anchor move it; interior insertions
    /// expand it. Deletions retain every surviving part, including endpoints.
    pub fn range(self, a: usize, b: usize) -> Option<(usize, usize)> {
        let (low, high) = (a.min(b), a.max(b));
        let (low, high) = if self.delta > 0 {
            (
                self.point(low)?,
                if high >= self.start {
                    high.saturating_add(self.count()).min(self.maximum() - 1)
                } else {
                    high
                },
            )
        } else {
            let end = self.start + self.count();
            if low >= self.start && high < end {
                return None;
            }
            (
                if low < self.start {
                    low
                } else {
                    low.max(end) - self.count()
                },
                if high < self.start {
                    high
                } else if high < end {
                    self.start - 1
                } else {
                    high - self.count()
                },
            )
        };
        Some(if a <= b { (low, high) } else { (high, low) })
    }
    fn area(self, mut area: [usize; 4]) -> Option<[usize; 4]> {
        let i = usize::from(self.columns);
        (area[i], area[i + 2]) = self.range(area[i], area[i + 2])?;
        Some(area)
    }
    fn rectangle(self, mut rect: [usize; 4]) -> Option<[usize; 4]> {
        let i = usize::from(self.columns);
        let size = if self.columns { 2 } else { 3 };
        let (first, last) = self.range(rect[i], rect[i] + rect[size] - 1)?;
        rect[i] = first;
        rect[size] = last - first + 1;
        Some(rect)
    }
    fn filter(self, filter: &mut Option<model::Filter>) {
        let Some(source) = filter else {
            return;
        };
        let old = source.area;
        let Some(area) = self.area(old) else {
            *filter = None;
            return;
        };
        source.area = area;
        if let Some(fields) = source.fields.take() {
            source.fields = Some(
                fields
                    .into_iter()
                    .filter_map(|(column, mut field)| {
                        let column = if self.columns {
                            self.point(old[1] + column)?.checked_sub(area[1])?
                        } else {
                            column
                        };
                        if !self.columns
                            && let Some(rows) = &mut field.hidden_rows
                        {
                            *rows = rows
                                .iter()
                                .filter_map(|&r| self.point(r))
                                .filter(|&r| r > area[0] && r <= area[2])
                                .collect();
                        }
                        Some((column, field))
                    })
                    .collect(),
            );
        }
    }
}

impl Spreadsheet {
    /// Insert (positive delta) or delete (negative delta) whole rows/columns at
    /// a zero-based position. All workbook changes commit together after a
    /// successful bounded recalculation.
    pub fn edit_axis(
        &mut self,
        sheet: usize,
        columns: bool,
        start: usize,
        delta: i32,
        limit: usize,
    ) -> Result<(), String> {
        let source = self.sheets.get(sheet).ok_or("Unknown sheet")?;
        let edit = AxisEdit {
            sheet,
            columns,
            start,
            delta,
        };
        if start >= edit.maximum() || edit.count() > edit.maximum() - start {
            return Err("Row or column edit is outside the sheet".into());
        }
        if delta == 0 {
            return Ok(());
        }
        let index = usize::from(columns);
        for array in &source.arrays {
            let first = array.range[index];
            let size = array.range[if columns { 2 } else { 3 }];
            let last = size
                .checked_sub(1)
                .and_then(|size| first.checked_add(size))
                .filter(|&last| last < edit.maximum())
                .ok_or("Invalid array formula range")?;
            let splits = if delta > 0 {
                start > first && start <= last
            } else {
                start <= last
                    && start + edit.count() > first
                    && !(start <= first && start + edit.count() > last)
            };
            if splits {
                return Err("Cannot change part of an array formula".into());
            }
            if delta > 0 && edit.point(last).is_none() {
                return Err("Insertion would push an array formula off the sheet".into());
            }
        }
        if delta > 0
            && (source
                .cells
                .keys()
                .any(|&(r, c)| edit.point(if columns { c } else { r }).is_none())
                || (if columns {
                    &source.columns
                } else {
                    &source.rows
                })
                .keys()
                .any(|&p| edit.point(p).is_none())
                || source
                    .comments
                    .iter()
                    .any(|c| edit.point(if columns { c.column } else { c.row }).is_none())
                || self
                    .options
                    .tables
                    .iter()
                    .any(|t| t.sheet == sheet && edit.point(t.area[index + 2]).is_none()))
        {
            return Err("Insertion would push data or formatting off the sheet".into());
        }
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        let mut work = limit / 2;
        if columns && delta > 0 {
            for table in self
                .options
                .tables
                .iter()
                .filter(|t| t.sheet == sheet && start > t.area[1] && start <= t.area[3])
            {
                work = work
                    .checked_sub((table.columns.len() + edit.count()).saturating_mul(256))
                    .ok_or("Column insertion exceeds its table limit")?;
            }
        }
        let names: Vec<_> = self.sheets.iter().map(|s| s.name.clone()).collect();
        let sources: Vec<_> = names.iter().map(|s| (s.clone(), String::new())).collect();
        let mut table_maps = Vec::new();
        for table in self.options.tables.iter().filter(|t| t.sheet == sheet) {
            work = work
                .checked_sub(table.columns.len().saturating_mul(64).saturating_add(128))
                .ok_or("Row or column edit exceeds its table-reference limit")?;
            table_maps.push(super::TableReferenceMap {
                name: &table.name,
                replacement: edit
                    .area(table.area)
                    .is_some()
                    .then_some(table.name.as_str()),
                local: false,
                columns: table
                    .columns
                    .iter()
                    .enumerate()
                    .map(|(i, name)| {
                        (
                            name.as_str(),
                            (!columns || edit.point(table.area[1] + i).is_some())
                                .then_some(name.as_str()),
                        )
                    })
                    .collect(),
            });
        }
        // Resolve removed table/column names while the original definitions and
        // formula positions still exist (including local [@Column] references).
        let mut rewrite = |expression: &str,
                           original: Option<&str>,
                           position: (usize, usize, usize),
                           offset: (i64, i64)|
         -> Result<String, String> {
            if original.is_some_and(|s| s.starts_with("of:=")) {
                return Err(
                    "Row and column edits for OpenFormula documents are not supported yet".into(),
                );
            }
            let source = original
                .and_then(|s| s.strip_prefix("msoxl:="))
                .unwrap_or(expression);
            let source = xlsx_import::formula_tokens(
                source,
                &self.options.names,
                &sources,
                (Some(position.0), Some(position.0)),
                offset,
                Syntax::Editor,
                &mut work,
            )
            .ok_or("Row or column edit exceeds its formula limit")?
            .text;
            let source =
                xlsx_references::map_axis_references(&source, &names, position.0, edit, &mut work)?;
            for (table, mapping) in self
                .options
                .tables
                .iter()
                .filter(|t| t.sheet == sheet)
                .zip(&mut table_maps)
            {
                mapping.local = position.0 == table.sheet
                    && (table.area[0]..=table.area[2]).contains(&position.1)
                    && (table.area[1]..=table.area[3]).contains(&position.2);
            }
            super::map_table_references(&source, &table_maps, &mut work)
                .map(|r| r.0)
                .ok_or_else(|| "Row or column edit exceeds its table-reference limit".into())
        };
        for (s, sheet) in next.sheets.iter_mut().enumerate() {
            for (&(r, c), cell) in &mut sheet.cells {
                let Some(formula) = &cell.formula else {
                    continue;
                };
                if s == edit.sheet && edit.point(if columns { c } else { r }).is_none() {
                    continue;
                }
                let (_, or, oc) = self
                    .options
                    .formula_origins
                    .get(&(s, r, c))
                    .copied()
                    .unwrap_or((s, r, c));
                let formula = rewrite(
                    formula,
                    cell.openformula.as_deref(),
                    (s, r, c),
                    (r as i64 - or as i64, c as i64 - oc as i64),
                )?;
                if let Some(display) = &cell.formula_display {
                    cell.formula_display = Some(rewrite(display, None, (s, r, c), (0, 0))?);
                }
                cell.openformula = Some(format!("msoxl:={formula}"));
                cell.formula = Some(formula);
                cell.value = None;
                cell.value_format = None;
            }
            for group in &mut sheet.arrays {
                let [r, c, _, _] = group.range;
                if s == edit.sheet && edit.rectangle(group.range).is_none() {
                    continue;
                }
                let (_, or, oc) = self
                    .options
                    .formula_origins
                    .get(&(s, r, c))
                    .copied()
                    .unwrap_or((s, r, c));
                group.expression = rewrite(
                    &group.expression,
                    group.openformula.as_deref(),
                    (s, r, c),
                    (r as i64 - or as i64, c as i64 - oc as i64),
                )?;
                group.openformula = Some(format!("msoxl:={}", group.expression));
                if let Some(display) = &group.formula_display {
                    group.formula_display = Some(rewrite(display, None, (s, r, c), (0, 0))?);
                }
            }
        }
        for name in &mut next.options.names {
            name.expression = rewrite(
                &name.expression,
                name.openformula.as_deref(),
                (
                    name.sheet.unwrap_or(name.position.0),
                    name.position.1.max(0) as usize,
                    name.position.2.max(0) as usize,
                ),
                (0, 0),
            )?;
            name.openformula = Some(format!("msoxl:={}", name.expression));
            name.compiled = None;
            if name.position.0 == sheet {
                let p = if columns {
                    &mut name.position.2
                } else {
                    &mut name.position.1
                };
                if *p >= 0 {
                    *p = edit.point(*p as usize).unwrap_or(start) as i64;
                }
            }
        }
        for rule in &mut next.options.conditional_formats {
            let old_anchor = rule
                .anchor()
                .ok_or("Missing conditional formatting range")?;
            let mut original = old_anchor;
            if rule.sheet == sheet {
                rule.ranges = rule
                    .ranges
                    .iter()
                    .filter_map(|&area| edit.area(area))
                    .collect();
                let Some(anchor) = rule.anchor() else {
                    continue;
                };
                original = anchor;
                let p = if columns {
                    &mut original.1
                } else {
                    &mut original.0
                };
                // Rebase onto the first surviving origin before mapping references.
                // Otherwise deleting the origin incorrectly invalidates relative A1.
                if delta > 0 && *p >= start + edit.count() {
                    *p -= edit.count();
                } else if delta < 0 && *p >= start {
                    *p += edit.count();
                }
            }
            let offset = (
                original.0 as i64 - old_anchor.0 as i64,
                original.1 as i64 - old_anchor.1 as i64,
            );
            for source in rule.rule.formulas_mut() {
                *source = rewrite(source, None, (rule.sheet, original.0, original.1), offset)?;
            }
        }
        next.options
            .conditional_formats
            .retain(|rule| !rule.ranges.is_empty());
        let mut template_offsets = Vec::new();
        for (table_index, table) in next.options.tables.iter_mut().enumerate() {
            let base = table.area[0] + usize::from(table.header);
            for (&column, definition) in &mut table.calculated_columns {
                let mut origin = base;
                let mut offset = 0;
                if !columns
                    && table.sheet == sheet
                    && let Some(area) = edit.area(table.area)
                {
                    origin = definition.origin_row.unwrap_or(base);
                    // Use the first surviving authored row, including after a
                    // previous insertion created new rows ahead of that origin.
                    if edit.point(origin).is_none() {
                        origin = start + edit.count();
                    }
                    if let Some(mapped) = edit.point(origin) {
                        offset = (area[0] + usize::from(table.header)) as i64 - mapped as i64;
                        definition.origin_row = Some(mapped);
                    }
                }
                definition.formula = rewrite(
                    &definition.formula,
                    None,
                    (table.sheet, base, table.area[1] + column),
                    (origin as i64 - base as i64, 0),
                )?;
                if offset != 0 {
                    template_offsets.push((table_index, column, offset));
                }
            }
        }
        for (index, column, offset) in template_offsets {
            let table = &mut next.options.tables[index];
            if let Some(definition) = table.calculated_columns.get_mut(&column) {
                definition.formula = super::xlsx_import::formula_tokens(
                    &definition.formula,
                    &self.options.names,
                    &sources,
                    (Some(table.sheet), Some(table.sheet)),
                    (offset, 0),
                    Syntax::Editor,
                    &mut work,
                )
                .ok_or("Column formula exceeds its relocation limit")?
                .text
                .into_owned();
            }
        }
        let target = &mut next.sheets[sheet];
        let frozen = if columns {
            &mut target.frozen_columns
        } else {
            &mut target.frozen_rows
        };
        if start < *frozen {
            *frozen = if delta > 0 {
                frozen.saturating_add(edit.count()).min(edit.maximum() - 1)
            } else {
                *frozen - edit.count().min(*frozen - start)
            };
        }
        target.cells = std::mem::take(&mut target.cells)
            .into_iter()
            .filter_map(|((r, c), cell)| {
                Some((
                    (
                        if columns { r } else { edit.point(r)? },
                        if columns { edit.point(c)? } else { c },
                    ),
                    cell,
                ))
            })
            .collect();
        let axis = if columns {
            &mut target.columns
        } else {
            &mut target.rows
        };
        *axis = std::mem::take(axis)
            .into_iter()
            .filter_map(|(p, v)| Some((edit.point(p)?, v)))
            .collect();
        target.comments.retain_mut(|comment| {
            let p = if columns {
                &mut comment.column
            } else {
                &mut comment.row
            };
            if let Some(value) = edit.point(*p) {
                *p = value;
                true
            } else {
                false
            }
        });
        target.merges = target
            .merges
            .iter()
            .filter_map(|&r| edit.rectangle(r))
            .filter(|r| r[2] > 1 || r[3] > 1)
            .collect();
        target.arrays.retain_mut(|a| {
            if let Some(range) = edit.rectangle(a.range) {
                a.range = range;
                true
            } else {
                false
            }
        });
        edit.filter(&mut target.filter);
        next.options.tables.retain_mut(|table| {
            if table.sheet != sheet {
                return true;
            }
            let old = table.area;
            let Some(area) = edit.area(old) else {
                return false;
            };
            if columns {
                table.calculated_columns = std::mem::take(&mut table.calculated_columns)
                    .into_iter()
                    .filter_map(|(column, definition)| {
                        Some((
                            edit.point(old[1] + column)?.checked_sub(area[1])?,
                            definition,
                        ))
                    })
                    .collect();
                let retained: std::collections::BTreeMap<_, _> = table
                    .columns
                    .iter()
                    .enumerate()
                    .filter_map(|(i, name)| Some((edit.point(old[1] + i)?, name.clone())))
                    .collect();
                let mut used: std::collections::BTreeSet<_> = table
                    .columns
                    .iter()
                    .map(|n| super::sheet_name_key(n))
                    .collect();
                let mut suffix = 1;
                table.columns = (area[1]..=area[3])
                    .map(|c| {
                        if let Some(name) = retained.get(&c) {
                            return name.clone();
                        }
                        let name = loop {
                            let name = format!("Column{suffix}");
                            suffix += 1;
                            if used.insert(super::sheet_name_key(&name)) {
                                break name;
                            }
                        };
                        if table.header {
                            target.cells.insert(
                                (area[0], c),
                                model::TypedCell {
                                    legacy_formula: false,
                                    value: Some(model::Value::Text(name.clone())),
                                    formula: None,
                                    openformula: None,
                                    formula_display: None,
                                    format: None,
                                    value_format: None,
                                    style: None,
                                    rich_text: None,
                                },
                            );
                        }
                        name
                    })
                    .collect();
            } else {
                if edit.point(old[0]).is_none() {
                    table.header = false;
                    table.filter = None;
                }
                if edit.point(old[2]).is_none() {
                    table.totals = false;
                }
            }
            table.area = area;
            edit.filter(&mut table.filter);
            true
        });
        next.options.formula_origins.clear();
        next.options.name_dependencies.clear();
        next.options.name_uses.clear();
        for set in [
            &mut next.options.uninterned_arrays,
            &mut next.options.explicit_formula_styles,
        ] {
            *set = set
                .iter()
                .filter_map(|&(s, r, c)| {
                    Some(if s != sheet {
                        (s, r, c)
                    } else {
                        (
                            s,
                            if columns { r } else { edit.point(r)? },
                            if columns { edit.point(c)? } else { c },
                        )
                    })
                })
                .collect();
        }
        if !columns && delta > 0 {
            for index in 0..next.options.tables.len() {
                let table = &next.options.tables[index];
                if table.sheet != sheet || table.calculated_columns.is_empty() {
                    continue;
                }
                let first = start.max(table.area[0] + usize::from(table.header));
                let end = (start + edit.count()).min(table.area[2] + 1 - usize::from(table.totals));
                if first < end {
                    next.fill_table_columns(index, first, end - 1, None, true, &mut work)?;
                }
            }
        }
        next.spills = formulas::cache(&mut next.sheets, &next.options, None, work, true)
            .ok_or("Row or column edit exceeds its calculation limit")?;
        *self = next;
        Ok(())
    }
}

//! Calculated-column definitions are anchored at the first data row.
use super::{Spreadsheet, formula_arguments::Syntax, model};
use std::collections::BTreeSet;

impl Spreadsheet {
    /// Rebase an editor formula without evaluating it or creating worksheet
    /// cells. Uses the Excel import walker, including external references and
    /// LET/LAMBDA local names, and returns readable editor function names.
    pub fn translate_formula(
        source: &str,
        sheets: &[String],
        sheet: usize,
        offset: (i64, i64),
        work: &mut usize,
    ) -> Result<String, String> {
        if sheet >= sheets.len() {
            return Err("Unknown formula worksheet".into());
        }
        if !(-1_048_576..=1_048_576).contains(&offset.0) || !(-16_384..=16_384).contains(&offset.1)
        {
            return Err("Formula relocation is outside the worksheet".into());
        }
        *work = work
            .checked_sub(
                sheets
                    .iter()
                    .fold(0usize, |n, s| n.saturating_add(s.len() + 32)),
            )
            .ok_or("Formula relocation exceeds its limit")?;
        let sources = sheets
            .iter()
            .map(|name| (name.clone(), String::new()))
            .collect::<Vec<_>>();
        let source = super::xlsx_import::formula_tokens(
            source,
            &[],
            &sources,
            (Some(sheet), Some(sheet)),
            offset,
            Syntax::Editor,
            work,
        )
        .ok_or("Formula relocation exceeds its limit")?
        .text;
        super::formula_arguments::rewrite(&source, Syntax::EditorDisplay, &[], work)
            .map(|formula| formula.into_owned())
            .ok_or_else(|| "Formula relocation exceeds its limit".into())
    }

    /// Replaces the selected column's data formulas in one transaction. An empty
    /// source stops future filling and leaves existing cells unchanged.
    pub fn set_calculated_column(
        &mut self,
        index: usize,
        column: usize,
        source: &str,
        array: bool,
        limit: usize,
    ) -> Result<(), String> {
        let table = self.options.tables.get(index).ok_or("Unknown table")?;
        if column > table.area[3] - table.area[1] {
            return Err("Unknown table column".into());
        }
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        let mut work = limit / 2;
        let source = source.trim();
        let source = source.strip_prefix('=').unwrap_or(source).trim();
        if source.is_empty() {
            next.options.tables[index]
                .calculated_columns
                .remove(&column);
        } else {
            let source = super::formula_arguments::rewrite(source, Syntax::Editor, &[], &mut work)
                .ok_or("Column formula exceeds its limit")?;
            let names = self
                .sheets
                .iter()
                .map(|s| s.name.clone())
                .collect::<Vec<_>>();
            let source = super::formulas::complete_input(
                &source,
                &names,
                &self.options,
                (
                    table.sheet,
                    table.area[0] + usize::from(table.header),
                    table.area[1] + column,
                ),
                &mut work,
            )
            .ok_or("Column formula exceeds its limit")?
            .into_owned();
            let source = super::formulas::qualify_columns(&source, &table.name, &mut work)
                .ok_or("Column formula exceeds its limit")?;
            let source =
                super::formula_arguments::rewrite(&source, Syntax::EditorDisplay, &[], &mut work)
                    .ok_or("Column formula exceeds its limit")?
                    .into_owned();
            next.options.tables[index].calculated_columns.insert(
                column,
                model::CalculatedColumn {
                    formula: source,
                    array,
                    origin_row: None,
                },
            );
            next.fill_table_columns(
                index,
                table.area[0] + usize::from(table.header),
                table.area[2] - usize::from(table.totals),
                Some(column),
                false,
                &mut work,
            )?;
            next.replace_cells(Vec::new(), work)?;
        }
        *self = next;
        Ok(())
    }

    // Called on a temporary workbook so array and cell changes roll back together.
    pub(super) fn fill_table_columns(
        &mut self,
        index: usize,
        start: usize,
        end: usize,
        selected: Option<usize>,
        blanks_only: bool,
        work: &mut usize,
    ) -> Result<(), String> {
        if start > end {
            return Ok(());
        }
        let table = &self.options.tables[index];
        let sheet = table.sheet;
        let base_row = table.area[0] + usize::from(table.header);
        let sources = self
            .sheets
            .iter()
            .map(|s| (s.name.clone(), String::new()))
            .collect::<Vec<_>>();
        let mut replacements = Vec::new();
        let mut arrays = Vec::new();
        let mut replaced = BTreeSet::new();
        for (&column, definition) in &table.calculated_columns {
            if selected.is_some_and(|selected| selected != column)
                || definition.formula.trim().is_empty()
            {
                continue;
            }
            let formula = super::formula_arguments::rewrite(
                definition.formula.trim().trim_start_matches('='),
                Syntax::Editor,
                &[],
                work,
            )
            .ok_or("Column formula exceeds its fill limit")?;
            let formula = super::formulas::qualify_columns(&formula, &table.name, work)
                .ok_or("Column formula exceeds its fill limit")?;
            let column = table.area[1] + column;
            for row in start..=end {
                *work = work
                    .checked_sub(512)
                    .ok_or("Calculated column exceeds its fill limit")?;
                let current = self.sheets[sheet].cells.get(&(row, column));
                if blanks_only
                    && current.is_some_and(|cell| cell.formula.is_some() || cell.value.is_some())
                {
                    continue;
                }
                if self.sheets[sheet]
                    .merges
                    .iter()
                    .any(|&[r, c, w, h]| row >= r && row - r < h && column >= c && column - c < w)
                    || self.sheets[sheet].arrays.iter().any(|a| {
                        let [r, c, w, h] = a.range;
                        (w > 1 || h > 1) && row >= r && row - r < h && column >= c && column - c < w
                    })
                {
                    return Err("A calculated column cannot replace merged cells or part of an array formula".into());
                }
                let source = super::xlsx_import::formula_tokens(
                    &formula,
                    &self.options.names,
                    &sources,
                    (Some(sheet), Some(sheet)),
                    (row as i64 - base_row as i64, 0),
                    Syntax::Editor,
                    work,
                )
                .ok_or("Column formula exceeds its fill limit")?
                .text
                .into_owned();
                *work = work
                    .checked_sub(source.len().saturating_mul(3))
                    .ok_or("Calculated column exceeds its fill limit")?;
                let mut cell = current.cloned().unwrap_or(model::TypedCell {
                    legacy_formula: false,
                    value: None,
                    formula: None,
                    openformula: None,
                    formula_display: None,
                    format: None,
                    value_format: None,
                    style: None,
                    rich_text: None,
                });
                cell.value = None;
                cell.value_format = None;
                cell.rich_text = None;
                cell.legacy_formula = false;
                cell.formula = Some(source.clone());
                cell.openformula = Some(format!("msoxl:={source}"));
                let display =
                    super::formula_arguments::rewrite(&source, Syntax::EditorDisplay, &[], work)
                        .ok_or("Column formula exceeds its fill limit")?;
                cell.formula_display = (display != source).then(|| display.into_owned());
                if definition.array {
                    arrays.push(model::ArrayFormula {
                        range: [row, column, 1, 1],
                        expression: source.clone(),
                        openformula: Some(format!("msoxl:={source}")),
                        formula_display: cell.formula_display.clone(),
                    });
                }
                replacements.push(((row, column), cell));
                replaced.insert((row, column));
            }
        }
        self.sheets[sheet]
            .arrays
            .retain(|a| !replaced.contains(&(a.range[0], a.range[1])));
        self.sheets[sheet].arrays.extend(arrays);
        for (position, cell) in replacements {
            self.sheets[sheet].cells.insert(position, cell);
        }
        Ok(())
    }

    /// Resizes the bottom/right edges without deleting worksheet data. New rows
    /// receive column formulas only in empty cells; existing exceptions survive.
    pub fn resize_table(
        &mut self,
        index: usize,
        bottom: usize,
        right: usize,
        limit: usize,
    ) -> Result<(), String> {
        let table = self.options.tables.get(index).ok_or("Unknown table")?;
        let [top, left, old_bottom, old_right] = table.area;
        if bottom < top + usize::from(table.header) + usize::from(table.totals)
            || right < left
            || bottom >= 1_048_576
            || right >= 16_384
        {
            return Err("A table needs at least one data row within the worksheet".into());
        }
        if (bottom, right) == (old_bottom, old_right) {
            return Ok(());
        }
        let sheet = table.sheet;
        if table.totals && bottom != old_bottom {
            return Err(
                "Resize tables with a totals row after converting the totals row to ordinary data"
                    .into(),
            );
        }
        if self.options.tables.iter().enumerate().any(|(i, t)| {
            i != index
                && t.sheet == sheet
                && t.area[0] <= bottom
                && t.area[2] >= top
                && t.area[1] <= right
                && t.area[3] >= left
        }) || self.sheets[sheet]
            .merges
            .iter()
            .any(|&[r, c, w, h]| r <= bottom && r + h > top && c <= right && c + w > left)
            || self.sheets[sheet].arrays.iter().any(|a| {
                let [r, c, w, h] = a.range;
                // A single-cell array stays intact when the table grows over it,
                // including after shrinking previously calculated rows/columns.
                r <= bottom && r + h > top && c <= right && c + w > left && (w > 1 || h > 1)
            })
        {
            return Err(
                "Tables cannot overlap another table, merged cells or array formulas".into(),
            );
        }
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        let mut work = limit / 2;
        if bottom < old_bottom || right < old_right {
            // Resolve local structured references while their original table
            // context still exists. Cells outside the resized table remain real
            // worksheet cells; their table references must remain bound as well.
            let leaving = |row: usize, column: usize| {
                (top..=old_bottom).contains(&row)
                    && (left..=old_right).contains(&column)
                    && (row > bottom || column > right)
            };
            let mut qualify = |source: &mut String| -> Result<(), String> {
                *source = super::formulas::qualify_columns(source, &table.name, &mut work)
                    .ok_or("Table resize exceeds its formula limit")?;
                Ok(())
            };
            for (&(row, column), cell) in &mut next.sheets[sheet].cells {
                if !leaving(row, column)
                    || cell
                        .openformula
                        .as_deref()
                        .is_some_and(|s| s.starts_with("of:="))
                {
                    continue;
                }
                for source in [
                    &mut cell.formula,
                    &mut cell.openformula,
                    &mut cell.formula_display,
                ]
                .into_iter()
                .flatten()
                {
                    qualify(source)?;
                }
            }
            for array in &mut next.sheets[sheet].arrays {
                if !leaving(array.range[0], array.range[1])
                    || array
                        .openformula
                        .as_deref()
                        .is_some_and(|s| s.starts_with("of:="))
                {
                    continue;
                }
                qualify(&mut array.expression)?;
                for source in [&mut array.openformula, &mut array.formula_display]
                    .into_iter()
                    .flatten()
                {
                    qualify(source)?;
                }
            }
            for name in &mut next.options.names {
                if name.sheet.unwrap_or(name.position.0) != sheet
                    || name.position.1 < 0
                    || name.position.2 < 0
                    || !leaving(name.position.1 as usize, name.position.2 as usize)
                    || name
                        .openformula
                        .as_deref()
                        .is_some_and(|s| s.starts_with("of:="))
                {
                    continue;
                }
                qualify(&mut name.expression)?;
                if let Some(source) = &mut name.openformula {
                    qualify(source)?;
                }
                if let Some(compiled) = &mut name.compiled {
                    qualify(&mut compiled.expression)?;
                }
            }
        }
        let mut columns = table
            .columns
            .iter()
            .take(right - left + 1)
            .cloned()
            .collect::<Vec<_>>();
        let mut used = columns
            .iter()
            .map(|s| super::case_fold::sheet_key(s))
            .collect::<BTreeSet<_>>();
        let mut headers = Vec::new();
        for column in old_right + 1..=right {
            let source = if table.header {
                self.display(sheet, top, column, work)?
            } else {
                String::new()
            };
            let source = if source.is_empty() {
                format!("Column{}", column - left + 1)
            } else {
                source
            };
            work = work
                .checked_sub(source.len().saturating_mul(4) + 512)
                .ok_or("Table headers exceed their limit")?;
            let mut name = source.clone();
            let mut suffix = 2;
            while !used.insert(super::case_fold::sheet_key(&name)) {
                work = work
                    .checked_sub(name.len() + 64)
                    .ok_or("Table headers exceed their limit")?;
                name = format!("{source}{suffix}");
                suffix += 1;
            }
            if table.header {
                headers.push((sheet, top, column, name.clone()));
            }
            columns.push(name);
        }
        let target = &mut next.options.tables[index];
        target.area = [top, left, bottom, right];
        target.columns = columns;
        target
            .calculated_columns
            .retain(|&column, _| column <= right - left);
        if let Some(filter) = &mut target.filter {
            filter.area = [top, left, bottom - usize::from(table.totals), right];
            if let Some(fields) = &mut filter.fields {
                fields.retain(|&column, _| column <= right - left);
                for field in fields.values_mut() {
                    if let Some(rows) = &mut field.hidden_rows {
                        rows.retain(|&row| row <= filter.area[2]);
                    }
                }
            }
        }
        let edits = headers
            .iter()
            .map(|(s, r, c, text)| (*s, *r, *c, text.as_str()))
            .collect::<Vec<_>>();
        next.edit(&edits, work / 2)?;
        work /= 2;
        next.fill_table_columns(index, old_bottom + 1, bottom, None, true, &mut work)?;
        next.replace_cells(Vec::new(), work)?;
        if next.options.tables[index].filter.is_some() {
            next.reapply_table_filter(index, work)?;
        }
        *self = next;
        Ok(())
    }
}

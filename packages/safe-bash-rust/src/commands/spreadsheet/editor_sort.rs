//! Typed sort order adapted from Univer's sheets-sort/controllers/utils.ts
//! (Apache-2.0, see LICENSE.Univer). Stable ties retain the original record order.
use super::{Spreadsheet, collation, model::Value};
use std::collections::BTreeMap;

impl Spreadsheet {
    /// Sort a table's data rows by a zero-based column within the table.
    /// Returns changed cell coordinates for callers publishing sparse edits.
    pub fn sort_table(
        &mut self,
        index: usize,
        column: usize,
        descending: bool,
        limit: usize,
    ) -> Result<Vec<(usize, usize)>, String> {
        let table = self.options.tables.get(index).ok_or("Unknown table")?;
        let [top, left, bottom, right] = table.area;
        if column > right - left {
            return Err("Unknown table column".into());
        }
        let start = top + usize::from(table.header);
        let end = bottom + 1 - usize::from(table.totals);
        if end <= start + 1 {
            return Ok(Vec::new());
        }
        let sheet = table.sheet;
        let source = &self.sheets[sheet];
        if self.options.tables.iter().enumerate().any(|(i, t)| {
            i != index
                && t.sheet == sheet
                && t.area[0] < end
                && t.area[2] >= start
                && t.area[1] <= right
                && t.area[3] >= left
        }) {
            return Err("Cannot sort overlapping tables".into());
        }
        if source
            .merges
            .iter()
            .chain(
                source
                    .arrays
                    .iter()
                    .filter(|a| a.range[2..] != [1, 1])
                    .map(|a| &a.range),
            )
            .any(|[r, c, w, h]| *r < end && r + h > start && *c <= right && c + w > left)
        {
            return Err("Cannot sort a table containing merged cells or array formulas".into());
        }
        let mut work = (limit / 2)
            .checked_sub(
                (end - start)
                    .checked_mul(256)
                    .ok_or("Table sort exceeds its limit")?,
            )
            .ok_or("Table sort exceeds its limit")?;
        let rank = |value: Option<&Value<String>>| match value {
            Some(Value::Number(_)) => 0,
            Some(Value::Text(s)) if !s.is_empty() => 1,
            Some(Value::Bool(_)) => 2,
            Some(Value::Error(_)) => 3,
            _ => 4,
        };
        let mut rows = Vec::with_capacity(end - start);
        for row in start..end {
            let value = source
                .cells
                .get(&(row, left + column))
                .and_then(|c| c.value.as_ref());
            let key = match value {
                Some(Value::Text(s)) => Some(
                    collation::key(s, false, &mut work)
                        .ok_or("Table sort exceeds its text limit")?,
                ),
                _ => None,
            };
            rows.push((row, value, key));
        }
        rows.sort_by(|(_, a, ak), (_, b, bk)| {
            let (ar, br) = (rank(*a), rank(*b));
            let order = ar.cmp(&br).then_with(|| match (a, b) {
                (Some(Value::Number(a)), Some(Value::Number(b))) => {
                    a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
                }
                (Some(Value::Bool(a)), Some(Value::Bool(b))) => a.cmp(b),
                (Some(Value::Text(_)), Some(Value::Text(_))) => ak.cmp(bk),
                _ => std::cmp::Ordering::Equal,
            });
            if descending && ar != 4 && br != 4 {
                order.reverse()
            } else {
                order
            }
        });
        let order: Vec<_> = rows.into_iter().map(|(r, _, _)| r).collect();
        if order.iter().copied().eq(start..end) {
            return Ok(Vec::new());
        }
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        let mut edits = BTreeMap::new();
        let mut destinations = vec![0; end - start];
        for (offset, &from) in order.iter().enumerate() {
            let to = start + offset;
            destinations[from - start] = to;
            if from == to {
                continue;
            }
            for (&(_, c), _) in source.cells.range((to, left)..=(to, right)) {
                edits.entry((to, c)).or_insert(None);
            }
            for (&(_, c), cell) in source.cells.range((from, left)..=(from, right)) {
                work = work
                    .checked_sub(256 + cell.formula.as_ref().map_or(0, |s| s.len() * 16))
                    .ok_or("Table sort exceeds its cell limit")?;
                edits.insert(
                    (to, c),
                    Some(self.relocate_cell(cell, (from, c), (to, c), sheet, work)?),
                );
            }
            // Row heights and row styles belong to their grid positions. Saved
            // hidden/filter visibility follows the sorted records.
            let hidden = source.rows.get(&from).is_some_and(|r| r.hidden);
            if hidden || next.sheets[sheet].rows.contains_key(&to) {
                next.sheets[sheet].rows.entry(to).or_default().hidden = hidden;
            }
        }
        if let Some(filter) = &mut next.options.tables[index].filter {
            for field in filter
                .fields
                .iter_mut()
                .flat_map(|fields| fields.values_mut())
            {
                if let Some(hidden) = &mut field.hidden_rows {
                    for row in hidden.iter_mut() {
                        if (start..end).contains(row) {
                            *row = destinations[*row - start];
                        }
                    }
                    hidden.sort_unstable();
                }
            }
        }
        for comment in &mut next.sheets[sheet].comments {
            if (start..end).contains(&comment.row) && (left..=right).contains(&comment.column) {
                comment.row = destinations[comment.row - start];
            }
        }
        for array in &mut next.sheets[sheet].arrays {
            let [row, column, _, _] = array.range;
            if !(start..end).contains(&row) || !(left..=right).contains(&column) {
                continue;
            }
            let to = destinations[row - start];
            if row == to {
                continue;
            }
            work = work
                .checked_sub(
                    256 + array.expression.len() * 16
                        + array.formula_display.as_ref().map_or(0, |s| s.len() * 16),
                )
                .ok_or("Table sort exceeds its array formula limit")?;
            // The group is authoritative even in legacy JSON whose anchor
            // only stores a cached value. Use the same copier as ordinary cells.
            let mut cell = source
                .cells
                .get(&(row, column))
                .cloned()
                .ok_or("Array formula is missing its anchor")?;
            cell.formula = Some(array.expression.clone());
            cell.formula_display = array.formula_display.clone();
            let cell = self.relocate_cell(&cell, (row, column), (to, column), sheet, work)?;
            array.expression = cell.formula.expect("copied array formula");
            array.openformula = cell.openformula;
            array.formula_display = cell.formula_display;
            array.range[0] = to;
        }
        let changed = edits.keys().copied().collect();
        next.replace_cells(
            edits
                .into_iter()
                .map(|((r, c), cell)| (sheet, r, c, cell))
                .collect(),
            work,
        )?;
        *self = next;
        Ok(changed)
    }
}

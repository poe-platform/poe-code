//! Editable pivot definitions; calculated cells belong to the calculation cache.
//! Field/aggregate contracts follow XlsxWriter 238e935a (LICENSE.XlsxWriter)
//! and ClosedXML 057f5976 (LICENSE.ClosedXML).
use super::{Spreadsheet, Value, formulas};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Key {
    Number(u64),
    Text((Vec<u8>, Vec<u8>, Vec<u8>)),
    Bool(bool),
    Error(String),
    Blank,
}

pub(super) fn number_key(n: f64) -> u64 {
    let bits = if n == 0. { 0. } else { n }.to_bits();
    if n < 0. { !bits } else { bits ^ (1 << 63) }
}

pub(super) fn selected_key(value: &Value<String>, work: &mut usize) -> Option<Key> {
    *work = work.checked_sub(64)?;
    Some(match value {
        Value::Number(n) if n.is_finite() => Key::Number(number_key(*n)),
        Value::Number(_) => return None,
        Value::Bool(b) => Key::Bool(*b),
        Value::Text(s) => Key::Text(super::collation::key(s, false, work)?),
        Value::Error(s) => {
            *work = work.checked_sub(s.len())?;
            Key::Error(s.clone())
        }
        Value::Empty => Key::Blank,
    })
}

#[derive(Clone)]
pub struct PivotValue {
    pub field: usize,
    pub aggregate: String,
    pub name: String,
}

#[derive(Clone)]
pub struct PivotFilter {
    pub field: usize,
    /// None selects all values; an empty selection selects no records.
    pub selected: Option<Vec<Value<String>>>,
}

#[derive(Clone)]
pub struct PivotTable {
    pub name: String,
    pub sheet: usize,
    pub row: usize,
    pub column: usize,
    pub source_sheet: usize,
    /// Inclusive source range, including its header row.
    pub source: [usize; 4],
    pub rows: Vec<usize>,
    pub columns: Vec<usize>,
    pub values: Vec<PivotValue>,
    pub filters: Vec<PivotFilter>,
    pub row_totals: bool,
    pub column_totals: bool,
}

pub(super) fn aggregate(name: &str) -> Option<&'static str> {
    Some(match name {
        "sum" => "SUM",
        "count" => "COUNTA",
        "countNums" => "COUNT",
        "average" => "AVERAGE",
        "min" => "MIN",
        "max" => "MAX",
        "product" => "PRODUCT",
        "stdDev" => "STDEV.S",
        "stdDevp" => "STDEV.P",
        "var" => "VAR.S",
        "varp" => "VAR.P",
        _ => return None,
    })
}

impl Spreadsheet {
    pub(super) fn validate_pivots(&self, work: &mut usize) -> Result<(), String> {
        let mut names = BTreeSet::new();
        let mut anchors = BTreeSet::new();
        for (id, pivot) in &self.options.pivots {
            *work = work
                .checked_sub(id.len() + pivot.name.len() + 256)
                .ok_or("Pivot tables exceed limit")?;
            let [top, left, bottom, right] = pivot.source;
            if id.is_empty()
                || id.len() > 256
                || pivot.name.is_empty()
                || pivot.name.len() > 1024
                || !names.insert(super::case_fold::sheet_key(&pivot.name))
                || pivot.sheet >= self.sheets.len()
                || pivot.source_sheet >= self.sheets.len()
                || pivot.row >= 1_048_576
                || pivot.column >= 16_384
                || top >= bottom
                || left > right
                || bottom >= 1_048_576
                || right >= 16_384
                || !anchors.insert((pivot.sheet, pivot.row, pivot.column))
            {
                return Err("Invalid pivot table definition".into());
            }
            let mut fields = BTreeSet::new();
            for &field in pivot.rows.iter().chain(&pivot.columns) {
                *work = work.checked_sub(64).ok_or("Pivot fields exceed limit")?;
                if field > right - left || !fields.insert(field) {
                    return Err("Invalid or duplicate pivot field".into());
                }
            }
            fields.clear();
            for filter in &pivot.filters {
                *work = work.checked_sub(64).ok_or("Pivot filters exceed limit")?;
                if filter.field > right - left || !fields.insert(filter.field) {
                    return Err("Invalid or duplicate pivot filter".into());
                }
            }
            for value in &pivot.values {
                *work = work
                    .checked_sub(value.name.len() + value.aggregate.len() + 64)
                    .ok_or("Pivot values exceed limit")?;
                if value.field > right - left
                    || value.name.is_empty()
                    || aggregate(&value.aggregate).is_none()
                {
                    return Err("Invalid pivot value field".into());
                }
            }
            if self.sheets[pivot.sheet]
                .cells
                .get(&(pivot.row, pivot.column))
                .is_some_and(|cell| {
                    cell.formula.is_some()
                        || cell
                            .value
                            .as_ref()
                            .is_some_and(|v| !matches!(v, Value::Empty))
                })
            {
                return Err("Pivot table would replace an existing cell".into());
            }
        }
        Ok(())
    }

    /// Replace one definition atomically. Output is recalculated, never authored.
    pub fn set_pivot(
        &mut self,
        id: &str,
        pivot: Option<PivotTable>,
        limit: usize,
    ) -> Result<(), String> {
        let previous = match pivot {
            Some(pivot) => self.options.pivots.insert(id.into(), pivot),
            None => self.options.pivots.remove(id),
        };
        let mut work = limit;
        let result = self.validate_pivots(&mut work).and_then(|()| {
            formulas::cache(&mut self.sheets, &self.options, None, work, true)
                .ok_or_else(|| "Pivot calculation exceeds its limit".to_owned())
        });
        match result {
            Ok(cache) => {
                self.spills = cache;
                Ok(())
            }
            Err(error) => {
                match previous {
                    Some(pivot) => {
                        self.options.pivots.insert(id.into(), pivot);
                    }
                    None => {
                        self.options.pivots.remove(id);
                    }
                }
                Err(error)
            }
        }
    }

    pub(super) fn edit_pivots(
        &mut self,
        edit: super::editor_structure::AxisEdit,
    ) -> Result<(), String> {
        let mut removed = Vec::new();
        for (id, pivot) in &mut self.options.pivots {
            if pivot.sheet == edit.sheet {
                let [width, height] = self
                    .spills
                    .pivot_ranges
                    .get(&(pivot.sheet, pivot.row, pivot.column))
                    .copied()
                    .unwrap_or([1, 1]);
                let first = if edit.columns {
                    pivot.column
                } else {
                    pivot.row
                };
                let last = first + if edit.columns { width } else { height } - 1;
                if edit.delta < 0 && edit.start <= first && edit.start + edit.count() > last {
                    removed.push(id.clone());
                    continue;
                }
                let splits = if edit.delta > 0 {
                    edit.start > first && edit.start <= last
                } else {
                    edit.start <= last && edit.start + edit.count() > first
                };
                if splits {
                    return Err("Cannot change part of a pivot table".into());
                }
                if edit.point(last).is_none() {
                    return Err("Insertion would push a pivot table off the sheet".into());
                }
                let position = edit.point(first).ok_or("Pivot destination was deleted")?;
                if edit.columns {
                    pivot.column = position;
                } else {
                    pivot.row = position;
                }
            }
            if pivot.source_sheet == edit.sheet {
                let axis = usize::from(edit.columns);
                let before = pivot.source;
                let (first, last) = edit
                    .range(before[axis], before[axis + 2])
                    .ok_or("Remove the pivot table before deleting its source")?;
                if !edit.columns && (first >= last || edit.point(before[0]).is_none()) {
                    return Err("A pivot source needs its header and at least one data row".into());
                }
                pivot.source[axis] = first;
                pivot.source[axis + 2] = last;
                if edit.columns {
                    let field = |f| edit.point(before[1] + f).and_then(|c| c.checked_sub(first));
                    pivot.rows = pivot.rows.iter().filter_map(|&f| field(f)).collect();
                    pivot.columns = pivot.columns.iter().filter_map(|&f| field(f)).collect();
                    pivot.values.retain_mut(|value| {
                        if let Some(f) = field(value.field) {
                            value.field = f;
                            true
                        } else {
                            false
                        }
                    });
                    pivot.filters.retain_mut(|filter| {
                        if let Some(f) = field(filter.field) {
                            filter.field = f;
                            true
                        } else {
                            false
                        }
                    });
                }
            }
        }
        for id in removed {
            self.options.pivots.remove(&id);
        }
        Ok(())
    }

    pub(super) fn pivot_intersects(
        &self,
        sheet: usize,
        [row, column, width, height]: [usize; 4],
    ) -> bool {
        self.options.pivots.values().any(|pivot| {
            if pivot.sheet != sheet {
                return false;
            }
            let [w, h] = self
                .spills
                .pivot_ranges
                .get(&(sheet, pivot.row, pivot.column))
                .copied()
                .unwrap_or([1, 1]);
            row < pivot.row + h
                && pivot.row < row.saturating_add(height)
                && column < pivot.column + w
                && pivot.column < column.saturating_add(width)
        })
    }

    pub fn pivot_at(&self, sheet: usize, row: usize, column: usize) -> Option<(&str, [usize; 4])> {
        self.options.pivots.iter().find_map(|(id, pivot)| {
            if pivot.sheet != sheet {
                return None;
            }
            let [width, height] = self
                .spills
                .pivot_ranges
                .get(&(sheet, pivot.row, pivot.column))
                .copied()
                .unwrap_or([1, 1]);
            (row >= pivot.row
                && row - pivot.row < height
                && column >= pivot.column
                && column - pivot.column < width)
                .then_some((id.as_str(), [pivot.row, pivot.column, width, height]))
        })
    }
}

fn filter_source(
    book: &Spreadsheet,
    sheet: usize,
    source: [usize; 4],
    field: usize,
) -> Result<(), String> {
    let [top, left, bottom, right] = source;
    if sheet >= book.sheets.len()
        || top >= bottom
        || left > right
        || bottom >= 1_048_576
        || right >= 16_384
        || field > right - left
    {
        return Err("Invalid pivot filter source".into());
    }
    Ok(())
}

impl Spreadsheet {
    /// Typed distinct source values, formatted labels, row counts and selection.
    /// Saved selections absent from the current source remain visible with count 0.
    /// Comparison and ordering are identical to pivot calculation.
    pub fn pivot_filter_values(
        &self,
        sheet: usize,
        source: [usize; 4],
        filter: &PivotFilter,
        limit: usize,
    ) -> Result<Vec<(Value<String>, String, usize, bool)>, String> {
        filter_source(self, sheet, source, filter.field)?;
        let mut work = limit;
        let mut selected = BTreeMap::new();
        for value in filter.selected.iter().flatten() {
            work = work.checked_sub(128).ok_or("Pivot filter exceeds limit")?;
            let key = selected_key(value, &mut work)
                .ok_or("Invalid pivot selection or limit exceeded")?;
            selected.insert(key, value);
        }
        let mut values = BTreeMap::new();
        let column = source[1] + filter.field;
        for row in source[0] + 1..=source[2] {
            work = work.checked_sub(128).ok_or("Pivot filter exceeds limit")?;
            let cell = self.cell(sheet, row, column);
            let value = cell
                .as_ref()
                .and_then(|c| c.value.as_ref())
                .unwrap_or(&Value::Empty);
            let key =
                selected_key(value, &mut work).ok_or("Invalid pivot value or limit exceeded")?;
            let included = filter.selected.is_none() || selected.contains_key(&key);
            if let Some((_, _, count, _)) = values.get_mut(&key) {
                *count += 1;
            } else {
                let label = if matches!(value, Value::Empty) {
                    "(blank)".into()
                } else {
                    super::csv::cell_text(
                        cell.as_deref().ok_or("Missing pivot value")?,
                        None,
                        self.options.date1904,
                        super::number_format::Mode::ExcelDisplay,
                        &mut work,
                    )
                    .map(|(label, _)| label)
                    .ok_or("Pivot filter formatting exceeds limit")?
                };
                work = work
                    .checked_sub(label.len().saturating_mul(2))
                    .ok_or("Pivot filter exceeds limit")?;
                values.insert(key, (value.clone(), label, 1, included));
            }
        }
        for (key, value) in selected {
            if let std::collections::btree_map::Entry::Vacant(entry) = values.entry(key) {
                let label = match value {
                    Value::Empty => "(blank)".into(),
                    Value::Text(s) | Value::Error(s) => s.clone(),
                    Value::Bool(b) => if *b { "TRUE" } else { "FALSE" }.into(),
                    Value::Number(n) => super::number_format::number(*n, false),
                };
                work = work
                    .checked_sub(label.len().saturating_mul(2))
                    .ok_or("Pivot filter exceeds limit")?;
                entry.insert((value.clone(), label, 0, true));
            }
        }
        Ok(values.into_values().collect())
    }

    /// Resolve checklist edits as one batch, leaving the workbook unchanged.
    /// None retains all current and future values; explicit selections retain
    /// their absent items. Repeated edits use the last decision for each typed key.
    pub fn pivot_filter_selection(
        &self,
        sheet: usize,
        source: [usize; 4],
        filter: &PivotFilter,
        changes: &[(Value<String>, bool)],
        limit: usize,
    ) -> Result<PivotFilter, String> {
        filter_source(self, sheet, source, filter.field)?;
        let mut work = limit / 2;
        let mut edits = BTreeMap::new();
        for (value, included) in changes {
            work = work.checked_sub(128).ok_or("Pivot filter exceeds limit")?;
            edits.insert(
                selected_key(value, &mut work)
                    .ok_or("Invalid pivot selection or limit exceeded")?,
                (value, *included),
            );
        }
        if filter.selected.is_none() && edits.values().all(|(_, included)| *included) {
            return Ok(filter.clone());
        }
        let mut selected = BTreeMap::new();
        if let Some(values) = &filter.selected {
            for value in values {
                work = work.checked_sub(128).ok_or("Pivot filter exceeds limit")?;
                selected.insert(
                    selected_key(value, &mut work)
                        .ok_or("Invalid pivot selection or limit exceeded")?,
                    value.clone(),
                );
            }
        } else {
            for (value, _, _, _) in self.pivot_filter_values(sheet, source, filter, limit / 2)? {
                work = work.checked_sub(128).ok_or("Pivot filter exceeds limit")?;
                selected.insert(
                    selected_key(&value, &mut work).ok_or("Pivot filter exceeds limit")?,
                    value,
                );
            }
        }
        for (key, (value, included)) in edits {
            if included {
                selected.insert(key, value.clone());
            } else {
                selected.remove(&key);
            }
        }
        Ok(PivotFilter {
            field: filter.field,
            selected: Some(selected.into_values().collect()),
        })
    }
}

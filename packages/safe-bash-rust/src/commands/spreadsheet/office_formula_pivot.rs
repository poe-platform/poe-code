//! Grouping uses typed, case-insensitive keys, then the existing Rust aggregates.
//! Output shares dynamic-array dependency scheduling without becoming a formula
//! or authored cells in the workbook document.
use super::{Calculation, Coord, Expr, Value};
use crate::commands::spreadsheet::pivot::{
    Key, PivotSource, PivotTable, aggregate, number_key, selected_key,
};
use std::collections::{BTreeMap, BTreeSet};

fn key(value: &Value, work: &mut usize) -> Option<Key> {
    *work = work.checked_sub(64)?;
    Some(match value {
        Value::Number(n) => Key::Number(number_key(*n)),
        Value::Bool(b) => Key::Bool(*b),
        Value::Text(s) | Value::UninternedText(s) => {
            Key::Text(super::super::collation::key(s, false, work)?)
        }
        Value::Error(e) | Value::LiteralError(e) => Key::Error((*e).into()),
        Value::Blank | Value::Empty => Key::Blank,
        _ => return None,
    })
}

type Groups = BTreeMap<Vec<Key>, (Vec<Value>, usize)>;

// Group order is already sorted by typed keys. Expand values within each prefix,
// retaining references to labels instead of copying them for each measure.
fn axis_groups(
    groups: &Groups,
    total: bool,
    count: usize,
    position: Option<usize>,
) -> Vec<(Option<usize>, &[Value], usize)> {
    let entries: Vec<_> = groups.iter().collect();
    let mut result = Vec::new();
    let mut first = 0;
    while first < entries.len() {
        let end = if let Some(position) = position {
            first
                + entries[first..]
                    .iter()
                    .take_while(|(key, _)| key[..position] == entries[first].0[..position])
                    .count()
        } else {
            first + 1
        };
        for measure in 0..count {
            for (_, (labels, id)) in &entries[first..end] {
                result.push((Some(*id), labels.as_slice(), measure));
            }
        }
        first = end;
    }
    if total {
        for measure in 0..count {
            result.push((None, &[][..], measure));
        }
    }
    result
}

impl Calculation<'_> {
    pub(super) fn pivot_source(
        &mut self,
        binding: Option<PivotSource>,
        fallback: (usize, [usize; 4]),
        depth: usize,
    ) -> Option<Value> {
        let (sheet, area) = match binding {
            None => fallback,
            Some(PivotSource::Table(index)) => {
                let Some(table) = self.book.tables.get(index) else {
                    return Some(Value::Error("#REF!"));
                };
                if !table.header || table.area[2] < table.area[0] + usize::from(table.totals) {
                    return Some(Value::Error("#REF!"));
                }
                let mut area = table.area;
                area[2] -= usize::from(table.totals);
                (table.sheet, area)
            }
            Some(PivotSource::Name(index)) => {
                let Some(name) = self.book.names.get(index) else {
                    return Some(Value::Error("#REF!"));
                };
                let (sheet, row, column) = name.position;
                if !(0..1_048_576).contains(&row) || !(0..16_384).contains(&column) {
                    return Some(Value::Error("#REF!"));
                }
                return self.eval(
                    &Expr::Name(index),
                    (sheet, row as usize, column as usize),
                    depth,
                    true,
                );
            }
            Some(PivotSource::Missing) => return Some(Value::Error("#REF!")),
        };
        Some(Value::Range(
            (sheet, area[0], area[1]),
            (sheet, area[2], area[3]),
        ))
    }

    fn pivot_group(
        &mut self,
        source: (usize, usize),
        row: usize,
        fields: &[usize],
        groups: &mut Groups,
        depth: usize,
    ) -> Option<usize> {
        self.work = self.work.checked_sub(fields.len().checked_mul(128)?)?;
        let mut labels = Vec::with_capacity(fields.len());
        let mut keys = Vec::with_capacity(fields.len());
        for &field in fields {
            let value = self.cell((source.0, row, source.1 + field), depth + 1)?;
            keys.push(key(&value, &mut self.work)?);
            labels.push(match value {
                Value::Blank | Value::Empty => Value::Text("(blank)".into()),
                value => value,
            });
        }
        let index = groups.len();
        self.work = self.work.checked_sub(128)?;
        Some(groups.entry(keys).or_insert((labels, index)).1)
    }

    pub(super) fn pivot_table(
        &mut self,
        pivot: &PivotTable,
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        self.tick(depth)?;
        self.pivot_sources.remove(&pos);
        let value = self.pivot_source(
            pivot.source_binding,
            (pivot.source_sheet, pivot.source),
            depth + 1,
        )?;
        let (first, last) = match value {
            Value::Single(cell) => (cell, cell),
            Value::Range(first, last) => (first, last),
            Value::Error(_) | Value::LiteralError(_) => return Some(value),
            _ => return Some(Value::Error("#REF!")),
        };
        if first.0 != last.0
            || first.0 >= self.sheets.len()
            || first.1 >= last.1
            || first.2 > last.2
            || last.1 >= 1_048_576
            || last.2 >= 16_384
        {
            return Some(Value::Error("#REF!"));
        }
        let source_sheet = first.0;
        let [top, left, bottom, right] = [first.1, first.2, last.1, last.2];
        if pivot
            .rows
            .iter()
            .chain(&pivot.columns)
            .copied()
            .chain(pivot.values.iter().map(|v| v.field))
            .chain(pivot.filters.iter().map(|v| v.field))
            .any(|field| field > right - left)
        {
            return Some(Value::Error("#REF!"));
        }
        self.work = self.work.checked_sub(128)?;
        self.pivot_sources
            .insert(pos, (source_sheet, [top, left, bottom, right]));
        self.read_spill_range((source_sheet, top, left), (source_sheet, bottom, right))?;
        self.work = self
            .work
            .checked_sub((right - left + 1).checked_mul(128)?)?;
        let mut headers = Vec::new();
        let mut names = BTreeSet::new();
        for column in left..=right {
            let value = self.cell((source_sheet, top, column), depth + 1)?;
            let Value::Text(name) = value else {
                return Some(Value::Error("#VALUE!"));
            };
            self.work = self.work.checked_sub(name.len().checked_mul(4)?)?;
            if name.is_empty() || !names.insert(super::super::case_fold::sheet_key(&name)) {
                return Some(Value::Error("#VALUE!"));
            }
            headers.push(name);
        }
        let mut filters = Vec::new();
        for filter in &pivot.filters {
            if let Some(selected) = &filter.selected {
                self.work = self.work.checked_sub(selected.len().checked_mul(128)?)?;
                let keys = selected
                    .iter()
                    .map(|value| selected_key(value, &mut self.work))
                    .collect::<Option<BTreeSet<_>>>()?;
                filters.push((filter.field, keys));
            }
        }
        let mut rows = Groups::new();
        let mut columns = Groups::new();
        // Each source row participates in its intersection and optional totals.
        // Keep row indexes, not copies of its strings or numeric values.
        let mut groups = BTreeMap::<(Option<usize>, Option<usize>), Vec<usize>>::new();
        for row in top + 1..=bottom {
            self.tick(depth)?;
            let mut included = true;
            for (field, selected) in &filters {
                let value = self.cell((source_sheet, row, left + field), depth + 1)?;
                if !selected.contains(&key(&value, &mut self.work)?) {
                    included = false;
                    break;
                }
            }
            if !included {
                continue;
            }
            let r = self.pivot_group((source_sheet, left), row, &pivot.rows, &mut rows, depth)?;
            let c = self.pivot_group(
                (source_sheet, left),
                row,
                &pivot.columns,
                &mut columns,
                depth,
            )?;
            for coordinate in [
                (Some(r), Some(c)),
                (Some(r), None),
                (None, Some(c)),
                (None, None),
            ] {
                self.work = self.work.checked_sub(64)?;
                groups.entry(coordinate).or_default().push(row);
            }
        }
        if pivot.rows.is_empty() && rows.is_empty() {
            rows.insert(Vec::new(), (Vec::new(), 0));
        }
        if pivot.columns.is_empty() && columns.is_empty() {
            columns.insert(Vec::new(), (Vec::new(), 0));
        }
        let row_total = pivot.column_totals && !pivot.rows.is_empty();
        let column_total = pivot.row_totals && !pivot.columns.is_empty();
        let axis = pivot.data_axis();
        let row_position = axis.filter(|a| a.rows).map(|a| a.position);
        let column_position = axis.filter(|a| !a.rows).map(|a| a.position);
        let on_rows = row_position.is_some();
        let (header_rows, label_columns) = pivot.header_size();
        let row_measures = if on_rows { pivot.values.len() } else { 1 };
        let column_measures = if on_rows { 1 } else { pivot.values.len() };
        let width = label_columns.checked_add(
            (columns.len() + usize::from(column_total)).checked_mul(column_measures)?,
        )?;
        let height = header_rows
            .checked_add((rows.len() + usize::from(row_total)).checked_mul(row_measures)?)?;
        if width > 16_384 - pos.2 || height > 1_048_576 - pos.1 {
            return Some(Value::Error("#SPILL!"));
        }
        self.work = self
            .work
            .checked_sub(width.checked_mul(height)?.checked_mul(160)?)?;
        let mut result = vec![vec![Value::Text(String::new()); width]; height];
        for (column, &field) in pivot.rows.iter().enumerate() {
            self.work = self.work.checked_sub(headers[field].len())?;
            let column = column + usize::from(row_position.is_some_and(|p| p <= column));
            result[header_rows - 1][column] = Value::Text(headers[field].clone());
        }
        if let Some(position) = row_position {
            result[header_rows - 1][position] = Value::Text("Values".into());
        } else if pivot.rows.is_empty() {
            result[header_rows - 1][0] = Value::Text(
                pivot
                    .values
                    .first()
                    .map_or(pivot.name.as_str(), |v| v.name.as_str())
                    .into(),
            );
        }
        let row_groups = axis_groups(&rows, row_total, row_measures, row_position);
        let column_groups = axis_groups(&columns, column_total, column_measures, column_position);
        for (index, (id, labels, measure)) in column_groups.iter().enumerate() {
            let column = label_columns + index;
            for (r, label) in labels.iter().enumerate() {
                self.charge_value(label)?;
                let r = r + usize::from(column_position.is_some_and(|p| p <= r));
                result[r][column] = label.clone();
            }
            if id.is_none() {
                result[usize::from(column_position == Some(0))][column] =
                    Value::Text("Grand Total".into());
            }
            if let Some(position) =
                column_position.or_else(|| (!on_rows && pivot.columns.is_empty()).then_some(0))
            {
                let name = &pivot.values[*measure].name;
                self.work = self.work.checked_sub(name.len())?;
                result[position][column] = Value::Text(name.clone());
            }
        }
        for (index, (row_id, labels, row_measure)) in row_groups.iter().enumerate() {
            let row = header_rows + index;
            for (c, label) in labels.iter().enumerate() {
                self.charge_value(label)?;
                let c = c + usize::from(row_position.is_some_and(|p| p <= c));
                result[row][c] = label.clone();
            }
            if row_id.is_none() {
                result[row][usize::from(row_position == Some(0))] =
                    Value::Text("Grand Total".into());
            }
            if let Some(position) = row_position {
                let name = &pivot.values[*row_measure].name;
                self.work = self.work.checked_sub(name.len())?;
                result[row][position] = Value::Text(name.clone());
            }
            for (column, (column_id, _, column_measure)) in column_groups.iter().enumerate() {
                let measure = if on_rows {
                    *row_measure
                } else {
                    *column_measure
                };
                let field = &pivot.values[measure];
                let source_rows = groups
                    .get(&(*row_id, *column_id))
                    .map_or(&[][..], Vec::as_slice);
                self.work = self.work.checked_sub(source_rows.len().checked_mul(64)?)?;
                let mut values = Vec::with_capacity(source_rows.len());
                for &r in source_rows {
                    values.push(self.cell((source_sheet, r, left + field.field), depth + 1)?);
                }
                let name = aggregate(&field.aggregate)?;
                let value = if name == "COUNT" {
                    Value::Number(
                        values
                            .iter()
                            .filter(|v| matches!(v, Value::Number(_)))
                            .count() as f64,
                    )
                } else if name == "COUNTA" {
                    Value::Number(
                        values
                            .iter()
                            .filter(|v| !matches!(v, Value::Blank | Value::Empty))
                            .count() as f64,
                    )
                } else if values.is_empty() {
                    Value::Text(String::new())
                } else {
                    self.aggregate_excel(
                        name,
                        &[Expr::Value(Value::Matrix(vec![values]))],
                        pos,
                        depth + 1,
                    )?
                };
                result[row][label_columns + column] = value;
            }
        }
        Some(Value::Matrix(result))
    }
}

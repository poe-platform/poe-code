//! Grouping uses typed, case-insensitive keys, then the existing Rust aggregates.
//! Output shares dynamic-array dependency scheduling without becoming a formula
//! or authored cells in the workbook document.
use super::{Calculation, Coord, Expr, Value};
use crate::commands::spreadsheet::pivot::{
    Key, PivotSource, PivotSubtotal, PivotTable, SUBTOTALS, aggregate, number_key, selected_key,
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

struct AxisGroup<'a> {
    id: Option<usize>,
    labels: &'a [Value],
    measure: usize,
    subtotal: Option<&'a str>,
}

// Walk grouping fields and the values pseudo-field. The explicit stack avoids
// recursion on the native/WASM stack for deeply nested imported pivots.
fn axis_groups<'a>(
    groups: &'a Groups,
    fields: &[usize],
    subtotals: &BTreeMap<usize, &'a PivotSubtotal>,
    total: bool,
    count: usize,
    position: Option<usize>,
    work: &mut usize,
) -> Option<Vec<AxisGroup<'a>>> {
    if count == 0 {
        return Some(Vec::new());
    }
    *work = work.checked_sub(groups.len().checked_mul(32)?)?;
    let entries: Vec<_> = groups
        .iter()
        .filter(|(key, _)| key.len() == fields.len())
        .collect();
    let mut result = Vec::new();
    enum Frame {
        Walk(usize, usize, usize, Option<usize>),
        Subtotal(usize, usize, Option<usize>),
    }
    let mut stack = vec![Frame::Walk(0, entries.len(), 0, None)];
    while let Some(frame) = stack.pop() {
        *work = work.checked_sub(64)?;
        match frame {
            Frame::Subtotal(first, depth, measure) => {
                let (labels, id) = groups.get(&entries[first].0[..depth])?;
                let subtotal = subtotals.get(&fields[depth - 1])?;
                // Excel stores these as flags, so its fixed function order is
                // also used before export, independent of JSON array order.
                for (aggregate, _, _, _) in SUBTOTALS {
                    if !subtotal.aggregates.iter().any(|a| a == aggregate) {
                        continue;
                    }
                    for measure in measure.map_or(0..count, |m| m..m + 1) {
                        *work = work.checked_sub(64)?;
                        result.push(AxisGroup {
                            id: Some(*id),
                            labels,
                            measure,
                            subtotal: Some(aggregate),
                        });
                    }
                }
            }
            Frame::Walk(first, end, depth, measure) => {
                if first == end {
                    continue;
                }
                if position == Some(depth) && measure.is_none() {
                    *work = work.checked_sub(count.checked_mul(64)?)?;
                    for measure in (0..count).rev() {
                        stack.push(Frame::Walk(first, end, depth, Some(measure)));
                    }
                } else if depth == fields.len() {
                    let (_, (labels, id)) = entries[first];
                    result.push(AxisGroup {
                        id: Some(*id),
                        labels,
                        measure: measure.unwrap_or(0),
                        subtotal: None,
                    });
                } else {
                    let mut last = end;
                    while last > first {
                        let mut start = last - 1;
                        while start > first
                            && entries[start - 1].0[depth] == entries[last - 1].0[depth]
                        {
                            *work = work.checked_sub(1)?;
                            start -= 1;
                        }
                        *work = work.checked_sub(192)?;
                        let subtotal = subtotals
                            .get(&fields[depth])
                            .filter(|_| depth + 1 < fields.len());
                        if subtotal.is_some_and(|s| !s.at_top) {
                            stack.push(Frame::Subtotal(start, depth + 1, measure));
                        }
                        stack.push(Frame::Walk(start, last, depth + 1, measure));
                        if subtotal.is_some_and(|s| s.at_top) {
                            stack.push(Frame::Subtotal(start, depth + 1, measure));
                        }
                        last = start;
                    }
                }
            }
        }
    }
    if total {
        for measure in 0..count {
            *work = work.checked_sub(64)?;
            result.push(AxisGroup {
                id: None,
                labels: &[],
                measure,
                subtotal: None,
            });
        }
    }
    Some(result)
}

fn subtotal_label(group: &AxisGroup<'_>, work: &mut usize) -> Option<Value> {
    let suffix = SUBTOTALS.iter().find(|s| Some(s.0) == group.subtotal)?.3;
    let label = super::strings::string(group.labels.last()?);
    *work = work.checked_sub(label.len().checked_add(suffix.len() + 1)?)?;
    Some(Value::Text(format!("{label} {suffix}")))
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
        self.work = self
            .work
            .checked_sub(pivot.subtotals.len().checked_mul(64)?)?;
        let subtotals: BTreeMap<_, _> = pivot.subtotals.iter().map(|s| (s.field, s)).collect();
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
            let mut axes = [Vec::new(), Vec::new()];
            for ((fields, groups), ids) in
                [(&pivot.rows, &mut rows), (&pivot.columns, &mut columns)]
                    .into_iter()
                    .zip(&mut axes)
            {
                for length in 0..=fields.len() {
                    if length == fields.len()
                        || length > 0 && subtotals.contains_key(&fields[length - 1])
                    {
                        ids.push(Some(self.pivot_group(
                            (source_sheet, left),
                            row,
                            &fields[..length],
                            groups,
                            depth,
                        )?));
                    }
                }
                ids.push(None);
            }
            for &r in &axes[0] {
                for &c in &axes[1] {
                    self.work = self.work.checked_sub(64)?;
                    groups.entry((r, c)).or_default().push(row);
                }
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
        let row_groups = axis_groups(
            &rows,
            &pivot.rows,
            &subtotals,
            row_total,
            row_measures,
            row_position,
            &mut self.work,
        )?;
        let column_groups = axis_groups(
            &columns,
            &pivot.columns,
            &subtotals,
            column_total,
            column_measures,
            column_position,
            &mut self.work,
        )?;
        let width = label_columns.checked_add(column_groups.len())?;
        let height = header_rows.checked_add(row_groups.len())?;
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
        for (index, group) in column_groups.iter().enumerate() {
            let column = label_columns + index;
            for (r, label) in group.labels.iter().enumerate() {
                self.charge_value(label)?;
                let r = r + usize::from(column_position.is_some_and(|p| p <= r));
                result[r][column] = label.clone();
            }
            if group.subtotal.is_some() {
                let r = group.labels.len() - 1;
                result[r + usize::from(column_position.is_some_and(|p| p <= r))][column] =
                    subtotal_label(group, &mut self.work)?;
            }
            if group.id.is_none() {
                result[usize::from(column_position == Some(0))][column] =
                    Value::Text("Grand Total".into());
            }
            if let Some(position) =
                column_position.or_else(|| (!on_rows && pivot.columns.is_empty()).then_some(0))
            {
                let name = &pivot.values[group.measure].name;
                self.work = self.work.checked_sub(name.len())?;
                result[position][column] = Value::Text(name.clone());
            }
        }
        for (index, row_group) in row_groups.iter().enumerate() {
            let row = header_rows + index;
            for (c, label) in row_group.labels.iter().enumerate() {
                self.charge_value(label)?;
                let c = c + usize::from(row_position.is_some_and(|p| p <= c));
                result[row][c] = label.clone();
            }
            if row_group.subtotal.is_some() {
                let c = row_group.labels.len() - 1;
                result[row][c + usize::from(row_position.is_some_and(|p| p <= c))] =
                    subtotal_label(row_group, &mut self.work)?;
            }
            if row_group.id.is_none() {
                result[row][usize::from(row_position == Some(0))] =
                    Value::Text("Grand Total".into());
            }
            if let Some(position) = row_position {
                let name = &pivot.values[row_group.measure].name;
                self.work = self.work.checked_sub(name.len())?;
                result[row][position] = Value::Text(name.clone());
            }
            for (column, column_group) in column_groups.iter().enumerate() {
                let measure = if on_rows {
                    row_group.measure
                } else {
                    column_group.measure
                };
                let field = &pivot.values[measure];
                let row_aggregate = row_group.subtotal.filter(|&s| s != "automatic");
                let column_aggregate = column_group.subtotal.filter(|&s| s != "automatic");
                if row_aggregate.is_some()
                    && column_aggregate.is_some()
                    && row_aggregate != column_aggregate
                {
                    continue;
                }
                let source_rows = groups
                    .get(&(row_group.id, column_group.id))
                    .map_or(&[][..], Vec::as_slice);
                self.work = self.work.checked_sub(source_rows.len().checked_mul(64)?)?;
                let mut values = Vec::with_capacity(source_rows.len());
                for &r in source_rows {
                    values.push(self.cell((source_sheet, r, left + field.field), depth + 1)?);
                }
                let name = aggregate(
                    row_aggregate
                        .or(column_aggregate)
                        .unwrap_or(&field.aggregate),
                )?;
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

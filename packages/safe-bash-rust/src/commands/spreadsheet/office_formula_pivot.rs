//! Grouping uses typed, case-insensitive keys, then the existing Rust aggregates.
//! Layout contracts: ClosedXML 057f5976 (MIT) and LibreOffice abf91474804c
//! dpoutput.cxx / dptabres.cxx (MPL-2.0, LICENSE.LibreOffice, NOTICE.OpenOffice).
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
    header: bool,
    data_header: bool,
    top: bool,
    blank: bool,
}

// Walk grouping fields and the values pseudo-field. The explicit stack avoids
// recursion on the native/WASM stack for deeply nested imported pivots.
fn axis_groups<'a>(
    groups: &'a Groups,
    pivot: &'a PivotTable,
    rows: bool,
    subtotals: &BTreeMap<usize, &'a PivotSubtotal>,
    work: &mut usize,
) -> Option<Vec<AxisGroup<'a>>> {
    let fields = if rows { &pivot.rows } else { &pivot.columns };
    let axis = pivot.data_axis();
    let position = axis.filter(|a| a.rows == rows).map(|a| a.position);
    let count = if axis.is_some_and(|a| a.rows) == rows {
        pivot.values.len()
    } else {
        1
    };
    let total = !fields.is_empty()
        && if rows {
            pivot.column_totals
        } else {
            pivot.row_totals
        };
    if count == 0 {
        return Some(Vec::new());
    }
    *work = work.checked_sub(groups.len().checked_mul(32)?)?;
    let entries: Vec<_> = groups
        .iter()
        .filter(|(key, _)| key.len() == fields.len())
        .collect();
    let mut result: Vec<AxisGroup<'a>> = Vec::new();
    enum Frame {
        Walk(usize, usize, usize, Option<usize>),
        Subtotal(usize, usize, Option<usize>, bool),
        Header(usize, usize, Option<usize>, bool),
        Blank,
    }
    let mut stack = vec![Frame::Walk(0, entries.len(), 0, None)];
    while let Some(frame) = stack.pop() {
        *work = work.checked_sub(96)?;
        match frame {
            Frame::Blank => {
                if result.last().is_some_and(|g| g.blank) {
                    continue;
                }
                result.push(AxisGroup {
                    id: None,
                    labels: &[],
                    measure: 0,
                    subtotal: None,
                    header: false,
                    data_header: false,
                    top: false,
                    blank: true,
                });
            }
            Frame::Header(first, depth, measure, data_header) => {
                let (_, (labels, id)) = entries[first];
                result.push(AxisGroup {
                    id: Some(*id),
                    labels: &labels[..depth],
                    measure: measure.unwrap_or(0),
                    subtotal: None,
                    header: true,
                    data_header,
                    top: false,
                    blank: false,
                });
            }
            Frame::Subtotal(first, depth, measure, top) => {
                let (labels, id) = groups.get(&entries[first].0[..depth])?;
                let subtotal = subtotals.get(&fields[depth - 1])?;
                // Excel stores these as flags, so its fixed function order is
                // also used before export, independent of JSON array order.
                for (aggregate, _, _, _) in SUBTOTALS {
                    if !subtotal.aggregates.iter().any(|a| a == aggregate) {
                        continue;
                    }
                    for measure in measure.map_or(0..count, |m| m..m + 1) {
                        *work = work.checked_sub(96)?;
                        result.push(AxisGroup {
                            id: Some(*id),
                            labels,
                            measure,
                            subtotal: Some(aggregate),
                            header: false,
                            data_header: false,
                            top,
                            blank: false,
                        });
                    }
                }
            }
            Frame::Walk(first, end, depth, measure) => {
                if first == end {
                    continue;
                }
                if position == Some(depth) && measure.is_none() {
                    *work = work.checked_sub(count.checked_mul(128)?)?;
                    for measure in (0..count).rev() {
                        stack.push(Frame::Walk(first, end, depth, Some(measure)));
                        if rows
                            && depth < fields.len()
                            && pivot.layout.as_ref().is_some_and(|l| l.outline_data)
                        {
                            stack.push(Frame::Header(first, depth, Some(measure), true));
                        }
                    }
                } else if depth == fields.len() {
                    let (_, (labels, id)) = entries[first];
                    result.push(AxisGroup {
                        id: Some(*id),
                        labels,
                        measure: measure.unwrap_or(0),
                        subtotal: None,
                        header: false,
                        data_header: false,
                        top: false,
                        blank: false,
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
                        *work = work.checked_sub(320)?;
                        let layout = pivot.layout.as_ref().map(|l| l.field(fields[depth]));
                        let subtotal = subtotals
                            .get(&fields[depth])
                            .filter(|_| depth + 1 < fields.len());
                        let top = subtotal.is_some_and(|s| {
                            s.at_top
                                && layout.as_ref().is_none_or(|l| {
                                    rows && l.outline
                                        && s.aggregates.len() == 1
                                        && (measure.is_some() || count == 1)
                                })
                        });
                        if depth + 1 < fields.len() && layout.as_ref().is_some_and(|l| l.blank_row)
                        {
                            stack.push(Frame::Blank);
                        }
                        if subtotal.is_some() && !top {
                            stack.push(Frame::Subtotal(start, depth + 1, measure, false));
                        }
                        stack.push(Frame::Walk(start, last, depth + 1, measure));
                        if top {
                            stack.push(Frame::Subtotal(start, depth + 1, measure, true));
                        } else if rows
                            && layout.as_ref().is_some_and(|l| l.outline)
                            && (depth + 1 < fields.len() || position == Some(depth + 1))
                        {
                            stack.push(Frame::Header(start, depth + 1, measure, false));
                        }
                        last = start;
                    }
                }
            }
        }
    }
    if total {
        for measure in 0..count {
            *work = work.checked_sub(96)?;
            result.push(AxisGroup {
                id: None,
                labels: &[],
                measure,
                subtotal: None,
                header: false,
                data_header: false,
                top: false,
                blank: false,
            });
        }
    }
    Some(result)
}

fn subtotal_label(group: &AxisGroup<'_>, measure: Option<&str>, work: &mut usize) -> Option<Value> {
    let suffix = SUBTOTALS.iter().find(|s| Some(s.0) == group.subtotal)?.3;
    let suffix = measure.unwrap_or(suffix);
    let label = super::strings::string(group.labels.last()?);
    *work = work.checked_sub(label.len().checked_add(suffix.len() + 1)?)?;
    Some(Value::Text(format!("{label} {suffix}")))
}

// A label belongs to the whole prefix (including Values when it precedes it),
// so identical child captions under different parents are never suppressed.
fn repeated_label(
    group: &AxisGroup<'_>,
    previous: Option<&AxisGroup<'_>>,
    depth: usize,
    position: Option<usize>,
) -> bool {
    previous.is_some_and(|previous| {
        !previous.blank
            && group.labels.get(..=depth) == previous.labels.get(..=depth)
            && (position.is_none_or(|p| p > depth) || group.measure == previous.measure)
    })
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
        self.pivot_indents.remove(&pos);
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
        let axis = pivot.data_axis();
        let row_position = axis.filter(|a| a.rows).map(|a| a.position);
        let column_position = axis.filter(|a| !a.rows).map(|a| a.position);
        let on_rows = row_position.is_some();
        let (header_rows, label_columns) = pivot.header_size();
        let column_header_offset = usize::from(
            pivot.layout.is_some() && (!pivot.columns.is_empty() || column_position.is_some()),
        );
        let row_groups = axis_groups(&rows, pivot, true, &subtotals, &mut self.work)?;
        let column_groups = axis_groups(&columns, pivot, false, &subtotals, &mut self.work)?;
        let grouped_headers = pivot
            .layout
            .as_ref()
            .is_some_and(|layout| (0..headers.len()).any(|field| layout.field(field).compact));
        let caption_columns = if pivot.layout.is_some() && !grouped_headers {
            pivot.columns.len() + usize::from(column_position.is_some())
        } else {
            0
        };
        let width = label_columns.checked_add(column_groups.len().max(caption_columns))?;
        let height = header_rows.checked_add(row_groups.len())?;
        if width > 16_384 - pos.2 || height > 1_048_576 - pos.1 {
            return Some(Value::Error("#SPILL!"));
        }
        self.work = self
            .work
            .checked_sub(width.checked_mul(height)?.checked_mul(160)?)?;
        let slots = pivot.row_slots();
        let mut indents = BTreeMap::new();
        let empty = if pivot.layout.is_some() {
            Value::Empty
        } else {
            Value::Text(String::new())
        };
        let mut result = vec![vec![empty.clone(); width]; height];
        for (column, &field) in pivot.rows.iter().enumerate() {
            self.work = self.work.checked_sub(headers[field].len())?;
            let column = column + usize::from(row_position.is_some_and(|p| p <= column));
            result[header_rows - 1][slots[column].0] = Value::Text(headers[field].clone());
        }
        if let Some(position) = row_position {
            result[header_rows - 1][slots[position].0] = Value::Text("Values".into());
        } else if pivot.rows.is_empty() {
            result[header_rows - 1][0] = Value::Text(
                pivot
                    .values
                    .first()
                    .map_or(pivot.name.as_str(), |v| v.name.as_str())
                    .into(),
            );
        }
        if grouped_headers && !pivot.rows.is_empty() {
            result[header_rows - 1][..label_columns].fill(empty.clone());
            result[header_rows - 1][0] = Value::Text("Row Labels".into());
        }
        if column_header_offset != 0 {
            if !on_rows && pivot.values.len() == 1 {
                self.work = self.work.checked_sub(pivot.values[0].name.len())?;
                result[0][0] = Value::Text(pivot.values[0].name.clone());
            }
            let grouped = grouped_headers;
            for index in 0..pivot.columns.len() + usize::from(column_position.is_some()) {
                if label_columns + index >= width {
                    break;
                }
                let name = if grouped {
                    "Column Labels"
                } else if column_position == Some(index) {
                    "Values"
                } else {
                    &headers[pivot.columns
                        [index - usize::from(column_position.is_some_and(|p| p < index))]]
                };
                self.work = self.work.checked_sub(name.len())?;
                result[0][label_columns + index] = Value::Text(name.into());
                if grouped {
                    break;
                }
            }
        }
        for (index, group) in column_groups.iter().enumerate() {
            let column = label_columns + index;
            if group.blank {
                continue;
            }
            for (r, label) in group.labels.iter().enumerate() {
                if pivot.layout.as_ref().is_some_and(|l| {
                    let f = l.field(pivot.columns[r]);
                    !f.repeat_labels || f.compact && f.outline
                }) && repeated_label(
                    group,
                    index.checked_sub(1).map(|i| &column_groups[i]),
                    r,
                    column_position,
                ) {
                    continue;
                }
                self.charge_value(label)?;
                let r = r + usize::from(column_position.is_some_and(|p| p <= r));
                result[column_header_offset + r][column] = label.clone();
            }
            if group.subtotal.is_some() {
                let r = group.labels.len() - 1;
                result[column_header_offset
                    + r
                    + usize::from(column_position.is_some_and(|p| p <= r))][column] =
                    subtotal_label(
                        group,
                        pivot
                            .layout
                            .as_ref()
                            .and_then(|_| {
                                column_position.map(|_| pivot.values[group.measure].name.as_str())
                            })
                            .filter(|_| pivot.values.len() > 1),
                        &mut self.work,
                    )?;
            }
            if group.id.is_none() {
                result[column_header_offset + usize::from(column_position == Some(0))][column] =
                    Value::Text("Grand Total".into());
            }
            if let Some(position) =
                column_position.or_else(|| (!on_rows && pivot.columns.is_empty()).then_some(0))
            {
                let name = &pivot.values[group.measure].name;
                self.work = self.work.checked_sub(name.len())?;
                result[column_header_offset + position][column] = Value::Text(name.clone());
            }
        }
        for (index, row_group) in row_groups.iter().enumerate() {
            let row = header_rows + index;
            if row_group.blank {
                continue;
            }
            for (c, label) in row_group.labels.iter().enumerate() {
                let slot = slots[c + usize::from(row_position.is_some_and(|p| p <= c))];
                if let Some(layout) = &pivot.layout {
                    let field = layout.field(pivot.rows[c]);
                    let repeated = repeated_label(
                        row_group,
                        index.checked_sub(1).map(|i| &row_groups[i]),
                        c,
                        row_position,
                    );
                    if repeated
                        && (!field.repeat_labels || field.outline && field.compact)
                        && !(c + 1 == row_group.labels.len() && row_group.subtotal.is_some())
                    {
                        continue;
                    }
                    self.work = self.work.checked_sub(96)?;
                    indents.insert((pos.0, pos.1 + row, pos.2 + slot.0), slot.1);
                }
                self.charge_value(label)?;
                result[row][slot.0] = label.clone();
            }
            if row_group.subtotal.is_some() && !(row_group.top && pivot.layout.is_some()) {
                let c = row_group.labels.len() - 1;
                result[row][slots[c + usize::from(row_position.is_some_and(|p| p <= c))].0] =
                    subtotal_label(
                        row_group,
                        pivot
                            .layout
                            .as_ref()
                            .and_then(|_| {
                                row_position.map(|_| pivot.values[row_group.measure].name.as_str())
                            })
                            .filter(|_| pivot.values.len() > 1),
                        &mut self.work,
                    )?;
            }
            if row_group.id.is_none() {
                let slot = slots
                    .get(usize::from(row_position == Some(0)))
                    .map_or(0, |s| s.0);
                let label = if pivot.layout.is_some() && on_rows && pivot.values.len() > 1 {
                    format!("Total {}", pivot.values[row_group.measure].name)
                } else {
                    "Grand Total".into()
                };
                self.work = self.work.checked_sub(label.len())?;
                result[row][slot] = Value::Text(label);
                if pivot.layout.is_some() {
                    self.work = self.work.checked_sub(96)?;
                    indents.insert((pos.0, pos.1 + row, pos.2 + slot), 0);
                }
            }
            if let Some(position) = row_position {
                let show = (!row_group.header || row_group.data_header)
                    && (pivot.layout.is_none()
                        || row_group.id.is_some() && row_group.subtotal.is_none());
                let repeated = index.checked_sub(1).is_some_and(|i| {
                    let previous = &row_groups[i];
                    !previous.blank
                        && previous.measure == row_group.measure
                        && previous.labels.get(..position) == row_group.labels.get(..position)
                });
                if show && (pivot.layout.is_none() || !repeated || position == pivot.rows.len()) {
                    let name = &pivot.values[row_group.measure].name;
                    self.work = self.work.checked_sub(name.len() + 96)?;
                    let slot = slots[position];
                    result[row][slot.0] = Value::Text(name.clone());
                    if pivot.layout.is_some() {
                        indents.insert((pos.0, pos.1 + row, pos.2 + slot.0), slot.1);
                    }
                }
            }
            if row_group.header {
                continue;
            }
            for (column, column_group) in column_groups.iter().enumerate() {
                if column_group.blank {
                    continue;
                }
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
                    empty.clone()
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
        self.pivot_indents.insert(pos, indents);
        Some(Value::Matrix(result))
    }
}

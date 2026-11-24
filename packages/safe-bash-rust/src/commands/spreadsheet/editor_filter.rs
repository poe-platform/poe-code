//! Column filter snapshots and typed conditions, adapted from Univer's
//! sheets-filter/models/{filter-model,custom-filters}.ts (Apache-2.0).
use super::{
    Spreadsheet, collation,
    model::{self, Filter, FilterField, Value},
    wildcard,
};
use std::collections::{BTreeMap, BTreeSet};
const LIMIT: &str = "Table filter exceeds its limit";
#[path = "editor_filter_color.rs"]
mod color;
#[path = "editor_filter_dynamic.rs"]
mod dynamic;

fn condition(
    value: Option<&Value<String>>,
    display: &str,
    operator: &str,
    compare: &str,
    work: &mut usize,
) -> Result<bool, String> {
    *work = work
        .checked_sub(compare.len() + display.len() + 32)
        .ok_or(LIMIT)?;
    let number = compare.trim().parse::<f64>().ok().filter(|n| n.is_finite());
    let blank = matches!(value, None | Some(Value::Empty))
        || matches!(value,Some(Value::Text(s)) if s.is_empty());
    if let Some(compare) = number {
        let Some(Value::Number(value)) = value else {
            return Ok(operator == "notEqual");
        };
        return Ok(match operator {
            "equal" => *value == compare,
            "notEqual" => *value != compare,
            "lessThan" => *value < compare,
            "lessThanOrEqual" => *value <= compare,
            "greaterThan" => *value > compare,
            "greaterThanOrEqual" => *value >= compare,
            _ => return Err("Invalid filter operator".into()),
        });
    }
    if matches!(operator, "equal" | "notEqual") {
        let matched = if compare.is_empty() {
            blank
        } else if blank || matches!(value, Some(Value::Bool(_))) {
            false
        } else {
            wildcard::matches(compare, display, true, false, work).ok_or(LIMIT)?
        };
        return Ok(if operator == "notEqual" {
            !matched
        } else {
            matched
        });
    }
    Ok(false)
}
fn matches(
    field: &FilterField,
    value: Option<&Value<String>>,
    display: &str,
    work: &mut usize,
) -> Result<bool, String> {
    if !field.custom {
        for (_, compare) in &field.conditions {
            if collation::compare(display, compare, false, work)
                .ok_or(LIMIT)?
                .is_eq()
            {
                return Ok(true);
            }
        }
        return Ok(false);
    }
    let mut result = field.conjunction;
    for (operator, compare) in &field.conditions {
        let matched = condition(value, display, operator, compare, work)?;
        if field.conjunction {
            result &= matched;
            if !result {
                break;
            }
        } else {
            result |= matched;
            if result {
                break;
            }
        }
    }
    Ok(result)
}
fn valid_date_group(group: &[usize]) -> bool {
    if !(1..=6).contains(&group.len()) || !(1..=9999).contains(&group[0]) {
        return false;
    }
    if group.len() < 2 {
        return true;
    }
    if !(1..=12).contains(&group[1]) {
        return false;
    }
    if group.len() < 3 {
        return true;
    }
    let year = group[0];
    let days = match group[1] {
        4 | 6 | 9 | 11 => 30,
        2 => {
            28 + usize::from(year == 1900 || year % 4 == 0 && (year % 100 != 0 || year % 400 == 0))
        }
        _ => 31,
    };
    (1..=days).contains(&group[2])
        && group.get(3).is_none_or(|hour| *hour < 24)
        && group.get(4).is_none_or(|minute| *minute < 60)
        && group.get(5).is_none_or(|second| *second < 60)
}

// Date/time grouping adapted from ClosedXML XLFilter.CreateDateGroupFilter
// at 057f5976c788d97e8eac86d1a528bd5411d9386e (LICENSE.ClosedXML).
// Excel stores dates as numbers. Text and booleans never become date serials.
fn date_matches(
    value: Option<&Value<String>>,
    date1904: bool,
    groups: &BTreeSet<&[usize]>,
) -> bool {
    let Some(Value::Number(n)) = value else {
        return false;
    };
    if groups.is_empty()
        || !n.is_finite()
        || *n < 0.
        || *n >= if date1904 { 2_957_004. } else { 2_958_466. }
    {
        return false;
    }
    // Correct serial floating-point noise at millisecond precision, then discard
    // fractional seconds rather than rounding to the nearest whole second.
    let seconds = ((*n * 86_400_000.).round() as i64) / 1000;
    let (year, month, day) = super::formulas::date_difference::calendar(seconds / 86400, date1904);
    let parts = [
        year as usize,
        month as usize,
        day as usize,
        (seconds % 86400 / 3600) as usize,
        (seconds % 3600 / 60) as usize,
        (seconds % 60) as usize,
    ];
    (1..=6).any(|depth| groups.contains(&parts[..depth]))
}

fn validate(field: &FilterField) -> Result<(), String> {
    if let Some(color) = &field.color {
        return if color
            .color
            .as_ref()
            .is_none_or(|value| value.len() == 8 && value.bytes().all(|b| b.is_ascii_hexdigit()))
            && (!color.font || color.color.is_some())
            && field.dynamic.is_none()
            && field.top.is_none()
            && field.date_groups.is_empty()
            && !field.custom
            && !field.conjunction
            && field.conditions.is_empty()
        {
            Ok(())
        } else {
            Err("Invalid color filter".into())
        };
    }
    if let Some(dynamic) = &field.dynamic {
        return if dynamic::valid(dynamic)
            && field.top.is_none()
            && field.date_groups.is_empty()
            && !field.custom
            && !field.conjunction
            && field.conditions.is_empty()
        {
            Ok(())
        } else {
            Err("Invalid dynamic filter".into())
        };
    }
    if let Some(top) = &field.top {
        return if field.date_groups.is_empty()
            && !field.custom
            && !field.conjunction
            && field.conditions.is_empty()
            && top.rank.is_finite()
            && top.rank >= 1.
            && top.rank <= if top.percent { 100. } else { 500. }
        {
            Ok(())
        } else {
            Err("Invalid top/bottom filter".into())
        };
    }
    if !field.date_groups.is_empty() && (field.custom || field.conjunction)
        || field
            .date_groups
            .iter()
            .any(|group| !valid_date_group(group))
    {
        return Err("Invalid date-group filter".into());
    }
    if field.custom && (field.conditions.is_empty() || field.conditions.len() > 2) {
        return Err("Use one or two custom filter conditions".into());
    }
    if field.conditions.iter().any(|(op, _)| {
        !matches!(
            *op,
            "equal"
                | "notEqual"
                | "lessThan"
                | "lessThanOrEqual"
                | "greaterThan"
                | "greaterThanOrEqual"
        ) || (!field.custom && *op != "equal")
    }) {
        return Err("Invalid filter operator".into());
    }
    Ok(())
}
pub(super) fn valid(filter: &Filter) -> bool {
    let [top, left, bottom, right] = filter.area;
    top <= bottom
        && left <= right
        && bottom < 1_048_576
        && right < 16_384
        && filter
            .fields
            .iter()
            .flat_map(|fields| fields.iter())
            .all(|(&column, field)| {
                column <= right - left
                    && validate(field).is_ok()
                    && field.hidden_rows.as_ref().is_none_or(|rows| {
                        rows.iter().all(|&row| row > top && row <= bottom)
                            && rows.windows(2).all(|pair| pair[0] < pair[1])
                    })
            })
}
pub(super) fn rows<S>(
    sheet: &model::Sheet<S>,
    book: &model::Workbook,
    index: usize,
    work: &mut usize,
) -> Option<BTreeSet<usize>> {
    let mut hidden = BTreeSet::new();
    for filter in sheet.filter.iter().chain(
        book.tables
            .iter()
            .filter(|t| t.sheet == index)
            .filter_map(|t| t.filter.as_ref()),
    ) {
        if filter.area[0] >= filter.area[2] {
            continue;
        }
        if filter.column_visibility {
            for field in filter.fields.iter().flat_map(|fields| fields.values()) {
                for &row in field.hidden_rows.iter().flatten() {
                    *work = work.checked_sub(32)?;
                    if row > filter.area[0] && row <= filter.area[2] {
                        hidden.insert(row);
                    }
                }
            }
        } else if filter
            .fields
            .as_ref()
            .is_some_and(|fields| !fields.is_empty())
        {
            for (&row, axis) in sheet
                .rows
                .range(filter.area[0].saturating_add(1)..=filter.area[2])
            {
                *work = work.checked_sub(32)?;
                if axis.hidden {
                    hidden.insert(row);
                }
            }
        }
    }
    Some(hidden)
}
fn activate(filter: &mut Filter, rows: &mut BTreeMap<usize, model::Axis>) {
    if !filter.column_visibility {
        if filter.area[0] < filter.area[2]
            && filter
                .fields
                .as_ref()
                .is_some_and(|fields| !fields.is_empty())
        {
            // Legacy Excel stores its aggregate filter mask in row.hidden.
            // Once reapplied, independent column snapshots own that mask.
            for (_, axis) in rows.range_mut(filter.area[0] + 1..=filter.area[2]) {
                axis.hidden = false;
            }
        }
        filter.column_visibility = true;
    }
}

impl Spreadsheet {
    /// Distinct display values, counts and current value-filter selection.
    pub fn table_filter_values(
        &self,
        index: usize,
        column: usize,
        limit: usize,
    ) -> Result<Vec<(String, usize, bool)>, String> {
        let table = self.options.tables.get(index).ok_or("Unknown table")?;
        if column > table.area[3] - table.area[1] {
            return Err("Unknown table column".into());
        }
        let field = table
            .filter
            .as_ref()
            .and_then(|f| f.fields.as_ref())
            .and_then(|fields| fields.get(&column))
            .filter(|field| {
                !field.custom
                    && field.top.is_none()
                    && field.dynamic.is_none()
                    && field.color.is_none()
            });
        let mut work = limit;
        let selected = field
            .map(|field| {
                field
                    .conditions
                    .iter()
                    .map(|(_, v)| {
                        collation::key(v, false, &mut work).ok_or_else(|| LIMIT.to_string())
                    })
                    .collect::<Result<BTreeSet<_>, _>>()
            })
            .transpose()?;
        let mut values = BTreeMap::new();
        for row in
            table.area[0] + usize::from(table.header)..table.area[2] + 1 - usize::from(table.totals)
        {
            work = work.checked_sub(128).ok_or(LIMIT)?;
            let value = self.display(table.sheet, row, table.area[1] + column, work)?;
            let key = collation::key(&value, false, &mut work).ok_or(LIMIT)?;
            let included = selected.as_ref().is_none_or(|values| values.contains(&key));
            values.entry(key).or_insert((value, 0, included)).1 += 1;
        }
        Ok(values.into_values().collect())
    }
    /// Applies a value checklist in one Rust batch. `values` is the initial
    /// inclusion list (or exclusion list when all=true); changes override it.
    /// Existing date-group clauses remain selected independently of value labels.
    pub fn filter_table_selection(
        &mut self,
        index: usize,
        column: usize,
        all: bool,
        values: &[String],
        changes: &[(String, bool)],
        limit: usize,
    ) -> Result<(), String> {
        let mut work = limit / 3;
        let mut selected = BTreeMap::new();
        if all {
            for (value, _, _) in self.table_filter_values(index, column, limit / 3)? {
                selected.insert(
                    collation::key(&value, false, &mut work).ok_or(LIMIT)?,
                    value,
                );
            }
        }
        for value in values {
            let key = collation::key(value, false, &mut work).ok_or(LIMIT)?;
            if all {
                selected.remove(&key);
            } else {
                selected.insert(key, value.clone());
            }
        }
        for (value, included) in changes {
            let key = collation::key(value, false, &mut work).ok_or(LIMIT)?;
            if *included {
                selected.insert(key, value.clone());
            } else {
                selected.remove(&key);
            }
        }
        let date_groups = self
            .options
            .tables
            .get(index)
            .and_then(|table| table.filter.as_ref())
            .and_then(|filter| filter.fields.as_ref())
            .and_then(|fields| fields.get(&column))
            .map(|field| field.date_groups.as_slice())
            .unwrap_or_default();
        work = work
            .checked_sub(date_groups.len().checked_mul(128).ok_or(LIMIT)?)
            .ok_or(LIMIT)?;
        let date_groups = date_groups.to_vec();
        self.filter_table(
            index,
            column,
            Some(FilterField {
                color: None,
                dynamic: None,
                date_groups,
                top: None,
                custom: false,
                conjunction: false,
                conditions: selected
                    .into_values()
                    .map(|value| ("equal", value))
                    .collect(),
                hidden_rows: None,
            }),
            work,
        )
    }
    pub fn filtered_rows(&self, sheet: usize, limit: usize) -> Result<BTreeSet<usize>, String> {
        rows(
            self.sheets.get(sheet).ok_or("Unknown sheet")?,
            &self.options,
            sheet,
            &mut { limit },
        )
        .ok_or_else(|| LIMIT.into())
    }
    fn filter_snapshot(
        &self,
        sheet: usize,
        area: [usize; 4],
        column: usize,
        field: &FilterField,
        now: f64,
        work: &mut usize,
    ) -> Result<(Vec<usize>, Option<model::DynamicFilter>), String> {
        validate(field)?;
        if area[0] > area[2] || area[1] > area[3] || area[2] >= 1_048_576 || area[3] >= 16_384 {
            return Err("Invalid filter range".into());
        }
        if column > area[3] - area[1] {
            return Err("Unknown filter column".into());
        }
        *work = work
            .checked_sub(field.date_groups.len().checked_mul(128).ok_or(LIMIT)?)
            .ok_or(LIMIT)?;
        let date_groups = field
            .date_groups
            .iter()
            .map(Vec::as_slice)
            .collect::<BTreeSet<_>>();
        let dynamic = field
            .dynamic
            .as_ref()
            .map(|filter| dynamic::prepare(self, sheet, area, column, filter, now, work))
            .transpose()?;
        let colors = field
            .color
            .as_ref()
            .map(|filter| color::values(self, sheet, area, column, filter.font, work))
            .transpose()?;
        let threshold = if let Some(top) = &field.top {
            let mut numbers = Vec::new();
            for row in area[0] + 1..=area[2] {
                *work = work.checked_sub(128).ok_or(LIMIT)?;
                if let Some(Value::Number(number)) = self
                    .cell(sheet, row, area[1] + column)
                    .as_deref()
                    .and_then(|cell| cell.value.as_ref())
                {
                    numbers.push(*number);
                }
            }
            if numbers.is_empty() {
                None
            } else {
                let count = if top.percent {
                    (numbers.len() as f64 * top.rank / 100.).ceil()
                } else {
                    top.rank.floor()
                }
                .clamp(1., numbers.len() as f64) as usize;
                let at = if top.bottom {
                    count - 1
                } else {
                    numbers.len() - count
                };
                Some(*numbers.select_nth_unstable_by(at, f64::total_cmp).1)
            }
        } else {
            None
        };
        let accepted = if field.custom
            || field.top.is_some()
            || field.dynamic.is_some()
            || field.color.is_some()
        {
            None
        } else {
            Some(
                field
                    .conditions
                    .iter()
                    .map(|(_, value)| {
                        collation::key(value, false, work).ok_or_else(|| LIMIT.to_string())
                    })
                    .collect::<Result<BTreeSet<_>, _>>()?,
            )
        };
        let mut hidden = Vec::new();
        for row in area[0] + 1..=area[2] {
            *work = work.checked_sub(128).ok_or(LIMIT)?;
            let cell = self.cell(sheet, row, area[1] + column);
            let cell = cell.as_deref();
            if let Some(filter) = &field.color {
                let color = &colors.as_ref().unwrap()[row - area[0] - 1];
                let matched = match (color.as_deref(), filter.color.as_deref()) {
                    (Some(a), Some(b)) => a[2..].eq_ignore_ascii_case(&b[2..]),
                    (None, None) => true,
                    _ => false,
                };
                if !matched {
                    hidden.push(row);
                }
                continue;
            }
            if let Some(dynamic) = &dynamic {
                if !dynamic::matches(
                    dynamic,
                    cell.and_then(|cell| cell.value.as_ref()),
                    self.options.date1904,
                ) {
                    hidden.push(row);
                }
                continue;
            }
            if let Some(top) = &field.top {
                let accepted = threshold.is_some_and(|threshold| {
                    matches!(cell.and_then(|cell| cell.value.as_ref()), Some(Value::Number(value))
                        if if top.bottom { *value <= threshold } else { *value >= threshold })
                });
                if !accepted {
                    hidden.push(row);
                }
                continue;
            }
            let display = if field.custom {
                match cell.and_then(|c| c.value.as_ref()) {
                    Some(Value::Number(n)) => n.to_string(),
                    Some(Value::Text(s)) => s.clone(),
                    Some(Value::Error(_)) => self.display(sheet, row, area[1] + column, *work)?,
                    Some(Value::Bool(b)) => if *b { "TRUE" } else { "FALSE" }.into(),
                    _ => String::new(),
                }
            } else {
                self.display(sheet, row, area[1] + column, *work)?
            };
            let accepted = if let Some(accepted) = &accepted {
                if !date_groups.is_empty() {
                    *work = work.checked_sub(256).ok_or(LIMIT)?;
                }
                accepted.contains(&collation::key(&display, false, work).ok_or(LIMIT)?)
                    || date_matches(
                        cell.and_then(|cell| cell.value.as_ref()),
                        self.options.date1904,
                        &date_groups,
                    )
            } else {
                matches(field, cell.and_then(|c| c.value.as_ref()), &display, work)?
            };
            if !accepted {
                hidden.push(row);
            }
        }
        Ok((hidden, dynamic))
    }
    pub(super) fn prepare_filter_snapshots(&mut self, limit: usize) -> Result<(), String> {
        let mut work = limit;
        let mut updates = Vec::new();
        let now = super::formulas::clock::now_ms();
        for (i, table) in self.options.tables.iter().enumerate() {
            if let Some(filter) = &table.filter {
                for (&column, field) in filter.fields.iter().flat_map(|fields| fields.iter()) {
                    if field.hidden_rows.is_none() {
                        updates.push((
                            true,
                            i,
                            column,
                            self.filter_snapshot(
                                table.sheet,
                                filter.area,
                                column,
                                field,
                                now,
                                &mut work,
                            )?,
                        ));
                    }
                }
            }
        }
        for (i, sheet) in self.sheets.iter().enumerate() {
            if let Some(filter) = &sheet.filter {
                for (&column, field) in filter.fields.iter().flat_map(|fields| fields.iter()) {
                    if field.hidden_rows.is_none() {
                        updates.push((
                            false,
                            i,
                            column,
                            self.filter_snapshot(i, filter.area, column, field, now, &mut work)?,
                        ));
                    }
                }
            }
        }
        let mut changed_visibility = false;
        for (table, i, column, (hidden, dynamic)) in updates {
            let filter = if table {
                self.options.tables[i].filter.as_mut()
            } else {
                self.sheets[i].filter.as_mut()
            }
            .unwrap();
            changed_visibility |= filter.column_visibility;
            let field = filter.fields.as_mut().unwrap().get_mut(&column).unwrap();
            field.hidden_rows = Some(hidden);
            field.dynamic = dynamic;
        }
        if changed_visibility {
            self.spills = super::formulas::cache(&mut self.sheets, &self.options, None, work, true)
                .ok_or(LIMIT)?;
        }
        Ok(())
    }
    fn activate_table_filter(&mut self, index: usize) -> Result<(), String> {
        let table = &mut self.options.tables[index];
        if !table.header {
            return Err("Table filters require a header row".into());
        }
        let filter = table.filter.get_or_insert_with(|| Filter {
            column_visibility: true,
            area: [
                table.area[0],
                table.area[1],
                table.area[2] - usize::from(table.totals),
                table.area[3],
            ],
            fields: Some(BTreeMap::new()),
            show_buttons: true,
        });
        activate(filter, &mut self.sheets[table.sheet].rows);
        Ok(())
    }
    /// Edit an existing worksheet autofilter without creating an Excel table.
    pub fn filter_sheet(
        &mut self,
        sheet: usize,
        column: usize,
        field: Option<FilterField>,
        limit: usize,
    ) -> Result<(), String> {
        let filter = self
            .sheets
            .get(sheet)
            .and_then(|s| s.filter.as_ref())
            .ok_or("Unknown worksheet filter")?;
        if column > filter.area[3] - filter.area[1] {
            return Err("Unknown filter column".into());
        }
        if let Some(field) = &field {
            validate(field)?;
        }
        let area = filter.area;
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        let target = &mut next.sheets[sheet];
        activate(target.filter.as_mut().unwrap(), &mut target.rows);
        let mut work = limit / 2;
        let field = field
            .map(|mut field| -> Result<_, String> {
                if let Some(dynamic) = &mut field.dynamic {
                    dynamic.value = None;
                    dynamic.max_value = None;
                }
                let (hidden, dynamic) = next.filter_snapshot(
                    sheet,
                    area,
                    column,
                    &field,
                    super::formulas::clock::now_ms(),
                    &mut work,
                )?;
                field.hidden_rows = Some(hidden);
                field.dynamic = dynamic;
                Ok(field)
            })
            .transpose()?;
        let fields = next.sheets[sheet]
            .filter
            .as_mut()
            .unwrap()
            .fields
            .get_or_insert_with(BTreeMap::new);
        if let Some(field) = field {
            fields.insert(column, field);
        } else {
            fields.remove(&column);
        }
        next.spills = super::formulas::cache(&mut next.sheets, &next.options, None, work, true)
            .ok_or(LIMIT)?;
        *self = next;
        Ok(())
    }
    pub fn reapply_sheet_filter(&mut self, sheet: usize, limit: usize) -> Result<(), String> {
        self.sheets
            .get(sheet)
            .and_then(|s| s.filter.as_ref())
            .ok_or("Unknown worksheet filter")?;
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        let target = &mut next.sheets[sheet];
        let filter = target.filter.as_mut().unwrap();
        activate(filter, &mut target.rows);
        for field in filter
            .fields
            .iter_mut()
            .flat_map(|fields| fields.values_mut())
        {
            field.hidden_rows = None;
            if let Some(dynamic) = &mut field.dynamic {
                dynamic.value = None;
                dynamic.max_value = None;
            }
        }
        next.prepare_filter_snapshots(limit / 4)?;
        next.spills =
            super::formulas::cache(&mut next.sheets, &next.options, None, limit / 4, true)
                .ok_or(LIMIT)?;
        *self = next;
        Ok(())
    }
    pub fn filter_table(
        &mut self,
        index: usize,
        column: usize,
        field: Option<FilterField>,
        limit: usize,
    ) -> Result<(), String> {
        let table = self.options.tables.get(index).ok_or("Unknown table")?;
        if column > table.area[3] - table.area[1] {
            return Err("Unknown table column".into());
        }
        if let Some(field) = &field {
            validate(field)?;
        }
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        next.activate_table_filter(index)?;
        let table = &next.options.tables[index];
        let mut work = limit / 2;
        let field = field
            .map(|mut field| -> Result<_, String> {
                if let Some(dynamic) = &mut field.dynamic {
                    dynamic.value = None;
                    dynamic.max_value = None;
                }
                let (hidden, dynamic) = next.filter_snapshot(
                    table.sheet,
                    table.filter.as_ref().unwrap().area,
                    column,
                    &field,
                    super::formulas::clock::now_ms(),
                    &mut work,
                )?;
                field.hidden_rows = Some(hidden);
                field.dynamic = dynamic;
                Ok(field)
            })
            .transpose()?;
        let fields = next.options.tables[index]
            .filter
            .as_mut()
            .unwrap()
            .fields
            .get_or_insert_with(BTreeMap::new);
        if let Some(field) = field {
            fields.insert(column, field);
        } else {
            fields.remove(&column);
        }
        next.spills = super::formulas::cache(&mut next.sheets, &next.options, None, work, true)
            .ok_or(LIMIT)?;
        *self = next;
        Ok(())
    }
    pub fn reapply_table_filter(&mut self, index: usize, limit: usize) -> Result<(), String> {
        self.options.tables.get(index).ok_or("Unknown table")?;
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        next.activate_table_filter(index)?;
        for field in next.options.tables[index]
            .filter
            .as_mut()
            .unwrap()
            .fields
            .iter_mut()
            .flat_map(|fields| fields.values_mut())
        {
            field.hidden_rows = None;
            if let Some(dynamic) = &mut field.dynamic {
                dynamic.value = None;
                dynamic.max_value = None;
            }
        }
        next.prepare_filter_snapshots(limit / 4)?;
        next.spills =
            super::formulas::cache(&mut next.sheets, &next.options, None, limit / 4, true)
                .ok_or(LIMIT)?;
        *self = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closedxml_date_groups_keep_visibility_through_json_and_excel() {
        // ClosedXML 057f5976c788d97e8eac86d1a528bd5411d9386e,
        // Resource/Examples/AutoFilter/DateTimeGroupAutoFilter.xlsx (MIT).
        let bytes = include_bytes!("fixtures/closedxml-date-groups.xlsx");
        let mut book = Spreadsheet::import_xlsx(bytes, 20_000_000).unwrap();
        for _ in 0..2 {
            assert_eq!(
                book.filtered_rows(0, 1_000_000).unwrap(),
                [1, 2, 5, 6].into()
            );
            book = Spreadsheet::from_json(&book.to_json(), 20_000_000).unwrap();
            assert_eq!(
                book.filtered_rows(0, 1_000_000).unwrap(),
                [1, 2, 5, 6].into()
            );
            book = Spreadsheet::import_xlsx(&book.export_xlsx(20_000_000).unwrap(), 20_000_000)
                .unwrap();
        }
    }
    #[test]
    fn libreoffice_top_filter_keeps_excel_visibility_through_json_and_xlsx() {
        // LibreOffice sc/qa/unit/data/xlsx/tdf143068_top10filter.xlsx
        // at d79de2a2975db6b34f47b7ccfe8d18692373d6f0
        // (MPL-2.0; LICENSE.LibreOffice): Excel selects 7, 8, 9, 10.
        let bytes = include_bytes!("fixtures/libreoffice-top10.xlsx");
        let mut book = Spreadsheet::import_xlsx(bytes, 20_000_000).unwrap();
        for _ in 0..2 {
            assert_eq!(book.filtered_rows(0, 1_000_000).unwrap(), (1..7).collect());
            assert_eq!(book.input(0, 7, 0), "7");
            book = Spreadsheet::from_json(&book.to_json(), 20_000_000).unwrap();
            assert_eq!(book.filtered_rows(0, 1_000_000).unwrap(), (1..7).collect());
            book = Spreadsheet::import_xlsx(&book.export_xlsx(20_000_000).unwrap(), 20_000_000)
                .unwrap();
        }
    }

    fn date_filter(groups: Vec<Vec<usize>>, values: &[&str]) -> FilterField {
        FilterField {
            color: None,
            dynamic: None,
            date_groups: groups,
            top: None,
            hidden_rows: None,
            custom: false,
            conjunction: false,
            conditions: values
                .iter()
                .map(|value| ("equal", (*value).into()))
                .collect(),
        }
    }

    #[test]
    fn date_groups_match_all_calendar_depths_and_both_excel_epochs() {
        for date1904 in [false, true] {
            let mut book = Spreadsheet::new();
            book.options.date1904 = date1904;
            book.edit(
                &[
                    (0, 0, 0, "Date"),
                    (0, 1, 0, "=DATE(2024,2,29)+TIME(12,34,56)"),
                    (0, 2, 0, "=DATE(2024,2,29)+TIME(12,34,57)"),
                    (0, 3, 0, "=DATE(2024,2,29)+TIME(12,35,0)"),
                    (0, 4, 0, "=DATE(2024,2,29)+TIME(13,0,0)"),
                    (0, 5, 0, "=DATE(2024,2,28)"),
                    (0, 6, 0, "=DATE(2024,3,1)"),
                    (0, 7, 0, "=DATE(2023,2,28)"),
                    (0, 8, 0, "'2024-02-29"),
                    (0, 9, 0, "TRUE"),
                    (0, 10, 0, "=NA()"),
                    (0, 11, 0, "=DATE(2024,2,29)+TIME(12,34,56)+0.9/86400"),
                ],
                20_000_000,
            )
            .unwrap();
            book.add_table(0, "Dates", [0, 0, 12, 0], 20_000_000)
                .unwrap();
            for (parts, visible) in [
                (vec![2024], vec![1, 2, 3, 4, 5, 6, 11]),
                (vec![2024, 2], vec![1, 2, 3, 4, 5, 11]),
                (vec![2024, 2, 29], vec![1, 2, 3, 4, 11]),
                (vec![2024, 2, 29, 12], vec![1, 2, 3, 11]),
                (vec![2024, 2, 29, 12, 34], vec![1, 2, 11]),
                (vec![2024, 2, 29, 12, 34, 56], vec![1, 11]),
            ] {
                book.filter_table(
                    0,
                    0,
                    Some(date_filter(vec![parts.clone()], &[])),
                    20_000_000,
                )
                .unwrap();
                let hidden = book.filtered_rows(0, 1_000_000).unwrap();
                assert_eq!(
                    (1..=12)
                        .filter(|row| !hidden.contains(row))
                        .collect::<Vec<_>>(),
                    visible,
                    "{date1904} {parts:?}"
                );
                let restored = Spreadsheet::from_json(&book.to_json(), 20_000_000).unwrap();
                assert_eq!(
                    restored.options.tables[0]
                        .filter
                        .as_ref()
                        .unwrap()
                        .fields
                        .as_ref()
                        .unwrap()[&0]
                        .date_groups,
                    vec![parts]
                );
                let restored = Spreadsheet::import_xlsx(
                    &restored.export_xlsx(20_000_000).unwrap(),
                    20_000_000,
                )
                .unwrap();
                assert_eq!(restored.filtered_rows(0, 1_000_000).unwrap(), hidden);
            }
        }
    }

    #[test]
    fn closedxml_date_groups_and_regular_values_can_be_used_together() {
        // Port of RegularFilterTests.DateTimeGrouping_and_regular_values_can_be_used_together
        // from ClosedXML 057f5976c788d97e8eac86d1a528bd5411d9386e (MIT).
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 0, "Data"),
                (0, 1, 0, "1"),
                (0, 2, 0, "2"),
                (0, 3, 0, "=DATE(2015,7,25)"),
                (0, 4, 0, "=DATE(2015,8,25)"),
            ],
            20_000_000,
        )
        .unwrap();
        book.add_table(0, "Dates", [0, 0, 4, 0], 20_000_000)
            .unwrap();
        book.filter_table(
            0,
            0,
            Some(date_filter(vec![vec![2015, 8]], &["1"])),
            20_000_000,
        )
        .unwrap();
        book.filter_table_selection(0, 0, false, &["1".into()], &[], 20_000_000)
            .unwrap();
        for _ in 0..2 {
            book.reapply_table_filter(0, 20_000_000).unwrap();
            let hidden = book.filtered_rows(0, 1_000_000).unwrap();
            assert_eq!(
                (1..=4)
                    .map(|row| !hidden.contains(&row))
                    .collect::<Vec<_>>(),
                [true, false, false, true]
            );
            book = Spreadsheet::from_json(&book.to_json(), 20_000_000).unwrap();
            book = Spreadsheet::import_xlsx(&book.export_xlsx(20_000_000).unwrap(), 20_000_000)
                .unwrap();
        }
    }

    #[test]
    fn date_groups_keep_snapshots_and_combine_blanks_and_multiple_groups() {
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 0, "Dates"),
                (0, 1, 0, "60"),
                (0, 2, 0, "61"),
                (0, 3, 0, "-1"),
                (0, 4, 0, "=DATE(2000,2,29)"),
                (0, 5, 0, "=DATE(9999,12,31)"),
                (0, 6, 0, "2958466"),
            ],
            20_000_000,
        )
        .unwrap();
        book.add_table(0, "Dates", [0, 0, 7, 0], 20_000_000)
            .unwrap();
        book.filter_table(
            0,
            0,
            Some(date_filter(
                vec![vec![1900, 2, 29], vec![2000, 2], vec![9999]],
                &[""],
            )),
            20_000_000,
        )
        .unwrap();
        assert_eq!(book.filtered_rows(0, 1_000_000).unwrap(), [2, 3, 6].into());
        book.edit(&[(0, 1, 0, "61")], 20_000_000).unwrap();
        assert_eq!(book.filtered_rows(0, 1_000_000).unwrap(), [2, 3, 6].into());
        book = Spreadsheet::from_json(&book.to_json(), 20_000_000).unwrap();
        book.reapply_table_filter(0, 20_000_000).unwrap();
        assert_eq!(
            book.filtered_rows(0, 1_000_000).unwrap(),
            [1, 2, 3, 6].into()
        );
    }

    #[test]
    fn date_groups_reject_invalid_calendars_and_budget_exhaustion_atomically() {
        let mut book = Spreadsheet::new();
        book.edit(
            &[(0, 0, 0, "Dates"), (0, 1, 0, "=DATE(2024,2,29)")],
            20_000_000,
        )
        .unwrap();
        book.add_table(0, "Dates", [0, 0, 1, 0], 20_000_000)
            .unwrap();
        let before = book.to_json();
        for parts in [
            vec![],
            vec![0],
            vec![10000],
            vec![2024, 0],
            vec![2024, 13],
            vec![2024, 2, 30],
            vec![2100, 2, 29],
            vec![2024, 1, 0],
            vec![2024, 1, 1, 24],
            vec![2024, 1, 1, 0, 60],
            vec![2024, 1, 1, 0, 0, 60],
            vec![2024, 1, 1, 0, 0, 0, 0],
        ] {
            assert!(
                book.filter_table(0, 0, Some(date_filter(vec![parts], &[])), 20_000_000)
                    .is_err()
            );
            assert_eq!(book.to_json(), before);
        }
        let mut custom = date_filter(vec![vec![2024]], &["1"]);
        custom.custom = true;
        assert!(book.filter_table(0, 0, Some(custom), 20_000_000).is_err());
        assert!(
            book.filter_table(0, 0, Some(date_filter(vec![vec![2024]; 1000], &[])), 10000)
                .is_err()
        );
        assert_eq!(book.to_json(), before);
    }

    fn top_filter(rank: f64, percent: bool, bottom: bool) -> FilterField {
        FilterField {
            color: None,
            dynamic: None,
            date_groups: Vec::new(),
            top: Some(model::TopFilter {
                rank,
                percent,
                bottom,
            }),
            hidden_rows: None,
            custom: false,
            conjunction: false,
            conditions: Vec::new(),
        }
    }
    #[test]
    fn closedxml_top_bottom_cutoffs_and_percent_boundaries() {
        // Ported from ClosedXML.Tests/Excel/AutoFilters/Top10FilterTests.cs
        // at 057f5976c788d97e8eac86d1a528bd5411d9386e (LICENSE.ClosedXML).
        for (bottom, rank, percent, values, expected) in [
            (false, 3., false, vec![4, 4, 1, 3, 2, 5], vec![1, 2, 6]),
            (
                false,
                2.,
                false,
                vec![5, 4, 4, 4, 3, 2, 1],
                vec![1, 2, 3, 4],
            ),
            (false, 2., false, vec![5, 5, 4, 4, 4, 3, 2, 1], vec![1, 2]),
            (true, 2., false, vec![1, 2, 2, 2, 3, 4, 5], vec![1, 2, 3, 4]),
            (true, 2., false, vec![1, 1, 2, 2, 2, 3, 4, 5], vec![1, 2]),
            (
                false,
                25.,
                true,
                (1..=1000).collect(),
                (751..=1000).collect(),
            ),
            (true, 25., true, (1..=1000).collect(), (1..=250).collect()),
            (false, 1., true, vec![3, 2, 1], vec![1]),
            (true, 1., true, vec![1, 2, 3], vec![1]),
            // Fractional counts round up in both directions.
            (false, 50., true, vec![1, 2, 3], vec![2, 3]),
            (true, 50., true, vec![1, 2, 3], vec![1, 2]),
        ] {
            let mut book = Spreadsheet::new();
            let values = values.iter().map(ToString::to_string).collect::<Vec<_>>();
            let cells = values
                .iter()
                .enumerate()
                .map(|(i, v)| (0, i + 1, 0, v.as_str()))
                .collect::<Vec<_>>();
            book.edit(&cells, 20_000_000).unwrap();
            book.add_table(0, "Data", [0, 0, values.len(), 0], 20_000_000)
                .unwrap();
            book.filter_table(0, 0, Some(top_filter(rank, percent, bottom)), 20_000_000)
                .unwrap();
            let hidden = book.filtered_rows(0, 1_000_000).unwrap();
            assert_eq!(
                (1..=values.len())
                    .filter(|r| !hidden.contains(r))
                    .collect::<Vec<_>>(),
                expected
            );
        }
    }
    #[test]
    fn top_filters_rank_columns_independently_excluding_headers_and_totals() {
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 0, "1000"),
                (0, 0, 1, "Other"),
                (0, 1, 0, "10"),
                (0, 1, 1, "1"),
                (0, 2, 0, "9"),
                (0, 2, 1, "8"),
                (0, 3, 0, "8"),
                (0, 3, 1, "9"),
                (0, 4, 0, "1"),
                (0, 4, 1, "10"),
                (0, 5, 0, "=SUM(A2:A5)"),
                (0, 5, 1, "=SUM(B2:B5)"),
            ],
            10_000_000,
        )
        .unwrap();
        book.add_table(0, "Sales", [0, 0, 5, 1], 10_000_000)
            .unwrap();
        book.options.tables[0].totals = true;
        book.options.tables[0].filter = None;
        book.filter_table(0, 0, Some(top_filter(3., false, false)), 10_000_000)
            .unwrap();
        book.filter_table(0, 1, Some(top_filter(2., false, false)), 10_000_000)
            .unwrap();
        assert_eq!(
            book.filtered_rows(0, 1_000_000).unwrap(),
            [1, 2, 4].into_iter().collect()
        );
        book.edit_axis(0, false, 2, 1, 10_000_000).unwrap();
        assert_eq!(
            book.filtered_rows(0, 1_000_000).unwrap(),
            [1, 3, 5].into_iter().collect()
        );
        book = Spreadsheet::from_json(&book.to_json(), 10_000_000).unwrap();
        book.reapply_table_filter(0, 10_000_000).unwrap();
        assert_eq!(
            book.filtered_rows(0, 1_000_000).unwrap(),
            [1, 2, 3, 5].into_iter().collect()
        );
        book.filter_table(0, 1, None, 10_000_000).unwrap();
        assert_eq!(
            book.filtered_rows(0, 1_000_000).unwrap(),
            [2, 5].into_iter().collect()
        );
    }
    #[test]
    fn top_bottom_filters_include_ties_and_ignore_non_numeric_cells() {
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 0, "Amount"),
                (0, 0, 1, "Group"),
                (0, 1, 0, "10"),
                (0, 2, 0, "8"),
                (0, 3, 0, "8"),
                (0, 4, 0, "2"),
                (0, 5, 0, "-3"),
                (0, 6, 0, "'99"),
                (0, 7, 0, "TRUE"),
                (0, 8, 0, "=1/0"),
                (0, 10, 0, "=\"\""),
                (0, 11, 0, "=6+6"),
                (0, 1, 1, "x"),
                (0, 11, 1, "y"),
            ],
            10_000_000,
        )
        .unwrap();
        book.add_table(0, "Sales", [0, 0, 11, 1], 10_000_000)
            .unwrap();
        for (rank, percent, bottom, visible) in [
            (2., false, false, vec![1, 11]),
            (3., false, false, vec![1, 2, 3, 11]),
            (2., false, true, vec![4, 5]),
            (50., true, false, vec![1, 2, 3, 11]),
            (10., true, false, vec![11]),
            (100., true, true, vec![1, 2, 3, 4, 5, 11]),
        ] {
            book.filter_table(0, 0, Some(top_filter(rank, percent, bottom)), 10_000_000)
                .unwrap();
            let hidden = book.filtered_rows(0, 1_000_000).unwrap();
            assert_eq!(
                (1..12).filter(|r| !hidden.contains(r)).collect::<Vec<_>>(),
                visible,
                "rank={rank}, percent={percent}, bottom={bottom}"
            );
        }
        book.filter_table(0, 0, Some(top_filter(2., false, false)), 10_000_000)
            .unwrap();
        book.edit(&[(0, 1, 0, "1")], 10_000_000).unwrap();
        for _ in 0..2 {
            let hidden = book.filtered_rows(0, 1_000_000).unwrap();
            assert_eq!(
                (1..12).filter(|r| !hidden.contains(r)).collect::<Vec<_>>(),
                vec![1, 11]
            );
            book = Spreadsheet::from_json(&book.to_json(), 20_000_000).unwrap();
            book = Spreadsheet::import_xlsx(&book.export_xlsx(20_000_000).unwrap(), 20_000_000)
                .unwrap();
        }
        book.reapply_table_filter(0, 10_000_000).unwrap();
        let hidden = book.filtered_rows(0, 1_000_000).unwrap();
        assert_eq!(
            (1..12).filter(|r| !hidden.contains(r)).collect::<Vec<_>>(),
            vec![2, 3, 11]
        );
    }
    #[test]
    fn top_filters_reject_invalid_settings_and_exhaustion_atomically() {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, "Amount"), (0, 1, 0, "text")], 10_000_000)
            .unwrap();
        book.add_table(0, "Sales", [0, 0, 2, 0], 10_000_000)
            .unwrap();
        let before = book.to_json();
        for rank in [0., -1., f64::NAN, f64::INFINITY, 101.] {
            assert!(
                book.filter_table(0, 0, Some(top_filter(rank, true, false)), 10_000_000)
                    .is_err()
            );
            assert_eq!(book.to_json(), before);
        }
        assert!(
            book.filter_table(0, 0, Some(top_filter(501., false, false)), 10_000_000)
                .is_err()
        );
        let mut mixed = top_filter(1., false, false);
        mixed.conditions.push(("equal", "1".into()));
        assert!(book.filter_table(0, 0, Some(mixed), 10_000_000).is_err());
        assert!(
            book.filter_table(0, 0, Some(top_filter(1., false, false)), 1)
                .is_err()
        );
        assert_eq!(book.to_json(), before);
        book.filter_table(0, 0, Some(top_filter(1., false, false)), 10_000_000)
            .unwrap();
        assert_eq!(
            book.filtered_rows(0, 1_000_000).unwrap(),
            [1, 2].into_iter().collect()
        );
    }

    // Assertions ported from Univer custom-filter.spec.ts at
    // 4767b3b309467c283bbd52b725536ca73861e0fc (see LICENSE.Univer).
    #[test]
    fn univer_numeric_conditions_require_number_cells() {
        for (op, expected) in [
            ("greaterThan", [true, false, false]),
            ("greaterThanOrEqual", [true, true, false]),
            ("lessThan", [false, false, true]),
            ("lessThanOrEqual", [false, true, true]),
            ("equal", [false, true, false]),
            ("notEqual", [true, false, true]),
        ] {
            assert_eq!(
                condition(Some(&Value::Text("1".into())), "1", op, "0", &mut 10_000).unwrap(),
                op == "notEqual"
            );
            for (value, expected) in [1., 0., -1.].into_iter().zip(expected) {
                assert_eq!(
                    condition(Some(&Value::Number(value)), "", op, "0", &mut 10_000).unwrap(),
                    expected
                );
            }
        }
    }
    #[test]
    fn univer_custom_text_wildcards_are_anchored_and_do_not_cross_line_breaks() {
        for (value, pattern, expected) in [
            ("hello world", "hello*", true),
            ("hello", "hello*", true),
            ("hell", "hello*", false),
            ("hello world", "*world", true),
            ("world", "*world", true),
            ("wrld", "*world", false),
            ("hello world", "*llo w*", true),
            ("hell world", "*llo w*", false),
            ("hello", "hell?", true),
            ("helloooo", "hell?", false),
            ("helloooo", "hell?ooo", true),
            ("hello world", "hell?", false),
            ("hello", "?hell?", false),
            ("yhell", "?hell?", false),
            ("hello111", "*hello?*", true),
            ("hello111\r\n", "*hello?*", false),
            ("hello", "*hello?*", false),
            ("HELLO", "hello*", true),
            ("a*b", "a~*b", true),
            ("ab", "a~*b", false),
        ] {
            assert_eq!(
                condition(
                    Some(&Value::Text(value.into())),
                    value,
                    "equal",
                    pattern,
                    &mut 100_000
                )
                .unwrap(),
                expected,
                "{value:?} {pattern}"
            );
        }
        assert!(
            !condition(
                Some(&Value::Number(123.)),
                "123",
                "notEqual",
                "*123*",
                &mut 10_000
            )
            .unwrap()
        );
        assert!(
            condition(
                Some(&Value::Text("12".into())),
                "12",
                "notEqual",
                "*123*",
                &mut 10_000
            )
            .unwrap()
        );
    }
    #[test]
    fn values_lists_use_literal_display_values_and_keep_blanks_distinct_from_zero_and_false() {
        let values = FilterField {
            color: None,
            dynamic: None,
            date_groups: Vec::new(),
            top: None,
            custom: false,
            conditions: vec![
                ("equal", "a*".into()),
                ("equal", "$7.00".into()),
                ("equal", "".into()),
            ],
            conjunction: false,
            hidden_rows: None,
        };
        for (value, display, expected) in [
            (None, "", true),
            (Some(Value::Number(0.)), "0", false),
            (Some(Value::Bool(false)), "FALSE", false),
            (Some(Value::Number(7.)), "$7.00", true),
            (Some(Value::Text("a*".into())), "a*", true),
            (Some(Value::Text("abc".into())), "abc", false),
        ] {
            assert_eq!(
                matches(&values, value.as_ref(), display, &mut 100_000).unwrap(),
                expected
            );
        }
        assert!(condition(None, "", "equal", "", &mut 10_000).unwrap());
        assert!(!condition(Some(&Value::Bool(false)), "FALSE", "equal", "", &mut 10_000).unwrap());
        let none = FilterField {
            color: None,
            dynamic: None,
            date_groups: Vec::new(),
            top: None,
            conditions: vec![],
            ..values
        };
        assert!(!matches(&none, None, "", &mut 100_000).unwrap());
    }
    #[test]
    fn conjunction_disjunction_and_expensive_patterns_are_bounded() {
        let mut field = FilterField {
            color: None,
            dynamic: None,
            date_groups: Vec::new(),
            top: None,
            custom: true,
            conditions: vec![("greaterThan", "2".into()), ("lessThan", "5".into())],
            conjunction: true,
            hidden_rows: None,
        };
        assert!(matches(&field, Some(&Value::Number(3.)), "3", &mut 10_000).unwrap());
        assert!(!matches(&field, Some(&Value::Number(7.)), "7", &mut 10_000).unwrap());
        field.conjunction = false;
        assert!(matches(&field, Some(&Value::Number(7.)), "7", &mut 10_000).unwrap());
        let pattern = "*?".repeat(100);
        assert!(
            condition(
                Some(&Value::Text("a".repeat(500))),
                &"a".repeat(500),
                "equal",
                &pattern,
                &mut 100
            )
            .is_err()
        );
    }
}

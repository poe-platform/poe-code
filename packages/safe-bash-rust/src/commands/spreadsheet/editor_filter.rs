//! Column filter snapshots and typed conditions, adapted from Univer's
//! sheets-filter/models/{filter-model,custom-filters}.ts (Apache-2.0).
use super::{
    Spreadsheet, collation,
    model::{self, Filter, FilterField, Value},
    wildcard,
};
use std::collections::{BTreeMap, BTreeSet};
const LIMIT: &str = "Table filter exceeds its limit";

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
fn validate(field: &FilterField) -> Result<(), String> {
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
            .filter(|field| !field.custom);
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
        self.filter_table(
            index,
            column,
            Some(FilterField {
                custom: false,
                conjunction: false,
                conditions: selected
                    .into_values()
                    .map(|value| ("equal", value))
                    .collect(),
                hidden_rows: None,
            }),
            limit / 3,
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
        work: &mut usize,
    ) -> Result<Vec<usize>, String> {
        validate(field)?;
        if area[0] > area[2] || area[1] > area[3] || area[2] >= 1_048_576 || area[3] >= 16_384 {
            return Err("Invalid filter range".into());
        }
        if column > area[3] - area[1] {
            return Err("Unknown filter column".into());
        }
        let accepted = if field.custom {
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
            let cell = self.sheets[sheet].cells.get(&(row, area[1] + column));
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
                accepted.contains(&collation::key(&display, false, work).ok_or(LIMIT)?)
            } else {
                matches(field, cell.and_then(|c| c.value.as_ref()), &display, work)?
            };
            if !accepted {
                hidden.push(row);
            }
        }
        Ok(hidden)
    }
    pub(super) fn prepare_filter_snapshots(&mut self, limit: usize) -> Result<(), String> {
        let mut work = limit;
        let mut updates = Vec::new();
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
                            self.filter_snapshot(i, filter.area, column, field, &mut work)?,
                        ));
                    }
                }
            }
        }
        let mut changed_visibility = false;
        for (table, i, column, hidden) in updates {
            let filter = if table {
                self.options.tables[i].filter.as_mut()
            } else {
                self.sheets[i].filter.as_mut()
            }
            .unwrap();
            changed_visibility |= filter.column_visibility;
            filter
                .fields
                .as_mut()
                .unwrap()
                .get_mut(&column)
                .unwrap()
                .hidden_rows = Some(hidden);
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
        if !filter.column_visibility {
            if filter.area[0] < filter.area[2]
                && filter
                    .fields
                    .as_ref()
                    .is_some_and(|fields| !fields.is_empty())
            {
                // Legacy Excel stores its aggregate filter mask in row.hidden.
                // Once reapplied, independent column snapshots own that mask.
                for (_, axis) in self.sheets[table.sheet]
                    .rows
                    .range_mut(filter.area[0] + 1..=filter.area[2])
                {
                    axis.hidden = false;
                }
            }
            filter.column_visibility = true;
        }
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
                field.hidden_rows = Some(next.filter_snapshot(
                    table.sheet,
                    table.filter.as_ref().unwrap().area,
                    column,
                    &field,
                    &mut work,
                )?);
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
            conditions: vec![],
            ..values
        };
        assert!(!matches(&none, None, "", &mut 100_000).unwrap());
    }
    #[test]
    fn conjunction_disjunction_and_expensive_patterns_are_bounded() {
        let mut field = FilterField {
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

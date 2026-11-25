use super::{Spreadsheet, case_fold, model};
use std::collections::BTreeSet;

pub(super) fn valid_table_name(name: &str) -> bool {
    let mut chars = name.chars();
    if name.chars().count() > 255
        || !chars
            .next()
            .is_some_and(|c| c.is_alphabetic() || matches!(c, '_' | '\\'))
        || !chars.all(|c| c.is_alphanumeric() || matches!(c, '_' | '.'))
        || ["r", "c"].iter().any(|n| name.eq_ignore_ascii_case(n))
        || super::coordinate(name).is_some()
    {
        return false;
    }
    let upper = name.to_ascii_uppercase();
    if let Some(rest) = upper.strip_prefix('R')
        && let Some((r, c)) = rest.split_once('C')
        && r.bytes().all(|c| c.is_ascii_digit())
        && c.bytes().all(|c| c.is_ascii_digit())
    {
        return false;
    }
    true
}

impl Spreadsheet {
    pub fn rename_table(&mut self, index: usize, name: &str, limit: usize) -> Result<(), String> {
        let table = self.options.tables.get(index).ok_or("Unknown table")?;
        if !valid_table_name(name)
            || self
                .options
                .tables
                .iter()
                .enumerate()
                .any(|(i, t)| i != index && case_fold::same_name(&t.name, name))
            || self
                .options
                .names
                .iter()
                .any(|n| case_fold::same_name(&n.name, name))
        {
            return Err(
                "Table names must be unique and cannot be cell references or contain spaces".into(),
            );
        }
        if table.name == name {
            return Ok(());
        }
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        let maps = [super::TableReferenceMap {
            name: &table.name,
            replacement: Some(name),
            columns: Vec::new(),
            local: false,
        }];
        let mut work = limit / 2;
        let mut rewrite = |source: &mut String| -> Result<(), String> {
            *source = super::map_table_references(source, &maps, &mut work)
                .ok_or("Table rename exceeds its formula limit")?
                .0;
            Ok(())
        };
        for sheet in &mut next.sheets {
            for cell in sheet.cells.values_mut() {
                for source in [
                    &mut cell.formula,
                    &mut cell.openformula,
                    &mut cell.formula_display,
                ]
                .into_iter()
                .flatten()
                {
                    rewrite(source)?;
                }
            }
            for array in &mut sheet.arrays {
                rewrite(&mut array.expression)?;
                for source in [&mut array.openformula, &mut array.formula_display]
                    .into_iter()
                    .flatten()
                {
                    rewrite(source)?;
                }
            }
        }
        for named in &mut next.options.names {
            rewrite(&mut named.expression)?;
            if let Some(source) = &mut named.openformula {
                rewrite(source)?;
            }
            if let Some(compiled) = &mut named.compiled {
                rewrite(&mut compiled.expression)?;
            }
        }
        for table in &mut next.options.tables {
            for column in table.calculated_columns.values_mut() {
                rewrite(&mut column.formula)?;
            }
        }
        for rule in &mut next.options.conditional_formats {
            for source in rule.rule.formulas_mut() {
                rewrite(source)?;
            }
        }
        next.options.tables[index].name = name.into();
        next.spills = super::formulas::cache(&mut next.sheets, &next.options, None, work, true)
            .ok_or("Table rename exceeds its calculation limit")?;
        *self = next;
        Ok(())
    }

    /// Removes the table definition and converts structured references to A1.
    /// Explicit cell styles and data remain; table filtering is removed.
    pub fn convert_table_to_range(&mut self, index: usize, limit: usize) -> Result<(), String> {
        let table = self.options.tables.get(index).ok_or("Unknown table")?;
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        let sheet_name = &self.sheets[table.sheet].name;
        let sheets: Vec<_> = self
            .sheets
            .iter()
            .map(|s| (s.name.clone(), String::new()))
            .collect();
        let mut work = limit / 2;
        let mut rewrite = |expression: &str,
                           original: Option<&str>,
                           position: (usize, usize, usize),
                           offset,
                           qualify_sheet,
                           compiled: bool|
         -> Result<Option<String>, String> {
            if let Some(source) = original.and_then(|s| s.strip_prefix("of:=")) {
                let converted = super::table_to_range_references(
                    source,
                    table,
                    sheet_name,
                    position,
                    qualify_sheet,
                    &mut work,
                )
                .ok_or("Table conversion exceeds its formula limit")?;
                if converted == source {
                    return Ok(None);
                }
                return Err(
                    "Table conversion for OpenFormula documents is not supported yet".into(),
                );
            }
            let source = original
                .and_then(|s| s.strip_prefix("msoxl:="))
                .unwrap_or(expression);
            // Imported symbols may intentionally bind a different name with the
            // same spelling. Token normalization would erase that distinction.
            let source = if compiled {
                std::borrow::Cow::Borrowed(source)
            } else {
                super::xlsx_import::formula_tokens(
                    source,
                    &self.options.names,
                    &sheets,
                    (Some(position.0), Some(position.0)),
                    offset,
                    super::formula_arguments::Syntax::Editor,
                    &mut work,
                )
                .ok_or("Table conversion exceeds its formula limit")?
                .text
            };
            let converted = super::table_to_range_references(
                &source,
                table,
                sheet_name,
                position,
                qualify_sheet,
                &mut work,
            )
            .ok_or("Table conversion exceeds its formula limit")?;
            Ok((converted != source).then_some(converted))
        };
        let mut origins = Vec::new();
        for (s, sheet) in next.sheets.iter_mut().enumerate() {
            for (&(r, c), cell) in &mut sheet.cells {
                if let Some(formula) = &cell.formula {
                    let (_, origin_r, origin_c) = self
                        .options
                        .formula_origins
                        .get(&(s, r, c))
                        .copied()
                        .unwrap_or((s, r, c));
                    let Some(formula) = rewrite(
                        formula,
                        cell.openformula.as_deref(),
                        (s, r, c),
                        (r as i64 - origin_r as i64, c as i64 - origin_c as i64),
                        false,
                        false,
                    )?
                    else {
                        continue;
                    };
                    origins.push((s, r, c));
                    if let Some(display) = &cell.formula_display {
                        if let Some(display) =
                            rewrite(display, None, (s, r, c), (0, 0), false, false)?
                        {
                            cell.formula_display = Some(display);
                        }
                    }
                    cell.openformula = Some(format!("msoxl:={formula}"));
                    cell.formula = Some(formula);
                    cell.value = None;
                    cell.value_format = None;
                }
            }
            for group in &mut sheet.arrays {
                let [r, c, _, _] = group.range;
                let (_, origin_r, origin_c) = self
                    .options
                    .formula_origins
                    .get(&(s, r, c))
                    .copied()
                    .unwrap_or((s, r, c));
                let Some(expression) = rewrite(
                    &group.expression,
                    group.openformula.as_deref(),
                    (s, r, c),
                    (r as i64 - origin_r as i64, c as i64 - origin_c as i64),
                    false,
                    false,
                )?
                else {
                    continue;
                };
                origins.push((s, r, c));
                group.expression = expression;
                group.openformula = Some(format!("msoxl:={}", group.expression));
                if let Some(display) = &group.formula_display {
                    if let Some(display) = rewrite(display, None, (s, r, c), (0, 0), false, false)?
                    {
                        group.formula_display = Some(display);
                    }
                }
            }
        }
        for name in &mut next.options.names {
            let (s, r, c) = name.position;
            if let Some(expression) = rewrite(
                &name.expression,
                name.openformula.as_deref(),
                (s, r.max(0) as usize, c.max(0) as usize),
                (0, 0),
                true,
                false,
            )? {
                name.expression = expression;
                name.openformula = Some(format!("msoxl:={}", name.expression));
            }
            if let Some(compiled) = &mut name.compiled
                && let Some(expression) = rewrite(
                    &compiled.expression,
                    Some(&compiled.expression),
                    (s, r.max(0) as usize, c.max(0) as usize),
                    (0, 0),
                    true,
                    true,
                )?
            {
                compiled.expression = format!("msoxl:={expression}");
            }
        }
        for target in &mut next.options.tables {
            for (&column, definition) in &mut target.calculated_columns {
                let position = (
                    target.sheet,
                    target.area[0] + usize::from(target.header),
                    target.area[1] + column,
                );
                if let Some(source) =
                    rewrite(&definition.formula, None, position, (0, 0), false, false)?
                {
                    definition.formula = source;
                }
            }
        }
        for rule in &mut next.options.conditional_formats {
            let (r, c) = rule
                .anchor()
                .ok_or("Missing conditional formatting range")?;
            for source in rule.rule.formulas_mut() {
                if let Some(converted) =
                    rewrite(source, None, (rule.sheet, r, c), (0, 0), false, false)?
                {
                    *source = converted;
                }
            }
        }
        for position in origins {
            next.options.formula_origins.remove(&position);
        }
        if let Some(filter) = &table.filter {
            if !filter.column_visibility
                && filter.fields.as_ref().is_some_and(|f| !f.is_empty())
                && filter.area[0] < filter.area[2]
            {
                for (_, axis) in next.sheets[table.sheet]
                    .rows
                    .range_mut(filter.area[0] + 1..=filter.area[2])
                {
                    axis.hidden = false;
                }
            }
        }
        for pivot in next.options.pivots.values_mut() {
            if let Some(super::PivotSource::Table(bound)) = pivot.source_binding {
                if bound == index {
                    if let Some(&(sheet, area)) =
                        self.spills
                            .pivot_sources
                            .get(&(pivot.sheet, pivot.row, pivot.column))
                    {
                        pivot.source_sheet = sheet;
                        pivot.source = area;
                        pivot.source_binding = None;
                    } else {
                        pivot.source_binding = Some(super::PivotSource::Missing);
                    }
                } else {
                    pivot.source_binding = Some(super::PivotSource::Table(
                        bound - usize::from(bound > index),
                    ));
                }
            }
        }
        next.options.tables.remove(index);
        next.spills = super::formulas::cache(&mut next.sheets, &next.options, None, work, true)
            .ok_or("Table conversion exceeds its calculation limit")?;
        *self = next;
        Ok(())
    }

    pub fn add_table(
        &mut self,
        sheet: usize,
        name: &str,
        area: [usize; 4],
        limit: usize,
    ) -> Result<(), String> {
        let [top, left, bottom, right] = area;
        if !valid_table_name(name)
            || self
                .options
                .tables
                .iter()
                .any(|t| case_fold::same_name(&t.name, name))
            || self
                .options
                .names
                .iter()
                .any(|n| case_fold::same_name(&n.name, name))
        {
            return Err(
                "Table names must be unique and cannot be cell references or contain spaces".into(),
            );
        }
        let source = self.sheets.get(sheet).ok_or("Unknown sheet")?;
        if top >= bottom || left > right || bottom >= 1_048_576 || right >= 16_384 {
            return Err("Select a header row and at least one data row".into());
        }
        if self.pivot_intersects(sheet, [top, left, right - left + 1, bottom - top + 1]) {
            return Err("Tables cannot overlap pivot tables".into());
        }
        if self.options.tables.iter().any(|t| {
            t.sheet == sheet
                && t.area[0] <= bottom
                && t.area[2] >= top
                && t.area[1] <= right
                && t.area[3] >= left
        }) || source
            .merges
            .iter()
            .chain(source.arrays.iter().map(|a| &a.range))
            .any(|[r, c, w, h]| *r <= bottom && r + h > top && *c <= right && c + w > left)
        {
            return Err(
                "Tables cannot overlap another table, merged cells or array formulas".into(),
            );
        }
        let mut work = limit
            .checked_sub((right - left + 1) * 512)
            .ok_or("Table exceeds calculation limit")?;
        let mut used = BTreeSet::new();
        let mut columns = Vec::new();
        let mut edits = Vec::new();
        for column in left..=right {
            let original = self.display(sheet, top, column, work)?;
            let original = if original.is_empty() {
                format!("Column{}", column - left + 1)
            } else {
                original
            };
            work = work
                .checked_sub(original.len() * 4 + 256)
                .ok_or("Table headers exceed calculation limit")?;
            let mut label = original.clone();
            let mut suffix = 2;
            while !used.insert(case_fold::sheet_key(&label)) {
                work = work
                    .checked_sub(label.len() + 16)
                    .ok_or("Table headers exceed calculation limit")?;
                label = format!("{original}{suffix}");
                suffix += 1;
            }
            let mut cell = source
                .cells
                .get(&(top, column))
                .cloned()
                .unwrap_or(model::TypedCell {
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
            cell.value = Some(model::Value::Text(label.clone()));
            cell.formula = None;
            cell.openformula = None;
            cell.formula_display = None;
            cell.value_format = None;
            cell.rich_text = None;
            columns.push(label);
            edits.push((sheet, top, column, Some(cell)));
        }
        self.options.tables.push(model::Table {
            style: None,
            calculated_columns: Default::default(),
            name: name.into(),
            sheet,
            area,
            header: true,
            totals: false,
            columns,
            filter: Some(model::Filter {
                column_visibility: true,
                area,
                fields: Some(Default::default()),
                show_buttons: true,
            }),
        });
        if let Err(error) = self.replace_cells(edits, work) {
            self.options.tables.pop();
            return Err(error);
        }
        Ok(())
    }

    pub(super) fn replace_table_headers(
        &mut self,
        edits: Vec<(usize, usize, usize, Option<model::TypedCell<String>>)>,
        limit: usize,
    ) -> Result<(), String> {
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        let mut work = limit / 2;
        let mut edits: std::collections::BTreeMap<_, _> = edits
            .into_iter()
            .map(|(s, r, c, cell)| ((s, r, c), cell))
            .collect();
        for (index, table) in self.options.tables.iter().enumerate() {
            if !table.header
                || !edits.keys().any(|&(s, r, c)| {
                    s == table.sheet
                        && r == table.area[0]
                        && (table.area[1]..=table.area[3]).contains(&c)
                })
            {
                continue;
            }
            let mut columns = Vec::new();
            let mut mapping = Vec::new();
            let mut used = BTreeSet::new();
            for c in table.area[1]..=table.area[3] {
                let coord = (table.sheet, table.area[0], c);
                let old = match table.columns.get(c - table.area[1]) {
                    Some(name) => name.clone(),
                    None => self.display(coord.0, coord.1, coord.2, work)?,
                };
                let original = if let Some(cell) = edits.get(&coord) {
                    match cell {
                        Some(cell) => {
                            super::csv::cell_text(
                                cell,
                                None,
                                self.options.date1904,
                                super::number_format::Mode::ExcelDisplay,
                                &mut work,
                            )
                            .ok_or("Table header exceeds formatting limit")?
                            .0
                        }
                        None => String::new(),
                    }
                } else {
                    old.clone()
                };
                let original = if original.is_empty() {
                    format!("Column{}", c - table.area[1] + 1)
                } else {
                    original
                };
                work = work
                    .checked_sub(original.len() * 4 + 256)
                    .ok_or("Table header edit exceeds calculation limit")?;
                let mut label = original.clone();
                let mut suffix = 2;
                while !used.insert(case_fold::sheet_key(&label)) {
                    work = work
                        .checked_sub(label.len() + 16)
                        .ok_or("Table headers exceed calculation limit")?;
                    label = format!("{original}{suffix}");
                    suffix += 1;
                }
                if label != old {
                    mapping.push((old, label.clone()));
                }
                let mut cell = edits
                    .remove(&coord)
                    .flatten()
                    .or_else(|| next.sheets[coord.0].cells.get(&(coord.1, coord.2)).cloned())
                    .unwrap_or(model::TypedCell {
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
                cell.value = Some(model::Value::Text(label.clone()));
                cell.formula = None;
                cell.openformula = None;
                cell.formula_display = None;
                cell.value_format = None;
                cell.rich_text = None;
                edits.insert(coord, Some(cell));
                columns.push(label);
            }
            next.options.tables[index].columns = columns;
            let mut rewrite = |source: &mut String, position| -> Result<(), String> {
                *source =
                    super::formulas::rewrite_columns(source, table, position, &mapping, &mut work)
                        .ok_or("Table reference edit exceeds calculation limit")?;
                Ok(())
            };
            for (s, sheet) in next.sheets.iter_mut().enumerate() {
                for (&(r, c), cell) in &mut sheet.cells {
                    for source in [
                        &mut cell.formula,
                        &mut cell.openformula,
                        &mut cell.formula_display,
                    ]
                    .into_iter()
                    .flatten()
                    {
                        rewrite(source, (s, r, c))?;
                    }
                }
                for array in &mut sheet.arrays {
                    let pos = (s, array.range[0], array.range[1]);
                    rewrite(&mut array.expression, pos)?;
                    for source in [&mut array.openformula, &mut array.formula_display]
                        .into_iter()
                        .flatten()
                    {
                        rewrite(source, pos)?;
                    }
                }
            }
            for target in &mut next.options.tables {
                for (&column, definition) in &mut target.calculated_columns {
                    rewrite(
                        &mut definition.formula,
                        (
                            target.sheet,
                            target.area[0] + usize::from(target.header),
                            target.area[1] + column,
                        ),
                    )?;
                }
            }
            for rule in &mut next.options.conditional_formats {
                let (r, c) = rule
                    .anchor()
                    .ok_or("Missing conditional formatting range")?;
                for source in rule.rule.formulas_mut() {
                    rewrite(source, (rule.sheet, r, c))?;
                }
            }
            for name in &mut next.options.names {
                let pos = (
                    name.position.0,
                    name.position.1.max(0) as usize,
                    name.position.2.max(0) as usize,
                );
                rewrite(&mut name.expression, pos)?;
                if let Some(source) = &mut name.openformula {
                    rewrite(source, pos)?;
                }
                if let Some(compiled) = &mut name.compiled {
                    rewrite(&mut compiled.expression, pos)?;
                }
            }
        }
        let edits = edits
            .into_iter()
            .map(|((s, r, c), cell)| (s, r, c, cell))
            .collect();
        next.replace_cells(edits, work)?;
        *self = next;
        Ok(())
    }
}

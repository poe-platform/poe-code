use super::{csv, date_serial, decimal, formulas, model, valid_sheet_name};
use std::collections::BTreeMap;

// Restrict automatic input conversion to the ISO dates already accepted by
// the editor. Reuse DATEVALUE/TIMEVALUE parsing for the attached clock and epoch.
fn datetime_input(text: &str, date1904: bool) -> Option<f64> {
    date_serial(text.get(..10)?)?;
    if !matches!(text.as_bytes().get(10), Some(b' ' | b'T' | b't')) {
        return None;
    }
    let (day, time) = formulas::date_text::parse(text, date1904)?;
    Some(day as f64 + time)
}

// IronCalc model::formula_without_prefix (f936620, MIT; LICENSE.IronCalc).
// Use the editor's supported numeric forms. Share classification with input()
// so editing a stored text cell cannot silently turn it into a formula.
fn formula_source(text: &str) -> Option<&str> {
    if let Some(source) = text.strip_prefix('=') {
        return (!source.is_empty()).then_some(source);
    }
    let rest = text.strip_prefix(['+', '-'])?.trim();
    if rest.is_empty()
        || decimal(rest).is_some()
        || rest.strip_suffix('%').and_then(decimal).is_some()
        || date_serial(rest).is_some()
        || datetime_input(rest, false).is_some()
    {
        None
    } else {
        Some(text)
    }
}

/// A sparse workbook. Edits and calculation use the same typed cells as XLSX.
pub struct Spreadsheet {
    pub sheets: Vec<model::Sheet<String>>,
    pub options: model::Workbook,
    pub(super) spills: formulas::SpillCache,
}

impl Default for Spreadsheet {
    fn default() -> Self {
        Self::new()
    }
}

impl Spreadsheet {
    pub fn new() -> Self {
        let mut book = Self {
            spills: Default::default(),
            sheets: Vec::new(),
            options: model::Workbook {
                recalculate: true,
                case_insensitive: true,
                ..Default::default()
            },
        };
        book.add_sheet("Sheet1").expect("valid initial sheet");
        book
    }

    pub fn add_sheet(&mut self, name: &str) -> Result<usize, String> {
        if !valid_sheet_name(name)
            || name.chars().count() > 31
            || self
                .sheets
                .iter()
                .any(|s| super::case_fold::same_name(&s.name, name))
        {
            return Err("Sheet names must be unique and contain 1–31 valid characters".into());
        }
        let index = self.sheets.len();
        self.sheets.push(model::Sheet {
            name: name.into(),
            view: Vec::new(),
            frozen_rows: 0,
            frozen_columns: 0,
            print: Default::default(),
            filter: None,
            cells: BTreeMap::new(),
            rows: BTreeMap::new(),
            columns: BTreeMap::new(),
            merges: Vec::new(),
            arrays: Vec::new(),
            comments: Vec::new(),
            empty_headers: false,
            default_row_height: Some(21.),
            default_column_width: Some(90.),
        });
        Ok(index)
    }

    /// Freeze leading rows/columns, retaining at least one scrollable cell.
    /// Bounds follow IronCalc's worksheet setters (MIT, LICENSE.IronCalc).
    pub fn set_frozen(&mut self, sheet: usize, rows: usize, columns: usize) -> Result<(), String> {
        let sheet = self.sheets.get_mut(sheet).ok_or("Unknown sheet")?;
        if rows >= 1_048_576 || columns >= 16_384 {
            return Err("Frozen rows or columns exceed the worksheet".into());
        }
        sheet.frozen_rows = rows;
        sheet.frozen_columns = columns;
        Ok(())
    }

    /// Applies one batch, validates every coordinate first, and calculates once.
    /// On failure only changed cells need restoring; the workbook is not cloned.
    pub fn edit(
        &mut self,
        edits: &[(usize, usize, usize, &str)],
        limit: usize,
    ) -> Result<(), String> {
        let mut remaining = limit;
        let mut replaced_arrays = BTreeMap::<usize, std::collections::BTreeSet<usize>>::new();
        let mut coordinates = std::collections::BTreeSet::new();
        for &(s, r, c, text) in edits {
            if s >= self.sheets.len() || r >= 1_048_576 || c >= 16_384 {
                return Err("Cell is outside the workbook".into());
            }
            if self
                .merged_cell(s, r, c)
                .is_some_and(|[row, col, _, _]| (r, c) != (row, col))
            {
                return Err("Cannot edit a cell that is part of a merged cell".into());
            }
            if self.pivot_at(s, r, c).is_some() {
                return Err("Cannot edit calculated pivot cells".into());
            }
            for (index, a) in self.sheets[s].arrays.iter().enumerate() {
                remaining = remaining
                    .checked_sub(1)
                    .ok_or("Edit exceeds calculation limit")?;
                let [row, col, width, height] = a.range;
                if r >= row && r - row < height && c >= col && c - col < width {
                    replaced_arrays.entry(s).or_default().insert(index);
                }
            }
            remaining = remaining
                .checked_sub(text.len().saturating_add(256))
                .ok_or("Edit exceeds calculation limit")?;
            coordinates.insert((s, r, c));
        }
        for (&sheet, indices) in &replaced_arrays {
            for &index in indices {
                let [row, col, width, height] = self.sheets[sheet].arrays[index].range;
                // Duplicate edits cannot substitute for a missing member.
                if width.saturating_mul(height) > coordinates.len() {
                    return Err("Cannot edit part of an array formula".into());
                }
                remaining = remaining
                    .checked_sub(width.saturating_mul(height).saturating_mul(32))
                    .ok_or("Edit exceeds calculation limit")?;
                if !(row..row + height)
                    .all(|r| (col..col + width).all(|c| coordinates.contains(&(sheet, r, c))))
                {
                    return Err("Cannot edit part of an array formula".into());
                }
            }
        }
        let mut sheet_names = Vec::new();
        if edits
            .iter()
            .any(|(_, _, _, text)| text.starts_with(['=', '+', '-']) && text.contains('('))
        {
            for sheet in &self.sheets {
                remaining = remaining
                    .checked_sub(sheet.name.len() + std::mem::size_of::<String>())
                    .ok_or("Edit exceeds calculation limit")?;
            }
            sheet_names = self.sheets.iter().map(|sheet| sheet.name.clone()).collect();
        }
        let mut replacements = Vec::with_capacity(edits.len());
        for &(s, r, c, text) in edits {
            let sheet = &self.sheets[s];
            let mut cell = sheet
                .cells
                .get(&(r, c))
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
            cell.value = None;
            cell.formula = None;
            cell.legacy_formula = false;
            cell.openformula = None;
            cell.formula_display = None;
            cell.value_format = None;
            cell.rich_text = None;
            if let Some(literal) = text.strip_prefix('\'') {
                cell.value = Some(model::Value::Text(literal.into()));
            } else if self.options.tables.iter().any(|t| {
                t.header && t.sheet == s && t.area[0] == r && (t.area[1]..=t.area[3]).contains(&c)
            }) {
                cell.value = Some(model::Value::Text(text.into()));
            } else if let Some(source) = formula_source(text) {
                let excel = super::formula_arguments::rewrite(
                    source,
                    super::formula_arguments::Syntax::Editor,
                    &[],
                    &mut remaining,
                )
                .ok_or("Edit exceeds calculation limit")?;
                let completed = formulas::complete_input(
                    &excel,
                    &sheet_names,
                    &self.options,
                    (s, r, c),
                    &mut remaining,
                )
                .ok_or("Edit exceeds calculation limit")?;
                if excel != source {
                    let mut display = source.to_owned();
                    if completed.len() != excel.len() {
                        display.push(')');
                    }
                    cell.formula_display = Some(display);
                }
                remaining = remaining
                    .checked_sub(completed.len().saturating_add(8))
                    .ok_or("Edit exceeds calculation limit")?;
                cell.openformula = Some(format!("msoxl:={completed}"));
                cell.formula = Some(completed.into_owned());
            } else if !text.is_empty() {
                let trimmed = text.trim();
                cell.value = Some(
                    if trimmed.eq_ignore_ascii_case("true") || trimmed.eq_ignore_ascii_case("false")
                    {
                        model::Value::Bool(trimmed.eq_ignore_ascii_case("true"))
                    } else if let Some(error) = formulas::LITERAL_ERRORS
                        .iter()
                        .find(|error| trimmed.eq_ignore_ascii_case(error))
                    {
                        model::Value::Error((*error).into())
                    } else if let Some(n) = decimal(trimmed) {
                        model::Value::Number(n)
                    } else if let Some(n) = trimmed.strip_suffix('%').and_then(decimal) {
                        cell.format = Some("0.##########%".into());
                        model::Value::Number(n / 100.)
                    } else if let Some(n) = date_serial(trimmed) {
                        cell.format = Some("yyyy-mm-dd".into());
                        model::Value::Number(
                            n as f64 - if self.options.date1904 { 1462. } else { 0. },
                        )
                    } else {
                        remaining = remaining
                            .checked_sub(trimmed.len().saturating_mul(2))
                            .ok_or("Edit exceeds calculation limit")?;
                        if let Some(n) = datetime_input(trimmed, self.options.date1904) {
                            cell.format = Some(
                                if trimmed.contains('.') {
                                    "yyyy-mm-dd hh:mm:ss.000"
                                } else if trimmed.bytes().filter(|&b| b == b':').count() > 1 {
                                    "yyyy-mm-dd hh:mm:ss"
                                } else {
                                    "yyyy-mm-dd hh:mm"
                                }
                                .into(),
                            );
                            model::Value::Number(n)
                        } else {
                            model::Value::Text(text.into())
                        }
                    },
                );
            }
            if cell.value.is_some()
                || cell.formula.is_some()
                || cell.format.is_some()
                || cell.style.is_some()
            {
                replacements.push((s, r, c, Some(cell)));
            } else {
                replacements.push((s, r, c, None));
            }
        }
        // A complete batch replaces its whole array group. Move only the
        // affected descriptors; preserve their exact order if calculation fails.
        let mut removed = Vec::new();
        for (sheet, indices) in replaced_arrays {
            let mut index = 0;
            let groups = self.sheets[sheet]
                .arrays
                .extract_if(.., |_| {
                    let remove = indices.contains(&index);
                    index += 1;
                    remove
                })
                .collect::<Vec<_>>();
            removed.push((sheet, indices, groups));
        }
        let result = self.replace_cells(replacements, remaining);
        if result.is_err() {
            for (sheet, indices, groups) in removed {
                for (index, group) in indices.into_iter().zip(groups) {
                    self.sheets[sheet].arrays.insert(index, group);
                }
            }
        }
        result
    }

    /// Replace typed cell batches, preserving literal types for undo and sync.
    pub fn replace_cells(
        &mut self,
        mut edits: Vec<(usize, usize, usize, Option<model::TypedCell<String>>)>,
        limit: usize,
    ) -> Result<(), String> {
        for (s, r, c, cell) in &edits {
            if self.pivot_at(*s, *r, *c).is_some()
                && !cell
                    .as_ref()
                    .is_some_and(|cell| cell.value.is_none() && cell.formula.is_none())
            {
                return Err("Cannot edit calculated pivot cells".into());
            }
        }
        // An authored number-format change invalidates the old inferred format.
        // Keep unrelated style edits from changing the cached display format.
        for (s, r, c, cell) in &mut edits {
            if let Some(cell) = cell {
                let before = self
                    .sheets
                    .get(*s)
                    .and_then(|sheet| sheet.cells.get(&(*r, *c)))
                    .and_then(|cell| cell.format.as_deref());
                if cell.format.as_deref() != before {
                    cell.value_format = None;
                }
            }
        }
        if edits.iter().any(|(s, r, c, cell)| {
            self.options.tables.iter().any(|t| {
                t.header
                    && t.sheet == *s
                    && t.area[0] == *r
                    && (t.area[1]..=t.area[3]).contains(c)
                    && match cell.as_ref().and_then(|cell| cell.value.as_ref()) {
                        Some(model::Value::Text(text)) => {
                            t.columns.get(c - t.area[1]) != Some(text)
                        }
                        _ => true,
                    }
            })
        }) {
            return self.replace_table_headers(edits, limit);
        }
        let mut remaining = limit;
        for (s, r, c, cell) in &edits {
            if *s >= self.sheets.len() || *r >= 1_048_576 || *c >= 16_384 {
                return Err("Cell is outside the workbook".into());
            }
            let bytes = cell.as_ref().map_or(0, |cell| {
                cell.formula.as_ref().map_or(0, String::len)
                    + match &cell.value {
                        Some(model::Value::Text(s) | model::Value::Error(s)) => s.len(),
                        _ => 0,
                    }
            });
            remaining = remaining
                .checked_sub(bytes.saturating_add(256))
                .ok_or("Edit exceeds calculation limit")?;
        }
        let mut previous = BTreeMap::new();
        for (s, r, c, cell) in edits {
            let before = if let Some(cell) = cell {
                self.sheets[s].cells.insert((r, c), cell)
            } else {
                self.sheets[s].cells.remove(&(r, c))
            };
            previous.entry((s, r, c)).or_insert(before);
        }
        if let Some(spills) =
            formulas::cache(&mut self.sheets, &self.options, None, remaining, true)
        {
            self.spills = spills;
        } else {
            for ((s, r, c), cell) in previous {
                if let Some(cell) = cell {
                    self.sheets[s].cells.insert((r, c), cell);
                } else {
                    self.sheets[s].cells.remove(&(r, c));
                }
            }
            return Err(
                "Formula calculation exceeds its limit or contains unsupported syntax".into(),
            );
        }
        Ok(())
    }

    /// The anchor and extent of calculated output, including a one-cell array.
    pub fn spill_range(&self, sheet: usize, row: usize, column: usize) -> Option<[usize; 4]> {
        let coordinate = (sheet, row, column);
        if let Some(&[width, height]) = self.spills.ranges.get(&coordinate) {
            return Some([row, column, width, height]);
        }
        // Only generated children can belong to another cell's spill. Use the
        // existing indexes before scanning ranges, especially for sparse copies
        // and searches that visit every authored formula in a worksheet.
        if !self.spills.values.contains_key(&coordinate) {
            return None;
        }
        self.spills
            .ranges
            .range((sheet, 0, 0)..=(sheet, row, usize::MAX))
            .find_map(|(&(s, r, c), &[w, h])| {
                (s == sheet && row < r + h && column >= c && column < c + w).then_some([r, c, w, h])
            })
    }

    /// Resolve appearance without creating authored cells for empty or spilled positions.
    pub fn cell_style(&self, sheet: usize, row: usize, column: usize) -> Option<&model::Style> {
        if row >= 1_048_576 || column >= 16_384 {
            return None;
        }
        if let Some(style) = self.spills.styles.get(&(sheet, row, column)) {
            return Some(style);
        }
        let sheet = self.sheets.get(sheet)?;
        sheet
            .cells
            .get(&(row, column))
            .and_then(|cell| cell.style.as_deref())
            .or_else(|| sheet.rows.get(&row).and_then(|axis| axis.style.as_deref()))
            .or_else(|| {
                sheet
                    .columns
                    .get(&column)
                    .and_then(|axis| axis.style.as_deref())
            })
            .or(self.options.default_style.as_deref())
    }

    /// Authored cells overlaid with calculated spill output; never serialize this view.
    pub fn cell(
        &self,
        sheet: usize,
        row: usize,
        column: usize,
    ) -> Option<std::borrow::Cow<'_, model::TypedCell<String>>> {
        let source = self.sheets.get(sheet)?.cells.get(&(row, column));
        if let Some(value) = self.spills.values.get(&(sheet, row, column)) {
            let mut cell = source.cloned().unwrap_or(model::TypedCell {
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
            cell.value = Some(value.clone());
            if let Some(style) = self.spills.styles.get(&(sheet, row, column)) {
                cell.style = Some(style.clone());
            }
            Some(std::borrow::Cow::Owned(cell))
        } else {
            source.map(std::borrow::Cow::Borrowed)
        }
    }

    pub fn display(
        &self,
        sheet: usize,
        row: usize,
        column: usize,
        limit: usize,
    ) -> Result<String, String> {
        if sheet >= self.sheets.len() {
            return Err("Unknown sheet".into());
        }
        match self.cell(sheet, row, column).as_deref() {
            Some(cell) => csv::cell_text(
                cell,
                None,
                self.options.date1904,
                super::number_format::Mode::ExcelDisplay,
                &mut { limit },
            )
            .map(|(text, _)| text)
            .ok_or_else(|| "Cell formatting exceeds its limit".into()),
            None => Ok(String::new()),
        }
    }

    pub fn input(&self, sheet: usize, row: usize, column: usize) -> String {
        let cell = self.cell(sheet, row, column);
        let formula = cell
            .as_ref()
            .and_then(|cell| cell.formula_display.as_deref().or(cell.formula.as_deref()))
            .or_else(|| {
                self.sheets.get(sheet)?.arrays.iter().find_map(|group| {
                    let [r, c, w, h] = group.range;
                    ((r..r + h).contains(&row) && (c..c + w).contains(&column)).then(|| {
                        group
                            .formula_display
                            .as_deref()
                            .unwrap_or(&group.expression)
                    })
                })
            });
        if let Some(formula) = formula {
            return format!("={}", formula.trim_start_matches('='));
        }
        let Some(cell) = cell else {
            return String::new();
        };
        match &cell.value {
            Some(model::Value::Text(text)) => {
                let trimmed = text.trim();
                if text.is_empty()
                    || text.starts_with('\'')
                    || formula_source(text).is_some()
                    || trimmed.eq_ignore_ascii_case("true")
                    || trimmed.eq_ignore_ascii_case("false")
                    || formulas::LITERAL_ERRORS
                        .iter()
                        .any(|error| trimmed.eq_ignore_ascii_case(error))
                    || decimal(trimmed).is_some()
                    || trimmed.strip_suffix('%').and_then(decimal).is_some()
                    || date_serial(trimmed).is_some()
                    || datetime_input(trimmed, self.options.date1904).is_some()
                {
                    format!("'{text}")
                } else {
                    text.clone()
                }
            }
            Some(model::Value::Number(n)) => super::number_format::number(*n, true),
            Some(model::Value::Bool(b)) => if *b { "TRUE" } else { "FALSE" }.into(),
            Some(model::Value::Error(e)) => e.clone(),
            _ => String::new(),
        }
    }

    pub fn import_xlsx(bytes: &[u8], limit: usize) -> Result<Self, String> {
        let (mut sheets, options) = super::xlsx_import::workbook(bytes, limit)?;
        // Excel may omit sheetFormatPr or its column width. Resolve its standard
        // 20px rows and 64px columns before handing the editable book to a renderer.
        for sheet in &mut sheets {
            sheet.default_row_height.get_or_insert(15.);
            sheet.default_column_width.get_or_insert(48.);
        }
        let mut book = Self {
            sheets,
            options,
            spills: Default::default(),
        }
        .materialize_formulas(limit / 2)?;
        book.validate_conditional_formats(&book.options.conditional_formats, &mut { limit / 2 })?;
        book.validate_pivots(&mut { limit / 2 })?;
        book.options.recalculate = true;
        book.spills = formulas::cache(&mut book.sheets, &book.options, None, limit / 2, true)
            .ok_or("Imported workbook calculation exceeds its limit")?;
        book.prepare_filter_snapshots(limit / 2)?;
        book.intern_import_styles(limit / 2)?;
        Ok(book)
    }

    /// Resolve imported shared formula origins into each cell/array's own
    /// coordinates before binding references to a collaborative grid. Consumes
    /// the workbook so a bounded conversion cannot expose partially changed data.
    pub fn materialize_formulas(mut self, limit: usize) -> Result<Self, String> {
        let sources: Vec<_> = self
            .sheets
            .iter()
            .map(|s| (s.name.clone(), String::new()))
            .collect();
        let mut remaining = limit;
        let mut materialize =
            |expression: &str, original: Option<&str>, position: (usize, usize, usize)| {
                let (s, r, c) = position;
                if original.is_some_and(|source| source.starts_with("of:=")) {
                    if self.options.formula_origins.contains_key(&position) {
                        return Err("Shared OpenFormula origins are not supported".to_string());
                    }
                    return Ok(None);
                }
                let source = original
                    .and_then(|source| source.strip_prefix("msoxl:="))
                    .unwrap_or(expression);
                let (_, or, oc) = self
                    .options
                    .formula_origins
                    .get(&position)
                    .copied()
                    .unwrap_or(position);
                let formula = super::xlsx_import::formula_tokens(
                    source,
                    &self.options.names,
                    &sources,
                    (Some(s), Some(s)),
                    (r as i64 - or as i64, c as i64 - oc as i64),
                    super::formula_arguments::Syntax::Editor,
                    &mut remaining,
                )
                .ok_or("Imported formula exceeds its limit")?
                .text
                .into_owned();
                let display = super::formula_arguments::rewrite(
                    &formula,
                    super::formula_arguments::Syntax::EditorDisplay,
                    &[],
                    &mut remaining,
                )
                .ok_or("Imported formula exceeds its limit")?;
                let display = (display != formula).then(|| display.into_owned());
                Ok(Some((formula, display)))
            };
        for (s, sheet) in self.sheets.iter_mut().enumerate() {
            for (&(r, c), cell) in &mut sheet.cells {
                let Some(expression) = &cell.formula else {
                    continue;
                };
                let Some((formula, display)) =
                    materialize(expression, cell.openformula.as_deref(), (s, r, c))?
                else {
                    continue;
                };
                cell.formula_display = display;
                cell.openformula = Some(format!("msoxl:={formula}"));
                cell.formula = Some(formula);
            }
            for group in &mut sheet.arrays {
                let [r, c, _, _] = group.range;
                let Some((formula, display)) =
                    materialize(&group.expression, group.openformula.as_deref(), (s, r, c))?
                else {
                    continue;
                };
                // Older editor JSON already materialized ordinary cells while
                // retaining the array's original code. Its anchor must use the
                // array source, not receive the origin offset a second time.
                if let Some(cell) = sheet.cells.get_mut(&(r, c))
                    && cell.formula.is_some()
                {
                    cell.formula = Some(formula.clone());
                    cell.openformula = Some(format!("msoxl:={formula}"));
                    cell.formula_display = display.clone();
                }
                group.formula_display = display;
                group.openformula = Some(format!("msoxl:={formula}"));
                group.expression = formula;
            }
        }
        for table in &mut self.options.tables {
            for definition in table.calculated_columns.values_mut() {
                let formula = super::xlsx_import::formula_tokens(
                    &definition.formula,
                    &self.options.names,
                    &sources,
                    (Some(table.sheet), Some(table.sheet)),
                    (0, 0),
                    super::formula_arguments::Syntax::Editor,
                    &mut remaining,
                )
                .ok_or("Imported column formula exceeds its limit")?
                .text;
                definition.formula = super::formula_arguments::rewrite(
                    &formula,
                    super::formula_arguments::Syntax::EditorDisplay,
                    &[],
                    &mut remaining,
                )
                .ok_or("Imported column formula exceeds its limit")?
                .into_owned();
            }
        }
        self.options.formula_origins.clear();
        Ok(self)
    }

    /// Copy a typed cell, rebasing relative formula references through the same
    /// token parser used for shared XLSX formulas. Literal types/styles survive.
    pub fn relocate_cell(
        &self,
        cell: &model::TypedCell<String>,
        from: (usize, usize),
        to: (usize, usize),
        sheet: usize,
        limit: usize,
    ) -> Result<model::TypedCell<String>, String> {
        if sheet >= self.sheets.len()
            || from.0 >= 1_048_576
            || to.0 >= 1_048_576
            || from.1 >= 16_384
            || to.1 >= 16_384
        {
            return Err("Cell is outside the workbook".into());
        }
        let mut cell = cell.clone();
        if let Some(formula) = &cell.formula {
            let sheets: Vec<_> = self
                .sheets
                .iter()
                .map(|s| (s.name.clone(), String::new()))
                .collect();
            let tokens = super::xlsx_import::formula_tokens(
                formula,
                &self.options.names,
                &sheets,
                (Some(sheet), Some(sheet)),
                (to.0 as i64 - from.0 as i64, to.1 as i64 - from.1 as i64),
                super::formula_arguments::Syntax::Editor,
                &mut { limit },
            )
            .ok_or("Formula copy exceeds its calculation limit")?;
            let formula = tokens.text.into_owned();
            cell.openformula = Some(format!("msoxl:={formula}"));
            if let Some(display) = &cell.formula_display {
                cell.formula_display = Some(
                    super::xlsx_import::formula_tokens(
                        display,
                        &self.options.names,
                        &sheets,
                        (Some(sheet), Some(sheet)),
                        (to.0 as i64 - from.0 as i64, to.1 as i64 - from.1 as i64),
                        super::formula_arguments::Syntax::Editor,
                        &mut { limit },
                    )
                    .ok_or("Formula copy exceeds its calculation limit")?
                    .text
                    .into_owned(),
                );
            }
            cell.formula = Some(formula);
            cell.value = None;
            cell.value_format = None;
        }
        Ok(cell)
    }

    pub fn export_xlsx(&self, limit: usize) -> Result<Vec<u8>, String> {
        let mut limit = limit;
        self.validate_conditional_formats(&self.options.conditional_formats, &mut limit)?;
        model::write_cells(
            model::Dialect::LibreOffice,
            &self.sheets,
            &self.options,
            limit,
            Some(&self.spills),
        )
        .ok_or_else(|| "Workbook exceeds XLSX output limit".into())
    }
}

use super::{Calculation, Coord, Expr, Format, Value, parse};
use crate::commands::spreadsheet::model::{Sheet, Value as CellValue, Workbook};
use std::collections::BTreeSet;
use std::sync::Arc;

impl crate::commands::spreadsheet::Spreadsheet {
    /// Resolve exact name/table identities as one read-only batch. Workbook
    /// names are not shadowed by local definitions with the same label.
    pub fn resolve_pivot_sources(
        &self,
        sources: &[super::super::PivotSource],
        limit: usize,
    ) -> Result<Vec<(usize, [usize; 4])>, String> {
        if sources.is_empty() {
            return Ok(Vec::new());
        }
        let work = limit
            .checked_sub(sources.len().saturating_mul(256))
            .ok_or("Pivot source batch exceeds its limit")?;
        let names: Vec<_> = self.sheets.iter().map(|sheet| sheet.name.clone()).collect();
        let mut calc = reference_calculation(self, &names, work)?;
        let mut result = Vec::with_capacity(sources.len());
        for &source in sources {
            let value = calc
                .pivot_source(Some(source), (0, [0; 4]), 0)
                .ok_or("Pivot source resolution exceeds its limit")?;
            let Value::Range(first, last) = value else {
                return Err(
                    "Pivot source must be a rectangular range with headers and data".into(),
                );
            };
            if first.0 != last.0
                || first.0 >= self.sheets.len()
                || first.1 >= last.1
                || first.2 > last.2
                || last.1 >= 1_048_576
                || last.2 >= 16_384
            {
                return Err("Invalid pivot source range".into());
            }
            result.push((first.0, [first.1, first.2, last.1, last.2]));
        }
        Ok(result)
    }

    /// Resolve a batch of Excel reference expressions to single-sheet rectangles.
    /// Names, structured references and reference-returning functions use the
    /// formula AST. Existing calculated cells and spills are read without
    /// resampling volatile cells or changing the workbook.
    pub fn resolve_ranges(
        &self,
        requests: &[(&str, Coord)],
        limit: usize,
    ) -> Result<Vec<(usize, [usize; 4])>, String> {
        if requests.is_empty() {
            return Ok(Vec::new());
        }
        let mut work = limit;
        for (source, (sheet, row, column)) in requests {
            if *sheet >= self.sheets.len() || *row >= 1_048_576 || *column >= 16_384 {
                return Err("Invalid reference origin".into());
            }
            work = work
                .checked_sub(source.len().saturating_mul(8).saturating_add(256))
                .ok_or("Reference batch exceeds its limit")?;
        }
        let names: Vec<_> = self.sheets.iter().map(|sheet| sheet.name.clone()).collect();
        let mut calc = reference_calculation(self, &names, work)?;
        let mut result = Vec::with_capacity(requests.len());
        for &(source, position) in requests {
            let source = format!("msoxl:={}", source.strip_prefix('=').unwrap_or(source));
            let expression = parse(
                &source,
                &names,
                &self.options,
                (position.0, position.1 as i64, position.2 as i64),
                Some(position.0),
                false,
                None,
                calc.work,
                true,
            )
            .map_err(|_| "Invalid reference expression")?
            .ok_or("Unsupported reference expression")?;
            if let Some(error) = expression
                .compiled_error(&calc.names, &mut calc.work)
                .ok_or("Reference resolution exceeds its limit")?
            {
                return Err(error.into());
            }
            let value = calc
                .eval(&expression, position, 0, true)
                .ok_or("Reference resolution exceeds its limit")?;
            let (first, last) = match value {
                Value::Single(cell) => (cell, cell),
                Value::Range(first, last) => (first, last),
                Value::Error(error) | Value::LiteralError(error) => return Err(error.into()),
                Value::InvalidReference | Value::InvalidRange(..) => return Err("#REF!".into()),
                _ => return Err("Select one rectangular reference".into()),
            };
            if first.0 != last.0
                || first.0 >= self.sheets.len()
                || first.1 > last.1
                || first.2 > last.2
                || last.1 >= 1_048_576
                || last.2 >= 16_384
            {
                return Err("Select one rectangular reference on a single worksheet".into());
            }
            result.push((first.0, [first.1, first.2, last.1, last.2]));
        }
        Ok(result)
    }
}

fn reference_calculation<'a>(
    book: &'a crate::commands::spreadsheet::Spreadsheet,
    names: &'a [String],
    limit: usize,
) -> Result<Calculation<'a>, String> {
    let (mut calc, _, _) = calculation(&book.sheets, &book.options, names, false, limit, true)
        .ok_or("Reference resolution exceeds its limit")?;
    // The saved calculation already owns these results. A read-only query
    // must not rebuild pivot output or recalculate volatile input cells.
    for position in calc.pivot_anchors.keys() {
        calc.expressions.remove(position);
    }
    calc.pivot_anchors.clear();
    for (&position, value) in &book.spills.values {
        calc.work = calc
            .work
            .checked_sub(128)
            .ok_or("Reference resolution exceeds its limit")?;
        let value = cached_value(Some(value), &mut calc.work)
            .ok_or("Reference resolution exceeds its limit")?;
        calc.values.insert(position, value);
    }
    for (&position, &range) in book.spills.ranges.iter().chain(&book.spills.pivot_ranges) {
        calc.work = calc
            .work
            .checked_sub(128)
            .ok_or("Reference resolution exceeds its limit")?;
        calc.dynamic
            .as_mut()
            .expect("dynamic calculation")
            .ranges
            .insert(position, range);
    }
    calc.now_ms = book.spills.calculated_at_ms;
    Ok(calc)
}

pub(in crate::commands) fn resolve_pivot_source(
    sheets: &[Sheet<String>],
    book: &Workbook,
    binding: super::super::PivotSource,
    work: &mut usize,
) -> Result<(usize, [usize; 4]), String> {
    let names: Vec<_> = sheets.iter().map(|sheet| sheet.name.clone()).collect();
    let (mut calc, _, _) = calculation(sheets, book, &names, true, *work, true)
        .ok_or("Pivot source exceeds its calculation limit")?;
    let value = calc
        .pivot_source(Some(binding), (0, [0; 4]), 0)
        .ok_or("Pivot source exceeds its calculation limit")?;
    *work = calc.work;
    let Value::Range(first, last) = value else {
        return Err("Pivot source must be a rectangular range with headers and data".into());
    };
    if first.0 != last.0
        || first.0 >= sheets.len()
        || first.1 >= last.1
        || first.2 > last.2
        || last.1 >= 1_048_576
        || last.2 >= 16_384
    {
        return Err("Invalid pivot source range".into());
    }
    Ok((first.0, [first.1, first.2, last.1, last.2]))
}

fn cached_value(value: Option<&CellValue<String>>, work: &mut usize) -> Option<Value> {
    Some(match value {
        Some(CellValue::Empty) => Value::Empty,
        Some(CellValue::Number(n)) => Value::Number(*n),
        Some(CellValue::Bool(b)) => Value::Bool(*b),
        Some(CellValue::Text(s)) => {
            *work = work.checked_sub(s.len())?;
            Value::Text(s.clone())
        }
        Some(CellValue::Error(s)) => Value::Error(match s.as_str() {
            "Err:502" => "Err:502",
            "Err:504" => "Err:504",
            "Err:511" => "Err:511",
            "Err:514" => "Err:514",
            "Err:533" => "Err:533",
            "Err:538" => "Err:538",
            "Err:539" => "Err:539",
            "Err:508" => "Err:508",
            "Err:509" => "Err:509",
            "Err:510" => "Err:510",
            "Err:520" => "Err:520",
            "Err:522" => "Err:522",
            "Err:523" => "Err:523",
            _ => super::LITERAL_ERRORS
                .into_iter()
                .find(|error| s.eq_ignore_ascii_case(error))
                .unwrap_or("#VALUE!"),
        }),
        None => Value::Blank,
    })
}

fn calculation<'a>(
    sheets: &'a [Sheet<String>],
    book: &'a Workbook,
    names: &'a [String],
    recalculate: bool,
    limit: usize,
    dynamic: bool,
) -> Option<(Calculation<'a>, BTreeSet<Coord>, bool)> {
    let sizes = vec![(1_048_576, 16_384); sheets.len()];
    let mut calc = Calculation::new(book, names, sizes, limit);
    if dynamic {
        let mut state = super::spill::Dynamic::default();
        for (index, sheet) in sheets.iter().enumerate() {
            for (&(r, c), cell) in &sheet.cells {
                calc.work = calc.work.checked_sub(64)?;
                if cell.formula.is_some()
                    || cell
                        .value
                        .as_ref()
                        .is_some_and(|v| !matches!(v, CellValue::Empty))
                {
                    state.occupied.insert((index, r, c));
                }
            }
            for range in sheet
                .merges
                .iter()
                .chain(sheet.arrays.iter().map(|a| &a.range))
            {
                calc.work = calc.work.checked_sub(64)?;
                state.blocked.push((index, *range));
            }
        }
        for table in &book.tables {
            calc.work = calc.work.checked_sub(64)?;
            let [r, c, end_r, end_c] = table.area;
            state
                .blocked
                .push((table.sheet, [r, c, end_c - c + 1, end_r - r + 1]));
        }
        calc.dynamic = Some(state);
    }
    for (sheet, source) in sheets.iter().enumerate() {
        for (&row, axis) in &source.rows {
            calc.work = calc.work.checked_sub(32)?;
            if axis.hidden {
                calc.hidden_rows.insert((sheet, row));
            }
        }
        for row in
            crate::commands::spreadsheet::editor_filter::rows(source, book, sheet, &mut calc.work)?
        {
            calc.filtered_rows.insert((sheet, row));
        }
    }
    let mut unsupported = false;
    let mut missing = std::collections::BTreeSet::new();
    for (index, name) in book.names.iter().enumerate() {
        let source = name.openformula.as_deref().unwrap_or(&name.expression);
        calc.work = calc.work.checked_sub(source.len())?;
        let expression = parse(
            source,
            names,
            book,
            name.position,
            name.sheet,
            false,
            Some(index),
            calc.work,
            dynamic,
        )
        .ok()?;
        calc.names.push(Arc::new(
            expression.unwrap_or(Expr::Value(Value::Error("#NAME?"))),
        ));
    }
    for (index, sheet) in sheets.iter().enumerate() {
        for (&(r, c), cell) in &sheet.cells {
            calc.work = calc.work.checked_sub(128)?;
            let value = cached_value(cell.value.as_ref(), &mut calc.work)?;
            let position = (index, r, c);
            if let Some(formula) = cell.formula_display.as_deref().or(cell.formula.as_deref()) {
                calc.formula_sources.insert(position, formula);
            }
            calc.values.insert(position, value);
            if let Some(format) = cell.value_format.as_deref().or(cell.format.as_deref()) {
                calc.work = calc
                    .work
                    .checked_sub(std::mem::size_of::<(Coord, Format<'_>)>() + 32)?;
                let format = Format::import(format, &mut calc.work)?;
                calc.formats.insert(position, format);
            }
            if (recalculate || cell.value.is_none())
                && let Some(source) = cell.openformula.as_ref().or(cell.formula.as_ref())
            {
                missing.insert(position);
                if !book.explicit_formula_styles.contains(&position)
                    && cell
                        .format
                        .as_deref()
                        .is_none_or(|f| f.eq_ignore_ascii_case("General"))
                    && cell
                        .value_format
                        .as_deref()
                        .is_none_or(|f| f.eq_ignore_ascii_case("General"))
                {
                    calc.work = calc.work.checked_sub(64)?;
                    calc.automatic_formats.insert(position);
                }
                calc.work = calc.work.checked_sub(source.len())?;
                let origin = book
                    .formula_origins
                    .get(&position)
                    .copied()
                    .unwrap_or(position);
                let expression = parse(
                    source,
                    names,
                    book,
                    (origin.0, origin.1 as i64, origin.2 as i64),
                    Some(index),
                    false,
                    None,
                    calc.work,
                    dynamic,
                )
                .ok()?;
                if expression.is_none() {
                    unsupported = true;
                }
                let expression = expression.unwrap_or(Expr::Value(Value::Blank));
                if dynamic
                    && cell.legacy_formula
                    && !expression.dynamic_arrays(&calc.names, &mut calc.work)?
                {
                    calc.work = calc.work.checked_sub(64)?;
                    calc.legacy_formulas.insert(position);
                }
                calc.expressions.insert(position, expression);
            }
        }
        for group in &sheet.arrays {
            let [r, c, w, h] = group.range;
            // Pending cells already use worksheet/row/column order. Start at
            // this array instead of rescanning every earlier formula per group.
            if w == 0
                || h == 0
                || !missing
                    .range((index, r, c)..(index, r + h - 1, c + w))
                    .any(|&(_, _, col)| (c..c + w).contains(&col))
            {
                continue;
            }
            let position = (index, r, c);
            let origin = book
                .formula_origins
                .get(&position)
                .copied()
                .unwrap_or(position);
            calc.array_sizes.insert(position, (h, w));
            let source = group.openformula.as_ref().unwrap_or(&group.expression);
            calc.work = calc.work.checked_sub(source.len())?;
            let expression = parse(
                source,
                names,
                book,
                (origin.0, origin.1 as i64, origin.2 as i64),
                Some(index),
                false,
                None,
                calc.work,
                dynamic,
            )
            .ok()?;
            if expression.is_none() {
                unsupported = true;
            }
            let expression = Arc::new(expression.unwrap_or(Expr::Value(Value::Blank)));
            for row in r..r + h {
                for col in c..c + w {
                    calc.work = calc.work.checked_sub(128)?;
                    if (row, col) != (r, c)
                        && sheet
                            .cells
                            .get(&(row, col))
                            .is_some_and(|cell| cell.formula.is_some())
                    {
                        continue;
                    }
                    calc.work = calc.work.checked_sub(64)?;
                    calc.formula_sources.insert(
                        (index, row, col),
                        group
                            .formula_display
                            .as_deref()
                            .unwrap_or(&group.expression),
                    );
                    if !recalculate
                        && sheet
                            .cells
                            .get(&(row, col))
                            .is_some_and(|cell| cell.value.is_some())
                    {
                        continue;
                    }
                    missing.insert((index, row, col));
                    calc.expressions.insert(
                        (index, row, col),
                        Expr::MatrixCell(expression.clone(), position),
                    );
                }
            }
        }
    }
    if dynamic {
        for pivot in book.pivots.values() {
            calc.work = calc.work.checked_sub(256)?;
            let position = (pivot.sheet, pivot.row, pivot.column);
            calc.pivot_anchors.insert(position, pivot);
            calc.expressions.insert(position, Expr::Value(Value::Blank));
            calc.dynamic.as_mut()?.occupied.insert(position);
        }
    }
    Some((calc, missing, unsupported))
}

pub(in crate::commands) fn cache(
    sheets: &mut [Sheet<String>],
    book: &Workbook,
    export_names: Option<&[String]>,
    limit: usize,
    dynamic: bool,
) -> Option<super::SpillCache> {
    let recalculate = book.recalculate || export_names.is_some();
    if book.pivots.is_empty()
        && !sheets
            .iter()
            .flat_map(|s| s.cells.values())
            .any(|c| (recalculate || c.value.is_none()) && c.formula.is_some())
    {
        return Some(Default::default());
    }
    let names: Vec<_> = sheets.iter().map(|s| s.name.clone()).collect();
    let (mut calc, missing, unsupported) =
        calculation(sheets, book, &names, recalculate, limit, dynamic)?;
    if unsupported {
        return (!recalculate).then_some(Default::default());
    }
    // Named expressions are expanded by the compiler even in inactive branches.
    // Detect their compiler errors and recursion before evaluating cell values.
    if !calc.names.is_empty() {
        for expression in calc.expressions.values_mut() {
            if let Some(error) = expression.compiled_error(&calc.names, &mut calc.work)? {
                *expression = Expr::Value(Value::Error(error));
            }
        }
    }
    let coordinates: Vec<_> = calc.expressions.keys().copied().collect();
    loop {
        let ordered = if let Some(state) = &mut calc.dynamic {
            state.order(&coordinates, &mut calc.work)?
        } else {
            coordinates.clone()
        };
        for coord in ordered {
            calc.cell(coord, 0)?;
        }
        if calc.dynamic.is_none() || !calc.restart_spills()? {
            break;
        }
    }
    if let Some(names) = export_names {
        // Calc first calculates with the imported names. Renaming for XLSX then
        // invalidates volatile formulas and their static dependency closure.
        // References already contain sheet indexes, so they survive the rename.
        let mut affected = BTreeSet::new();
        let mut work = calc.work;
        loop {
            let count = affected.len();
            for (&coord, expression) in &calc.expressions {
                work = work.checked_sub(1)?;
                if !affected.contains(&coord)
                    && depends_on_volatile(
                        &calc,
                        expression,
                        (coord, None),
                        &affected,
                        &mut BTreeSet::new(),
                        &mut work,
                        0,
                    )?
                {
                    work = work.checked_sub(64)?;
                    affected.insert(coord);
                }
            }
            if affected.len() == count {
                break;
            }
        }
        calc.work = work;
        calc.sheets = names;
        calc.matrices.clear();
        calc.cleared.clear();
        calc.iterated.clear();
        for coord in &affected {
            calc.results.remove(coord);
        }
        for coord in affected {
            calc.cell(coord, 0)?;
        }
    }
    let mut inferred = std::collections::BTreeMap::new();
    for coord in &calc.automatic_formats {
        if let Some(format) = calc.formats.get(coord)
            && !matches!(calc.results.get(coord), Some(Value::Bool(_)))
        {
            calc.work = calc.work.checked_sub(format.pattern.len())?;
            inferred.insert(*coord, format.pattern.to_owned());
        }
    }
    // Validate the result destinations before publishing any cache values.
    // A malformed array must not leave half-recalculated cells after failure.
    if calc.results.keys().any(|&(s, r, c)| {
        missing.contains(&(s, r, c))
            && !sheets
                .get(s)
                .is_some_and(|sheet| sheet.cells.contains_key(&(r, c)))
    }) {
        return None;
    }
    let mut spills = super::SpillCache {
        calculated_at_ms: calc.now_ms,
        pivot_sources: calc.pivot_sources,
        ..Default::default()
    };
    if let Some(state) = calc.dynamic {
        for coord in state.cells {
            let value = super::spill::cell_value(calc.values.remove(&coord)?)?;
            spills.values.insert(coord, value);
        }
        for (position, range) in state.ranges {
            if calc.pivot_anchors.contains_key(&position) {
                spills.pivot_ranges.insert(position, range);
            } else {
                spills.ranges.insert(position, range);
            }
        }
    }
    let array_sizes = calc.array_sizes;
    let legacy_formulas = calc.legacy_formulas;
    let pivot_anchors: BTreeSet<_> = calc.pivot_anchors.into_keys().collect();
    for ((sheet, r, c), value) in calc.results {
        if pivot_anchors.contains(&(sheet, r, c)) {
            spills
                .values
                .insert((sheet, r, c), super::spill::cell_value(value)?);
            continue;
        }
        if !missing.contains(&(sheet, r, c)) {
            continue;
        }
        let array = array_sizes.contains_key(&(sheet, r, c));
        let format = inferred.remove(&(sheet, r, c));
        let legacy = legacy_formulas.contains(&(sheet, r, c));
        let sheet = &mut sheets[sheet];
        let cell = sheet.cells.get_mut(&(r, c))?;
        if dynamic && cell.legacy_formula && !legacy {
            cell.legacy_formula = false;
        }
        if let Some(format) = format {
            cell.value_format = Some(format);
        }
        if matches!(value, Value::Bool(_))
            && array
            && cell.format.as_deref().is_none_or(|f| f == "General")
        {
            cell.value_format = Some("General".into());
        }
        cell.value = match value {
            Value::Blank => Some(CellValue::Number(0.)),
            // The editor follows Excel array output: a referenced empty cell
            // is zero, while an empty text value stays text. Keep Calc's native
            // Empty result for the conversion engine's non-editor path.
            Value::Empty if dynamic => Some(CellValue::Number(0.)),
            Value::Empty => Some(CellValue::Empty),
            Value::Number(n) => Some(CellValue::Number(n)),
            Value::Bool(b) => Some(CellValue::Bool(b)),
            Value::Text(s) | Value::UninternedText(s) => Some(CellValue::Text(s)),
            Value::Error(e) => Some(CellValue::Error(e.into())),
            _ => None,
        };
    }
    Some(spills)
}

pub(in crate::commands) fn xlsx_recalculate(
    sheets: &mut [Sheet<String>],
    book: &Workbook,
    manual: bool,
    work: &mut usize,
) -> Option<BTreeSet<Coord>> {
    let names: Vec<_> = sheets.iter().map(|sheet| sheet.name.clone()).collect();
    let mut calc = Calculation::new(book, &names, vec![(1_048_576, 16_384); sheets.len()], *work);
    for (index, name) in book.names.iter().enumerate() {
        let source = name.openformula.as_deref().unwrap_or(&name.expression);
        *work = work.checked_sub(source.len() + 128)?;
        let expr = parse(
            source,
            &names,
            book,
            name.position,
            name.sheet,
            false,
            Some(index),
            *work,
            false,
        )
        .ok()?;
        calc.names.push(Arc::new(
            expr.unwrap_or(Expr::Value(Value::Error(super::syntax_error(source)))),
        ));
    }
    for (s, sheet) in sheets.iter().enumerate() {
        for (&(r, c), cell) in &sheet.cells {
            let Some(source) = cell.openformula.as_ref().or(cell.formula.as_ref()) else {
                continue;
            };
            *work = work.checked_sub(source.len() + 128)?;
            let position = (s, r, c);
            let origin = book
                .formula_origins
                .get(&position)
                .copied()
                .unwrap_or(position);
            let expr = parse(
                source,
                &names,
                book,
                (origin.0, origin.1 as i64, origin.2 as i64),
                Some(s),
                false,
                None,
                *work,
                false,
            )
            .ok()?;
            calc.expressions.insert(
                position,
                expr.unwrap_or(Expr::Value(Value::Error(super::syntax_error(source)))),
            );
        }
        for group in &sheet.arrays {
            let [r, c, w, h] = group.range;
            let source = group.openformula.as_ref().unwrap_or(&group.expression);
            let origin = book
                .formula_origins
                .get(&(s, r, c))
                .copied()
                .unwrap_or((s, r, c));
            *work = work.checked_sub(source.len())?;
            let expr = parse(
                source,
                &names,
                book,
                (origin.0, origin.1 as i64, origin.2 as i64),
                Some(s),
                false,
                None,
                *work,
                false,
            )
            .ok()?;
            let expr =
                Arc::new(expr.unwrap_or(Expr::Value(Value::Error(super::syntax_error(source)))));
            for row in r..r + h {
                for col in c..c + w {
                    *work = work.checked_sub(128)?;
                    calc.expressions
                        .entry((s, row, col))
                        .or_insert_with(|| Expr::MatrixCell(expr.clone(), (s, r, c)));
                }
            }
        }
    }
    let mut affected = BTreeSet::new();
    let mut errors = BTreeSet::new();
    for (&position, expr) in &calc.expressions {
        let mut pending = vec![(expr, None)];
        let mut visited = BTreeSet::new();
        let mut active = BTreeSet::new();
        let mut error = if let Expr::Value(Value::Error(error)) = expr
            && *error != "#NAME?"
        {
            Some(*error)
        } else {
            None
        };
        if matches!(expr, Expr::Binary(",", ..))
            || matches!(expr, Expr::Name(index) if matches!(calc.names.get(*index).map(|e| e.as_ref()), Some(Expr::Binary(",", ..))))
        {
            error.get_or_insert("Err:509");
        }
        let mut recalculate = false;
        while let Some((expr, leaving)) = pending.pop() {
            *work = work.checked_sub(std::mem::size_of::<(&Expr, Option<usize>)>() * 2 + 1)?;
            if let Some(index) = leaving {
                active.remove(&index);
                visited.insert(index);
                continue;
            }
            match expr {
                Expr::Value(Value::Error(value)) if value.starts_with("Err:") => {
                    error.get_or_insert(*value);
                }
                Expr::Name(index) if !visited.contains(index) => {
                    *work = work.checked_sub(128)?;
                    if active.insert(*index) {
                        let name = &book.names[*index];
                        if super::operators::separator(
                            name.openformula.as_deref().unwrap_or(&name.expression),
                            ';',
                        )
                        .is_some()
                        {
                            error.get_or_insert("Err:508");
                        }
                        pending.push((expr, Some(*index)));
                        pending.push((calc.names.get(*index)?, None));
                    } else {
                        error.get_or_insert("Err:514");
                    }
                }
                Expr::MatrixCell(child, _) => pending.push((child, None)),
                Expr::Group(child) | Expr::Unary(_, child) => pending.push((child, None)),
                Expr::Binary(_, a, b) => {
                    pending.push((b, None));
                    pending.push((a, None));
                }
                // Imported closures can hide volatile calls behind local variables.
                // Recalculate them rather than trusting an external cached value.
                Expr::Lambda(..) => recalculate |= !manual,
                Expr::Invoke(callee, args) => {
                    recalculate |= !manual;
                    pending.extend(args.iter().rev().map(|arg| (arg, None)));
                    pending.push((callee, None));
                }
                Expr::Call(name, args) => {
                    recalculate |= matches!(name.as_str(), "CELL" | "HYPERLINK")
                        || !manual
                            && matches!(
                                name.as_str(),
                                "RAND"
                                    | "TODAY"
                                    | "NOW"
                                    | "FORMULA"
                                    | "INFO"
                                    | "INDIRECT"
                                    | "OFFSET"
                                    | "DEBUGVAR"
                                    | "RANDARRAY"
                                    | "RANDBETWEEN"
                            );
                    pending.extend(args.iter().rev().map(|arg| (arg, None)));
                }
                _ => {}
            }
        }
        if matches!(expr, Expr::MatrixCell(..))
            && sheets[position.0].cells[&(position.1, position.2)]
                .value
                .is_some()
        {
            // Imported ordinary caches override array results, including
            // compiler errors in the anchor's expression.
            error = None;
        }
        if recalculate || error.is_some() {
            *work = work.checked_sub(64)?;
            if recalculate {
                affected.insert(position);
            }
            if let Some(error) = error {
                let cell = sheets[position.0]
                    .cells
                    .get_mut(&(position.1, position.2))?;
                errors.insert(position);
                // Internal Calc compiler codes replace its parsed expression.
                // Excel errors retain their original source, including the
                // function namespace needed when the editor recalculates it.
                if cell.formula.is_some() && error.starts_with("Err:") {
                    cell.openformula = Some(error.into());
                }
                cell.value = Some(CellValue::Error(error.into()));
            }
        }
    }
    if !manual {
        loop {
            let count = affected.len();
            for (&position, expr) in &calc.expressions {
                *work = work.checked_sub(1)?;
                if !affected.contains(&position)
                    && depends_on_volatile(
                        &calc,
                        expr,
                        (position, None),
                        &affected,
                        &mut BTreeSet::new(),
                        work,
                        0,
                    )?
                {
                    *work = work.checked_sub(64)?;
                    affected.insert(position);
                }
            }
            if affected.len() == count {
                break;
            }
        }
    }
    for &(s, r, c) in &affected {
        let cell = sheets[s].cells.get_mut(&(r, c))?;
        if !errors.contains(&(s, r, c)) {
            cell.value = None;
        }
    }
    affected.extend(errors);
    Some(affected)
}

fn depends_on_volatile(
    calc: &Calculation<'_>,
    expr: &Expr,
    position: (Coord, Option<Coord>),
    affected: &BTreeSet<Coord>,
    names: &mut BTreeSet<usize>,
    work: &mut usize,
    depth: usize,
) -> Option<bool> {
    let (position, named) = position;
    *work = work.checked_sub(1)?;
    if depth > 128 {
        return None;
    }
    match expr {
        // LET binding expressions are visited through their containing call.
        Expr::Value(_) | Expr::Local(_) => Some(false),
        Expr::Ref(a) | Expr::Range(a, _) => {
            let b = if let Expr::Range(_, b) = expr { b } else { a };
            let Value::Range(a, b) = calc.range(a, b, position, named) else {
                return Some(false);
            };
            for &(sheet, row, column) in
                affected.range((a.0.min(b.0), 0, 0)..=(a.0.max(b.0), usize::MAX, usize::MAX))
            {
                *work = work.checked_sub(1)?;
                if (a.0.min(b.0)..=a.0.max(b.0)).contains(&sheet)
                    && (a.1.min(b.1)..=a.1.max(b.1)).contains(&row)
                    && (a.2.min(b.2)..=a.2.max(b.2)).contains(&column)
                {
                    return Some(true);
                }
            }
            Some(false)
        }
        Expr::Name(index) => {
            if !names.insert(*index) {
                return Some(false);
            }
            let mut origin = calc
                .book
                .formula_origins
                .get(&position)
                .copied()
                .unwrap_or(position);
            origin.0 = calc.book.names[*index].sheet.unwrap_or(origin.0);
            let result = depends_on_volatile(
                calc,
                calc.names.get(*index)?,
                (position, Some(origin)),
                affected,
                names,
                work,
                depth + 1,
            );
            names.remove(index);
            result
        }
        Expr::MatrixCell(child, anchor) => depends_on_volatile(
            calc,
            child,
            (*anchor, None),
            affected,
            names,
            work,
            depth + 1,
        ),
        Expr::Lambda(_, child) => depends_on_volatile(
            calc,
            child,
            (position, named),
            affected,
            names,
            work,
            depth + 1,
        ),
        Expr::Group(child) | Expr::Unary(_, child) => depends_on_volatile(
            calc,
            child,
            (position, named),
            affected,
            names,
            work,
            depth + 1,
        ),
        Expr::Binary(..) => {
            let mut pending = Vec::new();
            let mut base = expr;
            while let Expr::Binary(_, a, b) = base {
                *work = work.checked_sub(std::mem::size_of::<&Expr>() + 1)?;
                pending.push(b.as_ref());
                base = a;
            }
            if depends_on_volatile(
                calc,
                base,
                (position, named),
                affected,
                names,
                work,
                depth + 1,
            )? {
                return Some(true);
            }
            for right in pending.into_iter().rev() {
                if depends_on_volatile(
                    calc,
                    right,
                    (position, named),
                    affected,
                    names,
                    work,
                    depth + 1,
                )? {
                    return Some(true);
                }
            }
            Some(false)
        }
        Expr::Invoke(callee, args) => {
            for child in std::iter::once(callee.as_ref()).chain(args.iter()) {
                if depends_on_volatile(
                    calc,
                    child,
                    (position, named),
                    affected,
                    names,
                    work,
                    depth + 1,
                )? {
                    return Some(true);
                }
            }
            Some(false)
        }
        Expr::Call(name, args) => {
            if matches!(name.as_str(), "INDIRECT" | "OFFSET") {
                return Some(true);
            }
            for arg in args {
                if depends_on_volatile(
                    calc,
                    arg,
                    (position, named),
                    affected,
                    names,
                    work,
                    depth + 1,
                )? {
                    return Some(true);
                }
            }
            Some(false)
        }
    }
}

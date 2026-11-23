use super::{Calculation, Coord, Expr, Failure, Format, Value, parse};
use crate::commands::structured::xlsx::{Dialect, Sheet, Value as CellValue, Workbook};
use std::collections::BTreeSet;
use std::sync::Arc;

pub(in crate::commands) fn cache(
    dialect: Dialect,
    sheets: &mut [Sheet<String>],
    book: &Workbook,
    export_names: Option<&[String]>,
    limit: usize,
) -> Result<(), Failure> {
    let recalculate = book.recalculate || export_names.is_some();
    if !sheets
        .iter()
        .flat_map(|s| s.cells.values())
        .any(|c| (recalculate || c.value.is_none()) && c.formula.is_some())
        && !(recalculate && sheets.iter().any(|s| !s.arrays.is_empty()))
    {
        return Ok(());
    }
    if dialect == Dialect::Gnumeric {
        let mut work = limit;
        for source in sheets
            .iter()
            .flat_map(|sheet| sheet.cells.values())
            .filter_map(|cell| cell.openformula.as_deref())
            .filter(|source| source.starts_with('='))
        {
            work = work.checked_sub(source.len()).ok_or(Failure::Limit)?;
            if let Some(parsed) =
                super::super::super::office_ods::formula::convert(true, source, false, work, true)
                    .map_err(|_| Failure::Limit)?
                && let Some((start, end)) = parsed.native_diagnostic
            {
                return Err(Failure::Unsupported(format!(
                    "Unsupported ssconvert feature: formula syntax at {start}:{end}"
                )));
            }
        }
    }
    let names: Vec<_> = sheets.iter().map(|s| s.name.clone()).collect();
    let sizes = if book.sheet_sizes.is_empty() {
        vec![(1_048_576, 16_384); sheets.len()]
    } else {
        book.sheet_sizes.clone()
    };
    let mut failure = Failure::Limit;
    let result = (|| {
        let mut calc = Calculation::new(book, &names, sizes, limit);
        calc.dialect = dialect;
        let mut unsupported = false;
        let mut missing = std::collections::BTreeSet::new();
        for (index, name) in book.names.iter().enumerate() {
            let source = name.openformula.as_deref().unwrap_or(&name.expression);
            calc.work = calc.work.checked_sub(source.len())?;
            let expression = parse(
                calc.dialect,
                source,
                &names,
                book,
                name.position,
                name.sheet,
                false,
                Some(index),
                calc.work,
            )
            .ok()?;
            calc.names.push(Arc::new(
                expression.unwrap_or(Expr::Value(Value::Error("#NAME?"))),
            ));
        }
        if dialect == Dialect::Gnumeric
            && calc
                .names
                .iter()
                .any(|name| matches!(name.as_ref(), Expr::InvalidFormula(..)))
        {
            // Dependency discovery parses referenced names before evaluating
            // branches, including references from cells whose values are cached.
            for (index, sheet) in sheets.iter().enumerate() {
                for (&(row, column), cell) in &sheet.cells {
                    let Some(source) = cell.openformula.as_deref().or(cell.formula.as_deref())
                    else {
                        continue;
                    };
                    calc.work = calc.work.checked_sub(source.len())?;
                    let Some(expression) = parse(
                        dialect,
                        source,
                        &names,
                        book,
                        (index, row as i64, column as i64),
                        Some(index),
                        false,
                        None,
                        calc.work,
                    )
                    .ok()?
                    else {
                        continue;
                    };
                    let mut pending = vec![&expression];
                    let mut visited = BTreeSet::new();
                    while let Some(node) = pending.pop() {
                        calc.work = calc.work.checked_sub(64)?;
                        match node {
                            Expr::InvalidFormula(start, end) => {
                                failure = Failure::Unsupported(format!(
                                    "Unsupported ssconvert feature: formula syntax at {start}:{end}"
                                ));
                                return None;
                            }
                            Expr::Name(index) | Expr::LiveName(index, _)
                                if visited.insert(*index) =>
                            {
                                pending.push(calc.names.get(*index)?.as_ref())
                            }
                            Expr::Group(child) | Expr::Unary(_, child) => pending.push(child),
                            Expr::MatrixCell(child, _) => pending.push(child),
                            Expr::Binary(_, left, right) => {
                                pending.extend([right.as_ref(), left.as_ref()])
                            }
                            Expr::Call(_, args) => pending.extend(args.iter().rev()),
                            _ => {}
                        }
                    }
                    expression.discard();
                }
            }
        }
        for (index, sheet) in sheets.iter().enumerate() {
            for (&(r, c), cell) in &sheet.cells {
                calc.work = calc.work.checked_sub(128)?;
                let value = match &cell.value {
                    Some(CellValue::Empty) => Value::Empty,
                    Some(CellValue::Number(n)) => Value::Number(*n),
                    Some(CellValue::Bool(b)) => Value::Bool(*b),
                    Some(CellValue::Text(s)) => {
                        calc.work = calc.work.checked_sub(s.len())?;
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
                        "#REF!" => "#REF!",
                        "#DIV/0!" => "#DIV/0!",
                        "#NUM!" => "#NUM!",
                        "#NAME?" => "#NAME?",
                        "#N/A" => "#N/A",
                        "#NULL!" => "#NULL!",
                        _ => "#VALUE!",
                    }),
                    None => Value::Blank,
                };
                let position = (index, r, c);
                if let Some(source) = cell.formula.as_deref() {
                    calc.formula_sources
                        .insert(position, cell.openformula.as_deref().unwrap_or(source));
                }
                calc.values.insert(position, value);
                if let Some(format) = cell.value_format.as_deref().or(cell.format.as_deref()) {
                    calc.work = calc
                        .work
                        .checked_sub(std::mem::size_of::<(Coord, Format<'_>)>() + 32)?;
                    let format = Format::import(format, &mut calc.work)?;
                    calc.formats.insert(position, format);
                }
                if book
                    .calculation_cells
                    .as_ref()
                    .map_or(recalculate || cell.value.is_none(), |cells| {
                        cells.contains(&position)
                    })
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
                        calc.dialect,
                        source,
                        &names,
                        book,
                        (origin.0, origin.1 as i64, origin.2 as i64),
                        Some(index),
                        false,
                        None,
                        calc.work,
                    )
                    .ok()?;
                    if expression.is_none() {
                        unsupported = true;
                    }
                    calc.expressions
                        .insert(position, expression.unwrap_or(Expr::Value(Value::Blank)));
                }
            }
            for group in &sheet.arrays {
                let [r, c, w, h] = group.range;
                let position = (index, r, c);
                calc.array_sizes.insert(position, (h, w));
                if !(recalculate && book.calculation_cells.is_none())
                    && !missing.iter().any(|&(s, row, col)| {
                        s == index && (r..r + h).contains(&row) && (c..c + w).contains(&col)
                    })
                {
                    continue;
                }
                let origin = book
                    .formula_origins
                    .get(&position)
                    .copied()
                    .unwrap_or(position);
                let source = group.openformula.as_ref().unwrap_or(&group.expression);
                calc.work = calc.work.checked_sub(source.len())?;
                let expression = parse(
                    calc.dialect,
                    source,
                    &names,
                    book,
                    (origin.0, origin.1 as i64, origin.2 as i64),
                    Some(index),
                    false,
                    None,
                    calc.work,
                )
                .ok()?;
                if expression.is_none() {
                    unsupported = true;
                }
                let expression = Arc::new(expression.unwrap_or(Expr::Value(Value::Blank)));
                for row in r..r + h {
                    for col in c..c + w {
                        calc.work = calc.work.checked_sub(128)?;
                        if dialect == Dialect::Gnumeric
                            && recalculate
                            && book.calculation_cells.is_none()
                        {
                            missing.insert((index, row, col));
                        }
                        if dialect == Dialect::LibreOffice {
                            if (row, col) != (r, c)
                                && sheet
                                    .cells
                                    .get(&(row, col))
                                    .is_some_and(|cell| cell.formula.is_some())
                            {
                                continue;
                            }
                            if !recalculate
                                && sheet
                                    .cells
                                    .get(&(row, col))
                                    .is_some_and(|cell| cell.value.is_some())
                            {
                                continue;
                            }
                            missing.insert((index, row, col));
                        }
                        // A missing formula result activates the entire array for
                        // dependents. Only cells missing their own formula cache
                        // receive exported results; imported caches stay intact.
                        calc.expressions.insert(
                            (index, row, col),
                            Expr::MatrixCell(expression.clone(), position),
                        );
                    }
                }
            }
        }
        if unsupported {
            return (!recalculate).then_some(());
        }
        // Calc expands named expressions even in inactive branches.
        // Detect their compiler errors and recursion before evaluating cell values.
        if dialect == Dialect::LibreOffice && !calc.names.is_empty() {
            for expression in calc.expressions.values_mut() {
                if let Some(error) = expression.compiled_error(&calc.names, &mut calc.work)? {
                    *expression = Expr::Value(Value::Error(error));
                }
            }
        }
        let coordinates: Vec<_> = calc.expressions.keys().copied().collect();
        for coord in coordinates {
            calc.cell(coord, 0).or_else(|| {
                failure = calc.failure.take().unwrap_or(Failure::Limit);
                None
            })?;
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
                calc.cell(coord, 0).or_else(|| {
                    failure = calc.failure.take().unwrap_or(Failure::Limit);
                    None
                })?;
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
        drop(calc.formula_sources);
        let array_sizes = calc.array_sizes;
        for ((sheet, r, c), value) in calc.results {
            if !missing.contains(&(sheet, r, c)) {
                continue;
            }
            let array = array_sizes.contains_key(&(sheet, r, c));
            let format = inferred.remove(&(sheet, r, c));
            let sheet = &mut sheets[sheet];
            let cell = sheet.cells.get_mut(&(r, c))?;
            if dialect == Dialect::Gnumeric
                && recalculate
                && book.calculation_cells.is_none()
                && let Some(group) = sheet.arrays.iter().find(|g| {
                    r >= g.range[0]
                        && r < g.range[0] + g.range[3]
                        && c >= g.range[1]
                        && c < g.range[1] + g.range[2]
                })
            {
                cell.formula = Some(group.expression.clone());
                cell.openformula = group.openformula.clone();
            }

            if let Some(format) = format {
                if dialect == Dialect::Gnumeric {
                    cell.format = Some(format);
                } else {
                    cell.value_format = Some(format);
                }
            }
            if matches!(value, Value::Bool(_))
                && array
                && cell.format.as_deref().is_none_or(|f| f == "General")
            {
                cell.value_format = Some("General".into());
            }
            cell.value = match value {
                Value::Blank if dialect == Dialect::Gnumeric => None,
                Value::Blank => Some(CellValue::Number(0.)),
                Value::FunctionEmpty | Value::MatrixEmpty => None,
                Value::Empty => Some(CellValue::Empty),
                Value::Number(n) => Some(CellValue::Number(n)),
                Value::Bool(b) => Some(CellValue::Bool(b)),
                Value::Text(s) | Value::UninternedText(s) => Some(CellValue::Text(s)),
                Value::Error(e) => Some(CellValue::Error(e.into())),
                _ => None,
            };
        }
        Some(())
    })();
    result.ok_or(failure)
}

// Explicitly styled formulas and matrix anchors export the compiler's logical
// type independently of display formatting. Leave calculation and CSV values intact.
// XLSX preserves ordinary imported caches. Calc recompiles every formula,
// recalculates on-load functions even in manual mode, and propagates automatic
// invalidation through static references and named expressions.
#[cfg(test)]
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
            calc.dialect,
            source,
            &names,
            book,
            name.position,
            name.sheet,
            false,
            Some(index),
            *work,
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
                calc.dialect,
                source,
                &names,
                book,
                (origin.0, origin.1 as i64, origin.2 as i64),
                Some(s),
                false,
                None,
                *work,
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
                calc.dialect,
                source,
                &names,
                book,
                (origin.0, origin.1 as i64, origin.2 as i64),
                Some(s),
                false,
                None,
                *work,
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
                Expr::Name(index) | Expr::LiveName(index, _) if !visited.contains(index) => {
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
                // Internal compiler errors are not imported XLSX formula text.
                if cell.formula.is_some() {
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

pub(in crate::commands) fn dirty_cells(
    sheets: &[Sheet<String>],
    book: &Workbook,
    mut changed: BTreeSet<Coord>,
    work: &mut usize,
) -> Option<BTreeSet<Coord>> {
    let names: Vec<_> = sheets.iter().map(|sheet| sheet.name.clone()).collect();
    let mut calc = Calculation::new(book, &names, book.sheet_sizes.clone(), *work);
    calc.dialect = Dialect::Gnumeric;
    for (index, name) in book.names.iter().enumerate() {
        let source = name.openformula.as_deref().unwrap_or(&name.expression);
        *work = work.checked_sub(source.len() + 64)?;
        calc.names.push(Arc::new(
            parse(
                calc.dialect,
                source,
                &names,
                book,
                name.position,
                name.sheet,
                false,
                Some(index),
                *work,
            )
            .ok()??,
        ));
    }
    for (index, sheet) in sheets.iter().enumerate() {
        for (&(row, column), cell) in &sheet.cells {
            let Some(source) = cell.openformula.as_deref().or(cell.formula.as_deref()) else {
                continue;
            };
            *work = work.checked_sub(source.len() + 128)?;
            let position = (index, row, column);
            let expression = parse(
                calc.dialect,
                source,
                &names,
                book,
                (index, row as i64, column as i64),
                Some(index),
                false,
                None,
                *work,
            )
            .ok()??;
            calc.expressions.insert(position, expression);
        }
    }
    loop {
        let count = changed.len();
        for (&position, expression) in &calc.expressions {
            *work = work.checked_sub(1)?;
            if !changed.contains(&position)
                && depends_on_volatile(
                    &calc,
                    expression,
                    (position, None),
                    &changed,
                    &mut BTreeSet::new(),
                    work,
                    0,
                )?
            {
                *work = work.checked_sub(64)?;
                changed.insert(position);
            }
        }
        if changed.len() == count {
            return Some(changed);
        }
    }
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
        Expr::Value(_) | Expr::InvalidFormula(..) => Some(false),
        Expr::Radical(label) => {
            for anchor in &label.anchors {
                if depends_on_volatile(
                    calc,
                    &Expr::Ref(*anchor),
                    (position, named),
                    affected,
                    names,
                    work,
                    depth + 1,
                )? {
                    return Some(true);
                }
            }
            if let Some((first, last)) = label.data {
                return depends_on_volatile(
                    calc,
                    &Expr::Range(first, last),
                    (position, named),
                    affected,
                    names,
                    work,
                    depth + 1,
                );
            }
            Some(false)
        }
        Expr::Label(anchor, column, _, openformula) => {
            let Some(coord) = anchor.label_anchor(position, named, &calc.sizes) else {
                return Some(false);
            };
            // Production tracks the whole anchor sheet for live labels: edits
            // can extend the inferred area or change competing label cells.
            if affected.iter().any(|c| c.0 == coord.0) {
                return Some(true);
            }
            match calc.label_range(anchor, *column, *openformula, position, named, work)? {
                Value::LabelRange(a, b, _) => Some(affected.iter().any(|&(sheet, row, col)| {
                    sheet == a.0 && (a.1..=b.1).contains(&row) && (a.2..=b.2).contains(&col)
                })),
                _ => Some(false),
            }
        }
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
        Expr::LiveName(index, relocation) => {
            if !names.insert(*index) {
                return Some(false);
            }
            let expression = calc.relocated_name(*index, relocation, work)?;
            let result = depends_on_volatile(
                calc,
                &expression,
                (position, None),
                affected,
                names,
                work,
                depth + 1,
            );
            names.remove(index);
            expression.discard();
            result
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

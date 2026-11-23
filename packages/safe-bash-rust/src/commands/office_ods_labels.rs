use super::{LIMIT, formula};
use crate::commands::{
    archive::office::case_fold,
    structured::xlsx::{Sheet, Value, Workbook},
};

pub(super) fn select(
    text: &str,
    sheets: &[&Sheet<String>],
    book: &Workbook,
    position: (usize, usize, usize),
    calc: bool,
    work: &mut usize,
) -> Result<Option<(bool, (usize, usize, usize))>, &'static str> {
    let key = case_fold::fold(text);
    for local in [true, false] {
        for column in [true, false] {
            for (index, sheet) in sheets.iter().enumerate() {
                if (index == position.0) != local {
                    continue;
                }
                for pair in book
                    .label_ranges
                    .get(index)
                    .into_iter()
                    .flatten()
                    .filter(|p| p.column == column)
                {
                    let mut selected = None;
                    for (&(row, col), cell) in &sheet.cells {
                        *work = work.checked_sub(1).ok_or(LIMIT)?;
                        if row < pair.labels[0]
                            || row > pair.labels[2]
                            || col < pair.labels[1]
                            || col > pair.labels[3]
                            || (index, row, col) == position
                        {
                            continue;
                        }
                        if let Some(Value::Text(value)) = &cell.value
                            && case_fold::fold(value) == key
                            && selected.is_none_or(|previous| (col, row) < previous)
                        {
                            selected = Some((col, row));
                        }
                    }
                    if let Some((col, row)) = selected {
                        return Ok(Some((column, (index, row, col))));
                    }
                }
            }
        }
    }
    if !book.automatic_label_lookup {
        return Ok(None);
    }
    let sheet = &sheets[position.0];
    let mut matches = Vec::new();
    for (&(row, col), cell) in &sheet.cells {
        *work = work.checked_sub(1).ok_or(LIMIT)?;
        if (position.0, row, col) != position
            && matches!(&cell.value, Some(Value::Text(value)) if case_fold::fold(value) == key)
        {
            matches.push((col, row));
        }
    }
    matches.sort_unstable();
    let (mut first, mut second, mut distance, mut maximum) =
        (None, None, f64::INFINITY, usize::MAX);
    let distance_to = |(col, row): (usize, usize)| {
        (col.abs_diff(position.2) as f64).powi(2) + (row.abs_diff(position.1) as f64).powi(2)
    };
    for (col, row) in matches {
        if col > maximum {
            break;
        }
        let next = distance_to((col, row));
        if let Some((_, prior_row)) = first {
            if next >= distance {
                continue;
            }
            if col > position.2 || row > position.1 {
                second = Some((col, row));
            } else if row >= prior_row || position.1 < prior_row {
                first = Some((col, row));
                second = None;
            } else {
                continue;
            }
        } else {
            first = Some((col, row));
        }
        distance = next;
        maximum =
            (position.2 + col.abs_diff(position.2)).max(position.1 + row.abs_diff(position.1));
    }
    let Some(mut selected) = first else {
        return Ok(None);
    };
    if let Some(second) = second
        && !(position.2 >= selected.0 && position.1 >= selected.1)
        && if position.2 < selected.0 {
            position.1 >= second.1
        } else {
            distance_to(second) < distance_to(selected)
        }
    {
        selected = second;
    }
    let (col, row) = selected;
    let mut row_label = [row.checked_sub(1), row.checked_add(1)]
        .into_iter()
        .flatten()
        .any(|r| {
            sheet
                .cells
                .get(&(r, col))
                .is_some_and(|cell| matches!(cell.value, Some(Value::Text(_))))
        });
    let size = book
        .sheet_sizes
        .get(position.0)
        .copied()
        .unwrap_or((65536, 256));
    if calc
        && row + 1 < size.0
        && col + 1 < size.1
        && sheet
            .cells
            .get(&(row + 1, col))
            .is_none_or(|cell| cell.value.is_none() && cell.formula.is_none())
        && sheet
            .cells
            .get(&(row, col + 1))
            .is_some_and(|cell| matches!(cell.value, Some(Value::Number(_))))
    {
        row_label = true;
    }
    Ok(Some((!row_label, (position.0, row, col))))
}

pub(super) fn bind(
    sheets: &mut [Sheet<String>],
    book: &mut Workbook,
    label_cells: &[(usize, usize, usize)],
    label_names: &[usize],
    work: &mut usize,
) -> Result<(), String> {
    let references: Vec<_> = sheets.iter().collect();
    let mut cells = Vec::new();
    let mut names = Vec::new();
    let mut diagnostics = String::new();
    let mut unparsed = Vec::new();
    for (index, sheet) in sheets.iter().enumerate() {
        for (&(row, col), cell) in &sheet.cells {
            if !label_cells.contains(&(index, row, col)) {
                continue;
            }
            let Some(source) = cell.openformula.as_deref().filter(|s| s.contains('\'')) else {
                continue;
            };
            let Some(mut parsed) = formula::convert(true, source, false, *work, false)? else {
                continue;
            };
            if parsed.bind_labels(&references, book, (index, row, col), work)? {
                if parsed.excel.is_empty() {
                    unparsed.push(index);
                    diagnostics.push_str(&formula::parse_warning(source, &sheet.name, row, col));
                }
                cells.push(((index, row, col), parsed));
            }
        }
    }
    for (index, name) in book.names.iter().enumerate() {
        if !label_names.contains(&index) {
            continue;
        }
        let Some(source) = name.openformula.as_deref().filter(|s| s.contains('\'')) else {
            continue;
        };
        let Some(mut parsed) = formula::convert(true, source, false, *work, false)? else {
            continue;
        };
        if parsed.bind_labels(
            &references,
            book,
            (
                name.position.0,
                name.position.1 as usize,
                name.position.2 as usize,
            ),
            work,
        )? {
            if parsed.excel.is_empty() {
                diagnostics.push_str(&formula::parse_warning(
                    source,
                    &sheets[name.position.0].name,
                    name.position.1 as usize,
                    name.position.2 as usize,
                ));
            }
            names.push((index, parsed));
        }
    }
    for ((index, row, col), parsed) in cells {
        let sheet = &mut sheets[index];
        let cell = sheet.cells.get_mut(&(row, col)).unwrap();
        cell.formula = (!parsed.excel.is_empty()).then(|| parsed.excel.clone());
        cell.openformula = parsed.openformula.clone();
        if parsed.excel.is_empty() {
            sheet
                .arrays
                .retain(|group| (group.range[0], group.range[1]) != (row, col));
            if cell.value.is_none() {
                sheet.cells.remove(&(row, col));
            }
        }
        for group in &mut sheet.arrays {
            if (group.range[0], group.range[1]) == (row, col) {
                group.expression.clone_from(&parsed.excel);
                group.openformula.clone_from(&parsed.openformula);
            }
        }
    }
    for (index, parsed) in names {
        book.names[index].expression = parsed.excel;
        book.names[index].openformula = parsed.openformula;
    }
    book.names.retain(|name| !name.expression.is_empty());
    if let Some(source) = &mut book.odf {
        source.diagnostics.push_str(&diagnostics);
        source.unparsed_formulas.extend(unparsed);
    }
    Ok(())
}

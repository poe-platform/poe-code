use super::{WorkbookSheet, resolve_posix_path, xlsx};
use crate::commands::{
    archive::{
        office::{case_fold, formulas, xlsx_gnumeric},
        office_ods::formula,
    },
    coreutils::{civil_from_days, days_from_civil},
};
use xlsx::{Dialect, TypedCell, Value, Workbook};

fn quoted(text: &str, at: &mut usize) -> Option<String> {
    let quote = text[*at..].chars().next()?;
    if !matches!(quote, '\'' | '"') {
        return None;
    }
    *at += 1;
    let mut result = String::new();
    while let Some(ch) = text[*at..].chars().next() {
        *at += ch.len_utf8();
        if ch == quote {
            return Some(result);
        }
        if ch == '\\' {
            let next = text[*at..].chars().next()?;
            *at += next.len_utf8();
            result.push(next);
        } else {
            result.push(ch);
        }
    }
    None
}

fn sheet_reference(
    text: &str,
    at: &mut usize,
    sheets: &[WorkbookSheet],
    span: bool,
) -> Option<usize> {
    let start = *at;
    let name = if text[*at..].starts_with(['\'', '"']) {
        quoted(text, at)?
    } else {
        let mut only_digits = true;
        while let Some(ch) = text[*at..].chars().next() {
            if ch.is_alphabetic() || ch == '_' {
                if only_digits && *at != start && matches!(ch, 'e' | 'E') {
                    *at = start;
                    return None;
                }
                only_digits = false;
            } else if ch.is_numeric() || ch == '.' && !only_digits {
            } else {
                break;
            }
            *at += ch.len_utf8();
        }
        if !text[*at..].starts_with('!') && !(span && text[*at..].starts_with(':')) {
            *at = start;
            return None;
        }
        text[start..*at].to_owned()
    };
    let result = sheets
        .iter()
        .position(|s| case_fold::same_name(&s.name, &name));
    if result.is_none() {
        *at = start;
    }
    result
}

fn column(text: &str, at: &mut usize, maximum: usize) -> Option<usize> {
    let start = *at;
    if text[*at..].starts_with('$') {
        *at += 1;
    }
    let mut value = 0usize;
    while let Some(ch) = text.as_bytes().get(*at).filter(|c| c.is_ascii_alphabetic()) {
        value = value
            .checked_mul(26)?
            .checked_add(usize::from(ch.to_ascii_uppercase() - b'A' + 1))?;
        if value > maximum {
            *at = start;
            return None;
        }
        *at += 1;
    }
    if value == 0 {
        *at = start;
        None
    } else {
        Some(value - 1)
    }
}
fn row(text: &str, at: &mut usize, maximum: usize) -> Option<usize> {
    let start = *at;
    if text[*at..].starts_with('$') {
        *at += 1;
    }
    if !text
        .as_bytes()
        .get(*at)
        .is_some_and(|c| matches!(c, b'1'..=b'9'))
    {
        *at = start;
        return None;
    }
    let mut value = 0usize;
    while let Some(ch) = text.as_bytes().get(*at).filter(|c| c.is_ascii_digit()) {
        value = value.checked_mul(10)?.checked_add(usize::from(ch - b'0'))?;
        if value > maximum {
            *at = start;
            return None;
        }
        *at += 1;
    }
    if text[*at..]
        .chars()
        .next()
        .is_some_and(|c| c == '_' || c.is_alphanumeric())
    {
        *at = start;
        return None;
    }
    Some(value - 1)
}

fn size(sheet: &WorkbookSheet) -> (usize, usize) {
    (
        sheet
            .rows
            .len()
            .max(65536)
            .next_power_of_two()
            .min(1_048_576),
        sheet
            .rows
            .iter()
            .map(Vec::len)
            .max()
            .unwrap_or(0)
            .max(256)
            .next_power_of_two()
            .min(16384),
    )
}
fn range<'a>(
    text: &'a str,
    sheets: &[WorkbookSheet],
    sizes: &[(usize, usize)],
    source: &str,
    cwd: &str,
) -> Option<([usize; 4], &'a str)> {
    let mut at = 0;
    let qualified_book = text.starts_with('[');
    if qualified_book {
        at += 1;
        let name = if text[at..].starts_with(['\'', '"']) {
            quoted(text, &mut at)?
        } else {
            let end = text[at..].find(']')? + at;
            let name = text[at..end].to_owned();
            at = end;
            name
        };
        if !text[at..].starts_with(']') || name.is_empty() {
            return None;
        }
        at += 1;
        let source = resolve_posix_path(cwd, source);
        let parent = source.rsplit_once('/')?.0;
        if name != super::uri(cwd, &source) && resolve_posix_path(parent, &name) != source {
            return None;
        }
    }
    let first = sheet_reference(text, &mut at, sheets, true);
    if qualified_book && first.is_none() {
        return None;
    }
    let mut last = first;
    if first.is_some() {
        if text[at..].starts_with(':') {
            at += 1;
            last = Some(sheet_reference(text, &mut at, sheets, false)?);
        }
        if !text[at..].starts_with('!') {
            return None;
        }
        at += 1;
    }
    let a = *sizes.get(first.unwrap_or(0))?;
    let b = *sizes.get(last.unwrap_or(0))?;
    let (r, c, y, x);
    if let Some(col) = column(text, &mut at, a.1) {
        c = col;
        if let Some(start) = row(text, &mut at, a.0) {
            r = start;
            if text[at..].starts_with(':') {
                at += 1;
                x = column(text, &mut at, b.1)?;
                y = row(text, &mut at, b.0)?;
            } else {
                x = c;
                y = r;
            }
        } else {
            if !text[at..].starts_with(':') {
                return None;
            }
            at += 1;
            x = column(text, &mut at, a.1)?;
            r = 0;
            y = b.0 - 1;
        }
    } else {
        r = row(text, &mut at, a.0)?;
        if !text[at..].starts_with(':') {
            return None;
        }
        at += 1;
        y = row(text, &mut at, b.0)?;
        c = 0;
        x = b.1 - 1;
    }
    if !text[at..].starts_with('=') {
        return None;
    }
    Some(([r.min(y), c.min(x), r.max(y), c.max(x)], &text[at + 1..]))
}

pub(super) fn infer(text: &str, date1904: bool) -> (Value<String>, Option<String>) {
    if text.is_empty() {
        return (Value::Empty, None);
    }
    if let Some(text) = text.strip_prefix('\'') {
        return (Value::Text(text.into()), None);
    }
    if text.eq_ignore_ascii_case("true") || text.eq_ignore_ascii_case("false") {
        return (Value::Bool(text.eq_ignore_ascii_case("true")), None);
    }
    let trimmed =
        text.trim_matches(|c: char| c.is_whitespace() && c != '\u{85}' || c == '\u{feff}');
    let slash = trimmed.contains('/');
    let mut date: Vec<_> = trimmed.split(if slash { '/' } else { '-' }).collect();
    if slash && date.len() == 3 {
        date.rotate_right(1);
    }
    if date.len() == 3
        && date[0].len() == 4
        && date
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|c| c.is_ascii_digit()))
    {
        let (year, month, day) = (
            date[0].parse::<i64>().unwrap(),
            date[1].parse::<i64>().unwrap_or(-1),
            date[2].parse::<i64>().unwrap_or(-1),
        );
        if year >= 1900 && (1..=12).contains(&month) && (1..=31).contains(&day) {
            let days = days_from_civil(year, month, day);
            if civil_from_days(days) == (year, month as u32, day as u32) {
                let value = if date1904 {
                    days - days_from_civil(1904, 1, 1)
                } else {
                    days - days_from_civil(1899, 12, 31) + i64::from(year > 1900 || month > 2)
                };
                return (
                    Value::Number(value as f64),
                    Some(if slash { "m/d/yyyy" } else { "yyyy-mm-dd" }.into()),
                );
            }
        }
    }
    let currency = trimmed.starts_with('$');
    let mut numeric = trimmed.strip_prefix('$').unwrap_or(trimmed).to_owned();
    let percent = numeric.ends_with('%');
    if percent {
        numeric.pop();
        numeric = numeric
            .trim_matches(|c: char| c.is_whitespace() && c != '\u{85}' || c == '\u{feff}')
            .to_owned();
    }
    if numeric.contains(',') {
        let start = usize::from(numeric.starts_with(['+', '-']));
        let end = numeric[start..]
            .bytes()
            .take_while(|c| c.is_ascii_digit() || *c == b',')
            .count()
            + start;
        let groups: Vec<_> = numeric[start..end].split(',').collect();
        if !groups[0].is_empty()
            && groups[0].len() <= 3
            && groups.iter().skip(1).all(|g| g.len() == 3)
        {
            numeric = format!(
                "{}{}{}",
                &numeric[..start],
                groups.concat(),
                &numeric[end..]
            );
        }
    }
    if let Ok(value) = numeric.parse::<f64>()
        && value.is_finite()
    {
        return (
            Value::Number(value / if percent { 100. } else { 1. }),
            if currency {
                Some("$#,##0_);[Red]($#,##0)".into())
            } else if percent {
                Some("0%".into())
            } else {
                None
            },
        );
    }
    (Value::Text(text.into()), None)
}

pub(in super::super) fn apply(
    sheets: &mut [WorkbookSheet],
    book: &mut Workbook,
    expressions: &[String],
    source: &str,
    cwd: &str,
    limit: usize,
) -> Result<(), String> {
    let mut typed =
        xlsx::typed_sheets(sheets).ok_or("ssconvert: workbook exceeds input limit\n")?;
    let force = book.recalculate;
    let active = book.active_sheet;
    book.recalculate |= !book.manual;
    if book.sheet_sizes.is_empty() {
        book.sheet_sizes = sheets.iter().map(size).collect();
    }
    let sheet_names = typed.iter().map(|s| s.name.clone()).collect::<Vec<_>>();
    let mut work = limit;
    let mut changed = std::collections::BTreeSet::new();
    for expression in expressions {
        let ([r, c, y, x], text) = range(expression, sheets, &book.sheet_sizes, source, cwd)
            .ok_or_else(|| format!("Failed to set cell {expression}\n"))?;
        let area = (y - r + 1)
            .checked_mul(x - c + 1)
            .ok_or("ssconvert cells limit exceeded\n")?;
        work = work
            .checked_sub(
                area.saturating_mul(128)
                    .saturating_add(text.len().saturating_mul(area)),
            )
            .ok_or("ssconvert cells limit exceeded\n")?;
        let text_format = typed[active]
            .cells
            .get(&(r, c))
            .is_some_and(|c| c.format.as_deref() == Some("@"));
        let (value, format) = if text_format && !text.starts_with('\'') && !text.is_empty() {
            (Value::Text(text.into()), None)
        } else {
            infer(text, book.date1904)
        };
        let introduced;
        let candidate = if text_format {
            None
        } else if text.starts_with('=') || text.starts_with("of:=") {
            Some(text)
        } else if matches!(&value, Value::Text(_))
            && (text.starts_with('@')
                || text.starts_with(['+', '-'])
                    && text.as_bytes().get(1) != text.as_bytes().first())
        {
            introduced = format!(
                "={}",
                if text.starts_with('-') {
                    text
                } else {
                    &text[1..]
                }
            );
            Some(introduced.as_str())
        } else {
            None
        };
        let normalized = candidate
            .filter(|s| s.len() > 1)
            .map(|s| formula::expression_text(s, true, &mut work))
            .transpose()
            .map_err(|e| format!("ssconvert: {e}\n"))?
            .flatten();
        let mut parsed = normalized
            .as_deref()
            .map(|s| formula::convert(true, s, false, work, true))
            .transpose()
            .map_err(|e| format!("ssconvert: {e}\n"))?
            .flatten();
        if let Some(formula) = &mut parsed
            && !formula
                .public_expression(&mut work)
                .map_err(|e| format!("ssconvert: {e}\n"))?
        {
            parsed = None;
        }
        let names = parsed
            .as_ref()
            .filter(|p| p.error.is_none() && p.native_diagnostic.is_none())
            .map(|parsed| parsed.entry_names(&sheet_names, &book.sheet_sizes, &mut work))
            .transpose()
            .map_err(|e| format!("ssconvert: {e}\n"))?
            .flatten();
        let source_formula = normalized.as_deref().filter(|_| names.is_some());
        for (scope, name, global) in names.into_iter().flatten() {
            if global {
                continue;
            }
            if !book.names.iter().any(|n| {
                (n.sheet == scope || n.sheet.is_none()) && case_fold::same_name(&n.name, &name)
            }) {
                book.names.push(xlsx::NamedExpression {
                    name,
                    sheet: scope,
                    expression: "#NAME?".into(),
                    openformula: None,
                    position: (0, 0, 0),
                    compiled: None,
                });
            }
        }
        for group in book
            .shared_formulas
            .iter_mut()
            .filter(|group| group.sheet == active)
        {
            group
                .members
                .retain(|&(row, col)| !(r..=y).contains(&row) || !(c..=x).contains(&col));
        }
        for row in r..=y {
            for col in c..=x {
                changed.insert((active, row, col));
                let translated = source_formula
                    .map(|f| {
                        xlsx_gnumeric::translate_formula(
                            f,
                            ((row - r) as i64, (col - c) as i64),
                            true,
                            &mut work,
                        )
                    })
                    .transpose()
                    .map_err(|e| format!("ssconvert: {e}\n"))?;
                let calculation = if translated.is_some() {
                    parsed
                        .as_ref()
                        .map(|p| {
                            xlsx_gnumeric::translate_formula(
                                &p.excel,
                                ((row - r) as i64, (col - c) as i64),
                                false,
                                &mut work,
                            )
                        })
                        .transpose()
                        .map_err(|e| format!("ssconvert: {e}\n"))?
                } else {
                    None
                };
                let openformula = if let Some(source) = translated
                    .as_deref()
                    .filter(|_| candidate.is_some_and(|s| s.starts_with("of:=")))
                {
                    match formula::convert(true, source, false, work, true)
                        .map_err(|e| format!("ssconvert: {e}\n"))?
                    {
                        Some(parsed) => parsed
                            .open_document(&mut work)
                            .map_err(|e| format!("ssconvert: {e}\n"))?,
                        None => None,
                    }
                } else {
                    None
                };
                let prior = typed[active].cells.get(&(row, col));
                let retained_format = prior.and_then(|cell| cell.format.clone());
                let style = prior.and_then(|cell| cell.style.clone());
                typed[active].cells.insert(
                    (row, col),
                    TypedCell {
                        value: (translated.is_none() && !matches!(value, Value::Empty))
                            .then(|| value.clone()),
                        formula: calculation,
                        openformula,
                        formula_display: translated
                            .as_deref()
                            .map(|s| s.strip_prefix('=').unwrap_or(s).to_owned()),
                        format: format.clone().or(retained_format),
                        value_format: None,
                        style,
                        rich_text: None,
                    },
                );
                if sheets[active].rows.len() <= row {
                    sheets[active].rows.resize_with(row + 1, Vec::new);
                }
                if sheets[active].rows[row].len() <= col {
                    sheets[active].rows[row].resize(col + 1, String::new());
                }
                sheets[active].rows[row][col] = translated.unwrap_or_else(|| text.to_owned());
            }
        }
        for &[mr, mc, width, height] in &typed[active].merges.clone() {
            if mr > y || mr + height <= r || mc > x || mc + width <= c {
                continue;
            }
            for (&(row, col), cell) in &mut typed[active].cells {
                if (mr..mr + height).contains(&row)
                    && (mc..mc + width).contains(&col)
                    && (row, col) != (mr, mc)
                {
                    cell.value = None;
                    cell.formula = None;
                    cell.openformula = None;
                    cell.rich_text = None;
                    if let Some(raw) = sheets[active]
                        .rows
                        .get_mut(row)
                        .and_then(|r| r.get_mut(col))
                    {
                        raw.clear();
                    }
                }
            }
        }
    }
    if !book.manual || book.recalculate {
        let mut pending = formulas::dirty_cells(&typed, book, changed.clone(), &mut work)
            .ok_or("ssconvert: formula calculation exceeds input limit\n")?;
        for group in &book.shared_formulas {
            let sheet = &mut typed[group.sheet];
            if !force
                && !group.members.iter().any(|position| {
                    sheet
                        .cells
                        .get(position)
                        .is_some_and(|cell| cell.formula.is_some())
                })
            {
                continue;
            }
            let [r, c, w, h] = group.range;
            let dirty = force
                || group
                    .members
                    .iter()
                    .any(|&(row, col)| pending.contains(&(group.sheet, row, col)));
            for row in r..r + h {
                for col in c..c + w {
                    if !dirty {
                        pending.remove(&(group.sheet, row, col));
                        continue;
                    }
                    pending.insert((group.sheet, row, col));
                    let formula = xlsx_gnumeric::translate_formula(
                        &group.expression,
                        (
                            row as i64 - group.origin.0 as i64,
                            col as i64 - group.origin.1 as i64,
                        ),
                        false,
                        &mut work,
                    )
                    .map_err(|e| format!("ssconvert: {e}\n"))?;
                    let cell = sheet
                        .cells
                        .get_mut(&(row, col))
                        .ok_or("ssconvert: missing formula group member\n")?;
                    cell.formula = Some(formula);
                    cell.openformula = None;
                    cell.formula_display = None;
                }
            }
        }
        book.calculation_cells = (!force).then_some(pending);
        formulas::cache(Dialect::Gnumeric, &mut typed, book, None, limit).map_err(|error| {
            match error {
                formulas::Failure::Limit => {
                    "ssconvert: formula calculation exceeds input limit\n".into()
                }
                formulas::Failure::Unsupported(message) => format!("{message}\n"),
            }
        })?;
        book.calculation_cells = None;
    }
    // Keep Gnumeric function names during calculation, then serialize the edited
    // formulas for XLSX just as imported formulas are prepared by their reader.
    for (sheet, row, col) in changed {
        if let Some(cell) = typed[sheet].cells.get_mut(&(row, col))
            && let Some(source) = cell.formula.as_mut()
        {
            let input = format!(
                "msoxl:={}",
                cell.formula_display.as_deref().unwrap_or(source)
            );
            if let Some(parsed) = formula::convert(true, &input, false, work, true)
                .map_err(|e| format!("ssconvert: {e}\n"))?
            {
                if parsed
                    .has_live_references(&mut work)
                    .map_err(str::to_owned)?
                {
                    cell.openformula = parsed.openformula;
                    continue;
                }
                *source = parsed
                    .native_xlsx(&sheet_names, &mut work)
                    .map_err(|e| format!("ssconvert: {e}\n"))?;
            }
        }
    }
    for (sheet, typed) in sheets.iter_mut().zip(typed) {
        sheet.typed = Some(typed);
    }
    Ok(())
}

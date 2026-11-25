use super::{Calculation, Coord, Value, parse};
use crate::commands::spreadsheet::{DataValidation, Spreadsheet};

const LIMIT: &str = "Input validation exceeds its calculation limit";

fn formula(
    calc: &mut Calculation<'_>,
    rule: &DataValidation,
    source: &str,
    position: Coord,
) -> Option<Value> {
    let anchor = rule.ranges.first()?;
    let source = source.trim().strip_prefix('=').unwrap_or(source.trim());
    let source = Spreadsheet::translate_formula(
        source,
        calc.sheets,
        position.0,
        (
            position.1 as i64 - anchor[0] as i64,
            position.2 as i64 - anchor[1] as i64,
        ),
        &mut calc.work,
    )
    .ok()?;
    calc.work = calc.work.checked_sub(source.len().saturating_add(128))?;
    let expression = parse(
        &source,
        calc.sheets,
        calc.book,
        (position.0, position.1 as i64, position.2 as i64),
        Some(position.0),
        true,
        None,
        calc.work,
        true,
    )
    .ok()??;
    calc.eval(&expression, position, 0, false)
}

fn allowed(calc: &mut Calculation<'_>, rule: &DataValidation, position: Coord) -> Option<bool> {
    let value = calc.cell(position, 0)?;
    if matches!(&value, Value::Blank | Value::Empty)
        || matches!(&value, Value::Text(s) | Value::UninternedText(s) if s.is_empty())
    {
        return Some(rule.allow_blank);
    }
    let source = rule.formula.as_deref()?;
    if rule.kind == "list" {
        let source = source.trim().strip_prefix('=').unwrap_or(source.trim());
        if let Some(list) = source.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
            calc.work = calc.work.checked_sub(
                list.len()
                    .saturating_add(value.text().len())
                    .saturating_mul(4),
            )?;
            let target = value.text().to_lowercase();
            return Some(
                list.split(',')
                    .any(|s| s.replace("\"\"", "\"").to_lowercase() == target),
            );
        }
        let list = formula(calc, rule, source, position)?;
        let list = calc.matrix(list, 0)?;
        let target = value.text().to_lowercase();
        for row in list {
            for item in row {
                calc.work = calc.work.checked_sub(
                    item.text()
                        .len()
                        .saturating_add(target.len())
                        .saturating_add(1),
                )?;
                if !matches!(item, Value::Error(_) | Value::LiteralError(_))
                    && item.text().to_lowercase() == target
                {
                    return Some(true);
                }
            }
        }
        return Some(false);
    }
    let first = formula(calc, rule, source, position)?;
    let first = calc.scalar(first, position, 0)?;
    if rule.kind == "custom" {
        return Some(match first {
            Value::Bool(b) => b,
            Value::Number(n) => n != 0.,
            _ => false,
        });
    }
    let n = if rule.kind == "textLength" {
        let text = value.text();
        calc.work = calc.work.checked_sub(text.len())?;
        text.encode_utf16().count() as f64
    } else {
        let Value::Number(n) = value else {
            return Some(false);
        };
        if rule.kind == "whole" && n.fract() != 0. {
            return Some(false);
        }
        n
    };
    let Value::Number(first) = first else {
        return Some(false);
    };
    let second = if matches!(rule.operator.as_str(), "between" | "notBetween") {
        let second = formula(calc, rule, rule.formula2.as_deref()?, position)?;
        let Value::Number(second) = calc.scalar(second, position, 0)? else {
            return Some(false);
        };
        second
    } else {
        0.
    };
    Some(match rule.operator.as_str() {
        "between" => n >= first && n <= second,
        "notBetween" => n < first || n > second,
        "equal" => n == first,
        "notEqual" => n != first,
        "lessThan" => n < first,
        "lessThanOrEqual" => n <= first,
        "greaterThan" => n > first,
        "greaterThanOrEqual" => n >= first,
        _ => false,
    })
}

pub(in crate::commands::spreadsheet) fn check(
    book: &Spreadsheet,
    positions: &[Coord],
    limit: usize,
) -> Result<(), String> {
    let names: Vec<_> = book.sheets.iter().map(|s| s.name.clone()).collect();
    let mut calc = super::workbook::reference_calculation(book, &names, limit)?;
    for &(s, r, c) in positions {
        for rule in &book.sheets[s].validations {
            calc.work = calc
                .work
                .checked_sub(rule.ranges.len().saturating_add(1))
                .ok_or(LIMIT)?;
            if rule.kind == "none" || !rule.show_error || !rule.covers(r, c) {
                continue;
            }
            if !allowed(&mut calc, rule, (s, r, c)).ok_or(LIMIT)? {
                let cell = format!(
                    "{}{}",
                    crate::commands::structured::xlsx_idx_to_col_ref(c),
                    r + 1
                );
                return Err(format!(
                    "{}!{cell}: {}",
                    names[s],
                    rule.error
                        .as_deref()
                        .filter(|s| !s.is_empty())
                        .unwrap_or("Value does not meet this cell's input rule")
                ));
            }
        }
    }
    Ok(())
}

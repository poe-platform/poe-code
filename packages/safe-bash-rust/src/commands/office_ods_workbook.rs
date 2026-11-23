use super::super::office::case_fold;
use super::{INVALID, LIMIT, attr, children, formula, js_number};
use crate::commands::structured::{
    xlsx::{Iteration, LabelRange, LookupSearch, NamedExpression, Workbook},
    xml::{Element, Node},
};
use std::collections::BTreeSet;

pub(super) fn read(
    gnumeric: bool,
    spreadsheet: &Element,
    sheets: &[String],
    legacy: bool,
    date1904: bool,
    target: &str,
    remaining: &mut usize,
) -> Result<(Workbook, Vec<usize>, String), String> {
    let mut label_names = Vec::new();
    let mut diagnostics = String::new();
    let mut book = Workbook {
        date1904,
        lookup_search: LookupSearch::Regex,
        automatic_label_lookup: true,
        ..Workbook::default()
    };
    if let Some(settings) = children(spreadsheet, "table:calculation-settings").next() {
        book.automatic_label_lookup =
            attr(settings, "table:automatic-find-labels") != Some("false");
        book.case_insensitive = attr(settings, "table:case-sensitive") == Some("false");
        book.lookup_search = if attr(settings, "table:use-wildcards") == Some("true") {
            LookupSearch::Wildcard
        } else if attr(settings, "table:use-regular-expressions") == Some("false") {
            LookupSearch::Literal
        } else {
            LookupSearch::Regex
        };
        book.lookup_substring =
            attr(settings, "table:search-criteria-must-apply-to-whole-cell") == Some("false");
        let iteration = children(settings, "table:iteration").next();
        let maximum = iteration
            .and_then(|e| attr(e, "table:steps"))
            .unwrap_or("100");
        let maximum =
            js_number(maximum.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}'))
                .filter(|n| *n >= 0. && *n <= 9007199254740991. && n.fract() == 0.)
                .ok_or_else(|| format!("{INVALID}invalid iteration count"))?;
        if attr(settings, "table:automatic-find-labels")
            .is_some_and(|v| !matches!(v, "true" | "false"))
        {
            return Err(format!("{INVALID}invalid automatic label lookup setting"));
        }
        if let Some(iteration) = iteration {
            let tolerance = attr(iteration, "table:maximum-difference").unwrap_or("0.001");
            let tolerance =
                js_number(tolerance.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}'))
                    .ok_or("Nonfinite workbook number")?;
            if tolerance < 0. {
                return Err("Invalid iteration settings".into());
            }
            book.iteration = Some(Iteration {
                enabled: attr(iteration, "table:status") == Some("enable"),
                maximum: maximum as u64,
                tolerance,
            });
        }
    }
    let mut seen = BTreeSet::new();
    let parents = children(spreadsheet, "table:table")
        .enumerate()
        .map(|(index, table)| (table, Some(index)))
        .chain(std::iter::once((spreadsheet, None)));
    for (parent, scope) in parents {
        for container in children(parent, "table:named-expressions") {
            for node in &container.children {
                let Node::Element(node) = node else { continue };
                if !matches!(
                    node.tag.as_str(),
                    "table:named-range" | "table:named-expression"
                ) {
                    continue;
                }
                let Some(name) = attr(node, "table:name").filter(|s| !s.is_empty()) else {
                    continue;
                };
                let source = attr(node, "table:expression")
                    .map(str::to_owned)
                    .or_else(|| {
                        attr(node, "table:cell-range-address")
                            .filter(|s| !s.is_empty())
                            .map(|s| format!("=[{s}]"))
                    });
                let Some(source) = source.filter(|s| !s.is_empty()) else {
                    continue;
                };
                *remaining = remaining.checked_sub(source.len()).ok_or(LIMIT)?;
                let mut position = (scope.unwrap_or(0), 0, 0);
                if let Some(base) = attr(node, "table:base-cell-address").and_then(formula::base) {
                    if let Some(sheet) = base.sheet {
                        position.0 = sheets
                            .iter()
                            .position(|s| case_fold::fold(s) == case_fold::fold(&sheet))
                            .ok_or("Invalid named expression position")?;
                    }
                    if base.row >= 16777216 || base.column >= 16384 {
                        return Err("Invalid cell address".into());
                    }
                    position.1 = base.row as i64;
                    position.2 = base.column as i64;
                }
                let Some(mut parsed) =
                    formula::convert(gnumeric, &source, legacy, *remaining, false)?
                else {
                    if gnumeric {
                        diagnostics.push_str(&formula::parse_warning(
                            &source,
                            &sheets[position.0],
                            position.1 as usize,
                            position.2 as usize,
                        ));
                    }
                    continue;
                };
                if target != "csv" && !parsed.public_expression(remaining)? {
                    continue;
                }
                if parsed.error.is_some() || parsed.excel.is_empty() {
                    continue;
                }
                if !seen.insert((scope, name.to_owned())) {
                    return Err("Conflicting named expression".into());
                }
                *remaining = remaining
                    .checked_sub(
                        std::mem::size_of::<NamedExpression>()
                            + name.len()
                            + parsed.excel.len()
                            + parsed.openformula.as_ref().map_or(0, String::len),
                    )
                    .ok_or(LIMIT)?;
                if gnumeric && parsed.has_live_references(remaining)? {
                    label_names.push(book.names.len());
                }
                book.names.push(NamedExpression {
                    name: name.into(),
                    sheet: scope,
                    expression: parsed.excel,
                    openformula: parsed.openformula,
                    position,
                    compiled: None,
                });
            }
        }
    }
    Ok((book, label_names, diagnostics))
}

pub(super) fn labels(
    spreadsheet: &Element,
    sheets: &[String],
    book: &mut Workbook,
    remaining: &mut usize,
) -> Result<(), String> {
    let invalid = || format!("{INVALID}invalid label range");
    let address = |source: Option<&str>| {
        let source = source?;
        let (first, last) = formula::range_split(source)
            .map_or((source, source), |at| (&source[..at], &source[at + 1..]));
        let first = formula::label_base(first)?;
        let last = formula::label_base(last)?;
        let index = sheets.iter().position(|name| {
            first
                .sheet
                .as_ref()
                .is_some_and(|s| case_fold::fold(name) == case_fold::fold(s))
        })?;
        if last
            .sheet
            .as_ref()
            .is_some_and(|s| case_fold::fold(&sheets[index]) != case_fold::fold(s))
            || first.row > last.row
            || first.column > last.column
            || last.row >= 16777216
            || last.column >= 16384
        {
            return None;
        }
        Some((
            index,
            [
                first.row as usize,
                first.column as usize,
                last.row as usize,
                last.column as usize,
            ],
        ))
    };
    for container in children(spreadsheet, "table:label-ranges") {
        for node in children(container, "table:label-range") {
            let column = match attr(node, "table:orientation") {
                Some("column") => true,
                Some("row") => false,
                _ => return Err(invalid()),
            };
            let (sheet, labels) =
                address(attr(node, "table:label-cell-range-address")).ok_or_else(invalid)?;
            let (data_sheet, data) =
                address(attr(node, "table:data-cell-range-address")).ok_or_else(invalid)?;
            *remaining = remaining
                .checked_sub(std::mem::size_of::<LabelRange>())
                .ok_or(LIMIT)?;
            for (index, range) in [(sheet, labels), (data_sheet, data)] {
                let size = &mut book.sheet_sizes[index];
                size.0 = size.0.max((range[2] + 1).next_power_of_two());
                size.1 = size.1.max((range[3] + 1).next_power_of_two());
            }
            if book.label_ranges.is_empty() {
                *remaining = remaining
                    .checked_sub(sheets.len() * std::mem::size_of::<Vec<LabelRange>>())
                    .ok_or(LIMIT)?;
                book.label_ranges.resize_with(sheets.len(), Vec::new);
            }
            book.label_ranges[sheet].push(LabelRange {
                column,
                labels,
                data,
                data_sheet,
            });
        }
    }
    Ok(())
}

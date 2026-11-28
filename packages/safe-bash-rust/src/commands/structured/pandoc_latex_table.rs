use super::{PandocBlock, pandoc_table, parse_pandoc_latex};
use std::fmt::Alignment;

pub(super) fn parse(input: &str) -> Option<(pandoc_table::Table, &str)> {
    let input = input.trim_start().strip_prefix('{')?;
    let (columns, input) = input.split_once('}')?;
    let mut table = pandoc_table::Table::default();
    for ch in columns.chars() {
        let align = match ch {
            'l' => Alignment::Left,
            'c' => Alignment::Center,
            'r' => Alignment::Right,
            '|' | ' ' | '\t' | '\n' => continue,
            _ => return None,
        };
        table.cols.push((Some(align), 0.));
    }
    let (body, rest) = input.split_once("\\end{tabular}")?;
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut depth = 0usize;
    let mut chars = body.chars();
    let finish_cell = |cell: &mut String, row: &mut Vec<pandoc_table::Cell>| {
        let blocks = parse_pandoc_latex(cell.trim())?
            .into_iter()
            .map(|block| match block {
                PandocBlock::Para(inlines) => PandocBlock::Plain(inlines),
                other => other,
            })
            .collect();
        row.push(pandoc_table::Cell {
            column: row.len(),
            span: (1, 1),
            blocks,
            ..Default::default()
        });
        cell.clear();
        Some(())
    };
    while let Some(ch) = chars.next() {
        match ch {
            '\\' => {
                let escaped = chars.next()?;
                if escaped == '\\' && depth == 0 {
                    finish_cell(&mut cell, &mut row)?;
                    table.body.push(std::mem::take(&mut row));
                } else {
                    cell.push(ch);
                    cell.push(escaped);
                }
            }
            '&' if depth == 0 => finish_cell(&mut cell, &mut row)?,
            '{' => {
                depth += 1;
                cell.push(ch);
            }
            '}' => {
                depth = depth.checked_sub(1)?;
                cell.push(ch);
            }
            _ => cell.push(ch),
        }
    }
    if depth != 0 {
        return None;
    }
    if !row.is_empty() || !cell.trim().is_empty() {
        finish_cell(&mut cell, &mut row)?;
        table.body.push(row);
    }
    Some((table, rest))
}

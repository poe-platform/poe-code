use super::{json_format::LimitedText, pandoc_table::Table, render_pandoc_plain};
use crate::commands::coreutils::fold_char_width;
use std::fmt::{Alignment, Write};

fn repeat(out: &mut LimitedText<'_>, ascii: char, n: usize) -> std::fmt::Result {
    *out.remaining = out.remaining.checked_sub(n).ok_or(std::fmt::Error)?;
    out.text.extend(std::iter::repeat_n(ascii, n));
    Ok(())
}

fn width(text: &str) -> usize {
    text.chars().map(|ch| fold_char_width(ch as u32)).sum()
}

pub(super) fn render(table: &Table, mut limit: usize) -> Option<String> {
    let mut widths = vec![2; table.cols.len()];
    let mut heights = Vec::new();
    let mut multiline = false;
    let cells: Vec<Vec<Vec<String>>> = table
        .head
        .iter()
        .chain(&table.body)
        .map(|row| {
            // A separator keeps even an empty multi-column row visible.
            let mut height = usize::from(table.cols.len() > 1);
            let cells = row
                .iter()
                .zip(&mut widths)
                .map(|(cell, column)| {
                    let text = render_pandoc_plain(&cell.blocks, limit)?;
                    let lines: Vec<_> = text
                        .lines()
                        .filter(|s| !s.is_empty())
                        .map(str::to_owned)
                        .collect();
                    for line in &lines {
                        *column = (*column).max(width(line) + 2);
                    }
                    height = height.max(lines.len());
                    Some(lines)
                })
                .collect::<Option<_>>()?;
            multiline |= height > 1;
            heights.push(height);
            Some(cells)
        })
        .collect::<Option<_>>()?;
    let has_header = !table.head.is_empty() && cells[0].iter().any(|cell| !cell.is_empty());
    let mut text = String::new();
    let mut out = LimitedText {
        text: &mut text,
        remaining: &mut limit,
    };
    let rule = |out: &mut LimitedText<'_>, solid: bool| -> std::fmt::Result {
        out.write_str("  ")?;
        for (i, &n) in widths.iter().enumerate() {
            if i != 0 {
                out.write_char(if solid { '-' } else { ' ' })?;
            }
            repeat(out, '-', n)?;
        }
        Ok(())
    };
    if !has_header || multiline {
        rule(&mut out, has_header).ok()?;
    }
    for (r, row) in cells.iter().enumerate() {
        if r < table.head.len() && !has_header {
            continue;
        }
        if multiline && r > 1 {
            out.write_char('\n').ok()?;
        }
        for line in 0..heights[r] {
            if !out.text.is_empty() {
                out.write_char('\n').ok()?;
            }
            out.write_str("  ").ok()?;
            for (i, &n) in widths.iter().enumerate() {
                if i > 0 {
                    out.write_char(' ').ok()?;
                }
                let value = row
                    .get(i)
                    .and_then(|cell| cell.get(line))
                    .map_or("", String::as_str);
                let pad = n - width(value);
                let left = if value.is_empty() {
                    0
                } else {
                    match table.cols[i].0 {
                        Some(Alignment::Right) => pad,
                        Some(Alignment::Center) => pad / 2,
                        _ => 0,
                    }
                };
                repeat(&mut out, ' ', left).ok()?;
                out.write_str(value).ok()?;
                if i + 1 < widths.len() {
                    repeat(&mut out, ' ', pad - left).ok()?;
                }
            }
        }
        if r + 1 == table.head.len() {
            out.write_char('\n').ok()?;
            rule(&mut out, false).ok()?;
        }
    }
    if !has_header || multiline {
        if multiline && table.body.len() == 1 {
            out.write_char('\n').ok()?;
        }
        out.write_char('\n').ok()?;
        rule(&mut out, has_header).ok()?;
    }
    Some(text)
}

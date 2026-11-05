use super::{inlines_plain_text, json_format::LimitedText, parse_pandoc_md_inlines};
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

pub(super) fn render(
    header: &[String],
    rows: &[Vec<String>],
    pipe_alignment: Option<&[Alignment]>,
    mut limit: usize,
) -> Option<String> {
    let mut widths = vec![2; header.len()];
    let mut heights = Vec::new();
    let mut multiline = false;
    let cells: Vec<Vec<Vec<String>>> = std::iter::once(header)
        .chain(rows.iter().map(Vec::as_slice))
        .map(|row| {
            let mut height = 1;
            let cells = row
                .iter()
                .zip(&mut widths)
                .map(|(cell, column)| {
                    let text = if pipe_alignment.is_some() {
                        inlines_plain_text(&parse_pandoc_md_inlines(cell))
                    } else {
                        cell.clone()
                    };
                    let lines: Vec<_> = text
                        .lines()
                        .filter(|s| !s.is_empty())
                        .map(str::to_owned)
                        .collect();
                    for line in &lines {
                        *column = (*column).max(width(line) + 2);
                    }
                    height = height.max(lines.len());
                    lines
                })
                .collect();
            multiline |= height > 1;
            heights.push(height);
            cells
        })
        .collect();
    let has_header = cells[0].iter().any(|cell| !cell.is_empty());
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
        if r == 0 && !has_header {
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
                    match pipe_alignment.and_then(|a| a.get(i)) {
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
        if r == 0 {
            out.write_char('\n').ok()?;
            rule(&mut out, false).ok()?;
        }
    }
    if !has_header || multiline {
        if multiline && rows.len() == 1 {
            out.write_char('\n').ok()?;
        }
        out.write_char('\n').ok()?;
        rule(&mut out, has_header).ok()?;
    }
    Some(text)
}

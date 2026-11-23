use super::{WorkbookSheet, xlsx};
use crate::commands::archive::office_ods::formula;
use crate::commands::structured::xml::Element;
use std::{collections::BTreeSet, fmt::Write};
use xlsx::{Sheet, Style, Value, Workbook};

#[derive(Clone, PartialEq)]
struct OutputStyle {
    format: String,
    name: String,
    size: f64,
    align: f64,
    bold: bool,
    italic: bool,
    stipple: bool,
    borders: [bool; 4],
}
fn style_at(
    sheet: &Sheet<String>,
    source: Option<&Element>,
    row: usize,
    column: usize,
) -> OutputStyle {
    let cell = sheet.cells.get(&(row, column));
    let mut retained = Style::default();
    let style = if let Some(style) = cell.and_then(|c| c.style.as_deref()) {
        style
    } else {
        for (r, style) in &sheet.style_regions {
            if row < r[0] || row > r[2] || column < r[1] || column > r[3] {
                continue;
            }
            for (key, value) in &style.attributes {
                if let Some((_, old)) = retained.attributes.iter_mut().find(|(k, _)| k == key) {
                    old.clone_from(value);
                } else {
                    retained.attributes.push((*key, value.clone()));
                }
            }
            // Retained metadata replaces a child node as a whole.
            if !style.family.is_empty() || !style.font.is_empty() {
                retained.family.clone_from(&style.family);
                retained.font.clone_from(&style.font);
            }
            if !style.borders.is_empty() {
                retained.borders.clone_from(&style.borders);
            }
        }
        &retained
    };
    let attr = |key| {
        style
            .attributes
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.as_str())
    };
    let font = |key, default| {
        style
            .font
            .iter()
            .find(|(k, _)| *k == key)
            .and_then(|(_, v)| v.parse::<f64>().ok())
            .unwrap_or(default)
    };
    OutputStyle {
        format: cell
            .and_then(|c| {
                c.format
                    .as_deref()
                    .filter(|f| Some(*f) != c.value_format.as_deref())
            })
            .or_else(|| attr("Format"))
            .unwrap_or("General")
            .into(),
        name: if style.family.is_empty() {
            source
                .and_then(|s| super::gnumeric_read::source_style(s, row, column))
                .and_then(|s| super::gnumeric_read::children(s, "Font").next())
                .map_or("Sans", |_| "")
        } else {
            &style.family
        }
        .into(),
        size: font("Unit", 10.),
        align: attr("HAlign").and_then(|s| s.parse().ok()).unwrap_or(1.),
        bold: font("Bold", 0.) != 0.,
        italic: font("Italic", 0.) != 0.,
        stipple: attr("Shade") == Some("5"),
        borders: ["Top", "Bottom", "Left", "Right"].map(|key| {
            style
                .borders
                .iter()
                .any(|(k, value, _)| *k == key && *value > 0)
        }),
    }
}
fn escaped(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars().take_while(|c| *c != '\0') {
        if c == ';' {
            out.push_str(";;");
        } else {
            out.push(if c.is_ascii() { c } else { '?' });
        }
    }
    out
}

pub(in super::super) fn write(
    sheet: &WorkbookSheet,
    book: &Workbook,
    size: (usize, usize),
    limit: usize,
) -> Result<Vec<u8>, String> {
    let failure = "ssconvert: SYLK output exceeds byte limit\n";
    let typed = sheet.typed.as_ref().ok_or(failure)?;
    let source = super::gnumeric_read::source_sheet(book.gnumeric.as_ref(), &typed.name);
    let (mut r, mut c, mut y, mut x) = super::extent(sheet, false);
    let mut has_content = typed.cells.values().any(|cell| match &cell.value {
        None | Some(Value::Empty) => false,
        Some(Value::Text(s)) => !s.is_empty(),
        _ => true,
    });
    for (index, comment) in typed.comments.iter().enumerate() {
        if !has_content && index == 0 {
            (r, c, y, x) = (comment.row, comment.column, comment.row, comment.column);
        }
        r = r.min(comment.row);
        c = c.min(comment.column);
        y = y.max(comment.row);
        x = x.max(comment.column);
    }
    for (&(row, col), cell) in &typed.cells {
        if matches!(&cell.value, Some(Value::Text(s)) if s.is_empty()) {
            if !has_content {
                (r, c, y, x) = (row, col, row, col);
                has_content = true;
            }
            r = r.min(row);
            c = c.min(col);
            y = y.max(row);
            x = x.max(col);
        }
    }
    let mut styles = Vec::new();
    let mut collect = |style: OutputStyle| {
        if !styles.contains(&style) {
            styles.push(style);
        }
    };
    for &(row, column) in typed.cells.keys() {
        collect(style_at(typed, source, row, column));
    }
    let last_column = typed
        .style_regions
        .iter()
        .fold(x, |last, (area, _)| last.max(area[3].min(size.1 - 1)));
    let mut columns = Vec::new();
    let mut work = limit;
    for column in 0..=last_column {
        let mut boundaries = BTreeSet::from([0, size.0]);
        for (area, _) in &typed.style_regions {
            if column >= area[1] && column <= area[3] {
                boundaries.insert(area[0].min(size.0));
                boundaries.insert((area[2] + 1).min(size.0));
            }
        }
        for &(row, col) in typed.cells.keys() {
            if col == column {
                boundaries.insert(row);
                boundaries.insert(row + 1);
            }
        }
        let breaks = boundaries.into_iter().collect::<Vec<_>>();
        let mut counts: Vec<(OutputStyle, usize)> = Vec::new();
        let mut bands = Vec::new();
        for pair in breaks.windows(2) {
            work = work
                .checked_sub(typed.style_regions.len() + 1)
                .ok_or(failure)?;
            let style = style_at(typed, source, pair[0], column);
            collect(style.clone());
            let index = if let Some(index) = counts.iter().position(|(s, _)| *s == style) {
                index
            } else {
                counts.push((style, 0));
                counts.len() - 1
            };
            counts[index].1 += pair[1] - pair[0];
            bands.push((pair[0], pair[1] - 1, index));
        }
        let mut most = 0;
        for i in 1..counts.len() {
            if counts[i].1 > counts[most].1 {
                most = i;
            }
        }
        columns.push(counts[most].0.clone());
        for (row, end, index) in bands {
            if index != most {
                r = r.min(row);
                y = y.max(end);
                c = c.min(column);
                x = x.max(column);
            }
        }
    }
    if (y - r + 1).saturating_mul(x - c + 1) > limit {
        return Err(failure.into());
    }
    for row in r..=y {
        for column in c..=x {
            work = work
                .checked_sub(typed.style_regions.len() + 1)
                .ok_or(failure)?;
            collect(style_at(typed, source, row, column));
        }
    }
    styles.sort_by(|a, b| {
        a.borders
            .cmp(&b.borders)
            .then(a.stipple.cmp(&b.stipple))
            .then_with(|| a.name.encode_utf16().cmp(b.name.encode_utf16()))
            .then(a.bold.cmp(&b.bold))
            .then(a.italic.cmp(&b.italic))
            .then(a.size.total_cmp(&b.size))
            .then_with(|| a.format.encode_utf16().cmp(b.format.encode_utf16()))
            .then(a.align.total_cmp(&b.align))
    });
    let mut formats = Vec::new();
    let mut fonts = Vec::new();
    for style in &styles {
        if !formats.contains(&style.format.as_str()) {
            formats.push(style.format.as_str());
        }
        let font = (style.name.as_str(), style.size);
        if !fonts.contains(&font) {
            fonts.push(font);
        }
    }
    let style_line = |style: &OutputStyle| {
        let mut line = String::from("F");
        let align = match style.align as i32 {
            2 => "L",
            4 => "R",
            8 => "C",
            16 => "X",
            _ => "",
        };
        if !align.is_empty() {
            write!(line, ";FD0{align}").unwrap();
        }
        write!(
            line,
            ";P{};SM{}",
            formats.iter().position(|f| *f == style.format).unwrap(),
            fonts
                .iter()
                .position(|f| *f == (style.name.as_str(), style.size))
                .unwrap()
                + 1
        )
        .unwrap();
        for (enabled, key) in [(style.bold, 'D'), (style.italic, 'I'), (style.stipple, 'S')]
            .into_iter()
            .chain(style.borders.into_iter().zip(['T', 'B', 'L', 'R']))
        {
            if enabled {
                write!(line, ";S{key}").unwrap();
            }
        }
        line
    };
    let mut out = String::from("ID;PGnumeric;N;E\r\n");
    for format in &formats {
        write!(out, "P;P{format}\r\n").unwrap();
    }
    for (name, size) in &fonts {
        write!(out, "P;E{name};M{}\r\n", (size * 20. + 0.5).floor()).unwrap();
    }
    for (column, style) in columns.iter().enumerate().take(x + 1).skip(c) {
        write!(out, "{};C{}\r\n", style_line(style), column + 1).unwrap();
    }
    for row in r..=y {
        for column in c..=x {
            out.push_str(&style_line(&style_at(typed, source, row, column)));
            if column == c {
                write!(out, ";Y{}", row + 1).unwrap();
            }
            write!(out, ";X{}\r\n", column + 1).unwrap();
            if out.len() > limit {
                return Err(failure.into());
            }
        }
    }
    for (&column, axis) in typed.columns.range(c..=x) {
        if let Some(size) = axis.size.filter(|n| *n != 48.) {
            write!(
                out,
                "F;W{0} {0} {1}\r\n",
                column + 1,
                (size / 7.45 + 0.5).floor()
            )
            .unwrap();
        }
    }
    for (&row, axis) in typed.rows.range(r..=y) {
        if let Some(size) = axis.size.filter(|n| *n != 12.75) {
            write!(out, "F;M{};R{}\r\n", (size * 20. + 0.5).floor(), row + 1).unwrap();
        }
    }
    write!(out, "B;Y{};X{};D0 0 {y} {x}\r\n", y + 1, x + 1).unwrap();
    let iteration = book.iteration.as_ref();
    write!(
        out,
        "O;{}{} {:.6}{}{};V{}{}\r\n",
        if iteration.is_none_or(|i| i.enabled) {
            'A'
        } else {
            'G'
        },
        iteration.map_or(100, |i| i.maximum),
        iteration.map_or(0.001, |i| i.tolerance),
        if typed.sylk_r1c1 == Some(true) {
            ""
        } else {
            ";L"
        },
        if book.manual { ";M" } else { "" },
        if book.date1904 { 4 } else { 0 },
        if typed.sylk_hide_zero { ";Z" } else { "" }
    )
    .unwrap();
    let mut current_row = None;
    for (&(row, column), cell) in &typed.cells {
        let value = match &cell.value {
            None | Some(Value::Empty) => continue,
            Some(Value::Text(s)) => format!("\"{}\"", escaped(s)),
            Some(Value::Number(n)) => xlsx::number(*n),
            Some(Value::Bool(b)) => if *b { "TRUE" } else { "FALSE" }.into(),
            Some(Value::Error(s)) => s.clone(),
        };
        out.push('C');
        if current_row != Some(row) {
            write!(out, ";Y{}", row + 1).unwrap();
            current_row = Some(row);
        }
        write!(out, ";X{};K{value}", column + 1).unwrap();
        let group = typed.arrays.iter().find(|g| {
            row >= g.range[0]
                && row < g.range[0] + g.range[3]
                && column >= g.range[1]
                && column < g.range[1] + g.range[2]
        });
        if group.is_some_and(|g| (row, column) != (g.range[0], g.range[1])) {
            out.push_str(";I");
        } else if let Some(source) = cell
            .formula
            .as_ref()
            .or_else(|| group.map(|g| &g.expression))
        {
            let source = if sheet.delimited || book.gnumeric.is_some() {
                cell.formula_display.as_ref().unwrap_or(source)
            } else {
                source
            };
            let text = formula::write_sylk(source, (row, column), &mut work)?;
            if let Some(g) = group {
                write!(
                    out,
                    ";R{};C{};M",
                    g.range[0] + g.range[3],
                    g.range[1] + g.range[2]
                )
                .unwrap();
            } else {
                out.push_str(";E");
            }
            out.push_str(&escaped(&text));
        }
        out.push_str("\r\n");
        if out.len() > limit {
            return Err(failure.into());
        }
    }
    out.push_str("E\r\n");
    if out.len() > limit {
        return Err(failure.into());
    }
    Ok(out.into_bytes())
}

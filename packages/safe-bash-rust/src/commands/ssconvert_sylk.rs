// Gnumeric 1.12.61 plugins/sylk (GPL-2.0-or-later); see LICENSE.GNUMERIC.
use super::{updates, xlsx};
use crate::commands::archive::office_ods::formula;
use std::{collections::BTreeMap, fmt::Write, sync::Arc};
use xlsx::{
    ArrayFormula, Axis, Iteration, NamedExpression, Sheet, Style, TypedCell, Value, Workbook,
};

fn integer(text: &str) -> Option<i32> {
    let text = text.trim_start_matches(|c| " \t\r\n\x0b\x0c".contains(c));
    let start = usize::from(text.starts_with(['+', '-']));
    let end = start + text[start..].bytes().take_while(u8::is_ascii_digit).count();
    (end > start)
        .then(|| text[..end].parse::<i64>().ok().map(|n| n as i32))
        .flatten()
}
fn coord(text: &str, previous: i32, maximum: i32) -> i32 {
    integer(text)
        .filter(|n| (1..=maximum).contains(n))
        .map_or(previous, |n| n - 1)
}
fn tokens(text: &str) -> Vec<String> {
    let mut chars = text.chars().peekable();
    let mut result = Vec::new();
    let mut field = String::new();
    while let Some(c) = chars.next() {
        if c == ';' {
            if chars.peek() == Some(&';') {
                chars.next();
                field.push(';');
            } else {
                result.push(std::mem::take(&mut field));
            }
        } else if c == '\x1b' {
            if chars.peek() != Some(&'N') {
                continue;
            }
            let mut look = chars.clone();
            look.next();
            let Some(code) = look.next() else {
                continue;
            };
            chars.next();
            if !(33..127).contains(&(code as u32)) {
                continue;
            }
            chars.next();
            let table = if code < '@' {
                "¡¢£$¥#§¤'\"«,-./°±²³4µ¶·8'\"»¼½¾¿"
            } else {
                "¯¬®©TUVWXYZ[\\]^_`ÆÐªdefghØŒ°ÞmnopærðtuvwxøœßÞ}~"
            };
            if code < '@' || code >= 'P' {
                if let Some(c) = table
                    .chars()
                    .nth(code as usize - if code < '@' { 33 } else { 80 })
                {
                    field.push(c);
                } else {
                    field.push_str("undefined");
                }
            } else {
                let accent =
                    [-1, 0, 1, 2, 3, -1, -1, -1, 8, -1, 10, 39, -1, -1, -1, -1][code as usize - 64];
                if let Some(base) = chars.next() {
                    if accent < 0 {
                        field.push(base);
                    } else {
                        compose(
                            base,
                            char::from_u32(768 + accent as u32).unwrap(),
                            &mut field,
                        );
                    }
                }
            }
        } else {
            field.push(c);
        }
    }
    if !field.is_empty() {
        result.push(field);
    }
    result
}
fn value(text: &str, date1904: bool) -> Value<String> {
    if let Some(s) = text.strip_prefix('"') {
        return Value::Text(s.strip_suffix('"').unwrap_or(s).into());
    }
    if matches!(
        text,
        "#NULL!" | "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A"
    ) {
        return Value::Error(text.into());
    }
    let plain = || Value::Text(text.into());
    if text.is_empty() || text.starts_with(['\'', '=']) {
        return plain();
    }
    let tail = text.trim_end_matches(|c| " \t\r\n\x0b\x0c".contains(c));
    if tail.ends_with(|c: char| c.is_whitespace() && c != '\u{85}' || c == '\u{feff}') {
        return plain();
    }
    let (value, format) = updates::infer(text, date1904);
    if format.is_some() || text.contains(',') {
        return plain();
    }
    if matches!(value, Value::Number(n) if n == 0.) {
        if text
            .to_ascii_lowercase()
            .split('e')
            .next()
            .unwrap()
            .bytes()
            .any(|b| (b'1'..=b'9').contains(&b))
        {
            return plain();
        }
        return Value::Number(0.);
    }
    value
}
fn set(fields: &mut Vec<(&'static str, String)>, key: &'static str, value: String) {
    if let Some((_, old)) = fields.iter_mut().find(|(k, _)| *k == key) {
        *old = value;
    } else {
        fields.push((key, value));
    }
}
fn merge(style: &mut Style, other: &Style) {
    for (k, v) in &other.attributes {
        set(&mut style.attributes, k, v.clone());
    }
    for (k, v) in &other.font {
        set(&mut style.font, k, v.clone());
    }
    if !other.family.is_empty() {
        style.family.clone_from(&other.family);
    }
    for border in &other.borders {
        if let Some(old) = style.borders.iter_mut().find(|b| b.0 == border.0) {
            *old = border.clone();
        } else {
            style.borders.push(border.clone());
        }
    }
}
fn empty() -> TypedCell<String> {
    TypedCell {
        value: None,
        formula: None,
        openformula: None,
        formula_display: None,
        format: None,
        value_format: None,
        style: None,
        rich_text: None,
    }
}

pub(in super::super) fn read(
    bytes: &[u8],
    limit: usize,
    diagnostics: &mut String,
) -> Result<(Sheet<String>, Workbook), String> {
    let mut sheet = Sheet {
        style_regions: vec![],
        name: "Sheet1".into(),
        view: vec![],
        sylk_r1c1: Some(false),
        sylk_hide_zero: false,
        print: Default::default(),
        filter: None,
        cells: BTreeMap::new(),
        rows: BTreeMap::new(),
        columns: BTreeMap::new(),
        merges: vec![],
        arrays: vec![],
        comments: vec![],
        empty_headers: true,
    };
    let mut book = Workbook {
        sheet_sizes: vec![(65536, 256)],
        calculation_cells: Some(Default::default()),
        ..Workbook::default()
    };
    let (mut row, mut column) = (1, 1);
    let mut formats = Vec::new();
    let mut fonts: Vec<Style> = Vec::new();
    let mut styles = Vec::new();
    let mut work = limit;
    let mut bytes = bytes;
    let mut line_number = 0;
    let mut finished = false;
    while !bytes.is_empty() {
        line_number += 1;
        let end = bytes
            .iter()
            .position(|b| matches!(b, 10 | 13))
            .unwrap_or(bytes.len());
        let line: String = bytes[..end]
            .iter()
            .take_while(|&&b| b != 0)
            .map(|&b| char::from(b))
            .collect();
        let skip = if bytes.get(end..end + 2) == Some(b"\r\n") {
            2
        } else {
            1
        };
        bytes = &bytes[(end + skip).min(bytes.len())..];
        let line = line.trim_end_matches(|c| " \t\r\n\x0b\x0c".contains(c));
        let directive = if line.as_bytes().get(1) == Some(&b';') {
            line.chars().next()
        } else if line.starts_with('E') {
            Some('E')
        } else {
            None
        };
        if directive == Some('E') {
            finished = true;
            break;
        }
        if directive == Some('B') || "ID".starts_with(line) || "NN;".starts_with(line) {
            continue;
        }
        let fields = tokens(line.get(2..).unwrap_or(""));
        let mut warn = |message: String| {
            writeln!(diagnostics, "{line_number}:{message}").unwrap();
        };
        work = work
            .checked_sub(line.len() + 128)
            .ok_or("ssconvert SYLK records limit exceeded\n")?;
        match directive {
            Some('C') => {
                let mut v = None;
                let mut expression = None;
                let mut array = false;
                let (mut end_row, mut end_column) = (-1, -1);
                for f in &fields {
                    let key = f.chars().next();
                    let s = f.get(1..).unwrap_or("");
                    match key {
                        Some('X') => column = coord(s, column, 256),
                        Some('Y') => row = coord(s, row, 65536),
                        Some('K') => {
                            if v.is_some() {
                                warn("Multiple values in the same cell".into());
                            }
                            v = Some(value(s, book.date1904));
                        }
                        Some('E' | 'M') => {
                            if expression.is_some() {
                                warn("Multiple expressions in the same cell".into());
                            }
                            let mut names = Vec::new();
                            expression = formula::sylk(
                                s,
                                (row as usize, column as usize),
                                &mut names,
                                &mut work,
                            )
                            .map_err(|e| format!("ssconvert: {e}\n"))?;
                            for (scope, name) in names {
                                if !book
                                    .names
                                    .iter()
                                    .any(|n| n.sheet == scope && n.name.eq_ignore_ascii_case(&name))
                                {
                                    book.names.push(NamedExpression {
                                        name,
                                        sheet: scope,
                                        expression: "#NAME?".into(),
                                        openformula: None,
                                        position: (0, i64::from(row), i64::from(column)),
                                        compiled: None,
                                    });
                                }
                            }
                            if key == Some('M') {
                                array = true;
                            }
                        }
                        Some('I') => array = true,
                        Some('R') => end_row = coord(s, -1, 65536),
                        Some('C') => end_column = coord(s, -1, 256),
                        _ => {}
                    }
                }
                if v.is_some() || expression.is_some() {
                    let position = (row as usize, column as usize);
                    let mut cell = if array && expression.is_none() {
                        sheet.cells.get(&position).cloned().unwrap_or_else(empty)
                    } else {
                        empty()
                    };
                    if v.is_some() {
                        cell.value = v;
                    }
                    if expression.is_some() {
                        cell.formula = expression.clone();
                    }
                    sheet.cells.insert(position, cell);
                    if let Some(expression) = expression.filter(|_| array) {
                        let r = if end_row < 0 { row } else { end_row };
                        let c = if end_column < 0 { column } else { end_column };
                        if r >= row && c >= column {
                            work = work
                                .checked_sub(
                                    (r - row + 1) as usize * (c - column + 1) as usize * 256,
                                )
                                .ok_or("ssconvert SYLK records limit exceeded\n")?;
                            sheet.arrays.push(ArrayFormula {
                                range: [
                                    row as usize,
                                    column as usize,
                                    (c - column + 1) as usize,
                                    (r - row + 1) as usize,
                                ],
                                expression: expression.clone(),
                                openformula: None,
                                formula_display: None,
                            });
                            for y in row..=r {
                                for x in column..=c {
                                    let cell = sheet
                                        .cells
                                        .entry((y as usize, x as usize))
                                        .or_insert_with(empty);
                                    cell.formula = Some(expression.clone());
                                }
                            }
                        }
                    }
                }
            }
            Some('P') => {
                let mut font = Style::default();
                for f in &fields {
                    let key = f.chars().next();
                    let s = f.get(1..).unwrap_or("");
                    match key {
                        Some('P') => formats.push(s.to_owned()),
                        Some('E') if !s.is_empty() => font.family = s.into(),
                        Some('M') if integer(s).is_some_and(|n| n > 0) => set(
                            &mut font.font,
                            "Unit",
                            (f64::from(integer(s).unwrap()) / 20.).to_string(),
                        ),
                        Some('S') => {
                            if s.contains('I') {
                                set(&mut font.font, "Italic", "1".into());
                            }
                            if s.contains('B') {
                                set(&mut font.font, "Bold", "1".into());
                            }
                        }
                        Some('F' | 'L' | 'E' | 'M') => {}
                        _ => warn(format!(
                            "unknown P option '{}'",
                            key.map_or("undefined".into(), |c| c.to_string())
                        )),
                    }
                }
                if font != Style::default() {
                    fonts.push(font);
                }
            }
            Some('O') => {
                sheet.sylk_r1c1 = Some(true);
                for f in &fields {
                    let key = f.chars().next();
                    let s = f.get(1..).unwrap_or("");
                    match key {
                        Some('L') => sheet.sylk_r1c1 = Some(false),
                        Some('M') => book.manual = true,
                        Some('V') if s.starts_with('4') => book.date1904 = true,
                        Some('P') => {}
                        Some('Z') => sheet.sylk_hide_zero = true,
                        Some('A' | 'G') => {
                            let p: Vec<_> = s.trim().split(' ').filter(|s| !s.is_empty()).collect();
                            if p.len() >= 2
                                && let (Some(n), Ok(t)) = (integer(p[0]), p[1].parse::<f64>())
                                && t.is_finite()
                            {
                                book.iteration = Some(Iteration {
                                    enabled: key == Some('A'),
                                    maximum: n as u64,
                                    tolerance: t,
                                });
                            }
                        }
                        Some('C' | 'D' | 'E' | 'K' | 'R' | 'V') => {}
                        _ => warn(format!(
                            "unknown option '{}'",
                            key.map_or("undefined".into(), |c| c.to_string())
                        )),
                    }
                }
            }
            Some('F') => {
                let mut style = Style::default();
                let (mut full_column, mut full_row, mut size) = (-1, -1, -1);
                let mut defaults = false;
                for f in &fields {
                    let key = f.chars().next();
                    let s = f.get(1..).unwrap_or("");
                    match key {
                        Some('X') => column = coord(s, column, 256),
                        Some('Y') => row = coord(s, row, 65536),
                        Some('C') => full_column = coord(s, -1, 256),
                        Some('R') => full_row = coord(s, -1, 65536),
                        Some('M') => size = integer(s).unwrap_or(size),
                        Some('P') => {
                            if let Some(format) = integer(s)
                                .and_then(|n| usize::try_from(n).ok())
                                .and_then(|n| formats.get(n))
                            {
                                set(&mut style.attributes, "Format", format.clone());
                            }
                        }
                        Some('D' | 'F') => {
                            defaults |= key == Some('D');
                            let tail = s
                                .get(1..)
                                .unwrap_or("")
                                .trim_start_matches(|c| " \t\r\n\x0b\x0c".contains(c));
                            let at = usize::from(tail.starts_with(['+', '-']));
                            let count = tail[at..].bytes().take_while(u8::is_ascii_digit).count();
                            if count > 0 {
                                let align = match tail.as_bytes().get(at + count) {
                                    Some(b'S' | b'D') => Some(1),
                                    Some(b'L') => Some(2),
                                    Some(b'R') => Some(4),
                                    Some(b'C') => Some(8),
                                    Some(b'X') => Some(16),
                                    _ => None,
                                };
                                if let Some(a) = align {
                                    set(&mut style.attributes, "HAlign", a.to_string());
                                }
                            }
                        }
                        Some('S') => {
                            for (at, ch) in s.char_indices() {
                                match ch {
                                    'I' | 'D' => set(
                                        &mut style.font,
                                        if ch == 'I' { "Italic" } else { "Bold" },
                                        "1".into(),
                                    ),
                                    'M' => {
                                        if let Some(font) = integer(&s[at + 1..])
                                            .and_then(|n| usize::try_from(n - 1).ok())
                                            .and_then(|n| fonts.get(n))
                                        {
                                            let mut font = font.clone();
                                            font.font.retain(|(k, _)| *k == "Unit");
                                            merge(&mut style, &font);
                                        }
                                        break;
                                    }
                                    'S' => set(&mut style.attributes, "Shade", "5".into()),
                                    'T' | 'B' | 'L' | 'R' => {
                                        let key = match ch {
                                            'T' => "Top",
                                            'B' => "Bottom",
                                            'L' => "Left",
                                            _ => "Right",
                                        };
                                        if !style.borders.iter().any(|b| b.0 == key) {
                                            style.borders.push((key, 1, "FF000000".into()));
                                        }
                                    }
                                    _ => warn(format!("unhandled style S{ch}.")),
                                }
                            }
                        }
                        Some('N') => {
                            let p: Vec<_> = s.trim().split(' ').filter(|s| !s.is_empty()).collect();
                            if p.len() >= 2
                                && integer(p[1]).is_some()
                                && let Some(font) = integer(p[0])
                                    .and_then(|n| usize::try_from(n - 1).ok())
                                    .and_then(|n| fonts.get(n))
                            {
                                defaults = true;
                                let mut font = font.clone();
                                font.font.retain(|(k, _)| *k == "Unit");
                                merge(&mut style, &font);
                            }
                        }
                        Some('W') => {
                            let p: Vec<_> = s
                                .trim()
                                .split(' ')
                                .filter(|s| !s.is_empty())
                                .map(integer)
                                .collect();
                            if let [Some(first), Some(last), Some(width), ..] = p.as_slice()
                                && *first >= 1
                                && last >= first
                                && *last <= 256
                            {
                                for c in first - 1..*last {
                                    sheet.columns.insert(
                                        c as usize,
                                        Axis {
                                            size: Some(f64::from(*width) * 7.45),
                                            ..Axis::default()
                                        },
                                    );
                                }
                            }
                        }
                        Some('Z') => sheet.sylk_hide_zero = true,
                        Some('E' | 'G' | 'H') => {}
                        Some('K') => {}
                        _ => warn(format!(
                            "unhandled F option {}.",
                            key.map_or("undefined".into(), |c| c.to_string())
                        )),
                    }
                }
                if full_column >= 0 && size > 0 {
                    sheet.columns.entry(full_column as usize).or_default().size =
                        Some(f64::from(size) / 20.);
                } else if full_row >= 0 && size > 0 {
                    sheet.rows.entry(full_row as usize).or_default().size =
                        Some(f64::from(size) / 20.);
                }
                if style != Style::default() {
                    styles.push((
                        [
                            if full_column >= 0 || defaults {
                                0
                            } else if full_row >= 0 {
                                full_row
                            } else {
                                row
                            },
                            if full_column >= 0 {
                                full_column
                            } else if full_row >= 0 || defaults {
                                0
                            } else {
                                column
                            },
                            if full_column >= 0 || defaults {
                                65535
                            } else if full_row >= 0 {
                                full_row
                            } else {
                                row
                            },
                            if full_column >= 0 {
                                full_column
                            } else if full_row >= 0 || defaults {
                                255
                            } else {
                                column
                            },
                        ],
                        style,
                    ));
                }
            }
            Some('W') => {
                for f in &fields {
                    if !f.chars().next().is_some_and(|c| "RABNSC".contains(c)) {
                        warn(format!(
                            "unhandled W option {}.",
                            f.chars()
                                .next()
                                .map_or("undefined".into(), |c| c.to_string())
                        ));
                    }
                }
            }
            _ => warn(format!("Unknown directive '{line}'")),
        }
    }
    if !finished {
        writeln!(diagnostics, "{line_number}:Missing closing 'E'").unwrap();
    }
    for (&(row, col), cell) in &mut sheet.cells {
        let mut style = Style::default();
        for (r, s) in &styles {
            work = work
                .checked_sub(1)
                .ok_or("ssconvert SYLK style work limit exceeded\n")?;
            if row >= r[0] as usize
                && row <= r[2] as usize
                && col >= r[1] as usize
                && col <= r[3] as usize
            {
                merge(&mut style, s);
            }
        }
        if style != Style::default() {
            if !style.font.is_empty() && style.family.is_empty() {
                style.family = "Sans".into();
            }
            cell.format = style
                .attributes
                .iter()
                .find(|(k, _)| *k == "Format")
                .map(|(_, v)| v.clone());
            cell.style = Some(Arc::new(style));
        }
    }
    sheet.style_regions = styles
        .into_iter()
        .map(|(r, mut s)| {
            if !s.font.is_empty() && s.family.is_empty() {
                s.family = "Sans".into();
            }
            (r.map(|v| v as usize), Arc::new(s))
        })
        .collect();
    Ok((sheet, book))
}

fn compose(base: char, accent: char, out: &mut String) {
    let pair = match (base, accent) {
        ('\u{41}', '\u{300}') => Some("\u{c0}"),
        ('\u{41}', '\u{301}') => Some("\u{c1}"),
        ('\u{41}', '\u{302}') => Some("\u{c2}"),
        ('\u{41}', '\u{303}') => Some("\u{c3}"),
        ('\u{41}', '\u{308}') => Some("\u{c4}"),
        ('\u{41}', '\u{30a}') => Some("\u{c5}"),
        ('\u{43}', '\u{301}') => Some("\u{106}"),
        ('\u{43}', '\u{302}') => Some("\u{108}"),
        ('\u{43}', '\u{327}') => Some("\u{c7}"),
        ('\u{44}', '\u{327}') => Some("\u{1e10}"),
        ('\u{45}', '\u{300}') => Some("\u{c8}"),
        ('\u{45}', '\u{301}') => Some("\u{c9}"),
        ('\u{45}', '\u{302}') => Some("\u{ca}"),
        ('\u{45}', '\u{303}') => Some("\u{1ebc}"),
        ('\u{45}', '\u{308}') => Some("\u{cb}"),
        ('\u{45}', '\u{327}') => Some("\u{228}"),
        ('\u{47}', '\u{301}') => Some("\u{1f4}"),
        ('\u{47}', '\u{302}') => Some("\u{11c}"),
        ('\u{47}', '\u{327}') => Some("\u{122}"),
        ('\u{48}', '\u{302}') => Some("\u{124}"),
        ('\u{48}', '\u{308}') => Some("\u{1e26}"),
        ('\u{48}', '\u{327}') => Some("\u{1e28}"),
        ('\u{49}', '\u{300}') => Some("\u{cc}"),
        ('\u{49}', '\u{301}') => Some("\u{cd}"),
        ('\u{49}', '\u{302}') => Some("\u{ce}"),
        ('\u{49}', '\u{303}') => Some("\u{128}"),
        ('\u{49}', '\u{308}') => Some("\u{cf}"),
        ('\u{4a}', '\u{302}') => Some("\u{134}"),
        ('\u{4b}', '\u{301}') => Some("\u{1e30}"),
        ('\u{4b}', '\u{327}') => Some("\u{136}"),
        ('\u{4c}', '\u{301}') => Some("\u{139}"),
        ('\u{4c}', '\u{327}') => Some("\u{13b}"),
        ('\u{4d}', '\u{301}') => Some("\u{1e3e}"),
        ('\u{4e}', '\u{300}') => Some("\u{1f8}"),
        ('\u{4e}', '\u{301}') => Some("\u{143}"),
        ('\u{4e}', '\u{303}') => Some("\u{d1}"),
        ('\u{4e}', '\u{327}') => Some("\u{145}"),
        ('\u{4f}', '\u{300}') => Some("\u{d2}"),
        ('\u{4f}', '\u{301}') => Some("\u{d3}"),
        ('\u{4f}', '\u{302}') => Some("\u{d4}"),
        ('\u{4f}', '\u{303}') => Some("\u{d5}"),
        ('\u{4f}', '\u{308}') => Some("\u{d6}"),
        ('\u{50}', '\u{301}') => Some("\u{1e54}"),
        ('\u{52}', '\u{301}') => Some("\u{154}"),
        ('\u{52}', '\u{327}') => Some("\u{156}"),
        ('\u{53}', '\u{301}') => Some("\u{15a}"),
        ('\u{53}', '\u{302}') => Some("\u{15c}"),
        ('\u{53}', '\u{327}') => Some("\u{15e}"),
        ('\u{54}', '\u{327}') => Some("\u{162}"),
        ('\u{55}', '\u{300}') => Some("\u{d9}"),
        ('\u{55}', '\u{301}') => Some("\u{da}"),
        ('\u{55}', '\u{302}') => Some("\u{db}"),
        ('\u{55}', '\u{303}') => Some("\u{168}"),
        ('\u{55}', '\u{308}') => Some("\u{dc}"),
        ('\u{55}', '\u{30a}') => Some("\u{16e}"),
        ('\u{56}', '\u{303}') => Some("\u{1e7c}"),
        ('\u{57}', '\u{300}') => Some("\u{1e80}"),
        ('\u{57}', '\u{301}') => Some("\u{1e82}"),
        ('\u{57}', '\u{302}') => Some("\u{174}"),
        ('\u{57}', '\u{308}') => Some("\u{1e84}"),
        ('\u{58}', '\u{308}') => Some("\u{1e8c}"),
        ('\u{59}', '\u{300}') => Some("\u{1ef2}"),
        ('\u{59}', '\u{301}') => Some("\u{dd}"),
        ('\u{59}', '\u{302}') => Some("\u{176}"),
        ('\u{59}', '\u{303}') => Some("\u{1ef8}"),
        ('\u{59}', '\u{308}') => Some("\u{178}"),
        ('\u{5a}', '\u{301}') => Some("\u{179}"),
        ('\u{5a}', '\u{302}') => Some("\u{1e90}"),
        ('\u{61}', '\u{300}') => Some("\u{e0}"),
        ('\u{61}', '\u{301}') => Some("\u{e1}"),
        ('\u{61}', '\u{302}') => Some("\u{e2}"),
        ('\u{61}', '\u{303}') => Some("\u{e3}"),
        ('\u{61}', '\u{308}') => Some("\u{e4}"),
        ('\u{61}', '\u{30a}') => Some("\u{e5}"),
        ('\u{63}', '\u{301}') => Some("\u{107}"),
        ('\u{63}', '\u{302}') => Some("\u{109}"),
        ('\u{63}', '\u{327}') => Some("\u{e7}"),
        ('\u{64}', '\u{327}') => Some("\u{1e11}"),
        ('\u{65}', '\u{300}') => Some("\u{e8}"),
        ('\u{65}', '\u{301}') => Some("\u{e9}"),
        ('\u{65}', '\u{302}') => Some("\u{ea}"),
        ('\u{65}', '\u{303}') => Some("\u{1ebd}"),
        ('\u{65}', '\u{308}') => Some("\u{eb}"),
        ('\u{65}', '\u{327}') => Some("\u{229}"),
        ('\u{67}', '\u{301}') => Some("\u{1f5}"),
        ('\u{67}', '\u{302}') => Some("\u{11d}"),
        ('\u{67}', '\u{327}') => Some("\u{123}"),
        ('\u{68}', '\u{302}') => Some("\u{125}"),
        ('\u{68}', '\u{308}') => Some("\u{1e27}"),
        ('\u{68}', '\u{327}') => Some("\u{1e29}"),
        ('\u{69}', '\u{300}') => Some("\u{ec}"),
        ('\u{69}', '\u{301}') => Some("\u{ed}"),
        ('\u{69}', '\u{302}') => Some("\u{ee}"),
        ('\u{69}', '\u{303}') => Some("\u{129}"),
        ('\u{69}', '\u{308}') => Some("\u{ef}"),
        ('\u{6a}', '\u{302}') => Some("\u{135}"),
        ('\u{6b}', '\u{301}') => Some("\u{1e31}"),
        ('\u{6b}', '\u{327}') => Some("\u{137}"),
        ('\u{6c}', '\u{301}') => Some("\u{13a}"),
        ('\u{6c}', '\u{327}') => Some("\u{13c}"),
        ('\u{6d}', '\u{301}') => Some("\u{1e3f}"),
        ('\u{6e}', '\u{300}') => Some("\u{1f9}"),
        ('\u{6e}', '\u{301}') => Some("\u{144}"),
        ('\u{6e}', '\u{303}') => Some("\u{f1}"),
        ('\u{6e}', '\u{327}') => Some("\u{146}"),
        ('\u{6f}', '\u{300}') => Some("\u{f2}"),
        ('\u{6f}', '\u{301}') => Some("\u{f3}"),
        ('\u{6f}', '\u{302}') => Some("\u{f4}"),
        ('\u{6f}', '\u{303}') => Some("\u{f5}"),
        ('\u{6f}', '\u{308}') => Some("\u{f6}"),
        ('\u{70}', '\u{301}') => Some("\u{1e55}"),
        ('\u{72}', '\u{301}') => Some("\u{155}"),
        ('\u{72}', '\u{327}') => Some("\u{157}"),
        ('\u{73}', '\u{301}') => Some("\u{15b}"),
        ('\u{73}', '\u{302}') => Some("\u{15d}"),
        ('\u{73}', '\u{327}') => Some("\u{15f}"),
        ('\u{74}', '\u{308}') => Some("\u{1e97}"),
        ('\u{74}', '\u{327}') => Some("\u{163}"),
        ('\u{75}', '\u{300}') => Some("\u{f9}"),
        ('\u{75}', '\u{301}') => Some("\u{fa}"),
        ('\u{75}', '\u{302}') => Some("\u{fb}"),
        ('\u{75}', '\u{303}') => Some("\u{169}"),
        ('\u{75}', '\u{308}') => Some("\u{fc}"),
        ('\u{75}', '\u{30a}') => Some("\u{16f}"),
        ('\u{76}', '\u{303}') => Some("\u{1e7d}"),
        ('\u{77}', '\u{300}') => Some("\u{1e81}"),
        ('\u{77}', '\u{301}') => Some("\u{1e83}"),
        ('\u{77}', '\u{302}') => Some("\u{175}"),
        ('\u{77}', '\u{308}') => Some("\u{1e85}"),
        ('\u{77}', '\u{30a}') => Some("\u{1e98}"),
        ('\u{78}', '\u{308}') => Some("\u{1e8d}"),
        ('\u{79}', '\u{300}') => Some("\u{1ef3}"),
        ('\u{79}', '\u{301}') => Some("\u{fd}"),
        ('\u{79}', '\u{302}') => Some("\u{177}"),
        ('\u{79}', '\u{303}') => Some("\u{1ef9}"),
        ('\u{79}', '\u{308}') => Some("\u{ff}"),
        ('\u{79}', '\u{30a}') => Some("\u{1e99}"),
        ('\u{7a}', '\u{301}') => Some("\u{17a}"),
        ('\u{7a}', '\u{302}') => Some("\u{1e91}"),
        ('\u{a8}', '\u{300}') => Some("\u{1fed}"),
        ('\u{a8}', '\u{301}') => Some("\u{385}"),
        ('\u{c2}', '\u{300}') => Some("\u{1ea6}"),
        ('\u{c2}', '\u{301}') => Some("\u{1ea4}"),
        ('\u{c2}', '\u{303}') => Some("\u{1eaa}"),
        ('\u{c5}', '\u{301}') => Some("\u{1fa}"),
        ('\u{c6}', '\u{301}') => Some("\u{1fc}"),
        ('\u{c7}', '\u{301}') => Some("\u{1e08}"),
        ('\u{c8}', '\u{327}') => Some("\u{228}\u{300}"),
        ('\u{c9}', '\u{327}') => Some("\u{228}\u{301}"),
        ('\u{ca}', '\u{300}') => Some("\u{1ec0}"),
        ('\u{ca}', '\u{301}') => Some("\u{1ebe}"),
        ('\u{ca}', '\u{303}') => Some("\u{1ec4}"),
        ('\u{ca}', '\u{327}') => Some("\u{228}\u{302}"),
        ('\u{cb}', '\u{327}') => Some("\u{228}\u{308}"),
        ('\u{cf}', '\u{301}') => Some("\u{1e2e}"),
        ('\u{d1}', '\u{327}') => Some("\u{145}\u{303}"),
        ('\u{d4}', '\u{300}') => Some("\u{1ed2}"),
        ('\u{d4}', '\u{301}') => Some("\u{1ed0}"),
        ('\u{d4}', '\u{303}') => Some("\u{1ed6}"),
        ('\u{d5}', '\u{301}') => Some("\u{1e4c}"),
        ('\u{d5}', '\u{308}') => Some("\u{1e4e}"),
        ('\u{d8}', '\u{301}') => Some("\u{1fe}"),
        ('\u{dc}', '\u{300}') => Some("\u{1db}"),
        ('\u{dc}', '\u{301}') => Some("\u{1d7}"),
        ('\u{e2}', '\u{300}') => Some("\u{1ea7}"),
        ('\u{e2}', '\u{301}') => Some("\u{1ea5}"),
        ('\u{e2}', '\u{303}') => Some("\u{1eab}"),
        ('\u{e5}', '\u{301}') => Some("\u{1fb}"),
        ('\u{e6}', '\u{301}') => Some("\u{1fd}"),
        ('\u{e7}', '\u{301}') => Some("\u{1e09}"),
        ('\u{e8}', '\u{327}') => Some("\u{229}\u{300}"),
        ('\u{e9}', '\u{327}') => Some("\u{229}\u{301}"),
        ('\u{ea}', '\u{300}') => Some("\u{1ec1}"),
        ('\u{ea}', '\u{301}') => Some("\u{1ebf}"),
        ('\u{ea}', '\u{303}') => Some("\u{1ec5}"),
        ('\u{ea}', '\u{327}') => Some("\u{229}\u{302}"),
        ('\u{eb}', '\u{327}') => Some("\u{229}\u{308}"),
        ('\u{ef}', '\u{301}') => Some("\u{1e2f}"),
        ('\u{f1}', '\u{327}') => Some("\u{146}\u{303}"),
        ('\u{f4}', '\u{300}') => Some("\u{1ed3}"),
        ('\u{f4}', '\u{301}') => Some("\u{1ed1}"),
        ('\u{f4}', '\u{303}') => Some("\u{1ed7}"),
        ('\u{f5}', '\u{301}') => Some("\u{1e4d}"),
        ('\u{f5}', '\u{308}') => Some("\u{1e4f}"),
        ('\u{f8}', '\u{301}') => Some("\u{1ff}"),
        ('\u{fc}', '\u{300}') => Some("\u{1dc}"),
        ('\u{fc}', '\u{301}') => Some("\u{1d8}"),
        _ => None,
    };
    if let Some(pair) = pair {
        out.push_str(pair);
    } else {
        out.push(base);
        out.push(accent);
    }
}

// XLSX uses a column default for full-sheet regions and explicit blanks for
// partial regions. The first partial region at an absent cell supplies its style.
// Keep this expansion out of import and text conversion, where whole-axis styles
// do not add any cells or change the table bounds.
pub(in super::super) fn expand(
    sheet: &mut super::WorkbookSheet,
    size: (usize, usize),
    limit: usize,
) -> Result<(), String> {
    let Some(typed) = sheet.typed.as_mut() else {
        return Ok(());
    };
    let mut remaining = limit;
    for (range, style) in &typed.style_regions {
        if *range == [0, 0, size.0 - 1, size.1 - 1] {
            continue;
        }
        let count = (range[2] - range[0] + 1).saturating_mul(range[3] - range[1] + 1);
        remaining = remaining
            .checked_sub(count.saturating_mul(128))
            .ok_or("ssconvert: workbook style range exceeds byte limit\n")?;
        for row in range[0]..=range[2] {
            for col in range[1]..=range[3] {
                if typed.cells.contains_key(&(row, col)) {
                    continue;
                }
                let mut cell = empty();
                cell.format = style
                    .attributes
                    .iter()
                    .find(|(k, _)| *k == "Format")
                    .map(|(_, v)| v.clone());
                cell.style = Some(style.clone());
                typed.cells.insert((row, col), cell);
            }
        }
    }
    Ok(())
}

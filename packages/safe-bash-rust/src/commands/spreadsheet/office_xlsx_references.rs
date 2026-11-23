use super::{
    case_fold::same_name, coordinate as valid_coordinate, formula_arguments::Syntax,
    sheet_name::quote_sheet,
};
use crate::commands::structured::xlsx_idx_to_col_ref;

#[derive(Clone, Copy)]
pub(in crate::commands) struct Address {
    pub(super) row: (usize, bool),
    pub(super) column: (usize, bool),
    pub(super) sheet: Option<usize>,
    pub(in crate::commands) relative_sheet: bool,
}
#[derive(Clone, Copy)]
pub(in crate::commands) struct Reference {
    pub(in crate::commands) end: usize,
    pub(in crate::commands) first: Address,
    pub(in crate::commands) last: Address,
    pub(super) range: bool,
    last_explicit: bool,
    pub(in crate::commands) unknown: bool,
    // Retain unresolved qualifiers separately from Calc's name-token rules.
    pub(super) missing_sheet: bool,
}

fn coordinate(source: &str) -> Option<(usize, usize)> {
    let bare = source.strip_prefix('$').unwrap_or(source);
    if bare
        .get(..5)
        .is_some_and(|s| s.eq_ignore_ascii_case("#REF!"))
    {
        let row = bare[5..].strip_prefix('$').unwrap_or(&bare[5..]);
        if row.is_empty() || !row.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let row = row.parse::<usize>().ok()?;
        return (1..=1_048_576).contains(&row).then(|| (row - 1, 16_384));
    }
    valid_coordinate(source)
}

fn partial_column(source: &str) -> Option<usize> {
    let bare = source.strip_prefix('$').unwrap_or(source);
    let letters = bare.bytes().take_while(u8::is_ascii_alphabetic).count();
    let column = bare[..letters].bytes().try_fold(0usize, |n, b| {
        n.checked_mul(26)?
            .checked_add(usize::from(b.to_ascii_uppercase() - b'A' + 1))
    })?;
    if !(1..=16_384).contains(&column) {
        return None;
    }
    let row = bare[letters..]
        .strip_prefix('$')
        .unwrap_or(&bare[letters..]);
    let digits = row.bytes().take_while(u8::is_ascii_digit).count();
    if row[..digits]
        .parse::<usize>()
        .is_ok_and(|n| (1..=1_048_576).contains(&n))
    {
        return None;
    }
    Some(column - 1)
}

fn word(source: &str) -> usize {
    let mut end = 0;
    loop {
        end += source[end..]
            .chars()
            .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '$'))
            .map(char::len_utf8)
            .sum::<usize>();
        if source[end..]
            .get(..5)
            .is_some_and(|s| s.eq_ignore_ascii_case("#REF!"))
        {
            end += 5;
        } else {
            return end;
        }
    }
}
fn label(source: &str) -> Option<(&str, usize)> {
    if !source.starts_with('\'') {
        let end = word(source);
        return (end > 0).then_some((&source[..end], end));
    }
    let mut end = 1;
    loop {
        end += source[end..].find('\'')? + 1;
        if !source[end..].starts_with('\'') {
            return Some((&source[..end], end));
        }
        end += 1;
    }
}
fn sheet<I>(raw: &str, sheets: I) -> Option<usize>
where
    I: Iterator,
    I::Item: AsRef<str>,
{
    if raw.starts_with('$') {
        return None;
    }
    let unquoted = raw
        .strip_prefix('\'')
        .and_then(|s| s.strip_suffix('\''))
        .map(|s| s.replace("''", "'"));
    let name = unquoted.as_deref().unwrap_or(raw);
    sheets
        .enumerate()
        .find_map(|(i, s)| same_name(s.as_ref(), name).then_some(i))
}

fn opaque_token(source: &str) -> Option<usize> {
    let first = source.chars().next()?;
    let mut end = first.len_utf8();
    if first == '#' {
        end = 1 + source[1..]
            .chars()
            .take_while(|c| c.is_alphanumeric() || matches!(c, '/' | '_' | '.'))
            .map(char::len_utf8)
            .sum::<usize>();
        if source[end..].starts_with(['!', '?']) {
            end += 1;
        }
    } else if first == '"' || first == '\'' {
        loop {
            let Some(next) = source[end..].find(first) else {
                end = source.len();
                break;
            };
            end += next + 1;
            if !source[end..].starts_with(first) {
                break;
            }
            end += 1;
        }
        if first == '\'' {
            if !source[..end].contains('[') {
                return None;
            }
            if source[end..].starts_with('!') {
                end += 1;
                end += word(&source[end..]);
                end = external_range_end(source, end);
            }
        }
    } else if first == '[' {
        // Both external workbook prefixes and structured table references.
        let mut depth = 0usize;
        let mut escaped = false;
        for (i, c) in source.char_indices() {
            end = i + c.len_utf8();
            if escaped {
                escaped = false;
                continue;
            }
            if c == '\'' {
                escaped = true;
                continue;
            }
            if c == '[' {
                depth += 1;
            }
            if c == ']' {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
        }
        if source[end..]
            .chars()
            .next()
            .is_some_and(|c| c.is_alphanumeric())
        {
            end = super::formula_arguments::external_reference_end(source)?;
            end = external_range_end(source, end);
        }
    } else {
        return None;
    }
    Some(end)
}

fn external_range_end(source: &str, mut end: usize) -> usize {
    if let Some(tail) = source[end..].trim_start().strip_prefix(':') {
        end = source.len() - tail.trim_start().len();
        if let Some((_, length)) = label(&source[end..]) {
            end += length;
            if source[end..].starts_with('!') {
                end += 1;
                end += word(&source[end..]);
            }
        }
    }
    end
}

// External workbook qualifiers stay opaque, but copying a formula still moves
// their relative coordinates. Structural edits never enter this path.
pub(in crate::commands) fn external_reference(source: &str) -> Option<(usize, Reference)> {
    let end = if source.starts_with('\'') {
        let (raw, end) = label(source)?;
        if !raw.contains('[') || !raw.contains(']') {
            return None;
        }
        end
    } else if source.starts_with('[') {
        let book = source.find(']')? + 1;
        book + label(&source[book..])?.1
    } else {
        return None;
    };
    if !source[end..].starts_with('!') {
        return None;
    }
    let prefix = end + 1;
    let reference = parse(&source[prefix..], std::iter::empty::<&str>())?;
    (!reference.unknown && reference.first.sheet.is_none()).then_some((prefix, reference))
}

/// Change resolved sheet references while leaving strings, external workbooks,
/// structured table labels and unrelated identifiers untouched.
pub fn map_sheet_references(
    mut source: &str,
    mapping: &[(&str, Option<&str>)],
    work: &mut usize,
) -> Option<(String, Vec<usize>)> {
    *work = work.checked_sub(source.len())?;
    let mut output = String::new();
    let sheets: Vec<_> = mapping.iter().map(|(name, _)| *name).collect();
    let renamed: Vec<_> = mapping
        .iter()
        .map(|(name, replacement)| replacement.unwrap_or(name))
        .collect();
    let mut bindings = std::collections::BTreeSet::new();
    while let Some(first) = source.chars().next() {
        *work = work.checked_sub(1)?;
        let mut end = first.len_utf8();
        let mut rewritten = None;
        if let Some(length) = opaque_token(source) {
            end = length;
        } else if let Some(mut reference) = parse(source, sheets.iter())
            .filter(|r| !r.unknown && !r.missing_sheet && r.first.sheet.is_some())
        {
            end = reference.end;
            let first = reference.first.sheet?;
            let last = reference.last.sheet?;
            bindings.insert(first);
            bindings.insert(last);
            if mapping[first].1 != Some(sheets[first]) || mapping[last].1 != Some(sheets[last]) {
                let step = if first <= last { 1i64 } else { -1 };
                let mut a = first as i64;
                let mut b = last as i64;
                while (b - a) * step >= 0 && mapping[a as usize].1.is_none() {
                    a += step;
                }
                while (b - a) * step >= 0 && mapping[b as usize].1.is_none() {
                    b -= step;
                }
                if (b - a) * step < 0 {
                    rewritten = Some("#REF!".into());
                } else {
                    reference.first.sheet = Some(a as usize);
                    reference.last.sheet = Some(b as usize);
                    rewritten = Some(reference.render(
                        renamed.iter(),
                        (0, 0),
                        (0, 0),
                        false,
                        Syntax::Editor,
                    )?);
                }
            }
        } else if let Some((raw, count)) = label(source) {
            end = count;
            // Whole-axis ranges and sheet-local defined names use the same
            // sheet-label parser as ordinary references.
            if source[end..].starts_with('!')
                && let Some(index) = sheet(raw, sheets.iter())
            {
                bindings.insert(index);
                end += 1;
                if let Some(name) = mapping[index].1 {
                    if name != sheets[index] {
                        rewritten = Some(format!("{}!", quote_sheet(name)));
                    }
                } else {
                    end += word(&source[end..]);
                    if source[end..].starts_with(':') {
                        end += 1;
                        end += word(&source[end..]);
                    }
                    rewritten = Some("#REF!".into());
                }
            }
        }
        let text = rewritten.as_deref().unwrap_or(&source[..end]);
        *work = work.checked_sub(text.len().saturating_add(end.saturating_mul(sheets.len())))?;
        output.push_str(text);
        source = &source[end..];
    }
    Some((output, bindings.into_iter().collect()))
}

/// Reference shape stays separate from its rectangular extent: whole columns
/// do not acquire row bindings when the caller stores stable grid identities.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GridReferenceKind {
    Cell,
    Range,
    Rows,
    Columns,
}
#[derive(Clone, Copy, Debug)]
pub struct GridReference {
    pub kind: GridReferenceKind,
    pub sheets: [usize; 2],
    /// A missing endpoint used to fall back to the first sheet. Report this
    /// legacy position for reading saved bindings, but never create new ones.
    pub unresolved: bool,
    /// Zero-based inclusive [top, left, bottom, right], preserving endpoint order.
    pub area: [usize; 4],
}

/// Parse comma-separated literal ranges on one worksheet without evaluating
/// formulas, names or external workbooks. Reuse the Excel import/edit grammar.
pub fn parse_cell_ranges(
    mut source: &str,
    sheets: &[String],
    scope: usize,
    mut work: usize,
) -> Result<Vec<[usize; 4]>, String> {
    const INVALID: &str = "Enter cell ranges on this sheet, such as A1:B10 or A:A, C:C";
    if scope >= sheets.len() {
        return Err("Unknown worksheet".into());
    }
    work = work
        .checked_sub(source.len())
        .ok_or("Cell ranges exceed their limit")?;
    let names = sheets
        .iter()
        .try_fold(0usize, |n, s| n.checked_add(s.len() + 32))
        .ok_or("Cell ranges exceed their limit")?;
    let mut areas = Vec::new();
    loop {
        source = source.trim_start();
        work = work
            .checked_sub(names + 128)
            .ok_or("Cell ranges exceed their limit")?;
        let (end, area) =
            if let Some((end, _, sheet, rows, first, last)) = whole_axis(source, sheets) {
                if sheet.unwrap_or(scope) != scope {
                    return Err(INVALID.into());
                }
                (
                    end,
                    if rows {
                        [first.0, 0, last.0, 16_383]
                    } else {
                        [0, first.0, 1_048_575, last.0]
                    },
                )
            } else {
                let reference = edit_reference(source, sheets).ok_or(INVALID)?;
                if reference.unknown
                    || reference.missing_sheet
                    || reference.first.sheet.unwrap_or(scope) != scope
                    || reference.last.sheet.unwrap_or(scope) != scope
                {
                    return Err(INVALID.into());
                }
                (
                    reference.end,
                    [
                        reference.first.row.0,
                        reference.first.column.0,
                        reference.last.row.0,
                        reference.last.column.0,
                    ],
                )
            };
        validate_area(area)?;
        areas.push([
            area[0].min(area[2]),
            area[1].min(area[3]),
            area[0].max(area[2]),
            area[1].max(area[3]),
        ]);
        source = source[end..].trim_start();
        if source.is_empty() {
            return Ok(areas);
        }
        source = source.strip_prefix(',').ok_or(INVALID)?;
    }
}

/// Visit A1 references using the same grammar as Excel import and
/// structural editing. Return new coordinates or None for a deleted binding.
/// Unchanged references retain their original spelling and absolute markers.
/// Unresolved endpoint ranges are reported but always retain their source text.
pub fn map_grid_references(
    mut source: &str,
    sheets: &[String],
    scope: usize,
    work: &mut usize,
    mut visit: impl FnMut(GridReference, &mut usize) -> Result<Option<[usize; 4]>, String>,
) -> Result<String, String> {
    const LIMIT: &str = "Formula references exceed their work limit";
    if scope >= sheets.len() {
        return Err("Unknown formula worksheet".into());
    }
    *work = work.checked_sub(source.len()).ok_or(LIMIT)?;
    let mut output = String::new();
    while let Some(first) = source.chars().next() {
        *work = work.checked_sub(1).ok_or(LIMIT)?;
        let mut end = first.len_utf8();
        let mut rewritten = None;
        if let Some(length) = opaque_token(source) {
            end = length;
        } else if let Some((length, prefix, target, rows, a, b)) = whole_axis(source, sheets) {
            end = length;
            let reference = GridReference {
                kind: if rows {
                    GridReferenceKind::Rows
                } else {
                    GridReferenceKind::Columns
                },
                sheets: [target.unwrap_or(scope); 2],
                unresolved: false,
                area: if rows {
                    [a.0, 0, b.0, 16_383]
                } else {
                    [0, a.0, 1_048_575, b.0]
                },
            };
            match visit(reference, work)? {
                None => rewritten = Some("#REF!".into()),
                Some(area) if area != reference.area => {
                    validate_area(area)?;
                    let (left, right) = if rows {
                        (area[0], area[2])
                    } else {
                        (area[1], area[3])
                    };
                    let render = |value: usize, fixed: bool| {
                        format!(
                            "{}{}",
                            if fixed { "$" } else { "" },
                            if rows {
                                (value + 1).to_string()
                            } else {
                                xlsx_idx_to_col_ref(value)
                            }
                        )
                    };
                    rewritten = Some(format!(
                        "{}{}:{}",
                        &source[..prefix],
                        render(left, a.1),
                        render(right, b.1)
                    ));
                }
                _ => {}
            }
        } else if let Some(mut parsed) = edit_reference(source, sheets) {
            end = parsed.end;
            if !parsed.unknown && parsed.first.column.0 < 16_384 && parsed.last.column.0 < 16_384 {
                let a = parsed.first.sheet.unwrap_or(scope);
                let b = parsed.last.sheet.unwrap_or(a);
                let reference = GridReference {
                    kind: if parsed.range {
                        GridReferenceKind::Range
                    } else {
                        GridReferenceKind::Cell
                    },
                    sheets: [a, b],
                    unresolved: parsed.missing_sheet,
                    area: [
                        parsed.first.row.0,
                        parsed.first.column.0,
                        parsed.last.row.0,
                        parsed.last.column.0,
                    ],
                };
                match visit(reference, work)? {
                    _ if parsed.missing_sheet => {}
                    None => rewritten = Some("#REF!".into()),
                    Some(area) if area != reference.area => {
                        validate_area(area)?;
                        parsed.first.row.0 = area[0];
                        parsed.first.column.0 = area[1];
                        parsed.last.row.0 = area[2];
                        parsed.last.column.0 = area[3];
                        rewritten = Some(
                            parsed
                                .render(
                                    sheets.iter(),
                                    (scope, scope),
                                    (0, 0),
                                    false,
                                    Syntax::Editor,
                                )
                                .ok_or(LIMIT)?,
                        );
                    }
                    _ => {}
                }
            }
        } else if let Some((_, length)) = label(source) {
            end = length;
            // Unknown sheet-qualified names/axes must never become local refs.
            if source[end..].starts_with('!') {
                end += 1;
                end += word(&source[end..]);
                if source[end..].starts_with(':') {
                    end += 1;
                    end += word(&source[end..]);
                }
            }
        }
        let text = rewritten.as_deref().unwrap_or(&source[..end]);
        *work = work
            .checked_sub(
                text.len()
                    .saturating_add(end.saturating_mul(sheets.len() + 1)),
            )
            .ok_or(LIMIT)?;
        output.push_str(text);
        source = &source[end..];
    }
    Ok(output)
}
fn validate_area(area: [usize; 4]) -> Result<(), String> {
    if area[0] >= 1_048_576 || area[2] >= 1_048_576 || area[1] >= 16_384 || area[3] >= 16_384 {
        Err("Formula reference is outside the sheet".into())
    } else {
        Ok(())
    }
}

pub(super) fn map_axis_references(
    source: &str,
    sheets: &[String],
    scope: usize,
    edit: super::editor_structure::AxisEdit,
    work: &mut usize,
) -> Result<String, String> {
    map_grid_references(source, sheets, scope, work, |reference, _| {
        if reference.unresolved {
            return Ok(Some(reference.area));
        }
        let [a, b] = reference.sheets;
        if a != b && (a.min(b)..=a.max(b)).contains(&edit.sheet) {
            return Err(
                "Row and column edits through a 3D formula reference are not supported yet".into(),
            );
        }
        let mut area = reference.area;
        if a != edit.sheet
            || b != edit.sheet
            || reference.kind == GridReferenceKind::Rows && edit.columns
            || reference.kind == GridReferenceKind::Columns && !edit.columns
        {
            return Ok(Some(area));
        }
        let i = usize::from(edit.columns);
        let changed = if reference.kind == GridReferenceKind::Cell {
            edit.point(area[i]).map(|p| (p, p))
        } else {
            edit.range(area[i], area[i + 2])
        };
        Ok(changed.map(|(first, last)| {
            area[i] = first;
            area[i + 2] = last;
            area
        }))
    })
}

fn edit_reference(source: &str, sheets: &[String]) -> Option<Reference> {
    let reference = parse(source, sheets.iter())?;
    if reference.range {
        return Some(reference);
    }
    let tail = source[reference.end..].trim_start();
    let Some(tail) = tail.strip_prefix(':') else {
        return Some(reference);
    };
    let tail = tail.trim_start();
    let Some(last) = parse(tail, sheets.iter()).filter(|r| !r.range) else {
        return Some(reference);
    };
    let combined = format!("{}:{}", &source[..reference.end], &tail[..last.end]);
    let Some(mut combined) = parse(&combined, sheets.iter()).filter(|r| r.range) else {
        return Some(reference);
    };
    combined.end = source.len() - tail.len() + last.end;
    Some(combined)
}

// The ordinary address parser deliberately leaves whole-axis ranges to its
// caller. Keep their original sheet qualifier and absolute-axis markers.
fn whole_axis(
    source: &str,
    sheets: &[String],
) -> Option<(
    usize,
    usize,
    Option<usize>,
    bool,
    (usize, bool),
    (usize, bool),
)> {
    let (first, mut end) = label(source)?;
    let (prefix, target, first) = if source[end..].starts_with('!') {
        let target = sheet(first, sheets.iter())?;
        end += 1;
        let prefix = end;
        let (first, count) = label(&source[end..])?;
        end += count;
        (prefix, Some(target), first)
    } else {
        (0, None, first)
    };
    let tail = source[end..].trim_start().strip_prefix(':')?.trim_start();
    let (last, count) = label(tail)?;
    if tail[count..].starts_with('!') {
        return None;
    }
    let axis = |s: &str| {
        let fixed = s.starts_with('$');
        let bare = s.strip_prefix('$').unwrap_or(s);
        if bare.is_empty() {
            return None;
        }
        let rows = bare.bytes().all(|b| b.is_ascii_digit());
        let value = if rows {
            bare.parse::<usize>().ok()?
        } else {
            bare.bytes().try_fold(0usize, |n, b| {
                b.is_ascii_alphabetic().then_some(())?;
                n.checked_mul(26)?
                    .checked_add(usize::from(b.to_ascii_uppercase() - b'A' + 1))
            })?
        };
        (1..=if rows { 1_048_576 } else { 16_384 })
            .contains(&value)
            .then_some((rows, (value - 1, fixed)))
    };
    let (rows, a) = axis(first)?;
    let (last_rows, b) = axis(last)?;
    if rows != last_rows {
        return None;
    }
    Some((
        source.len() - tail.len() + count,
        prefix,
        target,
        rows,
        a,
        b,
    ))
}

// A token can contain a sheet span or a second qualified endpoint. Whitespace
// separates tokens, so `Sheet1!A1 : Sheet1!B2` must retain both prefixes.
pub(in crate::commands) fn parse<I>(source: &str, sheets: I) -> Option<Reference>
where
    I: Iterator + Clone,
    I::Item: AsRef<str>,
{
    let (raw, mut end) = label(source)?;
    let mut first_sheet = None;
    let mut last_sheet = None;
    let mut span = false;
    let mut relative_end = false;
    let mut unknown = false;
    let address;
    if source[end..].starts_with('!') {
        let decoded = raw
            .strip_prefix('\'')
            .and_then(|s| s.strip_suffix('\''))
            .map(|s| s.replace("''", "'"));
        if let Some((a, b)) = decoded.as_deref().and_then(|s| s.split_once(':')) {
            first_sheet = sheet(a, sheets.clone());
            last_sheet = sheet(b, sheets.clone());
            span = true;
        } else {
            first_sheet = sheet(raw, sheets.clone());
            last_sheet = first_sheet;
        }
        unknown = first_sheet.is_none() || last_sheet.is_none();
        end += 1;
        let count = word(&source[end..]);
        address = &source[end..end + count];
        end += count;
    } else if source[end..].starts_with(':')
        && let Some((other, count)) = label(&source[end + 1..])
        && source[end + 1 + count..].starts_with('!')
        && coordinate(raw).is_none()
    {
        first_sheet = sheet(raw, sheets.clone());
        last_sheet = sheet(other, sheets.clone());
        span = true;
        let mixed_quotes = raw.starts_with('\'') || other.starts_with('\'');
        relative_end = mixed_quotes || first_sheet <= last_sheet;
        unknown = first_sheet.is_none() || last_sheet.is_none();
        if !mixed_quotes && first_sheet > last_sheet {
            std::mem::swap(&mut first_sheet, &mut last_sheet);
        }
        end += count + 2;
        let count = word(&source[end..]);
        address = &source[end..end + count];
        end += count;
    } else {
        address = raw;
    }
    let missing_sheet = unknown;
    let position = coordinate(address);
    if position.is_none() {
        // A qualified whole-axis pair with another sheet prefix is an unknown
        // identifier. Valid Sheet!A:C / Sheet!1:3 use the existing axis parser.
        let tail = source[end..].strip_prefix(':')?;
        let (_, count) = label(tail)?;
        if first_sheet.is_none() || !tail[count..].starts_with('!') {
            return None;
        }
        end += count + 2;
        end += word(&source[end..]);
        unknown = true;
    }
    let (row, column) = position.unwrap_or((0, 0));
    let fixed_column = address.starts_with('$');
    let bare = address.strip_prefix('$').unwrap_or(address);
    let letters = if column == 16_384 {
        5
    } else {
        bare.bytes().take_while(u8::is_ascii_alphabetic).count()
    };
    let first = Address {
        row: (row, bare[letters..].starts_with('$')),
        column: (column, fixed_column),
        sheet: first_sheet,
        relative_sheet: first_sheet.is_none(),
    };
    let mut token = Reference {
        end,
        first,
        last: Address {
            sheet: last_sheet,
            relative_sheet: last_sheet.is_none(),
            ..first
        },
        range: span,
        last_explicit: span,
        unknown,
        missing_sheet,
    };
    if unknown && span {
        return Some(token);
    }
    if source[end..].starts_with(':') {
        let tail = &source[end + 1..];
        let Some((last, count)) = label(tail) else {
            return Some(token);
        };
        let mut count = count;
        let mut last_sheet = token.last.sheet;
        let last_address;
        let qualified = tail[count..].starts_with('!');
        let partial = partial_column(last);
        let mut last_explicit = false;
        let mut missing_sheet = false;
        if qualified {
            let target = sheet(last, sheets.clone());
            missing_sheet = target.is_none();
            last_explicit = target.is_some();
            last_sheet = target.or(token.first.sheet);
            count += 1;
            let length = word(&tail[count..]);
            last_address = &tail[count..count + length];
            count += length;
        } else {
            last_address = last;
        }
        if let Some((row, column)) =
            coordinate(last_address).filter(|_| !qualified || partial.is_none())
        {
            let bare = last_address.strip_prefix('$').unwrap_or(last_address);
            let letters = if column == 16_384 {
                5
            } else {
                bare.bytes().take_while(u8::is_ascii_alphabetic).count()
            };
            token.last = Address {
                row: (row, bare[letters..].starts_with('$')),
                column: (column, last_address.starts_with('$')),
                sheet: last_sheet,
                relative_sheet: last_sheet.is_none() || span && relative_end,
            };
            token.range = true;
            token.last_explicit |= last_explicit;
            token.unknown |= qualified && token.first.sheet.is_none();
            token.missing_sheet |= missing_sheet;
            token.end += count + 1;
        } else if let Some(column) =
            partial.or_else(|| token.first.sheet.and_then(|_| partial_column(last_address)))
        {
            // Calc retains a parsed column when the row is missing or invalid.
            // Without an initial sheet qualifier this is one unknown token,
            // even when the endpoint spelling is a declared name.
            token.unknown |= token.first.sheet.is_none();
            token.last.column = (column, false);
            token.last.row = (token.first.row.0, false);
            if partial.is_none() {
                token.last.sheet = last_sheet;
                token.last.relative_sheet = last_sheet.is_none() || span && relative_end;
                token.last_explicit |= last_explicit;
            }
            token.range = true;
            token.end += count + 1;
        }
    }
    if token.first.sheet.is_none()
        && !token.range
        && source[token.end..].trim_start().starts_with('(')
    {
        return None;
    }
    if token.range && (token.first.column.0 == 16_384 || token.last.column.0 == 16_384) {
        // Deleted columns sort before A, as Calc's -1 coordinate does.
        if token.first.row.0 > token.last.row.0 {
            std::mem::swap(&mut token.first.row, &mut token.last.row);
        }
        let column = |value| (value != 16_384, value);
        if column(token.first.column.0) > column(token.last.column.0) {
            std::mem::swap(&mut token.first.column, &mut token.last.column);
        }
    }
    // Calc folds a trailing singleton into the preceding range token. An
    // endpoint pair after another colon remains a separate stored token.
    if token.range
        && !token.unknown
        && let Some(tail) = source[token.end..].strip_prefix(':')
    {
        let Some((last, count)) = label(tail) else {
            return Some(token);
        };
        let (address, count) = if tail[count..].starts_with('!') {
            if sheet(last, sheets).is_none() {
                return Some(token);
            }
            token.last_explicit = true;
            let start = count + 1;
            let count = word(&tail[start..]);
            (&tail[start..start + count], start + count)
        } else {
            (last, count)
        };
        if !tail[count..].starts_with(':')
            && let Some((row, column)) = coordinate(address)
        {
            let bare = address.strip_prefix('$').unwrap_or(address);
            let letters = if column == 16_384 {
                5
            } else {
                bare.bytes().take_while(u8::is_ascii_alphabetic).count()
            };
            for (a, b, next) in [
                (
                    &mut token.first.row,
                    &mut token.last.row,
                    (row, bare[letters..].starts_with('$')),
                ),
                (
                    &mut token.first.column,
                    &mut token.last.column,
                    (column, address.starts_with('$')),
                ),
            ] {
                if a.0 > b.0 {
                    std::mem::swap(a, b);
                }
                if next.0 < a.0 {
                    *a = next;
                }
                if next.0 > b.0 {
                    *b = next;
                }
            }
            token.end += 1 + count;
        }
    }
    Some(token)
}

// Normalize reference spelling only after sheet-name repair and calculation.
// XLSX operator compilation must not rewrite OpenFormula unions/intersections.
pub(in crate::commands) fn export(
    mut source: &str,
    sheets: &[String],
    remaining: &mut usize,
) -> Result<String, &'static str> {
    const LIMIT: &str = "Error: conversion failed: worksheet exceeds byte limit\n";
    let mut output = String::new();
    while let Some(first) = source.chars().next() {
        *remaining = remaining.checked_sub(1).ok_or(LIMIT)?;
        let embedded_quote = matches!(first, '\'' | '"')
            && output
                .chars()
                .last()
                .is_some_and(|c| c.is_alphanumeric() || c == '_');
        if first != '"'
            && !embedded_quote
            && let Some(reference) = parse(source, sheets.iter())
                .filter(|r| r.first.sheet.is_some() || r.range || r.unknown)
        {
            *remaining = remaining
                .checked_sub(reference.end.checked_mul(sheets.len() + 3).ok_or(LIMIT)?)
                .ok_or(LIMIT)?;
            let text = if reference.unknown {
                source[..reference.end].to_owned()
            } else {
                reference
                    .render(sheets.iter(), (0, 0), (0, 0), false, Syntax::Ods)
                    .ok_or("Invalid formula reference")?
            };
            *remaining = remaining.checked_sub(text.len()).ok_or(LIMIT)?;
            output.push_str(&text);
            source = &source[reference.end..];
            continue;
        }
        let mut end = first.len_utf8();
        if matches!(first, '\'' | '"') && !embedded_quote {
            loop {
                let Some(next) = source[end..].find(first) else {
                    end = source.len();
                    break;
                };
                end += next + 1;
                if !source[end..].starts_with(first) {
                    break;
                }
                end += 1;
            }
        } else if first.is_alphanumeric() || matches!(first, '_' | '.' | '$') {
            end = source
                .chars()
                .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '$'))
                .map(char::len_utf8)
                .sum();
        }
        *remaining = remaining.checked_sub(end).ok_or(LIMIT)?;
        output.push_str(&source[..end]);
        source = &source[end..];
    }
    Ok(output)
}

impl Reference {
    pub(in crate::commands) fn render<I>(
        self,
        sheets: I,
        scope: (usize, usize),
        offset: (i64, i64),
        qualify: bool,
        syntax: Syntax,
    ) -> Option<String>
    where
        I: Iterator + Clone,
        I::Item: AsRef<str>,
    {
        if self.unknown
            || self.missing_sheet && matches!(syntax, Syntax::Editor | Syntax::EditorXlsx)
        {
            return None;
        }
        let shift = |sheet: Option<usize>, relative: bool| {
            let base = sheet? as i64;
            usize::try_from(
                base + if relative {
                    scope.1 as i64 - scope.0 as i64
                } else {
                    0
                },
            )
            .ok()
        };
        let first_sheet = if self.first.sheet.is_some() {
            Some(shift(self.first.sheet, self.first.relative_sheet)?)
        } else {
            qualify.then_some(scope.1)
        };
        let last_sheet = if self.last.sheet.is_none() {
            first_sheet
        } else {
            shift(self.last.sheet, self.last.relative_sheet)
        };
        let mut prefix = String::new();
        if syntax != Syntax::XlsxImport
            && let Some(first) = first_sheet
        {
            let first = sheets.clone().nth(first)?;
            prefix = quote_sheet(first.as_ref());
            if self.range && first_sheet != last_sheet {
                let last = sheets.clone().nth(last_sheet?)?;
                let last = quote_sheet(last.as_ref());
                // Preserve Calc's FormExcelSheetRange spelling, including its
                // asymmetric quote handling when only the first name needs quotes.
                if prefix.starts_with('\'') {
                    prefix.pop();
                } else if last.starts_with('\'') {
                    prefix.insert(0, '\'');
                }
                prefix.push(':');
                prefix.push_str(last.strip_prefix('\'').unwrap_or(&last));
            }
            prefix.push('!');
        }
        let mut valid = true;
        let mut address = |a: Address| {
            let row = a.row.0 as i64 + if a.row.1 { 0 } else { offset.0 };
            let column = a.column.0 as i64
                + if a.column.1 || a.column.0 == 16_384 {
                    0
                } else {
                    offset.1
                };
            let valid_row = (0..1_048_576).contains(&row);
            let valid_column = (0..16_384).contains(&column);
            valid &= valid_row && valid_column;
            format!(
                "{}{}{}{}",
                if a.column.1 { "$" } else { "" },
                if valid_column {
                    xlsx_idx_to_col_ref(column as usize)
                } else {
                    "#REF!".into()
                },
                if a.row.1 { "$" } else { "" },
                if valid_row {
                    (row + 1).to_string()
                } else {
                    "#REF!".into()
                }
            )
        };
        let first = address(self.first);
        let last = address(self.last);
        if !valid && syntax != Syntax::XlsxImport {
            return Some(if qualify {
                format!("{prefix}#REF!")
            } else {
                "#REF!".into()
            });
        }
        if syntax == Syntax::XlsxImport {
            let prefix = |sheet: Option<usize>, relative: bool| -> Option<String> {
                let Some(sheet) = sheet else {
                    return Some(String::new());
                };
                let name = sheets.clone().nth(sheet)?;
                Some(format!(
                    "{}{}.",
                    if relative { "" } else { "$" },
                    quote_sheet(name.as_ref())
                ))
            };
            let left = prefix(first_sheet, self.first.relative_sheet)?;
            return Some(if self.range {
                let right = if self.last_explicit {
                    prefix(last_sheet, self.last.relative_sheet)?
                } else {
                    String::new()
                };
                format!("{left}{first}:{right}{last}")
            } else {
                format!("{left}{first}")
            });
        }
        if self.range && first != last {
            Some(format!("{prefix}{first}:{last}"))
        } else {
            Some(format!("{prefix}{first}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adjacent_range_names_follow_native_token_boundaries() {
        for source in ["A1:Foo", "$A$1:Foo", "A1:A0", "A1:A_1", "A1:SUM(B1)"] {
            let token = parse(source, ["Sheet1"].into_iter()).unwrap();
            assert!(token.unknown, "{source}");
            assert_eq!(
                token.end,
                source.find('(').unwrap_or(source.len()),
                "{source}"
            );
        }
        for source in [
            "A1 :Foo",
            "A1: Foo",
            "A1:\tFoo",
            "A1:α",
            "A1:INDIRECT(\"B1\")",
        ] {
            let token = parse(source, ["Sheet1"].into_iter()).unwrap();
            assert!(!token.unknown, "{source}");
            assert_eq!(token.end, 2, "{source}");
        }
        for (source, expected) in [
            ("Sheet1!A1:Foo", "Sheet1!A1:FOO1"),
            ("Sheet1!A1:A0", "Sheet1!A1"),
            ("Sheet1!A1:B1048577", "Sheet1!A1:B1"),
            ("Sheet1!A1:A_1", "Sheet1!A1"),
            ("Sheet1!B$2:$Foo", "Sheet1!B$2:FOO2"),
            ("Sheet1!A1:Foo:A2", "Sheet1!A1:FOO2"),
        ] {
            let token = parse(source, ["Sheet1"].into_iter()).unwrap();
            assert_eq!(token.end, source.len(), "{source}");
            assert_eq!(
                token
                    .render(["Sheet1"].into_iter(), (0, 0), (0, 0), false, Syntax::Ods)
                    .as_deref(),
                Some(expected),
                "{source}"
            );
        }
    }
}

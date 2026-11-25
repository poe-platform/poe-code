#[path = "office_xlsx_colors.rs"]
pub(super) mod colors;
#[path = "office_xlsx_layout.rs"]
pub(super) mod layout;
#[path = "office_xlsx_pivot.rs"]
mod pivot;
use super::formula_arguments::{self, Syntax};
use super::model::{ArrayFormula, Iteration, NamedExpression, Sheet, TypedCell, Value, Workbook};
use super::{
    coordinate, dates, formulas, xml_attribute as attr, xml_elements as elements, xml_text as text,
};
#[cfg(test)]
use crate::commands::structured::read_office_archive;
use crate::commands::structured::xml;
use std::collections::BTreeMap;

#[path = "office_xlsx_groups.rs"]
mod groups;

const LIMIT: &str = "Error: conversion failed: worksheet exceeds byte limit\n";

pub(super) struct FormulaTokens<'a> {
    pub(super) text: std::borrow::Cow<'a, str>,
    #[cfg_attr(not(test), allow(dead_code))]
    names: Vec<usize>,
    #[cfg_attr(not(test), allow(dead_code))]
    relative: bool,
    numeric_hash: u64,
    #[cfg_attr(not(test), allow(dead_code))]
    first_reference: Option<(super::xlsx_references::Reference, usize)>,
}

// Calc's international token scanner keeps one leading Unicode space separator
// in the following name. These are not its ASCII formula-whitespace tokens.
pub(super) fn space_name(source: &str) -> Option<&str> {
    let first = source.chars().next()?;
    if !matches!(
        first,
        '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{202f}' | '\u{205f}' | '\u{3000}'
    ) {
        return None;
    }
    let end = first.len_utf8()
        + source[first.len_utf8()..]
            .chars()
            .take_while(|c| c.is_alphanumeric() || "_$?.!".contains(*c))
            .map(char::len_utf8)
            .sum::<usize>();
    Some(&source[..end])
}

// Calc scans the complete hash token before recognizing an error constant.
// #REF! can start an invalid reference, so its ASCII identifier tail belongs
// to the same token. Other !/? suffixes terminate the token.
pub(super) fn error_token(source: &str) -> &str {
    let mut end = 1;
    let mut slash = false;
    for (offset, c) in source[1..].char_indices() {
        if c == '/' {
            if slash {
                break;
            }
            slash = true;
        } else if c.is_ascii() && !c.is_ascii_alphanumeric() && !matches!(c, '!' | '?' | '_') {
            break;
        }
        end = offset + 1 + c.len_utf8();
        if matches!(c, '!' | '?') {
            if c == '!'
                && source[..end].eq_ignore_ascii_case("#REF!")
                && source
                    .as_bytes()
                    .get(end)
                    .is_some_and(|c| c.is_ascii_alphanumeric() || b"_$.!]".contains(c))
            {
                let mut colon = false;
                loop {
                    let tail = &source[end..];
                    if tail
                        .get(..5)
                        .is_some_and(|s| s.eq_ignore_ascii_case("#REF!"))
                    {
                        end += 5;
                    } else if let Some(c) = tail.bytes().next()
                        && (c.is_ascii_alphanumeric()
                            || b"_$.!]".contains(&c)
                            || c == b':' && !colon)
                    {
                        colon |= c == b':';
                        end += 1;
                    } else {
                        break;
                    }
                }
            }
            break;
        }
    }
    &source[..end]
}

// Only literal rectangular arrays merge into a matrix token. Failed merges
// retain signs and non-finite numeric tokens in the exported formula.
pub(in crate::commands) fn matrix_constant(mut source: &str, work: &mut usize) -> Option<bool> {
    let mut columns = 0;
    let mut width = None;
    loop {
        let start = source.len();
        source = source.trim_ascii_start();
        *work = work.checked_sub(start - source.len() + 1)?;
        if source.starts_with('"') {
            let mut end = 1;
            loop {
                let next = source[end..].find('"');
                *work = work.checked_sub(next.map_or(source.len() - end, |n| n + 2))?;
                let Some(next) = next else { return Some(false) };
                end += next + 1;
                if !source[end..].starts_with('"') {
                    break;
                }
                end += 1;
            }
            source = &source[end..];
        } else if !source.starts_with([',', ';', '}']) {
            let unsigned = source
                .strip_prefix(['+', '-'])
                .unwrap_or(source)
                .trim_ascii_start();
            if unsigned.starts_with(|c: char| c.is_ascii_digit() || c == '.') {
                let word = number_token(unsigned, false).0;
                *work = work.checked_sub(source.len() - unsigned.len() + word.len())?;
                if word.parse::<f64>().is_err() {
                    return Some(false);
                }
                source = &unsigned[word.len()..];
            } else if source
                .get(..4)
                .is_some_and(|s| s.eq_ignore_ascii_case("TRUE"))
            {
                source = &source[4..];
            } else if source
                .get(..5)
                .is_some_and(|s| s.eq_ignore_ascii_case("FALSE"))
            {
                source = &source[5..];
            } else {
                return Some(false);
            }
        }
        let start = source.len();
        source = source.trim_ascii_start();
        *work = work.checked_sub(start - source.len() + 1)?;
        columns += 1;
        match source.as_bytes().first() {
            Some(b',') => {}
            Some(b';' | b'}') => {
                if width.is_some_and(|width| columns != width) {
                    return Some(false);
                }
                width = Some(columns);
                columns = 0;
                if source.starts_with('}') {
                    return Some(true);
                }
            }
            _ => return Some(false),
        }
        source = &source[1..];
    }
}

// Calc first scans ASCII numbers, then reparses ambiguous text as a number
// or identifier. The character following an incomplete exponent matters:
// 1e at end is a name, while 1e) ends the numeric token before e.
pub(in crate::commands) fn number_token(source: &str, calc: bool) -> (&str, bool) {
    let bytes = source.as_bytes();
    let mut end = 1;
    // The initial character is consumed before Calc starts counting dots.
    let mut decimals = 0;
    let fallback = loop {
        let Some(&c) = bytes.get(end) else {
            break false;
        };
        match c {
            b'0'..=b'9' => {}
            b',' if calc => {}
            b'!' | b'{' | b'|' if calc => break false,
            b':' if calc => break true,
            b'.' => {
                decimals += 1;
                if decimals > 1 {
                    break true;
                }
            }
            b'e' | b'E' => {
                if !bytes
                    .get(end + 1)
                    .is_some_and(|c| c.is_ascii_digit() || matches!(c, b'+' | b'-'))
                {
                    break true;
                }
            }
            b'+' | b'-' => {
                if !matches!(bytes[end - 1], b'e' | b'E')
                    || !bytes.get(end + 1).is_some_and(u8::is_ascii_digit)
                {
                    break false;
                }
            }
            b' ' | b'\t' | b'\r' | b'\n' | b'(' | b')' | b',' | b';' | b':' | b'%' | b'*'
            | b'/' | b'^' | b'&' | b'=' | b'<' | b'>' | b'}' => break false,
            _ => break true,
        }
        end += 1;
    };
    if !fallback {
        return (&source[..end], false);
    }
    end = 1;
    decimals = usize::from(bytes[0] == b'.');
    let word = |c: char| c.is_alphanumeric() || "_$?.!".contains(c);
    let mut might_be_word = bytes[0].is_ascii_digit();
    let mut identifier = false;
    for (i, c) in source[1..].char_indices() {
        let i = i + 1;
        let next = source[i + c.len_utf8()..].chars().next();
        might_be_word &= word(c);
        if identifier {
            if !word(c) {
                break;
            }
        } else if c.is_ascii_digit() {
        } else if c == '.' {
            decimals += 1;
            if decimals > 1 {
                break;
            }
        } else if matches!(c, 'e' | 'E') {
            if !next.is_some_and(|c| c.is_ascii_digit() || matches!(c, '+' | '-')) {
                if might_be_word && next.is_none_or(word) {
                    identifier = true;
                } else {
                    break;
                }
            }
        } else if matches!(c, '+' | '-') {
            if !(matches!(bytes[i - 1], b'e' | b'E') && next.is_some_and(|c| c.is_ascii_digit())) {
                if might_be_word && next.is_none_or(word) {
                    identifier = true;
                } else {
                    break;
                }
            }
        } else if might_be_word {
            identifier = true;
        } else {
            break;
        }
        end = i + c.len_utf8();
    }
    // A lone decimal separator has no token type in the fallback scanner.
    // Consecutive dots rewind to single-character tokens instead.
    let illegal = bytes[0] == b'.' && end == 1 && bytes.get(1) != Some(&b'.');
    (&source[..end], illegal)
}

// Render the imported token spelling while retaining spaces outside tokens.
// The row offset is also used by Calc's per-column compiled-formula cache.
pub(super) fn formula_tokens<'a>(
    source: &'a str,
    names: &[NamedExpression],
    sheets: &[(String, String)],
    // Name symbols render from sheet zero even when compiled in another scope.
    scope: (Option<usize>, Option<usize>),
    offset: (i64, i64),
    syntax: Syntax,
    work: &mut usize,
) -> Option<FormulaTokens<'a>> {
    use std::borrow::Cow;
    let preserve_numbers = matches!(syntax, Syntax::Editor | Syntax::EditorXlsx);
    let syntax = match syntax {
        Syntax::EditorXlsx => Syntax::Xlsx,
        _ => syntax,
    };
    let grouping = syntax == Syntax::XlsxGroup;
    let syntax = if grouping { Syntax::XlsxImport } else { syntax };
    *work = work.checked_sub(source.len())?;
    let source = source.trim_start_matches(' ');
    let mut rest = source
        .strip_prefix('=')
        .unwrap_or(source)
        .trim_end_matches(' ');
    let trailing_whitespace = rest.len() - rest.trim_end_matches([' ', '\t', '\n', '\r']).len();
    let local_length = rest.len();
    let locals = formulas::lexical_tokens(rest, work)?.0;
    let mut operators = formulas::xlsx_operators(
        rest,
        sheets.iter().map(|s| s.0.as_str()),
        names,
        scope.0,
        work,
    )?;
    let mut token_count = 0usize;
    let mut numeric_hash = 0u64;
    let mut arrays = Vec::new();
    let mut parentheses = 0usize;
    let mut raw_tail = None;
    let mut verbatim = Vec::new();
    let mut output = String::new();
    let mut relative = false;
    let mut first_reference = None;
    let mut reference = None::<(usize, bool)>;
    let mut joined = false;
    let mut sheet_start = None;
    while let Some(first) = rest.chars().next() {
        if rest.len() == trailing_whitespace {
            break;
        }
        if let Ok(index) =
            locals.binary_search_by_key(&(local_length - rest.len()), |(start, _)| *start)
        {
            let length = locals[index].1;
            *work = work.checked_sub(length)?;
            reference = Some((output.len(), false));
            let token = &rest[..length];
            if syntax == Syntax::Editor
                && token
                    .get(..6)
                    .is_some_and(|p| p.eq_ignore_ascii_case("_xlpm."))
            {
                output.push_str(&token[6..]);
            } else if syntax == Syntax::Editor
                && token
                    .get(..6)
                    .is_some_and(|p| p.eq_ignore_ascii_case("_xlop."))
            {
                output.push('[');
                output.push_str(&token[6..]);
                output.push(']');
            } else {
                output.push_str(token);
            }
            rest = &rest[length..];
            joined = false;
            sheet_start = None;
            if grouping && token_count < 20 {
                numeric_hash = numeric_hash.wrapping_mul(15);
                token_count += 1;
            }
            continue;
        }
        if first == '#' && matches!(syntax, Syntax::Editor | Syntax::Xlsx) {
            if let Some((start, false)) = reference.take() {
                *work = work.checked_sub(output.len() - start + 24)?;
                if syntax == Syntax::Xlsx {
                    let cell = output.split_off(start);
                    output.push_str("_xlfn.ANCHORARRAY(");
                    output.push_str(&cell);
                    output.push(')');
                } else {
                    output.push('#');
                }
                rest = &rest[1..];
                joined = false;
                sheet_start = None;
                continue;
            }
        }
        if let Some(&(remaining, length, operator)) = operators.last()
            && remaining == rest.len()
        {
            *work = work.checked_sub(1)?;
            output.push(if operator == '!' && syntax != Syntax::XlsxImport {
                ' '
            } else {
                operator
            });
            rest = &rest[length..];
            operators.pop();
            if grouping && token_count < 20 {
                numeric_hash = numeric_hash.wrapping_mul(15);
                token_count += 1;
            }
            reference = None;
            joined = false;
            sheet_start = None;
            continue;
        }
        let mut end = first.len_utf8();
        let mut number = None;
        let mut lexical_tokens = 1;
        let mut replacement = None::<Cow<'_, str>>;
        let mut shifted_reference = None;
        let mut reference_range = false;
        let mut sheet_token = false;
        if preserve_numbers
            && let Some((prefix, token)) = super::xlsx_references::external_reference(rest)
        {
            let shifted =
                token.render(std::iter::empty::<&str>(), (0, 0), offset, false, syntax)?;
            *work = work.checked_sub(prefix + shifted.len())?;
            reference = Some((output.len(), shifted == "#REF!"));
            output.push_str(&rest[..prefix]);
            output.push_str(&shifted);
            rest = &rest[prefix + token.end..];
            sheet_start = None;
            joined = false;
            continue;
        }
        if let Some(token) = super::xlsx_references::parse(rest, sheets.iter().map(|s| &s.0))
            .filter(|r| r.first.sheet.is_some() || r.range || r.unknown || rest.starts_with('#'))
        {
            *work = work.checked_sub(token.end.checked_mul(sheets.len() + 3)?)?;
            let text = if preserve_numbers && token.missing_sheet {
                rest[..token.end].to_owned()
            } else if grouping && !token.unknown {
                if token.range { "R:R" } else { "R" }.into()
            } else if token.unknown {
                super::function_names::unknown(&super::case_fold::sheet_key(&rest[..token.end]))
            } else if rest.starts_with('\'') && rest[token.end..].trim_ascii_end() == ":" {
                rest[..token.end].to_owned()
            } else {
                token
                    .render(
                        sheets.iter().map(|s| &s.0),
                        (scope.0.unwrap_or(0), scope.1.unwrap_or(0)),
                        offset,
                        false,
                        syntax,
                    )
                    .unwrap_or_else(|| "#REF!".into())
            };
            *work = work.checked_sub(text.len())?;
            if token.unknown && rest[token.end..].trim_ascii_start().starts_with('(') {
                *work = work.checked_sub(std::mem::size_of::<std::ops::Range<usize>>())?;
                verbatim.push(output.len()..output.len() + text.len());
            }
            if output.trim().is_empty() && !token.unknown {
                relative = token.first.relative_sheet || token.last.relative_sheet;
                first_reference = Some((token, output.len() + text.len()));
            }
            reference = (!token.unknown).then_some((output.len(), text == "#REF!"));
            sheet_start = None;
            joined = false;
            output.push_str(&text);
            rest = &rest[token.end..];
            if grouping && token_count < 20 {
                numeric_hash = numeric_hash.wrapping_mul(15);
                token_count += 1;
            }
            continue;
        }
        if first == '(' {
            parentheses += 1;
        } else if first == ')' {
            parentheses = parentheses.saturating_sub(1);
        }
        if first == '{' {
            *work = work.checked_sub(std::mem::size_of::<(usize, bool)>())?;
            arrays.push((parentheses, matrix_constant(&rest[1..], work)?));
        } else if first == '}' {
            arrays.pop();
        }
        if matches!(first, ' ' | '\t' | '\n' | '\r') {
            // CreateString emits one character per whitespace token, while
            // export retains its count, capped at the token's byte-sized limit.
            end = rest.chars().take_while(|&c| c == first).count();
            replacement = Some(Cow::Borrowed(
                if arrays.last() == Some(&(parentheses, true)) {
                    ""
                } else if grouping {
                    if first == ' ' { " " } else { "\t" }
                } else {
                    &rest[..if syntax == Syntax::XlsxCode {
                        1
                    } else {
                        end.min(255)
                    }]
                },
            ));
        } else if matches!(first, '\'' | '"') {
            loop {
                let Some(next) = rest[end..].find(first) else {
                    end = rest.len();
                    break;
                };
                end += next + first.len_utf8();
                if rest[end..].starts_with(first) {
                    end += first.len_utf8();
                } else {
                    break;
                }
            }
            if first == '\''
                && rest[end..].trim_ascii_start().starts_with('!')
                && rest[..end].ends_with('\'')
            {
                sheet_token = true;
                *work = work.checked_sub(end.checked_mul(3)?)?;
                replacement = Some(Cow::Borrowed(&rest[..end]));
            }
        } else if first == '[' {
            end = rest.find(']').map_or(rest.len(), |i| i + 1);
            sheet_token = &rest[..end] == "[0]" && rest[end..].trim_ascii_start().starts_with('!');
        } else if first == '#' {
            let token = error_token(rest);
            end = token.len();
            if token == "#" {
                end = rest.len();
                raw_tail = Some(output.len());
            } else {
                replacement = Some(
                    if let Some(error) = formulas::LITERAL_ERRORS
                        .into_iter()
                        .find(|error| token.eq_ignore_ascii_case(error))
                    {
                        Cow::Borrowed(error)
                    } else {
                        *work = work.checked_sub(token.len().checked_mul(3)?)?;
                        Cow::Owned(super::function_names::unknown(token))
                    },
                );
            }
        } else if let Some(token) = space_name(rest) {
            end = token.len();
            let start = sheet_start.take().unwrap_or(output.len());
            *work = work.checked_sub((output.len() - start + end).checked_mul(3)?)?;
            replacement = Some(Cow::Owned(super::function_names::unknown(
                &super::case_fold::sheet_key(&format!("{}{token}", &output[start..])),
            )));
            output.truncate(start);
            if rest[end..].trim_ascii_start().starts_with('(') {
                *work = work.checked_sub(std::mem::size_of::<std::ops::Range<usize>>())?;
                verbatim.push(start..start + replacement.as_ref()?.len());
            }
        } else if !first.is_ascii() && !first.is_alphanumeric() {
            end = rest.len();
            raw_tail = Some(output.len());
        } else if first == '$'
            && rest[1..]
                .chars()
                .next()
                .is_none_or(|c| !c.is_alphanumeric() && !"_$.".contains(c))
        {
            end = rest.len();
            raw_tail = Some(output.len());
        } else if first.is_alphanumeric() || matches!(first, '_' | '.' | '$' | '?') {
            if first.is_ascii_digit() || first == '.' {
                end = number_token(rest, false).0.len();
                let word = &rest[..end];
                *work = work.checked_sub(word.len().checked_mul(3)?)?;
                replacement = Some(Cow::Owned(match word.parse::<f64>() {
                    Ok(value) => {
                        number = Some(value);
                        let before = output.trim_ascii_end();
                        let prefix = before
                            .strip_suffix(['+', '-'])
                            .unwrap_or(before)
                            .trim_ascii_end();
                        let matrix_number = arrays.last() == Some(&(parentheses, true))
                            && prefix.ends_with(['{', ',', ';'])
                            && rest[end..].trim_ascii_start().starts_with([',', ';', '}']);
                        if matrix_number && (before.ends_with('+') || !value.is_finite()) {
                            output.truncate(prefix.len());
                        }
                        if grouping {
                            "0".into()
                        } else if matrix_number && !value.is_finite() {
                            "#NUM!".into()
                        } else if (preserve_numbers || syntax == Syntax::Xlsx) && value.is_finite()
                        {
                            // Display rounding can change a formula's domain.
                            // Editable and exported formulas retain authored literals.
                            word.into()
                        } else {
                            super::number_format::number(value, true)
                        }
                    }
                    Err(_) => super::function_names::unknown(word),
                }));
            } else {
                end = rest
                    .chars()
                    .take_while(|c| {
                        c.is_alphanumeric()
                            || matches!(c, '_' | '.' | '$')
                            || first == '?' && matches!(c, '?' | '!')
                    })
                    .map(char::len_utf8)
                    .sum();
            }
            let word = &rest[..end];
            let after = rest[end..].trim_ascii_start();
            let bare = word.strip_prefix('$').unwrap_or(word);
            sheet_token = after
                .strip_prefix('!')
                .is_some_and(|tail| space_name(tail).is_none());
            let axis = |word: &str, rows: bool| {
                let bare = word.strip_prefix('$').unwrap_or(word);
                let value = if rows {
                    bare.parse::<i64>().ok()?
                } else {
                    if bare.is_empty() {
                        return None;
                    }
                    bare.bytes().try_fold(0i64, |n, b| {
                        b.is_ascii_alphabetic().then_some(())?;
                        n.checked_mul(26)?
                            .checked_add(i64::from(b.to_ascii_uppercase() - b'A' + 1))
                    })?
                };
                (1..=if rows { 1_048_576 } else { 16_384 })
                    .contains(&value)
                    .then_some(value - 1)
            };
            let whole_range = after.strip_prefix(':').and_then(|tail| {
                let tail = tail.trim_ascii_start();
                let count = tail
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '$'))
                    .map(char::len_utf8)
                    .sum::<usize>();
                let last = &tail[..count];
                let rows = bare.bytes().all(|b| b.is_ascii_digit());
                Some((
                    rows,
                    axis(word, rows)?,
                    axis(last, rows)?,
                    last,
                    rest.len() - tail.len(),
                    count,
                ))
            });
            if preserve_numbers && after.starts_with('[') {
                // A structured reference names a table, not an unresolved name.
                // Keep its spelling when materializing editable formula source.
                replacement = Some(Cow::Borrowed(word));
            } else if !sheet_token
                && (!after.starts_with('(')
                    || syntax != Syntax::Editor
                        && super::function_names::imported(&word.to_ascii_uppercase()).is_none())
            {
                if let Some((row, col)) = coordinate(word) {
                    let letters = bare.bytes().take_while(u8::is_ascii_alphabetic).count();
                    let fixed_row = bare[letters..].starts_with('$');
                    let fixed_col = word.starts_with('$');
                    let row = row as i64 + if fixed_row { 0 } else { offset.0 };
                    let col = col as i64 + if fixed_col { 0 } else { offset.1 };
                    let valid_row = (0..1_048_576).contains(&row);
                    let valid_col = (0..16_384).contains(&col);
                    shifted_reference = Some(!valid_row || !valid_col);
                    replacement = Some(Cow::Owned(format!(
                        "{}{}{}{}",
                        if fixed_col { "$" } else { "" },
                        if valid_col {
                            crate::commands::structured::xlsx_idx_to_col_ref(col as usize)
                        } else {
                            "#REF!".into()
                        },
                        if fixed_row { "$" } else { "" },
                        if valid_row {
                            (row + 1).to_string()
                        } else {
                            "#REF!".into()
                        },
                    )));
                } else if let Some((rows, first, last, last_word, start, count)) = whole_range {
                    reference_range = true;
                    let maximum = if rows { 1_048_576 } else { 16_384 };
                    let delta = if rows { offset.0 } else { offset.1 };
                    let first = first + if word.starts_with('$') { 0 } else { delta };
                    let last = last + if last_word.starts_with('$') { 0 } else { delta };
                    let invalid = !(0..maximum).contains(&first) || !(0..maximum).contains(&last);
                    let render = |value: i64, raw: &str| {
                        if !(0..maximum).contains(&value) {
                            return "#REF!".to_owned();
                        }
                        format!(
                            "{}{}",
                            if raw.starts_with('$') { "$" } else { "" },
                            if rows {
                                (value + 1).to_string()
                            } else {
                                crate::commands::structured::xlsx_idx_to_col_ref(value as usize)
                            }
                        )
                    };
                    let first = render(first, word);
                    let last = render(last, last_word);
                    let separator = &rest[end..start];
                    replacement = Some(Cow::Owned(if invalid && syntax == Syntax::XlsxImport {
                        if rows {
                            format!("$A{first}{separator}$XFD{last}")
                        } else {
                            format!("{first}$1{separator}{last}$1048576")
                        }
                    } else {
                        format!("{first}{separator}{last}")
                    }));
                    shifted_reference = Some(invalid);
                    end = start + count;
                    if let Some(start) = sheet_start {
                        let prefix = output[start..].trim_end_matches('!');
                        *work = work.checked_sub(prefix.len().checked_mul(sheets.len() + 3)?)?;
                        let label = prefix
                            .strip_prefix('\'')
                            .and_then(|s| s.strip_suffix('\''))
                            .map(|s| s.replace("''", "'"));
                        if !sheets.iter().any(|(name, _)| {
                            super::case_fold::same_name(name, label.as_deref().unwrap_or(prefix))
                        }) {
                            let unknown = super::function_names::unknown(&format!(
                                "{}{}",
                                &output[start..],
                                &rest[..end]
                            ));
                            *work = work.checked_sub(unknown.len())?;
                            output.truncate(start);
                            replacement = Some(Cow::Owned(unknown));
                            shifted_reference = None;
                            number = None;
                        }
                    }
                } else if word.eq_ignore_ascii_case("TRUE") || word.eq_ignore_ascii_case("FALSE") {
                    if arrays.is_empty() {
                        lexical_tokens = 3;
                    }
                    replacement = Some(Cow::Owned(format!(
                        "{}{}",
                        word.to_ascii_uppercase(),
                        if arrays.is_empty() { "()" } else { "" }
                    )));
                } else if sheet_start.is_some() || !first.is_ascii_digit() && first != '.' {
                    number = None;
                    let explicit = sheet_start.map(|start| {
                        let prefix = output[start..]
                            .trim_end_matches([' ', '\t', '\n', '\r'])
                            .strip_suffix('!')
                            .unwrap_or("")
                            .trim();
                        prefix
                            .strip_prefix('\'')
                            .and_then(|s| s.strip_suffix('\''))
                            .map_or_else(|| prefix.to_owned(), |s| s.replace("''", "'"))
                    });
                    let target = if let Some(label) = explicit.as_deref() {
                        *work = work
                            .checked_sub(label.len().checked_mul(sheets.len().checked_add(3)?)?)?;
                        let key = super::case_fold::sheet_key(label);
                        let mut target = None;
                        for (index, (sheet, _)) in sheets.iter().enumerate() {
                            *work = work.checked_sub(sheet.len())?;
                            if super::case_fold::sheet_key(sheet) == key {
                                target = Some(index);
                                break;
                            }
                        }
                        target
                    } else {
                        scope.0.or(Some(0))
                    };
                    *work = work.checked_sub(names.len().checked_mul(word.len() + 1)?)?;
                    let name = names
                        .iter()
                        .find(|name| {
                            target.is_some()
                                && name.sheet == target
                                && super::case_fold::same_name(&name.name, word)
                        })
                        .or_else(|| {
                            (explicit.is_none() || explicit.as_deref() == Some("[0]"))
                                .then(|| {
                                    names.iter().find(|name| {
                                        name.sheet.is_none()
                                            && super::case_fold::same_name(&name.name, word)
                                    })
                                })
                                .flatten()
                        });
                    if let Some(definition) = name {
                        let name = &definition.name;
                        let local = definition.sheet;
                        if let Some(start) = sheet_start.take() {
                            output.truncate(start);
                            if explicit.as_deref() == Some("[0]") {
                                output.push_str("[0]!");
                            }
                        }
                        if let Some(local) =
                            local.filter(|local| Some(*local) != scope.1.or(Some(0)))
                        {
                            let prefix = super::sheet_name::quote_sheet(&sheets[local].0);
                            *work = work.checked_sub(prefix.len() + 1)?;
                            output.push_str(&prefix);
                            output.push(if syntax == Syntax::XlsxImport {
                                '.'
                            } else {
                                '!'
                            });
                        }
                        if after.starts_with('(') {
                            *work =
                                work.checked_sub(std::mem::size_of::<std::ops::Range<usize>>())?;
                            verbatim.push(output.len()..output.len() + name.len());
                        }
                        replacement = Some(Cow::Borrowed(name));
                    } else if let Some(start) = sheet_start.take() {
                        *work =
                            work.checked_sub((output.len() - start + word.len()).checked_mul(3)?)?;
                        let unknown = super::function_names::unknown(&super::case_fold::sheet_key(
                            &format!("{}{word}", &output[start..]),
                        ));
                        output.truncate(start);
                        replacement = Some(Cow::Owned(unknown));
                    } else {
                        replacement = Some(Cow::Owned(super::function_names::unknown(
                            &super::case_fold::sheet_key(word),
                        )));
                    }
                }
            }
        }
        if sheet_token {
            sheet_start = Some(output.len());
        } else if let Some(invalid) = shifted_reference {
            if let Some(start) = sheet_start {
                let prefix = output[start..].trim_end_matches('!');
                if let Some(quoted) = prefix.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')) {
                    let prefix = super::sheet_name::quote_sheet(&quoted.replace("''", "'"));
                    *work = work.checked_sub(prefix.len() + 1)?;
                    output.truncate(start);
                    output.push_str(&prefix);
                    output.push('!');
                }
            }
            if sheet_start.is_none() && output.trim().is_empty() {
                relative = true;
            }
            if syntax == Syntax::XlsxImport
                && let Some(start) = sheet_start
            {
                let prefix = output[start..]
                    .strip_suffix('!')
                    .unwrap_or(&output[start..])
                    .to_owned();
                *work = work.checked_sub(prefix.len() + 2)?;
                output.truncate(start);
                output.push('$');
                output.push_str(&prefix);
                output.push('.');
            }
            let start = sheet_start.take().unwrap_or(output.len());
            let (start, invalid) = if joined {
                reference.map_or((start, invalid), |(start, previous)| {
                    (start, invalid || previous)
                })
            } else {
                (start, invalid)
            };
            if invalid && syntax != Syntax::XlsxImport {
                output.truncate(start);
                replacement = Some(Cow::Borrowed("#REF!"));
            }
            reference = Some((start, invalid));
            joined = false;
        } else if first == ':' {
            joined = reference.is_some();
        } else if first != '!' && !first.is_whitespace() {
            reference = None;
            joined = false;
            sheet_start = None;
        }
        if grouping && shifted_reference.is_some() {
            replacement = Some(Cow::Borrowed(if reference_range { "R:R" } else { "R" }));
        }
        if grouping && token_count < 20 {
            if shifted_reference.is_none() && !sheet_token {
                numeric_hash = numeric_hash.wrapping_add(number.map_or(0, formulas::number_hash));
            }
            for _ in 0..lexical_tokens.min(20 - token_count) {
                numeric_hash = numeric_hash.wrapping_mul(15);
                token_count += 1;
            }
        }
        // Comparisons with two characters are one lexical opcode.
        if grouping && (rest.starts_with("<=") || rest.starts_with(">=") || rest.starts_with("<>"))
        {
            end = 2;
        }
        let text = replacement.as_deref().unwrap_or(&rest[..end]);
        *work = work.checked_sub(text.len())?;
        output.push_str(text);
        rest = &rest[end..];
    }
    if let Some(start) = raw_tail {
        *work = work.checked_sub(parentheses + std::mem::size_of::<std::ops::Range<usize>>())?;
        verbatim.push(start..output.len());
        output.extend(std::iter::repeat_n(')', parentheses));
    }
    // Rebasing the editor display retains user function spelling. Export
    // normalization runs separately on the stored formula.
    if syntax != Syntax::Editor
        && let Cow::Owned(normalized) =
            formula_arguments::rewrite(&output, syntax, &verbatim, work)?
    {
        output = normalized;
    }
    let used_names = if syntax == Syntax::Xlsx {
        formulas::xlsx_export_names(
            source,
            sheets.iter().map(|s| s.0.as_str()),
            names,
            scope.0,
            None,
            work,
        )?
    } else {
        Vec::new()
    };
    Some(FormulaTokens {
        text: if output == source {
            Cow::Borrowed(source)
        } else {
            Cow::Owned(output)
        },
        names: used_names,
        relative,
        numeric_hash,
        first_reference,
    })
}

fn integer(value: &str) -> i32 {
    let value = value.trim_start();
    let sign = usize::from(value.starts_with(['-', '+']));
    let digits = value[sign..].bytes().take_while(u8::is_ascii_digit).count();
    value[..sign + digits].parse::<i32>().unwrap_or(0)
}

fn row_position(row: &xml::Element, row_index: i64) -> i64 {
    attr(row, "r").map_or(row_index.saturating_add(1), |value| {
        let index = integer(value);
        if index == -1 {
            row_index.saturating_add(1)
        } else {
            i64::from(index) - 1
        }
    })
}

fn cell_position(
    cell: &xml::Element,
    row_index: i64,
    column_index: &mut i64,
) -> Option<(usize, usize)> {
    *column_index = column_index.saturating_add(1);
    let mut cell_row = row_index;
    if let Some(reference) = attr(cell, "r").filter(|r| !r.is_empty()) {
        let reference = reference.strip_prefix('$').unwrap_or(reference);
        let letters = reference
            .bytes()
            .take_while(u8::is_ascii_alphabetic)
            .count();
        let column = reference[..letters].bytes().try_fold(0i32, |n, b| {
            n.checked_mul(26)?
                .checked_add(i32::from(b.to_ascii_uppercase() - b'A' + 1))
        });
        *column_index = i64::from(column.unwrap_or(0).saturating_sub(1).max(0));
        let reference = reference[letters..]
            .strip_prefix('$')
            .unwrap_or(&reference[letters..]);
        cell_row = reference.parse::<i64>().unwrap_or(0).saturating_sub(1);
        if letters == 0 || column.is_none() {
            return None;
        }
    }
    if !(0..1_048_576).contains(&cell_row) || !(0..16_384).contains(column_index) {
        return None;
    }
    Some((cell_row as usize, *column_index as usize))
}

// Retain the converter export helpers for their original compatibility tests.
#[cfg(test)]
#[allow(dead_code)]
#[path = "office_xlsx_export.rs"]
mod export;
#[cfg(test)]
pub(super) use export::export_xlsx;

fn normalize_names(
    nodes: &mut [xml::Node],
    sheets: usize,
    work: &mut usize,
) -> Result<bool, &'static str> {
    let mut used = BTreeMap::new();
    let mut changed = false;
    for node in nodes {
        let xml::Node::Element(root) = node else {
            continue;
        };
        for node in &mut root.children {
            let xml::Node::Element(container) = node else {
                continue;
            };
            if container.tag.rsplit(':').next() != Some("definedNames") {
                continue;
            }
            let mut children = Vec::new();
            for mut node in std::mem::take(&mut container.children) {
                *work = work
                    .checked_sub(std::mem::size_of::<xml::Node>())
                    .ok_or(LIMIT)?;
                if let xml::Node::Element(name) = &mut node
                    && name.tag.rsplit(':').next() == Some("definedName")
                {
                    let original = attr(name, "name").unwrap_or("");
                    if original.is_empty()
                        || ["function", "vbProcedure"]
                            .iter()
                            .any(|key| matches!(attr(name, key), Some("1" | "true" | "on")))
                    {
                        changed = true;
                        continue;
                    }
                    *work = work
                        .checked_sub(original.len().checked_mul(3).ok_or(LIMIT)? + 128)
                        .ok_or(LIMIT)?;
                    let original = original.to_owned();
                    let scope = attr(name, "localSheetId")
                        .map(integer)
                        .filter(|&s| s >= 0)
                        .map(|s| s as usize);
                    if scope.is_some_and(|s| s >= sheets) {
                        return Err(super::SOURCE_LOAD_ERROR);
                    }
                    if let Some(raw) = attr(name, "localSheetId") {
                        let normalized = scope.map(|s| s.to_string());
                        if normalized.as_deref() != Some(raw) {
                            changed = true;
                            name.attrs
                                .retain(|(key, _)| key.rsplit(':').next() != Some("localSheetId"));
                            if let Some(value) = normalized {
                                name.attrs.push(("localSheetId".into(), value));
                            }
                        }
                    }
                    let mut label = original.clone();
                    let mut key = (scope, super::case_fold::sheet_key(&label));
                    if let Some(mut suffix) = used.get(&key).copied() {
                        *work = work.checked_sub(key.1.len() + 32).ok_or(LIMIT)?;
                        let original_key = key.clone();
                        loop {
                            *work = work
                                .checked_sub(original.len().checked_mul(3).ok_or(LIMIT)? + 128)
                                .ok_or(LIMIT)?;
                            label = format!("{original}_{suffix}");
                            key.1 = super::case_fold::sheet_key(&label);
                            suffix += 1;
                            if !used.contains_key(&key) {
                                break;
                            }
                        }
                        // Earlier suffixes remain occupied; later duplicates
                        // can resume here without rescanning the same names.
                        *used.get_mut(&original_key).unwrap() = suffix;
                    }
                    used.insert(key, 0usize);
                    if label != original {
                        name.attrs
                            .iter_mut()
                            .find(|(k, _)| k.rsplit(':').next() == Some("name"))
                            .unwrap()
                            .1 = label;
                        changed = true;
                    }
                }
                children.push(node);
            }
            container.children = children;
        }
    }
    Ok(changed)
}

struct Imported {
    #[cfg(test)]
    workbook_path: String,
    #[cfg(test)]
    app_path: Option<String>,
    style_path: Option<String>,
    theme_path: Option<String>,
    sources: Vec<(String, String)>,
    sheets: Vec<Sheet<String>>,
    book: Workbook,
    raw: Vec<BTreeMap<(usize, usize), (String, bool)>>,
    remaining: usize,
}

fn string_content(nodes: &[xml::Node]) -> (String, bool) {
    let portions = elements(nodes, "t");
    let rich = portions.len() > 1 || !elements(nodes, "rPr").is_empty();
    let value: String = portions
        .iter()
        .map(|el| super::xlsx_string::decode(&text(el)))
        .collect();
    // Native rich strings pass through the paragraph engine. Plain single
    // portions without LF retain CR, as do cached string values outside this path.
    if value.contains('\r') && (value.contains('\n') || rich) {
        let mut normalized = String::with_capacity(value.len());
        let mut chars = value.chars().peekable();
        while let Some(c) = chars.next() {
            if matches!(c, '\r' | '\n') {
                if chars
                    .peek()
                    .is_some_and(|next| *next != c && matches!(next, '\r' | '\n'))
                {
                    chars.next();
                }
                normalized.push('\n');
            } else {
                normalized.push(c);
            }
        }
        (normalized, rich)
    } else {
        (value, rich)
    }
}

fn read(
    entries: &BTreeMap<String, Vec<u8>>,
    limit: usize,
    editable: bool,
) -> Result<Imported, String> {
    let parse = |name: &str| -> Result<Vec<xml::Node>, &'static str> {
        match entries.get(name) {
            Some(bytes) if !bytes.is_empty() => {
                crate::commands::spreadsheet::office_xml::decode(bytes)
                    .and_then(|source| xml::parse(&source, None, None))
                    .map(|doc| doc.nodes)
                    .map_err(|_| "Error: conversion failed: invalid worksheet XML\n")
            }
            _ => Ok(Vec::new()),
        }
    };
    let related = |rels: &[xml::Node], directory: &str, kind: &str| {
        elements(rels, "Relationship")
            .into_iter()
            .find(|el| {
                attr(el, "Type").and_then(|t| t.rsplit('/').next()) == Some(kind)
                    && attr(el, "TargetMode") != Some("External")
            })
            .and_then(|el| attr(el, "Target"))
            .map(|target| crate::vfs::resolve_posix_path(directory, target))
    };
    let package = parse("_rels/.rels")?;
    let workbook_path =
        related(&package, "/", "officeDocument").unwrap_or_else(|| "/xl/workbook.xml".into());
    if !entries.contains_key(workbook_path.trim_start_matches('/')) {
        return Err(super::SOURCE_LOAD_ERROR.into());
    }
    let (directory, filename) = workbook_path.rsplit_once('/').unwrap();
    let relationship_path = format!("{directory}/_rels/{filename}.rels");
    let relationships = parse(relationship_path.trim_start_matches('/'))?;
    let missing_relationships = !entries.contains_key(relationship_path.trim_start_matches('/'));
    let metadata_path = related(&relationships, directory, "sheetMetadata");
    let metadata = if editable {
        parse(
            metadata_path
                .as_deref()
                .unwrap_or("")
                .trim_start_matches('/'),
        )?
    } else {
        Vec::new()
    };
    let dynamic_type = elements(&metadata, "metadataType")
        .iter()
        .position(|el| attr(el, "name") == Some("XLDAPR"))
        .map(|i| i + 1);
    let dynamic_records: std::collections::BTreeSet<_> = elements(&metadata, "futureMetadata")
        .iter()
        .filter(|el| attr(el, "name") == Some("XLDAPR"))
        .flat_map(|el| elements(&el.children, "bk"))
        .enumerate()
        .filter(|(_, el)| {
            elements(&el.children, "dynamicArrayProperties")
                .iter()
                .any(|p| matches!(attr(p, "fDynamic"), Some("1" | "true")))
        })
        .map(|(i, _)| i)
        .collect();
    let dynamic_metadata: std::collections::BTreeSet<_> = elements(&metadata, "cellMetadata")
        .iter()
        .flat_map(|el| elements(&el.children, "bk"))
        .enumerate()
        .filter(|(_, el)| {
            elements(&el.children, "rc").iter().any(|record| {
                dynamic_type.is_some()
                    && attr(record, "t").and_then(|s| s.parse::<usize>().ok()) == dynamic_type
                    && attr(record, "v")
                        .and_then(|s| s.parse::<usize>().ok())
                        .is_some_and(|v| dynamic_records.contains(&v))
            })
        })
        .map(|(i, _)| i + 1)
        .collect();
    let mut dynamic_ranges = Vec::new();
    let mut authored_formulas = std::collections::BTreeSet::new();
    let shared_path = related(&relationships, directory, "sharedStrings")
        .or_else(|| missing_relationships.then(|| format!("{directory}/sharedStrings.xml")));
    let shared = parse(shared_path.as_deref().unwrap_or("").trim_start_matches('/'))?;
    let shared: Vec<_> = elements(&shared, "si")
        .into_iter()
        .map(|el| string_content(&el.children))
        .collect();
    let theme_path = related(&relationships, directory, "theme");
    let style_path = related(&relationships, directory, "styles")
        .or_else(|| missing_relationships.then(|| format!("{directory}/styles.xml")));
    let style_doc = parse(style_path.as_deref().unwrap_or("").trim_start_matches('/'))?;
    let mut formats = BTreeMap::new();
    for el in elements(&style_doc, "numFmt") {
        if let (Some(id), Some(pattern)) = (
            attr(el, "numFmtId").and_then(|v| v.parse::<usize>().ok()),
            attr(el, "formatCode"),
        ) {
            formats.insert(id, pattern.to_owned());
        }
    }
    let styles: Vec<_> = elements(&style_doc, "cellXfs")
        .first()
        .map(|el| {
            elements(&el.children, "xf")
                .iter()
                .map(|el| {
                    attr(el, "numFmtId")
                        .and_then(|v| v.parse::<usize>().ok())
                        .unwrap_or(0)
                })
                .collect()
        })
        .unwrap_or_default();
    let mut workbook =
        parse(workbook_path.trim_start_matches('/')).map_err(|_| super::SOURCE_LOAD_ERROR)?;
    let mut book = Workbook {
        case_insensitive: true,
        date1904: elements(&workbook, "workbookPr")
            .first()
            .is_some_and(|el| matches!(attr(el, "date1904"), Some("1" | "true" | "on"))),
        ..Workbook::default()
    };
    let calc = elements(&workbook, "calcPr");
    let manual = calc
        .first()
        .is_some_and(|el| attr(el, "calcMode") == Some("manual"));
    if let Some(el) = calc.first() {
        book.iteration = Some(Iteration {
            enabled: matches!(attr(el, "iterate"), Some("1" | "true")),
            maximum: attr(el, "iterateCount")
                .and_then(|v| v.parse().ok())
                .unwrap_or(100),
            tolerance: attr(el, "iterateDelta")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.001),
        });
    }
    let app_path = related(&package, "/", "extended-properties");
    let app = match app_path.as_deref() {
        Some(path) => parse(path.trim_start_matches('/'))?,
        None => Vec::new(),
    };
    let generator = elements(&app, "Application")
        .first()
        .map(|el| text(el))
        .unwrap_or_default()
        .to_ascii_lowercase();
    let known = generator.starts_with("microsoft") || generator.starts_with("libreoffice");
    let mut sources = Vec::new();
    let mut states = Vec::new();
    for sheet in elements(&workbook, "sheet") {
        let name = attr(sheet, "name").unwrap_or(if editable { "" } else { "Sheet1" });
        if !super::valid_sheet_name(name) {
            if editable {
                return Err(format!("Invalid worksheet name {name:?}"));
            }
            continue;
        }
        let id = attr(sheet, "id");
        if editable && id.is_none_or(str::is_empty) {
            return Err(format!("Worksheet {name:?} has no relationship ID"));
        }
        let Some(rel) = elements(&relationships, "Relationship")
            .into_iter()
            .find(|rel| attr(rel, "Id") == id && attr(rel, "TargetMode") != Some("External"))
        else {
            if editable {
                return Err(format!(
                    "Worksheet {name:?} references no internal relationship"
                ));
            }
            continue;
        };
        let Some(target) = attr(rel, "Target").filter(|target| !editable || !target.is_empty())
        else {
            if editable {
                return Err(format!("Worksheet {name:?} has no relationship target"));
            }
            continue;
        };
        let target = crate::vfs::resolve_posix_path(directory, target);
        let state = match attr(sheet, "state") {
            None | Some("visible") => "visible",
            Some("hidden") => "hidden",
            Some("veryHidden") => "veryHidden",
            _ => return Err(format!("Invalid worksheet visibility for {name:?}")),
        };
        states.push(state);
        sources.push((name.to_owned(), target.trim_start_matches('/').to_owned()));
    }
    if sources.is_empty() && !elements(&workbook, "sheet").is_empty() {
        let target = if entries.contains_key("xl/worksheets/sheet1.xml") {
            Some("xl/worksheets/sheet1.xml")
        } else {
            entries
                .keys()
                .find(|n| n.starts_with("xl/worksheets/sheet"))
                .map(String::as_str)
        };
        if let Some(target) = target {
            sources.push(("Sheet1".into(), target.into()));
            states.push("visible");
        }
    }
    if editable && !states.is_empty() && !states.contains(&"visible") {
        return Err("Workbook must have at least one visible sheet".into());
    }
    let mut remaining = limit;
    let value_errors = if editable {
        let values = related(&relationships, directory, "rdRichValue");
        let structures = related(&relationships, directory, "rdRichValueStructure");
        // Charge metadata traversal, XML trees and index vectors before allocation.
        for path in [
            metadata_path.as_deref(),
            values.as_deref(),
            structures.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if let Some(bytes) = entries.get(path.trim_start_matches('/')) {
                remaining = remaining
                    .checked_sub(bytes.len().checked_mul(16).ok_or(LIMIT)?)
                    .ok_or(LIMIT)?;
            }
        }
        let values =
            parse(values.as_deref().unwrap_or("").trim_start_matches('/')).unwrap_or_default();
        let structures =
            parse(structures.as_deref().unwrap_or("").trim_start_matches('/')).unwrap_or_default();
        super::value_metadata::errors(&metadata, &values, &structures)
    } else {
        Vec::new()
    };
    for (name, path) in &sources {
        remaining = remaining
            .checked_sub(name.len() + path.len() + std::mem::size_of::<Sheet<String>>() + 128)
            .ok_or(LIMIT)?;
    }
    normalize_names(&mut workbook, sources.len().max(1), &mut remaining)?;
    for name in elements(&workbook, "definedName") {
        let Some(label) = attr(name, "name") else {
            continue;
        };
        let sheet = attr(name, "localSheetId")
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|&s| s < sources.len().max(1));
        let expression = text(name);
        let expression = if editable {
            super::xlsx_string::decode(&expression)
        } else {
            expression
        };
        remaining = remaining
            .checked_sub(
                label.len() + expression.len() + std::mem::size_of::<NamedExpression>() + 64,
            )
            .ok_or(LIMIT)?;
        book.names.push(NamedExpression {
            name: label.into(),
            sheet,
            expression,
            openformula: None,
            position: (sheet.unwrap_or(0), 0, 0),
            compiled: None,
        });
    }
    let mut raw = Vec::new();
    let mut sheets = Vec::new();
    let mut groups = BTreeMap::new();
    let mut shared_cells = Vec::new();
    let mut ordinary = Vec::new();
    let mut shared_strings = std::collections::BTreeSet::new();
    let mut calculated = known;
    for (s, (name, path)) in sources.iter().enumerate() {
        let doc = parse(path)?;
        if editable && doc.is_empty() {
            return Err("Workbook references missing worksheet data".into());
        }
        let mut raw_cells = BTreeMap::new();
        let mut sheet = Sheet {
            name: name.clone(),
            state: states[s],
            view: Vec::new(),
            print: Default::default(),
            filter: None,
            cells: BTreeMap::new(),
            rows: BTreeMap::new(),
            columns: BTreeMap::new(),
            merges: Vec::new(),
            arrays: Vec::new(),
            comments: Vec::new(),
            empty_headers: false,
            default_row_height: None,
            frozen_rows: 0,
            frozen_columns: 0,
            default_column_width: None,
        };
        let mut row_index = -1i64;
        for row in elements(&doc, "row") {
            row_index = row_position(row, row_index);
            let mut column_index = -1i64;
            for cell in elements(&row.children, "c") {
                let Some((r, c)) = cell_position(cell, row_index, &mut column_index) else {
                    continue;
                };
                let position = (s, r, c);
                let kind = attr(cell, "t").unwrap_or("n");
                let (mut value, mut rich) = if kind == "inlineStr" {
                    string_content(&cell.children)
                } else {
                    (
                        elements(&cell.children, "v")
                            .first()
                            .map(|el| text(el))
                            .unwrap_or_default(),
                        false,
                    )
                };
                if kind == "s" {
                    let item = value.parse::<usize>().ok().and_then(|i| shared.get(i));
                    if editable && !value.is_empty() && item.is_none() {
                        return Err("Cell references a missing shared string".into());
                    }
                    if item.is_some_and(|(v, _)| v.len() > remaining) {
                        return Err(LIMIT.into());
                    }
                    (value, rich) = item.cloned().unwrap_or_default();
                }
                if editable && kind == "str" {
                    value = super::xlsx_string::decode(&value);
                }
                if kind == "e"
                    && let Some(error) = attr(cell, "vm")
                        .and_then(|s| s.parse::<usize>().ok())
                        .and_then(|i| i.checked_sub(1))
                        .and_then(|i| value_errors.get(i))
                        .copied()
                        .flatten()
                {
                    value = error.into();
                }
                let formula = elements(&cell.children, "f");
                let formula = formula.first().copied();
                // Excel can put an empty <f ca="1"/> on a cached dynamic
                // spill follower. Only the declared spill cleanup below may
                // discard it; real, shared and array formulas stay authored.
                if editable
                    && formula.is_some_and(|f| {
                        !f.children.is_empty() || !matches!(attr(f, "t"), None | Some("normal"))
                    })
                {
                    authored_formulas.insert(position);
                }
                let dynamic = attr(cell, "cm")
                    .and_then(|s| s.parse::<usize>().ok())
                    .is_some_and(|i| dynamic_metadata.contains(&i));
                let formula_type = formula.and_then(|f| attr(f, "t")).unwrap_or("normal");
                // Explicit Excel strings, including zero-length strings, are
                // authored text. MATCH/ISTEXT distinguish them from blank cells.
                let empty = value.is_empty()
                    && !rich
                    && formula.is_none()
                    && kind != "b"
                    && !(editable && matches!(kind, "s" | "str" | "inlineStr"));
                // An empty styled cell is still authored content: its number
                // format and appearance apply to later edits and array spills.
                if empty && !(editable && attr(cell, "s").is_some()) {
                    continue;
                }
                remaining = remaining
                    .checked_sub(value.len())
                    .and_then(|n| {
                        n.checked_sub(if !matches!(kind, "n" | "b") {
                            value.len()
                        } else {
                            0
                        })
                    })
                    .and_then(|n| n.checked_sub(std::mem::size_of::<TypedCell<String>>() + 96))
                    .ok_or(LIMIT)?;
                let mut typed = match kind {
                    _ if empty => None,
                    "n" => Some(Value::Number(
                        value
                            .parse::<f64>()
                            .ok()
                            .filter(|n| n.is_finite())
                            .unwrap_or(0.),
                    )),
                    "b" => Some(Value::Bool(matches!(value.as_str(), "1" | "true"))),
                    "e" => Some(Value::Error(value.clone())),
                    _ => Some(Value::Text(value.clone())),
                };
                if formula.is_some() {
                    if formula_type != "array"
                        && kind == "n"
                        && value.parse::<f64>().is_ok_and(|n| n != 0. && n.is_finite())
                    {
                        calculated = true;
                    }
                    if value.is_empty()
                        || !(kind == "n"
                            || kind == "str" && known
                            || kind == "b"
                                && formula_type == "shared"
                                && matches!(value.as_str(), "0" | "1"))
                    {
                        typed = None;
                    }
                }
                {
                    let display = if kind == "b" {
                        if matches!(value.as_str(), "1" | "true") {
                            "TRUE"
                        } else {
                            "FALSE"
                        }
                        .to_owned()
                    } else {
                        value
                    };
                    raw_cells.insert((r, c), (display, kind == "n"));
                }
                let index = attr(cell, "s")
                    .and_then(|v| v.parse::<usize>().ok())
                    .unwrap_or(0);
                let format = styles
                    .get(index)
                    .and_then(|id| {
                        formats
                            .get(id)
                            .map(String::as_str)
                            .or_else(|| dates::builtin(*id))
                    })
                    .map(str::to_owned);
                // ECMA-376 ST_Formula extends ST_Xstring, including its escaped
                // controls and literal underscores. The editable workbook uses
                // that representation; the conversion path preserves Calc's
                // raw-formula behavior for its native compatibility fixtures.
                let source = formula
                    .map(|f| {
                        let source = text(f);
                        if editable {
                            super::xlsx_string::decode(&source)
                        } else {
                            source
                        }
                    })
                    .or_else(|| match (kind, &typed) {
                        ("b", Some(Value::Bool(value))) if !editable => {
                            Some(if *value { "TRUE()" } else { "FALSE()" }.into())
                        }
                        ("e", Some(Value::Error(value))) if !editable => Some(value.clone()),
                        _ => None,
                    });
                if let Some(source) = &source {
                    remaining = remaining.checked_sub(source.len()).ok_or(LIMIT)?;
                }
                if kind == "b" && formula.is_none() && !editable {
                    typed = None;
                }
                if source.is_some() && !matches!(formula_type, "shared" | "array") {
                    remaining = remaining
                        .checked_sub(std::mem::size_of::<((usize, usize, usize), bool)>())
                        .ok_or(LIMIT)?;
                    ordinary.push((position, !matches!(kind, "b" | "e")));
                }
                if let Some(f) = formula {
                    if formula_type == "shared" {
                        if let Some(id) = attr(f, "si").and_then(|v| v.parse::<usize>().ok()) {
                            if let Some(source) = source.as_ref().filter(|v| !v.is_empty()) {
                                groups.insert((s, id), (position, source.clone()));
                            }
                            shared_cells.push((position, id));
                            if kind == "str" && known {
                                shared_strings.insert(position);
                            }
                        }
                    } else if formula_type == "array"
                        && let Some(range) = attr(f, "ref")
                    {
                        let (a, b) = range.split_once(':').unwrap_or((range, range));
                        if let (Some(a), Some(b)) = (coordinate(a), coordinate(b)) {
                            let range = [
                                a.0.min(b.0),
                                a.1.min(b.1),
                                a.1.abs_diff(b.1) + 1,
                                a.0.abs_diff(b.0) + 1,
                            ];
                            if dynamic && (r, c) == (range[0], range[1]) {
                                dynamic_ranges.push((s, range));
                            } else {
                                sheet.arrays.push(ArrayFormula {
                                    range,
                                    expression: source.clone().unwrap_or_default(),
                                    openformula: None,
                                    formula_display: None,
                                });
                            }
                        }
                    }
                }
                sheet.cells.insert(
                    (r, c),
                    TypedCell {
                        legacy_formula: editable
                            && formula.is_some()
                            && formula_type != "array"
                            && !dynamic,
                        value: typed,
                        formula: source,
                        openformula: None,
                        formula_display: None,
                        format,
                        value_format: None,
                        style: None,
                        rich_text: None,
                    },
                );
            }
        }
        sheets.push(sheet);
        raw.push(raw_cells);
    }
    if sheets.is_empty() {
        remaining = remaining
            .checked_sub(std::mem::size_of::<Sheet<String>>() + 6)
            .ok_or(LIMIT)?;
        sheets.push(Sheet {
            name: "Sheet1".into(),
            state: "visible",
            view: Vec::new(),
            print: Default::default(),
            filter: None,
            cells: BTreeMap::new(),
            rows: BTreeMap::new(),
            columns: BTreeMap::new(),
            merges: Vec::new(),
            arrays: Vec::new(),
            comments: Vec::new(),
            empty_headers: true,
            default_row_height: None,
            frozen_rows: 0,
            frozen_columns: 0,
            default_column_width: None,
        });
        raw.push(BTreeMap::new());
    }
    for (position, id) in shared_cells {
        if let Some((origin, source)) = groups.get(&(position.0, id)) {
            remaining = remaining.checked_sub(source.len() + 64).ok_or(LIMIT)?;
            let cell = sheets[position.0]
                .cells
                .get_mut(&(position.1, position.2))
                .unwrap();
            cell.formula = Some(source.clone());
            book.formula_origins.insert(position, *origin);
            if !manual && !shared_strings.contains(&position) {
                cell.value = None;
            }
        }
    }
    let formula_names: Vec<_> = book
        .names
        .iter()
        .map(|name| {
            remaining = remaining
                .checked_sub(
                    name.name.len()
                        + name.expression.len()
                        + name.openformula.as_ref().map_or(0, String::len)
                        + std::mem::size_of::<NamedExpression>(),
                )
                .ok_or(LIMIT)?;
            Ok(name.clone())
        })
        .collect::<Result<_, &str>>()?;
    // Native conversion emulates Calc's compiled-formula grouping. In the
    // editor it can merge distinct numeric literals after display rounding.
    if !editable {
        // LibreOffice compares the raw next formula with the prior compiled code's
        // text at the new row. Literal cells and row gaps leave this cache intact;
        // explicit shared/array formulas are imported in separate passes.
        let mut compiled: BTreeMap<_, ((usize, usize, usize), Option<(usize, usize, usize)>)> =
            BTreeMap::new();
        let mut raw_groups = BTreeMap::new();
        for &(position @ (s, r, c), _) in &ordinary {
            let mut group = None;
            if let Some(&(previous, head)) = compiled.get(&(s, c)) {
                let prior = &sheets[s].cells[&(previous.1, previous.2)];
                let original = prior
                    .openformula
                    .as_deref()
                    .and_then(|source| source.strip_prefix("msoxl:="))
                    .unwrap_or(prior.formula.as_deref().unwrap());
                let origin = book
                    .formula_origins
                    .get(&previous)
                    .copied()
                    .unwrap_or(previous);
                let predicted = formula_tokens(
                    original,
                    &formula_names,
                    &sources,
                    (Some(s), Some(s)),
                    (r as i64 - origin.1 as i64, 0),
                    Syntax::XlsxCode,
                    &mut remaining,
                )
                .ok_or(LIMIT)?;
                if sheets[s].cells[&(r, c)].formula.as_deref() == Some(predicted.text.as_ref()) {
                    remaining = remaining
                        .checked_sub(original.len() + 8 + 64)
                        .ok_or(LIMIT)?;
                    let code = format!("msoxl:={original}");
                    sheets[s].cells.get_mut(&(r, c)).unwrap().openformula = Some(code);
                    book.formula_origins.insert(position, origin);
                    if previous.1 + 1 == r {
                        let top = head.unwrap_or(previous);
                        if head.is_none() {
                            remaining = remaining.checked_sub(96).ok_or(LIMIT)?;
                        }
                        *raw_groups.entry(top).or_insert(1) += 1;
                        group = Some(top);
                    }
                }
            }
            remaining = remaining.checked_sub(64).ok_or(LIMIT)?;
            compiled.insert((s, c), (position, group));
        }
        groups::regroup(
            &mut sheets,
            &mut book,
            &sources,
            &formula_names,
            &raw_groups,
            &mut remaining,
        )?;
    }
    // Calculation retains the imported dialect, including cached compiled code.
    // Display uses each cell's own position, including both shared reference axes.
    let origins = &book.formula_origins;
    for (source, original, offset, scope) in book
        .names
        .iter_mut()
        .map(|name| {
            (
                &mut name.expression,
                &mut name.openformula,
                (0, 0),
                name.sheet,
            )
        })
        .chain(sheets.iter_mut().enumerate().flat_map(|(s, sheet)| {
            sheet
                .cells
                .iter_mut()
                .filter_map(move |(&(r, c), cell)| {
                    cell.formula.as_mut().map(|formula| {
                        let origin = origins.get(&(s, r, c)).copied().unwrap_or((s, r, c));
                        (
                            formula,
                            &mut cell.openformula,
                            (r as i64 - origin.1 as i64, c as i64 - origin.2 as i64),
                            Some(s),
                        )
                    })
                })
                .chain(sheet.arrays.iter_mut().map(move |group| {
                    let [r, c, _, _] = group.range;
                    let origin = origins.get(&(s, r, c)).copied().unwrap_or((s, r, c));
                    (
                        &mut group.expression,
                        &mut group.openformula,
                        (r as i64 - origin.1 as i64, c as i64 - origin.2 as i64),
                        Some(s),
                    )
                }))
        }))
    {
        if original.is_none() {
            remaining = remaining.checked_sub(source.len() + 8).ok_or(LIMIT)?;
            *original = Some(format!("msoxl:={source}"));
        }
        let code = original
            .as_deref()
            .unwrap()
            .strip_prefix("msoxl:=")
            .unwrap();
        let display = formula_tokens(
            code,
            &formula_names,
            &sources,
            (scope, scope),
            offset,
            Syntax::XlsxImport,
            &mut remaining,
        )
        .ok_or(LIMIT)?;
        if source.as_str() != display.text.as_ref() {
            *source = display.text.into_owned();
        }
    }
    // Boolean/error cells still separate formula groups, but cannot supply
    // ordinary caches that override an array member's calculated value.
    ordinary.retain(|&(_, cached)| cached);
    ordinary.sort_unstable();
    book.recalculate = !calculated;
    for (s, sheet) in sheets.iter_mut().enumerate() {
        remaining = remaining
            .checked_sub(sheet.cells.len() + sheet.arrays.len())
            .ok_or(LIMIT)?;
        let last_column = sheet
            .cells
            .keys()
            .map(|&(_, c)| c)
            .chain(sheet.arrays.iter().map(|g| g.range[1] + g.range[2] - 1))
            .max();
        for group in &mut sheet.arrays {
            if group.expression.is_empty() {
                // An empty matrix has no instructions and evaluates to zero;
                // an ordinary empty formula remains a compiler error.
                remaining = remaining.checked_sub(16).ok_or(LIMIT)?;
                group.openformula = Some("msoxl:=0".into());
                let [r, c, _, _] = group.range;
                if let Some(cell) = sheet.cells.get_mut(&(r, c)) {
                    cell.openformula = Some("msoxl:=0".into());
                }
            }
        }
        for (&(r, c), cell) in &mut sheet.cells {
            if cell.formula.is_none() {
                continue;
            }
            if book.recalculate || cell.value.is_none() {
                raw[s].remove(&(r, c));
                cell.value = if manual && !book.recalculate {
                    Some(Value::Number(0.))
                } else {
                    None
                };
            }
        }
        for group in &sheet.arrays {
            let [r, c, w, h] = group.range;
            remaining = remaining
                .checked_sub(
                    w.checked_mul(h)
                        .and_then(|n| n.checked_mul(std::mem::size_of::<TypedCell<String>>() + 128))
                        .ok_or(LIMIT)?,
                )
                .ok_or(LIMIT)?;
            for row in r..r + h {
                for col in c..c + w {
                    let cell = sheet.cells.entry((row, col)).or_insert_with(|| TypedCell {
                        legacy_formula: false,
                        value: None,
                        formula: None,
                        openformula: None,
                        formula_display: None,
                        format: None,
                        value_format: None,
                        style: None,
                        rich_text: None,
                    });
                    if (row, col) != (r, c) {
                        // XLSX matrix membership replaces follower formulas.
                        cell.formula = None;
                        cell.openformula = None;
                    }
                    // Array caches and plain follower values are discarded.
                    // Ordinary formula caches are applied after array creation
                    // and can supply retained results for its follower cells.
                    if (row, col) == (r, c)
                        || ordinary.binary_search(&((s, row, col), true)).is_err()
                    {
                        cell.value = None;
                    }
                    if cell.value.is_none() {
                        raw[s].remove(&(row, col));
                    }
                }
            }
            if manual && calculated && w > 1 && last_column == Some(c + w - 1) {
                // At the sheet's last used column, manual import takes the
                // first-row matrix follower from the anchor.
                let cell = sheet.cells.get_mut(&(r, c + w - 1)).unwrap();
                cell.formula = Some(format!(
                    "${}${}",
                    crate::commands::structured::xlsx_idx_to_col_ref(c),
                    r + 1
                ));
                cell.value_format = Some("General".into());
            }
        }
    }
    // Error literals become formulas only outside array follower cells. Keep
    // existing matrix caches until membership has removed their formula text.
    for (s, sheet) in sheets.iter_mut().enumerate() {
        for (&position, cell) in &mut sheet.cells {
            if cell.formula.is_some() && matches!(cell.value, Some(Value::Error(_))) {
                cell.value = None;
                raw[s].remove(&position);
            }
        }
    }
    let mut imported = Imported {
        #[cfg(test)]
        workbook_path,
        #[cfg(test)]
        app_path,
        style_path,
        theme_path,
        sources,
        sheets,
        book,
        raw,
        remaining,
    };
    // Local structured references need their table before compilation. An
    // early compiler error is otherwise persisted over the original formula.
    if editable {
        layout::retain(&mut imported, entries)?;
        for (s, [r, c, w, h]) in dynamic_ranges {
            let sheet = &mut imported.sheets[s];
            let mut empty = Vec::new();
            for (&(row, col), cell) in sheet.cells.range_mut((r, 0)..(r + h, 0)) {
                imported.remaining = imported.remaining.checked_sub(32).ok_or(LIMIT)?;
                if col < c || col >= c + w || authored_formulas.contains(&(s, row, col)) {
                    continue;
                }
                cell.value = None;
                cell.formula = None;
                cell.openformula = None;
                cell.formula_display = None;
                cell.value_format = None;
                cell.rich_text = None;
                if cell.format.as_deref().is_some_and(|f| f == "General") {
                    cell.format = None;
                }
                if cell.format.is_none() && cell.style.is_none() {
                    empty.push((row, col));
                }
                imported.raw[s].remove(&(row, col));
            }
            for position in empty {
                sheet.cells.remove(&position);
            }
        }
    }
    // Named pivot sources may reference dynamic arrays. Their cached cells
    // must be cleared before resolving a source, so they cannot block its spill.
    if editable {
        pivot::retain(&mut imported, entries)?;
    }
    // Editable workbooks calculate after shared formulas are materialized, with
    // each cell's scalar/array mode. The converter retains Calc's cache rules.
    if !editable {
        for (s, r, c) in formulas::xlsx_recalculate(
            &mut imported.sheets,
            &imported.book,
            manual,
            &mut imported.remaining,
        )
        .ok_or(LIMIT)?
        {
            imported.raw[s].remove(&(r, c));
        }
        formulas::cache(
            &mut imported.sheets,
            &imported.book,
            None,
            imported.remaining,
            false,
        )
        .ok_or(LIMIT)?;
    }
    Ok(imported)
}

#[cfg(test)]
pub(in crate::commands) fn export_csv(
    bytes: &[u8],
    filter: Option<&str>,
    limit: usize,
) -> Result<Vec<super::csv::Output>, String> {
    let imported = read(&read_office_archive(bytes), limit, false)?;
    super::csv::workbook(
        &imported.sheets,
        filter,
        imported.book.date1904,
        &imported.raw,
        imported.remaining,
    )
    .map_err(|e| format!("Error: conversion failed: {e}\n"))
}

#[cfg(test)]
pub(in crate::commands) fn read_xlsx(
    bytes: &[u8],
    output_format: &str,
    limit: usize,
) -> Result<Vec<Vec<String>>, String> {
    let Imported {
        sheets,
        book,
        raw,
        mut remaining,
        ..
    } = read(&read_office_archive(bytes), limit, false)?;
    let Some(sheet) = sheets.first() else {
        return Ok(Vec::new());
    };
    let mut raw = raw.into_iter().next().unwrap_or_default();
    let mut output = BTreeMap::new();
    let mut height = 0usize;
    let mut width = 0usize;
    let mut format_work = remaining;
    for group in &sheet.arrays {
        height = height.max(group.range[0] + group.range[3]);
        width = width.max(group.range[1] + group.range[2]);
    }
    for (&position, cell) in &sheet.cells {
        let (mut value, numeric) = if let Some(raw) = raw.remove(&position) {
            raw
        } else {
            match &cell.value {
                Some(Value::Number(n)) => (dates::display_number(*n), true),
                Some(Value::Bool(b)) if cell.value_format.as_deref() == Some("General") => {
                    (u8::from(*b).to_string(), true)
                }
                Some(Value::Bool(b)) => (if *b { "TRUE" } else { "FALSE" }.into(), false),
                Some(Value::Text(s) | Value::Error(s)) => (s.clone(), false),
                _ => (String::new(), false),
            }
        };
        if output_format == "csv" {
            value = super::csv::cell_text(
                cell,
                Some(&(value, numeric)),
                book.date1904,
                super::number_format::Mode::Edit,
                &mut format_work,
            )
            .ok_or(LIMIT)?
            .0;
        }
        if output_format == "html"
            && numeric
            && let Some(pattern) = cell.format.as_deref()
            && let Some(formatted) = dates::text(
                &value,
                pattern,
                book.date1904,
                false,
                remaining,
                &mut format_work,
            )
            .map_err(|e| format!("Error: conversion failed: {e}\n"))?
        {
            value = formatted;
        }
        if value.is_empty() && cell.formula.is_none() {
            continue;
        }
        remaining = remaining.checked_sub(value.len()).ok_or(LIMIT)?;
        height = height.max(position.0 + 1);
        width = width.max(position.1 + 1);
        output.insert(position, value);
    }
    let allocation = width
        .checked_mul(std::mem::size_of::<String>())
        .and_then(|n| n.checked_add(std::mem::size_of::<Vec<String>>()))
        .and_then(|n| n.checked_mul(height));
    if allocation.is_none_or(|n| n > remaining) {
        return Err("Error: conversion failed: worksheet exceeds cell limit\n".into());
    }
    let mut rows = vec![vec![String::new(); width]; height];
    for ((r, c), value) in output {
        rows[r][c] = value;
    }
    Ok(rows)
}

/// Load all package members before interpreting cells, including CRC and byte limits.
pub(super) fn workbook(
    bytes: &[u8],
    limit: usize,
) -> Result<(Vec<Sheet<String>>, Workbook), String> {
    use std::borrow::Cow;
    let mut remaining = limit.checked_sub(bytes.len()).ok_or(LIMIT)?;
    let mut entries = BTreeMap::new();
    let (members, _) = crate::commands::codecs::zip_directory(bytes.len(), |range| {
        Ok(Cow::Borrowed(&bytes[range]))
    })
    .map_err(|_| "Invalid XLSX archive")?;
    for member in members {
        if !matches!(member.method, 0 | 8) || entries.contains_key(&member.name) {
            return Err("Invalid XLSX archive member".into());
        }
        remaining = remaining
            .checked_sub(member.size)
            .and_then(|n| n.checked_sub(member.name.len() + 128))
            .ok_or(LIMIT)?;
        let content = member
            .decode(Cow::Borrowed(&bytes[member.payload.clone()]), None)
            .map_err(|_| "Invalid XLSX member data")?;
        entries.insert(member.name, content.into_owned());
    }
    let imported = read(&entries, remaining, true)?;
    if imported.sources.is_empty() {
        return Err("Archive contains no spreadsheet workbook".into());
    }
    Ok((imported.sheets, imported.book))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::structured::{JVal, parse_json_stream, write_zip_stored};

    #[test]
    fn formula_rendering_retains_native_non_ascii_space_tokens() {
        // LibreOffice 24.8.7.2 emits these as name tokens, not empty formulas.
        for (source, expected) in [
            ("\u{a0}", "\u{a0}"),
            ("\u{2003}", "\u{2003}"),
            (" \u{a0} ", "\u{a0}"),
            ("\u{a0}\t", "\u{a0}"),
            ("=\u{a0}", "\u{a0}"),
        ] {
            for syntax in [Syntax::XlsxImport, Syntax::Xlsx] {
                let output = formula_tokens(
                    source,
                    &[],
                    &[("Sheet1".into(), String::new())],
                    (Some(0), Some(0)),
                    (0, 0),
                    syntax,
                    &mut 65536,
                )
                .unwrap();
                assert_eq!(output.text, expected, "{source:?}");
            }
        }
    }

    #[test]
    fn xlsx_arithmetic_number_formats_match_native_libreoffice() {
        let JVal::Object(fixture) = parse_json_stream(include_str!(
            "fixtures/soffice-arithmetic-formats-native.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &fixture.iter().find(|(key, _)| key == "cases").unwrap().1 else {
            panic!("cases")
        };
        for case in cases {
            let JVal::Object(fields) = case else {
                panic!("case")
            };
            let field = |key: &str| &fields.iter().find(|(k, _)| k == key).unwrap().1;
            let JVal::Object(parts) = field("parts") else {
                panic!("parts")
            };
            let JVal::Array(expected) = field("formats") else {
                panic!("formats")
            };
            let JVal::Array(formulas) = field("formulas") else {
                panic!("formulas")
            };
            let input = write_zip_stored(
                &parts
                    .iter()
                    .map(|(path, value)| {
                        let JVal::Str(value) = value else {
                            panic!("part")
                        };
                        (path.as_str(), value.as_bytes())
                    })
                    .collect::<Vec<_>>(),
            );
            let output = export_xlsx(&input, 10_000_000).unwrap();
            let imported = read(&read_office_archive(&output), 10_000_000, false).unwrap();
            let mut failures = Vec::new();
            for (r, expected) in expected.iter().enumerate() {
                let JVal::Str(expected) = expected else {
                    panic!("format")
                };
                let JVal::Str(formula) = &formulas[r] else {
                    panic!("formula")
                };
                let actual = imported.sheets[0].cells[&(r, 0)]
                    .format
                    .as_deref()
                    .unwrap_or("General");
                // Escapes of these punctuation literals do not change the format.
                let normalize = |s: &str| {
                    s.replace(r"\$", "$")
                        .replace(r"\-", "-")
                        .replace(r"\ ", " ")
                };
                if normalize(actual) != normalize(expected) {
                    failures.push(format!("{formula}: expected {expected:?}, got {actual:?}"));
                }
            }
            assert!(
                failures.is_empty(),
                "{} mismatches:\n{}",
                failures.len(),
                failures
                    .iter()
                    .take(40)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n")
            );
        }
    }

    #[test]
    fn xlsx_empty_workbook_keeps_native_date_system_and_named_expressions() {
        let JVal::Object(fixture) =
            parse_json_stream(include_str!("fixtures/soffice-main-parts-native.json"))
                .unwrap()
                .remove(0)
        else {
            panic!("fixture")
        };
        let JVal::Object(archives) = &fixture.iter().find(|(key, _)| key == "archives").unwrap().1
        else {
            panic!("archives")
        };
        let JVal::Str(input) = &archives
            .iter()
            .find(|(key, _)| key == "empty-names.xlsx")
            .unwrap()
            .1
        else {
            panic!("input")
        };
        let input: Vec<u8> = input
            .as_bytes()
            .chunks_exact(2)
            .map(|b| u8::from_str_radix(std::str::from_utf8(b).unwrap(), 16).unwrap())
            .collect();
        let output = export_xlsx(&input, 10_000_000).unwrap();
        let entries = read_office_archive(&output);
        let workbook = xml::parse(
            std::str::from_utf8(&entries["xl/workbook.xml"]).unwrap(),
            None,
            None,
        )
        .unwrap();
        // LibreOffice 24.8.7.2 creates Sheet1 while keeping these workbook properties.
        let props = elements(&workbook.nodes, "workbookPr");
        assert!(matches!(attr(props[0], "date1904"), Some("true" | "1")));
        let sheets = elements(&workbook.nodes, "sheet");
        assert_eq!(sheets.len(), 1);
        assert_eq!(attr(sheets[0], "name"), Some("Sheet1"));
        let names = elements(&workbook.nodes, "definedName");
        let mut names: Vec<_> = names
            .into_iter()
            .map(|el| (attr(el, "name"), attr(el, "localSheetId"), text(el)))
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                (Some("Local"), Some("0"), "4".into()),
                (Some("Rate"), None, "9".into())
            ]
        );
    }

    #[test]
    fn xlsx_export_result_formats_match_native_libreoffice() {
        let JVal::Object(fixture) =
            parse_json_stream(include_str!("fixtures/soffice-result-formats-native.json"))
                .unwrap()
                .remove(0)
        else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &fixture.iter().find(|(key, _)| key == "cases").unwrap().1 else {
            panic!("cases")
        };
        for case in cases {
            let JVal::Object(fields) = case else {
                panic!("case")
            };
            let field = |key: &str| &fields.iter().find(|(k, _)| k == key).unwrap().1;
            let JVal::Str(name) = field("name") else {
                panic!("name")
            };
            let JVal::Object(parts) = field("parts") else {
                panic!("parts")
            };
            let JVal::Str(expected) = field("xlsx_csv") else {
                panic!("csv")
            };
            let input = write_zip_stored(
                &parts
                    .iter()
                    .map(|(path, value)| {
                        let JVal::Str(value) = value else {
                            panic!("part")
                        };
                        (path.as_str(), value.as_bytes())
                    })
                    .collect::<Vec<_>>(),
            );
            let output =
                export_xlsx(&input, 10_000_000).unwrap_or_else(|error| panic!("{name}: {error}"));
            let rows = read_xlsx(&output, "csv", 10_000_000).unwrap();
            if name == "explicit.xlsx" {
                // Column A uses General. Preserve the explicit styles in the other
                // columns, which native export can rewrite after logical results.
                assert_eq!(
                    rows.iter().map(|row| row[0].as_str()).collect::<Vec<_>>(),
                    expected
                        .lines()
                        .map(|row| row.split(',').next().unwrap())
                        .collect::<Vec<_>>(),
                    "{name}"
                );
            } else {
                let actual = rows
                    .iter()
                    .map(|row| row.join(",") + "\n")
                    .collect::<String>();
                assert_eq!(&actual, expected, "{name}");
            }
        }
    }

    #[test]
    fn xlsx_export_retains_inferred_formats_and_cell_appearance() {
        let styles = br#"<s:styleSheet xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><s:fonts count="2"><s:font/><s:font><s:b/></s:font></s:fonts><s:fills count="2"><s:fill/><s:fill><s:patternFill patternType="solid"/></s:fill></s:fills><s:borders count="2"><s:border/><s:border><s:left style="thin"/></s:border></s:borders><s:cellXfs count="3"><s:xf numFmtId="0"/><s:xf numFmtId="0" fontId="1" fillId="1" borderId="1" applyAlignment="1"><s:alignment horizontal="center"/><s:protection locked="0"/></s:xf><s:xf numFmtId="2" fontId="1"/></s:cellXfs></s:styleSheet>"#;
        let input = write_zip_stored(&[
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="formats/custom.xml"/><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
            ("xl/formats/custom.xml", styles),
            ("xl/worksheets/sheet1.xml", br#"<worksheet><sheetData><row><c s="1"><f>DATE(2024,1,1)</f></c><c s="1"><f>A1+1</f></c><c s="2"><f>DATE(2024,1,1)</f></c><c s="1"><f>TIME(12,0,0)</f></c><c s="1"><f>50%</f></c><c s="1"><f t="array" ref="F1:G1">DATE(2024,1,1)</f></c></row></sheetData></worksheet>"#),
        ]);
        let output = export_xlsx(&input, 100_000).unwrap();
        assert_eq!(
            read_xlsx(&output, "csv", 100_000).unwrap(),
            vec![vec![
                "01/01/2024",
                "01/02/2024",
                "45292",
                "12:00:00 PM",
                "50%",
                "45292",
                "45292"
            ]]
        );
        let parts = read_office_archive(&output);
        let doc = xml::parse(
            std::str::from_utf8(&parts["xl/formats/custom.xml"]).unwrap(),
            None,
            None,
        )
        .unwrap();
        let original = xml::parse(std::str::from_utf8(styles).unwrap(), None, None).unwrap();
        for tag in ["fonts", "fills", "borders"] {
            assert_eq!(
                format!("{:?}", elements(&doc.nodes, tag)),
                format!("{:?}", elements(&original.nodes, tag))
            );
        }
        let original_xfs = elements(&elements(&original.nodes, "cellXfs")[0].children, "xf");
        let xfs = elements(&elements(&doc.nodes, "cellXfs")[0].children, "xf");
        assert_eq!(xfs.len(), 6);
        assert_eq!(format!("{:?}", &xfs[..3]), format!("{original_xfs:?}"));
        for xf in &xfs[3..] {
            for key in ["fontId", "fillId", "borderId", "applyAlignment"] {
                assert_eq!(attr(xf, key), attr(original_xfs[1], key));
            }
            assert_eq!(
                format!("{:?}", xf.children),
                format!("{:?}", original_xfs[1].children)
            );
        }
        assert_eq!(export_xlsx(&output, 100_000).unwrap(), output);
    }

    #[test]
    fn xlsx_export_adds_missing_format_parts() {
        let input = write_zip_stored(&[
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>"#),
            ("xl/worksheets/sheet1.xml", b"<worksheet><sheetData><row><c><f>DATE(2024,1,1)</f></c></row></sheetData></worksheet>"),
        ]);
        let output = export_xlsx(&input, 100_000).unwrap();
        assert_eq!(
            read_xlsx(&output, "csv", 100_000).unwrap(),
            vec![vec!["01/01/2024"]]
        );
        let parts = read_office_archive(&output);
        let rels = xml::parse(
            std::str::from_utf8(&parts["xl/_rels/workbook.xml.rels"]).unwrap(),
            None,
            None,
        )
        .unwrap();
        assert!(
            elements(&rels.nodes, "Relationship")
                .iter()
                .any(|el| attr(el, "Target") == Some("styles.xml"))
        );
        let types = xml::parse(
            std::str::from_utf8(&parts["[Content_Types].xml"]).unwrap(),
            None,
            None,
        )
        .unwrap();
        assert!(
            elements(&types.nodes, "Override")
                .iter()
                .any(|el| attr(el, "PartName") == Some("/xl/styles.xml"))
        );
        assert!(export_xlsx(&input, output.len() - 1).is_err());
    }

    #[test]
    fn xlsx_export_reopens_manual_workbook_without_zeroing_typed_values() {
        let input = write_zip_stored(&[
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets><calcPr calcMode="manual" iterate="1" iterateCount="20"/></workbook>"#),
            ("xl/worksheets/sheet1.xml", br#"<worksheet><sheetData><row><c><f>TRUE()</f></c><c><f>"text"</f></c><c><f>1+1</f></c></row></sheetData></worksheet>"#),
        ]);
        let output = export_xlsx(&input, 100_000).unwrap();
        assert_eq!(
            read_xlsx(&output, "csv", 100_000).unwrap(),
            vec![vec!["TRUE", "text", "2"]]
        );
        let parts = read_office_archive(&output);
        let doc = xml::parse(
            std::str::from_utf8(&parts["xl/workbook.xml"]).unwrap(),
            None,
            None,
        )
        .unwrap();
        let calc = elements(&doc.nodes, "calcPr")[0];
        assert_eq!(attr(calc, "calcMode"), None);
        assert_eq!(attr(calc, "iterate"), Some("1"));
        assert_eq!(attr(calc, "iterateCount"), Some("20"));
    }

    #[test]
    fn xlsx_export_marks_unicode_package_names_as_utf8() {
        let input = write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),
            (
                "xl/worksheets/sheet1.xml",
                b"<worksheet><sheetData/></worksheet>",
            ),
            ("custom/donn\u{e9}es.xml", b"<custom/>"),
        ]);
        let output = export_xlsx(&input, 8192).unwrap();
        let (members, _) = crate::commands::codecs::zip_directory(output.len(), |r| {
            Ok(std::borrow::Cow::Borrowed(&output[r]))
        })
        .unwrap();
        let member = members.iter().find(|m| !m.name.is_ascii()).unwrap();
        let start = member.payload.start - 30 - member.name.len();
        assert_eq!(
            u16::from_le_bytes(output[start + 6..start + 8].try_into().unwrap()) & 0x800,
            0x800
        );
        let mut at = u32::from_le_bytes(
            output[output.len() - 6..output.len() - 2]
                .try_into()
                .unwrap(),
        ) as usize;
        while &output[at..at + 4] == b"PK\x01\x02" {
            let len = usize::from(u16::from_le_bytes(
                output[at + 28..at + 30].try_into().unwrap(),
            ));
            if &output[at + 46..at + 46 + len] == member.name.as_bytes() {
                assert_eq!(
                    u16::from_le_bytes(output[at + 8..at + 10].try_into().unwrap()) & 0x800,
                    0x800
                );
                return;
            }
            at += 46 + len;
        }
        panic!("missing central member");
    }

    #[test]
    fn xlsx_export_bounds_escaped_cache_output() {
        let sheet = format!(
            "<worksheet><sheetData><row><c><f t=\"array\" ref=\"A1:D1\">\"{}\"</f></c></row></sheetData></worksheet>",
            "&amp;".repeat(400)
        );
        let input = write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),("xl/worksheets/sheet1.xml", sheet.as_bytes())]);
        let output = export_xlsx(&input, 100_000).unwrap();
        assert!(output.len() > 10_000);
        assert!(export_xlsx(&input, 10_000).unwrap_err().contains("limit"));
    }

    #[test]
    fn xlsx_export_inserts_sparse_arrays_without_moving_implicit_cells() {
        let sheet = br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1"/><sheetData><row ht="25"><c><f t="array" ref="A1:B3">{1,2;3,4;5,6}</f></c><c r="D1"><v>9</v></c><c><v>10</v></c></row><row><c r="D2"><v>11</v></c><c><f>D2+1</f></c></row><row r="4"><c r="A4"><v>20</v></c></row></sheetData></worksheet>"#;
        let input = write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),("xl/worksheets/sheet1.xml", sheet)]);
        let output = export_xlsx(&input, 100_000).unwrap();
        let parts = read_office_archive(&output);
        let doc = xml::parse(
            std::str::from_utf8(&parts["xl/worksheets/sheet1.xml"]).unwrap(),
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            attr(elements(&doc.nodes, "dimension")[0], "ref"),
            Some("A1:E4")
        );
        assert_eq!(
            elements(&doc.nodes, "row")
                .iter()
                .map(|r| attr(r, "r").unwrap())
                .collect::<Vec<_>>(),
            ["1", "2", "3", "4"]
        );
        let cells: BTreeMap<_, _> = elements(&doc.nodes, "c")
            .iter()
            .map(|c| {
                (
                    attr(c, "r").unwrap().to_owned(),
                    text(elements(&c.children, "v")[0]),
                )
            })
            .collect();
        for (pos, value) in [
            ("A1", "1"),
            ("B1", "2"),
            ("A2", "3"),
            ("B2", "4"),
            ("A3", "5"),
            ("B3", "6"),
            ("D1", "9"),
            ("E1", "10"),
            ("D2", "11"),
            ("E2", "12"),
            ("A4", "20"),
        ] {
            assert_eq!(cells[pos], value, "{pos}");
        }
        assert_eq!(
            read_xlsx(&input, "csv", 100_000).unwrap(),
            read_xlsx(&output, "csv", 100_000).unwrap()
        );
    }

    #[test]
    fn xlsx_export_validates_every_package_member_before_replacing_output() {
        use crate::commands::{archive::TarEntry, codecs};
        let sheet =
            br#"<worksheet><sheetData><row><c><f>1+1</f></c></row></sheetData></worksheet>"#;
        let entries: Vec<_> = [
            ("xl/worksheets/sheet1.xml", sheet.as_slice()),
            ("custom/opaque.bin", b"retained payload".as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
        ]
        .into_iter()
        .map(|(name, bytes)| TarEntry {
            name: name.into(),
            content: bytes.to_vec(),
            typeflag: b'0',
            mode: 0o644,
            mtime: 0.,
            atime: None,
            uid: 0,
            gid: 0,
            linkname: String::new(),
        })
        .collect();
        let mut invalid = Vec::new();
        for (descriptors, zip64) in [(false, None), (true, None), (true, Some(true))] {
            let input = codecs::encode_zip_members(
                &entries,
                (8, 6),
                &[],
                false,
                (descriptors, zip64, false),
                (&Default::default(), &Default::default()),
                |_, _, _, _| true,
            );
            let output = export_xlsx(&input, 100_000).unwrap();
            assert_eq!(
                read_office_archive(&output)["custom/opaque.bin"],
                b"retained payload"
            );
            assert_eq!(read_xlsx(&output, "csv", 100_000).unwrap(), vec![vec!["2"]]);
            let mut truncated = input.clone();
            truncated.truncate(truncated.len() - 5);
            invalid.push(truncated);
            let (members, _) =
                codecs::zip_directory(input.len(), |r| Ok(std::borrow::Cow::Borrowed(&input[r])))
                    .unwrap();
            let mut corrupt = input.clone();
            corrupt[members[1].payload.start] ^= 0xff;
            invalid.push(corrupt);
        }
        invalid.push(write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),
            ("xl/worksheets/sheet1.xml", sheet),
            ("xl/worksheets/sheet1.xml", sheet),
        ]));
        invalid.push(write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),
            ("xl/worksheets/sheet1.xml", b"<worksheet>".as_slice()),
        ]));
        for input in invalid {
            assert!(export_xlsx(&input, 100_000).is_err());
            assert!(workbook(&input, 100_000).is_err());
        }
        let mut large = entries;
        large[1].content = vec![b'x'; 100_000];
        let input = codecs::encode_zip_members(
            &large,
            (8, 6),
            &[],
            false,
            (true, None, false),
            (&Default::default(), &Default::default()),
            |_, _, _, _| true,
        );
        assert!(input.len() < 8192);
        assert!(export_xlsx(&input, 8192).unwrap_err().contains("limit"));
        let output = export_xlsx(&input, 200_000).unwrap();
        assert_eq!(
            read_office_archive(&output)["custom/opaque.bin"].len(),
            100_000
        );
        let expanded = br#"<worksheet><sheetData><row><c><f t="array" ref="A1:XFD1048576">1</f></c></row></sheetData></worksheet>"#;
        assert!(
            export_xlsx(
                &write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),("xl/worksheets/sheet1.xml", expanded)]),
                100_000
            )
            .unwrap_err()
            .contains("limit")
        );
    }

    #[test]
    fn xlsx_export_preserves_workbook_and_native_typed_caches() {
        let JVal::Object(fixture) =
            parse_json_stream(include_str!("fixtures/soffice-xlsx-export-native.json"))
                .unwrap()
                .remove(0)
        else {
            panic!("fixture")
        };
        let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "cases").unwrap().1 else {
            panic!("cases")
        };
        for case in cases {
            let JVal::Object(fields) = case else {
                panic!("case")
            };
            let field = |name: &str| &fields.iter().find(|(k, _)| k == name).unwrap().1;
            let JVal::Str(name) = field("name") else {
                panic!("name")
            };
            let JVal::Object(parts) = field("parts") else {
                panic!("parts")
            };
            let JVal::Object(caches) = field("caches") else {
                panic!("caches")
            };
            let parts: Vec<_> = parts
                .iter()
                .map(|(k, v)| {
                    let JVal::Str(v) = v else { panic!("part") };
                    (k.as_str(), v.as_bytes())
                })
                .collect();
            let input = write_zip_stored(&parts);
            let output = read_office_archive(&export_xlsx(&input, 10_000_000).unwrap());
            assert_eq!(
                output.len(),
                parts.len() + 1,
                "{name}: expected the application property part"
            );
            assert!(output.contains_key("docProps/app.xml"));
            for (path, source) in parts {
                let actual = output
                    .get(path)
                    .unwrap_or_else(|| panic!("{name}: lost {path}"));
                let Some((_, JVal::Object(expected))) = caches.iter().find(|(p, _)| p == path)
                else {
                    if matches!(path, "[Content_Types].xml" | "_rels/.rels") {
                        let mut original =
                            xml::parse(std::str::from_utf8(source).unwrap(), None, None).unwrap();
                        let mut doc =
                            xml::parse(std::str::from_utf8(actual).unwrap(), None, None).unwrap();
                        assert!(
                            elements(
                                &doc.nodes,
                                if path == "_rels/.rels" {
                                    "Relationship"
                                } else {
                                    "Override"
                                }
                            )
                            .iter()
                            .any(|el| {
                                attr(el, "PartName") == Some("/docProps/app.xml")
                                    || attr(el, "Type")
                                        .is_some_and(|t| t.ends_with("/extended-properties"))
                            }),
                            "{name}: metadata registration"
                        );
                        for nodes in [&mut original.nodes, &mut doc.nodes] {
                            for node in nodes {
                                if let xml::Node::Element(root) = node {
                                    root.children.retain(|node| {
                                    let metadata = matches!(node, xml::Node::Element(el)
                                        if attr(el, "PartName") == Some("/docProps/app.xml")
                                            || attr(el, "Type").is_some_and(|t| t.ends_with("/extended-properties")));
                                    !metadata
                                });
                                }
                            }
                        }
                        assert_eq!(format!("{:?}", original.nodes), format!("{:?}", doc.nodes));
                        continue;
                    }
                    if path.ends_with("/styles.xml") {
                        let original =
                            xml::parse(std::str::from_utf8(source).unwrap(), None, None).unwrap();
                        let doc =
                            xml::parse(std::str::from_utf8(actual).unwrap(), None, None).unwrap();
                        // Existing formats and styles remain at their original indexes.
                        for (collection, tag) in [
                            ("numFmts", "numFmt"),
                            ("cellStyleXfs", "xf"),
                            ("cellXfs", "xf"),
                        ] {
                            let old = elements(&original.nodes, collection);
                            let new = elements(&doc.nodes, collection);
                            assert!(new.len() >= old.len());
                            for (old, new) in old.iter().zip(new) {
                                let old = elements(&old.children, tag);
                                let new = elements(&new.children, tag);
                                assert_eq!(format!("{old:?}"), format!("{:?}", &new[..old.len()]));
                            }
                        }
                        for tag in ["fonts", "fills", "borders", "cellStyles"] {
                            assert_eq!(
                                format!("{:?}", elements(&original.nodes, tag)),
                                format!("{:?}", elements(&doc.nodes, tag))
                            );
                        }
                        continue;
                    }
                    if path.ends_with("/workbook.xml") {
                        let mut original =
                            xml::parse(std::str::from_utf8(source).unwrap(), None, None).unwrap();
                        for node in &mut original.nodes {
                            if let xml::Node::Element(root) = node {
                                for node in &mut root.children {
                                    if let xml::Node::Element(el) = node
                                        && el.tag.rsplit(':').next() == Some("calcPr")
                                    {
                                        el.attrs.retain(|(k, _)| k != "calcMode");
                                    }
                                }
                            }
                        }
                        let doc =
                            xml::parse(std::str::from_utf8(actual).unwrap(), None, None).unwrap();
                        assert_eq!(format!("{:?}", original.nodes), format!("{:?}", doc.nodes));
                        continue;
                    }
                    assert_eq!(actual, source, "{name}: changed {path}");
                    continue;
                };
                let doc = xml::parse(std::str::from_utf8(actual).unwrap(), None, None).unwrap();
                let cells = elements(&doc.nodes, "c");
                for (reference, value) in expected {
                    let JVal::Array(value) = value else {
                        panic!("cache")
                    };
                    let cell = cells
                        .iter()
                        .find(|c| attr(c, "r") == Some(reference))
                        .unwrap_or_else(|| panic!("{name}: missing {reference}"));
                    assert_eq!(
                        JVal::Str(attr(cell, "t").unwrap_or("n").into()),
                        value[0],
                        "{name} {path} {reference}: type"
                    );
                    let mut cached = elements(&cell.children, "v")
                        .first()
                        .map(|v| text(v))
                        .unwrap_or_default();
                    // Native LibreOffice serializes only 15 significant digits.
                    // Our stored values retain full precision; compare this
                    // fixture at its original precision. The editor regression
                    // separately verifies exact cell/cache bits after reopening.
                    if value[0] == JVal::Str("n".into()) && JVal::Str(cached.clone()) != value[1] {
                        cached =
                            super::super::number_format::number(cached.parse().unwrap(), false);
                    }
                    assert_eq!(
                        JVal::Str(cached),
                        value[1],
                        "{name} {path} {reference}: value"
                    );
                }
                let original =
                    xml::parse(std::str::from_utf8(source).unwrap(), None, None).unwrap();
                for old in elements(&original.nodes, "c") {
                    let new = cells
                        .iter()
                        .find(|c| attr(c, "r") == attr(old, "r"))
                        .unwrap();
                    let native_formula = fields.iter().find_map(|(key, value)| {
                        let JVal::Object(sheets) = value else {
                            return None;
                        };
                        if key != "formulas" {
                            return None;
                        }
                        let JVal::Object(cells) =
                            &sheets.iter().find(|(sheet, _)| sheet == path)?.1
                        else {
                            return None;
                        };
                        let JVal::Str(formula) = &cells
                            .iter()
                            .find(|(reference, _)| Some(reference.as_str()) == attr(old, "r"))?
                            .1
                        else {
                            return None;
                        };
                        Some(formula)
                    });
                    if let Some(expected) = native_formula {
                        let formulas = elements(&new.children, "f");
                        assert_eq!(formulas.len(), 1);
                        assert_eq!(&text(formulas[0]), expected, "{name}: native formula");
                        assert!(formulas[0].attrs.is_empty());
                        if elements(&old.children, "f").is_empty() {
                            let mut constant = (*new).clone();
                            constant.children.retain(|node| !matches!(node, xml::Node::Element(el) if el.tag.rsplit(':').next() == Some("f")));
                            assert_eq!(
                                format!("{old:?}"),
                                format!("{constant:?}"),
                                "{name}: Boolean cell attributes/cache"
                            );
                        }
                        continue;
                    }
                    assert_eq!(
                        format!("{:?}", elements(&old.children, "f")),
                        format!("{:?}", elements(&new.children, "f")),
                        "{name}: formula"
                    );
                    if elements(&old.children, "f").is_empty() {
                        assert_eq!(
                            format!("{old:?}"),
                            format!("{new:?}"),
                            "{name}: constant or rich text"
                        );
                    }
                }
                for tag in [
                    "dimension",
                    "cols",
                    "mergeCells",
                    "hyperlinks",
                    "pageMargins",
                ] {
                    assert_eq!(
                        format!("{:?}", elements(&original.nodes, tag)),
                        format!("{:?}", elements(&doc.nodes, tag)),
                        "{name}: {tag}"
                    );
                }
                for old in elements(&original.nodes, "row") {
                    let new = elements(&doc.nodes, "row")
                        .into_iter()
                        .find(|r| attr(r, "r") == attr(old, "r"))
                        .unwrap();
                    assert_eq!(old.attrs, new.attrs, "{name}: row attributes");
                }
            }
        }
    }
}

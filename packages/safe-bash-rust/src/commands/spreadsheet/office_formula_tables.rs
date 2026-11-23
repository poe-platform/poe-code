//! Structured-reference grammar adapted from IronCalc's MIT-licensed
//! expressions/lexer/structured_references.rs and parser table resolution.
//! See LICENSE.IronCalc. References compile into the existing range AST.
use super::super::{case_fold, model::Table};
use super::{Expr, Parser, Value, references::Reference};

use std::ops::Range;
pub(super) struct Token<'a> {
    pub name: &'a str,
    pub end: usize,
    pub parts: Vec<(Range<usize>, &'a str)>,
    this_row: bool,
    range: bool,
    valid: bool,
}
pub(super) fn token(source: &str) -> Option<Token<'_>> {
    let end = source
        .char_indices()
        .take_while(|(_, c)| c.is_alphanumeric() || matches!(c, '_' | '.' | '\\'))
        .map(|(i, c)| i + c.len_utf8())
        .last()
        .unwrap_or(0);
    let body = &source[end..];
    if !body.starts_with('[') {
        return None;
    }
    let mut depth = 0usize;
    let mut start = 1;
    let mut parts = Vec::new();
    let mut nested = false;
    let mut this_row = false;
    let mut range = false;
    let mut consumed = None;
    let mut valid = true;
    let mut chars = body.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        match c {
            '\'' if chars
                .peek()
                .is_some_and(|(_, c)| matches!(c, '[' | ']' | '#' | '@' | '\'')) =>
            {
                chars.next();
            }
            '[' => {
                depth += 1;
                if depth > 2 {
                    valid = false;
                    break;
                }
                if depth == 2 {
                    let prefix = &body[start..i];
                    if prefix.trim() == "@" {
                        this_row = true;
                    } else if !prefix.trim().is_empty() {
                        valid = false;
                    }
                    nested = true;
                }
                start = i + 1;
            }
            ']' => {
                if depth == 0 {
                    valid = false;
                    break;
                }
                if (depth == 2 || depth == 1 && !nested) && i > start {
                    parts.push((end + start..end + i, &body[start..i]));
                }
                depth -= 1;
                start = i + 1;
                if depth == 0 {
                    consumed = Some(i + 1);
                    break;
                }
            }
            ':' | ',' if depth == 1 && nested => {
                if c == ':' {
                    range = true;
                }
                start = i + 1;
            }
            c if depth == 1 && nested => {
                if !c.is_ascii_whitespace() {
                    valid = false;
                }
            }
            _ => {}
        }
    }
    Some(Token {
        name: &source[..end],
        end: end + consumed.unwrap_or(body.len()),
        parts,
        this_row,
        range,
        valid: valid && depth == 0,
    })
}
impl<'a, S: Iterator<Item = &'a str> + Clone> Parser<'a, S> {
    pub(super) fn table_reference(&mut self) -> Option<Expr> {
        let start = self.source;
        if start.starts_with(['\'', '"']) {
            return None;
        }
        let end = start
            .char_indices()
            .take_while(|(_, c)| c.is_alphanumeric() || matches!(c, '_' | '.' | '\\'))
            .map(|(i, c)| i + c.len_utf8())
            .last()
            .unwrap_or(0);
        let name = &start[..end];
        let body = &start[end..];
        if body.trim_ascii_start().starts_with(['!', '(']) {
            return None;
        }
        let Some(nodes) = self.nodes.checked_sub(self.tables.len()) else {
            self.limited = true;
            return None;
        };
        self.nodes = nodes;
        let table = if name.is_empty() {
            self.tables.iter().find(|t| {
                t.sheet == self.position.0
                    && self.position.1 >= t.area[0] as i64
                    && self.position.1 <= t.area[2] as i64
                    && self.position.2 >= t.area[1] as i64
                    && self.position.2 <= t.area[3] as i64
            })
        } else {
            self.tables
                .iter()
                .find(|t| case_fold::same_name(&t.name, name))
        };
        if !body.starts_with('[') {
            let table = table.filter(|_| !name.is_empty())?;
            self.source = body;
            return Some(resolve(table, &[], false, false, self.position));
        }
        if name.is_empty() && table.is_none() && self.local_tokens.is_none() {
            return None;
        }
        if name.is_empty()
            && let Some(close) = body.find(']')
            && body[close + 1..]
                .split([
                    '+', '-', '*', '/', '^', '&', '=', '<', '>', '%', ',', ';', '(', ')', '{', '}',
                ])
                .next()
                .is_some_and(|s| s.contains('!'))
        {
            return None;
        }
        if start.len() > self.nodes.saturating_mul(std::mem::size_of::<Expr>()) {
            self.limited = true;
            return None;
        }
        let token = token(start)?;
        self.source = &start[token.end..];
        let cost = token.end.div_ceil(std::mem::size_of::<Expr>()) + token.parts.len() + 1;
        let Some(nodes) = self.nodes.checked_sub(cost) else {
            self.limited = true;
            return None;
        };
        self.nodes = nodes;
        if !token.valid {
            return Some(Expr::Value(Value::Error("#REF!")));
        }
        let Some(table) = table else {
            return Some(Expr::Value(Value::Error("#NAME?")));
        };
        Some(resolve(
            table,
            &token.parts,
            token.this_row,
            token.range,
            self.position,
        ))
    }
}
pub(super) fn unescape(text: &str) -> String {
    let mut decoded = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\''
            && chars
                .peek()
                .is_some_and(|c| matches!(c, '[' | ']' | '#' | '@' | '\''))
        {
            decoded.push(chars.next().unwrap());
        } else {
            decoded.push(c);
        }
    }
    decoded
}
fn resolve(
    table: &Table,
    parts: &[(Range<usize>, &str)],
    mut this_row: bool,
    range: bool,
    position: (usize, i64, i64),
) -> Expr {
    let error = || Expr::Value(Value::Error("#REF!"));
    let mut sections = 0u8;
    let mut all = false;
    let mut columns = Vec::new();
    for (_, part) in parts {
        let mut text = *part;
        if let Some(rest) = text.strip_prefix('@') {
            this_row = true;
            text = rest;
        }
        if text.starts_with('#') {
            match text.to_ascii_lowercase().as_str() {
                "#all" => {
                    all = true;
                    sections = 7;
                }
                "#headers" => sections |= 1,
                "#data" => sections |= 2,
                "#totals" => sections |= 4,
                "#this row" => this_row = true,
                _ => return error(),
            }
        } else if !text.is_empty() {
            let decoded = unescape(text);
            let Some(index) = table
                .columns
                .iter()
                .position(|c| case_fold::same_name(c, &decoded))
            else {
                return error();
            };
            columns.push(table.area[1] + index);
        }
    }
    if columns.len() > 2 || columns.len() == 2 && !range || columns.len() < 2 && range {
        return error();
    }
    let left = columns.first().copied().unwrap_or(table.area[1]);
    let right = columns.last().copied().unwrap_or(table.area[3]);
    if left > right {
        return error();
    }
    let top = table.area[0] + usize::from(table.header);
    let bottom = table.area[2].checked_sub(usize::from(table.totals));
    let make = |a, b, relative| {
        let first = Reference::table(table.sheet, a, left, relative);
        let last = Reference::table(table.sheet, b, right, relative);
        if a == b && left == right {
            Expr::Ref(first)
        } else {
            Expr::Range(first, last)
        }
    };
    if this_row {
        if sections != 0 || position.1 < top as i64 || bottom.is_none_or(|b| position.1 > b as i64)
        {
            return error();
        }
        return make(0, 0, true);
    }
    if sections == 0 {
        sections = 2;
    }
    if !all && (sections & 1 != 0 && !table.header || sections & 4 != 0 && !table.totals) {
        return error();
    }
    let mut spans = Vec::new();
    if sections & 1 != 0 && table.header {
        spans.push((table.area[0], table.area[0]));
    }
    if sections & 2 != 0
        && let Some(bottom) = bottom.filter(|b| *b >= top)
    {
        spans.push((top, bottom));
    }
    if sections & 4 != 0 && table.totals {
        spans.push((table.area[2], table.area[2]));
    }
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (top, bottom) in spans {
        if let Some(last) = merged.last_mut()
            && last.1 + 1 == top
        {
            last.1 = bottom;
        } else {
            merged.push((top, bottom));
        }
    }
    let mut expressions = merged.into_iter().map(|(a, b)| make(a, b, false));
    let Some(first) = expressions.next() else {
        return error();
    };
    expressions.fold(first, |left, right| {
        Expr::Binary("~", Box::new(left), Box::new(right))
    })
}

/// Names are readable formula tokens; callers supply stable-identity mappings.
pub struct TableReferenceMap<'a> {
    pub name: &'a str,
    pub replacement: Option<&'a str>,
    pub columns: Vec<(&'a str, Option<&'a str>)>,
    pub local: bool,
}

fn visit_references<'a>(
    source: &'a str,
    work: &mut usize,
    mut visit: impl FnMut(usize, usize, &'a str, Option<Token<'a>>, &mut usize) -> Option<()>,
) -> Option<()> {
    *work = work.checked_sub(source.len().checked_mul(4)?.checked_add(64)?)?;
    let locals = super::let_bindings::lexical_tokens(source, work)?.0;
    let mut index = 0;
    while index < source.len() {
        let c = source[index..].chars().next()?;
        if c == '#'
            && let Some(error) = super::LITERAL_ERRORS.iter().copied().find(|error| {
                source[index..]
                    .get(..error.len())
                    .is_some_and(|s| s.eq_ignore_ascii_case(error))
            })
        {
            index += error.len();
            continue;
        }
        if matches!(c, '\'' | '"') {
            index += c.len_utf8();
            while index < source.len() {
                let next = source[index..].chars().next()?;
                index += next.len_utf8();
                if next == c {
                    if source[index..].starts_with(c) {
                        index += c.len_utf8();
                    } else {
                        break;
                    }
                }
            }
            continue;
        }
        let token = token(&source[index..]);
        if let Some(token) = &token {
            let tail = &source[index + token.end..];
            if token.name.is_empty()
                && tail
                    .split([
                        '+', '-', '*', '/', '^', '&', '=', '<', '>', '%', ',', ';', '(', ')', '{',
                        '}',
                    ])
                    .next()
                    .is_some_and(|s| s.contains('!'))
            {
                // An external-workbook qualifier owns the following reference.
                index += token.end;
                let mut brackets = 0usize;
                let mut quote = false;
                while index < source.len() {
                    let next = source[index..].chars().next()?;
                    if next == '\'' && brackets > 0 {
                        index += next.len_utf8();
                        if let Some(escaped) = source[index..]
                            .chars()
                            .next()
                            .filter(|c| matches!(c, '[' | ']' | '#' | '@' | '\''))
                        {
                            index += escaped.len_utf8();
                        }
                        continue;
                    }
                    if next == '\'' {
                        quote = !quote;
                    }
                    if !quote {
                        if next == '[' {
                            brackets += 1;
                        }
                        if next == ']' {
                            brackets = brackets.saturating_sub(1);
                        }
                        if brackets == 0
                            && matches!(
                                next,
                                '+' | '-'
                                    | '*'
                                    | '/'
                                    | '^'
                                    | '&'
                                    | '='
                                    | '<'
                                    | '>'
                                    | '%'
                                    | ','
                                    | ';'
                                    | '('
                                    | ')'
                                    | '{'
                                    | '}'
                            )
                        {
                            break;
                        }
                    }
                    index += next.len_utf8();
                }
                continue;
            }
        }
        let end = token.as_ref().map_or_else(
            || {
                source[index..]
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '\\'))
                    .map(char::len_utf8)
                    .sum()
            },
            |t| t.end,
        );
        if end == 0 {
            index += c.len_utf8();
            continue;
        }
        let name = token
            .as_ref()
            .map_or(&source[index..index + end], |t| t.name);
        let tail = source[index + end..].trim_ascii_start();
        let local = locals
            .partition_point(|(start, _)| *start <= index)
            .checked_sub(1)
            .is_some_and(|i| index < locals[i].0 + locals[i].1);
        if !tail.starts_with(['!', '(']) && !local {
            visit(index, end, name, token, work)?;
        }
        index += end;
    }
    Some(())
}

pub(in crate::commands) fn qualify_columns(
    source: &str,
    table: &str,
    work: &mut usize,
) -> Option<String> {
    let mut starts = Vec::new();
    visit_references(source, work, |start, length, name, token, work| {
        let qualifier = source[start + length..]
            .trim_start()
            .chars()
            .next()
            .is_some_and(|c| c.is_alphanumeric() || matches!(c, '_' | '\\' | '\''));
        if name.is_empty() && token.is_some_and(|t| t.valid) && !qualifier {
            *work = work.checked_sub(table.len() + 16)?;
            starts.push(start);
        }
        Some(())
    })?;
    *work = work.checked_sub(source.len())?;
    let mut output = String::new();
    let mut previous = 0;
    for start in starts {
        output.push_str(&source[previous..start]);
        output.push_str(table);
        previous = start;
    }
    output.push_str(&source[previous..]);
    Some(output)
}

pub fn map_table_references(
    source: &str,
    mappings: &[TableReferenceMap<'_>],
    work: &mut usize,
) -> Option<(String, Vec<(usize, Vec<usize>)>)> {
    use std::collections::{BTreeMap, BTreeSet};
    let mut used = BTreeMap::<usize, BTreeSet<usize>>::new();
    let mut replacements = Vec::new();
    visit_references(source, work, |index, end, name, token, work| {
        *work = work.checked_sub(mappings.len().checked_mul(name.len() + 16)?)?;
        let mapping = mappings.iter().enumerate().find(|(_, m)| {
            if name.is_empty() {
                m.local
            } else {
                case_fold::same_name(m.name, name)
            }
        });
        if let Some((table, mapping)) = mapping
            && token.as_ref().is_none_or(|t| t.valid)
        {
            let columns = used.entry(table).or_default();
            let mut changes = Vec::new();
            let mut deleted = mapping.replacement.is_none();
            if let Some(token) = token {
                for (span, part) in token.parts {
                    let (prefix, raw) = part.strip_prefix('@').map_or(("", part), |s| ("@", s));
                    if raw.is_empty() || raw.starts_with('#') {
                        continue;
                    }
                    let column_name = unescape(raw);
                    *work = work
                        .checked_sub(mapping.columns.len().checked_mul(column_name.len() + 16)?)?;
                    if let Some((column, (_, to))) = mapping
                        .columns
                        .iter()
                        .enumerate()
                        .find(|(_, (from, _))| case_fold::same_name(from, &column_name))
                    {
                        columns.insert(column);
                        if let Some(to) = to {
                            *work = work.checked_sub(to.len().checked_mul(2)?.checked_add(64)?)?;
                            let mut text = prefix.to_owned();
                            for c in to.chars() {
                                if matches!(c, '[' | ']' | '#' | '@' | '\'') {
                                    text.push('\'');
                                }
                                text.push(c);
                            }
                            if text != part {
                                changes.push((index + span.start..index + span.end, text));
                            }
                        } else {
                            deleted = true;
                        }
                    }
                }
            }
            if deleted {
                replacements.push((index..index + end, "#REF!".into()));
            } else {
                let to = mapping.replacement?;
                if !name.is_empty() && name != to {
                    *work = work.checked_sub(to.len() + 64)?;
                    replacements.push((index..index + name.len(), to.to_owned()));
                }
                replacements.extend(changes);
            }
        }
        Some(())
    })?;
    let mut output = String::new();
    let mut start = 0;
    for (span, replacement) in replacements {
        output.push_str(&source[start..span.start]);
        output.push_str(&replacement);
        start = span.end;
    }
    output.push_str(&source[start..]);
    Some((
        output,
        used.into_iter()
            .map(|(i, columns)| (i, columns.into_iter().collect()))
            .collect(),
    ))
}

pub(in crate::commands::spreadsheet) fn rewrite_columns(
    source: &str,
    table: &Table,
    position: (usize, usize, usize),
    mapping: &[(String, String)],
    work: &mut usize,
) -> Option<String> {
    let local = table.sheet == position.0
        && (table.area[0]..=table.area[2]).contains(&position.1)
        && (table.area[1]..=table.area[3]).contains(&position.2);
    map_table_references(
        source,
        &[TableReferenceMap {
            name: &table.name,
            replacement: Some(&table.name),
            local,
            columns: mapping
                .iter()
                .map(|(from, to)| (from.as_str(), Some(to.as_str())))
                .collect(),
        }],
        work,
    )
    .map(|(formula, _)| formula)
}

/// Replace references to one table with ordinary Excel A1 references.
/// The structured-reference parser and resolver are shared with calculation.
pub fn table_to_range_references(
    source: &str,
    table: &Table,
    sheet_name: &str,
    position: (usize, usize, usize),
    qualify_sheet: bool,
    work: &mut usize,
) -> Option<String> {
    fn render(expr: Expr, row: usize, sheet: Option<&str>) -> Option<String> {
        Some(match expr {
            Expr::Ref(reference) => reference.table_a1(row, sheet),
            Expr::Range(first, last) => format!(
                "{}:{}",
                first.table_a1(row, sheet),
                last.table_a1(row, None)
            ),
            Expr::Binary("~", first, last) => format!(
                "({},{})",
                render(*first, row, sheet)?,
                render(*last, row, sheet)?
            ),
            Expr::Value(Value::Error(error)) => error.into(),
            _ => return None,
        })
    }
    let local = table.sheet == position.0
        && (table.area[0]..=table.area[2]).contains(&position.1)
        && (table.area[1]..=table.area[3]).contains(&position.2);
    let mut replacements = Vec::new();
    visit_references(source, work, |start, length, name, token, work| {
        if !(if name.is_empty() {
            local
        } else {
            case_fold::same_name(name, &table.name)
        }) {
            return Some(());
        }
        *work = work.checked_sub(table.columns.iter().map(|c| c.len() + 32).sum::<usize>())?;
        let expr = match token {
            Some(token) if token.valid => resolve(
                table,
                &token.parts,
                token.this_row,
                token.range,
                (position.0, position.1 as i64, position.2 as i64),
            ),
            Some(_) => Expr::Value(Value::Error("#REF!")),
            None => resolve(
                table,
                &[],
                false,
                false,
                (position.0, position.1 as i64, position.2 as i64),
            ),
        };
        let replacement = render(
            expr,
            position.1,
            (qualify_sheet || table.sheet != position.0).then_some(sheet_name),
        )?;
        *work = work.checked_sub(replacement.len() + 64)?;
        replacements.push((start..start + length, replacement));
        Some(())
    })?;
    let mut result = String::new();
    let mut start = 0;
    for (span, replacement) in replacements {
        result.push_str(&source[start..span.start]);
        result.push_str(&replacement);
        start = span.end;
    }
    result.push_str(&source[start..]);
    Some(result)
}

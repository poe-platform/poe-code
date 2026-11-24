use super::{Expr, Parser};

impl Expr {
    // Calc's intersection parser recognizes references, names and these two
    // reference-returning functions.
    pub(super) fn range_result(&self) -> bool {
        match self {
            Self::Ref(_) | Self::Range(..) | Self::Name(_) | Self::Local(_) | Self::Invoke(..) => {
                true
            }
            Self::Group(child) => child.range_result(),
            Self::Binary(";", _, right) => right.range_result(),
            Self::Binary(":" | "!" | "~" | "~;", ..) => true,
            Self::Call(name, _) => matches!(name.as_str(), "INDIRECT" | "OFFSET" | "LET"),
            _ => false,
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(super) enum SeparatorToken {
    Reference,
    RangeResult,
    UnionSeparator,
    Value,
}

impl<'a, S> Parser<'a, S>
where
    S: Iterator<Item = &'a str> + Clone,
{
    // Names are compiled where their token occurs, before later caller errors.
    pub(super) fn name_error(&mut self, index: usize) -> Option<Option<&'static str>> {
        if self.name_stack.contains(&index) {
            return Some(Some("Err:514"));
        }
        if self.name_stack.len() >= 96 {
            self.limited = true;
            return None;
        }
        let name = &self.names[index];
        let source = name
            .compiled
            .as_ref()
            .map(|c| c.expression.as_str())
            .or(name.openformula.as_deref())
            .unwrap_or(&name.expression);
        self.nodes = self
            .nodes
            .checked_sub(source.len().div_ceil(std::mem::size_of::<Expr>()) + 1)
            .or_else(|| {
                self.limited = true;
                None
            })?;
        let odf = source.starts_with("of:=");
        let xlsx = source.starts_with("msoxl:=");
        let source = source
            .strip_prefix("of:=")
            .or_else(|| source.strip_prefix("msoxl:="))
            .unwrap_or(source);
        let source = source.strip_prefix('=').unwrap_or(source);
        let mut child = Parser {
            source,
            nodes: self.nodes,
            limited: false,
            error: None,
            raw_tail: false,
            editor: self.editor,
            arrays: 0,
            uninterned_arrays: false,
            sheets: self.sheets.clone(),
            names: self.names,
            tables: self.tables,
            bindings: name.compiled.as_ref().map(|c| &c.bindings),
            operators: Vec::new(),
            name_stack: std::mem::take(&mut self.name_stack),
            locals: Vec::new(),
            lambda_depth: 0,
            local_tokens: None,
            name_tokens: None,
            export_names: None,
            position: name.position,
            scope: name.sheet,
            odf,
            xlsx,
            csv: false,
            r1c1: false,
            sizes: self.sizes,
        };
        child.name_stack.push(index);
        let expression = child.expression(0, 0, false);
        child.space();
        if child.xlsx
            && (child.source.starts_with(';') || expression.is_some() && !child.source.is_empty())
        {
            child
                .error
                .get_or_insert(if child.source.starts_with([')', '}', ';']) {
                    "Err:508"
                } else {
                    "Err:509"
                });
        }
        self.nodes = child.nodes;
        self.limited |= child.limited;
        child.name_stack.pop();
        self.name_stack = child.name_stack;
        if self.limited {
            None
        } else {
            Some(child.error)
        }
    }

    // Calc tests the last two emitted RPN tokens, which can both belong to
    // the right operand. Names expand in place; grouping and unary + emit none.
    pub(super) fn separator_tokens(
        &mut self,
        expression: &Expr,
        tokens: &mut Vec<SeparatorToken>,
        depth: usize,
    ) -> Option<bool> {
        if depth > 96 || self.nodes == 0 {
            self.limited = true;
            return None;
        }
        self.nodes -= 1;
        let mut valid = true;
        let token = match expression {
            Expr::Ref(_) | Expr::Range(..) | Expr::Local(_) => SeparatorToken::Reference,
            Expr::Name(index) => {
                if self.name_stack.contains(index) {
                    tokens.push(SeparatorToken::Value);
                    return Some(false);
                }
                let name = &self.names[*index];
                let source = name
                    .compiled
                    .as_ref()
                    .map(|c| c.expression.as_str())
                    .or(name.openformula.as_deref())
                    .unwrap_or(&name.expression);
                self.nodes = self
                    .nodes
                    .checked_sub(source.len().div_ceil(std::mem::size_of::<Expr>()))
                    .or_else(|| {
                        self.limited = true;
                        None
                    })?;
                let odf = source.starts_with("of:=");
                let xlsx = source.starts_with("msoxl:=");
                let source = source
                    .strip_prefix("of:=")
                    .or_else(|| source.strip_prefix("msoxl:="))
                    .unwrap_or(source);
                let source = source.strip_prefix('=').unwrap_or(source);
                let mut child = Parser {
                    source,
                    nodes: self.nodes,
                    limited: false,
                    error: None,
                    raw_tail: false,
                    editor: self.editor,
                    arrays: 0,
                    uninterned_arrays: false,
                    sheets: self.sheets.clone(),
                    names: self.names,
                    tables: self.tables,
                    bindings: name.compiled.as_ref().map(|c| &c.bindings),
                    operators: Vec::new(),
                    name_stack: std::mem::take(&mut self.name_stack),
                    locals: Vec::new(),
                    lambda_depth: 0,
                    local_tokens: None,
                    name_tokens: None,
                    export_names: None,
                    position: name.position,
                    scope: name.sheet,
                    odf,
                    xlsx,
                    csv: false,
                    r1c1: false,
                    sizes: self.sizes,
                };
                child.name_stack.push(*index);
                let parsed = child.expression(0, depth + 1, false);
                let result = if let Some(parsed) = parsed.filter(|_| child.error.is_none()) {
                    child.separator_tokens(&parsed, tokens, depth + 1)
                } else {
                    tokens.push(SeparatorToken::Value);
                    Some(true)
                };
                self.nodes = child.nodes;
                self.limited |= child.limited;
                child.name_stack.pop();
                self.name_stack = child.name_stack;
                return if self.limited { None } else { result };
            }
            Expr::Group(child) | Expr::Unary(b'+', child) => {
                return self.separator_tokens(child, tokens, depth + 1);
            }
            Expr::Unary(_, child) => {
                valid &= self.separator_tokens(child, tokens, depth + 1)?;
                SeparatorToken::Value
            }
            Expr::Invoke(callee, args) => {
                valid &= self.separator_tokens(callee, tokens, depth + 1)?;
                for arg in args {
                    valid &= self.separator_tokens(arg, tokens, depth + 1)?;
                }
                SeparatorToken::RangeResult
            }
            Expr::Call(name, args) => {
                for arg in args {
                    valid &= self.separator_tokens(arg, tokens, depth + 1)?;
                }
                if matches!(name.as_str(), "INDIRECT" | "OFFSET" | "LET") {
                    SeparatorToken::RangeResult
                } else {
                    SeparatorToken::Value
                }
            }
            Expr::Binary(..) => {
                let mut pending = Vec::new();
                let mut base = expression;
                while let Expr::Binary(op, left, right) = base {
                    if self.nodes == 0 {
                        self.limited = true;
                        return None;
                    }
                    self.nodes -= 1;
                    pending.push((op, right.as_ref()));
                    base = left;
                }
                valid &= self.separator_tokens(base, tokens, depth + 1)?;
                for (op, right) in pending.into_iter().rev() {
                    let left_end = tokens.len();
                    valid &= self.separator_tokens(right, tokens, depth + 1)?;
                    if *op == ":"
                        && tokens.len() == left_end + 1
                        && tokens.ends_with(&[SeparatorToken::Reference; 2])
                    {
                        tokens.pop();
                        continue;
                    }
                    tokens.push(match *op {
                        ";" => continue,
                        "~;" => SeparatorToken::UnionSeparator,
                        ":" | "!" | "~" => SeparatorToken::RangeResult,
                        _ => SeparatorToken::Value,
                    });
                }
                return Some(valid);
            }
            _ => SeparatorToken::Value,
        };
        tokens.push(token);
        Some(valid)
    }
}

// XLSX export walks a separate grammar to register referenced names. Its
// reference operators cannot consume an ungrouped unary operand, and a postfix
// percentage ends the reference term. Keep names visited before a parse failure.
pub(in crate::commands) fn xlsx_export_names<'a>(
    source: &'a str,
    sheets: impl Iterator<Item = &'a str> + Clone,
    names: &'a [crate::commands::spreadsheet::model::NamedExpression],
    scope: Option<usize>,
    bindings: Option<&'a std::collections::BTreeMap<String, Option<usize>>>,
    work: &mut usize,
) -> Option<Vec<usize>> {
    if names.is_empty() {
        return Some(Vec::new());
    }
    let legacy = source.starts_with("oooc:=");
    let source = source.strip_prefix("oooc:=").unwrap_or(source);
    let nodes = (*work / std::mem::size_of::<Expr>()).min(8192);
    let mut parser = Parser {
        source: source.strip_prefix('=').unwrap_or(source),
        nodes,
        limited: false,
        error: None,
        raw_tail: false,
        editor: false,
        arrays: 0,
        uninterned_arrays: false,
        sheets,
        names,
        tables: &[],
        bindings,
        operators: Vec::new(),
        name_stack: Vec::new(),
        locals: Vec::new(),
        lambda_depth: 0,
        local_tokens: None,
        name_tokens: None,
        export_names: Some(Vec::new()),
        position: (scope.unwrap_or(0), 0, 0),
        scope,
        odf: legacy,
        xlsx: !legacy,
        csv: false,
        r1c1: false,
        sizes: &[],
    };
    parser.expression(0, 0, false);
    *work = work.checked_sub((nodes - parser.nodes) * std::mem::size_of::<Expr>())?;
    if parser.limited {
        None
    } else {
        parser.export_names
    }
}

pub(in crate::commands) fn xlsx_operators<'a>(
    source: &'a str,
    sheets: impl Iterator<Item = &'a str> + Clone,
    names: &'a [crate::commands::spreadsheet::model::NamedExpression],
    scope: Option<usize>,
    work: &mut usize,
) -> Option<Vec<(usize, usize, char)>> {
    let mut previous = None::<char>;
    let mut quote = None;
    let mut groups = false;
    for c in source.chars() {
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
        } else if matches!(c, '\'' | '"') {
            quote = Some(c);
        } else if c == '('
            && previous.is_none_or(|c| !c.is_alphanumeric() && !matches!(c, '_' | '.' | '$' | '\''))
        {
            groups = true;
        }
        if !c.is_whitespace() {
            previous = Some(c);
        }
    }
    if !source.contains(' ') && !groups && (names.is_empty() || !source.contains('(')) {
        return Some(Vec::new());
    }
    let nodes = (*work / std::mem::size_of::<Expr>()).min(8192);
    let mut parser = Parser {
        source,
        nodes,
        limited: false,
        error: None,
        raw_tail: false,
        editor: false,
        arrays: 0,
        uninterned_arrays: false,
        sheets,
        names,
        tables: &[],
        bindings: None,
        operators: Vec::new(),
        name_stack: Vec::new(),
        locals: Vec::new(),
        lambda_depth: 0,
        local_tokens: None,
        name_tokens: None,
        export_names: None,
        position: (scope.unwrap_or(0), 0, 0),
        scope,
        odf: false,
        xlsx: true,
        csv: false,
        r1c1: false,
        sizes: &[],
    };
    let expression = parser.expression(0, 0, false);
    if parser.limited {
        return None;
    }
    *work = work.checked_sub(
        (nodes - parser.nodes) * std::mem::size_of::<Expr>()
            + parser.operators.len() * std::mem::size_of::<(usize, usize, char)>(),
    )?;
    if matches!(expression, Some(Expr::Binary(",", ..)))
        && let Some(index) = separator(source, ',')
    {
        parser.operators.retain(|op| op.0 > source.len() - index);
    }
    // A name compiler stops at a top-level separator. If its final argument
    // still contains an uncompiled intersection, compiling a caller can pop
    // back to the caller's token array before replacing that whitespace token.
    // Match Calc's token-index replacement, including its exported spelling.
    let mut pending = if !names.is_empty() && parser.error.is_none() {
        expression.iter().collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let mut visited = std::collections::BTreeSet::new();
    while let Some(expr) = pending.pop() {
        *work = work.checked_sub(std::mem::size_of::<&Expr>() * 2 + 1)?;
        match expr {
            Expr::Name(index) if visited.insert(*index) => {
                let name = &names[*index];
                let code = name.openformula.as_deref().unwrap_or(&name.expression);
                let code = code.strip_prefix("msoxl:=").unwrap_or(code);
                *work = work.checked_sub(code.len() * 2 + 128)?;
                if !code.contains(',') || !code.contains(' ') {
                    continue;
                }
                let mut child = Parser {
                    source: code,
                    nodes: (*work / std::mem::size_of::<Expr>()).min(8192),
                    limited: false,
                    error: None,
                    raw_tail: false,
                    editor: false,
                    arrays: 0,
                    uninterned_arrays: false,
                    sheets: parser.sheets.clone(),
                    names: parser.names,
                    tables: parser.tables,
                    bindings: None,
                    operators: Vec::new(),
                    name_stack: Vec::new(),
                    locals: Vec::new(),
                    lambda_depth: 0,
                    local_tokens: None,
                    name_tokens: None,
                    export_names: None,
                    position: name.position,
                    scope: name.sheet,
                    odf: false,
                    xlsx: true,
                    csv: false,
                    r1c1: false,
                    sizes: &[],
                };
                let before = child.nodes;
                let expanded = child.expression(0, 0, false);
                if child.limited {
                    return None;
                }
                *work = work.checked_sub((before - child.nodes) * std::mem::size_of::<Expr>())?;
                if let Some(Expr::Binary(",", _, tail)) = &expanded
                    && matches!(tail.as_ref(), Expr::Binary("!", ..))
                    && let Some(&(remaining, _, '!')) = child.operators.last()
                {
                    let name_tokens = tokens(code, parser.sheets.clone(), work)?;
                    if let Some(index) = name_tokens
                        .iter()
                        .position(|&(start, _)| start == remaining)
                        && let Some(&(start, length)) =
                            tokens(source, parser.sheets.clone(), work)?.get(index)
                    {
                        parser.operators.push((start, length, '!'));
                    }
                }
            }
            Expr::Group(child) | Expr::Unary(_, child) => pending.push(child),
            Expr::Binary(";", a, _) => pending.push(a),
            Expr::Binary(_, a, b) => {
                pending.push(b);
                pending.push(a);
            }
            Expr::Lambda(_, body) => pending.push(body),
            Expr::Invoke(callee, args) => {
                pending.extend(args.iter().rev());
                pending.push(callee);
            }
            Expr::Call(_, args) => pending.extend(args.iter().rev()),
            _ => {}
        }
    }
    parser.operators.sort_unstable_by_key(|op| op.0);
    parser.operators.dedup_by_key(|op| op.0);
    Some(parser.operators)
}

fn tokens<'a>(
    source: &str,
    sheets: impl Iterator<Item = &'a str> + Clone,
    work: &mut usize,
) -> Option<Vec<(usize, usize)>> {
    let mut rest = source;
    let mut tokens = Vec::new();
    while let Some(first) = rest.chars().next() {
        *work = work.checked_sub(std::mem::size_of::<(usize, usize)>() + 1)?;
        let length =
            if let Some(reference) = super::super::xlsx_references::parse(rest, sheets.clone()) {
                reference.end
            } else if matches!(first, '\'' | '"') {
                let mut end = 1;
                loop {
                    let Some(next) = rest[end..].find(first) else {
                        end = rest.len();
                        break;
                    };
                    end += next + 1;
                    if rest[end..].starts_with(first) {
                        end += 1;
                    } else {
                        break;
                    }
                }
                end
            } else if first.is_whitespace() {
                rest.chars()
                    .take_while(|&c| c == first)
                    .map(char::len_utf8)
                    .sum()
            } else if first.is_alphanumeric() || matches!(first, '_' | '.' | '$') {
                rest.chars()
                    .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '$'))
                    .map(char::len_utf8)
                    .sum()
            } else {
                first.len_utf8()
            };
        *work = work.checked_sub(length)?;
        tokens.push((rest.len(), length));
        rest = &rest[length..];
    }
    Some(tokens)
}

pub(super) fn separator(source: &str, delimiter: char) -> Option<usize> {
    let mut depth = 0usize;
    let mut quote = None;
    for (i, c) in source.char_indices() {
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
        } else {
            match c {
                '\'' | '"' => quote = Some(c),
                '(' | '{' => depth += 1,
                ')' | '}' => depth = depth.saturating_sub(1),
                c if c == delimiter && depth == 0 => return Some(i),
                _ => {}
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::spreadsheet::model::NamedExpression;
    use std::collections::BTreeMap;

    #[test]
    fn legacy_export_keeps_compiled_bindings_before_a_parse_failure() {
        let names = [None, Some(0)].map(|sheet| NamedExpression {
            name: "Shared".into(),
            sheet,
            expression: "5".into(),
            openformula: None,
            position: (0, 0, 0),
            compiled: None,
        });
        let bindings = BTreeMap::from([("shared".into(), Some(0)), ("later".into(), Some(1))]);
        for (source, expected) in [
            ("oooc:=SUM(shared,later)", vec![0]),
            ("oooc:=SUM(1,shared)", vec![]),
            ("oooc:=SUM(shared+later)", vec![0, 1]),
            ("oooc:=Second!shared", vec![0]),
            ("oooc:=SUM(shared+UNKNOWN(later))", vec![0]),
            ("oooc:=SUM({shared,1},later)", vec![]),
        ] {
            let mut work = 1_000_000;
            assert_eq!(
                xlsx_export_names(
                    source,
                    ["First"].into_iter(),
                    &names,
                    Some(0),
                    Some(&bindings),
                    &mut work,
                ),
                Some(expected),
                "{source}",
            );
            assert!(work < 1_000_000);
        }
        assert!(
            xlsx_export_names(
                "oooc:=SUM(shared+later)",
                ["First"].into_iter(),
                &names,
                Some(0),
                Some(&bindings),
                &mut 0,
            )
            .is_none()
        );
    }
}

// Calculation and SpreadsheetML have different reference and operator syntax.
// Parse expressions before rendering so quoting and grouping survive conversion.
use crate::commands::spreadsheet::{collation, formulas::Value, function_names, number_format};
#[derive(Clone, Copy, PartialEq)]
enum Syntax<'a> {
    Excel,
    #[allow(dead_code)] // Retain the original Calc export-rendering branches.
    Xlsx(&'a [String], &'a std::collections::BTreeMap<String, String>),
    Calculation,
    CompiledCalculation,
    Calc,
}
#[derive(Clone)]
enum Expr {
    Omitted,
    // A required empty argument retained after Microsoft optional-argument trimming.
    OmittedZero,
    Literal(String),
    Name(String),
    Bad(String),
    Number(f64, bool),
    Array(Vec<Vec<Expr>>),
    Reference {
        excel: String,
        odf: String,
        foreign: bool,
    },
    // Keep the legacy ISOWEEKNUM method in lexical tokens, but omit it on export.
    Call(String, Vec<Expr>, bool),
    Group(Box<Expr>),
    Spaced(String, Box<Expr>, String),
    Unary(char, Box<Expr>),
    Binary(String, Box<Expr>, Box<Expr>),
}
#[derive(Clone, Copy, PartialEq)]
enum SeparatorToken {
    Reference,
    RangeResult,
    UnionSeparator,
    Value,
}
struct SeparatorCompiler<'a> {
    names: &'a [crate::commands::spreadsheet::model::NamedExpression],
    sheets: &'a [String],
    visiting: Vec<usize>,
    tokens: Vec<SeparatorToken>,
    failed: bool,
    stopped: bool,
    error: Option<&'static str>,
    work: &'a mut usize,
}
impl SeparatorCompiler<'_> {
    fn compile(
        &mut self,
        expression: &mut Expr,
        sheet: usize,
        bindings: Option<&std::collections::BTreeMap<String, Option<usize>>>,
        nested: bool,
        depth: usize,
    ) -> Result<(), &'static str> {
        if self.stopped {
            return Ok(());
        }
        if depth > 128 {
            return Err(super::LIMIT);
        }
        *self.work = self
            .work
            .checked_sub(std::mem::size_of::<Expr>())
            .ok_or(super::LIMIT)?;
        let token = match expression {
            Expr::Reference { .. } => SeparatorToken::Reference,
            Expr::Name(raw) => {
                let selected = if let Some(index) = bindings.and_then(|b| b.get(raw)) {
                    *index
                } else {
                    *self.work = self
                        .work
                        .checked_sub(self.names.iter().map(|n| n.name.len() * 4 + 32).sum())
                        .ok_or(super::LIMIT)?;
                    lookup_name(raw, true, sheet, self.sheets, self.work, |key| {
                        let key_name = crate::commands::spreadsheet::case_fold::fold(&key.1);
                        self.names.iter().position(|n| {
                            n.sheet == key.0
                                && crate::commands::spreadsheet::case_fold::fold(&n.name)
                                    == key_name
                        })
                    })?
                    .map(|(_, i)| i)
                };
                if selected.is_some_and(|i| self.visiting.contains(&i)) {
                    self.failed = true;
                }
                if let Some(index) = selected.filter(|i| !self.visiting.contains(i)) {
                    let name = &self.names[index];
                    let source = name
                        .compiled
                        .as_ref()
                        .map(|c| c.expression.as_str())
                        .or(name.openformula.as_deref())
                        .unwrap_or(&name.expression);
                    *self.work = self
                        .work
                        .checked_sub(source.len() * 4 + 128)
                        .ok_or(super::LIMIT)?;
                    if let Some(error) = source.strip_prefix("of:=").and_then(|source| {
                        [
                            "Err:501", "Err:502", "Err:504", "Err:508", "Err:509", "Err:510",
                            "Err:511", "Err:520", "Err:539",
                        ]
                        .into_iter()
                        .find(|error| *error == source)
                    }) {
                        self.error = Some(if error == "Err:520" && nested {
                            "Err:511"
                        } else {
                            error
                        });
                        self.stopped = true;
                        return Ok(());
                    }
                    let source = if source.starts_with("of:=") {
                        source.to_owned()
                    } else {
                        format!(
                            "{{http://schemas.microsoft.com/office/excel/formula}}={}",
                            source.strip_prefix("msoxl:=").unwrap_or(source)
                        )
                    };
                    let mut parsed = convert(&source, false, *self.work, true)?.unwrap();
                    if let Some(error) = parsed.error {
                        self.error = Some(if error == "Err:520" && nested {
                            "Err:511"
                        } else {
                            error
                        });
                        self.stopped = true;
                        return Ok(());
                    }
                    if let Some(expression) = parsed.expression.as_mut() {
                        self.visiting.push(index);
                        self.compile(
                            expression,
                            name.position.0,
                            name.compiled.as_ref().map(|c| &c.bindings),
                            nested,
                            depth + 1,
                        )?;
                        self.visiting.pop();
                        return Ok(());
                    }
                }
                SeparatorToken::Value
            }
            Expr::Spaced(_, child, _) => {
                return self.compile(child, sheet, bindings, nested, depth + 1);
            }
            Expr::Group(child) | Expr::Unary('+', child) => {
                return self.compile(child, sheet, bindings, true, depth + 1);
            }
            Expr::Unary(_, child) => {
                self.compile(child, sheet, bindings, true, depth + 1)?;
                SeparatorToken::Value
            }
            Expr::Call(name, args, _) => {
                if function_names::name(name, false).is_none()
                    && crate::commands::spreadsheet::coordinate(name).is_some()
                {
                    self.error = Some("Err:509");
                    self.stopped = true;
                    return Ok(());
                }
                for arg in args {
                    self.compile(arg, sheet, bindings, true, depth + 1)?;
                }
                if matches!(name.as_str(), "INDIRECT" | "OFFSET") {
                    SeparatorToken::RangeResult
                } else {
                    SeparatorToken::Value
                }
            }
            Expr::Binary(..) => {
                let mut pending = Vec::new();
                let mut base = expression;
                while let Expr::Binary(op, left, right) = base {
                    *self.work = self
                        .work
                        .checked_sub(std::mem::size_of::<(&mut String, &mut Expr)>())
                        .ok_or(super::LIMIT)?;
                    pending.push((op, right.as_mut()));
                    base = left;
                }
                self.compile(base, sheet, bindings, true, depth + 1)?;
                for (op, right) in pending.into_iter().rev() {
                    if self.stopped {
                        return Ok(());
                    }
                    if matches!(op.as_str(), "~?" | ";" | "") || op == "," && !nested {
                        // A pending separator can use the reference emitted
                        // before the external grammar reaches an invalid operator.
                        self.stopped = true;
                        return Ok(());
                    }
                    let left_end = self.tokens.len();
                    self.compile(right, sheet, bindings, true, depth + 1)?;
                    let pair = self.tokens.len().checked_sub(2).map(|i| &self.tokens[i..]);
                    if op == ":"
                        && self.tokens.len() == left_end + 1
                        && pair == Some([SeparatorToken::Reference; 2].as_slice())
                    {
                        // Adjacent range endpoints collapse into one RPN reference.
                        self.tokens.pop();
                        continue;
                    }
                    let token = if op == "," {
                        if self.failed
                            || !pair.is_some_and(|p| {
                                p[0] != SeparatorToken::Value
                                    && matches!(
                                        p[1],
                                        SeparatorToken::Reference | SeparatorToken::RangeResult
                                    )
                            })
                        {
                            continue;
                        }
                        *op = "~;".into();
                        // A converted separator keeps its token type: it may
                        // precede another separator, but cannot be its right operand.
                        SeparatorToken::UnionSeparator
                    } else if matches!(op.as_str(), ":" | "!" | "~") {
                        SeparatorToken::RangeResult
                    } else {
                        SeparatorToken::Value
                    };
                    self.tokens.push(token);
                }
                return Ok(());
            }
            _ => SeparatorToken::Value,
        };
        if !self.stopped {
            self.tokens.push(token);
        }
        Ok(())
    }
}
impl Expr {
    fn adjacency_error(&self, work: &mut usize) -> Result<Option<&'static str>, &'static str> {
        let mut pending = vec![(self, false, false)];
        while let Some((value, nested, visit)) = pending.pop() {
            *work = work.checked_sub(32).ok_or(super::LIMIT)?;
            if visit {
                if let Expr::Binary(op, left, right) = value
                    && op.is_empty()
                {
                    let mut first = right.as_ref();
                    let mut previous = left.as_ref();
                    loop {
                        *work = work.checked_sub(16).ok_or(super::LIMIT)?;
                        match first {
                            Expr::Spaced(_, child, _) | Expr::Binary(_, child, _) => first = child,
                            _ => break,
                        }
                    }
                    while let Expr::Spaced(_, child, _) = previous {
                        previous = child;
                    }
                    return Ok(Some(
                        if nested
                            && (matches!(first, Expr::Bad(_))
                                || matches!(first, Expr::Name(_) | Expr::Group(_))
                                    && !matches!(
                                        previous,
                                        Expr::Number(..)
                                            | Expr::Reference { .. }
                                            | Expr::Literal(_)
                                    ))
                        {
                            "Err:508"
                        } else {
                            "Err:509"
                        },
                    ));
                }
                continue;
            }
            match value {
                Expr::Call(_, args, _) => {
                    pending.extend(args.iter().rev().map(|arg| (arg, true, false)))
                }
                Expr::Group(child) => pending.push((child, true, false)),
                Expr::Spaced(_, child, _) | Expr::Unary(_, child) => {
                    pending.push((child, nested, false))
                }
                Expr::Binary(_, a, b) => pending.extend([
                    (b.as_ref(), nested, false),
                    (value, nested, true),
                    (a.as_ref(), nested, false),
                ]),
                _ => {}
            }
        }
        Ok(None)
    }
    fn precedence(&self) -> u8 {
        match self {
            Self::Binary(op, ..) => precedence(op),
            Self::Unary('%', _) => 7,
            Self::Unary(..) => 6,
            Self::Spaced(_, e, _) => e.precedence(),
            _ => 11,
        }
    }
    fn foreign(&self) -> bool {
        match self {
            Self::Reference { foreign, .. } => *foreign,
            Self::Call(..) | Self::Bad(_) => true,
            Self::Name(s) => s.contains(['.', '!', '\'', '$']),
            Self::Number(n, _) => number_format::number(*n, true).parse::<f64>() != Ok(*n),
            Self::Array(rows) => rows.iter().flatten().any(Self::foreign),
            Self::Literal(s) => {
                s.contains(',') && s.as_bytes().first().is_some_and(u8::is_ascii_digit)
            }
            Self::Unary(_, e) | Self::Group(e) | Self::Spaced(_, e, _) => e.foreign(),
            Self::Binary(..) => {
                let mut base = self;
                while let Self::Binary(op, a, b) = base {
                    if matches!(op.as_str(), "~" | "~;" | "~?" | "!") || b.foreign() {
                        return true;
                    }
                    base = a;
                }
                base.foreign()
            }
            _ => false,
        }
    }
    fn render(&self, syntax: Syntax, remaining: &mut usize) -> Result<String, &'static str> {
        let odf = matches!(syntax, Syntax::Calculation | Syntax::CompiledCalculation);
        let out = match self {
            Self::Omitted => String::new(),
            Self::OmittedZero => {
                if odf {
                    "0".into()
                } else {
                    String::new()
                }
            }
            Self::Literal(s) => s.clone(),
            Self::Name(s) => {
                if let Syntax::Xlsx(_, changes) = syntax {
                    rename(s, changes, remaining)?
                } else if syntax == Syntax::Calc {
                    qualified(s, '!').map_or_else(
                        || s.clone(),
                        |(sheet, name)| {
                            let unquoted = sheet
                                .strip_prefix('\'')
                                .and_then(|s| s.strip_suffix('\''))
                                .map(|s| s.replace("''", "'"));
                            let sheet = unquoted.map_or_else(
                                || sheet.to_owned(),
                                |sheet| {
                                    crate::commands::spreadsheet::sheet_name::quote_sheet(&sheet)
                                },
                            );
                            format!("{sheet}.{name}")
                        },
                    )
                } else {
                    s.clone()
                }
            }
            Self::Bad(s) => {
                if odf {
                    // A quoted, invalid reference stays an error even when a
                    // declared name has the same spelling. CSV retains its token.
                    format!("['{}']", s.replace('\'', "''"))
                } else {
                    s.clone()
                }
            }
            Self::Number(n, percent) => {
                let mut value = if odf && n.is_finite() {
                    Value::Number(*n).cached()
                } else if *n == 0. && n.is_sign_negative() {
                    "-0".into()
                } else {
                    number_format::number(*n, true)
                };
                if *percent {
                    value.push('%');
                }
                value
            }
            Self::Array(rows) => format!(
                "{{{}}}",
                rows.iter()
                    .map(|row| row
                        .iter()
                        .map(|v| v.render(syntax, remaining))
                        .collect::<Result<Vec<_>, _>>()
                        .map(|v| v.join(if odf { ";" } else { "," })))
                    .collect::<Result<Vec<_>, _>>()?
                    .join(if odf { "|" } else { ";" })
            ),
            Self::Group(e) => format!("({})", e.render(syntax, remaining)?),
            Self::Spaced(before, e, after) => {
                format!("{before}{}{after}", e.render(syntax, remaining)?)
            }
            Self::Reference {
                excel, odf: source, ..
            } => {
                if odf {
                    format!("[{source}]")
                } else if let Syntax::Xlsx(sheets, changes) = syntax {
                    crate::commands::spreadsheet::xlsx_references::export(
                        &rename(excel, changes, remaining)?,
                        sheets,
                        remaining,
                    )?
                } else if syntax == Syntax::Calc {
                    let split = range_split(source);
                    let (first, last) = split.map_or((source.as_str(), None), |i| {
                        (&source[..i], Some(&source[i + 1..]))
                    });
                    let mut parts = Vec::new();
                    for raw in std::iter::once(first).chain(last) {
                        let Some(part) = endpoint(raw, '.') else {
                            parts.push(raw.into());
                            continue;
                        };
                        let mut text = String::new();
                        if let Some(sheet) = &part.sheet {
                            if !part.relative {
                                text.push('$');
                            }
                            text.push_str(&crate::commands::spreadsheet::sheet_name::quote_sheet(
                                sheet,
                            ));
                            text.push('.');
                        }
                        text.push_str(&part.cell);
                        parts.push(text);
                    }
                    parts.join(":")
                } else {
                    excel.clone()
                }
            }
            Self::Call(name, args, omit_method) => {
                let mut rendered = Vec::new();
                for a in args.iter().take(args.len() - usize::from(*omit_method)) {
                    rendered.push(a.render(syntax, remaining)?);
                }
                if syntax == Syntax::CompiledCalculation {
                    // ODF serialization fills optional arguments before Calc
                    // compares the previous cell's spelling with the new source.
                    match (name.as_str(), args.len()) {
                        ("NORMDIST" | "GAMMADIST", 3)
                        | ("LOGINV" | "LOGNORMDIST" | "POISSON", 2) => {
                            rendered.push("1".into());
                        }
                        ("LOGINV" | "LOGNORMDIST", 1) => {
                            rendered.extend(["0".into(), "1".into()]);
                        }
                        _ => {}
                    }
                }
                let name = match syntax {
                    Syntax::Calculation | Syntax::CompiledCalculation => {
                        function_names::openformula(name)
                    }
                    // The optional-argument rewriter distinguishes the old
                    // hypergeometric call before exporting its modern spelling.
                    Syntax::Excel | Syntax::Xlsx(..) if name == "HYPGEOMDIST" => name,
                    Syntax::Excel | Syntax::Xlsx(..) => {
                        function_names::name(name, true).unwrap_or(name)
                    }
                    Syntax::Calc => name,
                };
                format!("{name}({})", rendered.join(if odf { ";" } else { "," }))
            }
            Self::Unary('%', e) => format!("{}%", e.render(syntax, remaining)?),
            Self::Unary(op, e) => {
                let s = e.render(syntax, remaining)?;
                format!(
                    "{op}{}",
                    if syntax != Syntax::CompiledCalculation && e.precedence() < 6 {
                        format!("({s})")
                    } else {
                        s
                    }
                )
            }
            Self::Binary(..) => {
                let mut pending = Vec::new();
                let mut base = self;
                while let Self::Binary(op, a, b) = base {
                    *remaining = remaining
                        .checked_sub(std::mem::size_of::<(&str, &Expr, &Expr)>())
                        .ok_or(super::LIMIT)?;
                    pending.push((op.as_str(), a.as_ref(), b.as_ref()));
                    base = a;
                }
                let mut out = base.render(syntax, remaining)?;
                for (op, a, b) in pending.into_iter().rev() {
                    if syntax != Syntax::CompiledCalculation
                        && (a.precedence() < precedence(op)
                            && !matches!(a, Self::Binary(sep, ..) if sep == ",")
                            && !matches!(a, Self::Unary('+' | '%', _))
                            || op == "^" && matches!(a, Expr::Unary('+' | '-', _))
                            || odf && op == "!" && matches!(a, Expr::Name(_)))
                    {
                        *remaining = remaining.checked_sub(2).ok_or(super::LIMIT)?;
                        out.insert(0, '(');
                        out.push(')');
                    }
                    let right = b.render(syntax, remaining)?;
                    let wrap = syntax != Syntax::CompiledCalculation
                        && (b.precedence() < precedence(op)
                            && !matches!(b, Self::Unary('+' | '-', _))
                            || b.precedence() == precedence(op) && matches!(op, "-" | "/" | "^"));
                    let op = match (syntax, op) {
                        (Syntax::Calculation, "~;") => ";",
                        (_, "~;") => "~",
                        (_, "~?") => "~",
                        (Syntax::Excel | Syntax::Xlsx(..), "!") => " ",
                        (Syntax::Calculation | Syntax::CompiledCalculation, ",") => ";",
                        _ => op,
                    };
                    *remaining = remaining
                        .checked_sub(op.len() + if wrap { 2 } else { 0 })
                        .ok_or(super::LIMIT)?;
                    out.push_str(if matches!(op, "()" | "[]") { "" } else { op });
                    if op == "()" && odf {
                        out.push('(');
                    }
                    if wrap {
                        out.push('(');
                    }
                    out.push_str(&right);
                    if wrap {
                        out.push(')');
                    }
                    if op == "()" && odf {
                        out.push(')');
                    }
                    if op == ":"
                        && matches!((a, b), (Self::Reference { .. }, Self::Reference { .. }))
                        && let Syntax::Xlsx(sheets, _) = syntax
                    {
                        out = crate::commands::spreadsheet::xlsx_references::export(
                            &out, sheets, remaining,
                        )?;
                    }
                }
                out
            }
        };
        *remaining = remaining.checked_sub(out.len()).ok_or(super::LIMIT)?;
        Ok(out)
    }
}
fn precedence(op: &str) -> u8 {
    match op {
        "=" | "<>" | "<" | ">" | "<=" | ">=" => 1,
        "&" => 2,
        "+" | "-" => 3,
        "*" | "/" => 4,
        "^" => 5,
        "," | "~;" => 0,
        "~" | "~?" | ";" => 8,
        "" | "()" | "[]" => 10,
        "!" => 9,
        ":" => 10,
        _ => 0,
    }
}
struct Parser<'a> {
    source: &'a str,
    pos: usize,
    nodes: usize,
    limited: bool,
    work: usize,
    sheet_separator: char,
    legacy: bool,
    excel: bool,
    normalized: bool,
    arrays: usize,
    in_array: bool,
    has_bindings: bool,
    separators: bool,
    error: Option<&'static str>,
}
impl<'a> Parser<'a> {
    fn space(&mut self) {
        while self
            .source
            .as_bytes()
            .get(self.pos)
            .is_some_and(u8::is_ascii_whitespace)
        {
            self.pos += 1;
        }
    }
    fn take(&mut self, c: u8) -> bool {
        self.space();
        if self.source.as_bytes().get(self.pos) == Some(&c) {
            self.pos += 1;
            true
        } else {
            false
        }
    }
    fn expression(&mut self, min: u8, depth: usize, stop_separator: bool) -> Option<Expr> {
        if depth > 64 {
            return None;
        }
        if self.nodes == 0 {
            self.limited = true;
            return None;
        }
        self.nodes -= 1;
        self.space();
        let mut left = if self.take(b'+') {
            Expr::Unary(
                '+',
                Box::new(self.expression(6, depth + 1, stop_separator)?),
            )
        } else if self.take(b'-') {
            Expr::Unary(
                '-',
                Box::new(self.expression(6, depth + 1, stop_separator)?),
            )
        } else {
            self.atom(depth + 1)?
        };
        let mut postfix = 0;
        loop {
            self.space();
            if min <= 7 && self.take(b'%') {
                postfix += 1;
                if self.nodes == 0 || depth + postfix > 64 {
                    self.limited = true;
                    return None;
                }
                self.nodes -= 1;
                left = Expr::Unary('%', Box::new(left));
                continue;
            }
            let rest = &self.source[self.pos..];
            if stop_separator
                && (rest.starts_with(',')
                    || (!self.excel || self.arrays > 0) && rest.starts_with(';'))
            {
                break;
            }
            let op = [
                "<=", ">=", "<>", "+", "-", "*", "/", "^", "&", "=", "<", ">", "~", "!", ":", ",",
                ";",
            ]
            .into_iter()
            .find(|op| rest.starts_with(op));
            let adjacent = rest.as_bytes().first().is_some_and(|b| {
                b.is_ascii_alphanumeric()
                    || *b == b'.'
                    || self.excel && matches!(b, b'[' | b']' | b'\'' | b'(' | b'_' | b'$')
            });
            let Some(op) = op.or_else(|| adjacent.then_some("")) else {
                break;
            };
            if op == "," && !self.excel {
                return None;
            }
            let token = op;
            if self.excel && token == "~" {
                self.error
                    .get_or_insert(if stop_separator { "Err:508" } else { "Err:509" });
            }
            let op = if op == "~" && self.excel {
                "~?"
            } else if op == ";" && !self.excel {
                ","
            } else {
                op
            };
            if op.is_empty() && self.excel {
                self.has_bindings = true;
            }
            if op.is_empty() && !self.excel || self.excel && op == "," && !stop_separator {
                self.error.get_or_insert(
                    if !self.excel
                        && stop_separator
                        && matches!(&left, Expr::Literal(raw) if raw.ends_with(','))
                    {
                        "Err:508"
                    } else {
                        "Err:509"
                    },
                );
            }
            self.separators |= op == ",";
            if op == ";" {
                self.error
                    .get_or_insert(if stop_separator { "Err:508" } else { "Err:509" });
            }
            let prec = precedence(op);
            if prec < min {
                break;
            }
            let before = &self.source[..self.pos];
            let before = &before[before
                .trim_end_matches(|c: char| c.is_ascii_whitespace())
                .len()..];
            self.pos += token.len();
            let start = self.pos;
            self.space();
            let after = &self.source[start..self.pos];
            if !self.excel && matches!(op, "~" | "!" | ":") {
                if matches!(left, Expr::Unary('%', _)) {
                    self.error.get_or_insert("Err:508");
                } else if self.source[self.pos..].starts_with('-') {
                    self.error.get_or_insert("Err:520");
                }
            }
            let mut right = if self.pos == self.source.len()
                || op == ":" && self.source[self.pos..].starts_with(['=', ':'])
                || stop_separator && self.source[self.pos..].starts_with([';', ',', ')'])
            {
                self.error = Some(if self.pos == self.source.len() {
                    "Err:520"
                } else if stop_separator && self.source[self.pos..].starts_with([';', ',', ')']) {
                    "Err:511"
                } else {
                    "Err:510"
                });
                Expr::Omitted
            } else {
                self.expression(prec + 1, depth + 1, stop_separator)?
            };
            for (value, leading, trailing) in [(&mut left, "", before), (&mut right, after, "")] {
                if !leading.is_empty() || !trailing.is_empty() {
                    if self.nodes == 0 {
                        self.limited = true;
                        return None;
                    }
                    self.nodes -= 1;
                    *value = Expr::Spaced(
                        leading.into(),
                        Box::new(std::mem::replace(value, Expr::Omitted)),
                        trailing.into(),
                    );
                }
            }
            // Calc compiles adjacent reference tokens around ':' into one
            // range token before hashing; parentheses/whitespace prevent it.
            if !self.excel
                && op == ":"
                && let (Expr::Reference { odf: a, .. }, Expr::Reference { odf: b, .. }) =
                    (&left, &right)
                && base(a).is_some()
                && base(b).is_some()
            {
                let Some(work) = self.work.checked_sub((a.len() + b.len()) * 4 + 256) else {
                    self.limited = true;
                    return None;
                };
                self.work = work;
                if let Some(merged) = reference(&format!("{a}:{b}"), '.', &[]) {
                    left = merged;
                    continue;
                }
            }
            left = Expr::Binary(op.into(), Box::new(left), Box::new(right));
        }
        Some(left)
    }
    fn atom(&mut self, depth: usize) -> Option<Expr> {
        self.space();
        if self.take(b'{') {
            if self.arrays > 0 {
                if self.error == Some("Err:539") {
                    self.error = None;
                }
                self.error
                    .get_or_insert(if self.excel { "Err:520" } else { "Err:533" });
            }
            let invalid = if self.excel { "Err:520" } else { "Err:539" };
            self.arrays += 1;
            self.in_array = true;
            let column = if self.excel { b',' } else { b';' };
            let row_separator = if self.excel { b';' } else { b'|' };
            let mut rows: Vec<Vec<Expr>> = Vec::new();
            loop {
                let mut row = Vec::new();
                loop {
                    let leading = self.pos;
                    self.space();
                    let before = &self.source[leading..self.pos];
                    let start = self.pos;
                    let mut value = if self
                        .source
                        .as_bytes()
                        .get(self.pos)
                        .is_some_and(|b| [column, row_separator, b'}'].contains(b))
                    {
                        Expr::Literal(String::new())
                    } else {
                        self.expression(1, depth, true)?
                    };
                    match &value {
                        Expr::Number(_, false) => {}
                        Expr::Unary('+' | '-', e)
                            if matches!(e.as_ref(), Expr::Number(_, false)) => {}
                        Expr::Literal(s)
                            if s.is_empty()
                                || s.starts_with(['#', '"'])
                                || matches!(s.as_str(), "TRUE" | "FALSE")
                                || s.parse::<f64>().is_ok() => {}
                        Expr::Unary('+' | '-', e) if matches!(e.as_ref(), Expr::Literal(s) if s.parse::<f64>().is_ok()) =>
                            {}
                        _ => {
                            // Invalid matrix tokens are diagnosed before the
                            // function grammar's missing operators/separators.
                            if matches!(self.error, Some("Err:508" | "Err:509")) {
                                self.error = None;
                            }
                            self.error.get_or_insert(invalid);
                        }
                    }
                    if matches!(&value, Expr::Literal(v) if v.starts_with('#')) {
                        self.error.get_or_insert(invalid);
                    }
                    if matches!(&value, Expr::Literal(v) if matches!(v.as_str(), "TRUE" | "FALSE"))
                        && self.source[start..self.pos].contains('(')
                    {
                        self.error.get_or_insert(invalid);
                        if let Expr::Literal(name) = value {
                            value = Expr::Call(name, Vec::new(), false);
                        }
                    }
                    let raw = &self.source[start..self.pos];
                    let after = &raw[raw.trim_ascii_end().len()..];
                    if !before.is_empty() || !after.is_empty() {
                        if self.nodes == 0 {
                            self.limited = true;
                            return None;
                        }
                        self.nodes -= 1;
                        value = Expr::Spaced(before.into(), Box::new(value), after.into());
                    }
                    row.push(value);
                    if !self.take(column) {
                        if !self.excel && self.take(b',') {
                            self.error.get_or_insert(invalid);
                        } else {
                            break;
                        }
                    }
                }
                if rows.first().is_some_and(|first| first.len() != row.len()) {
                    self.error.get_or_insert(invalid);
                }
                rows.push(row);
                if self.take(row_separator) {
                    continue;
                }
                let closed = self.take(b'}') || self.pos == self.source.len();
                if !closed && self.excel && self.source[self.pos..].starts_with('|') {
                    self.error.get_or_insert("Err:520");
                }
                self.arrays -= 1;
                self.in_array = false;
                let constant = rows.iter().all(|row| row.len() == rows[0].len())
                    && rows.iter().flatten().all(|mut value| {
                        while let Expr::Spaced(_, inner, _) = value {
                            value = inner;
                        }
                        match value {
                            Expr::Number(_, false) => true,
                            Expr::Unary('+' | '-', inner) => {
                                matches!(inner.as_ref(), Expr::Number(_, false))
                            }
                            Expr::Literal(s) => {
                                s.is_empty()
                                    || s.starts_with('"')
                                    || matches!(s.as_str(), "TRUE" | "FALSE")
                            }
                            _ => false,
                        }
                    });
                if constant {
                    for slot in rows.iter_mut().flatten() {
                        let mut value = std::mem::replace(slot, Expr::Omitted);
                        while let Expr::Spaced(_, inner, _) = value {
                            value = *inner;
                        }
                        if let Expr::Unary(op, inner) = &value
                            && let Expr::Number(n, false) = inner.as_ref()
                        {
                            value = Expr::Number(if *op == '-' { -*n } else { *n }, false);
                        }
                        if matches!(value, Expr::Number(n, false) if !n.is_finite()) {
                            value = Expr::Literal("#NUM!".into());
                        } else if self.excel && matches!(&value, Expr::Literal(s) if s.is_empty()) {
                            value = Expr::Literal("\"\"".into());
                        }
                        *slot = value;
                    }
                }
                return closed.then_some(Expr::Array(rows));
            }
        }
        if self.take(b'(') {
            let separator = if self.excel { b',' } else { b';' };
            let start = self.pos;
            self.space();
            let before = &self.source[start..self.pos];
            let start = self.pos;
            let mut value = if self.source.as_bytes().get(self.pos) == Some(&separator) {
                Expr::Omitted
            } else {
                self.expression(1, depth, true)?
            };
            while self.take(separator) {
                if self.nodes == 0 {
                    self.limited = true;
                    return None;
                }
                self.nodes -= 1;
                self.separators = true;
                let preceding = &self.source[..self.pos - 1];
                let trailing = &preceding[preceding
                    .trim_end_matches(|c: char| c.is_ascii_whitespace())
                    .len()..];
                let start = self.pos;
                self.space();
                let leading = &self.source[start..self.pos];
                let mut right = if self
                    .source
                    .as_bytes()
                    .get(self.pos)
                    .is_some_and(|c| *c == separator || *c == b')')
                {
                    Expr::Omitted
                } else {
                    self.expression(1, depth, true)?
                };
                for (child, before, after) in
                    [(&mut value, "", trailing), (&mut right, leading, "")]
                {
                    if !before.is_empty() || !after.is_empty() {
                        if self.nodes == 0 {
                            self.limited = true;
                            return None;
                        }
                        self.nodes -= 1;
                        *child = Expr::Spaced(
                            before.into(),
                            Box::new(std::mem::replace(child, Expr::Omitted)),
                            after.into(),
                        );
                    }
                }
                value = Expr::Binary(",".into(), Box::new(value), Box::new(right));
            }
            let raw = &self.source[start..self.pos];
            let after = &raw[raw
                .trim_end_matches(|c: char| c.is_ascii_whitespace())
                .len()..];
            if !before.is_empty() || !after.is_empty() {
                if self.nodes == 0 {
                    self.limited = true;
                    return None;
                }
                self.nodes -= 1;
                value = Expr::Spaced(before.into(), Box::new(value), after.into());
            }
            let closed = self.take(b')') || self.pos == self.source.len();
            if !closed && !matches!(self.error, Some("Err:502" | "Err:533" | "Err:539")) {
                self.error = Some("Err:508");
            }
            return closed.then(|| Expr::Group(Box::new(value)));
        }
        let first = *self.source.as_bytes().get(self.pos)?;
        if first == b'#' {
            let value = [
                "#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!",
            ]
            .into_iter()
            .find(|v| {
                self.source[self.pos..]
                    .get(..v.len())
                    .is_some_and(|source| {
                        if self.excel {
                            source.eq_ignore_ascii_case(v)
                        } else {
                            source == *v
                        }
                    })
            })?;
            self.pos += value.len();
            return Some(if self.excel {
                Expr::Bad(function_names::unknown(value))
            } else {
                Expr::Literal(value.into())
            });
        }
        if first == b'"' {
            let start = self.pos;
            self.pos += 1;
            loop {
                let next = self.source[self.pos..].find('"')? + self.pos;
                self.pos = next + 1;
                if self.source.as_bytes().get(self.pos) == Some(&b'"') {
                    self.pos += 1;
                } else {
                    break;
                }
            }
            return Some(Expr::Literal(self.source[start..self.pos].into()));
        }
        if first == b'[' {
            if self.excel {
                let start = self.pos;
                if let Some(close) = self.source[start..].find(']') {
                    let end = start + close + 1;
                    let header = &self.source[start + 1..end - 1];
                    let tail = &self.source[end..];
                    let count = tail
                        .chars()
                        .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '$' | '.' | '!'))
                        .map(char::len_utf8)
                        .sum::<usize>();
                    let (sheet, cell) = qualified(&tail[..count], '!')
                        .map_or((None, &tail[..count]), |(sheet, cell)| (Some(sheet), cell));
                    let header_token = if header.starts_with('\'') {
                        header.len() >= 2
                            && header.ends_with('\'')
                            && header[1..header.len() - 1]
                                .split("''")
                                .all(|s| !s.contains('\''))
                    } else {
                        header
                            .chars()
                            .all(|c| c.is_alphanumeric() || matches!(c, '_' | '$' | '.' | ':'))
                            && header.bytes().filter(|b| *b == b':').count() <= 1
                    };
                    if header_token
                        && !tail.starts_with('!')
                        && crate::commands::spreadsheet::coordinate(cell).is_some()
                    {
                        if header.is_empty() {
                            // An empty document token consumes the remaining
                            // source as one bad operand, including delimiters.
                            self.pos = self.source.len();
                            self.has_bindings = true;
                            return Some(Expr::Bad(tail.to_owned()));
                        }
                        // The external parser retains an unresolved document
                        // prefix and the following reference as adjacent tokens.
                        self.work = (header.len() + count)
                            .checked_mul(4)
                            .and_then(|n| n.checked_add(256))
                            .and_then(|n| self.work.checked_sub(n))
                            .or_else(|| {
                                self.limited = true;
                                None
                            })?;
                        self.nodes = self.nodes.checked_sub(5).or_else(|| {
                            self.limited = true;
                            None
                        })?;
                        self.pos = end + count;
                        self.has_bindings = true;
                        let mut prefix = Expr::Bad(header.to_owned());
                        let suffix = reference(cell, '.', &[])?;
                        if let Some(sheet) = sheet {
                            prefix = Expr::Binary(
                                "[]".into(),
                                Box::new(prefix),
                                Box::new(Expr::Bad(function_names::unknown(sheet))),
                            );
                        }
                        return Some(Expr::Binary(
                            if sheet.is_some() {
                                "!".into()
                            } else {
                                "[]".into()
                            },
                            Box::new(prefix),
                            Box::new(suffix),
                        ));
                    }
                    if header.contains('\'')
                        || !header.is_ascii()
                        || tail.starts_with('!')
                        || header.bytes().filter(|b| *b == b':').count() > 1
                    {
                        self.pos = start
                            + crate::commands::spreadsheet::formula_arguments::external_reference_end(
                                &self.source[start..],
                            )?;
                        let token = &self.source[start..self.pos];
                        let upper = if header.is_ascii() {
                            collation::uppercase(token, &mut self.work).or_else(|| {
                                self.limited = true;
                                None
                            })?
                        } else {
                            token.to_owned()
                        };
                        return Some(Expr::Bad(
                            if (header.contains('\'') || !header.is_ascii())
                                && self.pos == end
                                && tail.trim().is_empty()
                                || tail.strip_prefix('!').is_some_and(|s| {
                                    crate::commands::spreadsheet::coordinate(
                                        &s[..count.saturating_sub(1)],
                                    )
                                    .is_some()
                                })
                            {
                                token.to_owned()
                            } else {
                                function_names::unknown(&upper)
                            },
                        ));
                    }
                }
                // An opening bracket starts an identifier; closing brackets
                // continue it. Operators, spaces and another '[' end the token.
                self.pos += 1;
                self.pos += self.source[self.pos..]
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '$' | ']' | '!'))
                    .map(char::len_utf8)
                    .sum::<usize>();
                self.has_bindings = true;
                let upper = collation::uppercase(&self.source[start..self.pos], &mut self.work)
                    .or_else(|| {
                        self.limited = true;
                        None
                    })?;
                return Some(Expr::Bad(function_names::unknown(&upper)));
            }
            self.pos += 1;
            let start = self.pos;
            let mut quoted = false;
            while let Some(&b) = self.source.as_bytes().get(self.pos) {
                if b == b'\'' {
                    quoted = !quoted;
                }
                if b == b']' && (!quoted || self.excel) {
                    break;
                }
                self.pos += 1;
            }
            if self.source.as_bytes().get(self.pos) != Some(&b']') {
                return None;
            }
            let raw = &self.source[start..self.pos];
            self.pos += 1;
            if self.legacy {
                return reference(raw, '!', &[]);
            }
            let Some(work) = raw
                .len()
                .checked_mul(4)
                .and_then(|n| n.checked_add(64))
                .and_then(|n| self.work.checked_sub(n))
            else {
                self.limited = true;
                return None;
            };
            self.work = work;
            let value = odf_reference(raw);
            self.has_bindings |= matches!(&value, Expr::Bad(_))
                || matches!(&value, Expr::Reference { excel, .. } if excel.contains('!'));
            return Some(value);
        }
        if self.excel && first == b']' {
            self.pos += 1;
            self.has_bindings = true;
            return Some(Expr::Bad("]".into()));
        }
        if first == b'.' && self.source[self.pos + 1..].starts_with("$$") {
            self.pos += 1;
            self.error = Some(if self.excel { "Err:509" } else { "Err:501" });
            return Some(Expr::Binary(
                String::new(),
                Box::new(Expr::Literal(".".into())),
                Box::new(self.atom(depth + 1)?),
            ));
        }
        if first.is_ascii_digit() || first == b'.' {
            let start = self.pos;
            let mut point = false;
            while let Some(&b) = self.source.as_bytes().get(self.pos) {
                if b == b'.' {
                    if point && first != b'.' {
                        break;
                    }
                    point = true;
                } else if !b.is_ascii_digit() && (self.excel || b != b',') {
                    break;
                }
                self.pos += 1;
            }
            if matches!(self.source.as_bytes().get(self.pos), Some(b'e' | b'E')) {
                self.pos += 1;
                if matches!(self.source.as_bytes().get(self.pos), Some(b'+' | b'-'))
                    && self
                        .source
                        .as_bytes()
                        .get(self.pos + 1)
                        .is_some_and(u8::is_ascii_digit)
                {
                    self.pos += 1;
                }
                while self
                    .source
                    .as_bytes()
                    .get(self.pos)
                    .is_some_and(u8::is_ascii_digit)
                {
                    self.pos += 1;
                }
            }
            if !self.excel && self.source[start..self.pos].contains(',') {
                // A following name makes Calc retry numeric scanning. Commas
                // are accepted by the first scan, but end the fallback token.
                let (token, illegal) =
                    crate::commands::spreadsheet::number_token(&self.source[start..], true);
                self.pos = start + token.len();
                if illegal {
                    self.error.get_or_insert("Err:501");
                }
            }
            let source = &self.source[start..self.pos];
            let number = if source.contains(',') {
                let mantissa = source.split(['e', 'E']).next().unwrap_or(source);
                let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
                let mut groups = whole.split(',');
                let grouped = self.sheet_separator == '!'
                    && !self.excel
                    && groups.next().is_some_and(|s| !s.is_empty() && s.len() <= 3)
                    && groups.all(|s| s.len() == 3 && s.bytes().all(|b| b.is_ascii_digit()))
                    && fraction.bytes().all(|b| b.is_ascii_digit());
                if !grouped {
                    return Some(Expr::Literal(source.into()));
                }
                source.replace(',', "").parse::<f64>()
            } else {
                source.parse::<f64>()
            };
            let Ok(mut number) = number else {
                if source.ends_with(['e', 'E'])
                    && self.source[self.pos..].starts_with([';', ',', ')'])
                {
                    self.error.get_or_insert("Err:508");
                }
                return Some(if self.excel && source == "." {
                    Expr::Bad(source.into())
                } else {
                    Expr::Literal(source.into())
                });
            };
            if !number.is_finite()
                || number.is_subnormal()
                || number == 0.
                    && source
                        .split(['e', 'E'])
                        .next()?
                        .bytes()
                        .any(|b| (b'1'..=b'9').contains(&b))
            {
                if !self.excel
                    && matches!(self.error, None | Some("Err:508" | "Err:509" | "Err:539"))
                {
                    self.error = Some("Err:502");
                }
                if self.sheet_separator == '!' {
                    number = if number.is_infinite() { f64::MAX } else { 0. };
                }
            }
            let percent = self.take(b'%');
            return Some(Expr::Number(number, percent));
        }
        let start = self.pos;
        if !self.excel && self.source[self.pos..].starts_with(',') {
            // Legacy Calc can retain a leading comma in an unknown token.
            self.pos += 1;
        }
        let mut quoted = false;
        while let Some(c) = self.source[self.pos..].chars().next() {
            if c == '\'' {
                quoted = !quoted;
            } else if !quoted
                && !c.is_alphanumeric()
                && !matches!(c, '_' | '.' | '$')
                && !(self.excel && matches!(c, '!' | ']'))
            {
                break;
            }
            self.pos += c.len_utf8();
            if c == '\'' && !quoted && self.excel && self.source[self.pos..].starts_with('.') {
                let left = self.source[start..self.pos].to_owned();
                self.pos += 1;
                self.error = Some("Err:509");
                self.has_bindings = true;
                return Some(Expr::Binary(
                    ".".into(),
                    Box::new(Expr::Name(left)),
                    Box::new(self.atom(depth + 1)?),
                ));
            }
        }
        if self.pos == start {
            return None;
        }
        let name = &self.source[start..self.pos];
        if self.excel && name.contains(']') {
            self.has_bindings = true;
            let upper = collation::uppercase(name, &mut self.work).or_else(|| {
                self.limited = true;
                None
            })?;
            return Some(Expr::Bad(function_names::unknown(&upper)));
        }
        if let Some(tail) = name.strip_prefix(',') {
            if tail.as_bytes().first().is_some_and(u8::is_ascii_digit) {
                self.error.get_or_insert("Err:509");
            }
            return Some(Expr::Bad(function_names::unknown(name)));
        }
        let name_end = self.pos;
        if !self.take(b'(') {
            let mut parsed_reference = if self.excel && qualified(name, '!').is_some() {
                if name.starts_with('$') {
                    None
                } else {
                    reference(&format!("${name}"), '!', &[])
                }
            } else {
                reference(name, if self.excel { '!' } else { '.' }, &[])
            };
            if self.excel
                && qualified(name, '!').is_some()
                && let Some(Expr::Reference { excel, foreign, .. }) = &mut parsed_reference
            {
                *excel = name.to_owned();
                *foreign = true;
            }
            if let Some(reference) = parsed_reference {
                self.has_bindings |=
                    matches!(&reference, Expr::Reference { excel, .. } if excel.contains('!'));
                return Some(reference);
            }
            let name = if self.excel {
                name
            } else {
                name.strip_prefix("$$").unwrap_or(name)
            };
            let boolean = name.eq_ignore_ascii_case("true") || name.eq_ignore_ascii_case("false");
            let name = if boolean {
                name.to_ascii_uppercase()
            } else {
                name.into()
            };
            return Some(if boolean && self.arrays == 0 {
                if self.sheet_separator == '.' {
                    Expr::Call(name, Vec::new(), false)
                } else {
                    Expr::Literal(if name == "TRUE" { "1" } else { "0" }.into())
                }
            } else if boolean {
                Expr::Literal(name)
            } else {
                self.has_bindings = true;
                Expr::Name(name)
            });
        }
        let call_space = &self.source[name_end..self.pos - 1];
        let mut args = Vec::new();
        let in_array = self.in_array;
        let start = self.pos;
        self.space();
        let empty = self.source.as_bytes().get(self.pos) == Some(&b')');
        if empty && self.pos == start {
            self.pos += 1;
        } else {
            self.pos = start;
            loop {
                let start = self.pos;
                self.space();
                let before = &self.source[start..self.pos];
                let start = self.pos;
                let mut arg = if self
                    .source
                    .as_bytes()
                    .get(self.pos)
                    .is_some_and(|b| *b == b')' || *b == if self.excel { b',' } else { b';' })
                {
                    Expr::Omitted
                } else {
                    self.expression(1, depth, true)?
                };
                let raw = &self.source[start..self.pos];
                let after = &raw[raw
                    .trim_end_matches(|c: char| c.is_ascii_whitespace())
                    .len()..];
                if !before.is_empty() || !after.is_empty() {
                    if self.nodes == 0 {
                        self.limited = true;
                        return None;
                    }
                    self.nodes -= 1;
                    arg = Expr::Spaced(before.into(), Box::new(arg), after.into());
                }
                args.push(arg);
                if self.take(b')') || self.pos == self.source.len() {
                    break;
                }
                if !self.take(if self.excel { b',' } else { b';' }) {
                    if !self.excel && self.take(b',') {
                        // An invalid matrix element keeps its error; an
                        // incomplete argument list replaces missing operators.
                        if !matches!(self.error, Some("Err:502" | "Err:533" | "Err:539")) {
                            self.error = Some("Err:508");
                        }
                    } else {
                        return None;
                    }
                }
            }
        }
        if name.eq_ignore_ascii_case("NA") && !empty {
            self.error = Some("Err:508");
        }
        if self.normalized {
            return Some(Expr::Call(
                function_names::imported_ods(name, false, false)
                    .unwrap_or(name)
                    .into(),
                args,
                false,
            ));
        }
        let Some(upper) = collation::uppercase(name, &mut self.work) else {
            self.limited = true;
            return None;
        };
        let ascii = name.to_ascii_uppercase();
        let mut recognized = function_names::imported_ods(
            if self.sheet_separator == '.' {
                &ascii
            } else {
                &upper
            },
            self.sheet_separator == '!' && !self.excel,
            self.excel,
        );
        if recognized.is_none() && crate::commands::spreadsheet::coordinate(&upper).is_some() {
            self.error = Some("Err:509");
            return Some(Expr::Call(upper, args, false));
        }
        if self.excel
            && matches!(
                recognized,
                Some(
                    "ROUND"
                        | "ROUNDUP"
                        | "ROUNDDOWN"
                        | "TRUNC"
                        | "LOGNORMDIST"
                        | "EUROCONVERT"
                        | "FACT"
                        | "COMBIN"
                        | "COMBINA"
                        | "PERMUT"
                        | "PERMUTATIONA"
                        | "HYPGEOMDIST"
                        | "HYPGEOM.DIST"
                        | "DCOUNT"
                        | "DCOUNTA"
                        | "DSUM"
                        | "DAVERAGE"
                        | "DMIN"
                        | "DMAX"
                        | "DPRODUCT"
                        | "DGET"
                        | "DSTDEV"
                        | "DSTDEVP"
                        | "DVAR"
                        | "DVARP"
                )
            )
        {
            let minimum = match recognized {
                Some("TRUNC" | "FACT") => 1,
                Some("LOGNORMDIST" | "EUROCONVERT") => 3,
                Some("HYPGEOMDIST") => 4,
                Some("HYPGEOM.DIST") => 5,
                Some(
                    "DCOUNT" | "DCOUNTA" | "DSUM" | "DAVERAGE" | "DMIN" | "DMAX" | "DPRODUCT"
                    | "DGET" | "DSTDEV" | "DSTDEVP" | "DVAR" | "DVARP",
                ) => 3,
                _ => 2,
            };
            while args.len() > minimum {
                let mut last = args.last().unwrap();
                while let Expr::Spaced(_, inner, _) = last {
                    last = inner;
                }
                if !matches!(last, Expr::Omitted) {
                    break;
                }
                args.pop();
                if args.len() == 1 {
                    let mut first = &mut args[0];
                    while let Expr::Spaced(_, inner, _) = first {
                        first = inner;
                    }
                    if matches!(first, Expr::Omitted) {
                        *first = Expr::OmittedZero;
                    }
                }
            }
        }
        let mut omit_method = false;
        if recognized == Some("ISOWEEKNUM") {
            if self.sheet_separator == '.' && args.len() == 2 {
                let mut method = &args[1];
                while let Expr::Spaced(_, inner, _) = method {
                    method = inner;
                }
                if matches!(method, Expr::Number(2., false)) {
                    omit_method = true;
                } else {
                    recognized = Some("WEEKNUM_OOO");
                }
            } else if self.sheet_separator != '.' && args.len() > 1 {
                self.error = Some("Err:508");
            }
        }
        if self.excel && recognized == Some("WEEKNUM_EXCEL2003") {
            let Some(count) = crate::commands::spreadsheet::formula_arguments::argument_count(
                &self.source[start - 1..self.pos],
                in_array,
                &mut self.work,
            ) else {
                self.limited = true;
                return None;
            };
            if count == 1 {
                args.push(Expr::Literal("1".into()));
            }
        }
        let name = recognized
            .map(str::to_owned)
            .unwrap_or_else(|| format!("{}{call_space}", function_names::unknown(&upper)));
        Some(Expr::Call(name, args, omit_method))
    }
}
fn qualified(raw: &str, separator: char) -> Option<(&str, &str)> {
    let mut quoted = false;
    raw.char_indices().find_map(|(i, c)| {
        if c == '\'' {
            quoted = !quoted;
        }
        (c == separator && !quoted).then(|| (&raw[..i], &raw[i + c.len_utf8()..]))
    })
}

pub(super) fn lookup_name<T>(
    name: &str,
    excel: bool,
    sheet: usize,
    sheets: &[String],
    work: &mut usize,
    mut lookup: impl FnMut(&(Option<usize>, String)) -> Option<T>,
) -> Result<Option<(Option<usize>, T)>, &'static str> {
    let upper = collation::uppercase(name, work).ok_or(super::LIMIT)?;
    for scope in [Some(sheet), None] {
        if let Some(value) = lookup(&(scope, upper.clone())) {
            return Ok(Some((scope, value)));
        }
    }
    let Some((raw, name)) = qualified(&upper, if excel { '!' } else { '.' }) else {
        return Ok(None);
    };
    let raw = if excel {
        raw
    } else {
        raw.strip_prefix('$').unwrap_or(raw)
    };
    let quoted = raw.starts_with('\'');
    let raw = if quoted {
        raw.strip_prefix('\'')
            .and_then(|s| s.strip_suffix('\''))
            .map(|s| s.replace("''", "'"))
    } else {
        Some(raw.to_owned())
    };
    let Some(raw) = raw else {
        return Ok(None);
    };
    let raw = if quoted { raw.to_lowercase() } else { raw };
    for (index, sheet) in sheets.iter().enumerate() {
        *work = work
            .checked_sub(sheet.len() + name.len() + 32)
            .ok_or(super::LIMIT)?;
        // Quoted sheet lookup uses the compiler's simple case comparison;
        // unquoted lookup also expands compatibility characters such as ﬃ.
        let key = if quoted {
            sheet.to_lowercase()
        } else {
            collation::uppercase(sheet, work).ok_or(super::LIMIT)?
        };
        if key == raw {
            return Ok(lookup(&(Some(index), name.to_owned())).map(|v| (Some(index), v)));
        }
    }
    Ok(None)
}

// ODF markers quote token contents, not sheet names. Keep the original
// unquoted range separators: a colon inside a marked name is not a range.
fn odf_reference(raw: &str) -> Expr {
    let mut text = String::new();
    let mut chars = raw.chars().peekable();
    let (mut name, mut quoted, mut marked, mut past_dot, mut mark_ahead) =
        (false, false, false, false, false);
    let mut references = 1;
    while let Some(c) = chars.next() {
        if c == ':' && !quoted {
            references += 1;
            (name, quoted, marked, past_dot, mark_ahead) = (false, false, false, false, false);
        } else if c == '.' && !name && !marked && !past_dot {
            past_dot = true;
            mark_ahead = chars.clone().take(2).eq(['$', '$']);
            continue;
        } else if !past_dot || marked || mark_ahead {
            if c == '$' && !quoted && chars.peek() == Some(&'$') {
                chars.next();
                mark_ahead = false;
                if marked {
                    text.push_str("$$");
                } else {
                    marked = true;
                    name = false;
                }
                continue;
            }
            if c == '\'' {
                let boundary = !name || quoted;
                if !name {
                    name = true;
                    quoted = true;
                } else if quoted {
                    if chars.peek() == Some(&'\'') {
                        chars.next();
                        if !marked {
                            text.push('\'');
                        }
                        text.push('\'');
                        continue;
                    }
                    quoted = false;
                }
                if marked && boundary {
                    continue;
                }
            } else if c == '.' && !quoted {
                past_dot = true;
                mark_ahead = chars.clone().take(2).eq(['$', '$']);
            } else if c != '$' || name || marked || past_dot {
                name = true;
            }
        }
        text.push(c);
    }
    let valid = |part: &str| base(part).is_some_and(|p| p.column < 16_384 && p.row < 1_048_576);
    let parsed = match (references, range_split(&text)) {
        (1, None) if valid(&text) => reference(&text, '.', &[]),
        (2, Some(i)) if valid(&text[..i]) && valid(&text[i + 1..]) => reference(&text, '.', &[]),
        _ => None,
    };
    parsed.unwrap_or(Expr::Bad(text))
}

pub(super) struct Base {
    #[cfg(test)]
    #[allow(dead_code)] // Legacy export metadata, outside the editor path.
    pub sheet: Option<String>,
    pub row: u64,
    pub column: u64,
}
struct Endpoint {
    sheet: Option<String>,
    relative: bool,
    cell: String,
    position: Option<(u64, u64)>,
}
fn endpoint(raw: &str, separator: char) -> Option<Endpoint> {
    let (sheet, cell) = raw.rsplit_once(separator).unwrap_or(("", raw));
    let relative = !sheet.starts_with('$');
    let sheet = sheet.strip_prefix('$').unwrap_or(sheet);
    let sheet = if sheet.is_empty() {
        None
    } else if let Some(s) = sheet.strip_prefix('\'') {
        let s = s.strip_suffix('\'')?;
        let mut chars = s.chars();
        let mut name = String::new();
        while let Some(c) = chars.next() {
            if c == '\'' && chars.next() != Some('\'') {
                return None;
            }
            name.push(c);
        }
        Some(name)
    } else {
        if !sheet
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '_' | ' '))
        {
            return None;
        }
        Some(sheet.to_owned())
    };
    let c = cell.strip_prefix('$').unwrap_or(cell);
    let letters = c.bytes().take_while(u8::is_ascii_alphabetic).count();
    let row = c[letters..].strip_prefix('$').unwrap_or(&c[letters..]);
    let position = if letters > 0 && !row.is_empty() && row.bytes().all(|b| b.is_ascii_digit()) {
        let column = c[..letters].bytes().try_fold(0u64, |n, b| {
            n.checked_mul(26)?
                .checked_add(u64::from(b.to_ascii_uppercase() - b'A' + 1))
                .filter(|v| *v <= 9007199254740991)
        });
        row.parse::<u64>()
            .ok()
            .filter(|n| *n > 0 && *n <= 9007199254740991)
            .zip(column)
            .map(|(r, c)| (r - 1, c - 1))
    } else {
        None
    };
    if position.is_none()
        && (cell.is_empty() || !cell.chars().all(|c| c.is_alphanumeric() || c == '_'))
    {
        return None;
    }
    Some(Endpoint {
        sheet,
        relative,
        cell: if let Some((r, _)) = position {
            format!(
                "{}{next}",
                cell[..cell.len() - row.len()].to_uppercase(),
                next = r + 1
            )
        } else {
            cell.into()
        },
        position,
    })
}
pub(super) fn range_split(raw: &str) -> Option<usize> {
    let mut quoted = false;
    raw.char_indices().find_map(|(i, c)| {
        if c == '\'' {
            quoted = !quoted;
        }
        (c == ':' && !quoted).then_some(i)
    })
}
pub(super) fn base(raw: &str) -> Option<Base> {
    if range_split(raw).is_some() {
        return None;
    }
    let endpoint = endpoint(raw, '.')?;
    let (row, column) = endpoint.position?;
    Some(Base {
        #[cfg(test)]
        sheet: endpoint.sheet,
        row,
        column,
    })
}
fn reference(raw: &str, separator: char, sheets: &[String]) -> Option<Expr> {
    let split = range_split(raw);
    let (first, last) = split.map_or((raw, None), |i| (&raw[..i], Some(&raw[i + 1..])));
    let mut first = endpoint(first, separator)?;
    let mut last = match last {
        Some(raw) => Some(endpoint(raw, separator)?),
        None => None,
    };
    if first.position.is_none() || last.as_ref().is_some_and(|p| p.position.is_none()) {
        return None;
    }
    if std::iter::once(&first).chain(last.iter()).any(|part| {
        part.sheet
            .as_deref()
            .is_some_and(|name| !super::valid_sheet_name(name))
    }) {
        return Some(Expr::Literal("#REF!".into()));
    }
    let inherited_sheet = last.as_ref().is_some_and(|part| part.sheet.is_none());
    if let Some(last) = &mut last {
        if last.sheet.is_none() {
            last.sheet.clone_from(&first.sheet);
            last.relative = first.relative;
        }
    }
    if let Some(last) = &mut last {
        let sheet_index = |name: &str| {
            sheets
                .iter()
                .position(|sheet| crate::commands::spreadsheet::case_fold::same_name(sheet, name))
        };
        // Unknown sheet tokens retain their original spelling and coordinates.
        if [&first, &*last].iter().all(|part| {
            part.sheet
                .as_deref()
                .is_none_or(|name| sheet_index(name).is_some())
        }) {
            let (ar, ac) = first.position?;
            let (br, bc) = last.position?;
            if ar > br || ac > bc {
                let split = |cell: &str| {
                    usize::from(cell.starts_with('$'))
                        + cell
                            .trim_start_matches('$')
                            .bytes()
                            .take_while(u8::is_ascii_alphabetic)
                            .count()
                };
                let (acol, arow) = first.cell.split_at(split(&first.cell));
                let (bcol, brow) = last.cell.split_at(split(&last.cell));
                let a = format!(
                    "{}{}",
                    if ac > bc { bcol } else { acol },
                    if ar > br { brow } else { arow }
                );
                let b = format!(
                    "{}{}",
                    if ac > bc { acol } else { bcol },
                    if ar > br { arow } else { brow }
                );
                first.cell = a;
                last.cell = b;
                first.position = Some((ar.min(br), ac.min(bc)));
                last.position = Some((ar.max(br), ac.max(bc)));
            }
            if let (Some(a), Some(b)) = (
                first.sheet.as_deref().and_then(sheet_index),
                last.sheet.as_deref().and_then(sheet_index),
            ) && a > b
            {
                std::mem::swap(&mut first.sheet, &mut last.sheet);
                std::mem::swap(&mut first.relative, &mut last.relative);
            }
        } else if !sheets.is_empty() {
            return Some(Expr::Bad(raw.to_owned()));
        }
    }
    let singleton_range = last.as_ref().is_some_and(|last| {
        last.sheet == first.sheet && last.relative == first.relative && last.cell == first.cell
    });
    if singleton_range {
        last = None;
    }
    let mut excel = String::new();
    let mut odf = Vec::new();
    let mut foreign = singleton_range;
    for (i, part) in std::iter::once(&first).chain(last.iter()).enumerate() {
        if i > 0 {
            excel.push(':');
        }
        let sheet = part
            .sheet
            .as_ref()
            .map(|s| format!("'{}'", s.replace('\'', "''")));
        if let Some(sheet) = &sheet {
            if i == 0 || part.sheet != first.sheet {
                excel.push_str(&format!("{sheet}!"));
            }
            foreign |= part.relative && part.position.is_some();
        }
        excel.push_str(&part.cell);
        let sheet = sheet.filter(|_| i == 0 || !inherited_sheet);
        odf.push(format!(
            "{}{}.{}",
            if sheet.is_some() && !part.relative {
                "$"
            } else {
                ""
            },
            sheet.unwrap_or_default(),
            part.cell
        ));
    }
    if let Some(last) = &last
        && first.sheet != last.sheet
    {
        excel = format!(
            "'{}':'{}'!{}:{}",
            first.sheet.as_deref().unwrap_or("").replace('\'', "''"),
            last.sheet.as_deref().unwrap_or("").replace('\'', "''"),
            first.cell,
            last.cell
        );
    }
    Some(Expr::Reference {
        excel,
        odf: if sheets.is_empty()
            && separator == '.'
            && (first.sheet.is_some() || last.as_ref().is_some_and(|p| p.sheet.is_some()))
        {
            raw.to_owned()
        } else if singleton_range {
            format!("{0}:{0}", odf[0])
        } else {
            odf.join(":")
        },
        foreign,
    })
}
// Excel's unresolved document prefix is reparsed using Calc reference syntax.
#[cfg(test)]
fn external_prefix(raw: &str, sheets: &[String]) -> Expr {
    let bad = || Expr::Bad(raw.to_owned());
    let split = range_split(raw);
    let (sheet, cell) = raw
        .rsplit_once('.')
        .map_or((None, raw), |(s, c)| (Some(s), c));
    let known_sheet = sheet.filter(|s| !s.is_empty()).is_some_and(|s| {
        sheets.iter().any(|name| {
            crate::commands::spreadsheet::case_fold::same_name(name, s.trim_start_matches('$'))
        })
    });
    let row = |s: &str| {
        let digits = s.strip_prefix('$').unwrap_or(s);
        digits
            .bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| digits.parse::<u64>().ok())
            .flatten()
            .filter(|n| (1..=1_048_576).contains(n))
    };
    if split.is_none()
        && let Some(n) = row(cell)
    {
        if known_sheet {
            return bad();
        }
        return Expr::Reference {
            excel: "#REF!".into(),
            odf: format!(
                "{}#REF!{}{n}",
                if sheet.is_some_and(|s| !s.is_empty()) {
                    "#REF!."
                } else {
                    ""
                },
                if cell.starts_with('$') { "$" } else { "" }
            ),
            foreign: true,
        };
    }
    if let Some(i) = split {
        let (a, b) = (&raw[..i], &raw[i + 1..]);
        let column = |s: &str| {
            let letters = s.strip_prefix('$').unwrap_or(s);
            if letters.is_empty() || !letters.bytes().all(|b| b.is_ascii_alphabetic()) {
                return None;
            }
            letters
                .bytes()
                .try_fold(0u64, |n, b| {
                    n.checked_mul(26)?
                        .checked_add(u64::from(b.to_ascii_uppercase() - b'A' + 1))
                })
                .filter(|n| *n <= 16384)
        };
        if let Some((x, y)) = row(a).zip(row(b)).or_else(|| column(a).zip(column(b))) {
            let (a, b) = if x > y { (b, a) } else { (a, b) };
            let axis = |s: &str| {
                row(s).map_or_else(
                    || s.to_ascii_uppercase(),
                    |n| format!("{}{n}", if s.starts_with('$') { "$" } else { "" }),
                )
            };
            let text = format!("{}:{}", axis(a), axis(b));
            return Expr::Reference {
                excel: text.clone(),
                odf: text,
                foreign: true,
            };
        }
    }
    let valid = |s: &str| {
        endpoint(s, '.')
            .is_some_and(|p| p.position.is_some_and(|(r, c)| r < 1_048_576 && c < 16384))
    };
    let valid = split.map_or_else(|| valid(raw), |i| valid(&raw[..i]) && valid(&raw[i + 1..]));
    if valid {
        if split.is_none() && sheet.is_some_and(|s| !s.is_empty()) && !known_sheet {
            return Expr::Reference {
                excel: "#REF!".into(),
                odf: format!("#REF!.{cell}"),
                foreign: true,
            };
        }
        return reference(raw, '.', sheets).unwrap_or_else(bad);
    }
    bad()
}
// Converted ODS references always quote sheet names. Parse quoted tokens so
// string arguments (notably INDIRECT and SHEET) retain their original spelling.
pub(super) fn rename(
    mut source: &str,
    changes: &std::collections::BTreeMap<String, String>,
    remaining: &mut usize,
) -> Result<String, &'static str> {
    let mut output = String::new();
    while !source.is_empty() {
        let end = source.find(['\'', '"']).unwrap_or(source.len());
        *remaining = remaining.checked_sub(end).ok_or(super::LIMIT)?;
        output.push_str(&source[..end]);
        source = &source[end..];
        let Some(quote) = source.chars().next() else {
            break;
        };
        // Bad ODF tokens can contain unquoted apostrophes or quotes.
        // They are literal text, not the start of a sheet/string token.
        if output
            .chars()
            .last()
            .is_some_and(|c| c.is_alphanumeric() || c == '_')
        {
            *remaining = remaining.checked_sub(1).ok_or(super::LIMIT)?;
            output.push(quote);
            source = &source[1..];
            continue;
        }
        let mut end = 1;
        loop {
            let Some(next) = source[end..].find(quote) else {
                end = source.len();
                break;
            };
            end += next + 1;
            if source[end..].starts_with(quote) {
                end += 1;
            } else {
                break;
            }
        }
        let token = &source[..end];
        let tail = &source[end..];
        let cell = tail.strip_prefix('.').map(|tail| {
            let n = tail
                .bytes()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == b'$')
                .count();
            &tail[..n]
        });
        let reference = tail.starts_with(['!', ':'])
            || cell.is_some_and(|c| base(c).is_some())
            || tail.starts_with(".#REF!");
        let replacement = if quote == '\'' && reference {
            let name = token[1..end - 1].replace("''", "'");
            changes.get(&crate::commands::spreadsheet::case_fold::sheet_key(&name))
        } else {
            None
        };
        if let Some(name) = replacement {
            *remaining = remaining
                .checked_sub(
                    name.len()
                        .checked_mul(2)
                        .and_then(|n| n.checked_add(2))
                        .ok_or(super::LIMIT)?,
                )
                .ok_or(super::LIMIT)?;
            let named = tail.strip_prefix('!').is_some_and(|tail| {
                let n = tail
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '$'))
                    .map(char::len_utf8)
                    .sum::<usize>();
                n > 0 && base(&tail[..n]).is_none()
            });
            if named {
                output.push_str(&crate::commands::spreadsheet::sheet_name::quote_sheet(name));
            } else {
                output.push('\'');
                output.push_str(&name.replace('\'', "''"));
                output.push('\'');
            }
        } else {
            *remaining = remaining.checked_sub(token.len()).ok_or(super::LIMIT)?;
            output.push_str(token);
        }
        source = &source[end..];
    }
    Ok(output)
}

pub(in crate::commands) struct Formula {
    pub display: Option<String>,
    pub excel: String,
    pub openformula: Option<String>,
    pub error: Option<&'static str>,
    token_error: Option<&'static str>,
    expression: Option<Expr>,
    pub(super) external: bool,
    has_bindings: bool,
    pub(super) separators: bool,
}

#[cfg(test)]
pub(super) struct Group {
    row: usize,
    pub(super) first: usize,
    expression: Expr,
    numeric_hash: Option<u64>,
    rewritten: bool,
    pub(super) retained: usize,
}

impl Formula {
    #[cfg(test)]
    #[allow(dead_code)] // Retained with the original converter test support.
    pub(super) fn invalidate_reference(
        &mut self,
        raw: &str,
        work: &mut usize,
    ) -> Result<(), &'static str> {
        *work = work.checked_sub(raw.len() * 4 + 64).ok_or(super::LIMIT)?;
        let token = function_names::unknown(raw);
        self.excel = token.clone();
        self.openformula = Some(format!("of:=['{}']", token.replace('\'', "''")));
        self.expression = Some(Expr::Bad(token));
        self.error = None;
        self.token_error = None;
        Ok(())
    }

    #[cfg(test)]
    #[allow(dead_code)] // Retained with the original converter test support.
    pub(super) fn export(
        &mut self,
        group: Option<&Group>,
        sheets: &[String],
        changes: &std::collections::BTreeMap<String, String>,
        work: &mut usize,
    ) -> Result<(), &'static str> {
        let Some(expression) = self
            .expression
            .as_ref()
            .or_else(|| group.map(|g| &g.expression))
        else {
            return Ok(());
        };
        let text = expression.render(Syntax::Xlsx(sheets, changes), work)?;
        if text != self.excel && self.openformula.is_none() {
            self.openformula = Some(format!(
                "of:={}",
                expression.render(Syntax::Calculation, work)?
            ));
        }
        self.excel = text;
        Ok(())
    }

    #[cfg(test)]
    #[allow(dead_code)] // Retained with the original converter test support.
    pub(super) fn recompile_microsoft(
        &mut self,
        source: &str,
        work: &mut usize,
    ) -> Result<String, &'static str> {
        use crate::commands::spreadsheet::formula_arguments::{Syntax as Arguments, rewrite};
        // Calc serializes these unresolved names with Excel separators, then
        // recompiles them with its legacy grammar, where commas are not argument
        // separators. Keep the resulting compiler error and export defaults.
        *work = work.checked_sub(source.len() + 40).ok_or(super::LIMIT)?;
        let source = format!(
            "{{http://openoffice.org/2004/calc}}={}",
            source.strip_prefix("oooc:=").unwrap_or(source)
        );
        let parsed = convert(&source, false, *work, false)?.unwrap();
        self.error = self.error.or(parsed.token_error).or(parsed.error);
        self.excel = rewrite(&self.excel, Arguments::OdsRecompiledMicrosoft, &[], work)
            .ok_or(super::LIMIT)?
            .into_owned();
        *work = work.checked_sub(4).ok_or(super::LIMIT)?;
        Ok(format!(
            "of:={}",
            if let Some(error) = self.error {
                *work = work.checked_sub(error.len()).ok_or(super::LIMIT)?;
                error.to_owned()
            } else if let Some(expression) = parsed.expression {
                expression.render(Syntax::Calculation, work)?
            } else {
                parsed.excel
            }
        ))
    }

    pub(in crate::commands) fn compile_separators(
        &mut self,
        names: &[crate::commands::spreadsheet::model::NamedExpression],
        sheets: &[String],
        sheet: usize,
        bindings: Option<&std::collections::BTreeMap<String, Option<usize>>>,
        work: &mut usize,
    ) -> Result<(), &'static str> {
        if !(self.separators || self.external && self.has_bindings)
            || self.error.is_some()
                && !(self.external && matches!(self.error, Some("Err:508" | "Err:509" | "Err:520")))
        {
            return Ok(());
        }
        let Some(expression) = self.expression.as_mut() else {
            return Ok(());
        };
        let mut compiler = SeparatorCompiler {
            names,
            sheets,
            visiting: Vec::new(),
            tokens: Vec::new(),
            failed: false,
            stopped: false,
            error: None,
            work,
        };
        compiler.compile(expression, sheet, bindings, false, 0)?;
        self.error = compiler.error.or(self.token_error).or(self.error);
        if !self.separators {
            return Ok(());
        }
        self.excel = expression.render(Syntax::Excel, work)?;
        self.display = Some(expression.render(Syntax::Calc, work)?);
        self.openformula = Some(format!(
            "of:={}",
            expression.render(Syntax::Calculation, work)?
        ));
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn bind_names(
        &mut self,
        names: &std::collections::BTreeMap<(Option<usize>, String), &str>,
        sheet: usize,
        sheets: &[String],
        work: &mut usize,
    ) -> Result<(), &'static str> {
        if !self.has_bindings {
            return Ok(());
        }
        let excel = self.external;
        self.resolve_names(sheets, work, true, |name, work| {
            let selected = lookup_name(name, excel, sheet, sheets, work, |key| {
                names.get(key).copied()
            })?;
            selected
                .map(|(scope, name)| {
                    *work = work
                        .checked_sub(name.len() + scope.map_or(0, |s| sheets[s].len() * 2 + 3))
                        .ok_or(super::LIMIT)?;
                    Ok(if let Some(scope) = scope.filter(|s| *s != sheet) {
                        format!(
                            "{}!{name}",
                            if sheets[scope].encode_utf16().count() > 31 {
                                format!("'{}'", sheets[scope].replace('\'', "''"))
                            } else {
                                crate::commands::spreadsheet::sheet_name::quote_sheet(
                                    &sheets[scope],
                                )
                            }
                        )
                    } else {
                        name.to_owned()
                    })
                })
                .transpose()
        })?;
        Ok(())
    }

    // Return whether an unknown function requires Calc's final name compilation.
    #[cfg(test)]
    pub(super) fn resolve_names(
        &mut self,
        sheets: &[String],
        work: &mut usize,
        finalize: bool,
        mut resolve: impl FnMut(&str, &mut usize) -> Result<Option<String>, &'static str>,
    ) -> Result<bool, &'static str> {
        let Some(expression) = self.expression.as_mut() else {
            return Ok(false);
        };
        let mut unknown = false;
        let mut pending = vec![expression];
        let mut changed = false;
        let mut sheet_names = None;
        while let Some(value) = pending.pop() {
            *work = work
                .checked_sub(std::mem::size_of::<Expr>())
                .ok_or(super::LIMIT)?;
            match value {
                Expr::Reference {
                    excel,
                    odf,
                    foreign,
                } => {
                    *work = work
                        .checked_sub(
                            odf.len() * 4 + sheets.iter().map(|s| s.len() * 4 + 32).sum::<usize>(),
                        )
                        .ok_or(super::LIMIT)?;
                    if self.external
                        && endpoint(odf, '.')
                            .and_then(|p| p.sheet)
                            .is_some_and(|sheet| {
                                !sheets.iter().any(|s| {
                                    crate::commands::spreadsheet::case_fold::same_name(s, &sheet)
                                })
                            })
                    {
                        let upper = collation::uppercase(excel, work).ok_or(super::LIMIT)?;
                        *value = Expr::Bad(function_names::unknown(&upper));
                        changed = true;
                        continue;
                    }
                    match reference(odf, '.', sheets) {
                        Some(Expr::Reference {
                            excel: normalized,
                            odf: source,
                            foreign: normalized_foreign,
                        }) => {
                            changed |= *excel != normalized
                                || *odf != source
                                || !*foreign && normalized_foreign;
                            *excel = normalized;
                            *odf = source;
                            *foreign |= normalized_foreign;
                        }
                        Some(Expr::Bad(raw)) => {
                            *value = Expr::Bad(raw);
                            changed = true;
                            continue;
                        }
                        _ => {}
                    }
                    if sheet_names.is_none() {
                        let mut names = std::collections::BTreeMap::new();
                        for name in sheets {
                            *work = work.checked_sub(name.len() * 4 + 128).ok_or(super::LIMIT)?;
                            names.insert(
                                crate::commands::spreadsheet::case_fold::sheet_key(name),
                                name.clone(),
                            );
                        }
                        sheet_names = Some(names);
                    }
                    let names = sheet_names.as_ref().unwrap();
                    for source in [excel, odf] {
                        let canonical = rename(source, names, work)?;
                        changed |= canonical != *source;
                        *source = canonical;
                    }
                }
                Expr::Name(name) => {
                    if let Some(declared) = resolve(name, work)? {
                        *name = declared;
                        changed = true;
                    } else if finalize {
                        let upper = collation::uppercase(name, work).ok_or(super::LIMIT)?;
                        *value = Expr::Bad(function_names::unknown(&upper));
                        changed = true;
                    }
                }
                Expr::Bad(_) => changed |= finalize,
                Expr::Array(rows) => pending.extend(rows.iter_mut().flatten()),
                Expr::Call(name, args, _) => {
                    unknown |= function_names::name(name, false).is_none();
                    pending.extend(args);
                }
                Expr::Group(child) | Expr::Unary(_, child) | Expr::Spaced(_, child, _) => {
                    pending.push(child);
                }
                Expr::Binary(op, a, b) => {
                    if op == "[]" {
                        if let Expr::Bad(header) = a.as_ref() {
                            *work = work
                                .checked_sub(
                                    header.len() * 8
                                        + sheets.iter().map(|s| s.len() * 4 + 32).sum::<usize>()
                                        + 256,
                                )
                                .ok_or(super::LIMIT)?;
                            **a = external_prefix(header, sheets);
                        }
                        op.clear();
                        changed = true;
                        pending.push(b.as_mut());
                    } else {
                        pending.extend([a.as_mut(), b.as_mut()]);
                    }
                }
                _ => {}
            }
        }
        if self.external {
            let mut pending = vec![self.expression.as_mut().unwrap()];
            while let Some(value) = pending.pop() {
                *work = work
                    .checked_sub(std::mem::size_of::<Expr>())
                    .ok_or(super::LIMIT)?;
                match value {
                    Expr::Binary(op, left, right) => {
                        let mut first = left.as_ref();
                        let mut last = right.as_ref();
                        while let Expr::Spaced(_, child, _) = first {
                            first = child;
                        }
                        while let Expr::Spaced(_, child, _) = last {
                            last = child;
                        }
                        if op.is_empty()
                            && matches!(first, Expr::Bad(_))
                            && matches!(last, Expr::Name(_))
                        {
                            // Name expansion inserts parentheses, so the preceding
                            // bad token becomes an unknown function call.
                            *op = "()".into();
                            changed = true;
                        }
                        pending.extend([left.as_mut(), right.as_mut()]);
                    }
                    Expr::Call(_, args, _) => pending.extend(args),
                    Expr::Group(child) | Expr::Unary(_, child) | Expr::Spaced(_, child, _) => {
                        pending.push(child)
                    }
                    _ => {}
                }
            }
            self.error =
                self.token_error
                    .or(self.expression.as_ref().unwrap().adjacency_error(work)?);
        }
        if changed {
            let expression = self.expression.as_ref().unwrap();
            self.excel = expression.render(Syntax::Excel, work)?;
            self.display = Some(expression.render(Syntax::Calc, work)?);
            self.openformula = if expression.foreign() {
                Some(format!(
                    "of:={}",
                    expression.render(Syntax::Calculation, work)?
                ))
            } else {
                None
            };
        }
        Ok(unknown)
    }

    #[cfg(test)]
    pub(super) fn group(
        &mut self,
        source: &str,
        row: usize,
        array: bool,
        previous: Option<&Group>,
        work: &mut usize,
    ) -> Result<Option<Group>, &'static str> {
        let Some(expression) = self.expression.as_mut().filter(|_| self.error.is_none()) else {
            return Ok(None);
        };
        let mut retained = std::mem::size_of::<(usize, Group)>();
        let mut rewritten = self.separators;
        let mut pending = vec![&*expression];
        while let Some(value) = pending.pop() {
            *work = work
                .checked_sub(std::mem::size_of::<Expr>() + 32)
                .ok_or(super::LIMIT)?;
            let bytes = match value {
                Expr::Array(_) => return Ok(None),
                Expr::Literal(s) | Expr::Name(s) | Expr::Bad(s) => s.len(),
                Expr::Reference { excel, odf, .. } => excel.len() + odf.len(),
                Expr::Call(name, args, _) => {
                    rewritten |= matches!(
                        (name.as_str(), args.len()),
                        ("NORMDIST" | "GAMMADIST", 3)
                            | ("LOGINV" | "LOGNORMDIST", 1 | 2)
                            | ("POISSON", 2)
                    );
                    pending.extend(args);
                    name.len()
                }
                Expr::Group(child) | Expr::Unary(_, child) => {
                    pending.push(child);
                    0
                }
                Expr::Spaced(before, child, after) => {
                    pending.push(child);
                    before.len() + after.len()
                }
                Expr::Binary(op, a, b) => {
                    pending.extend([a.as_ref(), b.as_ref()]);
                    op.len()
                }
                _ => 0,
            };
            *work = work.checked_sub(bytes).ok_or(super::LIMIT)?;
            retained += std::mem::size_of::<Expr>() + bytes;
        }
        let mut first = row;
        let mut changed = false;
        if !self.external
            && let Some(previous) = previous.filter(|p| p.row + 1 == row && p.rewritten)
            && let Some(source) = source
                .strip_prefix("{urn:oasis:names:tc:opendocument:xmlns:of:1.2}")
                .or_else(|| source.strip_prefix("{http://openoffice.org/2004/calc}"))
        {
            // Calc first compares the original text with the previous cell's
            // compiled spelling, including rewritten separators and optional
            // arguments. Reversing these rows does not qualify for this reuse.
            *work = work.checked_sub(previous.retained).ok_or(super::LIMIT)?;
            let mut candidate = previous.expression.clone();
            let mut candidate_size = previous.retained;
            let mut pending = vec![&mut candidate];
            while let Some(value) = pending.pop() {
                *work = work.checked_sub(32).ok_or(super::LIMIT)?;
                match value {
                    Expr::Reference { excel, odf, .. } => {
                        for text in [excel, odf] {
                            let split = range_split(text);
                            let (first, last) = split.map_or((text.as_str(), None), |i| {
                                (&text[..i], Some(&text[i + 1..]))
                            });
                            let mut parts = Vec::new();
                            for raw in std::iter::once(first).chain(last) {
                                let digits = raw.trim_end_matches(|c: char| c.is_ascii_digit());
                                let shifted = if !digits.ends_with('$')
                                    && let Ok(row) = raw[digits.len()..].parse::<u64>()
                                {
                                    format!("{digits}{}", row + 1)
                                } else {
                                    raw.to_owned()
                                };
                                *work = work.checked_sub(shifted.len() + 32).ok_or(super::LIMIT)?;
                                parts.push(shifted);
                            }
                            candidate_size -= text.len();
                            *text = parts.join(":");
                            candidate_size += text.len();
                        }
                    }
                    Expr::Call(_, args, _) => pending.extend(args),
                    Expr::Group(child) | Expr::Unary(_, child) | Expr::Spaced(_, child, _) => {
                        pending.push(child)
                    }
                    Expr::Binary(_, a, b) => pending.extend([a.as_mut(), b.as_mut()]),
                    _ => {}
                }
            }
            if candidate.render(Syntax::CompiledCalculation, work)?
                == source.strip_prefix('=').unwrap_or(source)
            {
                *expression = candidate;
                retained = candidate_size;
                first = previous.first;
                rewritten = previous.rewritten;
                changed = true;
            }
        }
        let numeric_hash = if self.external {
            None
        } else {
            Some(expression.numeric_hash(work)?)
        };
        if !changed
            && !array
            && let Some(previous) =
                previous.filter(|p| p.row + 1 == row && p.numeric_hash == numeric_hash)
            && expression.same_group(&previous.expression, work)?
        {
            first = previous.first;
            // Calc shares the previous scalar token array after hash and
            // approximate numeric comparison; matrices are never shareable.
            let mut pending = vec![(expression, &previous.expression)];
            while let Some((current, prior)) = pending.pop() {
                *work = work.checked_sub(32).ok_or(super::LIMIT)?;
                match (current, prior) {
                    (Expr::Number(a, _), Expr::Number(b, _)) => {
                        changed |= a.to_bits() != b.to_bits();
                        *a = *b;
                    }
                    (Expr::Call(_, a, _), Expr::Call(_, b, _)) => {
                        pending.extend(a.iter_mut().zip(b))
                    }
                    (Expr::Group(a), Expr::Group(b)) | (Expr::Unary(_, a), Expr::Unary(_, b)) => {
                        pending.push((a, b));
                    }
                    (Expr::Spaced(a, child, b), Expr::Spaced(c, prior, d)) => {
                        *work = work.checked_sub(c.len() + d.len()).ok_or(super::LIMIT)?;
                        changed |= a != c || b != d;
                        a.clone_from(c);
                        b.clone_from(d);
                        pending.push((child, prior));
                    }
                    (Expr::Binary(_, a, b), Expr::Binary(_, c, d)) => {
                        pending.extend([(a.as_mut(), c.as_ref()), (b.as_mut(), d.as_ref())]);
                    }
                    _ => {}
                }
            }
        }
        if changed {
            let expression = self.expression.as_ref().unwrap();
            self.excel = expression.render(Syntax::Excel, work)?;
            if self.display.is_some() {
                self.display = Some(expression.render(Syntax::Calc, work)?);
            }
            self.openformula = if expression.foreign() {
                Some(format!(
                    "of:={}",
                    expression.render(Syntax::Calculation, work)?
                ))
            } else {
                None
            };
        }
        Ok(self.expression.take().map(|expression| Group {
            row,
            first,
            expression,
            numeric_hash,
            rewritten,
            retained,
        }))
    }
}

impl Expr {
    #[cfg(test)]
    fn numeric_hash(&self, work: &mut usize) -> Result<u64, &'static str> {
        // GenHash visits the first 20 lexical tokens. For expressions that
        // pass same_group, all nonnumeric contributions are equal and cancel.
        // Keep its wrapping arithmetic, including possible numeric collisions.
        let mut pending = vec![Some(self)];
        let mut hash = 0u64;
        let mut tokens = 0;
        while tokens < 20 {
            let Some(value) = pending.pop() else { break };
            *work = work.checked_sub(32).ok_or(super::LIMIT)?;
            let number = match value {
                Some(Self::Number(n, percent)) => {
                    if *percent {
                        pending.push(None);
                    }
                    Some(*n)
                }
                Some(Self::Literal(s)) => s.parse::<f64>().ok(),
                Some(Self::Group(child)) => {
                    pending.extend([None, Some(child.as_ref()), None]);
                    continue;
                }
                Some(Self::Unary('%', child)) => {
                    pending.extend([None, Some(child.as_ref())]);
                    continue;
                }
                Some(Self::Unary(_, child)) => {
                    pending.extend([Some(child.as_ref()), None]);
                    continue;
                }
                Some(Self::Binary(_, a, b)) => {
                    pending.extend([Some(b.as_ref()), None, Some(a.as_ref())]);
                    continue;
                }
                Some(Self::Spaced(before, child, after)) => {
                    *work = work
                        .checked_sub(before.len() + after.len())
                        .ok_or(super::LIMIT)?;
                    pending.extend(
                        after
                            .as_bytes()
                            .chunk_by(|a, b| a == b)
                            .take(20)
                            .map(|_| None),
                    );
                    pending.push(Some(child));
                    pending.extend(
                        before
                            .as_bytes()
                            .chunk_by(|a, b| a == b)
                            .take(20)
                            .map(|_| None),
                    );
                    continue;
                }
                Some(Self::Call(_, args, _)) => {
                    *work = work.checked_sub(args.len() * 32).ok_or(super::LIMIT)?;
                    pending.push(None);
                    for (index, arg) in args.iter().enumerate().rev() {
                        pending.push(Some(arg));
                        if index > 0 {
                            pending.push(None);
                        }
                    }
                    pending.extend([None, None]);
                    continue;
                }
                _ => None,
            };
            if let Some(number) = number {
                hash =
                    hash.wrapping_add(crate::commands::spreadsheet::formulas::number_hash(number));
            }
            hash = hash.wrapping_mul(15);
            tokens += 1;
        }
        Ok(hash)
    }

    #[cfg(test)]
    fn same_group(&self, previous: &Self, work: &mut usize) -> Result<bool, &'static str> {
        let mut pending = vec![(self, previous)];
        while let Some((current, prior)) = pending.pop() {
            *work = work.checked_sub(32).ok_or(super::LIMIT)?;
            match (current, prior) {
                (Self::Omitted, Self::Omitted) | (Self::OmittedZero, Self::OmittedZero) => {}
                (Self::Number(a, p), Self::Number(b, q))
                    if p == q
                        && crate::commands::spreadsheet::formulas::approximately_equal(*a, *b) => {}
                (Self::Literal(a), Self::Literal(b))
                | (Self::Name(a), Self::Name(b))
                | (Self::Bad(a), Self::Bad(b))
                    if a == b => {}
                (Self::Reference { odf: a, .. }, Self::Reference { odf: b, .. }) => {
                    *work = work
                        .checked_sub((a.len() + b.len()) * 2 + 4 * std::mem::size_of::<Endpoint>())
                        .ok_or(super::LIMIT)?;
                    let parts = |s: &str| {
                        let split = range_split(s);
                        let (first, last) =
                            split.map_or((s, None), |i| (&s[..i], Some(&s[i + 1..])));
                        std::iter::once(first)
                            .chain(last)
                            .map(|s| endpoint(s, '.'))
                            .collect::<Option<Vec<_>>>()
                    };
                    let (Some(a), Some(b)) = (parts(a), parts(b)) else {
                        return Ok(false);
                    };
                    if a.len() != b.len() {
                        return Ok(false);
                    }
                    for (a, b) in a.iter().zip(&b) {
                        if a.sheet != b.sheet || a.relative != b.relative {
                            return Ok(false);
                        }
                        match (a.position, b.position) {
                            (Some((ar, ac)), Some((br, bc))) => {
                                let row_fixed = |cell: &str| {
                                    cell.strip_prefix('$').unwrap_or(cell).contains('$')
                                };
                                if ac != bc
                                    || a.cell.starts_with('$') != b.cell.starts_with('$')
                                    || row_fixed(&a.cell) != row_fixed(&b.cell)
                                    || ar != br + u64::from(!row_fixed(&a.cell))
                                {
                                    return Ok(false);
                                }
                            }
                            (None, None) if a.cell == b.cell => {}
                            _ => return Ok(false),
                        }
                    }
                }
                (Self::Call(a, args, omit), Self::Call(b, prior, prior_omit))
                    if a == b && omit == prior_omit && args.len() == prior.len() =>
                {
                    pending.extend(args.iter().zip(prior));
                }
                (Self::Group(a), Self::Group(b)) => pending.push((a, b)),
                (Self::Unary(a, child), Self::Unary(b, prior)) if a == b => {
                    pending.push((child, prior))
                }
                (Self::Spaced(a, child, b), Self::Spaced(c, prior, d))
                    if a.as_bytes()
                        .chunk_by(|a, b| a == b)
                        .map(|s| s[0])
                        .eq(c.as_bytes().chunk_by(|a, b| a == b).map(|s| s[0]))
                        && b.as_bytes()
                            .chunk_by(|a, b| a == b)
                            .map(|s| s[0])
                            .eq(d.as_bytes().chunk_by(|a, b| a == b).map(|s| s[0])) =>
                {
                    pending.push((child, prior))
                }
                (Self::Binary(a, left, right), Self::Binary(b, prior_left, prior_right))
                    if a == b =>
                {
                    pending.extend([
                        (left.as_ref(), prior_left.as_ref()),
                        (right.as_ref(), prior_right.as_ref()),
                    ]);
                }
                _ => return Ok(false),
            }
        }
        Ok(true)
    }
}

pub(in crate::commands) fn convert(
    source: &str,
    legacy: bool,
    limit: usize,
    display: bool,
) -> Result<Option<Formula>, &'static str> {
    // Retained OpenFormula uses canonical uppercase names for known functions
    // and lowercase names for unknown tokens. Display must preserve that
    // distinction when the input originally used another namespace.
    let normalized = display && source.starts_with("of:=");
    let source = if normalized { &source[4..] } else { source };
    let excel =
        !legacy && source.starts_with("{http://schemas.microsoft.com/office/excel/formula}");
    let separator = if legacy || source.starts_with("{http://openoffice.org/2004/calc}") || excel {
        '!'
    } else {
        '.'
    };
    let source = source
        .strip_prefix("{urn:oasis:names:tc:opendocument:xmlns:of:1.2}")
        .or_else(|| source.strip_prefix("{http://openoffice.org/2004/calc}"))
        .or_else(|| source.strip_prefix("{http://schemas.microsoft.com/office/excel/formula}"))
        .unwrap_or(source);
    let source = source.trim();
    let source = source.strip_prefix('=').unwrap_or(source);
    if source.len() > limit {
        return Err(super::LIMIT);
    }
    let mut parser = Parser {
        source,
        pos: 0,
        nodes: (limit / std::mem::size_of::<Expr>()).min(8192),
        limited: false,
        work: limit,
        sheet_separator: separator,
        legacy,
        excel,
        normalized,
        arrays: 0,
        in_array: false,
        has_bindings: false,
        separators: false,
        error: None,
    };
    let expression = parser.expression(u8::from(!excel), 0, false);
    if parser.limited {
        return Err(super::LIMIT);
    }
    parser.space();
    let Some(mut expression) = expression.filter(|_| parser.pos == source.len()) else {
        return Ok(Some(Formula {
            display: None,
            excel: source.into(),
            openformula: None,
            error: Some(
                excel
                    .then_some(parser.error)
                    .flatten()
                    .unwrap_or(if source.is_empty() {
                        "#NAME?"
                    } else {
                        "#VALUE!"
                    }),
            ),
            token_error: parser.error,
            expression: None,
            external: excel,
            has_bindings: parser.has_bindings,
            separators: parser.separators,
        }));
    };
    let leading = &source[..source.len()
        - source
            .trim_start_matches(|c: char| c.is_ascii_whitespace())
            .len()];
    if !leading.is_empty() {
        expression = Expr::Spaced(leading.into(), Box::new(expression), String::new());
    }
    let mut remaining = parser.work;
    let external = excel;
    let excel = expression.render(Syntax::Excel, &mut remaining)?;
    let openformula = if expression.foreign() || parser.separators {
        Some(format!(
            "of:={}",
            expression.render(Syntax::Calculation, &mut remaining)?
        ))
    } else {
        None
    };
    let display = (display || external)
        .then(|| expression.render(Syntax::Calc, &mut remaining))
        .transpose()?;
    Ok(Some(Formula {
        display,
        excel,
        openformula,
        error: parser.error.or(if external {
            expression.adjacency_error(&mut remaining)?
        } else {
            None
        }),
        token_error: parser.error,
        expression: Some(expression),
        external,
        has_bindings: parser.has_bindings,
        separators: parser.separators,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_sheet_ranges_keep_their_original_token() {
        for token in ["$Missing.$A$1:$Third.$C$3", "$'Missing'.$C$4:$'Third'.$A$2"] {
            let source = format!("{{urn:oasis:names:tc:opendocument:xmlns:of:1.2}}=ROW([{token}])");
            let mut parsed = convert(&source, false, 1_000_000, true).unwrap().unwrap();
            parsed
                .resolve_names(
                    &["First".into(), "Third".into()],
                    &mut 1_000_000,
                    true,
                    |_, _| Ok(None),
                )
                .unwrap();
            assert_eq!(parsed.excel, format!("ROW({token})"));
            assert_eq!(parsed.display, Some(format!("ROW({token})")));
        }
    }

    #[test]
    fn reversed_ranges_keep_each_axis_absolute_flags() {
        // LibreOffice 24.8.7.2 normalizes coordinates independently.
        for (source, expected) in [
            ("[.C4:.A2]", "A2:C4"),
            ("[.$C4:.A$2]", "A$2:$C4"),
            ("[.$A4:.C$2]", "$A$2:C4"),
            ("[.C$2:.$A4]", "$A$2:C4"),
            ("[.C$4:.$C4]", "C$4:$C4"),
        ] {
            for namespace in [
                "{urn:oasis:names:tc:opendocument:xmlns:of:1.2}",
                "{http://openoffice.org/2004/calc}",
            ] {
                let source = format!("{namespace}=ROW({source})");
                let parsed = convert(&source, false, 1_000_000, true).unwrap().unwrap();
                assert_eq!(parsed.excel, format!("ROW({expected})"), "{source}");
                assert_eq!(parsed.display, Some(format!("ROW({expected})")));
            }
        }
    }

    #[test]
    fn formula_groups_charge_retained_tokens_and_comparisons() {
        for (namespace, separator) in [
            ("http://schemas.microsoft.com/office/excel/formula", ','),
            ("urn:oasis:names:tc:opendocument:xmlns:of:1.2", ';'),
            ("http://openoffice.org/2004/calc", ';'),
        ] {
            let source = format!(
                "{{{namespace}}}=IF(1{separator}{}1.7976931348623155e308%{separator}\"{}\")",
                "0+".repeat(10),
                "x".repeat(1024)
            );
            for (limit, succeeds) in [(4096, false), (1048576, true)] {
                let mut work = limit;
                let mut previous = None;
                let result = (0..32).try_for_each(|row| {
                    let mut parsed = convert(&source, false, 65536, false)?.unwrap();
                    previous = parsed.group(&source, row, false, previous.as_ref(), &mut work)?;
                    Ok::<_, &str>(())
                });
                assert_eq!(result.is_ok(), succeeds, "{namespace} {limit}");
            }
        }
    }

    #[test]
    fn boolean_tokens_follow_native_formula_and_array_syntax() {
        for (source, expected) in [
            ("TRUE", "TRUE()"),
            ("fAlSe", "FALSE()"),
            ("IF(TRUE;FALSE;TRUE)", "IF(TRUE(),FALSE(),TRUE())"),
            ("TRUE+FALSE", "TRUE()+FALSE()"),
            ("(TRUE)", "(TRUE())"),
            ("SUM( TRUE ; FALSE )", "SUM( TRUE() , FALSE() )"),
            ("{TRUE;FALSE}", "{TRUE,FALSE}"),
            ("{TRUE;FALSE|1;0}", "{TRUE,FALSE;1,0}"),
            ("IF({TRUE;FALSE};1;0)", "IF({TRUE,FALSE},1,0)"),
            ("{(TRUE);FALSE}", "{(TRUE),FALSE}"),
            ("{TRUE+FALSE;FALSE}", "{TRUE+FALSE,FALSE}"),
            ("\"TRUE\"", "\"TRUE\""),
            ("TRUE1", "TRUE1"),
        ] {
            let result = convert(source, false, 65536, true).unwrap().unwrap();
            assert_eq!(result.excel, expected, "{source}");
            assert_eq!(result.display.as_deref(), Some(expected), "{source}");
        }
        for namespace in [
            "http://openoffice.org/2004/calc",
            "http://schemas.microsoft.com/office/excel/formula",
        ] {
            for (source, expected) in [
                ("TRUE", "1"),
                ("FALSE", "0"),
                ("TRUE()", "TRUE()"),
                ("{TRUE}", "{TRUE}"),
            ] {
                let source = format!("{{{namespace}}}={source}");
                assert_eq!(
                    convert(&source, false, 65536, true).unwrap().unwrap().excel,
                    expected
                );
            }
        }
        assert!(convert("TRUE", false, 1, true).is_err());
    }

    #[test]
    fn renamed_references_preserve_literal_strings_and_escaping() {
        let changes = std::collections::BTreeMap::from([
            (
                crate::commands::spreadsheet::case_fold::sheet_key("Old's"),
                "New's".into(),
            ),
            (
                crate::commands::spreadsheet::case_fold::sheet_key("Other"),
                "Short".into(),
            ),
        ]);
        let source = "of:=IF(1;[$'Old''s'.$A$1:$'Other'.$B$2];INDIRECT(\"'Old''s'!A1\"))";
        assert_eq!(
            rename(source, &changes, &mut 4096).unwrap(),
            "of:=IF(1;[$'New''s'.$A$1:$'Short'.$B$2];INDIRECT(\"'Old''s'!A1\"))"
        );
        let source = "SUM('Old''s':'Other'!A1:B2)+\"\"\"'Old''s'\"";
        assert_eq!(
            rename(source, &changes, &mut 4096).unwrap(),
            "SUM('New''s':'Short'!A1:B2)+\"\"\"'Old''s'\""
        );
        assert!(rename(source, &changes, &mut 1).is_err());
    }

    #[test]
    fn omitted_separator_operands_respect_the_parser_node_limit() {
        for (prefix, separator) in [
            ("of:=", ";"),
            ("{http://schemas.microsoft.com/office/excel/formula}=", ","),
        ] {
            let source = format!("{prefix}({})", separator.repeat(9000));
            assert!(matches!(
                convert(&source, false, 16 * 1024 * 1024, true),
                Err(super::super::LIMIT)
            ));
        }
    }

    #[test]
    fn separator_compilation_bounds_repeated_named_range_expansion() {
        let names: Vec<_> = (0..18)
            .map(
                |index| crate::commands::spreadsheet::model::NamedExpression {
                    name: format!("Range_{index}"),
                    sheet: None,
                    expression: String::new(),
                    openformula: Some(if index == 0 {
                        "of:=[.$A$1]".into()
                    } else {
                        format!("of:=(Range_{};Range_{})", index - 1, index - 1)
                    }),
                    position: (0, 0, 0),
                    compiled: None,
                },
            )
            .collect();
        for source in [
            "of:=SUM((Range_17;Range_17))",
            "{http://schemas.microsoft.com/office/excel/formula}=SUM((Range_17,Range_17))",
            "{http://schemas.microsoft.com/office/excel/formula}=SUM(foo Range_17)",
        ] {
            let mut formula = convert(source, false, 65536, true).unwrap().unwrap();
            let declared = names
                .iter()
                .map(|n| ((None, n.name.to_uppercase()), n.name.as_str()))
                .collect();
            formula
                .bind_names(&declared, 0, &["First".into()], &mut 65536)
                .unwrap();
            assert_eq!(
                formula.compile_separators(&names, &["First".into()], 0, None, &mut 65536),
                Err(super::super::LIMIT)
            );
        }
    }

    #[test]
    fn index_preserves_a_sheet_span_as_one_reference() {
        let source = "{urn:oasis:names:tc:opendocument:xmlns:of:1.2}=INDEX([$Sheet0.$A$1:$Sheet199.$C$3];2;2;100)";
        let parsed = convert(source, false, 1024, false).unwrap().unwrap();
        assert_eq!(parsed.excel, "INDEX('Sheet0':'Sheet199'!$A$1:$C$3,2,2,100)");
        assert_eq!(
            parsed.openformula.as_deref(),
            Some("of:=INDEX([$Sheet0.$A$1:$Sheet199.$C$3];2;2;100)")
        );
        assert!(matches!(
            convert(source, false, 16, false),
            Err(super::super::LIMIT)
        ));
    }
}

#[path = "office_formula_basis.rs"]
mod basis;
#[path = "office_formula_bessel.rs"]
mod bessel;
#[path = "office_formula_clock.rs"]
pub(super) mod clock;
#[path = "office_formula_complex.rs"]
mod complex;
#[path = "office_formula_higher_order.rs"]
mod higher_order;
#[path = "office_formula_lambda.rs"]
mod lambda;
#[path = "office_formula_let.rs"]
mod let_bindings;
#[path = "office_formula_regex.rs"]
mod regex;
#[path = "office_formula_to_text.rs"]
mod to_text;
#[path = "office_formula_width.rs"]
mod width;
pub(super) use let_bindings::{lexical_tokens, xlsx_variables};
#[path = "office_formula_array_shape.rs"]
mod array_shape;
#[path = "office_formula_cashflow.rs"]
mod cashflow;
#[path = "office_formula_convert.rs"]
mod convert;
#[path = "office_formula_date_difference.rs"]
pub(super) mod date_difference;
#[path = "office_formula_date_text.rs"]
pub(super) mod date_text;
#[path = "office_formula_dynamic_functions.rs"]
mod dynamic_functions;
#[path = "office_formula_expand.rs"]
mod expand;
#[path = "office_formula_filter.rs"]
mod filter;
#[path = "office_formula_finance.rs"]
mod finance;
#[path = "office_formula_math.rs"]
mod mathematics;
#[path = "office_formula_matrix.rs"]
mod matrix_functions;
#[path = "office_formula_number_text.rs"]
mod number_text;
#[path = "office_formula_text_format.rs"]
mod text_format;
#[path = "office_formula_text_split.rs"]
mod text_split;
#[path = "office_formula_textjoin.rs"]
mod textjoin;
#[path = "office_formula_trimrange.rs"]
mod trimrange;
#[path = "office_formula_wrap.rs"]
mod wrap;
#[cfg(test)]
use super::date_serial;
use super::decimal;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

type Coord = (usize, usize, usize);
use crate::commands::spreadsheet::model::Workbook;
#[path = "office_formula_operators.rs"]
mod operators;
#[path = "office_formula_references.rs"]
mod references;
pub(in crate::commands) use operators::xlsx_export_names;
pub(super) use operators::xlsx_operators;
use references::Reference;
#[path = "office_formula_tables.rs"]
mod tables;
pub use tables::{TableReferenceMap, map_table_references, table_to_range_references};
#[path = "office_formula_names.rs"]
mod names;
pub(super) use names::{name_references, xlsx_bound_name};
pub(super) use tables::{qualify_columns, rewrite_columns};
#[path = "office_formula_aggregate.rs"]
mod aggregate;
#[path = "office_formula_choose.rs"]
mod choose;
#[path = "office_formula_conditional.rs"]
mod conditional;
#[path = "office_formula_database.rs"]
mod database;
#[path = "office_formula_dates.rs"]
mod dates;
#[path = "office_formula_descriptive.rs"]
mod descriptive;
#[path = "office_formula_euro.rs"]
mod euro;
#[path = "office_formula_index.rs"]
mod index;
#[path = "office_formula_information.rs"]
mod information;
#[path = "office_formula_lifetime.rs"]
mod lifetime;
#[path = "office_formula_logical.rs"]
mod logical;
#[path = "office_formula_lookup.rs"]
mod lookup;
#[path = "office_formula_order_statistics.rs"]
mod order_statistics;
#[path = "office_formula_paired_statistics.rs"]
mod paired_statistics;
#[path = "office_formula_pivot.rs"]
mod pivot;
#[path = "office_formula_reference_functions.rs"]
mod reference_functions;
#[path = "office_formula_regression.rs"]
pub(super) mod regression;
#[path = "office_formula_format.rs"]
mod result_format;
#[path = "office_formula_round.rs"]
mod rounding;
#[path = "office_formula_series.rs"]
mod series;
#[path = "office_formula_statistics.rs"]
mod statistics;
#[path = "office_formula_strings.rs"]
mod strings;
#[path = "office_formula_subtotal.rs"]
mod subtotal;
#[path = "office_formula_sum.rs"]
mod summation;
#[path = "office_formula_workdays.rs"]
mod workdays;
use result_format::{Format, Kind as FormatKind};
#[path = "office_formula_spill.rs"]
mod spill;
#[path = "office_formula_validation.rs"]
pub(super) mod validation;
#[path = "office_formula_workbook.rs"]
mod workbook;
pub(super) use spill::SpillCache;
pub(in crate::commands) use workbook::{cache, resolve_pivot_source, xlsx_recalculate};

pub(super) const LITERAL_ERRORS: [&str; 12] = [
    "#DIV/0!",
    "#REF!",
    "#VALUE!",
    "#NUM!",
    "#NAME?",
    "#N/A",
    "#NULL!",
    "#SPILL!",
    "#CALC!",
    "#GETTING_DATA",
    "#CIRC!",
    "#ERROR!",
];

#[derive(Clone, Debug, PartialEq)]
pub(in crate::commands) enum Value {
    Blank,
    // Functions can return an explicit empty value; direct references still become zero.
    Empty,
    Omitted,
    Lambda(usize),
    Number(f64),
    Text(String),
    // External ODS array tokens have no case-insensitive shared-string identity.
    UninternedText(String),
    Bool(bool),
    Error(&'static str),
    // Calc keeps literal error tokens distinct until an operation consumes them.
    LiteralError(&'static str),
    // An invalid reference remains a reference until a consumer dereferences it.
    InvalidReference,
    // Invalid axes use usize::MAX; valid axes survive for reference consumers.
    InvalidRange(Coord, Coord),
    Single(Coord),
    Range(Coord, Coord),
    Matrix(Vec<Vec<Value>>),
    Set(Vec<Value>),
}
impl Value {
    fn into_range(self) -> Self {
        match self {
            Self::Single(coord) => Self::Range(coord, coord),
            value => value,
        }
    }
    fn number(n: f64) -> Self {
        if n.is_finite() {
            Self::Number(if n == 0. { 0. } else { n })
        } else {
            Self::Error("#NUM!")
        }
    }
    fn numeric(&self) -> Option<f64> {
        match self {
            Self::Blank | Self::Empty | Self::Omitted => Some(0.),
            Self::Number(n) => Some(*n),
            Self::Bool(b) => Some(u8::from(*b) as f64),
            Self::Text(s) | Self::UninternedText(s) => {
                let s = s.trim();
                if let Some(s) = s.strip_suffix('%') {
                    decimal(s.trim()).map(|n| n / 100.)
                } else {
                    decimal(s)
                }
            }
            _ => None,
        }
    }
    pub(super) fn text(&self) -> String {
        match self {
            Self::Number(n) => super::number_format::number(*n, true),
            Self::Bool(b) => u8::from(*b).to_string(),
            Self::Text(s) | Self::UninternedText(s) => s.clone(),
            Self::Error(s) | Self::LiteralError(s) => (*s).into(),
            Self::InvalidReference | Self::InvalidRange(..) => "#REF!".into(),
            _ => String::new(),
        }
    }
    pub(in crate::commands) fn cached(&self) -> String {
        match self {
            Self::Blank | Self::Empty => "0".into(),
            Self::Number(n) if *n != 0. && !(1e-6..1e21).contains(&n.abs()) => {
                let scientific = format!("{n:e}");
                let (mantissa, exponent) = scientific.split_once('e').unwrap();
                let exponent: i32 = exponent.parse().unwrap();
                format!("{mantissa}e{exponent:+}")
            }
            Self::Number(n) => n.to_string(),
            Self::Bool(b) => u8::from(*b).to_string(),
            _ => self.text(),
        }
    }
}

#[derive(PartialEq)]
pub(super) enum Expr {
    Value(Value),
    Ref(Reference),
    Range(Reference, Reference),
    Name(usize),
    Local(usize),
    Lambda(Vec<bool>, Arc<Expr>),
    Invoke(Box<Expr>, Vec<Expr>),
    Group(Box<Expr>),
    Unary(u8, Box<Expr>),
    Binary(&'static str, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
    MatrixCell(std::sync::Arc<Expr>, Coord),
}
impl Expr {
    // Dynamic-only functions also identify modern formulas in XLSX files whose
    // producers omit Excel's optional dynamic-array metadata. Inspect the AST,
    // so quoted text, local bindings and named expressions keep their meaning.
    fn dynamic_arrays(&self, names: &[Arc<Expr>], work: &mut usize) -> Option<bool> {
        let mut pending = vec![self];
        let mut visited = BTreeSet::new();
        while let Some(expr) = pending.pop() {
            *work = work.checked_sub(64)?;
            match expr {
                Self::Lambda(..) | Self::Invoke(..) => return Some(true),
                Self::Call(name, args) => {
                    if matches!(
                        name.as_str(),
                        "SEQUENCE"
                            | "RANDARRAY"
                            | "FILTER"
                            | "SORT"
                            | "SORTBY"
                            | "UNIQUE"
                            | "TAKE"
                            | "DROP"
                            | "CHOOSECOLS"
                            | "CHOOSEROWS"
                            | "HSTACK"
                            | "VSTACK"
                            | "TOCOL"
                            | "TOROW"
                            | "WRAPROWS"
                            | "WRAPCOLS"
                            | "EXPAND"
                            | "TRIMRANGE"
                            | "TEXTSPLIT"
                            | "TEXTBEFORE"
                            | "TEXTAFTER"
                            | "LET"
                            | "MAP"
                            | "REDUCE"
                            | "SCAN"
                            | "BYROW"
                            | "BYCOL"
                            | "MAKEARRAY"
                            | "ANCHORARRAY"
                    ) {
                        return Some(true);
                    }
                    *work =
                        work.checked_sub(args.len().checked_mul(std::mem::size_of::<&Expr>())?)?;
                    pending.extend(args);
                }
                Self::Name(index) if visited.insert(*index) => pending.push(names.get(*index)?),
                Self::Group(child) | Self::Unary(_, child) => pending.push(child),
                Self::Binary(_, a, b) => pending.extend([a.as_ref(), b.as_ref()]),
                _ => {}
            }
        }
        Some(false)
    }

    pub(super) fn same_xlsx_group(&self, other: &Self, work: &mut usize) -> Option<bool> {
        let mut pending = vec![(self, other)];
        while let Some((left, right)) = pending.pop() {
            *work = work.checked_sub(64)?;
            match (left, right) {
                (Self::Value(Value::Number(a)), Self::Value(Value::Number(b))) => {
                    if !approximately_equal(*a, *b) {
                        return Some(false);
                    }
                }
                (Self::Lambda(a, left), Self::Lambda(b, right)) if a == b => {
                    pending.push((left, right))
                }
                (Self::Invoke(a, left), Self::Invoke(b, right)) if left.len() == right.len() => {
                    pending.push((a, b));
                    pending.extend(left.iter().zip(right));
                }
                (Self::Group(a), Self::Group(b)) => pending.push((a, b)),
                (Self::Unary(a, left), Self::Unary(b, right)) if a == b => {
                    pending.push((left, right))
                }
                (Self::Binary(a, x, y), Self::Binary(b, u, v)) if a == b => {
                    pending.extend([(x.as_ref(), u.as_ref()), (y.as_ref(), v.as_ref())]);
                }
                (Self::Call(a, left), Self::Call(b, right))
                    if a == b && left.len() == right.len() =>
                {
                    pending.extend(left.iter().zip(right));
                }
                _ if left == right => {}
                _ => return Some(false),
            }
        }
        Some(true)
    }

    fn compiled_error(
        &self,
        names: &[Arc<Expr>],
        work: &mut usize,
    ) -> Option<Option<&'static str>> {
        let mut pending = vec![(self, None)];
        let mut active = BTreeSet::new();
        let mut visited = BTreeSet::new();
        while let Some((expression, leaving)) = pending.pop() {
            *work = work.checked_sub(64)?;
            if let Some(index) = leaving {
                active.remove(&index);
                visited.insert(index);
                continue;
            }
            match expression {
                Self::Value(Value::Error(error)) if error.starts_with("Err:") => {
                    return Some(Some(error));
                }
                Self::Name(index) if !visited.contains(index) => {
                    *work = work.checked_sub(128)?;
                    if !active.insert(*index) {
                        return Some(Some("Err:514"));
                    }
                    pending.push((expression, Some(*index)));
                    pending.push((names.get(*index)?, None));
                }
                Self::MatrixCell(child, _) => pending.push((child, None)),
                Self::Group(child) | Self::Unary(_, child) => pending.push((child, None)),
                Self::Binary(_, a, b) => {
                    pending.push((b, None));
                    pending.push((a, None));
                }
                Self::Invoke(callee, args) => {
                    pending.extend(args.iter().rev().map(|arg| (arg, None)));
                    pending.push((callee, None));
                }
                Self::Call(_, args) => pending.extend(args.iter().rev().map(|arg| (arg, None))),
                _ => {}
            }
        }
        Some(None)
    }

    fn compiled_logical(&self, names: &[std::sync::Arc<Expr>], work: &mut usize) -> Option<bool> {
        let mut pending = vec![self];
        while let Some(expr) = pending.pop() {
            *work = work.checked_sub(std::mem::size_of::<&Expr>() * 2 + 1)?;
            match expr {
                // Calc's compiler takes the format of the first function it
                // encounters, before compiling its arguments. Literals and
                // references do not select a format; groups/unary operators pass through.
                Self::Call(name, _) => {
                    return Some(matches!(
                        name.as_str(),
                        "AND"
                            | "OR"
                            | "XOR"
                            | "NOT"
                            | "TRUE"
                            | "FALSE"
                            | "ISBLANK"
                            | "ISTEXT"
                            | "ISNONTEXT"
                            | "ISLOGICAL"
                            | "ISREF"
                            | "ISNUMBER"
                            | "ISFORMULA"
                            | "ISNA"
                            | "ISERR"
                            | "ISERROR"
                            | "ISEVEN"
                            | "ISODD"
                            | "EXACT"
                    ));
                }
                Self::Binary(_, a, b) => {
                    pending.push(b);
                    pending.push(a);
                }
                Self::Unary(_, child) | Self::Group(child) => pending.push(child),
                Self::Name(index) => pending.push(names.get(*index)?),
                _ => {}
            }
        }
        Some(false)
    }
}
struct Parser<'a, S> {
    source: &'a str,
    nodes: usize,
    limited: bool,
    error: Option<&'static str>,
    // A bare hash/dollar retains the rest as one bad token and closes calls.
    raw_tail: bool,
    arrays: usize,
    uninterned_arrays: bool,
    sheets: S,
    names: &'a [crate::commands::spreadsheet::model::NamedExpression],
    tables: &'a [crate::commands::spreadsheet::model::Table],
    bindings: Option<&'a BTreeMap<String, Option<usize>>>,
    operators: Vec<(usize, usize, char)>,
    name_stack: Vec<usize>,
    locals: Vec<String>,
    lambda_depth: usize,
    local_tokens: Option<Vec<(usize, usize)>>,
    name_tokens: Option<Vec<(usize, usize, Option<usize>)>>,
    export_names: Option<Vec<usize>>,
    position: (usize, i64, i64),
    scope: Option<usize>,
    odf: bool,
    xlsx: bool,
    csv: bool,
    editor: bool,
    r1c1: bool,
    sizes: &'a [(usize, usize)],
}
impl<'a, S> Parser<'a, S>
where
    S: Iterator<Item = &'a str> + Clone,
{
    fn space(&mut self) {
        self.source = self
            .source
            .trim_start_matches(|c: char| c.is_whitespace() && (!self.xlsx || c.is_ascii()));
    }
    fn take(&mut self, token: &str) -> bool {
        if let Some(rest) = self
            .source
            .trim_start_matches(|c: char| c.is_whitespace() && (!self.xlsx || c.is_ascii()))
            .strip_prefix(token)
        {
            self.source = rest;
            true
        } else {
            self.raw_tail && self.source.is_empty() && token == ")"
        }
    }
    fn word(&mut self) -> &'a str {
        self.space();
        if self.xlsx
            && let Some(name) = super::xlsx_import::space_name(self.source)
        {
            self.source = &self.source[name.len()..];
            return name;
        }
        let question = self.xlsx && self.source.starts_with('?');
        let len = self
            .source
            .chars()
            .take_while(|c| {
                c.is_alphanumeric()
                    || "_$.".contains(*c)
                    || question && matches!(c, '?' | '!')
                    || self.r1c1 && "[]+-".contains(*c)
            })
            .map(char::len_utf8)
            .sum();
        let (word, rest) = self.source.split_at(len);
        self.source = rest;
        word
    }
    fn string(&mut self, quote: char) -> Option<String> {
        if !self.source.starts_with(quote) {
            return None;
        }
        let original = self.source;
        self.source = &self.source[1..];
        let mut out = String::new();
        loop {
            let end = self.source.find(quote)?;
            out.push_str(&self.source[..end]);
            self.source = &self.source[end + 1..];
            if !self.source.starts_with(quote) {
                return Some(if quote == '\'' {
                    original[..original.len() - self.source.len()].into()
                } else {
                    out
                });
            }
            out.push(quote);
            self.source = &self.source[1..];
        }
    }
    fn expression(&mut self, minimum: u8, depth: usize, stop_separator: bool) -> Option<Expr> {
        if depth > 96 || self.nodes == 0 {
            self.limited = true;
            return None;
        }
        self.nodes -= 1;
        self.space();
        if self.xlsx && self.source.starts_with('~') {
            self.error.get_or_insert("Err:510");
            return None;
        }
        if depth > 0 && self.source.starts_with(')') && self.export_names.is_none() {
            self.error.get_or_insert("Err:511");
            return None;
        }
        if self.export_names.is_some() && minimum > 7 && self.source.starts_with(['+', '-']) {
            return None;
        }
        let mut left = if self.export_names.is_some() && self.source.starts_with([',', ')']) {
            Expr::Value(Value::Blank)
        } else if (self.editor || self.local_tokens.is_some()) && self.take("@") {
            // Excel's explicit intersection binds a reference before arithmetic.
            // Keep the operand span for XLSX export, using this same parser.
            let start = self.source.len() + 1;
            let child = self.expression(8, depth + 1, stop_separator)?;
            if self.local_tokens.is_some() {
                self.operators.push((start, start - self.source.len(), '@'));
            }
            Expr::Call("_xlfn.SINGLE".into(), vec![child])
        } else if self.take("+") {
            Expr::Unary(
                b'+',
                Box::new(self.expression(6, depth + 1, stop_separator)?),
            )
        } else if self.take("-") {
            Expr::Unary(
                b'-',
                Box::new(self.expression(6, depth + 1, stop_separator)?),
            )
        } else if self.take("(") {
            let mut node = if self.export_names.is_some() {
                self.expression(0, depth + 1, false)?
            } else if (self.odf || self.xlsx)
                && self
                    .source
                    .trim_start_matches(|c: char| c.is_whitespace() && (!self.xlsx || c.is_ascii()))
                    .starts_with(if self.odf { ';' } else { ',' })
            {
                Expr::Value(Value::Blank)
            } else {
                self.expression(0, depth + 1, self.xlsx || self.odf)?
            };
            while (self.xlsx || self.odf)
                && self.export_names.is_none()
                && self
                    .source
                    .trim_start_matches(|c: char| c.is_whitespace() && (!self.xlsx || c.is_ascii()))
                    .starts_with(if self.odf { ';' } else { ',' })
            {
                if self.nodes == 0 {
                    self.limited = true;
                    return None;
                }
                self.nodes -= 1;
                self.space();
                let offset = self.source.len();
                self.source = &self.source[1..];
                let right = if self
                    .source
                    .trim_start_matches(|c: char| c.is_whitespace() && (!self.xlsx || c.is_ascii()))
                    .starts_with([if self.odf { ';' } else { ',' }, ')'])
                {
                    Expr::Value(Value::Blank)
                } else {
                    self.expression(0, depth + 1, true)?
                };
                let union = if (self.xlsx || self.odf) && self.error.is_none() {
                    let mut tokens = Vec::new();
                    let left_valid = self.separator_tokens(&node, &mut tokens, depth + 1)?;
                    let right_valid = self.separator_tokens(&right, &mut tokens, depth + 1)?;
                    left_valid
                        && right_valid
                        && tokens.len().checked_sub(2).is_some_and(|i| {
                            tokens[i] != operators::SeparatorToken::Value
                                && matches!(
                                    tokens[i + 1],
                                    operators::SeparatorToken::Reference
                                        | operators::SeparatorToken::RangeResult
                                )
                        })
                } else {
                    false
                };
                if union {
                    self.operators.push((offset, 1, '~'));
                }
                node = if union && let Expr::Binary(";", extra, previous) = node {
                    Expr::Binary(
                        ";",
                        extra,
                        Box::new(Expr::Binary("~;", previous, Box::new(right))),
                    )
                } else {
                    Expr::Binary(
                        if union { "~;" } else { ";" },
                        Box::new(node),
                        Box::new(right),
                    )
                };
            }
            if !self.take(")") {
                if self.xlsx {
                    self.error.get_or_insert("Err:508");
                }
                return None;
            }
            Expr::Group(Box::new(node))
        } else if self.take("{") {
            if self.arrays > 0 {
                if self.error == Some("Err:539") {
                    self.error = None;
                }
                self.error.get_or_insert("Err:533");
            }
            self.arrays += 1;
            let mut rows: Vec<Vec<Value>> = Vec::new();
            let column = if self.odf { ";" } else { "," };
            let row_separator = if self.odf { "|" } else { ";" };
            loop {
                let mut row = Vec::new();
                loop {
                    self.space();
                    let value = if [column, row_separator, "}"]
                        .iter()
                        .any(|s| self.source.starts_with(s))
                    {
                        self.nodes = self.nodes.checked_sub(1).or_else(|| {
                            self.limited = true;
                            None
                        })?;
                        Value::Empty
                    } else {
                        let names_start = self.export_names.as_ref().map(Vec::len);
                        let element = self.expression(0, depth + 1, true);
                        if self.odf
                            && let (Some(names), Some(start)) =
                                (&mut self.export_names, names_start)
                        {
                            // Matrix elements are compiled into a single token;
                            // their invalid name operands never create exports.
                            names.truncate(start);
                        }
                        match element? {
                            Expr::Value(
                                value @ (Value::Number(_)
                                | Value::Text(_)
                                | Value::UninternedText(_)
                                | Value::Bool(_)),
                            ) => value,
                            Expr::Value(value @ Value::LiteralError(_)) if self.xlsx => value,
                            Expr::Unary(op @ (b'+' | b'-'), child) => {
                                if let Expr::Value(Value::Number(n)) = *child {
                                    Value::Number(if op == b'-' { -n } else { n })
                                } else {
                                    self.error.get_or_insert("Err:539");
                                    Value::Error("Err:539")
                                }
                            }
                            _ => {
                                self.error.get_or_insert("Err:539");
                                Value::Error("Err:539")
                            }
                        }
                    };
                    let value = match value {
                        Value::Text(text) if self.uninterned_arrays => Value::UninternedText(text),
                        other => other,
                    };
                    row.push(value);
                    if !self.take(column) {
                        break;
                    }
                }
                if rows.first().is_some_and(|first| first.len() != row.len()) {
                    self.error.get_or_insert("Err:539");
                    return None;
                }
                rows.push(row);
                if self.take(row_separator) {
                    continue;
                }
                if !self.take("}") {
                    self.error.get_or_insert("Err:539");
                    return None;
                }
                if !self.xlsx
                    && rows
                        .iter()
                        .flatten()
                        .any(|v| matches!(v, Value::Error(_) | Value::LiteralError(_)))
                {
                    self.error.get_or_insert("#N/A");
                }
                self.arrays -= 1;
                break Expr::Value(Value::Matrix(rows));
            }
        } else if let Some(local) = self.local_reference() {
            local
        } else if (self.xlsx || self.editor) && !self.r1c1 && !self.odf && self.take("[0]!") {
            self.space();
            let name = self.word();
            self.reference_or_name(Some("[0]"), name)
        } else if (self.editor || self.local_tokens.is_some())
            && !self.r1c1
            && !self.odf
            && self.source.starts_with(['[', '\''])
            && let Some((prefix, reference)) =
                super::xlsx_references::external_reference(self.source)
        {
            // Retain unresolved external workbook coordinates as a name error,
            // just as quoted external references, rather than rejecting the edit.
            self.source = &self.source[prefix + reference.end..];
            Expr::Value(Value::Error("#NAME?"))
        } else if (self.xlsx || self.editor)
            && !self.r1c1
            && !self.odf
            && let Some(reference) = self.table_reference()
        {
            reference
        } else if self.xlsx
            && !(self.arrays > 0 && self.source.starts_with('#'))
            && let Some(reference) = self.xlsx_reference()
        {
            reference
        } else if self.odf && self.source.starts_with('[') {
            self.bracket_reference()?
        } else if let Some(reference) = self.whole_axis_range() {
            reference
        } else if self.source.starts_with('"') {
            Expr::Value(Value::Text(self.string('"')?))
        } else if self.source.starts_with('#') {
            let token = if self.xlsx {
                super::xlsx_import::error_token(self.source)
            } else {
                self.source
            };
            let error = LITERAL_ERRORS.into_iter().find(|e| {
                if self.xlsx {
                    token.eq_ignore_ascii_case(e)
                } else {
                    token.starts_with(e)
                }
            });
            if let Some(error) = error {
                self.source = &self.source[error.len()..];
                if self.export_names.is_some() {
                    return None;
                }
                Expr::Value(Value::LiteralError(error))
            } else if self.xlsx {
                if token == "#" {
                    self.raw_tail = true;
                    self.source = "";
                } else {
                    self.source = &self.source[token.len()..];
                }
                Expr::Value(Value::Error("#NAME?"))
            } else {
                return None;
            }
        } else if self
            .source
            .as_bytes()
            .first()
            .is_some_and(|b| b.is_ascii_digit() || *b == b'.')
        {
            let end = if self.xlsx {
                let (token, illegal) = super::xlsx_import::number_token(self.source, false);
                if illegal {
                    self.error = Some("Err:501");
                }
                token.len()
            } else {
                let raw = self.source.as_bytes();
                let mut end = 0;
                while raw
                    .get(end)
                    .is_some_and(|b| b.is_ascii_digit() || *b == b'.' || self.odf && *b == b',')
                {
                    end += 1;
                }
                if raw.get(end).is_some_and(|b| matches!(b, b'e' | b'E')) {
                    end += 1;
                    if raw.get(end).is_some_and(|b| matches!(b, b'+' | b'-'))
                        && raw.get(end + 1).is_some_and(u8::is_ascii_digit)
                    {
                        end += 1;
                    }
                    while raw.get(end).is_some_and(u8::is_ascii_digit) {
                        end += 1;
                    }
                }
                end
            };
            let literal = &self.source[..end];
            if literal.contains(',') || literal.parse::<f64>().is_err() {
                self.source = &self.source[end..];
                if self.xlsx {
                    self.reference_or_name(None, literal)
                } else {
                    Expr::Value(Value::Error("#NAME?"))
                }
            } else {
                let number = literal.parse::<f64>().ok()?;
                if !number.is_finite()
                    || number.is_subnormal()
                    || number == 0.
                        && literal
                            .split(['e', 'E'])
                            .next()?
                            .bytes()
                            .any(|b| (b'1'..=b'9').contains(&b))
                {
                    if self.error != Some("Err:533") {
                        self.error = Some("Err:502");
                    }
                }
                self.source = &self.source[end..];
                Expr::Value(Value::Number(number))
            }
        } else {
            let quoted = self.source.starts_with('\'');
            let symbol = self.xlsx && self.source.starts_with(['@', '`', '\\', '|']);
            let name = if self.xlsx
                && let Some(token) = super::xlsx_references::parse(self.source, self.sheets.clone())
                    .filter(|token| {
                        token.unknown
                            && self.source[token.end..]
                                .trim_start_matches(|c: char| {
                                    c.is_whitespace() && (!self.xlsx || c.is_ascii())
                                })
                                .starts_with('(')
                    }) {
                let name = self.source[..token.end].to_owned();
                self.source = &self.source[token.end..];
                name
            } else if quoted {
                self.string('\'')?
            } else if symbol {
                let name = self.source[..1].to_owned();
                self.source = &self.source[1..];
                name
            } else {
                self.word().to_owned()
            };
            if name.is_empty() {
                if self.xlsx && self.source.chars().next().is_some_and(|c| !c.is_ascii()) {
                    self.error.get_or_insert("Err:501");
                }
                return None;
            }
            if !quoted
                && name.ends_with('.')
                && self.source.chars().next().is_some_and(char::is_whitespace)
                && self
                    .source
                    .trim_start_matches(|c: char| c.is_whitespace() && (!self.xlsx || c.is_ascii()))
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_alphanumeric() || "_$'\"[.#".contains(c))
            {
                self.error.get_or_insert("Err:509");
            }
            if self.xlsx && name == "$" {
                self.raw_tail = true;
                self.source = "";
                Expr::Value(Value::Error("#NAME?"))
            } else if !self.odf
                && !symbol
                && let Some(range) = self.sheet_span(&name)
            {
                range
            } else if !symbol
                && !(self.odf && self.export_names.is_some())
                && !(self.xlsx
                    && !quoted
                    && self
                        .source
                        .strip_prefix('!')
                        .is_some_and(|tail| super::xlsx_import::space_name(tail).is_some()))
                && self.take("!")
            {
                self.space();
                if (self.editor || self.local_tokens.is_some())
                    && self.source.starts_with('#')
                    && super::xlsx_import::error_token(self.source).eq_ignore_ascii_case("#REF!")
                {
                    // A deleted Excel reference can retain its sheet qualifier.
                    // It is a value error that IFERROR can catch, not a syntax error.
                    self.source = &self.source[5..];
                    Expr::Value(Value::Error("#REF!"))
                } else {
                    let cell = self.word();
                    self.reference_or_name(Some(&name), cell)
                }
            } else if quoted && self.odf && self.bindings.is_some() && self.take(".") {
                let tail = self.word();
                self.reference_or_name(None, &format!("{name}.{tail}"))
            } else if quoted {
                if self.source.chars().next().is_some_and(char::is_whitespace)
                    && self
                        .source
                        .trim_start_matches(|c: char| {
                            c.is_whitespace() && (!self.xlsx || c.is_ascii())
                        })
                        .starts_with('.')
                {
                    self.error.get_or_insert("Err:501");
                }
                if self.take(".") {
                    self.word();
                }
                Expr::Value(Value::Error("#NAME?"))
            } else if self.xlsx
                && super::coordinate(&name).is_some()
                && super::function_names::imported(&name.to_ascii_uppercase()).is_none()
                && self
                    .source
                    .trim_start_matches(|c: char| c.is_whitespace() && (!self.xlsx || c.is_ascii()))
                    .starts_with('(')
            {
                self.error.get_or_insert("Err:509");
                return None;
            } else if self
                .source
                .trim_start_matches(|c: char| c.is_whitespace() && (!self.xlsx || c.is_ascii()))
                .starts_with('(')
                && (if self.xlsx {
                    super::function_names::imported(&name.to_ascii_uppercase()).is_none()
                } else {
                    super::function_names::name(&name.to_ascii_uppercase(), false).is_none()
                })
                && let node @ Expr::Name(_) = self.reference_or_name(None, &name)
            {
                node
            } else if self.take("(") {
                if self.arrays > 0 {
                    self.error.get_or_insert("Err:539");
                }
                // CSV normalization already distinguishes recognized uppercase
                // functions from unknown names, including foreign prefixes.
                let name = if self.csv {
                    name
                } else if self.xlsx {
                    let upper = name.to_ascii_uppercase();
                    super::function_names::imported(&upper)
                        .map(|(ui, _)| ui.to_owned())
                        .unwrap_or_else(|| super::function_names::unknown(&name))
                } else if self.odf {
                    // ODS import has already canonicalized known functions.
                    // Re-folding lowercase unknown tokens could recognize them
                    // under a different namespace (e.g. legacy bare ACCRINT).
                    super::function_names::imported_ods(&name, false, false)
                        .map(str::to_owned)
                        .unwrap_or_else(|| super::function_names::unknown(&name))
                } else {
                    name.to_ascii_uppercase()
                };
                if self.odf
                    && self.export_names.is_some()
                    && super::function_names::name(&name, false).is_none()
                {
                    return None;
                }
                let iso_week = self.odf && name == "ISOWEEKNUM";
                let name = match name.as_str() {
                    "DAYS" if self.csv || self.xlsx => "_XLFN.DAYS",
                    // Reference rewrites also visit the editor's unprefixed display text.
                    "let" if self.local_tokens.is_some() || self.name_tokens.is_some() => "LET",
                    "lambda" if self.local_tokens.is_some() || self.name_tokens.is_some() => {
                        "LAMBDA"
                    }
                    "COM.MICROSOFT.LET" | "_XLFN.LET" => "LET",
                    _ if self.csv => &name,
                    "ISOWEEKNUM" if iso_week => "WEEKNUM",
                    "COM.MICROSOFT.XLOOKUP" | "_XLFN.XLOOKUP" => "XLOOKUP",
                    "COM.MICROSOFT.XMATCH" | "_XLFN.XMATCH" => "XMATCH",
                    "COM.MICROSOFT.MINIFS" | "_XLFN.MINIFS" => "MINIFS",
                    "COM.MICROSOFT.MAXIFS" | "_XLFN.MAXIFS" => "MAXIFS",
                    "COM.MICROSOFT.NETWORKDAYS.INTL" | "_XLFN.NETWORKDAYS.INTL" => {
                        "NETWORKDAYS.INTL"
                    }
                    "COM.MICROSOFT.WORKDAY.INTL" | "_XLFN.WORKDAY.INTL" => "WORKDAY.INTL",
                    "COM.MICROSOFT.SUMIFS" | "_XLFN.SUMIFS" => "SUMIFS",
                    "COM.MICROSOFT.COUNTIFS" | "_XLFN.COUNTIFS" => "COUNTIFS",
                    "COM.MICROSOFT.AVERAGEIFS" | "_XLFN.AVERAGEIFS" => "AVERAGEIFS",
                    "COM.MICROSOFT.UNIQUE" | "_XLFN.UNIQUE" => "UNIQUE",
                    "COM.MICROSOFT.IFNA" | "_XLFN.IFNA" => "IFNA",
                    "COM.MICROSOFT.ISFORMULA" | "_XLFN.ISFORMULA" => "ISFORMULA",
                    "_XLFN.XOR" => "XOR",
                    // Keep Excel's reference/logical semantics distinct from Calc.
                    "COUNT" if self.xlsx => "COUNT.XLSX",
                    "SUM" if self.xlsx => "SUM.XLSX",
                    "AVERAGE" if self.xlsx => "AVERAGE.XLSX",
                    "MIN" if self.xlsx => "MIN.XLSX",
                    "MAX" if self.xlsx => "MAX.XLSX",
                    "PRODUCT" if self.xlsx => "PRODUCT.XLSX",
                    "SHEET" | "_XLFN.SHEET" if self.xlsx => "SHEET.XLSX",
                    "_XLFN.SHEET" => "SHEET",
                    "COM.MICROSOFT.CONCAT" | "_XLFN.CONCAT" => "CONCAT",
                    "_XLFN.SHEETS" => "SHEETS",
                    "_XLFN.ISOWEEKNUM" => "ISOWEEKNUM",
                    "DAYS" if self.odf => "_XLFN.DAYS",
                    "ORG.OPENOFFICE.ERRORTYPE" if self.odf => "ERRORTYPE",
                    _ => &name,
                };
                if name == "LAMBDA" {
                    self.lambda_expression(depth)?
                } else {
                    let fixed = match name {
                        "NORMSDIST" | "NORMSINV" | "GAMMA" | "GAMMALN" | "GAMMALN.PRECISE"
                        | "INT" | "LEN" | "TRIM" | "FORMULA" | "RAND" | "NOT" | "TODAY" | "NOW"
                        | "FACT"
                            if self.editor =>
                        {
                            None
                        }
                        "TRUE" | "FALSE" | "NA" | "PI" | "RAND" | "NOW" | "TODAY" | "CURRENT"
                        | "RAND.NV" => Some(0),
                        "N" | "T" | "ISODD" | "ISEVEN" | "ERROR.TYPE" | "ERRORTYPE" | "ISBLANK"
                        | "ISNUMBER" | "ISTEXT" | "ISERROR" | "ISREF" | "TYPE" | "ISERR"
                        | "ISNA" | "ISNONTEXT" | "ISFORMULA" | "ISLOGICAL" | "NOT" | "ABS"
                        | "SQRT" | "INT" | "FACT" | "GAMMA" | "GAMMALN" | "GAMMALN.PRECISE"
                        | "NORMSDIST" | "NORMSINV" | "PHI" | "GAUSS" | "LEN" | "UPPER"
                        | "LOWER" | "TRIM" | "YEAR" | "MONTH" | "DAY" | "HOUR" | "MINUTE"
                        | "SECOND" | "ISOWEEKNUM" | "INFO" | "FORMULA" => Some(1),
                        _ => None,
                    };
                    let mut args = if name == "LET" {
                        self.let_arguments(depth)?
                    } else {
                        let mut args = Vec::new();
                        if !self.take(")") {
                            loop {
                                if fixed.is_some_and(|count| args.len() >= count) {
                                    self.error.get_or_insert("Err:508");
                                } else if args.len() >= 255
                                    && !(self.editor
                                        && matches!(
                                            name,
                                            "GCD"
                                                | "LCM"
                                                | "CONCATENATE"
                                                | "TEXTJOIN"
                                                | "IMSUM"
                                                | "IMPRODUCT"
                                                | "AND"
                                                | "OR"
                                                | "XOR"
                                                | "IFS"
                                                | "SWITCH"
                                        ))
                                    && !matches!(name, "IF" | "IFERROR" | "IFNA" | "CHOOSE")
                                {
                                    self.error.get_or_insert("Err:512");
                                }
                                self.space();
                                args.push(
                                    if self.source.starts_with(')')
                                        || self.source.starts_with(if self.odf { ';' } else { ',' })
                                    {
                                        self.nodes = self.nodes.checked_sub(1).or_else(|| {
                                            self.limited = true;
                                            None
                                        })?;
                                        Expr::Value(Value::Blank)
                                    } else {
                                        self.expression(0, depth + 1, true)?
                                    },
                                );
                                if self.take(")") {
                                    break;
                                }
                                if !self.take(if self.odf { ";" } else { "," }) {
                                    self.error.get_or_insert("Err:508");
                                    return None;
                                }
                            }
                        }
                        args
                    };
                    if self.xlsx && name == "WEEKNUM" && args.len() == 1 {
                        args.push(Expr::Value(Value::Number(1.)));
                    }
                    if iso_week && args.len() == 1 {
                        args.push(Expr::Value(Value::Number(21.)));
                    }
                    let error = if self.editor && matches!(name, "IFERROR" | "IFNA" | "CHOOSE") {
                        None
                    } else if (fixed == Some(1) || name == "WEEKNUM" && self.xlsx)
                        && args.is_empty()
                        || matches!(name, "IF" | "IFERROR" | "IFNA" | "CHOOSE") && args.is_empty()
                    {
                        Some("Err:511")
                    } else if matches!(name, "IF" | "IFERROR" | "IFNA" | "CHOOSE") {
                        let maximum = match name {
                            "IF" => 3,
                            "CHOOSE" => 31,
                            _ => 2,
                        };
                        if args.len() > 255 {
                            Some("Err:508")
                        } else if args.len() > maximum {
                            Some("Err:504")
                        } else {
                            None
                        }
                    } else {
                        None
                    };
                    if let Some(error) = error {
                        self.error.get_or_insert(error);
                    }
                    Expr::Call(name.into(), args)
                }
            } else {
                self.reference_or_name(None, &name)
            }
        };
        if self.xlsx
            && self.arrays == 0
            && self.export_names.is_none()
            && self.lambda_depth == 0
            && self.error.is_none()
            && let Expr::Name(index) = left
            && let Some(error) = self.name_error(index)?
        {
            self.error = Some(
                if error == "Err:520" && (depth > 0 || !self.source.trim().is_empty()) {
                    "Err:511"
                } else {
                    error
                },
            );
        }
        if self.odf && matches!(left, Expr::Value(Value::Error("#NAME?"))) && self.take("(") {
            // A bad token followed by a parenthesized name expansion is an
            // unknown function. Its argument errors still take precedence.
            let mut args = Vec::new();
            if !self.take(")") {
                loop {
                    if args.len() >= 255 {
                        self.error.get_or_insert("Err:512");
                    }
                    self.space();
                    args.push(if self.source.starts_with([')', ';']) {
                        self.nodes = self.nodes.checked_sub(1).or_else(|| {
                            self.limited = true;
                            None
                        })?;
                        Expr::Value(Value::Blank)
                    } else {
                        self.expression(0, depth + 1, true)?
                    });
                    if self.take(")") {
                        break;
                    }
                    if !self.take(";") {
                        self.error.get_or_insert("Err:508");
                        return None;
                    }
                }
            }
            left = Expr::Call(String::new(), args);
        }
        if let Expr::Name(index) = &left
            && let Some(names) = &mut self.export_names
        {
            names.push(*index);
        }
        loop {
            let before = self.source;
            self.space();
            if stop_separator && self.source.starts_with(if self.odf { ';' } else { ',' }) {
                break;
            }
            if self.source.starts_with('(')
                && matches!(
                    &left,
                    Expr::Lambda(..)
                        | Expr::Invoke(..)
                        | Expr::Local(_)
                        | Expr::Name(_)
                        | Expr::Group(_)
                        | Expr::Call(..)
                )
            {
                self.source = &self.source[1..];
                let args = self.lambda_call_arguments(depth)?;
                left = Expr::Invoke(Box::new(left), args);
                continue;
            }
            if (self.xlsx || self.editor && !self.odf) && self.source.starts_with('#') {
                self.source = &self.source[1..];
                left = Expr::Unary(b'#', Box::new(left));
                continue;
            }
            if self.source.starts_with('%') && minimum <= 7 {
                self.source = &self.source[1..];
                left = Expr::Unary(b'%', Box::new(left));
                continue;
            }
            let operator = [
                ("<=", 1),
                (">=", 1),
                ("<>", 1),
                ("=", 1),
                ("<", 1),
                (">", 1),
                ("&", 2),
                ("+", 3),
                ("-", 3),
                ("*", 4),
                ("/", 4),
                ("^", 5),
                (
                    if self.odf || self.xlsx || self.csv {
                        "~"
                    } else {
                        ","
                    },
                    8,
                ),
                (
                    ",",
                    if self.xlsx && self.export_names.is_none() {
                        0
                    } else {
                        8
                    },
                ),
                (if self.odf { "!" } else { " " }, 9),
                (":", 10),
            ]
            .into_iter()
            .find(|(op, _)| *op != " " && (!self.odf || *op != ",") && self.source.starts_with(op));
            let implicit = !self.odf
                && before.len() != self.source.len()
                && !(self.xlsx && matches!(left, Expr::Name(_)) && self.source.starts_with('('))
                && matches!(
                    left,
                    Expr::Ref(_)
                        | Expr::Value(Value::Error("#NAME?"))
                        | Expr::Range(..)
                        | Expr::Name(_)
                        | Expr::Local(_)
                        | Expr::Group(_)
                        | Expr::Call(..)
                        | Expr::Invoke(..)
                        | Expr::Binary(":" | "~" | "~;" | "!", ..)
                )
                && self
                    .source
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_alphabetic() || "_$'[(".contains(c));
            let Some((token, prec)) = operator.or_else(|| implicit.then_some((" ", 9))) else {
                if self.xlsx {
                    let next = self.source.chars().next();
                    let number = next
                        .is_some_and(|c| c.is_ascii_digit() || c == '.')
                        .then(|| super::xlsx_import::number_token(self.source, false));
                    if next.is_some_and(|c| {
                        !c.is_ascii()
                            && !c.is_alphanumeric()
                            && super::xlsx_import::space_name(self.source).is_none()
                    }) || number.is_some_and(|(_, illegal)| illegal)
                    {
                        self.error.get_or_insert("Err:501");
                    } else if next == Some('"')
                        || next == Some('(') && matches!(left, Expr::Ref(_) | Expr::Range(..))
                        || number.is_some_and(|(token, _)| token.parse::<f64>().is_ok())
                        || self.source.starts_with('#')
                            && LITERAL_ERRORS.iter().any(|e| {
                                super::xlsx_import::error_token(self.source).eq_ignore_ascii_case(e)
                            })
                        || super::xlsx_references::parse(self.source, self.sheets.clone()).is_some()
                    {
                        self.error.get_or_insert("Err:509");
                    }
                }
                break;
            };
            if prec < minimum {
                self.source = before;
                break;
            }
            if self.xlsx && token == "," && self.name_stack.is_empty() {
                self.error.get_or_insert("Err:509");
            }
            let mut postfix = &left;
            while let Expr::Unary(b'+' | b'-', child) = postfix {
                postfix = child;
            }
            if matches!(postfix, Expr::Unary(b'%', _)) && prec >= 8 {
                if self.export_names.is_some() {
                    self.source = before;
                    break;
                }
                if self.xlsx && matches!(token, "~" | ":") {
                    self.error
                        .get_or_insert(if stop_separator { "Err:508" } else { "Err:509" });
                }
            }
            if self.export_names.is_some()
                && token == " "
                && (!left.range_result() || matches!(left, Expr::Group(_)))
            {
                self.source = before;
                break;
            }
            if token != " " {
                self.source = &self.source[token.len()..];
            }
            let op = match token {
                "," if !self.xlsx => "~",
                " " => "!",
                _ => token,
            };
            let whitespace = before.len() - self.source.len();
            let right_source = self
                .source
                .trim_start_matches(|c: char| c.is_whitespace() && (!self.xlsx || c.is_ascii()));
            if self.xlsx && !matches!(token, "~" | "," | " ") {
                if right_source.is_empty() {
                    self.error.get_or_insert("Err:520");
                } else if right_source.starts_with([',', ')']) {
                    self.error.get_or_insert("Err:511");
                } else if right_source.starts_with(['*', '/', '^', '&', '=', '<', '>']) {
                    self.error.get_or_insert("Err:510");
                }
            }
            if self.xlsx && token == "~" {
                if right_source.is_empty() || right_source.starts_with(['-', '%']) {
                    self.error.get_or_insert("Err:520");
                } else if right_source.starts_with(['*', '/', '^', '&', '=', '<', '>', ':']) {
                    self.error.get_or_insert("Err:510");
                }
            }
            let bare_endpoint = right_source
                .chars()
                .take_while(|c| {
                    c.is_alphanumeric() || "_$.".contains(*c) || self.r1c1 && "[]+-".contains(*c)
                })
                .map(char::len_utf8)
                .sum::<usize>();
            let inherit_sheet = !self.odf
                && bare_endpoint > 0
                && !right_source[bare_endpoint..]
                    .trim_start_matches(|c: char| c.is_whitespace() && (!self.xlsx || c.is_ascii()))
                    .starts_with('!');
            let right = self.expression(prec + 1, depth + 1, stop_separator)?;
            if self.xlsx && token == " " {
                if matches!(right, Expr::Value(Value::Error("#NAME?"))) {
                    self.source = before;
                    break;
                }
                if matches!(left, Expr::Call(..))
                    && let Expr::Name(index) = &right
                    && let Some(name) = self.names.get(*index)
                    && operators::separator(
                        name.openformula.as_deref().unwrap_or(&name.expression),
                        ',',
                    )
                    .is_some()
                {
                    left = Expr::Binary(";", Box::new(left), Box::new(right));
                    continue;
                }
                let spaces = &before[..whitespace];
                if !spaces.contains(' ')
                    || !spaces
                        .bytes()
                        .all(|b| matches!(b, b' ' | b'\t' | b'\n' | b'\r'))
                    || !left.range_result()
                    || !right.range_result()
                    || matches!(&left, Expr::Group(_))
                {
                    self.error.get_or_insert("Err:509");
                } else {
                    // Calc replaces the last whitespace token, including a
                    // tab or line break, when this span contains an ASCII space.
                    let last = spaces.as_bytes().last().copied();
                    let length = spaces
                        .bytes()
                        .rev()
                        .take_while(|&b| Some(b) == last)
                        .count();
                    self.operators
                        .push((before.len() - spaces.len() + length, length, '!'));
                }
            }
            if op == ":"
                && !self.odf
                && let (Expr::Ref(a), Expr::Ref(b)) = (&left, &right)
            {
                let mut end = *b;
                if inherit_sheet || !a.unknown_name && b.unknown_name {
                    end.sheet = a.sheet;
                    end.unknown_name = a.unknown_name;
                }
                left = Expr::Range(*a, end);
                continue;
            }
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Some(left)
    }
}
struct Calculation<'a> {
    dynamic: Option<spill::Dynamic>,
    book: &'a Workbook,
    pivot_anchors: BTreeMap<Coord, &'a super::pivot::PivotTable>,
    pivot_sources: BTreeMap<Coord, (usize, [usize; 4])>,
    pivot_indents: BTreeMap<Coord, BTreeMap<Coord, u8>>,
    sheets: &'a [String],
    array_sizes: BTreeMap<Coord, (usize, usize)>,
    sizes: Vec<(usize, usize)>,
    values: BTreeMap<Coord, Value>,
    formula_sources: BTreeMap<Coord, &'a str>,
    legacy_formulas: BTreeSet<Coord>,
    hidden_rows: BTreeSet<(usize, usize)>,
    filtered_rows: BTreeSet<(usize, usize)>,
    formats: BTreeMap<Coord, Format<'a>>,
    automatic_formats: BTreeSet<Coord>,
    result_format: Option<Format<'a>>,
    previous_format: Option<Format<'a>>,
    names: Vec<std::sync::Arc<Expr>>,
    visiting_names: BTreeSet<usize>,
    locals: Vec<Arc<(Value, Option<Format<'a>>)>>,
    lambdas: Vec<Arc<lambda::Closure<'a>>>,
    name_origin: Option<Coord>,
    iteration_root: Option<Coord>,
    iterated: BTreeSet<Coord>,
    cleared: BTreeSet<Coord>,
    expressions: BTreeMap<Coord, Expr>,
    results: BTreeMap<Coord, Value>,
    visiting: BTreeSet<Coord>,
    work: usize,
    array: bool,
    extra_operands: bool,
    matrices: BTreeMap<Coord, Value>,
    random_bytes: Vec<u8>,
    now_ms: f64,
}
impl<'a> Calculation<'a> {
    fn new(
        book: &'a Workbook,
        sheets: &'a [String],
        sizes: Vec<(usize, usize)>,
        work: usize,
    ) -> Self {
        Self {
            dynamic: None,
            book,
            pivot_anchors: BTreeMap::new(),
            pivot_sources: BTreeMap::new(),
            pivot_indents: BTreeMap::new(),
            sheets,
            array_sizes: BTreeMap::new(),
            sizes,
            work,
            array: false,
            extra_operands: false,
            matrices: BTreeMap::new(),
            random_bytes: Vec::new(),
            now_ms: clock::now_ms(),
            values: BTreeMap::new(),
            formula_sources: BTreeMap::new(),
            legacy_formulas: BTreeSet::new(),
            hidden_rows: BTreeSet::new(),
            filtered_rows: BTreeSet::new(),
            formats: BTreeMap::new(),
            automatic_formats: BTreeSet::new(),
            result_format: None,
            previous_format: None,
            expressions: BTreeMap::new(),
            results: BTreeMap::new(),
            names: Vec::new(),
            visiting: BTreeSet::new(),
            visiting_names: BTreeSet::new(),
            locals: Vec::new(),
            lambdas: Vec::new(),
            name_origin: None,
            iteration_root: None,
            iterated: BTreeSet::new(),
            cleared: BTreeSet::new(),
        }
    }
    fn tick(&mut self, depth: usize) -> Option<()> {
        if depth > 128 {
            return None;
        }
        self.work = self.work.checked_sub(1)?;
        Some(())
    }
    fn charge_value(&mut self, value: &Value) -> Option<()> {
        match value {
            Value::Text(text) | Value::UninternedText(text) => {
                self.work = self.work.checked_sub(text.len())?
            }
            Value::Matrix(rows) => {
                for row in rows {
                    self.work = self
                        .work
                        .checked_sub(row.len().checked_mul(std::mem::size_of::<Value>())?)?;
                    for value in row {
                        self.charge_value(value)?;
                    }
                }
            }
            Value::Set(values) => {
                self.work = self
                    .work
                    .checked_sub(values.len().checked_mul(std::mem::size_of::<Value>())?)?;
                for value in values {
                    self.charge_value(value)?;
                }
            }
            _ => {}
        }
        Some(())
    }
    fn cell(&mut self, coord: Coord, depth: usize) -> Option<Value> {
        self.tick(depth)?;
        if self.formula_sources.contains_key(&coord) || self.expressions.contains_key(&coord) {
            if let Some(state) = &mut self.dynamic {
                state.dependency(coord, &mut self.work)?;
            }
        }
        if let Some(value) = self.results.get(&coord) {
            if let Value::Text(text) | Value::UninternedText(text) = value {
                self.work = self.work.checked_sub(text.len())?;
            }
            return Some(if matches!(value, Value::Blank | Value::Empty) {
                Value::Number(0.)
            } else {
                value.clone()
            });
        }
        if self.cleared.contains(&coord) {
            return Some(self.values.get(&coord).cloned().unwrap_or(Value::Blank));
        }
        if self.visiting.contains(&coord) {
            if !self.book.iteration.as_ref().is_some_and(|i| i.enabled) {
                return Some(Value::Error(if self.dynamic.is_some() {
                    "#CIRC!"
                } else {
                    "Err:522"
                }));
            }
            if self.book.iteration.as_ref().is_some_and(|i| i.enabled)
                && self.iteration_root.is_none()
            {
                self.iteration_root = Some(coord);
                self.iterated.insert(coord);
            }
            self.cleared.insert(coord);
            return Some(self.values.get(&coord).cloned().unwrap_or(Value::Blank));
        }
        if let Some(expr) = self.expressions.remove(&coord) {
            let outer_root = self
                .dynamic
                .as_mut()
                .and_then(|state| state.root.replace(coord));
            let outer_format = self.result_format.take();
            let outer_previous = self.previous_format.take();
            let legacy = self.legacy_formulas.contains(&coord);
            let array = std::mem::replace(&mut self.array, self.dynamic.is_some() && !legacy);
            self.visiting.insert(coord);
            let active_names = std::mem::take(&mut self.visiting_names);
            let active_locals = std::mem::take(&mut self.locals);
            let name_origin = self.name_origin.take();
            let mut remaining = self.book.iteration.as_ref().map_or(0, |i| i.maximum);
            let mut value = self.values.get(&coord).cloned().unwrap_or(Value::Blank);
            loop {
                let extra_operands = std::mem::replace(&mut self.extra_operands, false);
                let next = if self
                    .dynamic
                    .as_ref()
                    .is_some_and(|d| d.circular.contains(&coord))
                {
                    Value::Error("#CIRC!")
                } else {
                    if let Some(pivot) = self.pivot_anchors.get(&coord).copied() {
                        self.pivot_table(pivot, coord, depth + 1)?
                    } else {
                        self.eval(&expr, coord, depth + 1, true)?
                    }
                };
                let next = if legacy {
                    self.scalar(next, coord, depth + 1)?
                } else if self.dynamic.is_some() && !matches!(expr, Expr::MatrixCell(..)) {
                    self.spill_result(coord, next, depth + 1)?
                } else {
                    next
                };
                let matrix = matches!(next, Value::Matrix(..));
                let next = self.scalar(next, coord, depth + 1)?;
                let next = match next {
                    Value::Bool(b)
                        if matrix
                            && self.dynamic.is_none()
                            && self.result_format.is_none()
                            && !expr.compiled_logical(&self.names, &mut self.work)? =>
                    {
                        Value::Number(f64::from(b))
                    }
                    value => value,
                };
                let extra = std::mem::replace(&mut self.extra_operands, extra_operands);
                let next = match next {
                    Value::LiteralError(error) => Value::Error(error),
                    value if extra && !matches!(value, Value::Error(_)) => Value::Error("Err:509"),
                    value => value,
                };
                if self.iteration_root != Some(coord) || !self.iterated.remove(&coord) {
                    value = next;
                    if self.iteration_root == Some(coord) {
                        self.iteration_root = None;
                    }
                    break;
                }
                if remaining == 0 {
                    self.iteration_root = None;
                    value = Value::Error("Err:523");
                    break;
                }
                remaining -= 1;
                let difference = match (&value, &next) {
                    (Value::Number(a), Value::Number(b)) => (a - b).abs(),
                    _ => f64::INFINITY,
                };
                if difference >= self.book.iteration.as_ref()?.tolerance {
                    self.iteration_root = None;
                }
                value = next;
                if let Value::Text(s) | Value::UninternedText(s) = &value {
                    self.work = self.work.checked_sub(s.len())?;
                }
                self.values.insert(coord, value.clone());
                self.matrices.clear();
            }
            self.array = array;
            if let Some(state) = &mut self.dynamic {
                state.root = outer_root;
            }
            self.visiting_names = active_names;
            self.locals = active_locals;
            self.name_origin = name_origin;
            self.visiting.remove(&coord);
            self.expressions.insert(coord, expr);
            if let Value::Text(text) | Value::UninternedText(text) = &value {
                self.work = self.work.checked_sub(text.len())?;
            }
            if self.automatic_formats.contains(&coord) {
                if let Some(format) = self
                    .result_format
                    .filter(|_| matches!(value, Value::Number(_) | Value::Bool(_)))
                {
                    self.formats.insert(coord, format);
                } else {
                    self.formats.remove(&coord);
                }
            }
            self.result_format = outer_format;
            self.previous_format = outer_previous;
            self.results.insert(coord, value.clone());
            return Some(if matches!(value, Value::Blank | Value::Empty) {
                Value::Number(0.)
            } else {
                value
            });
        }
        let value = self.values.get(&coord).cloned().unwrap_or(Value::Blank);
        if matches!(value, Value::Blank | Value::Empty) {
            self.read_spill_range(coord, coord)?;
        }
        if let Value::Text(text) | Value::UninternedText(text) = &value {
            self.work = self.work.checked_sub(text.len())?;
        }
        Some(
            if matches!(value, Value::Empty)
                && !self
                    .dynamic
                    .as_ref()
                    .is_some_and(|state| state.cells.contains(&coord))
            {
                Value::Number(0.)
            } else {
                value
            },
        )
    }
    fn scalar(&mut self, value: Value, position: Coord, depth: usize) -> Option<Value> {
        if matches!(value, Value::Lambda(_)) {
            return Some(Value::Error("#CALC!"));
        }
        if matches!(value, Value::Omitted) {
            return Some(Value::Number(0.));
        }
        if matches!(value, Value::InvalidReference | Value::InvalidRange(..)) {
            return Some(Value::Error("#REF!"));
        }
        if let Value::Single(coord) = value {
            let value = self.cell(coord, depth + 1)?;
            self.result_format = self.formats.get(&coord).copied();
            return Some(value);
        }
        if matches!(value, Value::Set(_)) {
            return Some(Value::Error(if self.extra_operands {
                "Err:509"
            } else {
                "#VALUE!"
            }));
        }
        if let Value::Matrix(rows) = value {
            return Some(
                rows.into_iter()
                    .next()
                    .and_then(|row| row.into_iter().next())
                    .unwrap_or(Value::Error("#VALUE!")),
            );
        }
        let Value::Range(a, b) = value else {
            return Some(value);
        };
        match self.intersect_range(a, b, position) {
            Value::Single(coord) => {
                let value = self.cell(coord, depth + 1)?;
                self.result_format = self.formats.get(&coord).copied();
                Some(value)
            }
            value => Some(value),
        }
    }
    fn intersect_range(&self, a: Coord, b: Coord, position: Coord) -> Value {
        let sheet = if a.0 == b.0 {
            a.0
        } else if (a.1 != b.1 || a.2 != b.2) && (a.0.min(b.0)..=a.0.max(b.0)).contains(&position.0)
        {
            position.0
        } else {
            return Value::Error("#VALUE!");
        };
        let (first, last) = ((a.1.min(b.1), a.2.min(b.2)), (a.1.max(b.1), a.2.max(b.2)));
        let coord = if first == last {
            (sheet, first.0, first.1)
        } else if first.0 == last.0 && (first.1..=last.1).contains(&position.2) {
            (sheet, first.0, position.2)
        } else if first.1 == last.1 && (first.0..=last.0).contains(&position.1) {
            (sheet, position.1, first.1)
        } else if self.dynamic.is_some()
            && (first.0..=last.0).contains(&position.1)
            && (first.1..=last.1).contains(&position.2)
        {
            (sheet, position.1, position.2)
        } else {
            return Value::Error("#VALUE!");
        };
        Value::Single(coord)
    }
    fn matrix(&mut self, value: Value, depth: usize) -> Option<Vec<Vec<Value>>> {
        match value {
            Value::InvalidReference | Value::InvalidRange(..) => {
                Some(vec![vec![Value::Error("#REF!")]])
            }
            Value::Single(coord) => Some(vec![vec![self.cell(coord, depth + 1)?]]),
            Value::Set(_) => Some(vec![vec![Value::Error("#VALUE!")]]),
            Value::Matrix(rows) => Some(rows),
            Value::Range(a, b) => {
                let area = (a.0.abs_diff(b.0) + 1)
                    .checked_mul(a.1.abs_diff(b.1) + 1)
                    .and_then(|n| n.checked_mul(a.2.abs_diff(b.2) + 1));
                // Native 64-bit Calc's matrix pool allows 6 GiB at 12 bytes per element.
                // This is a cell error, independent of our execution budget.
                let Some(area) = area.filter(|&n| n <= 536_870_912) else {
                    return Some(vec![vec![Value::Error("Err:538")]]);
                };
                self.work = self
                    .work
                    .checked_sub(area.checked_mul(std::mem::size_of::<Value>())?)?;
                let mut rows = Vec::new();
                for sheet in a.0.min(b.0)..=a.0.max(b.0) {
                    for r in a.1.min(b.1)..=a.1.max(b.1) {
                        let mut row = Vec::new();
                        for c in a.2.min(b.2)..=a.2.max(b.2) {
                            let coord = (sheet, r, c);
                            let value = self.cell(coord, depth + 1)?;
                            row.push(
                                if matches!(value, Value::Blank)
                                    || matches!(value, Value::Number(0.))
                                        && matches!(
                                            self.results
                                                .get(&coord)
                                                .or_else(|| self.values.get(&coord)),
                                            Some(Value::Blank | Value::Empty)
                                        )
                                {
                                    Value::Empty
                                } else {
                                    value
                                },
                            );
                        }
                        rows.push(row);
                    }
                }
                Some(rows)
            }
            value => Some(vec![vec![value]]),
        }
    }
    fn binary(&mut self, op: &str, mut a: Value, mut b: Value) -> Option<Value> {
        if matches!(op, "=" | "<>" | "<" | ">" | "<=" | ">=") {
            use std::cmp::Ordering;
            if let Value::Error(error) | Value::LiteralError(error) = a {
                return Some(Value::Error(error));
            }
            if let Value::Error(error) | Value::LiteralError(error) = b {
                return Some(Value::Error(error));
            }
            if matches!(a, Value::Blank | Value::Empty) {
                a = if matches!(b, Value::Text(_) | Value::UninternedText(_)) {
                    Value::Text(String::new())
                } else {
                    Value::Number(0.)
                };
            }
            if matches!(b, Value::Blank | Value::Empty) {
                b = if matches!(a, Value::Text(_) | Value::UninternedText(_)) {
                    Value::Text(String::new())
                } else {
                    Value::Number(0.)
                };
            }
            let order = match (&a, &b) {
                (
                    Value::Text(a) | Value::UninternedText(a),
                    Value::Text(b) | Value::UninternedText(b),
                ) if matches!(op, "=" | "<>") => {
                    // Calc equality compares shared strings, without collation's
                    // canonical equivalence or accent/width normalization.
                    let equal = if self.book.case_insensitive {
                        super::collation::uppercase(a, &mut self.work)?
                            == super::collation::uppercase(b, &mut self.work)?
                    } else {
                        self.work = self.work.checked_sub(a.len().checked_add(b.len())?)?;
                        a == b
                    };
                    if equal {
                        Ordering::Equal
                    } else {
                        Ordering::Greater
                    }
                }
                (
                    Value::Text(a) | Value::UninternedText(a),
                    Value::Text(b) | Value::UninternedText(b),
                ) => super::collation::compare(a, b, !self.book.case_insensitive, &mut self.work)?,
                (Value::Text(_) | Value::UninternedText(_), _) => Ordering::Greater,
                (_, Value::Text(_) | Value::UninternedText(_)) => Ordering::Less,
                _ => {
                    let a = a.numeric()?;
                    let b = b.numeric()?;
                    let equal = approximately_equal(a, b);
                    if equal {
                        Ordering::Equal
                    } else {
                        a.partial_cmp(&b)?
                    }
                }
            };
            return Some(Value::Bool(match op {
                "=" => order.is_eq(),
                "<>" => !order.is_eq(),
                "<" => order.is_lt(),
                ">" => order.is_gt(),
                "<=" => !order.is_gt(),
                _ => !order.is_lt(),
            }));
        }
        if op == "&"
            && !matches!(a, Value::Error(_) | Value::LiteralError(_))
            && !matches!(b, Value::Error(_) | Value::LiteralError(_))
        {
            if self.dynamic.is_some() {
                let left = strings::string(&a);
                let right = strings::string(&b);
                // Excel's & truncates at the cell's UTF-16 text limit. Iterate
                // original characters so truncation never splits a UTF-8 scalar.
                let capacity = left.len().checked_add(right.len())?.min(32767 * 3);
                self.work = self.work.checked_sub(capacity.checked_mul(2)?)?;
                let mut text = String::with_capacity(capacity);
                let mut units = 0;
                for c in left.chars().chain(right.chars()) {
                    units += c.len_utf16();
                    if units > 32767 {
                        break;
                    }
                    text.push(c);
                }
                return Some(Value::Text(text));
            }
            let mut text = a.text();
            let right = b.text();
            self.work = self
                .work
                .checked_sub(text.len().checked_add(right.len())?)?;
            text.push_str(&right);
            Some(Value::Text(text))
        } else {
            Some(binary(op, a, b))
        }
    }
    fn eval(&mut self, expr: &Expr, pos: Coord, depth: usize, reference: bool) -> Option<Value> {
        self.tick(depth)?;
        self.result_format = None;
        match expr {
            Expr::MatrixCell(expression, anchor) => {
                let value = if let Some(value) = self.matrices.remove(anchor) {
                    value
                } else {
                    let array = std::mem::replace(&mut self.array, true);
                    let value = self.eval(expression, *anchor, depth + 1, false)?;
                    let value = match value {
                        Value::Single(coord) => self.cell(coord, depth + 1)?,
                        Value::Range(..) => Value::Matrix(self.matrix(value, depth + 1)?),
                        Value::Set(values)
                            if values.iter().all(|v| {
                                matches!(v, Value::Single(_))
                                    || matches!(v, Value::Range(a, b) if a == b)
                            }) =>
                        {
                            // Calc resolves a final list of single-cell references
                            // into a column vector, retaining duplicates and order.
                            self.work = self.work.checked_sub(
                                values
                                    .len()
                                    .checked_mul(std::mem::size_of::<Vec<Value>>())?,
                            )?;
                            let mut rows = Vec::with_capacity(values.len());
                            for value in values {
                                rows.extend(self.matrix(value.into_range(), depth + 1)?);
                            }
                            Value::Matrix(rows)
                        }
                        value => value,
                    };
                    self.array = array;
                    if self.extra_operands
                        && !matches!(value, Value::Error(_) | Value::LiteralError(_))
                    {
                        Value::Error("Err:509")
                    } else {
                        value
                    }
                };
                let result = if let Value::Matrix(rows) = &value {
                    let row = if rows.len() == 1 { 0 } else { pos.1 - anchor.1 };
                    let col = if rows.first().is_some_and(|r| r.len() == 1) {
                        0
                    } else {
                        pos.2 - anchor.2
                    };
                    rows.get(row)
                        .and_then(|r| r.get(col))
                        .unwrap_or(&Value::Error("#N/A"))
                } else if matches!(value, Value::Empty) && pos != *anchor {
                    &Value::Number(0.)
                } else {
                    &value
                };
                self.charge_value(result)?;
                let result = match result {
                    Value::Bool(b)
                        if pos != *anchor
                            || matches!(value, Value::Matrix(..))
                                && !expression.compiled_logical(&self.names, &mut self.work)? =>
                    {
                        Value::Number(f64::from(*b))
                    }
                    value => value.clone(),
                };
                self.matrices.insert(*anchor, value);
                self.result_format = None;
                self.previous_format = None;
                Some(result)
            }
            Expr::Value(value) => {
                self.charge_value(value)?;
                if matches!(value, Value::Bool(_)) {
                    self.result_format = FormatKind::Logical.standard();
                    self.previous_format = self.result_format;
                }
                Some(value.clone())
            }
            Expr::Ref(cell) => {
                if cell.unknown_name {
                    return Some(Value::Error("#NAME?"));
                }
                let value = match self.range(cell, cell, pos, self.name_origin) {
                    Value::Range(coord, _) => Value::Single(coord),
                    Value::Error("#REF!") | Value::InvalidRange(..) => Value::InvalidReference,
                    value => value,
                };
                if reference {
                    Some(value)
                } else {
                    self.scalar(value, pos, depth + 1)
                }
            }
            Expr::Range(a, b) => Some(if a.unknown_name || b.unknown_name {
                Value::Error("#NAME?")
            } else {
                self.range(a, b, pos, self.name_origin)
            }),
            Expr::Group(child) | Expr::Unary(b'+', child) => {
                self.eval(child, pos, depth + 1, reference)
            }
            Expr::Lambda(parameters, body) => self.lambda_value(parameters, body),
            Expr::Invoke(callee, args) => self.invoke(callee, args, pos, depth),
            Expr::Local(index) => self.local_value(*index, pos, depth, reference),
            Expr::Name(index) => {
                if !self.visiting_names.insert(*index) {
                    return Some(Value::Error("#NAME?"));
                }
                let expression = self.names.get(*index)?.clone();
                let mut origin = self.book.formula_origins.get(&pos).copied().unwrap_or(pos);
                origin.0 = self.book.names[*index].sheet.unwrap_or(origin.0);
                let previous = self.name_origin.replace(origin);
                let locals = std::mem::take(&mut self.locals);
                let value = self.eval(&expression, pos, depth + 1, reference);
                self.locals = locals;
                self.name_origin = previous;
                self.visiting_names.remove(index);
                value
            }
            Expr::Unary(b'#', child) => {
                let reference = self.eval(child, pos, depth + 1, true)?;
                self.spill_reference(reference, depth + 1)
            }
            Expr::Unary(op, child) => {
                let value = self.eval(child, pos, depth + 1, true)?;
                if matches!(value, Value::Set(_)) {
                    return Some(Value::Error(if self.array { "#REF!" } else { "Err:504" }));
                }
                if matches!(value, Value::Matrix(..))
                    || self.array && matches!(value, Value::Range(..))
                {
                    let mut rows = self.matrix(value, depth + 1)?;
                    for row in &mut rows {
                        for value in row {
                            self.tick(depth)?;
                            *value = unary(*op, std::mem::replace(value, Value::Blank));
                        }
                    }
                    return Some(Value::Matrix(rows));
                }
                let format = match op {
                    b'-' => self.previous_format.and_then(|f| f.kind.standard()),
                    b'%' => FormatKind::Percent.standard(),
                    _ => self.result_format,
                };
                let value = self.implicit_invalid_range(child, value, pos)?;
                let value = self.scalar(value, pos, depth + 1)?;
                self.result_format = format;
                self.previous_format = self.result_format;
                Some(unary(*op, value))
            }
            Expr::Binary(op, left, right) => {
                if matches!(*op, "~" | "~;" | "," | ";") {
                    // Array unions retain reference lists until the matrix is read.
                    let reference = reference || self.array;
                    let a = self.eval(left, pos, depth + 1, reference)?;
                    let b = self.eval(right, pos, depth + 1, reference)?;
                    if *op == "," && matches!(b, Value::Error(_) | Value::LiteralError(_)) {
                        return Some(b);
                    }
                    if *op == ";" {
                        self.extra_operands = true;
                        if matches!(a, Value::Error(_)) {
                            return Some(a);
                        }
                        return Some(b);
                    }
                    if reference && *op == "," {
                        return Some(Value::Set(vec![a, b]));
                    }
                    if reference {
                        // Calculated errors stop the interpreter before literal
                        // error tokens are popped by the union operator.
                        for value in [&a, &b] {
                            if let Value::Error(error) = value {
                                return Some(Value::Error(error));
                            }
                        }
                        for value in [&a, &b] {
                            if let Value::LiteralError(error) = value {
                                return Some(Value::Error(error));
                            }
                        }
                        for value in [&a, &b] {
                            match value {
                                Value::Single(_) | Value::Range(..) | Value::Set(_) => {}
                                Value::InvalidReference | Value::InvalidRange(..) => {
                                    return Some(Value::Error("#REF!"));
                                }
                                _ => return Some(Value::Error("Err:502")),
                            }
                        }
                        // Calc appends to an existing reference list, preferring the left one.
                        let values = match (a, b) {
                            (Value::Set(mut a), Value::Set(b)) => {
                                self.work = self
                                    .work
                                    .checked_sub(b.len() * std::mem::size_of::<Value>())?;
                                a.extend(b);
                                a
                            }
                            (Value::Set(mut values), value) | (value, Value::Set(mut values)) => {
                                self.work = self.work.checked_sub(std::mem::size_of::<Value>())?;
                                values.push(value);
                                values
                            }
                            (a, b) => {
                                self.work =
                                    self.work.checked_sub(2 * std::mem::size_of::<Value>())?;
                                vec![a, b]
                            }
                        };
                        return Some(Value::Set(values));
                    }
                    let mut rows = Vec::new();
                    for value in [a, b] {
                        if let Value::Matrix(matrix) = value {
                            rows.extend(matrix);
                        } else {
                            let value = self.scalar(value, pos, depth + 1)?;
                            rows.push(vec![if matches!(value, Value::Blank | Value::Empty) {
                                Value::Number(0.)
                            } else {
                                value
                            }]);
                        }
                    }
                    return Some(Value::Matrix(rows));
                }
                if matches!(*op, ":" | "!") {
                    // Range operands retain references even inside an array formula.
                    let array = std::mem::replace(&mut self.array, false);
                    let a = self.eval(left, pos, depth + 1, true)?;
                    let b = self.eval(right, pos, depth + 1, true)?;
                    self.array = array;
                    if *op == "!" {
                        return self.intersection(a, b, depth + 1);
                    }
                    let a = self.range_list(a, depth + 1)?;
                    let b = self.range_list(b, depth + 1)?;
                    if let Value::Error(error) | Value::LiteralError(error) = a {
                        return Some(Value::Error(error));
                    }
                    if let Value::Error(error) | Value::LiteralError(error) = b {
                        return Some(Value::Error(error));
                    }
                    let invalid = if matches!(
                        a,
                        Value::Number(_) | Value::Text(_) | Value::UninternedText(_)
                    ) || matches!(
                        b,
                        Value::Number(_) | Value::Text(_) | Value::UninternedText(_)
                    ) {
                        "Err:502"
                    } else {
                        "#VALUE!"
                    };
                    let (Value::Range(a, b), Value::Range(c, d)) = (a.into_range(), b.into_range())
                    else {
                        return Some(Value::Error(invalid));
                    };
                    return Some(Value::Range(
                        (
                            a.0.min(b.0).min(c.0.min(d.0)),
                            a.1.min(b.1).min(c.1.min(d.1)),
                            a.2.min(b.2).min(c.2.min(d.2)),
                        ),
                        (
                            a.0.max(b.0).max(c.0.max(d.0)),
                            a.1.max(b.1).max(c.1.max(d.1)),
                            a.2.max(b.2).max(c.2.max(d.2)),
                        ),
                    ));
                }
                // Left-associative chains do not consume the recursive expression budget.
                // Retain evaluation order: scalarize each left operand before its right.
                let mut pending = Vec::new();
                let mut base = expr;
                while let Expr::Binary(op, left, right) = base {
                    if matches!(*op, "~" | "~;" | "," | ";" | ":" | "!") {
                        break;
                    }
                    self.work = self
                        .work
                        .checked_sub(std::mem::size_of::<(&str, &Expr)>())?;
                    if !pending.is_empty() {
                        self.tick(depth)?;
                    }
                    pending.push((op, right.as_ref()));
                    base = left;
                }
                let mut a = self.eval(base, pos, depth + 1, true)?;
                for (op, right) in pending.into_iter().rev() {
                    if !matches!(right, Expr::Value(Value::Matrix(..))) {
                        a = self.implicit_invalid_range(base, a, pos)?;
                    }
                    a = if self.array || matches!(a, Value::Matrix(..) | Value::Set(..)) {
                        a
                    } else {
                        self.scalar(a, pos, depth + 1)?
                    };
                    let format_a = self.result_format;
                    let mut b = self.eval(right, pos, depth + 1, true)?;
                    if !matches!(a, Value::Matrix(..)) {
                        b = self.implicit_invalid_range(right, b, pos)?;
                    }
                    if matches!(a, Value::Set(_)) || matches!(b, Value::Set(_)) {
                        for value in [&a, &b] {
                            if let Value::Error(error) | Value::LiteralError(error) = value {
                                return Some(Value::Error(error));
                            }
                        }
                        return Some(Value::Error(if self.array {
                            "#REF!"
                        } else if *op == "&" {
                            "Err:502"
                        } else {
                            "Err:504"
                        }));
                    }
                    a = if matches!(a, Value::Matrix(..))
                        || matches!(b, Value::Matrix(..))
                        || self.array
                            && (matches!(a, Value::Range(..)) || matches!(b, Value::Range(..)))
                    {
                        let a = self.matrix(a, depth + 1)?;
                        let b = self.matrix(b, depth + 1)?;
                        let dimension = |a: usize, b: usize| {
                            if a == 1 {
                                b
                            } else if b == 1 {
                                a
                            } else if matches!(*op, "=" | "<>" | "<" | ">" | "<=" | ">=") {
                                a.max(b)
                            } else {
                                a.min(b)
                            }
                        };
                        let height = dimension(a.len(), b.len());
                        let width = dimension(a.first()?.len(), b.first()?.len());
                        self.work = self.work.checked_sub(
                            height
                                .checked_mul(width)?
                                .checked_mul(std::mem::size_of::<Value>())?,
                        )?;
                        let mut rows = Vec::new();
                        for r in 0..height {
                            let mut row = Vec::new();
                            for c in 0..width {
                                let a = a
                                    .get(if a.len() == 1 { 0 } else { r })
                                    .and_then(|row| row.get(if row.len() == 1 { 0 } else { c }))
                                    .unwrap_or(&Value::Error("#VALUE!"));
                                let b = b
                                    .get(if b.len() == 1 { 0 } else { r })
                                    .and_then(|row| row.get(if row.len() == 1 { 0 } else { c }))
                                    .unwrap_or(&Value::Error("#VALUE!"));
                                self.charge_value(a)?;
                                self.charge_value(b)?;
                                row.push(match self.binary(op, a.clone(), b.clone())? {
                                    Value::Bool(b) if self.array && self.dynamic.is_none() => {
                                        Value::Number(f64::from(b))
                                    }
                                    value => value,
                                });
                            }
                            rows.push(row);
                        }
                        self.result_format =
                            if !self.array && matches!(*op, "=" | "<>" | "<" | ">" | "<=" | ">=") {
                                FormatKind::Logical.standard()
                            } else {
                                None
                            };
                        Value::Matrix(rows)
                    } else {
                        let scalar_a = self.scalar(a, pos, depth + 1)?;
                        let b = self.scalar(b, pos, depth + 1)?;
                        let format = result_format::arithmetic(op, format_a, self.result_format);
                        self.result_format = format;
                        self.previous_format = format;
                        match self.binary(op, scalar_a, b)? {
                            Value::Bool(b) if self.array && self.dynamic.is_none() => {
                                Value::Number(f64::from(b))
                            }
                            value => value,
                        }
                    };
                }
                Some(a)
            }
            Expr::Call(name, args) => {
                if self.dynamic.is_some()
                    && (name.eq_ignore_ascii_case("_xlfn.SINGLE")
                        || name.eq_ignore_ascii_case("COM.MICROSOFT.SINGLE"))
                    && args.len() == 1
                {
                    let value = self.eval(&args[0], pos, depth + 1, true)?;
                    let value = match value {
                        Value::Range(a, b) => self.intersect_range(a, b, pos),
                        value => value,
                    };
                    // Reference consumers such as ROW and FORMULATEXT need the
                    // intersected cell, not its contents. Arrays take top-left.
                    return if reference && matches!(value, Value::Single(_)) {
                        Some(value)
                    } else {
                        self.scalar(value, pos, depth + 1)
                    };
                }
                let mut value = self.call(name, args, pos, depth + 1)?;
                if self.array
                    && self.dynamic.is_none()
                    && matches!(name.as_str(), "IF" | "IFERROR" | "IFNA" | "CHOOSE")
                {
                    if !reference && let Value::Single(coord) = value {
                        value = self.cell(coord, depth + 1)?;
                    }
                    // Calc's array selectors return numeric logical results. Direct
                    // logical functions retain a Boolean anchor in their matrix.
                    match &mut value {
                        Value::Bool(b) => value = Value::Number(f64::from(*b)),
                        Value::Matrix(rows) => {
                            for value in rows.iter_mut().flatten() {
                                self.work = self.work.checked_sub(1)?;
                                if let Value::Bool(b) = value {
                                    *value = Value::Number(f64::from(*b));
                                }
                            }
                        }
                        _ => {}
                    }
                    self.result_format =
                        self.result_format.filter(|f| f.kind != FormatKind::Logical);
                }
                self.result_format = match name.as_str() {
                    "DATE" | "TODAY" => FormatKind::Date.standard(),
                    "NOW" => FormatKind::DateTime.standard(),
                    "TIME" => FormatKind::Time.standard(),
                    "LET" | "IF" | "IFERROR" | "IFNA" | "CHOOSE" | "SUM" | "AVERAGE" | "MIN"
                    | "MAX" | "PRODUCT" | "SUM.XLSX" | "AVERAGE.XLSX" | "MIN.XLSX" | "MAX.XLSX"
                    | "PRODUCT.XLSX" | "AVERAGEA" | "MINA" | "MAXA" => self.result_format,
                    _ if matches!(value, Value::Bool(_)) => FormatKind::Logical.standard(),
                    _ => None,
                };
                self.previous_format = self.result_format;
                if !matches!(name.as_str(), "IF" | "IFERROR" | "IFNA" | "SUM" | "PRODUCT")
                    && matches!(value, Value::Blank)
                {
                    value = Value::Empty;
                }
                Some(value)
            }
        }
    }
    fn call(&mut self, name: &str, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if matches!(name, "TODAY" | "NOW") {
            if !args.is_empty() {
                return Some(Value::Error(if self.dynamic.is_some() {
                    "#ERROR!"
                } else {
                    "Err:504"
                }));
            }
            return Some(match clock::serial(self.now_ms, self.book.date1904) {
                Some(value) => Value::Number(if name == "TODAY" {
                    value.floor()
                } else {
                    value
                }),
                None => Value::Error("#NUM!"),
            });
        }
        // IronCalc/Univer: PERCENTOF is SUM(subset) / SUM(total), with
        // aggregate coercion and errors rather than element-wise division.
        if name == "PERCENTOF" {
            if args.len() != 2 {
                return Some(Value::Error("#ERROR!"));
            }
            let part = self.aggregate_excel("SUM", &args[..1], pos, depth)?;
            if matches!(part, Value::Error(_)) {
                return Some(part);
            }
            let total = self.aggregate_excel("SUM", &args[1..], pos, depth)?;
            return Some(binary("/", part, total));
        }
        if self.dynamic.is_some() && matches!(name, "ARRAYTOTEXT" | "VALUETOTEXT") {
            return self.text_function(name, args, pos, depth);
        }
        if self.dynamic.is_some() && name == "CHOOSE" {
            return self.choose(args, pos, depth);
        }
        if self.dynamic.is_some() && matches!(name, "AND" | "OR" | "XOR") {
            return self.aggregate_excel(name, args, pos, depth);
        }
        if self.dynamic.is_some() && matches!(name, "FORMULA" | "FORMULATEXT") {
            return self.formulatext(args, pos, depth);
        }
        if self.dynamic.is_some() && name == "CELL" {
            return self.cell_info(args, pos, depth);
        }
        if matches!(
            name,
            "REGEXMATCH" | "REGEXTEST" | "REGEXEXTRACT" | "REGEXREPLACE"
        ) {
            return self.regex_function(name, args, pos, depth);
        }
        if name.eq_ignore_ascii_case("_xlfn.SINGLE")
            || name.eq_ignore_ascii_case("COM.MICROSOFT.SINGLE")
        {
            if args.len() != 1 {
                return Some(Value::Error("#ERROR!"));
            }
            let value = self.eval(&args[0], pos, depth + 1, true)?;
            return self.scalar(value, pos, depth + 1);
        }
        if matches!(name, "IFS" | "SWITCH") {
            return self.logical_cases(name, args, pos, depth);
        }
        if name == "PROB" {
            return self.probability(args, pos, depth);
        }
        if matches!(name, "Z.TEST" | "ZTEST") {
            return self.z_test(args, pos, depth);
        }
        if matches!(name, "T.TEST" | "TTEST") {
            return self.student_test(args, pos, depth);
        }
        if matches!(name, "F.TEST" | "FTEST") {
            return self.f_test(args, pos, depth);
        }
        if matches!(name, "CHISQ.TEST" | "CHITEST") {
            return self.chisquare_test(args, pos, depth);
        }
        if name == "SERIESSUM" {
            return self.series_sum(args, pos, depth);
        }
        if descriptive::minimum(name).is_some() {
            return self.aggregate_excel(name, args, pos, depth);
        }
        if matches!(
            name,
            "CORREL"
                | "PEARSON"
                | "RSQ"
                | "SLOPE"
                | "INTERCEPT"
                | "STEYX"
                | "COVAR"
                | "COVARIANCE.P"
                | "COVARIANCE.S"
                | "FORECAST"
                | "FORECAST.LINEAR"
        ) {
            return self.paired_statistics(name, args, pos, depth);
        }
        if matches!(name, "LINEST" | "LOGEST" | "TREND" | "GROWTH") {
            return self.regression(name, args, pos, depth);
        }
        if matches!(
            name,
            "PERCENTILE"
                | "PERCENTILE.INC"
                | "PERCENTILE.EXC"
                | "QUARTILE"
                | "QUARTILE.INC"
                | "QUARTILE.EXC"
                | "PERCENTRANK"
                | "PERCENTRANK.INC"
                | "PERCENTRANK.EXC"
                | "MODE"
                | "MODE.SNGL"
                | "MODE.MULT"
                | "FREQUENCY"
                | "TRIMMEAN"
                | "MEDIAN"
                | "LARGE"
                | "SMALL"
                | "RANK"
                | "RANK.EQ"
                | "RANK.AVG"
        ) {
            return self.order_statistics(name, args, pos, depth);
        }
        if name == "YEARFRAC" {
            return self.yearfrac(args, pos, depth);
        }
        if name == "DATEDIF" {
            return self.datedif(args, pos, depth);
        }
        if name == "LET" {
            return self.let_value(args, pos, depth);
        }
        if matches!(name, "MAP" | "REDUCE" | "SCAN") {
            return self.higher_order(name, args, pos, depth);
        }
        if matches!(name, "BYROW" | "BYCOL" | "MAKEARRAY") {
            return self.array_callback(name, args, pos, depth);
        }
        if name == "ISOMITTED" {
            if args.len() != 1 {
                return Some(Value::Error("#ERROR!"));
            }
            return Some(Value::Bool(matches!(
                self.eval(&args[0], pos, depth + 1, true)?,
                Value::Omitted
            )));
        }
        if name == "SUMPRODUCT" {
            return self.sumproduct(args, pos, depth);
        }
        if matches!(name, "SUMX2MY2" | "SUMX2PY2" | "SUMXMY2") {
            return self.squared_pairs(name, args, pos, depth);
        }
        if matches!(name, "MMULT" | "MDETERM" | "MINVERSE" | "MUNIT") {
            return self.matrix_function(name, args, pos, depth);
        }
        if matches!(
            name,
            "NPV" | "IRR" | "MIRR" | "XNPV" | "XIRR" | "FVSCHEDULE"
        ) {
            return self.cashflow(name, args, pos, depth);
        }
        if matches!(name, "WRAPROWS" | "WRAPCOLS") {
            return self.wrap_vector(name, args, pos, depth);
        }
        if name == "EXPAND" {
            return self.expand_array(args, pos, depth);
        }
        if name == "TRIMRANGE" {
            return self.trim_range(args, pos, depth);
        }
        if name == "TEXTSPLIT" {
            return self.text_split(args, pos, depth);
        }
        if matches!(name, "TEXTBEFORE" | "TEXTAFTER") {
            return self.text_boundary(name, args, pos, depth);
        }
        if matches!(
            name,
            "TAKE" | "DROP" | "TOCOL" | "TOROW" | "HSTACK" | "VSTACK" | "CHOOSECOLS" | "CHOOSEROWS"
        ) {
            return self.shape_function(name, args, pos, depth);
        }
        if matches!(name, "SORT" | "SORTBY") && self.dynamic.is_some() {
            return self.sort_dynamic(name, args, pos, depth);
        }
        if name == "RAND" && self.dynamic.is_some() {
            if !args.is_empty() {
                return Some(Value::Error("#ERROR!"));
            }
            return self.random_value(0., 1., false);
        }
        if name == "RANDARRAY" && self.dynamic.is_some() {
            return self.random_array(args, pos, depth);
        }
        if matches!(name, "SEQUENCE" | "FILTER" | "ANCHORARRAY") {
            return self.dynamic_function(name, args, pos, depth);
        }
        // The editor uses a non-DBCS locale; byte variants count characters.
        let name = match name {
            "REPLACEB" => "REPLACE",
            "LENB" if self.dynamic.is_some() => "LEN",
            "LEFTB" if self.dynamic.is_some() => "LEFT",
            "RIGHTB" if self.dynamic.is_some() => "RIGHT",
            "MIDB" if self.dynamic.is_some() => "MID",
            _ => name,
        };
        if matches!(
            name,
            "SUM.XLSX"
                | "AVERAGE.XLSX"
                | "MIN.XLSX"
                | "MAX.XLSX"
                | "PRODUCT.XLSX"
                | "AVERAGEA"
                | "MINA"
                | "MAXA"
                | "SUMSQ"
                | "MULTINOMIAL"
                | "GCD"
                | "LCM"
        ) {
            return self.aggregate_excel(
                name.strip_suffix(".XLSX").unwrap_or(name),
                args,
                pos,
                depth,
            );
        }
        if matches!(
            name,
            "SUMIF"
                | "SUMIFS"
                | "COUNTIF"
                | "COUNTIFS"
                | "AVERAGEIF"
                | "AVERAGEIFS"
                | "MINIFS"
                | "MAXIFS"
        ) {
            return self.conditional_aggregate(name, args, pos, depth);
        }
        if matches!(
            name,
            "WORKDAY" | "WORKDAY.INTL" | "NETWORKDAYS" | "NETWORKDAYS.INTL"
        ) {
            return self.working_dates(name, args, pos, depth);
        }
        let excel_count = name == "COUNT.XLSX";
        let name = if excel_count { "COUNT" } else { name };
        if name == "SUBTOTAL" {
            return self.subtotal(args, pos, depth);
        }
        if matches!(
            name,
            "DCOUNT"
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
        ) {
            return self.database(name, args, pos, depth);
        }
        if name == "COUNTBLANK" {
            return self.countblank(args, pos, depth);
        }
        if name == "NORM.S.INV" && args.len() != 1 && self.dynamic.is_none() {
            // This native opcode consumes only the last stack argument. Surplus
            // operands remain visible to the enclosing expression's final check.
            for arg in args.iter().take(args.len().saturating_sub(1)) {
                if let Value::Error(error) = self.eval(arg, pos, depth + 1, true)? {
                    return Some(Value::Error(error));
                }
            }
            let Some(last) = args.last() else {
                return Some(Value::Error("Err:518"));
            };
            self.extra_operands = true;
            return self.call(name, std::slice::from_ref(last), pos, depth + 1);
        }
        if self.dynamic.is_some() && matches!(name, "IMSUM" | "IMPRODUCT") {
            return self.complex_aggregate(name, args, pos, depth);
        }
        let random_between = self.dynamic.is_some() && name == "RANDBETWEEN";
        if random_between && args.len() != 2 {
            return Some(Value::Error("#ERROR!"));
        }
        let bessel_function =
            self.dynamic.is_some() && matches!(name, "BESSELI" | "BESSELJ" | "BESSELK" | "BESSELY");
        if bessel_function {
            if args.len() != 2 {
                return Some(Value::Error("#ERROR!"));
            }
            if args.iter().any(|a| matches!(a, Expr::Value(Value::Blank))) {
                return Some(Value::Error("#N/A"));
            }
        }
        let complex_arguments = self
            .dynamic
            .is_some()
            .then(|| complex::arguments(name))
            .flatten();
        let complex_function = complex_arguments.is_some();
        if let Some((min, max)) = complex_arguments
            && !(min..=max).contains(&args.len())
        {
            return Some(Value::Error("#ERROR!"));
        }
        let basis_arguments = basis::arguments(name);
        let basis_function = basis_arguments.is_some();
        if basis_function && name.starts_with("BIT") && args.len() != 2 {
            return Some(Value::Error("#ERROR!"));
        }
        if self.dynamic.is_some()
            && (name == "INT" && args.len() != 1
                || name == "TRUNC" && !(1..=2).contains(&args.len()))
        {
            return Some(Value::Error("#ERROR!"));
        }
        if name == "ENCODEURL" && args.len() != 1 {
            return Some(Value::Error("#ERROR!"));
        }
        if name == "MROUND" {
            if args.len() != 2 {
                return Some(Value::Error("#ERROR!"));
            }
            if args.iter().any(|a| matches!(a, Expr::Value(Value::Blank))) {
                return Some(Value::Error("#N/A"));
            }
        }
        let rounding = matches!(name, "ROUND" | "ROUNDUP" | "ROUNDDOWN" | "TRUNC");
        let formatted_decimals_omitted = matches!(name, "FIXED" | "DOLLAR")
            && (args.len() < 2 || matches!(args[1], Expr::Value(Value::Blank)));
        let string_function = matches!(name, "LEN" | "LEFT" | "RIGHT" | "MID");
        let search_function = matches!(
            name,
            "EXACT" | "FIND" | "FINDB" | "SEARCH" | "SEARCHB" | "SUBSTITUTE"
        );
        let character_function =
            self.dynamic.is_some() && matches!(name, "LEN" | "LEFT" | "RIGHT" | "MID" | "TRIM");
        let concatenate = self.dynamic.is_some() && name == "CONCATENATE";
        let text_function = concatenate
            || character_function
            || search_function
            || matches!(
                name,
                "ASC"
                    | "DBCS"
                    | "JIS"
                    | "ENCODEURL"
                    | "VALUE"
                    | "NUMBERVALUE"
                    | "FIXED"
                    | "DOLLAR"
                    | "CHAR"
                    | "CODE"
                    | "UNICHAR"
                    | "UNICODE"
                    | "CLEAN"
                    | "PROPER"
                    | "REPLACE"
                    | "REPT"
                    | "TEXT"
                    | "DATEVALUE"
                    | "TIMEVALUE"
            );
        let financial_arguments = finance::arguments(name);
        let financial_function = financial_arguments.is_some();
        let mathematical_arguments = if name == "INT" && self.dynamic.is_some() {
            Some((1, 1))
        } else {
            mathematics::arguments(name)
        };
        let mathematical_function = mathematical_arguments.is_some();
        let multiple_rounding = self.dynamic.is_some()
            && (name.starts_with("FLOOR") || name.starts_with("CEILING") || name == "ISO.CEILING");
        let threshold_function = matches!(name, "DELTA" | "GESTEP");
        if matches!(name, "ERF" | "ERFC" | "ERF.PRECISE" | "ERFC.PRECISE")
            && !(1..=if name == "ERF" { 2 } else { 1 }).contains(&args.len())
        {
            return Some(Value::Error("#ERROR!"));
        }
        if threshold_function && !(1..=2).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        if name == "GESTEP" && matches!(args[0], Expr::Value(Value::Blank)) {
            return Some(Value::Error("#N/A"));
        }
        if matches!(name, "FISHER" | "FISHERINV") && args.len() != 1 {
            return Some(Value::Error("#ERROR!"));
        }
        let inference_arguments = statistics::inference::arguments(name);
        let inference_function = inference_arguments.is_some();
        if inference_function && args.len() != 3 {
            return Some(Value::Error("#ERROR!"));
        }
        let student_arguments = statistics::student::arguments(name);
        let student_function = student_arguments.is_some();
        if let Some((min, max)) = student_arguments
            && !(min..=max).contains(&args.len())
        {
            return Some(Value::Error("#ERROR!"));
        }
        let f_arguments = statistics::f_distribution::arguments(name);
        let f_function = f_arguments.is_some();
        if let Some((min, max)) = f_arguments
            && !(min..=max).contains(&args.len())
        {
            return Some(Value::Error("#ERROR!"));
        }
        let beta_arguments = statistics::beta::arguments(name);
        let beta_function = beta_arguments.is_some();
        if let Some((min, max)) = beta_arguments
            && !(min..=max).contains(&args.len())
        {
            return Some(Value::Error("#ERROR!"));
        }
        let beta_upper_index = if name == "BETA.DIST" { 5 } else { 4 };
        let beta_upper_omitted = beta_function
            && (args.len() <= beta_upper_index
                || matches!(args[beta_upper_index], Expr::Value(Value::Blank)));
        let chisquare_arguments = statistics::chisquare::arguments(name);
        let chisquare_function = chisquare_arguments.is_some();
        if let Some((min, max)) = chisquare_arguments
            && !(min..=max).contains(&args.len())
        {
            return Some(Value::Error("#ERROR!"));
        }
        let binomial_arguments = statistics::binomial::arguments(name);
        let binomial_function = binomial_arguments.is_some();
        if let Some((min, max)) = binomial_arguments
            && !(min..=max).contains(&args.len())
        {
            return Some(Value::Error("#ERROR!"));
        }
        let lifetime_arguments = lifetime::arguments(name);
        let lifetime_function = lifetime_arguments.is_some();
        if lifetime_function && args.len() != lifetime_arguments?.0 {
            return Some(Value::Error("#ERROR!"));
        }
        let excel_statistical_arguments = self
            .dynamic
            .as_ref()
            .and_then(|_| statistics::excel_arguments(name));
        let excel_statistics = excel_statistical_arguments.is_some();
        if excel_statistics && args.len() != excel_statistical_arguments?.0 {
            return Some(Value::Error("#ERROR!"));
        }
        let statistical_arguments = inference_arguments
            .or(student_arguments)
            .or(f_arguments)
            .or(beta_arguments)
            .or(chisquare_arguments)
            .or(binomial_arguments)
            .or(lifetime_arguments)
            .or(excel_statistical_arguments)
            .or(statistics::arguments(name))
            .or(mathematical_arguments);
        let statistical_function = statistical_arguments.is_some();
        let month_shift = self.dynamic.is_some() && matches!(name, "EDATE" | "EOMONTH");
        if month_shift {
            if args.len() != 2 {
                return Some(Value::Error("#ERROR!"));
            }
            if args
                .iter()
                .any(|arg| matches!(arg, Expr::Value(Value::Blank)))
            {
                return Some(Value::Error("#N/A"));
            }
        }
        let day_count = name == "DAYS360" || name == "_XLFN.DAYS" && self.dynamic.is_some();
        let euroconvert = name == "EUROCONVERT";
        let unit_conversion = name == "CONVERT";
        if unit_conversion && args.len() != 3 {
            return Some(Value::Error("#ERROR!"));
        }
        let elementwise = unit_conversion
            || random_between
            || bessel_function
            || complex_function
            || month_shift
            || day_count
            || basis_function
            || rounding
            || string_function
            || text_function
            || statistical_function
            || financial_function
            || euroconvert;
        let (minimum, maximum) = complex_arguments
            .or(basis_arguments)
            .or(financial_arguments)
            .or(statistical_arguments)
            .unwrap_or(match name {
                _ if random_between || bessel_function || month_shift => (2, 2),
                _ if day_count => (2, if name == "DAYS360" { 3 } else { 2 }),
                "EUROCONVERT" => (3, 5),
                "CONVERT" => (3, 3),
                "LEN" => (1, 1),
                "LEFT" | "RIGHT" => (1, 2),
                "MID" => (3, 3),
                "REPLACE" => (4, 4),
                "REPT" | "TEXT" | "EXACT" => (2, 2),
                "FIND" | "FINDB" | "SEARCH" | "SEARCHB" => (2, 3),
                "SUBSTITUTE" => (3, 4),
                "CONCATENATE" => (1, 255),
                "NUMBERVALUE" | "FIXED" => (1, 3),
                "DOLLAR" => (1, 2),
                _ if text_function => (1, 1),
                _ => (1, 2),
            });
        if (search_function || self.dynamic.is_some() && text_function)
            && !(minimum..=maximum).contains(&args.len())
        {
            return Some(Value::Error("#ERROR!"));
        }
        if elementwise && !(minimum..=maximum).contains(&args.len()) {
            for arg in args {
                if let Value::Error(error) = self.eval(arg, pos, depth + 1, true)? {
                    return Some(Value::Error(error));
                }
            }
            return Some(Value::Error(
                if day_count
                    || financial_function
                    || basis_function
                    || matches!(
                        name,
                        "DATEVALUE" | "TIMEVALUE" | "NUMBERVALUE" | "FIXED" | "DOLLAR"
                    )
                {
                    "#ERROR!"
                } else if args.len() < minimum {
                    "Err:511"
                } else {
                    "Err:504"
                },
            ));
        }
        let date_arguments = dates::arguments(name);
        if let Some((minimum, maximum)) = date_arguments
            && (args.len() < minimum || args.len() > maximum)
        {
            return Some(Value::Error(
                if args.len() < minimum
                    && !matches!(name, "EDATE" | "EOMONTH" | "WEEKNUM_EXCEL2003")
                {
                    "Err:511"
                } else {
                    "Err:504"
                },
            ));
        }
        if matches!(
            name,
            "ISBLANK"
                | "ISNUMBER"
                | "ISTEXT"
                | "ISERROR"
                | "ISREF"
                | "TYPE"
                | "ISERR"
                | "ISNA"
                | "ISNONTEXT"
                | "ISFORMULA"
                | "ISLOGICAL"
                | "N"
                | "T"
                | "ISODD"
                | "ISEVEN"
                | "ERROR.TYPE"
                | "ERRORTYPE"
        ) {
            return self.information(name, args, pos, depth);
        }
        if name == "CONCAT" {
            return self.concat(args, pos, depth);
        }
        if self.dynamic.is_some() && name == "TEXTJOIN" {
            return self.textjoin(args, pos, depth);
        }
        if matches!(
            name,
            "CHOOSE" | "AREAS" | "ARRAY" | "ROWS" | "COLUMNS" | "SHEETS" | "SHEET.XLSX"
        ) {
            return self.reference_special(name, args, pos, depth);
        }
        if name == "INDEX" {
            return self.index(args, pos, depth);
        }
        if matches!(
            name,
            "MATCH"
                | "LOOKUP"
                | "VLOOKUP"
                | "HLOOKUP"
                | "XMATCH"
                | "XLOOKUP"
                | "ADDRESS"
                | "ROW"
                | "COLUMN"
                | "COLUMNNUMBER"
                | "HYPERLINK"
                | "INDIRECT"
                | "OFFSET"
                | "SHEET"
                | "TRANSPOSE"
                | "FLIP"
                | "SORT"
                | "UNIQUE"
        ) {
            return self.lookup(name, args, pos, depth);
        }
        if self.dynamic.is_some()
            && ((name == "NOT" && args.len() != 1)
                || matches!(name, "IFERROR" | "IFNA") && args.len() != 2)
        {
            return Some(Value::Error("#ERROR!"));
        }
        if matches!(name, "IFERROR" | "IFNA") && args.len() == 1 {
            self.eval(&args[0], pos, depth + 1, true)?;
            // Calc leaves the first operand on its stack when the fallback is absent.
            self.extra_operands = true;
            return Some(Value::Error("Err:511"));
        }
        let mut selector = if matches!(name, "IF" | "IFERROR" | "IFNA") {
            Some(self.eval(args.first()?, pos, depth + 1, true)?)
        } else {
            None
        };
        if matches!(name, "IFERROR" | "IFNA")
            && let Some(value @ (Value::Single(_) | Value::Range(..))) = &selector
        {
            let checked = if self.array && matches!(value, Value::Range(..)) {
                Value::Matrix(self.matrix(value.clone(), depth + 1)?)
            } else {
                self.scalar(value.clone(), pos, depth + 1)?
            };
            let caught = |value: &Value| {
                matches!(value, Value::Error(error) | Value::LiteralError(error)
                    if name == "IFERROR" || *error == "#N/A")
            };
            let replace = match &checked {
                Value::Matrix(rows) => rows.iter().flatten().any(caught),
                value => caught(value),
            };
            if !replace {
                return selector;
            }
            selector = Some(checked);
        }
        let matrix_selector = selector.as_ref().is_some_and(|v| {
            matches!(v, Value::Matrix(..))
                || (name == "IF" || self.array) && matches!(v, Value::Range(..))
                || name == "IF" && matches!(v, Value::Set(..))
        });
        if (self.array || matrix_selector || elementwise)
            && (selector.is_none() || matrix_selector)
            && (date_arguments.is_some()
                || elementwise
                || matches!(
                    name,
                    "IF" | "IFERROR"
                        | "IFNA"
                        | "NOT"
                        | "ABS"
                        | "SQRT"
                        | "INT"
                        | "MOD"
                        | "UPPER"
                        | "LOWER"
                ))
        {
            let array = self.array;
            if !elementwise {
                self.array = true;
            }
            let mut shape = None;
            let mut values = Vec::new();
            let mut literal_error = None;
            for arg in args {
                let mut value = match selector.take() {
                    Some(value) => value,
                    None => self.eval(arg, pos, depth + 1, true)?,
                };
                if name == "IF" && self.extra_operands && matches!(value, Value::Error(_)) {
                    self.array = array;
                    return Some(value);
                }
                if elementwise
                    && name != "TEXT"
                    && !month_shift
                    && !search_function
                    && !character_function
                    && !concatenate
                    && !complex_function
                    && !threshold_function
                    && !bessel_function
                    && !random_between
                    && !multiple_rounding
                    && !unit_conversion
                {
                    match value {
                        Value::Error(_) => {
                            self.array = array;
                            return Some(value);
                        }
                        Value::LiteralError(error)
                            if rounding
                                || statistical_function
                                    && !lifetime_function
                                    && !excel_statistics
                                    && !binomial_function
                                    && !chisquare_function
                                    && !beta_function
                                    && !f_function
                                    && !student_function
                                    && !inference_function
                                    && name != "MROUND" =>
                        {
                            literal_error.get_or_insert(error);
                        }
                        _ => {}
                    }
                }
                if elementwise
                    && !array
                    && (self.dynamic.is_some()
                        || !text_function
                            && !financial_function
                            && !basis_function
                            && !day_count
                            && !month_shift)
                {
                    value = self.implicit_invalid_range(arg, value, pos)?;
                    if !matches!(value, Value::Matrix(..))
                        && !(name == "ARABIC" && matches!(value, Value::Single(_)))
                    {
                        value = self.scalar(value, pos, depth + 1)?;
                    }
                }
                // ARABIC distinguishes a blank cell from the number zero.
                // Use the range reader to preserve even a styled blank.
                if name == "ARABIC" {
                    value = value.into_range();
                }
                let is_matrix = matches!(value, Value::Matrix(..) | Value::Range(..));
                let rows = self.matrix(value, depth + 1)?;
                if is_matrix {
                    let dimensions = (rows.len(), rows.first()?.len());
                    shape = Some(shape.map_or(dimensions, |(h, w): (usize, usize)| {
                        (h.max(dimensions.0), w.max(dimensions.1))
                    }));
                }
                values.push(rows);
            }
            if let Some(error) = literal_error {
                self.array = array;
                return Some(Value::Error(error));
            }
            let (height, width) = shape.unwrap_or((1, 1));
            self.work = self.work.checked_sub(
                height
                    .checked_mul(width)?
                    .checked_mul(std::mem::size_of::<Value>())?,
            )?;
            let mut rows = Vec::new();
            self.array = false;
            for r in 0..height {
                let mut row = Vec::new();
                for c in 0..width {
                    self.tick(depth)?;
                    let item = |index: usize| {
                        let matrix = &values[index];
                        matrix
                            .get(if matrix.len() == 1 { 0 } else { r })
                            .and_then(|row| row.get(if row.len() == 1 { 0 } else { c }))
                            .unwrap_or(&Value::Error("#N/A"))
                    };
                    let result = if day_count || month_shift {
                        let mut args = [&Value::Blank; 3];
                        for (index, arg) in args.iter_mut().enumerate().take(values.len()) {
                            *arg = item(index);
                            self.charge_value(arg)?;
                        }
                        if month_shift {
                            date_difference::month_shift(
                                name,
                                &args[..values.len()],
                                self.book.date1904,
                                &mut self.work,
                            )?
                        } else {
                            date_difference::day_count(
                                name,
                                &args[..values.len()],
                                self.book.date1904,
                                &mut self.work,
                            )?
                        }
                    } else if rounding {
                        self.charge_value(item(0))?;
                        if args.len() == 2 {
                            self.charge_value(item(1))?;
                        }
                        rounding::calculate(
                            if name == "TRUNC" && self.dynamic.is_some() {
                                "TRUNC.XLSX"
                            } else {
                                name
                            },
                            item(0),
                            (args.len() == 2).then(|| item(1)),
                            self.book.date1904,
                        )
                    } else if random_between {
                        self.charge_value(item(0))?;
                        self.charge_value(item(1))?;
                        self.random_between([item(0), item(1)])?
                    } else if bessel_function {
                        self.charge_value(item(0))?;
                        self.charge_value(item(1))?;
                        bessel::calculate(
                            name,
                            [item(0), item(1)],
                            self.book.date1904,
                            &mut self.work,
                        )?
                    } else if complex_function {
                        let mut items = [&Value::Blank; 3];
                        for (index, value) in items.iter_mut().enumerate().take(values.len()) {
                            *value = item(index);
                            self.charge_value(value)?;
                        }
                        complex::calculate(
                            name,
                            &items[..values.len()],
                            self.book.date1904,
                            &mut self.work,
                        )?
                    } else if basis_function {
                        let mut items = [&Value::Blank; 3];
                        for (index, item_value) in items.iter_mut().enumerate().take(values.len()) {
                            *item_value = item(index);
                            self.charge_value(item_value)?;
                        }
                        let minimum_omitted =
                            args.len() < 3 || matches!(args[2], Expr::Value(Value::Blank));
                        basis::calculate(
                            name,
                            &items[..values.len()],
                            self.book.date1904,
                            minimum_omitted,
                            &mut self.work,
                        )?
                    } else if financial_function {
                        let mut args = [&Value::Blank; 9];
                        for (index, arg) in args.iter_mut().enumerate().take(values.len()) {
                            *arg = item(index);
                            self.charge_value(arg)?;
                        }
                        finance::calculate(
                            name,
                            &args[..values.len()],
                            self.book.date1904,
                            &mut self.work,
                        )?
                    } else if statistical_function {
                        let mut args = [&Value::Blank; 6];
                        for (index, arg) in args.iter_mut().enumerate().take(values.len()) {
                            *arg = item(index);
                            self.charge_value(arg)?;
                        }
                        if inference_function {
                            statistics::inference::calculate(
                                name,
                                &args[..values.len()],
                                self.book.date1904,
                                &mut self.work,
                            )?
                        } else if student_function {
                            statistics::student::calculate(
                                name,
                                &args[..values.len()],
                                self.book.date1904,
                                &mut self.work,
                            )?
                        } else if f_function {
                            statistics::f_distribution::calculate(
                                name,
                                &args[..values.len()],
                                self.book.date1904,
                                &mut self.work,
                            )?
                        } else if beta_function {
                            statistics::beta::calculate(
                                name,
                                &args[..values.len()],
                                self.book.date1904,
                                beta_upper_omitted,
                                &mut self.work,
                            )?
                        } else if chisquare_function {
                            statistics::chisquare::calculate(
                                name,
                                &args[..values.len()],
                                self.book.date1904,
                                &mut self.work,
                            )?
                        } else if binomial_function {
                            statistics::binomial::calculate(
                                name,
                                &args[..values.len()],
                                self.book.date1904,
                                &mut self.work,
                            )?
                        } else if lifetime_function {
                            lifetime::calculate(
                                &args[..values.len()],
                                self.book.date1904,
                                &mut self.work,
                            )?
                        } else if mathematical_function {
                            mathematics::calculate(
                                name,
                                &args[..values.len()],
                                self.book.date1904,
                                self.dynamic.is_some(),
                            )
                        } else {
                            statistics::calculate(
                                name,
                                &args[..values.len()],
                                self.book.date1904,
                                excel_statistics,
                                &mut self.work,
                            )?
                        }
                    } else if unit_conversion {
                        for index in 0..3 {
                            self.charge_value(item(index))?;
                        }
                        convert::calculate(
                            [item(0), item(1), item(2)],
                            self.book.date1904,
                            &mut self.work,
                        )?
                    } else if euroconvert {
                        let mut args = [&Value::Blank; 5];
                        for (index, arg) in args.iter_mut().enumerate().take(values.len()) {
                            *arg = item(index);
                            self.charge_value(arg)?;
                        }
                        euro::calculate(&args[..values.len()], self.book.date1904)
                    } else if concatenate {
                        strings::concatenate((0..values.len()).map(item), &mut self.work)?
                    } else if string_function || text_function {
                        let mut args = [&Value::Blank; 4];
                        for (index, arg) in args.iter_mut().enumerate().take(values.len()) {
                            *arg = item(index);
                            self.charge_value(arg)?;
                        }
                        if matches!(name, "VALUE" | "NUMBERVALUE" | "FIXED" | "DOLLAR") {
                            number_text::calculate(
                                name,
                                &args[..values.len()],
                                self.book.date1904,
                                formatted_decimals_omitted,
                                &mut self.work,
                            )?
                        } else if matches!(name, "DATEVALUE" | "TIMEVALUE") {
                            date_text::calculate(name, args[0], self.book.date1904, &mut self.work)?
                        } else if name == "TEXT" {
                            text_format::calculate(
                                args[0],
                                args[1],
                                self.book.date1904,
                                &mut self.work,
                            )?
                        } else if text_function {
                            strings::text(name, &args[..values.len()], &mut self.work)?
                        } else {
                            strings::calculate(name, &args[..values.len()], self.book.date1904)
                        }
                    } else {
                        let mut args = Vec::new();
                        for index in 0..values.len() {
                            let value = item(index);
                            self.charge_value(value)?;
                            args.push(Expr::Value(value.clone()));
                        }
                        self.call(name, &args, pos, depth + 1)?
                    };
                    row.push(self.scalar(result, pos, depth + 1)?);
                }
                rows.push(row);
            }
            self.array = array;
            return Some(if shape.is_some() {
                Value::Matrix(rows)
            } else {
                rows.pop()?.pop()?
            });
        }
        if date_arguments.is_some() {
            return self.date_function(name, args, pos, depth);
        }
        if super::function_names::name(name, false).is_none() {
            // Unknown functions evaluate argument expressions but do not consume
            // references or coerce ranges. Only expression errors take precedence.
            let mut error = None;
            for arg in args {
                match self.eval(arg, pos, depth + 1, true)? {
                    Value::Error(e) => return Some(Value::Error(e)),
                    Value::LiteralError(e) => {
                        error.get_or_insert(e);
                    }
                    _ => {}
                }
            }
            return Some(Value::Error(error.unwrap_or("#NAME?")));
        }
        if matches!(name, "IF" | "IFERROR" | "IFNA") {
            let value = match selector {
                Some(value) => value,
                None => self.eval(&args[0], pos, depth + 1, true)?,
            };
            let value = if name != "IF"
                && let Value::InvalidRange(a, b) = value
            {
                if self.array {
                    Value::Error("#REF!")
                } else {
                    let column = |value| if value == usize::MAX { 0 } else { value };
                    let cell = self.scalar(
                        Value::Range((a.0, a.1, column(a.2)), (b.0, b.1, column(b.2))),
                        pos,
                        depth + 1,
                    )?;
                    // IFERROR clears the reference-pop error before inspecting the
                    // intersected cell; a successful check returns the original token.
                    if !matches!(cell, Value::Error(e) | Value::LiteralError(e)
                        if name == "IFERROR" || e == "#N/A")
                    {
                        return Some(value);
                    }
                    cell
                }
            } else {
                value
            };
            if name != "IF" && matches!(value, Value::InvalidReference | Value::Set(_)) {
                return Some(value);
            }
            let value = self.scalar(value, pos, depth + 1)?;
            let selected = if name == "IF" {
                if let Value::Error(error) | Value::LiteralError(error) = value {
                    return Some(Value::Error(error));
                }
                let number = match &value {
                    Value::Text(text) | Value::UninternedText(text) => {
                        lookup::number::parse(text, self.book.date1904)
                    }
                    _ => value.numeric(),
                };
                match number {
                    Some(n) => usize::from(n == 0.) + 1,
                    None => return Some(Value::Error("#VALUE!")),
                }
            } else if matches!(value,Value::Error(e) | Value::LiteralError(e) if name == "IFERROR" || e == "#N/A")
            {
                1
            } else {
                return Some(value);
            };
            return match args.get(selected) {
                Some(arg) => self.eval(arg, pos, depth + 1, true),
                None => Some(Value::Bool(selected == 1)),
            };
        }
        let count = args.len();
        let limits = match name {
            "MOD" => Some((2, 2)),
            _ => None,
        };
        if let Some((minimum, maximum)) = limits
            && (count < minimum || count > maximum)
        {
            return Some(Value::Error(if count < minimum {
                "Err:511"
            } else {
                "Err:504"
            }));
        }
        let aggregate = matches!(
            name,
            "SUM"
                | "AVERAGE"
                | "MIN"
                | "MAX"
                | "COUNT"
                | "COUNTA"
                | "AND"
                | "OR"
                | "XOR"
                | "PRODUCT"
        );
        if args.is_empty() && matches!(name, "MIN" | "MAX" | "AND" | "OR" | "XOR") {
            return Some(Value::Error("Err:511"));
        }
        if name == "NA" && args.is_empty() {
            return Some(Value::Error("#N/A"));
        }
        let mut values = Vec::new();
        let mut aggregate_format = None;
        let sums = matches!(name, "SUM" | "AVERAGE");
        let mut sum_arguments = Vec::new();
        for arg in args {
            let mut sum_terms = Vec::new();
            // Named expressions may retain unprefixed aggregate names. Share
            // the bounded coordinate reduction without changing Calc coercion.
            let coordinates =
                (self.dynamic.is_some() && self.array && matches!(name, "MIN" | "MAX"))
                    .then(|| filter::coordinate_product(arg))
                    .flatten();
            let mut value = match coordinates {
                Some((source, vertical, mask)) => {
                    self.coordinate_extrema(arg, source, vertical, mask, name == "MAX", pos, depth)?
                }
                None => self.eval(arg, pos, depth + 1, true)?,
            };
            if !aggregate {
                value = self.implicit_invalid_range(arg, value, pos)?;
            }
            let mut pending = vec![value];
            let mut format_position = None;
            let mut formats_argument = false;
            while let Some(value) = pending.pop() {
                if matches!(value, Value::InvalidReference | Value::InvalidRange(..)) {
                    return Some(Value::Error("#REF!"));
                }
                if aggregate && let Value::Set(mut set) = value {
                    self.tick(depth)?;
                    set.reverse();
                    pending.extend(set);
                    continue;
                }
                if aggregate && let Value::Matrix(rows) = value {
                    if sums {
                        let mut sum = summation::Sum::default();
                        for column in 0..rows.first().map_or(0, Vec::len) {
                            for row in &rows {
                                self.tick(depth)?;
                                if let Some(value @ (Value::Number(_) | Value::Bool(_))) =
                                    row.get(column)
                                {
                                    sum.add(value.numeric()?);
                                }
                            }
                        }
                        sum_terms.push(summation::Term::Group(sum));
                    }
                    let mut numeric = false;
                    for row in rows {
                        for value in row {
                            self.tick(depth)?;
                            let value = match value {
                                Value::Bool(b) if !excel_count => Value::Number(f64::from(b)),
                                Value::Blank
                                | Value::Empty
                                | Value::Text(_)
                                | Value::UninternedText(_)
                                    if matches!(name, "AND" | "OR" | "XOR") =>
                                {
                                    Value::Error("Err:502")
                                }
                                value => value,
                            };
                            numeric |= matches!(
                                value,
                                Value::Number(_) | Value::Error(_) | Value::LiteralError(_)
                            );
                            values.push((value, true));
                        }
                    }
                    formats_argument |= numeric;
                    if !numeric && matches!(name, "MIN" | "MAX") {
                        values.push((Value::Number(0.), false));
                    }
                } else if aggregate && let Value::Single(coord) = value {
                    let value = self.cell(coord, depth + 1)?;
                    if matches!(value, Value::Number(_) | Value::Bool(_)) {
                        formats_argument = true;
                        format_position.get_or_insert(coord);
                        if sums {
                            sum_terms.push(summation::Term::Number(value.numeric()?));
                        }
                    }
                    values.push((value, true));
                } else if aggregate && let Value::Range(a, b) = value {
                    self.read_spill_range(a, b)?;
                    let cells: BTreeSet<_> = self
                        .values
                        .keys()
                        .chain(self.expressions.keys())
                        .copied()
                        .filter(|c| {
                            (a.0.min(b.0)..=a.0.max(b.0)).contains(&c.0)
                                && (a.1.min(b.1)..=a.1.max(b.1)).contains(&c.1)
                                && (a.2.min(b.2)..=a.2.max(b.2)).contains(&c.2)
                        })
                        .collect();
                    let mut sum_cells = Vec::new();
                    for coord in cells {
                        let value = self.cell(coord, depth + 1)?;
                        if sums && matches!(value, Value::Number(_) | Value::Bool(_)) {
                            sum_cells.push((
                                coord,
                                value.numeric()?,
                                self.expressions.contains_key(&coord),
                            ));
                        }
                        if matches!(value, Value::Number(_) | Value::Bool(_)) {
                            formats_argument = true;
                            let order = |c: Coord| (c.0, c.2, c.1);
                            if format_position.is_none_or(|old| {
                                if name == "SUM" {
                                    order(coord) > order(old)
                                } else {
                                    order(coord) < order(old)
                                }
                            }) {
                                format_position = Some(coord);
                            }
                        }
                        values.push((value, true));
                    }
                    if sums {
                        sum_cells.sort_unstable_by_key(|(c, _, _)| (c.0, c.2, c.1));
                        if name == "SUM" {
                            sum_terms.push(summation::Term::Group(summation::range(&sum_cells)));
                        } else {
                            sum_terms.extend(
                                sum_cells
                                    .into_iter()
                                    .map(|(_, n, _)| summation::Term::Number(n)),
                            );
                        }
                    }
                } else {
                    let value = self.scalar(value, pos, depth + 1)?;
                    if sums && let Some(n) = value.numeric() {
                        sum_terms.push(summation::Term::Number(n));
                    }
                    formats_argument |= matches!(value, Value::Number(_) | Value::Bool(_));
                    values.push((value, matches!(arg, Expr::Ref(_))));
                }
            }
            if sums {
                sum_arguments.push(sum_terms);
            }
            if aggregate_format.is_none() && formats_argument {
                aggregate_format =
                    Some(format_position.and_then(|coord| self.formats.get(&coord).copied()));
            }
        }
        self.result_format = aggregate_format.flatten().and_then(Format::aggregate);
        if !matches!(name, "MIN" | "MAX")
            && self
                .result_format
                .is_some_and(|f| f.kind == FormatKind::Logical)
        {
            self.result_format = None;
        }
        if name == "COUNTA" {
            return Some(Value::Number(
                values
                    .iter()
                    .filter(|(v, reference)| {
                        !reference || !matches!(v, Value::Blank | Value::Empty)
                    })
                    .count() as f64,
            ));
        }
        if let Some((Value::Error(error) | Value::LiteralError(error), _)) = values
            .iter()
            .find(|(v, _)| matches!(v, Value::Error(_) | Value::LiteralError(_)))
            && name != "COUNT"
        {
            return Some(Value::Error(error));
        }
        if aggregate {
            let mut numbers = Vec::new();
            for (value, reference) in &values {
                if excel_count && *reference && matches!(value, Value::Bool(_)) {
                    continue;
                }
                if *reference
                    && matches!(
                        value,
                        Value::Blank | Value::Empty | Value::Text(_) | Value::UninternedText(_)
                    )
                {
                    continue;
                }
                if matches!(value, Value::Text(_) | Value::UninternedText(_)) && name != "COUNT" {
                    return Some(Value::Error(if matches!(name, "MIN" | "MAX") {
                        "Err:504"
                    } else {
                        "#VALUE!"
                    }));
                }
                if let Some(n) = value.numeric() {
                    numbers.push(n);
                } else if name != "COUNT" {
                    return Some(Value::Error("#VALUE!"));
                }
            }
            return Some(match name {
                "COUNT" => Value::Number(numbers.len() as f64),
                "AND" => {
                    if numbers.is_empty() {
                        Value::Error("#VALUE!")
                    } else {
                        Value::Bool(numbers.iter().all(|n| *n != 0.))
                    }
                }
                "OR" | "XOR" => {
                    if numbers.is_empty() {
                        Value::Error("#VALUE!")
                    } else if name == "OR" {
                        Value::Bool(numbers.iter().any(|n| *n != 0.))
                    } else {
                        Value::Bool(numbers.iter().fold(false, |value, n| value ^ (*n != 0.)))
                    }
                }
                "MIN" => Value::number(numbers.into_iter().reduce(f64::min).unwrap_or(0.)),
                "MAX" => Value::number(numbers.into_iter().reduce(f64::max).unwrap_or(0.)),
                "PRODUCT" => Value::number(if numbers.is_empty() {
                    0.
                } else {
                    numbers.into_iter().product()
                }),
                "AVERAGE" if numbers.is_empty() => Value::Error("#DIV/0!"),
                _ => {
                    let mut sum = summation::Sum::default();
                    for terms in sum_arguments.into_iter().rev() {
                        for term in terms {
                            self.tick(depth)?;
                            match term {
                                summation::Term::Number(n) => sum.add(n),
                                summation::Term::Group(group) => sum.merge(group),
                            }
                        }
                    }
                    let total = sum.total();
                    Value::number(if name == "AVERAGE" {
                        total / numbers.len() as f64
                    } else {
                        total
                    })
                }
            });
        }
        let value = |index: usize| values.get(index).map(|(v, _)| v);
        let n = |index| value(index).and_then(Value::numeric);
        let count = values.len();
        Some(match name {
            "TRUE" | "FALSE" if count == 0 => Value::Bool(name == "TRUE"),
            "NOT" if count == 1 => {
                let boolean = if self.dynamic.is_some() {
                    value(0).and_then(lookup::boolean)
                } else {
                    n(0).map(|n| n != 0.)
                        .or_else(|| value(0).and_then(lookup::boolean))
                };
                boolean.map_or(Value::Error("#VALUE!"), |value| Value::Bool(!value))
            }
            "ABS" | "SQRT" | "INT" if count == 1 => n(0).map_or(Value::Error("#VALUE!"), |n| {
                Value::number(match name {
                    "ABS" => n.abs(),
                    "SQRT" if n < 0. => {
                        return Value::Error(if self.dynamic.is_some() {
                            "#NUM!"
                        } else {
                            "Err:502"
                        });
                    }
                    "SQRT" => n.sqrt(),
                    _ => n.floor(),
                })
            }),
            "MOD" if count == 2 => match (n(0), n(1)) {
                (_, Some(0.)) => Value::Error("#DIV/0!"),
                (Some(a), Some(b)) => Value::number(a - b * (a / b).floor()),
                _ => Value::Error("#VALUE!"),
            },
            "TRIM" if count == 1 => {
                let text = value(0)?.text();
                self.work = self.work.checked_sub(text.len())?;
                let mut trimmed = String::with_capacity(text.len());
                for word in text.split(' ').filter(|s| !s.is_empty()) {
                    if !trimmed.is_empty() {
                        trimmed.push(' ');
                    }
                    trimmed.push_str(word);
                }
                Value::Text(trimmed)
            }
            "UPPER" | "LOWER" if count == 1 => {
                let text = if self.dynamic.is_some() {
                    strings::string(value(0)?)
                } else {
                    std::borrow::Cow::Owned(value(0)?.text())
                };
                Value::Text(if name == "UPPER" {
                    super::collation::uppercase(&text, &mut self.work)?
                } else {
                    self.work = self.work.checked_sub(text.len().checked_mul(3)?)?;
                    text.to_lowercase()
                })
            }
            _ => Value::Error("#NAME?"),
        })
    }
}

fn unary(op: u8, value: Value) -> Value {
    if op == b'+' || matches!(value, Value::Error(_)) {
        return value;
    }
    if let Value::LiteralError(error) = value {
        return Value::Error(error);
    }
    match value.numeric() {
        Some(n) if op == b'-' => Value::Number(-n),
        Some(n) => Value::number(n / 100.),
        None => Value::Error("#VALUE!"),
    }
}
fn binary(op: &str, a: Value, mut b: Value) -> Value {
    if let Value::Error(error) | Value::LiteralError(error) = a {
        return Value::Error(error);
    }
    if let Value::LiteralError(error) = b {
        b = Value::Error(error);
    }
    if op == "&" {
        return b;
    }
    let Some(left) = a.numeric() else {
        return Value::Error("#VALUE!");
    };
    if matches!(b, Value::Error(_)) {
        return b;
    }
    let Some(right) = b.numeric() else {
        return Value::Error("#VALUE!");
    };
    if op == "/" && right == 0. {
        return Value::Error("#DIV/0!");
    }
    if op == "^"
        && (left == 0. && right < 0.
            || left < 0.
                && (right.fract() != 0. || !(-2147483648. ..=2147483647.).contains(&right)))
    {
        return Value::Error("#NUM!");
    }
    let result = match op {
        "+" if left.is_sign_negative() != right.is_sign_negative()
            && approximately_equal(left, -right) =>
        {
            0.
        }
        "-" if left.is_sign_negative() == right.is_sign_negative()
            && approximately_equal(left, right) =>
        {
            0.
        }
        "+" => left + right,
        "-" => left - right,
        "*" => left * right,
        "/" => left / right,
        _ => {
            // Wasm's pow approximation can miss the correctly rounded sqrt(2)
            // multiple by one ULP. For exact powers of two the normal result
            // of a half-integer exponent only needs binary scaling and sqrt(2).
            let exponent = ((left.to_bits() >> 52) & 0x7ff) as i32 - 1023;
            let power = f64::from(exponent) * right;
            if left > 0.
                && exponent > -1023
                && left.to_bits() & 0x000f_ffff_ffff_ffff == 0
                && right.fract().abs() == 0.5
                && power.fract().abs() == 0.5
                && (-1022. ..1024.).contains(&power)
            {
                let scale = f64::from_bits(((power.floor() as i32 + 1023) as u64) << 52);
                scale * std::f64::consts::SQRT_2
            } else {
                left.powf(right)
            }
        }
    };
    if op == "^" && left != 0. && (result == 0. || result.is_subnormal()) {
        Value::Error("#NUM!")
    } else {
        Value::number(result)
    }
}

// libstdc++'s 64-bit std::hash<double>, used by the native Calc token hash.
// Both signed zeros hash to zero.
pub(in crate::commands) fn number_hash(number: f64) -> u64 {
    if number == 0. {
        return 0;
    }
    let m = 0xc6a4a7935bd1e995u64;
    let mut k = number.to_bits().wrapping_mul(m);
    k ^= k >> 47;
    k = k.wrapping_mul(m);
    let mut h = (0xc70f6907 ^ 8u64.wrapping_mul(m)) ^ k;
    h = h.wrapping_mul(m);
    h ^= h >> 47;
    h = h.wrapping_mul(m);
    h ^ (h >> 47)
}

// Calc compares within 2^-48 relative to both operands, except zero,
// opposite signs and distinct exactly representable integers.
pub(in crate::commands) fn approximately_equal(a: f64, b: f64) -> bool {
    let difference = (a - b).abs();
    a == b
        || a != 0.
            && b != 0.
            && a.is_sign_negative() == b.is_sign_negative()
            && difference < a.abs() * (1. / 281_474_976_710_656.)
            && difference < b.abs() * (1. / 281_474_976_710_656.)
            && !(a.abs() < 9_007_199_254_740_992.
                && b.abs() < 9_007_199_254_740_992.
                && a.fract() == 0.
                && b.fract() == 0.)
}

#[cfg(test)]
pub(super) fn calculate(
    rows: &[Vec<String>],
    numeric: &BTreeSet<(usize, usize)>,
    sheet: &str,
    limit: usize,
) -> Option<BTreeMap<(usize, usize), (Value, bool)>> {
    let book = Workbook {
        string_ref_syntax: crate::commands::spreadsheet::model::StringRefSyntax::CalcA1,
        ..Default::default()
    };
    // CSV formulas compile before the sheet is renamed to the filename.
    // String references resolve afterward against the imported filename.
    let sheets = vec![sheet.into()];
    let imported = vec!["Sheet1".into()];
    let mut calc = Calculation::new(&book, &sheets, vec![(1_048_576, 16_384)], limit);
    let mut logical = BTreeSet::new();
    for (r, row) in rows.iter().enumerate() {
        for (c, text) in row.iter().enumerate() {
            let position = (0, r, c);
            if let Some(source) = text
                .strip_prefix('=')
                .filter(|s| !s.is_empty() && !s.contains(['\r', '\n']))
            {
                let source = super::csv::reference_text(
                    source,
                    "Sheet1",
                    super::csv::FormulaMode::Calculate,
                    &mut calc.work,
                )?;
                let source = super::csv::text_from_units(source.into_iter(), true, calc.work)?;
                let expression = parse(
                    &source,
                    &imported,
                    &book,
                    (position.0, position.1 as i64, position.2 as i64),
                    Some(0),
                    true,
                    None,
                    calc.work,
                    false,
                )
                .ok()?;
                let expression =
                    expression.unwrap_or_else(|| Expr::Value(Value::Error(syntax_error(&source))));
                if expression.compiled_logical(&[], &mut calc.work)? {
                    calc.work = calc.work.checked_sub(64)?;
                    logical.insert(position);
                }
                // CSV import leaves every cell in General, independently of
                // the compiler format used for the formula's exported cache.
                calc.work = calc
                    .work
                    .checked_sub(std::mem::size_of::<(Coord, Format<'_>)>() + 32)?;
                calc.formats.insert(
                    position,
                    Format {
                        pattern: "General",
                        kind: FormatKind::Number,
                    },
                );
                calc.expressions.insert(position, expression);
                calc.values.insert(position, Value::Blank);
            } else {
                let value = if text.is_empty() {
                    Value::Blank
                } else if let Some(day) = date_serial(text) {
                    Value::Number(day as f64)
                } else if numeric.contains(&(r, c)) {
                    Value::Number(text.parse().ok()?)
                } else {
                    Value::Text(text.clone())
                };
                calc.values.insert(position, value);
            }
        }
    }
    let coordinates: Vec<_> = calc.expressions.keys().copied().collect();
    for coord in coordinates {
        calc.cell(coord, 0)?;
    }
    Some(
        calc.results
            .into_iter()
            .map(|((_, r, c), v)| {
                (
                    (r, c),
                    (
                        if matches!(v, Value::Blank) {
                            Value::Number(0.)
                        } else {
                            v
                        },
                        logical.contains(&(0, r, c)),
                    ),
                )
            })
            .collect(),
    )
}
fn syntax_error(source: &str) -> &'static str {
    let mut parentheses = 0i64;
    let mut quote = None;
    let mut unmatched = false;
    for c in source.chars() {
        if let Some(delimiter) = quote {
            if c == delimiter {
                quote = None;
            }
        } else {
            match c {
                '\'' | '"' => quote = Some(c),
                '(' => parentheses += 1,
                ')' => {
                    parentheses -= 1;
                    unmatched |= parentheses < 0;
                }
                _ => {}
            }
        }
    }
    if unmatched || parentheses != 0 {
        "Err:508"
    } else {
        "Err:520"
    }
}

// Match IronCalc's formula-entry correction: try one closing parenthesis,
// but keep the original input unless the existing AST parser accepts it.
// This is only called for user edits; import and converter parsing stay strict.
pub(super) fn complete_input<'a>(
    source: &'a str,
    sheets: &[String],
    book: &Workbook,
    position: Coord,
    work: &mut usize,
) -> Option<std::borrow::Cow<'a, str>> {
    use std::borrow::Cow;
    if !source.contains('(') {
        return Some(Cow::Borrowed(source));
    }
    *work = work.checked_sub(source.len().checked_add(8)?.checked_mul(2)?)?;
    let mut formula = format!("msoxl:={source}");
    let position = (position.0, position.1 as i64, position.2 as i64);
    let original = parse(
        &formula,
        sheets,
        book,
        position,
        Some(position.0),
        false,
        None,
        *work,
        true,
    )
    .ok()?;
    if !matches!(original, None | Some(Expr::Value(Value::Error(_)))) {
        return Some(Cow::Borrowed(source));
    }
    drop(original);
    *work = work.checked_sub(formula.len().checked_add(1)?)?;
    formula.push(')');
    let corrected = parse(
        &formula,
        sheets,
        book,
        position,
        Some(position.0),
        false,
        None,
        *work,
        true,
    )
    .ok()?;
    if matches!(corrected, None | Some(Expr::Value(Value::Error(_)))) {
        return Some(Cow::Borrowed(source));
    }
    *work = work.checked_sub(source.len().checked_add(1)?)?;
    Some(Cow::Owned(format!("{source})")))
}

fn parse(
    source: &str,
    sheets: &[String],
    book: &Workbook,
    position: (usize, i64, i64),
    scope: Option<usize>,
    csv: bool,
    definition: Option<usize>,
    limit: usize,
    editor: bool,
) -> Result<Option<Expr>, ()> {
    let compiled = definition.and_then(|i| book.names[i].compiled.as_ref());
    let source = compiled.map_or(source, |name| name.expression.as_str());
    let mut work = limit;
    let mut converted = None;
    if compiled.is_some() && source.starts_with("of:=") && source.contains(';') {
        let mut formula =
            crate::commands::spreadsheet::ods_formula::convert(source, false, work, true)
                .map_err(|_| ())?
                .ok_or(())?;
        formula
            .compile_separators(
                &book.names,
                sheets,
                position.0,
                compiled.map(|name| &name.bindings),
                &mut work,
            )
            .map_err(|_| ())?;
        converted = formula.openformula;
    }
    let source = converted.as_deref().unwrap_or(source);
    let limit = work;
    let odf = source.starts_with("of:=");
    let xlsx = source.starts_with("msoxl:=");
    let source = source
        .strip_prefix("of:=")
        .or_else(|| source.strip_prefix("msoxl:="))
        .or_else(|| source.strip_prefix('='))
        .unwrap_or(source);
    let source = if xlsx {
        let source = source.trim_start_matches(' ');
        source
            .strip_prefix('=')
            .unwrap_or(source)
            .trim_end_matches(' ')
    } else {
        source
    };
    if !xlsx
        && let Some(error) = [
            "Err:501", "Err:502", "Err:504", "Err:533", "Err:538", "Err:539", "Err:508", "Err:509",
            "Err:510", "Err:511", "Err:512", "Err:513", "Err:514", "Err:520", "Err:522", "Err:523",
        ]
        .into_iter()
        .find(|&e| e == source)
    {
        return Ok(Some(Expr::Value(Value::Error(error))));
    }
    let mut parser = Parser {
        source,
        nodes: (limit / std::mem::size_of::<Expr>()).min(8192),
        limited: false,
        error: None,
        raw_tail: false,
        editor,
        arrays: 0,
        uninterned_arrays: definition.is_none()
            && position.1 >= 0
            && position.2 >= 0
            && book.uninterned_arrays.contains(&(
                position.0,
                position.1 as usize,
                position.2 as usize,
            )),
        sheets: sheets.iter().map(String::as_str),
        names: &book.names,
        tables: &book.tables,
        bindings: compiled.map(|name| &name.bindings),
        operators: Vec::new(),
        name_stack: definition.into_iter().collect(),
        locals: Vec::new(),
        lambda_depth: 0,
        local_tokens: None,
        name_tokens: None,
        export_names: None,
        position,
        scope,
        odf,
        xlsx,
        csv,
        r1c1: false,
        sizes: &[],
    };
    let expression = parser.expression(0, 0, false);
    parser.space();
    if xlsx && (parser.source.starts_with(';') || expression.is_some() && !parser.source.is_empty())
    {
        parser
            .error
            .get_or_insert(if parser.source.starts_with([')', '}']) {
                "Err:508"
            } else {
                "Err:509"
            });
    }
    if parser.limited {
        return Err(());
    }
    Ok(if let Some(error) = parser.error {
        Some(Expr::Value(Value::Error(error)))
    } else {
        expression.filter(|_| parser.source.is_empty())
    })
}

// Grouping compares compiled expressions, including relative reference offsets.
// Matrix constants and compiler errors have no shareable RPN representation.
pub(super) fn xlsx_group_expression(
    source: &str,
    book: &Workbook,
    sheets: &[String],
    position: Coord,
    work: &mut usize,
) -> Result<Option<Expr>, ()> {
    *work = work.checked_sub(source.len() + 8).ok_or(())?;
    let source = format!("msoxl:={source}");
    let Some(root) = parse(
        &source,
        sheets,
        book,
        (position.0, position.1 as i64, position.2 as i64),
        Some(position.0),
        false,
        None,
        *work,
        false,
    )?
    else {
        return Ok(None);
    };
    let inspect = |root: &Expr, work: &mut usize| -> Result<Option<Vec<usize>>, ()> {
        let mut pending = vec![root];
        let mut names = Vec::new();
        while let Some(expr) = pending.pop() {
            *work = work.checked_sub(128).ok_or(())?;
            match expr {
                Expr::Value(Value::Matrix(_)) | Expr::MatrixCell(..) => {
                    return Ok(None);
                }
                Expr::Value(Value::Error(error)) if error.starts_with("Err:") => return Ok(None),
                Expr::Name(index) => names.push(*index),
                Expr::Group(child) | Expr::Unary(_, child) => pending.push(child),
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
        Ok(Some(names))
    };
    let Some(names) = inspect(&root, work)? else {
        return Ok(None);
    };
    let mut pending: Vec<_> = names.into_iter().map(|index| (index, false)).collect();
    let mut active = BTreeSet::new();
    let mut complete = BTreeSet::new();
    while let Some((index, leaving)) = pending.pop() {
        *work = work.checked_sub(128).ok_or(())?;
        if leaving {
            active.remove(&index);
            complete.insert(index);
            continue;
        }
        if complete.contains(&index) {
            continue;
        }
        if !active.insert(index) {
            return Ok(None);
        }
        let Some(name) = book.names.get(index) else {
            return Ok(None);
        };
        let source = name.openformula.as_deref().unwrap_or(&name.expression);
        *work = work.checked_sub(source.len()).ok_or(())?;
        let Some(expr) = parse(
            source,
            sheets,
            book,
            name.position,
            name.sheet,
            false,
            Some(index),
            *work,
            false,
        )?
        else {
            return Ok(None);
        };
        let Some(names) = inspect(&expr, work)? else {
            return Ok(None);
        };
        pending.push((index, true));
        pending.extend(names.into_iter().map(|index| (index, false)));
    }
    Ok(Some(root))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn countblank_matches_native_arguments_and_sparse_ranges() {
        // LibreOffice 24.8.7.2: scalar values are rejected; matrix values are counted.
        for (formula, expected) in [
            ("=COUNTBLANK()", "Err:511"),
            ("=COUNTBLANK(0)", "Err:504"),
            ("=COUNTBLANK(1)", "Err:504"),
            ("=COUNTBLANK(\"\")", "Err:504"),
            ("=COUNTBLANK(\"x\")", "Err:504"),
            ("=COUNTBLANK(TRUE())", "Err:504"),
            ("=COUNTBLANK(1/0)", "#DIV/0!"),
            ("=COUNTBLANK(A100:B102)", "6"),
            ("=COUNTBLANK(A100,B100)", "Err:504"),
            ("=COUNTBLANK({0;\"\";\"x\"})", "1"),
            ("=COUNTBLANK(#REF!)", "Err:504"),
            ("=COUNTBLANK((A100,B100))", "2"),
            ("=COUNTBLANK(#N/A)", "Err:504"),
            ("=COUNTBLANK(#DIV/0!)", "Err:504"),
            ("=COUNTBLANK(#VALUE!)", "Err:504"),
            ("=COUNTBLANK(INDEX(A1:A2,3))", "#REF!"),
            ("=COUNTBLANK(INDIRECT(\"XFE1\"))", "#REF!"),
        ] {
            let values =
                calculate(&[vec![formula.into()]], &BTreeSet::new(), "Sheet1", 65536).unwrap();
            assert_eq!(values[&(0, 0)].0.cached(), expected, "{formula}");
        }
        let rows = vec![
            vec![
                "=COUNTBLANK((A100:A101,A101:A102))",
                "=COUNTBLANK(C1:XFD1048576)",
            ],
            vec!["", "=1/0", "=\"\"", "text", "0", "=COUNTBLANK(A2:E2)"],
        ]
        .into_iter()
        .map(|row| row.into_iter().map(str::to_owned).collect())
        .collect::<Vec<_>>();
        let values = calculate(&rows, &BTreeSet::from([(1, 4)]), "Sheet1", 65536).unwrap();
        for (position, expected) in [((0, 0), "4"), ((0, 1), "17177772029"), ((1, 5), "2")] {
            assert_eq!(values[&position].0.cached(), expected, "{position:?}");
        }
    }

    #[test]
    fn countblank_charges_repeated_sparse_range_scans() {
        let mut rows = vec![vec!["value".to_owned()]];
        rows.extend((0..32).map(|_| vec!["=COUNTBLANK(A1:B1)".into()]));
        assert!(calculate(&rows, &BTreeSet::new(), "Sheet1", 4096).is_none());
        assert!(calculate(&rows, &BTreeSet::new(), "Sheet1", 65536).is_some());
    }

    #[test]
    fn out_of_range_literals_are_compile_errors() {
        for literal in [
            "1e309", "-1e309", "+1e309", "1e309%", "1e-308", "5e-324", "1e-999",
        ] {
            for formula in [
                format!("={literal}"),
                format!("=IFERROR({literal},42)"),
                format!("=IF(FALSE,{literal},42)"),
                format!("={{{literal}}}"),
            ] {
                let result =
                    calculate(&[vec![formula.clone()]], &BTreeSet::new(), "Sheet1", 65536).unwrap();
                assert!(
                    matches!(result[&(0, 0)].0, Value::Error("Err:502")),
                    "{formula}: {:?}",
                    result[&(0, 0)]
                );
            }
        }
    }

    #[test]
    fn repeated_text_formula_results_are_charged() {
        for formula in [
            "=UPPER(A1)",
            "=TRIM(A1)",
            "=A1",
            "=A2",
            "=INDEX(A1:A2,1)",
            "=INDEX((A1,A2),1,1,2)",
        ] {
            let mut rows = vec![vec!["x".repeat(256)], vec!["=UPPER(A1)".into()]];
            rows.extend((0..32).map(|_| vec![formula.into()]));
            assert!(
                calculate(&rows, &BTreeSet::new(), "Sheet1", 4096).is_none(),
                "{formula}"
            );
            assert!(
                calculate(&rows, &BTreeSet::new(), "Sheet1", 65536).is_some(),
                "{formula}"
            );
        }
    }

    #[test]
    fn excel_statistical_arity_retains_converter_compiler_errors() {
        let book = Workbook::default();
        let sheets = vec!["Sheet1".to_owned()];
        for name in [
            "FACT",
            "NORMSDIST",
            "NORMSINV",
            "_xlfn.GAMMA",
            "GAMMALN",
            "_xlfn.GAMMALN.PRECISE",
        ] {
            for (args, native) in [("", "Err:511"), ("0.5,0.5", "Err:508")] {
                let source = format!("msoxl:={name}({args})");
                for editor in [false, true] {
                    let expr = parse(
                        &source,
                        &sheets,
                        &book,
                        (0, 0, 0),
                        None,
                        false,
                        None,
                        65536,
                        editor,
                    )
                    .unwrap()
                    .unwrap();
                    let mut calc = Calculation::new(&book, &sheets, vec![(1, 1)], 65536);
                    if editor {
                        calc.dynamic = Some(spill::Dynamic::default());
                    }
                    assert_eq!(
                        calc.eval(&expr, (0, 0, 0), 0, true).unwrap().text(),
                        if editor { "#ERROR!" } else { native },
                        "{source}, editor={editor}"
                    );
                }
            }
        }
    }

    #[test]
    fn native_matrix_size_errors_do_not_replace_execution_budget_limits() {
        let book = Workbook::default();
        let sheets = vec!["Sheet1".to_owned()];
        let mut calc = Calculation::new(&book, &sheets, vec![(1_048_576, 16_384)], 65536);
        assert!(
            calc.matrix(Value::Range((0, 0, 0), (0, 1_048_575, 511)), 0)
                .is_none()
        );
        let mut calc = Calculation::new(&book, &sheets, vec![(1_048_576, 16_384)], 65536);
        let result = calc
            .matrix(Value::Range((0, 0, 0), (0, 1_048_575, 512)), 0)
            .unwrap();
        assert!(matches!(result[0][0], Value::Error("Err:538")));
    }

    #[test]
    fn matrix_reference_lists_charge_repeated_text_cells() {
        let book = Workbook::default();
        let sheets = vec!["Sheet1".to_owned()];
        let source = format!("of:={}", vec!["[.A1]"; 32].join("~"));
        let expression = parse(
            &source,
            &sheets,
            &book,
            (0, 0, 1),
            None,
            false,
            None,
            65536,
            false,
        )
        .unwrap()
        .unwrap();
        let expression = Expr::MatrixCell(std::sync::Arc::new(expression), (0, 0, 1));
        for (limit, succeeds) in [(8192, false), (65536, true)] {
            let mut calc = Calculation::new(&book, &sheets, vec![(32, 2)], limit);
            calc.values.insert((0, 0, 0), Value::Text("x".repeat(1024)));
            let result = calc.eval(&expression, (0, 31, 1), 0, false);
            assert_eq!(result.is_some(), succeeds);
            if let Some(value) = result {
                assert_eq!(value.text(), "x".repeat(1024));
            }
        }
    }

    #[test]
    fn formula_expansion_is_charged_before_materializing_large_results() {
        let mut rows = vec![vec!["x".to_owned()]];
        for row in 1..20 {
            rows.push(vec![format!("=A{row}&A{row}")]);
        }
        assert!(calculate(&rows, &BTreeSet::new(), "Sheet1", 4096).is_none());
    }

    #[test]
    fn formula_depth_limits_are_errors_not_uncalculated_successes() {
        let rows = vec![vec![format!("={}1{}", "(".repeat(150), ")".repeat(150))]];
        assert!(calculate(&rows, &BTreeSet::new(), "Sheet1", 4096).is_none());
    }

    #[test]
    fn omitted_arguments_count_against_the_parser_node_budget() {
        let source = format!("=INDEX({})", ",".repeat(1000));
        assert!(
            parse(
                &source,
                &[],
                &Workbook::default(),
                (0, 0, 0),
                None,
                false,
                None,
                4096,
                false,
            )
            .is_err()
        );
    }
}

#[path = "office_formula_conditional_styles.rs"]
pub(super) mod conditional_styles;

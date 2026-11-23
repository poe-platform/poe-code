use super::{date_serial, decimal};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

type Coord = (usize, usize, usize);
use crate::commands::structured::xlsx::{Dialect, Workbook};
#[path = "office_formula_operators.rs"]
mod operators;
#[path = "office_formula_references.rs"]
mod references;
#[cfg(test)]
pub(in crate::commands::archive) use operators::xlsx_export_names;
#[cfg(test)]
pub(super) use operators::xlsx_operators;
pub(in crate::commands) use references::label_prefix;
use references::{RadicalLabel, Reference};
#[path = "office_formula_case.rs"]
mod case;
#[path = "office_formula_database.rs"]
mod database;
#[path = "office_formula_dates.rs"]
mod dates;
#[path = "office_formula_euro.rs"]
mod euro;
#[path = "office_formula_financial.rs"]
mod financial;
#[path = "office_formula_index.rs"]
mod index;
#[path = "office_formula_information.rs"]
mod information;
#[path = "office_formula_live_names.rs"]
pub(in crate::commands) mod live_names;
#[path = "office_formula_lookup.rs"]
mod lookup;
#[path = "office_formula_math.rs"]
mod math;
#[path = "office_formula_power.rs"]
mod power;
#[path = "office_formula_production.rs"]
mod production;
#[path = "office_formula_reference_functions.rs"]
mod reference_functions;
#[path = "office_formula_format.rs"]
mod result_format;
#[path = "office_formula_round.rs"]
pub(super) mod rounding;
#[path = "office_formula_statistics.rs"]
mod statistics;
#[path = "office_formula_strings.rs"]
mod strings;
#[path = "office_formula_sum.rs"]
mod summation;
#[path = "office_formula_text.rs"]
pub(in crate::commands) mod text;
#[path = "office_formula_trigonometry.rs"]
mod trigonometry;
use result_format::{Format, Kind as FormatKind};
#[path = "office_formula_workbook.rs"]
mod workbook;
#[cfg(test)]
pub(in crate::commands) use workbook::xlsx_recalculate;
pub(in crate::commands) use workbook::{cache, dirty_cells};

pub(super) const LITERAL_ERRORS: [&str; 7] = [
    "#DIV/0!", "#REF!", "#VALUE!", "#NUM!", "#NAME?", "#N/A", "#NULL!",
];

#[derive(Debug)]
pub(in crate::commands) enum Failure {
    Limit,
    Unsupported(String),
}

#[derive(Clone, Debug, PartialEq)]
pub(in crate::commands) enum Value {
    Blank,
    // Functions can return an explicit empty value; direct references still become zero.
    Empty,
    // Public function results preserve an empty value through caches and aggregation.
    FunctionEmpty,
    // An empty matrix element retains a blank cache but no scalar function marker.
    MatrixEmpty,
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
    LabelRange(Coord, Coord, Option<Coord>),
    Matrix(Vec<Vec<Value>>),
    Set(Vec<Value>),
}
impl Value {
    fn into_range(self) -> Self {
        match self {
            Self::Single(coord) => Self::Range(coord, coord),
            Self::LabelRange(first, last, _) => Self::Range(first, last),
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
            Self::Blank | Self::Empty | Self::FunctionEmpty | Self::MatrixEmpty => Some(0.),
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
            Self::Blank | Self::Empty | Self::FunctionEmpty | Self::MatrixEmpty => "0".into(),
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

pub(in crate::commands) fn array_string_value(text: &str) -> Option<Value> {
    match text.to_uppercase().as_str() {
        "TRUE" => return Some(Value::Bool(true)),
        "FALSE" => return Some(Value::Bool(false)),
        _ => {}
    }
    if let Some(error) = LITERAL_ERRORS.into_iter().find(|error| *error == text) {
        return Some(Value::LiteralError(error));
    }
    decimal(text.trim_matches([' ', '\t', '\r', '\n', '\x0b', '\x0c'])).map(Value::Number)
}

#[derive(Clone, PartialEq)]
pub(super) enum Expr {
    Value(Value),
    Ref(Reference),
    Label(Reference, bool, bool, bool), // anchor, column axis, scalar, OpenFormula semantics
    Radical(Box<RadicalLabel>),
    Range(Reference, Reference),
    Name(usize),
    LiveName(usize, Box<live_names::Relocation>),
    InvalidFormula(usize, usize),
    Group(Box<Expr>),
    Unary(u8, Box<Expr>),
    Binary(&'static str, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
    MatrixCell(std::sync::Arc<Expr>, Coord),
}
impl Expr {
    fn discard(self) {
        let mut pending = vec![self];
        while let Some(expr) = pending.pop() {
            match expr {
                Self::Group(child) | Self::Unary(_, child) => pending.push(*child),
                Self::Binary(_, a, b) => pending.extend([*a, *b]),
                Self::Call(_, args) => pending.extend(args),
                Self::MatrixCell(child, _) => {
                    if let Ok(child) = Arc::try_unwrap(child) {
                        pending.push(child);
                    }
                }
                _ => {}
            }
        }
    }
    #[cfg(test)]
    pub(super) fn same_xlsx_group(&self, other: &Self, work: &mut usize) -> Option<bool> {
        let mut pending = vec![(self, other)];
        while let Some((left, right)) = pending.pop() {
            *work = work.checked_sub(64)?;
            match (left, right) {
                (Self::Value(Value::Number(a)), Self::Value(Value::Number(b))) => {
                    if a.to_bits() != b.to_bits() {
                        return Some(false);
                    }
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
                Self::Name(index) | Self::LiveName(index, _) if !visited.contains(index) => {
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
                Self::Call(_, args) => pending.extend(args.iter().rev().map(|arg| (arg, None))),
                _ => {}
            }
        }
        Some(None)
    }
}
pub(in crate::commands) fn valid_native_name(name: &str) -> bool {
    let letters = name.bytes().take_while(u8::is_ascii_alphabetic).count();
    let (row, column) = name.split_once(['c', 'C']).unwrap_or(("", ""));
    !(!name.starts_with('_') && !name.chars().next().is_some_and(char::is_alphabetic)
        || !name.chars().all(|c| c == '_' || c.is_alphanumeric())
        || (1..=4).contains(&letters)
            && letters < name.len()
            && name[letters..].bytes().all(|c| c.is_ascii_digit())
        || row.starts_with(['r', 'R'])
            && row.len() > 1
            && !column.is_empty()
            && row[1..]
                .bytes()
                .chain(column.bytes())
                .all(|c| c.is_ascii_digit()))
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
    names: &'a [crate::commands::structured::xlsx::NamedExpression],
    bindings: Option<&'a BTreeMap<String, Option<usize>>>,
    operators: Vec<(usize, usize, char)>,
    name_stack: Vec<usize>,
    export_names: Option<Vec<usize>>,
    position: (usize, i64, i64),
    scope: Option<usize>,
    odf: bool,
    xlsx: bool,
    csv: bool,
    dialect: Dialect,
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
                    || self.dialect == Dialect::Gnumeric && !c.is_ascii() && !"¬∧∨".contains(*c)
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
        if self.csv {
            while let Some(c) = self.source.chars().next() {
                self.source = &self.source[c.len_utf8()..];
                if c == quote {
                    return Some(if quote == '\'' {
                        format!("'{}'", out.replace('\'', "''"))
                    } else {
                        out
                    });
                }
                if c == '\\' {
                    let escaped = self.source.chars().next()?;
                    self.source = &self.source[escaped.len_utf8()..];
                    out.push(escaped);
                } else {
                    out.push(c);
                }
            }
            return None;
        }
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
        let mut left = if self.dialect == Dialect::Gnumeric
            && let Some((name, tail)) = live_names::global_name(self.source)
        {
            self.source = tail;
            self.names
                .iter()
                .position(|n| n.sheet.is_none() && n.name == name)
                .map_or(Expr::Value(Value::Error("#NAME?")), Expr::Name)
        } else if self.source.starts_with("@name.") {
            if self.dialect != Dialect::Gnumeric {
                return None;
            }
            let (live, tail) = live_names::LiveName::parse(self.source, !self.odf)?;
            self.source = tail;
            self.names
                .iter()
                .position(|n| n.sheet.is_none() && n.name == live.name)
                .map_or(Expr::Value(Value::Error("#NAME?")), |index| {
                    Expr::LiveName(index, Box::new(live.relocation))
                })
        } else if let Some((prefix, rest)) = label_prefix(self.source) {
            let column = prefix.starts_with("@column");
            let openformula = prefix.contains(".odf");
            self.source = rest;
            if prefix.starts_with("@range") {
                let multiple = prefix.contains(".multi");
                if multiple && (prefix.contains(".quoted") || !self.take("{")) {
                    return None;
                }
                let mut anchors = Vec::new();
                loop {
                    let Expr::Ref(anchor) = self.expression(12, depth + 1, true)? else {
                        return None;
                    };
                    anchors.push(anchor);
                    if !multiple || !self.take(";") {
                        break;
                    }
                }
                if multiple && !self.take("}") || !self.take("->") {
                    return None;
                }
                let data = if self.take("#REF!") {
                    None
                } else {
                    Some(self.radical_data(depth + 1)?)
                };
                Expr::Radical(Box::new(RadicalLabel {
                    anchors,
                    data,
                    multiple,
                    scalar: false,
                }))
            } else {
                let Expr::Ref(reference) = self.expression(12, depth + 1, stop_separator)? else {
                    return None;
                };
                Expr::Label(reference, column, false, openformula)
            }
        } else if self.export_names.is_some() && self.source.starts_with([',', ')']) {
            Expr::Value(Value::Blank)
        } else if self.csv && self.source.starts_with(['+', '-']) {
            let mut negative = 0usize;
            while self.take("+") || {
                let minus = self.take("-");
                negative += usize::from(minus);
                minus
            } {}
            let mut value = self.expression(6, depth + 1, stop_separator)?;
            // Plus is an identity; two minuses still coerce strings and Booleans.
            for _ in 0..if negative == 0 { 1 } else { 2 - negative % 2 } {
                value = Expr::Unary(if negative == 0 { b'+' } else { b'-' }, Box::new(value));
            }
            value
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
                self.expression(0, depth + 1, self.odf)?
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
                if self.xlsx {
                    node = Expr::Binary("~", Box::new(node), Box::new(right));
                    continue;
                }
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
                                | Value::Bool(_)
                                | Value::LiteralError(_)),
                            ) => value,
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
                if rows.iter().flatten().any(|v| matches!(v, Value::Error(_))) {
                    self.error.get_or_insert("#N/A");
                }
                self.arrays -= 1;
                break Expr::Value(Value::Matrix(rows));
            }
        } else if self.xlsx
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
                if !number.is_finite() {
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
                && !(self.odf && (self.export_names.is_some() || self.dialect == Dialect::Gnumeric))
                && !(self.xlsx
                    && !quoted
                    && self
                        .source
                        .strip_prefix('!')
                        .is_some_and(|tail| super::xlsx_import::space_name(tail).is_some()))
                && self.take("!")
            {
                let cell = self.word();
                self.reference_or_name(Some(&name), cell)
            } else if quoted && self.odf && self.bindings.is_some() && self.take(".") {
                let tail = self.word();
                self.reference_or_name(None, &format!("{name}.{tail}"))
            } else if quoted && self.csv {
                Expr::Value(Value::Text(name[1..name.len() - 1].replace("''", "'")))
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
            } else if self.xlsx
                && self
                    .source
                    .trim_start_matches(|c: char| c.is_whitespace() && (!self.xlsx || c.is_ascii()))
                    .starts_with('(')
                && super::function_names::imported(&name.to_ascii_uppercase()).is_none()
                && let node @ Expr::Name(_) = self.reference_or_name(None, &name)
            {
                node
            } else if self.take("(") {
                let odf_rounding = self.odf && matches!(name.as_str(), "FLOOR" | "CEILING");
                if self.arrays > 0 {
                    self.error.get_or_insert("Err:539");
                }
                let name = if self.csv {
                    name.to_ascii_uppercase()
                } else if self.xlsx {
                    let upper = name.to_ascii_uppercase();
                    super::function_names::imported(&upper)
                        .map(|(ui, _)| ui.to_owned())
                        .unwrap_or_else(|| super::function_names::unknown(&name))
                } else if self.odf && self.dialect == Dialect::Gnumeric {
                    super::function_names::public_odf(&name)
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
                let iso_week =
                    self.odf && self.dialect != Dialect::Gnumeric && name == "ISOWEEKNUM";
                let name = match name.as_str() {
                    "DAYS" if self.csv || self.xlsx => "_XLFN.DAYS",
                    _ if self.csv => &name,
                    _ if self.odf && self.dialect == Dialect::Gnumeric && name != "DAYS" => &name,
                    "ISOWEEKNUM" if iso_week => "WEEKNUM",
                    "COM.MICROSOFT.XLOOKUP" | "_XLFN.XLOOKUP" => "XLOOKUP",
                    "COM.MICROSOFT.XMATCH" | "_XLFN.XMATCH" => "XMATCH",
                    "COM.MICROSOFT.UNIQUE" | "_XLFN.UNIQUE" => "UNIQUE",
                    "COM.MICROSOFT.IFNA" | "_XLFN.IFNA" => "IFNA",
                    "COM.MICROSOFT.ISFORMULA" | "_XLFN.ISFORMULA" => "ISFORMULA",
                    "_XLFN.XOR" => "XOR",
                    "_XLFN.SHEET" => "SHEET",
                    "_XLFN.SHEETS" => "SHEETS",
                    "_XLFN.ISOWEEKNUM" => "ISOWEEKNUM",
                    "DAYS" if self.odf => "_XLFN.DAYS",
                    "ORG.OPENOFFICE.ERRORTYPE" if self.odf => "ERRORTYPE",
                    _ => &name,
                };
                let fixed = match name {
                    "TRUE" | "FALSE" | "NA" | "PI" | "RAND" | "NOW" | "TODAY" | "CURRENT"
                    | "RAND.NV" => Some(0),
                    "N" | "T" | "ISODD" | "ISEVEN" | "ERROR.TYPE" | "ERRORTYPE" | "ISBLANK"
                    | "ISNUMBER" | "ISTEXT" | "ISERROR" | "ISREF" | "TYPE" | "ISERR" | "ISNA"
                    | "ISNONTEXT" | "ISFORMULA" | "ISLOGICAL" => {
                        (self.dialect != Dialect::Gnumeric).then_some(1)
                    }
                    "NOT" | "ABS" | "SQRT" | "INT" | "FACT" | "GAMMA" | "GAMMALN"
                    | "GAMMALN.PRECISE" | "NORMSDIST" | "NORMSINV" | "PHI" | "GAUSS" | "LEN"
                    | "UPPER" | "LOWER" | "TRIM" | "YEAR" | "MONTH" | "DAY" | "HOUR" | "MINUTE"
                    | "SECOND" | "INFO" | "FORMULA" => Some(1),
                    "ISOWEEKNUM" => (self.dialect != Dialect::Gnumeric).then_some(1),
                    _ => None,
                };
                let fixed = fixed.filter(|_| self.dialect != Dialect::Gnumeric);
                let argument_nodes = self.nodes;
                let mut args = Vec::new();
                if !self.take(")") {
                    loop {
                        if !self.csv && fixed.is_some_and(|count| args.len() >= count) {
                            self.error.get_or_insert("Err:508");
                        } else if args.len() >= 255
                            && self.dialect != Dialect::Gnumeric
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
                if self.xlsx
                    && self.dialect != Dialect::Gnumeric
                    && name == "WEEKNUM"
                    && args.len() == 1
                {
                    args.push(Expr::Value(Value::Number(1.)));
                }
                if iso_week && args.len() == 1 {
                    args.push(Expr::Value(Value::Number(21.)));
                }
                let error = if (fixed == Some(1)
                    || name == "WEEKNUM" && self.xlsx && self.dialect != Dialect::Gnumeric)
                    && args.is_empty()
                    || name == "CHOOSE" && args.is_empty()
                {
                    Some("Err:511")
                } else if name == "CHOOSE" {
                    if args.len() > 255 {
                        Some("Err:508")
                    } else if args.len() > 31 {
                        Some("Err:504")
                    } else {
                        None
                    }
                } else {
                    None
                };
                if !self.csv
                    && self.dialect != Dialect::Gnumeric
                    && let Some(error) = error
                {
                    self.error.get_or_insert(error);
                }
                if odf_rounding {
                    self.nodes = self
                        .nodes
                        .checked_sub((argument_nodes - self.nodes) * 6 + 12)
                        .or_else(|| {
                            self.limited = true;
                            None
                        })?;
                    if !(1..=3).contains(&args.len()) {
                        Expr::Value(Value::Error("#NAME?"))
                    } else if name == "CEILING" && args.len() == 1 {
                        Expr::Call("CEIL".into(), args)
                    } else {
                        let mode = (args.len() == 3).then(|| args.pop().unwrap());
                        let x = args[0].clone();
                        if args.len() == 1 {
                            args.push(Expr::Call("SIGN".into(), vec![x.clone()]));
                        }
                        let mode_one = Expr::Call(name.into(), args.clone());
                        let mode_zero = Expr::Call(
                            "IF".into(),
                            vec![
                                Expr::Binary(
                                    "<".into(),
                                    Box::new(x),
                                    Box::new(Expr::Value(Value::Number(0.))),
                                ),
                                Expr::Call(
                                    if name == "FLOOR" { "CEILING" } else { "FLOOR" }.into(),
                                    args,
                                ),
                                mode_one.clone(),
                            ],
                        );
                        match mode {
                            Some(Expr::Value(Value::Number(n))) if n != 0. => mode_one,
                            None | Some(Expr::Value(Value::Number(_))) => mode_zero,
                            Some(mode) => Expr::Call(
                                "IF".into(),
                                vec![
                                    Expr::Binary(
                                        "=".into(),
                                        Box::new(Expr::Value(Value::Number(0.))),
                                        Box::new(mode),
                                    ),
                                    mode_zero,
                                    mode_one,
                                ],
                            ),
                        }
                    }
                } else {
                    Expr::Call(name.into(), args)
                }
            } else {
                if self.csv && self.reference(None, &name).is_none() && !valid_native_name(&name) {
                    return None;
                }
                self.reference_or_name(None, &name)
            }
        };
        if self.xlsx
            && self.dialect == Dialect::LibreOffice
            && self.arrays == 0
            && self.export_names.is_none()
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
                (",", 8),
                ("!!", 11),
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
                        | Expr::Radical(_)
                        | Expr::Value(Value::Error("#NAME?"))
                        | Expr::Range(..)
                        | Expr::Name(_)
                        | Expr::Group(_)
                        | Expr::Call(..)
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
                "," => "~",
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
            let mut right = self.expression(prec + 1, depth + 1, stop_separator)?;
            if (self.csv || self.dialect == Dialect::Gnumeric && !self.odf) && token == "^" {
                // Collect the chain without nesting parser calls, then associate right.
                let mut powers = Vec::new();
                while self.take("^") {
                    powers.push(right);
                    right = self.expression(prec + 1, depth + 1, stop_separator)?;
                }
                for operand in powers.into_iter().rev() {
                    right = Expr::Binary("^", Box::new(operand), Box::new(right));
                }
            }
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
    failure: Option<Failure>,
    dialect: Dialect,
    book: &'a Workbook,
    sheets: &'a [String],
    array_sizes: BTreeMap<Coord, (usize, usize)>,
    sizes: Vec<(usize, usize)>,
    values: BTreeMap<Coord, Value>,
    formula_sources: BTreeMap<Coord, &'a str>,
    formats: BTreeMap<Coord, Format<'a>>,
    automatic_formats: BTreeSet<Coord>,
    result_format: Option<Format<'a>>,
    previous_format: Option<Format<'a>>,
    names: Vec<std::sync::Arc<Expr>>,
    visiting_names: BTreeSet<usize>,
    name_origin: Option<Coord>,
    iteration_root: Option<Coord>,
    iterated: BTreeSet<Coord>,
    cleared: BTreeSet<Coord>,
    expressions: BTreeMap<Coord, Expr>,
    results: BTreeMap<Coord, Value>,
    visiting: BTreeSet<Coord>,
    work: usize,
    array: bool,
    aggregate: bool,
    extra_operands: bool,
    csv: bool,
    matrices: BTreeMap<Coord, Value>,
}
impl<'a> Calculation<'a> {
    fn new(
        book: &'a Workbook,
        sheets: &'a [String],
        sizes: Vec<(usize, usize)>,
        work: usize,
    ) -> Self {
        Self {
            failure: None,
            dialect: Dialect::LibreOffice,
            book,
            sheets,
            array_sizes: BTreeMap::new(),
            sizes,
            work,
            array: false,
            aggregate: false,
            extra_operands: false,
            csv: false,
            matrices: BTreeMap::new(),
            values: BTreeMap::new(),
            formula_sources: BTreeMap::new(),
            formats: BTreeMap::new(),
            automatic_formats: BTreeSet::new(),
            result_format: None,
            previous_format: None,
            expressions: BTreeMap::new(),
            results: BTreeMap::new(),
            names: Vec::new(),
            visiting: BTreeSet::new(),
            visiting_names: BTreeSet::new(),
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
        if let Some(value) = self.results.get(&coord) {
            if let Value::Text(text) | Value::UninternedText(text) = value {
                self.work = self.work.checked_sub(text.len())?;
            }
            return Some(
                if matches!(value, Value::Blank | Value::Empty)
                    || self.dialect != Dialect::Gnumeric
                        && matches!(value, Value::FunctionEmpty | Value::MatrixEmpty)
                {
                    Value::Number(0.)
                } else {
                    value.clone()
                },
            );
        }
        if self.cleared.contains(&coord) {
            return Some(self.values.get(&coord).cloned().unwrap_or(Value::Blank));
        }
        if self.visiting.contains(&coord) {
            if self.csv {
                return Some(Value::Blank);
            }
            if self.dialect == Dialect::LibreOffice
                && !self.book.iteration.as_ref().is_some_and(|i| i.enabled)
            {
                return Some(Value::Error("Err:522"));
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
            let outer_format = self.result_format.take();
            let outer_previous = self.previous_format.take();
            let array = std::mem::replace(&mut self.array, false);
            self.visiting.insert(coord);
            let active_names = std::mem::take(&mut self.visiting_names);
            let name_origin = self.name_origin.take();
            let mut remaining = self.book.iteration.as_ref().map_or(0, |i| i.maximum);
            let mut value = self.values.get(&coord).cloned().unwrap_or(Value::Blank);
            loop {
                let extra_operands = std::mem::replace(&mut self.extra_operands, false);
                let next = self.eval(&expr, coord, depth + 1, true)?;
                let reference = matches!(
                    next,
                    Value::Single(_) | Value::Range(..) | Value::LabelRange(..)
                );
                let next = self.scalar(next, coord, depth + 1)?;
                let extra = std::mem::replace(&mut self.extra_operands, extra_operands);
                let next = match next {
                    Value::Blank if self.csv || self.dialect == Dialect::Gnumeric => {
                        Value::Number(0.)
                    }
                    Value::FunctionEmpty | Value::MatrixEmpty
                        if reference && self.dialect == Dialect::Gnumeric =>
                    {
                        Value::Number(0.)
                    }
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
                    if self.dialect == Dialect::LibreOffice {
                        value = Value::Error("Err:523");
                    }
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
            self.visiting_names = active_names;
            self.name_origin = name_origin;
            self.visiting.remove(&coord);
            if self.dialect == Dialect::Gnumeric {
                self.result_format = None;
                let mut root = &expr;
                loop {
                    self.tick(depth)?;
                    match root {
                        Expr::Group(child) => root = child,
                        Expr::MatrixCell(child, anchor) if *anchor == coord => root = child,
                        _ => break,
                    }
                }
                if matches!(root, Expr::Call(name, _) if matches!(name.as_str(), "DATE" | "EDATE" | "EOMONTH" | "WORKDAY" | "COUPNCD" | "COUPPCD"))
                    && matches!(value, Value::Number(_))
                {
                    self.result_format = Some(Format {
                        pattern: "yyyy/mm/dd",
                        kind: FormatKind::Date,
                    });
                }
            }
            self.expressions.insert(coord, expr);
            if let Value::Text(text) | Value::UninternedText(text) = &value {
                self.work = self.work.checked_sub(text.len())?;
            }
            if self.automatic_formats.contains(&coord) {
                if let Some(format) = self.result_format.filter(|format| {
                    matches!(value, Value::Number(_) | Value::Bool(_))
                        || matches!(format.kind, FormatKind::Currency | FormatKind::Percent)
                }) {
                    self.formats.insert(coord, format);
                } else {
                    self.formats.remove(&coord);
                }
            }
            self.result_format = outer_format;
            self.previous_format = outer_previous;
            self.results.insert(coord, value.clone());
            return Some(
                if matches!(value, Value::Blank | Value::Empty)
                    || self.dialect != Dialect::Gnumeric
                        && matches!(value, Value::FunctionEmpty | Value::MatrixEmpty)
                {
                    Value::Number(0.)
                } else {
                    value
                },
            );
        }
        let value = self.values.get(&coord).cloned().unwrap_or(Value::Blank);
        if let Value::Text(text) | Value::UninternedText(text) = &value {
            self.work = self.work.checked_sub(text.len())?;
        }
        Some(if matches!(value, Value::Empty) {
            Value::Number(0.)
        } else {
            value
        })
    }
    fn scalar(&mut self, value: Value, position: Coord, depth: usize) -> Option<Value> {
        if let Value::LabelRange(_, _, selected) = value {
            return match selected {
                Some(coord) => self.scalar(Value::Single(coord), position, depth + 1),
                None => Some(Value::Error("#REF!")),
            };
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
        let sheet = if a.0 == b.0 {
            a.0
        } else if self.dialect != Dialect::Gnumeric
            && (a.1 != b.1 || a.2 != b.2)
            && (a.0.min(b.0)..=a.0.max(b.0)).contains(&position.0)
        {
            position.0
        } else {
            return Some(Value::Error("#VALUE!"));
        };
        let (first, last) = ((a.1.min(b.1), a.2.min(b.2)), (a.1.max(b.1), a.2.max(b.2)));
        let coord = if first == last {
            (sheet, first.0, first.1)
        } else if first.0 == last.0 && (first.1..=last.1).contains(&position.2) {
            (sheet, first.0, position.2)
        } else if first.1 == last.1 && (first.0..=last.0).contains(&position.1) {
            (sheet, position.1, first.1)
        } else {
            return Some(Value::Error("#VALUE!"));
        };
        let value = self.cell(coord, depth + 1)?;
        self.result_format = self.formats.get(&coord).copied();
        Some(value)
    }
    fn matrix(&mut self, value: Value, depth: usize) -> Option<Vec<Vec<Value>>> {
        match value {
            Value::InvalidReference | Value::InvalidRange(..) => {
                Some(vec![vec![Value::Error("#REF!")]])
            }
            Value::Single(coord) => Some(vec![vec![self.cell(coord, depth + 1)?]]),
            Value::Set(_) => Some(vec![vec![Value::Error("#VALUE!")]]),
            Value::Matrix(rows) => Some(rows),
            Value::Range(a, b) | Value::LabelRange(a, b, _) => {
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
                                            Some(
                                                Value::Blank
                                                    | Value::Empty
                                                    | Value::FunctionEmpty
                                                    | Value::MatrixEmpty
                                            )
                                        )
                                        && !(self.dialect == Dialect::Gnumeric
                                            && matches!(
                                                self.results.get(&coord),
                                                Some(Value::Blank | Value::Empty)
                                            ))
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
            if matches!(
                a,
                Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
            ) {
                a = if matches!(b, Value::Text(_) | Value::UninternedText(_)) {
                    Value::Text(String::new())
                } else if matches!(b, Value::Bool(_)) {
                    Value::Bool(false)
                } else {
                    Value::Number(0.)
                };
            }
            if matches!(
                b,
                Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
            ) {
                b = if matches!(a, Value::Text(_) | Value::UninternedText(_)) {
                    Value::Text(String::new())
                } else if matches!(a, Value::Bool(_)) {
                    Value::Bool(false)
                } else {
                    Value::Number(0.)
                };
            }
            let order = match (&a, &b) {
                (Value::Bool(a), Value::Bool(b)) => a.cmp(b),
                (Value::Bool(_), _) => Ordering::Greater,
                (_, Value::Bool(_)) => Ordering::Less,
                (
                    Value::Text(a) | Value::UninternedText(a),
                    Value::Text(b) | Value::UninternedText(b),
                ) if self.dialect == Dialect::Gnumeric => {
                    self.work = self
                        .work
                        .checked_sub(a.len().checked_add(b.len())?.checked_mul(3)?)?;
                    super::case_fold::fold(a)
                        .encode_utf16()
                        .cmp(super::case_fold::fold(b).encode_utf16())
                }
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
                    let equal = self.dialect != Dialect::Gnumeric && approximately_equal(a, b);
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
            let render = |value: &Value| {
                if self.dialect == Dialect::Gnumeric {
                    match value {
                        Value::Number(n) => return super::dates::display_number(*n),
                        Value::Bool(b) => return if *b { "TRUE" } else { "FALSE" }.into(),
                        _ => {}
                    }
                }
                value.text()
            };
            let mut text = render(&a);
            let right = render(&b);
            self.work = self
                .work
                .checked_sub(text.len().checked_add(right.len())?)?;
            text.push_str(&right);
            Some(Value::Text(text))
        } else if (self.csv || self.dialect == Dialect::Gnumeric)
            && op == "^"
            && a.numeric() == Some(0.)
            && b.numeric() == Some(0.)
        {
            Some(Value::Error("#NUM!"))
        } else {
            Some(binary(self.dialect, op, a, b))
        }
    }
    fn eval(&mut self, expr: &Expr, pos: Coord, depth: usize, reference: bool) -> Option<Value> {
        self.tick(depth)?;
        self.result_format = None;
        let aggregate = std::mem::replace(&mut self.aggregate, false);
        let result = (|| match expr {
            Expr::InvalidFormula(start, end) => {
                self.failure = Some(Failure::Unsupported(format!(
                    "Unsupported ssconvert feature: formula syntax at {start}:{end}"
                )));
                None
            }
            Expr::MatrixCell(expression, anchor) => {
                let value = if let Some(value) = self.matrices.remove(anchor) {
                    value
                } else {
                    let array = std::mem::replace(&mut self.array, true);
                    let value = self.eval(expression, *anchor, depth + 1, true)?;
                    let value = match value {
                        Value::Single(coord) => {
                            let value = self.cell(coord, depth + 1)?;
                            if self.dialect == Dialect::Gnumeric
                                && matches!(value, Value::FunctionEmpty | Value::MatrixEmpty)
                            {
                                Value::Number(0.)
                            } else {
                                value
                            }
                        }
                        Value::Range(..) | Value::LabelRange(..) => {
                            let mut rows = self.matrix(value, depth + 1)?;
                            if self.dialect == Dialect::Gnumeric {
                                for value in rows.iter_mut().flatten() {
                                    if matches!(value, Value::FunctionEmpty | Value::MatrixEmpty) {
                                        *value = Value::Number(0.);
                                    }
                                }
                            }
                            Value::Matrix(rows)
                        }
                        Value::Set(_) => Value::Error("#VALUE!"),
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
                let result = result.clone();
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
            Expr::Radical(label) => {
                let mut work = self.work;
                let value = self.radical_range(label, pos, self.name_origin, &mut work);
                self.work = work;
                value
            }
            Expr::Label(cell, column, scalar, openformula) => {
                if let Some(coord) = cell.label_anchor(pos, self.name_origin, &self.sizes)
                    && self.book.automatic_label_lookup
                    && !self
                        .book
                        .label_ranges
                        .get(coord.0)
                        .into_iter()
                        .flatten()
                        .any(|pair| {
                            pair.column == *column
                                && (pair.labels[0]..=pair.labels[2]).contains(&coord.1)
                                && (pair.labels[1]..=pair.labels[3]).contains(&coord.2)
                        })
                    && self.expressions.contains_key(&coord)
                {
                    self.cell(coord, depth + 1)?;
                }
                let mut work = self.work;
                let value = self.label_range(
                    cell,
                    *column,
                    *openformula,
                    pos,
                    self.name_origin,
                    &mut work,
                );
                self.work = work;
                let value = value?;
                Some(if *scalar {
                    match value {
                        Value::LabelRange(_, _, Some(coord)) => Value::Range(coord, coord),
                        Value::LabelRange(_, _, None) => Value::Error("#REF!"),
                        value => value,
                    }
                } else if !*openformula {
                    value.into_range()
                } else {
                    value
                })
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
            Expr::Range(a, b) => {
                if self.dialect == Dialect::Gnumeric && a.public_singleton(*b) {
                    return self.eval(&Expr::Ref(*a), pos, depth + 1, reference);
                }
                Some(if a.unknown_name || b.unknown_name {
                    Value::Error("#NAME?")
                } else {
                    self.range(a, b, pos, self.name_origin)
                })
            }
            Expr::Group(child) => {
                let union = matches!(child.as_ref(), Expr::Binary("~" | "~;" | "," | ";", ..));
                self.aggregate = aggregate && union;
                let value = self.eval(child, pos, depth + 1, reference)?;
                if aggregate && !union && !self.array {
                    self.scalar(value, pos, depth + 1)
                } else {
                    Some(value)
                }
            }
            Expr::LiveName(index, relocation) => {
                self.aggregate = aggregate;
                if !self.visiting_names.insert(*index) {
                    return Some(Value::Error("#NAME?"));
                }
                let mut work = self.work;
                let expression = self.relocated_name(*index, relocation, &mut work)?;
                self.work = work;
                let previous = self.name_origin.take();
                let value = self.eval(&expression, pos, depth + 1, reference);
                self.name_origin = previous;
                self.visiting_names.remove(index);
                expression.discard();
                value
            }
            Expr::Name(index) => {
                self.aggregate = aggregate;
                if !self.visiting_names.insert(*index) {
                    return Some(Value::Error("#NAME?"));
                }
                let expression = self.names.get(*index)?.clone();
                let mut origin = self.book.formula_origins.get(&pos).copied().unwrap_or(pos);
                origin.0 = self.book.names[*index].sheet.unwrap_or(origin.0);
                let previous = self.name_origin.replace(origin);
                let value = self.eval(&expression, pos, depth + 1, reference);
                self.name_origin = previous;
                self.visiting_names.remove(index);
                value
            }
            Expr::Unary(op, child) => {
                let value = self.eval(child, pos, depth + 1, true)?;
                if self.array
                    && matches!(
                        value,
                        Value::Matrix(..)
                            | Value::Range(..)
                            | Value::LabelRange(..)
                            | Value::Single(_)
                    )
                {
                    let mut rows = self.matrix(value, depth + 1)?;
                    for row in &mut rows {
                        for value in row {
                            self.tick(depth)?;
                            let input = std::mem::replace(value, Value::Blank);
                            *value = unary(
                                *op,
                                if matches!(input, Value::MatrixEmpty) {
                                    Value::Empty
                                } else {
                                    input
                                },
                            );
                        }
                    }
                    return Some(Value::Matrix(rows));
                }
                let format = match op {
                    b'-' | b'%' if self.dialect == Dialect::Gnumeric => None,
                    b'-' => self
                        .previous_format
                        .filter(|f| f.kind != FormatKind::Logical)
                        .and_then(|f| f.kind.standard()),
                    b'%' => FormatKind::Percent.standard(),
                    _ => self.result_format,
                };
                let value = self.implicit_invalid_range(child, value, pos)?;
                let value = self.scalar(value, pos, depth + 1)?;
                if *op == b'+' {
                    return Some(if matches!(value, Value::MatrixEmpty) {
                        Value::Empty
                    } else {
                        value
                    });
                }
                self.result_format = format;
                self.previous_format = self.result_format;
                Some(unary(*op, value))
            }
            Expr::Binary(op, left, right) => {
                if self.csv && *op == "^" && matches!(right.as_ref(), Expr::Binary("^", ..)) {
                    let mut values = Vec::new();
                    let mut tail = expr;
                    while let Expr::Binary("^", left, right) = tail {
                        self.tick(depth)?;
                        let value = self.eval(left, pos, depth + 1, true)?;
                        self.charge_value(&value)?;
                        values.push(value);
                        tail = right;
                    }
                    let mut value = self.eval(tail, pos, depth + 1, true)?;
                    for left in values.into_iter().rev() {
                        value = self.eval(
                            &Expr::Binary(
                                "^",
                                Box::new(Expr::Value(left)),
                                Box::new(Expr::Value(value)),
                            ),
                            pos,
                            depth + 1,
                            reference,
                        )?;
                    }
                    return Some(value);
                }
                if matches!(*op, "~" | "~;" | "," | ";") {
                    self.aggregate = aggregate;
                    let a = self.eval(left, pos, depth + 1, reference)?;
                    let b = self.eval(right, pos, depth + 1, reference)?;
                    if *op == ";" {
                        self.extra_operands = true;
                        if matches!(a, Value::Error(_)) {
                            return Some(a);
                        }
                        return Some(b);
                    }
                    if reference {
                        self.work = self.work.checked_sub(2 * std::mem::size_of::<Value>())?;
                        return Some(Value::Set(vec![a, b]));
                    }
                    let mut rows = Vec::new();
                    for value in [a, b] {
                        if let Value::Matrix(matrix) = value {
                            rows.extend(matrix);
                        } else {
                            let value = self.scalar(value, pos, depth + 1)?;
                            rows.push(vec![if matches!(
                                value,
                                Value::Blank
                                    | Value::Empty
                                    | Value::FunctionEmpty
                                    | Value::MatrixEmpty
                            ) {
                                Value::Number(0.)
                            } else {
                                value
                            }]);
                        }
                    }
                    return Some(Value::Matrix(rows));
                }
                if matches!(*op, ":" | "!" | "!!") {
                    let array = self.array;
                    if self.dialect != Dialect::Gnumeric {
                        self.array = false;
                    }
                    let a = if *op == ":"
                        && let (Expr::Label(anchor, ..), Expr::Ref(_)) =
                            (left.as_ref(), right.as_ref())
                    {
                        anchor
                            .label_anchor(pos, self.name_origin, &self.sizes)
                            .map_or(Value::Error("#REF!"), |coord| Value::Range(coord, coord))
                    } else {
                        self.eval(left, pos, depth + 1, true)?
                    };
                    let b = self.eval(right, pos, depth + 1, true)?;
                    self.array = array;
                    if *op == "!!" {
                        if let Value::Error(error) | Value::LiteralError(error) = a {
                            return Some(Value::Error(error));
                        }
                        if let Value::Error(error) | Value::LiteralError(error) = b {
                            return Some(Value::Error(error));
                        }
                        if !matches!((left.as_ref(), right.as_ref()), (Expr::Label(_, a, _, _), Expr::Label(_, b, _, _)) if a != b)
                        {
                            return Some(Value::Error("#VALUE!"));
                        }
                        return Some(match self.intersection(a, b, depth + 1)? {
                            Value::Range(first, last) if first != last => Value::Error("#VALUE!"),
                            value => value,
                        });
                    }
                    if *op == "!" {
                        return self.intersection(a, b, depth + 1);
                    }
                    let (a, b) = if self.dialect == Dialect::Gnumeric {
                        (a, b)
                    } else {
                        let a = self.range_list(a, depth + 1)?;
                        let b = self.range_list(b, depth + 1)?;
                        if let Value::Error(error) | Value::LiteralError(error) = a {
                            return Some(Value::Error(error));
                        }
                        if let Value::Error(error) | Value::LiteralError(error) = b {
                            return Some(Value::Error(error));
                        }
                        (a, b)
                    };
                    let invalid = if self.dialect == Dialect::Gnumeric {
                        "#VALUE!"
                    } else if matches!(
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
                    if self.dialect == Dialect::Gnumeric && (a.0 != b.0 || c.0 != d.0 || a.0 != c.0)
                    {
                        return Some(Value::Error("#VALUE!"));
                    }
                    let first = (
                        a.0.min(b.0).min(c.0.min(d.0)),
                        a.1.min(b.1).min(c.1.min(d.1)),
                        a.2.min(b.2).min(c.2.min(d.2)),
                    );
                    let last = (
                        a.0.max(b.0).max(c.0.max(d.0)),
                        a.1.max(b.1).max(c.1.max(d.1)),
                        a.2.max(b.2).max(c.2.max(d.2)),
                    );
                    return Some(Value::Range(first, last));
                }
                // Left-associative chains do not consume the recursive expression budget.
                // Retain evaluation order: scalarize each left operand before its right.
                let mut pending = Vec::new();
                let mut base = expr;
                while let Expr::Binary(op, left, right) = base {
                    if matches!(*op, "~" | "~;" | "," | ";" | ":" | "!" | "!!") {
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
                    a = if self.array || matches!(a, Value::Set(..)) {
                        a
                    } else {
                        self.scalar(a, pos, depth + 1)?
                    };
                    let format_a = self.result_format;
                    if self.dialect == Dialect::Gnumeric && matches!(a, Value::Set(_)) {
                        return Some(Value::Error("#VALUE!"));
                    }
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
                        return Some(Value::Error(if self.dialect == Dialect::Gnumeric {
                            "#VALUE!"
                        } else if self.array {
                            "#REF!"
                        } else if *op == "&" {
                            "Err:502"
                        } else {
                            "Err:504"
                        }));
                    }
                    a = if self.array
                        && (matches!(
                            a,
                            Value::Matrix(..) | Value::Range(..) | Value::LabelRange(..)
                        ) || matches!(
                            b,
                            Value::Matrix(..) | Value::Range(..) | Value::LabelRange(..)
                        )) {
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
                                row.push(self.binary(op, a.clone(), b.clone())?);
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
                        self.binary(op, scalar_a, b)?
                    };
                }
                Some(a)
            }
            Expr::Call(name, args) => {
                if self.csv
                    && (matches!(name.as_str(), "PDURATION" | "ERRORTYPE")
                        || !matches!(name.as_str(), "G_DURATION" | "GET.FORMULA" | "EXPRESSION")
                            && dates::arguments(name, true).is_none()
                            && statistics::arguments(name).is_none()
                            && super::function_names::name(name, false).is_none())
                {
                    return Some(Value::Error("#NAME?"));
                }
                let mut value = self.call(name, args, pos, depth + 1, reference)?;
                if self.dialect == Dialect::Gnumeric && name != "IF" {
                    match &mut value {
                        Value::Blank | Value::Empty | Value::MatrixEmpty => {
                            value = Value::FunctionEmpty;
                        }
                        Value::Matrix(rows) => {
                            for value in rows.iter_mut().flatten() {
                                if matches!(value, Value::Blank | Value::Empty) {
                                    *value = Value::MatrixEmpty;
                                }
                            }
                        }
                        _ => {}
                    }
                }
                if self.array && matches!(name.as_str(), "IF" | "IFERROR" | "IFNA" | "CHOOSE") {
                    if !reference && let Value::Single(coord) = value {
                        value = self.cell(coord, depth + 1)?;
                    }
                    // Keep matrix element types for consumers such as lookups.
                    // MatrixCell handles logical values when exporting cells.
                    self.result_format =
                        self.result_format.filter(|f| f.kind != FormatKind::Logical);
                }
                self.result_format = match name.as_str() {
                    "DATE" if self.dialect != Dialect::Gnumeric => FormatKind::Date.standard(),
                    "TIME" if self.dialect != Dialect::Gnumeric => FormatKind::Time.standard(),
                    "IF" | "IFERROR" | "IFNA" | "CHOOSE" | "SUM" | "AVERAGE" | "MIN" | "MAX"
                    | "PRODUCT" | "PV" | "FV" | "PMT" | "IPMT" | "PPMT" | "SLN" | "SYD" | "DDB"
                    | "DB" | "VDB" | "CUMIPMT" | "CUMPRINC" | "RATE" | "EFFECT" | "NOMINAL"
                    | "RRI" | "NPV" | "IRR" | "MIRR" => self.result_format,
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
        })();
        self.aggregate = aggregate;
        result
    }
    fn call(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
        reference: bool,
    ) -> Option<Value> {
        if self.dialect == Dialect::Gnumeric
            && matches!(
                name,
                "GAMMA.DIST"
                    | "GAMMA.INV"
                    | "GAMMALN.PRECISE"
                    | "GAUSS"
                    | "HYPGEOM.DIST"
                    | "LOGNORM.DIST"
                    | "LOGNORM.INV"
                    | "NORM.DIST"
                    | "NORM.INV"
                    | "NORM.S.DIST"
                    | "NORM.S.INV"
                    | "PDURATION"
                    | "PHI"
                    | "POISSON.DIST"
            )
        {
            return Some(Value::Error("#NAME?"));
        }
        if name == "IF" && !(1..=3).contains(&args.len())
            || matches!(name, "IFERROR" | "IFNA") && args.len() != 2
        {
            return Some(Value::Error("#N/A"));
        }
        let public = self.csv || self.dialect == Dialect::Gnumeric;
        let fixed = match name {
            "TRUE" | "FALSE" | "NA" if public => Some(0),
            "NOT" | "ABS" | "SQRT" | "INT" if public => Some(1),
            "MOD" if public => Some(2),
            _ => None,
        };
        if let Some(count) = fixed
            && args.len() != count
        {
            return Some(Value::Error(if public {
                "#N/A"
            } else if args.len() < count {
                "Err:511"
            } else {
                "Err:504"
            }));
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
        if public && matches!(name, "GET.FORMULA" | "EXPRESSION") {
            return self.formula_metadata(name, args, pos, depth);
        }
        if name == "COUNTBLANK" {
            return self.countblank(args, pos, depth);
        }
        if name == "SUMSQ" {
            return self.sum_squares(args, pos, depth);
        }
        if public && matches!(name, "SUMPRODUCT" | "ODF.SUMPRODUCT") {
            return self.sum_product(name, args, pos, depth);
        }
        if name == "NORM.S.INV" && args.len() != 1 {
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
            return self.call(name, std::slice::from_ref(last), pos, depth + 1, reference);
        }
        if matches!(name, "NPV" | "IRR" | "MIRR" | "FVSCHEDULE") {
            return self.cashflow(name, args, pos, depth);
        }
        if self.dialect == Dialect::Gnumeric && matches!(name, "FLOOR.XCL" | "CEILING.XCL") {
            return Some(Value::Error("#NAME?"));
        }
        if trigonometry::arguments(name).is_some()
            || math::arguments(name).is_some()
            || matches!(
                name,
                "ODDFPRICE"
                    | "ODDFYIELD"
                    | "OPT_BS"
                    | "OPT_BS_DELTA"
                    | "OPT_BS_RHO"
                    | "OPT_BS_THETA"
                    | "OPT_BS_GAMMA"
                    | "OPT_BS_VEGA"
                    | "OPT_BS_CARRYCOST"
                    | "OPT_GARMAN_KOHLHAGEN"
                    | "OPT_FRENCH"
                    | "OPT_JUMP_DIFF"
                    | "OPT_EXEC"
                    | "OPT_FORWARD_START"
                    | "OPT_SIMPLE_CHOOSER"
                    | "OPT_SPREAD_APPROX"
                    | "OPT_FLOAT_STRK_LKBK"
                    | "OPT_FIXED_STRK_LKBK"
                    | "OPT_TIME_SWITCH"
                    | "CUM_BIV_NORM_DIST"
                    | "OPT_EXTENDIBLE_WRITER"
                    | "OPT_COMPLEX_CHOOSER"
                    | "OPT_RGW"
                    | "OPT_BJER_STENS"
                    | "OPT_BAW_AMER"
                    | "OPT_MILTERSEN_SCHWARTZ"
                    | "OPT_ON_OPTIONS"
                    | "OPT_2_ASSET_CORRELATION"
                    | "OPT_EURO_EXCHANGE"
                    | "OPT_AMER_EXCHANGE"
                    | "OPT_BINOMIAL"
            )
        {
            return self.production_numeric(name, args, pos, depth);
        }
        if matches!(name, "XNPV" | "XIRR") {
            return self.dated_cashflow(name, args, pos, depth);
        }
        let rounding = matches!(name, "ROUND" | "ROUNDUP" | "ROUNDDOWN" | "TRUNC");
        let string_function = matches!(name, "LEN" | "LEFT" | "RIGHT" | "MID");
        let statistical_arguments = statistics::arguments(name)
            .filter(|_| {
                self.dialect == Dialect::Gnumeric
                    || !matches!(
                        name,
                        "R.DNORM"
                            | "R.DLNORM"
                            | "R.PNORM"
                            | "R.PLNORM"
                            | "R.QNORM"
                            | "R.QLNORM"
                            | "R.QCHISQ"
                    )
            })
            .map(|bounds| {
                if self.dialect == Dialect::Gnumeric {
                    match name {
                        "GAMMADIST" | "NORMDIST" => (4, 4),
                        "POISSON" | "LOGNORMDIST" | "LOGINV" => (3, 3),
                        _ => bounds,
                    }
                } else {
                    bounds
                }
            });
        let statistical_function = statistical_arguments.is_some();
        let public_statistics = self.dialect == Dialect::Gnumeric && statistical_function;
        let euroconvert = name == "EUROCONVERT";
        let public_financial = self.csv || self.dialect == Dialect::Gnumeric;
        let public_euro = public_financial && euroconvert;
        let public_rounding = public_financial && rounding;
        let public_strings = public_financial && string_function;
        let public_case = public_financial && matches!(name, "UPPER" | "LOWER" | "TRIM" | "EXACT");
        let public_char = public_financial && name == "CHAR";
        let financial_arguments = financial::arguments(name, public_financial);
        let public_financial_dates = public_financial && financial::date_function(name);
        let financial_function = financial_arguments.is_some();
        let financial_basis = match name {
            "YEARFRAC" => Some(2),
            "DISC" | "INTRATE" | "RECEIVED" | "PRICEDISC" | "YIELDDISC" | "ACCRINTM" => Some(4),
            "PRICEMAT" | "YIELDMAT" | "DURATION" | "MDURATION" => Some(5),
            "ACCRINT" | "AMORLINC" | "AMORDEGRC" | "PRICE" | "YIELD" => Some(6),
            "ODDLPRICE" | "ODDLYIELD" => Some(7),
            "COUPDAYBS" | "COUPDAYS" | "COUPDAYSNC" | "COUPNCD" | "COUPNUM" | "COUPPCD" => Some(3),
            _ => None,
        };
        let financial_par = match name {
            "ACCRINT" => Some(4),
            "ACCRINTM" => Some(3),
            _ => None,
        };
        let financial_addin = !public_financial_dates
            && (financial_basis.is_some()
                || matches!(name, "TBILLEQ" | "TBILLPRICE" | "TBILLYIELD")
                || !public_financial && matches!(name, "DOLLARDE" | "DOLLARFR"));
        let financial_format = match name {
            _ if public_financial => None,
            "NPER" | "ISPMT" | "PDURATION" | "DOLLARDE" | "DOLLARFR" | "TBILLEQ" | "TBILLPRICE"
            | "TBILLYIELD" => None,
            _ if financial_basis.is_some() => None,
            "RATE" | "EFFECT" | "NOMINAL" | "RRI" => FormatKind::Percent.standard(),
            _ if financial_function => FormatKind::Currency.standard(),
            _ => None,
        };
        let date_arguments = dates::arguments(name, self.dialect == Dialect::Gnumeric);
        let public_dates = self.dialect == Dialect::Gnumeric && date_arguments.is_some();
        let workdays = public_dates && matches!(name, "WORKDAY" | "NETWORKDAYS");
        let elementwise = public_dates
            || public_case
            || public_char
            || rounding
            || string_function
            || statistical_function
            || euroconvert
            || financial_function;
        let (minimum, maximum) = statistical_arguments
            .or(date_arguments.filter(|_| public_dates))
            .or(financial_arguments)
            .unwrap_or(match name {
                "UPPER" | "LOWER" | "TRIM" if public_case => (1, 1),
                "EXACT" if public_case => (2, 2),
                "CHAR" if public_char => (1, 1),
                "EUROCONVERT" => (3, 5),
                "LEN" => (1, 1),
                "MID" => (3, 3),
                _ => (1, 2),
            });
        if elementwise && !(minimum..=maximum).contains(&args.len()) {
            if public_financial && financial_function
                || public_euro
                || public_rounding
                || public_strings
                || public_case
                || public_char
                || self.dialect == Dialect::Gnumeric
            {
                return Some(Value::Error("#N/A"));
            }
            for arg in args {
                if let Value::Error(error) = self.eval(arg, pos, depth + 1, true)? {
                    return Some(Value::Error(error));
                }
            }
            if financial_function && !self.array {
                self.result_format = financial_format;
            }
            return Some(Value::Error(if args.len() < minimum && !financial_addin {
                "Err:511"
            } else {
                "Err:504"
            }));
        }
        if let Some((minimum, maximum)) = date_arguments
            && (args.len() < minimum || args.len() > maximum)
        {
            if self.csv && matches!(name, "EDATE" | "EOMONTH") {
                return Some(Value::Error("#N/A"));
            }
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
        if self.dialect == Dialect::Gnumeric && name == "ERRORTYPE" {
            return Some(Value::Error("#NAME?"));
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
        if matches!(
            name,
            "CHOOSE" | "AREAS" | "ARRAY" | "ROWS" | "COLUMNS" | "SHEETS"
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
                | "TEXT"
        ) {
            return self.lookup(name, args, pos, depth);
        }
        if self.dialect == Dialect::Gnumeric && matches!(name, "IFERROR" | "IFNA" | "VALUE") {
            return self.lookup(name, args, pos, depth);
        }
        let mut selector = if matches!(name, "IF" | "IFERROR" | "IFNA") {
            Some(self.eval(args.first()?, pos, depth + 1, name != "IF" || !self.array)?)
        } else {
            None
        };
        if name == "IF" && !self.array {
            selector = Some(self.scalar(selector?, pos, depth + 1)?);
        }
        if name == "IF" && self.array {
            match selector.as_ref()? {
                Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
                Value::Text(s) | Value::UninternedText(s) => {
                    if !s.eq_ignore_ascii_case("true") && !s.eq_ignore_ascii_case("false") {
                        return Some(Value::Error("#VALUE!"));
                    }
                    selector = Some(Value::Bool(s.eq_ignore_ascii_case("true")));
                }
                _ => {}
            }
        }
        if matches!(name, "IFERROR" | "IFNA")
            && let Some(value @ (Value::Single(_) | Value::Range(..) | Value::LabelRange(..))) =
                &selector
        {
            let checked = if self.array && matches!(value, Value::Range(..) | Value::LabelRange(..))
            {
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
                || (name == "IF" || self.array)
                    && matches!(v, Value::Range(..) | Value::LabelRange(..))
                || name == "IF" && matches!(v, Value::Set(..))
        });
        if (self.array || matrix_selector || elementwise)
            && (selector.is_none() || matrix_selector || name == "IF" && self.array)
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
            for (index, arg) in args.iter().enumerate() {
                if workdays && index == 3 {
                    self.array = true;
                }
                let mut value = match selector.take() {
                    Some(value) => value,
                    None => self.eval(arg, pos, depth + 1, name != "IF")?,
                };
                if workdays && index >= 2 {
                    self.array = array;
                    if index == 3
                        && matches!(value, Value::InvalidReference | Value::InvalidRange(..))
                    {
                        return Some(Value::Error("#REF!"));
                    }
                    if index == 3
                        && let Value::Error(e) | Value::LiteralError(e) = value
                    {
                        return Some(Value::Error(e));
                    }
                    values.push(vec![vec![value]]);
                    continue;
                }
                let string_argument = public_dates && name == "DATEDIF" && index == 2
                    || public_euro && matches!(index, 1 | 2)
                    || public_strings && index == 0
                    || public_case;
                if (public_statistics
                    || public_dates
                    || public_euro
                    || public_rounding
                    || public_strings
                    || public_char
                    || public_case)
                    && !(array
                        && matches!(
                            value,
                            Value::Matrix(_) | Value::Range(..) | Value::LabelRange(..)
                        ))
                {
                    value = self.scalar(value, pos, depth + 1)?;
                    let boolean = match name {
                        "EUROCONVERT" => index == 3,
                        "POISSON" => index == 2,
                        "R.QCHISQ" => index >= 2,
                        "HYPGEOMDIST" => index == 4,
                        "NORMDIST" | "GAMMADIST" | "R.DNORM" | "R.DLNORM" | "R.PNORM"
                        | "R.PLNORM" | "R.QNORM" | "R.QLNORM" => index >= 3,
                        _ => false,
                    };
                    value = if index >= minimum
                        && matches!(
                            value,
                            Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                        ) {
                        if public_euro {
                            Value::Blank
                        } else {
                            Value::Number(f64::from(
                                index == 3
                                    && matches!(
                                        name,
                                        "R.PNORM" | "R.PLNORM" | "R.QNORM" | "R.QLNORM"
                                    )
                                    || index == 1 && matches!(name, "WEEKDAY" | "WEEKNUM")
                                    || index == 2 && name == "R.QCHISQ"
                                    || public_strings,
                            ))
                        }
                    } else if string_argument {
                        if let Value::Error(e) | Value::LiteralError(e) = value {
                            return Some(Value::Error(e));
                        }
                        value
                    } else if boolean && matches!(value, Value::Text(_) | Value::UninternedText(_))
                    {
                        match lookup::boolean(&value) {
                            Some(b) => Value::Bool(b),
                            None => return Some(Value::Error("#VALUE!")),
                        }
                    } else {
                        match production::operand(&value, self.book.date1904) {
                            Ok(n) => Value::Number(n),
                            Err(e) => return Some(Value::Error(e)),
                        }
                    };
                }
                if public_financial
                    && financial_function
                    && !financial_addin
                    && !(array
                        && matches!(
                            value,
                            Value::Matrix(_) | Value::Range(..) | Value::LabelRange(..)
                        ))
                {
                    value = self.scalar(value, pos, depth + 1)?;
                    if !(index >= minimum
                        && matches!(
                            value,
                            Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                        ))
                    {
                        if (name == "ACCRINT" && index == 7
                            || financial_basis == Some(3) && index == 4)
                            && let Value::Text(s) | Value::UninternedText(s) = &value
                        {
                            value = if s.eq_ignore_ascii_case("true")
                                || s.eq_ignore_ascii_case("false")
                            {
                                Value::Bool(s.eq_ignore_ascii_case("true"))
                            } else {
                                return Some(Value::Error("#VALUE!"));
                            };
                        }
                        value = match production::operand(&value, self.book.date1904) {
                            Ok(number) => Value::Number(number),
                            Err(error) => return Some(Value::Error(error)),
                        };
                    }
                }
                if elementwise {
                    match value {
                        Value::Error(_) => {
                            self.array = array;
                            return Some(value);
                        }
                        Value::LiteralError(error)
                            if rounding
                                || statistical_function
                                || financial_function && !financial_addin =>
                        {
                            literal_error.get_or_insert(error);
                        }
                        _ => {}
                    }
                }
                if financial_addin
                    && (financial_basis == Some(index) || financial_par == Some(index))
                {
                    let value = self.addin_value(value, pos, depth)?;
                    values.push(vec![vec![value]]);
                    continue;
                }
                if financial_addin && matches!(value, Value::Set(_)) {
                    if array {
                        self.array = array;
                        return Some(Value::Error("#REF!"));
                    }
                    value = Value::Error("Err:504");
                }
                if elementwise && !array {
                    value = self.implicit_invalid_range(arg, value, pos)?;
                    if !matches!(value, Value::Matrix(..)) {
                        value = self.scalar(value, pos, depth + 1)?;
                    }
                }
                let is_matrix = matches!(
                    value,
                    Value::Matrix(..) | Value::Range(..) | Value::LabelRange(..)
                );
                let mut rows = self.matrix(value, depth + 1)?;
                if is_matrix {
                    let dimensions = (rows.len(), rows.first()?.len());
                    if (name == "IF"
                        || public_statistics
                        || public_dates
                        || public_euro
                        || public_rounding
                        || public_strings
                        || public_case
                        || public_financial && financial_function && !financial_addin)
                        && shape.is_some_and(|size| size != dimensions)
                    {
                        self.array = array;
                        return Some(Value::Error("#VALUE!"));
                    }
                    shape = Some(shape.map_or(dimensions, |(h, w): (usize, usize)| {
                        (h.max(dimensions.0), w.max(dimensions.1))
                    }));
                    if public_statistics
                        || public_dates
                        || public_euro
                        || public_rounding
                        || public_strings && index > 0
                        || public_char
                        || public_financial && financial_function && !financial_addin
                    {
                        for row in &mut rows {
                            for value in row {
                                self.tick(depth)?;
                                *value = if string_argument {
                                    match value {
                                        Value::Blank
                                        | Value::Empty
                                        | Value::FunctionEmpty
                                        | Value::MatrixEmpty => Value::Text(String::new()),
                                        Value::Text(_)
                                        | Value::UninternedText(_)
                                        | Value::Error(_)
                                        | Value::LiteralError(_) => continue,
                                        _ => Value::Error("#VALUE!"),
                                    }
                                } else {
                                    match production::operand(value, self.book.date1904) {
                                        Ok(n) => Value::Number(n),
                                        Err(e) => Value::Error(e),
                                    }
                                };
                            }
                        }
                    }
                }
                values.push(rows);
            }
            if financial_function {
                self.result_format = if !array && shape.is_none() {
                    financial_format
                } else {
                    None
                };
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
                    let result = if name == "IF" {
                        let condition = item(0);
                        if let Value::Error(e) | Value::LiteralError(e) = condition {
                            Value::Error(e)
                        } else {
                            let number = match condition {
                                Value::Text(s) | Value::UninternedText(s) => {
                                    lookup::number::parse(s, self.book.date1904)
                                }
                                _ => condition.numeric(),
                            };
                            if let Some(number) = number {
                                let branch = usize::from(number == 0.) + 1;
                                match args.get(branch) {
                                    None => Value::Bool(branch == 1),
                                    Some(Expr::Value(Value::Blank)) => Value::Number(0.),
                                    Some(_) => {
                                        self.charge_value(item(branch))?;
                                        item(branch).clone()
                                    }
                                }
                            } else {
                                Value::Error("#VALUE!")
                            }
                        }
                    } else if rounding {
                        self.charge_value(item(0))?;
                        if args.len() == 2 {
                            self.charge_value(item(1))?;
                        }
                        rounding::calculate(
                            name,
                            item(0),
                            (args.len() == 2).then(|| item(1)),
                            self.book.date1904,
                            public_rounding,
                        )
                    } else if public_dates {
                        let mut args = [&Value::Blank; 4];
                        for (index, arg) in args.iter_mut().enumerate().take(values.len()) {
                            *arg = item(index);
                            self.charge_value(arg)?;
                        }
                        if workdays {
                            self.public_workday(name, &args[..values.len()], depth + 1)?
                        } else {
                            dates::public_date(name, &args[..values.len()], self.book.date1904)
                        }
                    } else if statistical_function {
                        let mut args = [&Value::Blank; 5];
                        for (index, arg) in args.iter_mut().enumerate().take(values.len()) {
                            *arg = item(index);
                            self.charge_value(arg)?;
                        }
                        statistics::calculate(
                            self.dialect == Dialect::Gnumeric,
                            name,
                            &args[..values.len()],
                            self.book.date1904,
                            &mut self.work,
                        )?
                    } else if euroconvert {
                        let mut args = [&Value::Blank; 5];
                        for (index, arg) in args.iter_mut().enumerate().take(values.len()) {
                            *arg = item(index);
                            self.charge_value(arg)?;
                        }
                        if public_euro {
                            euro::public_calculate(&args[..values.len()])
                        } else {
                            euro::calculate(&args[..values.len()], self.book.date1904)
                        }
                    } else if financial_function {
                        let mut items = [&Value::Blank; 8];
                        for (index, arg) in items.iter_mut().enumerate().take(values.len()) {
                            *arg = item(index);
                            self.charge_value(arg)?;
                        }
                        let result = financial::calculate(
                            name,
                            &items[..values.len()],
                            self.book.date1904,
                            public_financial,
                            &mut self.work,
                        )?;
                        if public_financial && matches!(result, Value::Error("Err:502")) {
                            Value::Error("#NUM!")
                        } else if financial_addin
                            && matches!(result, Value::Number(_))
                            && args
                                .iter()
                                .take(financial_basis.unwrap_or(args.len()))
                                .enumerate()
                                .any(|(index, arg)| {
                                    financial_par != Some(index)
                                        && matches!(arg, Expr::Value(Value::Blank))
                                })
                        {
                            Value::Error("Err:502")
                        } else {
                            result
                        }
                    } else if public_char {
                        case::character(item(0))
                    } else if public_case {
                        let mut args = [&Value::Blank; 2];
                        for (index, arg) in args.iter_mut().enumerate().take(values.len()) {
                            *arg = item(index);
                            self.charge_value(arg)?;
                        }
                        case::calculate(name, &args[..values.len()], &mut self.work)?
                    } else if string_function {
                        let mut args = [&Value::Blank; 3];
                        for (index, arg) in args.iter_mut().enumerate().take(values.len()) {
                            *arg = item(index);
                            self.charge_value(arg)?;
                        }
                        strings::calculate(
                            name,
                            &args[..values.len()],
                            self.book.date1904,
                            self.csv,
                            self.dialect,
                        )
                    } else {
                        let mut args = Vec::new();
                        for index in 0..values.len() {
                            let value = item(index);
                            self.charge_value(value)?;
                            args.push(Expr::Value(value.clone()));
                        }
                        self.call(name, &args, pos, depth + 1, reference)?
                    };
                    let result = self.scalar(result, pos, depth + 1)?;
                    row.push(if name == "IF" && matches!(result, Value::MatrixEmpty) {
                        Value::Empty
                    } else {
                        result
                    });
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
            if self.dialect == Dialect::Gnumeric {
                return Some(Value::Error("#NAME?"));
            }
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
                let yes = match &value {
                    Value::Text(text) | Value::UninternedText(text) => {
                        text.eq_ignore_ascii_case("true")
                    }
                    _ => value.numeric().unwrap_or(0.) != 0.,
                };
                usize::from(!yes) + 1
            } else if matches!(value,Value::Error(e) | Value::LiteralError(e) if name == "IFERROR" || e == "#N/A")
            {
                1
            } else {
                return Some(value);
            };
            return match args.get(selected) {
                Some(Expr::Value(Value::Blank)) if name == "IF" => {
                    self.result_format = None;
                    Some(Value::Number(0.))
                }
                Some(arg) => self.eval(
                    arg,
                    pos,
                    depth + 1,
                    self.dialect != Dialect::Gnumeric || name != "IF" || reference,
                ),
                None => Some(Value::Bool(selected == 1)),
            };
        }
        if name == "MOD" && args.len() != 2 {
            return Some(Value::Error(if args.len() < 2 {
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
        if args.is_empty()
            && (matches!(name, "AND" | "OR" | "XOR")
                || self.dialect != Dialect::Gnumeric && matches!(name, "MIN" | "MAX"))
        {
            return Some(Value::Error(if public { "#VALUE!" } else { "Err:511" }));
        }
        if name == "NA" && args.is_empty() {
            return Some(Value::Error("#N/A"));
        }
        if self.dialect == Dialect::Gnumeric
            && !aggregate
            && !matches!(
                name,
                "TRUE"
                    | "FALSE"
                    | "NOT"
                    | "ABS"
                    | "SQRT"
                    | "INT"
                    | "MOD"
                    | "TRIM"
                    | "UPPER"
                    | "LOWER"
            )
        {
            return Some(Value::Error("#NAME?"));
        }
        let mut values = Vec::new();
        let mut aggregate_format = None;
        let sums = matches!(name, "SUM" | "AVERAGE");
        for arg in args {
            self.aggregate = aggregate;
            let mut value = self.eval(arg, pos, depth + 1, true)?;
            self.aggregate = false;
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
                    let mut numeric = false;
                    for row in rows {
                        for value in row {
                            self.tick(depth)?;
                            let value = match value {
                                Value::Bool(b) if matches!(name, "AND" | "OR" | "XOR") => {
                                    Value::Number(f64::from(b))
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
                    if self.dialect != Dialect::Gnumeric
                        && !numeric
                        && matches!(name, "MIN" | "MAX")
                    {
                        values.push((Value::Number(0.), false));
                    }
                } else if aggregate && let Value::Single(coord) = value {
                    let mut value = self.cell(coord, depth + 1)?;
                    if self.dialect == Dialect::Gnumeric
                        && matches!(
                            self.results.get(&coord),
                            Some(Value::FunctionEmpty | Value::MatrixEmpty)
                        )
                    {
                        value = Value::Empty;
                    }
                    if matches!(value, Value::Number(_)) {
                        formats_argument = true;
                        format_position.get_or_insert(coord);
                    }
                    values.push((value, true));
                } else if aggregate && let Value::Range(a, b) | Value::LabelRange(a, b, _) = value {
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
                    for coord in cells {
                        let mut value = self.cell(coord, depth + 1)?;
                        if self.dialect == Dialect::Gnumeric
                            && matches!(
                                self.results.get(&coord),
                                Some(Value::FunctionEmpty | Value::MatrixEmpty)
                            )
                        {
                            value = Value::Empty;
                        }
                        if matches!(value, Value::Number(_)) {
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
                } else {
                    let value = self.scalar(value, pos, depth + 1)?;
                    formats_argument |= matches!(value, Value::Number(_) | Value::Bool(_));
                    values.push((value, matches!(arg, Expr::Ref(_))));
                }
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
                        !reference && self.dialect != Dialect::Gnumeric
                            || !matches!(
                                v,
                                Value::Blank
                                    | Value::Empty
                                    | Value::FunctionEmpty
                                    | Value::MatrixEmpty
                            )
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
                if (sums || self.dialect == Dialect::Gnumeric)
                    && matches!(
                        value,
                        Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                    )
                {
                    continue;
                }
                if matches!(name, "AND" | "OR" | "XOR")
                    && matches!(
                        value,
                        Value::Blank
                            | Value::Empty
                            | Value::FunctionEmpty
                            | Value::MatrixEmpty
                            | Value::Text(_)
                            | Value::UninternedText(_)
                    )
                {
                    continue;
                }
                if *reference
                    && matches!(
                        value,
                        Value::Blank
                            | Value::Empty
                            | Value::FunctionEmpty
                            | Value::MatrixEmpty
                            | Value::Text(_)
                            | Value::UninternedText(_)
                    )
                {
                    continue;
                }
                if *reference
                    && matches!(value, Value::Bool(_))
                    && !matches!(name, "AND" | "OR" | "XOR")
                {
                    continue;
                }
                if matches!(value, Value::Text(_) | Value::UninternedText(_))
                    && value.numeric().is_none()
                    && (name != "COUNT" || self.dialect == Dialect::Gnumeric)
                {
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
                "AVERAGE" if numbers.iter().all(|n| *n == numbers[0]) => Value::number(numbers[0]),
                _ => {
                    let total = production::Expansion::sum(&numbers, &mut self.work)?;
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
            "NOT" if count == 1 => n(0).map_or(Value::Error("#VALUE!"), |n| Value::Bool(n == 0.)),
            "ABS" | "SQRT" | "INT" if count == 1 => n(0).map_or(Value::Error("#VALUE!"), |n| {
                Value::number(match name {
                    "ABS" => n.abs(),
                    "SQRT" if n < 0. => {
                        return Value::Error(if public { "#NUM!" } else { "Err:502" });
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
            "UPPER" | "LOWER" if count == 1 => Value::Text(if name == "UPPER" {
                super::collation::uppercase(&value(0)?.text(), &mut self.work)?
            } else {
                value(0)?.text().to_lowercase()
            }),
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
fn binary(dialect: Dialect, op: &str, a: Value, mut b: Value) -> Value {
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
        "+" if dialect != Dialect::Gnumeric
            && left.is_sign_negative() != right.is_sign_negative()
            && approximately_equal(left, -right) =>
        {
            0.
        }
        "-" if dialect != Dialect::Gnumeric
            && left.is_sign_negative() == right.is_sign_negative()
            && approximately_equal(left, right) =>
        {
            0.
        }
        "+" => left + right,
        "-" => left - right,
        "*" => left * right,
        "/" => left / right,
        _ => power::pow(left, right),
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

pub(super) fn calculate(
    rows: &[Vec<String>],
    numeric: &BTreeSet<(usize, usize)>,
    limit: usize,
) -> Option<BTreeMap<(usize, usize), Value>> {
    let book = Workbook::default();
    let sheets = vec!["Sheet1".into()];
    let height = rows.len().max(65_536).next_power_of_two().min(1_048_576);
    let width = rows
        .iter()
        .map(Vec::len)
        .max()
        .unwrap_or(0)
        .max(256)
        .next_power_of_two()
        .min(16_384);
    let mut calc = Calculation::new(&book, &sheets, vec![(height, width)], limit);
    calc.dialect = Dialect::Gnumeric;
    calc.csv = true;
    let mut formulas = BTreeMap::new();
    let mut unsupported = false;
    for (r, row) in rows.iter().enumerate() {
        for (c, text) in row.iter().enumerate() {
            let position = (0, r, c);
            if let Some(source) = text.strip_prefix('=') {
                calc.formula_sources.insert(position, text);
                formulas.insert((r, c), Value::Blank);
                let expression = parse(
                    calc.dialect,
                    source,
                    &sheets,
                    &book,
                    (0, r as i64, c as i64),
                    Some(0),
                    true,
                    None,
                    calc.work,
                )
                .ok()?;
                if let Some(expression) = expression {
                    calc.expressions.insert(position, expression);
                } else {
                    unsupported = true;
                }
                calc.values.insert(position, Value::Blank);
            } else {
                let value = if let Some(day) = date_serial(text) {
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
    if !unsupported {
        let coordinates: Vec<_> = calc.expressions.keys().copied().collect();
        for coord in coordinates {
            if calc.cell(coord, 0).is_none() {
                if matches!(calc.failure, Some(Failure::Unsupported(_))) {
                    unsupported = true;
                    break;
                }
                return None;
            }
        }
    }
    for expr in std::mem::take(&mut calc.expressions).into_values() {
        expr.discard();
    }
    if unsupported {
        return Some(formulas);
    }
    for ((_, r, c), value) in calc.results {
        formulas.insert(
            (r, c),
            match value {
                Value::Error("Err:502") => Value::Error("#NUM!"),
                value => value,
            },
        );
    }
    Some(formulas)
}
#[cfg(test)]
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

fn parse(
    dialect: Dialect,
    source: &str,
    sheets: &[String],
    book: &Workbook,
    position: (usize, i64, i64),
    scope: Option<usize>,
    csv: bool,
    definition: Option<usize>,
    limit: usize,
) -> Result<Option<Expr>, ()> {
    if dialect == Dialect::Gnumeric && definition.is_some() && (source.is_empty() || source == "=")
    {
        return Ok(Some(Expr::Value(Value::Blank)));
    }
    if dialect == Dialect::Gnumeric
        && source.starts_with('=')
        && let Some(parsed) =
            super::super::office_ods::formula::convert(true, source, false, limit, true)
                .map_err(|_| ())?
        && let Some((start, end)) = parsed.native_diagnostic
    {
        return Ok(Some(Expr::InvalidFormula(start, end)));
    }
    let compiled = definition.and_then(|i| book.names[i].compiled.as_ref());
    let source = compiled.map_or(source, |name| name.expression.as_str());
    let mut work = limit;
    let mut converted = None;
    if compiled.is_some() && source.starts_with("of:=") && source.contains(';') {
        let mut formula = super::super::office_ods::formula::convert(
            dialect == Dialect::Gnumeric,
            source,
            false,
            work,
            true,
        )
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
        nodes: (limit / std::mem::size_of::<Expr>()).min(if csv { usize::MAX } else { 8192 }),
        limited: false,
        error: None,
        raw_tail: false,
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
        bindings: compiled.map(|name| &name.bindings),
        operators: Vec::new(),
        name_stack: definition.into_iter().collect(),
        export_names: None,
        position,
        scope,
        odf,
        xlsx,
        csv: csv
            || dialect == Dialect::Gnumeric
                && definition.is_some()
                && compiled.is_none()
                && book.odf.is_none()
                && !odf
                && !xlsx,
        dialect,
        r1c1: false,
        sizes: &book.sheet_sizes,
    };
    let mut expression = parser.expression(0, 0, false);
    // Calc selects label scalars from the immediate operator neighbors.
    // Parentheses and argument separators interrupt that selection.
    let mut pending: Vec<_> = expression.iter_mut().map(|node| (node, 1, 1)).collect();
    while let Some((node, before, after)) = pending.pop() {
        match node {
            Expr::Radical(label) => {
                label.scalar = before != 2 && after != 2 && (before == 1 || after == 1)
            }
            Expr::Label(_, _, scalar, _) => {
                *scalar = before != 2 && after != 2 && (before == 1 || after == 1)
            }
            Expr::Group(child) => pending.push((child, 0, 0)),
            Expr::Unary(op, child) => pending.push((
                child,
                if *op == b'%' { before } else { 1 },
                if *op == b'%' { 1 } else { after },
            )),
            Expr::Binary(op, left, right) => {
                let neighbor = if matches!(*op, "!" | "!!") { 2 } else { 1 };
                pending.extend([
                    (left.as_mut(), before, neighbor),
                    (right.as_mut(), neighbor, after),
                ]);
            }
            Expr::Call(_, args) => pending.extend(args.iter_mut().map(|child| (child, 0, 0))),
            _ => {}
        }
    }
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
    if parser.limited || parser.error.is_some() || !parser.source.is_empty() {
        if let Some(expression) = expression.take() {
            expression.discard();
        }
    }
    if parser.limited {
        return Err(());
    }
    if dialect == Dialect::Gnumeric
        && odf
        && definition.is_some()
        && (expression.is_none() || parser.error.is_some() || !parser.source.is_empty())
    {
        let consumed = source.len() - parser.source.len();
        let start = 4 + source[..consumed].encode_utf16().count();
        let end = start + parser.source.chars().next().map_or(0, char::len_utf16);
        return Ok(Some(Expr::InvalidFormula(start, end)));
    }
    if csv && parser.error.is_some() {
        return Ok(None);
    }
    Ok(if let Some(error) = parser.error {
        Some(Expr::Value(Value::Error(error)))
    } else {
        let mut expression = expression.filter(|_| parser.source.is_empty());
        let array_strings = definition.map_or_else(
            || {
                position.1 >= 0
                    && position.2 >= 0
                    && book.array_string_cells.contains(&(
                        position.0,
                        position.1 as usize,
                        position.2 as usize,
                    ))
            },
            |index| book.array_string_names.contains(&index),
        );
        if array_strings {
            return Ok(expression);
        }
        let mut pending: Vec<_> = expression.iter_mut().collect();
        while let Some(expr) = pending.pop() {
            match expr {
                Expr::Value(Value::Matrix(rows)) => {
                    for value in rows.iter_mut().flatten() {
                        let (Value::Text(text) | Value::UninternedText(text)) = value else {
                            continue;
                        };
                        if let Some(converted) = array_string_value(text) {
                            *value = converted;
                        }
                    }
                }
                Expr::Group(child) | Expr::Unary(_, child) => pending.push(child),
                Expr::Binary(_, left, right) => pending.extend([left.as_mut(), right.as_mut()]),
                Expr::Call(_, args) => pending.extend(args),
                _ => {}
            }
        }
        expression
    })
}

// Grouping compares compiled expressions, including relative reference offsets.
// Matrix constants and compiler errors have no shareable RPN representation.
#[cfg(test)]
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
        Dialect::LibreOffice,
        &source,
        sheets,
        book,
        (position.0, position.1 as i64, position.2 as i64),
        Some(position.0),
        false,
        None,
        *work,
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
            Dialect::LibreOffice,
            source,
            sheets,
            book,
            name.position,
            name.sheet,
            false,
            Some(index),
            *work,
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
    fn floor_ceiling_match_production_source_formats() {
        use crate::commands::structured::{JVal, parse_json_stream};
        fn field<'a>(value: &'a JVal, name: &str) -> &'a JVal {
            let JVal::Object(fields) = value else {
                panic!("object")
            };
            &fields.iter().find(|(key, _)| key == name).unwrap().1
        }
        fn string(value: &JVal) -> &str {
            let JVal::Str(value) = value else {
                panic!("string")
            };
            value
        }
        let JVal::Array(cases) = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-floor-ceiling-production.json"
        ))
        .unwrap()
        .remove(0) else {
            panic!("cases")
        };
        let book = Workbook::default();
        let sheets = vec!["Sheet1".into()];
        let mut failures = Vec::new();
        for case in cases {
            let formula = string(field(&case, "formula"));
            for (prefix, format, csv) in [
                ("=", "csv", true),
                ("msoxl:=", "csv", false),
                ("of:=", "ods", false),
            ] {
                let source = if format == "ods" {
                    formula.replace(',', ";")
                } else {
                    formula.into()
                };
                let expression = parse(
                    Dialect::LibreOffice,
                    &format!("{prefix}{source}"),
                    &sheets,
                    &book,
                    (0, 0, 0),
                    Some(0),
                    csv,
                    None,
                    4_000_000,
                )
                .unwrap()
                .unwrap();
                let mut calc = Calculation::new(&book, &sheets, vec![(1048576, 16384)], 4_000_000);
                let actual = calc.eval(&expression, (0, 0, 0), 0, false);
                let expected = string(field(field(&case, format), "value"));
                let matches = match &actual {
                    Some(Value::Number(n)) => expected.parse::<f64>() == Ok(*n),
                    Some(Value::Error(e)) => *e == expected,
                    _ => false,
                };
                if !matches {
                    failures.push(format!("{prefix}{source}: {actual:?} != {expected}"));
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn if_references_and_unused_branches_match_production() {
        use crate::commands::structured::{JVal, parse_json_stream};
        fn field<'a>(value: &'a JVal, name: &str) -> &'a JVal {
            let JVal::Object(fields) = value else {
                panic!("object")
            };
            &fields.iter().find(|(key, _)| key == name).unwrap().1
        }
        fn value(cell: &JVal) -> Value {
            let JVal::Str(kind) = field(cell, "kind") else {
                panic!("kind")
            };
            if kind == "blank" {
                return Value::Blank;
            }
            match (kind.as_str(), field(cell, "value")) {
                ("number", JVal::Number(n, _)) => Value::Number(*n),
                ("boolean", JVal::Bool(b)) => Value::Bool(*b),
                ("string", JVal::Str(s)) => Value::Text(s.clone()),
                ("error", JVal::Str(s)) => {
                    Value::Error(LITERAL_ERRORS.iter().find(|e| **e == s).unwrap())
                }
                _ => panic!("value"),
            }
        }
        let fixture = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-if-references-production.json"
        ))
        .unwrap()
        .remove(0);
        let JVal::Array(cells) = field(&fixture, "cells") else {
            panic!("cells")
        };
        let JVal::Array(cases) = field(&fixture, "cases") else {
            panic!("cases")
        };
        let mut failures = Vec::new();
        for (prefix, csv) in [("=", true), ("msoxl:=", false)] {
            for case in cases {
                let JVal::Str(formula) = field(case, "formula") else {
                    panic!("formula")
                };
                let array = matches!(field(case, "array"), JVal::Bool(true));
                let book = Workbook::default();
                let names = vec!["Sheet1".into()];
                let mut calc = Calculation::new(&book, &names, vec![(1048576, 16384)], 4_000_000);
                for cell in cells {
                    let JVal::Number(row, _) = field(cell, "row") else {
                        panic!("row")
                    };
                    let JVal::Number(col, _) = field(cell, "column") else {
                        panic!("column")
                    };
                    calc.values.insert(
                        (0, *row as usize, *col as usize),
                        value(field(cell, "value")),
                    );
                }
                let anchor = (0, 0, 4);
                let expression = parse(
                    Dialect::LibreOffice,
                    &format!("{prefix}{formula}"),
                    &names,
                    &book,
                    (0, 0, 4),
                    Some(0),
                    csv,
                    None,
                    4_000_000,
                )
                .unwrap()
                .unwrap();
                let expression = if array {
                    Expr::MatrixCell(std::sync::Arc::new(expression), anchor)
                } else {
                    expression
                };
                let JVal::Array(expected) = field(case, "values") else {
                    panic!("values")
                };
                for (index, expected) in expected.iter().enumerate() {
                    let pos = (0, index / 3, 4 + index % 3);
                    let actual = calc.eval(&expression, pos, 0, true).unwrap();
                    let actual = calc.scalar(actual, pos, 0).unwrap();
                    let expected = value(expected);
                    if actual != expected {
                        failures.push(format!(
                            "{prefix}{formula} array={array} [{index}]: {actual:?} != {expected:?}"
                        ));
                    }
                }
            }
        }
        assert!(
            failures.is_empty(),
            "{} differences:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }

    #[test]
    fn functions_match_production_calculations() {
        use crate::commands::structured::{JVal, parse_json_stream};
        for (source, absolute_scale) in [
            (
                include_str!("../../tests/fixtures/soffice-odd-first-production.json"),
                1.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-options-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-option-extensions-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-chooser-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-error-arrays-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-matrix-lookups-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-lookback-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-time-switch-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-bivariate-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-complex-chooser-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-remaining-options-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-trigonometry-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-math-arrays-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-elementary-arrays-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-math-operations-arrays-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-floor-ceiling-arrays-production.json"),
                0.,
            ),
            (
                include_str!("../../tests/fixtures/soffice-sumsq-arrays-production.json"),
                0.,
            ),
        ] {
            let JVal::Array(cases) = parse_json_stream(source).unwrap().remove(0) else {
                panic!("fixture")
            };
            let mut failures = Vec::new();
            for case in cases {
                let JVal::Object(fields) = case else {
                    panic!("case")
                };
                let field = |name: &str| &fields.iter().find(|(k, _)| k == name).unwrap().1;
                let JVal::Str(formula) = field("formula") else {
                    panic!("formula")
                };
                let book = Workbook {
                    date1904: fields
                        .iter()
                        .any(|(k, v)| k == "date1904" && matches!(v, JVal::Bool(true))),
                    ..Default::default()
                };
                let names = vec!["Sheet1".into()];
                let mut work = 4_000_000;
                let compiled = super::super::csv::reference_text(
                    formula,
                    "Sheet1",
                    super::super::csv::FormulaMode::Calculate,
                    &mut work,
                )
                .unwrap();
                let compiled =
                    super::super::csv::text_from_units(compiled.into_iter(), true, work).unwrap();
                let expression = parse(
                    Dialect::LibreOffice,
                    &compiled,
                    &names,
                    &book,
                    (0, 0, 0),
                    Some(0),
                    true,
                    None,
                    4_000_000,
                )
                .unwrap()
                .unwrap();
                let mut calc = Calculation::new(&book, &names, vec![(1048576, 16384)], 4_000_000);
                let array = matches!(field("kind"), JVal::Str(s) if s == "array");
                calc.array = array;
                let value = calc.eval(&expression, (0, 0, 0), 0, false).unwrap();
                let actual = if array {
                    calc.matrix(value, 0).unwrap()
                } else {
                    vec![vec![calc.scalar(value, (0, 0, 0), 0).unwrap()]]
                };
                let expected = match field("value") {
                    JVal::Array(values) => values
                        .iter()
                        .map(|v| {
                            let JVal::Object(fields) = v else {
                                panic!("cell")
                            };
                            &fields.iter().find(|(k, _)| k == "value").unwrap().1
                        })
                        .collect::<Vec<_>>(),
                    value => vec![value],
                };
                assert!(!expected.is_empty());
                for (column, expected) in expected.into_iter().enumerate() {
                    let actual = &actual[0][if actual[0].len() == 1 { 0 } else { column }];
                    let matched = match (actual, expected) {
                        (Value::Number(a), JVal::Number(b, _)) => {
                            (*a - *b).abs() <= 2e-12 * b.abs().max(absolute_scale)
                        }
                        (Value::Error(a) | Value::LiteralError(a), JVal::Str(b)) => a == b,
                        _ => false,
                    };
                    if !matched {
                        failures.push(format!(
                            "1904={} column={column} {formula}: {} != {expected:?}",
                            book.date1904,
                            actual.cached()
                        ));
                    }
                }
            }
            assert!(
                failures.is_empty(),
                "{} differences\n{}",
                failures.len(),
                failures.into_iter().take(50).collect::<Vec<_>>().join("\n")
            );
        }
    }

    #[test]
    fn countblank_matches_public_arguments_and_sparse_ranges() {
        // The public command rejects scalars and unions, and counts matrix values.
        for (formula, expected) in [
            ("=COUNTBLANK()", "#N/A"),
            ("=COUNTBLANK(0)", "#VALUE!"),
            ("=COUNTBLANK(1)", "#VALUE!"),
            ("=COUNTBLANK(\"\")", "#VALUE!"),
            ("=COUNTBLANK(\"x\")", "#VALUE!"),
            ("=COUNTBLANK(TRUE())", "#VALUE!"),
            ("=COUNTBLANK(1/0)", "#DIV/0!"),
            ("=COUNTBLANK(A100:B102)", "6"),
            ("=COUNTBLANK(A100,B100)", "#N/A"),
            ("=COUNTBLANK({0;\"\";\"x\"})", "1"),
            ("=COUNTBLANK(#REF!)", "#REF!"),
            ("=COUNTBLANK((A100,B100))", "#VALUE!"),
            ("=COUNTBLANK(#N/A)", "#N/A"),
            ("=COUNTBLANK(#DIV/0!)", "#DIV/0!"),
            ("=COUNTBLANK(#VALUE!)", "#VALUE!"),
            ("=COUNTBLANK(INDEX(A1:A2,3))", "#REF!"),
            // Public indirect references wrap outside the sheet dimensions.
            ("=COUNTBLANK(INDIRECT(\"XFE1\"))", "1"),
        ] {
            let values = calculate(&[vec![formula.into()]], &BTreeSet::new(), 65536).unwrap();
            assert_eq!(values[&(0, 0)].cached(), expected, "{formula}");
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
        let values = calculate(&rows, &BTreeSet::from([(1, 4)]), 65536).unwrap();
        // Public CSV imports start with 65,536 rows and 256 columns; the
        // oversized reference wraps to that extent before counting blanks.
        for (position, expected) in [((0, 0), "#VALUE!"), ((0, 1), "16646141"), ((1, 5), "2")] {
            assert_eq!(values[&position].cached(), expected, "{position:?}");
        }
    }

    #[test]
    fn countblank_charges_repeated_sparse_range_scans() {
        let mut rows = vec![vec!["value".to_owned()]];
        rows.extend((0..32).map(|_| vec!["=COUNTBLANK(A1:B1)".into()]));
        assert!(calculate(&rows, &BTreeSet::new(), 4096).is_none());
        assert!(calculate(&rows, &BTreeSet::new(), 65536).is_some());
    }

    #[test]
    fn overflowing_csv_literals_leave_formula_caches_empty() {
        for literal in ["1e309", "-1e309", "+1e309", "1e309%"] {
            for formula in [
                format!("={literal}"),
                format!("=IFERROR({literal},42)"),
                format!("=IF(FALSE,{literal},42)"),
                format!("={{{literal}}}"),
            ] {
                let result = calculate(&[vec![formula.clone()]], &BTreeSet::new(), 65536).unwrap();
                assert!(
                    matches!(result[&(0, 0)], Value::Blank),
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
                calculate(&rows, &BTreeSet::new(), 4096).is_none(),
                "{formula}"
            );
            assert!(
                calculate(&rows, &BTreeSet::new(), 65536).is_some(),
                "{formula}"
            );
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
        let source = format!("of:=IF(1;({});0)", vec!["[.A1]"; 32].join("~"));
        let expression = parse(
            Dialect::LibreOffice,
            &source,
            &sheets,
            &book,
            (0, 0, 1),
            None,
            false,
            None,
            65536,
        )
        .unwrap()
        .unwrap();
        let expression = Expr::MatrixCell(std::sync::Arc::new(expression), (0, 0, 1));
        for (limit, succeeds) in [(8192, false), (131072, true)] {
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
        assert!(calculate(&rows, &BTreeSet::new(), 4096).is_none());
    }

    #[test]
    fn formula_depth_limits_are_errors_not_uncalculated_successes() {
        let rows = vec![vec![format!("={}1{}", "(".repeat(150), ")".repeat(150))]];
        assert!(calculate(&rows, &BTreeSet::new(), 4096).is_none());
    }

    #[test]
    fn omitted_arguments_count_against_the_parser_node_budget() {
        let source = format!("=INDEX({})", ",".repeat(1000));
        assert!(
            parse(
                Dialect::LibreOffice,
                &source,
                &[],
                &Workbook::default(),
                (0, 0, 0),
                None,
                false,
                None,
                4096
            )
            .is_err()
        );
    }
}

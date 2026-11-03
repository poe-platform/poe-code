//! Compile-time syntax and binding checks. jq compiles the entire program before
//! opening its inputs, including definitions and branches that will never execute.
use super::{JqScope, SafeBashFs, resolve_posix_path};
use std::{borrow::Cow, ops::Range};

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Name,
    Number,
    Symbol,
    Quote,
    Text,
    Interpolate,
    EndInterpolation,
    EndQuote,
    End,
}

#[derive(Clone, Copy)]
struct Token<'a> {
    kind: Kind,
    text: &'a str,
    at: usize,
}

pub(super) fn starts_number(source: &str) -> bool {
    matches!(source.as_bytes(), [b'0'..=b'9', ..] | [b'.', b'0'..=b'9', ..])
}

struct Lexer<'a> {
    source: &'a str,
    pos: usize,
    string: bool,
    parentheses: Vec<usize>,
    comments: Vec<std::ops::Range<usize>>,
}

impl<'a> Lexer<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source,
            pos: 0,
            string: false,
            parentheses: Vec::new(),
            comments: Vec::new(),
        }
    }
    fn next(&mut self) -> Result<Token<'a>, String> {
        let bytes = self.source.as_bytes();
        loop {
            let at = self.pos;
            let kind = if self.string {
                match bytes.get(at) {
                    None => return Err(self.unterminated()),
                    Some(b'"') => {
                        self.pos += 1;
                        self.string = false;
                        Kind::EndQuote
                    }
                    Some(b'\\') if bytes.get(at + 1) == Some(&b'(') => {
                        self.pos += 2;
                        self.string = false;
                        self.parentheses.push(0);
                        Kind::Interpolate
                    }
                    _ => {
                        let mut escaped = false;
                        loop {
                            match bytes.get(self.pos) {
                                Some(b'"') => break,
                                Some(b'\\') if bytes.get(self.pos + 1) == Some(&b'(') => break,
                                Some(b'\\') => {
                                    escaped = true;
                                    self.pos += 2;
                                }
                                Some(_) => self.pos += 1,
                                None => return Err(self.unterminated()),
                            }
                        }
                        if escaped {
                            let mut chars = self.source[at..self.pos].chars();
                            while let Some(c) = chars.next() {
                                if c == '\\' && super::json_escape(&mut chars).is_none() {
                                    return Err(format!(
                                        "invalid string at offset {}",
                                        self.source[..at - 1].encode_utf16().count()
                                    ));
                                }
                            }
                        }
                        Kind::Text
                    }
                }
            } else if at == bytes.len() {
                if !self.parentheses.is_empty() {
                    return Err(self.unterminated());
                }
                Kind::End
            } else {
                let b = bytes[at];
                if b.is_ascii_whitespace() {
                    self.pos += 1;
                    continue;
                }
                if b == b'#' {
                    self.pos = self.source[at..].find('\n').map_or(bytes.len(), |n| at + n);
                    self.comments.push(at..self.pos);
                    continue;
                }
                if b.is_ascii_alphabetic() || b == b'_' {
                    self.pos += 1;
                    while bytes
                        .get(self.pos)
                        .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
                    {
                        self.pos += 1;
                    }
                    Kind::Name
                } else if starts_number(&self.source[at..]) {
                    while bytes.get(self.pos).is_some_and(u8::is_ascii_digit) {
                        self.pos += 1;
                    }
                    if bytes.get(self.pos) == Some(&b'.') {
                        self.pos += 1;
                        while bytes.get(self.pos).is_some_and(u8::is_ascii_digit) {
                            self.pos += 1;
                        }
                    }
                    if matches!(bytes.get(self.pos), Some(b'e' | b'E')) {
                        let mut i = self.pos + 1;
                        if matches!(bytes.get(i), Some(b'+' | b'-')) {
                            i += 1;
                        }
                        if bytes.get(i).is_some_and(u8::is_ascii_digit) {
                            self.pos = i + 1;
                            while bytes.get(self.pos).is_some_and(u8::is_ascii_digit) {
                                self.pos += 1;
                            }
                        }
                    }
                    Kind::Number
                } else if b == b'"' {
                    self.pos += 1;
                    self.string = true;
                    Kind::Quote
                } else if b == b')' && self.parentheses.last() == Some(&0) {
                    self.pos += 1;
                    self.parentheses.pop();
                    self.string = true;
                    Kind::EndInterpolation
                } else {
                    if let Some(level) = self.parentheses.last_mut() {
                        if b == b'(' {
                            *level += 1;
                        } else if b == b')' {
                            *level -= 1;
                        }
                    }
                    if let Some(op) = [
                        "?//", "//=", "..", "::", "|=", "+=", "-=", "*=", "/=", "%=", "==", "!=",
                        "<=", ">=", "//",
                    ]
                    .iter()
                    .find(|op| self.source[at..].starts_with(**op))
                    {
                        self.pos += op.len();
                    } else if b"@.[]{}(),:;?$|+*/%<>=-".contains(&b) {
                        self.pos += 1;
                    } else if let Some(ch) = self.source[at..]
                        .chars()
                        .next()
                        .filter(|c| c.is_whitespace() || *c == '\u{feff}')
                    {
                        self.pos += ch.len_utf8();
                        continue;
                    } else {
                        return Err(format!(
                            "unexpected character at offset {}",
                            self.source[..at].encode_utf16().count()
                        ));
                    }
                    Kind::Symbol
                }
            };
            return Ok(Token {
                kind,
                text: &self.source[at..self.pos],
                at,
            });
        }
    }
    fn unterminated(&self) -> String {
        format!(
            "unterminated string or interpolation at offset {}",
            self.source.encode_utf16().count() + self.pos.saturating_sub(self.source.len())
        )
    }
}

fn precedence(op: &str) -> Option<u8> {
    Some(match op {
        "|" => 1,
        "," => 2,
        "//" => 3,
        "=" | "|=" | "+=" | "-=" | "*=" | "/=" | "%=" | "//=" => 4,
        "or" => 5,
        "and" => 6,
        "==" | "!=" => 7,
        "<" | ">" | "<=" | ">=" => 8,
        "+" | "-" => 9,
        "*" | "/" | "%" => 10,
        _ => return None,
    })
}

// The evaluator still accepts source slices (including yq expressions). Use the
// compiler's tokens so exponent signs, strings and nested filters remain intact.
pub(super) enum Binary<'a> {
    Pair(&'a str, &'a str, &'a str),
    LiteralChain { left: &'a str, suffix: &'a str },
}

pub(super) fn binary(source: &str) -> Option<Binary<'_>> {
    let mut lexer = Lexer::new(source);
    let mut lowest = u8::MAX;
    let mut root: Option<Token<'_>> = None;
    let mut chain: Option<usize> = None;
    let single_number = |operand: &str, last: &str| {
        starts_number(last) && operand.trim() == last
    };
    let (mut depth, mut strings, mut conditions) = (0usize, 0usize, 0usize);
    let mut can_end = false;
    let mut previous = "";
    let mut end = 0;
    loop {
        let t = lexer.next().ok()?;
        match t.kind {
            Kind::End => break,
            Kind::Quote => {
                strings += 1;
                continue;
            }
            Kind::EndQuote => {
                strings -= 1;
                can_end = true;
                previous = t.text;
                continue;
            }
            _ if strings != 0 => continue,
            _ => {}
        }
        let property =
            matches!(previous, "." | "$" | "@" | "::") && end == t.at && t.kind == Kind::Name;
        end = t.at + t.text.len();
        if matches!(t.text, "(" | "[" | "{") {
            depth += 1;
        } else if matches!(t.text, ")" | "]" | "}") {
            depth = depth.checked_sub(1)?;
        } else if depth == 0 && !property && t.text == "if" {
            conditions += 1;
        } else if depth == 0 && conditions != 0 && !property && t.text == "end" {
            conditions -= 1;
        } else if depth == 0
            && conditions == 0
            && !property
            && can_end
            && let Some(prec) = precedence(t.text)
        {
            if prec < lowest || (prec == lowest && prec != 4) {
                if let Some(prev) = root && prec == lowest && prec >= 9
                    && single_number(&source[prev.at + prev.text.len()..t.at], previous)
                {
                    chain.get_or_insert(prev.at);
                } else {
                    chain = None;
                }
                root = Some(t);
                lowest = prec;
            }
            can_end = false;
            previous = t.text;
            continue;
        }
        can_end = matches!(t.kind, Kind::Name | Kind::Number)
            || matches!(t.text, "." | ".." | ")" | "]" | "}" | "?");
        previous = t.text;
    }
    let root = root.filter(|_| lowest >= 3)?;
    let right = &source[root.at + root.text.len()..];
    if let Some(start) = chain && single_number(right, previous) {
        Some(Binary::LiteralChain { left: &source[..start], suffix: &source[start..] })
    } else {
        Some(Binary::Pair(&source[..root.at], root.text, right))
    }
}

// Literal right operands cannot consume input or yield extra values. Apply the
// suffix in source order, keeping only the accumulator and the current token.
pub(super) fn apply_literal_chain(mut value: super::JVal, suffix: &str, max_value_bytes: usize) -> Result<super::JVal, super::JqFault> {
    let mut lexer = Lexer::new(suffix);
    loop {
        let op = lexer.next()?;
        if op.kind == Kind::End { return Ok(value); }
        let operand = lexer.next()?;
        let number = super::jq_number::literal(operand.text).ok_or("invalid numeric literal")?;
        value = super::apply_jq_arith(&value, &number, op.text, max_value_bytes)?;
    }
}

pub(super) enum Subscript<'a> {
    Iterate,
    Field(&'a str),
    Index(&'a str),
    Slice(&'a str, &'a str),
}

// Find the final field or bracket operator outside nested expressions and strings.
pub(super) fn subscript(source: &str) -> Result<Option<(&str, Subscript<'_>)>, super::JqFault> {
    if !source.ends_with(']') && !source.contains('.') {
        return Ok(None);
    }
    let mut lexer = Lexer::new(source);
    let (mut depth, mut strings, mut count) = (0usize, 0usize, 0usize);
    let (mut open, mut colon) = (0, None);
    let mut definition = false;
    let mut dot = None;
    let base = |pos| {
        if pos == 0 {
            "."
        } else {
            source[..pos].trim_end()
        }
    };
    loop {
        let Ok(t) = lexer.next() else { return Ok(None) };
        match t.kind {
            Kind::End => return Ok(None),
            Kind::Quote => {
                strings += 1;
                continue;
            }
            Kind::EndQuote => {
                strings -= 1;
                if strings == 0
                    && let Some(pos) = dot.take()
                    && t.at + 1 == source.len()
                {
                    return Ok(Some((
                        base(pos),
                        Subscript::Index(source[pos + 1..].trim_start()),
                    )));
                }
                continue;
            }
            _ if strings != 0 => continue,
            _ => {}
        }
        if let Some(pos) = dot.take()
            && t.kind == Kind::Name
            && t.at + t.text.len() == source.len()
        {
            return Ok(Some((base(pos), Subscript::Field(t.text))));
        }
        if depth == 0 && matches!(t.text, "." | "[") {
            count += 1;
            if count > 128 {
                return Err(super::JqFault::Limit("maxAstDepth"));
            }
        }
        match t.text {
            "." if depth == 0 => dot = Some(t.at),
            "(" | "[" | "{" => {
                if depth == 0 && t.text == "[" {
                    open = t.at;
                    colon = None;
                    definition = false;
                }
                depth += 1;
            }
            ")" | "]" | "}" => {
                if depth == 0 {
                    return Ok(None);
                }
                depth -= 1;
                if depth == 0 && t.text == "]" && t.at + 1 == source.len() && open > 0 {
                    let inner = &source[open + 1..t.at];
                    let op = if inner.trim().is_empty() {
                        Subscript::Iterate
                    } else if let Some(c) = colon {
                        Subscript::Slice(source[open + 1..c].trim(), source[c + 1..t.at].trim())
                    } else {
                        Subscript::Index(inner)
                    };
                    return Ok(Some((source[..open].trim_end(), op)));
                }
            }
            "def" if depth == 1 && !source[..t.at].ends_with(['.', '$']) => definition = true,
            ":" if depth == 1 && definition => definition = false,
            ":" if depth == 1 => colon = Some(t.at),
            _ => {}
        }
    }
}

pub(super) fn fold(source: &str) -> Option<(&str, &str, &str)> {
    let mut lexer = Lexer::new(source);
    let start = lexer.next().ok()?.text.len();
    loop {
        let t = lexer.next().ok()?;
        if t.kind == Kind::End {
            return None;
        }
        if t.kind == Kind::Name && t.text == "as" {
            let mut tail = Lexer::new(&source[t.at + 2..]);
            if tail.next().ok()?.text != "$" {
                continue;
            }
            let variable = tail.next().ok()?;
            if variable.kind != Kind::Name {
                continue;
            }
            let open = tail.next().ok()?;
            let body = &source[t.at + 2 + open.at..];
            if open.text == "(" && super::is_matching_outer_delim(body, '(', ')') {
                return Some((
                    &source[start..t.at],
                    variable.text,
                    &body[1..body.len() - 1],
                ));
            }
        }
    }
}

fn builtin(name: &str, arity: usize) -> bool {
    match name {
        "abs" | "add" | "arrays" | "ascii_downcase" | "ascii_upcase" | "booleans" | "ceil"
        | "empty" | "env" | "explode" | "fabs" | "floor" | "from_entries" | "fromdate"
        | "fromdateiso8601" | "fromjson" | "gmtime" | "halt" | "implode" | "infinite"
        | "inputs" | "isfinite" | "isinfinite" | "isnan" | "iterables" | "keys"
        | "keys_unsorted" | "leaf_paths" | "length" | "ltrim" | "max" | "min" | "mktime"
        | "nan" | "not" | "nulls" | "numbers" | "objects" | "reverse" | "round" | "rtrim"
        | "scalars" | "sort" | "sqrt" | "strings" | "to_entries" | "todate" | "todateiso8601"
        | "tojson" | "tonumber" | "tostring" | "transpose" | "trim" | "type" | "unique"
        | "utf8bytelength" | "values" => arity == 0,
        "bsearch" | "contains" | "del" | "delpaths" | "endswith" | "getpath" | "group_by"
        | "has" | "in" | "index" | "indices" | "inside" | "isempty" | "join" | "ltrimstr"
        | "map" | "map_values" | "max_by" | "min_by" | "path" | "pick" | "rindex" | "rtrimstr"
        | "select" | "sort_by" | "startswith" | "strflocaltime" | "strftime" | "strptime"
        | "unique_by" | "walk" | "with_entries" => arity == 1,
        "IN" | "INDEX" | "capture" | "match" | "nth" | "scan" | "split" | "splits" | "test" => {
            (1..=2).contains(&arity)
        }
        "limit" | "setpath" | "until" | "while" => arity == 2,
        "combinations" | "error" | "first" | "flatten" | "halt_error" | "last" | "paths" => {
            (0..=1).contains(&arity)
        }
        "range" => (1..=3).contains(&arity),
        "gsub" | "sub" => (2..=3).contains(&arity),
        "all" | "any" | "recurse" => (0..=2).contains(&arity),
        _ => false,
    }
}

struct Missing<'a> {
    at: usize,
    name: Cow<'a, str>,
    arity: usize,
}

struct Parser<'a, 'b> {
    arguments: &'b std::collections::BTreeMap<String, super::JVal>,
    lexer: Lexer<'a>,
    current: Token<'a>,
    previous: Token<'a>,
    variables: Vec<&'a str>,
    labels: Vec<&'a str>,
    signatures: Vec<(&'a str, usize)>,
    missing: Vec<Missing<'a>>,
    definition_errors: Vec<Vec<Missing<'a>>>,
    reads_input: bool,
    depth: usize,
}

impl<'a> Parser<'a, '_> {
    fn take(&mut self) -> Result<Token<'a>, String> {
        if self.current.kind == Kind::End {
            return Ok(self.current);
        }
        self.previous = self.current;
        self.current = self.lexer.next()?;
        Ok(self.previous)
    }
    fn accept(&mut self, token: &str) -> Result<bool, String> {
        if self.current.text == token {
            self.take()?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
    fn fail(&self, message: &str) -> String {
        format!(
            "{message} at offset {}",
            self.lexer.source[..self.current.at].encode_utf16().count()
        )
    }
    fn expect(&mut self, token: &str) -> Result<(), String> {
        if self.accept(token)? {
            Ok(())
        } else {
            Err(self.fail(&format!("expected '{token}'")))
        }
    }
    fn name(&mut self, what: &str) -> Result<&'a str, String> {
        let tok = self.take()?;
        if tok.kind == Kind::Name {
            Ok(tok.text)
        } else {
            Err(self.fail(what))
        }
    }
    fn variable(&mut self) -> Result<(), String> {
        let name = self.name("expected variable name")?;
        if name != "ENV" && !self.variables.contains(&name) && !self.arguments.contains_key(name) {
            return Err(self.fail(&format!("undefined variable ${name}")));
        }
        Ok(())
    }
    fn syntax(&self, tok: Token, end: bool) -> String {
        let (name, at) = match tok.kind {
            Kind::End => ("end of file".into(), self.previous.at),
            Kind::Name => ("IDENT".into(), tok.at),
            Kind::Quote | Kind::Number => ("LITERAL".into(), tok.at),
            _ => (format!("'{}'", tok.text), tok.at),
        };
        let expected = if end { ", expecting end of file" } else { "" };
        let message = self.diagnostic(
            at,
            &format!("syntax error, unexpected {name}{expected} (Unix shell quoting issues?)"),
        );
        format!("{message}\njq: 1 compile error")
    }
    fn diagnostic(&self, at: usize, message: &str) -> String {
        let source = self.lexer.source;
        let before = &source[..at];
        let line = 1 + before.bytes().filter(|b| *b == b'\n').count();
        let start = before.rfind('\n').map_or(0, |i| i + 1);
        let context = source[start..].split('\n').next().unwrap_or("");
        format!(
            "error: {message} at <top-level>, line {line}:\n{context}{}",
            " ".repeat(at - start)
        )
    }
    fn string(&mut self) -> Result<(), String> {
        self.take()?;
        loop {
            match self.current.kind {
                Kind::Text => {
                    self.take()?;
                }
                Kind::Interpolate => {
                    self.take()?;
                    self.expr(0, false)?;
                    if self.current.kind != Kind::EndInterpolation {
                        return Err(self.fail("expected 'interpolation-end'"));
                    }
                    self.take()?;
                }
                Kind::EndQuote => {
                    self.take()?;
                    return Ok(());
                }
                _ => return Err(self.lexer.unterminated()),
            }
        }
    }
    fn key(&mut self) -> Result<(), String> {
        if self.current.kind == Kind::Quote {
            self.string()
        } else {
            self.name("expected property name").map(|_| ())
        }
    }
    fn pattern(&mut self, names: &mut Vec<&'a str>, depth: usize) -> Result<(), String> {
        if depth >= 128 {
            return Err("maxAstDepth limit exceeded".into());
        }
        if self.accept("$")? {
            names.push(self.name("expected variable name")?);
            return Ok(());
        }
        let array = self.accept("[")?;
        if !array {
            self.expect("{")?;
        }
        loop {
            if array {
                self.pattern(names, depth + 1)?;
            } else if self.accept("$")? {
                names.push(self.name("expected variable name")?);
                if self.accept(":")? {
                    self.pattern(names, depth + 1)?;
                }
            } else {
                if self.accept("(")? {
                    self.expr(0, false)?;
                    self.expect(")")?;
                } else {
                    self.key()?;
                }
                self.expect(":")?;
                self.pattern(names, depth + 1)?;
            }
            if !self.accept(",")? {
                break;
            }
        }
        self.expect(if array { "]" } else { "}" })
    }
    fn definition(&mut self) -> Result<(Range<usize>, Vec<String>, Range<usize>), String> {
        let name_at = self.current.at;
        let function = self.name("expected function name")?;
        let mut formal = Vec::new();
        let sig_mark = self.signatures.len();
        let mark = self.variables.len();
        if self.accept("(")? {
            let mut params = Vec::new();
            loop {
                let value = self.accept("$")?;
                let name = self.name("expected unique parameter name")?;
                if params.contains(&name) {
                    return Err(self.fail("expected unique parameter name"));
                }
                params.push(name);
                formal.push(if value {
                    format!("${name}")
                } else {
                    name.to_owned()
                });
                if value {
                    self.variables.push(name);
                } else {
                    self.signatures.push((name, 0));
                }
                if !self.accept(";")? {
                    break;
                }
            }
            self.expect(")")?;
        }
        self.expect(":")?;
        let start = self.current.at;
        let signature = (function, formal.len());
        self.signatures.push(signature);
        let parent_errors = std::mem::take(&mut self.missing);
        self.expr(0, false)?;
        let errors = std::mem::replace(&mut self.missing, parent_errors);
        if !errors.is_empty() {
            self.definition_errors.push(errors);
        }
        self.signatures.truncate(sig_mark);
        self.signatures.push(signature);
        let body = start..self.current.at;
        self.expect(";")?;
        self.variables.truncate(mark);
        Ok((name_at..name_at + function.len(), formal, body))
    }
    fn expr(&mut self, min: u8, stop_comma: bool) -> Result<(), String> {
        if self.depth >= 128 {
            return Err("maxAstDepth limit exceeded".into());
        }
        self.depth += 1;
        if self.current.text == "def" {
            let mark = self.signatures.len();
            while self.accept("def")? {
                self.definition()?;
            }
            self.expr(0, stop_comma)?;
            self.signatures.truncate(mark);
            self.depth -= 1;
            return Ok(());
        }
        self.primary()?;
        loop {
            if self.current.text == "as" && min <= 3 {
                self.take()?;
                let mut names = Vec::new();
                self.pattern(&mut names, 0)?;
                while self.accept("?//")? {
                    self.pattern(&mut names, 0)?;
                }
                self.expect("|")?;
                let mark = self.variables.len();
                self.variables.extend(names);
                self.expr(0, stop_comma)?;
                self.variables.truncate(mark);
                continue;
            }
            let Some(prec) = precedence(self.current.text) else {
                break;
            };
            if stop_comma && self.current.text == "," {
                break;
            }
            if prec < min {
                break;
            }
            self.take()?;
            self.expr(prec + u8::from(prec != 4), stop_comma)?;
        }
        self.depth -= 1;
        Ok(())
    }
    fn primary(&mut self) -> Result<(), String> {
        let tok = self.current;
        if tok.kind == Kind::Quote {
            self.string()?;
        } else {
            self.take()?;
            match tok.text {
                "@" => {
                    self.name("expected format name")?;
                    if self.current.kind == Kind::Quote {
                        self.string()?;
                    }
                }
                ".." => {}
                "label" => {
                    self.expect("$")?;
                    let name = self.name("expected label name")?;
                    self.expect("|")?;
                    self.labels.push(name);
                    self.expr(0, false)?;
                    self.labels.pop();
                }
                "break" => {
                    self.expect("$")?;
                    let name = self.name("expected label name")?;
                    if !self.labels.contains(&name) {
                        return Err(self.fail(&format!("undefined label ${name}")));
                    }
                }
                "try" => {
                    self.expr(11, false)?;
                    if self.accept("catch")? {
                        self.expr(11, false)?;
                    }
                }
                "reduce" | "foreach" => {
                    self.expr(11, false)?;
                    self.expect("as")?;
                    self.expect("$")?;
                    let name = self.name("expected variable name")?;
                    self.expect("(")?;
                    self.expr(0, false)?;
                    self.expect(";")?;
                    self.variables.push(name);
                    self.expr(0, false)?;
                    if tok.text == "foreach" && self.accept(";")? {
                        self.expr(0, false)?;
                    }
                    self.variables.pop();
                    self.expect(")")?;
                }
                "." => {
                    if (self.current.kind == Kind::Name && self.current.at == tok.at + 1)
                        || self.current.kind == Kind::Quote
                    {
                        self.key()?;
                    }
                }
                "(" => {
                    self.expr(0, false)?;
                    self.expect(")")?;
                }
                "[" => {
                    if !self.accept("]")? {
                        self.expr(0, false)?;
                        self.expect("]")?;
                    }
                }
                "{" => {
                    while self.current.text != "}" {
                        if self.accept("(")? {
                            self.expr(0, false)?;
                            self.expect(")")?;
                            self.expect(":")?;
                            self.expr(0, true)?;
                        } else {
                            if self.accept("$")? {
                                self.variable()?;
                            } else {
                                self.key()?;
                            }
                            if self.accept(":")? {
                                self.expr(0, true)?;
                            }
                        }
                        if !self.accept(",")? {
                            break;
                        }
                    }
                    self.expect("}")?;
                }
                "$" => self.variable()?,
                "-" => self.expr(11, false)?,
                "if" => {
                    loop {
                        self.expr(0, false)?;
                        self.expect("then")?;
                        self.expr(0, false)?;
                        if !self.accept("elif")? {
                            break;
                        }
                    }
                    if self.accept("else")? {
                        self.expr(0, false)?;
                    }
                    self.expect("end")?;
                }
                "true" | "false" | "null" => {}
                _ if tok.kind == Kind::Name => {
                    let name = if self.accept("::")? {
                        Cow::Owned(format!(
                            "{}::{}",
                            tok.text,
                            self.name("expected namespace member")?
                        ))
                    } else {
                        Cow::Borrowed(tok.text)
                    };
                    self.reads_input |= name == "inputs";
                    let mark = self.missing.len();
                    let mut arity = 0;
                    if self.accept("(")? && !self.accept(")")? {
                        loop {
                            self.expr(0, false)?;
                            arity += 1;
                            if !self.accept(";")? {
                                break;
                            }
                        }
                        self.expect(")")?;
                    }
                    if !builtin(&name, arity) && !self.signatures.contains(&(name.as_ref(), arity))
                    {
                        // An unresolved outer call masks errors in its arguments.
                        self.missing.truncate(mark);
                        self.missing.push(Missing {
                            at: tok.at,
                            name,
                            arity,
                        });
                    }
                }
                _ if tok.kind == Kind::Number => {}
                _ => return Err(self.syntax(tok, self.depth == 1)),
            }
        }
        loop {
            if self.accept("?")? {
                continue;
            }
            if self.accept(".")? {
                self.key()?;
                continue;
            }
            if self.accept("[")? {
                if !self.accept("]")? {
                    if self.current.text != ":" {
                        self.expr(0, false)?;
                    }
                    if self.accept(":")? && self.current.text != "]" {
                        self.expr(0, false)?;
                    }
                    self.expect("]")?;
                }
                continue;
            }
            break;
        }
        Ok(())
    }
}

fn without_comments<'a>(
    source: &'a str,
    range: Range<usize>,
    comments: &[Range<usize>],
) -> Cow<'a, str> {
    let from = comments.partition_point(|c| c.end <= range.start);
    let to = comments.partition_point(|c| c.start < range.end);
    if from == to {
        return Cow::Borrowed(&source[range]);
    }
    let mut cleaned = String::with_capacity(range.len());
    let mut start = range.start;
    for comment in &comments[from..to] {
        cleaned.push_str(&source[start..comment.start]);
        start = comment.end;
    }
    cleaned.push_str(&source[start..range.end]);
    Cow::Owned(cleaned)
}

fn parse<'a>(
    source: &'a str,
    scope: &mut JqScope<'_>,
    module: bool,
) -> Result<Cow<'a, str>, String> {
    let mut lexer = Lexer::new(source);
    let current = lexer.next()?;
    let mut p = Parser {
        lexer,
        current,
        previous: current,
        arguments: &scope.bindings,
        signatures: scope
            .functions
            .iter()
            .flat_map(|(name, overloads)| {
                overloads.keys().map(move |&arity| (name.as_str(), arity))
            })
            .collect(),
        missing: Vec::new(),
        definition_errors: Vec::new(),
        reads_input: false,
        variables: Vec::new(),
        labels: vec![],
        depth: 0,
    };
    let mut definitions = Vec::new();
    while p.accept("def")? {
        definitions.push(p.definition()?);
    }
    let start = p.current.at;
    if module {
        if p.current.kind != Kind::End {
            return Err(p.fail("module must contain only imports and definitions"));
        }
    } else {
        p.expr(0, false)?;
        if p.current.kind != Kind::End {
            return Err(p.syntax(p.current, true));
        }
    }
    let mut diagnostics = String::new();
    let mut count = 0;
    for call in p.definition_errors.iter().rev().flatten().chain(&p.missing) {
        if count != 0 {
            diagnostics.push_str("\njq: ");
        }
        diagnostics.push_str(&p.diagnostic(
            call.at,
            &format!("{}/{} is not defined", call.name, call.arity),
        ));
        if diagnostics.len() > crate::ShellLimits::default().max_output_bytes {
            return Err("maxOutputBytes limit exceeded".into());
        }
        count += 1;
    }
    if count != 0 {
        return Err(format!(
            "{diagnostics}\njq: {count} compile error{}",
            if count == 1 { "" } else { "s" }
        ));
    }
    scope.inputs.borrow_mut().reads_input |= p.reads_input;
    let comments = p.lexer.comments;
    for (name, params, range) in definitions {
        let body = without_comments(source, range, &comments);
        scope.define(&source[name], params, body.trim(), scope.clone(), true);
    }
    Ok(without_comments(source, start..source.len(), &comments))
}

pub(super) struct ProgramError(pub i32, pub String);

impl<T: Into<String>> From<T> for ProgramError {
    fn from(message: T) -> Self { Self(3, message.into()) }
}

pub(super) fn read_program(fs: &dyn SafeBashFs, path: &str, remaining_source: usize) -> Result<String, ProgramError> {
    let read_error = |e| ProgramError(2, super::super::coreutils::stream_file_error(e, "readStream", path));
    let entry = fs.access_path(path, true).map_err(read_error)?;
    let mut next = fs.open_chunks(&entry).map_err(read_error)?;
    let memory = fs.shell_limits().max_memory_bytes;
    let mut bytes = Vec::new();
    let mut chunk = Vec::new();
    loop {
        next(&mut chunk).map_err(read_error)?;
        if chunk.is_empty() { break; }
        if chunk.len() > remaining_source.saturating_sub(bytes.len()) {
            return Err(ProgramError(5, "maxSourceBytes limit exceeded".into()));
        }
        if chunk.len() > memory.saturating_sub(bytes.len()) {
            return Err(ProgramError(5, fs.limit_error("maxMemoryBytes", memory)));
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "program file is not valid UTF-8".into())
}

pub(super) fn compile<'a>(
    source: &'a str,
    scope: &mut JqScope<'_>,
    dirs: &[String],
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Result<Cow<'a, str>, ProgramError> {
    if dirs.is_empty() {
        return Ok(parse(source, scope, false)?);
    }
    let mut modules = Modules {
        dirs,
        cwd,
        fs,
        active: Vec::new(),
        remaining: crate::budget::ShellLimits::default().max_source_bytes,
    };
    modules.compile(source, scope)
}

struct Modules<'a> {
    dirs: &'a [String],
    cwd: &'a str,
    fs: &'a dyn SafeBashFs,
    active: Vec<String>,
    remaining: usize,
}

impl Modules<'_> {
    fn compile<'a>(
        &mut self,
        source: &'a str,
        scope: &mut JqScope<'_>,
    ) -> Result<Cow<'a, str>, ProgramError> {
        self.remaining = self
            .remaining
            .checked_sub(source.len())
            .ok_or("maxSourceBytes limit exceeded")?;
        if self.active.len() >= 128 {
            return Err("maxAstDepth limit exceeded".into());
        }
        let mut lexer = Lexer::new(source);
        let mut token = lexer.next()?;
        while token.kind == Kind::Name && matches!(token.text, "import" | "include") {
            let qualified = token.text == "import";
            if lexer.next()?.kind != Kind::Quote {
                return Err("module directive requires a string path".into());
            }
            let mut path = String::new();
            let mut segment = lexer.next()?;
            if segment.kind == Kind::Text {
                let mut chars = segment.text.chars();
                while let Some(c) = chars.next() {
                    path.push(if c == '\\' {
                        super::json_escape(&mut chars).ok_or("invalid module path")?
                    } else {
                        c
                    });
                }
                segment = lexer.next()?;
            }
            if segment.kind != Kind::EndQuote {
                return Err("module directive requires a string path".into());
            }
            let alias = if qualified {
                if lexer.next()?.text != "as" {
                    return Err("import requires a namespace".into());
                }
                let name = lexer.next()?;
                if name.kind != Kind::Name {
                    return Err("import requires a namespace".into());
                }
                Some(name.text)
            } else {
                None
            };
            if lexer.next()?.text != ";" {
                return Err("module directive requires ';'".into());
            }
            if path
                .split('/')
                .any(|p| p.is_empty() || matches!(p, "." | "..") || p.contains('\0'))
            {
                return Err("invalid module path".into());
            }
            let mut found = false;
            for dir in self.dirs {
                let full = resolve_posix_path(self.cwd, &format!("{dir}/{path}.jq"));
                if self.active.contains(&full) {
                    return Err(format!("module dependency cycle: {path}").into());
                }
                let contents = match read_program(self.fs, &full, self.remaining) {
                    Ok(source) => source,
                    Err(ProgramError(2, e)) if e.starts_with("ENOENT") || e.starts_with("ENOTDIR") => continue,
                    Err(e) => return Err(e),
                };
                self.active.push(full);
                let mut child = JqScope {
                    functions: Default::default(),
                    bindings: scope.bindings.clone(),
                    ..scope.clone()
                };
                self.compile(&contents, &mut child)?;
                self.active.pop();
                for (name, overloads) in child.functions {
                    let name = if let Some(a) = alias {
                        format!("{a}::{name}")
                    } else {
                        name
                    };
                    scope.functions.entry(name).or_default().extend(overloads);
                }
                found = true;
                break;
            }
            if !found {
                return Err(format!("module not found: {path}").into());
            }
            token = lexer.next()?;
        }
        Ok(parse(&source[token.at..], scope, !self.active.is_empty())?)
    }
}

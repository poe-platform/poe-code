//! Compile-time syntax and binding checks. jq compiles the entire program before
//! opening its inputs, including definitions and branches that will never execute.
use std::borrow::Cow;

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

struct Lexer<'a> {
    source: &'a str,
    pos: usize,
    string: bool,
    parentheses: Vec<usize>,
    comments: Vec<std::ops::Range<usize>>,
}

impl<'a> Lexer<'a> {
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
                } else if b.is_ascii_digit()
                    || (b == b'.' && bytes.get(at + 1).is_some_and(u8::is_ascii_digit))
                {
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

struct Parser<'a> {
    lexer: Lexer<'a>,
    current: Token<'a>,
    previous: Token<'a>,
    variables: Vec<&'a str>,
    labels: Vec<&'a str>,
    depth: usize,
}

impl<'a> Parser<'a> {
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
        if name != "ENV" && !self.variables.contains(&name) {
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
        let source = self.lexer.source;
        let before = &source[..at];
        let line = 1 + before.bytes().filter(|b| *b == b'\n').count();
        let start = before.rfind('\n').map_or(0, |i| i + 1);
        let context = source[start..].split('\n').next().unwrap_or("");
        format!(
            "error: syntax error, unexpected {name}{} (Unix shell quoting issues?) at <top-level>, line {line}:\n{context}{}\njq: 1 compile error",
            if end { ", expecting end of file" } else { "" },
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
    fn definition(&mut self) -> Result<(), String> {
        self.name("expected function name")?;
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
                if value {
                    self.variables.push(name);
                }
                if !self.accept(";")? {
                    break;
                }
            }
            self.expect(")")?;
        }
        self.expect(":")?;
        self.expr(0, false)?;
        self.expect(";")?;
        self.variables.truncate(mark);
        Ok(())
    }
    fn expr(&mut self, min: u8, stop_comma: bool) -> Result<(), String> {
        if self.depth >= 128 {
            return Err("maxAstDepth limit exceeded".into());
        }
        self.depth += 1;
        while self.accept("def")? {
            self.definition()?;
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
            let prec = match self.current.text {
                "|" => 1,
                "," if !stop_comma => 2,
                "//" => 3,
                "=" | "|=" | "+=" | "-=" | "*=" | "/=" | "%=" | "//=" => 4,
                "or" => 5,
                "and" => 6,
                "==" | "!=" => 7,
                "<" | ">" | "<=" | ">=" => 8,
                "+" | "-" => 9,
                "*" | "/" | "%" => 10,
                _ => break,
            };
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
                _ if tok.kind == Kind::Name => {
                    if self.accept("::")? {
                        self.name("expected namespace member")?;
                    }
                    if self.accept("(")? && !self.accept(")")? {
                        loop {
                            self.expr(0, false)?;
                            if !self.accept(";")? {
                                break;
                            }
                        }
                        self.expect(")")?;
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

pub(super) fn compile<'a, 'b>(
    source: &'a str,
    variables: impl Iterator<Item = &'b str>,
    module: bool,
) -> Result<Cow<'a, str>, String> {
    let mut lexer = Lexer {
        source,
        pos: 0,
        string: false,
        parentheses: Vec::new(),
        comments: Vec::new(),
    };
    let current = lexer.next()?;
    let mut p = Parser {
        lexer,
        current,
        previous: current,
        variables: variables.collect(),
        labels: vec![],
        depth: 0,
    };
    while p.accept("def")? {
        p.definition()?;
    }
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
    if p.lexer.comments.is_empty() {
        return Ok(Cow::Borrowed(source));
    }
    let mut cleaned = String::with_capacity(source.len());
    let mut start = 0;
    for range in p.lexer.comments {
        cleaned.push_str(&source[start..range.start]);
        start = range.end;
    }
    cleaned.push_str(&source[start..]);
    Ok(Cow::Owned(cleaned))
}

use crate::{Error, Result, Value};

#[derive(Clone, Debug)]
pub(crate) struct Expr(pub usize, pub Node);
#[derive(Clone, Debug)]
pub(crate) enum Node {
    Literal(Value),
    Name(String),
    Vararg,
    Unary(String, Box<Expr>),
    Binary(String, Box<Expr>, Box<Expr>),
    Index(Box<Expr>, Box<Expr>),
    Call(Box<Expr>, Vec<Expr>),
    Method(Box<Expr>, String, Vec<Expr>),
    Table(Vec<(Option<Expr>, Expr)>),
    Function(Vec<String>, bool, Vec<Stmt>),
    Paren(Box<Expr>),
}
#[derive(Clone, Debug)]
pub(crate) enum Stmt {
    Assign(Vec<Expr>, Vec<Expr>),
    Local(Vec<String>, Vec<Expr>),
    LocalFunction(String, Expr),
    Call(Expr),
    Do(Vec<Stmt>),
    While(Expr, Vec<Stmt>),
    Repeat(Vec<Stmt>, Expr),
    If(Vec<(Option<Expr>, Vec<Stmt>)>),
    For(String, Expr, Expr, Option<Expr>, Vec<Stmt>),
    ForIn(Vec<String>, Vec<Expr>, Vec<Stmt>),
    Return(Vec<Expr>),
    Break,
    Goto(String),
    Label(String),
}
#[derive(Clone)]
struct Token {
    kind: String,
    value: Value,
    line: usize,
}
struct Lexer<'a> {
    source: &'a [u8],
    offset: usize,
    line: usize,
}
impl Lexer<'_> {
    fn byte(&self) -> u8 {
        self.source.get(self.offset).copied().unwrap_or(0)
    }
    fn take(&mut self) -> u8 {
        let b = self.byte();
        self.offset += 1;
        if b == b'\n' {
            self.line += 1;
        }
        b
    }
    fn long(&mut self) -> Result<Option<Vec<u8>>> {
        let start = self.offset;
        if self.byte() != b'[' {
            return Ok(None);
        }
        self.offset += 1;
        while self.byte() == b'=' {
            self.offset += 1;
        }
        if self.byte() != b'[' {
            self.offset = start;
            return Ok(None);
        }
        let equals = self.offset - start - 1;
        self.offset += 1;
        if self.byte() == b'\n' {
            self.take();
        }
        let content = self.offset;
        while self.offset < self.source.len() {
            if self.byte() == b']'
                && self
                    .source
                    .get(self.offset + 1..self.offset + 1 + equals)
                    .is_some_and(|s| s.iter().all(|b| *b == b'='))
                && self.source.get(self.offset + 1 + equals) == Some(&b']')
            {
                let text = self.source[content..self.offset].to_vec();
                self.offset += equals + 2;
                return Ok(Some(text));
            }
            self.take();
        }
        Err(Error::syntax("unfinished long string"))
    }
    fn next(&mut self) -> Result<Token> {
        loop {
            while self.byte().is_ascii_whitespace() {
                self.take();
            }
            if self.source.get(self.offset..self.offset + 2) == Some(b"--") {
                self.offset += 2;
                if self.long()?.is_none() {
                    while self.offset < self.source.len() && self.byte() != b'\n' {
                        self.take();
                    }
                }
            } else {
                break;
            }
        }
        let line = self.line;
        let start = self.offset;
        let b = self.byte();
        let mut value = Value::Nil;
        let kind = if self.offset == self.source.len() {
            "eof".into()
        } else if b.is_ascii_alphabetic() || b == b'_' {
            self.take();
            while self.byte().is_ascii_alphanumeric() || self.byte() == b'_' {
                self.take();
            }
            let word = String::from_utf8_lossy(&self.source[start..self.offset]).into_owned();
            if [
                "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto",
                "if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true",
                "until", "while",
            ]
            .contains(&word.as_str())
            {
                word
            } else {
                value = Value::String(word.into_bytes());
                "name".into()
            }
        } else if b == b'\'' || b == b'"' {
            self.take();
            let mut text = Vec::new();
            while self.byte() != b {
                if self.offset >= self.source.len() || self.byte() == b'\n' {
                    return Err(Error::syntax("unfinished string"));
                }
                let c = self.take();
                if c != b'\\' {
                    text.push(c);
                    continue;
                }
                let c = self.take();
                match c {
                    b'a' => text.push(7),
                    b'b' => text.push(8),
                    b'f' => text.push(12),
                    b'n' => text.push(10),
                    b'r' => text.push(13),
                    b't' => text.push(9),
                    b'v' => text.push(11),
                    b'z' => {
                        while self.byte().is_ascii_whitespace() {
                            self.take();
                        }
                    }
                    b'x' => {
                        let mut n = 0;
                        for _ in 0..2 {
                            n = n * 16
                                + (self.take() as char)
                                    .to_digit(16)
                                    .ok_or_else(|| Error::syntax("hexadecimal digit expected"))?;
                        }
                        text.push(n as u8);
                    }
                    b'0'..=b'9' => {
                        let mut n = (c - b'0') as u32;
                        for _ in 0..2 {
                            if !self.byte().is_ascii_digit() {
                                break;
                            }
                            n = n * 10 + (self.take() - b'0') as u32;
                        }
                        if n > 255 {
                            return Err(Error::syntax("decimal escape too large"));
                        }
                        text.push(n as u8);
                    }
                    _ => text.push(c),
                }
            }
            self.take();
            value = Value::String(text);
            "string".into()
        } else if b == b'['
            && let Some(text) = self.long()?
        {
            value = Value::String(text);
            "string".into()
        } else if b.is_ascii_digit()
            || b == b'.' && self.source.get(start + 1).is_some_and(u8::is_ascii_digit)
        {
            let hex =
                self.source[start..].starts_with(b"0x") || self.source[start..].starts_with(b"0X");
            self.take();
            while self.byte().is_ascii_alphanumeric()
                || self.byte() == b'.' && self.source.get(self.offset + 1) != Some(&b'.')
                || matches!(self.byte(), b'+' | b'-')
                    && if hex {
                        matches!(self.source[self.offset - 1], b'p' | b'P')
                    } else {
                        matches!(self.source[self.offset - 1], b'e' | b'E')
                    }
            {
                self.take();
            }
            value = crate::numbers::parse(&self.source[start..self.offset])
                .ok_or_else(|| Error::syntax("malformed number"))?;
            "number".into()
        } else {
            let mut operator = None;
            for op in ["...", "..", "//", "==", "~=", "<=", ">=", "<<", ">>", "::"] {
                if self.source[start..].starts_with(op.as_bytes()) {
                    operator = Some(op);
                    break;
                }
            }
            if let Some(op) = operator {
                self.offset += op.len();
                op.into()
            } else {
                self.take();
                (b as char).to_string()
            }
        };
        Ok(Token { kind, value, line })
    }
}
struct Parser {
    tokens: Vec<Token>,
    offset: usize,
    depth: usize,
}
impl Parser {
    fn token(&self) -> &Token {
        &self.tokens[self.offset]
    }
    fn kind(&self) -> &str {
        &self.token().kind
    }
    fn is_end(&self) -> bool {
        matches!(self.kind(), "end" | "else" | "elseif" | "until" | "eof")
    }
    fn eat(&mut self, kind: &str) -> bool {
        if self.kind() == kind {
            self.offset += 1;
            true
        } else {
            false
        }
    }
    fn expect(&mut self, kind: &str) -> Result<()> {
        if self.eat(kind) {
            Ok(())
        } else {
            Err(Error::syntax(format!(
                "Expected '{kind}', found '{}'",
                self.kind()
            )))
        }
    }
    fn name(&mut self) -> Result<String> {
        let value = self.token().value.clone();
        self.expect("name")?;
        if let Value::String(s) = value {
            Ok(String::from_utf8(s).expect("ASCII identifier"))
        } else {
            unreachable!()
        }
    }
    fn expressions(&mut self) -> Result<Vec<Expr>> {
        let mut xs = vec![self.expression(0)?];
        while self.eat(",") {
            xs.push(self.expression(0)?);
        }
        Ok(xs)
    }
    fn block(&mut self) -> Result<Vec<Stmt>> {
        self.depth += 1;
        if self.depth > 200 {
            return Err(Error::syntax("too many syntax levels"));
        }
        let mut body = Vec::new();
        while !self.is_end() {
            if self.eat(";") {
                continue;
            }
            let s = self.statement()?;
            let ret = matches!(s, Stmt::Return(_));
            body.push(s);
            if ret {
                break;
            }
        }
        self.depth -= 1;
        Ok(body)
    }
    fn function(&mut self, line: usize, method: bool) -> Result<Expr> {
        self.expect("(")?;
        let mut names = Vec::new();
        if method {
            names.push("self".into());
        }
        let mut vararg = false;
        if self.kind() != ")" {
            loop {
                if self.eat("...") {
                    vararg = true;
                    break;
                }
                names.push(self.name()?);
                if !self.eat(",") {
                    break;
                }
            }
        }
        self.expect(")")?;
        let body = self.block()?;
        self.expect("end")?;
        Ok(Expr(line, Node::Function(names, vararg, body)))
    }
    fn table(&mut self) -> Result<Expr> {
        let line = self.token().line;
        self.expect("{")?;
        let mut fields = Vec::new();
        while self.kind() != "}" {
            let key = if self.eat("[") {
                let e = self.expression(0)?;
                self.expect("]")?;
                self.expect("=")?;
                Some(e)
            } else if self.kind() == "name" && self.tokens[self.offset + 1].kind == "=" {
                let e = Expr(self.token().line, Node::Literal(self.token().value.clone()));
                self.offset += 2;
                Some(e)
            } else {
                None
            };
            fields.push((key, self.expression(0)?));
            if !self.eat(",") && !self.eat(";") {
                break;
            }
        }
        self.expect("}")?;
        Ok(Expr(line, Node::Table(fields)))
    }
    fn arguments(&mut self) -> Result<Vec<Expr>> {
        if self.eat("(") {
            let args = if self.kind() == ")" {
                Vec::new()
            } else {
                self.expressions()?
            };
            self.expect(")")?;
            Ok(args)
        } else if self.kind() == "{" {
            Ok(vec![self.table()?])
        } else if self.kind() == "string" {
            let t = self.token().clone();
            self.offset += 1;
            Ok(vec![Expr(t.line, Node::Literal(t.value))])
        } else {
            Err(Error::syntax("Function arguments expected"))
        }
    }
    fn suffix(&mut self) -> Result<Expr> {
        let line = self.token().line;
        let mut expr = if self.eat("(") {
            let e = self.expression(0)?;
            self.expect(")")?;
            Expr(line, Node::Paren(Box::new(e)))
        } else {
            Expr(line, Node::Name(self.name()?))
        };
        loop {
            expr = if self.eat(".") {
                let key = Expr(
                    line,
                    Node::Literal(Value::String(self.name()?.into_bytes())),
                );
                Expr(line, Node::Index(Box::new(expr), Box::new(key)))
            } else if self.eat("[") {
                let key = self.expression(0)?;
                self.expect("]")?;
                Expr(line, Node::Index(Box::new(expr), Box::new(key)))
            } else if self.eat(":") {
                let method = self.name()?;
                Expr(
                    line,
                    Node::Method(Box::new(expr), method, self.arguments()?),
                )
            } else if matches!(self.kind(), "(" | "{" | "string") {
                Expr(line, Node::Call(Box::new(expr), self.arguments()?))
            } else {
                return Ok(expr);
            };
        }
    }
    fn expression(&mut self, minimum: u8) -> Result<Expr> {
        self.depth += 1;
        if self.depth > 200 {
            return Err(Error::syntax("too many syntax levels"));
        }
        let t = self.token().clone();
        let mut left = match t.kind.as_str() {
            "not" | "-" | "~" | "#" => {
                self.offset += 1;
                Expr(t.line, Node::Unary(t.kind, Box::new(self.expression(11)?)))
            }
            "nil" | "true" | "false" | "number" | "string" => {
                self.offset += 1;
                Expr(
                    t.line,
                    Node::Literal(match t.kind.as_str() {
                        "true" => Value::Bool(true),
                        "false" => Value::Bool(false),
                        _ => t.value,
                    }),
                )
            }
            "..." => {
                self.offset += 1;
                Expr(t.line, Node::Vararg)
            }
            "function" => {
                self.offset += 1;
                self.function(t.line, false)?
            }
            "{" => self.table()?,
            _ => self.suffix()?,
        };
        loop {
            let op = self.kind().to_string();
            let priority = match op.as_str() {
                "or" => 1,
                "and" => 2,
                "<" | ">" | "<=" | ">=" | "~=" | "==" => 3,
                "|" => 4,
                "~" => 5,
                "&" => 6,
                "<<" | ">>" => 7,
                ".." => 8,
                "+" | "-" => 9,
                "*" | "/" | "//" | "%" => 10,
                "^" => 12,
                _ => 0,
            };
            if priority <= minimum {
                break;
            }
            self.offset += 1;
            let right = self.expression(priority - u8::from(op == "^" || op == ".."))?;
            left = Expr(t.line, Node::Binary(op, Box::new(left), Box::new(right)));
        }
        self.depth -= 1;
        Ok(left)
    }
    fn statement(&mut self) -> Result<Stmt> {
        let line = self.token().line;
        if self.eat("do") {
            let body = self.block()?;
            self.expect("end")?;
            return Ok(Stmt::Do(body));
        }
        if self.eat("while") {
            let cond = self.expression(0)?;
            self.expect("do")?;
            let body = self.block()?;
            self.expect("end")?;
            return Ok(Stmt::While(cond, body));
        }
        if self.eat("repeat") {
            let body = self.block()?;
            self.expect("until")?;
            return Ok(Stmt::Repeat(body, self.expression(0)?));
        }
        if self.eat("if") {
            let mut clauses = Vec::new();
            loop {
                let cond = self.expression(0)?;
                self.expect("then")?;
                clauses.push((Some(cond), self.block()?));
                if !self.eat("elseif") {
                    break;
                }
            }
            if self.eat("else") {
                clauses.push((None, self.block()?));
            }
            self.expect("end")?;
            return Ok(Stmt::If(clauses));
        }
        if self.eat("for") {
            let first = self.name()?;
            if self.eat("=") {
                let start = self.expression(0)?;
                self.expect(",")?;
                let limit = self.expression(0)?;
                let step = if self.eat(",") {
                    Some(self.expression(0)?)
                } else {
                    None
                };
                self.expect("do")?;
                let body = self.block()?;
                self.expect("end")?;
                return Ok(Stmt::For(first, start, limit, step, body));
            }
            let mut names = vec![first];
            while self.eat(",") {
                names.push(self.name()?);
            }
            self.expect("in")?;
            let values = self.expressions()?;
            self.expect("do")?;
            let body = self.block()?;
            self.expect("end")?;
            return Ok(Stmt::ForIn(names, values, body));
        }
        if self.eat("local") {
            if self.eat("function") {
                let name = self.name()?;
                return Ok(Stmt::LocalFunction(name, self.function(line, false)?));
            }
            let mut names = vec![self.name()?];
            while self.eat(",") {
                names.push(self.name()?);
            }
            let values = if self.eat("=") {
                self.expressions()?
            } else {
                Vec::new()
            };
            return Ok(Stmt::Local(names, values));
        }
        if self.eat("function") {
            let mut target = Expr(line, Node::Name(self.name()?));
            while self.eat(".") {
                target = Expr(
                    line,
                    Node::Index(
                        Box::new(target),
                        Box::new(Expr(
                            line,
                            Node::Literal(Value::String(self.name()?.into_bytes())),
                        )),
                    ),
                );
            }
            let method = self.eat(":");
            if method {
                target = Expr(
                    line,
                    Node::Index(
                        Box::new(target),
                        Box::new(Expr(
                            line,
                            Node::Literal(Value::String(self.name()?.into_bytes())),
                        )),
                    ),
                );
            }
            return Ok(Stmt::Assign(
                vec![target],
                vec![self.function(line, method)?],
            ));
        }
        if self.eat("return") {
            let xs = if self.is_end() || self.kind() == ";" {
                Vec::new()
            } else {
                self.expressions()?
            };
            self.eat(";");
            return Ok(Stmt::Return(xs));
        }
        if self.eat("break") {
            return Ok(Stmt::Break);
        }
        if self.eat("goto") {
            return Ok(Stmt::Goto(self.name()?));
        }
        if self.eat("::") {
            let name = self.name()?;
            self.expect("::")?;
            return Ok(Stmt::Label(name));
        }
        let expr = self.suffix()?;
        if self.kind() == "=" || self.kind() == "," {
            let mut targets = vec![expr];
            while self.eat(",") {
                targets.push(self.suffix()?);
            }
            if targets
                .iter()
                .any(|e| !matches!(e.1, Node::Name(_) | Node::Index(..)))
            {
                return Err(Error::syntax("Invalid assignment target"));
            }
            self.expect("=")?;
            Ok(Stmt::Assign(targets, self.expressions()?))
        } else if matches!(expr.1, Node::Call(..) | Node::Method(..)) {
            Ok(Stmt::Call(expr))
        } else {
            Err(Error::syntax("Unexpected statement"))
        }
    }
}
pub(crate) fn parse(source: &[u8]) -> Result<Vec<Stmt>> {
    let mut lexer = Lexer {
        source,
        offset: 0,
        line: 1,
    };
    let mut tokens = Vec::new();
    loop {
        let token = lexer.next()?;
        let end = token.kind == "eof";
        tokens.push(token);
        if end {
            break;
        }
    }
    let mut parser = Parser {
        tokens,
        offset: 0,
        depth: 0,
    };
    let body = parser.block()?;
    parser.expect("eof")?;
    Ok(body)
}

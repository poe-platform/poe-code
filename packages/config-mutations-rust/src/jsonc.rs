//! Lossless UTF-16 JSON with comments and targeted edits.
mod editor;
mod scanner;
pub use editor::{EditPlan, modify, plan};
use mcp_protocol_rust::json::{self, Value};
use scanner::{Kind, Scanner, Token};
use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub message: String,
    pub offset: usize,
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for Error {}
fn error(code: &str, offset: usize) -> Error {
    Error {
        message: format!("JSON parse error: {code}"),
        offset,
    }
}
fn edit_error(message: impl Into<String>) -> Error {
    Error {
        message: message.into(),
        offset: 0,
    }
}
fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PathSegment {
    Key(Vec<u16>),
    Index(i64),
}
enum Data {
    Scalar(Value),
    Object(Vec<(Vec<u16>, usize, Node)>),
    Array(Vec<Node>),
}
struct Node {
    start: usize,
    end: usize,
    data: Data,
}
impl Node {
    fn into_value(self) -> Value {
        match self.data {
            Data::Scalar(v) => v,
            Data::Array(v) => Value::Array(v.into_iter().map(Self::into_value).collect()),
            Data::Object(properties) => {
                let mut entries: Vec<(Vec<u16>, Value)> = Vec::new();
                let mut positions: std::collections::HashMap<Vec<u16>, usize> =
                    std::collections::HashMap::new();
                for (key, _, node) in properties {
                    let value = node.into_value();
                    if let Some(index) = positions.get(&key).copied() {
                        entries[index].1 = value;
                    } else {
                        positions.insert(key.clone(), entries.len());
                        entries.push((key, value));
                    }
                }
                entries.sort_by_key(|(key, _)| property_index(key).map_or(u64::MAX, u64::from));
                Value::Object(entries)
            }
        }
    }
    fn find(&self, path: &[PathSegment]) -> Option<&Node> {
        let mut node = self;
        for segment in path {
            node = match (&node.data, segment) {
                (Data::Object(p), PathSegment::Key(key)) => {
                    &p.iter().find(|(name, _, _)| name == key)?.2
                }
                (Data::Array(a), PathSegment::Index(i)) => a.get(usize::try_from(*i).ok()?)?,
                _ => return None,
            };
        }
        Some(node)
    }
    fn name(&self) -> &str {
        match self.data {
            Data::Object(_) => "object",
            Data::Array(_) => "array",
            Data::Scalar(Value::Null) => "null",
            Data::Scalar(Value::Bool(_)) => "boolean",
            Data::Scalar(Value::Number(_)) => "number",
            _ => "string",
        }
    }
}
struct Parser<'a> {
    scanner: Scanner<'a>,
    token: Token,
}
impl<'a> Parser<'a> {
    fn new(source: &'a [u16]) -> Result<Self, Error> {
        let mut scanner = Scanner::new(source);
        let token = scanner.next();
        let mut p = Self { scanner, token };
        p.skip_comments()?;
        Ok(p)
    }
    fn skip_comments(&mut self) -> Result<(), Error> {
        loop {
            if let Some(e) = self.token.error.take() {
                return Err(e);
            }
            if !matches!(self.token.kind, Kind::LineComment | Kind::BlockComment) {
                return Ok(());
            }
            self.token = self.scanner.next();
        }
    }
    fn advance(&mut self) -> Result<(), Error> {
        self.token = self.scanner.next();
        self.skip_comments()
    }
    fn node(&mut self, depth: usize) -> Result<Node, Error> {
        if depth > 512 {
            return Err(error("NestingLimitExceeded", self.token.start));
        }
        let start = self.token.start;
        let data = match self.token.kind {
            Kind::OpenObject => {
                self.advance()?;
                let mut props = Vec::new();
                let mut after_comma = false;
                while self.token.kind != Kind::CloseObject {
                    if props.is_empty() && !after_comma && self.token.kind == Kind::Comma {
                        return Err(error("ValueExpected", self.token.start));
                    }
                    if self.token.kind == Kind::Eof {
                        return Err(error(
                            if after_comma {
                                "PropertyNameExpected"
                            } else {
                                "CloseBraceExpected"
                            },
                            self.token.start,
                        ));
                    }
                    if self.token.kind != Kind::String {
                        return Err(error("PropertyNameExpected", self.token.start));
                    }
                    let property_start = self.token.start;
                    let Some(Value::String(key)) = self.token.value.take() else {
                        unreachable!()
                    };
                    self.advance()?;
                    if self.token.kind != Kind::Colon {
                        return Err(error("ColonExpected", self.token.start));
                    }
                    self.advance()?;
                    let child = self.node(depth + 1)?;
                    props.push((key, property_start, child));
                    after_comma = self.token.kind == Kind::Comma;
                    if after_comma {
                        self.advance()?;
                    } else if self.token.kind != Kind::CloseObject {
                        if self.token.kind == Kind::Eof {
                            return Err(error("CloseBraceExpected", self.token.start));
                        }
                        return Err(error("CommaExpected", self.token.start));
                    }
                }
                Data::Object(props)
            }
            Kind::OpenArray => {
                self.advance()?;
                let mut children = Vec::new();
                let mut after_comma = false;
                while self.token.kind != Kind::CloseArray {
                    if self.token.kind == Kind::Eof {
                        return Err(error(
                            if after_comma {
                                "ValueExpected"
                            } else {
                                "CloseBracketExpected"
                            },
                            self.token.start,
                        ));
                    }
                    children.push(self.node(depth + 1)?);
                    after_comma = self.token.kind == Kind::Comma;
                    if after_comma {
                        self.advance()?;
                    } else if self.token.kind != Kind::CloseArray {
                        if self.token.kind == Kind::Eof {
                            return Err(error("CloseBracketExpected", self.token.start));
                        }
                        return Err(error("CommaExpected", self.token.start));
                    }
                }
                Data::Array(children)
            }
            Kind::String | Kind::Number | Kind::Null | Kind::True | Kind::False => {
                Data::Scalar(self.token.value.take().unwrap())
            }
            _ => return Err(error("ValueExpected", self.token.start)),
        };
        let end = self.token.end;
        self.advance()?;
        Ok(Node { start, end, data })
    }
}
fn tree(source: &[u16]) -> Result<Option<Node>, Error> {
    let mut p = Parser::new(source)?;
    if p.token.kind == Kind::Eof {
        return Ok(None);
    }
    let node = p.node(0)?;
    if p.token.kind != Kind::Eof {
        return Err(error("EndOfFileExpected", p.token.start));
    }
    Ok(Some(node))
}
fn trim_space(ch: u16) -> bool {
    matches!(ch,9..=13|32|160|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000|0xfeff)
}
pub fn parse_object(source: &[u16]) -> Result<Value, Error> {
    if source.iter().all(|ch| trim_space(*ch)) {
        return Ok(Value::Object(vec![]));
    }
    let value = tree(source)?
        .ok_or_else(|| error("ValueExpected", source.len()))?
        .into_value();
    match value {
        Value::Null => Ok(Value::Object(vec![])),
        Value::Object(_) => Ok(value),
        _ => Err(edit_error("Expected JSON object.")),
    }
}
pub fn detect_indent(source: &[u16]) -> Vec<u16> {
    let mut start = 0;
    while start < source.len() {
        let mut end = start;
        while matches!(source.get(end), Some(9 | 32)) {
            end += 1;
        }
        if end > start {
            return source[start..end].to_vec();
        }
        while start < source.len() && !matches!(source[start], 10 | 13 | 0x2028 | 0x2029) {
            start += 1;
        }
        start += 1;
    }
    units("  ")
}
fn compact(value: &Value) -> Vec<u16> {
    enum Pending<'a> {
        Value(&'a Value),
        Key(&'a [u16]),
        Unit(u16),
    }
    let mut pending = vec![Pending::Value(value)];
    let mut output = vec![];
    while let Some(next) = pending.pop() {
        match next {
            Pending::Unit(unit) => output.push(unit),
            Pending::Key(key) => {
                output.extend(units(&json::stringify(&Value::String(key.to_vec()))))
            }
            Pending::Value(Value::Object(properties)) => {
                let mut sorted: Vec<_> = properties.iter().collect();
                sorted.sort_by_key(|(key, _)| property_index(key).map_or(u64::MAX, u64::from));
                output.push(123);
                pending.push(Pending::Unit(125));
                for (index, (key, value)) in sorted.into_iter().enumerate().rev() {
                    pending.push(Pending::Value(value));
                    pending.push(Pending::Unit(58));
                    pending.push(Pending::Key(key));
                    if index > 0 {
                        pending.push(Pending::Unit(44));
                    }
                }
            }
            Pending::Value(Value::Array(values)) => {
                output.push(91);
                pending.push(Pending::Unit(93));
                for (index, value) in values.iter().enumerate().rev() {
                    pending.push(Pending::Value(value));
                    if index > 0 {
                        pending.push(Pending::Unit(44));
                    }
                }
            }
            Pending::Value(value) => output.extend(units(&json::stringify(value))),
        }
    }
    output
}
fn property_index(key: &[u16]) -> Option<u32> {
    if key.is_empty() || (key.len() > 1 && key[0] == 48) {
        return None;
    }
    let mut number = 0u32;
    for unit in key {
        if !(48..=57).contains(unit) {
            return None;
        }
        number = number.checked_mul(10)?.checked_add(u32::from(*unit - 48))?;
    }
    (number < u32::MAX).then_some(number)
}
pub fn serialize(value: &Value) -> Vec<u16> {
    let raw = compact(value);
    let mut output = editor::format_range(&raw, 0, raw.len(), &[32, 32]);
    output.push(10);
    output
}

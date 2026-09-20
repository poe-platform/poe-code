use std::{collections::HashMap, fmt, fmt::Write};

/// UTF-16 code units preserve lone surrogates accepted by JavaScript's JSON API.
pub type JsonString = Vec<u16>;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(JsonString),
    Array(Vec<Value>),
    Object(Vec<(JsonString, Value)>),
}

impl Value {
    pub fn get(&self, name: &str) -> Option<&Value> {
        let Self::Object(properties) = self else {
            return None;
        };
        properties
            .iter()
            .find(|(key, _)| key.iter().copied().eq(name.encode_utf16()))
            .map(|(_, value)| value)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_bytes: usize,
    pub max_depth: usize,
    pub max_nodes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_bytes: 16 * 1024 * 1024,
            max_depth: 128,
            max_nodes: 262_144,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    InvalidUtf8,
    UnexpectedValue,
    UnexpectedEnd,
    InvalidString,
    InvalidNumber,
    TrailingData,
    ByteLimit,
    DepthLimit,
    NodeLimit,
    InvalidLimits,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub offset: usize,
    pub kind: ErrorKind,
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "Invalid JSON at byte {}: {:?}",
            self.offset, self.kind
        )
    }
}

impl std::error::Error for Error {}

pub fn parse(input: &[u8], limits: Limits) -> Result<Value, Error> {
    if limits.max_depth > 512 {
        return Err(Error {
            offset: 0,
            kind: ErrorKind::InvalidLimits,
        });
    }
    if input.len() > limits.max_bytes {
        return Err(Error {
            offset: limits.max_bytes,
            kind: ErrorKind::ByteLimit,
        });
    }
    let input = std::str::from_utf8(input).map_err(|error| Error {
        offset: error.valid_up_to(),
        kind: ErrorKind::InvalidUtf8,
    })?;
    let mut parser = Parser {
        input,
        offset: 0,
        nodes: 0,
        limits,
    };
    let value = parser.value(0)?;
    parser.whitespace();
    if parser.offset != input.len() {
        return Err(parser.error(ErrorKind::TrailingData));
    }
    Ok(value)
}

struct Parser<'a> {
    input: &'a str,
    offset: usize,
    nodes: usize,
    limits: Limits,
}

impl Parser<'_> {
    fn error(&self, kind: ErrorKind) -> Error {
        Error {
            offset: self.offset,
            kind,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.input.as_bytes().get(self.offset).copied()
    }

    fn whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\r' | b'\n')) {
            self.offset += 1;
        }
    }

    fn consume(&mut self, byte: u8) -> bool {
        if self.peek() == Some(byte) {
            self.offset += 1;
            true
        } else {
            false
        }
    }

    fn value(&mut self, depth: usize) -> Result<Value, Error> {
        self.whitespace();
        if self.nodes >= self.limits.max_nodes {
            return Err(self.error(ErrorKind::NodeLimit));
        }
        self.nodes += 1;
        match self.peek() {
            Some(b'n') => self.literal("null", Value::Null),
            Some(b't') => self.literal("true", Value::Bool(true)),
            Some(b'f') => self.literal("false", Value::Bool(false)),
            Some(b'"') => self.string().map(Value::String),
            Some(b'-' | b'0'..=b'9') => self.number().map(Value::Number),
            Some(b'[' | b'{') if depth >= self.limits.max_depth => {
                Err(self.error(ErrorKind::DepthLimit))
            }
            Some(b'[') => self.array(depth),
            Some(b'{') => self.object(depth),
            None => Err(self.error(ErrorKind::UnexpectedEnd)),
            _ => Err(self.error(ErrorKind::UnexpectedValue)),
        }
    }

    fn literal(&mut self, literal: &str, value: Value) -> Result<Value, Error> {
        if self.input.as_bytes()[self.offset..].starts_with(literal.as_bytes()) {
            self.offset += literal.len();
            Ok(value)
        } else {
            Err(self.error(ErrorKind::UnexpectedValue))
        }
    }

    fn array(&mut self, depth: usize) -> Result<Value, Error> {
        self.offset += 1;
        self.whitespace();
        let mut values = Vec::new();
        if self.consume(b']') {
            return Ok(Value::Array(values));
        }
        loop {
            values.push(self.value(depth + 1)?);
            self.whitespace();
            if self.consume(b']') {
                return Ok(Value::Array(values));
            }
            if !self.consume(b',') {
                return Err(self.error(ErrorKind::UnexpectedValue));
            }
        }
    }

    fn object(&mut self, depth: usize) -> Result<Value, Error> {
        self.offset += 1;
        self.whitespace();
        let mut properties: Vec<(JsonString, Value)> = Vec::new();
        let mut indexes: HashMap<JsonString, usize> = HashMap::new();
        if self.consume(b'}') {
            return Ok(Value::Object(properties));
        }
        loop {
            self.whitespace();
            let key = self.string()?;
            self.whitespace();
            if !self.consume(b':') {
                return Err(self.error(ErrorKind::UnexpectedValue));
            }
            let value = self.value(depth + 1)?;
            if let Some(index) = indexes.get(&key).copied() {
                properties[index].1 = value;
            } else {
                indexes.insert(key.clone(), properties.len());
                properties.push((key, value));
            }
            self.whitespace();
            if self.consume(b'}') {
                return Ok(Value::Object(properties));
            }
            if !self.consume(b',') {
                return Err(self.error(ErrorKind::UnexpectedValue));
            }
        }
    }

    fn string(&mut self) -> Result<JsonString, Error> {
        if !self.consume(b'"') {
            return Err(self.error(ErrorKind::InvalidString));
        }
        let mut result = Vec::new();
        let mut start = self.offset;
        loop {
            match self.peek() {
                Some(b'"') => {
                    result.extend(self.input[start..self.offset].encode_utf16());
                    self.offset += 1;
                    return Ok(result);
                }
                Some(b'\\') => {
                    result.extend(self.input[start..self.offset].encode_utf16());
                    self.offset += 1;
                    let escaped = match self.peek() {
                        Some(b'"') => b'"' as u16,
                        Some(b'\\') => b'\\' as u16,
                        Some(b'/') => b'/' as u16,
                        Some(b'b') => 8,
                        Some(b'f') => 12,
                        Some(b'n') => 10,
                        Some(b'r') => 13,
                        Some(b't') => 9,
                        Some(b'u') => {
                            self.offset += 1;
                            let mut unit = 0;
                            for _ in 0..4 {
                                let digit = match self.peek() {
                                    Some(byte @ b'0'..=b'9') => byte - b'0',
                                    Some(byte @ b'a'..=b'f') => byte - b'a' + 10,
                                    Some(byte @ b'A'..=b'F') => byte - b'A' + 10,
                                    _ => return Err(self.error(ErrorKind::InvalidString)),
                                };
                                unit = unit * 16 + digit as u16;
                                self.offset += 1;
                            }
                            result.push(unit);
                            start = self.offset;
                            continue;
                        }
                        _ => return Err(self.error(ErrorKind::InvalidString)),
                    };
                    result.push(escaped);
                    self.offset += 1;
                    start = self.offset;
                }
                Some(0..=31) => return Err(self.error(ErrorKind::InvalidString)),
                Some(_) => self.offset += 1,
                None => return Err(self.error(ErrorKind::UnexpectedEnd)),
            }
        }
    }

    fn number(&mut self) -> Result<f64, Error> {
        let start = self.offset;
        self.consume(b'-');
        match self.peek() {
            Some(b'0') => self.offset += 1,
            Some(b'1'..=b'9') => {
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.offset += 1;
                }
            }
            _ => return Err(self.error(ErrorKind::InvalidNumber)),
        }
        if self.consume(b'.') {
            self.digits()?;
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.offset += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.offset += 1;
            }
            self.digits()?;
        }
        self.input[start..self.offset]
            .parse()
            .map_err(|_| self.error(ErrorKind::InvalidNumber))
    }

    fn digits(&mut self) -> Result<(), Error> {
        let start = self.offset;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.offset += 1;
        }
        if start == self.offset {
            Err(self.error(ErrorKind::InvalidNumber))
        } else {
            Ok(())
        }
    }
}

/// Iterative traversal avoids adding serializer recursion to the host stack.
pub fn stringify(value: &Value) -> String {
    enum Pending<'a> {
        Value(&'a Value),
        String(&'a [u16]),
        Delimiter(char),
    }
    let mut output = String::new();
    let mut pending = vec![Pending::Value(value)];
    while let Some(next) = pending.pop() {
        match next {
            Pending::Delimiter(delimiter) => output.push(delimiter),
            Pending::String(string) => write_string(&mut output, string),
            Pending::Value(Value::Null) => output.push_str("null"),
            Pending::Value(Value::Bool(value)) => {
                output.push_str(if *value { "true" } else { "false" })
            }
            Pending::Value(Value::Number(number)) => {
                if !number.is_finite() {
                    output.push_str("null");
                } else if *number == 0.0 {
                    output.push('0');
                } else {
                    write!(output, "{number}").expect("writing to a String cannot fail");
                }
            }
            Pending::Value(Value::String(string)) => write_string(&mut output, string),
            Pending::Value(Value::Array(values)) => {
                output.push('[');
                pending.push(Pending::Delimiter(']'));
                for (index, value) in values.iter().enumerate().rev() {
                    pending.push(Pending::Value(value));
                    if index > 0 {
                        pending.push(Pending::Delimiter(','));
                    }
                }
            }
            Pending::Value(Value::Object(properties)) => {
                output.push('{');
                pending.push(Pending::Delimiter('}'));
                for (index, (key, value)) in properties.iter().enumerate().rev() {
                    pending.push(Pending::Value(value));
                    pending.push(Pending::Delimiter(':'));
                    pending.push(Pending::String(key));
                    if index > 0 {
                        pending.push(Pending::Delimiter(','));
                    }
                }
            }
        }
    }
    output
}

fn write_string(output: &mut String, units: &[u16]) {
    output.push('"');
    let mut index = 0;
    while index < units.len() {
        let unit = units[index];
        match unit {
            0x22 => output.push_str("\\\""),
            0x5c => output.push_str("\\\\"),
            8 => output.push_str("\\b"),
            9 => output.push_str("\\t"),
            10 => output.push_str("\\n"),
            12 => output.push_str("\\f"),
            13 => output.push_str("\\r"),
            0..=31 => write!(output, "\\u{unit:04x}").expect("writing to a String cannot fail"),
            0xd800..=0xdbff if matches!(units.get(index + 1), Some(0xdc00..=0xdfff)) => {
                let low = units[index + 1];
                let scalar = 0x10000 + ((unit as u32 - 0xd800) << 10) + (low as u32 - 0xdc00);
                output
                    .push(char::from_u32(scalar).expect("a paired surrogate is a Unicode scalar"));
                index += 1;
            }
            0xd800..=0xdfff => {
                write!(output, "\\u{unit:04x}").expect("writing to a String cannot fail")
            }
            _ => output.push(
                char::from_u32(unit as u32).expect("a non-surrogate unit is a Unicode scalar"),
            ),
        }
        index += 1;
    }
    output.push('"');
}

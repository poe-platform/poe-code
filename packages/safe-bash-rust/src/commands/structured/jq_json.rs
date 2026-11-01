//! jq's incremental JSON input grammar. In stream mode a frame retains the
//! current index or key, never the already-published children.
use super::{JVal, parse_single_json_strict};
use std::collections::VecDeque;

struct Frame {
    value: JVal,
    count: usize,
    key: Option<String>,
}

pub(super) struct Parser {
    frames: Vec<Frame>,
    pending: Option<JVal>,
    token: Vec<u8>,
    quoted: bool,
    escaped: bool,
    closed: bool,
    bom: usize,
    stream: bool,
    pub line: usize,
    pub column: usize,
    pub events: VecDeque<JVal>,
}

impl Parser {
    pub fn new(stream: bool, line: usize, column: usize) -> Self {
        Self {
            frames: Vec::new(),
            pending: None,
            token: Vec::new(),
            quoted: false,
            escaped: false,
            closed: false,
            bom: 0,
            stream,
            line,
            column,
            events: VecDeque::new(),
        }
    }
    pub fn path(&self) -> Vec<JVal> {
        self.frames
            .iter()
            .filter_map(|f| match &f.value {
                JVal::Array(_) => Some(JVal::Number(f.count as f64)),
                _ => f.key.as_ref().map(|k| JVal::Str(k.clone())),
            })
            .collect()
    }

    fn accept(&mut self, value: JVal) -> Result<(), &'static str> {
        if self.pending.is_some() {
            return Err("Expected separator between values");
        }
        self.pending = Some(value);
        self.closed = false;
        Ok(())
    }
    fn literal(&mut self, eof: bool) -> Result<(), &'static str> {
        if self.token.is_empty() {
            return Ok(());
        }
        let invalid = if eof {
            "Invalid numeric literal at EOF"
        } else {
            "Invalid numeric literal"
        };
        let text = std::str::from_utf8(&self.token).map_err(|_| invalid)?;
        let value = match text {
            "true" => JVal::Bool(true),
            "false" => JVal::Bool(false),
            "null" => JVal::Null,
            s if s.starts_with(['t', 'f']) || s.starts_with("nu") => {
                return Err(if eof {
                    "Invalid literal at EOF"
                } else {
                    "Invalid literal"
                });
            }
            _ => number(text).ok_or(invalid)?,
        };
        self.token.clear();
        self.accept(value)
    }
    fn done(&mut self) {
        if self.frames.is_empty()
            && let Some(value) = self.pending.take()
        {
            if !self.stream {
                self.events.push_back(value);
            } else if !self.closed {
                self.events
                    .push_back(JVal::Array(vec![JVal::Array(Vec::new()), value]));
            }
            self.closed = false;
        }
    }
    fn append(&mut self) -> Result<(), &'static str> {
        let value = self.pending.take().ok_or("Expected value before ','")?;
        let path = (self.stream && !self.closed).then(|| self.path());
        let frame = self
            .frames
            .last_mut()
            .ok_or("',' not as part of an object or array")?;
        match &mut frame.value {
            JVal::Array(array) => {
                if !self.stream {
                    array.push(value);
                } else if let Some(path) = path {
                    self.events
                        .push_back(JVal::Array(vec![JVal::Array(path), value]));
                }
            }
            JVal::Object(object) => {
                let key = frame
                    .key
                    .take()
                    .ok_or("Objects must consist of key:value pairs")?;
                if !self.stream {
                    if let Some((_, v)) = object.iter_mut().find(|(k, _)| k == &key) {
                        *v = value;
                    } else {
                        object.push((key, value));
                    }
                } else if let Some(path) = path {
                    self.events
                        .push_back(JVal::Array(vec![JVal::Array(path), value]));
                }
            }
            _ => unreachable!(),
        }
        frame.count += 1;
        Ok(())
    }
    fn structure(&mut self, b: u8) -> Result<(), &'static str> {
        match b {
            b'[' | b'{' => {
                if self.pending.is_some() {
                    return Err("Expected separator between values");
                }
                if self.frames.len() >= 256 {
                    return Err("maxDepth limit exceeded");
                }
                self.frames.push(Frame {
                    value: if b == b'[' {
                        JVal::Array(Vec::new())
                    } else {
                        JVal::Object(Vec::new())
                    },
                    count: 0,
                    key: None,
                });
            }
            b':' => {
                let key = self
                    .pending
                    .take()
                    .ok_or("Expected string key before ':'")?;
                let frame = self
                    .frames
                    .last_mut()
                    .filter(|f| matches!(f.value, JVal::Object(_)) && f.key.is_none())
                    .ok_or("':' not as part of an object")?;
                let JVal::Str(k) = key else {
                    return Err("Object keys must be strings");
                };
                frame.key = Some(k);
            }
            b',' => self.append()?,
            b']' | b'}' => {
                let unmatched = if b == b']' {
                    "Unmatched ']'"
                } else {
                    "Unmatched '}'"
                };
                let frame = self.frames.last().ok_or(unmatched)?;
                let array = matches!(frame.value, JVal::Array(_));
                if (b == b']' && !array) || (b == b'}' && array && self.pending.is_none()) {
                    return Err(unmatched);
                }
                if b == b'}' && self.pending.is_some() && frame.key.is_none() {
                    return Err("Objects must consist of key:value pairs");
                }
                let path = self.stream.then(|| self.path());
                if self.pending.is_some() {
                    self.append()?;
                } else if frame.key.is_some() {
                    return Err(unmatched);
                } else if frame.count != 0 {
                    return Err(if array {
                        "Expected another array element"
                    } else {
                        "Expected another key-value pair"
                    });
                }
                let frame = self.frames.pop().unwrap();
                if let Some(mut path) = path {
                    if frame.count == 0 {
                        if array {
                            path.pop();
                        }
                        self.events
                            .push_back(JVal::Array(vec![JVal::Array(path), frame.value.clone()]));
                    } else {
                        self.events.push_back(JVal::Array(vec![JVal::Array(path)]));
                    }
                }
                self.pending = Some(frame.value);
                self.closed = true;
            }
            _ => {}
        }
        Ok(())
    }
    pub fn feed(&mut self, b: u8) -> Result<(), &'static str> {
        if self.bom < 3 {
            if b == [0xef, 0xbb, 0xbf][self.bom] {
                self.bom += 1;
                return Ok(());
            }
            if self.bom > 0 {
                return Err("Malformed BOM");
            }
            self.bom = 3;
        }
        if b == b'\n' {
            self.line += 1;
            self.column = 0;
        } else {
            self.column += 1;
        }
        if self.quoted {
            if b == b'"' && !self.escaped {
                let value = string(&self.token)?;
                self.quoted = false;
                self.token.clear();
                self.accept(JVal::Str(value))?;
                self.done();
            } else {
                self.token.push(b);
                self.escaped = b == b'\\' && !self.escaped;
            }
            return Ok(());
        }
        if !matches!(
            b,
            b' ' | b'\r' | b'\n' | b'\t' | b'[' | b']' | b'{' | b'}' | b':' | b',' | b'"'
        ) {
            self.token.push(b);
            return Ok(());
        }
        self.literal(false)?;
        self.done();
        if b == b'"' {
            self.quoted = true;
            self.escaped = false;
        } else {
            self.structure(b)?;
        }
        self.done();
        Ok(())
    }
    pub fn finish(&mut self, sequence: bool, eof: bool) -> Result<(), &'static str> {
        if sequence {
            if !self.quoted
                && self.frames.is_empty()
                && std::str::from_utf8(&self.token)
                    .ok()
                    .and_then(number)
                    .is_some()
            {
                return Err(if eof {
                    "Potentially truncated top-level numeric value at EOF"
                } else {
                    "Potentially truncated top-level numeric value"
                });
            }
            if !eof && !self.frames.is_empty() && !self.quoted && self.token.is_empty() {
                return Ok(());
            }
            if !eof && (self.quoted || (!self.token.is_empty() && !self.frames.is_empty())) {
                return Err("Truncated value");
            }
        }
        if self.quoted {
            return Err("Unfinished string at EOF");
        }
        self.literal(true)?;
        if !self.frames.is_empty() {
            return Err("Unfinished JSON term at EOF");
        }
        self.done();
        Ok(())
    }
}

fn number(text: &str) -> Option<JVal> {
    let number = text.split('\0').next().unwrap_or(text);
    if let Ok(JVal::Number(n)) = parse_single_json_strict(number) {
        Some(JVal::Number(n))
    } else if let Ok(n) = number.parse::<f64>() {
        Some(JVal::Number(n))
    } else {
        let name = number
            .strip_prefix(['+', '-'])
            .unwrap_or(number)
            .trim_end_matches(|c: char| c.is_ascii_digit());
        if name.eq_ignore_ascii_case("nan") || name.eq_ignore_ascii_case("snan") {
            Some(JVal::Number(f64::NAN))
        } else {
            None
        }
    }
}

fn string(bytes: &[u8]) -> Result<String, &'static str> {
    let text = String::from_utf8_lossy(bytes);
    if !bytes.iter().any(|b| *b == b'\\' || *b < 32) {
        return Ok(text.into_owned());
    }
    fn unit(chars: &mut std::str::Chars<'_>) -> Result<u32, &'static str> {
        let mut value = 0;
        for _ in 0..4 {
            let c = chars.next().ok_or("Invalid \\uXXXX escape")?;
            value = value * 16
                + c.to_digit(16)
                    .ok_or("Invalid characters in \\uXXXX escape")?;
        }
        Ok(value)
    }
    let mut out = String::new();
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c < ' ' {
            return Err(
                "Invalid string: control characters from U+0000 through U+001F must be escaped",
            );
        }
        if c != '\\' {
            out.push(c);
            continue;
        }
        if chars.as_str().starts_with('u') {
            chars.next();
            let high = unit(&mut chars)?;
            let point = if (0xd800..=0xdbff).contains(&high) {
                let pair = "Invalid \\uXXXX\\uXXXX surrogate pair escape";
                if chars.next() != Some('\\') || chars.next() != Some('u') {
                    return Err(pair);
                }
                let low = unit(&mut chars).map_err(|_| pair)?;
                if !(0xdc00..=0xdfff).contains(&low) {
                    return Err(pair);
                }
                0x10000 + ((high - 0xd800) << 10) + low - 0xdc00
            } else {
                high
            };
            out.push(char::from_u32(point).unwrap_or(char::REPLACEMENT_CHARACTER));
        } else {
            out.push(super::json_escape(&mut chars).ok_or("Invalid escape")?);
        }
    }
    Ok(out)
}

use super::{Error, Value, error};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Kind {
    OpenObject,
    CloseObject,
    OpenArray,
    CloseArray,
    Comma,
    Colon,
    String,
    Number,
    Null,
    True,
    False,
    LineComment,
    BlockComment,
    Eof,
    Unknown,
}
pub(super) struct Token {
    pub kind: Kind,
    pub start: usize,
    pub end: usize,
    pub value: Option<Value>,
    pub error: Option<Error>,
    pub line_break: bool,
}
pub(super) struct Scanner<'a> {
    source: &'a [u16],
    pos: usize,
}
impl<'a> Scanner<'a> {
    pub fn new(source: &'a [u16]) -> Self {
        Self { source, pos: 0 }
    }
    fn peek(&self) -> Option<u16> {
        self.source.get(self.pos).copied()
    }
    pub fn next(&mut self) -> Token {
        let mut line_break = false;
        while matches!(self.peek(), Some(9 | 32 | 10 | 13)) {
            let ch = self.source[self.pos];
            line_break |= ch == 10 || ch == 13;
            self.pos += 1;
        }
        let start = self.pos;
        let mut value = None;
        let mut problem = None;
        let kind = match self.peek() {
            None => Kind::Eof,
            Some(ch @ (123 | 125 | 91 | 93 | 44 | 58)) => {
                self.pos += 1;
                match ch {
                    123 => Kind::OpenObject,
                    125 => Kind::CloseObject,
                    91 => Kind::OpenArray,
                    93 => Kind::CloseArray,
                    44 => Kind::Comma,
                    _ => Kind::Colon,
                }
            }
            Some(34) => {
                self.pos += 1;
                let mut decoded = Vec::new();
                let mut closed = false;
                while let Some(ch) = self.peek() {
                    self.pos += 1;
                    if ch == 34 {
                        closed = true;
                        break;
                    }
                    if ch == 92 {
                        let Some(escape) = self.peek() else { break };
                        self.pos += 1;
                        match escape {
                            34 | 47 | 92 => decoded.push(escape),
                            98 => decoded.push(8),
                            102 => decoded.push(12),
                            110 => decoded.push(10),
                            114 => decoded.push(13),
                            116 => decoded.push(9),
                            117 => {
                                let mut unit = 0;
                                let mut count = 0;
                                while count < 4 {
                                    let digit = match self.peek() {
                                        Some(48..=57) => self.source[self.pos] - 48,
                                        Some(65..=70) => self.source[self.pos] - 55,
                                        Some(97..=102) => self.source[self.pos] - 87,
                                        _ => break,
                                    };
                                    unit = unit * 16 + digit;
                                    count += 1;
                                    self.pos += 1;
                                }
                                if count == 4 {
                                    decoded.push(unit)
                                } else {
                                    problem = Some(error("InvalidUnicode", start));
                                }
                            }
                            _ => problem = Some(error("InvalidEscapeCharacter", start)),
                        }
                    } else if ch < 32 {
                        if ch == 10 || ch == 13 {
                            self.pos -= 1;
                            problem = Some(error("UnexpectedEndOfString", start));
                            break;
                        }
                        problem = Some(error("InvalidCharacter", start));
                        decoded.push(ch);
                    } else {
                        decoded.push(ch);
                    }
                }
                if !closed {
                    problem = Some(error("UnexpectedEndOfString", start));
                }
                value = Some(Value::String(decoded));
                Kind::String
            }
            Some(47) if self.source.get(self.pos + 1) == Some(&47) => {
                self.pos += 2;
                while !matches!(self.peek(), None | Some(10 | 13)) {
                    self.pos += 1;
                }
                Kind::LineComment
            }
            Some(47) if self.source.get(self.pos + 1) == Some(&42) => {
                self.pos += 2;
                let mut closed = false;
                while self.pos < self.source.len() {
                    if self.peek() == Some(42) && self.source.get(self.pos + 1) == Some(&47) {
                        self.pos += 2;
                        closed = true;
                        break;
                    }
                    self.pos += 1;
                }
                if !closed {
                    problem = Some(error("UnexpectedEndOfComment", start));
                }
                Kind::BlockComment
            }
            Some(45 | 48..=57) => {
                if self.peek() == Some(45) {
                    self.pos += 1;
                }
                if !matches!(self.peek(), Some(48..=57)) {
                    problem = Some(error("InvalidSymbol", start));
                    Kind::Unknown
                } else {
                    if self.peek() == Some(48) {
                        self.pos += 1;
                    } else {
                        while matches!(self.peek(), Some(48..=57)) {
                            self.pos += 1;
                        }
                    }
                    if self.peek() == Some(46) {
                        self.pos += 1;
                        let digits = self.pos;
                        while matches!(self.peek(), Some(48..=57)) {
                            self.pos += 1;
                        }
                        if digits == self.pos {
                            problem = Some(error("UnexpectedEndOfNumber", start));
                        }
                    }
                    if matches!(self.peek(), Some(69 | 101)) {
                        self.pos += 1;
                        if matches!(self.peek(), Some(43 | 45)) {
                            self.pos += 1;
                        }
                        let digits = self.pos;
                        while matches!(self.peek(), Some(48..=57)) {
                            self.pos += 1;
                        }
                        if digits == self.pos {
                            problem = Some(error("UnexpectedEndOfNumber", start));
                        }
                    }
                    let number = String::from_utf16_lossy(&self.source[start..self.pos])
                        .parse()
                        .unwrap_or(f64::NAN);
                    value = Some(Value::Number(number));
                    Kind::Number
                }
            }
            Some(_) => {
                self.pos += 1;
                while let Some(ch) = self.peek() {
                    if matches!(
                        ch,
                        9 | 32 | 10 | 13 | 123 | 125 | 91 | 93 | 44 | 58 | 34 | 47
                    ) {
                        break;
                    }
                    self.pos += 1;
                }
                match &self.source[start..self.pos] {
                    [116, 114, 117, 101] => {
                        value = Some(Value::Bool(true));
                        Kind::True
                    }
                    [102, 97, 108, 115, 101] => {
                        value = Some(Value::Bool(false));
                        Kind::False
                    }
                    [110, 117, 108, 108] => {
                        value = Some(Value::Null);
                        Kind::Null
                    }
                    _ => {
                        problem = Some(error("InvalidSymbol", start));
                        Kind::Unknown
                    }
                }
            }
        };
        Token {
            kind,
            start,
            end: self.pos,
            value,
            error: problem,
            line_break,
        }
    }
}

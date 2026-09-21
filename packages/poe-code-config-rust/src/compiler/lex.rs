//! Lexical boundaries for the intentionally static TypeScript schema surface.
#[derive(Clone, Debug)]
pub enum Kind {
    Ident(Vec<u16>),
    Quoted(Vec<u16>),
    Template(Vec<u16>, bool),
    Number(Vec<u16>),
    Symbol(u16),
    Opaque,
}
#[derive(Clone, Debug)]
pub struct Token {
    pub kind: Kind,
    pub start: usize,
    pub end: usize,
}
impl Token {
    pub fn is(&self, text: &str) -> bool {
        matches!(&self.kind,Kind::Ident(value) if value.iter().copied().eq(text.encode_utf16()))
    }
    pub fn symbol(&self, ch: u8) -> bool {
        matches!(self.kind,Kind::Symbol(unit) if unit==u16::from(ch))
    }
}
fn ident(unit: u16) -> bool {
    matches!(unit,36|95|48..=57|65..=90|97..=122|128..=65535)
}
fn space(unit: u16) -> bool {
    matches!(unit,9..=13|32|160|5760|8192..=8202|8232|8233|8239|8287|12288|65279)
}
fn hex(unit: u16) -> Option<u32> {
    match unit {
        48..=57 => Some(u32::from(unit - 48)),
        65..=70 => Some(u32::from(unit - 55)),
        97..=102 => Some(u32::from(unit - 87)),
        _ => None,
    }
}
struct Lexer<'a> {
    text: &'a [u16],
    pos: usize,
}
impl Lexer<'_> {
    fn at(&self, offset: usize) -> Option<u16> {
        self.text.get(self.pos + offset).copied()
    }
    fn hex(&mut self, count: usize) -> Result<u32, String> {
        let mut value = 0;
        for _ in 0..count {
            value = value * 16
                + hex(self.at(0).ok_or("Unterminated string escape")?)
                    .ok_or("Invalid string escape")?;
            self.pos += 1;
        }
        Ok(value)
    }
    fn quoted(&mut self, quote: u16, depth: usize) -> Result<(Vec<u16>, bool), String> {
        if depth > 128 {
            return Err("Static schema template depth exceeded (128).".into());
        }
        self.pos += 1;
        let mut result = vec![];
        let mut dynamic = false;
        while let Some(unit) = self.at(0) {
            self.pos += 1;
            if unit == quote {
                return Ok((result, dynamic));
            }
            if quote == 96 && unit == 36 && self.at(0) == Some(123) {
                dynamic = true;
                self.pos += 1;
                self.interpolation(depth + 1)?;
                continue;
            }
            if unit != 92 {
                if quote != 96 && matches!(unit, 10 | 13) {
                    return Err("Unterminated static schema string".into());
                }
                if quote == 96 && unit == 13 {
                    if self.at(0) == Some(10) {
                        self.pos += 1;
                    }
                    result.push(10);
                } else {
                    result.push(unit);
                }
                continue;
            }
            let escaped = self.at(0).ok_or("Unterminated string escape")?;
            self.pos += 1;
            match escaped {
                10 | 8232 | 8233 => {}
                13 => {
                    if self.at(0) == Some(10) {
                        self.pos += 1;
                    }
                }
                98 => result.push(8),
                102 => result.push(12),
                110 => result.push(10),
                114 => result.push(13),
                116 => result.push(9),
                118 => result.push(11),
                120 => result.push(self.hex(2)? as u16),
                117 => {
                    if self.at(0) == Some(123) {
                        self.pos += 1;
                        let mut value = 0_u32;
                        let mut count = 0;
                        while let Some(unit) = self.at(0) {
                            if unit == 125 {
                                break;
                            }
                            value = value
                                .checked_mul(16)
                                .and_then(|value| {
                                    hex(unit).and_then(|digit| value.checked_add(digit))
                                })
                                .ok_or("Invalid Unicode string escape")?;
                            count += 1;
                            self.pos += 1;
                        }
                        if count == 0 || self.at(0) != Some(125) || value > 0x10ffff {
                            return Err("Invalid Unicode string escape".into());
                        }
                        self.pos += 1;
                        if value <= 0xffff {
                            result.push(value as u16);
                        } else {
                            let value = value - 0x10000;
                            result.push(0xd800 + (value >> 10) as u16);
                            result.push(0xdc00 + (value & 1023) as u16);
                        }
                    } else {
                        result.push(self.hex(4)? as u16);
                    }
                }
                48..=55 => {
                    let mut value = escaped - 48;
                    let max = if escaped <= 51 { 3 } else { 2 };
                    for _ in 1..max {
                        if let Some(unit @ 48..=55) = self.at(0) {
                            value = value * 8 + unit - 48;
                            self.pos += 1;
                        } else {
                            break;
                        }
                    }
                    result.push(value);
                }
                other => result.push(other),
            }
        }
        Err("Unterminated static schema string".into())
    }
    fn identifier(&mut self) -> Result<Vec<u16>, String> {
        let mut value = vec![];
        while let Some(unit) = self.at(0) {
            if unit == 92 {
                self.pos += 1;
                if self.at(0) != Some(117) {
                    return Err("Invalid identifier escape".into());
                }
                self.pos += 1;
                let decoded = if self.at(0) == Some(123) {
                    self.pos += 1;
                    let mut value = 0_u32;
                    let mut count = 0;
                    while let Some(unit) = self.at(0) {
                        if unit == 125 {
                            break;
                        }
                        value = value
                            .checked_mul(16)
                            .and_then(|value| hex(unit).and_then(|digit| value.checked_add(digit)))
                            .ok_or("Invalid identifier escape")?;
                        self.pos += 1;
                        count += 1;
                    }
                    if count == 0 || self.at(0) != Some(125) || value > 0x10ffff {
                        return Err("Invalid identifier escape".into());
                    }
                    self.pos += 1;
                    value
                } else {
                    self.hex(4)?
                };
                if decoded <= 0xffff {
                    value.push(decoded as u16);
                } else {
                    let decoded = decoded - 0x10000;
                    value.push(0xd800 + (decoded >> 10) as u16);
                    value.push(0xdc00 + (decoded & 1023) as u16);
                }
            } else if ident(unit) {
                value.push(unit);
                self.pos += 1;
            } else {
                break;
            }
        }
        Ok(value)
    }
    fn comments(&mut self) -> Result<bool, String> {
        if self.at(0) != Some(47) {
            return Ok(false);
        }
        if self.at(1) == Some(47) {
            self.pos += 2;
            while self
                .at(0)
                .is_some_and(|unit| !matches!(unit, 10 | 13 | 8232 | 8233))
            {
                self.pos += 1;
            }
            return Ok(true);
        }
        if self.at(1) == Some(42) {
            self.pos += 2;
            while self.at(0).is_some() {
                if self.at(0) == Some(42) && self.at(1) == Some(47) {
                    self.pos += 2;
                    return Ok(true);
                }
                self.pos += 1;
            }
            return Err("Unterminated static schema comment".into());
        }
        Ok(false)
    }
    fn regex(&mut self) -> bool {
        let start = self.pos;
        self.pos += 1;
        let mut class = false;
        let mut escaped = false;
        while let Some(unit) = self.at(0) {
            self.pos += 1;
            if matches!(unit, 10 | 13 | 8232 | 8233) {
                break;
            }
            if escaped {
                escaped = false;
                continue;
            }
            if unit == 92 {
                escaped = true;
                continue;
            }
            if unit == 91 {
                class = true;
            } else if unit == 93 {
                class = false;
            } else if unit == 47 && !class {
                while self.at(0).is_some_and(ident) {
                    self.pos += 1;
                }
                return true;
            }
        }
        self.pos = start;
        false
    }
    fn interpolation(&mut self, depth: usize) -> Result<(), String> {
        let mut braces = 1;
        let mut regex_allowed = true;
        while let Some(unit) = self.at(0) {
            if self.comments()? {
                continue;
            }
            match unit {
                34 | 39 | 96 => {
                    self.quoted(unit, depth)?;
                    regex_allowed = false;
                }
                47 if regex_allowed && self.regex() => {
                    regex_allowed = false;
                }
                123 => {
                    braces += 1;
                    if braces > 512 {
                        return Err("Static schema nesting exceeded (512).".into());
                    }
                    self.pos += 1;
                    regex_allowed = true;
                }
                125 => {
                    braces -= 1;
                    self.pos += 1;
                    if braces == 0 {
                        return Ok(());
                    }
                    regex_allowed = false;
                }
                _ => {
                    self.pos += 1;
                    if !space(unit) {
                        regex_allowed = matches!(unit, 40 | 61 | 58 | 44 | 91 | 33 | 63 | 59);
                    }
                }
            }
        }
        Err("Unterminated template interpolation".into())
    }
}
pub fn lex(text: &[u16]) -> Result<(Vec<Token>, Vec<Option<usize>>), String> {
    if text.len() > 16 * 1024 * 1024 {
        return Err("Static schema source budget exceeded (16Mi units).".into());
    }
    let mut lexer = Lexer { text, pos: 0 };
    let mut tokens: Vec<Token> = vec![];
    let mut control_parens = vec![];
    let mut regex_after_control = false;
    let mut curly_blocks = vec![];
    let mut regex_after_block = false;
    while let Some(unit) = lexer.at(0) {
        if space(unit) {
            lexer.pos += 1;
            continue;
        }
        if lexer.comments()? {
            continue;
        }
        if lexer.pos == 0 && unit == 35 && lexer.at(1) == Some(33) {
            while lexer.at(0).is_some_and(|unit| !matches!(unit, 10 | 13)) {
                lexer.pos += 1;
            }
            continue;
        }
        let start = lexer.pos;
        let arrow = tokens.len() >= 2
            && tokens[tokens.len() - 1].symbol(b'>')
            && tokens[tokens.len() - 2].symbol(b'=');
        let regex_allowed = regex_after_control
            || regex_after_block
            || arrow
            || tokens.last().is_none_or(|token| {
                matches!(
                    token.kind,
                    Kind::Symbol(40 | 61 | 58 | 44 | 91 | 123 | 33 | 63 | 59)
                ) || [
                    "return",
                    "throw",
                    "case",
                    "yield",
                    "void",
                    "typeof",
                    "delete",
                    "await",
                    "in",
                    "of",
                    "instanceof",
                    "else",
                    "do",
                    "new",
                ]
                .iter()
                .any(|word| token.is(word))
            });
        let kind = if matches!(unit, 34 | 39 | 96) {
            let (value, dynamic) = lexer.quoted(unit, 0)?;
            if unit == 96 {
                Kind::Template(value, dynamic)
            } else {
                Kind::Quoted(value)
            }
        } else if unit == 47 && regex_allowed && lexer.regex() {
            Kind::Opaque
        } else if matches!(unit, 48..=57)
            || (unit == 46 && lexer.at(1).is_some_and(|unit| matches!(unit, 48..=57)))
        {
            lexer.pos += 1;
            while let Some(next) = lexer.at(0) {
                if ident(next)
                    || next == 46
                    || matches!(next, 43 | 45)
                        && lexer
                            .text
                            .get(lexer.pos - 1)
                            .is_some_and(|unit| matches!(unit, 69 | 101))
                {
                    lexer.pos += 1;
                } else {
                    break;
                }
            }
            Kind::Number(text[start..lexer.pos].to_vec())
        } else if ident(unit) || unit == 92 {
            Kind::Ident(lexer.identifier()?)
        } else {
            lexer.pos += 1;
            Kind::Symbol(unit)
        };
        let closed_block = if matches!(kind, Kind::Symbol(125)) {
            curly_blocks.pop().unwrap_or(false)
        } else {
            false
        };
        if matches!(kind, Kind::Symbol(123)) {
            let block = arrow
                || regex_after_control
                || tokens.last().is_none_or(|token| {
                    matches!(token.kind, Kind::Symbol(41 | 59))
                        || matches!(token.kind, Kind::Ident(_))
                });
            curly_blocks.push(block);
        }
        regex_after_block = closed_block;
        let closed_control = if matches!(kind, Kind::Symbol(41)) {
            control_parens.pop().unwrap_or(false)
        } else {
            false
        };
        if matches!(kind, Kind::Symbol(40)) {
            control_parens.push(tokens.last().is_some_and(|token| {
                ["if", "while", "for", "switch", "with", "catch"]
                    .iter()
                    .any(|word| token.is(word))
            }));
        }
        regex_after_control = closed_control;
        tokens.push(Token {
            kind,
            start,
            end: lexer.pos,
        });
        if tokens.len() > 1_000_000 {
            return Err("Static schema token budget exceeded (1000000).".into());
        }
    }
    let mut mates = vec![None; tokens.len()];
    let mut stack = vec![];
    for (i, token) in tokens.iter().enumerate() {
        if let Kind::Symbol(unit) = token.kind {
            if matches!(unit, 40 | 91 | 123) {
                stack.push((i, unit));
                if stack.len() > 512 {
                    return Err("Static schema nesting exceeded (512).".into());
                }
            } else if matches!(unit, 41 | 93 | 125) {
                let Some((start, open)) = stack.pop() else {
                    return Err("Unbalanced static schema source".into());
                };
                if !matches!((open, unit), (40, 41) | (91, 93) | (123, 125)) {
                    return Err("Unbalanced static schema source".into());
                }
                mates[start] = Some(i);
                mates[i] = Some(start);
            }
        }
    }
    if !stack.is_empty() {
        return Err("Unbalanced static schema source".into());
    }
    Ok((tokens, mates))
}

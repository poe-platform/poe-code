// Declaration metadata follows smol-toml's BSD-3-Clause table algorithm.
// See THIRD_PARTY_NOTICES.md for attribution and license.
use super::Error;
use crate::{temporal::Temporal, value::Value};
use std::collections::HashMap;
#[derive(Clone, Copy, PartialEq)]
enum Declaration {
    Dotted,
    Explicit,
    Array,
    ArrayDotted,
}
#[derive(Clone, Copy)]
enum LookupError {
    Redefined,
    NestingLimit,
}
impl LookupError {
    fn reason(self, inline: bool) -> &'static str {
        match self {
            Self::NestingLimit => "document contains excessively nested structures. aborting.",
            Self::Redefined if inline => "trying to redefine an already defined value",
            Self::Redefined => "trying to redefine an already defined table or value",
        }
    }
}
struct Table {
    entries: Vec<(Vec<u16>, usize)>,
    lookup: HashMap<Vec<u16>, usize>,
}
impl Table {
    fn new() -> Self {
        Self {
            entries: vec![],
            lookup: HashMap::new(),
        }
    }
}
enum Data {
    Pending,
    Table(Table),
    Array(Vec<usize>),
    Value(Value),
}
struct Node {
    data: Data,
    declaration: Declaration,
    defined: bool,
    depth: usize,
}
struct Document {
    nodes: Vec<Option<Node>>,
}
impl Document {
    fn new(depth: usize) -> Self {
        Self {
            nodes: vec![Some(Node {
                data: Data::Table(Table::new()),
                declaration: Declaration::Explicit,
                defined: true,
                depth,
            })],
        }
    }
    fn node(&self, id: usize) -> &Node {
        self.nodes[id].as_ref().unwrap()
    }
    fn node_mut(&mut self, id: usize) -> &mut Node {
        self.nodes[id].as_mut().unwrap()
    }
    fn add(
        &mut self,
        data: Data,
        declaration: Declaration,
        defined: bool,
        depth: usize,
    ) -> Result<usize, LookupError> {
        if depth > 1000 {
            return Err(LookupError::NestingLimit);
        }
        let id = self.nodes.len();
        self.nodes.push(Some(Node {
            data,
            declaration,
            defined,
            depth,
        }));
        Ok(id)
    }
    fn peek(
        &mut self,
        key: &[Vec<u16>],
        mut table: usize,
        kind: Declaration,
    ) -> Result<usize, LookupError> {
        let mut existing = false;
        let mut state = 0;
        for (index, part) in key.iter().enumerate() {
            if index > 0 {
                let node = self.node(state);
                if kind == Declaration::Dotted
                    && matches!(node.declaration, Declaration::Explicit | Declaration::Array)
                {
                    return Err(LookupError::Redefined);
                }
                if !existing {
                    self.node_mut(state).data = Data::Table(Table::new());
                }
                table = state;
                if self.node(state).declaration == Declaration::Array {
                    let Data::Array(items) = &self.node(state).data else {
                        return Err(LookupError::Redefined);
                    };
                    table = *items.last().ok_or(LookupError::Redefined)?;
                }
            }
            let Data::Table(object) = &self.node(table).data else {
                return Err(LookupError::Redefined);
            };
            let found = object.lookup.get(part).copied();
            existing = found.is_some();
            if let Some(id) = found {
                let node = self.node(id);
                if node.declaration == Declaration::Dotted && node.defined {
                    return Err(LookupError::Redefined);
                }
                state = id;
            } else {
                state = self.add(
                    Data::Pending,
                    if index + 1 < key.len() && kind == Declaration::Array {
                        Declaration::ArrayDotted
                    } else {
                        kind
                    },
                    false,
                    self.node(table).depth + 1,
                )?;
                let Data::Table(object) = &mut self.node_mut(table).data else {
                    unreachable!()
                };
                object.lookup.insert(part.clone(), state);
                object.entries.push((part.clone(), state));
            }
        }
        if key.is_empty() {
            return Err(LookupError::Redefined);
        }
        let node = self.node(state);
        if node.declaration != kind
            && !(kind == Declaration::Explicit && node.declaration == Declaration::ArrayDotted)
        {
            return Err(LookupError::Redefined);
        }
        if kind == Declaration::Array {
            if !self.node(state).defined {
                let node = self.node_mut(state);
                node.defined = true;
                node.data = Data::Array(vec![]);
            }
            let entry = self.add(
                Data::Table(Table::new()),
                Declaration::Explicit,
                false,
                self.node(state).depth + 1,
            )?;
            let Data::Array(items) = &mut self.node_mut(state).data else {
                return Err(LookupError::Redefined);
            };
            items.push(entry);
            state = entry;
        }
        if self.node(state).defined {
            return Err(LookupError::Redefined);
        }
        self.node_mut(state).defined = true;
        if kind == Declaration::Explicit {
            if !existing {
                self.node_mut(state).data = Data::Table(Table::new());
            }
        } else if kind == Declaration::Dotted && existing {
            return Err(LookupError::Redefined);
        }
        Ok(state)
    }
    fn take_value(&mut self, root: usize) -> Value {
        // Child ids always follow their parent. Assemble the arena backwards
        // without consuming Rust call-stack space for dotted paths.
        let mut values: Vec<Option<Value>> = (0..self.nodes.len()).map(|_| None).collect();
        for id in (0..self.nodes.len()).rev() {
            let node = self.nodes[id].take().unwrap();
            let value = match node.data {
                Data::Pending => unreachable!(),
                Data::Value(value) => value,
                Data::Array(items) => Value::Array(
                    items
                        .into_iter()
                        .map(|child| values[child].take().unwrap())
                        .collect(),
                ),
                Data::Table(table) => {
                    let mut properties: Vec<_> = table
                        .entries
                        .into_iter()
                        .map(|(key, child)| (key, values[child].take().unwrap()))
                        .collect();
                    properties.sort_by_key(|(key, _)| {
                        crate::jsonc::property_index(key).map_or(u64::MAX, u64::from)
                    });
                    Value::Object(properties)
                }
            };
            values[id] = Some(value);
        }
        values[root].take().unwrap()
    }
}
enum Frame {
    Array { items: Vec<Value>, depth: usize },
    Table { document: Document, entry: usize },
}
struct Cursor<'a> {
    source: &'a [u16],
    pos: usize,
}
impl<'a> Cursor<'a> {
    fn ch(&self) -> Option<u16> {
        self.source.get(self.pos).copied()
    }
    fn err(&self, reason: &str) -> Error {
        Error::new(self.source, self.pos, reason)
    }
    fn skip(&mut self, newlines: bool, comments: bool) -> Result<(), Error> {
        loop {
            match self.ch() {
                Some(32 | 9) => self.pos += 1,
                Some(10) if newlines => self.pos += 1,
                Some(13) if newlines && self.source.get(self.pos + 1) == Some(&10) => self.pos += 2,
                Some(35) if comments => {
                    let comment = self.pos;
                    self.pos += 1;
                    while let Some(ch) = self.ch() {
                        if ch == 10 {
                            break;
                        }
                        if ch == 13 && self.source.get(self.pos + 1) == Some(&10) {
                            self.pos += 1;
                            break;
                        }
                        if (ch < 32 && ch != 9) || ch == 127 {
                            return Err(Error::new(
                                self.source,
                                comment,
                                "control characters are not allowed in comments",
                            ));
                        }
                        self.pos += 1;
                    }
                }
                _ => return Ok(()),
            }
        }
    }
    fn string(&mut self, key: bool) -> Result<Vec<u16>, Error> {
        let quote = self.ch().unwrap();
        let opening = self.pos;
        self.pos += 1;
        let multiline = self.ch() == Some(quote) && self.source.get(self.pos + 1) == Some(&quote);
        if multiline {
            if key {
                return Err(Error::new(
                    self.source,
                    self.pos - 1,
                    "multiline strings are not allowed in keys",
                ));
            }
            self.pos += 2;
            if self.ch() == Some(10) {
                self.pos += 1;
            } else if self.ch() == Some(13) && self.source.get(self.pos + 1) == Some(&10) {
                self.pos += 2;
            }
        }
        let mut out = vec![];
        loop {
            let Some(ch) = self.ch() else {
                return Err(Error::new(self.source, opening, "unfinished string"));
            };
            if ch == quote
                && (!multiline
                    || (self.source.get(self.pos + 1) == Some(&quote)
                        && self.source.get(self.pos + 2) == Some(&quote)))
            {
                if multiline {
                    let mut extras = 0;
                    while extras < 2 && self.source.get(self.pos + 3 + extras) == Some(&quote) {
                        out.push(quote);
                        extras += 1;
                    }
                    self.pos += 3 + extras;
                } else {
                    self.pos += 1;
                }
                return Ok(out);
            }
            if (ch < 32 && ch != 9) || ch == 127 {
                if multiline && ch == 10 {
                    out.push(ch);
                    self.pos += 1;
                    continue;
                }
                if multiline && ch == 13 && self.source.get(self.pos + 1) == Some(&10) {
                    out.extend([13, 10]);
                    self.pos += 2;
                    continue;
                }
                return Err(self.err("control characters are not allowed in strings"));
            }
            self.pos += 1;
            if quote == 39 || ch != 92 {
                out.push(ch);
                continue;
            }
            let slash = self.pos - 1;
            let Some(escape) = self.ch() else {
                return Err(Error::new(self.source, opening, "unfinished string"));
            };
            if matches!(escape, 32 | 9 | 10 | 13) {
                let mut newline = false;
                while let Some(ch) = self.ch() {
                    match ch {
                        32 | 9 => self.pos += 1,
                        10 if multiline => {
                            newline = true;
                            self.pos += 1;
                        }
                        13 if multiline && self.source.get(self.pos + 1) == Some(&10) => {
                            newline = true;
                            self.pos += 2;
                        }
                        _ => break,
                    }
                }
                if !newline {
                    if matches!(self.ch(), Some(0..=31 | 127)) {
                        return Err(self.err("control characters are not allowed in strings"));
                    }
                    return Err(Error::new(
                        self.source,
                        slash,
                        "invalid escape: only line-ending whitespace may be escaped",
                    ));
                }
                continue;
            }
            self.pos += 1;
            match escape {
                98 => out.push(8),
                116 => out.push(9),
                110 => out.push(10),
                102 => out.push(12),
                114 => out.push(13),
                101 => out.push(27),
                34 | 92 => out.push(escape),
                120 | 117 | 85 => {
                    let count = if escape == 120 {
                        2
                    } else if escape == 117 {
                        4
                    } else {
                        8
                    };
                    let mut scalar = 0u32;
                    for _ in 0..count {
                        let digit = match self.ch() {
                            Some(48..=57) => u32::from(self.source[self.pos] - 48),
                            Some(65..=70) => u32::from(self.source[self.pos] - 55),
                            Some(97..=102) => u32::from(self.source[self.pos] - 87),
                            _ => {
                                return Err(self.err("invalid non-hex character in unicode escape"));
                            }
                        };
                        scalar = scalar * 16 + digit;
                        self.pos += 1;
                    }
                    let Some(ch) = char::from_u32(scalar) else {
                        return Err(Error::new(
                            self.source,
                            self.pos - 1,
                            "invalid unicode escape",
                        ));
                    };
                    let mut encoded = [0u16; 2];
                    out.extend_from_slice(ch.encode_utf16(&mut encoded));
                }
                _ => {
                    return Err(Error::new(
                        self.source,
                        self.pos - 1,
                        "unrecognized escape sequence",
                    ));
                }
            }
        }
    }
    fn key(&mut self, end: u16) -> Result<Vec<Vec<u16>>, Error> {
        let start = self.pos;
        if !self.source[start..].contains(&end) {
            return Err(self.err("incomplete key-value: cannot find end of key"));
        }
        let mut parts = vec![];
        loop {
            self.skip(false, false)?;
            let part_start = self.pos;
            let quoted = matches!(self.ch(), Some(34 | 39));
            let part = if quoted {
                self.string(true)?
            } else {
                let begin = self.pos;
                while matches!(self.ch(), Some(48..=57 | 65..=90 | 97..=122 | 45 | 95)) {
                    self.pos += 1;
                }
                if begin == self.pos {
                    return Err(self
                        .err("only letter, numbers, dashes and underscores are allowed in keys"));
                }
                self.source[begin..self.pos].to_vec()
            };
            let string_end = self.pos;
            if quoted && !self.source[self.pos..].contains(&end) {
                return Err(Error::new(
                    self.source,
                    part_start,
                    "incomplete key-value: cannot find end of key",
                ));
            }
            parts.push(part);
            self.skip(false, false)?;
            if self.ch() == Some(46) {
                self.pos += 1;
                continue;
            }
            if self.ch() != Some(end) {
                return Err(Error::new(
                    self.source,
                    if quoted { string_end } else { part_start },
                    if quoted && matches!(self.ch(), Some(10 | 13)) {
                        "newlines are not allowed in keys"
                    } else if quoted {
                        "found extra tokens after the string part"
                    } else {
                        "only letter, numbers, dashes and underscores are allowed in keys"
                    },
                ));
            }
            self.pos += 1;
            self.skip(false, false)?;
            return Ok(parts);
        }
    }
    fn inline_entry(&mut self, document: &mut Document) -> Result<usize, Error> {
        let start = self.pos;
        let key = self.key(61)?;
        document
            .peek(&key, 0, Declaration::Dotted)
            .map_err(|error| Error::new(self.source, start, error.reason(true)))
    }
    fn primitive_value(&mut self, closing: Option<u16>) -> Result<Value, Error> {
        let begin = self.pos;
        while let Some(ch) = self.ch() {
            if ch == 35
                || (closing.is_none() && matches!(ch, 10 | 13))
                || (closing.is_some() && (ch == 44 || Some(ch) == closing))
            {
                break;
            }
            self.pos += 1;
        }
        if closing.is_some() && self.ch().is_none() {
            return Err(Error::new(
                self.source,
                begin,
                "cannot find end of structure",
            ));
        }
        let mut end = self.pos;
        while end > begin && crate::jsonc::trim_space(self.source[end - 1]) {
            end -= 1;
        }
        if end == begin {
            return Err(Error::new(
                self.source,
                begin,
                "incomplete declaration: value expected",
            ));
        }
        primitive(&self.source[begin..end]).map_err(|reason| Error::new(self.source, begin, reason))
    }
    fn value(&mut self, depth: usize, closing: Option<u16>) -> Result<Value, Error> {
        let mut frames = vec![];
        let mut request = (depth, closing);
        loop {
            let (depth, closing) = request;
            if depth >= 1000 {
                return Err(self.err("document contains excessively nested structures. aborting."));
            }
            let mut value = match self.ch() {
                Some(34 | 39) => Value::String(self.string(false)?),
                Some(116 | 102) => {
                    let begin = self.pos;
                    let literal: &[u16] = if self.ch() == Some(116) {
                        &[116, 114, 117, 101]
                    } else {
                        &[102, 97, 108, 115, 101]
                    };
                    if !self.source[self.pos..].starts_with(literal) {
                        return Err(Error::new(self.source, begin, "invalid value"));
                    }
                    self.pos += literal.len();
                    Value::Bool(literal.len() == 4)
                }
                Some(91) => {
                    self.pos += 1;
                    if self.pos == self.source.len() {
                        return Err(self.err("unfinished array encountered"));
                    }
                    self.skip(true, true)?;
                    if self.ch() == Some(93) {
                        self.pos += 1;
                        Value::Array(vec![])
                    } else {
                        if self.ch().is_none() {
                            return Err(self.err("cannot find end of structure"));
                        }
                        if self.ch() == Some(44) {
                            return Err(self.err("incomplete declaration: value expected"));
                        }
                        frames.push(Frame::Array {
                            items: vec![],
                            depth,
                        });
                        request = (depth + 1, Some(93));
                        continue;
                    }
                }
                Some(123) => {
                    self.pos += 1;
                    if self.pos == self.source.len() {
                        return Err(self.err("unfinished table encountered"));
                    }
                    self.skip(true, true)?;
                    if self.ch() == Some(125) {
                        self.pos += 1;
                        Value::Object(vec![])
                    } else {
                        let mut document = Document::new(depth + 1);
                        let entry = self.inline_entry(&mut document)?;
                        request = (document.node(entry).depth - 1, Some(125));
                        frames.push(Frame::Table { document, entry });
                        continue;
                    }
                }
                _ => self.primitive_value(closing)?,
            };
            loop {
                match frames.pop() {
                    None => return Ok(value),
                    Some(Frame::Array { mut items, depth }) => {
                        items.push(value);
                        self.skip(true, true)?;
                        if self.ch() == Some(44) {
                            self.pos += 1;
                            if self.pos == self.source.len() {
                                return Err(self.err("unfinished array encountered"));
                            }
                            self.skip(true, true)?;
                        } else if self.ch() != Some(93) {
                            return Err(self.err("expected comma or end of structure"));
                        }
                        if self.ch() == Some(93) {
                            self.pos += 1;
                            value = Value::Array(items);
                            continue;
                        }
                        if self.ch().is_none() {
                            return Err(self.err("cannot find end of structure"));
                        }
                        if self.ch() == Some(44) {
                            return Err(self.err("incomplete declaration: value expected"));
                        }
                        request = (depth + 1, Some(93));
                        frames.push(Frame::Array { items, depth });
                        break;
                    }
                    Some(Frame::Table {
                        mut document,
                        entry,
                    }) => {
                        document.node_mut(entry).data = Data::Value(value);
                        self.skip(true, true)?;
                        if self.ch() == Some(44) {
                            self.pos += 1;
                            if self.pos == self.source.len() {
                                return Err(self.err("unfinished table encountered"));
                            }
                            self.skip(true, true)?;
                        } else if self.ch() != Some(125) {
                            return Err(self.err("expected comma or end of structure"));
                        }
                        if self.ch() == Some(125) {
                            self.pos += 1;
                            value = document.take_value(0);
                            continue;
                        }
                        let entry = self.inline_entry(&mut document)?;
                        request = (document.node(entry).depth - 1, Some(125));
                        frames.push(Frame::Table { document, entry });
                        break;
                    }
                }
            }
        }
    }
}
fn digits(text: &[u16], radix: u16) -> bool {
    if text.is_empty() {
        return false;
    }
    let mut expect = true;
    for ch in text {
        if *ch == 95 {
            if expect {
                return false;
            }
            expect = true;
        } else {
            let digit = match ch {
                48..=57 => *ch - 48,
                65..=70 => *ch - 55,
                97..=102 => *ch - 87,
                _ => return false,
            };
            if digit >= radix {
                return false;
            }
            expect = false;
        }
    }
    !expect
}
fn primitive(text: &[u16]) -> Result<Value, &'static str> {
    match text {
        [116, 114, 117, 101] => return Ok(Value::Bool(true)),
        [102, 97, 108, 115, 101] => return Ok(Value::Bool(false)),
        [45, 105, 110, 102] => return Ok(Value::Number(f64::NEG_INFINITY)),
        [105, 110, 102] | [43, 105, 110, 102] => return Ok(Value::Number(f64::INFINITY)),
        [110, 97, 110] | [43, 110, 97, 110] | [45, 110, 97, 110] => {
            return Ok(Value::Number(f64::NAN));
        }
        [45, 48] => return Ok(Value::Number(0.0)),
        _ => {}
    }
    let unsigned = if matches!(text.first(), Some(43 | 45)) {
        &text[1..]
    } else {
        text
    };
    let (integer, radix, body) = if text.starts_with(&[48, 120]) {
        (digits(&text[2..], 16), 16, &text[2..])
    } else if text.starts_with(&[48, 111]) {
        (digits(&text[2..], 10), 8, &text[2..])
    } else if text.starts_with(&[48, 98]) {
        (digits(&text[2..], 10), 2, &text[2..])
    } else {
        (digits(unsigned, 10), 10, unsigned)
    };
    let exponent = unsigned.iter().position(|ch| matches!(ch, 69 | 101));
    let mantissa = exponent.map_or(unsigned, |i| &unsigned[..i]);
    let decimal = mantissa.iter().position(|ch| *ch == 46);
    let float_mantissa = decimal.map_or_else(
        || digits(mantissa, 10),
        |i| digits(&mantissa[..i], 10) && digits(&mantissa[i + 1..], 10),
    );
    let float_exponent = exponent.is_none_or(|i| {
        let exponent = &unsigned[i + 1..];
        let exponent = if matches!(exponent.first(), Some(43 | 45)) {
            &exponent[1..]
        } else {
            exponent
        };
        digits(exponent, 10)
    });
    if integer || (float_mantissa && float_exponent) {
        if unsigned.len() > 1 && unsigned[0] == 48 && matches!(unsigned[1], 48..=57 | 95) {
            return Err("leading zeroes are not allowed");
        }
        let clean: String = text
            .iter()
            .filter(|ch| **ch != 95)
            .map(|ch| char::from_u32(u32::from(*ch)).unwrap())
            .collect();
        let number = if radix == 10 {
            clean.parse::<f64>().map_err(|_| "invalid number")?
        } else {
            let mut value = 0f64;
            for ch in body.iter().filter(|ch| **ch != 95) {
                let digit = match ch {
                    48..=57 => *ch - 48,
                    65..=70 => *ch - 55,
                    97..=102 => *ch - 87,
                    _ => return Err("invalid number"),
                };
                if digit >= radix {
                    return Err("invalid number");
                }
                value = value * f64::from(radix) + f64::from(digit);
            }
            value
        };
        if integer && (!number.is_finite() || number.abs() > 9007199254740991.0) {
            return Err("integer value cannot be represented losslessly");
        }
        return Ok(Value::Number(number));
    }
    Temporal::parse(text)
        .map(Value::Date)
        .ok_or("invalid value")
}
pub fn parse(source: &[u16]) -> Result<Value, Error> {
    if source.iter().all(|ch| crate::jsonc::trim_space(*ch)) {
        return Ok(Value::Object(vec![]));
    }
    let mut cursor = Cursor { source, pos: 0 };
    let mut document = Document::new(0);
    let mut table = 0;
    cursor.skip(true, true)?;
    while cursor.pos < source.len() {
        if cursor.ch() == Some(91) {
            cursor.pos += 1;
            let array = cursor.ch() == Some(91);
            if array {
                cursor.pos += 1;
            }
            let start = cursor.pos;
            let key = cursor.key(93)?;
            if array {
                if cursor.ch() != Some(93) || source.get(cursor.pos.saturating_sub(1)) != Some(&93)
                {
                    return Err(Error::new(
                        source,
                        cursor.pos.saturating_sub(1),
                        "expected end of table declaration",
                    ));
                }
                cursor.pos += 1;
            }
            table = document
                .peek(
                    &key,
                    0,
                    if array {
                        Declaration::Array
                    } else {
                        Declaration::Explicit
                    },
                )
                .map_err(|error| Error::new(source, start, error.reason(false)))?;
        } else {
            let start = cursor.pos;
            let key = cursor.key(61)?;
            let entry = document
                .peek(&key, table, Declaration::Dotted)
                .map_err(|error| Error::new(source, start, error.reason(false)))?;
            let value = cursor.value(document.node(entry).depth - 1, None)?;
            document.node_mut(entry).data = Data::Value(value);
        }
        cursor.skip(false, true)?;
        if !matches!(cursor.ch(), None | Some(10 | 13)) {
            return Err(cursor.err("each key-value declaration must be followed by an end-of-line"));
        }
        cursor.skip(true, true)?;
    }
    Ok(document.take_value(0))
}

//! Lua byte-pattern matching, adapted from the repository's LuaPattern and
//! Fengari/Lua matcher. See ../LICENSE.LUA for attribution and license.
use crate::{Error, Result, Value};

#[derive(Clone, Copy)]
struct Capture {
    start: isize,
    length: isize,
}
pub(crate) struct Iteration {
    pub last: isize,
    pub anchor: bool,
}
pub(crate) struct Matcher<'a> {
    source: &'a [u8],
    pattern: &'a [u8],
    steps: &'a mut usize,
    captures: Vec<Capture>,
    depth: usize,
}
impl<'a> Matcher<'a> {
    pub(crate) fn new(source: &'a [u8], pattern: &'a [u8], steps: &'a mut usize) -> Self {
        Self {
            source,
            pattern,
            steps,
            captures: Vec::new(),
            depth: 0,
        }
    }
    fn tick(&mut self) -> Result<()> {
        *self.steps = self
            .steps
            .checked_sub(1)
            .ok_or_else(|| Error::new("Lua instruction limit exceeded"))?;
        Ok(())
    }
    fn source_byte(&self, position: isize) -> Option<u8> {
        usize::try_from(position)
            .ok()
            .and_then(|p| self.source.get(p).copied())
    }
    fn class_end(&mut self, mut position: usize) -> Result<usize> {
        let byte = self.pattern.get(position);
        position += 1;
        match byte {
            Some(b'%') => {
                if position == self.pattern.len() {
                    return Err(Error::new("Malformed pattern (ends with '%')"));
                }
                Ok(position + 1)
            }
            Some(b'[') => {
                if self.pattern.get(position) == Some(&b'^') {
                    position += 1;
                }
                loop {
                    self.tick()?;
                    if position == self.pattern.len() {
                        return Err(Error::new("Malformed pattern (missing ']')"));
                    }
                    let byte = self.pattern[position];
                    position += 1;
                    if byte == b'%' && position < self.pattern.len() {
                        position += 1;
                    }
                    if self.pattern.get(position) == Some(&b']') {
                        return Ok(position + 1);
                    }
                }
            }
            _ => Ok(position),
        }
    }
    fn bracket(&mut self, value: Option<u8>, mut position: usize, end: usize) -> Result<bool> {
        let positive = self.pattern.get(position + 1) != Some(&b'^');
        if !positive {
            position += 1;
        }
        position += 1;
        while position < end {
            self.tick()?;
            let byte = self.pattern[position];
            if byte == b'%' {
                position += 1;
                if character_class(value, self.pattern[position]) {
                    return Ok(positive);
                }
            } else if self.pattern.get(position + 1) == Some(&b'-') && position + 2 < end {
                if value.is_some_and(|v| byte <= v && v <= self.pattern[position + 2]) {
                    return Ok(positive);
                }
                position += 2;
            } else if Some(byte) == value {
                return Ok(positive);
            }
            position += 1;
        }
        Ok(!positive)
    }
    fn single(&mut self, source: isize, pattern: usize, end: usize) -> Result<bool> {
        self.tick()?;
        if source >= self.source.len() as isize {
            return Ok(false);
        }
        let value = self.source_byte(source);
        Ok(match self.pattern[pattern] {
            b'.' => true,
            b'%' => character_class(value, self.pattern[pattern + 1]),
            b'[' => return self.bracket(value, pattern, end - 1),
            byte => Some(byte) == value,
        })
    }
    fn balanced(&mut self, mut source: isize, pattern: usize) -> Result<Option<isize>> {
        if pattern + 1 >= self.pattern.len() {
            return Err(Error::new("Malformed balanced pattern"));
        }
        let open = self.pattern[pattern];
        let close = self.pattern[pattern + 1];
        if self.source_byte(source) != Some(open) {
            return Ok(None);
        }
        let mut count = 1;
        source += 1;
        while source < self.source.len() as isize {
            self.tick()?;
            if self.source_byte(source) == Some(close) {
                count -= 1;
                if count == 0 {
                    return Ok(Some(source + 1));
                }
            } else if self.source_byte(source) == Some(open) {
                count += 1;
            }
            source += 1;
        }
        Ok(None)
    }
    fn equal(&mut self, first: isize, second: isize, count: isize) -> Result<bool> {
        // Preserve the existing JS engine's subarray behavior for position captures.
        let normalize = |position: isize| {
            if position < 0 {
                (self.source.len() as isize + position).max(0) as usize
            } else {
                (position as usize).min(self.source.len())
            }
        };
        let a = normalize(first);
        let b = normalize(second);
        let an = normalize(first + count).saturating_sub(a);
        let bn = normalize(second + count).saturating_sub(b);
        if an != bn {
            return Ok(false);
        }
        for offset in 0..an {
            self.tick()?;
            if self.source[a + offset] != self.source[b + offset] {
                return Ok(false);
            }
        }
        Ok(true)
    }
    fn match_pattern(&mut self, mut source: isize, mut pattern: usize) -> Result<Option<isize>> {
        if self.depth == 200 {
            return Err(Error::new("Pattern too complex"));
        }
        self.depth += 1;
        let result = (|| {
            while pattern != self.pattern.len() {
                self.tick()?;
                let byte = self.pattern[pattern];
                if byte == b'(' {
                    if self.captures.len() == 32 {
                        return Err(Error::new("Too many captures"));
                    }
                    let position = self.pattern.get(pattern + 1) == Some(&b')');
                    self.captures.push(Capture {
                        start: source,
                        length: if position { -2 } else { -1 },
                    });
                    let result =
                        self.match_pattern(source, pattern + if position { 2 } else { 1 })?;
                    if result.is_none() {
                        self.captures.pop();
                    }
                    return Ok(result);
                }
                if byte == b')' {
                    let index = self
                        .captures
                        .iter()
                        .rposition(|c| c.length == -1)
                        .ok_or_else(|| Error::new("Invalid pattern capture"))?;
                    self.captures[index].length = source - self.captures[index].start;
                    let result = self.match_pattern(source, pattern + 1)?;
                    if result.is_none() {
                        self.captures[index].length = -1;
                    }
                    return Ok(result);
                }
                if byte == b'$' && pattern + 1 == self.pattern.len() {
                    return Ok((source == self.source.len() as isize).then_some(source));
                }
                if byte == b'%' {
                    let escaped = self.pattern.get(pattern + 1).copied();
                    if escaped == Some(b'b') {
                        let Some(next) = self.balanced(source, pattern + 2)? else {
                            return Ok(None);
                        };
                        source = next;
                        pattern += 4;
                        continue;
                    }
                    if escaped == Some(b'f') {
                        pattern += 2;
                        if self.pattern.get(pattern) != Some(&b'[') {
                            return Err(Error::new("Missing '[' after '%f' in pattern"));
                        }
                        let end = self.class_end(pattern)?;
                        let previous = if source == 0 {
                            Some(0)
                        } else {
                            self.source_byte(source - 1)
                        };
                        let current = if source == self.source.len() as isize {
                            Some(0)
                        } else {
                            self.source_byte(source)
                        };
                        if self.bracket(previous, pattern, end - 1)?
                            || !self.bracket(current, pattern, end - 1)?
                        {
                            return Ok(None);
                        }
                        pattern = end;
                        continue;
                    }
                    if let Some(digit) = escaped.filter(u8::is_ascii_digit) {
                        let capture = digit
                            .checked_sub(b'1')
                            .and_then(|index| self.captures.get(index as usize))
                            .copied()
                            .filter(|c| c.length != -1)
                            .ok_or_else(|| Error::new("Invalid capture index"))?;
                        if (self.source.len() as isize - source) < capture.length
                            || !self.equal(capture.start, source, capture.length)?
                        {
                            return Ok(None);
                        }
                        source += capture.length;
                        pattern += 2;
                        continue;
                    }
                }
                let end = self.class_end(pattern)?;
                let suffix = self.pattern.get(end).copied();
                if !self.single(source, pattern, end)? {
                    if matches!(suffix, Some(b'*' | b'?' | b'-')) {
                        pattern = end + 1;
                        continue;
                    }
                    return Ok(None);
                }
                match suffix {
                    Some(b'?') => {
                        if let Some(result) = self.match_pattern(source + 1, end + 1)? {
                            return Ok(Some(result));
                        }
                        pattern = end + 1;
                    }
                    Some(b'*' | b'+') => {
                        if suffix == Some(b'+') {
                            source += 1;
                        }
                        let mut count = 0;
                        while self.single(source + count, pattern, end)? {
                            count += 1;
                        }
                        while count >= 0 {
                            if let Some(result) = self.match_pattern(source + count, end + 1)? {
                                // Existing LuaPattern skips a zero-position greedy result.
                                if result != 0 {
                                    return Ok(Some(result));
                                }
                            }
                            count -= 1;
                        }
                        return Ok(None);
                    }
                    Some(b'-') => loop {
                        if let Some(result) = self.match_pattern(source, end + 1)? {
                            return Ok(Some(result));
                        }
                        if !self.single(source, pattern, end)? {
                            return Ok(None);
                        }
                        source += 1;
                    },
                    _ => {
                        source += 1;
                        pattern = end;
                    }
                }
            }
            Ok(Some(source))
        })();
        self.depth -= 1;
        result
    }
    fn slice(&self, start: isize, length: isize) -> Value {
        let start = start.max(0) as usize;
        let end = start
            .saturating_add(length.max(0) as usize)
            .min(self.source.len());
        Value::String(self.source.get(start..end).unwrap_or_default().to_vec())
    }
    fn results(&self, start: isize, end: isize, find: bool, whole: bool) -> Result<Vec<Value>> {
        let mut result = Vec::new();
        if find {
            result.extend([Value::Number((start + 1) as f64), Value::Number(end as f64)]);
        }
        if self.captures.is_empty() && (!find || whole) {
            result.push(self.slice(start, end - start));
        }
        for capture in &self.captures {
            if capture.length == -1 {
                return Err(Error::new("Unfinished capture"));
            }
            result.push(if capture.length == -2 {
                Value::Number((capture.start + 1) as f64)
            } else {
                self.slice(capture.start, capture.length)
            });
        }
        Ok(result)
    }
    pub(crate) fn search(
        &mut self,
        start: isize,
        find: bool,
        plain: bool,
        iterator: Option<Iteration>,
    ) -> Result<Vec<Value>> {
        if start > self.source.len() as isize {
            return Ok(vec![Value::Nil]);
        }
        let plain = find
            && iterator.is_none()
            && (plain || !self.pattern.iter().any(|b| b"^$*+?.([%-".contains(b)));
        if plain {
            if self.pattern.is_empty() {
                return Ok(vec![
                    Value::Number((start + 1) as f64),
                    Value::Number(start as f64),
                ]);
            }
            for position in
                start.max(0) as usize..=self.source.len().saturating_sub(self.pattern.len())
            {
                self.tick()?;
                if self.source.get(position..position + self.pattern.len()) == Some(self.pattern) {
                    return Ok(vec![
                        Value::Number((position + 1) as f64),
                        Value::Number((position + self.pattern.len()) as f64),
                    ]);
                }
            }
            return Ok(vec![Value::Nil]);
        }
        let anchor =
            iterator.as_ref().is_none_or(|i| i.anchor) && self.pattern.first() == Some(&b'^');
        for position in start..=self.source.len() as isize {
            self.captures.clear();
            if let Some(end) = self.match_pattern(position, usize::from(anchor))?
                && iterator.as_ref().is_none_or(|i| i.last != end)
            {
                return self.results(position, end, find, iterator.is_some());
            }
            if anchor {
                break;
            }
        }
        Ok(vec![Value::Nil])
    }
}
fn character_class(value: Option<u8>, kind: u8) -> bool {
    let lower = kind.to_ascii_lowercase();
    let result = match lower {
        b'a' => value.is_some_and(|v| v.is_ascii_alphabetic()),
        b'c' => value.is_some_and(|v| v < 32 || v == 127),
        b'd' => value.is_some_and(|v| v.is_ascii_digit()),
        b'g' => value.is_some_and(|v| v.is_ascii_graphic()),
        b'l' => value.is_some_and(|v| v.is_ascii_lowercase()),
        b'p' => value.is_some_and(|v| v.is_ascii_punctuation()),
        b's' => value.is_some_and(|v| v == 32 || (9..=13).contains(&v)),
        b'u' => value.is_some_and(|v| v.is_ascii_uppercase()),
        b'w' => value.is_some_and(|v| v.is_ascii_alphanumeric()),
        b'x' => value.is_some_and(|v| v.is_ascii_hexdigit()),
        b'z' => value == Some(0),
        _ => return value == Some(kind),
    };
    if lower == kind { result } else { !result }
}

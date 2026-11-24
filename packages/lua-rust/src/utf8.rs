use crate::{Error, Result, Runtime, Value, numbers};

fn continuation(bytes: &[u8], position: usize) -> bool {
    bytes.get(position).is_some_and(|byte| byte & 0xc0 == 0x80)
}
fn decode(bytes: &[u8], position: usize) -> Option<(u32, usize)> {
    let first = *bytes.get(position)?;
    if first < 128 {
        return Some((first as u32, position + 1));
    }
    let count = match first {
        0xc2..=0xdf => 1,
        0xe0..=0xef => 2,
        0xf0..=0xf4 => 3,
        _ => return None,
    };
    let mut code = (first & ((1 << (6 - count)) - 1)) as u32;
    for offset in 1..=count {
        if !continuation(bytes, position + offset) {
            return None;
        }
        code = code * 64 + (bytes[position + offset] & 63) as u32;
    }
    // Lua's existing UTF-8 library accepts surrogate code points.
    (code >= [0, 128, 2048, 65536][count] && code <= 0x10ffff)
        .then_some((code, position + count + 1))
}
pub(crate) fn encode(code: u32, bytes: &mut Vec<u8>) {
    if code < 128 {
        bytes.push(code as u8);
    } else if code < 2048 {
        bytes.extend([(0xc0 | (code >> 6)) as u8, (0x80 | (code & 63)) as u8]);
    } else if code < 65536 {
        bytes.extend([
            (0xe0 | (code >> 12)) as u8,
            (0x80 | ((code >> 6) & 63)) as u8,
            (0x80 | (code & 63)) as u8,
        ]);
    } else {
        bytes.extend([
            (0xf0 | (code >> 18)) as u8,
            (0x80 | ((code >> 12) & 63)) as u8,
            (0x80 | ((code >> 6) & 63)) as u8,
            (0x80 | (code & 63)) as u8,
        ]);
    }
}
impl Runtime {
    pub(crate) fn utf8(&mut self, name: &str, args: Vec<Value>) -> Result<Vec<Value>> {
        let argument = |index: usize, default: Option<isize>| -> Result<isize> {
            let value = args.get(index).unwrap_or(&Value::Nil);
            if *value == Value::Nil
                && let Some(default) = default
            {
                return Ok(default);
            }
            let number = value
                .number()
                .map_err(|_| Error::unlocated("Expected Lua number"))?;
            numbers::integral(number)
                .map(|value| value as isize)
                .map_err(|error| Error::unlocated(error.message))
        };
        if name == "utf8.char" {
            let mut bytes = Vec::new();
            for index in 0..args.len() {
                self.tick()?;
                let code = argument(index, None)?;
                if !(0..=0x10ffff).contains(&code) {
                    return Err(Error::unlocated("Value out of range"));
                }
                let code = code as u32;
                encode(code, &mut bytes);
            }
            return Ok(vec![Value::String(bytes)]);
        }
        let text = match args.first() {
            Some(Value::String(bytes)) => bytes.clone(),
            Some(value @ (Value::Integer(_) | Value::Number(_))) => value.bytes(),
            _ => {
                return Err(Error::unlocated(
                    "Expected Lua string or number for concatenation",
                ));
            }
        };
        let relative = |position: isize| {
            if position < 0 {
                (text.len() as isize + position + 1).max(0)
            } else {
                position
            }
        };
        if name == "utf8.codes" {
            return Ok(vec![
                Value::Native("utf8.next"),
                Value::String(text),
                Value::Integer(0),
            ]);
        }
        if name == "utf8.next" {
            let previous = argument(1, None).unwrap_or(0).saturating_sub(1);
            let mut position = previous.max(0) as usize;
            if previous >= 0 && position < text.len() {
                position += 1;
                while continuation(&text, position) {
                    self.tick()?;
                    position += 1;
                }
            }
            if position >= text.len() {
                return Ok(Vec::new());
            }
            let (code, next) =
                decode(&text, position).ok_or_else(|| Error::unlocated("Invalid UTF-8 code"))?;
            if continuation(&text, next) {
                return Err(Error::unlocated("Invalid UTF-8 code"));
            }
            return Ok(vec![
                Value::Integer((position + 1) as i32),
                Value::Integer(code as i32),
            ]);
        }
        if name == "utf8.offset" {
            let mut count = argument(1, None)?;
            let start = relative(argument(
                2,
                Some(if count >= 0 {
                    1
                } else {
                    text.len() as isize + 1
                }),
            )?) - 1;
            if start < 0 || start > text.len() as isize {
                return Err(Error::unlocated("Position out of range"));
            }
            let mut position = start as usize;
            if count == 0 {
                while position > 0 && continuation(&text, position) {
                    self.tick()?;
                    position -= 1;
                }
            } else {
                if continuation(&text, position) {
                    return Err(Error::unlocated("Initial position is a continuation byte"));
                }
                if count < 0 {
                    while count < 0 && position > 0 {
                        self.tick()?;
                        position -= 1;
                        while position > 0 && continuation(&text, position) {
                            self.tick()?;
                            position -= 1;
                        }
                        count += 1;
                    }
                } else {
                    count -= 1;
                    while count > 0 && position < text.len() {
                        self.tick()?;
                        position += 1;
                        while continuation(&text, position) {
                            self.tick()?;
                            position += 1;
                        }
                        count -= 1;
                    }
                }
            }
            return Ok(vec![if count == 0 {
                Value::Integer((position + 1) as i32)
            } else {
                Value::Nil
            }]);
        }
        let start = relative(argument(1, Some(1))?) - 1;
        let end = relative(argument(
            2,
            Some(if name == "utf8.len" { -1 } else { start + 1 }),
        )?);
        if start < 0 || name == "utf8.len" && start > text.len() as isize {
            return Err(Error::unlocated("Initial position out of string"));
        }
        if end > text.len() as isize {
            return Err(Error::unlocated("Final position out of string"));
        }
        let mut position = start as usize;
        let mut count = 0;
        let mut points = Vec::new();
        while (position as isize) < end {
            self.tick()?;
            let Some((code, next)) = decode(&text, position) else {
                return if name == "utf8.len" {
                    Ok(vec![Value::Nil, Value::Integer((position + 1) as i32)])
                } else {
                    Err(Error::unlocated("Invalid UTF-8 code"))
                };
            };
            if name == "utf8.codepoint" {
                points.push(Value::Integer(code as i32));
            }
            count += 1;
            position = next;
        }
        Ok(if name == "utf8.len" {
            vec![Value::Integer(count)]
        } else {
            points
        })
    }
}

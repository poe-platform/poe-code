/*! Binary formats adapted from Fengari/Lua.
MIT License

Copyright © 2017-2019 Benoit Giannangeli
Copyright © 2017-2025 Daurnimator
Copyright © 1994–2017 Lua.org, PUC-Rio.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
use crate::{Error, Result, Value, numbers};

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Int,
    Uint,
    Float,
    Char,
    String,
    Zero,
    Pad,
    Align,
    None,
}
struct Format<'a> {
    bytes: &'a [u8],
    position: usize,
    little: bool,
    alignment: usize,
}
impl Format<'_> {
    fn number(&mut self, fallback: usize, limited: bool) -> Result<usize> {
        let mut value = fallback;
        if self
            .bytes
            .get(self.position)
            .is_some_and(u8::is_ascii_digit)
        {
            value = 0;
            loop {
                value = value * 10 + (self.bytes[self.position] - b'0') as usize;
                self.position += 1;
                if value > 214748363
                    || !self
                        .bytes
                        .get(self.position)
                        .is_some_and(u8::is_ascii_digit)
                {
                    break;
                }
            }
        }
        if limited && !(1..=16).contains(&value) {
            return Err(Error::unlocated("Integral size out of limits [1,16]"));
        }
        Ok(value)
    }
    fn option(&mut self) -> Result<(Kind, usize)> {
        let byte = self.bytes.get(self.position).copied();
        self.position += 1;
        Ok(match byte {
            Some(b'b') => (Kind::Int, 1),
            Some(b'B') => (Kind::Uint, 1),
            Some(b'h') => (Kind::Int, 2),
            Some(b'H') => (Kind::Uint, 2),
            Some(b'l' | b'j') => (Kind::Int, 4),
            Some(b'L' | b'J' | b'T') => (Kind::Uint, 4),
            Some(b'f') => (Kind::Float, 4),
            Some(b'd' | b'n') => (Kind::Float, 8),
            Some(b'i') => (Kind::Int, self.number(4, true)?),
            Some(b'I') => (Kind::Uint, self.number(4, true)?),
            Some(b's') => (Kind::String, self.number(4, true)?),
            Some(b'c') => {
                if !self
                    .bytes
                    .get(self.position)
                    .is_some_and(u8::is_ascii_digit)
                {
                    return Err(Error::unlocated("Missing size for format option 'c'"));
                }
                (Kind::Char, self.number(0, false)?)
            }
            Some(b'z') => (Kind::Zero, 0),
            Some(b'x') => (Kind::Pad, 1),
            Some(b'X') => (Kind::Align, 0),
            Some(b' ') => (Kind::None, 0),
            Some(b'<' | b'=') => {
                self.little = true;
                (Kind::None, 0)
            }
            Some(b'>') => {
                self.little = false;
                (Kind::None, 0)
            }
            Some(b'!') => {
                self.alignment = self.number(8, true)?;
                (Kind::None, 0)
            }
            _ => return Err(Error::unlocated("Invalid binary format option")),
        })
    }
    fn next(&mut self, total: i64) -> Result<(Kind, usize, usize)> {
        let (kind, size) = self.option()?;
        let mut align = size;
        if kind == Kind::Align {
            if matches!(self.bytes.get(self.position), None | Some(0)) {
                return Err(Error::unlocated("Invalid option after 'X'"));
            }
            let (next, size) = self.option()?;
            align = size;
            if next == Kind::Char || align == 0 {
                return Err(Error::unlocated("Invalid option after 'X'"));
            }
        }
        if align <= 1 || kind == Kind::Char {
            return Ok((kind, size, 0));
        }
        align = align.min(self.alignment);
        if !align.is_power_of_two() {
            return Err(Error::unlocated("Format alignment is not a power of two"));
        }
        let padding = (align.wrapping_sub(total as usize & (align - 1))) & (align - 1);
        Ok((kind, size, padding))
    }
}
fn string(value: &Value) -> Result<Vec<u8>> {
    match value {
        Value::String(_) | Value::Integer(_) | Value::Number(_) => Ok(value.bytes()),
        _ => Err(Error::unlocated(
            "Expected Lua string or number for concatenation",
        )),
    }
}
fn number(value: &Value) -> Result<f64> {
    value
        .number()
        .map_err(|_| Error::unlocated("Expected Lua number"))
}
fn integer(value: &Value) -> Result<i32> {
    numbers::integral(number(value)?).map_err(|error| Error::unlocated(error.message))
}
fn pack_integer(output: &mut Vec<u8>, mut value: i32, size: usize, little: bool) {
    let start = output.len();
    output.resize(start + size, 0);
    for i in 0..size {
        output[start + if little { i } else { size - 1 - i }] = value as u8;
        // Preserve the existing engine's sign extension even for wide unsigned fields.
        value >>= 8;
    }
}
fn unpack_integer(bytes: &[u8], little: bool, signed: bool) -> Result<i32> {
    let at = |i| bytes[if little { i } else { bytes.len() - 1 - i }];
    let limit = bytes.len().min(4);
    let mut value = 0i32;
    for i in (0..limit).rev() {
        value = (value << 8) | at(i) as i32;
    }
    if bytes.len() < 4 && signed {
        let mask = 1 << (bytes.len() * 8 - 1);
        value = (value ^ mask) - mask;
    }
    if bytes.len() > 4 {
        let mask = if signed && value < 0 { 255 } else { 0 };
        for i in limit..bytes.len() {
            if at(i) != mask {
                return Err(Error::unlocated("Integer does not fit into Lua integer"));
            }
        }
    }
    Ok(value)
}
fn slice(data: &[u8], start: i64, end: i64) -> Vec<u8> {
    let normalize = |p: i64| {
        if p < 0 {
            (data.len() as i64 + p).max(0) as usize
        } else {
            (p as usize).min(data.len())
        }
    };
    let start = normalize(start);
    data[start..normalize(end).max(start)].to_vec()
}
pub(crate) fn invoke(name: &str, args: &[Value]) -> Result<Vec<Value>> {
    let arg = |i| args.get(i).unwrap_or(&Value::Nil);
    let bytes = string(arg(0))?;
    let mut format = Format {
        bytes: &bytes,
        position: 0,
        little: true,
        alignment: 1,
    };
    if name == "string.packsize" {
        let mut total = 0i64;
        while format.position < bytes.len() {
            let (kind, size, padding) = format.next(total)?;
            total += (size + padding) as i64;
            if total > i32::MAX as i64 {
                return Err(Error::unlocated("Format result too large"));
            }
            if matches!(kind, Kind::String | Kind::Zero) {
                return Err(Error::unlocated("Variable-length format"));
            }
        }
        return Ok(vec![Value::Integer(total as i32)]);
    }
    if name == "string.pack" {
        let mut output = Vec::new();
        let mut index = 1;
        while format.position < bytes.len() {
            let (kind, size, padding) = format.next(output.len() as i64)?;
            output.resize(output.len() + padding, 0);
            if kind == Kind::Pad {
                output.push(0);
                continue;
            }
            if matches!(kind, Kind::None | Kind::Align) {
                continue;
            }
            let value = arg(index);
            index += 1;
            match kind {
                Kind::Int | Kind::Uint => {
                    let value = integer(value)?;
                    if size < 4
                        && if kind == Kind::Int {
                            value < -(1 << (size * 8 - 1)) || value >= 1 << (size * 8 - 1)
                        } else {
                            value as u32 >= 1 << (size * 8)
                        }
                    {
                        return Err(Error::unlocated("Integer overflow"));
                    }
                    pack_integer(&mut output, value, size, format.little);
                }
                Kind::Float => {
                    let value = number(value)?;
                    let mut bytes = if size == 4 {
                        (value as f32).to_le_bytes().to_vec()
                    } else {
                        value.to_le_bytes().to_vec()
                    };
                    if !format.little {
                        bytes.reverse();
                    }
                    output.extend(bytes);
                }
                Kind::Char | Kind::String | Kind::Zero => {
                    let value = string(value)?;
                    if kind == Kind::Char && value.len() > size {
                        return Err(Error::unlocated("String longer than given size"));
                    }
                    if kind == Kind::String {
                        if size < 4 && value.len() >= 1 << (size * 8) {
                            return Err(Error::unlocated(
                                "String length does not fit in given size",
                            ));
                        }
                        pack_integer(&mut output, value.len() as i32, size, format.little);
                    }
                    if kind == Kind::Zero && value.contains(&0) {
                        return Err(Error::unlocated("String contains zeros"));
                    }
                    output.extend_from_slice(&value);
                    if kind == Kind::Char {
                        output.resize(output.len() + size - value.len(), 0);
                    }
                    if kind == Kind::Zero {
                        output.push(0);
                    }
                }
                _ => unreachable!(),
            }
        }
        return Ok(vec![Value::String(output)]);
    }
    let data = string(arg(1))?;
    let relative = if *arg(2) == Value::Nil {
        1
    } else {
        integer(arg(2))? as i64
    };
    let mut position = if relative >= 0 {
        relative
    } else {
        (data.len() as i64 + relative + 1).max(0)
    } - 1;
    if position < 0 || position > data.len() as i64 {
        return Err(Error::unlocated("Initial position out of string"));
    }
    let mut output = Vec::new();
    while format.position < bytes.len() {
        let (kind, size, padding) = format.next(position)?;
        if position < 0 || position + (padding + size) as i64 > data.len() as i64 {
            return Err(Error::unlocated("Data string too short"));
        }
        position += padding as i64;
        let field = &data[position as usize..position as usize + size];
        match kind {
            Kind::Int | Kind::Uint => output.push(Value::Integer(unpack_integer(
                field,
                format.little,
                kind == Kind::Int,
            )?)),
            Kind::Float => {
                let value = if size == 4 {
                    let bytes = field.try_into().unwrap();
                    (if format.little {
                        f32::from_le_bytes(bytes)
                    } else {
                        f32::from_be_bytes(bytes)
                    }) as f64
                } else {
                    let bytes = field.try_into().unwrap();
                    if format.little {
                        f64::from_le_bytes(bytes)
                    } else {
                        f64::from_be_bytes(bytes)
                    }
                };
                output.push(Value::Number(value));
            }
            Kind::Char => output.push(Value::String(field.to_vec())),
            Kind::String => {
                let count = unpack_integer(field, format.little, false)? as i64;
                if position + size as i64 + count > data.len() as i64 {
                    return Err(Error::unlocated("Data string too short"));
                }
                output.push(Value::String(slice(
                    &data,
                    position + size as i64,
                    position + size as i64 + count,
                )));
                position += count;
            }
            Kind::Zero => {
                // Preserve the existing unterminated-string end calculation.
                let end = data[position as usize..]
                    .iter()
                    .position(|b| *b == 0)
                    .map(|n| position + n as i64)
                    .unwrap_or(data.len() as i64 - position);
                output.push(Value::String(slice(&data, position, end)));
                position = end + 1;
            }
            _ => (),
        }
        position += size as i64;
    }
    output.push(Value::Integer((position + 1) as i32));
    Ok(output)
}

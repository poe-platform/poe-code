/*! String formatting and encoding adapted from Fengari/Lua.
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
/*! Numeric field rendering adapted from sprintf-js.
Copyright (c) 2007-present, Alexandru Mărășteanu <hello@alexei.ro>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
* Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
* Neither the name of this software nor the names of its contributors may be
  used to endorse or promote products derived from this software without
  specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
use crate::{Error, Result, Runtime, Value, numbers};
use mcp_protocol_rust::numbers::format as decimal;

struct Field {
    plus: bool,
    zero: bool,
    left: bool,
    width: usize,
    precision: Option<usize>,
    kind: u8,
}
impl Field {
    fn parse(spec: &[u8]) -> Result<Self> {
        let mut position = 1;
        let plus = spec.get(position) == Some(&b'+');
        position += usize::from(plus);
        let zero = spec.get(position) == Some(&b'0');
        position += usize::from(zero);
        let left = spec.get(position) == Some(&b'-');
        position += usize::from(left);
        let mut width = 0;
        while let Some(byte) = spec.get(position).filter(|b| b.is_ascii_digit()) {
            width = width * 10 + (byte - b'0') as usize;
            position += 1;
        }
        let mut precision = None;
        if spec.get(position) == Some(&b'.') {
            position += 1;
            if !spec.get(position).is_some_and(u8::is_ascii_digit) {
                return Err(Error::new("Invalid format placeholder"));
            }
            let mut digits = 0;
            while let Some(byte) = spec.get(position).filter(|b| b.is_ascii_digit()) {
                digits = digits * 10 + (byte - b'0') as usize;
                position += 1;
            }
            precision = Some(digits);
        }
        let kind = spec.get(position).copied().unwrap_or(0);
        if position + 1 != spec.len() || !b"diefgouxXs".contains(&kind) {
            return Err(Error::new("Invalid format placeholder"));
        }
        Ok(Self {
            plus,
            zero,
            left,
            width,
            precision,
            kind,
        })
    }
    fn pad(&self, mut text: Vec<u16>, sign: Option<u16>) -> Vec<u8> {
        let count = self
            .width
            .saturating_sub(text.len() + usize::from(sign.is_some()));
        let padding = std::iter::repeat_n(if self.zero { b'0' as u16 } else { b' ' as u16 }, count);
        let mut output = Vec::new();
        if self.left {
            output.extend(sign);
            output.append(&mut text);
            output.extend(padding);
        } else if self.zero {
            output.extend(sign);
            output.extend(padding);
            output.append(&mut text);
        } else {
            output.extend(padding);
            output.extend(sign);
            output.append(&mut text);
        }
        encode(&output)
    }
}

impl Runtime {
    pub(crate) fn format(&mut self, name: &str, args: Vec<Value>) -> Result<Vec<Value>> {
        let Some(Value::String(spec)) = args.first() else {
            return Err(Error::new("Expected format string"));
        };
        if name == "string.format_token" {
            let start = args[1].number()? as usize;
            let mut end = start;
            while end < spec.len() && spec[end] != b'%' {
                self.tick()?;
                end += 1;
            }
            if end > start {
                return Ok(vec![
                    Value::Integer(end as i32),
                    Value::String(spec[start..end].to_vec()),
                ]);
            }
            if spec.get(start + 1) == Some(&b'%') {
                return Ok(vec![
                    Value::Integer((start + 2) as i32),
                    Value::String(b"%".to_vec()),
                ]);
            }
            let mut position = start + 1;
            while spec.get(position).is_some_and(|b| b"-+ #0".contains(b)) {
                position += 1;
            }
            if position - start > 5 {
                return Err(Error::new("Invalid format (repeated flags)"));
            }
            for _ in 0..2 {
                if spec.get(position).is_some_and(u8::is_ascii_digit) {
                    position += 1;
                }
            }
            if spec.get(position) == Some(&b'.') {
                position += 1;
                for _ in 0..2 {
                    if spec.get(position).is_some_and(u8::is_ascii_digit) {
                        position += 1;
                    }
                }
            }
            if spec.get(position).is_some_and(u8::is_ascii_digit) {
                return Err(Error::new("Format width or precision too long"));
            }
            let kind = *spec
                .get(position)
                .ok_or_else(|| Error::new("Invalid format option"))?;
            return Ok(vec![
                Value::Integer((position + 1) as i32),
                Value::String(spec[start..=position].to_vec()),
                Value::Integer(kind as i32),
            ]);
        }
        let value = args.get(1).unwrap_or(&Value::Nil);
        let kind = spec.last().copied().unwrap_or(0);
        let output = match kind {
            b'q' => match value {
                Value::String(bytes) => {
                    let mut output = vec![b'"'];
                    for (position, &byte) in bytes.iter().enumerate() {
                        self.tick()?;
                        if matches!(byte, b'"' | b'\\' | b'\n') {
                            output.extend([b'\\', byte]);
                        } else if byte < 32 || byte == 127 {
                            output.push(b'\\');
                            let digits = if bytes.get(position + 1).is_some_and(u8::is_ascii_digit)
                            {
                                format!("{byte:03}")
                            } else {
                                byte.to_string()
                            };
                            output.extend(digits.bytes());
                        } else {
                            output.push(byte);
                        }
                    }
                    output.push(b'"');
                    output
                }
                Value::Number(number) => hex(*number).into_bytes(),
                Value::Integer(i32::MIN) => b"0x80000000".to_vec(),
                Value::Integer(_) | Value::Nil | Value::Bool(_) => value.bytes(),
                _ => return Err(Error::new("Value has no literal form")),
            },
            b's' => {
                let Value::String(bytes) = value else {
                    return Err(Error::new("Expected format string"));
                };
                if spec == b"%s" {
                    return Ok(vec![value.clone()]);
                }
                let precision = spec.contains(&b'.');
                let mut text = Vec::new();
                let mut position = 0;
                while position < bytes.len() {
                    self.tick()?;
                    let first = bytes[position];
                    position += 1;
                    if first == 0 {
                        return Err(Error::new("String contains zeros"));
                    }
                    if !precision && bytes.len() >= 100 {
                        continue;
                    }
                    let mut code = first as u32;
                    if first >= 128 {
                        let count = match first {
                            0xc2..=0xdf => 1,
                            0xe0..=0xef => 2,
                            0xf0..=0xf4 => 3,
                            _ => return Err(Error::new("Invalid UTF-8 string")),
                        };
                        code &= (1 << (6 - count)) - 1;
                        for _ in 0..count {
                            let next = bytes
                                .get(position)
                                .filter(|b| *b & 0xc0 == 0x80)
                                .ok_or_else(|| Error::new("Invalid UTF-8 string"))?;
                            position += 1;
                            code = (code << 6) + (next & 63) as u32;
                        }
                    }
                    if text.len() < 99 {
                        if code <= 0xffff {
                            text.push(code as u16);
                        } else {
                            text.push((((code - 0x10000) >> 10) + 0xd800) as u16);
                            if text.len() < 99 {
                                text.push((((code - 0x10000) % 0x400) + 0xdc00) as u16);
                            }
                        }
                    }
                }
                if !precision && bytes.len() >= 100 {
                    return Ok(vec![value.clone()]);
                }
                let field = Field::parse(spec)?;
                if let Some(precision) = field.precision {
                    text.truncate(precision);
                }
                field.pad(text, None)
            }
            b'c' => vec![(numbers::integral(value.number()?)? & 255) as u8],
            b'a' | b'A' => {
                if spec.len() != 2 {
                    return Err(Error::new(
                        "Modifiers for hexadecimal float format not implemented",
                    ));
                }
                let mut text = hex(value.number()?);
                if kind == b'A' {
                    text.make_ascii_uppercase();
                }
                text.into_bytes()
            }
            _ => {
                if !b"diouxXefgEG".contains(&kind) {
                    return Err(Error::new("Invalid format option"));
                }
                let number = value.number()?;
                let integer = if b"diouxX".contains(&kind) {
                    numbers::integral(number)?
                } else {
                    0
                };
                let field = Field::parse(spec)?;
                let mut text = match field.kind {
                    b'd' | b'i' => integer.to_string(),
                    b'u' => (integer as u32).to_string(),
                    b'o' => format!("{:o}", integer as u32),
                    b'x' => format!("{:x}", integer as u32),
                    b'X' => format!("{:X}", integer as u32),
                    b'e' => match field.precision {
                        Some(p) => rounded(number, p, true),
                        None => exponential(number),
                    },
                    b'f' => match field.precision {
                        Some(p) if number.abs() < 1e21 => rounded(number, p, false),
                        _ => decimal(number),
                    },
                    b'g' => match field.precision {
                        Some(0) if number.is_finite() => {
                            return Err(Error::new("Invalid numeric format"));
                        }
                        Some(p) if number.is_finite() => {
                            decimal(rounded(number, p - 1, true).parse().unwrap())
                        }
                        _ => decimal(number),
                    },
                    _ => unreachable!(),
                };
                let sign = if b"diefg".contains(&kind)
                    && (number.is_nan() || number < 0.0 || field.plus)
                {
                    if text.starts_with(['+', '-']) {
                        text.remove(0);
                    }
                    Some(if number >= 0.0 {
                        b'+' as u16
                    } else {
                        b'-' as u16
                    })
                } else {
                    None
                };
                field.pad(text.encode_utf16().collect(), sign)
            }
        };
        Ok(vec![Value::String(output)])
    }
}

fn hex(number: f64) -> String {
    if number.is_nan() {
        return "nan".into();
    }
    let sign = if number.is_sign_negative() { "-" } else { "" };
    if number.is_infinite() {
        return format!("{sign}inf");
    }
    if number == 0.0 {
        return format!("{sign}0x0p+0");
    }
    let bits = number.to_bits();
    let biased = ((bits >> 52) & 0x7ff) as i32;
    let mut fraction = bits & ((1u64 << 52) - 1);
    let exponent = if biased == 0 {
        let shift = fraction.leading_zeros() - 11;
        fraction = (fraction << shift) & ((1u64 << 52) - 1);
        -1022 - shift as i32
    } else {
        biased - 1023
    };
    let digits = format!("{fraction:013x}");
    let digits = digits.trim_end_matches('0');
    format!(
        "{sign}0x1{}{digits}p{exponent:+}",
        if digits.is_empty() { "" } else { "." }
    )
}

fn exponential(number: f64) -> String {
    if !number.is_finite() {
        return decimal(number);
    }
    let text = decimal(number.abs());
    let (mantissa, exponent) = text.split_once('e').unwrap_or((&text, "0"));
    let mut exponent: i32 = exponent.parse().unwrap();
    let point = mantissa.find('.').unwrap_or(mantissa.len());
    let mut digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let leading = digits.bytes().take_while(|b| *b == b'0').count();
    if leading == digits.len() {
        return "0e+0".into();
    }
    exponent += point as i32 - leading as i32 - 1;
    digits.drain(..leading);
    while digits.ends_with('0') {
        digits.pop();
    }
    if digits.len() > 1 {
        digits.insert(1, '.');
    }
    format!(
        "{}{digits}e{exponent:+}",
        if number < 0.0 { "-" } else { "" }
    )
}

// JavaScript rounds decimal midpoint ties upward; Rust rounds them to even.
// A binary64 is exactly halfway at decimal scale s when its odd mantissa
// has binary exponent s-1 and (for positive s) is divisible by 5^s.
fn rounded(number: f64, precision: usize, scientific: bool) -> String {
    if !number.is_finite() {
        return decimal(number);
    }
    let absolute = number.abs();
    let extra = if scientific {
        format!("{:.*e}", precision + 1, absolute)
    } else {
        format!("{:.*}", precision + 1, absolute)
    };
    let (mantissa, exponent) = extra.split_once('e').unwrap_or((&extra, "0"));
    let mut exponent: i32 = exponent.parse().unwrap();
    let scale = if scientific {
        exponent - precision as i32
    } else {
        -(precision as i32)
    };
    let bits = absolute.to_bits();
    let biased = ((bits >> 52) & 0x7ff) as i32;
    let mut binary_mantissa = bits & ((1u64 << 52) - 1);
    let mut binary_scale = if biased == 0 {
        -1074
    } else {
        binary_mantissa |= 1 << 52;
        biased - 1075
    };
    binary_scale += binary_mantissa.trailing_zeros() as i32;
    binary_mantissa >>= binary_mantissa.trailing_zeros().min(63);
    let mut tie = absolute != 0.0 && binary_scale == scale - 1;
    for _ in 0..scale.max(0) {
        if !tie {
            break;
        }
        tie = binary_mantissa.is_multiple_of(5);
        binary_mantissa /= 5;
    }
    let mut output = if tie {
        let mut digits: Vec<u8> = mantissa.bytes().filter(|b| *b != b'.').collect();
        digits.pop();
        let mut carry = true;
        for digit in digits.iter_mut().rev() {
            if *digit == b'9' {
                *digit = b'0';
            } else {
                *digit += 1;
                carry = false;
                break;
            }
        }
        if carry {
            digits.insert(0, b'1');
            if scientific {
                exponent += 1;
                digits.pop();
            }
        }
        if scientific {
            if precision > 0 {
                digits.insert(1, b'.');
            }
        } else if precision > 0 {
            digits.insert(digits.len() - precision, b'.');
        }
        let mut text = String::from_utf8(digits).unwrap();
        if scientific {
            text.push_str(&format!("e{exponent:+}"));
        }
        text
    } else if scientific {
        let text = format!("{absolute:.precision$e}");
        let (mantissa, exponent) = text.split_once('e').unwrap();
        format!("{mantissa}e{:+}", exponent.parse::<i32>().unwrap())
    } else {
        format!("{absolute:.precision$}")
    };
    if number < 0.0 {
        output.insert(0, '-');
    }
    output
}

fn encode(text: &[u16]) -> Vec<u8> {
    let mut output = Vec::new();
    let mut position = 0;
    while position < text.len() {
        let mut code = text[position] as u32;
        position += 1;
        if (0xd800..=0xdbff).contains(&code)
            && let Some(&next) = text
                .get(position)
                .filter(|n| (0xdc00..=0xdfff).contains(*n))
        {
            code = (code - 0xd800) * 0x400 + next as u32 + 0x2400;
            position += 1;
        }
        if code <= 0x7f {
            output.push(code as u8);
        } else if code <= 0x7ff {
            output.extend([(0xc0 | (code >> 6)) as u8, (0x80 | (code & 63)) as u8]);
        } else if code <= 0xffff {
            output.extend([
                (0xe0 | (code >> 12)) as u8,
                (0x80 | ((code >> 6) & 63)) as u8,
                (0x80 | (code & 63)) as u8,
            ]);
        } else {
            output.extend([
                (0xf0 | (code >> 18)) as u8,
                (0x80 | ((code >> 12) & 63)) as u8,
                (0x80 | ((code >> 6) & 63)) as u8,
                (0x80 | (code & 63)) as u8,
            ]);
        }
    }
    output
}

use crate::{Error, Result, Value};

pub(crate) fn parse(bytes: &[u8]) -> Option<Value> {
    let space = |byte: &u8| *byte == b' ' || (9..=13).contains(byte);
    // Lua accepts ASCII space and controls 9–13, including vertical tab.
    let start = bytes.iter().position(|b| !space(b))?;
    let end = bytes.iter().rposition(|b| !space(b))? + 1;
    let mut text = &bytes[start..end];
    let negative = text.first() == Some(&b'-');
    if matches!(text.first(), Some(b'+' | b'-')) {
        text = &text[1..];
    }
    let hex = text.starts_with(b"0x") || text.starts_with(b"0X");
    if hex {
        text = &text[2..];
    }
    let mut position = 0;
    let mut digits = 0;
    let mut fraction = 0;
    let mut significant = 0usize;
    let mut dot = false;
    let mut integer = 0i32;
    let mut float = 0.0;
    while let Some(&byte) = text.get(position) {
        if byte == b'.' && !dot {
            dot = true;
            position += 1;
            continue;
        }
        let Some(n) = (byte as char).to_digit(if hex { 16 } else { 10 }) else {
            break;
        };
        digits += 1;
        fraction += usize::from(dot);
        if hex {
            integer = integer.wrapping_mul(16).wrapping_add(n as i32);
            if n != 0 || significant > 0 {
                significant += 1;
                if significant <= 30 {
                    float = float * 16.0 + n as f64;
                }
            }
        }
        position += 1;
    }
    if digits == 0 {
        return None;
    }
    let mut exponent = 0.0f64;
    let has_exponent = text.get(position).is_some_and(|b| {
        if hex {
            matches!(b, b'p' | b'P')
        } else {
            matches!(b, b'e' | b'E')
        }
    });
    if has_exponent {
        position += 1;
        let negative = text.get(position) == Some(&b'-');
        if matches!(text.get(position), Some(b'+' | b'-')) {
            position += 1;
        }
        let start = position;
        while let Some(&byte) = text.get(position).filter(|b| b.is_ascii_digit()) {
            exponent = (exponent * 10.0 + (byte - b'0') as f64).min(9007199254740991.0);
            position += 1;
        }
        if start == position {
            return None;
        }
        if negative {
            exponent = -exponent;
        }
    }
    if position != text.len() {
        return None;
    }
    if hex {
        if !dot && !has_exponent {
            return Some(Value::Integer(if negative {
                integer.wrapping_neg()
            } else {
                integer
            }));
        }
        let scale = exponent + 4.0 * (significant.saturating_sub(30) as f64 - fraction as f64);
        if negative {
            float = -float;
        }
        // Fengari scales in up to three stages; preserve its intermediate rounding.
        let steps = (scale.abs() / 1023.0).ceil().min(3.0) as i32;
        for i in 0..steps {
            float *= 2.0f64.powf(((scale + i as f64) / steps as f64).floor());
        }
        Some(Value::Number(float))
    } else {
        let text = std::str::from_utf8(&bytes[start..end]).ok()?;
        if !dot
            && !has_exponent
            && let Ok(integer) = text.parse::<i32>()
        {
            return Some(Value::Integer(integer));
        }
        text.parse().ok().map(Value::Number)
    }
}

pub(crate) fn integral(number: f64) -> Result<i32> {
    if number == number as i32 as f64 {
        Ok(number as i32)
    } else {
        Err(Error::new("Number has no integer representation"))
    }
}

pub(crate) fn tagged(number: f64) -> Value {
    match integral(number) {
        Ok(integer) => Value::Integer(integer),
        Err(_) => Value::Number(number),
    }
}

pub(crate) fn arithmetic(op: &str, left: &Value, right: &Value) -> Result<Value> {
    let a = left.number()?;
    let b = right.number()?;
    // Numeric strings coerce to floats in the existing evaluator.
    if matches!(op, "&" | "|" | "~" | "<<" | ">>") {
        let a = integral(a)?;
        let b = integral(b)?;
        return Ok(Value::Integer(match op {
            "&" => a & b,
            "|" => a | b,
            "~" => a ^ b,
            _ => {
                let shift = if op == "<<" { b as i64 } else { -(b as i64) };
                if shift.unsigned_abs() >= 32 {
                    0
                } else if shift < 0 {
                    ((a as u32) >> -shift) as i32
                } else {
                    a.wrapping_shl(shift as u32)
                }
            }
        }));
    }
    if let (Value::Integer(a), Value::Integer(b)) = (left, right) {
        let value = match op {
            "+" => Some(a.wrapping_add(*b)),
            "-" => Some(a.wrapping_sub(*b)),
            "*" => Some(a.wrapping_mul(*b)),
            "//" | "%" => {
                if *b == 0 {
                    return Err(Error::new(if op == "//" {
                        "Attempt to divide by zero"
                    } else {
                        "Attempt to perform n%0"
                    }));
                }
                let (a, b) = (*a as i64, *b as i64);
                let mut remainder = a % b;
                if remainder != 0 && (remainder < 0) != (b < 0) {
                    remainder += b;
                }
                Some(if op == "%" {
                    remainder as i32
                } else {
                    ((a - remainder) / b) as i32
                })
            }
            _ => None,
        };
        if let Some(value) = value {
            return Ok(Value::Integer(value));
        }
    }
    Ok(Value::Number(match op {
        "+" => a + b,
        "-" => a - b,
        "*" => a * b,
        "/" => a / b,
        "//" => (a / b).floor(),
        "%" => {
            let remainder = a % b;
            if remainder != 0.0 && (remainder < 0.0) != (b < 0.0) {
                remainder + b
            } else {
                remainder
            }
        }
        "^" => a.powf(b),
        _ => return Err(Error::new("unknown operator")),
    }))
}

pub(crate) fn text(number: f64) -> String {
    let mut rounded = number;
    if number.is_finite() && number != 0.0 {
        let scientific = format!("{:.13e}", number.abs());
        let (digits, exponent) = scientific.split_once('e').unwrap();
        let coefficient: u64 = digits
            .chars()
            .filter(|c| *c != '.')
            .collect::<String>()
            .parse()
            .unwrap();
        let scale = exponent.parse::<i32>().unwrap() - 13;
        // Rust rounds exact ties to even. JavaScript toPrecision rounds them up.
        let bits = number.abs().to_bits();
        let mut mantissa = bits & ((1u64 << 52) - 1);
        let biased = ((bits >> 52) & 0x7ff) as i32;
        let mut binary_scale = if biased == 0 {
            -1074
        } else {
            mantissa |= 1 << 52;
            biased - 1075
        };
        binary_scale += mantissa.trailing_zeros() as i32;
        mantissa >>= mantissa.trailing_zeros();
        let mut midpoint = coefficient * 2 + 1;
        let mut tie = binary_scale == scale - 1;
        for _ in 0..scale.abs() {
            if !tie {
                break;
            }
            if scale < 0 {
                tie = midpoint.is_multiple_of(5);
                midpoint /= 5;
            } else if let Some(product) = midpoint.checked_mul(5) {
                midpoint = product;
            } else {
                tie = false;
            }
        }
        rounded = if tie && midpoint == mantissa {
            format!("{}e{scale}", coefficient + 1)
                .parse::<f64>()
                .unwrap()
        } else {
            scientific.parse::<f64>().unwrap()
        }
        .copysign(number);
    }
    let mut text = mcp_protocol_rust::numbers::format(rounded);
    if text.bytes().all(|b| b == b'-' || b.is_ascii_digit()) {
        text.push_str(".0");
    }
    text
}

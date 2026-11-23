// Number-base conversions and bit operations adapted from IronCalc
// engineering/{number_basis,bit_operations}.rs and math_and_trigonometry/mathematical.rs, f93662006b8fb1c401dc870bbda26c5d60ac6037
// (MIT, LICENSE.IronCalc). Strict digits and negative output padding follow
// Univer engineering conversions, 4767b3b309467c283bbd52b725536ca73861e0fc
// (Apache-2.0, LICENSE.Univer). Fixed buffers bound conversion memory on Wasm.
use super::strings::string as text;
use super::{Value, lookup::number};
use std::borrow::Cow;

pub(super) fn arguments(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "ROMAN" => (1, 2),
        "ARABIC" => (1, 1),
        "BASE" => (2, 3),
        "DECIMAL" | "BITAND" | "BITOR" | "BITXOR" | "BITLSHIFT" | "BITRSHIFT" => (2, 2),
        "BIN2DEC" | "OCT2DEC" | "HEX2DEC" => (1, 1),
        "BIN2HEX" | "BIN2OCT" | "DEC2BIN" | "DEC2HEX" | "DEC2OCT" | "HEX2BIN" | "HEX2OCT"
        | "OCT2BIN" | "OCT2HEX" => (1, 2),
        _ => return None,
    })
}

fn numeric(value: &Value, date1904: bool, booleans: bool) -> Result<f64, &'static str> {
    let value = match value {
        Value::Error(e) | Value::LiteralError(e) => return Err(e),
        Value::Bool(_) if !booleans => return Err("#VALUE!"),
        Value::Text(text) | Value::UninternedText(text) => number::parse(text, date1904),
        _ => value.numeric(),
    }
    .ok_or("#VALUE!")?;
    if value.is_finite() {
        Ok(value)
    } else {
        Err("#NUM!")
    }
}

fn encode(
    mut value: u64,
    radix: u32,
    minimum: usize,
    zero: bool,
    work: &mut usize,
) -> Option<Value> {
    let mut buffer = [b'0'; 255];
    let mut start = buffer.len();
    if value == 0 && zero {
        start -= 1;
    }
    while value != 0 {
        start -= 1;
        buffer[start] =
            b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"[(value % u64::from(radix)) as usize];
        value /= u64::from(radix);
    }
    start = start.min(buffer.len() - minimum);
    *work = work.checked_sub(buffer.len() - start)?;
    Some(Value::Text(
        std::str::from_utf8(&buffer[start..]).ok()?.to_owned(),
    ))
}

pub(super) fn calculate(
    name: &str,
    args: &[&Value],
    date1904: bool,
    minimum_omitted: bool,
    work: &mut usize,
) -> Option<Value> {
    // Coercion errors are cell results; exhausted resource budgets return None.
    macro_rules! number {
        ($value:expr, $booleans:expr) => {
            match numeric($value, date1904, $booleans) {
                Ok(n) => n,
                Err(e) => return Some(Value::Error(e)),
            }
        };
    }
    for arg in args {
        if let Value::Error(e) | Value::LiteralError(e) = arg {
            return Some(Value::Error(e));
        }
    }
    if name == "ROMAN" {
        let value = number!(args[0], true).floor();
        let form = match args.get(1) {
            None | Some(Value::Bool(true)) => 0.,
            Some(Value::Bool(false)) => 4.,
            Some(value) => number!(value, true).floor(),
        };
        if !(0. ..=3999.).contains(&value) || !(0. ..=4.).contains(&form) {
            return Some(Value::Error("#VALUE!"));
        }
        return roman(value as u32, form as u8, work);
    }
    if name == "ARABIC" {
        return arabic(args[0], work);
    }
    if name.starts_with("BIT") {
        for arg in args {
            if let Value::Text(text) | Value::UninternedText(text) = arg
                && (text.trim().eq_ignore_ascii_case("true")
                    || text.trim().eq_ignore_ascii_case("false"))
            {
                return Some(Value::Error("#VALUE!"));
            }
        }
        let first = number!(args[0], true);
        let second = number!(args[1], true);
        let maximum = (1u64 << 48) - 1;
        if first.fract() != 0. || !(0. ..=maximum as f64).contains(&first) {
            return Some(Value::Error("#NUM!"));
        }
        let first = first as u64;
        let result = if matches!(name, "BITLSHIFT" | "BITRSHIFT") {
            if second.abs() > 53. {
                return Some(Value::Error("#NUM!"));
            }
            let shift = second.trunc() as i64 * if name == "BITLSHIFT" { 1 } else { -1 };
            if shift > 0 {
                // Check the 48-bit ceiling before shifting, so overflowing a
                // machine integer cannot wrap into a seemingly valid result.
                if first > maximum >> shift {
                    return Some(Value::Error("#NUM!"));
                }
                first << shift
            } else {
                first >> -shift
            }
        } else {
            if second.fract() != 0. || !(0. ..=maximum as f64).contains(&second) {
                return Some(Value::Error("#NUM!"));
            }
            let second = second as u64;
            match name {
                "BITAND" => first & second,
                "BITOR" => first | second,
                _ => first ^ second,
            }
        };
        return Some(Value::Number(result as f64));
    }
    if name == "BASE" {
        let value = number!(args[0], true);
        let radix = number!(args[1], true).trunc();
        let minimum = if args.len() == 3 {
            number!(args[2], true)
        } else {
            0.
        };
        if !(0. ..9_007_199_254_740_992.).contains(&value)
            || !(2. ..=36.).contains(&radix)
            || minimum < 0.
            || minimum.trunc() > 255.
        {
            return Some(Value::Error("#NUM!"));
        }
        return encode(
            value as u64,
            radix as u32,
            minimum as usize,
            minimum_omitted,
            work,
        );
    }
    if name == "DECIMAL" {
        let radix = number!(args[1], true).trunc();
        if !(2. ..=36.).contains(&radix) {
            return Some(Value::Error("#NUM!"));
        }
        if matches!(args[0], Value::Bool(_)) {
            return Some(Value::Error("#NUM!"));
        }
        let text = text(args[0]);
        if text.chars().take(256).count() > 255 {
            return Some(Value::Error("#VALUE!"));
        }
        if text.is_empty() {
            return Some(Value::Number(0.));
        }
        let digits = text.trim_start_matches(' ');
        if digits.is_empty() {
            return Some(Value::Error("#NUM!"));
        }
        *work = work.checked_sub(text.len())?;
        let mut value = 0.;
        for byte in digits.bytes() {
            let digit = match byte {
                b'0'..=b'9' => byte - b'0',
                b'A'..=b'Z' => byte - b'A' + 10,
                b'a'..=b'z' => byte - b'a' + 10,
                _ => return Some(Value::Error("#NUM!")),
            };
            if f64::from(digit) >= radix {
                return Some(Value::Error("#NUM!"));
            }
            value = value * radix + f64::from(digit);
        }
        return Some(Value::number(value));
    }
    let (source, target) = name.split_once('2')?;
    let radix = |kind| match kind {
        "BIN" => 2u32,
        "OCT" => 8,
        _ => 16,
    };
    let value = if source == "DEC" {
        number!(args[0], false).trunc()
    } else {
        if matches!(args[0], Value::Bool(_)) {
            return Some(Value::Error("#VALUE!"));
        }
        let source = radix(source);
        let text = if matches!(args[0], Value::Blank | Value::Empty | Value::Omitted) {
            Cow::Borrowed("0")
        } else {
            text(args[0])
        };
        if text.is_empty() || text.len() > 10 {
            return Some(Value::Error("#NUM!"));
        }
        let mut value = 0i64;
        for byte in text.bytes() {
            let digit = match byte {
                b'0'..=b'9' => byte - b'0',
                b'A'..=b'F' => byte - b'A' + 10,
                b'a'..=b'f' => byte - b'a' + 10,
                _ => return Some(Value::Error("#NUM!")),
            };
            if u32::from(digit) >= source {
                return Some(Value::Error("#NUM!"));
            }
            value = value * i64::from(source) + i64::from(digit);
        }
        let modulus = i64::from(source).pow(10);
        if value >= modulus / 2 {
            value -= modulus;
        }
        value as f64
    };
    if target == "DEC" {
        return Some(Value::Number(value));
    }
    let radix = radix(target);
    let modulus = i64::from(radix).pow(10);
    let minimum = if args.len() == 2 {
        number!(args[1], false).trunc()
    } else {
        0.
    };
    if value < -(modulus / 2) as f64
        || value >= (modulus / 2) as f64
        || !(0. ..=10.).contains(&minimum)
    {
        return Some(Value::Error("#NUM!"));
    }
    let value = value as i64;
    if value < 0 {
        return encode((modulus + value) as u64, radix, 10, true, work);
    }
    // Positive values must fit the explicitly requested width; a missing width
    // uses only the necessary digits. Negative values always use ten digits.
    if args.len() == 2 && value as u64 >= u64::from(radix).pow(minimum as u32)
        || args.len() == 2 && minimum == 0.
    {
        return Some(Value::Error("#NUM!"));
    }
    encode(value as u64, radix, minimum as usize, true, work)
}

// Roman forms adapt IronCalc math_and_trigonometry/arabic_roman.rs (f936620,
// MIT). Permissive decoding and argument/array semantics follow Univer
// math/{roman,arabic} (4767b3b, Apache-2.0). See the bundled licenses above.
fn roman(mut number: u32, form: u8, work: &mut usize) -> Option<Value> {
    // Each additional form admits more subtractive pairs. Descending greedy
    // conversion implements the same substitutions without temporary strings.
    const DIGITS: &[(u32, &str, u8)] = &[
        (1000, "M", 0),
        (999, "IM", 4),
        (995, "VM", 3),
        (990, "XM", 2),
        (950, "LM", 1),
        (900, "CM", 0),
        (500, "D", 0),
        (499, "ID", 4),
        (495, "VD", 3),
        (490, "XD", 2),
        (450, "LD", 1),
        (400, "CD", 0),
        (100, "C", 0),
        (99, "IC", 2),
        (95, "VC", 1),
        (90, "XC", 0),
        (50, "L", 0),
        (49, "IL", 2),
        (45, "VL", 1),
        (40, "XL", 0),
        (10, "X", 0),
        (9, "IX", 0),
        (5, "V", 0),
        (4, "IV", 0),
        (1, "I", 0),
    ];
    *work = work.checked_sub(DIGITS.len() + 15)?;
    let mut result = String::with_capacity(15);
    for &(value, digit, minimum) in DIGITS {
        if form < minimum {
            continue;
        }
        while number >= value {
            result.push_str(digit);
            number -= value;
        }
    }
    Some(Value::Text(result))
}
fn arabic(value: &Value, work: &mut usize) -> Option<Value> {
    let source = match value {
        Value::Blank | Value::Empty => return Some(Value::Number(0.)),
        Value::Text(text) | Value::UninternedText(text) => text.as_str(),
        _ => return Some(Value::Error("#VALUE!")),
    };
    // Valid numeral characters are ASCII, so the 255 UTF-16-unit ceiling is
    // also a byte ceiling. Other Unicode is invalid independently of length.
    if source.len() > 255 {
        return Some(Value::Error("#VALUE!"));
    }
    *work = work.checked_sub(source.len())?;
    let negative = source.starts_with('-');
    let source = source.strip_prefix('-').unwrap_or(source).as_bytes();
    let digit = |index: usize| match source.get(index).map(u8::to_ascii_uppercase) {
        Some(b'I') => 1,
        Some(b'V') => 5,
        Some(b'X') => 10,
        Some(b'L') => 50,
        Some(b'C') => 100,
        Some(b'D') => 500,
        Some(b'M') => 1000,
        _ => 0,
    };
    let mut result = 0i32;
    for i in 0..source.len() {
        let (a, b, c, d) = (digit(i), digit(i + 1), digit(i + 2), digit(i + 3));
        // Excel's original ARABIC_ROMAN workbook accepts CMM = 1900:
        // a subtractive pair can be followed by the same larger numeral.
        if a == 0 || c > b && c > a || a == b && a == c && a == d || 2 * a == b {
            return Some(Value::Error("#VALUE!"));
        }
        result += if a < b { -a } else { a };
    }
    Some(Value::Number(if negative { -result } else { result } as f64))
}

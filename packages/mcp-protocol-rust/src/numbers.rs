use std::fmt::Write;

/// ECMAScript Number::toString for binary64 values. Rust's shortest scientific
/// significand supplies round-tripping digits; ECMAScript chooses even digits at
/// exact decimal midpoints and applies its fixed/exponential notation boundaries.
pub fn format(number: f64) -> String {
    if number == 0.0 {
        return "0".into();
    }
    if number.is_nan() {
        return "NaN".into();
    }
    if number.is_infinite() {
        return if number.is_sign_negative() {
            "-Infinity"
        } else {
            "Infinity"
        }
        .into();
    }
    let scientific = format!("{:e}", number.abs());
    let (significand, exponent) = scientific
        .split_once('e')
        .expect("scientific number notation");
    let mut exponent: i32 = exponent.parse().expect("binary64 exponent");
    let mut digits: String = significand.chars().filter(|digit| *digit != '.').collect();
    let coefficient: u64 = digits.parse().expect("shortest binary64 coefficient");
    if !coefficient.is_multiple_of(2) {
        let scale = exponent - digits.len() as i32 + 1;
        let adjusted = if at_midpoint(number.abs(), coefficient * 2 - 1, scale) {
            Some(coefficient - 1)
        } else if at_midpoint(number.abs(), coefficient * 2 + 1, scale) {
            Some(coefficient + 1)
        } else {
            None
        };
        if let Some(adjusted) = adjusted {
            let adjusted = adjusted.to_string();
            exponent += adjusted.len() as i32 - digits.len() as i32;
            digits = adjusted;
            while digits.ends_with('0') {
                digits.pop();
            }
        }
    }
    let count = digits.len() as i32;
    let position = exponent + 1;
    let mut output = String::with_capacity(digits.len() + 8);
    if number.is_sign_negative() {
        output.push('-');
    }
    if count <= position && position <= 21 {
        output.push_str(&digits);
        output.extend(std::iter::repeat_n('0', (position - count) as usize));
    } else if 0 < position && position <= 21 {
        output.push_str(&digits[..position as usize]);
        output.push('.');
        output.push_str(&digits[position as usize..]);
    } else if -6 < position && position <= 0 {
        output.push_str("0.");
        output.extend(std::iter::repeat_n('0', -position as usize));
        output.push_str(&digits);
    } else {
        output.push_str(&digits[..1]);
        if digits.len() > 1 {
            output.push('.');
            output.push_str(&digits[1..]);
        }
        output.push('e');
        if exponent >= 0 {
            output.push('+');
        }
        write!(output, "{exponent}").expect("writing to a String cannot fail");
    }
    output
}

// Compare binary64's exact odd mantissa * 2^exponent with the decimal midpoint
// numerator * 10^scale / 2. Cancel factors of five using integer arithmetic;
// floating-point multiplication would round away the evidence of a tie.
fn at_midpoint(number: f64, mut numerator: u64, scale: i32) -> bool {
    let bits = number.to_bits();
    let biased_exponent = ((bits >> 52) & 0x7ff) as i32;
    let mut mantissa = bits & ((1u64 << 52) - 1);
    let mut exponent = if biased_exponent == 0 {
        -1074
    } else {
        mantissa |= 1u64 << 52;
        biased_exponent - 1075
    };
    let zeroes = mantissa.trailing_zeros();
    mantissa >>= zeroes;
    exponent += zeroes as i32;
    if exponent != scale - 1 {
        return false;
    }
    if scale < 0 {
        for _ in 0..-scale {
            if !numerator.is_multiple_of(5) {
                return false;
            }
            numerator /= 5;
        }
    } else {
        for _ in 0..scale {
            let Some(product) = numerator.checked_mul(5) else {
                return false;
            };
            numerator = product;
            if numerator > mantissa {
                return false;
            }
        }
    }
    numerator == mantissa
}

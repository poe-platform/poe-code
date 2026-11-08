//! Primitive scope coercion with ECMAScript whitespace and numeric admission.
use mcp_protocol_rust::strings::trim_ecmascript;
pub fn boolean_text(text: &[u16]) -> Option<bool> {
    match text {
        [116, 114, 117, 101] | [49] => Some(true),
        [102, 97, 108, 115, 101] | [48] => Some(false),
        _ => None,
    }
}
pub fn number_text(text: &[u16]) -> Option<f64> {
    let text = trim_ecmascript(text);
    if text.is_empty() {
        return None;
    }
    if text.len() >= 2 && text[0] == 48 {
        let width = match text[1] {
            120 | 88 => 4,
            111 | 79 => 3,
            98 | 66 => 1,
            _ => 0,
        };
        if width != 0 {
            return radix(&text[2..], width);
        }
    }
    let text = String::from_utf16(text).ok()?;
    let value = text.parse::<f64>().ok()?;
    value.is_finite().then_some(value)
}
fn radix(text: &[u16], width: usize) -> Option<f64> {
    if text.is_empty() {
        return None;
    }
    let mut bits = Vec::new();
    let mut started = false;
    for &unit in text {
        let digit = match unit {
            48..=57 => unit - 48,
            65..=70 => unit - 55,
            97..=102 => unit - 87,
            _ => return None,
        };
        if digit >= 1 << width {
            return None;
        }
        for bit in (0..width).rev() {
            let set = digit & (1 << bit) != 0;
            if set {
                started = true;
            }
            if started {
                if bits.len() >= 1024 {
                    return None;
                }
                bits.push(set);
            }
        }
    }
    if bits.len() > 1024 {
        return None;
    }
    let take = bits.len().min(53);
    let mut significand = 0_u64;
    for &bit in &bits[..take] {
        significand = (significand << 1) | u64::from(bit);
    }
    if bits.len() > take
        && bits[take]
        && (significand & 1 != 0 || bits[take + 1..].iter().any(|&bit| bit))
    {
        significand += 1;
    }
    let value = significand as f64 * 2.0_f64.powi((bits.len() - take) as i32);
    value.is_finite().then_some(value)
}

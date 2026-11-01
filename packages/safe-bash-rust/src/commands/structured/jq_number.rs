//! jq keeps the decimal literal until an operation asks for a double.
use super::JVal;

fn increment(digits: &mut Vec<u8>) {
    for d in digits.iter_mut().rev() {
        if *d < b'9' {
            *d += 1;
            return;
        }
        *d = b'0';
    }
    digits.insert(0, b'1');
}

pub(super) fn literal(token: &str) -> Option<JVal> {
    let negative = token.starts_with('-');
    let sign = if negative { "-" } else { "" };
    let unsigned = token.strip_prefix(['+', '-']).unwrap_or(token);
    let (coefficient, exp) = unsigned.split_once(['e', 'E']).unwrap_or((unsigned, "0"));
    let exp_digits = exp.strip_prefix(['+', '-']).unwrap_or(exp);
    if exp_digits.is_empty() || !exp_digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (whole, frac) = coefficient.split_once('.').unwrap_or((coefficient, ""));
    if whole.is_empty() && frac.is_empty()
        || !whole
            .bytes()
            .chain(frac.bytes())
            .all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let mut exponent = exp
        .parse::<i64>()
        .unwrap_or(if exp.starts_with('-') {
            i64::MIN
        } else {
            i64::MAX
        })
        .saturating_sub(frac.len() as i64);
    let mut digits: Vec<_> = whole
        .bytes()
        .chain(frac.bytes())
        .skip_while(|b| *b == b'0')
        .collect();
    if digits.is_empty() {
        digits.push(b'0');
        exponent = exponent.clamp(-1147483646, 999999999);
    } else if exponent.saturating_add(digits.len() as i64 - 1) > 999999999 {
        return Some(JVal::Number(
            if negative {
                -f64::INFINITY
            } else {
                f64::INFINITY
            },
            None,
        ));
    } else if exponent < -1147483646 {
        let retained = (digits.len() as i64).saturating_sub(-1147483646i64 - exponent);
        let up = retained >= 0 && digits.get(retained as usize).is_some_and(|b| *b >= b'5');
        digits.truncate(retained.max(0) as usize);
        if digits.is_empty() {
            digits.push(b'0');
        }
        if up {
            increment(&mut digits);
        }
        exponent = -1147483646;
    }
    let digits = String::from_utf8(digits).ok()?;
    let adjusted = exponent + digits.len() as i64 - 1;
    let text = if exponent > 0 || adjusted < -6 {
        let tail = if digits.len() > 1 {
            format!(".{}", &digits[1..])
        } else {
            String::new()
        };
        format!("{sign}{}{tail}E{adjusted:+}", &digits[..1])
    } else {
        let point = adjusted + 1;
        if point <= 0 {
            format!("{sign}0.{}{digits}", "0".repeat((-point) as usize))
        } else if exponent < 0 {
            format!(
                "{sign}{}.{}",
                &digits[..point as usize],
                &digits[point as usize..]
            )
        } else {
            format!("{sign}{digits}")
        }
    };
    // The reference rounds the coefficient to 17 significant digits before converting to binary.
    let value = if digits.len() > 17 {
        let mut rounded = digits.as_bytes()[..17].to_vec();
        let next = digits.as_bytes()[17];
        if next > b'5'
            || next == b'5'
                && (digits.as_bytes()[18..].iter().any(|b| *b != b'0') || rounded[16] % 2 == 1)
        {
            increment(&mut rounded);
        }
        format!(
            "{sign}{}e{}",
            String::from_utf8(rounded).ok()?,
            exponent + digits.len() as i64 - 17
        )
        .parse()
        .ok()?
    } else {
        text.parse().ok()?
    };
    Some(JVal::Number(value, Some(text.into_boxed_str())))
}

pub(super) fn computed(value: f64) -> String {
    if value.is_nan() {
        return "null".into();
    }
    let value = value.clamp(-f64::MAX, f64::MAX);
    let sign = if value.is_sign_negative() { "-" } else { "" };
    let scientific = format!("{:e}", value.abs());
    let (mantissa, power) = scientific.split_once('e').unwrap();
    let exponent: i32 = power.parse().unwrap();
    let digits = mantissa.replace('.', "");
    let point = exponent + 1;
    if point <= -4 || point > digits.len() as i32 + 15 {
        format!("{sign}{mantissa}e{exponent:+03}")
    } else {
        value.to_string()
    }
}

// Binary conversion is monotonic. Only ties between two decimal literals need
// their digits compared, including values that underflow to zero or overflow.
pub(super) fn compare(
    a: f64,
    left: Option<&str>,
    b: f64,
    right: Option<&str>,
) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let order = a.partial_cmp(&b).unwrap_or(Ordering::Equal);
    let (Some(left), Some(right)) = (left, right) else {
        return order;
    };
    if order != Ordering::Equal || left == right {
        return order;
    }
    fn parts(text: &str) -> (i8, i64, impl Iterator<Item = u8> + '_) {
        let s = text.trim_start_matches('-');
        let (mantissa, power) = s.split_once('E').unwrap_or((s, "0"));
        let point = mantissa.find('.').unwrap_or(mantissa.len());
        let leading = mantissa
            .bytes()
            .filter(|b| *b != b'.')
            .take_while(|b| *b == b'0')
            .count();
        let mut digits = mantissa
            .bytes()
            .filter(|b| *b != b'.')
            .skip(leading)
            .peekable();
        let sign = if digits.peek().is_none() {
            0
        } else if text.starts_with('-') {
            -1
        } else {
            1
        };
        (
            sign,
            point as i64 - leading as i64 + power.parse::<i64>().unwrap(),
            digits,
        )
    }
    let (sa, ma, mut da) = parts(left);
    let (sb, mb, mut db) = parts(right);
    if sa != sb || sa == 0 {
        return sa.cmp(&sb);
    }
    let mut magnitude = ma.cmp(&mb);
    while magnitude == Ordering::Equal {
        let (a, b) = (da.next(), db.next());
        if a.is_none() && b.is_none() {
            break;
        }
        magnitude = a.unwrap_or(b'0').cmp(&b.unwrap_or(b'0'));
    }
    if sa < 0 {
        magnitude.reverse()
    } else {
        magnitude
    }
}

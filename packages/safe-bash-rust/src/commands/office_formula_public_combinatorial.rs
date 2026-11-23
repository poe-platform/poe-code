// SPDX-License-Identifier: GPL-2.0-or-later
// Public math.ts and statistics.ts rounding and calculation order.
use super::Value;

fn binomial(n: f64, k: f64, work: &mut usize) -> Option<f64> {
    if n < 0. || k < 0. || k > n || !n.is_finite() || !k.is_finite() {
        return Some(f64::NAN);
    }
    let k = k.min(n - k);
    if k == 0. {
        return Some(1.);
    }
    // The public BigInt recurrence rounds only after each exact division.
    // A finite binary64 integer has at most 1024 bits; multiplying two such
    // integers needs 2048 bits. Stop when the divided result rounds to infinity.
    let mut factor = [0u64; 16];
    let bits = n.to_bits();
    let mantissa = (bits & ((1 << 52) - 1)) | (1 << 52);
    let shift = ((bits >> 52) & 2047) as i32 - 1023 - 52;
    if shift < 0 {
        factor[0] = mantissa >> -shift;
    } else {
        let word = shift as usize / 64;
        let significant = u128::from(mantissa) << (shift % 64);
        factor[word] = significant as u64;
        if significant >> 64 != 0 {
            factor[word + 1] = (significant >> 64) as u64;
        }
    }
    let mut result = [0u64; 16];
    result[0] = 1;
    let mut rounded = 1.;
    let mut i = 1u32;
    while f64::from(i) <= k {
        *work = work.checked_sub(1)?;
        let mut product = [0u64; 32];
        for (row, &a) in result.iter().enumerate() {
            if a == 0 {
                continue;
            }
            let mut carry = 0;
            for (column, &b) in factor.iter().enumerate() {
                let value =
                    u128::from(a) * u128::from(b) + u128::from(product[row + column]) + carry;
                product[row + column] = value as u64;
                carry = value >> 64;
            }
            product[row + 16] = carry as u64;
        }
        let mut remainder = 0;
        for word in product.iter_mut().rev() {
            let value = (remainder << 64) | u128::from(*word);
            *word = (value / u128::from(i)) as u64;
            remainder = value % u128::from(i);
        }
        if product[16..].iter().any(|&word| word != 0) {
            return Some(f64::INFINITY);
        }
        result.copy_from_slice(&product[..16]);
        let top = result.iter().rposition(|&word| word != 0).unwrap();
        rounded = if top == 0 {
            result[0] as f64
        } else {
            let mut significant = (u128::from(result[top]) << 64) | u128::from(result[top - 1]);
            if result[..top - 1].iter().any(|&word| word != 0) {
                significant |= 1;
            }
            significant as f64 * f64::from_bits(((1023 + 64 * (top - 1)) as u64) << 52)
        };
        if !rounded.is_finite() {
            break;
        }
        for word in &mut factor {
            let (value, borrow) = word.overflowing_sub(1);
            *word = value;
            if !borrow {
                break;
            }
        }
        i += 1;
    }
    Some(rounded)
}

pub(super) fn calculate(name: &str, n: f64, k: f64, work: &mut usize) -> Option<Value> {
    if matches!(name, "COMBIN" | "COMBINA") {
        let (n, k) = (n.floor(), k.floor());
        if n < 0. || k < 0. {
            return Some(Value::Error("#NUM!"));
        }
        return Some(Value::number(binomial(
            if name == "COMBINA" { n + k - 1. } else { n },
            k,
            work,
        )?));
    }
    let [n, k] = [n, k].map(|x| {
        if x == x.floor() {
            x
        } else {
            x.next_up().floor()
        }
    });
    if n < 0. || k < 0. || name == "PERMUT" && k > n {
        return Some(Value::Error("#NUM!"));
    }
    if name == "PERMUTATIONA" {
        return Some(Value::number(if k == 0. {
            1.
        } else {
            super::super::power::pow(n, k)
        }));
    }
    let mut result = 1.;
    let mut i = 0.;
    while i < k {
        *work = work.checked_sub(1)?;
        result *= n - i;
        if !result.is_finite() {
            break;
        }
        i += 1.;
    }
    Some(Value::number(result))
}

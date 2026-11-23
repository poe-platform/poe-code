// Adapted from IronCalc f93662006b8fb1c401dc870bbda26c5d60ac6037,
// engineering/{bessel.rs,transcendental/} (MIT, LICENSE.IronCalc).
// J/Y retain their original Sun/OpenLibm notices (LICENSE.Sun).
use super::{Value, lookup::number};

#[path = "office_formula_bessel/bessel_i.rs"]
mod bessel_i;
#[path = "office_formula_bessel/bessel_j0_y0.rs"]
mod bessel_j0_y0;
#[path = "office_formula_bessel/bessel_j1_y1.rs"]
mod bessel_j1_y1;
#[path = "office_formula_bessel/bessel_jn_yn.rs"]
mod bessel_jn_yn;
#[path = "office_formula_bessel/bessel_k.rs"]
mod bessel_k;
#[path = "office_formula_bessel/bessel_util.rs"]
mod bessel_util;
#[cfg(test)]
#[path = "office_formula_bessel/test_bessel.rs"]
mod test_bessel;

pub(super) fn calculate(
    name: &str,
    args: [&Value; 2],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    let mut values = [0.; 2];
    for (i, arg) in args.iter().enumerate() {
        values[i] = match arg {
            Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
            Value::Bool(_) => return Some(Value::Error("#VALUE!")),
            Value::Text(s) | Value::UninternedText(s)
                if s.trim().eq_ignore_ascii_case("true")
                    || s.trim().eq_ignore_ascii_case("false") =>
            {
                return Some(Value::Error("#VALUE!"));
            }
            Value::Text(s) | Value::UninternedText(s) => number::parse(s, date1904),
            _ => arg.numeric(),
        }
        .unwrap_or(f64::NAN);
        if values[i].is_nan() {
            return Some(Value::Error("#VALUE!"));
        }
    }
    let [x, n] = values;
    let n = n.trunc();
    if !x.is_finite()
        || !n.is_finite()
        || n < 0.
        || n > i32::MAX as f64
        || matches!(name, "BESSELK" | "BESSELY") && x <= 0.
    {
        return Some(Value::Error("#NUM!"));
    }
    // Recurrences use O(n) work and constant memory. Charge their order before
    // entering the upstream routines, including continued-fraction overhead.
    let iterations = if name == "BESSELI" && n >= 2. && (1e-8..=1e10).contains(&x.abs()) {
        bessel_i::iterations(n as i32, x)
    } else {
        n as usize
    };
    *work = work.checked_sub(iterations.checked_add(128)?.checked_mul(32)?)?;
    let result = match name {
        "BESSELI" => bessel_i::bessel_i(n as i32, x),
        "BESSELJ" => bessel_jn_yn::jn(n as i32, x),
        "BESSELK" => bessel_k::bessel_k(n as i32, x),
        "BESSELY" => bessel_jn_yn::yn(n as i32, x),
        _ => unreachable!(),
    };
    Some(if result.is_finite() {
        Value::Number(result)
    } else {
        Value::Error("#NUM!")
    })
}

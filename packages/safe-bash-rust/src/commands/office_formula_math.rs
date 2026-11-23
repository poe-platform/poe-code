use super::statistics::math::EXP_TABLE;
#[path = "office_formula_cbrt.rs"]
mod cbrt;
#[path = "office_formula_expm1.rs"]
pub(super) mod expm1;
#[path = "office_formula_log1p.rs"]
mod log1p;
#[path = "office_formula_logarithm.rs"]
pub(super) mod logarithm;

pub(super) fn arguments(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "EXP" | "LN" | "LOG10" | "SIGN" | "SQRTPI" | "EVEN" | "ODD" | "LOG2" | "EXPM1" | "LN1P"
        | "CEIL" => (1, 1),
        "LOG" | "FLOOR" | "CEILING" | "FLOOR.XCL" | "CEILING.XCL" => (1, 2),
        "POWER" => (2, 3),
        "QUOTIENT" | "MROUND" => (2, 2),
        _ => return None,
    })
}

pub(super) fn calculate(name: &str, x: f64, base: f64, root: f64) -> Result<f64, &'static str> {
    let result = match name {
        "FLOOR" | "CEILING" | "FLOOR.XCL" | "CEILING.XCL" => {
            let floor = matches!(name, "FLOOR" | "FLOOR.XCL");
            if x == 0. || !floor && base == 0. {
                return Ok(0.);
            }
            if base == 0. {
                return Err("#DIV/0!");
            }
            if x > 0. && base < 0. {
                return Err("#NUM!");
            }
            let ratio = x / base;
            (if ratio == ratio.floor() {
                ratio
            } else if floor {
                ratio.next_up().floor()
            } else {
                ratio.next_down().ceil()
            }) * base
        }
        "EXP" => exp(x),
        "EXPM1" => expm1::expm1(x),
        "LN1P" => log1p::log1p(x),
        "SIGN" => {
            if x == 0. {
                0.
            } else {
                x.signum()
            }
        }
        "SQRTPI" => (std::f64::consts::PI * x).sqrt(),
        "POWER" => {
            if x == 0. && base <= 0. {
                return Err(if base == 0. { "#NUM!" } else { "#DIV/0!" });
            }
            if x < 0. && base.fract() != 0. {
                return Err("#NUM!");
            }
            let value = if base == 0.5 {
                x.sqrt()
            } else if base == 2. {
                x * x
            } else {
                super::power::pow(x, base)
            };
            if root <= 0. || root.fract() != 0. || value < 0. && root % 2. == 0. {
                return Err("#NUM!");
            }
            if root == 3. {
                cbrt::cbrt(value)
            } else if root == 2. {
                value.sqrt()
            } else if root != 1. {
                value.signum() * super::power::pow(value.abs(), 1. / root)
            } else {
                value
            }
        }
        "QUOTIENT" => {
            if base == 0. {
                return Err("#DIV/0!");
            }
            let ratio = x / base;
            if ratio == ratio.floor() {
                ratio
            } else {
                ratio.signum() * ratio.abs().next_up().floor()
            }
        }
        "MROUND" => {
            if base == 0. {
                return Ok(0.);
            }
            if x > 0. && base < 0. || x < 0. && base > 0. {
                return Err("#NUM!");
            }
            let remainder = x.abs() % base.abs();
            (if x < 0. { -1. } else { 1. })
                * ((if remainder >= base.abs() / 2. {
                    base.abs()
                } else {
                    0.
                }) + (x.abs() - remainder))
        }
        "CEIL" => {
            if x.fract() == 0. {
                x
            } else {
                x.next_down().ceil()
            }
        }
        "EVEN" | "ODD" => {
            let integer = if x >= 0. { x.ceil() } else { x.floor() };
            if (integer % 2. == 0.) == (name == "ODD") {
                integer + if x >= 0. { 1. } else { -1. }
            } else {
                integer
            }
        }
        _ if x <= 0. => return Err("#NUM!"),
        "LN" => logarithm::log(x, 0),
        "LOG2" => logarithm::log(x, 2),
        "LOG10" => logarithm::log(x, 10),
        "LOG" if base <= 0. || base == 1. => return Err("#NUM!"),
        "LOG" if base == 10. => logarithm::log(x, 10),
        "LOG" if base == 2. => logarithm::log(x, 2),
        "LOG" => logarithm::log(x, 0) / logarithm::log(base, 0),
        _ => unreachable!(),
    };
    if result.is_finite() {
        Ok(if result == 0. { 0. } else { result })
    } else {
        Err("#NUM!")
    }
}

// The production EXP uses fused reduction and evaluation with these same
// 2^(k/128) anchors. The statistics exponential retains its non-fused profile.
pub(super) fn exp(x: f64) -> f64 {
    if x.abs() < 5.551115123125783e-17 {
        return 1. + x;
    }
    if x <= -1024. {
        return 0.;
    }
    if x >= 1024. {
        return f64::INFINITY;
    }
    let k = (184.6649652337873 * x).round_ties_even();
    let index = (k as i64).rem_euclid(128) as usize;
    let [tail, bits] = EXP_TABLE[index];
    let mut scale_bits = bits.wrapping_add((k as i64 as u64) << 45);
    let r = k.mul_add(-1.2864023111638346e-14, k.mul_add(-0.005415212348111709, x));
    let square = r * r;
    let correction = square.mul_add(
        r.mul_add(0.16666666666665886, 0.49999999999996786),
        f64::from_bits(tail) + r,
    );
    let correction = (square * square).mul_add(
        r.mul_add(0.008333335853059549, 0.0416666808410674),
        correction,
    );
    if x.abs() < 512. {
        let scale = f64::from_bits(scale_bits);
        return scale.mul_add(correction, scale);
    }
    if x > 0. {
        scale_bits = scale_bits.wrapping_sub(1009 << 52);
        let scale = f64::from_bits(scale_bits);
        return f64::from_bits((1023 + 1009) << 52) * scale.mul_add(correction, scale);
    }
    scale_bits = scale_bits.wrapping_add(1022 << 52);
    let scale = f64::from_bits(scale_bits);
    let mut y = scale.mul_add(correction, scale);
    if y < 1. {
        let low = scale.mul_add(correction, scale - y);
        let high = 1. + y;
        let low = 1. - high + y + low;
        y = high + low - 1.;
    }
    f64::MIN_POSITIVE * y
}

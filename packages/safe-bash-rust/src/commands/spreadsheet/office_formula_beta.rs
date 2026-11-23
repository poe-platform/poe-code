// Value/array contracts and continued fraction adapted from Univer 4767b3b,
// basics/statistical.ts and statistical/beta-* (Apache-2.0, LICENSE.Univer).
// IronCalc f936620 beta.rs supplies interval/argument contracts (MIT,
// LICENSE.IronCalc). Reuse Poe Code's Rust gamma and bounded work accounting.
use super::{Value, gamma, math, number};

pub(in super::super) fn arguments(name: &str) -> Option<(usize, usize)> {
    match name {
        "BETA.DIST" => Some((4, 6)),
        "BETA.INV" | "BETADIST" | "BETAINV" => Some((3, 5)),
        _ => None,
    }
}

pub(super) fn log_beta(mut a: f64, mut b: f64) -> f64 {
    if a > b {
        std::mem::swap(&mut a, &mut b);
    }
    if b < 16. {
        return gamma::log_gamma(a) + gamma::log_gamma(b) - gamma::log_gamma(a + b);
    }
    let r = a / b;
    if a < 16. {
        return gamma::log_gamma(a) - a * b.ln() - (b + a - 0.5) * r.ln_1p()
            + a
            + gamma::stirling_remainder(b)
            - gamma::stirling_remainder(b + a);
    }
    let lsum = b.ln() + r.ln_1p();
    a * (r.ln() - r.ln_1p()) - b * r.ln_1p()
        + 0.5 * (lsum - a.ln() - b.ln() + (2. * std::f64::consts::PI).ln())
        + gamma::stirling_remainder(a)
        + gamma::stirling_remainder(b)
        - gamma::stirling_remainder(a + b)
}

// log(x^a*y^b/B(a,b)). Near a large mean, cancel the linear terms
// analytically before evaluating log1p; subtracting log beta loses digits.
pub(super) fn log_prefix(x: f64, y: f64, a: f64, b: f64, work: &mut usize) -> Option<f64> {
    if a >= 16. && b >= 16. {
        let (mean, other) = if a <= b {
            let r = a / b;
            (r / (1. + r), 1. / (1. + r))
        } else {
            let r = b / a;
            (1. / (1. + r), r / (1. + r))
        };
        let delta = if x < y { x - mean } else { other - y };
        let u = delta / mean;
        let v = -delta / other;
        let terms = if u.abs() < 0.5 && v.abs() < 0.5 {
            a * gamma::temme::log1pmx(u, work)? + b * gamma::temme::log1pmx(v, work)?
        } else if x < mean {
            a * (x / mean).ln() + b * v.ln_1p()
        } else {
            a * u.ln_1p() + b * (y / other).ln()
        };
        let logsum = a.max(b).ln() + (a.min(b) / a.max(b)).ln_1p();
        return Some(
            terms + 0.5 * (a.ln() + b.ln() - logsum - (2. * std::f64::consts::PI).ln())
                - gamma::stirling_remainder(a)
                - gamma::stirling_remainder(b)
                + gamma::stirling_remainder(a + b),
        );
    }
    let (lx, ly) = if x < y {
        (x.ln(), (-x).ln_1p())
    } else {
        ((-y).ln_1p(), y.ln())
    };
    Some(a * lx + b * ly - log_beta(a, b))
}

// Upper tail for small shape. Expand the integral directly rather than
// subtracting a lower probability near one. b*x <= 1 bounds cancellation in
// the series. Raise b for the log-gamma ratio so its Stirling form is stable.
fn small_shape_upper(x: f64, a: f64, mut b: f64, work: &mut usize) -> Option<f64> {
    let original_b = b;
    let mut correction = 0.;
    while b < 16. {
        *work = work.checked_sub(1)?;
        correction -= (a / b).ln_1p();
        b += 1.;
    }
    let ratio = a * b.ln() + (b + a - 0.5) * (a / b).ln_1p() - a + gamma::stirling_remainder(b + a)
        - gamma::stirling_remainder(b)
        + correction;
    let logarithm = a * x.ln() - gamma::log_gamma_one_plus(a, work)? + ratio;
    let mut power = (1. - original_b) * x;
    let mut sum = power / (a + 1.);
    for n in 2usize.. {
        *work = work.checked_sub(1)?;
        power *= (n as f64 - original_b) * x / n as f64;
        let next = sum + power / (a + n as f64);
        if next == sum {
            break;
        }
        sum = next;
    }
    Some(-logarithm.exp_m1() - logarithm.exp() * a * sum)
}

pub(super) fn cdf(x: f64, y: f64, a: f64, b: f64, work: &mut usize) -> Option<f64> {
    if x == 0. {
        return Some(0.);
    }
    if y == 0. {
        return Some(1.);
    }
    if a == 1. {
        return Some(-(b * if x < y { (-x).ln_1p() } else { y.ln() }).exp_m1());
    }
    if b == 1. {
        return Some((a * if x < y { x.ln() } else { (-y).ln_1p() }).exp());
    }
    if a == b && x == y {
        return Some(0.5);
    }
    if b <= 0.25 && y < 0.5 && a * y <= 1. {
        return small_shape_upper(y, b, a, work);
    }
    if a <= 0.25 && x < 0.5 && b * x <= 1. {
        let upper = small_shape_upper(x, a, b, work)?;
        if upper < 0.5 {
            return Some(1. - upper);
        }
    }
    let flip = x * (b + 1.) > y * (a + 1.);
    let (x, y, a, b) = if flip { (y, x, b, a) } else { (x, y, a, b) };
    let prefix = log_prefix(x, y, a, b, work)?;
    let tiny = f64::MIN_POSITIVE / f64::EPSILON;
    let floor = |v: f64| if v.abs() < tiny { tiny.copysign(v) } else { v };
    let mut c = 1.;
    let mut d = 1. / floor(y + (1. - b) / (a + 1.) * x);
    let mut h = d;
    for m in 1usize.. {
        *work = work.checked_sub(2)?;
        let m = m as f64;
        let even = m / (a + 2. * m) * ((b - m) / (a - 1. + 2. * m)) * x;
        let odd = -(a + m) / (a + 2. * m) * (((a + m) * x + b * x) / (a + 1. + 2. * m));
        // Combine the even/odd steps when the odd coefficient is near -1.
        // Otherwise an intermediate rounded to 1 loses its tiny difference
        // before the next subtraction, even with an exact odd complement.
        let complement = y + x
            * (a / (a + 2. * m) * ((2. * m + 1. - b) / (a + 2. * m + 1.))
                + m / (a + 2. * m) * ((3. * m + 2. - b) / (a + 2. * m + 1.)));
        let delta = if complement.abs() < 0.5 {
            let ed = even * d;
            let ec = even / c;
            let denominator = floor(complement + ed);
            let numerator = floor(complement + ec);
            d = (1. + ed) / denominator;
            c = floor(numerator / (1. + ec));
            numerator / denominator
        } else {
            d = 1. / floor(1. + even * d);
            c = floor(1. + even / c);
            h *= d * c;
            d = 1. / floor(1. + odd * d);
            c = floor(1. + odd / c);
            d * c
        };
        h *= delta;
        if (delta - 1.).abs() <= 4. * f64::EPSILON {
            let logarithm = prefix + h.ln() - a.ln();
            return Some(if flip {
                -logarithm.exp_m1()
            } else {
                logarithm.exp()
            });
        }
    }
    unreachable!()
}

pub(super) fn inverse(p: f64, mut a: f64, mut b: f64, work: &mut usize) -> Option<(f64, f64)> {
    // Solve for a quantile in the lower half of the interval, keeping its
    // complement separately. Skewed distributions can have a median closer
    // to one than binary64 can represent, even for an ordinary probability.
    let flip = p > cdf(0.5, 0.5, a, b, work)?;
    let target = p.min(1. - p);
    let upper = if flip { p <= 0.5 } else { p > 0.5 };
    let logp = if upper {
        (-target).ln_1p()
    } else {
        target.ln()
    };
    if flip {
        std::mem::swap(&mut a, &mut b);
    }
    let result = if a == 1. {
        -(if upper {
            target.ln() / b
        } else {
            (-target).ln_1p() / b
        })
        .exp_m1()
    } else if b == 1. {
        (logp / a).exp()
    } else if a == b && target == 0.5 {
        0.5
    } else {
        let power = ((logp + a.ln() + log_beta(a, b)) / a).exp();
        let seed = if a > 1. && b > 1. {
            let z = math::inverse(target) * if upper { 1. } else { -1. };
            let r = (z * z - 3.) / 6.;
            let s = 1. / (2. * a - 1.);
            let t = 1. / (2. * b - 1.);
            let h = 2. / (s + t);
            let w = z * (h + r).sqrt() / h - (t - s) * (r + 5. / 6. - 2. / (3. * h));
            1. / (1. + (b / a) * (2. * w).exp())
        } else {
            power
        };
        if power == 0. && seed == 0. {
            return Some(if flip { (1., 0.) } else { (0., 1.) });
        }
        let mut x = if seed > 0. && seed < 1. {
            seed
        } else {
            power.min(0.5).max(f64::from_bits(1))
        };
        let (mut low, mut high) = (0., 1.);
        let mut answer = f64::NAN;
        for _ in 0..256 {
            *work = work.checked_sub(1)?;
            let value = if upper {
                cdf(1. - x, x, b, a, work)?
            } else {
                cdf(x, 1. - x, a, b, work)?
            };
            let residual = value - target;
            if residual.abs() <= target * 4. * f64::EPSILON {
                answer = x;
                break;
            }
            if (residual > 0.) != upper {
                high = x;
            } else {
                low = x;
            }
            if high - low <= 2. * f64::EPSILON * high {
                answer = (low + high) / 2.;
                break;
            }
            let density = (log_prefix(x, 1. - x, a, b, work)? - x.ln() - (-x).ln_1p()).exp();
            let step = if value > 0. && (value > target * 2. || value < target / 2.) {
                (value.ln() - target.ln()) * (value / density)
            } else {
                residual / density
            };
            let candidate = if upper { x + step } else { x - step };
            let next = if candidate > low && candidate < high {
                candidate
            } else {
                (low + high) / 2.
            };
            if next == x {
                answer = x;
                break;
            }
            x = next;
        }
        answer
    };
    Some(if flip {
        (1. - result, result)
    } else {
        (result, 1. - result)
    })
}

pub(in super::super) fn calculate(
    name: &str,
    args: &[&Value],
    date1904: bool,
    upper_omitted: bool,
    work: &mut usize,
) -> Option<Value> {
    *work = work.checked_sub(128)?;
    for v in args {
        if let Value::Error(e) | Value::LiteralError(e) = v {
            return Some(Value::Error(e));
        }
    }
    let distribution = name == "BETA.DIST";
    let inverse_function = matches!(name, "BETA.INV" | "BETAINV");
    let bounds = if distribution { 4 } else { 3 };
    let mut n = [0.; 6];
    n[bounds + 1] = 1.;
    for (i, v) in args.iter().enumerate() {
        if i == bounds + 1 && upper_omitted {
            continue;
        }
        let value = match v {
            Value::Text(s) | Value::UninternedText(s) => {
                if !(distribution && i == 3)
                    && (s.trim().eq_ignore_ascii_case("true")
                        || s.trim().eq_ignore_ascii_case("false"))
                {
                    None
                } else {
                    number::parse(s, date1904)
                }
            }
            _ => v.numeric(),
        };
        let Some(value) = value else {
            return Some(Value::Error("#VALUE!"));
        };
        if !value.is_finite() {
            return Some(Value::Error("#NUM!"));
        }
        n[i] = value;
    }
    let (x, a, b, lo, hi) = (n[0], n[1], n[2], n[bounds], n[bounds + 1]);
    if a <= 0. || b <= 0. || lo >= hi {
        return Some(Value::Error("#NUM!"));
    }
    let width = hi - lo;
    let logwidth = if width.is_finite() {
        width.ln()
    } else {
        (hi / 2. - lo / 2.).ln() + std::f64::consts::LN_2
    };
    let result = if inverse_function {
        if x <= 0. || x >= 1. {
            return Some(Value::Error("#NUM!"));
        }
        let (t, u) = inverse(x, a, b, work)?;
        // Preserve both tails through interval mapping. A normalized quantile
        // can underflow while its scaled offset remains representable.
        if t == 0. {
            lo + (logwidth + (x.ln() + a.ln() + log_beta(a, b)) / a).exp()
        } else if u == 0. {
            hi - (logwidth + ((-x).ln_1p() + b.ln() + log_beta(a, b)) / b).exp()
        } else if width.is_finite() {
            if t <= u {
                lo + t * width
            } else {
                hi - u * width
            }
        } else {
            lo * u + hi * t
        }
    } else {
        if x < lo || x > hi {
            return Some(Value::Error("#NUM!"));
        }
        let (t, u) = if width.is_finite() {
            ((x - lo) / width, (hi - x) / width)
        } else {
            let half = hi / 2. - lo / 2.;
            ((x / 2. - lo / 2.) / half, (hi / 2. - x / 2.) / half)
        };
        if (t == 0. && x > lo) || (u == 0. && x < hi) {
            // Only the ratio underflowed. The next integral-series term is
            // bounded by max(a,b)*MIN_SUBNORMAL, at binary64 rounding scale.
            let (logt, logu) = if t == 0. {
                ((x - lo).ln() - logwidth, 0.)
            } else {
                (0., (hi - x).ln() - logwidth)
            };
            let lb = log_beta(a, b);
            if !distribution || n[3] != 0. {
                if t == 0. {
                    (a * logt - lb - a.ln()).exp()
                } else {
                    -(b * logu - lb - b.ln()).exp_m1()
                }
            } else {
                ((a - 1.) * logt + (b - 1.) * logu - lb - logwidth).exp()
            }
        } else if !distribution || n[3] != 0. {
            cdf(t, u, a, b, work)?
        } else if x == lo || x == hi {
            let (shape, other) = if x == lo { (a, b) } else { (b, a) };
            if shape < 1. {
                f64::INFINITY
            } else if shape > 1. {
                0.
            } else {
                if width.is_finite() {
                    other / width
                } else {
                    (other / 2.) / (hi / 2. - lo / 2.)
                }
            }
        } else {
            (log_prefix(t, u, a, b, work)? - t.ln() - u.ln() - logwidth).exp()
        }
    };
    Some(Value::number(result))
}

#[cfg(test)]
mod tests {
    #[test]
    fn inverse_roundtrips_boost_reference_probabilities() {
        let cases: &[[f64; 5]] = include!("office_formula_beta_reference.rs");
        let mut failures = Vec::new();
        for &[a, b, x, p, q] in cases {
            for (a, b, x, p) in [(a, b, x, p), (b, a, 1. - x, q)] {
                if p <= 0. || p >= 1. {
                    continue;
                }
                let mut work = 128 * 1024 * 1024;
                let actual = super::inverse(p, a, b, &mut work).unwrap().0;
                let pdf = (super::log_prefix(x, 1. - x, a, b, &mut work).unwrap()
                    - x.ln()
                    - (-x).ln_1p())
                .exp();
                // The dataset's high-precision probabilities are rounded to
                // binary64 before inversion. Translate that rounding through
                // the density rather than allowing a fixed absolute x error.
                let tolerance =
                    x.abs() * 3e-11 + (p * f64::EPSILON).max(f64::from_bits(1)) / pdf * 16.;
                if !actual.is_finite() || (actual - x).abs() > tolerance {
                    failures.push(format!(
                        "a={a:e}, b={b:e}, p={p:e}: {actual:e} != {x:e}, tolerance={tolerance:e}"
                    ));
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn boost_normalized_beta_reference_cases() {
        let cases: &[[f64; 5]] = include!("office_formula_beta_reference.rs");
        assert_eq!(cases.len(), 2210);
        let mut failures = Vec::new();
        for &[a, b, x, p, q] in cases {
            for (upper, expected) in [(false, p), (true, q)] {
                let mut work = 128 * 1024 * 1024;
                let actual = if upper {
                    super::cdf(1. - x, x, b, a, &mut work)
                } else {
                    super::cdf(x, 1. - x, a, b, &mut work)
                }
                .unwrap();
                if !actual.is_finite() || (actual - expected).abs() > expected.abs() * 3e-12 {
                    failures.push(format!(
                        "a={a:e}, b={b:e}, x={x:e}, upper={upper}: {actual:e} != {expected:e}"
                    ));
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Public spreadsheet-engine probability.ts and scientific.ts calculation order.
use super::super::{financial::options::normal::exp, math::logarithm::log};
use super::Value;

pub(super) fn log_gamma(mut x: f64, work: &mut usize) -> Option<f64> {
    if x <= 0. {
        let sine = super::super::trigonometry::pi_reduced(x, false);
        return Some(if sine == 0. {
            f64::NAN
        } else {
            log(std::f64::consts::PI / sine.abs(), 0) - log_gamma(1. - x, work)?
        });
    }
    let mut recurrence = 0.;
    while x < 16. {
        *work = work.checked_sub(1)?;
        recurrence += log(x, 0);
        x += 1.;
    }
    let inverse = 1. / x;
    let square = inverse * inverse;
    let correction = inverse
        * (1. / 12.
            + square
                * (-1. / 360.
                    + square
                        * (1. / 1260.
                            + square
                                * (-1. / 1680.
                                    + square * (1. / 1188. + square * (-691. / 360360.))))));
    Some(
        (x - 0.5) * log(x, 0) - x + 0.5 * log(2. * std::f64::consts::PI, 0) + correction
            - recurrence,
    )
}

fn complement(logp: f64) -> f64 {
    if logp > -std::f64::consts::LN_2 {
        log(-super::super::math::expm1::expm1(logp), 0)
    } else {
        (-exp(logp)).ln_1p()
    }
}

fn gamma_probability(x: f64, shape: f64, lower: bool, work: &mut usize) -> Option<f64> {
    if x <= 0. {
        return Some(if lower { f64::NEG_INFINITY } else { 0. });
    }
    if x == f64::INFINITY {
        return Some(if lower { 0. } else { f64::NEG_INFINITY });
    }
    let factor = shape * log(x, 0) - x - log_gamma(shape, work)?;
    let direct_lower = x < shape + 1.;
    let total = if direct_lower {
        let mut term = 1. / shape;
        let mut total = term;
        let mut i = 1.;
        loop {
            *work = work.checked_sub(1)?;
            term *= x / (shape + i);
            total += term;
            if term <= total * f64::EPSILON / 2. {
                break total;
            }
            i += 1.;
        }
    } else {
        let tiny = 1e-300;
        let mut b = x + 1. - shape;
        let mut c = 1. / tiny;
        let mut d = 1. / b;
        let mut total = d;
        let mut i = 1.;
        loop {
            *work = work.checked_sub(1)?;
            let a = -i * (i - shape);
            b += 2.;
            d = a * d + b;
            if d.abs() < tiny {
                d = tiny;
            }
            c = b + a / c;
            if c.abs() < tiny {
                c = tiny;
            }
            d = 1. / d;
            let delta = d * c;
            total *= delta;
            if (delta - 1.).abs() <= f64::EPSILON * 2. {
                break total;
            }
            i += 1.;
        }
    };
    let value = factor + log(total, 0);
    Some(if direct_lower == lower {
        value
    } else {
        complement(value)
    })
}

pub(super) fn calculate(name: &str, values: [f64; 5], work: &mut usize) -> Option<Value> {
    if name == "HYPGEOMDIST" {
        let [x, n, m, population, cumulative] = values;
        let [x, n, m, population] = [x, n, m, population].map(|n| {
            if n == n.floor() {
                n
            } else {
                n.next_up().floor()
            }
        });
        if x < 0. || x > m || n < 0. || m < 0. || population < m || n > population {
            return Some(Value::Error("#NUM!"));
        }
        let low = 0_f64.max(n - (population - m));
        let high = m.min(n);
        if cumulative != 0. && (x < low || x >= high) {
            return Some(Value::Number(if x < low { 0. } else { 1. }));
        }
        let mut total = f64::NEG_INFINITY;
        let mut k = if cumulative == 0. { x } else { low };
        while k <= x {
            *work = work.checked_sub(1)?;
            let term = log_choose(m, k, work)? + log_choose(population - m, n - k, work)?
                - log_choose(population, n, work)?;
            if cumulative == 0. {
                return Some(Value::number(exp(term)));
            }
            let maximum = total.max(term);
            total = if maximum == f64::NEG_INFINITY {
                maximum
            } else {
                maximum + exp(total.min(term) - maximum).ln_1p()
            };
            k += 1.;
        }
        return Some(Value::number(exp(total)));
    }
    if name == "POISSON" {
        let [x, mean, cumulative, _, _] = values;
        let x = if x == x.floor() {
            x
        } else {
            x.next_up().floor()
        };
        if x < 0. || mean <= 0. {
            return Some(Value::Error("#NUM!"));
        }
        if x <= 140. && mean <= 140. {
            let density = super::super::power::pow(mean, x) * super::super::math::exp(-mean)
                / factorial(x as u32, work)?;
            if cumulative == 0. {
                return Some(Value::number(density));
            }
            let shape = x + 1.;
            if mean >= 1. && mean <= x && mean < 0.8 * (shape + 50.) {
                let mut term = mean / shape;
                let mut total = term;
                let mut denominator = shape;
                loop {
                    *work = work.checked_sub(1)?;
                    denominator += 1.;
                    term *= mean / denominator;
                    total += term;
                    if term <= total * f64::EPSILON {
                        break;
                    }
                }
                return Some(Value::number(1. - total * density));
            }
            if mean >= 1. && x < mean && shape < 0.8 * (mean + 50.) {
                let mut term = 1.;
                let mut total = 0.;
                let mut y = x;
                while y >= 1. && term > total * f64::EPSILON {
                    *work = work.checked_sub(1)?;
                    term *= y / mean;
                    total += term;
                    y -= 1.;
                }
                return Some(Value::number((1. + total) * density));
            }
        }
        return Some(Value::number(if cumulative == 0. {
            exp(x * log(mean, 0) - mean - log_gamma(x + 1., work)?)
        } else {
            exp(gamma_probability(mean, x + 1., false, work)?)
        }));
    }
    let [x, shape, scale, cumulative, _] = if name == "R.QCHISQ" {
        [values[0], values[1] / 2., 2., 0., 0.]
    } else {
        values
    };
    let quantile = matches!(name, "GAMMAINV" | "R.QCHISQ");
    let lower = name != "R.QCHISQ" || values[2] != 0.;
    let logarithmic = name == "R.QCHISQ" && values[3] != 0.;
    if shape <= 0.
        || scale <= 0.
        || if logarithmic {
            x > 0.
        } else {
            x < 0. || quantile && x > 1.
        }
    {
        return Some(Value::Error("#NUM!"));
    }
    let result = if quantile {
        if x == if logarithmic { f64::NEG_INFINITY } else { 0. } {
            return Some(Value::number(if lower { 0. } else { f64::INFINITY }));
        }
        if x == if logarithmic { 0. } else { 1. } {
            return Some(Value::number(if lower { f64::INFINITY } else { 0. }));
        }
        let logp = if logarithmic { x } else { log(x, 0) };
        let small = logp <= -std::f64::consts::LN_2;
        let lower = if small { lower } else { !lower };
        let target = if small { logp } else { complement(logp) };
        let mut lo = 0.;
        let mut hi = 1.;
        while (gamma_probability(hi / scale, shape, lower, work)? < target) == lower {
            *work = work.checked_sub(1)?;
            hi *= 2.;
            if !hi.is_finite() {
                return Some(Value::Error("#NUM!"));
            }
        }
        let mut result = f64::NAN;
        for _ in 0..1100 {
            *work = work.checked_sub(1)?;
            let mid = lo / 2. + hi / 2.;
            if mid == lo || mid == hi {
                result = mid;
                break;
            }
            let value = gamma_probability(mid / scale, shape, lower, work)?;
            if value.is_nan() {
                break;
            }
            if if lower {
                value < target
            } else {
                value > target
            } {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        result
    } else if cumulative != 0. {
        exp(gamma_probability(x / scale, shape, true, work)?)
    } else if x == 0. {
        if shape < 1. {
            f64::INFINITY
        } else if shape == 1. {
            exp(-log(scale, 0))
        } else {
            0.
        }
    } else {
        exp((shape - 1.) * log(x / scale, 0) - x / scale - log_gamma(shape, work)? - log(scale, 0))
    };
    Some(Value::number(result))
}

fn log_choose(n: f64, k: f64, work: &mut usize) -> Option<f64> {
    Some(if k < 0. || k > n {
        f64::NEG_INFINITY
    } else {
        log_gamma(n + 1., work)? - log_gamma(k + 1., work)? - log_gamma(n - k + 1., work)?
    })
}

// Public Poisson and GAMMA round their exact BigInt factorial once.
// 170! fits in sixteen little-endian limbs.
pub(super) fn factorial(n: u32, work: &mut usize) -> Option<f64> {
    let mut limbs = [0u64; 16];
    limbs[0] = 1;
    for i in 2..=n {
        *work = work.checked_sub(1)?;
        let mut carry = 0;
        for limb in &mut limbs {
            let product = u128::from(*limb) * u128::from(i) + carry;
            *limb = product as u64;
            carry = product >> 64;
        }
    }
    let top = limbs.iter().rposition(|&n| n != 0).unwrap();
    if top == 0 {
        return Some(limbs[0] as f64);
    }
    let mut significant = (u128::from(limbs[top]) << 64) | u128::from(limbs[top - 1]);
    if limbs[..top - 1].iter().any(|&n| n != 0) {
        significant |= 1;
    }
    Some(significant as f64 * f64::from_bits(((1023 + 64 * (top - 1)) as u64) << 52))
}

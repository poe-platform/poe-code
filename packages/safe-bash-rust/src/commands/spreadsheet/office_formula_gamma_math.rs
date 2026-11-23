#[path = "office_formula_gamma_temme.rs"]
pub(super) mod temme;
// Gamma algorithms adapted from LibreOffice Calc 24.8, interpr3.cxx and interpr6.cxx.
// This Source Code Form is subject to the terms of the Mozilla Public License,
// v. 2.0. If a copy of the MPL was not distributed with this file, You can
// obtain one at http://mozilla.org/MPL/2.0/.
//
// The original files incorporate work licensed to the Apache Software
// Foundation (ASF) under contributor license agreements. The ASF licenses that
// work under the Apache License, Version 2.0; see
// http://www.apache.org/licenses/LICENSE-2.0 .
use super::super::{rounding::approximate, summation::Sum};
use super::{Value, math::exp};
#[path = "office_formula_gamma_log.rs"]
mod logarithm;
use logarithm::ln;

const MAX_GAMMA: f64 = 171.624376956302;
const LANCZOS_G: f64 = 6.02468004077673;
const NUMERATOR: [f64; 13] = [
    23531376880.41076,
    42919803642.6491,
    35711959237.35567,
    17921034426.03721,
    6039542586.352028,
    1439720407.3117216,
    248874557.86205417,
    31426415.585400194,
    2876370.6289353725,
    186056.26539522348,
    8071.672002365816,
    210.82427775157936,
    2.5066282746310002,
];
const DENOMINATOR: [f64; 13] = [
    0., 39916800., 120543840., 150917976., 105258076., 45995730., 13339535., 2637558., 357423.,
    32670., 1925., 66., 1.,
];

fn lanczos(x: f64) -> f64 {
    let (mut numerator, mut denominator) = if x <= 1. {
        (NUMERATOR[12], DENOMINATOR[12])
    } else {
        (NUMERATOR[0], DENOMINATOR[0])
    };
    if x <= 1. {
        for index in (0..12).rev() {
            numerator = numerator * x + NUMERATOR[index];
            denominator = denominator * x + DENOMINATOR[index];
        }
    } else {
        let inverse = 1. / x;
        for index in 1..13 {
            numerator = numerator * inverse + NUMERATOR[index];
            denominator = denominator * inverse + DENOMINATOR[index];
        }
    }
    numerator / denominator
}

fn gamma_positive(x: f64) -> f64 {
    let shifted = x + LANCZOS_G - 0.5;
    let half_power = shifted.powf(x / 2. - 0.25);
    let result = lanczos(x) * half_power / exp(shifted) * half_power;
    if x <= 20. && x == approximate(x).floor() {
        result.round()
    } else {
        result
    }
}

fn log_gamma_positive(x: f64) -> f64 {
    let shifted = x + LANCZOS_G - 0.5;
    ln(lanczos(x)) + (x - 0.5) * ln(shifted) - shifted
}

fn gamma(x: f64) -> f64 {
    if x > MAX_GAMMA {
        return f64::INFINITY;
    }
    if x >= 1. {
        return gamma_positive(x);
    }
    if x >= 0.5 {
        return gamma_positive(x + 1.) / x;
    }
    if x >= -0.5 {
        let log_test = log_gamma_positive(x + 2.) - x.ln_1p() - ln(x.abs());
        if log_test >= ln(f64::MAX) {
            return f64::INFINITY;
        }
        return gamma_positive(x + 2.) / (x + 1.) / x;
    }
    let sine = (std::f64::consts::PI * x).sin();
    let log_divisor = log_gamma_positive(1. - x) + ln(sine.abs());
    let log_pi = ln(std::f64::consts::PI);
    if log_divisor - log_pi >= ln(f64::MAX) {
        return 0.;
    }
    if log_divisor < 0. && log_pi - log_divisor > ln(f64::MAX) {
        return f64::INFINITY;
    }
    exp(log_pi - log_divisor) * if sine < 0. { -1. } else { 1. }
}

pub(super) fn log_gamma(x: f64) -> f64 {
    if x >= MAX_GAMMA {
        log_gamma_positive(x)
    } else if x >= 1. {
        ln(gamma_positive(x))
    } else if x >= 0.5 {
        ln(gamma_positive(x + 1.) / x)
    } else {
        log_gamma_positive(x + 2.) - x.ln_1p() - ln(x)
    }
}

// Stirling remainder: reuse the existing Rust gamma routine for small counts;
// the alternating asymptotic expansion avoids subtracting large log-factorials.
pub(super) fn stirling_remainder(n: f64) -> f64 {
    if n < 16. {
        return log_gamma(n + 1.) - (n + 0.5) * n.ln() + n - 0.5 * (2. * std::f64::consts::PI).ln();
    }
    let r = 1. / n;
    let r2 = r * r;
    r * (1. / 12.
        - r2 * (1. / 360.
            - r2 * (1. / 1260. - r2 * (1. / 1680. - r2 * (1. / 1188. - r2 * 691. / 360360.)))))
}

// Stable log(x^a*exp(-x)/Gamma(a)); large nearly equal arguments must not
// subtract log-gamma values of order a*ln(a).
fn log_prefix(a: f64, x: f64, work: &mut usize) -> Option<f64> {
    if a < 16. {
        return Some(a * ln(x) - x - log_gamma(a));
    }
    let delta = (x - a) / a;
    let exponent = if delta.abs() < 0.5 {
        a * temme::log1pmx(delta, work)?
    } else {
        a * (ln(x) - ln(a)) - (x - a)
    };
    Some(exponent + 0.5 * (ln(a) - (2. * std::f64::consts::PI).ln()) - stirling_remainder(a))
}

fn chi_density(x: f64, degrees: f64, work: &mut usize) -> Option<f64> {
    let a = degrees / 2.;
    if x == 0. {
        return Some(if a == 1. {
            0.5
        } else if a < 1. {
            f64::INFINITY
        } else {
            0.
        });
    }
    let scaled = x / 2.;
    Some(if scaled == 0. {
        ((a - 1.) * (x.ln() - std::f64::consts::LN_2) - std::f64::consts::LN_2 - log_gamma(a)).exp()
    } else {
        (log_prefix(a, scaled, work)? - x.ln()).exp()
    })
}

// log Gamma(1+a), for |a| <= 0.25, without cancellation near a=0.
pub(super) fn log_gamma_one_plus(a: f64, work: &mut usize) -> Option<f64> {
    const COEFFICIENTS: [f64; 31] = [
        0.8224670334241133,
        -0.4006856343865313,
        0.27058080842778454,
        -0.2073855510286741,
        0.16955717699740813,
        -0.14404989676884614,
        0.12550966952474307,
        -0.11133426586956473,
        0.10009945751278182,
        -0.09095401714582904,
        0.08335384054610899,
        -0.0769325164113522,
        0.07143294629536133,
        -0.06666870588242048,
        0.06250095514121302,
        -0.058823978658684564,
        0.055555767627403614,
        -0.052631679379616644,
        0.05000004769810169,
        -0.04761907033014222,
        0.04545455629320467,
        -0.04347826605304026,
        0.04166666915034121,
        -0.04000000119214014,
        0.03846153903467519,
        -0.037037037312989324,
        0.03571428584733336,
        -0.034482758684919304,
        0.03333333336437758,
        -0.03225806453115041,
        0.03125000000727597,
    ];
    let mut polynomial = 0.;
    for c in COEFFICIENTS.iter().rev() {
        *work = work.checked_sub(1)?;
        polynomial = polynomial * a + c;
    }
    Some(a * (-0.5772156649015329 + a * polynomial))
}

struct Calculation<'a> {
    work: &'a mut usize,
    error: Option<&'static str>,
}

impl Calculation<'_> {
    fn incomplete(&mut self, a: f64, x: f64, upper: bool) -> Option<f64> {
        if x == 0. {
            return Some(if upper { 1. } else { 0. });
        }
        if x.is_infinite() {
            return Some(if upper { 0. } else { 1. });
        }
        // For small shape the lower probability is almost one. Evaluate the
        // upper tail directly using the alternating integral series, with
        // log Gamma(1+a) = -EulerGamma*a + sum((-1)^n*zeta(n)*a^n/n).
        if upper && a <= 0.25 && x < 1. {
            let log_gamma_one_plus = log_gamma_one_plus(a, self.work)?;
            let logarithm = a * ln(x) - log_gamma_one_plus;
            let mut power = -x;
            let mut sum = power / (a + 1.);
            for n in 2usize.. {
                *self.work = self.work.checked_sub(1)?;
                power *= -x / n as f64;
                let next = sum + power / (a + n as f64);
                if next == sum {
                    break;
                }
                sum = next;
            }
            return Some(-logarithm.exp_m1() - exp(logarithm) * a * sum);
        }
        let sigma = ((x - a) / a).abs();
        if a > 20.
            && (if a > 200. {
                20. / a > sigma * sigma
            } else {
                sigma < 0.4
            })
        {
            return temme::probability(a, x, upper, self.work);
        }
        let factor = exp(log_prefix(a, x, self.work)?);
        if factor == 0. {
            return Some(if upper == (x < a) { 1. } else { 0. });
        }
        let continued = x > a + 1.;
        let result = if continued {
            let mut y = 1. - a;
            let mut denominator = x + 2. - a;
            let (mut p1, mut p2, mut q1, mut q2) = (x + 1., 1., denominator * x, x);
            let mut approximation = p1 / q1;
            for count in 1usize.. {
                *self.work = self.work.checked_sub(1)?;
                y += 1.;
                let numerator = y * count as f64;
                denominator += 2.;
                let p = p1 * denominator - p2 * numerator;
                let q = q1 * denominator - q2 * numerator;
                let mut finished = false;
                if q != 0. {
                    let ratio = p / q;
                    finished = ((approximation - ratio) / ratio).abs() <= f64::EPSILON * 0.5;
                    approximation = ratio;
                }
                (p2, p1, q2, q1) = (p1, p, q1, q);
                if p.abs() > 1. / f64::EPSILON {
                    p2 *= f64::EPSILON;
                    p1 *= f64::EPSILON;
                    q2 *= f64::EPSILON;
                    q1 *= f64::EPSILON;
                }
                if finished {
                    break;
                }
            }
            factor * approximation
        } else {
            let mut denominator = a;
            let mut summand = 1. / a;
            let mut sum = summand;
            loop {
                *self.work = self.work.checked_sub(1)?;
                denominator += 1.;
                summand = summand * x / denominator;
                sum += summand;
                if summand / sum <= f64::EPSILON * 0.5 {
                    break;
                }
            }
            factor * sum
        };
        Some(if continued == upper {
            result
        } else {
            1. - result
        })
    }

    fn chi_inverse(&mut self, probability: f64, degrees: f64, mut upper: bool) -> Option<f64> {
        let mut p = probability;
        if p > 0.5 {
            p = 1. - p;
            upper = !upper;
        }
        let a = degrees / 2.;
        let z = super::math::inverse(p) * if upper { -1. } else { 1. };
        let base = 1. - 2. / (9. * degrees) + z * (2. / (9. * degrees)).sqrt();
        let seed = if !upper && (a <= 1. || base <= 0.) {
            ((p.ln() + log_gamma(a + 1.)) / a + std::f64::consts::LN_2).exp()
        } else {
            degrees * base.max(0.01).powi(3)
        };
        // The small lower-tail estimate is asymptotically exact here; a
        // rounded zero means that no positive binary64 quantile is representable.
        if !upper && seed == 0. {
            return Some(0.);
        }
        let mut high = degrees.max(seed).max(1.);
        loop {
            *self.work = self.work.checked_sub(1)?;
            let value = self.incomplete(a, high / 2., upper)?;
            if if upper { value <= p } else { value >= p } {
                break;
            }
            high *= 2.;
        }
        let mut low = 0.;
        let mut x = seed.max(f64::from_bits(1)).min(high);
        for _ in 0..128 {
            *self.work = self.work.checked_sub(1)?;
            let value = self.incomplete(a, x / 2., upper)?;
            let residual = value - p;
            if residual.abs() <= p * 2. * f64::EPSILON {
                return Some(x);
            }
            if if upper { value <= p } else { value >= p } {
                high = x;
            } else {
                low = x;
            }
            if high - low <= 2. * f64::EPSILON * high {
                return Some((low + high) / 2.);
            }
            let density = chi_density(x, degrees, self.work)?;
            // A linear Newton step advances only about two units when a
            // right-tail seed undershoots a very distant quantile. Newton on
            // log probability reaches those tiny tails without hundreds of
            // iterations; use the ordinary residual close to the root.
            let adjustment = if value > 0. && (value > p * 2. || value < p / 2.) {
                (value.ln() - p.ln()) * (value / density)
            } else {
                residual / density
            };
            let candidate = x + if upper { adjustment } else { -adjustment };
            let next = if candidate.is_finite() && candidate > low && candidate < high {
                candidate
            } else {
                (low + high) / 2.
            };
            if next == x {
                return Some(x);
            }
            x = next;
        }
        self.error = Some("#NUM!");
        Some(x)
    }

    fn inverse(&mut self, probability: f64, shape: f64, scale: f64) -> Option<f64> {
        let value = |this: &mut Self, x| {
            if x <= 0. {
                Some(probability)
            } else {
                Some(probability - this.incomplete(shape, x / scale, false)?)
            }
        };
        let change = |a: f64, b: f64| (a < 0. && b > 0.) || (a > 0. && b < 0.);
        let start = shape * scale;
        let (mut a, mut b) = (start * 0.5, start);
        let (mut ay, mut by) = (value(self, a)?, value(self, b)?);
        let (mut sa, mut sb) = (Sum::default(), Sum::default());
        sa.add(a);
        sa.total();
        sb.add(b);
        sb.total();
        for _ in 0..1000 {
            if change(ay, by) {
                break;
            }
            *self.work = self.work.checked_sub(1)?;
            if ay.abs() <= by.abs() {
                let previous = sa;
                let mut difference = sa;
                difference.subtract(sb);
                sa.add(difference.total() * 2.);
                if sa.total() < 0. {
                    sa = Sum::default();
                }
                sb = previous;
                by = ay;
                ay = value(self, sa.total())?;
            } else {
                let previous = sb;
                let mut difference = sb;
                difference.subtract(sa);
                sb.add(difference.total() * 2.);
                sa = previous;
                ay = by;
                by = value(self, sb.total())?;
            }
        }
        a = sa.total();
        b = sb.total();
        if ay == 0. {
            return Some(a);
        }
        if by == 0. {
            return Some(b);
        }
        if !change(ay, by) {
            self.error = Some("Err:523");
            return Some(0.);
        }
        let (mut px, mut py, mut qx, mut qy, mut rx, mut ry) = (a, ay, b, by, a, ay);
        let mut sx = 0.5 * (a + b);
        let mut interpolate = true;
        for _ in 0..500 {
            if !(ry.abs() > 1e-307 && b - a > a.abs().max(b.abs()) * f64::EPSILON) {
                break;
            }
            *self.work = self.work.checked_sub(1)?;
            if interpolate {
                if py != qy && qy != ry && ry != py {
                    sx = px * ry * qy / (ry - py) / (qy - py)
                        + rx * qy * py / (qy - ry) / (py - ry)
                        + qx * py * ry / (py - qy) / (ry - qy);
                    interpolate = a < sx && sx < b;
                } else {
                    interpolate = false;
                }
            }
            if !interpolate {
                sx = 0.5 * (a + b);
                qx = b;
                qy = by;
                interpolate = true;
            }
            (px, qx, rx) = (qx, rx, sx);
            (py, qy, ry) = (qy, ry, value(self, sx)?);
            if change(ay, ry) {
                b = rx;
                by = ry;
            } else {
                a = rx;
                ay = ry;
            }
            interpolate = interpolate && ry.abs() * 2. <= qy.abs();
        }
        Some(rx)
    }
}

pub(in super::super) fn calculate(name: &str, values: [f64; 4], work: &mut usize) -> Option<Value> {
    let [x, a, b, cumulative] = values;
    let mut calculation = Calculation { work, error: None };
    let result = match name {
        "CHISQ.DIST" | "CHISQ.DIST.RT" | "CHIDIST" => {
            if x < 0. || !(1. ..=10_000_000_000.).contains(&a) {
                return Some(Value::Error("#NUM!"));
            }
            if name == "CHISQ.DIST" && b == 0. {
                chi_density(x, a, calculation.work)?
            } else {
                let upper = name != "CHISQ.DIST";
                if a == 1. && x > 0. && x < f64::MIN_POSITIVE {
                    let lower = x.sqrt() * (2. / std::f64::consts::PI).sqrt();
                    if upper { 1. - lower } else { lower }
                } else {
                    calculation.incomplete(a / 2., x / 2., upper)?
                }
            }
        }
        "CHISQ.INV" | "CHISQ.INV.RT" | "CHIINV" => {
            let upper = name != "CHISQ.INV";
            if !(1. ..=10_000_000_000.).contains(&a)
                || !(0. ..=1.).contains(&x)
                || x == if upper { 0. } else { 1. }
            {
                return Some(Value::Error("#NUM!"));
            }
            if x == if upper { 1. } else { 0. } {
                0.
            } else if a == 2. {
                -2. * if upper { x.ln() } else { (-x).ln_1p() }
            } else {
                calculation.chi_inverse(x, a, upper)?
            }
        }
        "GAMMA" => {
            if x <= 0. && x == approximate(x).floor() {
                return Some(Value::Error("Err:502"));
            }
            gamma(x)
        }
        "GAMMALN" | "GAMMALN.PRECISE" => {
            if x <= 0. {
                return Some(Value::Error("Err:502"));
            }
            log_gamma(x)
        }
        "GAMMAINV" | "GAMMA.INV" => {
            if a <= 0. || b <= 0. || !(0. ..1.).contains(&x) {
                return Some(Value::Error("Err:502"));
            }
            if x == 0. {
                0.
            } else {
                calculation.inverse(x, a, b)?
            }
        }
        "POISSON" | "POISSON.DIST" => {
            let x = approximate(x).floor();
            if a <= 0. || x < 0. {
                return Some(Value::Error("Err:502"));
            }
            if b == 0. {
                if a > 712. {
                    exp(x * ln(a) - a - log_gamma(x + 1.))
                } else {
                    let mut value = 1.;
                    let mut index = 0.;
                    while index < x {
                        *calculation.work = calculation.work.checked_sub(1)?;
                        value *= a / (index + 1.);
                        index += 1.;
                    }
                    value * exp(-a)
                }
            } else if a > 712. {
                calculation.incomplete(x + 1., a, true)?
            } else if x >= 936. {
                1.
            } else {
                let mut term = exp(-a);
                let mut sum = Sum::default();
                sum.add(term);
                sum.total();
                for index in 1..=x as u32 {
                    *calculation.work = calculation.work.checked_sub(1)?;
                    term = term * a / f64::from(index);
                    sum.add(term);
                }
                sum.total()
            }
        }
        _ => {
            if a <= 0. || b <= 0. || name == "GAMMA.DIST" && x < 0. {
                return Some(Value::Error("Err:502"));
            }
            if cumulative != 0. {
                if x <= 0. {
                    0.
                } else {
                    calculation.incomplete(a, x / b, false)?
                }
            } else if x < 0. {
                0.
            } else if x == 0. {
                if a < 1. {
                    return Some(Value::Error("#DIV/0!"));
                }
                if a == 1. { 1. / b } else { 0. }
            } else {
                let scaled = x / b;
                if scaled > 1. && !(ln(scaled) * (a - 1.) < ln(f64::MAX) && a < MAX_GAMMA) {
                    exp((a - 1.) * ln(scaled) - scaled - ln(b) - log_gamma(a))
                } else {
                    let divisor = if a < MAX_GAMMA {
                        gamma(a)
                    } else {
                        exp(log_gamma(a))
                    };
                    scaled.powf(a - 1.) * exp(-scaled) / b / divisor
                }
            }
        }
    };
    Some(
        calculation
            .error
            .map_or_else(|| Value::number(result), Value::Error),
    )
}

#[cfg(test)]
mod tests {
    use super::calculate;

    #[test]
    fn boost_normalized_gamma_reference_cases() {
        let cases: &[[f64; 4]] = include!("office_formula_gamma_reference.rs");
        assert_eq!(cases.len(), 287);
        let mut failures = Vec::new();
        for &[a, x, q, p] in cases {
            for (upper, expected) in [(true, q), (false, p)] {
                let mut work = 128 * 1024 * 1024;
                let mut calculation = super::Calculation {
                    work: &mut work,
                    error: None,
                };
                let actual = calculation.incomplete(a, x, upper).unwrap();
                if !actual.is_finite() || (actual - expected).abs() > expected.abs() * 3e-12 {
                    failures.push(format!(
                        "a={a:e}, x={x:e}, upper={upper}: {actual:e} != {expected:e}"
                    ));
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn statistical_iterations_stop_when_the_work_budget_is_exhausted() {
        for (name, values) in [
            ("POISSON", [1e300, 1., 0., 1.]),
            ("GAMMADIST", [1e6, 1e6, 1., 1.]),
            ("GAMMAINV", [0.5, 200., 1., 1.]),
        ] {
            let mut work = 128;
            assert!(calculate(name, values, &mut work).is_none(), "{name}");
            assert_eq!(work, 0, "{name}");
        }
    }
}

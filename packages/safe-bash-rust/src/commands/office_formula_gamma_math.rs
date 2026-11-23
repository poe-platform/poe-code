// Gamma algorithms adapted from LibreOffice Calc 24.8, interpr3.cxx and interpr6.cxx.
// This Source Code Form is subject to the terms of the Mozilla Public License,
// v. 2.0. If a copy of the MPL was not distributed with this file, You can
// obtain one at http://mozilla.org/MPL/2.0/.
//
// The original files incorporate work licensed to the Apache Software
// Foundation (ASF) under contributor license agreements. The ASF licenses that
// work under the Apache License, Version 2.0; see
// http://www.apache.org/licenses/LICENSE-2.0 .
use super::super::{power, rounding::approximate, summation::Sum};
use super::logarithm::ln;
use super::{Value, math::exp};

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
    let half_power = power::pow(shifted, x / 2. - 0.25);
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

fn log_gamma(x: f64) -> f64 {
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

struct Calculation<'a> {
    work: &'a mut usize,
    error: Option<&'static str>,
}

impl Calculation<'_> {
    fn incomplete(&mut self, a: f64, x: f64, upper: bool) -> Option<f64> {
        let factor = exp(a * ln(x) - x - log_gamma(a));
        let continued = x > a + 1.;
        let result = if continued {
            let mut y = 1. - a;
            let mut denominator = x + 2. - a;
            let (mut p1, mut p2, mut q1, mut q2) = (x + 1., 1., denominator * x, x);
            let mut approximation = p1 / q1;
            let mut finished = false;
            for count in 1..=10000 {
                *self.work = self.work.checked_sub(1)?;
                y += 1.;
                let numerator = y * f64::from(count);
                denominator += 2.;
                let p = p1 * denominator - p2 * numerator;
                let q = q1 * denominator - q2 * numerator;
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
            if !finished {
                self.error = Some("Err:523");
            }
            factor * approximation
        } else {
            let mut denominator = a;
            let mut summand = 1. / a;
            let mut sum = summand;
            let mut count = 1;
            loop {
                *self.work = self.work.checked_sub(1)?;
                denominator += 1.;
                summand = summand * x / denominator;
                sum += summand;
                count += 1;
                if !(summand / sum > f64::EPSILON * 0.5 && count <= 10000) {
                    break;
                }
            }
            if count > 10000 {
                self.error = Some("Err:523");
            }
            factor * sum
        };
        Some(if continued == upper {
            result
        } else {
            1. - result
        })
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

pub(super) fn calculate(name: &str, values: [f64; 4], work: &mut usize) -> Option<Value> {
    let [x, a, b, cumulative] = values;
    let mut calculation = Calculation { work, error: None };
    let result = match name {
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
                    power::pow(scaled, a - 1.) * exp(-scaled) / b / divisor
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

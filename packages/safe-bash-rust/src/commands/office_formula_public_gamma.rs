// SPDX-License-Identifier: GPL-2.0-or-later
// Preserve spreadsheet-engine scientific.ts's paired recurrence and rounding.
use super::super::{financial::options::normal::exp, math::logarithm::log, trigonometry};
use super::public_probability::{factorial, log_gamma};

type Pair = [f64; 2];
const LOG_TWO: Pair = [std::f64::consts::LN_2, 2.3190468138462996e-17];

fn add(a: Pair, b: Pair) -> Pair {
    let high = a[0] + b[0];
    let split = high - a[0];
    let low = (a[0] - (high - split)) + (b[0] - split) + a[1] + b[1];
    let result = high + low;
    [result, low - (result - high)]
}

fn multiply(a: Pair, b: Pair) -> Pair {
    let high = a[0] * b[0];
    let low = a[0].mul_add(b[0], -high) + a[0] * b[1] + a[1] * b[0];
    add([high, 0.], [low, 0.])
}

fn divide(a: Pair, b: Pair) -> Pair {
    let high = a[0] / b[0];
    let product = multiply([high, 0.], b);
    let remainder = add(a, [-product[0], -product[1]]);
    add([high, 0.], [(remainder[0] + remainder[1]) / b[0], 0.])
}

fn power_two(exponent: i32) -> f64 {
    if exponent < -1022 {
        f64::from_bits(1 << (exponent + 1074))
    } else {
        f64::from_bits(((exponent + 1023) as u64) << 52)
    }
}

fn logarithm(x: Pair, work: &mut usize) -> Option<Pair> {
    let exponent = log(x[0], 2).floor();
    let power = power_two(exponent as i32);
    let mantissa = [x[0] / power, x[1] / power];
    let ratio = divide(add(mantissa, [-1., 0.]), add(mantissa, [1., 0.]));
    let square = multiply(ratio, ratio);
    let mut term = ratio;
    let mut sum = ratio;
    for i in (3..145).step_by(2) {
        *work = work.checked_sub(1)?;
        term = multiply(term, square);
        sum = add(sum, divide(term, [f64::from(i), 0.]));
        if term[0].abs() < 1e-34 {
            break;
        }
    }
    Some(add(
        multiply(sum, [2., 0.]),
        multiply(LOG_TWO, [exponent, 0.]),
    ))
}

fn exponential(x: Pair, work: &mut usize) -> Option<(Pair, i32)> {
    let exponent = (x[0] / std::f64::consts::LN_2).round();
    let multiple = multiply(LOG_TWO, [exponent, 0.]);
    let reduced = add(x, [-multiple[0], -multiple[1]]);
    let mut term = [1., 0.];
    let mut sum = term;
    for i in 1..45 {
        *work = work.checked_sub(1)?;
        term = divide(multiply(term, reduced), [f64::from(i), 0.]);
        sum = add(sum, term);
        if term[0].abs() < 1e-34 {
            break;
        }
    }
    Some((sum, exponent as i32))
}

fn recurrent(x: f64, work: &mut usize) -> Option<f64> {
    if x > 172. {
        return Some(f64::INFINITY);
    }
    let mut shifted = [x, 0.];
    let mut recurrence = [1., 0.];
    let mut recurrence_exponent = 0;
    let small = x > 0. && x < 0.5;
    if small {
        shifted = add(shifted, [1., 0.]);
    }
    while shifted[0] < 32. {
        *work = work.checked_sub(1)?;
        recurrence = multiply(recurrence, shifted);
        if recurrence[0].abs() > power_two(500) {
            recurrence = [
                recurrence[0] * power_two(-256),
                recurrence[1] * power_two(-256),
            ];
            recurrence_exponent += 256;
        }
        shifted = add(shifted, [1., 0.]);
    }
    let inverse = divide([1., 0.], shifted);
    let square = multiply(inverse, inverse);
    let mut term = inverse;
    let mut adjustment = [0., 0.];
    for (numerator, denominator) in [
        (1., 12.),
        (-1., 360.),
        (1., 1260.),
        (-1., 1680.),
        (1., 1188.),
        (-691., 360360.),
        (1., 156.),
        (-3617., 122400.),
        (43867., 244188.),
        (-174611., 125400.),
        (77683., 5796.),
        (-236364091., 1506960.),
    ] {
        *work = work.checked_sub(1)?;
        adjustment = add(
            adjustment,
            multiply(term, divide([numerator, 0.], [denominator, 0.])),
        );
        term = multiply(term, square);
    }
    let mut value = multiply(add(shifted, [-0.5, 0.]), logarithm(shifted, work)?);
    value = add(value, [-shifted[0], -shifted[1]]);
    value = add(value, [0.9189385332046728, -3.8782941580672414e-17]);
    value = add(value, adjustment);
    let (mantissa, mut exponent) = exponential(value, work)?;
    exponent -= recurrence_exponent;
    let mut mantissa = divide(mantissa, recurrence);
    if small {
        let input_exponent = log(x, 2).floor() as i32;
        mantissa = divide(mantissa, [x / power_two(input_exponent), 0.]);
        exponent -= input_exponent;
    }
    // Admission of x - 1 can round a negative argument onto a pole.
    if !mantissa[0].is_finite() {
        return Some(f64::NAN);
    }
    let normalization = log(mantissa[0].abs(), 2).floor() as i32;
    let power = power_two(normalization);
    mantissa = [mantissa[0] / power, mantissa[1] / power];
    exponent += normalization;
    let rounded = mantissa[0] + mantissa[1];
    Some(if exponent > 1023 {
        f64::INFINITY.copysign(rounded)
    } else if exponent < -1075 {
        0f64.copysign(rounded)
    } else if exponent == -1075 {
        rounded / 2. * f64::from_bits(1)
    } else {
        rounded * power_two(exponent)
    })
}

pub(super) fn gamma(x: f64, work: &mut usize) -> Option<f64> {
    if x <= 0. {
        let sine = trigonometry::pi_reduced(x, false);
        if sine != 0. && x >= -180. {
            return recurrent(if x < -1.5 { (x - 1.) + 1. } else { x }, work);
        }
        return Some(if sine == 0. {
            f64::NAN
        } else {
            sine.signum()
                * exp(log(std::f64::consts::PI / sine.abs(), 0) - log_gamma(1. - x, work)?)
        });
    }
    if x == x.floor() && x <= 171. {
        factorial(x as u32 - 1, work)
    } else {
        recurrent(x, work)
    }
}

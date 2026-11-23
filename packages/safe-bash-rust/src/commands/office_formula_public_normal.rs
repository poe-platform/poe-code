// SPDX-License-Identifier: GPL-2.0-or-later
// AS241/Wichura in the public spreadsheet engine's normal-distribution.ts
// evaluation order, including fused polynomial steps and V8 logarithms.
use super::super::{
    financial::options::normal,
    math::{expm1::expm1, logarithm::log},
};

pub(super) fn probability(x: f64, lower: bool, logarithmic: bool) -> f64 {
    let z = if lower { x } else { -x };
    if !logarithmic {
        return normal::cdf(z);
    }
    if !z.is_finite() {
        return if z == f64::INFINITY {
            0.
        } else if z == f64::NEG_INFINITY {
            f64::NEG_INFINITY
        } else {
            z
        };
    }
    let y = z.abs();
    if y <= 32f64.sqrt() {
        return log(normal::cdf(z), 0);
    }
    let tail = -y * y / 2. + log(normal::tail_ratio(y), 0);
    if z < 0. {
        tail
    } else {
        (-normal::exp(tail)).ln_1p()
    }
}

fn polynomial(x: f64, coefficients: &[f64]) -> f64 {
    coefficients[1..]
        .iter()
        .fold(coefficients[0], |value, &coefficient| {
            value.mul_add(x, coefficient)
        })
}

pub(super) fn inverse(probability: f64, lower: bool, logarithmic: bool) -> f64 {
    if probability.is_nan()
        || if logarithmic {
            probability > 0.
        } else {
            !(0. ..=1.).contains(&probability)
        }
    {
        return f64::NAN;
    }
    if probability == if logarithmic { f64::NEG_INFINITY } else { 0. } {
        return if lower {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    if probability == if logarithmic { 0. } else { 1. } {
        return if lower {
            f64::INFINITY
        } else {
            f64::NEG_INFINITY
        };
    }
    let p = if logarithmic {
        if lower {
            normal::exp(probability)
        } else {
            -expm1(probability)
        }
    } else if lower {
        probability
    } else {
        0.5 - probability + 0.5
    };
    let q = p - 0.5;
    if q.abs() <= 0.425 {
        let r = 0.180625 - q * q;
        return q * polynomial(
            r,
            &[
                2509.0809287301227,
                33430.57558358813,
                67265.7709270087,
                45921.95393154987,
                13731.69376550946,
                1971.5909503065513,
                133.14166789178438,
                3.3871328727963665,
            ],
        ) / polynomial(
            r,
            &[
                5226.495278852854,
                28729.085735721943,
                39307.89580009271,
                21213.794301586597,
                5394.196021424751,
                687.1870074920579,
                42.31333070160091,
                1.,
            ],
        );
    }
    let tail = if q > 0. {
        if logarithmic {
            if lower {
                -expm1(probability)
            } else {
                normal::exp(probability)
            }
        } else if lower {
            0.5 - probability + 0.5
        } else {
            probability
        }
    } else {
        p
    };
    let r = (-(if logarithmic && (lower && q <= 0. || !lower && q > 0.) {
        probability
    } else {
        log(tail, 0)
    }))
    .sqrt();
    let value = if r <= 5. {
        let r = r - 1.6;
        polynomial(
            r,
            &[
                0.0007745450142783414,
                0.022723844989269184,
                0.2417807251774506,
                1.2704582524523684,
                3.6478483247632045,
                5.769497221460691,
                4.630337846156546,
                1.4234371107496835,
            ],
        ) / polynomial(
            r,
            &[
                1.0507500716444169e-09,
                0.0005475938084995345,
                0.015198666563616457,
                0.14810397642748008,
                0.6897673349851,
                1.6763848301838038,
                2.053191626637759,
                1.,
            ],
        )
    } else {
        let r = r - 5.;
        polynomial(
            r,
            &[
                2.0103343992922881e-07,
                2.7115555687434876e-05,
                0.0012426609473880784,
                0.026532189526576124,
                0.29656057182850487,
                1.7848265399172913,
                5.463784911164114,
                6.657904643501103,
            ],
        ) / polynomial(
            r,
            &[
                2.0442631033899397e-15,
                1.421511758316446e-07,
                1.8463183175100548e-05,
                0.0007868691311456133,
                0.014875361290850615,
                0.1369298809227358,
                0.599832206555888,
                1.,
            ],
        )
    };
    if q < 0. { -value } else { value }
}

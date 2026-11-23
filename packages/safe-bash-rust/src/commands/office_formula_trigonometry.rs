// SPDX-License-Identifier: GPL-2.0-or-later
// Pi-scaled functions adapt GOffice quadrant reduction, as retained by the
// production spreadsheet engine's math.ts.
use std::f64::consts::{FRAC_1_SQRT_2, PI};

pub(super) fn arguments(name: &str) -> Option<usize> {
    Some(match name {
        "PI" => 0,
        "ATAN2" => 2,
        "SIN" | "COS" | "TAN" | "ASIN" | "ACOS" | "ATAN" | "SINH" | "COSH" | "TANH" | "ASINH"
        | "ACOSH" | "ATANH" | "SEC" | "CSC" | "COT" | "SECH" | "CSCH" | "COTH" | "ACOT"
        | "ACOTH" | "RADIANS" | "DEGREES" | "GD" | "SINPI" | "COSPI" | "TANPI" | "COTPI" => 1,
        _ => return None,
    })
}

pub(super) fn calculate(name: &str, x: f64, y: f64) -> Result<f64, &'static str> {
    let x = if x == 0. { 0. } else { x };
    let y = if y == 0. { 0. } else { y };
    let result = match name {
        "PI" => PI,
        "SIN" => x.sin(),
        "COS" => x.cos(),
        "TAN" => x.tan(),
        "ASIN" => x.asin(),
        "ACOS" => x.acos(),
        "ATAN" => x.atan(),
        "ACOT" => (1. / x).atan(),
        "ATAN2" if x == 0. && y == 0. => return Err("#DIV/0!"),
        "ATAN2" => y.atan2(x),
        "SINH" => x.sinh(),
        "COSH" => x.cosh(),
        "TANH" => x.tanh(),
        "ASINH" => x.asinh(),
        "ACOSH" => x.acosh(),
        "ATANH" => x.atanh(),
        "ACOTH" if x.abs() <= 1. => return Err("#NUM!"),
        "ACOTH" if x.abs() > 2. => (2. / (x - 1.)).ln_1p() / 2.,
        "ACOTH" => x.signum() * ((x.abs() - 1.) / (x.abs() + 1.)).ln() / -2.,
        "SEC" => 1. / x.cos(),
        "CSC" => 1. / x.sin(),
        "COT" => 1. / x.tan(),
        "SECH" => 1. / x.cosh(),
        "CSCH" => 1. / x.sinh(),
        "COTH" => 1. / x.tanh(),
        "RADIANS" => x * PI / 180.,
        "DEGREES" => x * 180. / PI,
        "GD" => 2. * (x / 2.).tanh().atan(),
        "SINPI" => pi_reduced(x, false),
        "COSPI" => pi_reduced(x, true),
        "TANPI" => pi_reduced(x, false) / pi_reduced(x, true),
        "COTPI" => pi_reduced(x, true) / pi_reduced(x, false),
        _ => unreachable!(),
    };
    if result.is_finite() {
        Ok(if result == 0. { 0. } else { result })
    } else {
        Err("#NUM!")
    }
}

pub(super) fn pi_reduced(x: f64, cosine: bool) -> f64 {
    let negative = x < 0.;
    let mut r = x.abs() % 2.;
    let mut quadrant = 0;
    if r >= 1. {
        r -= 1.;
        quadrant += 2;
    }
    if r >= 0.5 {
        r -= 0.5;
        quadrant += 1;
    }
    if r > 0.25 {
        r -= 0.5;
        quadrant += 1;
    }
    if negative {
        r = -r;
        quadrant = 4 - quadrant;
        if r == -0.25 {
            r += 0.5;
            quadrant += 3;
        }
    }
    if !cosine && r == 0. && quadrant & 1 == 0 {
        return 0f64.copysign(x);
    }
    if cosine && r == 0. && quadrant & 1 == 1 {
        return 0.;
    }
    if cosine {
        quadrant += 1;
    }
    let y = if r == 0. {
        f64::from(quadrant & 1)
    } else if r == 0.25 {
        FRAC_1_SQRT_2
    } else if quadrant & 1 != 0 {
        (PI * r).cos()
    } else {
        (PI * r).sin()
    };
    if quadrant & 2 != 0 { 0. - y } else { y }
}

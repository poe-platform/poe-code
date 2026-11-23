// SPDX-License-Identifier: GPL-2.0-or-later
// Gnumeric 1.12.61's lower-tail Cody approximation, as used by the production
// spreadsheet engine (normal-distribution.ts). Original algorithm by W. J.
// Cody, with R adaptations by Ross Ihaka and the R Core team.

// Gnumeric's bivariate quadrature and quadrant reductions, as retained by
// the production derivative functions.
pub(super) fn bivariate(a: f64, b: f64, rho: f64, work: &mut usize) -> Option<f64> {
    Some(if a <= 0. && b <= 0. && rho <= 0. {
        *work = work.checked_sub(30)?;
        let points = [
            (0.24840615, 0.10024215),
            (0.39233107, 0.48281397),
            (0.21141819, 1.0609498),
            (0.03324666, 1.7797294),
            (0.00082485334, 2.6697604),
        ];
        let denominator = (2. * (1. - rho * rho)).sqrt();
        let a1 = a / denominator;
        let b1 = b / denominator;
        let mut sum = 0.;
        for (wa, ya) in points {
            for (wb, yb) in points {
                sum += wa
                    * wb
                    * exp(a1 * (2. * ya - a1)
                        + b1 * (2. * yb - b1)
                        + 2. * rho * (ya - a1) * (yb - b1));
            }
        }
        (1. - rho * rho).sqrt() / std::f64::consts::PI * sum
    } else if a <= 0. && b >= 0. && rho >= 0. {
        cdf(a) - bivariate(a, -b, -rho, work)?
    } else if a >= 0. && b <= 0. && rho >= 0. {
        cdf(b) - bivariate(-a, b, -rho, work)?
    } else if a >= 0. && b >= 0. && rho <= 0. {
        cdf(a) + cdf(b) - 1. + bivariate(-a, -b, rho, work)?
    } else if a * b * rho > 0. {
        let denominator = (a * a - 2. * rho * a * b + b * b).sqrt();
        let rho1 = (rho * a - b) * a.signum() / denominator;
        let rho2 = (rho * b - a) * b.signum() / denominator;
        // Both signs are nonzero here. The original integer division makes
        // (1 - sign(a) * sign(b)) / 4 zero even for opposite signs.
        bivariate(a, 0., rho1, work)? + bivariate(b, 0., rho2, work)?
    } else {
        f64::NAN
    })
}

pub(in super::super::super) fn cdf(x: f64) -> f64 {
    if x.is_nan() {
        return x;
    }
    let y = x.abs();
    if y <= 0.67448975 {
        let a = [
            2.2352520354606837,
            161.02823106855587,
            1067.6894854603709,
            18154.98125334356,
            0.06568233791820745,
        ];
        let b = [
            47.202581904688245,
            976.0985517377767,
            10260.932208618979,
            45507.78933502673,
        ];
        let square = if y > f64::EPSILON / 2. { x * x } else { 0. };
        let mut numerator = a[4] * square;
        let mut denominator = square;
        for i in 0..3 {
            numerator = (numerator + a[i]) * square;
            denominator = (denominator + b[i]) * square;
        }
        return 0.5 + x * (numerator + a[3]) / (denominator + b[3]);
    }
    let temp = if y <= 32f64.sqrt() {
        let c = [
            0.39894151208813466,
            8.883149794388377,
            93.50665613217785,
            597.2702763948002,
            2494.5375852903726,
            6848.190450536283,
            11602.65143764735,
            9842.714838383978,
            1.0765576773720192e-08,
        ];
        let d = [
            22.266688044328117,
            235.387901782625,
            1519.3775994075547,
            6485.558298266761,
            18615.571640885097,
            34900.95272114598,
            38912.00328609327,
            19685.429676859992,
        ];
        let mut numerator = c[8] * y;
        let mut denominator = y;
        for i in 0..7 {
            numerator = (numerator + c[i]) * y;
            denominator = (denominator + d[i]) * y;
        }
        (numerator + c[7]) / (denominator + d[7])
    } else if x > -37.5193 && x < 8.2924 {
        tail_ratio(y)
    } else {
        return if x > 0. { 1. } else { 0. };
    };
    let truncated = (y * 16.).trunc() / 16.;
    let delta = (y - truncated) * (y + truncated);
    let lower = exp(-truncated * truncated * 0.5) * exp(-delta * 0.5) * temp;
    if x > 0. { 1. - lower } else { lower }
}

pub(in super::super::super) fn tail_ratio(y: f64) -> f64 {
    let p = [
        0.215898534057957,
        0.12740116116024736,
        0.022235277870649807,
        0.0014216191932278934,
        2.9112874951168793e-05,
        0.023073441764940174,
    ];
    let q = [
        1.284260096144911,
        0.4682382124808651,
        0.06598813786892856,
        0.0037823963320275824,
        7.297515550839662e-05,
    ];
    let square = 1. / (y * y);
    let mut numerator = p[5] * square;
    let mut denominator = square;
    for i in 0..4 {
        numerator = (numerator + p[i]) * square;
        denominator = (denominator + q[i]) * square;
    }
    (0.3989422804014327 - square * (numerator + p[4]) / (denominator + q[4])) / y
}

// Exponential adapted from fdlibm through V8's ieee754.cc. Keep its rounding:
// one ulp in a normal tail can be amplified when option prices subtract tails.
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunSoft, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved.
// Modified significantly by Google Inc.
// Copyright 2016 the V8 project authors. All rights reserved.
pub(in super::super::super) fn exp(mut x: f64) -> f64 {
    let high = (x.to_bits() >> 32) as u32 & 0x7fffffff;
    if high >= 0x40862e42 {
        if !x.is_finite() {
            return if x == f64::NEG_INFINITY { 0. } else { x + x };
        }
        if x > 709.782712893384 {
            return f64::INFINITY;
        }
        if x < -745.1332191019411 {
            return 0.;
        }
    }
    let mut k = 0;
    let mut hi = 0.;
    let mut lo = 0.;
    if high > 0x3fd62e42 {
        if high < 0x3ff0a2b2 {
            if x == 1. {
                return std::f64::consts::E;
            }
            k = if x.is_sign_negative() { -1 } else { 1 };
            hi = x - f64::from(k) * 0.6931471803691238;
            lo = f64::from(k) * 1.9082149292705877e-10;
        } else {
            k = (std::f64::consts::LOG2_E * x + if x.is_sign_negative() { -0.5 } else { 0.5 })
                as i32;
            hi = x - f64::from(k) * 0.6931471803691238;
            lo = f64::from(k) * 1.9082149292705877e-10;
        }
        x = hi - lo;
    } else if high < 0x3e300000 {
        return 1. + x;
    }
    let t = x * x;
    let c = x - t
        * (0.16666666666666602
            + t * (-0.0027777777777015593
                + t * (0.00006613756321437934
                    + t * (-0.0000016533902205465252 + t * 4.1381367970572385e-8))));
    if k == 0 {
        return 1. - (x * c / (c - 2.) - x);
    }
    let y = 1. - ((lo - x * c / (2. - c)) - hi);
    if k == 1024 {
        y * 2. * f64::from_bits(2046 << 52)
    } else if k >= -1021 {
        y * f64::from_bits(((k + 1023) as u64) << 52)
    } else {
        y * f64::from_bits(((k + 2023) as u64) << 52) * f64::from_bits(23 << 52)
    }
}

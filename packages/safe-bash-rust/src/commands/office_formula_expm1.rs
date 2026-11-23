// Portable exp(x)-1 adapted from FreeBSD msun s_expm1.c via Rust libm.
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunPro, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved.

pub(in super::super) fn expm1(mut x: f64) -> f64 {
    let high = ((x.to_bits() >> 32) & 0x7fffffff) as u32;
    let negative = x.is_sign_negative();
    if high >= 0x4043687a {
        if x.is_nan() {
            return x;
        }
        if negative {
            return -1.;
        }
        if x > 709.782712893384 {
            return f64::INFINITY;
        }
    }
    let (k, correction) = if high > 0x3fd62e42 {
        let (high, low, k) = if high < 0x3ff0a2b2 {
            if negative {
                (x + 0.6931471803691238, -1.9082149292705877e-10, -1)
            } else {
                (x - 0.6931471803691238, 1.9082149292705877e-10, 1)
            }
        } else {
            let k = (std::f64::consts::LOG2_E * x + if negative { -0.5 } else { 0.5 }) as i32;
            (
                x - k as f64 * 0.6931471803691238,
                k as f64 * 1.9082149292705877e-10,
                k,
            )
        };
        x = high - low;
        (k, (high - x) - low)
    } else if high < 0x3c900000 {
        return x;
    } else {
        (0, 0.)
    };
    let half = 0.5 * x;
    let square = x * half;
    let r = 1.
        + square
            * (-0.03333333333333313
                + square
                    * (0.0015873015872548146
                        + square
                            * (-0.000_079_365_075_786_748_8
                                + square
                                    * (0.000004008217827329362
                                        - square * 0.00000020109921818362437))));
    let t = 3. - r * half;
    let mut error = square * ((r - t) / (6. - x * t));
    if k == 0 {
        return x - (x * error - square);
    }
    error = x * (error - correction) - correction;
    error -= square;
    if k == -1 {
        return 0.5 * (x - error) - 0.5;
    }
    if k == 1 {
        return if x < -0.25 {
            -2. * (error - (x + 0.5))
        } else {
            1. + 2. * (x - error)
        };
    }
    let power = f64::from_bits(((1023 + k) as u64) << 52);
    if !(0..=56).contains(&k) {
        let y = x - error + 1.;
        return if k == 1024 {
            y * 2. * f64::from_bits(0x7fe0000000000000) - 1.
        } else {
            y * power - 1.
        };
    }
    let inverse = f64::from_bits(((1023 - k) as u64) << 52);
    if k < 20 {
        (x - error + (1. - inverse)) * power
    } else {
        (x - (error + inverse) + 1.) * power
    }
}

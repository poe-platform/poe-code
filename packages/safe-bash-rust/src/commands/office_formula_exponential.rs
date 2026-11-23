// Adapted from fdlibm e_exp.c, https://netlib.org/fdlibm/e_exp.c.
// Copyright (C) 2004 by Sun Microsystems, Inc. All rights reserved.
// Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved.

// Financial growth follows the JavaScript reference's fdlibm rounding.
pub(super) fn exp(mut x: f64) -> f64 {
    if !x.is_finite() {
        return if x == f64::NEG_INFINITY { 0. } else { x };
    }
    if x > 709.782712893384 {
        return f64::INFINITY;
    }
    if x < -745.1332191019411 {
        return 0.;
    }
    if x == 1. {
        return std::f64::consts::E;
    }
    let high_word = (x.to_bits() >> 32) as u32 & 0x7fff_ffff;
    let (mut high, mut low, mut k) = (0., 0., 0_i32);
    if high_word > 0x3fd6_2e42 {
        if high_word < 0x3ff0_a2b2 {
            k = if x < 0. { -1 } else { 1 };
            high = x - f64::from(k) * 0.6931471803691238;
            low = f64::from(k) * 1.9082149292705877e-10;
        } else {
            k = (std::f64::consts::LOG2_E * x + 0.5_f64.copysign(x)) as i32;
            high = x - f64::from(k) * 0.6931471803691238;
            low = f64::from(k) * 1.9082149292705877e-10;
        }
        x = high - low;
    } else if high_word < 0x3e30_0000 {
        return 1. + x;
    }
    let square = x * x;
    let correction = x - square
        * (0.16666666666666602
            + square
                * (-0.0027777777777015593
                    + square
                        * (0.00006613756321437934
                            + square
                                * (-0.0000016533902205465252
                                    + square * 0.000000041381367970572385))));
    if k == 0 {
        return 1. - ((x * correction) / (correction - 2.) - x);
    }
    let value = 1. - ((low - (x * correction) / (2. - correction)) - high);
    if k >= -1021 {
        f64::from_bits(value.to_bits().wrapping_add((i64::from(k) << 52) as u64))
    } else {
        f64::from_bits(
            value
                .to_bits()
                .wrapping_add((i64::from(k + 1000) << 52) as u64),
        ) * f64::from_bits(23 << 52)
    }
}

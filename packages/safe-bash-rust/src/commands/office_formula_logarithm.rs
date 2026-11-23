// Natural, base-2 and base-10 logarithms adapted from Sun fdlibm
// (via V8 src/base/ieee754.cc).
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunSoft, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved.

// Callers validate positive finite operands. Preserve the production
// reduction and operation order, including separate base-10 reduction.
pub(in crate::commands) fn log(mut x: f64, base: u8) -> f64 {
    let mut bits = x.to_bits();
    let mut high = (bits >> 32) as u32;
    let mut exponent = 0;
    if high < 0x00100000 {
        exponent -= 54;
        x *= 18014398509481984.;
        bits = x.to_bits();
        high = (bits >> 32) as u32;
    }
    if x == 1. && exponent == 0 {
        return 0.;
    }
    exponent += (high >> 20) as i32 - 1023;
    high &= 0x000fffff;
    if base == 10 {
        let negative = i32::from(exponent < 0);
        let normalized = f64::from_bits(
            (((high | ((1023 - negative as u32) << 20)) as u64) << 32) | (bits & 0xffffffff),
        );
        let y = (exponent + negative) as f64;
        return (y * 3.694239077158931e-13 + std::f64::consts::LOG10_E * log(normalized, 0))
            + y * 0.30102999566361177;
    }
    let i = (high + 0x95f64) & 0x100000;
    x = f64::from_bits((((high | (i ^ 0x3ff00000)) as u64) << 32) | (bits & 0xffffffff));
    exponent += (i >> 20) as i32;
    let f = x - 1.;
    let k = exponent as f64;
    if base == 0 && (0x000fffff & (2 + high)) < 3 {
        if f == 0. {
            return k * 0.6931471803691238 + k * 1.9082149292705877e-10;
        }
        let r = f * f * (0.5 - (1. / 3.) * f);
        return if exponent == 0 {
            f - r
        } else {
            k * 0.6931471803691238 - ((r - k * 1.9082149292705877e-10) - f)
        };
    }
    let half_square = 0.5 * f * f;
    let s = f / (2. + f);
    let z = s * s;
    let w = z * z;
    let t1 = w * (0.3999999999940942 + w * (0.22222198432149784 + w * 0.15313837699209373));
    let t2 = z
        * (0.6666666666666735
            + w * (0.2857142874366239 + w * (0.1818357216161805 + w * 0.14798198605116586)));
    let r = t2 + t1;
    if base == 0 {
        if ((high as i32 - 0x6147a) | (0x6b851 - high as i32)) > 0 {
            return if exponent == 0 {
                f - (half_square - s * (half_square + r))
            } else {
                k * 0.6931471803691238
                    - ((half_square - (s * (half_square + r) + k * 1.9082149292705877e-10)) - f)
            };
        }
        return if exponent == 0 {
            f - s * (f - r)
        } else {
            k * 0.6931471803691238 - ((s * (f - r) - k * 1.9082149292705877e-10) - f)
        };
    }
    let high = f64::from_bits((f - half_square).to_bits() & 0xffffffff00000000);
    let low = f - high - half_square + s * (half_square + r);
    let value_high = high * 1.4426950407214463;
    let value_low = (low + high) * 1.6751713164886512e-10 + low * 1.4426950407214463;
    let w = k + value_high;
    (value_low + ((k - w) + value_high)) + w
}

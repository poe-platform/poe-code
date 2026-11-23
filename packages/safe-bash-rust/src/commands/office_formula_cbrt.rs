// Portable cube root adapted from Sun fdlibm (s_cbrt.c).
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunPro, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved.

pub(super) fn cbrt(x: f64) -> f64 {
    if x == 0. || !x.is_finite() {
        return x;
    }
    let sign = x.to_bits() & (1 << 63);
    let high = (x.to_bits() >> 32) as u32 & 0x7fff_ffff;
    let estimate = if high < 0x0010_0000 {
        let scaled = x * 18014398509481984.;
        ((scaled.to_bits() >> 32) as u32 & 0x7fff_ffff) / 3 + 696219795
    } else {
        high / 3 + 715094163
    };
    let mut t = f64::from_bits(sign | (u64::from(estimate) << 32));
    let r = (t * t) * (t / x);
    t *= (1.87595182427177 + r * -1.8849797954337717)
        + (r * r) * 1.6214297201053545
        + ((r * r) * r) * (-0.758397934778766 + r * 0.14599619288661245);
    t = f64::from_bits((t.to_bits() + 0x8000_0000) & 0xffff_ffff_c000_0000);
    let square = t * t;
    let ratio = x / square;
    let correction = (ratio - t) / ((t + t) + ratio);
    t + t * correction
}

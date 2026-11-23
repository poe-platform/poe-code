// Error-function approximation adapted from Sun fdlibm (via musl src/math/erf.c).
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunPro, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved.

fn polynomial(x: f64, coefficients: &[f64]) -> f64 {
    coefficients
        .iter()
        .rev()
        .fold(0., |sum, coefficient| sum * x + coefficient)
}

pub(super) fn cdf(x: f64) -> f64 {
    0.5 * erfc(-x * std::f64::consts::FRAC_1_SQRT_2)
}

fn erfc(x: f64) -> f64 {
    if x.is_nan() {
        return x;
    }
    let absolute = x.abs();
    let high = (absolute.to_bits() >> 32) as u32;
    if high < 0x3feb0000 {
        if high < 0x3c700000 {
            return 1. - x;
        }
        let z = x * x;
        let ratio = polynomial(z, &PP) / polynomial(z, &QQ);
        return if x < 0. || high < 0x3fd00000 {
            1. - (x + x * ratio)
        } else {
            0.5 - (x - 0.5 + x * ratio)
        };
    }
    let result = if high < 0x3ff40000 {
        let z = absolute - 1.;
        1. - ERX - polynomial(z, &PA) / polynomial(z, &QA)
    } else if high < 0x403c0000 {
        let z = 1. / (absolute * absolute);
        let ratio = if high < 0x4006db6d {
            polynomial(z, &RA) / polynomial(z, &SA)
        } else {
            polynomial(z, &RB) / polynomial(z, &SB)
        };
        let truncated = f64::from_bits(absolute.to_bits() & 0xffff_ffff_0000_0000);
        exp(-truncated * truncated - 0.5625)
            * exp((truncated - absolute) * (truncated + absolute) + ratio)
            / absolute
    } else {
        0.
    };
    if x < 0. { 2. - result } else { result }
}

const ERX: f64 = 0.8450629115104675;
const PP: [f64; 5] = [
    0.12837916709551256,
    -0.3250421072470015,
    -0.02848174957559851,
    -0.005770270296489442,
    -2.3763016656650163e-05,
];
const QQ: [f64; 6] = [
    1.0,
    0.39791722395915535,
    0.0650222499887673,
    0.005081306281875766,
    0.00013249473800432164,
    -3.960228278775368e-06,
];
const PA: [f64; 7] = [
    -0.0023621185607526594,
    0.41485611868374833,
    -0.3722078760357013,
    0.31834661990116175,
    -0.11089469428239668,
    0.035478304325618236,
    -0.002166375594868791,
];
const QA: [f64; 7] = [
    1.0,
    0.10642088040084423,
    0.540397917702171,
    0.07182865441419627,
    0.12617121980876164,
    0.01363708391202905,
    0.011984499846799107,
];
const RA: [f64; 8] = [
    -0.009864944034847148,
    -0.6938585727071818,
    -10.558626225323291,
    -62.375332450326006,
    -162.39666946257347,
    -184.60509290671104,
    -81.2874355063066,
    -9.814329344169145,
];
const SA: [f64; 9] = [
    1.0,
    19.651271667439257,
    137.65775414351904,
    434.56587747522923,
    645.3872717332679,
    429.00814002756783,
    108.63500554177944,
    6.570249770319282,
    -0.0604244152148581,
];
const RB: [f64; 7] = [
    -0.0098649429247001,
    -0.799283237680523,
    -17.757954917754752,
    -160.63638485582192,
    -637.5664433683896,
    -1025.0951316110772,
    -483.5191916086514,
];
const SB: [f64; 8] = [
    1.0,
    30.33806074348246,
    325.7925129965739,
    1536.729586084437,
    3199.8582195085955,
    2553.0504064331644,
    474.52854120695537,
    -22.44095244658582,
];

// Wichura AS 241, using the coefficients and evaluation order in Calc 24.8.
pub(super) fn inverse(p: f64) -> f64 {
    let q = p - 0.5;
    if q.abs() <= 0.425 {
        let t = 0.180625 - q * q;
        return q * polynomial(t, &A) / polynomial(t, &B);
    }
    let t = (-(if q > 0. { 1. - p } else { p }).ln()).sqrt();
    let value = if t <= 5. {
        polynomial(t - 1.6, &C) / polynomial(t - 1.6, &D)
    } else {
        polynomial(t - 5., &E) / polynomial(t - 5., &F)
    };
    value.copysign(q)
}
const A: [f64; 8] = [
    3.3871328727963665,
    133.14166789178438,
    1971.5909503065513,
    13731.69376550946,
    45921.95393154987,
    67265.7709270087,
    33430.57558358813,
    2509.0809287301227,
];
const B: [f64; 8] = [
    1.0,
    42.31333070160091,
    687.1870074920579,
    5394.196021424751,
    21213.794301586597,
    39307.89580009271,
    28729.085735721943,
    5226.495278852854,
];
const C: [f64; 8] = [
    1.4234371107496835,
    4.630337846156546,
    5.769497221460691,
    3.6478483247632045,
    1.2704582524523684,
    0.2417807251774506,
    0.022723844989269184,
    0.0007745450142783414,
];
const D: [f64; 8] = [
    1.0,
    2.053191626637759,
    1.6763848301838038,
    0.6897673349851,
    0.14810397642748008,
    0.015198666563616457,
    0.0005475938084995345,
    1.0507500716444169e-09,
];
const E: [f64; 8] = [
    6.657904643501103,
    5.463784911164114,
    1.7848265399172913,
    0.29656057182850487,
    0.026532189526576124,
    0.0012426609473880784,
    2.7115555687434876e-05,
    2.0103343992922881e-07,
];
const F: [f64; 8] = [
    1.0,
    0.599832206555888,
    0.1369298809227358,
    0.014875361290850615,
    0.0007868691311456133,
    1.8463183175100548e-05,
    1.421511758316446e-07,
    2.0442631033899397e-15,
];

pub(super) fn density(x: f64) -> f64 {
    0.3989422804014327 * exp(-(x * x) / 2.)
}

pub(super) fn gauss(x: f64) -> f64 {
    let absolute = x.abs();
    let integer = super::super::rounding::approximate(absolute).floor();
    // Calc's x86_64 double-to-u16 cast truncates via a signed 32-bit integer.
    let region = if integer <= i32::MAX as f64 {
        integer as i32 as u16
    } else {
        0
    };
    let (coefficients, argument): (&[f64], _) = match region {
        0 => (&T0, absolute * absolute),
        1..=2 => (&T2, absolute - 2.),
        3..=4 => (&T4, absolute - 4.),
        _ => (&[-1., 1., -3., 15., -105.], 1. / (absolute * absolute)),
    };
    let mut value = *coefficients.last().unwrap();
    for coefficient in coefficients[..coefficients.len() - 1].iter().rev() {
        let mut sum = super::super::summation::Sum::default();
        sum.add(value * argument);
        sum.add(*coefficient);
        value = sum.total();
    }
    let value = match region {
        0 => value * absolute,
        1..=4 => value,
        _ => 0.5 + density(absolute) * value / absolute,
    };
    if x < 0. { -value } else { value }
}
const T0: [f64; 12] = [
    0.3989422804014327,
    -0.06649038006690546,
    0.00997355701003582,
    -0.00118732821548045,
    0.00011543468761616,
    -9.4446562595e-06,
    6.6596935163e-07,
    -4.122667415e-08,
    2.27352982e-09,
    1.1301172e-10,
    5.11243e-12,
    -2.1218e-13,
];
const T2: [f64; 24] = [
    0.4772498680518208,
    0.05399096651318805,
    -0.05399096651318805,
    0.02699548325659403,
    -0.00449924720943234,
    -0.00224962360471617,
    0.0013497741628297,
    -0.0001178374269137,
    -0.00011515930357476,
    3.704737285544e-05,
    2.82690796889e-06,
    -3.54513195524e-06,
    3.7669563126e-07,
    1.9202407921e-07,
    -5.22690859e-08,
    -4.91799345e-09,
    3.66377919e-09,
    -1.5981997e-10,
    -1.7381238e-10,
    2.624031e-11,
    5.60919e-12,
    -1.72127e-12,
    -8.634e-14,
    7.894e-14,
];
const T4: [f64; 21] = [
    0.4999683287581669,
    0.00013383022576489,
    -0.00026766045152977,
    0.00033457556441221,
    -0.00028996548915725,
    0.00018178605666397,
    -8.252863922168e-05,
    2.551802519049e-05,
    -3.91665839292e-06,
    -7.4018205222e-07,
    6.4422023359e-07,
    -1.737015534e-07,
    9.09595465e-09,
    9.44943118e-09,
    -3.29957075e-09,
    2.9492075e-10,
    1.1874477e-10,
    -4.420396e-11,
    3.61422e-12,
    1.43638e-12,
    -4.5848e-13,
];

// Portable exponential adapted from musl's exp.c and exp_data.c.
// Copyright (c) 2018, Arm Limited.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
pub(in crate::commands::archive::office::formulas) fn exp(x: f64) -> f64 {
    let absolute = x.abs();
    if absolute < 5.551115123125783e-17 {
        return 1. + x;
    }
    if !x.is_finite() {
        return if x == f64::NEG_INFINITY { 0. } else { 1. + x };
    }
    if absolute >= 1024. {
        return if x < 0. { 0. } else { f64::INFINITY };
    }
    // Reduce x = k * ln(2)/128 + r, with |r| <= ln(2)/256.
    let rounded = x * 184.6649652337873 + 6755399441055744.0;
    let ki = rounded.to_bits();
    let kd = rounded - 6755399441055744.0;
    let r = x + kd * -0.005415212348111709 + kd * -1.2864023111638346e-14;
    let [tail, scale_bits] = EXP_TABLE[(ki % 128) as usize];
    let mut scale_bits = scale_bits.wrapping_add(ki << 45);
    let r2 = r * r;
    let correction = f64::from_bits(tail)
        + r
        + r2 * (0.49999999999996786 + r * 0.16666666666665886)
        + r2 * r2 * (0.0416666808410674 + r * 0.008333335853059549);
    if absolute < 512. {
        let scale = f64::from_bits(scale_bits);
        return scale + scale * correction;
    }
    if ki & 0x8000_0000 == 0 {
        scale_bits = scale_bits.wrapping_sub(1009 << 52);
        let scale = f64::from_bits(scale_bits);
        return f64::from_bits((1023 + 1009) << 52) * (scale + scale * correction);
    }
    scale_bits = scale_bits.wrapping_add(1022 << 52);
    let scale = f64::from_bits(scale_bits);
    let mut value = scale + scale * correction;
    if value < 1. {
        // Round once at subnormal precision before scaling to avoid double rounding.
        let low = scale - value + scale * correction;
        let high = 1. + value;
        let low = 1. - high + value + low;
        value = high + low - 1.;
    }
    f64::MIN_POSITIVE * value
}

// 2^(k/128) = scale[k] * (1 + tail[k]); the scale has k/128 removed
// from its encoded exponent so that argument reduction can restore it.
pub(in crate::commands::archive::office::formulas) const EXP_TABLE: [[u64; 2]; 128] = [
    [0x0, 0x3ff0000000000000],
    [0x3c9b3b4f1a88bf6e, 0x3feff63da9fb3335],
    [0xbc7160139cd8dc5d, 0x3fefec9a3e778061],
    [0xbc905e7a108766d1, 0x3fefe315e86e7f85],
    [0x3c8cd2523567f613, 0x3fefd9b0d3158574],
    [0xbc8bce8023f98efa, 0x3fefd06b29ddf6de],
    [0x3c60f74e61e6c861, 0x3fefc74518759bc8],
    [0x3c90a3e45b33d399, 0x3fefbe3ecac6f383],
    [0x3c979aa65d837b6d, 0x3fefb5586cf9890f],
    [0x3c8eb51a92fdeffc, 0x3fefac922b7247f7],
    [0x3c3ebe3d702f9cd1, 0x3fefa3ec32d3d1a2],
    [0xbc6a033489906e0b, 0x3fef9b66affed31b],
    [0xbc9556522a2fbd0e, 0x3fef9301d0125b51],
    [0xbc5080ef8c4eea55, 0x3fef8abdc06c31cc],
    [0xbc91c923b9d5f416, 0x3fef829aaea92de0],
    [0x3c80d3e3e95c55af, 0x3fef7a98c8a58e51],
    [0xbc801b15eaa59348, 0x3fef72b83c7d517b],
    [0xbc8f1ff055de323d, 0x3fef6af9388c8dea],
    [0x3c8b898c3f1353bf, 0x3fef635beb6fcb75],
    [0xbc96d99c7611eb26, 0x3fef5be084045cd4],
    [0x3c9aecf73e3a2f60, 0x3fef54873168b9aa],
    [0xbc8fe782cb86389d, 0x3fef4d5022fcd91d],
    [0x3c8a6f4144a6c38d, 0x3fef463b88628cd6],
    [0x3c807a05b0e4047d, 0x3fef3f49917ddc96],
    [0x3c968efde3a8a894, 0x3fef387a6e756238],
    [0x3c875e18f274487d, 0x3fef31ce4fb2a63f],
    [0x3c80472b981fe7f2, 0x3fef2b4565e27cdd],
    [0xbc96b87b3f71085e, 0x3fef24dfe1f56381],
    [0x3c82f7e16d09ab31, 0x3fef1e9df51fdee1],
    [0xbc3d219b1a6fbffa, 0x3fef187fd0dad990],
    [0x3c8b3782720c0ab4, 0x3fef1285a6e4030b],
    [0x3c6e149289cecb8f, 0x3fef0cafa93e2f56],
    [0x3c834d754db0abb6, 0x3fef06fe0a31b715],
    [0x3c864201e2ac744c, 0x3fef0170fc4cd831],
    [0x3c8fdd395dd3f84a, 0x3feefc08b26416ff],
    [0xbc86a3803b8e5b04, 0x3feef6c55f929ff1],
    [0xbc924aedcc4b5068, 0x3feef1a7373aa9cb],
    [0xbc9907f81b512d8e, 0x3feeecae6d05d866],
    [0xbc71d1e83e9436d2, 0x3feee7db34e59ff7],
    [0xbc991919b3ce1b15, 0x3feee32dc313a8e5],
    [0x3c859f48a72a4c6d, 0x3feedea64c123422],
    [0xbc9312607a28698a, 0x3feeda4504ac801c],
    [0xbc58a78f4817895b, 0x3feed60a21f72e2a],
    [0xbc7c2c9b67499a1b, 0x3feed1f5d950a897],
    [0x3c4363ed60c2ac11, 0x3feece086061892d],
    [0x3c9666093b0664ef, 0x3feeca41ed1d0057],
    [0x3c6ecce1daa10379, 0x3feec6a2b5c13cd0],
    [0x3c93ff8e3f0f1230, 0x3feec32af0d7d3de],
    [0x3c7690cebb7aafb0, 0x3feebfdad5362a27],
    [0x3c931dbdeb54e077, 0x3feebcb299fddd0d],
    [0xbc8f94340071a38e, 0x3feeb9b2769d2ca7],
    [0xbc87deccdc93a349, 0x3feeb6daa2cf6642],
    [0xbc78dec6bd0f385f, 0x3feeb42b569d4f82],
    [0xbc861246ec7b5cf6, 0x3feeb1a4ca5d920f],
    [0x3c93350518fdd78e, 0x3feeaf4736b527da],
    [0x3c7b98b72f8a9b05, 0x3feead12d497c7fd],
    [0x3c9063e1e21c5409, 0x3feeab07dd485429],
    [0x3c34c7855019c6ea, 0x3feea9268a5946b7],
    [0x3c9432e62b64c035, 0x3feea76f15ad2148],
    [0xbc8ce44a6199769f, 0x3feea5e1b976dc09],
    [0xbc8c33c53bef4da8, 0x3feea47eb03a5585],
    [0xbc845378892be9ae, 0x3feea34634ccc320],
    [0xbc93cedd78565858, 0x3feea23882552225],
    [0x3c5710aa807e1964, 0x3feea155d44ca973],
    [0xbc93b3efbf5e2228, 0x3feea09e667f3bcd],
    [0xbc6a12ad8734b982, 0x3feea012750bdabf],
    [0xbc6367efb86da9ee, 0x3fee9fb23c651a2f],
    [0xbc80dc3d54e08851, 0x3fee9f7df9519484],
    [0xbc781f647e5a3ecf, 0x3fee9f75e8ec5f74],
    [0xbc86ee4ac08b7db0, 0x3fee9f9a48a58174],
    [0xbc8619321e55e68a, 0x3fee9feb564267c9],
    [0x3c909ccb5e09d4d3, 0x3feea0694fde5d3f],
    [0xbc7b32dcb94da51d, 0x3feea11473eb0187],
    [0x3c94ecfd5467c06b, 0x3feea1ed0130c132],
    [0x3c65ebe1abd66c55, 0x3feea2f336cf4e62],
    [0xbc88a1c52fb3cf42, 0x3feea427543e1a12],
    [0xbc9369b6f13b3734, 0x3feea589994cce13],
    [0xbc805e843a19ff1e, 0x3feea71a4623c7ad],
    [0xbc94d450d872576e, 0x3feea8d99b4492ed],
    [0x3c90ad675b0e8a00, 0x3feeaac7d98a6699],
    [0x3c8db72fc1f0eab4, 0x3feeace5422aa0db],
    [0xbc65b6609cc5e7ff, 0x3feeaf3216b5448c],
    [0x3c7bf68359f35f44, 0x3feeb1ae99157736],
    [0xbc93091fa71e3d83, 0x3feeb45b0b91ffc6],
    [0xbc5da9b88b6c1e29, 0x3feeb737b0cdc5e5],
    [0xbc6c23f97c90b959, 0x3feeba44cbc8520f],
    [0xbc92434322f4f9aa, 0x3feebd829fde4e50],
    [0xbc85ca6cd7668e4b, 0x3feec0f170ca07ba],
    [0x3c71affc2b91ce27, 0x3feec49182a3f090],
    [0x3c6dd235e10a73bb, 0x3feec86319e32323],
    [0xbc87c50422622263, 0x3feecc667b5de565],
    [0x3c8b1c86e3e231d5, 0x3feed09bec4a2d33],
    [0xbc91bbd1d3bcbb15, 0x3feed503b23e255d],
    [0x3c90cc319cee31d2, 0x3feed99e1330b358],
    [0x3c8469846e735ab3, 0x3feede6b5579fdbf],
    [0xbc82dfcd978e9db4, 0x3feee36bbfd3f37a],
    [0x3c8c1a7792cb3387, 0x3feee89f995ad3ad],
    [0xbc907b8f4ad1d9fa, 0x3feeee07298db666],
    [0xbc55c3d956dcaeba, 0x3feef3a2b84f15fb],
    [0xbc90a40e3da6f640, 0x3feef9728de5593a],
    [0xbc68d6f438ad9334, 0x3feeff76f2fb5e47],
    [0xbc91eee26b588a35, 0x3fef05b030a1064a],
    [0x3c74ffd70a5fddcd, 0x3fef0c1e904bc1d2],
    [0xbc91bdfbfa9298ac, 0x3fef12c25bd71e09],
    [0x3c736eae30af0cb3, 0x3fef199bdd85529c],
    [0x3c8ee3325c9ffd94, 0x3fef20ab5fffd07a],
    [0x3c84e08fd10959ac, 0x3fef27f12e57d14b],
    [0x3c63cdaf384e1a67, 0x3fef2f6d9406e7b5],
    [0x3c676b2c6c921968, 0x3fef3720dcef9069],
    [0xbc808a1883ccb5d2, 0x3fef3f0b555dc3fa],
    [0xbc8fad5d3ffffa6f, 0x3fef472d4a07897c],
    [0xbc900dae3875a949, 0x3fef4f87080d89f2],
    [0x3c74a385a63d07a7, 0x3fef5818dcfba487],
    [0xbc82919e2040220f, 0x3fef60e316c98398],
    [0x3c8e5a50d5c192ac, 0x3fef69e603db3285],
    [0x3c843a59ac016b4b, 0x3fef7321f301b460],
    [0xbc82d52107b43e1f, 0x3fef7c97337b9b5f],
    [0xbc892ab93b470dc9, 0x3fef864614f5a129],
    [0x3c74b604603a88d3, 0x3fef902ee78b3ff6],
    [0x3c83c5ec519d7271, 0x3fef9a51fbc74c83],
    [0xbc8ff7128fd391f0, 0x3fefa4afa2a490da],
    [0xbc8dae98e223747d, 0x3fefaf482d8e67f1],
    [0x3c8ec3bc41aa2008, 0x3fefba1bee615a27],
    [0x3c842b94c3a9eb32, 0x3fefc52b376bba97],
    [0x3c8a64a931d185ee, 0x3fefd0765b6e4540],
    [0xbc8e37bae43be3ed, 0x3fefdbfdad9cbe14],
    [0x3c77893b4d91cd9d, 0x3fefe7c1819e90d8],
    [0x3c5305c14160cc89, 0x3feff3c22b8f71f1],
];

// I0's asymptotic polynomial is shared with logarithmic normalization of
// higher orders, where I0 itself can overflow before the final result does.
fn i0_tail(y: f64) -> f64 {
    let q1 = 0.39894228;
    let q2 = 1.328592e-2;
    let q3 = 2.25319e-3;
    let q4 = -1.57565e-3;
    let q5 = 9.16281e-3;
    let q6 = -2.057706e-2;
    let q7 = 2.635537e-2;
    let q8 = -1.647633e-2;
    let q9 = 3.92377e-3;

    q1 + y * (q2 + y * (q3 + y * (q4 + y * (q5 + y * (q6 + y * (q7 + y * (q8 + y * q9)))))))
}

// This are somewhat lower precision than the BesselJ and BesselY

// needed for BesselK
pub(crate) fn bessel_i0(x: f64) -> f64 {
    // Parameters of the polynomial approximation
    let p1 = 1.0;
    let p2 = 3.5156229;
    let p3 = 3.0899424;
    let p4 = 1.2067492;
    let p5 = 0.2659732;
    let p6 = 3.60768e-2;
    let p7 = 4.5813e-3;

    let k1 = 3.75;
    let ax = x.abs();

    if x.is_infinite() {
        return 0.0;
    }

    if ax < k1 {
        // let xx = x / k1;
        // let y = xx * xx;
        // let mut result = 1.0;
        // let max_iter = 50;
        // let mut term = 1.0;
        // for i in 1..max_iter {
        //     term = term * k1*k1*y /(2.0*i as f64).powi(2);
        //     result += term;
        // };
        // result

        let xx = x / k1;
        let y = xx * xx;
        p1 + y * (p2 + y * (p3 + y * (p4 + y * (p5 + y * (p6 + y * p7)))))
    } else {
        (if ax > 709. {
            (ax - 0.5 * ax.ln()).exp()
        } else {
            ax.exp() / ax.sqrt()
        }) * i0_tail(k1 / ax)
    }
}

// needed for BesselK
pub(crate) fn bessel_i1(x: f64) -> f64 {
    let p1 = 0.5;
    let p2 = 0.87890594;
    let p3 = 0.51498869;
    let p4 = 0.15084934;
    let p5 = 2.658733e-2;
    let p6 = 3.01532e-3;
    let p7 = 3.2411e-4;

    let q1 = 0.39894228;
    let q2 = -3.988024e-2;
    let q3 = -3.62018e-3;
    let q4 = 1.63801e-3;
    let q5 = -1.031555e-2;
    let q6 = 2.282967e-2;
    let q7 = -2.895312e-2;
    let q8 = 1.787654e-2;
    let q9 = -4.20059e-3;

    let k1 = 3.75;
    let ax = x.abs();

    if ax < k1 {
        let xx = x / k1;
        let y = xx * xx;
        x * (p1 + y * (p2 + y * (p3 + y * (p4 + y * (p5 + y * (p6 + y * p7))))))
    } else {
        let y = k1 / ax;
        let result = (if ax > 709. {
            (ax - 0.5 * ax.ln()).exp()
        } else {
            ax.exp() / ax.sqrt()
        }) * (q1
            + y * (q2 + y * (q3 + y * (q4 + y * (q5 + y * (q6 + y * (q7 + y * (q8 + y * q9))))))));
        if x < 0.0 {
            return -result;
        }
        result
    }
}

// Miller's downward recurrence needs a starting order above both n and the
// transition region set by x. The same count is charged by the formula engine.
pub(super) fn iterations(n: i32, x: f64) -> usize {
    2 * (n as usize + (40. * n as f64).sqrt() as usize).max((40. * x.abs()).sqrt() as usize)
}

pub(crate) fn bessel_i(n: i32, x: f64) -> f64 {
    let large_number = 1e10;
    let small_number = 1e-10;

    if n < 0 {
        return f64::NAN;
    }

    if n == 0 {
        return bessel_i0(x);
    }
    if x == 0.0 {
        // I_n(0) = 0 for all n!= 0
        return 0.0;
    }
    if n == 1 {
        return bessel_i1(x);
    }

    if x.abs() > large_number {
        return f64::INFINITY;
    }
    if x.abs() < 1e-8 {
        // Remaining positive-series terms are below binary64 precision.
        // Avoid 2/x overflowing or destabilizing the downward recurrence.
        let mut result = 1.;
        for j in 1..=n {
            result *= x / (2. * j as f64);
            if result == 0. {
                break;
            }
        }
        return result;
    }

    let tox = 2.0 / x.abs();
    let mut bip = 0.0;
    let mut bi = 1.0;
    let mut result = 0.0;
    let m = iterations(n, x);
    let mut initial_result: f64 = 0.;
    let mut scaled_decades = 0.;

    for j in (1..=m).rev() {
        (bip, bi) = (bi, bip + (j as f64) * tox * bi);
        // Prevent overflow
        if bi.abs() > large_number {
            let (scale, decades) = if bi > 1e100 {
                (1e-100, 100.)
            } else {
                (small_number, 10.)
            };
            result *= scale;
            bi *= scale;
            bip *= scale;
            scaled_decades += decades;
        }
        if j == n as usize {
            result = bip;
            initial_result = bip;
            scaled_decades = 0.;
        }
    }

    let i0 = bessel_i0(x);
    if i0.is_finite() && result >= f64::MIN_POSITIVE && result / bi >= f64::MIN_POSITIVE {
        result *= i0 / bi;
    } else {
        // Keep scales separate when the recurrence ratio is subnormal, or
        // I0 overflows; both may still combine into a finite normal result.
        let ax = x.abs();
        let log_i0 = if ax >= 3.75 {
            ax - 0.5 * ax.ln() + i0_tail(3.75 / ax).ln()
        } else {
            i0.ln()
        };
        result = (initial_result.ln() - scaled_decades * std::f64::consts::LN_10 - bi.ln()
            + log_i0)
            .exp();
    }
    if (x < 0.0) && (n % 2 == 1) {
        result = -result;
    }

    result
}

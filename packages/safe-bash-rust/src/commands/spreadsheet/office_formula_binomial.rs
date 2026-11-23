// Contracts adapted from IronCalc f936620 statistical/binom.rs (MIT,
// LICENSE.IronCalc) and Univer 4767b3b statistical/binom-* (Apache-2.0,
// LICENSE.Univer). Inversion uses IronCalc's bisection. Sum relative masses
// outward from the interval's mode, avoiding factorial overflow and subtraction
// of two CDFs rounded to one. No probability table is allocated.
use super::{Value, gamma::stirling_remainder, number};

pub(in super::super) fn arguments(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "BINOMDIST" | "BINOM.DIST" | "NEGBINOM.DIST" => (4, 4),
        "BINOM.DIST.RANGE" => (3, 4),
        "CRITBINOM" | "BINOM.INV" | "NEGBINOMDIST" => (3, 3),
        _ => return None,
    })
}

pub(in super::super) fn calculate(
    name: &str,
    args: &[&Value],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    *work = work.checked_sub(128)?;
    for v in args {
        if let Value::Error(e) | Value::LiteralError(e) = v {
            return Some(Value::Error(e));
        }
    }
    let cumulative_arg = matches!(name, "BINOMDIST" | "BINOM.DIST" | "NEGBINOM.DIST");
    let mut numbers = [0.; 4];
    for (i, v) in args.iter().enumerate() {
        let n = match v {
            Value::Text(s) | Value::UninternedText(s) => {
                if !(cumulative_arg && i == 3)
                    && (s.trim().eq_ignore_ascii_case("true")
                        || s.trim().eq_ignore_ascii_case("false"))
                {
                    None
                } else {
                    number::parse(s, date1904)
                }
            }
            _ => v.numeric(),
        };
        let Some(n) = n else {
            return Some(Value::Error("#VALUE!"));
        };
        if !n.is_finite() {
            return Some(Value::Error("#NUM!"));
        }
        numbers[i] = n;
    }
    let [a, b, c, d] = numbers;
    let inverse = matches!(name, "CRITBINOM" | "BINOM.INV");
    let range = name == "BINOM.DIST.RANGE";
    let negative = matches!(name, "NEGBINOMDIST" | "NEGBINOM.DIST");
    let (n, k, p) = if inverse || range {
        (a.trunc(), c.trunc(), b)
    } else if negative {
        (a.trunc() + b.trunc(), b.trunc(), c)
    } else {
        (b.trunc(), a.trunc(), c)
    };
    // Discrete neighbors must remain distinguishable in the workbook's f64
    // values. Above 2^53-1 an increment of one may leave a trial count unchanged.
    if !(0. ..=9_007_199_254_740_991.).contains(&n)
        || !(0. ..=1.).contains(&p)
        || (!inverse && (k < 0. || k > n))
    {
        return Some(Value::Error("#NUM!"));
    }
    let q = 1. - p;
    let value = if inverse {
        if p <= 0. || p >= 1. || c <= 0. || c >= 1. {
            return Some(Value::Error("#NUM!"));
        }
        let (mut low, mut high) = (0., n);
        while low < high {
            *work = work.checked_sub(1)?;
            let mid = low + ((high - low) * 0.5).floor();
            if cdf(mid, n, p, q, work)? >= c {
                high = mid;
            } else {
                low = mid + 1.;
            }
        }
        low
    } else if negative {
        if a.trunc() < 0. || k < 1. || p <= 0. || p >= 1. {
            return Some(Value::Error("#NUM!"));
        }
        if cumulative_arg && d != 0. {
            cdf(a.trunc(), n, q, p, work)?
        } else {
            (log_mass(k, n, p, q, work)? + (k / n).ln()).exp()
        }
    } else if range {
        let upper = if args.len() == 4 { d.trunc() } else { k };
        if upper < k || upper > n {
            return Some(Value::Error("#NUM!"));
        }
        interval(k, upper, n, p, q, work)?
    } else if d != 0. {
        cdf(k, n, p, q, work)?
    } else {
        interval(k, k, n, p, q, work)?
    };
    Some(Value::number(value))
}

// x*ln(x/mean)+mean-x, evaluated as a convergent series near the mean.
fn deviance(x: f64, mean: f64, work: &mut usize) -> Option<f64> {
    if (x - mean).abs() < 0.1 * (x + mean) {
        let v = (x - mean) / (x + mean);
        let mut term = 2. * x * v;
        let square = v * v;
        let mut sum = (x - mean) * v;
        let mut denominator = 1.;
        loop {
            *work = work.checked_sub(1)?;
            term *= square;
            denominator += 2.;
            let next = sum + term / denominator;
            if next == sum {
                return Some(sum);
            }
            sum = next;
        }
    }
    Some(x * (x.ln() - mean.ln()) + mean - x)
}

fn log_mass(k: f64, n: f64, p: f64, q: f64, work: &mut usize) -> Option<f64> {
    *work = work.checked_sub(64)?;
    let log_p = if p < 0.5 { p.ln() } else { (-q).ln_1p() };
    let log_q = if q < 0.5 { q.ln() } else { (-p).ln_1p() };
    if k == 0. {
        return Some(n * log_q);
    }
    if k == n {
        return Some(n * log_p);
    }
    let log_scale =
        (2. * std::f64::consts::PI).ln() + k.min(n - k).ln() + (-k.min(n - k) / n).ln_1p();
    Some(
        stirling_remainder(n)
            - stirling_remainder(k)
            - stirling_remainder(n - k)
            - deviance(k, n * p, work)?
            - deviance(n - k, n * q, work)?
            - 0.5 * log_scale,
    )
}

fn interval(lower: f64, upper: f64, n: f64, p: f64, q: f64, work: &mut usize) -> Option<f64> {
    if lower == 0. && upper == n {
        return Some(1.);
    }
    if p == 0. {
        return Some(f64::from(lower == 0.));
    }
    if q == 0. {
        return Some(f64::from(upper == n));
    }
    // Fair-coin probabilities below 53 trials are exactly representable. Keep
    // those boundaries exact so inverse(CDF(k)) does not incorrectly return k+1.
    if p == 0.5 && n <= 52. {
        let (n, lo, hi) = (n as u64, lower as u64, upper as u64);
        let (mut choose, mut total) = (1u64, 0u64);
        for k in 0..=hi {
            *work = work.checked_sub(1)?;
            if k >= lo {
                total += choose;
            }
            if k < hi {
                choose = choose * (n - k) / (k + 1);
            }
        }
        return Some(total as f64 / (1u64 << n) as f64);
    }
    let mode = ((n + 1.) * p).floor().clamp(lower, upper);
    let log_anchor = log_mass(mode, n, p, q, work)?;
    let (mut sum, mut correction) = (1., 0.);
    for descending in [true, false] {
        let mut j = mode;
        let mut term = 1.;
        let mut steps = 0usize;
        while if descending { j > lower } else { j < upper } {
            *work = work.checked_sub(4)?;
            let ratio = if descending {
                (j / (n - j + 1.)) * (q / p)
            } else {
                ((n - j) / (j + 1.)) * (p / q)
            };
            term *= ratio;
            j += if descending { -1. } else { 1. };
            steps += 1;
            // Long products accumulate rounding even when the sum is compensated.
            // Re-anchor periodically with the stable log mass, using constant space.
            if steps % 128 == 0 {
                term = (log_mass(j, n, p, q, work)? - log_anchor).exp();
            }
            let adjusted = term - correction;
            let next = sum + adjusted;
            correction = (next - sum) - adjusted;
            sum = next;
            // Ratios decrease away from the mode. Bound the entire remaining
            // geometric tail, not just its next mass: for large trial counts
            // there can still be thousands of nearly equal terms left.
            if ratio < 1. && term * ratio <= sum * f64::EPSILON * 0.25 * (1. - ratio) {
                break;
            }
        }
    }
    Some((log_anchor + sum.ln()).exp().min(1.))
}

fn cdf(k: f64, n: f64, p: f64, q: f64, work: &mut usize) -> Option<f64> {
    if k >= n {
        return Some(1.);
    }
    if k < 0. {
        return Some(0.);
    }
    if k < n * p {
        interval(0., k, n, p, q, work)
    } else {
        Some(1. - interval(0., n - k - 1., n, q, p, work)?)
    }
}

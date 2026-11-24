// Factorial cancellation follows LibreOffice Calc 24.8, interpr3.cxx.
// This Source Code Form is subject to the terms of the Mozilla Public License,
// v. 2.0. If a copy of the MPL was not distributed with this file, You can
// obtain one at http://mozilla.org/MPL/2.0/.
//
// The original file incorporates work licensed to the Apache Software
// Foundation (ASF) under contributor license agreements. The ASF licenses that
// work under the Apache License, Version 2.0; see
// http://www.apache.org/licenses/LICENSE-2.0 .
use super::super::{rounding::approximate, summation::Sum};
use super::Value;

pub(super) fn excel(name: &str, a: f64, b: f64, work: &mut usize) -> Option<Value> {
    if a < 0. || b < 0. {
        return Some(Value::Error("#NUM!"));
    }
    let n = a.trunc();
    let k = b.trunc();
    if name == "PERMUTATIONA" {
        return Some(Value::number(n.powf(k)));
    }
    if matches!(name, "COMBIN" | "PERMUT") && k > n || name == "FACT" && n > 170. {
        return Some(Value::Error("#NUM!"));
    }
    let (base, terms) = match name {
        "FACT" => (n, n),
        "PERMUT" => (n, k),
        "COMBINA" => {
            if k == 0. {
                return Some(Value::Number(1.));
            }
            if n == 0. {
                return Some(Value::Number(0.));
            }
            // C(n+k-1,k) = C(n+k-1,n-1). Avoid forming n+k-1:
            // it can lose the unit or overflow before a finite result.
            ((n - 1.).max(k), (n - 1.).min(k))
        }
        _ => {
            let terms = k.min(n - k);
            (n - terms, terms)
        }
    };
    let combination = matches!(name, "COMBIN" | "COMBINA");
    let mut product = 1.;
    let mut index = 0.;
    while index < terms {
        *work = work.checked_sub(1)?;
        product *= if combination {
            (base + index + 1.) / (index + 1.)
        } else {
            base - index
        };
        if !product.is_finite() {
            return Some(Value::Error("#NUM!"));
        }
        index += 1.;
    }
    Some(Value::Number(product))
}

pub(super) fn calculate(name: &str, values: [f64; 5], work: &mut usize) -> Option<Value> {
    let [a, b, c, d, cumulative] = values;
    let n = approximate(a).floor();
    let k = approximate(b).floor();
    let result = match name {
        "FACT" => {
            if a < 0. {
                return Some(Value::Error("Err:502"));
            }
            if n > 170. {
                return Some(Value::Error("#VALUE!"));
            }
            let mut product = if n == 0. { 1. } else { n };
            let mut factor = n;
            while factor > 2. {
                *work = work.checked_sub(1)?;
                factor -= 1.;
                product *= factor;
            }
            product
        }
        "PERMUTATIONA" => {
            if n < 0. || k < 0. {
                return Some(Value::Error("Err:502"));
            }
            n.powf(k)
        }
        "PERMUT" => {
            if n < 0. || k < 0. || k > n {
                return Some(Value::Error("Err:502"));
            }
            let mut product = if k == 0. { 1. } else { n };
            let mut index = k - 1.;
            while index >= 1. {
                *work = work.checked_sub(1)?;
                product *= n - index;
                index -= 1.;
            }
            product
        }
        "COMBIN" | "COMBINA" => {
            if n < 0. || k < 0. || k > n {
                return Some(Value::Error("Err:502"));
            }
            let mut n = if name == "COMBINA" { n + k - 1. } else { n };
            if n < k {
                0.
            } else if k == 0. {
                1.
            } else {
                let mut k = k;
                let mut product = n / k;
                n -= 1.;
                k -= 1.;
                while k > 0. {
                    *work = work.checked_sub(1)?;
                    product *= n / k;
                    k -= 1.;
                    n -= 1.;
                }
                product
            }
        }
        _ => {
            let (x, n, m, population) = (n, k, approximate(c).floor(), approximate(d).floor());
            if x < 0. || n < x || population < n || population < m || m < 0. {
                return Some(Value::Error("Err:502"));
            }
            // Calc's cumulative iterator is signed 32-bit. Reject values that
            // cannot advance within that range instead of overflowing it.
            if x >= i32::MAX as f64 {
                return None;
            }
            let mut index = if cumulative == 0. { x } else { 0. };
            let mut sum = Sum::default();
            while index <= x {
                *work = work.checked_sub(1)?;
                if n - index <= population - m && index <= m {
                    if index + n.min(m) > 500_000. {
                        return Some(Value::Error("#VALUE!"));
                    }
                    sum.add(hypergeometric(index, n, m, population, work)?);
                }
                index += 1.;
            }
            sum.total()
        }
    };
    Some(Value::number(result))
}

// Each factorial contributes a descending range. Merge their next factors to
// reproduce Calc's descending sorted products without materializing the lists.
fn factors(
    values: &mut Vec<(f64, f64, f64)>,
    lower: f64,
    upper: f64,
    base: f64,
    work: &mut usize,
) -> Option<()> {
    *work = work.checked_sub(1)?;
    if lower <= upper && base - lower > 1. {
        values.push((lower, upper, base));
    }
    Some(())
}

fn next_factor(ranges: &mut [(f64, f64, f64)]) -> Option<f64> {
    let mut largest = None;
    let mut value = 1.;
    for (index, &(lower, upper, base)) in ranges.iter().enumerate() {
        if lower <= upper && base - lower > value {
            largest = Some(index);
            value = base - lower;
        }
    }
    let index = largest?;
    ranges[index].0 += 1.;
    Some(value)
}

fn hypergeometric(x: f64, n: f64, m: f64, population: f64, work: &mut usize) -> Option<f64> {
    // Cancellation leaves at most three ranges on either side.
    *work = work.checked_sub(6 * std::mem::size_of::<(f64, f64, f64)>())?;
    let mut numerator = Vec::with_capacity(3);
    let mut denominator = Vec::with_capacity(3);
    let mut c_num_upper = population - n - m + x - 1.;
    let mut c_den_lower = 1.;
    if population - n - m + x >= m - x + 1. {
        c_num_upper = m - x - 1.;
        c_den_lower = population - n - 2. * (m - x) + 1.;
    }
    let mut c_den_upper = population - n - m + x + 1. - c_den_lower;
    let mut d_num_lower = n - m;
    if n >= m + 1. {
        if population - m < n + 1. {
            if population - n < n + 1. {
                factors(&mut numerator, 0., c_num_upper, population - n, work)?;
                factors(&mut denominator, 0., population - n - 1., population, work)?;
            } else {
                factors(
                    &mut numerator,
                    population - 2. * n,
                    c_num_upper,
                    population - n,
                    work,
                )?;
                factors(&mut denominator, 0., n - 1., population, work)?;
            }
            if c_den_upper < n - x + 1. {
                factors(
                    &mut numerator,
                    1.,
                    population - m - n + x,
                    population - m + 1.,
                    work,
                )?;
            } else {
                factors(
                    &mut numerator,
                    1.,
                    population - m - c_den_upper,
                    population - m + 1.,
                    work,
                )?;
                c_den_upper = n - x;
                c_den_lower = population - m - 2. * (n - x) + 1.;
            }
        } else {
            if n > m - 1. {
                factors(&mut numerator, 0., c_num_upper, population - n, work)?;
                factors(&mut denominator, 0., m - 1., population, work)?;
            } else {
                factors(&mut numerator, m - n, c_num_upper, population - n, work)?;
                factors(&mut denominator, 0., n - 1., population, work)?;
            }
            if c_den_upper < n - x + 1. {
                factors(
                    &mut numerator,
                    population - m - n + 1.,
                    population - m - n + x,
                    population - m + 1.,
                    work,
                )?;
            } else {
                factors(
                    &mut numerator,
                    population - m - n + 1.,
                    population - m - c_den_upper,
                    population - m + 1.,
                    work,
                )?;
                c_den_upper = n - x;
                c_den_lower = population - m - 2. * (n - x) + 1.;
            }
        }
    } else {
        if population - m < m + 1. {
            if population - n < m + 1. {
                factors(&mut numerator, 0., c_num_upper, population - n, work)?;
                factors(&mut denominator, 0., population - m - 1., population, work)?;
            } else {
                factors(
                    &mut numerator,
                    population - n - m,
                    c_num_upper,
                    population - n,
                    work,
                )?;
                factors(&mut denominator, 0., n - 1., population, work)?;
            }
            if n - x + 1. > c_den_upper {
                factors(
                    &mut numerator,
                    1.,
                    population - m - n + x,
                    population - m + 1.,
                    work,
                )?;
            } else {
                factors(
                    &mut numerator,
                    1.,
                    population - m - c_den_upper,
                    population - m + 1.,
                    work,
                )?;
                c_den_lower = population - m - 2. * (n - x) + 1.;
                c_den_upper = n - x;
            }
        } else {
            if population - n < population - m + 1. {
                factors(&mut numerator, 0., c_num_upper, population - n, work)?;
                factors(&mut denominator, 0., m - 1., population, work)?;
            } else {
                factors(&mut numerator, m - n, c_num_upper, population - n, work)?;
                factors(&mut denominator, 0., n - 1., population, work)?;
            }
            if n - x + 1. > c_den_upper {
                factors(
                    &mut numerator,
                    population - 2. * m + 1.,
                    population - m - n + x,
                    population - m + 1.,
                    work,
                )?;
            } else if m >= c_den_upper {
                factors(
                    &mut numerator,
                    population - 2. * m + 1.,
                    population - m - c_den_upper,
                    population - m + 1.,
                    work,
                )?;
                c_den_upper = n - x;
                c_den_lower = population - m - 2. * (n - x) + 1.;
            } else {
                factors(
                    &mut denominator,
                    c_den_lower,
                    population - n - 2. * m + x,
                    population - n - m + x + 1.,
                    work,
                )?;
                c_den_upper = n - x;
                c_den_lower = population - m - 2. * (n - x) + 1.;
            }
        }
        d_num_lower = 0.;
    }
    let d_num_upper = if c_den_upper < x + 1. {
        n - x - 1.
    } else {
        n - c_den_upper - 1.
    };
    let d_den_lower = if c_den_upper < x + 1. {
        c_den_lower
    } else {
        population - n - m + 1.
    };
    factors(&mut numerator, d_num_lower, d_num_upper, n, work)?;
    factors(
        &mut denominator,
        d_den_lower,
        population - n - m + x,
        population - n - m + x + 1.,
        work,
    )?;
    let mut result = 1.;
    loop {
        *work = work.checked_sub(numerator.len() + denominator.len() + 1)?;
        let (numerator, denominator) = (next_factor(&mut numerator), next_factor(&mut denominator));
        if numerator.is_none() && denominator.is_none() {
            break;
        }
        result *= numerator.unwrap_or(1.) / denominator.unwrap_or(1.);
    }
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::{Value, calculate, excel};

    #[test]
    fn combinatorial_excel_keeps_native_calc_errors_and_work_limits() {
        for (name, n, k, expected) in [
            ("COMBINA", 2., 6., "Err:502"),
            ("COMBIN", 2., 6., "Err:502"),
            ("PERMUT", 2., 6., "Err:502"),
            ("FACT", 171., 0., "#VALUE!"),
        ] {
            assert!(matches!(
                calculate(name, [n, k, 0., 0., 0.], &mut 4096),
                Some(Value::Error(error)) if error == expected
            ));
        }
        for name in ["FACT", "COMBIN", "COMBINA", "PERMUT"] {
            assert!(excel(name, 100., 50., &mut 10).is_none(), "{name}");
        }
    }

    #[test]
    fn combinatorial_excel_matches_exact_integer_counts() {
        let factorial = |n: u32| (1..=n).map(u128::from).product::<u128>();
        for n in 1..=20 {
            for k in 0..=20 {
                for name in ["COMBIN", "COMBINA", "PERMUT"] {
                    if name != "COMBINA" && k > n {
                        continue;
                    }
                    let expected = match name {
                        "COMBIN" => factorial(n) / factorial(k) / factorial(n - k),
                        "COMBINA" => {
                            // Exact integer recurrence, independently of floating-point ratios.
                            (1..=k).fold(1_u128, |value, i| {
                                value * u128::from(n + i - 1) / u128::from(i)
                            })
                        }
                        _ => factorial(n) / factorial(n - k),
                    } as f64;
                    let Some(Value::Number(actual)) = excel(name, n as f64, k as f64, &mut 4096)
                    else {
                        panic!("{name}({n},{k})");
                    };
                    assert!(
                        (actual / expected - 1.).abs() < 2e-14,
                        "{name}({n},{k}): {actual} != {expected}"
                    );
                }
            }
        }
    }

    #[test]
    fn combinatorial_iterations_and_factor_storage_obey_the_work_budget() {
        for (name, values) in [
            ("COMBIN", [1e300, 1e300, 0., 0., 0.]),
            ("COMBINA", [1e300, 1e300, 0., 0., 0.]),
            ("PERMUT", [1e300, 1e300, 0., 0., 0.]),
            ("HYPGEOM.DIST", [1000., 1000., 1000., 2000., 1.]),
            ("HYPGEOMDIST", [500., 1000., 1000., 2000., 0.]),
        ] {
            for mut work in [128, 4096] {
                assert!(calculate(name, values, &mut work).is_none(), "{name}");
            }
        }
    }
}

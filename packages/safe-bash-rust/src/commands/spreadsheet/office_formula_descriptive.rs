// Descriptive statistics adapted from IronCalc statistical/{standard_dev,
// variance,devsq,geomean,count_and_average}.rs (f936620, MIT, LICENSE.IronCalc).
// Use the existing Excel aggregate collector and normalized flat buffers rather
// than raw sums of squares. All functions run in linear time without sorting.
use super::{
    Value,
    regression::{normalize, sum},
};

pub(super) fn minimum(name: &str) -> Option<usize> {
    Some(match name {
        "STDEV" | "STDEV.S" | "STDEVA" | "VAR" | "VAR.S" | "VARA" => 2,
        "SKEW" | "SKEWP" => 3,
        "KURT" => 4,
        "STDEVP" | "STDEV.P" | "STDEVPA" | "VARP" | "VAR.P" | "VARPA" | "DEVSQ" | "AVEDEV"
        | "GEOMEAN" | "HARMEAN" => 1,
        _ => return None,
    })
}

pub(super) fn calculate(name: &str, values: &mut [f64], work: &mut usize) -> Option<Value> {
    let n = values.len();
    if n < minimum(name)? {
        return Some(Value::Error(if name == "GEOMEAN" {
            "#NUM!"
        } else {
            "#DIV/0!"
        }));
    }
    *work = work.checked_sub(n.checked_mul(40)?)?;
    if values.iter().any(|n| !n.is_finite()) {
        return Some(Value::Error("#NUM!"));
    }
    if matches!(name, "GEOMEAN" | "HARMEAN") {
        let minimum = values.iter().copied().fold(f64::INFINITY, f64::min);
        let maximum = values.iter().copied().fold(0_f64, f64::max);
        if minimum <= 0. {
            return Some(Value::Error("#NUM!"));
        }
        if minimum == maximum {
            return Some(Value::Number(minimum));
        }
        let result = if name == "HARMEAN" {
            // Scale reciprocals by the smallest observation, so neither the
            // reciprocals nor their sum overflow, even for subnormal inputs.
            minimum / (sum(values.iter().map(|v| minimum / v)) / n as f64)
        } else {
            let origin = values[0].ln();
            (origin + sum(values.iter().map(|v| v.ln() - origin)) / n as f64).exp()
        };
        return Some(Value::number(result.clamp(minimum, maximum)));
    }
    let axis = normalize(values, 0, 1, true);
    let n = n as f64;
    let result = match name {
        "AVEDEV" => sum(values.iter().map(|v| v.abs())) / n * axis.scale,
        "SKEW" | "SKEWP" | "KURT" => {
            if axis.norm == 0. {
                return Some(Value::Error("#DIV/0!"));
            }
            if name == "KURT" {
                let fourth = sum(values.iter().map(|v| (v / axis.norm).powi(4)));
                let denominator = (n - 2.) * (n - 3.);
                n * (n + 1.) * (n - 1.) / denominator * fourth - 3. * (n - 1.).powi(2) / denominator
            } else {
                let third = sum(values.iter().map(|v| (v / axis.norm).powi(3)));
                third
                    * if name == "SKEWP" {
                        n.sqrt()
                    } else {
                        n * (n - 1.).sqrt() / (n - 2.)
                    }
            }
        }
        _ => {
            let sample = matches!(
                name,
                "STDEV" | "STDEV.S" | "STDEVA" | "VAR" | "VAR.S" | "VARA"
            );
            let denominator = if name == "DEVSQ" {
                1.
            } else {
                n - f64::from(sample)
            };
            let deviation = axis.norm / denominator.sqrt() * axis.scale;
            if matches!(
                name,
                "STDEV" | "STDEV.S" | "STDEVA" | "STDEVP" | "STDEV.P" | "STDEVPA"
            ) {
                deviation
            } else {
                deviation * deviation
            }
        }
    };
    Some(Value::number(result))
}

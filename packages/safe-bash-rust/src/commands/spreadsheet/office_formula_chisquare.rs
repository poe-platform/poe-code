// Contracts adapted from IronCalc f936620 statistical/chisq.rs (MIT,
// LICENSE.IronCalc) and Univer 4767b3b statistical/chisq-* (Apache-2.0,
// LICENSE.Univer). Reuse Rust gamma probabilities and sparse matrix pairing.
use super::super::{Calculation, Coord, Expr, matrix_functions::shape};
use super::{Value, gamma, number};
pub(in super::super) fn arguments(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "CHISQ.DIST" => (3, 3),
        "CHISQ.DIST.RT" | "CHISQ.INV" | "CHISQ.INV.RT" | "CHIDIST" | "CHIINV" => (2, 2),
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
    let mut values = [0.; 4];
    for (i, v) in args.iter().enumerate() {
        let n = match v {
            Value::Text(s) | Value::UninternedText(s) => {
                if i != 2
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
        values[i] = n;
    }
    values[1] = values[1].trunc();
    gamma::calculate(name, values, work)
}
impl Calculation<'_> {
    pub(in super::super) fn chisquare_test(
        &mut self,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if args.len() != 2 {
            return Some(Value::Error("#ERROR!"));
        }
        let (observed, ot) = self.matrix_source(&args[0], pos, depth + 1)?;
        let (expected, et) = self.matrix_source(&args[1], pos, depth + 1)?;
        let (rows, cols) = match shape(&observed, ot) {
            Ok(s) => s,
            Err(e) => return Some(Value::Error(e)),
        };
        let (er, ec) = match shape(&expected, et) {
            Ok(s) => s,
            Err(e) => return Some(Value::Error(e)),
        };
        if rows.checked_mul(cols)? != er.checked_mul(ec)? || rows * cols < 2 {
            return Some(Value::Error("#N/A"));
        }
        let observed = match self.paired_entries(observed, ot, depth + 1)? {
            Ok(v) => v,
            Err(e) => return Some(Value::Error(e)),
        };
        let expected = match self.paired_entries(expected, et, depth + 1)? {
            Ok(v) => v,
            Err(e) => return Some(Value::Error(e)),
        };
        self.work = self
            .work
            .checked_sub(observed.len().checked_add(expected.len())?)?;
        if let Some((_, e)) = observed
            .iter()
            .chain(&expected)
            .filter_map(|(i, v)| v.as_ref().err().map(|e| (i, e)))
            .min_by_key(|(i, _)| *i)
        {
            return Some(Value::Error(e));
        }
        let (mut sum, mut correction, mut count) = (0., 0., 0usize);
        let mut overflow = false;
        for (i, obs) in observed {
            self.tick(depth)?;
            if let (Ok(obs), Some(Ok(exp))) = (obs, expected.get(&i)) {
                if obs < 0. || *exp < 0. {
                    return Some(Value::Error("#NUM!"));
                }
                if *exp == 0. {
                    return Some(Value::Error("#DIV/0!"));
                }
                count += 1;
                if overflow {
                    continue;
                }
                let scaled = (obs - exp) / exp.sqrt();
                let term = scaled * scaled;
                let adjusted = term - correction;
                let next = sum + adjusted;
                if !next.is_finite() {
                    overflow = true;
                    continue;
                }
                correction = (next - sum) - adjusted;
                sum = next;
            }
        }
        if count == 0 {
            return Some(Value::Error("#DIV/0!"));
        }
        self.result_format = None;
        if overflow {
            return Some(Value::Number(0.));
        }
        let degrees = if rows > 1 && cols > 1 {
            (rows - 1).checked_mul(cols - 1)?
        } else {
            rows * cols - 1
        };
        gamma::calculate(
            "CHISQ.DIST.RT",
            [sum, degrees as f64, 0., 0.],
            &mut self.work,
        )
    }
}

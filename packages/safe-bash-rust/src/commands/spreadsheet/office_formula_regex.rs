// Regex formula contracts adapted from IronCalc f936620 text/regex_functions.rs
// (MIT, LICENSE.IronCalc) and Univer 4767b3b text/regex{match,extract,replace}
// (Apache-2.0, LICENSE.Univer). Excel's documented return modes and occurrence
// selectors take precedence over the older upstream argument contracts.
// Uses Poe Code's bounded Rust matcher; no host JavaScript regular expressions.
use super::strings::string;
use super::{Calculation, Coord, Expr, Value};
use crate::commands::search::ZeroRegex;

impl Calculation<'_> {
    pub(super) fn regex_function(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let (min, max) = match name {
            "REGEXMATCH" | "REGEXTEST" => (2, 3),
            "REGEXEXTRACT" => (2, 4),
            _ => (3, 5),
        };
        if !(min..=max).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let mut values = Vec::new();
        let (mut height, mut width) = (1, 1);
        let mut matrix = false;
        for arg in args {
            let mut value = self.eval(arg, pos, depth + 1, true)?;
            if !self.array && !matches!(value, Value::Matrix(_)) {
                value = self.implicit_invalid_range(arg, value, pos)?;
                value = self.scalar(value, pos, depth + 1)?;
            }
            matrix |= matches!(value, Value::Range(..) | Value::Matrix(_));
            let rows = self.matrix(value, depth + 1)?;
            height = height.max(rows.len());
            width = width.max(rows.first()?.len());
            values.push(rows);
        }
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?
                .checked_add(height.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
        )?;
        let mut output = Vec::with_capacity(height);
        // A scalar pattern across a large range must not compile once per cell.
        let mut compiled: Option<(String, bool, Option<ZeroRegex>)> = None;
        for r in 0..height {
            let mut row = Vec::with_capacity(width);
            for c in 0..width {
                self.tick(depth)?;
                let mut items = [&Value::Blank; 5];
                for (i, value) in values.iter().enumerate() {
                    items[i] = value
                        .get(if value.len() == 1 { 0 } else { r })
                        .and_then(|row| row.get(if row.len() == 1 { 0 } else { c }))
                        .unwrap_or(&Value::Error("#N/A"));
                    self.charge_value(items[i])?;
                }
                let result = calculate(name, &items, &mut compiled, &mut self.work)?;
                if let Value::Matrix(mut rows) = result {
                    if height == 1 && width == 1 {
                        self.result_format = None;
                        return Some(Value::Matrix(rows));
                    }
                    // Nested arrays cannot be represented as worksheet cells.
                    row.push(if rows.len() == 1 && rows[0].len() == 1 {
                        rows.pop()?.pop()?
                    } else {
                        Value::Error("#CALC!")
                    });
                } else {
                    row.push(result);
                }
            }
            output.push(row);
        }
        self.result_format = None;
        Some(if matrix {
            Value::Matrix(output)
        } else {
            output.pop()?.pop()?
        })
    }
}

fn calculate(
    name: &str,
    args: &[&Value; 5],
    compiled: &mut Option<(String, bool, Option<ZeroRegex>)>,
    work: &mut usize,
) -> Option<Value> {
    for value in args {
        if let Value::Error(e) | Value::LiteralError(e) = value {
            return Some(Value::Error(e));
        }
    }
    let case = match name {
        "REGEXTEST" | "REGEXMATCH" => 2,
        "REGEXEXTRACT" => 3,
        _ => 4,
    };
    let insensitive = match args[case].numeric() {
        Some(0.) => false,
        Some(1.) => true,
        _ => return Some(Value::Error("#VALUE!")),
    };
    let extract = name == "REGEXEXTRACT";
    let replace = name == "REGEXREPLACE";
    let selector = if extract || replace {
        match args[if extract { 2 } else { 3 }].numeric() {
            Some(n) if n.is_finite() => n.trunc(),
            _ => return Some(Value::Error("#VALUE!")),
        }
    } else {
        0.
    };
    if extract && !(0. ..=2.).contains(&selector) {
        return Some(Value::Error("#VALUE!"));
    }
    let text = string(args[0]);
    let pattern = string(args[1]);
    *work = work.checked_sub(pattern.len())?;
    if !compiled
        .as_ref()
        .is_some_and(|(p, case, _)| p == pattern.as_ref() && *case == insensitive)
    {
        let regex = ZeroRegex::office(&pattern, insensitive, work)?;
        *compiled = Some((pattern.into_owned(), insensitive, regex));
    }
    let Some(regex) = &compiled.as_ref()?.2 else {
        return Some(Value::Error("#VALUE!"));
    };
    if !extract && !replace {
        return Some(Value::Bool(regex.office_match(&text, false, false, work)?));
    }
    let matches = regex.office_matches(&text, replace || selector == 1., work)?;
    if extract {
        if matches.is_empty() || selector == 2. && matches[0].len() == 1 {
            return Some(Value::Error("#N/A"));
        }
        let count = if selector == 2. {
            matches[0].len() - 1
        } else {
            matches.len()
        };
        *work = work.checked_sub(count.checked_mul(std::mem::size_of::<Value>())?)?;
        let mut output = Vec::with_capacity(count);
        for i in 0..count {
            let span = if selector == 2. {
                matches[0][i + 1]
            } else {
                matches[i][0]
            };
            let s = span.map_or("", |(a, b)| &text[a..b]);
            *work = work.checked_sub(s.len())?;
            output.push(Value::Text(s.into()));
        }
        return Some(if selector == 0. {
            output.pop()?
        } else {
            Value::Matrix(vec![output])
        });
    }
    let replacement = string(args[2]);
    let mut output = String::new();
    let mut units = 0;
    let mut end = 0;
    for (i, captures) in matches.iter().enumerate() {
        if selector != 0.
            && (if selector > 0. {
                (i + 1) as f64 != selector
            } else {
                (matches.len() - i) as f64 != -selector
            })
        {
            continue;
        }
        let (a, b) = captures[0]?;
        if !append(&mut output, &text[end..a], &mut units, work)? {
            return Some(Value::Error("#VALUE!"));
        }
        let mut chars = replacement.char_indices().peekable();
        while let Some((start, ch)) = chars.next() {
            *work = work.checked_sub(1)?;
            let part = if ch == '$' {
                if chars.peek().is_some_and(|(_, c)| *c == '$') {
                    chars.next();
                    "$"
                } else if chars.peek().is_some_and(|(_, c)| c.is_ascii_digit()) {
                    let mut group = Some(0usize);
                    while let Some(&(_, c)) = chars.peek().filter(|(_, c)| c.is_ascii_digit()) {
                        *work = work.checked_sub(1)?;
                        group = group.and_then(|g| {
                            g.checked_mul(10)?.checked_add(c as usize - '0' as usize)
                        });
                        chars.next();
                    }
                    group
                        .and_then(|g| captures.get(g))
                        .copied()
                        .flatten()
                        .map_or("", |(a, b)| &text[a..b])
                } else {
                    "$"
                }
            } else {
                &replacement[start..start + ch.len_utf8()]
            };
            if !append(&mut output, part, &mut units, work)? {
                return Some(Value::Error("#VALUE!"));
            }
        }
        end = b;
    }
    if !append(&mut output, &text[end..], &mut units, work)? {
        return Some(Value::Error("#VALUE!"));
    }
    Some(Value::Text(output))
}

fn append(output: &mut String, text: &str, units: &mut usize, work: &mut usize) -> Option<bool> {
    *work = work.checked_sub(text.len().checked_mul(2)?.checked_add(1)?)?;
    *units = units.checked_add(text.encode_utf16().count())?;
    if *units > 32_767 {
        return Some(false);
    }
    output.push_str(text);
    Some(true)
}

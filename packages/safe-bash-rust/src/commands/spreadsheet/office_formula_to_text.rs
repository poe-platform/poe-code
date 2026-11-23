// ARRAYTOTEXT serialization adapts IronCalc f936620 text/arraytotext.rs (MIT,
// LICENSE.IronCalc). Format arrays adapt Univer 4767b3b (Apache-2.0,
// LICENSE.Univer). VALUETOTEXT types follow the original Excel fixture: even
// booleans, numbers and errors become text. References are read incrementally.
use super::{Calculation, Coord, Expr, Value, lookup, strings};

fn format(value: &Value) -> Result<bool, &'static str> {
    if let Value::Error(e) | Value::LiteralError(e) = value {
        return Err(e);
    }
    match value.numeric().map(f64::floor) {
        Some(0.) => Ok(false),
        Some(1.) => Ok(true),
        _ => Err("#VALUE!"),
    }
}

// Check UTF-16 length and charge bytes before growing the result. Strict text
// doubles embedded quotes; numbers, booleans, errors and blanks stay unquoted.
fn append(
    output: &mut String,
    units: &mut usize,
    text: &str,
    quoted: bool,
    work: &mut usize,
) -> Option<bool> {
    *work = work.checked_sub(text.len())?;
    let quotes = if quoted {
        text.bytes().filter(|&b| b == b'"').count() + 2
    } else {
        0
    };
    *units = units
        .checked_add(text.encode_utf16().count())?
        .checked_add(quotes)?;
    if *units > 32767 {
        return Some(false);
    }
    *work = work.checked_sub(text.len().checked_add(quotes)?)?;
    output.reserve(text.len().checked_add(quotes)?);
    if quoted {
        output.push('"');
        for c in text.chars() {
            output.push(c);
            if c == '"' {
                output.push('"');
            }
        }
        output.push('"');
    } else {
        output.push_str(text);
    }
    Some(true)
}

impl Calculation<'_> {
    fn text_entry(
        &mut self,
        source: &Value,
        r: usize,
        c: usize,
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let value = self.lookup_entry(source, r, c, pos, depth)?;
        if let Value::Range(a, b) = source {
            let coord = (
                a.0,
                a.1.min(b.1).checked_add(r)?,
                a.2.min(b.2).checked_add(c)?,
            );
            if matches!(value, Value::Number(0.))
                && matches!(
                    self.results.get(&coord).or_else(|| self.values.get(&coord)),
                    Some(Value::Blank | Value::Empty)
                )
            {
                return Some(Value::Blank);
            }
        }
        Some(value)
    }

    fn serialize_array(
        &mut self,
        source: &Value,
        strict: bool,
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let (height, width) = lookup::dimensions(source);
        // A whole-sheet range exceeds usize on Wasm. It already exceeds the
        // smallest possible text output, so report the cell error directly.
        let Some(count) = height.checked_mul(width).filter(|&n| n <= 32768) else {
            return Some(Value::Error("#CALC!"));
        };
        let minimum = if strict {
            count.checked_add(1)?
        } else {
            count.saturating_sub(1).checked_mul(2)?
        };
        if minimum > 32767 {
            return Some(Value::Error("#CALC!"));
        }
        let mut output = String::new();
        let mut units = 0;
        if strict {
            append(&mut output, &mut units, "{", false, &mut self.work)?;
        }
        for r in 0..height {
            for c in 0..width {
                self.tick(depth)?;
                let value = self.text_entry(source, r, c, pos, depth + 1)?;
                if count == 1
                    && let Value::Error(e) | Value::LiteralError(e) = value
                {
                    return Some(Value::Error(e));
                }
                if matches!(value, Value::Lambda(_)) {
                    return Some(Value::Error("#CALC!"));
                }
                if r != 0 || c != 0 {
                    let separator = if !strict {
                        ", "
                    } else if c == 0 {
                        ";"
                    } else {
                        ","
                    };
                    if !append(&mut output, &mut units, separator, false, &mut self.work)? {
                        return Some(Value::Error("#CALC!"));
                    }
                }
                let quoted = strict && matches!(value, Value::Text(_) | Value::UninternedText(_));
                if !append(
                    &mut output,
                    &mut units,
                    &strings::string(&value),
                    quoted,
                    &mut self.work,
                )? {
                    return Some(Value::Error("#CALC!"));
                }
            }
        }
        if strict && !append(&mut output, &mut units, "}", false, &mut self.work)? {
            return Some(Value::Error("#CALC!"));
        }
        Some(Value::Text(output))
    }

    pub(super) fn text_function(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if !(1..=2).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let aggregate = name == "ARRAYTOTEXT";
        let mut source = self.eval(&args[0], pos, depth + 1, true)?;
        let mut formats = if args.len() == 2 {
            self.eval(&args[1], pos, depth + 1, true)?
        } else {
            Value::Number(0.)
        };
        if !self.array {
            if !aggregate && !matches!(source, Value::Matrix(_)) {
                source = self.scalar(source, pos, depth + 1)?;
            }
            if !matches!(formats, Value::Matrix(_)) {
                formats = self.scalar(formats, pos, depth + 1)?;
            }
        }
        let source = source.into_range();
        let formats = formats.into_range();
        if matches!(source,Value::Range(a,b) if a.0!=b.0)
            || matches!(formats,Value::Range(a,b) if a.0!=b.0)
        {
            return Some(Value::Error("#VALUE!"));
        }
        let (sh, sw) = lookup::dimensions(&source);
        let (fh, fw) = lookup::dimensions(&formats);
        let (height, width) = if aggregate {
            (fh, fw)
        } else {
            (fh.max(sh), fw.max(sw))
        };
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?
                .checked_add(height.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
        )?;
        let mut results = Vec::with_capacity(height);
        let mut cached: [Option<Value>; 2] = [None, None];
        for r in 0..height {
            let mut row = Vec::with_capacity(width);
            for c in 0..width {
                self.tick(depth)?;
                let (fr, fc) = (if fh == 1 { 0 } else { r }, if fw == 1 { 0 } else { c });
                let flag = if fr >= fh || fc >= fw {
                    Err("#N/A")
                } else {
                    format(&self.lookup_entry(&formats, fr, fc, pos, depth + 1)?)
                };
                let strict = match flag {
                    Ok(v) => v,
                    Err(e) => {
                        row.push(Value::Error(e));
                        continue;
                    }
                };
                let value = if aggregate {
                    let i = usize::from(strict);
                    if cached[i].is_none() {
                        cached[i] = Some(self.serialize_array(&source, strict, pos, depth + 1)?);
                    }
                    let value = cached[i].as_ref()?;
                    self.charge_value(value)?;
                    value.clone()
                } else {
                    let (sr, sc) = (if sh == 1 { 0 } else { r }, if sw == 1 { 0 } else { c });
                    if sr >= sh || sc >= sw {
                        row.push(Value::Error("#N/A"));
                        continue;
                    }
                    let value = self.text_entry(&source, sr, sc, pos, depth + 1)?;
                    if matches!(value, Value::Lambda(_)) {
                        row.push(Value::Error("#CALC!"));
                        continue;
                    }
                    let quoted =
                        strict && matches!(value, Value::Text(_) | Value::UninternedText(_));
                    let mut output = String::new();
                    let mut units = 0;
                    if append(
                        &mut output,
                        &mut units,
                        &strings::string(&value),
                        quoted,
                        &mut self.work,
                    )? {
                        Value::Text(output)
                    } else {
                        Value::Error("#VALUE!")
                    }
                };
                row.push(value);
            }
            results.push(row);
        }
        if height == 1 && width == 1 {
            results.pop()?.pop()
        } else {
            Some(Value::Matrix(results))
        }
    }
}

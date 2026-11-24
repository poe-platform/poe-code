use crate::numbers;
use crate::pattern::{Iteration, Matcher};
use crate::{Error, Result, Runtime, Value, first};
impl Runtime {
    pub(crate) fn install(&mut self) {
        self.set_global("_G", self.globals.clone());
        self.set_global("_VERSION", Value::String("Lua 5.3".into()));
        for name in [
            "assert",
            "error",
            "type",
            "tostring",
            "tonumber",
            "select",
            "next",
            "pairs",
            "ipairs",
            "rawget",
            "rawset",
            "rawlen",
            "rawequal",
            "getmetatable",
            "setmetatable",
            "__pandoc_depth",
            "__pandoc_reference",
            "__pandoc_string",
            "__pandoc_ast_error",
            "__pandoc_unsupported",
            "__pandoc_invalid",
        ] {
            self.set_global(name, Value::Native(name));
        }
        for (name, functions) in [
            (
                "string",
                &[
                    "string.upper",
                    "string.lower",
                    "string.len",
                    "string.sub",
                    "string.rep",
                    "string.reverse",
                    "string.byte",
                    "string.char",
                    "string.find",
                    "string.match",
                    "string.pack",
                    "string.packsize",
                    "string.unpack",
                ][..],
            ),
            (
                "math",
                &[
                    "math.abs",
                    "math.ceil",
                    "math.floor",
                    "math.sqrt",
                    "math.exp",
                    "math.log",
                    "math.sin",
                    "math.cos",
                    "math.tan",
                    "math.asin",
                    "math.acos",
                    "math.atan",
                    "math.deg",
                    "math.rad",
                    "math.min",
                    "math.max",
                    "math.fmod",
                    "math.modf",
                    "math.tointeger",
                    "math.type",
                    "math.random",
                    "math.randomseed",
                    "math.ult",
                ][..],
            ),
            (
                "utf8",
                &[
                    "utf8.len",
                    "utf8.char",
                    "utf8.codepoint",
                    "utf8.offset",
                    "utf8.codes",
                ][..],
            ),
        ] {
            let table = self.table();
            for function in functions {
                self.raw_set(
                    &table,
                    Value::String(function.split_once('.').unwrap().1.into()),
                    Value::Native(function),
                )
                .unwrap();
            }
            self.set_global(name, table);
        }
        self.string_meta = self.table();
        self.raw_set(
            &self.string_meta.clone(),
            Value::String("__index".into()),
            self.global("string"),
        )
        .unwrap();
        self.raw_set(
            &self.global("utf8"),
            Value::String("charpattern".into()),
            Value::String(vec![
                91, 0, 45, 127, 194, 45, 244, 93, 91, 128, 45, 191, 93, 42,
            ]),
        )
        .unwrap();
        let factory = self
            .run(include_str!("string.lua"), "@string")
            .expect("valid internal string library")
            .remove(0);
        self.call(
            factory,
            vec![
                self.global("string"),
                Value::Native("string.coerce"),
                Value::Native("string.next_match"),
                Value::Native("string.integer"),
                Value::Native("string.join"),
                Value::Native("string.replacement_token"),
                Value::Native("string.format_token"),
                Value::Native("string.format_value"),
            ],
        )
        .expect("valid internal string library installation");
        let factory = self
            .run(include_str!("table.lua"), "@table")
            .expect("valid internal table library")
            .remove(0);
        let table = self
            .call(
                factory,
                vec![
                    Value::Native("table.pack"),
                    Value::Native("table.integer"),
                    Value::Native("table.string"),
                    Value::Native("table.finish"),
                    Value::Native("table.values"),
                    Value::Native("table.random"),
                    Value::Native("table.check"),
                ],
            )
            .expect("valid internal table library installation")
            .remove(0);
        self.set_global("table", table);
        let math = self.global("math");
        for (name, value) in [("pi", std::f64::consts::PI), ("huge", f64::INFINITY)] {
            self.raw_set(&math, Value::String(name.into()), Value::Number(value))
                .unwrap();
        }
        for (name, value) in [("maxinteger", i32::MAX), ("mininteger", i32::MIN)] {
            self.raw_set(&math, Value::String(name.into()), Value::Integer(value))
                .unwrap();
        }
    }
    fn lua_error(&self, value: Value, level: i32) -> Error {
        let mut error = Error::unlocated(match &value {
            Value::String(_) | Value::Integer(_) | Value::Number(_) => value.text(),
            _ => "Lua filter execution failed".into(),
        });
        if level > 0 && matches!(value, Value::String(_)) {
            // Native callbacks count as frames but have no Lua source location.
            // A tail call replaces its caller in the streaming engine.
            if let Some(frame) = self
                .frames
                .iter()
                .rev()
                .filter(|frame| !frame.tail)
                .nth(level as usize)
            {
                error.location = frame
                    .source
                    .as_ref()
                    .map(|source| (source.clone(), frame.line));
            }
        }
        error
    }
    pub(crate) fn native(&mut self, name: &str, args: Vec<Value>) -> Result<Vec<Value>> {
        let required = match name {
            "rawset" => 3,
            "setmetatable" | "rawget" | "rawequal" | "ipairs.next" => 2,
            "getmetatable" | "rawlen" | "type" | "next" | "tostring" | "pairs" | "ipairs"
            | "select" | "assert" | "tonumber" => 1,
            _ => 0,
        };
        if args.len() < required {
            return Err(Error::unlocated("Value expected"));
        }
        let a = |i: usize| args.get(i).cloned().unwrap_or_default();
        let n = |i: usize| a(i).number();
        let s = |i: usize| match a(i) {
            Value::String(s) => Ok(s),
            v @ (Value::Integer(_) | Value::Number(_)) => Ok(v.bytes()),
            _ => Err(Error::new("string expected")),
        };
        let result = match name {
            "string.pack" | "string.packsize" | "string.unpack" => {
                return crate::pack::invoke(name, &args);
            }
            "__pandoc_depth" | "__pandoc_reference" | "__pandoc_string" => return Ok(Vec::new()),
            "__pandoc_ast_error" => {
                return Err(Error::new(
                    "Lua callback must return an element, list or nil",
                ));
            }
            "__pandoc_unsupported" | "__pandoc_invalid" => {
                return Err(Error::new(a(0).text()));
            }
            "error" => {
                let level = if a(1) == Value::Nil {
                    1
                } else {
                    numbers::integral(n(1).map_err(|_| Error::unlocated("Expected Lua number"))?)
                        .map_err(|error| Error::unlocated(error.message))?
                };
                return Err(self.lua_error(a(0), level));
            }
            "assert" => {
                if !a(0).truth() {
                    return Err(self.lua_error(
                        args.get(1)
                            .cloned()
                            .unwrap_or_else(|| Value::String("assertion failed!".into())),
                        1,
                    ));
                }
                return Ok(args);
            }
            "type" => Value::String(a(0).kind().into()),
            "tostring" => {
                let method = self.meta(&a(0), "__tostring");
                if method == Value::Nil {
                    Value::String(a(0).bytes())
                } else {
                    let result = first(self.call(method, vec![a(0)])?);
                    if !matches!(
                        result,
                        Value::String(_) | Value::Integer(_) | Value::Number(_)
                    ) {
                        return Err(Error::unlocated("'__tostring' must return a string"));
                    }
                    Value::String(result.bytes())
                }
            }
            "tonumber" => {
                if a(1) != Value::Nil {
                    let base = n(1).map_err(|_| Error::unlocated("Expected Lua number"))?;
                    let base = numbers::integral(base)
                        .map_err(|error| Error::unlocated(error.message))?
                        as u32;
                    let Value::String(bytes) = a(0) else {
                        return Err(Error::unlocated("Expected Lua string"));
                    };
                    if !(2..=36).contains(&base) {
                        return Err(Error::unlocated("base out of range"));
                    }
                    numbers::radix(&bytes, base).unwrap_or_default()
                } else {
                    match a(0) {
                        value @ (Value::Integer(_) | Value::Number(_)) => value,
                        Value::String(bytes) => numbers::parse(&bytes).unwrap_or_default(),
                        _ => Value::Nil,
                    }
                }
            }
            "select" => {
                if matches!(a(0), Value::String(bytes) if bytes.first() == Some(&b'#')) {
                    Value::Integer(args.len().saturating_sub(1) as i32)
                } else {
                    let i = numbers::integral(
                        n(0).map_err(|_| Error::unlocated("Expected Lua number"))?,
                    )
                    .map_err(|error| Error::unlocated(error.message))?
                        as isize;
                    let i = if i < 0 { args.len() as isize + i } else { i };
                    if i < 1 {
                        return Err(Error::unlocated("index out of range"));
                    }
                    return Ok(args.get(i as usize..).unwrap_or_default().to_vec());
                }
            }
            "rawget" => {
                if !matches!(a(0), Value::Table(_)) {
                    return Err(Error::unlocated("Expected Lua table"));
                }
                self.raw_get(&a(0), &a(1))
            }
            "rawset" => {
                self.raw_set(&a(0), a(1), a(2))?;
                a(0)
            }
            "rawlen" => Value::Integer(self.length(&a(0))?),
            "rawequal" => Value::Bool(a(0) == a(1)),
            "getmetatable" => {
                let meta = match a(0) {
                    Value::Table(t) => self.tables[t].meta.clone(),
                    Value::String(_) => self.string_meta.clone(),
                    _ => Value::Nil,
                };
                let protected = self.raw_get(&meta, &Value::String("__metatable".into()));
                if protected == Value::Nil {
                    meta
                } else {
                    protected
                }
            }
            "setmetatable" => {
                let Value::Table(t) = a(0) else {
                    return Err(Error::unlocated("Expected Lua table"));
                };
                if !matches!(a(1), Value::Nil | Value::Table(_)) {
                    return Err(Error::unlocated("Expected Lua table"));
                }
                if self.meta(&a(0), "__metatable") != Value::Nil {
                    return Err(Error::unlocated("Cannot change a protected metatable"));
                }
                self.tables[t].meta = a(1);
                a(0)
            }
            "pairs" => {
                let method = self.meta(&a(0), "__pairs");
                return if method != Value::Nil {
                    let mut values = self.call(method, vec![a(0)])?;
                    values.resize(3, Value::Nil);
                    Ok(values)
                } else {
                    Ok(vec![Value::Native("next"), a(0), Value::Nil])
                };
            }
            "ipairs" => return Ok(vec![Value::Native("ipairs.next"), a(0), Value::Integer(0)]),
            "ipairs.next" => {
                let index =
                    numbers::integral(n(1).map_err(|_| Error::unlocated("Expected Lua number"))?)
                        .map_err(|error| Error::unlocated(error.message))?
                        .wrapping_add(1);
                let value = self.get(&a(0), &Value::Integer(index))?;
                return Ok(if value == Value::Nil {
                    vec![Value::Nil]
                } else {
                    vec![Value::Integer(index), value]
                });
            }
            "next" => {
                let Value::Table(table) = a(0) else {
                    return Err(Error::unlocated("Expected Lua table"));
                };
                let entries = &self.tables[table].entries;
                let after = a(1);
                let offset = if after == Value::Nil {
                    0
                } else {
                    entries
                        .iter()
                        .position(|(k, _)| k == &after)
                        .ok_or_else(|| Error::unlocated("Invalid key to next"))?
                        + 1
                };
                return Ok(entries
                    .iter()
                    .skip(offset)
                    .find(|(_, value)| *value != Value::Nil)
                    .map(|(k, v)| vec![k.clone(), v.clone()])
                    .unwrap_or_else(|| vec![Value::Nil]));
            }
            "string.format_token" | "string.format_value" => return self.format(name, args),
            "string.upper" => Value::String(s(0)?.to_ascii_uppercase()),
            "string.lower" => Value::String(s(0)?.to_ascii_lowercase()),
            "string.len" => Value::Integer(s(0)?.len() as i32),
            "string.sub" | "string.byte" | "string.rep" => {
                let string = |i| {
                    s(i).map_err(|_| {
                        Error::unlocated("Expected Lua string or number for concatenation")
                    })
                };
                let integer = |i| {
                    let number = n(i).map_err(|_| Error::unlocated("Expected Lua number"))?;
                    numbers::integral(number).map_err(|error| Error::unlocated(error.message))
                };
                let text = string(0)?;
                if name == "string.rep" {
                    let count = integer(1)?.max(0) as usize;
                    let sep = if a(2) == Value::Nil {
                        Vec::new()
                    } else {
                        string(2)?
                    };
                    if count == 0 {
                        return Ok(vec![Value::String(Vec::new())]);
                    }
                    if (text.len() as u64 + sep.len() as u64) * count as u64 > i32::MAX as u64 {
                        return Err(Error::unlocated("Resulting string too large"));
                    }
                    if text.is_empty() && (sep.is_empty() || count == 1) {
                        return Ok(vec![Value::String(Vec::new())]);
                    }
                    let mut result = Vec::new();
                    for i in 0..count {
                        self.tick()?;
                        if i > 0 {
                            result.extend_from_slice(&sep);
                        }
                        result.extend_from_slice(&text);
                    }
                    Value::String(result)
                } else {
                    let start = if name == "string.byte" && a(1) == Value::Nil {
                        1
                    } else {
                        integer(1)?
                    };
                    let requested = position(start as isize, text.len()).max(0);
                    let end = if a(2) != Value::Nil {
                        integer(2)? as isize
                    } else if name == "string.byte" {
                        requested
                    } else {
                        -1
                    };
                    let end = position(end, text.len()).clamp(0, text.len() as isize) as usize;
                    let start = requested.max(1) as usize - 1;
                    let bytes = text.get(start..end).unwrap_or_default();
                    if name == "string.byte" {
                        return Ok(bytes.iter().map(|b| Value::Integer(*b as i32)).collect());
                    }
                    Value::String(bytes.to_vec())
                }
            }
            "string.reverse" => Value::String(s(0)?.into_iter().rev().collect()),
            "string.char" => {
                let bytes = args
                    .iter()
                    .map(|v| {
                        let n = v.number()?;
                        if !(0.0..=255.0).contains(&n) || n.fract() != 0.0 {
                            return Err(Error::new("value out of range"));
                        }
                        Ok(n as u8)
                    })
                    .collect::<Result<Vec<_>>>()?;
                Value::String(bytes)
            }
            "string.find" | "string.match" | "string.next_match" => {
                let text = s(0)?;
                let pattern = s(1)?;
                let (start, iterator) = if name == "string.next_match" {
                    (
                        n(2)? as isize,
                        Some(Iteration {
                            last: n(3)? as isize,
                            anchor: a(4).truth(),
                        }),
                    )
                } else {
                    let start = if a(2) == Value::Nil { 1.0 } else { n(2)? };
                    if !start.is_finite() || start.fract() != 0.0 {
                        return Err(Error::new("number has no integer representation"));
                    }
                    (position(start as isize, text.len()).max(1) - 1, None)
                };
                return Matcher::new(&text, &pattern, &mut self.steps).search(
                    start,
                    name != "string.match",
                    a(3).truth(),
                    iterator,
                );
            }
            "string.coerce" => Value::String(s(0)?),
            "string.integer" => Value::Integer(numbers::integral(n(0)?)?),
            "string.join" => {
                let mut result = Vec::new();
                for index in 1..=n(1)? as usize {
                    let value = self.get(&a(0), &Value::Integer(index as i32))?;
                    match value {
                        Value::String(text) => result.extend_from_slice(&text),
                        value @ (Value::Integer(_) | Value::Number(_)) => {
                            result.extend(value.bytes())
                        }
                        _ => return Err(Error::new("string expected")),
                    }
                }
                Value::String(result)
            }
            "string.replacement_token" => {
                let text = s(0)?;
                let start = n(1)? as usize;
                let bytes = &text;
                let mut end = start;
                while end < bytes.len() && bytes[end] != b'%' {
                    self.tick()?;
                    end += 1;
                }
                if end > start {
                    return Ok(vec![
                        Value::Integer(end as i32),
                        Value::String(text[start..end].into()),
                        Value::Bool(false),
                    ]);
                }
                let byte = *bytes
                    .get(start + 1)
                    .ok_or_else(|| Error::new("Invalid '%' in replacement string"))?;
                let (value, capture) = if byte.is_ascii_digit() {
                    (Value::Integer((byte - b'0') as i32), true)
                } else if byte == b'%' {
                    (Value::String("%".into()), false)
                } else {
                    return Err(Error::new("Invalid '%' in replacement string"));
                };
                return Ok(vec![
                    Value::Integer((start + 2) as i32),
                    value,
                    Value::Bool(capture),
                ]);
            }
            "table.pack" | "table.integer" | "table.string" | "table.finish" | "table.values"
            | "table.random" | "table.check" => return self.table_library(name, args),
            "math.random" | "math.randomseed" | "math.ult" => {
                if name != "math.random" && args.is_empty() {
                    return Err(Error::unlocated("Value expected"));
                }
                let number = |i| n(i).map_err(|_| Error::unlocated("Expected Lua number"));
                let integer = |i| {
                    numbers::integral(number(i)?).map_err(|error| Error::unlocated(error.message))
                };
                if name == "math.ult" {
                    Value::Bool((integer(0)? as u32) < integer(1)? as u32)
                } else if name == "math.randomseed" {
                    self.random_state = (number(0)? % 4294967296.0) as i64 as i32;
                    if self.random_state == 0 {
                        self.random_state = 1;
                    }
                    self.next_random();
                    return Ok(Vec::new());
                } else {
                    // The existing library advances even when arguments are invalid.
                    let random = self.next_random();
                    if args.is_empty() {
                        return Ok(vec![Value::Number(random)]);
                    }
                    if args.len() > 2 {
                        return Err(Error::unlocated("Wrong number of arguments"));
                    }
                    let first = integer(0)?;
                    let (low, high) = if args.len() == 1 {
                        (1, first)
                    } else {
                        (first, integer(1)?)
                    };
                    if low > high {
                        return Err(Error::unlocated("Interval is empty"));
                    }
                    if low < 0 && high > i32::MAX + low {
                        return Err(Error::unlocated("Interval too large"));
                    }
                    Value::Integer((random * (high as f64 - low as f64 + 1.0)).floor() as i32 + low)
                }
            }
            "math.min" | "math.max" => {
                let mut best = args
                    .first()
                    .cloned()
                    .ok_or_else(|| Error::new("Value expected"))?;
                for value in args.iter().skip(1) {
                    let (left, right) = if name == "math.min" {
                        (value.clone(), best.clone())
                    } else {
                        (best.clone(), value.clone())
                    };
                    if self.binary("<", left, right)?.truth() {
                        best = value.clone();
                    }
                }
                best
            }
            "math.modf" => {
                let value = n(0)?;
                let whole = value.trunc();
                return Ok(vec![
                    numbers::tagged(whole),
                    Value::Number(if value == whole { 0.0 } else { value - whole }),
                ]);
            }
            "math.type" => match a(0) {
                Value::Integer(_) => Value::String("integer".into()),
                Value::Number(_) => Value::String("float".into()),
                _ => Value::Nil,
            },
            "math.tointeger" => a(0)
                .number()
                .ok()
                .and_then(|n| numbers::integral(n).ok())
                .map(Value::Integer)
                .unwrap_or_default(),
            "math.abs" | "math.ceil" | "math.floor" | "math.sqrt" | "math.exp" | "math.log"
            | "math.sin" | "math.cos" | "math.tan" | "math.asin" | "math.acos" | "math.atan"
            | "math.deg" | "math.rad" | "math.fmod" => {
                let x = n(0)?;
                match name {
                    "math.abs" => {
                        return Ok(vec![match a(0) {
                            Value::Integer(n) => Value::Integer(n.wrapping_abs()),
                            _ => Value::Number(x.abs()),
                        }]);
                    }
                    "math.ceil" => return Ok(vec![numbers::tagged(x.ceil())]),
                    "math.floor" => return Ok(vec![numbers::tagged(x.floor())]),
                    "math.fmod"
                        if matches!((a(0), a(1)), (Value::Integer(_), Value::Integer(_))) =>
                    {
                        let divisor = n(1)?;
                        if divisor == 0.0 {
                            return Err(Error::new("Zero divisor"));
                        }
                        return Ok(vec![Value::Integer((x % divisor) as i32)]);
                    }
                    _ => (),
                }
                Value::Number(match name {
                    "math.sqrt" => x.sqrt(),
                    "math.exp" => x.exp(),
                    "math.log" => {
                        if args.len() > 1 {
                            match n(1)? {
                                2.0 => x.log2(),
                                10.0 => x.log10(),
                                base => x.ln() / base.ln(),
                            }
                        } else {
                            x.ln()
                        }
                    }
                    "math.sin" => x.sin(),
                    "math.cos" => x.cos(),
                    "math.tan" => x.tan(),
                    "math.asin" => x.asin(),
                    "math.acos" => x.acos(),
                    "math.atan" => {
                        if args.len() > 1 {
                            x.atan2(n(1)?)
                        } else {
                            x.atan()
                        }
                    }
                    "math.deg" => x.to_degrees(),
                    "math.rad" => x.to_radians(),
                    _ => x % n(1)?,
                })
            }
            "utf8.len" | "utf8.char" | "utf8.codepoint" | "utf8.codes" | "utf8.next"
            | "utf8.offset" => return self.utf8(name, args),
            _ => return Err(Error::new(format!("unsupported Lua function: {name}"))),
        };
        Ok(vec![result])
    }

    fn next_random(&mut self) -> f64 {
        // Fengari multiplies in binary64 before truncating to 31 bits.
        // Integer multiplication would produce a different seeded sequence.
        self.random_state =
            ((1103515245.0 * self.random_state as f64 + 12345.0) as i64 as i32) & 0x7fffffff;
        self.random_state as f64 / 2147483648.0
    }
}
fn position(index: isize, length: usize) -> isize {
    if index < 0 {
        length as isize + index + 1
    } else {
        index
    }
}

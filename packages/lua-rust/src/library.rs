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
                "table",
                &[
                    "table.insert",
                    "table.remove",
                    "table.concat",
                    "table.unpack",
                    "table.pack",
                    "table.sort",
                    "table.move",
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
    pub(crate) fn native(&mut self, name: &str, args: Vec<Value>) -> Result<Vec<Value>> {
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
            "__pandoc_unsupported" | "__pandoc_invalid" | "error" => {
                return Err(Error::new(a(0).text()));
            }
            "assert" => {
                if !a(0).truth() {
                    return Err(Error::new(
                        args.get(1)
                            .map(Value::text)
                            .unwrap_or_else(|| "assertion failed!".into()),
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
                        return Err(Error::new("'__tostring' must return a string"));
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
                if a(0) == Value::String("#".into()) {
                    Value::Integer(args.len().saturating_sub(1) as i32)
                } else {
                    let i = n(0)? as isize;
                    let i = if i < 0 { args.len() as isize + i } else { i };
                    if i < 1 {
                        return Err(Error::new("index out of range"));
                    }
                    return Ok(args.get(i as usize..).unwrap_or_default().to_vec());
                }
            }
            "rawget" => self.raw_get(&a(0), &a(1)),
            "rawset" => {
                self.raw_set(&a(0), a(1), a(2))?;
                a(0)
            }
            "rawlen" => Value::Integer(self.length(&a(0))? as i32),
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
                    return Err(Error::new("table expected"));
                };
                if self.meta(&a(0), "__metatable") != Value::Nil {
                    return Err(Error::new("cannot change a protected metatable"));
                }
                if !matches!(a(1), Value::Nil | Value::Table(_)) {
                    return Err(Error::new("nil or table expected"));
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
                let index = numbers::integral(n(1)?)?.wrapping_add(1);
                let value = self.get(&a(0), &Value::Integer(index))?;
                return Ok(if value == Value::Nil {
                    vec![Value::Nil]
                } else {
                    vec![Value::Integer(index), value]
                });
            }
            "next" => {
                let entries = self.entries(&a(0))?;
                let offset = if a(1) == Value::Nil {
                    0
                } else {
                    entries
                        .iter()
                        .position(|(k, _)| k == &a(1))
                        .ok_or_else(|| Error::new("invalid key to 'next'"))?
                        + 1
                };
                return Ok(entries
                    .get(offset)
                    .map(|(k, v)| vec![k.clone(), v.clone()])
                    .unwrap_or_else(|| vec![Value::Nil]));
            }
            "string.format_token" | "string.format_value" => return self.format(name, args),
            "string.upper" => Value::String(s(0)?.to_ascii_uppercase()),
            "string.lower" => Value::String(s(0)?.to_ascii_lowercase()),
            "string.len" => Value::Integer(s(0)?.len() as i32),
            "string.sub" => {
                let text = s(0)?;
                let start = position(n(1)? as isize, text.len()).max(1) as usize;
                let end = position(if args.len() > 2 { n(2)? as isize } else { -1 }, text.len())
                    .min(text.len() as isize)
                    .max(0) as usize;
                Value::String(text.get(start - 1..end).unwrap_or_default().to_vec())
            }
            "string.rep" => {
                let text = s(0)?;
                let count = n(1)?.max(0.0) as usize;
                let sep = if args.len() > 2 { s(2)? } else { Vec::new() };
                let mut result = Vec::new();
                for i in 0..count {
                    self.tick()?;
                    if i > 0 {
                        result.extend_from_slice(&sep)
                    }
                    result.extend_from_slice(&text);
                }
                Value::String(result)
            }
            "string.reverse" => Value::String(s(0)?.into_iter().rev().collect()),
            "string.byte" => {
                let text = s(0)?;
                let start = position(if args.len() > 1 { n(1)? as isize } else { 1 }, text.len())
                    .max(1) as usize;
                let end = position(
                    if args.len() > 2 {
                        n(2)? as isize
                    } else {
                        start as isize
                    },
                    text.len(),
                )
                .min(text.len() as isize)
                .max(0) as usize;
                return Ok(text
                    .get(start - 1..end)
                    .unwrap_or_default()
                    .iter()
                    .map(|b| Value::Integer(*b as i32))
                    .collect());
            }
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
            "table.insert" => {
                let len = self.length(&a(0))?;
                let (pos, value) = if args.len() > 2 {
                    (n(1)? as usize, a(2))
                } else {
                    (len + 1, a(1))
                };
                if pos < 1 || pos > len + 1 {
                    return Err(Error::new("position out of bounds"));
                }
                for i in (pos..=len).rev() {
                    let v = self.get(&a(0), &Value::Integer(i as i32))?;
                    self.set(a(0), Value::Integer((i + 1) as i32), v)?;
                }
                self.set(a(0), Value::Integer(pos as i32), value)?;
                return Ok(Vec::new());
            }
            "table.remove" => {
                let len = self.length(&a(0))?;
                let pos = if args.len() > 1 { n(1)? as usize } else { len };
                let value = self.get(&a(0), &Value::Integer(pos as i32))?;
                for i in pos..len {
                    let v = self.get(&a(0), &Value::Integer((i + 1) as i32))?;
                    self.set(a(0), Value::Integer(i as i32), v)?;
                }
                self.set(a(0), Value::Integer(len as i32), Value::Nil)?;
                value
            }
            "table.concat" => {
                let sep = if args.len() > 1 { s(1)? } else { Vec::new() };
                let start = if args.len() > 2 { n(2)? as i64 } else { 1 };
                let end = if args.len() > 3 {
                    n(3)? as i64
                } else {
                    self.length(&a(0))? as i64
                };
                let mut text = Vec::new();
                for i in start..=end {
                    let value = self.get(&a(0), &Value::Integer(i as i32))?;
                    if !matches!(
                        value,
                        Value::String(_) | Value::Integer(_) | Value::Number(_)
                    ) {
                        return Err(Error::new("invalid value in table for concat"));
                    }
                    if i > start {
                        text.extend_from_slice(&sep)
                    }
                    text.extend(value.bytes());
                }
                Value::String(text)
            }
            "table.pack" => {
                let table = self.table();
                self.raw_set(
                    &table,
                    Value::String("n".into()),
                    Value::Integer(args.len() as i32),
                )?;
                for (i, v) in args.into_iter().enumerate() {
                    self.raw_set(&table, Value::Integer((i + 1) as i32), v)?;
                }
                table
            }
            "table.unpack" => {
                let start = if args.len() > 1 { n(1)? as i64 } else { 1 };
                let end = if args.len() > 2 {
                    n(2)? as i64
                } else {
                    self.length(&a(0))? as i64
                };
                let mut values = Vec::new();
                for i in start..=end {
                    values.push(self.get(&a(0), &Value::Integer(i as i32))?);
                }
                return Ok(values);
            }
            "table.move" => {
                let from = n(1)? as i64;
                let end = n(2)? as i64;
                let to = n(3)? as i64;
                let target = if args.len() > 4 { a(4) } else { a(0) };
                let mut values = Vec::new();
                for i in from..=end {
                    values.push(self.get(&a(0), &Value::Integer(i as i32))?);
                }
                for (i, value) in values.into_iter().enumerate() {
                    self.set(
                        target.clone(),
                        Value::Integer((to + i as i64) as i32),
                        value,
                    )?;
                }
                target
            }
            "table.sort" => {
                let len = self.length(&a(0))?;
                for i in 2..=len {
                    let mut j = i;
                    while j > 1 {
                        let left = self.get(&a(0), &Value::Integer(j as i32))?;
                        let right = self.get(&a(0), &Value::Integer((j - 1) as i32))?;
                        let less = if a(1) == Value::Nil {
                            self.binary("<", left.clone(), right.clone())?.truth()
                        } else {
                            first(self.call(a(1), vec![left.clone(), right.clone()])?).truth()
                        };
                        if !less {
                            break;
                        }
                        self.set(a(0), Value::Integer(j as i32), right)?;
                        self.set(a(0), Value::Integer((j - 1) as i32), left)?;
                        j -= 1;
                    }
                }
                return Ok(Vec::new());
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
}
fn position(index: isize, length: usize) -> isize {
    if index < 0 {
        length as isize + index + 1
    } else {
        index
    }
}

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
        let math = self.global("math");
        for (name, value) in [
            ("pi", std::f64::consts::PI),
            ("huge", f64::INFINITY),
            ("maxinteger", i64::MAX as f64),
            ("mininteger", i64::MIN as f64),
        ] {
            self.raw_set(&math, Value::String(name.into()), Value::Number(value))
                .unwrap();
        }
    }
    pub(crate) fn native(&mut self, name: &str, args: Vec<Value>) -> Result<Vec<Value>> {
        let a = |i: usize| args.get(i).cloned().unwrap_or_default();
        let n = |i: usize| a(i).number();
        let s = |i: usize| match a(i) {
            Value::String(s) => Ok(s),
            Value::Number(n) => Ok(n.to_string()),
            _ => Err(Error::new("string expected")),
        };
        let result = match name {
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
                    Value::String(a(0).text())
                } else {
                    first(self.call(method, vec![a(0)])?)
                }
            }
            "tonumber" => {
                if args.len() > 1 {
                    let base = n(1)? as u32;
                    if !(2..=36).contains(&base) {
                        return Err(Error::new("base out of range"));
                    }
                    i64::from_str_radix(s(0)?.trim(), base)
                        .ok()
                        .map(|n| Value::Number(n as f64))
                        .unwrap_or_default()
                } else {
                    a(0).number().ok().map(Value::Number).unwrap_or_default()
                }
            }
            "select" => {
                if a(0) == Value::String("#".into()) {
                    Value::Number(args.len().saturating_sub(1) as f64)
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
            "rawlen" => Value::Number(self.length(&a(0))? as f64),
            "rawequal" => Value::Bool(a(0) == a(1)),
            "getmetatable" => {
                let Value::Table(t) = a(0) else {
                    return Ok(vec![Value::Nil]);
                };
                let meta = self.tables[t].meta.clone();
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
                    self.call(method, vec![a(0)])
                } else {
                    Ok(vec![Value::Native("next"), a(0), Value::Nil])
                };
            }
            "ipairs" => return Ok(vec![Value::Native("ipairs.next"), a(0), Value::Number(0.0)]),
            "ipairs.next" => {
                let index = n(1)? + 1.0;
                let value = self.get(&a(0), &Value::Number(index))?;
                return Ok(if value == Value::Nil {
                    vec![Value::Nil]
                } else {
                    vec![Value::Number(index), value]
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
            "string.upper" => Value::String(s(0)?.to_ascii_uppercase()),
            "string.lower" => Value::String(s(0)?.to_ascii_lowercase()),
            "string.len" => Value::Number(s(0)?.len() as f64),
            "string.sub" => {
                let text = s(0)?;
                let start = position(n(1)? as isize, text.len()).max(1) as usize;
                let end = position(if args.len() > 2 { n(2)? as isize } else { -1 }, text.len())
                    .min(text.len() as isize)
                    .max(0) as usize;
                Value::String(
                    String::from_utf8_lossy(
                        text.as_bytes().get(start - 1..end).unwrap_or_default(),
                    )
                    .into_owned(),
                )
            }
            "string.rep" => {
                let text = s(0)?;
                let count = n(1)?.max(0.0) as usize;
                let sep = if args.len() > 2 { s(2)? } else { String::new() };
                let mut result = String::new();
                for i in 0..count {
                    self.tick()?;
                    if i > 0 {
                        result.push_str(&sep)
                    }
                    result.push_str(&text);
                }
                Value::String(result)
            }
            "string.reverse" => Value::String(
                String::from_utf8_lossy(&s(0)?.bytes().rev().collect::<Vec<_>>()).into_owned(),
            ),
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
                    .as_bytes()
                    .get(start - 1..end)
                    .unwrap_or_default()
                    .iter()
                    .map(|b| Value::Number(*b as f64))
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
                Value::String(String::from_utf8_lossy(&bytes).into_owned())
            }
            "string.find" => {
                let text = s(0)?;
                let needle = s(1)?;
                if !a(3).truth() && needle.bytes().any(|b| b"^$()%.[]*+-?".contains(&b)) {
                    return Err(Error::new("Lua string patterns are not supported"));
                }
                let start = position(if args.len() > 2 { n(2)? as isize } else { 1 }, text.len())
                    .max(1) as usize
                    - 1;
                return Ok(
                    if let Some(offset) = text.get(start..).and_then(|s| s.find(&needle)) {
                        vec![
                            Value::Number((start + offset + 1) as f64),
                            Value::Number((start + offset + needle.len()) as f64),
                        ]
                    } else {
                        vec![Value::Nil]
                    },
                );
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
                    let v = self.get(&a(0), &Value::Number(i as f64))?;
                    self.set(a(0), Value::Number((i + 1) as f64), v)?;
                }
                self.set(a(0), Value::Number(pos as f64), value)?;
                return Ok(Vec::new());
            }
            "table.remove" => {
                let len = self.length(&a(0))?;
                let pos = if args.len() > 1 { n(1)? as usize } else { len };
                let value = self.get(&a(0), &Value::Number(pos as f64))?;
                for i in pos..len {
                    let v = self.get(&a(0), &Value::Number((i + 1) as f64))?;
                    self.set(a(0), Value::Number(i as f64), v)?;
                }
                self.set(a(0), Value::Number(len as f64), Value::Nil)?;
                value
            }
            "table.concat" => {
                let sep = if args.len() > 1 { s(1)? } else { String::new() };
                let start = if args.len() > 2 { n(2)? as i64 } else { 1 };
                let end = if args.len() > 3 {
                    n(3)? as i64
                } else {
                    self.length(&a(0))? as i64
                };
                let mut text = String::new();
                for i in start..=end {
                    let value = self.get(&a(0), &Value::Number(i as f64))?;
                    if !matches!(value, Value::String(_) | Value::Number(_)) {
                        return Err(Error::new("invalid value in table for concat"));
                    }
                    if i > start {
                        text.push_str(&sep)
                    }
                    text.push_str(&value.text());
                }
                Value::String(text)
            }
            "table.pack" => {
                let table = self.table();
                self.raw_set(
                    &table,
                    Value::String("n".into()),
                    Value::Number(args.len() as f64),
                )?;
                for (i, v) in args.into_iter().enumerate() {
                    self.raw_set(&table, Value::Number((i + 1) as f64), v)?;
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
                    values.push(self.get(&a(0), &Value::Number(i as f64))?);
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
                    values.push(self.get(&a(0), &Value::Number(i as f64))?);
                }
                for (i, value) in values.into_iter().enumerate() {
                    self.set(target.clone(), Value::Number((to + i as i64) as f64), value)?;
                }
                target
            }
            "table.sort" => {
                let len = self.length(&a(0))?;
                for i in 2..=len {
                    let mut j = i;
                    while j > 1 {
                        let left = self.get(&a(0), &Value::Number(j as f64))?;
                        let right = self.get(&a(0), &Value::Number((j - 1) as f64))?;
                        let less = if a(1) == Value::Nil {
                            self.binary("<", left.clone(), right.clone())?.truth()
                        } else {
                            first(self.call(a(1), vec![left.clone(), right.clone()])?).truth()
                        };
                        if !less {
                            break;
                        }
                        self.set(a(0), Value::Number(j as f64), right)?;
                        self.set(a(0), Value::Number((j - 1) as f64), left)?;
                        j -= 1;
                    }
                }
                return Ok(Vec::new());
            }
            "math.min" | "math.max" => {
                let mut best = n(0)?;
                for value in args.iter().skip(1) {
                    let v = value.number()?;
                    best = if name == "math.min" {
                        best.min(v)
                    } else {
                        best.max(v)
                    }
                }
                Value::Number(best)
            }
            "math.modf" => {
                let value = n(0)?;
                return Ok(vec![
                    Value::Number(value.trunc()),
                    Value::Number(value - value.trunc()),
                ]);
            }
            "math.type" => {
                if let Value::Number(v) = a(0) {
                    Value::String(if v.fract() == 0.0 { "integer" } else { "float" }.into())
                } else {
                    Value::Nil
                }
            }
            "math.tointeger" => a(0)
                .number()
                .ok()
                .filter(|n| n.fract() == 0.0)
                .map(Value::Number)
                .unwrap_or_default(),
            "math.abs" | "math.ceil" | "math.floor" | "math.sqrt" | "math.exp" | "math.log"
            | "math.sin" | "math.cos" | "math.tan" | "math.asin" | "math.acos" | "math.atan"
            | "math.deg" | "math.rad" | "math.fmod" => {
                let x = n(0)?;
                Value::Number(match name {
                    "math.abs" => x.abs(),
                    "math.ceil" => x.ceil(),
                    "math.floor" => x.floor(),
                    "math.sqrt" => x.sqrt(),
                    "math.exp" => x.exp(),
                    "math.log" => {
                        if args.len() > 1 {
                            x.log(n(1)?)
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
            "utf8.len" => Value::Number(s(0)?.chars().count() as f64),
            "utf8.char" => Value::String(
                args.iter()
                    .map(|v| {
                        char::from_u32(v.number()? as u32)
                            .ok_or_else(|| Error::new("value out of range"))
                    })
                    .collect::<Result<String>>()?,
            ),
            "utf8.codepoint" => {
                let text = s(0)?;
                let start = position(if args.len() > 1 { n(1)? as isize } else { 1 }, text.len())
                    .max(1) as usize
                    - 1;
                let end = if args.len() > 2 {
                    position(n(2)? as isize, text.len()).max(0) as usize
                } else {
                    start + 1
                };
                return Ok(text
                    .get(start..)
                    .ok_or_else(|| Error::new("invalid UTF-8 code"))?
                    .char_indices()
                    .take_while(|(i, _)| start + i < end)
                    .map(|(_, c)| Value::Number(c as u32 as f64))
                    .collect());
            }
            "utf8.codes" => return Ok(vec![Value::Native("utf8.next"), a(0), Value::Number(0.0)]),
            "utf8.next" => {
                let text = s(0)?;
                let previous = n(1)? as usize;
                return Ok(text
                    .char_indices()
                    .find(|(i, _)| *i + 1 > previous)
                    .map(|(i, c)| {
                        vec![
                            Value::Number((i + 1) as f64),
                            Value::Number(c as u32 as f64),
                        ]
                    })
                    .unwrap_or_else(|| vec![Value::Nil]));
            }
            "utf8.offset" => {
                let text = s(0)?;
                let count = n(1)? as isize;
                let start = position(
                    if args.len() > 2 {
                        n(2)? as isize
                    } else if count >= 0 {
                        1
                    } else {
                        text.len() as isize + 1
                    },
                    text.len(),
                )
                .max(1) as usize
                    - 1;
                let mut positions = text.char_indices().map(|(i, _)| i).collect::<Vec<_>>();
                positions.push(text.len());
                let base = positions
                    .iter()
                    .position(|p| *p >= start)
                    .unwrap_or(positions.len());
                let target = base as isize + if count > 0 { count - 1 } else { count };
                if target < 0 {
                    Value::Nil
                } else {
                    positions
                        .get(target as usize)
                        .map(|p| Value::Number((p + 1) as f64))
                        .unwrap_or_default()
                }
            }
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

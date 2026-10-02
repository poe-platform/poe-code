//! CLI token scanning, numeric-array option normalization and output policies.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! yes {
        ($value:expr) => {{
            let value = $value;
            let truthy = c!("truthy", value);
            host.is_true(truthy)?
        }};
    }
    match (operation, args) {
        ("unwrap", [schema]) => {
            let kind = host.get(*schema, "kind")?;
            if host.is_kind(kind, "optional")? {
                let inner = host.get(*schema, "inner")?;
                host.call("unwrap", vec![inner])
            } else {
                Ok(*schema)
            }
        }
        ("split", [value]) => {
            let items = c!("list");
            let mut current = host.literal("")?;
            let mut index = c!("zeroIndex");
            loop {
                let more = c!("more", *value, index);
                if !host.is_true(more)? {
                    break;
                }
                let char = c!("at", *value, index);
                let char = if host.is_nullish(char)? {
                    host.literal("")?
                } else {
                    char
                };
                if host.is_kind(char, ",")? {
                    append_trimmed(host, items, current)?;
                    current = host.literal("")?;
                } else {
                    current = c!("append", current, char);
                }
                index = c!("increment", index);
            }
            append_trimmed(host, items, current)?;
            Ok(items)
        }
        ("negative", [token]) => {
            let dash = c!("startsDash", *token);
            if !yes!(dash) {
                return host.call("false", vec![]);
            }
            let long = c!("startsLong", *token);
            if yes!(long) {
                return host.call("false", vec![]);
            }
            let items = c!("split", *token);
            let length = host.get(items, "length")?;
            let positive = c!("positive", length);
            if !host.is_true(positive)? {
                return Ok(positive);
            }
            host.call("everyNumber", vec![items])
        }
        ("nextOption", [token, schema]) => {
            if host.is_kind(*token, "-")? {
                let item = host.get(*schema, "item")?;
                let item = c!("unwrap", item);
                let kind = host.get(item, "kind")?;
                if host.is_kind(kind, "string")? {
                    return host.call("false", vec![]);
                }
            }
            let dash = c!("startsDash", *token);
            if !yes!(dash) {
                return Ok(dash);
            }
            let item = host.get(*schema, "item")?;
            let item = c!("unwrap", item);
            let kind = host.get(item, "kind")?;
            let negative = if host.is_kind(kind, "number")? {
                let value = c!("negative", *token);
                yes!(value)
            } else {
                false
            };
            host.call(if negative { "false" } else { "true" }, vec![])
        }
        ("normalize", [argv, options, arrays]) => normalize(host, *argv, *options, *arrays),
        ("helpOutput", [argv]) => scan_output(host, *argv, None),
        ("argvOutput", [argv, formats]) => scan_output(host, *argv, Some(*formats)),
        ("output", [flags]) => {
            let json = host.get(*flags, "json")?;
            if host.is_true(json)? {
                return host.literal("json");
            }
            let output = host.get(*flags, "output")?;
            if !host.is_undefined(output)? {
                let output = host.get(*flags, "output")?;
                return if host.is_kind(output, "markdown")? {
                    host.literal("md")
                } else {
                    host.get(*flags, "output")
                };
            }
            host.literal("rich")
        }
        ("designOutput", [output]) => {
            if host.is_kind(*output, "md")? {
                host.literal("markdown")
            } else if host.is_kind(*output, "json")? {
                host.literal("json")
            } else {
                host.literal("terminal")
            }
        }
        ("debugMode", [value]) => {
            if host.is_true(*value)? || host.is_kind(*value, "trim")? {
                host.literal("trim")
            } else if host.is_kind(*value, "raw")? {
                host.literal("raw")
            } else {
                host.call("undefined", vec![])
            }
        }
        ("argvDebug", [argv]) => {
            let mut index = c!("twoIndex");
            loop {
                let more = c!("more", *argv, index);
                if !host.is_true(more)? {
                    break;
                }
                let token = c!("at", *argv, index);
                if host.is_kind(token, "--debug")? {
                    return host.literal("trim");
                }
                if host.is_kind(token, "--debug=raw")? {
                    return host.literal("raw");
                }
                index = c!("increment", index);
            }
            host.call("undefined", vec![])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

fn append_trimmed<H: TextHost>(
    host: &mut H,
    items: H::Value,
    current: H::Value,
) -> Result<(), H::Error> {
    let trimmed = host.call("trim", vec![current])?;
    let length = host.get(trimmed, "length")?;
    let positive = host.call("positive", vec![length])?;
    if host.is_true(positive)? {
        host.call("push", vec![items, trimmed])?;
    }
    Ok(())
}

fn scan_output<H: TextHost>(
    host: &mut H,
    argv: H::Value,
    formats: Option<H::Value>,
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    let mut index = c!("zeroIndex");
    loop {
        let more = c!("more", argv, index);
        if !host.is_true(more)? {
            break;
        }
        let token = c!("at", argv, index);
        let token = if host.is_nullish(token)? {
            host.literal("")?
        } else {
            token
        };
        if formats.is_some() {
            if host.is_kind(token, "--json")? {
                return host.literal("json");
            }
            if host.is_kind(token, "--md")? || host.is_kind(token, "--markdown")? {
                return host.literal("md");
            }
        }
        let separate = host.is_kind(token, "--output")?;
        let matched = if separate {
            true
        } else {
            let prefix = c!("outputPrefix", token);
            let prefix = c!("truthy", prefix);
            host.is_true(prefix)?
        };
        if matched {
            let value = if separate {
                c!("next", argv, index)
            } else {
                c!("outputValue", token)
            };
            for kind in ["rich", "md", "json"] {
                if host.is_kind(value, kind)? {
                    return Ok(value);
                }
            }
            if host.is_kind(value, "markdown")? {
                return host.literal("md");
            }
            if let Some(formats) = formats
                && (!separate || !host.is_undefined(value)?)
            {
                let own = c!("hasFormat", formats, value);
                let own = c!("truthy", own);
                if host.is_true(own)? {
                    return Ok(value);
                }
            }
        }
        index = c!("increment", index);
    }
    host.literal("rich")
}

fn normalize<H: TextHost>(
    host: &mut H,
    argv: H::Value,
    options: H::Value,
    arrays: H::Value,
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! yes {
        ($value:expr) => {{
            let value = $value;
            let truthy = c!("truthy", value);
            host.is_true(truthy)?
        }};
    }
    let size = host.get(arrays, "size")?;
    let empty = c!("zero", size);
    if host.is_true(empty)? {
        return Ok(argv);
    }
    let normalized = c!("list");
    let mut active = c!("undefined");
    let mut index = c!("zeroIndex");
    loop {
        let more = c!("more", argv, index);
        if !host.is_true(more)? {
            break;
        }
        let token = c!("at", argv, index);
        if host.is_kind(token, "--")? {
            c!("pushTail", normalized, argv, index);
            break;
        }
        let option = c!("findOption", options, token);
        let attached = {
            let dash = c!("startsDash", token);
            let candidate = if yes!(dash) {
                let long = c!("startsLong", token);
                if !yes!(long) {
                    let long = c!("longShort", token);
                    host.is_true(long)?
                } else {
                    false
                }
            } else {
                false
            };
            if candidate {
                c!("findAttached", options, token)
            } else {
                c!("undefined")
            }
        };
        if !host.is_undefined(active)?
            && host.is_undefined(option)?
            && host.is_undefined(attached)?
        {
            let dash = c!("startsDash", token);
            let short = if yes!(dash) {
                let long = c!("startsLong", token);
                !yes!(long)
            } else {
                false
            };
            if short {
                let negative = c!("negative", token);
                if yes!(negative) {
                    c!("pushNormalized", normalized, active);
                } else if !host.is_kind(token, "-")? {
                    active = c!("undefined");
                }
            } else {
                let long = c!("startsLong", token);
                if yes!(long) {
                    active = c!("undefined");
                }
            }
        } else {
            active = c!("undefined");
        }
        c!("pushNormalized", normalized, token);
        if !host.is_undefined(option)? {
            let next = c!("next", argv, index);
            if !host.is_undefined(next)? {
                let required = host.get(option, "required")?;
                let consume = if yes!(required) {
                    true
                } else {
                    let optional = host.get(option, "optional")?;
                    if yes!(optional) {
                        let long = c!("nextLong", next);
                        if host.is_true(long)? {
                            let dash = c!("nextStartsDash", next);
                            !yes!(dash)
                        } else {
                            true
                        }
                    } else {
                        false
                    }
                };
                if consume {
                    c!("pushNormalized", normalized, next);
                    index = c!("increment", index);
                }
            }
            let numeric = c!("has", arrays, option);
            if yes!(numeric) {
                active = token;
            }
        }
        index = c!("increment", index);
    }
    Ok(normalized)
}

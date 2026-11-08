// Serialization layout follows smol-toml's BSD-3-Clause table algorithm.
// See THIRD_PARTY_NOTICES.md for attribution and license.
use super::Error;
use crate::value::Value;
use mcp_protocol_rust::{json, numbers};
fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn string(value: &[u16]) -> Vec<u16> {
    let text = json::stringify(&json::Value::String(value.to_vec()));
    let mut output = vec![];
    for ch in text.encode_utf16() {
        if ch == 127 {
            output.extend(units("\\u007f"));
        } else {
            output.push(ch);
        }
    }
    output
}
fn key(value: &[u16]) -> Vec<u16> {
    if !value.is_empty()
        && value
            .iter()
            .all(|ch| matches!(ch,48..=57|65..=90|97..=122|45|95))
    {
        value.to_vec()
    } else {
        string(value)
    }
}
fn entries(properties: &[(Vec<u16>, Value)]) -> Vec<(&[u16], &Value)> {
    let mut entries: Vec<_> = properties
        .iter()
        .map(|(key, value)| (key.as_slice(), value))
        .collect();
    entries.sort_by_key(|(key, _)| crate::jsonc::property_index(key).map_or(u64::MAX, u64::from));
    entries
}
fn join_path(prefix: &[u16], key: &[u16]) -> Vec<u16> {
    let mut out = prefix.to_vec();
    if !out.is_empty() {
        out.push(46);
    }
    out.extend_from_slice(key);
    out
}
fn depth_guard(depth: usize) -> Result<(), Error> {
    if depth == 0 {
        Err(Error::serialization(
            "Could not stringify the object: maximum object depth exceeded",
        ))
    } else {
        Ok(())
    }
}
fn array_of_tables(items: &[Value]) -> bool {
    !items.is_empty()
        && items
            .iter()
            .all(|item| matches!(item, Value::Object(_) | Value::Null))
}
fn scalar(value: &Value, depth: usize) -> Result<Vec<u16>, Error> {
    enum Pending<'a> {
        Value(&'a Value, usize, bool),
        Key(&'a [u16]),
        Text(&'static [u16]),
    }
    let mut pending = vec![Pending::Value(value, depth, false)];
    let mut output = vec![];
    while let Some(task) = pending.pop() {
        match task {
            Pending::Key(name) => output.extend(key(name)),
            Pending::Text(text) => output.extend_from_slice(text),
            Pending::Value(value, depth, array_item) => {
                if array_item && matches!(value, Value::Null | Value::Undefined) {
                    return Err(Error::serialization(
                        "arrays cannot contain null or undefined values",
                    ));
                }
                depth_guard(depth)?;
                match value {
                    Value::Bool(value) => {
                        output.extend(units(if *value { "true" } else { "false" }))
                    }
                    Value::Number(value) => output.extend(units(&if value.is_nan() {
                        "nan".to_owned()
                    } else if *value == f64::INFINITY {
                        "inf".to_owned()
                    } else if *value == f64::NEG_INFINITY {
                        "-inf".to_owned()
                    } else if value.fract() == 0.0
                        && value.abs() > 9007199254740991.0
                        && value.abs() < 1e21
                    {
                        format!("{value:.1}")
                    } else {
                        numbers::format(*value)
                    })),
                    Value::String(value) => output.extend(string(value)),
                    Value::BigInt(value) | Value::DateLiteral(value) => {
                        output.extend_from_slice(value)
                    }
                    Value::Date(value) => output.extend(value.to_iso_string()),
                    Value::Object(properties) => {
                        if properties.is_empty() {
                            output.extend([123, 125]);
                        } else {
                            output.extend([123, 32]);
                            pending.push(Pending::Text(&[32, 125]));
                            for (index, (name, value)) in
                                entries(properties).into_iter().enumerate().rev()
                            {
                                pending.push(Pending::Value(value, depth - 1, false));
                                pending.push(Pending::Text(&[32, 61, 32]));
                                pending.push(Pending::Key(name));
                                if index > 0 {
                                    pending.push(Pending::Text(&[44, 32]));
                                }
                            }
                        }
                    }
                    Value::Array(items) => {
                        if items.is_empty() {
                            output.extend([91, 93]);
                        } else {
                            output.extend([91, 32]);
                            pending.push(Pending::Text(&[32, 93]));
                            for (index, item) in items.iter().enumerate().rev() {
                                pending.push(Pending::Value(item, depth - 1, true));
                                if index > 0 {
                                    pending.push(Pending::Text(&[44, 32]));
                                }
                            }
                        }
                    }
                    Value::Null => {
                        return Err(Error::serialization(
                            "Cannot convert undefined or null to object",
                        ));
                    }
                    Value::Undefined | Value::Unsupported(_) | Value::Symbol(_) => {
                        output.extend(units("undefined"))
                    }
                }
            }
        }
    }
    Ok(output)
}
pub fn stringify(value: &Value) -> Result<Vec<u16>, Error> {
    let Value::Object(properties) = value else {
        return Err(Error::serialization(
            "stringify can only be called with an object",
        ));
    };
    enum Pending<'a> {
        Table {
            properties: &'a [(Vec<u16>, Value)],
            prefix: Vec<u16>,
            header: bool,
            depth: usize,
        },
        Array {
            items: &'a [Value],
            prefix: Vec<u16>,
            depth: usize,
        },
        ArrayItem {
            value: &'a Value,
            prefix: Vec<u16>,
            depth: usize,
        },
        Newline,
    }
    let mut pending = vec![Pending::Table {
        properties,
        prefix: vec![],
        header: false,
        depth: 1000,
    }];
    let mut output = vec![];
    while let Some(task) = pending.pop() {
        match task {
            Pending::Newline => output.push(10),
            Pending::Array {
                items,
                prefix,
                depth,
            } => {
                depth_guard(depth)?;
                for (index, value) in items.iter().enumerate().rev() {
                    pending.push(Pending::ArrayItem {
                        value,
                        prefix: prefix.clone(),
                        depth,
                    });
                    if index > 0 {
                        pending.push(Pending::Newline);
                    }
                }
            }
            Pending::ArrayItem {
                value,
                prefix,
                depth,
            } => {
                let Value::Object(properties) = value else {
                    return Err(Error::serialization(
                        "Cannot convert undefined or null to object",
                    ));
                };
                output.extend([91, 91]);
                output.extend_from_slice(&prefix);
                output.extend([93, 93, 10]);
                pending.push(Pending::Table {
                    properties,
                    prefix,
                    header: false,
                    depth,
                });
            }
            Pending::Table {
                properties,
                prefix,
                header,
                depth,
            } => {
                depth_guard(depth)?;
                let mut scalars = vec![];
                let mut nested = vec![];
                for (name, value) in entries(properties) {
                    if matches!(value, Value::Null | Value::Undefined) {
                        continue;
                    }
                    if matches!(value, Value::Symbol(_)) {
                        return Err(Error::serialization(
                            "cannot serialize values of type 'symbol'",
                        ));
                    }
                    if let Value::Unsupported(kind) = value {
                        return Err(Error::serialization(format!(
                            "cannot serialize values of type '{}'",
                            String::from_utf16_lossy(kind)
                        )));
                    }
                    match value {
                        Value::Object(properties) => {
                            let prefix = join_path(&prefix, &key(name));
                            nested.push(Pending::Table {
                                properties,
                                prefix,
                                header: true,
                                depth: depth - 1,
                            });
                        }
                        Value::Array(items) if array_of_tables(items) => {
                            let prefix = join_path(&prefix, &key(name));
                            nested.push(Pending::Array {
                                items,
                                prefix,
                                depth: depth - 1,
                            });
                        }
                        _ => scalars.push((name, value)),
                    }
                }
                if header && (!scalars.is_empty() || nested.is_empty()) {
                    output.push(91);
                    output.extend_from_slice(&prefix);
                    output.push(93);
                    if !scalars.is_empty() {
                        output.push(10);
                    }
                }
                for (name, value) in &scalars {
                    output.extend(key(name));
                    output.extend([32, 61, 32]);
                    output.extend(scalar(value, depth)?);
                    output.push(10);
                }
                if !scalars.is_empty() && !nested.is_empty() {
                    output.push(10);
                }
                for (index, task) in nested.into_iter().enumerate().rev() {
                    pending.push(task);
                    if index > 0 {
                        pending.push(Pending::Newline);
                    }
                }
            }
        }
    }
    if output.last() != Some(&10) {
        output.push(10);
    }
    Ok(output)
}

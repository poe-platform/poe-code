//! Portable storage policy. Host adapters retain filesystem, WebCrypto and object identity.
use mcp_protocol_rust::json::Value;

pub fn normalize_path(path: &[u16]) -> Result<Vec<u16>, &'static str> {
    if path.contains(&0) {
        return Err("EINVAL");
    }
    let mut components = Vec::new();
    for component in path.split(|unit| *unit == 47) {
        match component {
            [] | [46] => {}
            [46, 46] => {
                components.pop();
            }
            _ => components.push(component),
        }
    }
    if components.is_empty() {
        return Err("Credential filePath must name a file");
    }
    let mut result = Vec::new();
    for component in components {
        result.push(47);
        result.extend(component);
    }
    Ok(result)
}

pub fn path_ancestors(path: &[u16]) -> Vec<Vec<u16>> {
    path.iter()
        .enumerate()
        .skip(1)
        .filter(|(_, unit)| **unit == 47)
        .map(|(index, _)| path[..index].to_vec())
        .chain(std::iter::once(path.to_vec()))
        .collect()
}

pub fn key_field(index: usize, value: &Value) -> bool {
    match index {
        0 => value == &Value::String("secret".encode_utf16().collect()),
        1 => value == &Value::String("AES-GCM".encode_utf16().collect()),
        2 => value == &Value::Number(256.0),
        3 | 4 => value == &Value::Bool(true),
        _ => false,
    }
}

pub fn document_field(index: usize, value: &Value) -> bool {
    match index {
        0 => value == &Value::Number(1.0),
        1..=3 => matches!(value, Value::String(_)),
        _ => false,
    }
}

pub fn dispatch(operation: u32, input: &Value) -> Result<Value, &'static str> {
    let string = || match input {
        Value::String(value) => Ok(value.as_slice()),
        _ => Err("Expected string"),
    };
    let array = || match input {
        Value::Array(value) => Ok(value.as_slice()),
        _ => Err("Expected array"),
    };
    match operation {
        0 => normalize_path(string()?).map(Value::String),
        1 => Ok(Value::Array(
            path_ancestors(string()?)
                .into_iter()
                .map(Value::String)
                .collect(),
        )),
        2 => {
            let path = string()?;
            let end = path
                .iter()
                .rposition(|unit| *unit == 47)
                .unwrap_or(0)
                .max(1);
            Ok(Value::String(path[..end.min(path.len())].to_vec()))
        }
        3 | 5 => {
            let values = array()?;
            let [Value::Number(index), value] = values else {
                return Err("Expected field and value");
            };
            Ok(Value::Bool(if operation == 3 {
                key_field(*index as usize, value)
            } else {
                document_field(*index as usize, value)
            }))
        }
        4 => Ok(Value::Array(
            ["version", "iv", "authTag", "ciphertext"]
                .map(|field| Value::String(field.encode_utf16().collect()))
                .to_vec(),
        )),
        6 => Ok(Value::Bool(
            array()? == [Value::Number(12.0), Value::Number(16.0)],
        )),
        7 => {
            let mut value: Vec<u16> = "provider:".encode_utf16().collect();
            value.extend(string()?);
            Ok(Value::String(value))
        }
        8 => Ok(Value::Bool(
            array()? == [Value::Bool(true), Value::Bool(true)],
        )),
        9 => {
            let values = array()?;
            let [
                Value::Bool(primary_missing),
                Value::Bool(legacy_missing),
                Value::Bool(has_legacy),
            ] = values
            else {
                return Err("Expected rollback state");
            };
            let mut steps = vec![Value::String(
                if *primary_missing { "delete" } else { "set" }
                    .encode_utf16()
                    .collect(),
            )];
            if *has_legacy {
                steps.push(Value::String(
                    if *legacy_missing { "delete" } else { "set" }
                        .encode_utf16()
                        .collect(),
                ));
            }
            Ok(Value::Array(steps))
        }
        _ => Err("Unknown portable credential operation"),
    }
}

//! Capture only verifier diagnostic fields, without serialization or recursive traversal.
use mcp_protocol_rust::json::{Limits, Value};
use napi::{ValueType, bindgen_prelude::*};
pub fn read(error: Unknown<'_>) -> Result<Value> {
    if error.get_type()? != ValueType::Object {
        return Ok(Value::Null);
    }
    let object: Object = unsafe { error.cast()? };
    let mut fields = Vec::new();
    let mut bytes = 0;
    for name in ["error", "errorDescription", "scope"] {
        if let Some(value) = object.get::<Unknown>(name)? {
            if value.get_type()? == ValueType::Undefined {
                continue;
            }
            let value = if name == "scope" && value.get_type()? == ValueType::Object {
                let scope: Object = unsafe { value.cast()? };
                if scope.is_array()? {
                    let length = scope.get_array_length()?;
                    if length as usize > Limits::default().max_nodes {
                        return Err(napi::Error::from_reason(
                            "HTTP authorization input resource limit exceeded",
                        ));
                    }
                    let mut entries = Vec::with_capacity(length as usize);
                    for index in 0..length {
                        entries.push(scalar(scope.get_element(index)?, &mut bytes)?)
                    }
                    Value::Array(entries)
                } else {
                    Value::Bool(false)
                }
            } else {
                scalar(value, &mut bytes)?
            };
            fields.push((name.encode_utf16().collect(), value));
        }
    }
    Ok(Value::Object(fields))
}
fn scalar(value: Unknown<'_>, bytes: &mut usize) -> Result<Value> {
    if value.get_type()? == ValueType::String {
        let value: Utf16String = unsafe { value.cast()? };
        *bytes = bytes.saturating_add(value.len().saturating_mul(3));
        if *bytes > Limits::default().max_bytes {
            return Err(napi::Error::from_reason(
                "HTTP authorization input resource limit exceeded",
            ));
        }
        Ok(Value::String(value.to_vec()))
    } else {
        Ok(Value::Bool(false))
    }
}

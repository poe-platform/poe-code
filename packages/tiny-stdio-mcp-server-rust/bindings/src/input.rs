use mcp_protocol_rust::jsonrpc::Id;
use napi::{ValueType, bindgen_prelude::*};
use tiny_stdio_mcp_server_rust::headers::{HeaderValue, HeaderValues};

#[path = "../../../mcp-protocol-rust/bindings/src/json_input.rs"]
mod json_input;
pub use json_input::{Mode, read};

pub fn read_headers<'env>(env: &Env, source: Unknown<'env>) -> Result<Option<HeaderValues>> {
    if source.get_type()? == ValueType::Undefined {
        return Ok(None);
    }
    let mut values = HeaderValues::new();
    if source.get_type()? != ValueType::Object {
        return Ok(Some(values));
    }
    let object: Object = unsafe { source.cast()? };
    let keys = object.get_all_property_names(
        KeyCollectionMode::OwnOnly,
        KeyFilter::AllProperties,
        KeyConversion::NumbersToStrings,
    )?;
    if keys.get_array_length()? > 10_000 {
        return Err(napi::Error::from_reason(
            "MCP header map traversal limit exceeded",
        ));
    }
    let global = env.get_global()?;
    let constructor: Object = global.get_named_property_unchecked("Object")?;
    let descriptor: Function<FnArgs<(Unknown<'env>, Utf16String)>, Unknown> =
        constructor.get_named_property("getOwnPropertyDescriptor")?;
    for index in 0..keys.get_array_length()? {
        let key: Unknown = keys.get_element(index)?;
        if key.get_type()? != ValueType::String {
            continue;
        }
        let key: Utf16String = unsafe { key.cast()? };
        let entry = descriptor.call((source, key.to_vec().into()).into())?;
        if entry.get_type()? == ValueType::Undefined {
            continue;
        }
        let entry: Object = unsafe { entry.cast()? };
        let value = if entry.has_named_property("value")? {
            let value: Unknown = entry.get_named_property("value")?;
            match value.get_type()? {
                ValueType::Undefined => continue,
                ValueType::String => {
                    HeaderValue::String(unsafe { value.cast::<Utf16String>()? }.to_vec())
                }
                _ => HeaderValue::Invalid,
            }
        } else {
            HeaderValue::Invalid
        };
        values.insert(key.to_vec(), value);
    }
    Ok(Some(values))
}

pub fn read_id(source: Unknown<'_>) -> Result<Option<Id>> {
    Ok(match source.get_type()? {
        ValueType::Undefined => None,
        ValueType::String => Some(Id::String(
            unsafe { source.cast::<Utf16String>()? }.to_vec(),
        )),
        ValueType::Number => Some(Id::Number(unsafe { source.cast()? })),
        _ => Some(Id::Null),
    })
}

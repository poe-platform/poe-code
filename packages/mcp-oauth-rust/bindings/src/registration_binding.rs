use super::credential_json_binding::CredentialJson;
use crate::convert::NativeJson;
use mcp_protocol_rust::json::Value;
use napi::{Env, ValueType, bindgen_prelude::*};
use napi_derive::napi;
enum ReadTask<'env> {
    Value(Unknown<'env>),
    Array(usize),
    Object(Vec<Vec<u16>>),
}

pub(crate) fn read_credential_json(env: Env, source: Unknown<'_>) -> Result<Value> {
    let global = env.get_global()?;
    let object: Object = global.get_named_property_unchecked("Object")?;
    let descriptors: Function<'_, Unknown<'_>, Object<'_>> =
        object.get_named_property("getOwnPropertyDescriptors")?;
    let prototype: Unknown = object.get_named_property("prototype")?;
    let constructor: Function<(), Unknown> = global.get_named_property("Set")?;
    let ancestors: Object = unsafe { constructor.new_instance(())?.cast()? };
    let has: Function<Unknown, bool> = ancestors.get_named_property("has")?;
    let add: Function<Unknown, Unknown> = ancestors.get_named_property("add")?;
    let delete: Function<Unknown, bool> = ancestors.get_named_property("delete")?;
    let mut ancestry = vec![];
    let mut tasks = vec![ReadTask::Value(source)];
    let mut values = vec![];
    while let Some(task) = tasks.pop() {
        match task {
            ReadTask::Array(length) => {
                let items = values.split_off(values.len() - length);
                values.push(Value::Array(items));
                delete.apply(ancestors, ancestry.pop().expect("matching object entry"))?;
            }
            ReadTask::Object(keys) => {
                let items = values.split_off(values.len() - keys.len());
                values.push(Value::Object(keys.into_iter().zip(items).collect()));
                delete.apply(ancestors, ancestry.pop().expect("matching object entry"))?;
            }
            ReadTask::Value(source) => match source.get_type()? {
                ValueType::Null => values.push(Value::Null),
                ValueType::Boolean => values.push(Value::Bool(unsafe { source.cast()? })),
                ValueType::String => {
                    let text: Utf16String = unsafe { source.cast()? };
                    values.push(Value::String(text.to_vec()));
                }
                ValueType::Number => {
                    let value: f64 = unsafe { source.cast()? };
                    if !value.is_finite() {
                        return Err(napi::Error::from_reason("Invalid registration"));
                    }
                    values.push(Value::Number(value));
                }
                ValueType::Object => {
                    if has.apply(ancestors, source)? {
                        return Err(napi::Error::from_reason("Invalid registration"));
                    }
                    let object: Object = unsafe { source.cast()? };
                    let properties = descriptors.call(source)?;
                    let mut children = vec![];
                    if object.is_array()? {
                        let length: Object = properties.get_named_property("length")?;
                        let length: u32 = length.get_named_property("value")?;
                        for index in 0..length {
                            let key = index.to_string();
                            if !properties.has_own_property(&key)? {
                                return Err(napi::Error::from_reason("Invalid registration"));
                            }
                            let descriptor: Object = properties.get_named_property(&key)?;
                            if !descriptor.has_own_property("value")? {
                                return Err(napi::Error::from_reason("Invalid registration"));
                            }
                            children.push(descriptor.get_named_property("value")?);
                        }
                        tasks.push(ReadTask::Array(children.len()));
                    } else {
                        let current_prototype = object.get_prototype()?;
                        if current_prototype.get_type()? != ValueType::Null
                            && !env.strict_equals(current_prototype, prototype)?
                        {
                            return Err(napi::Error::from_reason("Invalid registration"));
                        }
                        let keys = properties.get_all_property_names(
                            KeyCollectionMode::OwnOnly,
                            KeyFilter::Enumerable,
                            KeyConversion::NumbersToStrings,
                        )?;
                        let mut fields = vec![];
                        for index in 0..keys.get_array_length()? {
                            let key: Unknown = keys.get_element(index)?;
                            if key.get_type()? == ValueType::Symbol {
                                continue;
                            }
                            let descriptor: Object = properties.get_property(key)?;
                            if !descriptor.get_named_property::<bool>("enumerable")? {
                                continue;
                            }
                            if !descriptor.has_own_property("value")? {
                                return Err(napi::Error::from_reason("Invalid registration"));
                            }
                            let key: Utf16String = unsafe { key.cast()? };
                            fields.push(key.to_vec());
                            children.push(descriptor.get_named_property("value")?);
                        }
                        tasks.push(ReadTask::Object(fields));
                    }
                    add.apply(ancestors, source)?;
                    ancestry.push(source);
                    for child in children.into_iter().rev() {
                        tasks.push(ReadTask::Value(child));
                    }
                }
                _ => return Err(napi::Error::from_reason("Invalid registration")),
            },
        }
    }
    values
        .pop()
        .ok_or_else(|| napi::Error::from_reason("Invalid registration"))
}
#[napi]
pub fn copy_credential_json(env: Env, source: Unknown<'_>) -> Result<CredentialJson> {
    let value = read_credential_json(env, source)?;
    mcp_oauth_rust::registration::validate_credential_json(&value)
        .map_err(napi::Error::from_reason)?;
    Ok(CredentialJson(value))
}
#[napi]
pub fn parse_client_registration(env: Env, source: Unknown<'_>) -> Result<CredentialJson> {
    let value = read_credential_json(env, source)?;
    let (key, value) = match mcp_oauth_rust::registration::validate(&value) {
        Ok(()) => ("value", value),
        Err(message) => ("error", Value::String(message.encode_utf16().collect())),
    };
    Ok(CredentialJson(Value::Object(vec![(
        key.encode_utf16().collect(),
        value,
    )])))
}

#[napi]
pub fn normalize_stored_client(text: Utf16String) -> Result<NativeJson> {
    let value = mcp_protocol_rust::json::parse_utf16(&text, Default::default())
        .map_err(|_| napi::Error::from_reason("Invalid OAuth client data"))?;
    let (key, value) = match mcp_oauth_rust::registration::normalize_stored(&value) {
        Ok(value) => ("value", value.unwrap_or(Value::Null)),
        Err(message) => ("error", Value::String(message.encode_utf16().collect())),
    };
    Ok(NativeJson(Value::Object(vec![(
        key.encode_utf16().collect(),
        value,
    )])))
}

#[napi]
pub fn registration_redirect_pair_allowed(
    requested_http: bool,
    returned_http: bool,
    requested_host: String,
    returned_host: String,
    returned_no_port: bool,
    normalized_equal: bool,
) -> bool {
    mcp_oauth_rust::registration::redirect_pair_allowed(
        requested_http,
        returned_http,
        &requested_host,
        &returned_host,
        returned_no_port,
        normalized_equal,
    )
}

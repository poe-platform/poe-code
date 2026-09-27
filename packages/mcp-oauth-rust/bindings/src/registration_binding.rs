use super::credential_json_binding::CredentialJson;
use crate::convert::NativeJson;
use mcp_protocol_rust::json::Value;
use napi::{Env, ValueType, bindgen_prelude::*};
use napi_derive::napi;

// Keep the unfinished tree flat: descriptor errors and cycles cannot recursively
// drop a partially copied, deeply nested provider extension.
enum Node {
    Scalar(Value),
    Array(Vec<usize>),
    Object(Vec<(Vec<u16>, usize)>),
}
enum Task<'env> {
    Visit(Unknown<'env>, usize),
    Leave(Unknown<'env>),
}

pub(crate) fn read_credential_json(env: Env, source: Unknown<'_>) -> Result<Value> {
    let global = env.get_global()?;
    let object: Object = global.get_named_property_unchecked("Object")?;
    let descriptors: Function<Unknown, Object> =
        object.get_named_property("getOwnPropertyDescriptors")?;
    let prototype: Unknown = object.get_named_property("prototype")?;
    let constructor: Function<(), Unknown> = global.get_named_property_unchecked("Set")?;
    let active: Object = unsafe { constructor.new_instance(())?.cast()? };
    let has: Function<Unknown, bool> = active.get_named_property("has")?;
    let add: Function<Unknown, Unknown> = active.get_named_property("add")?;
    let delete: Function<Unknown, bool> = active.get_named_property("delete")?;
    let mut nodes = vec![Node::Scalar(Value::Null)];
    let mut tasks = vec![Task::Visit(source, 0)];
    while let Some(task) = tasks.pop() {
        let Task::Visit(source, index) = task else {
            if let Task::Leave(source) = task {
                delete.apply(active, source)?;
            }
            continue;
        };
        nodes[index] = match source.get_type()? {
            ValueType::Null => Node::Scalar(Value::Null),
            ValueType::Boolean => Node::Scalar(Value::Bool(unsafe { source.cast()? })),
            ValueType::String => {
                let text: Utf16String = unsafe { source.cast()? };
                Node::Scalar(Value::String(text.to_vec()))
            }
            ValueType::Number => {
                let number: f64 = unsafe { source.cast()? };
                if !number.is_finite() {
                    return Err(napi::Error::from_reason("Invalid registration"));
                }
                Node::Scalar(Value::Number(number))
            }
            ValueType::Object => {
                if has.apply(active, source)? {
                    return Err(napi::Error::from_reason("Invalid registration"));
                }
                let object: Object = unsafe { source.cast()? };
                let properties = descriptors.call(source)?;
                let array = object.is_array()?;
                if !array {
                    let actual = object.get_prototype()?;
                    if actual.get_type()? != ValueType::Null
                        && !env.strict_equals(actual, prototype)?
                    {
                        return Err(napi::Error::from_reason("Invalid registration"));
                    }
                }
                add.apply(active, source)?;
                tasks.push(Task::Leave(source));
                let mut children = Vec::new();
                let mut fields = Vec::new();
                if array {
                    let length: Object = properties.get_named_property("length")?;
                    let length: u32 = length.get_named_property("value")?;
                    for at in 0..length {
                        let key = at.to_string();
                        if !properties.has_own_property(&key)? {
                            return Err(napi::Error::from_reason("Invalid registration"));
                        }
                        let descriptor: Object = properties.get_named_property(&key)?;
                        if !descriptor.has_own_property("value")? {
                            return Err(napi::Error::from_reason("Invalid registration"));
                        }
                        let child = nodes.len();
                        nodes.push(Node::Scalar(Value::Null));
                        children.push(Task::Visit(descriptor.get_named_property("value")?, child));
                        fields.push((vec![], child));
                    }
                } else {
                    let keys = properties.get_all_property_names(
                        KeyCollectionMode::OwnOnly,
                        KeyFilter::Enumerable,
                        KeyConversion::NumbersToStrings,
                    )?;
                    for at in 0..keys.get_array_length()? {
                        let key: Unknown = keys.get_element(at)?;
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
                        let child = nodes.len();
                        nodes.push(Node::Scalar(Value::Null));
                        children.push(Task::Visit(descriptor.get_named_property("value")?, child));
                        fields.push((key.to_vec(), child));
                    }
                }
                tasks.extend(children.into_iter().rev());
                if array {
                    Node::Array(fields.into_iter().map(|(_, index)| index).collect())
                } else {
                    Node::Object(fields)
                }
            }
            _ => return Err(napi::Error::from_reason("Invalid registration")),
        };
    }
    let mut values = (0..nodes.len()).map(|_| Value::Null).collect::<Vec<_>>();
    for (index, node) in nodes.into_iter().enumerate().rev() {
        values[index] = match node {
            Node::Scalar(value) => value,
            Node::Array(children) => Value::Array(
                children
                    .into_iter()
                    .map(|child| std::mem::replace(&mut values[child], Value::Null))
                    .collect(),
            ),
            Node::Object(fields) => Value::Object(
                fields
                    .into_iter()
                    .map(|(key, child)| (key, std::mem::replace(&mut values[child], Value::Null)))
                    .collect(),
            ),
        };
    }
    Ok(values.swap_remove(0))
}
#[napi]
pub fn copy_credential_json(env: Env, source: Unknown<'_>) -> Result<CredentialJson> {
    let mut value = NativeJson(read_credential_json(env, source)?);
    mcp_oauth_rust::registration::validate_credential_json(&value.0)
        .map_err(napi::Error::from_reason)?;
    Ok(CredentialJson(std::mem::replace(&mut value.0, Value::Null)))
}
#[napi]
pub fn parse_client_registration(env: Env, source: Unknown<'_>) -> Result<CredentialJson> {
    let mut input = NativeJson(read_credential_json(env, source)?);
    let (key, value) = match mcp_oauth_rust::registration::validate(&input.0) {
        Ok(()) => ("value", std::mem::replace(&mut input.0, Value::Null)),
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

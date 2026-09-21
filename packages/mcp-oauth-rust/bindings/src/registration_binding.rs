use crate::convert::NativeJson;
use mcp_protocol_rust::json::Value;
use napi::{Env, ValueType, bindgen_prelude::*};
use napi_derive::napi;
struct Reader<'env> {
    env: &'env Env,
    descriptors: Function<'env, Unknown<'env>, Object<'env>>,
    prototype: Unknown<'env>,
    nodes: usize,
    units: usize,
}
impl<'env> Reader<'env> {
    fn string(&mut self, source: Unknown<'env>) -> Result<Vec<u16>> {
        let mut length = 0;
        napi::check_status!(
            unsafe {
                napi::sys::napi_get_value_string_utf16(
                    self.env.raw(),
                    source.raw(),
                    std::ptr::null_mut(),
                    0,
                    &mut length,
                )
            },
            "Invalid credential string"
        )?;
        if length > 65_536 - self.units {
            return Err(napi::Error::from_reason("Invalid credential string"));
        }
        self.units += length;
        let text: Utf16String = unsafe { source.cast()? };
        Ok(text.to_vec())
    }

    fn visit(&mut self, source: Unknown<'env>, depth: usize) -> Result<Value> {
        self.nodes += 1;
        if self.nodes > 20_000 || depth > 64 {
            return Err(napi::Error::from_reason("Invalid registration"));
        }
        match source.get_type()? {
            ValueType::Null => Ok(Value::Null),
            ValueType::Boolean => Ok(Value::Bool(unsafe { source.cast()? })),
            ValueType::String => Ok(Value::String(self.string(source)?)),
            ValueType::Number => {
                let value: f64 = unsafe { source.cast()? };
                if value.is_finite() {
                    Ok(Value::Number(value))
                } else {
                    Err(napi::Error::from_reason("Invalid registration"))
                }
            }
            ValueType::Object => {
                let object: Object = unsafe { source.cast()? };
                let descriptors = self.descriptors.call(source)?;
                if object.is_array()? {
                    let length: Object = descriptors.get_named_property("length")?;
                    let length: u32 = length.get_named_property("value")?;
                    if length > 20_000 {
                        return Err(napi::Error::from_reason("Invalid registration"));
                    }
                    let mut values = Vec::with_capacity(length as usize);
                    for index in 0..length {
                        let key = index.to_string();
                        if !descriptors.has_own_property(&key)? {
                            return Err(napi::Error::from_reason("Invalid registration"));
                        }
                        let descriptor: Object = descriptors.get_named_property(&key)?;
                        if !descriptor.has_own_property("value")? {
                            return Err(napi::Error::from_reason("Invalid registration"));
                        }
                        values
                            .push(self.visit(descriptor.get_named_property("value")?, depth + 1)?);
                    }
                    Ok(Value::Array(values))
                } else {
                    let prototype = object.get_prototype()?;
                    if prototype.get_type()? != ValueType::Null
                        && !self.env.strict_equals(prototype, self.prototype)?
                    {
                        return Err(napi::Error::from_reason("Invalid registration"));
                    }
                    let keys = descriptors.get_all_property_names(
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
                        let descriptor: Object = descriptors.get_property(key)?;
                        if !descriptor.get_named_property::<bool>("enumerable")? {
                            continue;
                        }
                        if !descriptor.has_own_property("value")? {
                            return Err(napi::Error::from_reason("Invalid registration"));
                        }
                        let key = self.string(key)?;
                        let value =
                            self.visit(descriptor.get_named_property("value")?, depth + 1)?;
                        fields.push((key, value));
                    }
                    Ok(Value::Object(fields))
                }
            }
            _ => Err(napi::Error::from_reason("Invalid registration")),
        }
    }
}
pub(crate) fn read_credential_json(env: Env, source: Unknown<'_>) -> Result<Value> {
    let global = env.get_global()?;
    let object: Object = global.get_named_property_unchecked("Object")?;
    let mut reader = Reader {
        env: &env,
        descriptors: object.get_named_property("getOwnPropertyDescriptors")?,
        prototype: object.get_named_property("prototype")?,
        nodes: 0,
        units: 0,
    };
    reader.visit(source, 0)
}
#[napi]
pub fn copy_credential_json(env: Env, source: Unknown<'_>) -> Result<NativeJson> {
    let value = read_credential_json(env, source)?;
    mcp_oauth_rust::registration::validate_credential_json(&value)
        .map_err(napi::Error::from_reason)?;
    Ok(NativeJson(value))
}
#[napi]
pub fn parse_client_registration(env: Env, source: Unknown<'_>) -> Result<NativeJson> {
    let value = read_credential_json(env, source)?;
    let (key, value) = match mcp_oauth_rust::registration::validate(&value) {
        Ok(()) => ("value", value),
        Err(message) => ("error", Value::String(message.encode_utf16().collect())),
    };
    Ok(NativeJson(Value::Object(vec![(
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

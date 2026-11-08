use crate::convert::NativeJson;
use mcp_protocol_rust::json::Value;
use napi::{ValueType, bindgen_prelude::*};
use napi_derive::napi;
use std::cell::RefCell;
use tiny_mcp_client_rust::discovery::{self, CacheIndex, UrlFacts};

#[napi(object)]
pub struct DiscoveryUrlFacts {
    pub protocol: String,
    pub hostname: String,
    pub credentials: bool,
    pub fragment: bool,
    pub query: bool,
}
#[napi]
pub fn check_discovery_url(facts: DiscoveryUrlFacts, label: String, issuer: bool) -> Result<()> {
    if issuer && (facts.query || facts.fragment) {
        return Err(napi::Error::from_reason(
            "Authorization server issuer must not include query or fragment",
        ));
    }
    discovery::validate_secure(
        &UrlFacts {
            protocol: &facts.protocol,
            hostname: &facts.hostname,
            credentials: facts.credentials,
            fragment: facts.fragment,
        },
        &label,
    )
    .map_err(napi::Error::from_reason)
}
#[napi]
pub fn discovery_metadata_paths(path: String, issuer: bool) -> Vec<String> {
    discovery::metadata_paths(&path, issuer)
}

fn primitive(value: Unknown<'_>) -> Result<Option<Value>> {
    Ok(match value.get_type()? {
        ValueType::Undefined => None,
        ValueType::String => Some(Value::String(
            unsafe { value.cast::<Utf16String>()? }.to_vec(),
        )),
        _ => Some(Value::Null),
    })
}
fn field(object: &Object<'_>, name: &str) -> Result<Option<Value>> {
    let value: Unknown = object.get_named_property(name)?;
    if value.is_array()? {
        let array: Array = unsafe { value.cast()? };
        let properties = array.coerce_to_object()?;
        let mut values = Vec::with_capacity(array.len() as usize);
        for index in 0..array.len() {
            if !properties.has_element(index)? {
                // Array.every skips absent positions. The host retains the
                // original array, including its holes, in the metadata snapshot.
                continue;
            }
            let value: Unknown = array
                .get(index)?
                .unwrap_or_else(|| unreachable!("array position"));
            values.push(primitive(value)?.unwrap_or(Value::Null));
        }
        Ok(Some(Value::Array(values)))
    } else {
        primitive(value)
    }
}
#[napi]
pub fn discovery_metadata_policy(
    command: String,
    input: Unknown<'_>,
    expected: Option<Utf16String>,
    normalized: Option<Utf16String>,
) -> Result<NativeJson> {
    let projected = if input.get_type()? != ValueType::Object || input.is_array()? {
        Value::Null
    } else {
        let object: Object = unsafe { input.cast()? };
        let fields: &[&str] = match command.as_str() {
            "resource" => &["resource"],
            "resource_bound" => &["resource", "authorization_servers"],
            "issuer" => &["issuer"],
            "endpoints" => &[
                "authorization_endpoint",
                "token_endpoint",
                "registration_endpoint",
            ],
            "arrays" => &[
                "response_types_supported",
                "code_challenge_methods_supported",
            ],
            "cache_shape" => &[
                "resource",
                "resourceMetadataUrl",
                "authorizationServer",
                "authorizationServerMetadataUrl",
            ],
            "cache_issuer" => &["authorization_servers"],
            "cache_location" => &["locations"],
            _ => &[],
        };
        let mut values = vec![];
        for name in fields {
            if let Some(value) = field(&object, name)? {
                values.push((name.encode_utf16().collect(), value));
            }
        }
        Value::Object(values)
    };
    let outcome = discovery::metadata_policy(
        &command,
        &projected,
        expected
            .as_ref()
            .map(|value| value.as_ref())
            .unwrap_or_default(),
        normalized
            .as_ref()
            .map(|value| value.as_ref())
            .unwrap_or_default(),
    );
    let (name, value) = match outcome {
        Ok(value) => ("value", value),
        Err(error) => ("error", Value::String(error.0)),
    };
    Ok(NativeJson(Value::Object(vec![(
        name.encode_utf16().collect(),
        value,
    )])))
}
#[napi]
#[derive(Default)]
pub struct NativeDiscoveryCache {
    state: RefCell<CacheIndex>,
}
#[napi]
impl NativeDiscoveryCache {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn get(&self, resource: Utf16String) -> Option<f64> {
        self.state.borrow().get(&resource).map(|slot| slot as f64)
    }
    #[napi]
    pub fn insert(&self, resource: Utf16String) -> Result<NativeJson> {
        let (slot, previous) = self
            .state
            .borrow_mut()
            .insert(resource.to_vec())
            .map_err(napi::Error::from_reason)?;
        Ok(NativeJson(Value::Array(vec![
            Value::Number(slot as f64),
            previous
                .map(|value| Value::Number(value as f64))
                .unwrap_or(Value::Null),
        ])))
    }
    #[napi(getter)]
    pub fn size(&self) -> u32 {
        self.state.borrow().len() as u32
    }
}

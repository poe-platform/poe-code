//! Self-contained owned configuration addon.
#[path = "../../../config-extends-rust/bindings/src/lib.rs"]
mod extends;
pub use extends::*;
use mcp_protocol_rust::json::{self, Value};
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use poe_code_config_rust::{coerce, document};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (u(key), value))
            .collect(),
    )
}
fn number(value: u32) -> Value {
    Value::Number(f64::from(value))
}

fn snapshot_value(
    value: config_mutations_rust::value::Value,
    path: &mut Vec<Value>,
    references: &mut Vec<Value>,
) -> Result<Value> {
    use config_mutations_rust::value::Value as V;
    Ok(match value {
        V::Null => Value::Null,
        V::Bool(value) => Value::Bool(value),
        V::Number(value) => Value::Number(value),
        V::String(value) => Value::String(value),
        V::Undefined => {
            references.push(Value::Array(vec![
                Value::Array(path.clone()),
                Value::Number(-1.0),
            ]));
            Value::Null
        }
        V::Unsupported(id) => {
            let id = String::from_utf16(&id)
                .ok()
                .and_then(|text| text.parse::<u32>().ok())
                .ok_or_else(|| Error::from_reason("Invalid opaque snapshot handle"))?;
            references.push(Value::Array(vec![Value::Array(path.clone()), number(id)]));
            Value::Null
        }
        V::Array(items) => Value::Array(
            items
                .into_iter()
                .enumerate()
                .map(|(index, value)| {
                    path.push(Value::Number(index as f64));
                    let result = snapshot_value(value, path, references);
                    path.pop();
                    result
                })
                .collect::<Result<_>>()?,
        ),
        V::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(key, value)| {
                    path.push(Value::String(key.clone()));
                    let result = snapshot_value(value, path, references);
                    path.pop();
                    Ok((key, result?))
                })
                .collect::<Result<_>>()?,
        ),
        _ => return Err(Error::from_reason("Invalid owned snapshot value")),
    })
}
type Hook<'a> = Function<'a, FnArgs<(String, NativeJson)>, Utf16String>;
struct Host<'a> {
    hook: Hook<'a>,
}
impl Host<'_> {
    fn call(&self, operation: &str, args: Vec<Value>) -> Result<Value> {
        let text = self
            .hook
            .call((operation.to_owned(), NativeJson(Value::Array(args))).into())?;
        json::parse_utf16(
            &text,
            json::Limits {
                max_depth: 512,
                max_bytes: usize::MAX,
                max_nodes: usize::MAX,
            },
        )
        .map_err(|error| Error::from_reason(error.to_string()))
    }
    fn id(value: Value) -> Result<u32> {
        match value {
            Value::Number(value)
                if value >= 0.0 && value <= f64::from(u32::MAX) && value.fract() == 0.0 =>
            {
                Ok(value as u32)
            }
            _ => Err(Error::from_reason("Invalid config value handle")),
        }
    }
    fn boolean(value: Value) -> Result<bool> {
        if let Value::Bool(value) = value {
            Ok(value)
        } else {
            Err(Error::from_reason("Invalid config boolean"))
        }
    }
}
impl document::Host for Host<'_> {
    type Value = u32;
    type Error = Error;
    fn is_record(&mut self, value: u32) -> Result<bool> {
        Self::boolean(self.call("record", vec![number(value)])?)
    }
    fn is_undefined(&mut self, value: u32) -> Result<bool> {
        Self::boolean(self.call("undefined", vec![number(value)])?)
    }
    fn keys(&mut self, value: u32) -> Result<Vec<Vec<u16>>> {
        let Value::Array(keys) = self.call("keys", vec![number(value)])? else {
            return Err(Error::from_reason("Invalid config keys"));
        };
        keys.into_iter()
            .map(|key| {
                if let Value::String(key) = key {
                    Ok(key)
                } else {
                    Err(Error::from_reason("Invalid config key"))
                }
            })
            .collect()
    }
    fn own(&mut self, value: u32, key: &[u16]) -> Result<u32> {
        Self::id(self.call("own", vec![number(value), Value::String(key.to_vec())])?)
    }
    fn entries(&mut self, value: u32) -> Result<document::Entries<u32>> {
        let Value::Array(entries) = self.call("entries", vec![number(value)])? else {
            return Err(Error::from_reason("Invalid config entries"));
        };
        entries
            .into_iter()
            .map(|entry| {
                let Value::Array(mut parts) = entry else {
                    return Err(Error::from_reason("Invalid config entry"));
                };
                if parts.len() != 2 {
                    return Err(Error::from_reason("Invalid config entry length"));
                }
                let value = Self::id(parts.pop().unwrap())?;
                let Value::String(key) = parts.pop().unwrap() else {
                    return Err(Error::from_reason("Invalid config entry key"));
                };
                Ok((key, value))
            })
            .collect()
    }
    fn create(&mut self) -> Result<u32> {
        Self::id(self.call("create", vec![])?)
    }
    fn define(&mut self, target: u32, key: &[u16], value: u32) -> Result<()> {
        Self::boolean(self.call(
            "define",
            vec![number(target), Value::String(key.to_vec()), number(value)],
        )?)?;
        Ok(())
    }
    fn policy_error(&mut self, message: &'static str) -> Error {
        Error::from_reason(message)
    }
}
#[napi]
pub fn config_normalize(value: u32, hook: Hook) -> Result<u32> {
    document::normalize(&mut Host { hook }, value)
}
#[napi]
pub fn config_normalize_scope(value: u32, hook: Hook) -> Result<u32> {
    document::normalize_scope(&mut Host { hook }, value)
}
#[napi]
pub fn config_merge(base: u32, over: u32, hook: Hook) -> Result<u32> {
    document::merge(&mut Host { hook }, base, over)
}
#[napi]
pub fn config_coerce(
    kind: String,
    tag: u32,
    text: Utf16String,
    numeric: f64,
    boolean: bool,
) -> Option<NativeJson> {
    match (kind.as_str(), tag) {
        ("string", 1) => Some(NativeJson(Value::String(text.to_vec()))),
        ("number", 1) => coerce::number_text(&text).map(|value| NativeJson(Value::Number(value))),
        ("number", 2) if numeric.is_finite() => Some(NativeJson(Value::Number(numeric))),
        ("boolean", 1) => coerce::boolean_text(&text).map(|value| NativeJson(Value::Bool(value))),
        ("boolean", 3) => Some(NativeJson(Value::Bool(boolean))),
        _ => None,
    }
}
#[napi]
pub fn config_owned_document(
    snapshot: Buffer,
    root: u32,
    over: u32,
    operation: String,
) -> Result<NativeJson> {
    let graph = poe_code_config_rust::owned::Graph::decode(
        config_mutations_rust::snapshot::decode(&snapshot).map_err(Error::from_reason)?,
    )
    .map_err(Error::from_reason)?;
    let data = match operation.as_str() {
        "merge" => graph.merge(root as usize, over as usize),
        "normalize" => graph.normalize(root as usize),
        "scope" => graph.normalize_scope(root as usize),
        _ => Err("Invalid owned config operation"),
    }
    .map_err(Error::from_reason)?;
    let mut references = vec![];
    let data = snapshot_value(data, &mut vec![Value::String(u("data"))], &mut references)?;
    Ok(NativeJson(object(vec![
        ("data", data),
        ("references", Value::Array(references)),
    ])))
}
impl poe_code_config_rust::state::Host for Host<'_> {
    type Value = u32;
    type Error = Error;
    fn is_record(&mut self, value: u32) -> Result<bool> {
        Self::boolean(self.call("stateRecord", vec![number(value)])?)
    }
    fn is_array(&mut self, value: u32) -> Result<bool> {
        Self::boolean(self.call("stateArray", vec![number(value)])?)
    }
    fn kind(&mut self, value: u32) -> Result<poe_code_config_rust::state::Kind> {
        use poe_code_config_rust::state::Kind;
        Ok(
            match Self::id(self.call("stateKind", vec![number(value)])?)? {
                0 => Kind::Undefined,
                1 => Kind::Record,
                2 => Kind::String,
                3 => Kind::Number,
                4 => Kind::Array,
                5 => Kind::Other,
                _ => return Err(Error::from_reason("Invalid state value kind")),
            },
        )
    }
    fn read(&mut self, value: u32, key: &str) -> Result<u32> {
        Self::id(self.call("read", vec![number(value), Value::String(u(key))])?)
    }
    fn text(&mut self, value: u32) -> Result<Vec<u16>> {
        let Value::String(text) = self.call("text", vec![number(value)])? else {
            return Err(Error::from_reason("Invalid state string"));
        };
        Ok(text)
    }
    fn number(&mut self, value: u32) -> Result<f64> {
        Ok(match self.call("numeric", vec![number(value)])? {
            Value::Number(value) => value,
            Value::Null => f64::NAN,
            _ => return Err(Error::from_reason("Invalid state number")),
        })
    }
    fn all_strings(&mut self, value: u32) -> Result<bool> {
        Self::boolean(self.call("strings", vec![number(value)])?)
    }
    fn entries(&mut self, value: u32) -> Result<document::Entries<u32>> {
        document::Host::entries(self, value)
    }
}
#[napi]
pub fn config_state_policy(operation: String, value: u32, hook: Hook) -> Result<NativeJson> {
    use poe_code_config_rust::state;
    let mut host = Host { hook };
    Ok(NativeJson(match operation.as_str() {
        "job" => Value::Bool(state::valid_job(&mut host, value)?),
        "template" => Value::Bool(state::valid_template(&mut host, value)?),
        "templates" => Value::Array(
            state::templates(&mut host, value)?
                .into_iter()
                .map(|(key, value)| Value::Array(vec![Value::String(key), number(value)]))
                .collect(),
        ),
        _ => return Err(Error::from_reason("Invalid state policy")),
    }))
}
#[napi]
pub fn config_safe_job_id(id: Utf16String, absolute: bool) -> bool {
    poe_code_config_rust::state::safe_job_id(&id, absolute)
}

#[path = "../../../providers-rust/bindings/src/lib.rs"]
mod providers;
pub use providers::*;
#[path = "../../../agent-defs-rust/bindings/src/lib.rs"]
mod agents;
pub use agents::*;
#[napi]
pub fn config_service_files(values: Vec<Utf16String>) -> Vec<Utf16String> {
    poe_code_config_rust::services::files(values.into_iter().map(|value| value.to_vec()).collect())
        .into_iter()
        .map(Into::into)
        .collect()
}
#[napi]
pub fn config_service_text(value: Utf16String) -> Option<Utf16String> {
    poe_code_config_rust::services::optional_text(&value).map(Into::into)
}
#[napi]
pub fn config_service_shape(value: Utf16String) -> bool {
    poe_code_config_rust::services::is_api_shape(&value)
}

#[napi]
pub fn config_parse_stored(text: Utf16String) -> Option<NativeJson> {
    poe_code_config_rust::stored::parse(&text).map(NativeJson)
}

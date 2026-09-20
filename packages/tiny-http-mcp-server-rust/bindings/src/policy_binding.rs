use super::convert::NativeJson;
use mcp_protocol_rust::json::{self, Limits, Value};
use napi::{ValueType, bindgen_prelude::*};
use napi_derive::napi;
use tiny_http_mcp_server_rust::policy::Policy;
#[napi]
pub struct NativeHttpPolicy {
    state: Policy,
}
#[napi]
impl NativeHttpPolicy {
    #[napi(constructor)]
    pub fn new(options: Object<'_>) -> Result<Self> {
        let mut fields = Vec::new();
        for name in [
            "enableJsonResponse",
            "trustedProxy",
            "allowedOrigins",
            "allowedHosts",
            "maxRequestBytes",
            "maxResponseBytes",
            "maxBatchSize",
            "maxSessions",
            "maxSessionsPerSubject",
            "sessionTtlMs",
            "maxStreamsPerSession",
            "maxStreamBufferBytes",
            "maxSseEventHistory",
            "sseKeepAliveMs",
            "maxConcurrentToolCalls",
        ] {
            if let Some(value) = options.get::<Unknown>(name)?
                && value.get_type()? != ValueType::Undefined
            {
                fields.push((name.encode_utf16().collect(), read(value)?));
            }
        }
        Ok(Self {
            state: Policy::new(&Value::Object(fields)).map_err(napi::Error::from_reason)?,
        })
    }
    #[napi(getter)]
    pub fn settings(&self) -> NativeJson {
        NativeJson(self.state.settings())
    }
    #[napi]
    pub fn call(
        &self,
        command: String,
        source: Either<Utf16String, Object<'_>>,
    ) -> Result<NativeJson> {
        let input = match source {
            Either::A(text) => json::parse_utf16(&text, Limits::default())
                .map_err(|_| napi::Error::from_reason("Invalid HTTP policy input"))?,
            Either::B(object) => project(&command, &object)?,
        };
        Ok(NativeJson(self.state.call(&command, &input)))
    }
}
fn read(value: Unknown<'_>) -> Result<Value> {
    Ok(match value.get_type()? {
        ValueType::Null => Value::Null,
        ValueType::Number => Value::Number(unsafe { value.cast()? }),
        ValueType::Boolean => Value::Bool(unsafe { value.cast()? }),
        ValueType::String => {
            let s: Utf16String = unsafe { value.cast()? };
            if s.len() > Limits::default().max_bytes {
                return Err(napi::Error::from_reason(
                    "HTTP configuration resource limit exceeded",
                ));
            }
            Value::String(s.to_vec())
        }
        ValueType::Object => {
            let object: Object = unsafe { value.cast()? };
            if !object.is_array()? {
                Value::Null
            } else {
                let length = object.get_array_length()?;
                if length as usize > Limits::default().max_nodes {
                    return Err(napi::Error::from_reason(
                        "HTTP configuration resource limit exceeded",
                    ));
                }
                let mut array = Vec::with_capacity(length as usize);
                for i in 0..length {
                    let value: Unknown = object.get_element(i)?;
                    if value.get_type()? == ValueType::String {
                        array.push(read(value)?)
                    } else {
                        array.push(Value::Null)
                    }
                }
                Value::Array(array)
            }
        }
        _ => Value::Null,
    })
}
#[napi]
pub fn normalize_http_path(path: Utf16String, express: bool) -> Result<Utf16String> {
    tiny_http_mcp_server_rust::policy::normalize_path(&path, express)
        .map(Utf16String::from)
        .map_err(napi::Error::from_reason)
}

fn project(command: &str, object: &Object<'_>) -> Result<Value> {
    let names = match command {
        "session_update" => &["hasError", "method", "request", "version"][..],
        "tool_ok" => &["hasError"][..],
        _ => {
            return Err(napi::Error::from_reason(
                "Unsupported direct HTTP policy command",
            ));
        }
    };
    let mut fields = Vec::new();
    for name in names {
        if let Some(value) = object.get::<Unknown>(name)?
            && value.get_type()? != ValueType::Undefined
        {
            fields.push((name.encode_utf16().collect(), read(value)?));
        }
    }
    let input = Value::Object(fields);
    let initialization = matches!(input.get("method"),Some(Value::String(s)) if s.iter().copied().eq("initialize".encode_utf16()))
        && input.get("request") == Some(&Value::Bool(true))
        && input.get("hasError") != Some(&Value::Bool(true));
    let inspect_result =
        initialization || command == "tool_ok" && input.get("hasError") != Some(&Value::Bool(true));
    let mut fields = if let Value::Object(fields) = input {
        fields
    } else {
        unreachable!()
    };
    if inspect_result
        && let Some(result) = object.get::<Unknown>("result")?
        && result.get_type()? == ValueType::Object
    {
        let result: Object = unsafe { result.cast()? };
        if !result.is_array()? {
            let name = if initialization {
                "protocolVersion"
            } else {
                "isError"
            };
            let mut projected = Vec::new();
            if (initialization || result.has_own_property(name)?)
                && let Some(value) = result.get::<Unknown>(name)?
                && value.get_type()? != ValueType::Undefined
            {
                let value = if !initialization {
                    Value::Bool(
                        value.get_type()? == ValueType::Boolean && unsafe { value.cast::<bool>()? },
                    )
                } else {
                    read(value)?
                };
                projected.push((name.encode_utf16().collect(), value));
            }
            fields.push(("result".encode_utf16().collect(), Value::Object(projected)));
        }
    }
    Ok(Value::Object(fields))
}

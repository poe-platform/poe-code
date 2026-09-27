use mcp_protocol_rust::json::Value;
use napi::{Env, Property, bindgen_prelude::*};

/// Credential extensions require iterative output conversion as well as admission.
pub struct CredentialJson(pub Value);

enum WriteTask {
    Value(Value),
    Array(usize),
    Object(Vec<Vec<u16>>),
}

impl ToNapiValue for CredentialJson {
    unsafe fn to_napi_value(env: sys::napi_env, value: Self) -> Result<sys::napi_value> {
        // NAPI invokes this on the originating JS thread in its callback handle
        // scope. Raw handles stay in that scope until their parent is assembled;
        // no JS handles are stored in the Rust core or retained after return.
        let environment = Env::from_raw(env);
        let mut tasks = vec![WriteTask::Value(value.0)];
        let mut values = vec![];
        while let Some(task) = tasks.pop() {
            let output = match task {
                WriteTask::Value(Value::Array(items)) => {
                    tasks.push(WriteTask::Array(items.len()));
                    for item in items.into_iter().rev() {
                        tasks.push(WriteTask::Value(item));
                    }
                    continue;
                }
                WriteTask::Value(Value::Object(fields)) => {
                    let (keys, items): (Vec<_>, Vec<_>) = fields.into_iter().unzip();
                    tasks.push(WriteTask::Object(keys));
                    for item in items.into_iter().rev() {
                        tasks.push(WriteTask::Value(item));
                    }
                    continue;
                }
                WriteTask::Value(Value::Null) => unsafe { Null::to_napi_value(env, Null) }?,
                WriteTask::Value(Value::Bool(value)) => unsafe { bool::to_napi_value(env, value) }?,
                WriteTask::Value(Value::Number(value)) => {
                    unsafe { f64::to_napi_value(env, value) }?
                }
                WriteTask::Value(Value::String(value)) => {
                    unsafe { Utf16String::to_napi_value(env, value.into()) }?
                }
                WriteTask::Array(length) => {
                    let items = values
                        .split_off(values.len() - length)
                        .into_iter()
                        .map(|raw| unsafe { Unknown::from_napi_value(env, raw) })
                        .collect::<Result<Vec<_>>>()?;
                    unsafe { Vec::<Unknown>::to_napi_value(env, items) }?
                }
                WriteTask::Object(keys) => {
                    let items = values.split_off(values.len() - keys.len());
                    let mut object = Object::new(&environment)?;
                    let properties = keys
                        .into_iter()
                        .zip(items)
                        .map(|(key, raw)| {
                            Property::new()
                                .with_name(&environment, Utf16String::from(key))?
                                .with_napi_value(&environment, unsafe {
                                    Unknown::from_napi_value(env, raw)
                                }?)
                        })
                        .collect::<Result<Vec<_>>>()?;
                    object.define_properties(&properties)?;
                    unsafe { Object::to_napi_value(env, object) }?
                }
            };
            values.push(output);
        }
        values
            .pop()
            .ok_or_else(|| napi::Error::from_reason("Invalid credential JSON"))
    }
}

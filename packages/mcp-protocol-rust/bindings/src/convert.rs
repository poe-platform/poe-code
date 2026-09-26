use mcp_protocol_rust::json::Value;
use napi::{Env, Property, bindgen_prelude::*};

pub struct NativeJson(pub Value);

enum ConvertTask {
    Value(Value),
    Array(usize),
    Object(Vec<Vec<u16>>),
}

impl ToNapiValue for NativeJson {
    unsafe fn to_napi_value(env: sys::napi_env, value: Self) -> Result<sys::napi_value> {
        // napi-rs invokes this conversion on the originating JS thread inside
        // its callback handle scope. No JS handles are stored in the Rust core.
        // Use heap tasks so callers with unrestricted credential JSON do not
        // consume the native stack for every nested array or object.
        let environment = Env::from_raw(env);
        let mut tasks = vec![ConvertTask::Value(value.0)];
        let mut values: Vec<Unknown> = Vec::new();
        while let Some(task) = tasks.pop() {
            let raw = match task {
                ConvertTask::Value(Value::Null) => unsafe { Null::to_napi_value(env, Null)? },
                ConvertTask::Value(Value::Bool(value)) => unsafe {
                    bool::to_napi_value(env, value)?
                },
                ConvertTask::Value(Value::Number(value)) => unsafe {
                    f64::to_napi_value(env, value)?
                },
                ConvertTask::Value(Value::String(value)) => unsafe {
                    Utf16String::to_napi_value(env, value.into())?
                },
                ConvertTask::Value(Value::Array(children)) => {
                    tasks.push(ConvertTask::Array(children.len()));
                    tasks.extend(children.into_iter().rev().map(ConvertTask::Value));
                    continue;
                }
                ConvertTask::Value(Value::Object(properties)) => {
                    let (keys, children): (Vec<_>, Vec<_>) = properties.into_iter().unzip();
                    tasks.push(ConvertTask::Object(keys));
                    tasks.extend(children.into_iter().rev().map(ConvertTask::Value));
                    continue;
                }
                ConvertTask::Array(length) => {
                    let children = values.split_off(values.len() - length);
                    unsafe { Vec::<Unknown>::to_napi_value(env, children)? }
                }
                ConvertTask::Object(keys) => {
                    // Defining own data properties preserves __proto__, embedded
                    // NULs, lone surrogates, and JSON.parse's property attributes.
                    let mut object = Object::new(&environment)?;
                    let children = values.split_off(values.len() - keys.len());
                    let descriptors = keys
                        .into_iter()
                        .zip(children)
                        .map(|(key, value)| {
                            Property::new()
                                .with_name(&environment, Utf16String::from(key))?
                                .with_napi_value(&environment, value)
                        })
                        .collect::<Result<Vec<_>>>()?;
                    object.define_properties(&descriptors)?;
                    unsafe { Object::to_napi_value(env, object)? }
                }
            };
            values.push(unsafe { Unknown::from_napi_value(env, raw)? });
        }
        Ok(values.pop().expect("root JSON value").raw())
    }
}

use mcp_protocol_rust::json::Value;
use napi::{Env, Property, bindgen_prelude::*};

pub struct NativeJson(pub Value);

impl ToNapiValue for NativeJson {
    unsafe fn to_napi_value(env: sys::napi_env, value: Self) -> Result<sys::napi_value> {
        // napi-rs invokes this conversion on the originating JS thread inside
        // its callback handle scope. No JS handles are stored in the Rust core.
        match value.0 {
            Value::Null => unsafe { Null::to_napi_value(env, Null) },
            Value::Bool(value) => unsafe { bool::to_napi_value(env, value) },
            Value::Number(value) => unsafe { f64::to_napi_value(env, value) },
            Value::String(value) => unsafe { Utf16String::to_napi_value(env, value.into()) },
            Value::Array(values) => unsafe {
                Vec::<NativeJson>::to_napi_value(env, values.into_iter().map(NativeJson).collect())
            },
            Value::Object(properties) => {
                // Defining own data properties preserves __proto__, embedded
                // NULs, lone surrogates, and JSON.parse's property attributes.
                let environment = Env::from_raw(env);
                let mut object = Object::new(&environment)?;
                let descriptors = properties
                    .into_iter()
                    .map(|(key, value)| {
                        Property::new()
                            .with_name(&environment, Utf16String::from(key))?
                            .with_napi_value(&environment, NativeJson(value))
                    })
                    .collect::<Result<Vec<_>>>()?;
                object.define_properties(&descriptors)?;
                unsafe { Object::to_napi_value(env, object) }
            }
        }
    }
}

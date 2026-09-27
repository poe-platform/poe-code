use mcp_protocol_rust::json::Value;
use napi::{Env, JsValue, Property, bindgen_prelude::*};

pub struct NativeJson(pub Value);

impl Drop for NativeJson {
    fn drop(&mut self) {
        if !matches!(self.0, Value::Array(_) | Value::Object(_)) {
            return;
        }
        let mut pending = vec![std::mem::replace(&mut self.0, Value::Null)];
        while let Some(value) = pending.pop() {
            match value {
                Value::Array(values) => pending.extend(values),
                Value::Object(properties) => {
                    pending.extend(properties.into_iter().map(|(_, value)| value));
                }
                _ => {}
            }
        }
    }
}

impl ToNapiValue for NativeJson {
    unsafe fn to_napi_value(env: sys::napi_env, value: Self) -> Result<sys::napi_value> {
        // All handles stay in the originating callback scope. Iterative conversion
        // and disposal let credential extensions grow without native stack recursion.
        let environment = Env::from_raw(env);
        type Parent = (sys::napi_value, Vec<u16>);
        let mut pending: Vec<(NativeJson, Option<Parent>)> = vec![(value, None)];
        let mut root = std::ptr::null_mut();
        while let Some((mut value, parent)) = pending.pop() {
            let raw = match std::mem::replace(&mut value.0, Value::Null) {
                Value::Null => unsafe { Null::to_napi_value(env, Null)? },
                Value::Bool(value) => unsafe { bool::to_napi_value(env, value)? },
                Value::Number(value) => unsafe { f64::to_napi_value(env, value)? },
                Value::String(value) => unsafe { Utf16String::to_napi_value(env, value.into())? },
                Value::Array(values) => {
                    let mut array = std::ptr::null_mut();
                    napi::check_status!(unsafe {
                        sys::napi_create_array_with_length(env, values.len(), &mut array)
                    })?;
                    pending.extend(values.into_iter().enumerate().rev().map(|(index, value)| {
                        (NativeJson(value), Some((array, index.to_string().encode_utf16().collect())))
                    }));
                    array
                }
                Value::Object(properties) => {
                    let object = Object::new(&environment)?.raw();
                    pending.extend(properties.into_iter().rev().map(|(key, value)| {
                        (NativeJson(value), Some((object, key)))
                    }));
                    object
                }
            };
            if let Some((parent, key)) = parent {
                // Own data properties preserve __proto__, NULs, lone surrogates,
                // and JSON.parse's writable/enumerable/configurable attributes.
                let value = unsafe { Unknown::from_raw_unchecked(env, raw) };
                let descriptor = Property::new()
                    .with_name(&environment, Utf16String::from(key))?
                    .with_napi_value(&environment, value)?;
                Object::from_raw(env, parent).define_properties(&[descriptor])?;
            } else {
                root = raw;
            }
        }
        Ok(root)
    }
}

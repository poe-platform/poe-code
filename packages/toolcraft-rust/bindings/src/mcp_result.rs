use napi::{ValueType, bindgen_prelude::*};
use napi_derive::napi;

/// Validate before copying. All handles stay in this synchronous callback scope;
/// property access and spread execute in the caller's JavaScript realm.
#[napi]
pub fn mark_mcp_result<'env>(value: Unknown<'env>, host: Object<'env>) -> Result<Unknown<'env>> {
    let mut valid = value.get_type()? == ValueType::Object;
    if valid {
        let is_array: Function<Unknown, bool> = host.get_named_property("isArray")?;
        valid = !is_array.call(value)?;
        if valid {
            let content_is_array: Function<Unknown, bool> =
                host.get_named_property("contentIsArray")?;
            valid = content_is_array.call(value)?;
        }
    }
    if !valid {
        let invalid: Function<(), Unknown> = host.get_named_property("invalid")?;
        return invalid.call(());
    }
    let copy_and_mark: Function<Unknown, Unknown> = host.get_named_property("copyAndMark")?;
    copy_and_mark.call(value)
}

#[napi]
pub fn is_mcp_result(value: Unknown<'_>, host: Object<'_>) -> Result<bool> {
    if value.get_type()? != ValueType::Object {
        return Ok(false);
    }
    let marker: Function<Unknown, Unknown> = host.get_named_property("marker")?;
    let marker = marker.call(value)?;
    if marker.get_type()? != ValueType::Boolean {
        return Ok(false);
    }
    // The type was checked above; no coercion of caller values is performed.
    let marker: bool = unsafe { marker.cast()? };
    Ok(marker)
}

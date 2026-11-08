use crate::host::NodeHost;
use napi::{Env, JsValue, ValueType, bindgen_prelude::*, check_status, sys};
use napi_derive::napi;
use toolcraft_rust::cli_json_errors::{JsonErrorHost, scan_offset_prefix};
use toolcraft_rust::host::Host;

impl JsonErrorHost for NodeHost<'_> {
    fn primitive_offset_location(
        &mut self,
        source: Self::Value,
        bounded: Self::Value,
    ) -> Result<Option<Self::Value>> {
        if source.get_type()? != ValueType::String || bounded.get_type()? != ValueType::Number {
            return Ok(None);
        }
        let bounded: f64 = unsafe { bounded.cast()? };
        // Saturating casts map negative/NaN bounds to zero and infinity to the
        // platform maximum. A fractional live Math.max result admits ceil(n)
        // iterations in the original index < bound loop.
        let limit = bounded.ceil() as usize;
        let mut length = 0;
        check_status!(unsafe {
            sys::napi_get_value_string_utf16(
                self.env.raw(),
                source.raw(),
                std::ptr::null_mut(),
                0,
                &mut length,
            )
        })?;
        let prefix_length = limit.min(length);
        let mut prefix = vec![0; prefix_length + 1];
        let mut written = 0;
        check_status!(unsafe {
            sys::napi_get_value_string_utf16(
                self.env.raw(),
                source.raw(),
                prefix.as_mut_ptr(),
                prefix.len(),
                &mut written,
            )
        })?;
        let (line, column) = scan_offset_prefix(&prefix[..written]);
        let number = |value: usize| unsafe {
            Unknown::from_napi_value(
                self.env.raw(),
                f64::to_napi_value(self.env.raw(), value as f64)?,
            )
        };
        // The host object literal defines own data properties even when the
        // caller has installed inherited line/column setters.
        Ok(Some(
            self.call("location", vec![number(line)?, number(column)?])?,
        ))
    }
}

#[napi]
pub fn cli_json_errors_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    toolcraft_rust::cli_json_errors::run(&mut NodeHost { env, object: host }, &operation, &args)
}

use crate::host_values::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_schema_rust::validate::{self, Host};

impl<'env> Host for NodeHost<'env> {
    fn call(&mut self, operation: &str, args: Vec<Unknown<'env>>) -> Result<Unknown<'env>> {
        let function: Function<FnArgs<(String, Vec<Unknown>)>, Unknown> =
            self.0.get_named_property("operate")?;
        function.call((operation.to_owned(), args).into())
    }
    fn string(&mut self, value: Unknown<'env>) -> Result<Vec<u16>> {
        // Read UTF-16 directly, preserving lone surrogates in values and paths.
        let value: Utf16String = unsafe { value.cast()? };
        Ok(value.to_vec())
    }
    fn make_string(&mut self, value: Vec<u16>) -> Result<Unknown<'env>> {
        // Every handle stays inside the current synchronous N-API scope.
        unsafe {
            Unknown::from_napi_value(
                self.1.raw(),
                Utf16String::to_napi_value(self.1.raw(), value.into())?,
            )
        }
    }
    fn make_number(&mut self, value: f64) -> Result<Unknown<'env>> {
        unsafe { Unknown::from_napi_value(self.1.raw(), f64::to_napi_value(self.1.raw(), value)?) }
    }
    fn undefined(&mut self) -> Result<Unknown<'env>> {
        self.1.get_global()?.get_named_property("undefined")
    }
    fn make_boolean(&mut self, value: bool) -> Result<Unknown<'env>> {
        unsafe { Unknown::from_napi_value(self.1.raw(), bool::to_napi_value(self.1.raw(), value)?) }
    }
}

#[napi]
pub fn validate<'env>(
    env: Env,
    schema: Unknown<'env>,
    value: Unknown<'env>,
    defaults: Unknown<'env>,
    symbol: Unknown<'env>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let mut host = NodeHost(host, env);
    let result = validate::validate(&mut host, schema, value, defaults, symbol)?;
    if result.issues.is_empty() {
        let value = match result.value {
            Some(value) => value,
            None => host.undefined()?,
        };
        host.call("success", vec![value])
    } else {
        let issues = host.call("array", result.issues)?;
        host.call("failure", vec![issues])
    }
}

#[napi]
pub fn is_plain_record(env: Env, value: Unknown<'_>, host: Object<'_>) -> Result<bool> {
    validate::is_plain_record(&mut NodeHost(host, env), value)
}

#[napi]
pub fn deep_equal<'env>(
    env: Env,
    left: Unknown<'env>,
    right: Unknown<'env>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    validate::deep_equal(&mut NodeHost(host, env), left, right)
}

#[napi]
pub fn has_required_keys(
    env: Env,
    schema: Unknown<'_>,
    value: Unknown<'_>,
    host: Object<'_>,
) -> Result<bool> {
    validate::has_required_keys(&mut NodeHost(host, env), schema, value)
}

#[napi]
pub fn required_fingerprint(
    env: Env,
    schema: Unknown<'_>,
    host: Object<'_>,
) -> Result<Utf16String> {
    validate::required_fingerprint(&mut NodeHost(host, env), schema).map(Into::into)
}

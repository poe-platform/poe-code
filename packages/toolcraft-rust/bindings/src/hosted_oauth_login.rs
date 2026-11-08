use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::{host::Host, hosted_oauth_login::LoginHost};

impl LoginHost for NodeHost<'_> {
    fn template_units(&mut self, value: Self::Value) -> Result<Vec<u16>> {
        let value = self.call("template", vec![value])?;
        let text: Utf16String = unsafe { value.cast()? };
        Ok(text.to_vec())
    }
    fn string_from_units(&mut self, value: Vec<u16>) -> Result<Self::Value> {
        let value = unsafe { Utf16String::to_napi_value(self.env.raw(), value.into()) }?;
        unsafe { Unknown::from_napi_value(self.env.raw(), value) }
    }
}

#[napi]
pub fn hosted_oauth_login_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    toolcraft_rust::hosted_oauth_login::run(&mut NodeHost { env, object: host }, &operation, &args)
}

use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::stack_trim::StackHost;

impl StackHost for NodeHost<'_> {
    fn literal(&mut self, text: &'static str) -> Result<Self::Value> {
        let value = unsafe { String::to_napi_value(self.env.raw(), text.to_owned()) }?;
        unsafe { Unknown::from_napi_value(self.env.raw(), value) }
    }
}

#[napi]
pub fn stack_trim_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    toolcraft_rust::stack_trim::run(&mut NodeHost { env, object: host }, &operation, &args)
}

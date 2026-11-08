use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::hosted_oauth_runtime::RuntimeHost;

impl RuntimeHost for NodeHost<'_> {
    fn integer(&mut self, value: u32) -> Result<Self::Value> {
        let value = unsafe { u32::to_napi_value(self.env.raw(), value) }?;
        unsafe { Unknown::from_napi_value(self.env.raw(), value) }
    }
}

#[napi]
pub fn hosted_oauth_runtime_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    toolcraft_rust::hosted_oauth_runtime::run(
        &mut NodeHost { env, object: host },
        &operation,
        &args,
    )
}

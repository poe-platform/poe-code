use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::runtime_policy;

#[napi]
pub fn reserved_service_names() -> Vec<&'static str> {
    runtime_policy::RESERVED_SERVICE_NAMES.to_vec()
}

#[napi]
pub fn runtime_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    runtime_policy::run(&mut NodeHost { env, object: host }, &operation, &args)
}

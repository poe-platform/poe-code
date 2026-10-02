use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;

#[napi]
pub fn cli_json_errors_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    toolcraft_rust::cli_json_errors::run(&mut NodeHost { env, object: host }, &operation, &args)
}

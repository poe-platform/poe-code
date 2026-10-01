use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::api_error_summary;

#[napi]
pub fn api_error_summary<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    api_error_summary::run(&mut NodeHost { env, object: host }, &operation, &args)
}

mod host;
use host::NodeHost;
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi]
pub fn approval_policy<'env>(
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    agent_human_in_loop_rust::run(&mut NodeHost { object: host }, &operation, &args)
}

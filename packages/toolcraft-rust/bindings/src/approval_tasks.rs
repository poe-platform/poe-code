use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;

#[napi]
pub fn approval_state_machine_json() -> &'static str {
    toolcraft_rust::approval_tasks::STATE_MACHINE_JSON
}

#[napi]
pub fn approval_tasks_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    toolcraft_rust::approval_tasks::run(&mut NodeHost { env, object: host }, &operation, &args)
}

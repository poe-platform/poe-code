use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::applied_default;

#[napi]
pub fn validate_applied_default<'env>(
    env: Env,
    schema: Unknown<'env>,
    label: Unknown<'env>,
    errors: Unknown<'env>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    applied_default::validate(&mut NodeHost { env, object: host }, schema, label, errors)
}

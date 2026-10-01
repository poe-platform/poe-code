use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::json_schema_converter;

#[napi]
pub fn json_schema_conversion<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    json_schema_converter::run(&mut NodeHost { env, object: host }, &operation, &args)
}

#[napi]
pub fn json_schema_array_index(value: Vec<u16>) -> bool {
    !value.is_empty() && value.iter().all(|unit| (48..=57).contains(unit))
}

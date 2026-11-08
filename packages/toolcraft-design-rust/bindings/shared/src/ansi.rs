use super::table::NodeHost;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::ansi;

#[napi]
pub fn design_ansi_policy<'env>(
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    ansi::run(&mut NodeHost { object: host }, &operation, &args)
}

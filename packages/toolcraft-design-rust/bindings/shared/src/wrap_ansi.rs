use super::table::NodeHost;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::wrap_ansi;

#[napi]
pub fn design_wrap_ansi_policy<'env>(
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    wrap_ansi::run(&mut NodeHost { object: host }, &operation, &args)
}

#[napi]
pub fn design_wrap_ansi_closing_code(code: f64) -> Option<f64> {
    wrap_ansi::closing_code(code)
}

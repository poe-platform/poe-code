use super::table::NodeHost;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::string_width;

#[napi]
pub fn design_string_width_policy<'env>(
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    string_width::run(&mut NodeHost { object: host }, &operation, &args)
}

#[napi]
pub fn design_string_width_point_kind(point: f64) -> &'static str {
    string_width::point_kind(point)
}

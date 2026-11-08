use super::table::NodeHost;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::help;

#[napi]
pub fn design_help_policy<'env>(
    operation: String,
    args: Vec<Unknown<'env>>,
    plain: bool,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    help::run(&mut NodeHost { object: host }, &operation, &args, plain)
}
#[napi]
pub fn design_help_point_width(point: f64) -> f64 {
    help::point_width(point)
}
#[napi]
pub fn design_help_emoji_point(point: f64) -> bool {
    help::emoji_point(point)
}

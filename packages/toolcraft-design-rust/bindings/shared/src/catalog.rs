use super::table::NodeHost;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::catalog;

#[napi]
pub fn design_catalog_policy<'env>(
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    catalog::run(&mut NodeHost { object: host }, &operation, &args)
}

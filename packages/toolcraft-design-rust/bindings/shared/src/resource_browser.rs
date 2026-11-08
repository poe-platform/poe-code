use super::table::NodeHost;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::resource_browser;

#[napi]
pub fn design_resource_browser_policy<'env>(
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    resource_browser::run(&mut NodeHost { object: host }, &operation, &args)
}

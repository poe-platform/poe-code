use super::table::NodeHost;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::cards;

#[napi]
pub fn design_cards_policy<'env>(
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    cards::run(&mut NodeHost { object: host }, &operation, &args)
}

use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::error_report;

#[napi]
pub fn error_report_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    error_report::run(&mut NodeHost { env, object: host }, &operation, &args)
}
#[napi]
pub fn report_timestamp(iso: Utf16String) -> Utf16String {
    error_report::timestamp(&iso).into()
}
#[napi]
pub fn report_slug(characters: Vec<Utf16String>) -> Utf16String {
    error_report::slug(
        &characters
            .into_iter()
            .map(|value| value.to_vec())
            .collect::<Vec<_>>(),
    )
    .into()
}

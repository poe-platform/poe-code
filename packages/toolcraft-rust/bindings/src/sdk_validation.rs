use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::{sdk_casing, sdk_validation};

#[napi]
pub fn sdk_format_segment(
    value: Utf16String,
    lower: Function<Utf16String, Utf16String>,
    upper: Function<Utf16String, Utf16String>,
) -> Result<Utf16String> {
    sdk_casing::format(
        &value,
        |value| {
            lower
                .call(value.to_vec().into())
                .map(|value| value.to_vec())
        },
        |value| {
            upper
                .call(value.to_vec().into())
                .map(|value| value.to_vec())
        },
    )
    .map(Into::into)
}

#[napi]
pub fn sdk_validate<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    sdk_validation::run(&mut NodeHost { env, object: host }, &operation, &args)
}

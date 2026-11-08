use crate::host_values::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_schema_rust::{builders, schema_document, validate};

#[napi]
pub fn build_schema<'env>(
    env: Env,
    kind: String,
    first: Unknown<'env>,
    second: Unknown<'env>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    builders::build(&mut NodeHost(host, env), &kind, first, second)
}
#[napi]
pub fn invalid_enum_value(
    env: Env,
    value: Unknown<'_>,
    integer: bool,
    host: Object<'_>,
) -> Result<bool> {
    builders::invalid_enum_value(&mut NodeHost(host, env), value, integer)
}
#[napi]
pub fn required_keys(env: Env, schema: Unknown<'_>, host: Object<'_>) -> Result<Vec<Utf16String>> {
    validate::required_keys(&mut NodeHost(host, env), schema)
        .map(|keys| keys.into_iter().map(Into::into).collect())
}
#[napi]
pub fn enum_type_matches(
    env: Env,
    value: Unknown<'_>,
    expected: String,
    host: Object<'_>,
) -> Result<bool> {
    schema_document::enum_type_matches(&mut NodeHost(host, env), value, &expected)
}
#[napi]
pub fn to_json_schema<'env>(
    env: Env,
    schema: Unknown<'env>,
    options: Unknown<'env>,
    symbol: Unknown<'env>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    schema_document::to_json_schema(&mut NodeHost(host, env), schema, options, symbol)
}
#[napi]
pub fn branch_json_schema<'env>(
    env: Env,
    schema: Unknown<'env>,
    options: Unknown<'env>,
    symbol: Unknown<'env>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    schema_document::branch_json_schema(&mut NodeHost(host, env), schema, options, symbol)
}
#[napi]
pub fn standard_document<'env>(
    env: Env,
    schema: Unknown<'env>,
    io: Unknown<'env>,
    options: Unknown<'env>,
    symbol: Unknown<'env>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    schema_document::standard_document(&mut NodeHost(host, env), schema, io, options, symbol)
}
#[napi]
pub fn to_json_schema_document<'env>(
    env: Env,
    schema: Unknown<'env>,
    options: Unknown<'env>,
    symbol: Unknown<'env>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    schema_document::to_document(&mut NodeHost(host, env), schema, options, symbol)
}
#[napi]
pub fn with_json_schema<'env>(
    env: Env,
    projection: Unknown<'env>,
    document: Unknown<'env>,
    symbol: Unknown<'env>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    schema_document::with_json_schema(&mut NodeHost(host, env), projection, document, symbol)
}
#[napi]
pub fn unicode_length(value: Array<'_>) -> u32 {
    value.len()
}

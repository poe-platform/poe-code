use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::schema_scope;

#[napi]
pub fn filter_schema_for_scope<'env>(
    env: Env,
    schema: Unknown<'env>,
    scope: Unknown<'env>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    schema_scope::filter(&mut NodeHost { env, object: host }, schema, scope)
}

#[napi]
pub fn filter_scope_branch<'env>(
    env: Env,
    schema: Unknown<'env>,
    scope: Unknown<'env>,
    key: Unknown<'env>,
    entry: bool,
    objects_only: bool,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    schema_scope::filter_branch(
        &mut NodeHost { env, object: host },
        schema,
        scope,
        key,
        entry,
        objects_only,
    )
}

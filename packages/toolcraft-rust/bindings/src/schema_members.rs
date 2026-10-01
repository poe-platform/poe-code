use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::schema_members;

#[napi]
pub fn validate_cased_schema_members<'env>(
    env: Env,
    schema: Unknown<'env>,
    formatter: Unknown<'env>,
    surface: Unknown<'env>,
    discriminator: Unknown<'env>,
    host: Object<'env>,
) -> Result<()> {
    schema_members::validate(
        &mut NodeHost { env, object: host },
        schema,
        formatter,
        surface,
        discriminator,
    )
}

#[napi]
pub fn validate_cased_schema_member<'env>(
    env: Env,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<()> {
    let [members, key, child, formatter, surface] = args.as_slice() else {
        return Err(napi::Error::from_reason("Invalid schema member arguments"));
    };
    schema_members::validate_member(
        &mut NodeHost { env, object: host },
        *members,
        *key,
        *child,
        *formatter,
        *surface,
    )
}

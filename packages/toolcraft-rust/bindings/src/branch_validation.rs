use crate::host::NodeHost;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_rust::branch_validation;

#[napi]
pub fn resolve_discriminated_branch<'env>(
    env: Env,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let [schema, value, key, label, errors] = args.as_slice() else {
        return Err(napi::Error::from_reason("Invalid discriminator arguments"));
    };
    branch_validation::discriminator(
        &mut NodeHost { env, object: host },
        *schema,
        *value,
        *key,
        *label,
        *errors,
    )
}

#[napi]
pub fn validate_union_schema<'env>(
    env: Env,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let [schema, value, label, errors, validator] = args.as_slice() else {
        return Err(napi::Error::from_reason("Invalid union arguments"));
    };
    branch_validation::union(
        &mut NodeHost { env, object: host },
        *schema,
        *value,
        *label,
        *errors,
        *validator,
    )
}

#[napi]
pub fn validate_union_branch<'env>(
    env: Env,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<()> {
    let [index, branch, matches, failures, validator] = args.as_slice() else {
        return Err(napi::Error::from_reason("Invalid union branch arguments"));
    };
    branch_validation::union_branch(
        &mut NodeHost { env, object: host },
        *index,
        *branch,
        *matches,
        *failures,
        *validator,
    )
}

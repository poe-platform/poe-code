use super::{string_width::PrimitiveHost, table::NodeHost};
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;

#[napi]
pub fn design_theme_fixture_policy<'env>(
    env: Env,
    _operation: String,
    _args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    toolcraft_design_rust::theme_fixture::run(&mut PrimitiveHost {
        env,
        host: NodeHost { object: host },
    })?
    .to_host(&env)
}

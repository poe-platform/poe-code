use super::{
    string_width::{PrimitiveHost, Value},
    table::NodeHost,
};
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;

#[napi]
pub fn design_explorer_fixture_data(kind: String) -> NativeJson {
    NativeJson(toolcraft_design_rust::explorer_fixtures::data(&kind))
}
#[napi]
pub fn design_explorer_fixtures_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let args = args
        .into_iter()
        .map(Value::from_host)
        .collect::<Result<Vec<_>>>()?;
    toolcraft_design_rust::explorer_fixtures::run(
        &mut PrimitiveHost {
            env,
            host: NodeHost { object: host },
        },
        &operation,
        &args,
    )?
    .to_host(&env)
}

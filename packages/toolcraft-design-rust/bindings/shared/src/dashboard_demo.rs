use super::{
    string_width::{PrimitiveHost, Value},
    table::NodeHost,
};
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_design_rust::dashboard_demo;

#[napi]
pub fn design_dashboard_demo_config() -> NativeJson {
    NativeJson(dashboard_demo::config())
}

#[napi]
pub fn design_dashboard_demo_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let args = args
        .into_iter()
        .map(Value::from_host)
        .collect::<Result<Vec<_>>>()?;
    dashboard_demo::run(
        &mut PrimitiveHost {
            env,
            host: NodeHost { object: host },
        },
        &operation,
        &args,
    )?
    .to_host(&env)
}

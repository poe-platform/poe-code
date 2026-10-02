use super::{
    string_width::{PrimitiveHost, Value},
    table::NodeHost,
};
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
#[napi]
pub fn design_dashboard_snapshot_policy<'env>(
    env: Env,
    _operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let args = args
        .into_iter()
        .map(Value::from_host)
        .collect::<Result<Vec<_>>>()?;
    toolcraft_design_rust::dashboard_snapshot::run(
        &mut PrimitiveHost {
            env,
            host: NodeHost { object: host },
        },
        &args,
    )?
    .to_host(&env)
}

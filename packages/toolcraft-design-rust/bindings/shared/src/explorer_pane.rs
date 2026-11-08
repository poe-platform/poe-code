use super::{
    string_width::{PrimitiveHost, Value},
    table::NodeHost,
};
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;

#[napi]
pub fn design_explorer_pane_policy<'env>(
    env: Env,
    _operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let args = args
        .into_iter()
        .map(Value::from_host)
        .collect::<Result<Vec<_>>>()?;
    toolcraft_design_rust::explorer_pane::run(
        &mut PrimitiveHost {
            env,
            host: NodeHost { object: host },
        },
        &args,
    )?
    .to_host(&env)
}

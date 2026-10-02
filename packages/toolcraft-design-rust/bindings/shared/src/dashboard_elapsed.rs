use super::{
    string_width::{PrimitiveHost, Value},
    table::NodeHost,
};
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;

#[napi]
pub fn design_dashboard_elapsed<'env>(
    env: Env,
    _operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let args = args
        .into_iter()
        .map(Value::from_host)
        .collect::<Result<Vec<_>>>()?;
    let [value] = args.as_slice() else {
        return Err(Error::new(
            Status::InvalidArg,
            "Expected elapsed time argument",
        ));
    };
    toolcraft_design_rust::dashboard_elapsed::format(
        &mut PrimitiveHost {
            env,
            host: NodeHost { object: host },
        },
        *value,
    )?
    .to_host(&env)
}

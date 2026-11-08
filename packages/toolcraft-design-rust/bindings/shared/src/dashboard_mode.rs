use super::{
    string_width::{PrimitiveHost, Value},
    table::NodeHost,
};
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;

#[napi]
pub fn design_dashboard_mode<'env>(
    env: Env,
    _operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<bool> {
    let args = args
        .into_iter()
        .map(Value::from_host)
        .collect::<Result<Vec<_>>>()?;
    let [enabled, io] = args.as_slice() else {
        return Err(Error::new(
            Status::InvalidArg,
            "Expected dashboard mode arguments",
        ));
    };
    toolcraft_design_rust::dashboard_mode::should_use(
        &mut PrimitiveHost {
            env,
            host: NodeHost { object: host },
        },
        *enabled,
        *io,
    )
}

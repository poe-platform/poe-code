use super::{
    string_width::{PrimitiveHost, Value},
    table::NodeHost,
};
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;

#[napi]
pub fn design_terminal_string_tail_policy<'env>(
    env: Env,
    _operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    toolcraft_design_rust::terminal_strings::tail_start(
        &mut PrimitiveHost {
            env,
            host: NodeHost { object: host },
        },
        Value::from_host(args[0])?,
        Value::from_host(args[1])?,
    )?
    .to_host(&env)
}

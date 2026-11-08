use super::{
    string_width::{PrimitiveHost, Value},
    table::NodeHost,
};
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_design_rust::terminal_input;
#[napi]
pub fn design_terminal_input_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let args = args
        .into_iter()
        .map(Value::from_host)
        .collect::<Result<Vec<_>>>()?;
    terminal_input::run(
        &mut PrimitiveHost {
            env,
            host: NodeHost { object: host },
        },
        &operation,
        &args,
    )?
    .to_host(&env)
}

impl toolcraft_design_rust::terminal_input::Host for PrimitiveHost<'_> {
    fn string(&mut self, value: &'static str) -> Result<Self::Value> {
        Ok(Value::Block(value))
    }
    fn boolean(&mut self, value: bool) -> Result<Self::Value> {
        Ok(Value::Numeric(
            toolcraft_design_rust::string_width::NumericResult::Boolean(value),
        ))
    }
}

use super::{
    string_width::{PrimitiveHost, Value},
    table::NodeHost,
};
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_design_rust::{string_width::NumericResult, text_cells};
impl text_cells::Host for PrimitiveHost<'_> {
    fn number(&mut self, value: f64) -> Result<Self::Value> {
        Ok(Value::Numeric(NumericResult::Number(value)))
    }
}
#[napi]
pub fn design_text_cells_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let args = args
        .into_iter()
        .map(Value::from_host)
        .collect::<Result<Vec<_>>>()?;
    text_cells::run(
        &mut PrimitiveHost {
            env,
            host: NodeHost { object: host },
        },
        &operation,
        &args,
    )?
    .to_host(&env)
}

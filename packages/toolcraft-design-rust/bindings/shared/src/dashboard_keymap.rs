use super::{
    string_width::{PrimitiveHost, Value},
    table::NodeHost,
};
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
#[napi]
pub fn design_dashboard_keymap_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let args = args
        .into_iter()
        .map(Value::from_host)
        .collect::<Result<Vec<_>>>()?;
    toolcraft_design_rust::dashboard_keymap::run(
        &mut PrimitiveHost {
            env,
            host: NodeHost { object: host },
        },
        &operation,
        &args,
    )?
    .to_host(&env)
}
#[napi]
pub fn design_dashboard_keymap_defaults() -> Vec<Vec<String>> {
    toolcraft_design_rust::dashboard_keymap::defaults()
        .iter()
        .map(|(name, keys)| {
            std::iter::once(*name)
                .chain(keys.iter().copied())
                .map(str::to_owned)
                .collect()
        })
        .collect()
}
#[napi]
pub fn design_dashboard_named_keys() -> Vec<String> {
    toolcraft_design_rust::dashboard_keymap::named_keys()
        .iter()
        .map(|key| (*key).to_owned())
        .collect()
}

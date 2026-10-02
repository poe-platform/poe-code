use super::{
    string_width::{PrimitiveHost, Value},
    table::NodeHost,
};
use napi::{Env, ValueType, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_design_rust::{explorer_layout, table::Host};

#[napi]
pub fn design_explorer_layout_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let mut host = NodeHost { object: host };
    if operation == "body" {
        return explorer_layout::body(
            &mut PrimitiveHost { env, host },
            Value::from_host(args[0])?,
        )?
        .to_host(&env);
    }
    let mut sizes = [0.; 2];
    for (index, key) in ["cols", "rows"].iter().enumerate() {
        let value = host.get(args[0], key)?;
        if value.get_type()? == ValueType::Number {
            sizes[index] = unsafe { value.cast()? };
        }
    }
    let layout = explorer_layout::compute(sizes[0], sizes[1], |key, expected| {
        let value = host.get(args[0], key)?;
        if expected == "true" {
            host.is_true(value)
        } else {
            host.is_kind(value, expected)
        }
    })?;
    let mut result = Object::new(&env)?;
    result.set_named_property("mode", layout.mode)?;
    for (key, rect) in [
        ("header", layout.header),
        ("list", layout.list),
        ("detail", layout.detail),
        ("footer", layout.footer),
    ] {
        let mut value = Object::new(&env)?;
        for (key, number) in ["x", "y", "width", "height"].into_iter().zip(rect) {
            value.set_named_property(key, number)?;
        }
        result.set_named_property(key, value)?;
    }
    Ok(result.to_unknown())
}

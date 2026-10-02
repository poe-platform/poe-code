use super::table::NodeHost;
use napi::{Env, ValueType, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_design_rust::{
    string_width::{self, NumericResult},
    table::Host,
};

#[derive(Clone, Copy)]
enum Value<'env> {
    Numeric(NumericResult),
    Block(&'static str),
    Host(Unknown<'env>),
}

impl<'env> Value<'env> {
    fn from_host(value: Unknown<'env>) -> Result<Self> {
        Ok(match value.get_type()? {
            ValueType::Number => Self::Numeric(NumericResult::Number(unsafe { value.cast()? })),
            ValueType::Boolean => Self::Numeric(NumericResult::Boolean(unsafe { value.cast()? })),
            _ => Self::Host(value),
        })
    }

    fn to_host(self, env: &Env) -> Result<Unknown<'env>> {
        // These handles live only inside this invocation's active N-API scope.
        unsafe {
            let raw = match self {
                Self::Numeric(NumericResult::Number(value)) => {
                    f64::to_napi_value(env.raw(), value)?
                }
                Self::Numeric(NumericResult::Boolean(value)) => {
                    bool::to_napi_value(env.raw(), value)?
                }
                Self::Block(value) => <&str>::to_napi_value(env.raw(), value)?,
                Self::Host(value) => return Ok(value),
            };
            Unknown::from_napi_value(env.raw(), raw)
        }
    }
}

struct WidthHost<'env> {
    env: Env,
    host: NodeHost<'env>,
}

impl<'env> Host for WidthHost<'env> {
    type Value = Value<'env>;
    type Error = napi::Error;

    fn call(&mut self, name: &str, args: Vec<Self::Value>) -> Result<Self::Value> {
        // Keep primitive intermediates in Rust. Host objects never take this
        // path, so their arithmetic/coercion order stays with ECMAScript.
        let mut numbers = [0.0; 3];
        if args.len() <= numbers.len()
            && args.iter().enumerate().all(|(index, value)| {
                if let Value::Numeric(NumericResult::Number(value)) = value {
                    numbers[index] = *value;
                    true
                } else {
                    false
                }
            })
            && let Some(value) = string_width::numeric_operation(name, &numbers[..args.len()])
        {
            return Ok(Value::Numeric(value));
        }
        if args.is_empty() {
            let block = match name {
                "latin" => Some("latin"),
                "ansi" => Some("ansi"),
                "control" => Some("control"),
                "tab" => Some("tab"),
                "emoji" => Some("emoji"),
                "cjkt" => Some("cjkt"),
                _ => None,
            };
            if let Some(block) = block {
                return Ok(Value::Block(block));
            }
        }
        let args = args
            .into_iter()
            .map(|value| value.to_host(&self.env))
            .collect::<Result<Vec<_>>>()?;
        Value::from_host(self.host.call(name, args)?)
    }

    fn get(&mut self, value: Self::Value, key: &str) -> Result<Self::Value> {
        Value::from_host(self.host.get(value.to_host(&self.env)?, key)?)
    }

    fn is_undefined(&self, value: Self::Value) -> Result<bool> {
        match value {
            Value::Host(value) => self.host.is_undefined(value),
            _ => Ok(false),
        }
    }

    fn is_true(&self, value: Self::Value) -> Result<bool> {
        Ok(matches!(
            value,
            Value::Numeric(NumericResult::Boolean(true))
        ))
    }

    fn is_kind(&self, value: Self::Value, kind: &str) -> Result<bool> {
        match value {
            Value::Block(value) => Ok(value == kind),
            Value::Host(value) => self.host.is_kind(value, kind),
            _ => Ok(false),
        }
    }
}

#[napi]
pub fn design_string_width_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let args = args
        .into_iter()
        .map(Value::from_host)
        .collect::<Result<Vec<_>>>()?;
    string_width::run(
        &mut WidthHost {
            env,
            host: NodeHost { object: host },
        },
        &operation,
        &args,
    )?
    .to_host(&env)
}

#[napi]
pub fn design_string_width_point_kind(point: f64) -> &'static str {
    string_width::point_kind(point)
}

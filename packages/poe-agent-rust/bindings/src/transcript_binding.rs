use napi::{Property, bindgen_prelude::*};
use napi_derive::napi;
use poe_agent_rust::transcript::{self, Event, Kind, Node};
pub(crate) fn encode(env: Env, node: Node<napi::sys::napi_value>) -> Result<napi::sys::napi_value> {
    match node {
        Node::Bool(value) => unsafe { bool::to_napi_value(env.raw(), value) },
        Node::Opaque(value) => Ok(value),
        Node::String(value) => unsafe { String::to_napi_value(env.raw(), value.to_owned()) },
        Node::Number(value) => unsafe { f64::to_napi_value(env.raw(), value) },
        Node::Object(fields) => {
            let mut object = Object::new(&env)?;
            let descriptors = fields
                .into_iter()
                .map(|(key, value)| {
                    let value =
                        unsafe { Unknown::from_raw_unchecked(env.raw(), encode(env, value)?) };
                    Ok(Property::new().with_utf8_name(key)?.with_value(&value))
                })
                .collect::<Result<Vec<_>>>()?;
            object.define_properties(&descriptors)?;
            Ok(object.raw())
        }
    }
}
#[napi]
pub fn map_agent_transcript<'env>(
    env: Env,
    event: Object<'env>,
    length: Function<'env, Unknown<'env>, Unknown<'env>>,
    difference: Function<'env, FnArgs<(Unknown<'_>, Unknown<'_>)>, Unknown<'env>>,
) -> Result<Vec<Unknown<'env>>> {
    let kind = transcript::classify(|label| {
        let value: Unknown<'env> = event.get_c_named_property_unchecked(c"type")?;
        env.strict_equals(value, env.create_string(label)?)
    })?;
    let field = |key| event.get_c_named_property_unchecked::<Unknown<'env>>(key);
    let mapped = match kind {
        Kind::Ignore => Event::Ignore,
        Kind::Message => {
            let content = field(c"content")?;
            let length = length.call(content)?;
            if env.strict_equals(length, env.create_double(0.0)?)? {
                Event::Ignore
            } else {
                Event::Message {
                    content: field(c"content")?.raw(),
                    empty: false,
                }
            }
        }
        Kind::Intent => {
            let id = field(c"intentId")?.raw();
            let tool = field(c"tool")?.raw();
            let args = field(c"args")?.raw();
            Event::Intent {
                id,
                subsequent_id: field(c"intentId")?.raw(),
                tool,
                args,
            }
        }
        Kind::Result => Event::Result {
            id: field(c"intentId")?.raw(),
            result: field(c"result")?.raw(),
        },
        Kind::Error => Event::Error {
            id: field(c"intentId")?.raw(),
            error: field(c"error")?.raw(),
        },
        Kind::Usage => {
            let usage = field(c"usage")?.coerce_to_object()?;
            let input: Unknown<'env> = usage.get_c_named_property_unchecked(c"inputTokens")?;
            let output: Unknown<'env> = usage.get_c_named_property_unchecked(c"outputTokens")?;
            let cached: Unknown<'env> = usage.get_c_named_property_unchecked(c"cachedTokens")?;
            let creation: Unknown<'env> =
                usage.get_c_named_property_unchecked(c"cacheCreationTokens")?;
            let diff = difference
                .call(FnArgs::from((
                    unsafe { Unknown::from_raw_unchecked(env.raw(), input.raw()) },
                    unsafe { Unknown::from_raw_unchecked(env.raw(), cached.raw()) },
                )))?
                .coerce_to_number()?
                .get_double()?;
            Event::Usage {
                input: input.raw(),
                output: output.raw(),
                cached: cached.raw(),
                creation: creation.raw(),
                difference: diff,
            }
        }
    };
    transcript::updates(mapped)
        .into_iter()
        .map(|node| Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), encode(env, node)?) }))
        .collect()
}

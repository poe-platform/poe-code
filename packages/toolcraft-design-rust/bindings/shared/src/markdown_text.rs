use super::{
    string_width::{PrimitiveHost, Value},
    table::NodeHost,
};
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use toolcraft_design_rust::markdown_text;
#[napi(object)]
pub struct DesignMarkdownTextToken {
    pub kind: String,
    pub start: u32,
    pub end: u32,
}
#[napi]
pub fn design_markdown_text_tokens(value: Utf16String) -> Vec<DesignMarkdownTextToken> {
    markdown_text::tokenize(&value)
        .into_iter()
        .map(|token| DesignMarkdownTextToken {
            kind: token.kind.to_owned(),
            start: token.start as u32,
            end: token.end as u32,
        })
        .collect()
}
#[napi]
pub fn design_markdown_text_policy<'env>(
    env: Env,
    operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Unknown<'env>> {
    let args = args
        .into_iter()
        .map(Value::from_host)
        .collect::<Result<Vec<_>>>()?;
    markdown_text::run(
        &mut PrimitiveHost {
            env,
            host: NodeHost { object: host },
        },
        &operation,
        &args,
    )?
    .to_host(&env)
}

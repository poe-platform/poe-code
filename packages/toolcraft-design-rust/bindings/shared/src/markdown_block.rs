use crate::object;
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::markdown_block::{self as block, Node};
use toolcraft_design_rust::markdown_delimiter::CharacterClass;

#[napi(object)]
pub struct MarkdownClassReply {
    pub flags: u32,
    pub error: bool,
}
struct Host<'a> {
    callback: Function<'a, Utf16String, MarkdownClassReply>,
}
impl block::Host for Host<'_> {
    type Error = Error;
    fn class(&mut self, unit: Option<u16>) -> Result<CharacterClass> {
        let reply = self
            .callback
            .call(unit.into_iter().collect::<Vec<_>>().into())?;
        if reply.error {
            return Err(Error::from_reason("Markdown character host failed"));
        }
        Ok(CharacterClass {
            whitespace: reply.flags & 1 != 0,
            punctuation: reply.flags & 2 != 0,
        })
    }
    fn too_deep(&mut self) -> Error {
        Error::from_reason("Maximum call stack size exceeded")
    }
}
fn node_value(node: Node) -> Value {
    let mut fields = vec![("type", Value::String(node.kind.encode_utf16().collect()))];
    fields.extend(node.fields);
    if let Some(children) = node.children {
        fields.push((
            "children",
            Value::Array(children.into_iter().map(node_value).collect()),
        ));
    }
    fields.push((
        "range",
        object(vec![
            ("start", Value::Number(node.range[0])),
            ("end", Value::Number(node.range[1])),
        ]),
    ));
    object(fields)
}
#[napi]
pub fn design_parse_markdown_block_body(
    input: Utf16String,
    offset: f64,
    prefer_list: bool,
    callback: Function<'_, Utf16String, MarkdownClassReply>,
) -> Result<NativeJson> {
    block::parse(&input, offset, prefer_list, &mut Host { callback })
        .map(|nodes| NativeJson(Value::Array(nodes.into_iter().map(node_value).collect())))
}

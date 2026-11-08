use crate::object;
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::markdown_delimiter::CharacterClass;
use toolcraft_design_rust::markdown_parse_inline::{self as parser, Node};

#[napi(object)]
pub struct MarkdownParseReply {
    pub handle: u32,
    pub flags: u32,
    pub error: bool,
}

type Callback<'a> =
    Function<'a, FnArgs<(u32, u32, u32, u32, u32, Utf16String)>, MarkdownParseReply>;
struct Host<'a> {
    callback: Callback<'a>,
}
impl Host<'_> {
    fn call(&mut self, op: u32, args: [usize; 4], text: &[u16]) -> Result<MarkdownParseReply> {
        let reply = self.callback.call(
            (
                op,
                args[0] as u32,
                args[1] as u32,
                args[2] as u32,
                args[3] as u32,
                text.to_vec().into(),
            )
                .into(),
        )?;
        if reply.error {
            return Err(Error::from_reason("Markdown parser host failed"));
        }
        Ok(reply)
    }
}
impl parser::Host for Host<'_> {
    type Error = Error;
    fn class(&mut self, unit: Option<u16>) -> Result<CharacterClass> {
        let reply = self.call(5, [0; 4], &unit.into_iter().collect::<Vec<_>>())?;
        Ok(CharacterClass {
            whitespace: reply.flags & 1 != 0,
            punctuation: reply.flags & 2 != 0,
        })
    }
    fn range(
        &mut self,
        offsets: usize,
        start: usize,
        end: usize,
        delimiter: bool,
    ) -> Result<usize> {
        Ok(self
            .call(0, [offsets, start, end, usize::from(delimiter)], &[])?
            .handle as usize)
    }
    fn slice_offsets(
        &mut self,
        offsets: usize,
        start: usize,
        end: usize,
        source: &[u16],
    ) -> Result<usize> {
        Ok(self.call(1, [offsets, start, end, 0], source)?.handle as usize)
    }
    fn merge_ranges(&mut self, left: usize, right: usize) -> Result<usize> {
        Ok(self.call(2, [left, right, 0, 0], &[])?.handle as usize)
    }
    fn wrapper_range(
        &mut self,
        left: usize,
        right: usize,
        opener: usize,
        closer: usize,
    ) -> Result<usize> {
        Ok(self.call(3, [left, right, opener, closer], &[])?.handle as usize)
    }
    fn footnote(&mut self, label: &[u16]) -> Result<bool> {
        Ok(self.call(4, [0; 4], label)?.flags != 0)
    }
    fn too_deep(&mut self) -> Error {
        Error::from_reason("Maximum call stack size exceeded")
    }
}

fn node_value(node: Node) -> Value {
    let mut fields = vec![("type", Value::String(node.kind.encode_utf16().collect()))];
    fields.extend(
        node.fields
            .into_iter()
            .map(|(name, value)| (name, Value::String(value))),
    );
    if let Some(children) = node.children {
        fields.push((
            "children",
            Value::Array(children.into_iter().map(node_value).collect()),
        ));
    }
    fields.push(("range", Value::Number(node.range as f64)));
    object(fields)
}

#[napi]
pub fn design_parse_markdown_inline(
    input: Utf16String,
    literal: bool,
    footnotes: bool,
    callback: Callback<'_>,
) -> Result<NativeJson> {
    let mut host = Host { callback };
    parser::parse(
        &input,
        parser::Options {
            offsets: 0,
            literal,
            footnotes,
        },
        &mut host,
        0,
    )
    .map(|nodes| NativeJson(Value::Array(nodes.into_iter().map(node_value).collect())))
}

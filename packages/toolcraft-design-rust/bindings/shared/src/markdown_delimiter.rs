use crate::object;
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::markdown_delimiter::{self as delimiter, CharacterClass, Delimiter};

fn value(delimiter: Delimiter, position: bool) -> Value {
    let mut fields = vec![
        ("marker", Value::String(vec![delimiter.marker])),
        ("length", Value::Number(delimiter.length as f64)),
        ("canOpen", Value::Bool(delimiter.can_open)),
        ("canClose", Value::Bool(delimiter.can_close)),
    ];
    if position {
        fields.push(("position", Value::Number(delimiter.position as f64)));
    }
    object(fields)
}

#[napi]
pub fn design_markdown_delimiter(
    marker: Utf16String,
    length: u32,
    before: u32,
    after: u32,
) -> NativeJson {
    let class = |flags| CharacterClass {
        whitespace: flags & 1 != 0,
        punctuation: flags & 2 != 0,
    };
    NativeJson(
        delimiter::admit(
            marker.first().copied().unwrap_or(0),
            length as usize,
            class(before),
            class(after),
            0,
        )
        .map_or(Value::Null, |delimiter| value(delimiter, false)),
    )
}

#[napi(object)]
pub struct MarkdownDelimiterInput {
    pub marker: Utf16String,
    pub length: u32,
    pub can_open: bool,
    pub can_close: bool,
    pub position: u32,
}

#[napi]
pub fn design_match_markdown_delimiters(input: Vec<MarkdownDelimiterInput>) -> NativeJson {
    let mut delimiters: Vec<_> = input
        .into_iter()
        .map(|input| Delimiter {
            marker: input.marker.first().copied().unwrap_or(0),
            length: input.length as usize,
            can_open: input.can_open,
            can_close: input.can_close,
            position: input.position as usize,
        })
        .collect();
    let pairs = delimiter::match_pairs(&mut delimiters)
        .into_iter()
        .enumerate()
        .map(|(sequence, pair)| {
            object(vec![
                ("opener", Value::Number(pair.opener as f64)),
                ("closer", Value::Number(pair.closer as f64)),
                ("kind", Value::String(pair.kind.encode_utf16().collect())),
                ("sequence", Value::Number(sequence as f64)),
            ])
        })
        .collect();
    NativeJson(object(vec![
        (
            "delimiters",
            Value::Array(
                delimiters
                    .into_iter()
                    .map(|delimiter| value(delimiter, true))
                    .collect(),
            ),
        ),
        ("pairs", Value::Array(pairs)),
    ]))
}

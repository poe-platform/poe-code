use crate::object;
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::markdown_scan as scan;

fn text(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}

fn autolink(input: &[u16], link: scan::Autolink) -> Value {
    object(vec![
        (
            "node",
            object(vec![
                ("type", text("link")),
                ("url", Value::String(link.url)),
                (
                    "children",
                    Value::Array(vec![object(vec![
                        ("type", text("text")),
                        (
                            "value",
                            Value::String(input[link.text_start..link.text_end].to_vec()),
                        ),
                    ])]),
                ),
            ]),
        ),
        ("end", Value::Number(link.end as f64)),
    ])
}

// Internal lexical ingress; the public parser will attach ranges to the AST.
#[napi]
pub fn design_scan_markdown(kind: String, input: Utf16String, start: f64) -> NativeJson {
    let index = start as usize;
    let value = match kind.as_str() {
        "decodeEscapes" => Some(Value::String(scan::decode_escapes(&input))),
        "createOffsetMap" => Some(Value::Array(
            scan::offset_map(&input, start)
                .into_iter()
                .map(Value::Number)
                .collect(),
        )),
        "parseInlineCode" => scan::inline_code(&input, index).map(|code| {
            object(vec![
                (
                    "node",
                    object(vec![
                        ("type", text("inlineCode")),
                        ("value", Value::String(code.value)),
                    ]),
                ),
                ("end", Value::Number(code.end as f64)),
            ])
        }),
        "parseBracketedLabel" => scan::bracketed_label(&input, index).map(|label| {
            object(vec![
                (
                    "value",
                    Value::String(input[label.content_start..label.end - 1].to_vec()),
                ),
                ("contentStart", Value::Number(label.content_start as f64)),
                ("end", Value::Number(label.end as f64)),
            ])
        }),
        "parseLinkDestination" => scan::link_destination(&input, index).map(|destination| {
            let mut fields = vec![("url", Value::String(destination.url))];
            if let Some(title) = destination.title {
                fields.push(("title", Value::String(title)));
            }
            fields.push(("end", Value::Number(destination.end as f64)));
            object(fields)
        }),
        "parseAutolink" => scan::angle_autolink(&input, index).map(|link| autolink(&input, link)),
        "parseLiteralAutolink" => {
            scan::literal_autolink(&input, index).map(|link| autolink(&input, link))
        }
        "parseInlineHtmlTag" => scan::inline_html_end(&input, index).map(|end| {
            object(vec![
                (
                    "node",
                    object(vec![
                        ("type", text("html")),
                        ("value", Value::String(input[index..end].to_vec())),
                    ]),
                ),
                ("end", Value::Number(end as f64)),
            ])
        }),
        _ => None,
    };
    NativeJson(value.unwrap_or(Value::Null))
}

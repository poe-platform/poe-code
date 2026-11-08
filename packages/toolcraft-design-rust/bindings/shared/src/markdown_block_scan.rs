use crate::object;
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::markdown_block_scan as scan;

fn number(value: usize) -> Value {
    Value::Number(value as f64)
}
fn string(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn content(input: &[u16], start: usize) -> Vec<(&'static str, Value)> {
    vec![
        ("content", Value::String(input[start..].to_vec())),
        ("contentStart", number(start)),
    ]
}

#[napi]
pub fn design_scan_markdown_block(
    kind: String,
    input: Utf16String,
    arg_text: Utf16String,
    arg_number: f64,
    from: u32,
) -> NativeJson {
    let result = match kind.as_str() {
        "readLine" => {
            let start = arg_number as usize;
            let line = scan::read_line(&input, start);
            Some(object(vec![
                ("start", number(line.start)),
                ("text", Value::String(input[line.start..line.end].to_vec())),
                ("end", number(line.end)),
                ("nextPosition", number(line.next)),
            ]))
        }
        "readLeadingWhitespace" => {
            let (columns, offset) = scan::leading_whitespace(&input);
            Some(object(vec![
                ("columns", number(columns)),
                ("offset", number(offset)),
                ("normalized", Value::String(vec![32; columns])),
            ]))
        }
        "skipLeadingBlockIndent" => {
            Some(scan::block_indent(&input).map_or(Value::Number(-1.0), number))
        }
        "parseOpeningFence" => scan::opening_fence(&input).map(|fence| {
            let mut fields = vec![
                ("char", Value::String(vec![fence.marker])),
                ("length", number(fence.length)),
            ];
            if let Some(lang) = fence.lang {
                fields.push(("lang", Value::String(lang)));
            }
            if let Some(meta) = fence.meta {
                fields.push(("meta", Value::String(meta)));
            }
            object(fields)
        }),
        "isClosingFence" => {
            let marker = arg_text.first().copied().unwrap_or(0);
            let length = arg_number as usize;
            Some(Value::Bool(scan::closing_fence(&input, marker, length)))
        }
        "parseAtxHeadingLine" => scan::heading(&input).map(|heading| {
            object(vec![
                ("depth", number(heading.depth)),
                (
                    "text",
                    Value::String(input[heading.start..heading.end].to_vec()),
                ),
                ("contentStart", number(heading.start)),
                ("contentEnd", number(heading.end)),
            ])
        }),
        "isThematicBreakLine" => Some(Value::Bool(scan::thematic_break(&input))),
        "parseSetextUnderline" => scan::setext(&input).map(number),
        "parsePipeTableCellSegments" => scan::table_cells(&input).map(|cells| {
            Value::Array(
                cells
                    .into_iter()
                    .map(|cell| {
                        object(vec![
                            ("value", Value::String(cell.value)),
                            ("start", number(cell.start)),
                            ("end", number(cell.end)),
                        ])
                    })
                    .collect(),
            )
        }),
        "parsePipeTableSeparator" => scan::table_separator(&input).map(|align| {
            Value::Array(
                align
                    .into_iter()
                    .map(|value| value.map_or(Value::Null, string))
                    .collect(),
            )
        }),
        "parseBlockquoteLine" => {
            scan::blockquote(&input).map(|start| object(content(&input, start)))
        }
        "parseAlertMarker" => scan::alert(&input).map(|(kind, start)| {
            let mut fields = vec![("kind", string(kind))];
            fields.extend(content(&input, start));
            object(fields)
        }),
        "parseFootnoteDefinitionMarker" => scan::footnote(&input).map(|(label, start)| {
            object(vec![
                ("label", Value::String(label)),
                ("contentStart", number(start)),
            ])
        }),
        "parseBlockHtmlTagStart" => scan::html_tag(&input).map(|tag| {
            object(vec![
                ("tagName", string(tag.name)),
                ("tagEnd", number(tag.end)),
                ("closing", Value::Bool(tag.closing)),
                ("selfClosing", Value::Bool(tag.self_closing)),
            ])
        }),
        "containsClosingHtmlTag" => Some(Value::Bool(scan::contains_closing_html(
            &input,
            &arg_text,
            from as usize,
        ))),
        "parseListMarker" => scan::list_marker(&input).map(|marker| {
            let mut fields = vec![("ordered", Value::Bool(marker.ordered))];
            if let Some(start) = marker.start {
                fields.push(("start", Value::Number(start)));
            }
            fields.extend([
                ("indent", number(marker.indent)),
                ("contentIndent", number(marker.content_indent)),
                ("contentStart", number(marker.content_start)),
            ]);
            object(fields)
        }),
        "parseTaskMarker" => scan::task(&input).map(|(checked, start)| {
            let mut fields = vec![("checked", Value::Bool(checked))];
            fields.extend(content(&input, start));
            object(fields)
        }),
        _ => None,
    };
    NativeJson(result.unwrap_or(Value::Null))
}

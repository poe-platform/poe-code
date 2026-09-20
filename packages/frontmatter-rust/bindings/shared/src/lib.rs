//! Self-contained frontmatter addon embeds own YAML parsing and serialization.
pub use config_mutations_rust_napi_core::*;
use frontmatter_rust::{Inspection, inspect, line_starts};
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
fn text(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn number(value: usize) -> Value {
    Value::Number(value as f64)
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    )
}
#[napi]
pub fn frontmatter_inspect(source: Utf16String) -> NativeJson {
    let fields = match inspect(&source) {
        Inspection::Body => vec![("kind", text("body"))],
        Inspection::Missing { raw_start, raw_end } => vec![
            ("kind", text("missing-closing-fence")),
            ("rawStart", number(raw_start)),
            ("rawEnd", number(raw_end)),
        ],
        Inspection::Frontmatter {
            raw_start,
            raw_end,
            body_start,
        } => vec![
            ("kind", text("frontmatter")),
            ("rawStart", number(raw_start)),
            ("rawEnd", number(raw_end)),
            ("bodyStart", number(body_start)),
        ],
    };
    NativeJson(object(fields))
}
#[napi]
pub fn frontmatter_parse(
    source: Utf16String,
    unique_keys: bool,
    date_key: Option<Function<f64, Utf16String>>,
) -> Result<NativeJson> {
    let mut callback_error = None;
    let mut format = |epoch: i64| match date_key.as_ref().unwrap().call(epoch as f64) {
        Ok(text) => text.to_vec(),
        Err(error) => {
            callback_error = Some(error);
            vec![]
        }
    };
    let document = frontmatter_rust::parse_document(
        &source,
        unique_keys,
        if date_key.is_some() {
            Some(&mut format)
        } else {
            None
        },
    );
    if let Some(error) = callback_error {
        return Err(error);
    }
    let Value::Object(mut fields) = parsed_yaml_snapshot(document.yaml).0 else {
        unreachable!()
    };
    fields.push((
        "bodyStart".encode_utf16().collect(),
        number(document.body_start),
    ));
    fields.push((
        "lineStarts".encode_utf16().collect(),
        Value::Array(line_starts(&source).into_iter().map(number).collect()),
    ));
    fields.push((
        "errors".encode_utf16().collect(),
        Value::Array(
            document
                .errors
                .into_iter()
                .map(|error| {
                    let mut fields = vec![
                        ("message", text(&error.message)),
                        ("parseMessage", text(&error.parse_message)),
                    ];
                    if let Some((start, end)) = error.position {
                        fields.push(("pos", Value::Array(vec![number(start), number(end)])));
                    }
                    object(fields)
                })
                .collect(),
        ),
    ));
    Ok(NativeJson(Value::Object(fields)))
}

use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_stdio_mcp_server_rust::content::normalize_result;

fn value(source: &str) -> Value {
    json::parse(source.as_bytes(), Limits::default()).unwrap()
}

#[test]
fn normalizes_text_scalars_and_undefined_without_losing_utf16_units() {
    for (source, expected) in [
        (
            r#""\ud800🦀""#,
            r#"{"content":[{"type":"text","text":"\ud800🦀"}]}"#,
        ),
        ("true", r#"{"content":[{"type":"text","text":"true"}]}"#),
        ("null", r#"{"content":[{"type":"text","text":"null"}]}"#),
        ("123", r#"{"content":[{"type":"text","text":"123"}]}"#),
    ] {
        assert_eq!(
            normalize_result(Some(value(source)), false).unwrap(),
            value(expected)
        );
    }
    assert_eq!(
        normalize_result(None, false).unwrap(),
        value(r#"{"content":[]}"#)
    );
}

#[test]
fn nested_arrays_are_flattened_into_content_in_order() {
    assert_eq!(
        normalize_result(Some(value(r#"["one",[null,["two"]],[]]"#)), false).unwrap(),
        value(
            r#"{"content":[{"type":"text","text":"one"},{"type":"text","text":"null"},{"type":"text","text":"two"}]}"#
        )
    );
}

#[test]
fn json_objects_become_serialized_text_and_valid_content_is_preserved() {
    assert_eq!(
        normalize_result(Some(value(r#"{"x":1}"#)), false).unwrap(),
        value(r#"{"content":[{"type":"text","text":"{\"x\":1}"}]}"#)
    );
    assert_eq!(
        normalize_result(
            Some(value(
                r#"{"type":"text","text":"one","_meta":{"source":"test"}}"#
            )),
            false
        )
        .unwrap(),
        value(r#"{"content":[{"type":"text","text":"one","_meta":{"source":"test"}}]}"#)
    );
}

#[test]
fn explicit_call_results_are_preserved_and_invalid_content_arrays_fail() {
    let explicit = value(
        r#"{"content":[{"type":"text","text":"one"}],"isError":true,"structuredContent":{"x":1}}"#,
    );
    assert_eq!(
        normalize_result(Some(explicit.clone()), false).unwrap(),
        explicit
    );
    for source in [
        r#"{"content":[1]}"#,
        r#"{"content":[{"type":"text","text":1}]}"#,
        r#"{"content":[],"isError":1}"#,
    ] {
        assert_eq!(
            normalize_result(Some(value(source)), false).unwrap_err(),
            "Invalid tool result"
        );
    }
}

#[test]
fn all_wire_content_variants_are_preserved_in_explicit_results_and_nested_arrays() {
    for source in [
        r#"{"type":"image","data":"AA==","mimeType":"image/png"}"#,
        r#"{"type":"audio","data":"AAA=","mimeType":"audio/wav"}"#,
        r#"{"type":"resource_link","uri":"https://[::1]/asset","name":"Asset","size":12}"#,
        r#"{"type":"resource","resource":{"uri":"file:///asset","text":"hello","mimeType":"text/plain"}}"#,
        r#"{"type":"resource","resource":{"uri":"urn:asset:1","blob":"/w=="}}"#,
    ] {
        let block = value(source);
        let expected = Value::Object(vec![(
            "content".encode_utf16().collect(),
            Value::Array(vec![block.clone()]),
        )]);
        assert_eq!(
            normalize_result(Some(expected.clone()), false).unwrap(),
            expected
        );
        assert_eq!(
            normalize_result(Some(Value::Array(vec![Value::Array(vec![block])])), false).unwrap(),
            expected
        );
    }
}

#[test]
fn content_annotations_and_binary_or_uri_formats_are_validated() {
    for source in [
        r#"{"type":"text","text":"hello","annotations":null}"#,
        r#"{"type":"text","text":"hello","annotations":{"audience":["system"]}}"#,
        r#"{"type":"text","text":"hello","annotations":{"priority":"high"}}"#,
        r#"{"type":"text","text":"hello","annotations":{"lastModified":12}}"#,
        r#"{"type":"image","data":"Zh==","mimeType":"image/png"}"#,
        r#"{"type":"audio","data":"Zm9=","mimeType":"audio/wav"}"#,
        r#"{"type":"resource_link","uri":"/relative","name":"Asset"}"#,
        r#"{"type":"resource_link","uri":"https://host/","name":"Asset","size":"large"}"#,
        r#"{"type":"resource","resource":{"uri":"file:///bad%","text":"hello"}}"#,
        r#"{"type":"resource","resource":{"uri":"urn:asset:1","blob":"bad"}}"#,
    ] {
        let result = value(&format!("{{\"content\":[{source}]}}"));
        assert_eq!(
            normalize_result(Some(result), false).unwrap_err(),
            "Invalid tool result",
            "{source}"
        );
        assert_eq!(
            normalize_result(Some(value(source)), false).unwrap_err(),
            "Invalid tool result",
            "{source}"
        );
    }
    let result = value(
        r#"{"content":[{"type":"text","text":"hello","annotations":{"audience":["user","assistant"],"priority":2,"lastModified":"now"}}]}"#,
    );
    assert_eq!(
        normalize_result(Some(result.clone()), false).unwrap(),
        result
    );
}

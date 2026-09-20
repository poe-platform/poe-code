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
            normalize_result(Some(value(source))).unwrap(),
            value(expected)
        );
    }
    assert_eq!(normalize_result(None).unwrap(), value(r#"{"content":[]}"#));
}

#[test]
fn nested_arrays_are_flattened_into_content_in_order() {
    assert_eq!(
        normalize_result(Some(value(r#"["one",[null,["two"]],[]]"#))).unwrap(),
        value(
            r#"{"content":[{"type":"text","text":"one"},{"type":"text","text":"null"},{"type":"text","text":"two"}]}"#
        )
    );
}

#[test]
fn json_objects_become_serialized_text_and_valid_content_is_preserved() {
    assert_eq!(
        normalize_result(Some(value(r#"{"x":1}"#))).unwrap(),
        value(r#"{"content":[{"type":"text","text":"{\"x\":1}"}]}"#)
    );
    assert_eq!(
        normalize_result(Some(value(
            r#"{"type":"text","text":"one","_meta":{"source":"test"}}"#
        )))
        .unwrap(),
        value(r#"{"content":[{"type":"text","text":"one","_meta":{"source":"test"}}]}"#)
    );
}

#[test]
fn explicit_call_results_are_preserved_and_invalid_content_arrays_fail() {
    let explicit = value(
        r#"{"content":[{"type":"text","text":"one"}],"isError":true,"structuredContent":{"x":1}}"#,
    );
    assert_eq!(normalize_result(Some(explicit.clone())).unwrap(), explicit);
    for source in [
        r#"{"content":[1]}"#,
        r#"{"content":[{"type":"text","text":1}]}"#,
        r#"{"content":[],"isError":1}"#,
    ] {
        assert_eq!(
            normalize_result(Some(value(source))).unwrap_err(),
            "Invalid tool result"
        );
    }
}

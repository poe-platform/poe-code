use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_stdio_mcp_server_rust::headers::{self, HeaderValue};

fn value(source: &str) -> Value {
    json::parse(source.as_bytes(), Limits::default()).unwrap()
}
fn units(source: &str) -> Vec<u16> {
    source.encode_utf16().collect()
}

#[test]
fn header_codec_preserves_unicode_and_rejects_invalid_raw_and_encoded_values() {
    for text in [
        "normal",
        "Hello, 世界",
        " padded ",
        "line1\nline2",
        "=?base64?literal?=",
        "a\tb",
        "\u{feff}value",
    ] {
        let encoded = headers::encode_value(&units(text)).unwrap();
        assert_eq!(headers::decode_value(&encoded), Some(units(text)));
    }
    assert_eq!(
        headers::encode_value(&units("世界")).unwrap(),
        units("=?base64?5LiW55WM?=")
    );
    assert_eq!(
        headers::encode_value(&[0xd800]).unwrap_err(),
        "MCP header value must contain valid Unicode"
    );
    for invalid in [
        " raw",
        "raw ",
        "\n",
        "世界",
        "=?base64?YR==?=",
        "=?base64?/w==?=",
    ] {
        assert_eq!(headers::decode_value(&units(invalid)), None);
    }
    assert_eq!(
        headers::decode_value(&units("=?base64?77u/YQ==?=")),
        Some(units("\u{feff}a"))
    );
}

#[test]
fn header_schema_paths_are_static_unique_and_ignore_literal_annotations() {
    let definitions = headers::get_parameter_headers(&value(r#"{"type":"object","properties":{"tenant":{"type":"object","properties":{"id":{"type":"string","x-mcp-header":"Tenant"}}},"count":{"type":"integer","x-mcp-header":"Count"}}}"#)).unwrap();
    assert_eq!(definitions[0].name, "Mcp-Param-Tenant");
    assert_eq!(definitions[0].path, vec![units("tenant"), units("id")]);
    assert_eq!(definitions[1].name, "Mcp-Param-Count");
    assert!(
        headers::get_parameter_headers(&value(
            r#"{"type":"object","default":{"x-mcp-header":"literal"}}"#
        ))
        .unwrap()
        .is_empty()
    );
    assert_eq!(headers::get_parameter_headers(&value(r#"{"type":"object","properties":{"a":{"type":"string","x-mcp-header":"Name"},"b":{"type":"boolean","x-mcp-header":"name"}}}"#)).unwrap_err(), "Duplicate x-mcp-header name");
    assert_eq!(headers::get_parameter_headers(&value(r#"{"type":"object","oneOf":[{"properties":{"a":{"type":"string","x-mcp-header":"Name"}}}]}"#)).unwrap_err(), "Invalid x-mcp-header name or property path");
}

#[test]
fn header_validation_checks_safe_integers_and_decoded_matches_without_ignoring_missing_values() {
    let definitions = headers::get_parameter_headers(&value(r#"{"type":"object","properties":{"count":{"type":"integer","x-mcp-header":"Count"},"text":{"type":"string","x-mcp-header":"Text"},"enabled":{"type":"boolean","x-mcp-header":"Enabled"}}}"#)).unwrap();
    let args = value(r#"{"count":-7,"text":"世界","enabled":false}"#);
    let generated = headers::create_parameter_headers(&definitions, &args).unwrap();
    assert_eq!(generated.get("Mcp-Param-Count"), Some(&units("-7")));
    let actual = generated
        .into_iter()
        .map(|(name, value)| (units(&name.to_lowercase()), HeaderValue::String(value)))
        .collect();
    assert_eq!(
        headers::validate_parameter_headers(&definitions, &args, &actual),
        None
    );
    assert!(headers::validate_parameter_headers(&definitions, &value("{}"), &actual).is_some());
    assert_eq!(
        headers::create_parameter_headers(&definitions, &value(r#"{"count":9007199254740992}"#))
            .unwrap_err(),
        "Invalid value for Mcp-Param-Count"
    );
}

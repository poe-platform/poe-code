use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_stdio_mcp_server_rust::protocol::{validate_definition, validate_input_required};

fn value(source: &str) -> Value {
    json::parse(source.as_bytes(), Limits::default()).unwrap()
}

#[test]
fn normative_definitions_validate_formats_and_retry_values() {
    assert!(validate_definition(
        "InputResponses",
        &value(r#"{"reply":{"action":"accept","content":{"number":0.5}}}"#)
    ));
    assert!(!validate_definition(
        "InputResponses",
        &value(r#"{"reply":{}}"#)
    ));
    assert!(validate_definition(
        "ClientCapabilities",
        &value(r#"{"sampling":{"tools":{}}}"#)
    ));
    assert!(!validate_definition(
        "ClientCapabilities",
        &value(r#"{"extensions":{"invalid":{}}}"#)
    ));
    assert!(!validate_definition(
        "ListRootsResult",
        &value(r#"{"roots":[{"uri":"https://example.test"}]}"#)
    ));
}

#[test]
fn input_requirements_report_capability_sets_and_validate_sampling_sequences() {
    let result = value(
        r#"{"resultType":"input_required","inputRequests":{"roots":{"method":"roots/list"},"sample":{"method":"sampling/createMessage","params":{"messages":[],"maxTokens":1}}}}"#,
    );
    let error = validate_input_required("tools/call", &result, &value("{}")).unwrap_err();
    assert_eq!(error.code, -32021);
    assert_eq!(
        error.data,
        Some(value(
            r#"{"requiredCapabilities":{"roots":{},"sampling":{}}}"#
        ))
    );
    assert!(
        validate_input_required(
            "tools/call",
            &result,
            &value(r#"{"roots":{},"sampling":{}}"#)
        )
        .is_ok()
    );
    assert!(
        validate_input_required(
            "custom",
            &value(r#"{"resultType":"input_required","requestState":"opaque"}"#),
            &value("{}")
        )
        .is_err()
    );
    assert!(
        validate_input_required(
            "prompts/get",
            &value(r#"{"resultType":"input_required","requestState":"opaque"}"#),
            &value("{}")
        )
        .is_ok()
    );
    assert!(validate_input_required("tools/call", &value(r#"{"inputRequests":{"sample":{"method":"sampling/createMessage","params":{"maxTokens":1,"messages":[{"role":"assistant","content":{"type":"tool_use","id":"call","name":"echo","input":{}}}]}}}}"#), &value(r#"{"sampling":{"tools":{}}}"#)).is_err());
}

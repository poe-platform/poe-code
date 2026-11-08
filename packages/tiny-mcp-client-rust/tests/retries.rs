use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_mcp_client_rust::retries::{ResultAction, RetryState};

fn value(source: &str) -> Value {
    json::parse(source.as_bytes(), Limits::default()).unwrap()
}

#[test]
fn retry_parameters_replace_opaque_fields_and_preserve_original_arguments() {
    let mut retry = RetryState::new(
        "tools/call".into(),
        Some(value(
            r#"{"name":"tool","requestState":"old","inputResponses":{"old":{}},"arguments":{"count":7}}"#,
        )),
    );
    let input = value(
        r#"{"resultType":"input_required","requestState":"new","inputRequests":{"root":{"method":"roots/list"}}}"#,
    );
    assert!(matches!(
        retry
            .process_result(input, &value(r#"{"roots":{}}"#), &["roots/list".into()])
            .unwrap(),
        ResultAction::Inputs(_)
    ));
    retry
        .record_response(
            "root".encode_utf16().collect(),
            "roots/list",
            value(r#"{"roots":[]}"#),
        )
        .unwrap();
    assert_eq!(
        retry.next_params(),
        value(
            r#"{"name":"tool","arguments":{"count":7},"requestState":"new","inputResponses":{"root":{"roots":[]}}}"#
        )
    );
}

#[test]
fn malformed_complete_results_and_missing_subcapabilities_are_rejected() {
    let mut retry = RetryState::new("tools/list".into(), None);
    assert_eq!(
        retry
            .process_result(
                value(r#"{"resultType":"complete","tools":[]}"#),
                &value("{}"),
                &[]
            )
            .unwrap_err()
            .message,
        "MCP cache ttlMs must be a nonnegative safe integer"
    );
    let mut retry = RetryState::new("tools/call".into(), None);
    let error = retry
        .process_result(
            value(
                r#"{"resultType":"input_required","inputRequests":{"r":{"method":"roots/list"}}}"#,
            ),
            &value("{}"),
            &["roots/list".into()],
        )
        .unwrap_err();
    assert_eq!(error.code, -32021);
    assert_eq!(
        error.data,
        Some(value(r#"{"requiredCapabilities":{"roots":{}}}"#))
    );
}

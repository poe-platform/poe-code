use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_http_mcp_server_rust::body::{BodyError, ByteBudget, classify};
fn v(s: &str) -> Value {
    json::parse(s.as_bytes(), Limits::default()).unwrap()
}
#[test]
fn batches_preserve_positions_and_separate_three_message_kinds() {
    let input = v(
        r#"[{"jsonrpc":"2.0","id":1,"method":"ping"},12,{"jsonrpc":"2.0","method":"initialized"},{"jsonrpc":"2.0","id":1,"result":null},{"jsonrpc":"2.0","id":1,"result":2,"error":{}}]"#,
    );
    let out = classify(input, None).unwrap();
    assert_eq!(out.get("isBatch"), Some(&Value::Bool(true)));
    let Some(Value::Array(entries)) = out.get("entries") else {
        panic!("entries")
    };
    assert_eq!(entries.len(), 5);
    assert_eq!(entries[1], Value::Null);
    assert_eq!(entries[4], Value::Null);
    assert_eq!(out.get("kinds"), Some(&v("[1,0,2,3,0]")));
    for key in ["hasRequests", "hasNotifications", "hasResponses"] {
        assert_eq!(out.get(key), Some(&Value::Bool(true)));
    }
}
#[test]
fn invalid_single_request_preserves_id_and_modern_invalid_ids_are_null() {
    let error = classify(
        v(r#"{"jsonrpc":"2.0","id":"identity","params":null,"method":"ping"}"#),
        None,
    )
    .unwrap_err();
    assert!(matches!(
        error,
        BodyError::Message {
            id: Value::String(_),
            code: -32600,
            ..
        }
    ));
    let error=classify(v(r#"{"jsonrpc":"2.0","id":1.5,"method":"ping","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}"#),None).unwrap_err();
    assert!(
        matches!(error,BodyError::Message{id:Value::Null,message,..} if message=="Invalid Request ID")
    );
}
#[test]
fn empty_primitive_and_overlimit_batches_are_rejected() {
    for s in ["[]", "null", "false", "1", "\"body\""] {
        assert_eq!(
            classify(v(s), None).unwrap_err(),
            BodyError::Plain("Invalid Request")
        );
    }
    assert_eq!(
        classify(v("[1,2]"), Some(1.0)).unwrap_err(),
        BodyError::Plain("Batch size exceeds configured limit")
    );
}
#[test]
fn byte_budget_stays_rejected_after_overflow_and_integer_overflow() {
    let mut budget = ByteBudget::new(Some(4.0));
    assert!(budget.admit(4));
    assert!(!budget.admit(1));
    assert!(!budget.admit(0));
    let mut unlimited = ByteBudget::new(None);
    assert!(unlimited.admit(u64::MAX));
    assert!(!unlimited.admit(1));
    assert!(!unlimited.admit(0));
}

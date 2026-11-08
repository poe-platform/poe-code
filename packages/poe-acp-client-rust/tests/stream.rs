use mcp_protocol_rust::json::{self, Value};
use poe_acp_client_rust::stream::{Collector, legacy};
fn v(source: &str) -> Value {
    json::parse_utf16(
        &source.encode_utf16().collect::<Vec<_>>(),
        Default::default(),
    )
    .unwrap()
}
#[test]
fn interleaved_tools_merge_in_insertion_order_and_duplicate_start_rejects() {
    let mut collector = Collector::default();
    collector
        .push(v(
            r#"{"sessionUpdate":"tool_call_update","toolCallId":"a","status":"in_progress"}"#,
        ))
        .unwrap();
    collector
        .push(v(
            r#"{"sessionUpdate":"tool_call","toolCallId":"b","title":"Read"}"#,
        ))
        .unwrap();
    collector
        .push(v(
            r#"{"sessionUpdate":"tool_call","toolCallId":"a","title":"Write","rawInput":null}"#,
        ))
        .unwrap();
    collector.push(v(r#"{"sessionUpdate":"tool_call_update","toolCallId":"a","title":null,"status":"completed","rawOutput":null}"#)).unwrap();
    let tools = collector.tools();
    assert_eq!(
        tools,
        v(
            r#"[{"toolCallId":"a","title":"Write","rawInput":null,"status":"completed","rawOutput":null},{"toolCallId":"b","title":"Read"}]"#
        )
    );
    assert!(
        collector
            .push(v(
                r#"{"sessionUpdate":"tool_call","toolCallId":"a","title":"Again"}"#
            ))
            .is_err()
    );
}
#[test]
fn raw_update_precedence_and_legacy_validation() {
    let mut collector = Collector::default();
    collector.push(v(r#"{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"raw"},"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"usage_update"}}}"#)).unwrap();
    assert_eq!(collector.messages().len(), 1);
    assert_eq!(
        legacy(&v(r#"{"event":"tool_complete","id":"t","status":"bogus"}"#)),
        v("[]")
    );
    assert_eq!(
        legacy(&v(
            r#"{"event":"usage","inputTokens":2,"outputTokens":3,"cachedTokens":4,"costUsd":0.1}"#
        )),
        v(
            r#"[{"sessionUpdate":"usage_update","used":5,"size":9,"cost":{"amount":0.1,"currency":"USD"}}]"#
        )
    );
}
#[test]
fn stream_classification_preserves_raw_precedence_and_categories() {
    use poe_acp_client_rust::stream::classify;
    assert_eq!(
        classify(Some("agent_message_chunk"), true, Some("usage_update")),
        (false, "messages")
    );
    assert_eq!(classify(None, true, Some("usage_update")), (true, "usage"));
    assert_eq!(
        classify(None, false, Some("usage_update")),
        (false, "other")
    );
    assert_eq!(
        classify(Some("tool_call_update"), false, None),
        (false, "tools")
    );
}

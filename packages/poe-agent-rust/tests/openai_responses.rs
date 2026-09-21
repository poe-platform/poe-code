use mcp_protocol_rust::json::{self, Value};
use poe_agent_rust::openai_responses::ResponsesStream;
fn parse(text: &str) -> Value {
    json::parse(text.as_bytes(), json::Limits::default()).unwrap()
}

#[test]
fn aliases_and_streamed_arguments_override_the_final_item_snapshot() {
    let mut state = ResponsesStream::default();
    assert_eq!(state.push(&parse(r#"{"type":"response.output_item.added","item":{"type":"function_call","id":" item ","call_id":" call ","name":" tool.name "}}"#)).unwrap(),
      parse(r#"[{"type":"tool_use_delta","id":"call","name":"tool.name"}]"#));
    assert_eq!(state.push(&parse(r#"{"type":"response.function_call_arguments.delta","item_id":"item","delta":"{\"x\":1}"}"#)).unwrap(),
      parse(r#"[{"type":"tool_use_delta","id":"call","argsDelta":"{\"x\":1}"}]"#));
    assert_eq!(state.push(&parse(r#"{"type":"response.output_item.done","item":{"type":"function_call","id":"item","call_id":"call","arguments":"wrong"}}"#)).unwrap(),
      parse(r#"[{"type":"pending_tool","id":"call","name":"tool.name","raw":"{\"x\":1}"}]"#));
    state.record_tool_success();
    let terminal = state.push(&parse(r#"{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":3,"output_tokens":1}}}"#)).unwrap();
    assert_eq!(
        terminal,
        parse(
            r#"[{"type":"usage","inputTokens":3,"outputTokens":1,"cachedTokens":0,"cacheCreationTokens":0},{"type":"pending_stop","reason":"tool_use"}]"#
        )
    );
    assert!(state.terminated());
    assert_eq!(
        state
            .push(&parse(
                r#"{"type":"response.output_text.delta","delta":"late"}"#
            ))
            .unwrap(),
        Value::Array(vec![])
    );
}

#[test]
fn incomplete_limits_take_precedence_over_observed_tools() {
    let mut state = ResponsesStream::default();
    state.record_tool_success();
    assert_eq!(state.push(&parse(r#"{"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}"#)).unwrap(),
      parse(r#"[{"type":"pending_stop","reason":"max_tokens"}]"#));
}

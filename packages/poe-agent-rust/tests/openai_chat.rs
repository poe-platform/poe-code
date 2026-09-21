use mcp_protocol_rust::json::{self, Value};
use poe_agent_rust::openai_chat::ChatStream;

fn parse(text: &str) -> Value {
    json::parse_utf16(
        &text.encode_utf16().collect::<Vec<_>>(),
        json::Limits::default(),
    )
    .unwrap()
}

#[test]
fn interleaved_tools_retain_ids_order_and_exact_utf16_deltas() {
    let mut stream = ChatStream::default();
    assert_eq!(stream.push(&parse(r#"{"choices":[{"delta":{"content":"hi","tool_calls":[{"index":0,"id":" a ","function":{"name":"tool","arguments":"{\"x\":"}},{"index":1,"id":"b","function":{"name":"second","arguments":"[]"}}]}}]}"#)).unwrap(),
      parse(r#"[{"type":"text","text":"hi"},{"type":"tool_use_delta","id":"a","name":"tool","argsDelta":"{\"x\":"},{"type":"tool_use_delta","id":"b","name":"second","argsDelta":"[]"}]"#));
    stream.push(&parse(r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3.8,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":1}}}"#)).unwrap();
    assert_eq!(
        stream.finish(),
        parse(
            r#"[{"type":"pending_tool","id":"a","name":"tool","raw":"{\"x\":1}"},{"type":"pending_tool","id":"b","name":"second","raw":"[]"},{"type":"usage","inputTokens":3,"outputTokens":2,"cachedTokens":1,"cacheCreationTokens":0},{"type":"stop","reason":"tool_use"}]"#
        )
    );
}

#[test]
fn missing_ids_and_zero_usage_do_not_create_events() {
    let mut stream = ChatStream::default();
    assert_eq!(stream.push(&parse(r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"lost"}}]}}],"usage":{"prompt_tokens":-1}}"#)).unwrap(), Value::Array(vec![]));
    assert_eq!(
        stream.finish(),
        parse(r#"[{"type":"stop","reason":"end_turn"}]"#)
    );
}

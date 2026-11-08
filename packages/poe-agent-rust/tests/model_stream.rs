use poe_agent_rust::model_stream::{Collector, Outcome, ToolCall};
use poe_agent_rust::transcript::Node;
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}

#[test]
fn model_stream_correlates_deltas_and_preserves_raw_arguments_and_intent_state() {
    let mut stream = Collector::<u32>::default();
    let id = text("call");
    stream.ensure_pending(&id);
    stream.set_name(&id, Some(&text(" echo ")));
    stream.append_delta(&id, &text("{\"text\":\"owned\"}"));
    let intent = stream.pending_intent(&id).unwrap();
    assert_eq!(intent.tool, text("echo"));
    stream.mark_emitted(&id);
    assert!(stream.pending_intent(&id).is_none());
    stream.complete(
        &id,
        ToolCall {
            intent_id: text("call"),
            tool: text("echo"),
            args: 9,
            raw_arguments: None,
            intent_emitted: false,
        },
        &id,
    );
    let result = stream.finish();
    assert!(
        matches!(&result.outcomes[0], Outcome::Complete(call) if call.args == 9 && call.intent_emitted && call.raw_arguments == Some(text("{\"text\":\"owned\"}")))
    );
}

#[test]
fn model_stream_merges_selected_thinking_chunks_and_retains_payload_templates() {
    let mut stream = Collector::<u32>::default();
    stream.append_text(&text("hello "));
    stream.append_text(&text("🌍\0"));
    stream.append_thinking(text("one"), Some(text("s")));
    stream.merge_thinking(&text("two"));
    stream.append_thinking(text("three"), None);
    stream.redacted(3);
    stream.reasoning_detail(4);
    assert!(stream.usage([5, 6, 7, 8]).is_none());
    assert!(stream.stop(Some(9)).is_none());
    let result = stream.finish();
    assert_eq!(result.content, text("hello 🌍\0"));
    assert_eq!(result.thinking.len(), 2);
    assert_eq!(result.thinking[0].text, text("onetwo"));
    let Node::Object(fields) = result.template() else {
        panic!()
    };
    assert!(fields.contains(&("stopReason", Node::Opaque(9))));
    assert!(fields.contains(&("reasoningDetails", Node::Array(vec![Node::Opaque(4)]))));
}

#[test]
fn invalid_names_retire_the_requested_identity_and_incomplete_uses_are_not_outcomes() {
    let mut stream = Collector::<u32>::default();
    let id = text("call");
    stream.ensure_pending(&id);
    stream.set_name(&id, Some(&text(" echo ")));
    stream.set_name(&id, Some(&text("  ")));
    assert!(stream.pending_intent(&id).is_none());
    stream.append_delta(&id, &text("{}"));
    assert_eq!(stream.pending_intent(&id).unwrap().tool, text("echo"));
    stream.remove(&id);
    stream.ensure_pending(&id);
    stream.parse_error(&id, id.clone(), 11, 12, &id);
    assert!(
        matches!(&stream.finish().outcomes[0], Outcome::Error(error) if error.tool == text("unknown") && error.args == 11 && error.error == 12)
    );
}

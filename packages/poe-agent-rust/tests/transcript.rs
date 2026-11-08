use poe_agent_rust::transcript::{Event, Node, classify, updates};
#[test]
fn transcript_templates_keep_opaque_payload_handles_and_usage_metadata() {
    let result = updates(Event::Intent {
        id: 1,
        subsequent_id: 4,
        tool: 2,
        args: 3,
    });
    assert_eq!(result.len(), 2);
    let Node::Object(fields) = &result[0] else {
        panic!()
    };
    assert!(fields.contains(&("rawInput", Node::Opaque(3))));
    let result = updates(Event::Usage {
        input: 1,
        output: 2,
        cached: 3,
        creation: 4,
        difference: f64::NAN,
    });
    let Node::Object(fields) = &result[0] else {
        panic!()
    };
    assert!(
        matches!(fields.iter().find(|(name,_)|*name=="used"),Some((_,Node::Number(value))) if value.is_nan())
    );
    assert!(
        updates(Event::Message {
            content: 1,
            empty: true
        })
        .is_empty()
    );
}
#[test]
fn staged_event_classification_preserves_probe_order() {
    let mut probes = Vec::new();
    let kind = classify::<_, ()>(|label| {
        probes.push(label);
        Ok(label == "tool.result")
    })
    .unwrap();
    assert_eq!(kind, poe_agent_rust::transcript::Kind::Result);
    assert_eq!(probes, vec!["message.delta", "tool.intent", "tool.result"]);
}

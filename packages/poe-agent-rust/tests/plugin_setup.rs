use poe_agent_rust::plugin_setup::{McpPart, Pagination, SetupPlan, Stage, part, tool_error};
use poe_agent_rust::transcript::Node;

#[test]
fn setup_plan_orders_declarations_before_callbacks_and_follows_live_registration() {
    let mut plan = SetupPlan::default();
    for stage in [
        Stage::Tools,
        Stage::Prompt,
        Stage::Hooks,
        Stage::Setup,
        Stage::Flush,
        Stage::Dispose,
    ] {
        assert_eq!(plan.next(1), Some((0, stage)));
    }
    assert_eq!(plan.next(2), Some((1, Stage::Tools)));
    plan.skip_current();
    assert_eq!(plan.next(2), None);

    let mut plan = SetupPlan::default();
    assert_eq!(plan.next(1), Some((0, Stage::Tools)));
    assert_eq!(plan.next(0), Some((0, Stage::Prompt)));
}

#[test]
fn mcp_templates_preserve_payload_handles_and_terminal_error_policy() {
    assert_eq!(
        part(McpPart::Text(9)),
        Node::Object(vec![
            ("type", Node::String("text")),
            ("text", Node::Opaque(9))
        ])
    );
    assert_eq!(
        part(McpPart::Image {
            mime_type: 3,
            data: 4
        }),
        Node::Object(vec![
            ("type", Node::String("image")),
            ("mimeType", Node::Opaque(3)),
            ("data", Node::Opaque(4))
        ])
    );
    let Node::Object(fields) = tool_error(5) else {
        panic!()
    };
    assert!(fields.contains(&("message", Node::Opaque(5))));
    assert!(fields.contains(&("retriable", Node::Bool(false))));
}

#[test]
fn mcp_discovery_bounds_continuation_without_rejecting_the_final_page() {
    let mut pages = Pagination::default();
    for index in 0..128 {
        pages.advance();
        assert_eq!(
            pages.continuation_error(),
            if index < 127 {
                None
            } else {
                Some("exceeded the tool pagination limit (128 pages).")
            }
        );
        let cursor = index.to_string().encode_utf16().collect::<Vec<_>>();
        assert!(!pages.seen(&cursor));
        pages.record(cursor.clone());
        assert!(pages.seen(&cursor));
    }
    assert_eq!(pages.count(), 128);
}

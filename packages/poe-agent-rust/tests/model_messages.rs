use poe_agent_rust::{
    model_messages::{CopyKind, MessageHost, assistant_message, request_message},
    transcript::Node,
};
use std::collections::HashMap;
struct Host {
    fields: HashMap<&'static str, &'static str>,
    reads: Vec<String>,
}
impl MessageHost<&'static str, ()> for Host {
    fn field(&mut self, key: &'static str) -> Result<&'static str, ()> {
        self.reads.push(key.into());
        Ok(self.fields.get(key).copied().unwrap_or("undefined"))
    }
    fn undefined(&self, value: &&'static str) -> Result<bool, ()> {
        Ok(*value == "undefined")
    }
    fn tool_role(&self, value: &&'static str) -> Result<bool, ()> {
        Ok(*value == "tool")
    }
    fn copy(&mut self, kind: CopyKind, value: &'static str) -> Result<&'static str, ()> {
        self.reads.push(format!("copy:{kind:?}"));
        Ok(value)
    }
}
#[test]
fn request_layout_preserves_tool_key_order_and_short_circuit_reads() {
    let mut host = Host {
        fields: HashMap::from([
            ("role", "tool"),
            ("toolCallId", "call"),
            ("name", "echo"),
            ("content", "owned"),
        ]),
        reads: vec![],
    };
    let (message, tool) = request_message(&mut host).unwrap();
    assert!(tool);
    assert_eq!(
        message,
        Node::Object(vec![
            ("role", Node::Opaque("tool")),
            ("tool_call_id", Node::Opaque("call")),
            ("name", Node::Opaque("echo")),
            ("content", Node::Opaque("owned"))
        ])
    );
    assert_eq!(
        host.reads,
        [
            "role",
            "role",
            "toolCallId",
            "toolCallId",
            "name",
            "name",
            "content"
        ]
    );
}
#[test]
fn assistant_and_request_reasoning_copy_only_present_fields_in_order() {
    let mut host = Host {
        fields: HashMap::from([
            ("role", "assistant"),
            ("content", "owned"),
            ("thinking", "thoughts"),
            ("reasoning_details", "details"),
        ]),
        reads: vec![],
    };
    let (_, tool) = request_message(&mut host).unwrap();
    assert!(!tool);
    assert_eq!(
        host.reads,
        [
            "role",
            "role",
            "content",
            "reasoning_content",
            "reasoning",
            "thinking",
            "thinking",
            "copy:Entries",
            "redacted_thinking",
            "reasoning_details",
            "reasoning_details",
            "copy:Values"
        ]
    );
    host.fields.insert("reasoningContent", "reasoning");
    host.fields.insert("reasoningDetails", "details");
    host.reads.clear();
    let message = assistant_message(&mut host).unwrap();
    let Node::Object(fields) = message else {
        panic!("object required")
    };
    assert_eq!(
        fields.iter().map(|(key, _)| *key).collect::<Vec<_>>(),
        [
            "role",
            "content",
            "reasoning_content",
            "thinking",
            "reasoning_details"
        ]
    );
}

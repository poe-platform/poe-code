//! Model message layouts. The host performs observable property reads and ECMAScript copies.
use crate::transcript::Node;
#[derive(Debug, Clone, Copy)]
pub enum CopyKind {
    Entries,
    Values,
}
pub trait MessageHost<T, E> {
    fn field(&mut self, key: &'static str) -> Result<T, E>;
    fn undefined(&self, value: &T) -> Result<bool, E>;
    fn tool_role(&self, value: &T) -> Result<bool, E>;
    fn copy(&mut self, kind: CopyKind, value: T) -> Result<T, E>;
}
fn optional<T, E>(
    host: &mut impl MessageHost<T, E>,
    fields: &mut Vec<(&'static str, Node<T>)>,
    source: &'static str,
    target: &'static str,
    copy: Option<CopyKind>,
) -> Result<(), E> {
    let admission = host.field(source)?;
    if !host.undefined(&admission)? {
        let value = host.field(source)?;
        let value = if let Some(kind) = copy {
            host.copy(kind, value)?
        } else {
            value
        };
        fields.push((target, Node::Opaque(value)));
    }
    Ok(())
}
pub fn request_message<T, E>(host: &mut impl MessageHost<T, E>) -> Result<(Node<T>, bool), E> {
    let role = host.field("role")?;
    let tool = host.tool_role(&role)?;
    let mut fields = vec![("role", Node::Opaque(host.field("role")?))];
    if tool {
        optional(host, &mut fields, "toolCallId", "tool_call_id", None)?;
        optional(host, &mut fields, "name", "name", None)?;
        fields.push(("content", Node::Opaque(host.field("content")?)));
    } else {
        fields.push(("content", Node::Opaque(host.field("content")?)));
        for (key, kind) in [
            ("reasoning_content", None),
            ("reasoning", None),
            ("thinking", Some(CopyKind::Entries)),
            ("redacted_thinking", Some(CopyKind::Entries)),
            ("reasoning_details", Some(CopyKind::Values)),
        ] {
            optional(host, &mut fields, key, key, kind)?;
        }
    }
    Ok((Node::Object(fields), tool))
}
pub fn assistant_message<T, E>(host: &mut impl MessageHost<T, E>) -> Result<Node<T>, E> {
    let mut fields = vec![
        ("role", Node::String("assistant")),
        ("content", Node::Opaque(host.field("content")?)),
    ];
    for (source, target, kind) in [
        ("reasoningContent", "reasoning_content", None),
        ("reasoning", "reasoning", None),
        ("thinking", "thinking", Some(CopyKind::Entries)),
        (
            "redactedThinking",
            "redacted_thinking",
            Some(CopyKind::Entries),
        ),
        (
            "reasoningDetails",
            "reasoning_details",
            Some(CopyKind::Values),
        ),
    ] {
        optional(host, &mut fields, source, target, kind)?;
    }
    Ok(Node::Object(fields))
}

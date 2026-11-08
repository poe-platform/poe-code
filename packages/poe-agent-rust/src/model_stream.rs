//! Owned model stream assembly. Opaque payloads stay in the caller's GC arena.
use crate::transcript::Node;
use mcp_protocol_rust::strings::trim_ecmascript;
use std::collections::HashMap;

pub struct Thinking {
    pub text: Vec<u16>,
    pub signature: Option<Vec<u16>>,
}
pub struct ToolCall<T> {
    pub intent_id: Vec<u16>,
    pub tool: Vec<u16>,
    pub args: T,
    pub raw_arguments: Option<Vec<u16>>,
    pub intent_emitted: bool,
}
pub struct ToolError<T> {
    pub intent_id: Vec<u16>,
    pub tool: Vec<u16>,
    pub args: T,
    pub error: T,
}
pub enum Outcome<T> {
    Complete(ToolCall<T>),
    Error(ToolError<T>),
}
#[derive(Default)]
struct Pending {
    tool: Option<Vec<u16>>,
    arguments: Vec<u16>,
    emitted: bool,
}
pub struct PendingIntent {
    pub intent_id: Vec<u16>,
    pub tool: Vec<u16>,
    pub arguments: Vec<u16>,
}
pub struct Collected<T> {
    pub content: Vec<u16>,
    pub thinking: Vec<Thinking>,
    pub redacted: Vec<T>,
    pub reasoning_details: Vec<T>,
    pub outcomes: Vec<Outcome<T>>,
    pub usage: Option<[T; 4]>,
    pub stop: Option<T>,
}
impl<T> Default for Collected<T> {
    fn default() -> Self {
        Self {
            content: Vec::new(),
            thinking: Vec::new(),
            redacted: Vec::new(),
            reasoning_details: Vec::new(),
            outcomes: Vec::new(),
            usage: None,
            stop: None,
        }
    }
}
pub struct Collector<T> {
    collected: Collected<T>,
    pending: HashMap<Vec<u16>, Pending>,
}
impl<T> Default for Collector<T> {
    fn default() -> Self {
        Self {
            collected: Collected::default(),
            pending: HashMap::new(),
        }
    }
}
impl<T> Collector<T> {
    pub fn append_text(&mut self, text: &[u16]) {
        self.collected.content.extend_from_slice(text);
    }
    pub fn last_signature(&self) -> Option<&Option<Vec<u16>>> {
        self.collected.thinking.last().map(|value| &value.signature)
    }
    pub fn append_thinking(&mut self, text: Vec<u16>, signature: Option<Vec<u16>>) {
        self.collected.thinking.push(Thinking { text, signature });
    }
    pub fn merge_thinking(&mut self, text: &[u16]) {
        if let Some(last) = self.collected.thinking.last_mut() {
            last.text.extend_from_slice(text);
        }
    }
    pub fn redacted(&mut self, payload: T) {
        self.collected.redacted.push(payload);
    }
    pub fn reasoning_detail(&mut self, payload: T) {
        self.collected.reasoning_details.push(payload);
    }
    pub fn usage(&mut self, usage: [T; 4]) -> Option<[T; 4]> {
        self.collected.usage.replace(usage)
    }
    pub fn stop(&mut self, reason: Option<T>) -> Option<T> {
        std::mem::replace(&mut self.collected.stop, reason)
    }
    pub fn ensure_pending(&mut self, id: &[u16]) {
        self.pending.entry(id.to_vec()).or_default();
    }
    pub fn set_name(&mut self, id: &[u16], name: Option<&[u16]>) {
        let Some(name) = name.map(trim_ecmascript).filter(|name| !name.is_empty()) else {
            return;
        };
        if let Some(pending) = self.pending.get_mut(id) {
            pending.tool = Some(name.to_vec());
        }
    }
    pub fn append_delta(&mut self, id: &[u16], text: &[u16]) {
        if let Some(pending) = self.pending.get_mut(id) {
            pending.arguments.extend_from_slice(text);
        }
    }
    pub fn pending_intent(&self, id: &[u16]) -> Option<PendingIntent> {
        let pending = self.pending.get(id)?;
        if pending.emitted || pending.arguments.is_empty() {
            return None;
        }
        Some(PendingIntent {
            intent_id: id.to_vec(),
            tool: pending.tool.clone()?,
            arguments: pending.arguments.clone(),
        })
    }
    pub fn mark_emitted(&mut self, id: &[u16]) {
        if let Some(pending) = self.pending.get_mut(id) {
            pending.emitted = true;
        }
    }
    pub fn has_arguments(&self, id: &[u16]) -> bool {
        self.pending
            .get(id)
            .is_some_and(|pending| !pending.arguments.is_empty())
    }
    pub fn complete(&mut self, pending_id: &[u16], mut call: ToolCall<T>, retire_id: &[u16]) {
        let pending = self.pending.get(pending_id);
        call.raw_arguments = pending
            .filter(|pending| !pending.arguments.is_empty())
            .map(|pending| pending.arguments.clone())
            .or(call.raw_arguments);
        call.intent_emitted = pending.is_some_and(|pending| pending.emitted);
        self.collected.outcomes.push(Outcome::Complete(call));
        self.pending.remove(retire_id);
    }
    pub fn parse_error(
        &mut self,
        pending_id: &[u16],
        intent_id: Vec<u16>,
        args: T,
        error: T,
        retire_id: &[u16],
    ) {
        self.collected.outcomes.push(Outcome::Error(ToolError {
            intent_id,
            tool: self
                .pending
                .get(pending_id)
                .and_then(|pending| pending.tool.clone())
                .unwrap_or_else(|| "unknown".encode_utf16().collect()),
            args,
            error,
        }));
        self.pending.remove(retire_id);
    }
    pub fn remove(&mut self, id: &[u16]) {
        self.pending.remove(id);
    }
    pub fn finish(self) -> Collected<T> {
        self.collected
    }
}
impl<T> Collected<T> {
    pub fn template(self) -> Node<T> {
        use Node::{Array, Bool, Object, Opaque, String, Utf16};
        let mut fields = vec![("content", Utf16(self.content))];
        if !self.thinking.is_empty() {
            let reasoning = self
                .thinking
                .iter()
                .flat_map(|chunk| chunk.text.iter().copied())
                .collect::<Vec<_>>();
            fields.push(("reasoningContent", Utf16(reasoning.clone())));
            fields.push(("reasoning", Utf16(reasoning)));
            fields.push((
                "thinking",
                Array(
                    self.thinking
                        .into_iter()
                        .map(|chunk| {
                            let mut fields = vec![("text", Utf16(chunk.text))];
                            if let Some(signature) = chunk.signature {
                                fields.push(("signature", Utf16(signature)));
                            }
                            Object(fields)
                        })
                        .collect(),
                ),
            ));
        }
        if !self.redacted.is_empty() {
            fields.push((
                "redactedThinking",
                Array(
                    self.redacted
                        .into_iter()
                        .map(|value| Object(vec![("data", Opaque(value))]))
                        .collect(),
                ),
            ));
        }
        if !self.reasoning_details.is_empty() {
            fields.push((
                "reasoningDetails",
                Array(self.reasoning_details.into_iter().map(Opaque).collect()),
            ));
        }
        fields.push((
            "toolOutcomes",
            Array(
                self.outcomes
                    .into_iter()
                    .map(|outcome| match outcome {
                        Outcome::Complete(call) => {
                            let mut fields = vec![
                                ("intentId", Utf16(call.intent_id)),
                                ("tool", Utf16(call.tool)),
                                ("args", Opaque(call.args)),
                            ];
                            fields.push((
                                "rawArguments",
                                call.raw_arguments.map_or(Node::Undefined, Utf16),
                            ));
                            fields.push(("intentEmitted", Bool(call.intent_emitted)));
                            Object(vec![
                                ("type", String("complete")),
                                ("toolCall", Object(fields)),
                            ])
                        }
                        Outcome::Error(error) => Object(vec![
                            ("type", String("error")),
                            (
                                "error",
                                Object(vec![
                                    ("intentId", Utf16(error.intent_id)),
                                    ("tool", Utf16(error.tool)),
                                    ("args", Opaque(error.args)),
                                    ("error", Opaque(error.error)),
                                ]),
                            ),
                        ]),
                    })
                    .collect(),
            ),
        ));
        if let Some(usage) = self.usage {
            fields.push((
                "usage",
                Object(
                    [
                        "inputTokens",
                        "outputTokens",
                        "cachedTokens",
                        "cacheCreationTokens",
                    ]
                    .into_iter()
                    .zip(usage)
                    .map(|(key, value)| (key, Opaque(value)))
                    .collect(),
                ),
            ));
        }
        if let Some(stop) = self.stop {
            fields.push(("stopReason", Opaque(stop)));
        }
        Object(fields)
    }
}

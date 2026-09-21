//! Setup sequencing and bounded MCP discovery, independent of host callbacks/I/O.
use crate::transcript::Node;
use std::collections::HashSet;
use std::hash::Hash;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Stage {
    #[default]
    Tools,
    Prompt,
    Hooks,
    Setup,
    Flush,
    Dispose,
}
#[derive(Default)]
pub struct SetupPlan {
    index: usize,
    stage: Option<Stage>,
    started: bool,
}
impl SetupPlan {
    pub fn next(&mut self, count: usize) -> Option<(usize, Stage)> {
        if !self.started {
            self.started = true;
            self.stage = Some(Stage::Tools);
        } else if self.stage.is_none() {
            self.index += 1;
            self.stage = Some(Stage::Tools);
        }
        if self.index >= count && self.stage == Some(Stage::Tools) {
            return None;
        }
        let stage = self.stage?;
        self.stage = match stage {
            Stage::Tools => Some(Stage::Prompt),
            Stage::Prompt => Some(Stage::Hooks),
            Stage::Hooks => Some(Stage::Setup),
            Stage::Setup => Some(Stage::Flush),
            Stage::Flush => Some(Stage::Dispose),
            Stage::Dispose => None,
        };
        Some((self.index, stage))
    }
    pub fn skip_current(&mut self) {
        self.stage = None;
    }
}

pub struct Pagination<T = Vec<u16>> {
    pages: usize,
    seen: HashSet<T>,
}
impl<T> Default for Pagination<T> {
    fn default() -> Self {
        Self {
            pages: 0,
            seen: HashSet::new(),
        }
    }
}
impl<T: Eq + Hash> Pagination<T> {
    pub fn advance(&mut self) {
        self.pages += 1;
    }
    pub fn count(&self) -> usize {
        self.pages
    }
    pub fn seen(&self, cursor: &T) -> bool {
        self.seen.contains(cursor)
    }
    pub fn record(&mut self, cursor: T) {
        self.seen.insert(cursor);
    }
    pub fn continuation_error(&self) -> Option<&'static str> {
        (self.pages >= 128).then_some("exceeded the tool pagination limit (128 pages).")
    }
}
pub fn discovery_error(name: &[u16], repeated: bool) -> Vec<u16> {
    "MCP server \""
        .encode_utf16()
        .chain(name.iter().copied())
        .chain(
            if repeated {
                "\" returned a repeated pagination cursor."
            } else {
                "\" exceeded the tool pagination limit (128 pages)."
            }
            .encode_utf16(),
        )
        .collect()
}

pub enum McpPart<T> {
    Text(T),
    Image { mime_type: T, data: T },
}
pub fn part<T>(part: McpPart<T>) -> Node<T> {
    match part {
        McpPart::Text(text) => Node::Object(vec![
            ("type", Node::String("text")),
            ("text", Node::Opaque(text)),
        ]),
        McpPart::Image { mime_type, data } => Node::Object(vec![
            ("type", Node::String("image")),
            ("mimeType", Node::Opaque(mime_type)),
            ("data", Node::Opaque(data)),
        ]),
    }
}
pub fn tool_error<T>(message: T) -> Node<T> {
    Node::Object(vec![
        ("type", Node::String("error")),
        ("code", Node::String("mcp_tool_error")),
        ("message", Node::Opaque(message)),
        ("retriable", Node::Bool(false)),
    ])
}

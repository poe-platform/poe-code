//! Agent host state; callbacks and async invocations are supplied by the binding host.
use crate::transcript::Node;
#[derive(Default)]
pub struct InvocationState {
    closing: bool,
}
impl InvocationState {
    pub fn begin_close(&mut self) -> bool {
        if self.closing {
            return false;
        }
        self.closing = true;
        true
    }
}
#[derive(Default)]
pub struct HostState {
    sequence: f64,
}
impl HostState {
    pub fn next_fork(&mut self) -> f64 {
        self.sequence += 1.0;
        self.sequence
    }
}
#[derive(Default)]
pub struct SpawnOutput {
    content: Vec<u16>,
}
impl SpawnOutput {
    pub fn append(&mut self, text: &[u16]) {
        self.content.extend_from_slice(text);
    }
    pub fn finish(self) -> Vec<u16> {
        self.content
    }
}
pub enum ToolYield<T> {
    Delta(T),
    Progress(T),
}
impl<T> ToolYield<T> {
    pub fn template(self) -> Node<T> {
        match self {
            Self::Delta(content) => Node::Object(vec![
                ("type", Node::String("message.delta")),
                ("content", Node::Opaque(content)),
            ]),
            Self::Progress(message) => Node::Object(vec![
                ("type", Node::String("progress")),
                ("message", Node::Opaque(message)),
            ]),
        }
    }
}

/// Identity and terminal state for the in-memory ACP transport.
#[derive(Default)]
pub struct MemoryTransport {
    closed: bool,
    sequence: u32,
}
impl MemoryTransport {
    pub fn closed(&self) -> bool {
        self.closed
    }
    pub fn begin_close(&mut self) -> bool {
        if self.closed {
            return false;
        }
        self.closed = true;
        true
    }
    pub fn next_session(&mut self) -> Result<u32, &'static str> {
        if self.closed {
            return Err("In-memory ACP transport is disposed.");
        }
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or("In-memory ACP session identity overflow.")?;
        Ok(self.sequence)
    }
}

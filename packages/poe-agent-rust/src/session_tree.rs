//! Owned branch identity lookup and bounded acyclic history traversal.
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
pub struct Branch<'a> {
    indices: HashMap<Cow<'a, [u16]>, usize>,
    visited: HashSet<usize>,
}
impl<'a> Branch<'a> {
    pub fn new(names: Vec<Vec<u16>>) -> Self {
        Self {
            indices: names
                .into_iter()
                .enumerate()
                .map(|(index, name)| (Cow::Owned(name), index))
                .collect(),
            visited: HashSet::new(),
        }
    }
    pub fn borrowed(names: impl IntoIterator<Item = &'a [u16]>) -> Self {
        Self {
            indices: names
                .into_iter()
                .enumerate()
                .map(|(index, name)| (Cow::Borrowed(name), index))
                .collect(),
            visited: HashSet::new(),
        }
    }
    pub fn find(&mut self, name: &[u16]) -> Result<Option<usize>, &'static str> {
        let index = self.indices.get(name).copied();
        if let Some(index) = index
            && !self.visited.insert(index)
        {
            return Err("Session parent cycle detected.");
        }
        Ok(index)
    }
}
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Ignored,
    User,
    Assistant,
    ToolCall,
    ToolResult,
    Compaction,
}
pub fn classify<E>(mut equal: impl FnMut(&str) -> Result<bool, E>) -> Result<Kind, E> {
    for (label, kind) in [
        ("user", Kind::User),
        ("assistant", Kind::Assistant),
        ("tool_call", Kind::ToolCall),
        ("tool_result", Kind::ToolResult),
        ("compaction", Kind::Compaction),
    ] {
        if equal(label)? {
            return Ok(kind);
        }
    }
    Ok(Kind::Ignored)
}

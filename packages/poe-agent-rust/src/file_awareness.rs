//! Ordered, owned file-awareness sets; hosts supply platform path resolution.
use mcp_protocol_rust::strings::trim_ecmascript;
use std::{collections::HashSet, sync::Arc};
#[derive(Default)]
pub struct Tracker {
    read: Vec<Arc<[u16]>>,
    modified: Vec<Arc<[u16]>>,
    read_seen: HashSet<Arc<[u16]>>,
    modified_seen: HashSet<Arc<[u16]>>,
}
pub struct Snapshot {
    pub read: Vec<Vec<u16>>,
    pub modified: Vec<Vec<u16>>,
}
impl Tracker {
    pub fn read(&mut self, path: &[u16]) {
        if !self.read_seen.contains(path) {
            let path: Arc<[u16]> = Arc::from(path);
            self.read_seen.insert(Arc::clone(&path));
            self.read.push(path);
        }
    }
    pub fn write(&mut self, path: &[u16]) {
        if !self.modified_seen.contains(path) {
            let path: Arc<[u16]> = Arc::from(path);
            self.modified_seen.insert(Arc::clone(&path));
            self.modified.push(path);
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            read: self.read.iter().map(|path| path.to_vec()).collect(),
            modified: self.modified.iter().map(|path| path.to_vec()).collect(),
        }
    }
}
#[derive(Debug, PartialEq)]
pub enum Effect {
    Ignore,
    Read,
    Write,
    Edit,
}
pub fn path_allowed(path: &[u16]) -> bool {
    !trim_ecmascript(path).is_empty()
}
pub fn tool_effect(tool: &[u16]) -> Effect {
    if tool.iter().copied().eq("read_file".encode_utf16()) {
        Effect::Read
    } else if tool.iter().copied().eq("write_file".encode_utf16()) {
        Effect::Write
    } else if tool.iter().copied().eq("edit".encode_utf16()) {
        Effect::Edit
    } else {
        Effect::Ignore
    }
}

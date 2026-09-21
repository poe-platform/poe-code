//! Independent provider and agent runtime policies; host handles never enter this core.
use mcp_protocol_rust::strings::trim_ecmascript;
pub mod session;
use std::collections::HashMap;
#[derive(Debug, PartialEq)]
pub struct Collision {
    pub name: Vec<u16>,
    pub entries: Vec<Vec<u16>>,
}
#[derive(Default)]
pub struct Registry {
    entries: HashMap<Vec<u16>, Vec<u16>>,
}
impl Registry {
    pub fn register(&mut self, name: Vec<u16>, entry: Vec<u16>) -> Option<Collision> {
        if let Some(old) = self.entries.get(&name) {
            return Some(Collision {
                name,
                entries: vec![old.clone(), entry],
            });
        }
        self.entries.insert(name, entry);
        None
    }
}
#[derive(Default)]
pub struct Resolution {
    index: usize,
    active: bool,
    done: bool,
}
impl Resolution {
    pub fn begin(&mut self, count: usize) -> Result<Option<usize>, String> {
        if self.active {
            return Err("Provider resolution already has an active check.".into());
        }
        if self.done || self.index >= count {
            self.done = true;
            return Ok(None);
        }
        self.active = true;
        Ok(Some(self.index))
    }
    pub fn finish(&mut self, supported: bool) -> Result<Option<usize>, String> {
        if !self.active {
            return Err("Provider resolution has no active check.".into());
        }
        self.active = false;
        let index = self.index;
        self.index += 1;
        if supported {
            self.done = true;
            Ok(Some(index))
        } else {
            Ok(None)
        }
    }
}
pub fn valid_tool_name(name: &[u16]) -> bool {
    !name.is_empty()
        && name
            .iter()
            .all(|value| matches!(*value,65..=90|97..=122|48..=57|95|45))
}
pub fn safe_session_id(id: &[u16]) -> bool {
    !trim_ecmascript(id).is_empty()
        && id != [46]
        && id != [46, 46]
        && !id.contains(&47)
        && !id.contains(&92)
}
fn append(value: &mut Vec<u16>, text: &str) {
    value.extend(text.encode_utf16());
}
fn joined(entries: &[Vec<u16>]) -> Vec<u16> {
    let mut result = vec![];
    for (index, entry) in entries.iter().enumerate() {
        if index > 0 {
            append(&mut result, ", ");
        }
        result.extend(entry);
    }
    result
}
pub fn provider_error(model: &[u16], providers: &[Vec<u16>], provider: Option<&[u16]>) -> Vec<u16> {
    let mut value = vec![];
    if let Some(provider) = provider {
        append(&mut value, "Provider \"");
        value.extend(provider);
        append(&mut value, "\" failed while resolving model \"");
    } else {
        append(&mut value, "No provider supports model \"");
    }
    value.extend(model);
    append(&mut value, "\". Registered providers: ");
    if providers.is_empty() {
        append(&mut value, "(none)");
    } else {
        value.extend(joined(providers));
    }
    append(&mut value, ".");
    value
}
pub fn duplicate_error(name: &[u16], entries: &[Vec<u16>]) -> Vec<u16> {
    let mut value = vec![];
    append(&mut value, "Provider name collision: \"");
    value.extend(name);
    append(&mut value, "\" is already registered by ");
    value.extend(joined(entries));
    append(&mut value, ".");
    value
}
pub fn tool_error(name: &[u16], contributor: Option<&[u16]>) -> Vec<u16> {
    let mut value = vec![];
    append(&mut value, "Invalid tool name \"");
    value.extend(name);
    append(&mut value, "\"");
    if let Some(contributor) = contributor {
        append(&mut value, " from ");
        value.extend(contributor);
    }
    append(&mut value, ". Tool names must match /^[a-zA-Z0-9_-]+$/.");
    value
}
pub fn session_error(id: &[u16]) -> Vec<u16> {
    let mut value = vec![];
    append(&mut value, "Invalid poe-agent session id: ");
    value.extend(id);
    value
}

pub mod session_log;

pub mod tools;

pub mod config;

pub mod file_awareness;

pub mod hooks;

pub mod prompts;

pub mod run_context;

pub mod tool_results;

pub mod session_tree;

pub mod transcript;

pub mod plugin_setup;

pub mod model_stream;

pub mod execution;

pub mod model_messages;

pub mod agent_host;

pub mod builtin_plugins;

pub mod context_plugins;

pub mod file_tools;
pub mod openai_policy;

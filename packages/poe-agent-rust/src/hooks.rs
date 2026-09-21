//! Hook callback ordering and staged decision admission; opaque host values stay outside Rust.
pub const EVENTS: [&str; 10] = [
    "sessionStart",
    "userPromptSubmit",
    "preToolUse",
    "postToolUse",
    "preIteration",
    "postIteration",
    "preCompaction",
    "postCompaction",
    "notification",
    "stop",
];
#[derive(Default)]
pub struct Catalog {
    entries: [Vec<u32>; 10],
}
impl Catalog {
    pub fn add(&mut self, event: &str, handle: u32) {
        if let Some(index) = EVENTS.iter().position(|name| *name == event) {
            self.entries[index].push(handle);
        }
    }
    pub fn get(&self, event: &str, index: usize) -> Option<u32> {
        EVENTS
            .iter()
            .position(|name| *name == event)
            .and_then(|event| self.entries[event].get(index).copied())
    }
    pub fn snapshot(&self) -> Vec<Vec<u32>> {
        self.entries.to_vec()
    }
    pub fn append(&mut self, entries: Vec<Vec<u32>>, offset: u32) -> Result<(), &'static str> {
        if entries.len() != EVENTS.len() {
            return Err("Invalid hook catalog snapshot");
        }
        let entries = entries
            .into_iter()
            .map(|entries| {
                entries
                    .into_iter()
                    .map(|entry| {
                        entry
                            .checked_add(offset)
                            .ok_or("Hook callback capacity exceeded")
                    })
                    .collect::<Result<Vec<_>, _>>()
            })
            .collect::<Result<Vec<_>, _>>()?;
        for (target, entries) in self.entries.iter_mut().zip(entries) {
            target.extend(entries);
        }
        Ok(())
    }
}
#[derive(Default)]
pub struct Pipeline {
    decided: bool,
}
impl Pipeline {
    pub fn observe(&mut self, defined: bool) -> bool {
        if !self.decided && defined {
            self.decided = true;
            true
        } else {
            false
        }
    }
}
pub enum Primitive {
    Undefined,
    Skip,
    Abort,
    Object,
    Other,
}
pub struct Plan {
    state: &'static str,
}
impl Plan {
    pub fn new(event: &str, primitive: Primitive) -> Self {
        let state = match primitive {
            Primitive::Undefined => "continue",
            Primitive::Abort => "abort",
            Primitive::Skip
                if [
                    "preToolUse",
                    "preIteration",
                    "preCompaction",
                    "notification",
                ]
                .contains(&event) =>
            {
                "skip"
            }
            Primitive::Object => match event {
                "preToolUse" => "reject-string",
                "postToolUse" => "replace-object",
                "userPromptSubmit" => "action-transform",
                _ => "continue",
            },
            _ => "continue",
        };
        Self { state }
    }
    pub fn request(&self) -> &'static str {
        self.state
    }
    pub fn observe(&mut self, accepted: bool) {
        self.state = match (self.state, accepted) {
            ("reject-string", true) => "legacy",
            ("reject-string", false) => "block-true",
            ("block-true", true) => "reason-string",
            ("block-true", false) => "rewrite-object",
            ("reason-string", true) => "block",
            ("reason-string", false) => "rewrite-object",
            ("rewrite-object", true) => "rewrite-nonnull",
            ("rewrite-nonnull", true) => "rewrite-args",
            ("rewrite-args", true) => "rewrite",
            ("replace-object", true) => "replace-nonnull",
            ("replace-nonnull", true) => "replace",
            ("action-transform", true) | ("action-handled", true) => "action-result",
            ("action-transform", false) => "action-handled",
            ("action-result", true) => "transform",
            ("action-result", false) => "handled",
            _ => "continue",
        };
    }
}

#[derive(Default)]
pub struct Warnings {
    events: std::collections::HashSet<String>,
}
impl Warnings {
    pub fn mark(&mut self, event: &str) -> bool {
        self.events.insert(event.to_owned())
    }
}

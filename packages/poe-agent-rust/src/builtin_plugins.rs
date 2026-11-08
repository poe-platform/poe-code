//! Built-in plugin state and pure validation/formatting; host effects stay in Node.
use std::collections::{HashMap, HashSet};
#[derive(Default)]
pub struct Scratchpad {
    notes: HashMap<Vec<u16>, Vec<u16>>,
}
impl Scratchpad {
    pub fn write(&mut self, key: Vec<u16>, value: Vec<u16>) {
        self.notes.insert(key, value);
    }
    pub fn read(&self, key: &[u16]) -> Option<&[u16]> {
        self.notes.get(key).map(Vec::as_slice)
    }
}
#[derive(Default)]
pub struct StringSet {
    seen: HashSet<Vec<u16>>,
}
impl StringSet {
    pub fn admit(&mut self, value: Vec<u16>) -> bool {
        !value.is_empty() && self.seen.insert(value)
    }
}
struct Skill {
    tools: Vec<Vec<u16>>,
    tags: Vec<Vec<u16>>,
}
#[derive(Default)]
pub struct SkillCatalog {
    definitions: HashMap<Vec<u16>, Skill>,
}
fn add(out: &mut Vec<u16>, text: &str) {
    out.extend(text.encode_utf16());
}
fn join(values: &[Vec<u16>], separator: &str) -> Vec<u16> {
    let mut out = Vec::new();
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            add(&mut out, separator);
        }
        out.extend(value);
    }
    out
}
impl SkillCatalog {
    pub fn contains(&self, name: &[u16]) -> bool {
        self.definitions.contains_key(name)
    }
    pub fn insert(&mut self, name: Vec<u16>, tools: Vec<Vec<u16>>, tags: Vec<Vec<u16>>) {
        self.definitions.insert(name, Skill { tools, tags });
    }
    pub fn guidance_lines(&self, active: &[Vec<u16>]) -> Option<Vec<Vec<u16>>> {
        let active = active
            .iter()
            .filter_map(|name| {
                self.definitions
                    .get(name.as_slice())
                    .map(|skill| (name, skill))
            })
            .collect::<Vec<_>>();
        if active.is_empty() {
            return None;
        }
        let mut header = "Active skills: ".encode_utf16().collect::<Vec<_>>();
        header.extend(join(
            &active
                .iter()
                .map(|(name, _)| (*name).clone())
                .collect::<Vec<_>>(),
            ", ",
        ));
        let mut lines = vec![header];
        for (name, skill) in active {
            let mut details = Vec::new();
            for (label, values) in [("tools: ", &skill.tools), ("tags: ", &skill.tags)] {
                if !values.is_empty() {
                    let mut detail = label.encode_utf16().collect::<Vec<_>>();
                    detail.extend(join(values, ", "));
                    details.push(detail);
                }
            }
            if !details.is_empty() {
                let mut line = utf("- ");
                line.extend(name);
                add(&mut line, ": ");
                line.extend(join(&details, " | "));
                lines.push(line);
            }
        }
        Some(lines)
    }
}
fn utf(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
pub fn finish_guidance(mut lines: Vec<Vec<u16>>, available: Option<Vec<u16>>) -> Vec<u16> {
    if let Some(available) = available {
        let mut line = utf("Available skill tools for this run: ");
        line.extend(available);
        lines.push(line);
    }
    lines.push(utf(
        "Use active-skill tools when they directly help with the current task.",
    ));
    join(&lines, "\n")
}
#[derive(Clone, Copy)]
pub enum ArgumentKind {
    RequiredString,
    OptionalString,
    Boolean,
    Number,
    NonNegativeInteger,
}
pub fn argument_failure(
    kind: ArgumentKind,
    matches_type: bool,
    number: Option<f64>,
    empty: bool,
) -> Option<&'static str> {
    match kind {
        ArgumentKind::RequiredString | ArgumentKind::OptionalString if !matches_type => {
            Some("must be a string")
        }
        ArgumentKind::RequiredString if empty => Some("must not be empty"),
        ArgumentKind::Boolean if !matches_type => Some("must be a boolean"),
        ArgumentKind::Number if !matches_type => Some("must be a finite number"),
        ArgumentKind::Number if number.is_none_or(|value| !value.is_finite()) => {
            Some("must be a finite number")
        }
        ArgumentKind::NonNegativeInteger
            if !matches_type
                || number.is_none_or(|value| {
                    !value.is_finite() || value.fract() != 0.0 || value < 0.0
                }) =>
        {
            Some("must be a non-negative integer")
        }
        _ => None,
    }
}
pub fn argument_message(key: &[u16], failure: &str) -> Vec<u16> {
    let mut out = utf("Tool argument \"");
    out.extend(key);
    add(&mut out, "\" ");
    add(&mut out, failure);
    out
}
pub fn policy_failure(tool: &[u16], mode: &[u16], missing: bool) -> Vec<u16> {
    let mut out = utf("Tool \"");
    out.extend(tool);
    add(
        &mut out,
        if missing {
            "\" does not declare policy metadata and is blocked in "
        } else {
            "\" is not allowed in "
        },
    );
    out.extend(mode);
    add(&mut out, " mode.");
    out
}
pub fn iteration_exceeded(iteration: f64, limit: f64) -> bool {
    iteration > limit
}

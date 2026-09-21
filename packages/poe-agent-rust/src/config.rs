//! Immutable configuration policies and an iterative, lazy dependency planner.
use mcp_protocol_rust::strings::trim_ecmascript;
use std::collections::{HashMap, HashSet};
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn message(parts: &[&[u16]]) -> Vec<u16> {
    parts.concat()
}
pub fn normalize_name(value: &[u16], label: &[u16]) -> Result<Vec<u16>, Vec<u16>> {
    let value = trim_ecmascript(value);
    if value.is_empty() {
        Err(message(&[
            label,
            &text(" name must be a non-empty string."),
        ]))
    } else {
        Ok(value.to_vec())
    }
}
pub fn dependencies(values: Vec<Vec<u16>>) -> Vec<Vec<u16>> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter_map(|value| {
            let value = trim_ecmascript(&value).to_vec();
            (!value.is_empty() && seen.insert(value.clone())).then_some(value)
        })
        .collect()
}
struct Frame {
    index: usize,
    dependencies: Vec<Vec<u16>>,
    next: usize,
}
#[derive(Default)]
pub struct Graph {
    names: Vec<Vec<u16>>,
    indices: HashMap<Vec<u16>, usize>,
    states: Vec<u8>,
    stack: Vec<Frame>,
    ordered: Vec<u32>,
    started: bool,
}
impl Graph {
    pub fn add(&mut self, name: Vec<u16>) -> Result<u32, Vec<u16>> {
        if self.started {
            return Err(text("Invalid plugin dependency planner state."));
        }
        let name = normalize_name(&name, &text("Plugin"))?;
        if self.indices.contains_key(&name) {
            return Err(message(&[
                &text("Duplicate plugin name \""),
                &name,
                &text("\"."),
            ]));
        }
        let index = self.names.len();
        self.indices.insert(name.clone(), index);
        self.names.push(name);
        self.states.push(0);
        Ok(index as u32)
    }
    pub fn begin(&mut self, name: &[u16]) -> Result<Option<u32>, Vec<u16>> {
        if !self.stack.is_empty() {
            return Err(text("Invalid plugin dependency planner state."));
        }
        self.started = true;
        let name = normalize_name(name, &text("Plugin"))?;
        let Some(index) = self.indices.get(&name).copied() else {
            return Err(message(&[&text("Unknown plugin \""), &name, &text("\".")]));
        };
        self.enter(index)
    }
    fn enter(&mut self, index: usize) -> Result<Option<u32>, Vec<u16>> {
        match self.states[index] {
            2 => Ok(None),
            1 => {
                let start = self
                    .stack
                    .iter()
                    .position(|frame| frame.index == index)
                    .unwrap_or(0);
                let mut cycle = text("Circular plugin dependencies detected: \"");
                for frame in &self.stack[start..] {
                    cycle.extend(&self.names[frame.index]);
                    cycle.extend(text("\" -> \""));
                }
                cycle.extend(&self.names[index]);
                cycle.extend(text("\"."));
                Err(cycle)
            }
            _ => {
                self.states[index] = 1;
                self.stack.push(Frame {
                    index,
                    dependencies: vec![],
                    next: 0,
                });
                Ok(Some(index as u32))
            }
        }
    }
    pub fn load(&mut self, values: Vec<Vec<u16>>) -> Result<Option<u32>, Vec<u16>> {
        let Some(frame) = self.stack.last_mut() else {
            return Err(text("Invalid plugin dependency planner state."));
        };
        frame.dependencies = dependencies(values);
        while let Some(frame) = self.stack.last_mut() {
            if frame.next == frame.dependencies.len() {
                let frame = self.stack.pop().unwrap();
                self.states[frame.index] = 2;
                self.ordered.push(frame.index as u32);
                continue;
            }
            let name = frame.dependencies[frame.next].clone();
            frame.next += 1;
            let parent = frame.index;
            if name == self.names[parent] {
                return Err(message(&[
                    &text("Plugin \""),
                    &name,
                    &text("\" cannot depend on itself."),
                ]));
            }
            let Some(index) = self.indices.get(&name).copied() else {
                return Err(message(&[
                    &text("Unknown plugin dependency \""),
                    &name,
                    &text("\" for plugin \""),
                    &self.names[parent],
                    &text("\"."),
                ]));
            };
            if let Some(effect) = self.enter(index)? {
                return Ok(Some(effect));
            }
        }
        Ok(None)
    }
    pub fn order(&self) -> &[u32] {
        &self.ordered
    }
}

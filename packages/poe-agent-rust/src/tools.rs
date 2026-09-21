//! Tool indexing, selector normalization and visibility policies.
use mcp_protocol_rust::strings::trim_ecmascript;
use std::collections::{HashMap, HashSet};
#[derive(Default)]
pub struct ToolCatalog {
    indices: HashMap<Vec<u16>, usize>,
    names: Vec<Vec<u16>>,
}
impl ToolCatalog {
    pub fn get(&self, name: &[u16]) -> Option<usize> {
        self.indices.get(trim_ecmascript(name)).copied()
    }
    pub fn upsert(&mut self, name: Vec<u16>) -> usize {
        if let Some(index) = self.indices.get(&name) {
            return *index;
        }
        let index = self.names.len();
        self.indices.insert(name.clone(), index);
        self.names.push(name);
        index
    }
    pub fn len(&self) -> usize {
        self.names.len()
    }
    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }
    pub fn active(&self, visibility: &[Visibility], skills: &[Vec<u16>]) -> Vec<usize> {
        let skills = active_skills(skills);
        self.names
            .iter()
            .enumerate()
            .filter_map(|(index, name)| {
                visible(
                    name,
                    visibility.get(index).copied().unwrap_or(Visibility::Skill),
                    &skills,
                )
                .then_some(index)
            })
            .collect()
    }
}
#[derive(Clone, Copy)]
pub enum Visibility {
    Model,
    Internal,
    Skill,
}
pub fn active_skills(values: &[Vec<u16>]) -> Vec<Vec<u16>> {
    let mut seen = HashSet::new();
    let mut result = vec![];
    for value in values {
        let value = trim_ecmascript(value);
        if !value.is_empty() && seen.insert(value.to_vec()) {
            result.push(value.to_vec());
        }
    }
    result
}
pub fn visible(name: &[u16], visibility: Visibility, skills: &[Vec<u16>]) -> bool {
    match visibility {
        Visibility::Model => true,
        Visibility::Internal => false,
        Visibility::Skill => skills.iter().any(|skill| {
            if skill == name {
                return true;
            }
            let namespace = if skill.ends_with(&[46, 42]) {
                trim_ecmascript(&skill[..skill.len() - 2])
            } else {
                skill.as_slice()
            };
            !namespace.is_empty()
                && name.starts_with(namespace)
                && matches!(name.get(namespace.len()), Some(46 | 95))
        }),
    }
}

#[derive(Clone, Copy)]
pub enum RuntimeErrorKind {
    Tool,
    Setup,
    Prompt,
}
pub fn runtime_error(kind: RuntimeErrorKind, name: &[u16]) -> Vec<u16> {
    let (prefix, suffix) = match kind {
        RuntimeErrorKind::Tool => ("Tool name collision: \"", "\" is already registered."),
        RuntimeErrorKind::Setup => ("Plugin setup failed for \"", "\"."),
        RuntimeErrorKind::Prompt => ("Prompt transform failed for \"", "\"."),
    };
    let mut result = prefix.encode_utf16().collect::<Vec<_>>();
    result.extend_from_slice(name);
    result.extend(suffix.encode_utf16());
    result
}

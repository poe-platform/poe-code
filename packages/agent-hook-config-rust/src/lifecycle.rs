//! Independent ownership of live transformed runs and precise generated cleanup.
use crate::{Result, files, message, u};
use mcp_protocol_rust::json::Value;
use std::collections::{HashMap, HashSet};
#[derive(Default)]
pub struct Owners {
    live: HashMap<Vec<u16>, HashSet<Vec<u16>>>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ownership {
    pub id: Vec<u16>,
    pub overlaps: bool,
}
impl Owners {
    pub fn acquire(&mut self, path: &[u16], run: &[u16]) -> Result<Ownership> {
        let live = self.live.entry(path.to_vec()).or_default();
        let overlaps = !live.is_empty();
        let mut id = run.to_vec();
        let mut suffix = 1usize;
        while live.contains(&id) {
            id = message(&[run, &u(":"), &u(&suffix.to_string())]);
            suffix = suffix
                .checked_add(1)
                .ok_or_else(|| u("Hook ownership suffix exhausted"))?;
        }
        live.insert(id.clone());
        Ok(Ownership { id, overlaps })
    }
    pub fn release(&mut self, path: &[u16], id: &[u16]) {
        if let Some(live) = self.live.get_mut(path) {
            live.remove(id);
            if live.is_empty() {
                self.live.remove(path);
            }
        }
    }
    pub fn is_empty(&self) -> bool {
        self.live.is_empty()
    }
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PriorGroups {
    pub events: Vec<Vec<u16>>,
    pub matchers: Vec<(Vec<u16>, Option<Value>)>,
}
impl PriorGroups {
    pub fn from_file(file: Option<&Value>) -> Result<Self> {
        let Some(file) = file else {
            return Ok(Self::default());
        };
        let mut result = Self::default();
        if let Some(hooks) = file.get("hooks") {
            for (event, groups) in files::entries(hooks) {
                result.events.push(event.to_vec());
                let Value::Array(groups) = groups else {
                    return Err(u("Malformed hooks in prior hook file"));
                };
                for group in groups {
                    result
                        .matchers
                        .push((event.to_vec(), group.get("matcher").cloned()));
                }
            }
        }
        Ok(result)
    }
}
fn matcher_key(event: &[u16], matcher: Option<&Value>) -> Vec<u16> {
    let matcher = match matcher {
        None => u("<undefined>"),
        Some(Value::String(value)) => value.clone(),
        Some(Value::Null) => u("null"),
        Some(Value::Bool(value)) => u(if *value { "true" } else { "false" }),
        Some(Value::Number(value)) => u(&mcp_protocol_rust::numbers::format(*value)),
        _ => u("[object Object]"),
    };
    message(&[event, &[0], &matcher])
}
#[derive(Clone, Debug, PartialEq)]
pub struct Cleaned {
    pub file: Value,
    pub only_empty_hooks: bool,
}
pub fn cleanup_file(
    mut file: Value,
    owner: &[u16],
    prior: &PriorGroups,
    path: &[u16],
) -> Result<Cleaned> {
    files::validate(&file, path)?;
    let prefix = message(&[&u("[generated:poe-code:"), owner, &u("]")]);
    let events = prior.events.iter().collect::<HashSet<_>>();
    let matchers = prior
        .matchers
        .iter()
        .map(|(event, matcher)| matcher_key(event, matcher.as_ref()))
        .collect::<HashSet<_>>();
    if file.get("hooks").is_none() {
        let Value::Object(fields) = &mut file else {
            unreachable!()
        };
        fields.push((u("hooks"), Value::Object(vec![])));
    }
    let hooks = files::field_mut(&mut file, "hooks").unwrap();
    if *hooks == Value::Null {
        *hooks = Value::Object(vec![]);
    }
    let Value::Object(hooks) = hooks else {
        unreachable!()
    };
    hooks.retain_mut(|(event, groups)| {
        let Value::Array(groups) = groups else {
            unreachable!()
        };
        groups.retain_mut(|group| {
            let existed = matchers.contains(&matcher_key(event, group.get("matcher")));
            let Some(Value::Array(handlers)) = files::field_mut(group, "hooks") else {
                unreachable!()
            };
            let prior_len = handlers.len();
            handlers.retain(|handler| !files::generated(handler, &prefix));
            !handlers.is_empty() || handlers.len() == prior_len || existed
        });
        !groups.is_empty() || events.contains(event)
    });
    let only_empty_hooks = if let Value::Object(fields) = &file {
        fields.iter().all(|(key, _)| *key == u("hooks"))
            && matches!(file.get("hooks"),Some(Value::Object(hooks))if hooks.iter().all(|(_,groups)|matches!(groups,Value::Array(groups)if groups.is_empty())))
    } else {
        false
    };
    Ok(Cleaned {
        file,
        only_empty_hooks,
    })
}

//! Portable hook configuration policies with own declarative agent definitions.
pub mod files;
pub mod io;
pub mod paths;
use agent_defs_rust::Registry;
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};
pub type Result<T> = std::result::Result<T, Vec<u16>>;
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn message(parts: &[&[u16]]) -> Vec<u16> {
    parts.concat()
}
fn string(value: &Value, key: &str) -> Result<Vec<u16>> {
    match value.get(key) {
        Some(Value::String(value)) => Ok(value.clone()),
        _ => Err(u(&format!(
            "Hook configuration requires string field {key}"
        ))),
    }
}
fn strings(value: &Value, key: &str) -> Result<Vec<Vec<u16>>> {
    match value.get(key) {
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| match value {
                Value::String(value) => Ok(value.clone()),
                _ => Err(u("Hook configuration requires string arrays")),
            })
            .collect(),
        _ => Err(u(&format!("Hook configuration requires array field {key}"))),
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub global_path: Vec<u16>,
    pub local_path: Option<Vec<u16>>,
    pub format: Vec<u16>,
    pub transform_readable: bool,
    pub transform_writable: bool,
    pub events: Vec<Vec<u16>>,
    pub handler_types: Vec<Vec<u16>>,
    pub placeholders: Vec<(Vec<u16>, Vec<u16>)>,
    /// Retains additional declarative fields for adapters without leaking them into agent metadata.
    pub raw: Value,
}
impl Config {
    pub fn from_value(value: &Value) -> Result<Self> {
        let Some(Value::Object(placeholders)) = value.get("placeholders") else {
            return Err(u("Hook configuration requires placeholder object"));
        };
        let placeholders = placeholders
            .iter()
            .map(|(key, value)| match value {
                Value::String(value) => Ok((key.clone(), value.clone())),
                _ => Err(u("Hook placeholders must be strings")),
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            global_path: string(value, "globalHookPath")?,
            local_path: match value.get("localHookPath") {
                Some(Value::String(value)) => Some(value.clone()),
                None => None,
                _ => return Err(u("Hook local path must be a string")),
            },
            format: string(value, "format")?,
            transform_readable: matches!(value.get("transformReadable"), Some(Value::Bool(true))),
            transform_writable: matches!(value.get("transformWritable"), Some(Value::Bool(true))),
            events: strings(value, "supportedEvents")?,
            handler_types: strings(value, "supportedHandlerTypes")?,
            placeholders,
            raw: value.clone(),
        })
    }
    pub fn can_transform_to(&self, target: &Self) -> bool {
        self.transform_readable && target.transform_writable && self.format != target.format
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SupportStatus {
    Supported,
    Unsupported,
    Unknown,
}
#[derive(Debug)]
pub struct Support<'a> {
    pub status: SupportStatus,
    pub id: Option<&'a [u16]>,
    pub config: Option<&'a Config>,
}
pub struct Catalog {
    agents: Registry,
    configs: Vec<(Vec<u16>, Config)>,
}
impl Catalog {
    pub fn builtins() -> Result<Self> {
        Self::from_agents(Registry::builtins())
    }
    /// Every agent's hook settings are owned by its one declarative definition file.
    pub fn from_agents(agents: Registry) -> Result<Self> {
        let configs = agents
            .definitions()
            .iter()
            .filter_map(|agent| agent.hook_config.as_ref().map(|config| (agent, config)))
            .map(|(agent, config)| {
                Ok((string(&agent.metadata, "id")?, Config::from_value(config)?))
            })
            .collect::<Result<_>>()?;
        Ok(Self { agents, configs })
    }
    pub fn configs(&self) -> &[(Vec<u16>, Config)] {
        &self.configs
    }
    pub fn supported_agents(&self) -> Vec<Vec<u16>> {
        self.configs.iter().map(|(id, _)| id.clone()).collect()
    }
    /// Input is ECMAScript-trimmed and lowercased by the foreign runtime when applicable.
    pub fn resolve_normalized(&self, input: &[u16]) -> Support<'_> {
        let Some(id) = self.agents.resolve_normalized(input) else {
            return Support {
                status: SupportStatus::Unknown,
                id: None,
                config: None,
            };
        };
        let config = self
            .configs
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, value)| value);
        Support {
            status: if config.is_some() {
                SupportStatus::Supported
            } else {
                SupportStatus::Unsupported
            },
            id: Some(id),
            config,
        }
    }
    fn require(&self, input: &[u16]) -> Result<&Config> {
        let mut normalized = vec![];
        for character in char::decode_utf16(trim_ecmascript(input).iter().copied()) {
            match character {
                Ok(character) => {
                    for lowered in character.to_lowercase() {
                        normalized.extend(lowered.encode_utf16(&mut [0; 2]).iter().copied());
                    }
                }
                Err(error) => normalized.push(error.unpaired_surrogate()),
            }
        }
        self.resolve_normalized(&normalized)
            .config
            .ok_or_else(|| message(&[&u("Unknown hook agent \""), input, &u("\"")]))
    }
    pub fn transform_pairs(&self) -> Vec<(Vec<u16>, Vec<u16>)> {
        transform_pairs(&self.configs)
    }
    pub fn event_mappings(&self, source: &[u16], target: &[u16]) -> Result<Vec<EventMapping>> {
        let source = self.require(source)?;
        let target_config = self.require(target)?;
        Ok(source
            .events
            .iter()
            .map(|event| {
                if target_config.events.contains(event) {
                    EventMapping {
                        source_event: event.clone(),
                        target_event: Some(event.clone()),
                        drop_reason: None,
                    }
                } else {
                    EventMapping {
                        source_event: event.clone(),
                        target_event: None,
                        drop_reason: Some(message(&[target, &u(" has no "), event, &u(" hook")])),
                    }
                }
            })
            .collect())
    }
    pub fn handler_rules(&self, target: &[u16]) -> Result<Vec<HandlerRule>> {
        let config = self.require(target)?;
        let mut types = vec![];
        for (_, config) in &self.configs {
            for kind in &config.handler_types {
                if !types.contains(kind) {
                    types.push(kind.clone());
                }
            }
        }
        let supported = config
            .handler_types
            .iter()
            .map(|kind| message(&[&u("\""), kind, &u("\"")]))
            .collect::<Vec<_>>()
            .join(&u(", ")[..]);
        Ok(types
            .into_iter()
            .map(|source_type| {
                if config.handler_types.contains(&source_type) {
                    HandlerRule {
                        source_type,
                        allowed: true,
                        drop_reason: None,
                    }
                } else {
                    HandlerRule {
                        source_type,
                        allowed: false,
                        drop_reason: Some(message(&[
                            target,
                            &u(" only honors handlers of type "),
                            &supported,
                        ])),
                    }
                }
            })
            .collect())
    }
    pub fn placeholder_rewrites(&self, source: &[u16], target: &[u16]) -> Result<Vec<Rewrite>> {
        let source = self.require(source)?;
        let target = self.require(target)?;
        Ok(source
            .placeholders
            .iter()
            .filter_map(|(key, from)| {
                let to = target
                    .placeholders
                    .iter()
                    .find(|(target_key, _)| target_key == key)
                    .map(|(_, value)| value)?;
                (!from.is_empty() && !to.is_empty() && from != to).then(|| Rewrite {
                    from: from.clone(),
                    to: to.clone(),
                })
            })
            .collect())
    }
}
pub fn transform_pairs(configs: &[(Vec<u16>, Config)]) -> Vec<(Vec<u16>, Vec<u16>)> {
    configs
        .iter()
        .flat_map(|(source, config)| {
            configs
                .iter()
                .filter(|(_, target)| config.can_transform_to(target))
                .map(|(target, _)| (source.clone(), target.clone()))
        })
        .collect()
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EventMapping {
    pub source_event: Vec<u16>,
    pub target_event: Option<Vec<u16>>,
    pub drop_reason: Option<Vec<u16>>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HandlerRule {
    pub source_type: Vec<u16>,
    pub allowed: bool,
    pub drop_reason: Option<Vec<u16>>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rewrite {
    pub from: Vec<u16>,
    pub to: Vec<u16>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Handler {
    pub kind: Vec<u16>,
    pub command: Option<Vec<u16>>,
    pub args: Option<Vec<Vec<u16>>>,
    pub timeout: Option<f64>,
    pub status_message: Option<Vec<u16>>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct SourceEntry {
    pub event: Vec<u16>,
    pub matcher: Option<Vec<u16>>,
    pub handler: Handler,
}
#[derive(Clone, Debug, PartialEq)]
pub struct GeneratedEntry {
    pub event: Vec<u16>,
    pub matcher: Option<Vec<u16>>,
    pub handler: Handler,
    pub generated_id: Vec<u16>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Drop {
    pub reason: &'static str,
    pub detail: Vec<u16>,
    pub source_index: usize,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Transformed {
    pub entries: Vec<GeneratedEntry>,
    pub drops: Vec<Drop>,
}
fn rewrite(value: &[u16], rules: &[Rewrite]) -> Vec<u16> {
    let mut result = value.to_vec();
    for rule in rules {
        let mut next = vec![];
        let mut index = 0;
        while index < result.len() {
            if result[index..].starts_with(&rule.from) {
                next.extend(&rule.to);
                index += rule.from.len();
            } else {
                next.push(result[index]);
                index += 1;
            }
        }
        result = next;
    }
    result
}
pub fn transform_hooks(
    catalog: &Catalog,
    source: &[SourceEntry],
    source_agent: &[u16],
    target_agent: &[u16],
    run_id: &[u16],
) -> Result<Transformed> {
    let events = catalog.event_mappings(source_agent, target_agent)?;
    let handlers = catalog.handler_rules(target_agent)?;
    let rewrites = catalog.placeholder_rewrites(source_agent, target_agent)?;
    let mut result = Transformed::default();
    for (source_index, entry) in source.iter().enumerate() {
        let mapping = events
            .iter()
            .find(|mapping| mapping.source_event == entry.event);
        let target = mapping.and_then(|mapping| mapping.target_event.as_ref());
        let Some(target) = target else {
            result.drops.push(Drop {
                reason: "unsupported-event",
                detail: mapping
                    .and_then(|mapping| mapping.drop_reason.clone())
                    .unwrap_or_else(|| {
                        message(&[target_agent, &u(" has no "), &entry.event, &u(" hook")])
                    }),
                source_index,
            });
            continue;
        };
        let handler = handlers
            .iter()
            .find(|rule| rule.source_type == entry.handler.kind);
        if !handler.is_some_and(|handler| handler.allowed) {
            let detail = handler
                .and_then(|handler| handler.drop_reason.clone())
                .unwrap_or_else(|| message(&[target_agent, &u(" does not honor it")]));
            result.drops.push(Drop {
                reason: "unsupported-handler-type",
                detail: message(&[
                    &u("Unsupported handler type \""),
                    &entry.handler.kind,
                    &u("\": "),
                    &detail,
                ]),
                source_index,
            });
            continue;
        }
        if entry.handler.kind == u("command")
            && entry
                .handler
                .command
                .as_ref()
                .is_none_or(|command| trim_ecmascript(command).is_empty())
        {
            result.drops.push(Drop {
                reason: "unsupported-handler-type",
                detail: u("Command hook is missing an executable command"),
                source_index,
            });
            continue;
        }
        let status = message(&[
            &u("[generated:poe-code:"),
            run_id,
            &u("] "),
            entry.handler.status_message.as_deref().unwrap_or(&[]),
        ]);
        let index = u(&result.entries.len().to_string());
        result.entries.push(GeneratedEntry {
            event: target.clone(),
            matcher: entry.matcher.clone(),
            handler: Handler {
                kind: u("command"),
                command: Some(rewrite(
                    entry.handler.command.as_deref().unwrap_or(&[]),
                    &rewrites,
                )),
                args: entry
                    .handler
                    .args
                    .as_ref()
                    .map(|args| args.iter().map(|arg| rewrite(arg, &rewrites)).collect()),
                timeout: entry.handler.timeout,
                status_message: Some(status),
            },
            generated_id: message(&[&u("generated-"), run_id, &u("-"), &index]),
        });
    }
    Ok(result)
}

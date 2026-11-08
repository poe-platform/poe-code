//! A declarative agent catalog reusable from Rust, Node and future Python bindings.
use mcp_protocol_rust::{
    json::{self, Limits, Value},
    strings::trim_ecmascript,
};
include!(concat!(env!("OUT_DIR"), "/definitions.rs"));
pub const SPECIFIER_DELIMITER: u16 = 58;
pub const EMPTY_AGENT_ERROR: &str = "agent must not be empty";

pub struct Definition {
    pub export_name: String,
    pub metadata: Value,
    pub argument_templates: Option<Vec<Vec<u16>>>,
    /// Rust MCP integrations derive support from this same declarative file.
    /// It remains separate from the public SDK agent metadata.
    pub mcp_config: Option<Value>,
    /// Hook bridges derive support from the same declarative agent file.
    pub hook_config: Option<Value>,
    pub skill_config: Option<Value>,
    pub spawn_config: Option<Value>,
    pub acp_spawn_config: Option<Value>,
    id: Vec<u16>,
    aliases: Vec<Vec<u16>>,
    capabilities: Vec<Vec<u16>>,
}
pub struct Registry {
    definitions: Vec<Definition>,
    lookup: Vec<(Vec<u16>, Vec<u16>)>,
}
#[derive(Debug, PartialEq, Eq)]
pub struct Specifier {
    pub agent: Vec<u16>,
    pub model: Option<Vec<u16>>,
}
fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn as_string(value: Option<&Value>) -> Result<Vec<u16>, &'static str> {
    if let Some(Value::String(value)) = value {
        Ok(value.clone())
    } else {
        Err("Agent definition string is required")
    }
}
fn strings(value: Option<&Value>) -> Result<Vec<Vec<u16>>, &'static str> {
    match value {
        None => Ok(vec![]),
        Some(Value::Array(items)) => items.iter().map(|item| as_string(Some(item))).collect(),
        _ => Err("Agent definition array is required"),
    }
}
fn lower(text: &[u16]) -> Vec<u16> {
    let mut output = vec![];
    for character in char::decode_utf16(text.iter().copied()) {
        match character {
            Ok(character) => {
                for lowered in character.to_lowercase() {
                    output.extend(lowered.encode_utf16(&mut [0; 2]).iter().copied());
                }
            }
            Err(error) => output.push(error.unpaired_surrogate()),
        }
    }
    output
}
fn append(output: &mut Vec<u16>, text: &str) {
    output.extend(text.encode_utf16());
}
fn joined(values: &[Vec<u16>], separator: &str) -> Vec<u16> {
    let mut output = vec![];
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            append(&mut output, separator);
        }
        output.extend(value);
    }
    output
}

pub fn parse_specifier(input: &[u16]) -> Result<Specifier, &'static str> {
    let colon = input.iter().position(|unit| *unit == SPECIFIER_DELIMITER);
    let agent = trim_ecmascript(&input[..colon.unwrap_or(input.len())]);
    if agent.is_empty() {
        return Err(EMPTY_AGENT_ERROR);
    }
    let model = colon
        .map(|colon| trim_ecmascript(&input[colon + 1..]))
        .filter(|model| !model.is_empty())
        .map(<[u16]>::to_vec);
    Ok(Specifier {
        agent: agent.to_vec(),
        model,
    })
}
pub fn format_specifier(agent: &[u16], model: Option<&[u16]>) -> Result<Vec<u16>, &'static str> {
    let agent = trim_ecmascript(agent);
    if agent.is_empty() {
        return Err(EMPTY_AGENT_ERROR);
    }
    let mut output = agent.to_vec();
    if let Some(model) = model.map(trim_ecmascript).filter(|model| !model.is_empty()) {
        output.push(SPECIFIER_DELIMITER);
        output.extend(model);
    }
    Ok(output)
}
fn distance(a: &[u16], b: &[u16]) -> usize {
    if a.len().abs_diff(b.len()) > 3 {
        return a.len().max(b.len());
    }
    let mut previous: Vec<_> = (0..=b.len()).collect();
    for (i, left) in a.iter().enumerate() {
        let mut current = vec![i + 1; b.len() + 1];
        for (j, right) in b.iter().enumerate() {
            current[j + 1] = (previous[j] + usize::from(left != right))
                .min(previous[j + 1] + 1)
                .min(current[j] + 1);
        }
        previous = current;
    }
    previous[b.len()]
}
impl Registry {
    pub fn builtins() -> Self {
        Self::from_json(DEFINITION_JSON.iter().copied()).expect("Valid built-in agent definitions")
    }
    pub fn from_json<'a>(sources: impl IntoIterator<Item = &'a str>) -> Result<Self, &'static str> {
        let mut definitions = vec![];
        let mut lookup = vec![];
        for source in sources {
            let value = json::parse_utf16(&units(source), Limits::default())
                .map_err(|_| "Invalid agent definition JSON")?;
            let export_name = String::from_utf16(&as_string(value.get("exportName"))?)
                .map_err(|_| "Invalid agent export name")?;
            let Some(Value::Object(fields)) = value.get("definition") else {
                return Err("Agent definition object is required");
            };
            let mut metadata = Value::Object(fields.clone());
            let id = as_string(metadata.get("id"))?;
            if id.is_empty() {
                return Err("Agent id must not be empty");
            }
            for field in ["label", "summary"] {
                as_string(metadata.get(field))?;
            }
            let aliases = strings(metadata.get("aliases"))?;
            let capabilities = strings(metadata.get("capabilities"))?;
            let argument_templates = if value.get("argumentTemplates").is_some() {
                Some(strings(value.get("argumentTemplates"))?)
            } else {
                None
            };
            let mcp_config = value.get("mcpConfig").cloned();
            if mcp_config
                .as_ref()
                .is_some_and(|config| !matches!(config, Value::Object(_)))
            {
                return Err("Agent MCP configuration object is required");
            }
            let hook_config = value.get("hookConfig").cloned();
            if hook_config
                .as_ref()
                .is_some_and(|config| !matches!(config, Value::Object(_)))
            {
                return Err("Agent hook configuration object is required");
            }
            let skill_config = value.get("skillConfig").cloned();
            if skill_config
                .as_ref()
                .is_some_and(|config| !matches!(config, Value::Object(_)))
            {
                return Err("Agent skill configuration object is required");
            }
            let spawn_config = value.get("spawnConfig").cloned();
            let acp_spawn_config = value.get("acpSpawnConfig").cloned();
            if [spawn_config.as_ref(), acp_spawn_config.as_ref()]
                .into_iter()
                .flatten()
                .any(|config| !matches!(config, Value::Object(_)))
            {
                return Err("Agent spawn configuration object is required");
            }
            let Value::Object(fields) = &mut metadata else {
                return Err("Agent definition object is required");
            };
            if !fields.iter().any(|(key, _)| *key == units("name")) {
                fields.insert(1, (units("name"), Value::String(id.clone())));
            }
            if argument_templates.is_some()
                && !fields.iter().any(|(key, _)| *key == units("otelCapture"))
            {
                fields.push((units("otelCapture"), Value::Object(vec![])));
            }
            let name = as_string(metadata.get("name"))?;
            for key in std::iter::once(&id)
                .chain(std::iter::once(&name))
                .chain(aliases.iter())
            {
                let key = lower(key);
                if !lookup.iter().any(|(existing, _)| *existing == key) {
                    lookup.push((key, id.clone()));
                }
            }
            definitions.push(Definition {
                export_name,
                metadata,
                argument_templates,
                mcp_config,
                hook_config,
                skill_config,
                spawn_config,
                acp_spawn_config,
                id,
                aliases,
                capabilities,
            });
        }
        Ok(Self {
            definitions,
            lookup,
        })
    }
    pub fn definitions(&self) -> &[Definition] {
        &self.definitions
    }
    pub fn lookup_keys(&self) -> &[(Vec<u16>, Vec<u16>)] {
        &self.lookup
    }
    /// The caller supplies an ECMAScript-trimmed, lowercase lookup key.
    pub fn resolve_normalized(&self, input: &[u16]) -> Option<&[u16]> {
        self.lookup
            .iter()
            .find(|(key, _)| key == input)
            .map(|(_, id)| id.as_slice())
    }
    pub fn list(&self, capability: &[u16], include_aliases: bool) -> Vec<Vec<u16>> {
        let mut output = vec![];
        for agent in &self.definitions {
            if !agent.capabilities.iter().any(|value| value == capability) {
                continue;
            }
            output.push(agent.id.clone());
            if include_aliases {
                output.extend(agent.aliases.iter().cloned());
            }
        }
        output
    }
    pub fn normalize_specifier(
        &self,
        input: &[u16],
        normalized_agent: &[u16],
    ) -> Result<Vec<u16>, &'static str> {
        let specifier = parse_specifier(input)?;
        format_specifier(
            self.resolve_normalized(normalized_agent)
                .unwrap_or(&specifier.agent),
            specifier.model.as_deref(),
        )
    }
    pub fn capability_error(
        &self,
        agent: &[u16],
        normalized_agent: &[u16],
        capability: &[u16],
    ) -> Vec<u16> {
        let allowed = self.list(capability, true);
        let mut allow_list = units("Agents supporting ");
        allow_list.extend(capability);
        append(&mut allow_list, ": ");
        if allowed.is_empty() {
            append(&mut allow_list, "none");
        } else {
            allow_list.extend(joined(&allowed, ", "));
        }
        allow_list.push(46);
        let mut output = vec![];
        if let Some(id) = self.resolve_normalized(normalized_agent) {
            append(&mut output, "Agent \"");
            output.extend(id);
            append(&mut output, "\" does not support ");
            output.extend(capability);
            append(&mut output, ". ");
            let supported: Vec<_> = ["spawn", "configure", "install", "test", "skill", "mcp"]
                .into_iter()
                .filter(|capability| {
                    self.list(&units(capability), false)
                        .iter()
                        .any(|value| value == id)
                })
                .map(units)
                .collect();
            output.extend(id);
            if supported.is_empty() {
                append(&mut output, " is not supported by poe-code agent commands.");
            } else {
                append(&mut output, " supports: ");
                output.extend(joined(&supported, ", "));
                output.push(46);
            }
        } else {
            append(&mut output, "Unknown agent \"");
            output.extend(agent);
            append(&mut output, "\".");
            let mut near = vec![];
            let mut best = 3;
            for candidate in &allowed {
                let score = distance(normalized_agent, &lower(candidate));
                if score > best {
                    continue;
                }
                if score < best {
                    near.clear();
                    best = score;
                }
                near.push(candidate.clone());
            }
            if !near.is_empty() {
                append(&mut output, " Did you mean: ");
                output.extend(joined(&near, ", "));
                output.push(63);
            }
        }
        output.push(32);
        output.extend(allow_list);
        output
    }
    pub fn telemetry_arguments(
        &self,
        id: &[u16],
        endpoint: &[u16],
        content: bool,
    ) -> Option<Vec<Vec<u16>>> {
        let templates = self
            .definitions
            .iter()
            .find(|agent| agent.id == id)?
            .argument_templates
            .as_ref()?;
        let opener = units("${");
        Some(
            templates
                .iter()
                .map(|template| {
                    let mut output = vec![];
                    let mut start = 0;
                    while let Some(offset) = template[start..]
                        .windows(2)
                        .position(|window| window == opener)
                    {
                        let position = start + offset;
                        output.extend(&template[start..position]);
                        let Some(end) = template[position + 2..]
                            .iter()
                            .position(|unit| *unit == 125)
                            .map(|offset| position + 2 + offset)
                        else {
                            output.extend(&template[position..]);
                            return output;
                        };
                        let key = &template[position + 2..end];
                        if key == units("content") {
                            append(&mut output, if content { "true" } else { "false" });
                        } else if key.starts_with(&units("endpointJson:")) {
                            let mut url = endpoint.to_vec();
                            url.extend(&key[13..]);
                            append(&mut output, &json::stringify(&Value::String(url)));
                        } else {
                            output.extend(&template[position..=end]);
                        }
                        start = end + 1;
                    }
                    output.extend(&template[start..]);
                    output
                })
                .collect(),
        )
    }
}

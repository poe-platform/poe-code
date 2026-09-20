//! Portable coding-agent skill catalogs and filesystem policies.
pub mod exclude;
pub mod paths;
pub mod resolve;
use agent_defs_rust::Registry;
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
pub type Result<T> = std::result::Result<T, Vec<u16>>;
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub global_dir: Vec<u16>,
    pub local_dir: Vec<u16>,
    pub raw: Value,
}
impl Config {
    pub fn from_value(raw: &Value) -> Result<Self> {
        let string = |key| match raw.get(key) {
            Some(Value::String(value)) => Ok(value.clone()),
            _ => Err(u(&format!(
                "Skill configuration requires string field {key}"
            ))),
        };
        Ok(Self {
            global_dir: string("globalSkillDir")?,
            local_dir: string("localSkillDir")?,
            raw: raw.clone(),
        })
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SupportStatus {
    Supported,
    Unsupported,
    Unknown,
}
pub struct Support<'a> {
    pub status: SupportStatus,
    pub id: Option<Vec<u16>>,
    pub config: Option<&'a Config>,
}
pub struct Catalog {
    agents: Registry,
    configs: Vec<(Vec<u16>, Config)>,
}
impl Catalog {
    pub fn builtins() -> Result<Self> {
        Self::from_registry(Registry::builtins())
    }
    pub fn from_registry(agents: Registry) -> Result<Self> {
        let mut configs = vec![];
        for definition in agents.definitions() {
            if let Some(raw) = &definition.skill_config
                && let Some(Value::String(id)) = definition.metadata.get("id")
            {
                configs.push((id.clone(), Config::from_value(raw)?));
            }
        }
        Ok(Self { agents, configs })
    }
    pub fn configs(&self) -> &[(Vec<u16>, Config)] {
        &self.configs
    }
    pub fn supported_agents(&self) -> Vec<Vec<u16>> {
        self.configs.iter().map(|(id, _)| id.clone()).collect()
    }
    pub fn resolve_normalized(&self, input: &[u16]) -> Support<'_> {
        let id = self.agents.resolve_normalized(input).map(<[u16]>::to_vec);
        let config = id.as_ref().and_then(|id| {
            self.configs
                .iter()
                .find(|(key, _)| key == id)
                .map(|(_, config)| config)
        });
        let status = if id.is_none() {
            SupportStatus::Unknown
        } else if config.is_some() {
            SupportStatus::Supported
        } else {
            SupportStatus::Unsupported
        };
        Support { status, id, config }
    }
    pub fn resolve(&self, input: &[u16]) -> Support<'_> {
        let mut normalized = vec![];
        for character in char::decode_utf16(trim_ecmascript(input).iter().copied()) {
            match character {
                Ok(character) => {
                    for lower in character.to_lowercase() {
                        normalized.extend(lower.encode_utf16(&mut [0; 2]).iter().copied());
                    }
                }
                Err(error) => normalized.push(error.unpaired_surrogate()),
            }
        }
        self.resolve_normalized(&normalized)
    }
}

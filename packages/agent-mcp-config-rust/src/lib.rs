//! Portable agent MCP configuration policies.
pub mod decision;
pub mod shape;
pub mod validation;
use agent_defs_rust::Registry;
use mcp_protocol_rust::json::Value;

fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn string(value: Option<&Value>) -> Result<Vec<u16>, &'static str> {
    match value {
        Some(Value::String(value)) => Ok(value.clone()),
        _ => Err("MCP configuration string is required"),
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConfigPath {
    Static(Vec<u16>),
    Platforms(Vec<(Vec<u16>, Vec<u16>)>),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub file: ConfigPath,
    pub key: Vec<u16>,
    pub format: Vec<u16>,
    pub shape: Vec<u16>,
    pub output_format: Option<Vec<u16>>,
}
impl Config {
    fn from_value(value: &Value) -> Result<Self, &'static str> {
        let file = match value.get("configFile") {
            Some(Value::String(path)) => ConfigPath::Static(path.clone()),
            Some(Value::Object(fields)) => {
                if !fields.iter().any(|(key, _)| *key == units("default")) {
                    return Err("MCP platform paths require a default");
                }
                ConfigPath::Platforms(
                    fields
                        .iter()
                        .map(|(key, value)| Ok((key.clone(), string(Some(value))?)))
                        .collect::<Result<_, &'static str>>()?,
                )
            }
            _ => return Err("MCP configuration path is required"),
        };
        let format = string(value.get("format"))?;
        if !["json", "toml", "yaml"]
            .iter()
            .any(|item| units(item) == format)
        {
            return Err("Unknown MCP configuration format");
        }
        let shape = string(value.get("shape"))?;
        if !["standard", "opencode", "goose"]
            .iter()
            .any(|item| units(item) == shape)
        {
            return Err("Unknown MCP configuration shape");
        }
        Ok(Self {
            file,
            key: string(value.get("configKey"))?,
            format,
            shape,
            output_format: value
                .get("mcpOutputFormat")
                .map(|value| string(Some(value)))
                .transpose()?,
        })
    }
    pub fn path(&self, platform: &[u16]) -> Vec<u16> {
        match &self.file {
            ConfigPath::Static(path) => path.clone(),
            ConfigPath::Platforms(paths) => paths
                .iter()
                .find(|(key, _)| key == platform)
                .or_else(|| paths.iter().find(|(key, _)| *key == units("default")))
                .expect("Validated default path")
                .1
                .clone(),
        }
    }
}
pub enum Support<'a> {
    Supported { id: &'a [u16], config: &'a Config },
    Unsupported(&'a [u16]),
    Unknown,
}
pub struct Catalog {
    registry: Registry,
    configs: Vec<(Vec<u16>, Config)>,
}
impl Catalog {
    pub fn new(registry: Registry) -> Result<Self, &'static str> {
        let configs = registry
            .definitions()
            .iter()
            .filter_map(|definition| {
                definition
                    .mcp_config
                    .as_ref()
                    .map(|value| (definition, value))
            })
            .map(|(definition, value)| {
                Ok((
                    string(definition.metadata.get("id"))?,
                    Config::from_value(value)?,
                ))
            })
            .collect::<Result<_, &'static str>>()?;
        Ok(Self { registry, configs })
    }
    pub fn configs(&self) -> &[(Vec<u16>, Config)] {
        &self.configs
    }
    pub fn lookup_keys(&self) -> &[(Vec<u16>, Vec<u16>)] {
        self.registry.lookup_keys()
    }
    pub fn supported(&self) -> Vec<Vec<u16>> {
        self.configs.iter().map(|(id, _)| id.clone()).collect()
    }
    /// Input has already been normalized by the language host.
    pub fn resolve(&self, normalized: &[u16]) -> Support<'_> {
        match self.registry.resolve_normalized(normalized) {
            None => Support::Unknown,
            Some(id) => match self.configs.iter().find(|(key, _)| key == id) {
                Some((_, config)) => Support::Supported { id, config },
                None => Support::Unsupported(id),
            },
        }
    }
}

//! One self-contained addon embeds config codecs, execution and templates.
use agent_defs_rust::Registry;
use agent_mcp_config_rust::{Catalog, ConfigPath, decision, shape, validation};
pub use config_mutations_rust_napi_core::*;
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
fn s(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value))
            .collect(),
    )
}
fn kind(name: &str) -> NativeJson {
    NativeJson(object(vec![("kind", s(name))]))
}
#[napi]
pub fn agent_mcp_catalog() -> NativeJson {
    let catalog = Catalog::new(Registry::builtins()).expect("Valid built-in MCP catalog");
    NativeJson(object(vec![
        (
            "lookup",
            Value::Array(
                catalog
                    .lookup_keys()
                    .iter()
                    .map(|(key, id)| {
                        Value::Array(vec![Value::String(key.clone()), Value::String(id.clone())])
                    })
                    .collect(),
            ),
        ),
        (
            "configs",
            Value::Array(
                catalog
                    .configs()
                    .iter()
                    .map(|(id, config)| {
                        let file = match &config.file {
                            ConfigPath::Static(path) => Value::String(path.clone()),
                            ConfigPath::Platforms(paths) => Value::Object(
                                paths
                                    .iter()
                                    .map(|(key, path)| (key.clone(), Value::String(path.clone())))
                                    .collect(),
                            ),
                        };
                        let mut fields = vec![
                            ("configFile", file),
                            ("configKey", Value::String(config.key.clone())),
                            ("format", Value::String(config.format.clone())),
                            ("shape", Value::String(config.shape.clone())),
                        ];
                        if let Some(format) = &config.output_format {
                            fields.push(("mcpOutputFormat", Value::String(format.clone())));
                        }
                        Value::Array(vec![Value::String(id.clone()), object(fields)])
                    })
                    .collect(),
            ),
        ),
    ]))
}
fn shape_request(request: shape::Request) -> NativeJson {
    use shape::Request as R;
    let (name, mut fields) = match request {
        R::Enabled => ("enabled", vec![]),
        R::Transport => ("transport", vec![]),
        R::Cache => ("cache", vec![]),
        R::Command { cached } => ("command", vec![("cached", Value::Bool(cached))]),
        R::ArgsCheck { cached } => ("argsCheck", vec![("cached", Value::Bool(cached))]),
        R::Args { cached } => ("args", vec![("cached", Value::Bool(cached))]),
        R::Spread { args } => ("spread", vec![("args", Value::Bool(args))]),
        R::EnvCheck { cached } => ("envCheck", vec![("cached", Value::Bool(cached))]),
        R::Env { cached } => ("env", vec![("cached", Value::Bool(cached))]),
        R::Url => ("url", vec![]),
        R::HeadersCheck => ("headersCheck", vec![]),
        R::Headers => ("headers", vec![]),
        R::Done(present) => ("done", vec![("present", Value::Bool(present))]),
        R::Emit { key, value, mode } => {
            let (value_kind, value) = match value {
                shape::Value::Reference(reference) => {
                    ("reference", Value::Number(reference as f64))
                }
                shape::Value::String(text) => ("literal", s(text)),
                shape::Value::Bool(flag) => ("literal", Value::Bool(flag)),
            };
            (
                "emit",
                vec![
                    ("key", s(key)),
                    ("valueKind", s(value_kind)),
                    ("value", value),
                    ("assign", Value::Bool(mode == shape::FieldMode::Assign)),
                ],
            )
        }
    };
    fields.insert(0, ("kind", s(name)));
    NativeJson(object(fields))
}
#[napi]
pub fn agent_mcp_shape_policies() -> NativeJson {
    NativeJson(object(
        [
            ("standard", shape::Style::Standard),
            ("opencode", shape::Style::Opencode),
            ("goose", shape::Style::Goose),
        ]
        .into_iter()
        .map(|(name, style)| {
            let states = shape::Shape::policy(style)
                .into_iter()
                .map(|state| {
                    let Value::Object(mut fields) = shape_request(state.request).0 else {
                        unreachable!()
                    };
                    let mut add = |key: &str, index: usize| {
                        fields.push((key.encode_utf16().collect(), Value::Number(index as f64)))
                    };
                    match state.transition {
                        shape::Transition::Terminal => {}
                        shape::Transition::Advance(next) => add("next", next),
                        shape::Transition::Flag { yes, no } => {
                            add("yes", yes);
                            add("no", no);
                        }
                    }
                    Value::Object(fields)
                })
                .collect();
            (name, Value::Array(states))
        })
        .collect(),
    ))
}
#[napi]
pub struct AgentMcpShape {
    machine: Option<shape::Shape>,
}
#[napi]
impl AgentMcpShape {
    #[napi(constructor)]
    pub fn new(style: String) -> Result<Self> {
        let style = match style.as_str() {
            "standard" => shape::Style::Standard,
            "opencode" => shape::Style::Opencode,
            "goose" => shape::Style::Goose,
            _ => return Err(Error::from_reason("Unknown MCP configuration shape")),
        };
        Ok(Self {
            machine: Some(shape::Shape::new(style)),
        })
    }
    #[napi]
    pub fn request(&self) -> Result<NativeJson> {
        Ok(shape_request(
            self.machine
                .as_ref()
                .ok_or_else(|| Error::from_reason("Shape discarded"))?
                .request(),
        ))
    }
    #[napi]
    pub fn respond(&mut self, kind: String, flag: bool, reference: u32) -> Result<NativeJson> {
        let response = match kind.as_str() {
            "flag" => shape::Response::Flag(flag),
            "value" => shape::Response::Value(reference),
            "unit" => shape::Response::Unit,
            _ => return Err(Error::from_reason("Invalid shape response kind")),
        };
        let machine = self
            .machine
            .as_mut()
            .ok_or_else(|| Error::from_reason("Shape discarded"))?;
        machine.respond(response).map_err(Error::from_reason)?;
        Ok(shape_request(machine.request()))
    }
    #[napi]
    pub fn discard(&mut self) {
        self.machine = None;
    }
    #[napi]
    pub fn reset(&mut self, style: String) -> Result<()> {
        self.machine = Self::new(style)?.machine;
        Ok(())
    }
}
fn validation_request(request: validation::Request) -> NativeJson {
    use validation::Request as R;
    match request {
        R::Name => kind("name"),
        R::Transport => kind("transport"),
        R::Command => kind("command"),
        R::Url => kind("url"),
        R::ParseUrl => kind("parseUrl"),
        R::Http => kind("http"),
        R::Https => kind("https"),
        R::Done => kind("done"),
        R::Error(message) => {
            NativeJson(object(vec![("kind", s("error")), ("message", s(message))]))
        }
    }
}
#[napi]
pub struct AgentMcpValidation {
    machine: Option<validation::Validation>,
}
impl Default for AgentMcpValidation {
    fn default() -> Self {
        Self {
            machine: Some(validation::Validation::new()),
        }
    }
}
#[napi]
impl AgentMcpValidation {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn request(&self) -> Result<NativeJson> {
        Ok(validation_request(
            self.machine
                .as_ref()
                .ok_or_else(|| Error::from_reason("Validation discarded"))?
                .request(),
        ))
    }
    #[napi]
    pub fn respond(&mut self, flag: bool) -> Result<NativeJson> {
        let machine = self
            .machine
            .as_mut()
            .ok_or_else(|| Error::from_reason("Validation discarded"))?;
        machine.respond(flag).map_err(Error::from_reason)?;
        Ok(validation_request(machine.request()))
    }
    #[napi]
    pub fn discard(&mut self) {
        self.machine = None;
    }
    #[napi]
    pub fn reset(&mut self) {
        self.machine = Some(validation::Validation::new());
    }
}
fn decision_request(request: decision::Request) -> NativeJson {
    use decision::Request as R;
    match request {
        R::Map => kind("map"),
        R::EmptyMap => kind("emptyMap"),
        R::Existing => kind("existing"),
        R::EqualsShaped => kind("equalsShaped"),
        R::HasCanonical => kind("hasCanonical"),
        R::EqualsCanonical => kind("equalsCanonical"),
        R::ConflictName => kind("conflictName"),
        R::HasExpected => kind("hasExpected"),
        R::EqualsExpected => kind("equalsExpected"),
        R::Delete => kind("delete"),
        R::Noop => kind("noop"),
        R::Upsert => kind("upsert"),
        R::RemoveKey => kind("removeKey"),
        R::UpdateMap => kind("updateMap"),
        R::Error(message) => NativeJson(object(vec![
            ("kind", s("error")),
            ("message", Value::String(message)),
        ])),
    }
}
#[napi]
pub struct AgentMcpDecision {
    machine: Option<decision::Decision>,
}
#[napi]
impl AgentMcpDecision {
    #[napi(constructor)]
    pub fn new(mode: String, key: Utf16String, path: Utf16String) -> Result<Self> {
        let mode = match mode.as_str() {
            "configure" => decision::Mode::Configure,
            "unconfigure" => decision::Mode::Unconfigure,
            _ => return Err(Error::from_reason("Invalid configuration mode")),
        };
        Ok(Self {
            machine: Some(decision::Decision::new(mode, key.to_vec(), path.to_vec())),
        })
    }
    #[napi]
    pub fn request(&self) -> Result<NativeJson> {
        Ok(decision_request(
            self.machine
                .as_ref()
                .ok_or_else(|| Error::from_reason("Decision discarded"))?
                .request(),
        ))
    }
    #[napi]
    pub fn respond(
        &mut self,
        kind: String,
        flag: bool,
        name: Option<Utf16String>,
    ) -> Result<NativeJson> {
        let response = match kind.as_str() {
            "missing" => decision::Response::Map(decision::MapState::Missing),
            "valid" => decision::Response::Map(decision::MapState::Valid),
            "invalid" => decision::Response::Map(decision::MapState::Invalid),
            "flag" => decision::Response::Flag(flag),
            "unit" => decision::Response::Unit,
            "name" => decision::Response::Name(
                name.ok_or_else(|| Error::from_reason("Conflict name is required"))?
                    .to_vec(),
            ),
            _ => return Err(Error::from_reason("Invalid decision response kind")),
        };
        let machine = self
            .machine
            .as_mut()
            .ok_or_else(|| Error::from_reason("Decision discarded"))?;
        machine.respond(response).map_err(Error::from_reason)?;
        Ok(decision_request(machine.request()))
    }
    #[napi]
    pub fn discard(&mut self) {
        self.machine = None;
    }
    #[napi]
    pub fn reset(&mut self, mode: String, key: Utf16String, path: Utf16String) -> Result<()> {
        self.machine = Self::new(mode, key, path)?.machine;
        Ok(())
    }
}

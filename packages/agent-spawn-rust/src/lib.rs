//! Independent declarative spawn planning and execution policies.
pub mod adapters;
pub mod command;
pub mod mcp;
pub mod parallel;
pub mod retry;
pub mod stream;
use agent_defs_rust::{Definition, Registry};
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};
pub(crate) fn s(v: &str) -> Value {
    Value::String(v.encode_utf16().collect())
}
pub(crate) fn o(v: Vec<(&str, Value)>) -> Value {
    Value::Object(
        v.into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
pub(crate) fn array(v: &Value) -> &[Value] {
    if let Value::Array(v) = v { v } else { &[] }
}
pub(crate) fn object(v: &Value) -> Option<&[(Vec<u16>, Value)]> {
    if let Value::Object(v) = v {
        Some(v)
    } else {
        None
    }
}
pub(crate) fn text(v: &Value) -> String {
    if let Value::String(v) = v {
        String::from_utf16_lossy(v)
    } else {
        String::new()
    }
}
fn units(v: &Value) -> &[u16] {
    if let Value::String(v) = v { v } else { &[] }
}
fn field<'a>(v: &'a Value, k: &str) -> &'a Value {
    v.get(k).unwrap_or(&Value::Null)
}
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null | Value::Bool(false) => false,
        Value::String(v) => !v.is_empty(),
        Value::Number(n) => *n != 0.0 && !n.is_nan(),
        _ => true,
    }
}
fn args(v: &Value, k: &str) -> Vec<Value> {
    array(field(v, k)).to_vec()
}
pub const MODES: [&str; 4] = ["yolo", "auto", "edit", "read"];
pub const DEFAULT_MODE: &str = "auto";
pub fn mode_config(value: &Value) -> Value {
    if matches!(value, Value::Array(_)) {
        return o(vec![("args", value.clone())]);
    }
    let mut fields = vec![(
        "args",
        value
            .get("args")
            .filter(|v| **v != Value::Null)
            .cloned()
            .unwrap_or(Value::Array(vec![])),
    )];
    if let Some(env) = value
        .get("env")
        .filter(|v| object(v).is_some_and(|v| !v.is_empty()))
    {
        fields.push(("env", env.clone()));
    }
    o(fields)
}
pub fn resolve_mode(config: &Value, mode: Option<&str>) -> Result<Value, String> {
    let selected = mode.unwrap_or(DEFAULT_MODE);
    let modes = field(config, "modes");
    let Some(value) = modes.get(selected) else {
        let supported = MODES
            .iter()
            .filter(|m| modes.get(m).is_some())
            .copied()
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "Agent \"{}\" does not support mode \"{selected}\". Supported modes: {supported}.",
            text(field(config, "agentId"))
        ));
    };
    Ok(mode_config(value))
}
pub fn environment(sources: &[Value]) -> Value {
    let mut fields: Vec<(Vec<u16>, Value)> = vec![];
    for source in sources {
        for (key, value) in object(source).unwrap_or_default() {
            if let Some(index) = fields.iter().position(|(k, _)| k == key) {
                if value == &Value::Null {
                    fields.remove(index);
                } else {
                    fields[index].1 = value.clone();
                }
            } else if value != &Value::Null {
                fields.push((key.clone(), value.clone()));
            }
        }
    }
    Value::Object(fields)
}
fn replace(source: &[u16], needle: &[u16], replacement: &[u16]) -> Vec<u16> {
    if needle.is_empty() {
        return source.to_vec();
    }
    let mut output = vec![];
    let mut index = 0;
    while index < source.len() {
        if source[index..].starts_with(needle) {
            output.extend(replacement);
            index += needle.len();
        } else {
            output.push(source[index]);
            index += 1;
        }
    }
    output
}
pub fn model_transform(config: &Value, model: &[u16]) -> Vec<u16> {
    let mut model = model.to_vec();
    for rule in array(field(config, "modelTransforms")) {
        if let Some(prefixes) = rule.get("prefixes")
            && !array(prefixes)
                .iter()
                .any(|prefix| model.starts_with(units(prefix)))
        {
            continue;
        }
        match text(field(rule, "operation")).as_str() {
            "replace" => {
                model = replace(&model, units(field(rule, "from")), units(field(rule, "to")))
            }
            "ensurePrefix" => {
                let prefix = units(field(rule, "prefix"));
                if !model.starts_with(prefix) {
                    model = [prefix, &model].concat();
                }
            }
            _ => {}
        }
    }
    model
}
fn render(template: &[u16], thread: &[u16], cwd: &[u16]) -> Vec<u16> {
    let placeholders = [
        ("{{threadId}}".encode_utf16().collect::<Vec<_>>(), thread),
        ("{{cwd}}".encode_utf16().collect::<Vec<_>>(), cwd),
    ];
    let mut result = vec![];
    let mut index = 0;
    while index < template.len() {
        if let Some((key, value)) = placeholders
            .iter()
            .find(|(key, _)| template[index..].starts_with(key))
        {
            result.extend(*value);
            index += key.len();
        } else {
            result.push(template[index]);
            index += 1;
        }
    }
    result
}
pub fn resume_args(config: &Value, thread: &[u16], cwd: &[u16], hint: bool) -> Vec<Value> {
    let key = if hint {
        "hintArgsTemplate"
    } else {
        "argsTemplate"
    };
    array(field(field(config, "resume"), key))
        .iter()
        .map(|v| Value::String(render(units(v), thread, cwd)))
        .collect()
}
pub struct Planner {
    registry: Registry,
}
impl Planner {
    pub fn builtins() -> Self {
        Self::new(Registry::builtins())
    }
    pub fn new(registry: Registry) -> Self {
        Self { registry }
    }
    pub fn definition(&self, input: &str) -> Option<&Definition> {
        let resolved = self
            .registry
            .resolve_normalized(&input.encode_utf16().collect::<Vec<_>>())?;
        self.registry
            .definitions()
            .iter()
            .find(|v| units(field(&v.metadata, "id")) == resolved)
    }
    pub fn mcp_admission(
        &self,
        agent: &str,
        servers: &Value,
        supported: bool,
        argv: bool,
        strict: bool,
    ) -> Result<bool, String> {
        if object(servers).is_none_or(|servers| servers.is_empty()) {
            return Ok(false);
        }
        mcp::validate(servers)?;
        if strict && !supported {
            return Err(format!(
                "Agent \"{agent}\" does not support MCP servers at spawn time.\nAgents with spawn-time MCP support: {}",
                self.supported_mcp().join(", ")
            ));
        }
        Ok(argv)
    }
    pub fn supports_mode(&self, input: &str, mode: &str) -> bool {
        self.definition(input)
            .and_then(|d| d.spawn_config.as_ref())
            .is_none_or(|config| {
                field(config, "kind") != &s("cli") || field(config, "modes").get(mode).is_some()
            })
    }
    pub fn catalog(&self) -> Value {
        Value::Array(
            self.registry
                .definitions()
                .iter()
                .map(|d| {
                    let mut fields = vec![
                        ("exportName", s(&d.export_name)),
                        ("metadata", d.metadata.clone()),
                    ];
                    if let Some(config) = &d.spawn_config {
                        fields.push(("spawnConfig", config.clone()));
                    }
                    if let Some(config) = &d.acp_spawn_config {
                        fields.push(("acpSpawnConfig", config.clone()));
                    }
                    o(fields)
                })
                .collect(),
        )
    }
    pub fn supported_mcp(&self) -> Vec<String> {
        let mut definitions = self
            .registry
            .definitions()
            .iter()
            .filter(|d| {
                d.spawn_config
                    .as_ref()
                    .is_some_and(|v| field(v, "kind") == &s("cli") && v.get("mcp").is_some())
            })
            .collect::<Vec<_>>();
        definitions.sort_by(|a, b| {
            let order = |d: &Definition| {
                if let Some(Value::Number(n)) = d.spawn_config.as_ref().and_then(|v| v.get("order"))
                {
                    *n
                } else {
                    f64::INFINITY
                }
            };
            order(a).total_cmp(&order(b))
        });
        definitions
            .iter()
            .map(|d| text(field(&d.metadata, "id")))
            .collect()
    }
    pub fn build(
        &self,
        input: &str,
        options: &Value,
        binary_override: Option<&[u16]>,
    ) -> Result<Value, String> {
        let definition = self
            .definition(input)
            .ok_or_else(|| format!("Unknown agent \"{input}\"."))?;
        let id = text(field(&definition.metadata, "id"));
        let config = definition
            .spawn_config
            .as_ref()
            .ok_or_else(|| format!("Agent \"{id}\" has no spawn config."))?;
        if field(config, "kind") != &s("cli") {
            return Err(format!("Agent \"{id}\" does not support CLI spawn."));
        }
        let binary = binary_override
            .map(trim_ecmascript)
            .filter(|v| !v.is_empty())
            .map(|v| Value::String(v.to_vec()))
            .or_else(|| definition.metadata.get("binaryName").cloned())
            .ok_or_else(|| format!("Agent \"{id}\" has no binaryName."))?;
        let mut public_config = object(config).unwrap().to_vec();
        public_config.push(("agentId".encode_utf16().collect(), s(&id)));
        let public_config = Value::Object(public_config);
        let servers = options
            .get("mcpServers")
            .filter(|v| object(v).is_some_and(|v| !v.is_empty()));
        let mut mcp_args = vec![];
        if let Some(servers) = servers {
            mcp::validate(servers)?;
            let spec=config.get("mcp").ok_or_else(||format!("Agent \"{id}\" does not support MCP servers at spawn time.\nAgents with spawn-time MCP support: {}",self.supported_mcp().join(", ")))?;
            if field(spec, "channel") == &s("args") {
                mcp_args = array(&mcp::serialize(servers, &text(field(spec, "format")))?).to_vec();
            }
        }
        let resume = field(options, "resumeThreadId");
        let mut resume_args1 = vec![];
        if truthy(resume) {
            if config.get("resume").is_none() {
                return Err(format!("Agent \"{id}\" does not support resumeThreadId."));
            }
            resume_args1 = resume_args(config, units(resume), units(field(options, "cwd")), false);
        }
        let default_before = field(config, "defaultArgsPosition") == &s("beforePrompt");
        let mcp_position = if let Some(position) = config.get("mcpArgsPosition") {
            text(position)
        } else if field(config, "mcpArgsBeforeCommand") == &Value::Bool(true) {
            "beforeCommand".into()
        } else {
            "afterCommand".into()
        };
        let resume_before = field(field(config, "resume"), "position") == &s("beforePrompt");
        let options_before = !resume_args1.is_empty()
            && field(field(config, "resume"), "commandOptionsPosition") == &s("beforeResume");
        let mut result = vec![];
        if mcp_position == "beforeCommand" {
            result.extend(mcp_args.clone());
        }
        if default_before {
            result.extend(args(config, "defaultArgs"));
        }
        if mcp_position == "beforePrompt" {
            result.extend(mcp_args.clone());
        }
        if truthy(field(config, "promptFlag")) {
            result.push(field(config, "promptFlag").clone());
        }
        let mut command_options = vec![];
        if let Some(Value::String(model)) = options.get("model") {
            if !model.is_empty() && trim_ecmascript(model).is_empty() {
                return Err("Model must not be blank.".into());
            }
            if !model.is_empty() && truthy(field(config, "modelFlag")) {
                let model = if field(config, "modelStripProviderPrefix") == &Value::Bool(true) {
                    &model[model.iter().position(|v| *v == 47).map_or(0, |i| i + 1)..]
                } else {
                    model
                };
                command_options.extend([
                    field(config, "modelFlag").clone(),
                    Value::String(model_transform(config, model)),
                ]);
            }
        }
        if !default_before {
            command_options.extend(args(config, "defaultArgs"));
        }
        if mcp_position == "afterCommand" {
            command_options.extend(mcp_args);
        }
        let mode = options.get("mode").filter(|v| **v != Value::Null).map(text);
        let mode = resolve_mode(&public_config, mode.as_deref())?;
        command_options.extend(args(&mode, "args"));
        let stdin = stdin_mode(config, options);
        let mut prompt_index = None;
        let push_prompt = |result: &mut Vec<Value>, index: &mut Option<usize>| {
            if let Some(stdin) = stdin {
                if field(stdin, "omitPrompt") != &Value::Bool(true) {
                    *index = Some(result.len());
                    result.push(field(options, "prompt").clone());
                }
                result.extend(args(stdin, "extraArgs"));
            } else {
                *index = Some(result.len());
                result.push(field(options, "prompt").clone());
            }
        };
        if options_before {
            result.extend(command_options);
            result.extend(args(options, "args"));
            result.extend(resume_args1);
            push_prompt(&mut result, &mut prompt_index);
        } else {
            if resume_before {
                result.extend(resume_args1.clone());
            }
            push_prompt(&mut result, &mut prompt_index);
            result.extend(command_options);
            if !resume_before {
                result.extend(resume_args1);
            }
            result.extend(args(options, "args"));
        }
        let display = result
            .iter()
            .enumerate()
            .map(|(index, value)| {
                if Some(index) == prompt_index {
                    s("[prompt redacted]")
                } else {
                    value.clone()
                }
            })
            .collect();
        let mut fields = vec![
            ("binaryName", binary),
            ("args", Value::Array(result)),
            ("displayArgs", Value::Array(display)),
        ];
        if let Some(env) = mode.get("env") {
            fields.push(("env", env.clone()));
        }
        Ok(o(fields))
    }
    pub fn acp_args(&self, input: &str, options: &Value) -> Result<Value, String> {
        let definition = self
            .definition(input)
            .ok_or_else(|| format!("Unknown agent \"{input}\"."))?;
        let config = definition
            .acp_spawn_config
            .as_ref()
            .ok_or("Agent has no ACP spawn config.")?;
        if let Some(args) = config.get("acpArgs") {
            return Ok(args.clone());
        }
        let mut result = vec![];
        for step in array(field(config, "argsRecipe")) {
            if let Some(condition) = step.get("when")
                && !truthy(field(options, &text(condition)))
            {
                continue;
            }
            if let Some(condition) = step.get("whenDefined")
                && options.get(&text(condition)).is_none()
            {
                continue;
            }
            for argument in array(field(step, "args")) {
                if matches!(argument, Value::String(_)) {
                    result.push(argument.clone());
                } else if let Some(option) = argument.get("option") {
                    result.push(field(options, &text(option)).clone());
                } else if let Some(option) = argument.get("keysOf") {
                    let mut joined = vec![];
                    let separator = units(field(argument, "join"));
                    for (index, (key, _)) in object(field(options, &text(option)))
                        .unwrap_or_default()
                        .iter()
                        .enumerate()
                    {
                        if index > 0 {
                            joined.extend(separator);
                        }
                        joined.extend(key);
                    }
                    result.push(Value::String(joined));
                } else if let Some(option) = argument.get("mapOf") {
                    let selected = options
                        .get(&text(option))
                        .filter(|v| **v != Value::Null)
                        .unwrap_or(field(argument, "default"));
                    result.push(field(field(argument, "values"), &text(selected)).clone());
                }
            }
        }
        Ok(Value::Array(result))
    }
}
fn utf8_length(value: &[u16]) -> usize {
    char::decode_utf16(value.iter().copied())
        .map(|v| v.map_or(3, char::len_utf8))
        .sum()
}
fn stdin_mode<'a>(config: &'a Value, options: &Value) -> Option<&'a Value> {
    let mode = config.get("stdinMode")?;
    let prompt = units(field(options, "prompt"));
    if field(options, "useStdin") == &Value::Bool(true)
        || prompt.contains(&0)
        || (field(mode, "automaticFallback") != &Value::Bool(false) && utf8_length(prompt) > 65536)
    {
        Some(mode)
    } else {
        None
    }
}

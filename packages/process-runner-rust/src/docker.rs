//! Portable Docker argument, environment and engine-selection policies.
use mcp_protocol_rust::json::{self, Value};
pub type Text = Vec<u16>;
fn u(text: &str) -> Text {
    text.encode_utf16().collect()
}
fn equals(value: &[u16], text: &str) -> bool {
    value.iter().copied().eq(text.encode_utf16())
}
fn append(target: &mut Text, text: &str) {
    target.extend(text.encode_utf16());
}

pub const ENGINE_ERROR: &str = "No container engine found. Please install Docker or Podman:\n  - Docker Desktop: https://www.docker.com/products/docker-desktop\n  - Colima (macOS): brew install colima && colima start\n  - Podman: https://podman.io/docs/installation";
pub fn detect_engine(
    mut available: impl FnMut(&str) -> bool,
) -> Result<&'static str, &'static str> {
    for engine in ["docker", "podman"] {
        if available(engine) {
            return Ok(engine);
        }
    }
    Err(ENGINE_ERROR)
}
pub fn context_args(engine: &[u16], context: Option<&[u16]>) -> Vec<Text> {
    if equals(engine, "docker")
        && let Some(context) = context
        && !context.is_empty()
    {
        return vec![u("--context"), context.to_vec()];
    }
    Vec::new()
}
pub fn env_args(keys: &[Text], file: Option<&[u16]>) -> Vec<Text> {
    if keys.is_empty() {
        return Vec::new();
    }
    if let Some(file) = file {
        return vec![u("--env-file"), file.to_vec()];
    }
    keys.iter().flat_map(|key| [u("-e"), key.clone()]).collect()
}
pub struct Mount {
    pub source: Text,
    pub target: Text,
    pub readonly: bool,
}
pub struct Port {
    pub host: f64,
    pub container: f64,
    pub protocol: Option<Text>,
}
pub struct RunArgs {
    pub engine: Text,
    pub context: Option<Text>,
    pub image: Text,
    pub command: Text,
    pub args: Vec<Text>,
    pub cwd: Option<Text>,
    pub env_keys: Vec<Text>,
    pub env_file: Option<Text>,
    pub mounts: Vec<Mount>,
    pub ports: Vec<Port>,
    pub network: Option<Text>,
    pub name: Text,
    pub detached: bool,
    pub interactive: bool,
    pub tty: bool,
    pub rm: bool,
    pub extra: Vec<Text>,
}
pub fn port_arg(port: &Port, index: usize) -> Result<Text, String> {
    for (value, field) in [(port.host, "host"), (port.container, "container")] {
        if !value.is_finite() || value.fract() != 0.0 || !(1.0..=65535.0).contains(&value) {
            return Err(format!(
                "Invalid Docker port mapping ports[{index}].{field}: port must be an integer from 1 to 65535."
            ));
        }
    }
    if let Some(protocol) = &port.protocol
        && !equals(protocol, "tcp")
        && !equals(protocol, "udp")
    {
        return Err(format!(
            "Invalid Docker port mapping {index}: protocol must be tcp or udp."
        ));
    }
    let mut mapping = u(&format!("{}:{}", port.host as u16, port.container as u16));
    if let Some(protocol) = &port.protocol
        && !equals(protocol, "tcp")
    {
        append(&mut mapping, "/");
        mapping.extend(protocol);
    }
    Ok(mapping)
}
pub fn run_args(input: &RunArgs) -> Result<Vec<Text>, String> {
    let mut args = vec![input.engine.clone()];
    args.extend(context_args(&input.engine, input.context.as_deref()));
    args.push(u("run"));
    for (enabled, flag) in [
        (input.rm, "--rm"),
        (input.detached, "-d"),
        (input.interactive, "-i"),
        (input.tty, "-t"),
    ] {
        if enabled {
            args.push(u(flag));
        }
    }
    args.extend([u("--name"), input.name.clone()]);
    if let Some(cwd) = &input.cwd {
        args.extend([u("-w"), cwd.clone()]);
    }
    args.extend(env_args(&input.env_keys, input.env_file.as_deref()));
    for mount in &input.mounts {
        let mut volume = mount.source.clone();
        append(&mut volume, ":");
        volume.extend(&mount.target);
        if mount.readonly {
            append(&mut volume, ":ro");
        }
        args.extend([u("-v"), volume]);
    }
    for (index, port) in input.ports.iter().enumerate() {
        args.extend([u("-p"), port_arg(port, index)?]);
    }
    if let Some(network) = &input.network {
        args.extend([u("--network"), network.clone()]);
    }
    args.extend(input.extra.clone());
    args.extend([input.image.clone(), input.command.clone()]);
    args.extend(input.args.clone());
    Ok(args)
}
pub fn serialize_env(entries: &[(Text, Text)]) -> Result<Text, String> {
    let mut output = Vec::new();
    for (index, (key, value)) in entries.iter().enumerate() {
        if key.is_empty() || key.iter().any(|c| matches!(c, 61 | 10 | 13)) {
            return Err(format!(
                "Invalid Docker environment variable name: {}",
                json::stringify(&Value::String(key.clone()))
            ));
        }
        if value.iter().any(|c| matches!(c, 10 | 13)) {
            return Err("Docker env-file values cannot contain newline characters.".to_owned());
        }
        if index > 0 {
            output.push(10);
        }
        output.extend(key);
        output.push(61);
        output.extend(value);
    }
    output.push(10);
    Ok(output)
}
fn js_whitespace(unit: u16) -> bool {
    matches!(unit,9..=13|32|160|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000|0xfeff)
}
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(v) => *v,
        Value::Number(v) => *v != 0.0 && !v.is_nan(),
        Value::String(v) => !v.is_empty(),
        _ => true,
    }
}
fn js_text(value: &Value) -> Text {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => u("null"),
        Value::Object(_) => u("[object Object]"),
        Value::Array(values) => {
            let mut text = Vec::new();
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    text.push(44);
                }
                if !matches!(value, Value::Null) {
                    text.extend(js_text(value));
                }
            }
            text
        }
        _ => u(&json::stringify(value)),
    }
}
/// A malformed line before the first match invalidates discovery. Later lines
/// are never parsed once the first running Docker profile is found.
pub fn detect_context(output: &[u16]) -> Option<Text> {
    let start = output
        .iter()
        .position(|c| !js_whitespace(*c))
        .unwrap_or(output.len());
    let end = output
        .iter()
        .rposition(|c| !js_whitespace(*c))
        .map_or(start, |index| index + 1);
    for line in output[start..end]
        .split(|c| *c == 10)
        .filter(|line| !line.is_empty())
    {
        let profile = json::parse_utf16(line, json::Limits::default()).ok()?;
        if !matches!(profile.get("status"),Some(Value::String(value)) if equals(value,"Running"))
            || !matches!(profile.get("runtime"),Some(Value::String(value)) if equals(value,"docker"))
        {
            continue;
        }
        let name = profile
            .get("name")
            .filter(|value| !matches!(value, Value::Null))
            .or_else(|| profile.get("profile"));
        let Some(name) = name.filter(|value| truthy(value)) else {
            continue;
        };
        if matches!(name,Value::String(value) if equals(value,"default")) {
            return Some(u("colima"));
        }
        let mut context = u("colima-");
        context.extend(js_text(name));
        return Some(context);
    }
    None
}

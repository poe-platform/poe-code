use crate::{array, o, object, s};
use mcp_protocol_rust::json::{self, Value};
pub fn validate(servers: &Value) -> Result<(), String> {
    let Some(servers) = object(servers) else {
        return Err("MCP servers must be an object.".into());
    };
    for (name, server) in servers {
        let name1 = String::from_utf16_lossy(name);
        if mcp_protocol_rust::strings::trim_ecmascript(name).is_empty() {
            return Err("MCP server name must be a non-empty string.".into());
        }
        if !matches!(server.get("command"),Some(Value::String(v)) if !mcp_protocol_rust::strings::trim_ecmascript(v).is_empty())
        {
            return Err(format!(
                "MCP server \"{name1}\" command must be a non-empty string."
            ));
        }
    }
    Ok(())
}
pub fn json_servers(servers: &Value) -> Result<Value, String> {
    validate(servers)?;
    let mut mapped = vec![];
    for (name, server) in object(servers).unwrap() {
        let mut fields = vec![("command", server.get("command").unwrap().clone())];
        for field in ["args", "env", "timeout"] {
            if let Some(value) = server.get(field)
                && (field == "timeout"
                    || (field == "args" && !array(value).is_empty())
                    || (field == "env" && object(value).is_some_and(|v| !v.is_empty())))
            {
                fields.push((field, value.clone()));
            }
        }
        mapped.push((name.clone(), o(fields)));
    }
    Ok(Value::Object(mapped))
}
fn string(value: &Value) -> String {
    json::stringify(value)
}
fn toml_key(value: &[u16]) -> String {
    if !value.is_empty()
        && value
            .iter()
            .all(|v| matches!(*v,48..=57|65..=90|97..=122|45|95))
    {
        String::from_utf16_lossy(value)
    } else {
        json::stringify(&Value::String(value.to_vec()))
    }
}
pub fn serialize(servers: &Value, format: &str) -> Result<Value, String> {
    validate(servers)?;
    if format == "json" {
        return Ok(Value::Array(vec![
            s("--mcp-config"),
            s(&json::stringify(&o(vec![(
                "mcpServers",
                json_servers(servers)?,
            )]))),
        ]));
    }
    let mut args = vec![];
    let mut entries = vec![];
    for (name, server) in object(servers).unwrap() {
        let name1 = String::from_utf16_lossy(name);
        let command = server.get("command").unwrap();
        let env = server.get("env").and_then(object).filter(|v| !v.is_empty());
        let timeout = server.get("timeout");
        match format {
            "codex" => {
                let prefix = format!("mcp_servers.{}", toml_key(name));
                let mut push = |field: &str, value: String| {
                    args.push(s("-c"));
                    args.push(s(&format!("{prefix}.{field}={value}")));
                };
                push("command", string(command));
                if server.get("autoApprove") != Some(&Value::Bool(false)) {
                    push("default_tools_approval_mode", string(&s("approve")));
                }
                if let Some(value) = server.get("args")
                    && !array(value).is_empty()
                {
                    push(
                        "args",
                        format!(
                            "[{}]",
                            array(value)
                                .iter()
                                .map(string)
                                .collect::<Vec<_>>()
                                .join(", ")
                        ),
                    );
                }
                if let Some(env) = env {
                    push(
                        "env",
                        format!(
                            "{{{}}}",
                            env.iter()
                                .map(|(k, v)| format!(
                                    "{}={}",
                                    string(&Value::String(k.clone())),
                                    string(v)
                                ))
                                .collect::<Vec<_>>()
                                .join(", ")
                        ),
                    );
                }
                if let Some(timeout) = timeout {
                    push("timeout", string(timeout));
                }
            }
            "goose" => {
                if env.is_some() {
                    return Err(format!(
                        "Goose MCP server \"{name1}\" does not support env through --with-extension."
                    ));
                }
                if timeout.is_some() {
                    return Err(format!(
                        "Goose MCP server \"{name1}\" does not support timeout through --with-extension."
                    ));
                }
                let mut joined = if let Value::String(command) = command {
                    command.clone()
                } else {
                    vec![]
                };
                for argument in server.get("args").map(array).unwrap_or_default() {
                    joined.push(32);
                    if let Value::String(argument) = argument {
                        joined.extend(argument);
                    }
                }
                args.extend([s("--with-extension"), Value::String(joined)]);
            }
            "opencode" => {
                if timeout.is_some() {
                    return Err(format!(
                        "OpenCode MCP server \"{name1}\" does not support timeout."
                    ));
                }
                let mut command_args = vec![command.clone()];
                command_args.extend(
                    server
                        .get("args")
                        .map(array)
                        .unwrap_or_default()
                        .iter()
                        .cloned(),
                );
                let mut fields = vec![
                    ("type", s("local")),
                    ("command", Value::Array(command_args)),
                ];
                if let Some(env) = env {
                    fields.push(("environment", Value::Object(env.to_vec())));
                }
                entries.push((name.clone(), o(fields)));
            }
            _ => return Err(format!("Unknown MCP spawn format \"{format}\".")),
        }
    }
    if format == "opencode" {
        Ok(o(vec![(
            "OPENCODE_CONFIG_CONTENT",
            s(&json::stringify(&o(vec![("mcp", Value::Object(entries))]))),
        )]))
    } else {
        Ok(Value::Array(args))
    }
}

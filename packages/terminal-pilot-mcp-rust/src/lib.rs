//! Terminal automation MCP wire policies with no registry dependencies.
use mcp_protocol_rust::json::Value;
use std::sync::OnceLock;
pub use terminal_pilot_rust::command::Fault;
use toolcraft_schema_rust::{CompiledSchema, ValidationOptions};
#[derive(Default)]
pub struct ShutdownAdmission {
    requested: bool,
}
impl ShutdownAdmission {
    pub fn shutdown(&mut self) {
        self.requested = true;
    }
    pub fn admit(&self) -> Result<(), String> {
        if self.requested {
            Err("Terminal MCP server is closing or closed".into())
        } else {
            Ok(())
        }
    }
}
struct Tool {
    definition: Value,
    output: CompiledSchema,
}
fn declarations() -> &'static [Tool] {
    static TOOLS: OnceLock<Vec<Tool>> = OnceLock::new();
    TOOLS.get_or_init(|| {
        terminal_pilot_rust::command::tools()
            .into_iter()
            .map(|definition| {
                let output = CompiledSchema::compile(
                    definition
                        .get("outputSchema")
                        .expect("terminal output schema")
                        .clone(),
                    Default::default(),
                )
                .expect("static terminal output schema");
                Tool { definition, output }
            })
            .collect()
    })
}
pub fn tools() -> Vec<Value> {
    declarations()
        .iter()
        .map(|tool| tool.definition.clone())
        .collect()
}
fn wire(value: &Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, value)| {
                    let key = if key == &"exitCode".encode_utf16().collect::<Vec<_>>() {
                        "exit_code".encode_utf16().collect()
                    } else {
                        key.clone()
                    };
                    (key, wire(value))
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(wire).collect()),
        _ => value.clone(),
    }
}
pub fn result(name: &str, value: &Value) -> Result<Value, Fault> {
    let name = Value::String(name.encode_utf16().collect());
    let tool = declarations()
        .iter()
        .find(|tool| tool.definition.get("name") == Some(&name))
        .ok_or_else(|| Fault {
            code: -32602,
            message: "Unknown terminal tool".into(),
        })?;
    let value = wire(value);
    let issues = tool
        .output
        .validate(&value, ValidationOptions::default())
        .map_err(|message| Fault {
            code: -32603,
            message,
        })?;
    if let Some(issue) = issues.first() {
        return Err(Fault {
            code: -32603,
            message: format!(
                "Invalid terminal result at {}: {}",
                issue
                    .path
                    .iter()
                    .map(|p| String::from_utf16_lossy(p))
                    .collect::<Vec<_>>()
                    .join("."),
                String::from_utf16_lossy(&issue.message)
            ),
        });
    }
    Ok(value)
}
pub fn cli(arguments: &[String]) -> Result<bool, String> {
    let mut help = false;
    let mut positionals = false;
    for argument in arguments {
        if !positionals && argument == "--" {
            positionals = true;
            continue;
        }
        if !positionals && argument == "--help" {
            help = true;
        } else if !positionals && argument.starts_with("--help=") {
            return Err("Option '-h, --help' does not take an argument".into());
        } else if !positionals && argument.starts_with("--") {
            let name = argument
                .split_once('=')
                .map_or(argument.as_str(), |(name, _)| name);
            return Err(format!("Unknown option '{name}'"));
        } else if !positionals && argument.starts_with('-') && argument.len() > 1 {
            for short in argument[1..].chars() {
                if short != 'h' {
                    return Err(format!("Unknown option '-{short}'"));
                }
                help = true;
            }
        } else {
            return Err(format!(
                "Unexpected argument '{argument}'. This command does not take positional arguments"
            ));
        }
    }
    Ok(help)
}
pub const HELP: &str = "Usage: terminal-pilot-mcp-rust [options]\n\nServe MCP over stdio.\n\nOptions:\n  -h, --help  Show this help message\n";

//! Scoped MCP tool enumeration and collision admission over live command trees.
use crate::host::Host;
use crate::sdk_validation::yes;

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    match (operation, args) {
        ("enumerate", [root, casing, allowlist, omit]) => {
            let state = c!("state", *casing, *allowlist);
            let skip_root = if yes(host, "truthy", vec![*omit])? {
                true
            } else {
                let name = host.get(*root, "name")?;
                yes(host, "empty", vec![name])?
            };
            let root_path = if skip_root {
                c!("array")
            } else {
                c!("rootPath", *root)
            };
            c!("roots", *root, root_path, state);
            host.get(state, "tools")
        }
        ("visit", [state, node, tool_path, command_path]) => {
            let kind = host.get(*node, "kind")?;
            if host.is_kind(kind, "command")? {
                let scope = host.get(*node, "scope")?;
                if !yes(host, "mcpScope", vec![scope])? {
                    return host.call("undefined", vec![]);
                }
                let name = c!("toolName", *tool_path, *node);
                let raw_params = host.get(*node, "params")?;
                let params = c!("filter", raw_params);
                let allowlist = host.get(*state, "allowlist")?;
                if !yes(host, "allow", vec![name, allowlist])? {
                    return host.call("undefined", vec![]);
                }
                let valid_params = if host.is_undefined(params)? {
                    false
                } else {
                    let kind = host.get(params, "kind")?;
                    host.is_kind(kind, "object")?
                };
                if !valid_params {
                    return host.call("invalidParams", vec![name]);
                }
                let casing = host.get(*state, "casing")?;
                c!("validateMembers", params, casing);
                let result = host.get(*node, "result")?;
                if !host.is_undefined(result)? {
                    let result = host.get(*node, "result")?;
                    c!("validateMembers", result, casing);
                }
                let stream = host.get(*node, "stream")?;
                if !host.is_undefined(stream)? {
                    let stream = host.get(*node, "stream")?;
                    let event = host.get(stream, "event")?;
                    c!("validateMembers", event, casing);
                }
                let resolved_path = c!("commandPath", *command_path, *node);
                let paths = host.get(*state, "paths")?;
                let existing = c!("getPath", paths, name);
                if !host.is_undefined(existing)? {
                    return host.call("conflict", vec![existing, resolved_path, name]);
                }
                c!("setPath", paths, name, resolved_path);
                let tools = host.get(*state, "tools")?;
                c!(
                    "definition",
                    tools,
                    *node,
                    resolved_path,
                    name,
                    params,
                    casing
                );
            } else {
                let next_tool = c!("appendName", *tool_path, *node);
                let next_command = c!("appendName", *command_path, *node);
                c!("children", *node, *state, next_tool, next_command);
            }
            host.call("undefined", vec![])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

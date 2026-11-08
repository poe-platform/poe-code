use super::{object, rpc_error, string_matches};
use mcp_protocol_rust::{
    formats::{is_base64, is_valid_uri},
    json::{self, Limits, Value},
    jsonrpc::RpcError,
    metadata::is_valid_metadata_key,
};
use std::{collections::BTreeSet, sync::OnceLock};
use toolcraft_schema_rust::{CompiledSchema, FormatValidator, ValidationOptions};

pub const DEFINITIONS: [&str; 16] = [
    "InputRequest",
    "InputResponses",
    "ClientCapabilities",
    "ElicitResult",
    "CreateMessageResult",
    "ListRootsResult",
    "DiscoverResult",
    "ListToolsResult",
    "CallToolResult",
    "ListPromptsResult",
    "GetPromptResult",
    "ListResourcesResult",
    "ListResourceTemplatesResult",
    "ReadResourceResult",
    "CompleteResult",
    "Result",
];
static VALIDATORS: [OnceLock<CompiledSchema>; DEFINITIONS.len()] =
    [const { OnceLock::new() }; DEFINITIONS.len()];

struct ProtocolFormats;
impl FormatValidator for ProtocolFormats {
    fn check(&mut self, name: &[u16], value: &[u16]) -> Result<Option<bool>, String> {
        let known = if name.iter().copied().eq("mcp-metadata-key".encode_utf16()) {
            is_valid_metadata_key(value)
        } else if name.iter().copied().eq("mcp-extension-key".encode_utf16()) {
            value.contains(&(b'/' as u16)) && is_valid_metadata_key(value)
        } else if name.iter().copied().eq("uri".encode_utf16()) {
            is_valid_uri(value)
        } else if name.iter().copied().eq("byte".encode_utf16()) {
            is_base64(value)
        } else {
            return Ok(None);
        };
        Ok(Some(known))
    }
}

/// Validate a normative MCP definition with our own JSON Schema evaluator.
/// Embedded schemas and cached graphs contain no SDK code or host references.
pub fn validate_definition(definition: &str, value: &Value) -> bool {
    if !value.is_json_value() {
        return false;
    }
    let Some(index) = DEFINITIONS.iter().position(|name| *name == definition) else {
        return false;
    };
    if definition == "ListRootsResult"
        && let Some(Value::Array(roots)) = value.get("roots")
        && !roots.iter().all(|root| matches!(root.get("uri"), Some(Value::String(uri)) if uri.starts_with(&"file://".encode_utf16().collect::<Vec<_>>()) && is_valid_uri(uri))) { return false; }
    let validator = VALIDATORS[index].get_or_init(|| {
        CompiledSchema::compile(schema_for(definition), Default::default())
            .expect("vendored normative protocol schema compiles")
    });
    validator
        .validate(
            value,
            ValidationOptions {
                formats: Some(&mut ProtocolFormats),
            },
        )
        .is_ok_and(|issues| issues.is_empty())
}

fn schema_for(definition: &str) -> Value {
    let mut schema = json::parse(include_bytes!("../schema/protocol.json"), Limits::default())
        .expect("vendored normative protocol schema is valid JSON");
    let Value::Object(fields) = &mut schema else {
        unreachable!("protocol schema object");
    };
    let (_, Value::Object(definitions)) = fields
        .iter_mut()
        .find(|(name, _)| name.iter().copied().eq("$defs".encode_utf16()))
        .expect("protocol schema definitions")
    else {
        unreachable!("definitions object");
    };
    let root: Vec<u16> = definition.encode_utf16().collect();
    let mut reachable = BTreeSet::from([root.clone()]);
    let mut remaining = vec![root];
    let prefix: Vec<u16> = "#/$defs/".encode_utf16().collect();
    while let Some(name) = remaining.pop() {
        let (_, value) = definitions
            .iter()
            .find(|(key, _)| *key == name)
            .expect("normative definition exists");
        let mut pending = vec![value];
        while let Some(value) = pending.pop() {
            match value {
                Value::Object(properties) => {
                    if let Some(Value::String(reference)) = value.get("$ref")
                        && let Some(name) = reference.strip_prefix(prefix.as_slice())
                        && reachable.insert(name.to_vec())
                    {
                        remaining.push(name.to_vec());
                    }
                    pending.extend(properties.iter().map(|(_, value)| value));
                }
                Value::Array(values) => pending.extend(values),
                _ => {}
            }
        }
    }
    definitions.retain(|(name, _)| reachable.contains(name));
    super::put(
        fields,
        "$ref",
        super::string(&format!("#/$defs/{definition}")),
    );
    schema
}

pub fn validate_input_required(
    method: &str,
    value: &Value,
    capabilities: &Value,
) -> Result<(), RpcError> {
    let invalid = || rpc_error(-32603, "Invalid MCP input_required result");
    if !["tools/call", "prompts/get", "resources/read"].contains(&method)
        || (value.get("inputRequests").is_none() && value.get("requestState").is_none())
        || value
            .get("requestState")
            .is_some_and(|state| !matches!(state, Value::String(_)))
    {
        return Err(invalid());
    }
    let mut required = Vec::new();
    if let Some(requests) = value.get("inputRequests") {
        let Value::Object(requests) = requests else {
            return Err(invalid());
        };
        if !value
            .get("inputRequests")
            .expect("requests present")
            .is_json_value()
        {
            return Err(invalid());
        }
        for (_, request) in requests {
            if !validate_definition("InputRequest", request) {
                return Err(invalid());
            }
            let params = request.get("params");
            let capability = if string_matches(request.get("method"), "roots/list") {
                "roots"
            } else if string_matches(request.get("method"), "sampling/createMessage") {
                "sampling"
            } else if string_matches(request.get("method"), "elicitation/create") {
                "elicitation"
            } else {
                return Err(invalid());
            };
            if params.is_some_and(|params| !matches!(params, Value::Object(_))) {
                return Err(invalid());
            }
            let uses_tools = if capability == "sampling" {
                let Some(Value::Array(messages)) = params.and_then(|params| params.get("messages"))
                else {
                    return Err(invalid());
                };
                sampling_messages(messages).ok_or_else(invalid)?
            } else {
                false
            };
            let supported = capabilities.get(capability);
            if !matches!(supported, Some(Value::Object(_))) {
                super::put(&mut required, capability, object([]));
            } else if capability == "elicitation" {
                let supported = supported.expect("capability object");
                let mode = params.and_then(|params| params.get("mode"));
                let form = mode.is_none() || string_matches(mode, "form");
                let implicit_form =
                    form && matches!(supported, Value::Object(fields) if fields.is_empty());
                let key = if form { "form" } else { "url" };
                if !implicit_form && !matches!(supported.get(key), Some(Value::Object(_))) {
                    require_subcapability(&mut required, capability, key);
                }
            } else if capability == "sampling" {
                let params = params.expect("sampling params object");
                if (params.get("tools").is_some()
                    || params.get("toolChoice").is_some()
                    || uses_tools)
                    && !matches!(
                        supported.and_then(|supported| supported.get("tools")),
                        Some(Value::Object(_))
                    )
                {
                    require_subcapability(&mut required, capability, "tools");
                }
            }
        }
    }
    if !required.is_empty() {
        return Err(RpcError {
            code: -32021,
            message: "Missing required client capability".into(),
            data: Some(object([("requiredCapabilities", Value::Object(required))])),
        });
    }
    Ok(())
}

fn require_subcapability(required: &mut Vec<(Vec<u16>, Value)>, capability: &str, key: &str) {
    let name: Vec<u16> = capability.encode_utf16().collect();
    if let Some((_, Value::Object(fields))) = required.iter_mut().find(|(field, _)| *field == name)
    {
        super::put(fields, key, object([]));
    } else {
        required.push((name, object([(key, object([]))])));
    }
}

// Field validation happens first. Enforce the transcript relationships which
// cannot be expressed by individual message/content JSON Schemas.
fn sampling_messages(messages: &[Value]) -> Option<bool> {
    let mut pending: Option<BTreeSet<Vec<u16>>> = None;
    let mut seen = BTreeSet::new();
    let mut uses_tools = false;
    for message in messages {
        let content = message.get("content")?;
        let blocks: &[Value] = match content {
            Value::Array(blocks) => blocks,
            value => std::slice::from_ref(value),
        };
        if let Some(expected) = &mut pending {
            if !string_matches(message.get("role"), "user") {
                return None;
            }
            for block in blocks {
                if !string_matches(block.get("type"), "tool_result") {
                    return None;
                }
                let Some(Value::String(id)) = block.get("toolUseId") else {
                    return None;
                };
                if !expected.remove(id) {
                    return None;
                }
            }
            if !expected.is_empty() {
                return None;
            }
            pending = None;
            continue;
        }
        for block in blocks {
            if string_matches(block.get("type"), "tool_result") {
                return None;
            }
            if !string_matches(block.get("type"), "tool_use") {
                continue;
            }
            let Some(Value::String(id)) = block.get("id") else {
                return None;
            };
            if !string_matches(message.get("role"), "assistant") || !seen.insert(id.clone()) {
                return None;
            }
            pending.get_or_insert_with(BTreeSet::new).insert(id.clone());
            uses_tools = true;
        }
    }
    pending.is_none().then_some(uses_tools)
}

#[cfg(test)]
mod tests {
    #[test]
    fn capability_validation_retains_only_reachable_normative_definitions() {
        let schema = super::schema_for("ClientCapabilities");
        let Some(mcp_protocol_rust::json::Value::Object(definitions)) = schema.get("$defs") else {
            panic!("schema definitions missing");
        };
        assert!(
            definitions.len() <= 8,
            "unrelated protocol schemas retained: {}",
            definitions.len()
        );
        for name in ["ClientCapabilities", "JSONObject", "JSONValue"] {
            assert!(schema.get("$defs").unwrap().get(name).is_some());
        }
        assert!(schema.get("$defs").unwrap().get("ImageContent").is_none());
    }
}

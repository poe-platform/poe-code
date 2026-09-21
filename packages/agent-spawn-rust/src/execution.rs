//! Portable execution policies. Host adapters supply filesystem and process effects.
use crate::object;
use mcp_protocol_rust::json::Value;
pub fn merge_mcp(existing: &Value, addition: &Value) -> Result<Value, String> {
    let mut merged = object(existing)
        .ok_or("Existing MCP config JSON must contain an object.")?
        .to_vec();
    for (key, value) in object(addition).ok_or("MCP config additions must contain an object.")? {
        if let Some(index) = merged.iter().position(|(candidate, _)| candidate == key) {
            merged[index].1 = if object(&merged[index].1).is_some() && object(value).is_some() {
                merge_mcp(&merged[index].1, value)?
            } else {
                value.clone()
            };
        } else {
            merged.push((key.clone(), value.clone()));
        }
    }
    Ok(Value::Object(merged))
}

/// Interactive launch arguments from the same provider definition, without headless defaults.
pub fn interactive_plan(
    config: &Value,
    options: &Value,
    binary: Value,
    mcp_args: Vec<Value>,
    resume: Vec<Value>,
) -> Result<Value, String> {
    use crate::{args, field, model_transform, o, resolve_mode, s, text, truthy};
    use mcp_protocol_rust::strings::trim_ecmascript;
    let interactive = config.get("interactive").ok_or_else(|| {
        format!(
            "Agent \"{}\" does not support interactive mode.",
            text(field(config, "agentId"))
        )
    })?;
    let before = field(interactive, "defaultArgsPosition") == &s("beforePrompt");
    let resume_before = field(field(config, "resume"), "position") == &s("beforePrompt");
    let mut output = vec![];
    let mut prompt_index = None;
    if before {
        output.extend(args(interactive, "defaultArgs"));
    }
    if truthy(field(options, "prompt")) {
        if truthy(field(interactive, "promptFlag")) {
            output.push(field(interactive, "promptFlag").clone());
        }
        if resume_before {
            output.extend(resume.clone());
        }
        prompt_index = Some(output.len());
        output.push(field(options, "prompt").clone());
    } else if resume_before {
        output.extend(resume.clone());
    }
    if let Some(Value::String(model)) = options.get("model") {
        if !model.is_empty() && trim_ecmascript(model).is_empty() {
            return Err("Model must not be blank.".into());
        }
        if !model.is_empty() && truthy(field(config, "modelFlag")) {
            let model = if field(config, "modelStripProviderPrefix") == &Value::Bool(true) {
                &model[model.iter().position(|v| *v == 47).map_or(0, |v| v + 1)..]
            } else {
                model
            };
            output.extend([
                field(config, "modelFlag").clone(),
                Value::String(model_transform(config, model)),
            ]);
        }
    }
    if !before {
        output.extend(args(interactive, "defaultArgs"));
    }
    output.extend(mcp_args);
    let mode = options.get("mode").filter(|v| **v != Value::Null).map(text);
    let mode = resolve_mode(config, mode.as_deref())?;
    output.extend(args(&mode, "args"));
    if !resume_before {
        output.extend(resume);
    }
    output.extend(args(options, "args"));
    let display = output
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
        ("args", Value::Array(output)),
        ("displayArgs", Value::Array(display)),
    ];
    if let Some(env) = mode.get("env") {
        fields.push(("env", env.clone()));
    }
    Ok(o(fields))
}

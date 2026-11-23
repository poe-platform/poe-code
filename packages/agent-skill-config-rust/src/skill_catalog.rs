//! Skill skill metadata and Codex-style prompt rendering, without host callbacks.
use crate::u;
use config_mutations_rust::{value::Value, yaml};
use mcp_protocol_rust::strings::trim_ecmascript;

pub struct Skill {
    pub name: Vec<u16>,
    pub file: Vec<u16>,
    pub content: Vec<u16>,
}

fn metadata(content: &[u16]) -> Result<Value, &'static str> {
    let lines: Vec<_> = content.split(|unit| *unit == 10).collect();
    if trim_ecmascript(lines[0]) != [45, 45, 45] {
        return Ok(Value::Object(vec![]));
    }
    let end = lines
        .iter()
        .enumerate()
        .skip(1)
        .find(|(_, line)| trim_ecmascript(line) == [45, 45, 45])
        .map(|(index, _)| index)
        .ok_or("Missing closing frontmatter delimiter.")?;
    let raw = lines[1..end].join(&10);
    let parsed = yaml::parse_with_options(
        &raw,
        None,
        yaml::ParseOptions {
            unique_keys: true,
            object_root: false,
            ..Default::default()
        },
    )
    .map_err(|_| "Invalid YAML frontmatter.")?;
    if parsed.value == Value::Null {
        return Ok(Value::Object(vec![]));
    }
    if !parsed.plain_mapping || !matches!(parsed.value, Value::Object(_)) {
        return Err("Skill frontmatter must be a mapping.");
    }
    Ok(parsed.value)
}

fn escape(value: &[u16]) -> Vec<u16> {
    let mut output = Vec::new();
    for unit in value {
        let replacement = match unit {
            38 => "&amp;",
            60 => "&lt;",
            62 => "&gt;",
            34 => "&quot;",
            39 => "&apos;",
            10 | 13 => " ",
            _ => {
                output.push(*unit);
                continue;
            }
        };
        output.extend(replacement.encode_utf16());
    }
    output
}

fn row(file: &Skill) -> Result<Option<Vec<u16>>, &'static str> {
    let metadata = metadata(&file.content)?;
    let name = match metadata.get("name") {
        None => file.name.as_slice(),
        Some(Value::String(name)) => name,
        _ => return Err("Skill name must be a nonempty string."),
    };
    let name = trim_ecmascript(name);
    if name.is_empty() {
        return Err("Skill name must be a nonempty string.");
    }
    let description = match metadata.get("description") {
        None => &[][..],
        Some(Value::String(description)) => trim_ecmascript(description),
        _ => return Err("Skill description must be a string."),
    };
    match metadata.get("disable-model-invocation") {
        Some(Value::Bool(true)) => return Ok(None),
        None | Some(Value::Bool(false)) => {}
        _ => return Err("disable-model-invocation must be a boolean."),
    }
    let mut result = [u("- "), escape(name), u(": ")].concat();
    if !description.is_empty() {
        result.extend(escape(description));
        result.push(32);
    }
    result.extend([u("(file: "), escape(&file.file), u(")")].concat());
    Ok(Some(result))
}

fn fill(template: &str, marker: &str, content: &[u16]) -> Vec<u16> {
    let (before, after) = template
        .trim()
        .split_once(marker)
        .expect("Bundled catalog placeholder");
    [u(before), content.to_vec(), u(after)].concat()
}

pub fn render(files: &[Skill]) -> Option<Vec<u16>> {
    let mut skills = Vec::new();
    let mut diagnostics = Vec::new();
    for file in files {
        match row(file) {
            Ok(Some(line)) => skills.push(line),
            Ok(None) => {}
            Err(message) => {
                diagnostics.push([u("- "), escape(&file.file), u(": "), u(message)].concat())
            }
        }
    }
    if skills.is_empty() && diagnostics.is_empty() {
        return None;
    }
    if !diagnostics.is_empty() {
        skills.push(vec![]);
        skills.push(fill(
            include_str!("../../agent-skill-config/src/templates/skill-catalog-diagnostics.md"),
            "{{diagnostics}}",
            &diagnostics.join(&10),
        ));
    }
    Some(fill(
        include_str!("../../agent-skill-config/src/templates/skill-catalog.md"),
        "{{catalog}}",
        &skills.join(&10),
    ))
}

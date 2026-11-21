//! Render discovered skill metadata without including instruction bodies.
use config_mutations_rust::{value::Value, yaml};
use mcp_protocol_rust::strings::trim_ecmascript;
use std::collections::HashSet;

pub struct Skill {
    pub name: Vec<u16>,
    pub file: Vec<u16>,
    pub content: Vec<u16>,
}

fn escape(value: &[u16]) -> Vec<u16> {
    let mut result = vec![];
    for &unit in value {
        let entity = match unit {
            38 => "&amp;",
            60 => "&lt;",
            62 => "&gt;",
            34 => "&quot;",
            39 => "&apos;",
            _ => {
                result.push(unit);
                continue;
            }
        };
        result.extend(entity.encode_utf16());
    }
    result
}

fn tag(output: &mut Vec<u16>, name: &str, value: &[u16]) {
    output.extend(format!("<{name}>").encode_utf16());
    output.extend(escape(value));
    output.extend(format!("</{name}>").encode_utf16());
}

fn metadata(content: &[u16]) -> Result<Value, Vec<u16>> {
    let lines: Vec<_> = content.split(|&unit| unit == 10).collect();
    let fence = [45, 45, 45];
    if trim_ecmascript(lines[0]) != fence {
        return Ok(Value::Null);
    }
    let end = (1..lines.len())
        .find(|&index| trim_ecmascript(lines[index]) == fence)
        .ok_or_else(|| super::u("Missing closing frontmatter delimiter."))?;
    let source = lines[1..end].join(&10);
    let parsed = yaml::parse_with_options(
        &source,
        None,
        yaml::ParseOptions {
            object_root: false,
            ..Default::default()
        },
    )
    .map_err(|error| super::u(&error.reason))?;
    if parsed.value != Value::Null && !parsed.plain_mapping {
        return Err(super::u("Skill frontmatter must be a mapping."));
    }
    Ok(parsed.value)
}

fn entry(skill: &Skill, names: &mut HashSet<Vec<u16>>) -> Result<Option<Vec<u16>>, Vec<u16>> {
    let metadata = metadata(&skill.content)?;
    let name = match metadata.get("name") {
        Some(Value::String(name)) => name,
        None => &skill.name,
        _ => return Err(super::u("Skill name must be a nonempty string.")),
    };
    let name = trim_ecmascript(name);
    if name.is_empty() {
        return Err(super::u("Skill name must be a nonempty string."));
    }
    let description = match metadata.get("description") {
        Some(Value::String(description)) => trim_ecmascript(description),
        None => &[],
        _ => return Err(super::u("Skill description must be a string.")),
    };
    let disabled = match metadata.get("disable-model-invocation") {
        Some(Value::Bool(disabled)) => *disabled,
        None => false,
        _ => return Err(super::u("disable-model-invocation must be a boolean.")),
    };
    if !names.insert(name.to_vec()) {
        let mut error = super::u("Duplicate skill name: ");
        error.extend(name);
        return Err(error);
    }
    if disabled {
        return Ok(None);
    }
    let mut output = super::u("<skill>\n");
    tag(&mut output, "name", name);
    output.push(10);
    tag(&mut output, "description", description);
    output.push(10);
    tag(&mut output, "location", &skill.file);
    output.extend("\n</skill>".encode_utf16());
    Ok(Some(output))
}

pub fn render(files: &[Skill]) -> Option<Vec<u16>> {
    let mut names = HashSet::new();
    let mut skills = vec![];
    let mut diagnostics = vec![];
    for file in files {
        match entry(file, &mut names) {
            Ok(Some(skill)) => skills.push(skill),
            Ok(None) => {}
            Err(error) => {
                let mut diagnostic = super::u("<diagnostic>");
                tag(&mut diagnostic, "location", &file.file);
                tag(&mut diagnostic, "message", &error);
                diagnostic.extend("</diagnostic>".encode_utf16());
                diagnostics.push(diagnostic);
            }
        }
    }
    if skills.is_empty() && diagnostics.is_empty() {
        return None;
    }
    let mut lines = vec![super::u("<available_skills>")];
    lines.extend(skills);
    lines.push(super::u("</available_skills>"));
    if !diagnostics.is_empty() {
        lines.push(super::u("<skill_diagnostics>"));
        lines.extend(diagnostics);
        lines.push(super::u("</skill_diagnostics>"));
    }
    Some(lines.join(&10))
}

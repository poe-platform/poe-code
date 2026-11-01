use config_mutations_rust::{config_data, value::Value as Yaml, yaml};
use mcp_protocol_rust::json::Value;

// YAML diagnostics use UTF-16 columns, including leading whitespace after "init:".
fn yaml_error(raw: &[u16], err: yaml::Error) -> String {
    let at = err.offset.min(raw.len());
    let start = raw[..at]
        .iter()
        .rposition(|c| *c == 10)
        .map_or(0, |i| i + 1);
    let end = raw[at..]
        .iter()
        .position(|c| *c == 10)
        .map_or(raw.len(), |i| at + i);
    let line = raw[..start].iter().filter(|c| **c == 10).count() + 1;
    let column = at - start + 1;
    let mut reason = err.reason;
    if reason.contains("flow mapping")
        || reason.contains("flow sequence")
        || reason.contains("expected node content")
    {
        // The scanner reports the bad closer. The JS diagnostic describes the
        // collection that was still open there, distinguishing root from nested.
        let mut open = Vec::new();
        let mut quote = None;
        let mut escape = false;
        let mut comment = false;
        for (i, &c) in raw[..at].iter().enumerate() {
            if comment {
                comment = c != 10;
                continue;
            }
            if escape {
                escape = false;
                continue;
            }
            if let Some(q) = quote {
                if c == 92 && q == 34 {
                    escape = true;
                }
                if c == q {
                    quote = None;
                }
            } else {
                match c {
                    34 | 39 => quote = Some(c),
                    35 if i == 0 || matches!(raw[i - 1], 9 | 10 | 13 | 32) => comment = true,
                    91 | 123 => open.push((i, c)),
                    93 | 125 => {
                        open.pop();
                    }
                    _ => (),
                }
            }
        }
        if let Some((i, c)) = open.pop() {
            let (name, end) = if c == 91 {
                ("sequence", ']')
            } else {
                ("map", '}')
            };
            let nested = raw[..i].iter().any(|c| !matches!(c, 9 | 10 | 13 | 32));
            reason = if nested {
                format!(
                    "Flow {name} in block collection must be sufficiently indented and end with a {end}"
                )
            } else {
                format!("Flow {name} must end with a {end}")
            };
        } else if let Some(c @ (93 | 125)) = raw.get(at) {
            let name = if *c == 125 { "map" } else { "seq" };
            reason = format!(
                "Unexpected flow-{name}-end token in YAML document: \"{}\"",
                char::from_u32(*c as u32).unwrap()
            );
        }
    }
    format!(
        "mmdc: E_CONFIG: {reason} at line {line}, column {column}:\n\n{}\n{}^\n\n",
        String::from_utf16_lossy(&raw[start..end]),
        " ".repeat(column - 1)
    )
}

fn mapping(text: &str) -> Result<Yaml, String> {
    let raw: Vec<_> = text.encode_utf16().collect();
    // Mermaid disables YAML aliases before conversion to ordinary JS objects.
    if raw.contains(&42)
        && yaml::document::scan(&raw).is_ok_and(|d| {
            d.nodes
                .iter()
                .any(|n| n.kind == yaml::document::Kind::Alias)
        })
    {
        return Err("shell: line 1: internal error\n".into());
    }
    let parsed = yaml::parse_with_options(
        &raw,
        None,
        yaml::ParseOptions {
            object_root: false,
            unique_keys: true,
        },
    )
    .map_err(|e| yaml_error(&raw, e))?
    .value;
    if !matches!(parsed, Yaml::Object(_)) {
        return Err("mmdc: E_CONFIG: Mermaid configuration must be a mapping\n".into());
    }
    Ok(parsed)
}

fn json(value: Yaml) -> Value {
    match value {
        Yaml::Bool(b) => Value::Bool(b),
        Yaml::Number(n) => Value::Number(n),
        Yaml::String(s) => Value::String(s),
        Yaml::Array(a) => Value::Array(a.into_iter().map(json).collect()),
        Yaml::Object(pairs) => Value::Object(
            pairs
                .into_iter()
                .filter(|(k, _)| {
                    !matches!(
                        String::from_utf16_lossy(k).as_ref(),
                        "__proto__" | "constructor" | "prototype"
                    )
                })
                .map(|(k, v)| (k, json(v)))
                .collect(),
        ),
        _ => Value::Null,
    }
}

pub(in super::super) fn directives(
    bodies: Vec<&str>,
    limit: usize,
) -> Result<Option<Value>, String> {
    let mut merged = None;
    let mut total = 0usize;
    let mut work = limit;
    for body in bodies {
        let Some((key, text)) = body.trim().split_once(':') else {
            continue;
        };
        if !matches!(key.trim(), "init" | "initialize") {
            continue;
        }
        total = total.saturating_add(text.len());
        work = work
            .checked_sub(total)
            .ok_or("mmdc: E_LIMIT: Render work budget exceeded\n")?;
        let value = mapping(text)?;
        merged = Some(match merged {
            None => value,
            Some(old) => config_data::merge(&old, &value, None)
                .map_err(|e| format!("mmdc: E_CONFIG: {e}\n"))?,
        });
    }
    Ok(merged.map(json))
}

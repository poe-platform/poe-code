//! Document admission and extends extraction, independent of filesystem access.
use config_mutations_rust::{value::Value, yaml};
use mcp_protocol_rust::json;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Markdown,
    Yaml,
    Json,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Extends {
    Disabled,
    Enabled,
    Path(Vec<u16>),
}
#[derive(Debug)]
pub struct ParsedDocument {
    pub yaml: yaml::Parsed,
    pub format: Format,
    pub extends: Extends,
    pub has_extends: bool,
}
#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    pub message: Vec<u16>,
}
fn error(message: impl AsRef<str>) -> Error {
    Error {
        message: message.as_ref().encode_utf16().collect(),
    }
}
fn named(prefix: &str, path: &[u16], suffix: &str) -> Error {
    let mut message: Vec<u16> = prefix.encode_utf16().collect();
    message.extend(path);
    message.extend(suffix.encode_utf16());
    Error { message }
}
fn equals(units: &[u16], text: &str) -> bool {
    units.iter().copied().eq(text.encode_utf16())
}
fn format(source: &[u16], extension: &[u16]) -> Format {
    if equals(extension, ".md") {
        return Format::Markdown;
    }
    if equals(extension, ".yaml") || equals(extension, ".yml") {
        return Format::Yaml;
    }
    if equals(extension, ".json") || source.first() == Some(&123) {
        return Format::Json;
    }
    if source.starts_with(&[45, 45, 45, 10]) || source.starts_with(&[45, 45, 45, 13]) {
        return Format::Markdown;
    }
    Format::Yaml
}
fn empty(value: Value) -> yaml::Parsed {
    yaml::Parsed {
        value,
        date_ids: vec![],
        symbol_ids: vec![],
    }
}
fn from_json(value: json::Value) -> Value {
    match value {
        json::Value::Null => Value::Null,
        json::Value::Bool(value) => Value::Bool(value),
        json::Value::Number(value) => Value::Number(value),
        json::Value::String(value) => Value::String(value),
        json::Value::Array(items) => Value::Array(items.into_iter().map(from_json).collect()),
        json::Value::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(key, value)| (key, from_json(value)))
                .collect(),
        ),
    }
}
fn whitespace(unit: u16) -> bool {
    matches!(unit, 9..=13 | 32 | 160 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
fn extends(
    value: Option<&Value>,
    file: &[u16],
    absolute: &mut dyn FnMut(&[u16]) -> bool,
) -> Result<Extends, Error> {
    let reason = match value {
        None | Some(Value::Undefined | Value::Bool(false)) => return Ok(Extends::Disabled),
        Some(Value::Bool(true)) => return Ok(Extends::Enabled),
        Some(Value::String(value)) => {
            let start = value
                .iter()
                .position(|unit| !whitespace(*unit))
                .unwrap_or(value.len());
            let end = value
                .iter()
                .rposition(|unit| !whitespace(*unit))
                .map_or(start, |index| index + 1);
            let path = &value[start..end];
            if path.is_empty() {
                "expected a non-empty relative path."
            } else if absolute(path) {
                "expected a relative path."
            } else {
                return Ok(Extends::Path(path.to_vec()));
            }
        }
        _ => "expected a boolean or relative string path.",
    };
    let mut message: Vec<u16> = "Invalid extends value in ".encode_utf16().collect();
    message.extend_from_slice(file);
    message.extend(": ".encode_utf16());
    message.extend(reason.encode_utf16());
    Err(Error { message })
}
// Alias IDs are indexed by depth-first traversal, not by property name.
fn remove_field(parsed: &mut yaml::Parsed, key: &str) {
    let Value::Object(fields) = &mut parsed.value else {
        return;
    };
    let mut dates = parsed.date_ids.iter().copied();
    let mut symbols = parsed.symbol_ids.iter().copied();
    let mut retained_dates = vec![];
    let mut retained_symbols = vec![];
    for (name, value) in fields.iter() {
        let keep = !equals(name, key);
        let mut pending = vec![value];
        while let Some(value) = pending.pop() {
            match value {
                Value::Date(_) => {
                    if let Some(id) = dates.next()
                        && keep
                    {
                        retained_dates.push(id);
                    }
                }
                Value::Symbol(_) => {
                    if let Some(id) = symbols.next()
                        && keep
                    {
                        retained_symbols.push(id);
                    }
                }
                Value::Array(items) => pending.extend(items.iter().rev()),
                Value::Object(fields) => {
                    pending.extend(fields.iter().rev().map(|(_, value)| value))
                }
                _ => {}
            }
        }
    }
    fields.retain(|(name, _)| !equals(name, key));
    parsed.date_ids = retained_dates;
    parsed.symbol_ids = retained_symbols;
}
pub fn parse_document(
    source: &[u16],
    normalized_extension: &[u16],
    file_path: &[u16],
    is_absolute: &mut dyn FnMut(&[u16]) -> bool,
    date_key: Option<&mut dyn FnMut(i64) -> Vec<u16>>,
) -> Result<ParsedDocument, Error> {
    let source = &source[usize::from(source.first() == Some(&0xfeff))..];
    let format = format(source, normalized_extension);
    let mut parsed = match format {
        Format::Markdown => {
            let normalized = frontmatter_rust::normalize_line_endings(source);
            let document = frontmatter_rust::parse_document(&normalized, false, date_key);
            if let Some(diagnostic) = document.errors.first() {
                if diagnostic.parse_message == frontmatter_rust::MISSING_END {
                    empty(Value::Object(vec![(
                        "prompt".encode_utf16().collect(),
                        Value::String(source.to_vec()),
                    )]))
                } else {
                    return Err(error(&diagnostic.parse_message));
                }
            } else {
                let mut parsed = document.yaml;
                let body = &normalized[document.body_start..];
                if !body.is_empty() || parsed.value.get("prompt").is_none() {
                    let Value::Object(fields) = &parsed.value else {
                        unreachable!()
                    };
                    let index = fields
                        .iter()
                        .position(|(key, _)| equals(key, "prompt"))
                        .unwrap_or(fields.len());
                    remove_field(&mut parsed, "prompt");
                    let Value::Object(fields) = &mut parsed.value else {
                        unreachable!()
                    };
                    fields.insert(
                        index,
                        (
                            "prompt".encode_utf16().collect(),
                            Value::String(body.to_vec()),
                        ),
                    );
                }
                parsed
            }
        }
        Format::Yaml => yaml::parse_with_options(
            source,
            date_key,
            yaml::ParseOptions {
                unique_keys: true,
                object_root: false,
            },
        )
        .map_err(|diagnostic| error(diagnostic.to_string()))?,
        Format::Json => empty(from_json(
            json::parse_utf16(
                source,
                json::Limits {
                    max_depth: 512,
                    ..json::Limits::default()
                },
            )
            .map_err(|diagnostic| {
                named(
                    "Invalid JSON configuration in ",
                    file_path,
                    &format!(": {diagnostic}"),
                )
            })?,
        )),
    };
    if format == Format::Yaml && parsed.value == Value::Null {
        parsed.value = Value::Object(vec![]);
    }
    // The SDK accepts any non-array object then spreads its own fields. A Date
    // scalar therefore admits an empty record; frontmatter keeps its plain-root rule.
    if format == Format::Yaml && matches!(parsed.value, Value::Date(_)) {
        parsed = empty(Value::Object(vec![]));
    }
    if !matches!(parsed.value, Value::Object(_)) {
        return Err(named(
            "Invalid configuration in ",
            file_path,
            ": expected an object root.",
        ));
    }
    let has_extends = parsed.value.get("extends").is_some();
    let extends = extends(parsed.value.get("extends"), file_path, is_absolute)?;
    remove_field(&mut parsed, "extends");
    Ok(ParsedDocument {
        yaml: parsed,
        format,
        extends,
        has_extends,
    })
}

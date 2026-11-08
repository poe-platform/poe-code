use mcp_protocol_rust::{formats::is_base64, json::Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug)]
pub enum ParameterType {
    String,
    Integer,
    Boolean,
}

#[derive(Clone, Debug)]
pub struct ParameterHeader {
    pub name: String,
    pub path: Vec<Vec<u16>>,
    pub kind: ParameterType,
}

#[derive(Debug)]
pub enum HeaderValue {
    String(Vec<u16>),
    Invalid,
}
pub type HeaderValues = BTreeMap<Vec<u16>, HeaderValue>;

pub fn encode_value(value: &[u16]) -> Result<Vec<u16>, String> {
    let text = String::from_utf16(value)
        .map_err(|_| "MCP header value must contain valid Unicode".to_owned())?;
    let sentinel = text.starts_with("=?base64?") && text.ends_with("?=");
    if sentinel
        || text.trim() != text
        || text
            .bytes()
            .any(|byte| byte != 9 && !(32..=126).contains(&byte))
    {
        Ok(format!(
            "=?base64?{}?=",
            super::media::encode_base64(text.as_bytes())
        )
        .encode_utf16()
        .collect())
    } else {
        Ok(value.to_vec())
    }
}

pub fn decode_value(value: &[u16]) -> Option<Vec<u16>> {
    let text = String::from_utf16(value).ok()?;
    if let Some(encoded) = text
        .strip_prefix("=?base64?")
        .and_then(|text| text.strip_suffix("?="))
    {
        let units: Vec<u16> = encoded.encode_utf16().collect();
        if !is_base64(&units) {
            return None;
        }
        let bytes = super::media::decode_base64(&units).ok()?;
        return Some(std::str::from_utf8(&bytes).ok()?.encode_utf16().collect());
    }
    if text.trim() != text
        || text
            .bytes()
            .any(|byte| byte != 9 && !(32..=126).contains(&byte))
    {
        None
    } else {
        Some(value.to_vec())
    }
}

pub fn get_parameter_headers(schema: &Value) -> Result<Vec<ParameterHeader>, String> {
    let mut collector = Collector {
        definitions: Vec::new(),
        names: BTreeSet::new(),
        nodes: 0,
    };
    collector.visit(schema, &[], true, 0)?;
    Ok(collector.definitions)
}

struct Collector {
    definitions: Vec<ParameterHeader>,
    names: BTreeSet<String>,
    nodes: usize,
}
impl Collector {
    fn visit(
        &mut self,
        value: &Value,
        path: &[Vec<u16>],
        reachable: bool,
        depth: usize,
    ) -> Result<(), String> {
        self.nodes += 1;
        if self.nodes > 10_000 || depth > 64 {
            return Err("MCP header schema traversal limit exceeded".into());
        }
        if matches!(value, Value::Bool(_)) {
            return Ok(());
        }
        let Value::Object(fields) = value else {
            return Err("Invalid MCP header schema".into());
        };
        if let Some(name) = value.get("x-mcp-header") {
            let name = match name {
                Value::String(units)
                    if reachable
                        && !path.is_empty()
                        && !units.is_empty()
                        && units.iter().all(|unit| {
                            matches!(*unit, 48..=57 | 65..=90 | 97..=122)
                                || b"!#$%&'*+-.^_`|~".iter().any(|byte| *byte as u16 == *unit)
                        }) =>
                {
                    String::from_utf16(units).expect("ASCII header name")
                }
                _ => return Err("Invalid x-mcp-header name or property path".into()),
            };
            let kind = if super::string_matches(value.get("type"), "string") {
                ParameterType::String
            } else if super::string_matches(value.get("type"), "integer") {
                ParameterType::Integer
            } else if super::string_matches(value.get("type"), "boolean") {
                ParameterType::Boolean
            } else {
                return Err("x-mcp-header requires a string, integer, or boolean property".into());
            };
            if !self.names.insert(name.to_ascii_lowercase()) {
                return Err("Duplicate x-mcp-header name".into());
            }
            self.definitions.push(ParameterHeader {
                name: format!("Mcp-Param-{name}"),
                path: path.to_vec(),
                kind,
            });
        }
        for (keyword, child) in fields {
            let keyword = String::from_utf16_lossy(keyword);
            match keyword.as_str() {
                "properties" | "patternProperties" | "$defs" | "definitions"
                | "dependentSchemas" => {
                    let Value::Object(children) = child else {
                        return Err("Invalid schema map".into());
                    };
                    for (key, nested) in children {
                        let mut next = path.to_vec();
                        if keyword == "properties" {
                            next.push(key.clone());
                        }
                        self.visit(
                            nested,
                            &next,
                            reachable && keyword == "properties",
                            depth + 1,
                        )?;
                    }
                }
                "oneOf" | "allOf" | "anyOf" | "prefixItems" => {
                    let Value::Array(children) = child else {
                        return Err("Invalid schema array".into());
                    };
                    for nested in children {
                        self.visit(nested, path, false, depth + 1)?;
                    }
                }
                "items"
                | "additionalProperties"
                | "not"
                | "contains"
                | "if"
                | "then"
                | "else"
                | "propertyNames"
                | "unevaluatedProperties"
                | "unevaluatedItems"
                | "contentSchema" => {
                    if let Value::Array(children) = child {
                        for nested in children {
                            self.visit(nested, path, false, depth + 1)?;
                        }
                    } else {
                        self.visit(child, path, false, depth + 1)?;
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
}

pub fn create_parameter_headers(
    definitions: &[ParameterHeader],
    arguments: &Value,
) -> Result<BTreeMap<String, Vec<u16>>, String> {
    let mut generated = BTreeMap::new();
    for definition in definitions {
        let mut value = Some(arguments);
        for key in &definition.path {
            value = value.and_then(|value| match value {
                Value::Object(fields) => fields
                    .iter()
                    .find(|(name, _)| name == key)
                    .map(|(_, value)| value),
                _ => None,
            });
        }
        let Some(value) = value else {
            continue;
        };
        let text = match (definition.kind, value) {
            (ParameterType::String, Value::String(units)) => units.clone(),
            (ParameterType::Boolean, Value::Bool(boolean)) => {
                boolean.to_string().encode_utf16().collect()
            }
            (ParameterType::Integer, Value::Number(number))
                if number.is_finite()
                    && number.fract() == 0.0
                    && number.abs() <= 9_007_199_254_740_991.0 =>
            {
                mcp_protocol_rust::numbers::format(*number)
                    .encode_utf16()
                    .collect()
            }
            _ => return Err(format!("Invalid value for {}", definition.name)),
        };
        generated.insert(definition.name.clone(), encode_value(&text)?);
    }
    Ok(generated)
}

pub fn validate_parameter_headers(
    definitions: &[ParameterHeader],
    arguments: &Value,
    headers: &HeaderValues,
) -> Option<String> {
    let expected = match create_parameter_headers(definitions, arguments) {
        Ok(expected) => expected,
        Err(message) => return Some(message),
    };
    for definition in definitions {
        let value = expected.get(&definition.name);
        let actual = headers.get(
            &definition
                .name
                .to_ascii_lowercase()
                .encode_utf16()
                .collect::<Vec<_>>(),
        );
        if value.is_none() && actual.is_none() {
            continue;
        }
        let decoded = actual.and_then(|value| match value {
            HeaderValue::String(units) => decode_value(units),
            HeaderValue::Invalid => None,
        });
        if value.is_none()
            || actual.is_none()
            || decoded.is_none()
            || decoded != value.and_then(|value| decode_value(value))
        {
            return Some(format!(
                "Header mismatch: {} must match the tool argument",
                definition.name
            ));
        }
    }
    None
}

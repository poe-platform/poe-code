//! Dependency-free static config-scope extraction and JSON Schema emission.
mod lex;
mod source;
use mcp_protocol_rust::json::Value;
pub use source::scan;
#[derive(Clone, Copy)]
pub enum Mode {
    Imports,
    All,
}
use std::collections::HashMap;
#[derive(Debug, Clone)]
pub struct Field {
    pub name: Vec<u16>,
    pub kind: Vec<u16>,
    pub default: Value,
    pub doc: Vec<u16>,
}
#[derive(Debug, Clone)]
pub struct Fragment {
    pub scope: Vec<u16>,
    pub fields: Vec<Field>,
    pub source: String,
}
#[derive(Debug, Clone)]
pub struct Source {
    pub imports: Vec<Vec<u16>>,
    pub fragments: Vec<Fragment>,
}
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn text(value: &[u16]) -> String {
    String::from_utf16_lossy(value)
}
fn string(value: &str) -> Value {
    Value::String(u(value))
}
fn object(values: Vec<(&str, Value)>) -> Value {
    Value::Object(
        values
            .into_iter()
            .map(|(name, value)| (u(name), value))
            .collect(),
    )
}
fn index(name: &[u16]) -> Option<u32> {
    if name.is_empty() || name.len() > 10 || name.len() > 1 && name[0] == 48 {
        return None;
    }
    let mut result = 0_u32;
    for &unit in name {
        if !(48..=57).contains(&unit) {
            return None;
        }
        result = result.checked_mul(10)?.checked_add(u32::from(unit - 48))?;
    }
    (result != u32::MAX).then_some(result)
}
fn ordered<T>(values: &mut [(Vec<u16>, T)]) {
    values.sort_by_key(|(key, _)| index(key).map_or((1, 0), |index| (0, index)));
}
fn schema_object(mut properties: Vec<(Vec<u16>, Value)>, mut required: Vec<Vec<u16>>) -> Value {
    ordered(&mut properties);
    required.sort_by_key(|key| index(key).map_or((1, 0), |index| (0, index)));
    let fields = vec![
        ("type", string("object")),
        ("properties", Value::Object(properties)),
        (
            "required",
            Value::Array(required.into_iter().map(Value::String).collect()),
        ),
        ("additionalProperties", Value::Bool(false)),
    ];
    object(fields)
}
pub fn compile(sources: Vec<Source>, options: Value) -> Result<Value, String> {
    let mut scopes: Vec<(Vec<u16>, Vec<Field>)> = vec![];
    let mut origins = HashMap::<Vec<u16>, String>::new();
    for source in sources {
        for mut fragment in source.fragments {
            fragment
                .fields
                .sort_by_key(|field| index(&field.name).map_or((1, 0), |index| (0, index)));
            let position = if let Some(position) = scopes
                .iter()
                .position(|(scope, _)| *scope == fragment.scope)
            {
                position
            } else {
                scopes.push((fragment.scope.clone(), vec![]));
                scopes.len() - 1
            };
            for field in fragment.fields {
                let mut key = fragment.scope.clone();
                key.push(46);
                key.extend(&field.name);
                if let Some(previous) = origins.get(&key) {
                    return Err(format!(
                        "Duplicate config field \"{}\" in {}; first defined in {}",
                        text(&key),
                        fragment.source,
                        previous
                    ));
                }
                origins.insert(key, fragment.source.clone());
                scopes[position].1.push(field);
            }
        }
    }
    let mut properties = vec![(
        u("version"),
        object(vec![
            ("type", string("number")),
            ("default", Value::Number(1.0)),
        ]),
    )];
    let mut required = vec![u("version")];
    for (scope, fields) in scopes {
        if fields
            .iter()
            .any(|field| matches!(field.default,Value::Number(value) if !value.is_finite()))
        {
            return Err("default must be finite".into());
        }
        let required_fields = fields.iter().map(|field| field.name.clone()).collect();
        let shape = fields
            .into_iter()
            .map(|field| {
                (
                    field.name,
                    object(vec![
                        ("type", Value::String(field.kind)),
                        ("description", Value::String(field.doc)),
                        ("default", field.default),
                    ]),
                )
            })
            .collect();
        let schema = schema_object(shape, required_fields);
        if let Some((_, existing)) = properties.iter_mut().find(|(key, _)| *key == scope) {
            *existing = schema;
            required.retain(|key| *key != scope);
        } else {
            properties.push((scope, schema));
        }
    }
    let defaults = [
        ("id", "https://poe-code.dev/schemas/poe-code.schema.json"),
        ("title", "poe-code config"),
        ("description", "Schema for poe-code config files"),
        ("schema", "https://json-schema.org/draft/2020-12/schema"),
    ];
    let options = match options {
        Value::Object(fields) => fields,
        _ => vec![],
    };
    let value = |key: &str| {
        options
            .iter()
            .find(|(name, _)| *name == u(key))
            .map(|(_, value)| value.clone())
            .unwrap_or_else(|| string(defaults.iter().find(|(name, _)| *name == key).unwrap().1))
    };
    let mut fields = vec![(u("$schema"), value("schema"))];
    let Value::Object(root) = schema_object(properties, required) else {
        unreachable!()
    };
    fields.extend(root);
    for (key, output) in [
        ("id", "$id"),
        ("title", "title"),
        ("description", "description"),
    ] {
        fields.push((u(output), value(key)));
    }
    Ok(Value::Object(fields))
}

//! Compatibility normalization for the repository's legacy `nullable` keyword.
//! Identity fields stay on the complete schema resource. Pointer references are
//! rewritten only when their in-document target moved into a validation branch.
use crate::{Dialect, compile::decode_segment, units, uri};
use mcp_protocol_rust::json::Value;
use std::collections::HashMap;

type Path = Vec<Vec<u16>>;

#[derive(Clone)]
struct Scope {
    before: Path,
    after: Path,
    resource_before: Path,
    resource_after: Path,
    base: String,
    dialect: Dialect,
}

struct Reference {
    path: Path,
    value: Vec<u16>,
    base: String,
}

#[derive(Default)]
struct Normalizer {
    locations: HashMap<(Vec<u16>, Vec<u16>), Vec<u16>>,
    resource_ids: HashMap<String, Vec<u16>>,
    references: Vec<Reference>,
    nodes: usize,
}

/// Normalize legacy nullability without changing the caller's schema. Arbitrary
/// annotation values are copied verbatim rather than treated as child schemas.
pub fn normalize_legacy_nullability(source: &Value) -> Result<Value, String> {
    let mut normalizer = Normalizer::default();
    let mut normalized = normalizer.walk(
        source,
        Scope {
            before: vec![],
            after: vec![],
            resource_before: vec![],
            resource_after: vec![],
            base: "https://toolcraft.invalid/schema".into(),
            dialect: Dialect::Modern,
        },
        0,
    )?;
    for reference in normalizer.references {
        let absolute = uri::resolve(&String::from_utf16_lossy(&reference.value), &reference.base)?;
        let Some((resource_uri, fragment)) = absolute.split_once('#') else {
            continue;
        };
        if !fragment.starts_with('/') {
            continue;
        }
        let Some(resource) = normalizer.resource_ids.get(resource_uri) else {
            continue;
        };
        let original = decode_segment(&units(fragment))?;
        let Some(destination) = normalizer
            .locations
            .get(&(resource.clone(), original.clone()))
        else {
            continue;
        };
        if destination == &original {
            continue;
        }
        let Some(hash) = reference.value.iter().position(|unit| *unit == 35) else {
            continue;
        };
        let replacement = reference.value[..=hash]
            .iter()
            .copied()
            .chain(destination.iter().copied())
            .collect();
        *at_path(&mut normalized, &reference.path) = Value::String(replacement);
    }
    Ok(normalized)
}

impl Normalizer {
    fn walk(&mut self, node: &Value, mut scope: Scope, depth: usize) -> Result<Value, String> {
        self.nodes += 1;
        if depth > 128 || self.nodes > 262_144 {
            return Err("Schema resource limit exceeded".into());
        }
        let Value::Object(entries) = node else {
            return Ok(node.clone());
        };
        if let Some(Value::String(version)) = node.get("$schema") {
            let version = String::from_utf16_lossy(version);
            if version.contains("draft-07") {
                scope.dialect = Dialect::Draft7;
            } else if version.contains("2020-12") {
                scope.dialect = Dialect::Modern;
            }
        }
        let identifier = if scope.dialect == Dialect::Draft7 {
            // JS nullish coalescing preserves a non-string, non-null $id.
            match node.get("$id") {
                None | Some(Value::Null) => node.get("id"),
                other => other,
            }
        } else {
            node.get("$id")
        };
        if let Some(Value::String(id)) = identifier {
            scope.resource_before = scope.before.clone();
            scope.resource_after = scope.after.clone();
            scope.base = uri::resolve(&String::from_utf16_lossy(id), &scope.base)?
                .split('#')
                .next()
                .expect("URI resource")
                .into();
        }
        let resource = pointer(&scope.resource_before);
        self.resource_ids
            .insert(scope.base.clone(), resource.clone());
        self.locations.insert(
            (
                resource,
                pointer(&scope.before[scope.resource_before.len()..]),
            ),
            pointer(&scope.after[scope.resource_after.len()..]),
        );
        let nullable = node.get("nullable") == Some(&Value::Bool(true));
        let mut result = vec![];
        let mut validation = vec![];
        for (key, value) in entries {
            if key == &units("nullable") {
                continue;
            }
            let name = String::from_utf16_lossy(key);
            let wrapped = nullable
                && !matches!(
                    name.as_str(),
                    "$id"
                        | "id"
                        | "$schema"
                        | "$anchor"
                        | "$dynamicAnchor"
                        | "$defs"
                        | "definitions"
                        | "description"
                        | "default"
                );
            let mut after = scope.after.clone();
            if wrapped {
                after.extend([units("anyOf"), units("0")]);
            }
            after.push(key.clone());
            let mut before = scope.before.clone();
            before.push(key.clone());
            let child_scope = Scope {
                before,
                after: after.clone(),
                ..scope.clone()
            };
            let converted = if matches!(
                name.as_str(),
                "properties"
                    | "$defs"
                    | "definitions"
                    | "patternProperties"
                    | "dependentSchemas"
                    | "dependencies"
            ) && matches!(value, Value::Object(_))
            {
                let Value::Object(children) = value else {
                    unreachable!()
                };
                let mut converted = Vec::with_capacity(children.len());
                for (child_key, child) in children {
                    let mut child_scope = child_scope.clone();
                    child_scope.before.push(child_key.clone());
                    child_scope.after.push(child_key.clone());
                    converted.push((child_key.clone(), self.walk(child, child_scope, depth + 1)?));
                }
                Value::Object(converted)
            } else if matches!(
                name.as_str(),
                "allOf" | "anyOf" | "oneOf" | "prefixItems" | "items"
            ) && matches!(value, Value::Array(_))
            {
                let Value::Array(children) = value else {
                    unreachable!()
                };
                let mut converted = Vec::with_capacity(children.len());
                for (index, child) in children.iter().enumerate() {
                    let mut child_scope = child_scope.clone();
                    let index = units(&index.to_string());
                    child_scope.before.push(index.clone());
                    child_scope.after.push(index);
                    converted.push(self.walk(child, child_scope, depth + 1)?);
                }
                Value::Array(converted)
            } else if matches!(
                name.as_str(),
                "items"
                    | "additionalProperties"
                    | "additionalItems"
                    | "contains"
                    | "not"
                    | "if"
                    | "then"
                    | "else"
                    | "propertyNames"
                    | "unevaluatedProperties"
                    | "unevaluatedItems"
            ) {
                self.walk(value, child_scope, depth + 1)?
            } else {
                value.clone()
            };
            if matches!(name.as_str(), "$ref" | "$dynamicRef")
                && let Value::String(value) = value
            {
                self.references.push(Reference {
                    path: after,
                    value: value.clone(),
                    base: scope.base.clone(),
                });
            }
            if wrapped {
                validation.push((key.clone(), converted));
            } else {
                result.push((key.clone(), converted));
            }
        }
        if nullable {
            result.push((
                units("anyOf"),
                Value::Array(vec![
                    Value::Object(validation),
                    Value::Object(vec![(units("type"), Value::String(units("null")))]),
                ]),
            ));
        }
        Ok(Value::Object(result))
    }
}

fn pointer(path: &[Vec<u16>]) -> Vec<u16> {
    let mut result = vec![];
    for part in path {
        result.push(47);
        for unit in part {
            match unit {
                126 => result.extend([126, 48]),
                47 => result.extend([126, 49]),
                unit => result.push(*unit),
            }
        }
    }
    result
}

fn at_path<'a>(value: &'a mut Value, path: &[Vec<u16>]) -> &'a mut Value {
    if path.is_empty() {
        return value;
    }
    let child = match value {
        Value::Object(entries) => {
            &mut entries
                .iter_mut()
                .find(|(key, _)| key == &path[0])
                .expect("recorded reference field")
                .1
        }
        Value::Array(entries) => {
            &mut entries[String::from_utf16_lossy(&path[0])
                .parse::<usize>()
                .expect("recorded array index")]
        }
        _ => unreachable!("reference path traverses only constructed schema containers"),
    };
    at_path(child, &path[1..])
}

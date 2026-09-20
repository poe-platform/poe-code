use mcp_protocol_rust::json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

mod compile;
mod evaluate;
mod pattern;
mod unicode_categories;
mod uri;

#[derive(Default)]
pub struct CompileOptions {
    pub registry: Vec<(String, Value)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ValidationIssue {
    pub path: Vec<Vec<u16>>,
    pub expected: String,
    pub received: String,
    pub message: Vec<u16>,
    pub keyword: String,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Dialect {
    Draft7,
    Modern,
}

struct Node {
    schema: Value,
    dialect: Dialect,
    children: HashMap<Vec<u16>, usize>,
    reference: Option<usize>,
    dynamic_reference: Option<(usize, Option<Vec<u16>>)>,
    recursive_reference: Option<(usize, bool)>,
    resource_root: usize,
    resource_uri: Arc<str>,
    base_uri: Arc<str>,
    document: usize,
    validation_vocabulary: bool,
    pattern: Option<pattern::Pattern>,
    property_patterns: Vec<(Vec<u16>, pattern::Pattern)>,
}

pub struct CompiledSchema {
    nodes: Vec<Node>,
    dynamic_anchors: HashMap<usize, HashMap<Vec<u16>, usize>>,
}

impl CompiledSchema {
    pub fn validate(&self, value: &Value) -> Result<Vec<ValidationIssue>, String> {
        evaluate::Evaluator {
            graph: self,
            active: HashSet::new(),
            calls: 0,
            dynamic_scope: Vec::new(),
        }
        .evaluate(0, value, &[], 0)
        .map(|result| result.issues)
    }
}

fn units(source: &str) -> Vec<u16> {
    source.encode_utf16().collect()
}
fn is_string(value: &Value, source: &str) -> bool {
    matches!(value, Value::String(text) if text.iter().copied().eq(source.encode_utf16()))
}
fn child_key(keyword: &str, key: &[u16]) -> Vec<u16> {
    keyword
        .encode_utf16()
        .chain([47])
        .chain(key.iter().copied())
        .collect()
}

fn equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => {
            (left.is_nan() && right.is_nan())
                || (left == right
                    && (left != &0.0 || left.is_sign_negative() == right.is_sign_negative()))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left.iter().all(|(name, value)| {
                    right
                        .iter()
                        .find(|(key, _)| key == name)
                        .is_some_and(|(_, other)| equal(value, other))
                })
        }
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| equal(left, right))
        }
        _ => left == right,
    }
}

fn received(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
        Value::Number(number) if number.is_finite() && number.fract() == 0.0 => "integer",
        Value::Number(_) => "number",
    }
}

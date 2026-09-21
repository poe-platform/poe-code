//! OAuth scope grammar and canonical set comparison, without case folding.
use mcp_protocol_rust::json::Value;
use std::collections::BTreeSet;
pub fn normalize(value: Option<&Value>) -> Result<Option<Vec<u16>>, &'static str> {
    let Some(value) = value else {
        return Ok(None);
    };
    let Value::String(scope) = value else {
        return Err("Invalid OAuth scope syntax");
    };
    if scope
        .iter()
        .any(|unit| !(32..=126).contains(unit) || matches!(unit, 34 | 92))
    {
        return Err("Invalid OAuth scope syntax");
    }
    let values = scope
        .split(|unit| *unit == 32)
        .filter(|token| !token.is_empty())
        .collect::<BTreeSet<_>>();
    if values.is_empty() {
        return Ok(None);
    }
    let mut result = vec![];
    for (index, value) in values.into_iter().enumerate() {
        if index > 0 {
            result.push(32);
        }
        result.extend_from_slice(value);
    }
    Ok(Some(result))
}

//! Client-side stream admission and notification correlation without host I/O.
use mcp_protocol_rust::{formats::is_valid_uri, json::Value};
use std::collections::HashMap;
const LIST_FIELDS: [&str; 3] = [
    "toolsListChanged",
    "promptsListChanged",
    "resourcesListChanged",
];
#[derive(Hash, Eq, PartialEq)]
enum Id {
    Text(Vec<u16>),
    Number(u64),
}
impl Id {
    fn from(value: &Value) -> Option<Self> {
        match value {
            Value::String(text) => Some(Self::Text(text.clone())),
            Value::Number(number) => Some(Self::Number(if *number == 0.0 {
                0
            } else if number.is_nan() {
                f64::NAN.to_bits()
            } else {
                number.to_bits()
            })),
            _ => None,
        }
    }
}
struct Entry {
    requested: Value,
    accepted: Option<Value>,
}
#[derive(Default)]
pub struct SubscriptionState {
    entries: HashMap<Id, Entry>,
}
pub struct Acknowledgement {
    pub id: Value,
    pub filter: Value,
}
pub fn normalize_filter(value: &Value) -> Result<Value, String> {
    if !matches!(value, Value::Object(_)) {
        return Err("Notification filter must be an object".into());
    }
    let mut filter = Vec::new();
    for field in LIST_FIELDS {
        match value.get(field) {
            Some(Value::Bool(true)) => {
                filter.push((field.encode_utf16().collect(), Value::Bool(true)))
            }
            None | Some(Value::Bool(false)) => {}
            _ => return Err(format!("{field} must be a boolean")),
        }
    }
    if let Some(uris) = value.get("resourceSubscriptions") {
        let Value::Array(uris) = uris else {
            return Err(uri_error());
        };
        if uris.len() > 1024 || !uris.iter().all(|uri| matches!(uri, Value::String(text) if text.len() <= 8192 && is_valid_uri(text))) { return Err(uri_error()); }
        let mut selected = Vec::new();
        for uri in uris {
            if !selected.contains(uri) {
                selected.push(uri.clone());
            }
        }
        filter.push((
            "resourceSubscriptions".encode_utf16().collect(),
            Value::Array(selected),
        ));
    }
    Ok(Value::Object(filter))
}
fn uri_error() -> String {
    "Resource subscriptions require at most 1024 absolute URIs of at most 8192 characters".into()
}
pub fn subscription_id(params: &Value) -> Option<&Value> {
    let id = params
        .get("_meta")?
        .get("io.modelcontextprotocol/subscriptionId")?;
    Id::from(id).map(|_| id)
}
impl SubscriptionState {
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    pub fn normalize(&self, filter: &Value) -> Result<Value, String> {
        if self.entries.len() >= 64 {
            return Err("Too many MCP subscriptions".into());
        }
        normalize_filter(filter)
    }
    pub fn register(&mut self, id: Value, filter: Value) -> Result<(), String> {
        let normalized = self.normalize(&filter)?;
        let id = Id::from(&id).ok_or("Invalid subscription request ID")?;
        if self.entries.contains_key(&id) {
            return Err("Duplicate subscription request ID".into());
        }
        self.entries.insert(
            id,
            Entry {
                requested: normalized,
                accepted: None,
            },
        );
        Ok(())
    }
    pub fn acknowledge(&mut self, params: &Value) -> Result<Option<Acknowledgement>, String> {
        let Some(id) = subscription_id(params) else {
            return Ok(None);
        };
        let Some(entry) = self.entries.get_mut(&Id::from(id).expect("validated ID")) else {
            return Ok(None);
        };
        if entry.accepted.is_some() {
            return Ok(None);
        }
        let accepted = normalize_filter(params.get("notifications").unwrap_or(&Value::Null))?;
        if LIST_FIELDS.iter().any(|key| {
            accepted.get(key) == Some(&Value::Bool(true))
                && entry.requested.get(key) != Some(&Value::Bool(true))
        }) || matches!(accepted.get("resourceSubscriptions"), Some(Value::Array(uris)) if uris.iter().any(|uri| !matches!(entry.requested.get("resourceSubscriptions"), Some(Value::Array(requested)) if requested.contains(uri))))
        {
            return Err("Subscription acknowledgement exceeds the requested filter".into());
        }
        entry.accepted = Some(accepted.clone());
        Ok(Some(Acknowledgement {
            id: id.clone(),
            filter: accepted,
        }))
    }
    pub fn accepts(&self, method: &str, params: &Value) -> bool {
        let Some(id) = subscription_id(params).and_then(Id::from) else {
            return false;
        };
        let Some(accepted) = self
            .entries
            .get(&id)
            .and_then(|entry| entry.accepted.as_ref())
        else {
            return false;
        };
        let index = match method {
            "notifications/tools/list_changed" => Some(0),
            "notifications/prompts/list_changed" => Some(1),
            "notifications/resources/list_changed" => Some(2),
            _ => None,
        };
        if let Some(index) = index {
            return accepted.get(LIST_FIELDS[index]) == Some(&Value::Bool(true));
        }
        method == "notifications/resources/updated"
            && matches!(params.get("uri"), Some(Value::String(_)))
            && matches!(accepted.get("resourceSubscriptions"), Some(Value::Array(uris)) if params.get("uri").is_some_and(|uri| uris.contains(uri)))
    }
    pub fn validate_completion(&self, id: &Value, result: &Value) -> Result<(), String> {
        // JavaScript strict equality treats NaN as unequal and numeric zeroes equally.
        if subscription_id(result) != Some(id) {
            return Err("Invalid subscription completion ID".into());
        }
        if Id::from(id)
            .and_then(|id| self.entries.get(&id))
            .is_none_or(|entry| entry.accepted.is_none())
        {
            return Err("Subscription completed before acknowledgement".into());
        }
        Ok(())
    }
    pub fn remove(&mut self, id: &Value) -> bool {
        Id::from(id).is_some_and(|id| self.entries.remove(&id).is_some())
    }
    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

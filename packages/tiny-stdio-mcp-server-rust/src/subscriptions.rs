use super::{Action, Server, Session, failure, object, string};
use mcp_protocol_rust::{
    formats::is_valid_uri,
    json::Value,
    jsonrpc::{INVALID_PARAMS, Id},
};
use std::collections::{BTreeMap, BTreeSet};

const LIST_FIELDS: [&str; 3] = [
    "toolsListChanged",
    "promptsListChanged",
    "resourcesListChanged",
];

#[derive(Default)]
pub(crate) struct Subscriptions {
    entries: BTreeMap<u64, Subscription>,
}
struct Subscription {
    id: Id,
    lists: [bool; 3],
    uris: BTreeSet<Vec<u16>>,
    ready: bool,
}

impl Server {
    /// Admit a modern long-lived request. The host must deliver its acknowledgment
    /// before marking it ready, then keep it active until abort or close.
    pub fn listen(
        &self,
        session: &mut Session,
        token: u64,
        id: Option<Id>,
        notifications: Option<Value>,
    ) -> Action {
        if session.closed {
            return Action::NoReply;
        }
        let Some(id) = id.filter(Id::is_safe_request_id) else {
            return failure(INVALID_PARAMS, "subscriptions/listen requires a request ID");
        };
        let Some(Value::Object(_)) = notifications else {
            return failure(
                INVALID_PARAMS,
                "Subscription notifications must be an object",
            );
        };
        let notifications = notifications.expect("validated object");
        let mut lists = [false; 3];
        let mut filter = Vec::new();
        for (index, field) in LIST_FIELDS.iter().enumerate() {
            match notifications.get(field) {
                Some(Value::Bool(true)) if self.options.support_notifications => {
                    lists[index] = true;
                    filter.push((field.encode_utf16().collect(), Value::Bool(true)));
                }
                None | Some(Value::Bool(_)) => {}
                _ => return failure(INVALID_PARAMS, &format!("{field} must be a boolean")),
            }
        }
        let mut uris = BTreeSet::new();
        if let Some(values) = notifications.get("resourceSubscriptions") {
            let Value::Array(values) = values else {
                return invalid_uris();
            };
            if values.len() > 1024 || !values.iter().all(|value| matches!(value, Value::String(uri) if uri.len() <= 8192 && is_valid_uri(uri))) { return invalid_uris(); }
            if self.options.support_resource_subscriptions {
                let mut selected = Vec::new();
                for value in values {
                    let Value::String(uri) = value else {
                        unreachable!("validated URI");
                    };
                    if uris.insert(uri.clone()) {
                        selected.push(Value::String(uri.clone()));
                    }
                }
                filter.push((
                    "resourceSubscriptions".encode_utf16().collect(),
                    Value::Array(selected),
                ));
            }
        }
        let acknowledgment = object([
            ("jsonrpc", string("2.0")),
            ("method", string("notifications/subscriptions/acknowledged")),
            (
                "params",
                object([
                    (
                        "_meta",
                        object([(
                            "io.modelcontextprotocol/subscriptionId",
                            id.clone().into_value(),
                        )]),
                    ),
                    ("notifications", Value::Object(filter)),
                ]),
            ),
        ]);
        session.subscriptions.entries.insert(
            token,
            Subscription {
                id,
                lists,
                uris,
                ready: false,
            },
        );
        Action::Listen { acknowledgment }
    }
}

fn invalid_uris() -> Action {
    failure(
        INVALID_PARAMS,
        "resourceSubscriptions must contain at most 1024 absolute URIs of at most 8192 characters",
    )
}

impl Session {
    pub fn subscription_count(&self) -> usize {
        self.subscriptions.entries.len()
    }
    pub fn acknowledge_subscription(&mut self, token: u64) -> bool {
        let Some(entry) = self.subscriptions.entries.get_mut(&token) else {
            return false;
        };
        entry.ready = true;
        true
    }
    pub fn finish_subscription(&mut self, token: u64) -> bool {
        self.subscriptions.entries.remove(&token).is_some()
    }
}

impl Subscriptions {
    pub(crate) fn selected(
        &self,
        list: Option<usize>,
        uri: Option<&[u16]>,
    ) -> impl Iterator<Item = (u64, &Id)> {
        self.entries
            .iter()
            .filter(move |(_, entry)| {
                entry.ready
                    && (list.is_some_and(|index| entry.lists[index])
                        || uri.is_some_and(|uri| entry.uris.contains(uri)))
            })
            .map(|(token, entry)| (*token, &entry.id))
    }
}

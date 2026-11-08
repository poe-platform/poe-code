use super::{Server, Session, object, string};
use mcp_protocol_rust::json::Value;

pub enum NotificationKind {
    ToolsChanged,
    PromptsChanged,
    ResourcesChanged,
    ResourceUpdated(Vec<u16>),
}
pub struct Notification {
    pub value: Value,
    pub sessions: Vec<u32>,
    pub subscriptions: Vec<SubscriptionDelivery>,
}
pub struct SubscriptionDelivery {
    pub session: u32,
    pub notification: Value,
}

impl Server {
    pub fn notification<'a>(
        &self,
        kind: NotificationKind,
        sessions: impl IntoIterator<Item = (u32, &'a Session)>,
    ) -> Option<Notification> {
        let resource_uri = match &kind {
            NotificationKind::ResourceUpdated(uri) => Some(uri),
            _ => None,
        };
        if if resource_uri.is_some() {
            !self.options.support_resource_subscriptions
        } else {
            !self.options.support_notifications
        } {
            return None;
        }
        let mut ready = false;
        let mut targets = Vec::new();
        let mut subscriptions = Vec::new();
        let list = match kind {
            NotificationKind::ToolsChanged => Some(0),
            NotificationKind::PromptsChanged => Some(1),
            NotificationKind::ResourcesChanged => Some(2),
            NotificationKind::ResourceUpdated(_) => None,
        };
        for (id, session) in sessions {
            if session.closed {
                continue;
            }
            ready |= session.notification_ready || session.subscription_count() > 0;
            if session.notification_ready
                && resource_uri.is_none_or(|uri| session.resource_subscriptions.contains(uri))
            {
                targets.push(id);
            }
            subscriptions.extend(
                session
                    .subscriptions
                    .selected(list, resource_uri.map(Vec::as_slice))
                    .map(|(token, subscription_id)| (id, token, subscription_id.clone())),
            );
        }
        if !ready && resource_uri.is_none() {
            return None;
        }
        targets.sort_unstable();
        subscriptions.sort_unstable_by_key(|(session, token, _)| (*session, *token));
        let method = match kind {
            NotificationKind::ToolsChanged => "notifications/tools/list_changed",
            NotificationKind::PromptsChanged => "notifications/prompts/list_changed",
            NotificationKind::ResourcesChanged => "notifications/resources/list_changed",
            NotificationKind::ResourceUpdated(_) => "notifications/resources/updated",
        };
        let mut value = object([("jsonrpc", string("2.0")), ("method", string(method))]);
        if let NotificationKind::ResourceUpdated(ref uri) = kind {
            let Value::Object(fields) = &mut value else {
                unreachable!()
            };
            fields.push((
                "params".encode_utf16().collect(),
                object([("uri", Value::String(uri.clone()))]),
            ));
        }
        Some(Notification {
            value,
            sessions: targets,
            subscriptions: subscriptions
                .into_iter()
                .map(|(session, _, id)| {
                    let mut params = match &kind {
                        NotificationKind::ResourceUpdated(uri) => {
                            vec![("uri".encode_utf16().collect(), Value::String(uri.clone()))]
                        }
                        _ => vec![],
                    };
                    params.push((
                        "_meta".encode_utf16().collect(),
                        object([("io.modelcontextprotocol/subscriptionId", id.into_value())]),
                    ));
                    SubscriptionDelivery {
                        session,
                        notification: object([
                            ("jsonrpc", string("2.0")),
                            ("method", string(method)),
                            ("params", Value::Object(params)),
                        ]),
                    }
                })
                .collect(),
        })
    }
}

impl Session {
    pub fn can_notify(&self, modern: bool) -> bool {
        !self.closed && (modern || self.notification_ready)
    }
}

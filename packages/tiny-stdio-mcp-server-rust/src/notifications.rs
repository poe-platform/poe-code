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
        for (id, session) in sessions {
            if session.closed || !session.notification_ready {
                continue;
            }
            ready = true;
            if resource_uri.is_none_or(|uri| session.resource_subscriptions.contains(uri)) {
                targets.push(id);
            }
        }
        if !ready && resource_uri.is_none() {
            return None;
        }
        targets.sort_unstable();
        let method = match kind {
            NotificationKind::ToolsChanged => "notifications/tools/list_changed",
            NotificationKind::PromptsChanged => "notifications/prompts/list_changed",
            NotificationKind::ResourcesChanged => "notifications/resources/list_changed",
            NotificationKind::ResourceUpdated(_) => "notifications/resources/updated",
        };
        let mut value = object([("jsonrpc", string("2.0")), ("method", string(method))]);
        if let NotificationKind::ResourceUpdated(uri) = kind {
            let Value::Object(fields) = &mut value else {
                unreachable!()
            };
            fields.push((
                "params".encode_utf16().collect(),
                object([("uri", Value::String(uri))]),
            ));
        }
        Some(Notification {
            value,
            sessions: targets,
        })
    }
}

impl Session {
    pub fn can_notify(&self, modern: bool) -> bool {
        !self.closed && (modern || self.notification_ready)
    }
}

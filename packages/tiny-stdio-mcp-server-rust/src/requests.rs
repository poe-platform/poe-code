use mcp_protocol_rust::jsonrpc::{Id, RpcError};
use std::collections::HashMap;

pub struct RequestTracker {
    limit: usize,
    next_token: u64,
    active: HashMap<u64, Option<(u32, Key)>>,
    named: HashMap<(u32, Key), u64>,
}

#[derive(Clone, Hash, PartialEq, Eq)]
enum Key {
    String(Vec<u16>),
    Number(u64),
}

impl Key {
    fn from_id(id: &Id) -> Option<Self> {
        match id {
            Id::Null => None,
            Id::String(units) => Some(Self::String(units.clone())),
            Id::Number(number) => Some(Self::Number(if *number == 0.0 {
                0
            } else if number.is_nan() {
                f64::NAN.to_bits()
            } else {
                number.to_bits()
            })),
        }
    }
}

impl RequestTracker {
    pub fn new(limit: usize) -> Result<Self, String> {
        if limit == 0 {
            return Err("maxActiveRequests must be a positive integer".into());
        }
        Ok(Self {
            limit,
            next_token: 0,
            active: HashMap::new(),
            named: HashMap::new(),
        })
    }

    pub fn begin(&mut self, session: u32, id: Option<Id>, modern: bool) -> Result<u64, RpcError> {
        if modern && id.as_ref().is_some_and(|id| !id.is_safe_request_id()) {
            return Err(error(-32600, "Invalid Request ID"));
        }
        if self.active.len() >= self.limit {
            return Err(error(-32000, "Too many active requests"));
        }
        let key = id.as_ref().and_then(Key::from_id).map(|key| (session, key));
        if key.as_ref().is_some_and(|key| self.named.contains_key(key)) {
            return Err(error(-32600, "Request ID is already active"));
        }
        let token = self
            .next_token
            .checked_add(1)
            .ok_or_else(|| error(-32000, "Request identifier exhausted"))?;
        self.next_token = token;
        if let Some(key) = &key {
            self.named.insert(key.clone(), token);
        }
        self.active.insert(token, key);
        Ok(token)
    }

    /// Release only when the underlying operation settles. Cancellation alone
    /// does not free capacity for callbacks that keep running in the background.
    pub fn finish(&mut self, token: u64) -> bool {
        let Some(key) = self.active.remove(&token) else {
            return false;
        };
        if let Some(key) = key {
            self.named.remove(&key);
        }
        true
    }

    pub fn token(&self, session: u32, id: &Id) -> Option<u64> {
        self.named.get(&(session, Key::from_id(id)?)).copied()
    }

    pub fn active_count(&self) -> usize {
        self.active.len()
    }
}

fn error(code: i32, message: &str) -> RpcError {
    RpcError {
        code,
        message: message.into(),
        data: None,
    }
}

#[cfg(test)]
mod tests {
    use super::RequestTracker;

    #[test]
    fn tokens_do_not_exhaust_at_the_u32_boundary() {
        let mut tracker = RequestTracker::new(1).unwrap();
        tracker.next_token = u32::MAX.into();
        let token = tracker.begin(1, None, false).unwrap();
        assert!(token > u64::from(u32::MAX));
        assert!(tracker.finish(token));
    }
}

//! Native record retention and atomic single-use/refresh/revocation policy.
use mcp_protocol_rust::json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum Kind {
    Client,
    Transaction,
    Code,
    Grant,
    Access,
    Refresh,
}
impl Kind {
    pub fn parse(kind: &str) -> Option<Self> {
        match kind {
            "client" => Some(Self::Client),
            "transaction" => Some(Self::Transaction),
            "code" => Some(Self::Code),
            "grant" => Some(Self::Grant),
            "access" => Some(Self::Access),
            "refresh" => Some(Self::Refresh),
            _ => None,
        }
    }
}
#[derive(Clone, Debug)]
pub struct Record {
    pub payload: Arc<[u8]>,
    pub attributes: Value,
    pub patches: Value,
}
impl Record {
    pub fn new(payload: Vec<u8>, attributes: Value) -> Self {
        Self {
            payload: payload.into(),
            attributes,
            patches: Value::Object(Vec::new()),
        }
    }
    fn text(&self, name: &str) -> Option<&[u16]> {
        match self.attributes.get(name) {
            Some(Value::String(s)) => Some(s),
            _ => None,
        }
    }
    fn set(&mut self, name: &str, value: Value) {
        for object in [&mut self.attributes, &mut self.patches] {
            if let Value::Object(fields) = object {
                if let Some((_, entry)) = fields
                    .iter_mut()
                    .find(|(k, _)| k.iter().copied().eq(name.encode_utf16()))
                {
                    *entry = value.clone();
                } else {
                    fields.push((name.encode_utf16().collect(), value.clone()));
                }
            }
        }
    }
    fn revoked(&self) -> bool {
        self.attributes.get("revokedAt").is_some()
    }
    fn expired(&self, now: f64) -> bool {
        match self.attributes.get("expiresAt") {
            Some(Value::Number(n)) => *n <= now,
            Some(Value::String(s)) if s.iter().copied().eq("-Infinity".encode_utf16()) => {
                f64::NEG_INFINITY <= now
            }
            _ => false,
        }
    }
}
#[derive(Debug)]
pub enum Rotation {
    Rotated(Record),
    Replay(Option<Record>),
    Invalid,
}
#[derive(Default, Debug)]
pub struct Store {
    tables: HashMap<Kind, HashMap<Vec<u16>, Record>>,
}
impl Store {
    pub fn put(&mut self, kind: Kind, record: Record) -> Result<(), &'static str> {
        let key = record
            .text(match kind {
                Kind::Client | Kind::Transaction | Kind::Grant => "id",
                _ => "tokenHash",
            })
            .ok_or("Authorization record requires a string identity")?
            .to_vec();
        self.tables.entry(kind).or_default().insert(key, record);
        Ok(())
    }
    pub fn get(&self, kind: Kind, key: &[u16]) -> Option<Record> {
        self.tables.get(&kind)?.get(key).cloned()
    }
    pub fn take(&mut self, kind: Kind, key: &[u16]) -> Option<Record> {
        self.tables.get_mut(&kind)?.remove(key)
    }
    fn revoke_family(&mut self, family: &[u16], now: f64) {
        let mut grants = HashSet::new();
        if let Some(refresh) = self.tables.get_mut(&Kind::Refresh) {
            for token in refresh.values_mut() {
                if token.text("familyId") == Some(family) {
                    if let Some(id) = token.text("grantId") {
                        grants.insert(id.to_vec());
                    }
                    token.set("status", Value::String("revoked".encode_utf16().collect()));
                }
            }
        }
        if let Some(table) = self.tables.get_mut(&Kind::Grant) {
            for id in grants {
                if let Some(grant) = table.get_mut(&id)
                    && !grant.revoked()
                {
                    grant.set("revokedAt", Value::Number(now));
                }
            }
        }
    }
    pub fn rotate(
        &mut self,
        key: &[u16],
        replacement: Vec<u16>,
        now: f64,
        expires: f64,
    ) -> Rotation {
        let Some(token) = self.get(Kind::Refresh, key) else {
            return Rotation::Invalid;
        };
        if token.expired(now)
            || token.text("status") == Some(&"revoked".encode_utf16().collect::<Vec<_>>())
        {
            return Rotation::Invalid;
        }
        if token.text("status") == Some(&"rotated".encode_utf16().collect::<Vec<_>>()) {
            if let Some(family) = token.text("familyId") {
                self.revoke_family(family, now);
            }
            return Rotation::Replay(
                token
                    .text("grantId")
                    .and_then(|id| self.get(Kind::Grant, id)),
            );
        }
        let mut previous = token.clone();
        previous.set("status", Value::String("rotated".encode_utf16().collect()));
        let mut next = token.clone();
        next.set("tokenHash", Value::String(replacement.clone()));
        next.set("createdAt", Value::Number(now));
        next.set("expiresAt", Value::Number(expires));
        next.set("status", Value::String("active".encode_utf16().collect()));
        let table = self.tables.entry(Kind::Refresh).or_default();
        table.insert(key.to_vec(), previous);
        table.insert(replacement, next);
        Rotation::Rotated(token)
    }
    pub fn revoke_token(&mut self, key: &[u16], now: f64) -> Option<Record> {
        let refresh = self.get(Kind::Refresh, key);
        let access = self.get(Kind::Access, key);
        let grant_id = refresh
            .as_ref()
            .and_then(|t| t.text("grantId"))
            .or_else(|| access.as_ref().and_then(|t| t.text("grantId")));
        let grant = grant_id.and_then(|id| self.get(Kind::Grant, id));
        let already = grant.as_ref().is_some_and(Record::revoked)
            || refresh.as_ref().is_some_and(|t| {
                t.text("status") == Some(&"revoked".encode_utf16().collect::<Vec<_>>())
            })
            || access.as_ref().is_some_and(Record::revoked);
        if let Some(token) = refresh
            && let Some(family) = token.text("familyId")
        {
            self.revoke_family(family, now);
        }
        if let Some(mut token) = access {
            token.set("revokedAt", Value::Number(now));
            self.tables
                .entry(Kind::Access)
                .or_default()
                .insert(key.to_vec(), token);
        }
        if already { None } else { grant }
    }
    pub fn revoke_grant(&mut self, id: &[u16], now: f64) {
        if let Some(grant) = self
            .tables
            .get_mut(&Kind::Grant)
            .and_then(|t| t.get_mut(id))
        {
            grant.set("revokedAt", Value::Number(now));
        }
        for kind in [Kind::Access, Kind::Refresh] {
            if let Some(table) = self.tables.get_mut(&kind) {
                for token in table.values_mut().filter(|t| t.text("grantId") == Some(id)) {
                    match kind {
                        Kind::Access => token.set("revokedAt", Value::Number(now)),
                        _ => token.set("status", Value::String("revoked".encode_utf16().collect())),
                    }
                }
            }
        }
    }
}

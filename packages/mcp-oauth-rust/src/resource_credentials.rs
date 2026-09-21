//! One durable resource identity owns URL history, grant and issuer registrations.
use mcp_protocol_rust::json::{self, Value};
const INVALID: &str = "Invalid stored OAuth resource identity; reset explicitly to recover";
const MAX_GENERATION: u64 = 9_007_199_254_740_991;
#[derive(Debug)]
struct Document {
    resource: Vec<u16>,
    generation: u64,
    session: Value,
    clients: Vec<(Vec<u16>, Value)>,
}
#[derive(Debug, Default)]
pub struct ResourceCredentials {
    document: Option<Document>,
}
fn property(key: &str, value: Value) -> (Vec<u16>, Value) {
    (key.encode_utf16().collect(), value)
}
impl ResourceCredentials {
    pub fn empty() -> Self {
        Self::default()
    }
    pub fn read(source: Option<&[u8]>) -> Result<Self, &'static str> {
        let Some(source) = source else {
            return Ok(Self::empty());
        };
        let value = json::parse(source, Default::default()).map_err(
            |_| "Stored OAuth resource identity must be valid JSON; reset explicitly to recover",
        )?;
        if !matches!(value, Value::Object(_)) {
            return Err("Invalid stored OAuth resource identity");
        }
        let Some(Value::String(resource)) = value.get("resource") else {
            return Err(INVALID);
        };
        let Some(Value::Number(generation)) = value.get("generation") else {
            return Err(INVALID);
        };
        let Some(session) = value.get("session") else {
            return Err(INVALID);
        };
        let Some(Value::Object(clients)) = value.get("clients") else {
            return Err(INVALID);
        };
        if value.get("version") != Some(&Value::Number(1.0))
            || !generation.is_finite()
            || generation.fract() != 0.0
            || !(0.0..=MAX_GENERATION as f64).contains(generation)
            || (!matches!(session, Value::Null)
                && (!crate::session::validate_session(session)
                    || session.get("resource") != Some(&Value::String(resource.clone()))))
        {
            return Err(INVALID);
        }
        let mut normalized = Vec::with_capacity(clients.len());
        for (issuer, client) in clients {
            let client = crate::registration::normalize_stored(client)?
                .ok_or("Invalid stored OAuth resource client")?;
            normalized.push((issuer.clone(), client));
        }
        Ok(Self {
            document: Some(Document {
                resource: resource.clone(),
                generation: *generation as u64,
                session: session.clone(),
                clients: normalized,
            }),
        })
    }
    pub fn resource(&self) -> Option<&[u16]> {
        self.document
            .as_ref()
            .map(|value| value.resource.as_slice())
    }
    pub fn issuers(&self) -> Value {
        Value::Array(
            self.document
                .as_ref()
                .map(|value| {
                    value
                        .clients
                        .iter()
                        .map(|(key, _)| Value::String(key.clone()))
                        .collect()
                })
                .unwrap_or_default(),
        )
    }
    pub fn initial_grant_allowed(&self) -> bool {
        self.document
            .as_ref()
            .is_none_or(|value| value.generation == 0)
    }
    pub fn reconcile(&mut self, resource: &[u16]) -> Result<bool, &'static str> {
        if self.resource() == Some(resource) {
            return Ok(false);
        }
        let generation = match &self.document {
            None => 0,
            Some(value) => value
                .generation
                .checked_add(1)
                .filter(|value| *value <= MAX_GENERATION)
                .ok_or("OAuth resource identity generation limit exceeded")?,
        };
        self.document = Some(Document {
            resource: resource.to_vec(),
            generation,
            session: Value::Null,
            clients: Vec::new(),
        });
        Ok(true)
    }
    pub fn session(&self, resource: &[u16]) -> Value {
        self.document
            .as_ref()
            .filter(|value| value.resource == resource)
            .map(|value| value.session.clone())
            .unwrap_or(Value::Null)
    }
    pub fn client(&self, issuer: &[u16]) -> Value {
        self.document
            .as_ref()
            .and_then(|value| value.clients.iter().find(|(key, _)| key == issuer))
            .map(|(_, value)| value.clone())
            .unwrap_or(Value::Null)
    }
    pub fn set_session(&mut self, session: Value) -> Result<(), &'static str> {
        self.document.as_mut().ok_or(INVALID)?.session = session;
        Ok(())
    }
    pub fn clear_session(&mut self) -> Result<(), &'static str> {
        let document = self.document.as_mut().ok_or(INVALID)?;
        document.session = Value::Null;
        document.generation = document.generation.max(1);
        Ok(())
    }
    pub fn set_client(&mut self, issuer: Vec<u16>, client: Value) -> Result<(), &'static str> {
        let document = self
            .document
            .as_mut()
            .ok_or("OAuth resource identity must be bound before registering a client")?;
        if let Some((_, value)) = document.clients.iter_mut().find(|(key, _)| *key == issuer) {
            *value = client;
        } else {
            document.clients.push((issuer, client));
        }
        Ok(())
    }
    pub fn clear_client(&mut self, issuer: &[u16]) -> bool {
        let Some(document) = self.document.as_mut() else {
            return false;
        };
        let old = document.clients.len();
        document.clients.retain(|(key, _)| key != issuer);
        document.clients.len() != old
    }
    pub fn serialize(&self) -> Result<String, &'static str> {
        let document = self.document.as_ref().ok_or(INVALID)?;
        Ok(json::stringify(&Value::Object(vec![
            property("version", Value::Number(1.0)),
            property("resource", Value::String(document.resource.clone())),
            property("generation", Value::Number(document.generation as f64)),
            property("session", document.session.clone()),
            property("clients", Value::Object(document.clients.clone())),
        ])))
    }
    pub fn reset(resource: Vec<u16>) -> Self {
        Self {
            document: Some(Document {
                resource,
                generation: 1,
                session: Value::Null,
                clients: Vec::new(),
            }),
        }
    }
}

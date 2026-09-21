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
    pub fn import_session(mut session: Value) -> Result<Self, &'static str> {
        crate::registration::validate_credential_json(&session)
            .map_err(|_| "Invalid OAuth import session")?;
        const INVALID_IMPORT: &str = "Invalid OAuth import session or resource binding";
        if !crate::session::validate_session(&session)
            || session.get("tokens").is_none()
            || session.get("refreshState").is_some()
        {
            return Err(INVALID_IMPORT);
        }
        let resource = session.get("resource").cloned().ok_or(INVALID_IMPORT)?;
        let issuer = session
            .get("authorizationServer")
            .cloned()
            .ok_or(INVALID_IMPORT)?;
        let metadata = session
            .get("discovery")
            .and_then(|value| value.get("authorizationServerMetadata"))
            .ok_or(INVALID_IMPORT)?;
        if metadata.get("issuer") != Some(&issuer)
            || !matches!(
                session
                    .get("discovery")
                    .and_then(|value| value.get("resourceMetadata"))
                    .and_then(|value| value.get("resource")),
                Some(Value::String(_))
            )
        {
            return Err(INVALID_IMPORT);
        }
        let mut client =
            crate::registration::normalize_stored(session.get("client").ok_or(INVALID_IMPORT)?)
                .map_err(|_| INVALID_IMPORT)?
                .ok_or(INVALID_IMPORT)?;
        if let Some(registration) = client.get("registration") {
            if registration
                .get("issuer")
                .is_some_and(|value| !matches!(value, Value::Null) && value != &issuer)
            {
                return Err(INVALID_IMPORT);
            }
            set(
                &mut client,
                "registrationOwnership",
                Value::String("caller".encode_utf16().collect()),
            )?;
        }
        set(&mut session, "client", client.clone())?;
        let Value::String(resource) = resource else {
            return Err(INVALID_IMPORT);
        };
        let Value::String(issuer) = issuer else {
            return Err(INVALID_IMPORT);
        };
        Ok(Self {
            document: Some(Document {
                resource,
                generation: 1,
                session,
                clients: vec![(issuer, client)],
            }),
        })
    }
    pub fn import_bindings(&self) -> Result<Value, &'static str> {
        let document = self.document.as_ref().ok_or(INVALID)?;
        let session = &document.session;
        let access = session
            .get("tokens")
            .and_then(|value| value.get("accessToken"))
            .ok_or(INVALID)?;
        let issuer = session.get("authorizationServer").ok_or(INVALID)?;
        let resource = session
            .get("discovery")
            .and_then(|value| value.get("resourceMetadata"))
            .and_then(|value| value.get("resource"))
            .ok_or(INVALID)?;
        Ok(Value::Object(vec![
            property("resource", Value::String(document.resource.clone())),
            property("issuer", issuer.clone()),
            property("metadataResource", resource.clone()),
            property("accessToken", access.clone()),
        ]))
    }
    pub fn canonicalize_import(&mut self, resource: Vec<u16>) -> Result<(), &'static str> {
        let document = self.document.as_mut().ok_or(INVALID)?;
        set(
            &mut document.session,
            "resource",
            Value::String(resource.clone()),
        )?;
        document.resource = resource;
        Ok(())
    }
}

fn set(value: &mut Value, key: &str, entry: Value) -> Result<(), &'static str> {
    let Value::Object(fields) = value else {
        return Err(INVALID);
    };
    if let Some((_, value)) = fields
        .iter_mut()
        .rev()
        .find(|(name, _)| name.iter().copied().eq(key.encode_utf16()))
    {
        *value = entry;
    } else {
        fields.push(property(key, entry));
    }
    Ok(())
}

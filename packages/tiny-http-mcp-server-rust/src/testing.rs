//! In-memory test token identifiers and verification policy. Claims remain in the host.
use std::collections::HashMap;

#[derive(Debug, PartialEq, Eq)]
pub enum VerificationError {
    Unknown,
    Issuer,
    Audience,
    Expired,
    Scope,
}

struct Token {
    issuer: Vec<u16>,
    audience: Vec<Vec<u16>>,
    scopes: Vec<Vec<u16>>,
    expires_at: f64,
}

pub struct TestTokens {
    index: HashMap<Vec<u16>, usize>,
    tokens: Vec<Token>,
    next_token: u64,
}

impl Default for TestTokens {
    fn default() -> Self {
        Self {
            index: HashMap::new(),
            tokens: vec![],
            next_token: 1,
        }
    }
}

impl TestTokens {
    pub fn prepare(&mut self, token: Option<Vec<u16>>) -> Result<Vec<u16>, Vec<u16>> {
        let token = match token {
            Some(token) => token,
            None => {
                let token = format!("test-token-{}", self.next_token)
                    .encode_utf16()
                    .collect();
                self.next_token = self
                    .next_token
                    .checked_add(1)
                    .expect("test token sequence exhausted");
                token
            }
        };
        if self.index.contains_key(&token) {
            Err(token)
        } else {
            Ok(token)
        }
    }

    pub fn issue(
        &mut self,
        token: Option<Vec<u16>>,
        issuer: Vec<u16>,
        audience: Vec<Vec<u16>>,
        scopes: Vec<Vec<u16>>,
        expires_at: f64,
    ) -> Result<(Vec<u16>, usize), Vec<u16>> {
        let token = self.prepare(token)?;
        let slot = self.tokens.len();
        self.tokens.push(Token {
            issuer,
            audience,
            scopes,
            expires_at,
        });
        self.index.insert(token.clone(), slot);
        Ok((token, slot))
    }

    pub fn lookup(
        &self,
        token: &[u16],
        resource: &[u16],
        servers: &[Vec<u16>],
    ) -> Result<usize, VerificationError> {
        let slot = *self.index.get(token).ok_or(VerificationError::Unknown)?;
        let token = &self.tokens[slot];
        if !servers.contains(&token.issuer) {
            return Err(VerificationError::Issuer);
        }
        if !token.audience.iter().any(|value| value == resource) {
            return Err(VerificationError::Audience);
        }
        Ok(slot)
    }

    pub fn admit(
        &self,
        slot: usize,
        required: &[Vec<u16>],
        now: f64,
    ) -> Result<(), VerificationError> {
        let token = self.tokens.get(slot).ok_or(VerificationError::Unknown)?;
        if token.expires_at <= now {
            return Err(VerificationError::Expired);
        }
        if !required.is_empty() && !token.scopes.iter().any(|scope| required.contains(scope)) {
            return Err(VerificationError::Scope);
        }
        Ok(())
    }

    pub fn len(&self) -> usize {
        self.tokens.len()
    }
    pub fn is_empty(&self) -> bool {
        self.tokens.is_empty()
    }
    pub fn index_len(&self) -> usize {
        self.index.len()
    }
}

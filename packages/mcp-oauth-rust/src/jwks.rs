//! JWT/JWKS policy. A host supplies time, URL canonicalization and cryptographic primitives.
use mcp_protocol_rust::{
    json::{self, Limits, Value},
    strings::trim_ecmascript as trim_utf16,
};
use std::sync::Arc;

fn string(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
fn text(value: Option<&Value>) -> Option<&[u16]> {
    match value {
        Some(Value::String(s)) => Some(s),
        _ => None,
    }
}
fn equals(value: Option<&Value>, expected: &str) -> bool {
    text(value).is_some_and(|s| s.iter().copied().eq(expected.encode_utf16()))
}
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::Number(n)) => *n != 0.0 && !n.is_nan(),
        Some(Value::String(s)) => !s.is_empty(),
        _ => true,
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Configuration {
    pub skew: f64,
    pub ttl: f64,
    pub timeout: f64,
    pub cooldown: f64,
}
impl Configuration {
    pub fn validate(
        self,
        protocol: &str,
        hostname: &str,
        credentials: bool,
        insecure: bool,
    ) -> Result<(), &'static str> {
        if !["http:", "https:"].contains(&protocol) || credentials {
            return Err("jwksUrl must be an HTTP or HTTPS URL without credentials");
        }
        if !self.skew.is_finite() || self.skew < 0.0 {
            return Err("clockSkewSeconds must be a finite non-negative number");
        }
        for (value, error) in [
            (
                self.ttl,
                "jwksCacheTtlMs must be a non-negative safe integer",
            ),
            (
                self.cooldown,
                "jwksRefreshCooldownMs must be a non-negative safe integer",
            ),
        ] {
            if !value.is_finite()
                || value.fract() != 0.0
                || !(0.0..=9_007_199_254_740_991.0).contains(&value)
            {
                return Err(error);
            }
        }
        if !self.timeout.is_finite()
            || self.timeout.fract() != 0.0
            || !(1.0..=2_147_483_647.0).contains(&self.timeout)
        {
            return Err("jwksFetchTimeoutMs must be a positive integer no greater than 2147483647");
        }
        let parts: Vec<_> = hostname.split('.').collect();
        let loopback = hostname == "localhost"
            || hostname.ends_with(".localhost")
            || ["[::1]", "::1"].contains(&hostname)
            || (parts.len() == 4
                && parts[0] == "127"
                && parts[1..].iter().all(|p| p.parse::<u8>().is_ok()));
        if protocol != "https:" && !loopback && !insecure {
            return Err("jwksUrl must use HTTPS for non-loopback hosts");
        }
        Ok(())
    }
}

/// Browser-compatible base64 decoding: ASCII whitespace and valid trailing padding only.
pub fn decode(input: &[u16]) -> Result<Vec<u8>, &'static str> {
    let mut units: Vec<_> = input
        .iter()
        .copied()
        .filter(|u| !matches!(u, 9 | 10 | 12 | 13 | 32))
        .collect();
    if units.len().is_multiple_of(4) {
        if units.last() == Some(&61) {
            units.pop();
        }
        if units.last() == Some(&61) {
            units.pop();
        }
    }
    if units.len() % 4 == 1 {
        return Err("token verification failed");
    }
    let mut output = Vec::with_capacity(units.len() * 3 / 4);
    let mut bits = 0u32;
    let mut count = 0;
    for unit in units {
        let n = match unit {
            65..=90 => unit - 65,
            97..=122 => unit - 97 + 26,
            48..=57 => unit - 48 + 52,
            43 | 45 => 62,
            47 | 95 => 63,
            _ => return Err("token verification failed"),
        };
        bits = (bits << 6) | n as u32;
        count += 6;
        if count >= 8 {
            count -= 8;
            output.push((bits >> count) as u8);
        }
    }
    Ok(output)
}
fn decoded_json(segment: &[u16]) -> Result<Value, &'static str> {
    let bytes = decode(segment)?;
    // JOSE's nonfatal TextDecoder replaces malformed UTF-8 and removes a leading BOM.
    let decoded = String::from_utf8_lossy(&bytes);
    json::parse(
        decoded
            .strip_prefix('\u{feff}')
            .unwrap_or(&decoded)
            .as_bytes(),
        Limits::default(),
    )
    .map_err(|_| "token verification failed")
}

#[derive(Debug)]
pub struct Token {
    raw: Vec<u16>,
    segments: Vec<Vec<u16>>,
    pub header: Value,
    pub algorithm: String,
}
impl Token {
    pub fn new(raw: &[u16], allowed: &[String]) -> Result<Self, &'static str> {
        let segments: Vec<Vec<u16>> = raw.split(|u| *u == 46).map(<[u16]>::to_vec).collect();
        if ![3, 5].contains(&segments.len()) || segments[0].is_empty() {
            return Err("token verification failed");
        }
        let header = decoded_json(&segments[0])?;
        if !matches!(header, Value::Object(_)) {
            return Err("token verification failed");
        }
        if matches!(header.get("crit"),Some(Value::Array(a)) if !a.is_empty()) {
            return Err("unsupported critical token claims");
        }
        let algorithm = text(header.get("alg"))
            .and_then(|s| String::from_utf16(s).ok())
            .ok_or("unsupported token algorithm")?;
        if algorithm == "none" || algorithm.starts_with("HS") || !allowed.contains(&algorithm) {
            return Err("unsupported token algorithm");
        }
        Ok(Self {
            raw: raw.to_vec(),
            segments,
            header,
            algorithm,
        })
    }
    pub fn signature_data(&self) -> Result<(Vec<u8>, Vec<u8>), &'static str> {
        if self.segments.len() != 3
            || self.header.get("crit").is_some()
            || self.algorithm.is_empty()
        {
            return Err("token verification failed");
        }
        let mut data = Vec::new();
        for segment in &self.segments[..2] {
            if !data.is_empty() {
                data.push(b'.');
            }
            for unit in segment {
                if *unit > 127 {
                    return Err("token verification failed");
                }
                data.push(*unit as u8);
            }
        }
        Ok((decode(&self.segments[2])?, data))
    }
    pub fn payload(&self) -> Result<Value, &'static str> {
        let payload = decoded_json(&self.segments[1])?;
        if !matches!(payload, Value::Object(_)) {
            return Err("token verification failed");
        }
        Ok(payload)
    }
    pub fn result(
        &self,
        payload: &Value,
        audience: &[u16],
        required: &[Vec<u16>],
    ) -> Result<Value, &'static str> {
        let scopes = scopes(payload);
        if !required.iter().all(|s| scopes.contains(s)) {
            return Err("insufficient scope");
        }
        let mut fields = vec![
            ("token", Value::String(self.raw.clone())),
            (
                "issuer",
                Value::String(text(payload.get("iss")).unwrap_or_default().to_vec()),
            ),
            (
                "audience",
                Value::Array(vec![Value::String(audience.to_vec())]),
            ),
            (
                "scopes",
                Value::Array(scopes.into_iter().map(Value::String).collect()),
            ),
            (
                "expiresAt",
                payload.get("exp").cloned().unwrap_or(Value::Null),
            ),
            ("claims", payload.clone()),
        ];
        for (key, field) in [("sub", "subject"), ("client_id", "clientId")] {
            if let Some(s) = text(payload.get(key)) {
                fields.push((field, Value::String(s.to_vec())));
            }
        }
        Ok(object(fields))
    }
}
pub fn parse_jwks(source: &str) -> Result<Vec<Value>, &'static str> {
    let value = json::parse(source.as_bytes(), Limits::default())
        .map_err(|_| "token verification temporarily unavailable")?;
    match value.get("keys") {
        Some(Value::Array(keys)) if keys.iter().all(|k| matches!(k, Value::Object(_))) => {
            Ok(keys.clone())
        }
        _ => Err("token verification temporarily unavailable"),
    }
}
pub fn candidates<'a>(keys: &'a [Value], token: &Token) -> Vec<&'a Value> {
    let kid = text(token.header.get("kid"));
    keys.iter().filter(|key| {
        if kid.is_some() && kid != text(key.get("kid")) { return false; }
        if text(key.get("alg")).is_some() && !equals(key.get("alg"),&token.algorithm) { return false; }
        if text(key.get("use")).is_some() && !equals(key.get("use"),"sig") { return false; }
        !matches!(key.get("key_ops"),Some(Value::Array(ops)) if !ops.iter().any(|op| equals(Some(op),"verify")))
    }).collect()
}

/// Prepare native-platform crypto effects; private keys retain sign usages and fail verification.
pub fn import_plan(key: &Value, alg: &str) -> Result<Value, &'static str> {
    let private = truthy(key.get("d")) || truthy(key.get("priv"));
    let hash = string(&format!(
        "SHA-{}",
        alg.get(alg.len().saturating_sub(3)..).unwrap_or_default()
    ));
    let (import, verify, usages) = if equals(key.get("kty"), "RSA") {
        if key.get("oth").is_some() {
            return Err("malformed key");
        }
        let name = match alg {
            "PS256" | "PS384" | "PS512" => "RSA-PSS",
            "RS256" | "RS384" | "RS512" => "RSASSA-PKCS1-v1_5",
            _ => return Err("malformed key"),
        };
        let import = object(vec![("name", string(name)), ("hash", hash.clone())]);
        let mut verify = vec![("name", string(name)), ("hash", hash)];
        if name == "RSA-PSS" {
            verify.push((
                "saltLength",
                Value::Number(alg[2..].parse::<f64>().unwrap() / 8.0),
            ));
        }
        (
            import,
            object(verify),
            if private { "sign" } else { "verify" },
        )
    } else if equals(key.get("kty"), "EC") {
        let curve = match alg {
            "ES256" => "P-256",
            "ES384" => "P-384",
            "ES512" => "P-521",
            _ => return Err("malformed key"),
        };
        (
            object(vec![
                ("name", string("ECDSA")),
                ("namedCurve", string(curve)),
            ]),
            object(vec![("name", string("ECDSA")), ("hash", hash)]),
            if private { "sign" } else { "verify" },
        )
    } else if equals(key.get("kty"), "OKP") && ["EdDSA", "Ed25519"].contains(&alg) {
        (
            object(vec![("name", string("Ed25519"))]),
            object(vec![("name", string("Ed25519"))]),
            if private { "sign" } else { "verify" },
        )
    } else if equals(key.get("kty"), "AKP")
        && ["ML-DSA-44", "ML-DSA-65", "ML-DSA-87"].contains(&alg)
        && equals(key.get("alg"), alg)
    {
        (
            object(vec![("name", string(alg))]),
            object(vec![("name", string(alg))]),
            if private { "sign" } else { "verify" },
        )
    } else if equals(key.get("kty"), "oct") {
        let k = text(key.get("k"))
            .filter(|k| !k.is_empty())
            .ok_or("malformed key")?;
        decode(k).map_err(|_| "malformed key")?;
        return Ok(object(vec![
            ("symmetric", Value::Bool(true)),
            ("key", key.clone()),
        ]));
    } else {
        return Err("malformed key");
    };
    let mut data = match key {
        Value::Object(fields) => fields.clone(),
        _ => return Err("malformed key"),
    };
    data.retain(|(k, _)| {
        !["alg", "use"]
            .iter()
            .any(|name| k.iter().copied().eq(name.encode_utf16()))
    });
    if equals(key.get("kty"), "AKP") {
        data.push(("alg".encode_utf16().collect(), string(alg)));
    }
    let ext = match key.get("ext") {
        None | Some(Value::Null) => Value::Bool(!private),
        Some(v) => v.clone(),
    };
    let usages = key
        .get("key_ops")
        .filter(|v| !matches!(v, Value::Null))
        .cloned()
        .unwrap_or(Value::Array(vec![string(usages)]));
    Ok(object(vec![
        ("key", Value::Object(data)),
        ("import", import),
        ("verify", verify),
        ("extractable", ext),
        ("usages", usages),
    ]))
}

pub fn claims(
    header: &Value,
    payload: &Value,
    issuers: &[Vec<u16>],
    now_seconds: f64,
    skew: f64,
    require_type: bool,
) -> Result<(), &'static str> {
    if require_type {
        let typ = text(header.get("typ"))
            .and_then(|s| String::from_utf16(s).ok())
            .unwrap_or_default()
            .to_lowercase();
        if !["at+jwt", "application/at+jwt"].contains(&typ.as_str()) {
            return Err("invalid access token type");
        }
    }
    if payload.get("iss").is_none() {
        return Err("issuer mismatch");
    }
    if payload.get("exp").is_none() {
        return Err("token missing expiry");
    }
    if !text(payload.get("iss")).is_some_and(|issuer| issuers.iter().any(|s| s == issuer)) {
        return Err("issuer mismatch");
    }
    if payload
        .get("iat")
        .is_some_and(|v| !matches!(v, Value::Number(_)))
    {
        return Err("token verification failed");
    }
    if let Some(v) = payload.get("nbf") {
        match v {
            Value::Number(n) if *n <= now_seconds.floor() + skew => {}
            _ => return Err("token not active yet"),
        }
    }
    match payload.get("exp") {
        Some(Value::Number(n)) if *n > now_seconds.floor() - skew => Ok(()),
        _ => Err("token expired"),
    }
}
pub fn scopes(payload: &Value) -> Vec<Vec<u16>> {
    if let Some(raw) = text(payload.get("scope")).or_else(|| text(payload.get("scopes"))) {
        return raw
            .split(|u| *u == 32)
            .map(trim_utf16)
            .filter(|s| !s.is_empty())
            .map(<[u16]>::to_vec)
            .collect();
    }
    match payload.get("scopes") {
        Some(Value::Array(a)) if a.iter().all(|v| matches!(v, Value::String(_))) => {
            a.iter().map(|v| text(Some(v)).unwrap().to_vec()).collect()
        }
        _ => Vec::new(),
    }
}
#[derive(Debug)]
pub struct Cache {
    keys: Option<Arc<Vec<Value>>>,
    expires: f64,
    last_force: f64,
    ttl: f64,
    cooldown: f64,
}
impl Cache {
    pub fn new(ttl: f64, cooldown: f64) -> Self {
        Self {
            keys: None,
            expires: 0.0,
            last_force: f64::NEG_INFINITY,
            ttl,
            cooldown,
        }
    }
    pub fn cached(&self, now: f64) -> Option<&[Value]> {
        if self.expires > now {
            self.keys.as_deref().map(Vec::as_slice)
        } else {
            None
        }
    }
    pub fn store(&mut self, keys: Vec<Value>, now: f64) {
        self.store_shared(Arc::new(keys), now);
    }
    pub fn store_shared(&mut self, keys: Arc<Vec<Value>>, now: f64) {
        self.keys = Some(keys);
        self.expires = now + self.ttl;
    }
    pub fn snapshot(&self) -> Option<Arc<Vec<Value>>> {
        self.keys.clone()
    }
    pub fn keys(&self) -> &[Value] {
        self.keys.as_deref().map(Vec::as_slice).unwrap_or_default()
    }
    pub fn force(&mut self, now: f64) -> bool {
        if now - self.last_force < self.cooldown {
            return false;
        }
        self.last_force = now;
        true
    }
}

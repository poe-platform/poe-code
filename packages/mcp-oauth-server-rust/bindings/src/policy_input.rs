//! Copy relevant policy fields directly; unrelated values and serialization hooks are never read.
use mcp_protocol_rust::json::{Limits, Value};
use napi::{Env, JsValue, ValueType, bindgen_prelude::*};
pub enum Mode<'a> {
    Configuration,
    Key,
    Command(&'a str),
}
fn fields(mode: &Mode<'_>) -> &'static [&'static str] {
    match mode {
        Mode::Configuration => &[
            "issuer",
            "resources",
            "scopesSupported",
            "defaultScopes",
            "accessTokenTtlSeconds",
            "authorizationCodeTtlSeconds",
            "authorizationTransactionTtlSeconds",
            "refreshTokenTtlSeconds",
            "maxRequestBodyBytes",
        ],
        Mode::Key => &[
            "kty", "crv", "x", "y", "d", "p", "q", "n", "e", "dp", "dq", "qi", "k", "alg", "use",
            "key_ops", "ext", "oth", "priv", "pub",
        ],
        Mode::Command(command) => match *command {
            "route" => &["method", "path"],
            "signing_key" => &["algorithm", "type", "kind", "curve", "modulusLength"],
            "verification_key" => &[
                "algorithm",
                "name",
                "curve",
                "hash",
                "modulusLength",
                "usages",
            ],
            "content_type" => &["kind", "value"],
            "resource_presence" | "resource" => &["value"],
            "registration_input" => &["body"],
            "registration_metadata" => &["payload", "redirectUris"],
            "client_record" => &["id", "redirectUris", "now"],
            "registration_response" => &["client", "grantTypes"],
            "authorize_start" => &["response_type", "client_id"],
            "authorize_client" => &["params", "client"],
            "authorize_scopes" => &["params", "client", "redirectUri"],
            "transaction_record" => &[
                "params",
                "id",
                "redirectUri",
                "resource",
                "scopes",
                "createdAt",
                "expiresAtNow",
            ],
            "subject" => &["subject"],
            "complete" => &["transaction", "input", "now"],
            "grant_record" => &["id", "transaction", "subject", "scopes", "now"],
            "code_record" => &["hash", "grantId", "transaction", "subject", "scopes", "now"],
            "deny" => &["transaction"],
            "code_expiry" => &["code", "now"],
            "code_initial_binding" => &["body", "code"],
            "code_resource_binding" => &["code", "body", "resource"],
            "code_pkce" => &["matches"],
            "grant_valid" | "notify_grant" => &["grant"],
            "refresh_presence" | "code_presence" | "grant_type" => &["body"],
            "refresh_expiry" => &["now"],
            "refresh_status" => &["status"],
            "refresh_binding" => &["previous", "body", "resource"],
            "token_plan" => &["grant", "now", "tokenId", "algorithm", "keyId"],
            "access_record" => &["hash", "tokenId", "grant", "expiresAt"],
            "token_response" => &["token", "grant"],
            "refresh_record" => &["hash", "familyId", "grant", "now"],
            "access_resource" => &["resource"],
            "access_expiry" => &["storedToken", "now"],
            "verify_binding" => &["payload", "storedToken", "resource"],
            _ => &[],
        },
    }
}
fn nested(field: &str, command: &str) -> &'static [&'static str] {
    match field {
        "client" if command == "authorize_client" => &[],
        "client" if command == "authorize_scopes" => &["redirectUris"],
        "client" => &["id", "redirectUris", "createdAt"],
        "params" | "body" => &[
            "response_type",
            "client_id",
            "redirect_uri",
            "code_challenge",
            "code_challenge_method",
            "scope",
            "resource",
            "state",
            "grant_type",
            "code",
            "code_verifier",
            "refresh_token",
        ],
        "transaction" => &[
            "id",
            "clientId",
            "redirectUri",
            "codeChallenge",
            "resource",
            "scopes",
            "state",
            "createdAt",
            "expiresAt",
        ],
        "grant" => &[
            "id",
            "clientId",
            "subject",
            "resource",
            "scopes",
            "createdAt",
            "revokedAt",
        ],
        "code" => &[
            "tokenHash",
            "grantId",
            "clientId",
            "subject",
            "redirectUri",
            "codeChallenge",
            "resource",
            "scopes",
            "expiresAt",
        ],
        "previous" => &[
            "tokenHash",
            "familyId",
            "grantId",
            "clientId",
            "subject",
            "resource",
            "scopes",
            "createdAt",
            "expiresAt",
            "status",
        ],
        "storedToken" => &[
            "tokenHash",
            "tokenId",
            "grantId",
            "subject",
            "clientId",
            "resource",
            "expiresAt",
            "revokedAt",
        ],
        "input" => &["scopes"],
        "payload" if command == "registration_metadata" => &[
            "token_endpoint_auth_method",
            "grant_types",
            "response_types",
        ],
        "payload" => &["sub", "client_id", "jti", "scope"],
        _ => &[],
    }
}
pub fn read<'env>(env: &'env Env, input: Unknown<'env>, mode: Mode<'_>) -> Result<Value> {
    let command = match &mode {
        Mode::Command(command) => *command,
        _ => "",
    };
    Reader {
        env,
        ancestors: Vec::new(),
        nodes: 0,
        bytes: 0,
        limits: Limits::default(),
        command,
    }
    .visit(input, 0, fields(&mode))
    .map(|v| v.unwrap_or(Value::Null))
}
struct Reader<'env, 'mode> {
    env: &'env Env,
    ancestors: Vec<Unknown<'env>>,
    nodes: usize,
    bytes: usize,
    limits: Limits,
    command: &'mode str,
}
impl<'env> Reader<'env, '_> {
    fn visit(
        &mut self,
        input: Unknown<'env>,
        depth: usize,
        fields: &'static [&'static str],
    ) -> Result<Option<Value>> {
        self.nodes += 1;
        if depth > self.limits.max_depth || self.nodes > self.limits.max_nodes {
            return Err(napi::Error::from_reason(
                "Authorization-server input resource limit exceeded",
            ));
        }
        let value = match input.get_type()? {
            ValueType::Undefined => return Ok(None),
            ValueType::Null => Value::Null,
            ValueType::Number => Value::Number(unsafe { input.cast()? }),
            ValueType::Boolean => Value::Bool(unsafe { input.cast()? }),
            ValueType::String => {
                let text: Utf16String = unsafe { input.cast()? };
                if text.len() > self.limits.max_bytes {
                    return Err(napi::Error::from_reason(
                        "Authorization-server input resource limit exceeded",
                    ));
                }
                let width: usize = char::decode_utf16(text.iter().copied())
                    .map(|c| c.map_or(3, |c| c.len_utf8()))
                    .sum();
                if width > self.limits.max_bytes - self.bytes {
                    return Err(napi::Error::from_reason(
                        "Authorization-server input resource limit exceeded",
                    ));
                }
                self.bytes += width;
                Value::String(text.to_vec())
            }
            ValueType::Object => {
                for ancestor in &self.ancestors {
                    if self.env.strict_equals(*ancestor, input)? {
                        return Err(napi::Error::from_reason(
                            "Cyclic authorization-server policy input",
                        ));
                    }
                }
                let object: Object = unsafe { input.cast()? };
                self.ancestors.push(input);
                let value = if object.is_array()? {
                    let length = object.get_array_length()? as usize;
                    if length > self.limits.max_nodes - self.nodes {
                        return Err(napi::Error::from_reason(
                            "Authorization-server input resource limit exceeded",
                        ));
                    }
                    let mut values = Vec::with_capacity(length);
                    for index in 0..length {
                        values.push(
                            self.visit(object.get_element(index as u32)?, depth + 1, &[])?
                                .unwrap_or(Value::Null),
                        );
                    }
                    Value::Array(values)
                } else {
                    let keys = object.get_all_property_names(
                        KeyCollectionMode::OwnOnly,
                        KeyFilter::AllProperties,
                        KeyConversion::NumbersToStrings,
                    )?;
                    let length = keys.get_array_length()?;
                    if length as usize > self.limits.max_nodes - self.nodes {
                        return Err(napi::Error::from_reason(
                            "Authorization-server input resource limit exceeded",
                        ));
                    }
                    let mut values = Vec::new();
                    for index in 0..length {
                        let key: Unknown = keys.get_element(index)?;
                        if key.get_type()? == ValueType::Symbol {
                            continue;
                        }
                        let key: Utf16String = unsafe { key.cast()? };
                        let Some(name) = fields
                            .iter()
                            .find(|name| key.iter().copied().eq(name.encode_utf16()))
                        else {
                            continue;
                        };
                        if let Some(entry) = object.get::<Unknown>(name)?
                            && let Some(value) =
                                self.visit(entry, depth + 1, nested(name, self.command))?
                        {
                            values.push((key.to_vec(), value));
                        }
                    }
                    Value::Object(values)
                };
                self.ancestors.pop();
                value
            }
            _ => Value::Bool(false),
        };
        Ok(Some(value))
    }
}

//! Token endpoint authentication plans. Hosts provide HTTP effects only.
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Method {
    None,
    Post,
    Basic,
}
pub fn normalize(value: Option<&Value>) -> Result<Option<Method>, &'static str> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => match String::from_utf16_lossy(value).as_str() {
            "none" => Ok(Some(Method::None)),
            "client_secret_post" => Ok(Some(Method::Post)),
            "client_secret_basic" => Ok(Some(Method::Basic)),
            _ => Err("Unsupported OAuth token endpoint authentication method"),
        },
        _ => Err("Unsupported OAuth token endpoint authentication method"),
    }
}
#[derive(Debug)]
pub struct RequestPlan {
    pub body: String,
    pub authorization: Option<String>,
}
pub fn plan(
    params: &Value,
    id: &[u16],
    secret: Option<&[u16]>,
    method: Option<&Value>,
) -> Result<RequestPlan, &'static str> {
    let method = normalize(method)?.unwrap_or(if secret.is_some() {
        Method::Post
    } else {
        Method::None
    });
    if method != Method::None && secret.is_none_or(|value| trim_ecmascript(value).is_empty()) {
        return Err("OAuth token endpoint authentication requires a client secret");
    }
    let Value::Object(params) = params else {
        return Err("Invalid OAuth token request parameter");
    };
    let mut pairs = Vec::with_capacity(params.len() + 2);
    for (key, value) in params {
        let Value::String(value) = value else {
            return Err("Invalid OAuth token request parameter");
        };
        pairs.push((key.clone(), value.clone()));
    }
    let authorization = if method == Method::Basic {
        let credential = |value: &[u16]| {
            let encoded = crate::tokens::encode_form(&[(vec![], value.to_vec())]);
            encoded[1..].to_owned()
        };
        let value = format!("{}:{}", credential(id), credential(secret.unwrap()));
        let mut bytes = crate::base64::encode_url(value.as_bytes()).into_bytes();
        for byte in &mut bytes {
            match *byte {
                b'-' => *byte = b'+',
                b'_' => *byte = b'/',
                _ => {}
            }
        }
        while !bytes.len().is_multiple_of(4) {
            bytes.push(b'=');
        }
        Some(format!(
            "Basic {}",
            String::from_utf8(bytes).expect("base64 encoder is ASCII")
        ))
    } else {
        pairs.push(("client_id".encode_utf16().collect(), id.to_vec()));
        if method == Method::Post {
            pairs.push((
                "client_secret".encode_utf16().collect(),
                secret.unwrap().to_vec(),
            ));
        }
        None
    };
    Ok(RequestPlan {
        body: crate::tokens::encode_form(&pairs),
        authorization,
    })
}

impl Method {
    pub fn label(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Post => "client_secret_post",
            Self::Basic => "client_secret_basic",
        }
    }
}
fn supported(metadata: &Value) -> Result<Option<&[Value]>, &'static str> {
    match metadata.get("token_endpoint_auth_methods_supported") {
        None => Ok(None),
        Some(Value::Array(values))
            if values.len() <= 128
                && values.iter().all(|value| matches!(value, Value::String(_))) =>
        {
            Ok(Some(values))
        }
        _ => Err("Invalid OAuth token endpoint authentication metadata"),
    }
}
fn advertised(values: &[Value], method: Method) -> bool {
    values.iter().any(|value| matches!(value,Value::String(value) if value.iter().copied().eq(method.label().encode_utf16())))
}
pub fn choose_registration_method(
    metadata: &Value,
    requested: Option<&Value>,
) -> Result<Method, &'static str> {
    let requested = normalize(requested)?;
    let supported = supported(metadata)?;
    let method=requested.or_else(|| match supported {
        None => Some(Method::None),
        Some(values) => [Method::None,Method::Basic,Method::Post].into_iter().find(|method|advertised(values,*method)),
    }).ok_or("Authorization server does not support the requested OAuth token endpoint authentication")?;
    if supported.is_some_and(|values| !advertised(values, method)) {
        return Err(
            "Authorization server does not support the requested OAuth token endpoint authentication",
        );
    }
    Ok(method)
}
fn client_method(client: &Value) -> Result<Method, &'static str> {
    Ok(normalize(client.get("tokenEndpointAuthMethod"))?.unwrap_or(
        if matches!(client.get("clientSecret"), Some(Value::String(_))) {
            Method::Post
        } else {
            Method::None
        },
    ))
}
pub fn assert_supported(client: &Value, metadata: &Value) -> Result<(), &'static str> {
    let method = client_method(client)?;
    if method != Method::None && !matches!(client.get("clientSecret"), Some(Value::String(_))) {
        return Err("OAuth token endpoint authentication requires a client secret");
    }
    if supported(metadata)?.is_some_and(|values| !advertised(values, method)) {
        return Err(
            "Authorization server does not support the requested OAuth token endpoint authentication",
        );
    }
    Ok(())
}
pub fn assert_session_method(client: &Value, expected: Option<Method>) -> Result<(), &'static str> {
    if expected.is_some_and(|expected| client_method(client).ok() != Some(expected)) {
        return Err(
            "Stored session does not match the requested OAuth token endpoint authentication; select separate persistence or reset it",
        );
    }
    Ok(())
}

//! Host-independent credential storage policy.
pub mod cache;
use mcp_protocol_rust::{
    json::{self, Limits, Value},
    strings::trim_ecmascript,
};
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn property(key: &str, value: Value) -> (Vec<u16>, Value) {
    (text(key), value)
}
fn own_string<'a>(value: &'a Value, key: &str) -> Option<&'a [u16]> {
    match value.get(key) {
        Some(Value::String(text)) => Some(text),
        _ => None,
    }
}
#[derive(Clone, Copy)]
pub enum Operation {
    Get,
    Set,
    Delete,
}
impl Operation {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "get" => Some(Self::Get),
            "set" => Some(Self::Set),
            "delete" => Some(Self::Delete),
            _ => None,
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Get => "read secret from macOS Keychain",
            Self::Set => "store secret in macOS Keychain",
            Self::Delete => "delete secret from macOS Keychain",
        }
    }
}
pub struct KeychainPlan {
    service: Vec<u16>,
    account: Vec<u16>,
}
impl KeychainPlan {
    pub fn new(service: &[u16], account: &[u16]) -> Result<Self, &'static str> {
        let service = trim_ecmascript(service);
        let account = trim_ecmascript(account);
        if service.is_empty() {
            return Err("Keychain service must not be empty");
        }
        if account.is_empty() {
            return Err("Keychain account must not be empty");
        }
        Ok(Self {
            service: service.to_vec(),
            account: account.to_vec(),
        })
    }
    pub fn command(
        &self,
        operation: Operation,
        value: Option<&[u16]>,
    ) -> Result<Vec<Vec<u16>>, &'static str> {
        let command = match operation {
            Operation::Get => "find-generic-password",
            Operation::Set => "add-generic-password",
            Operation::Delete => "delete-generic-password",
        };
        let mut args = vec![
            text(command),
            text("-s"),
            self.service.clone(),
            text("-a"),
            self.account.clone(),
        ];
        match operation {
            Operation::Get => args.push(text("-w")),
            Operation::Set => {
                let value = value.ok_or("Keychain secret must be a string")?;
                if value.iter().any(|unit| matches!(unit, 10 | 13)) {
                    return Err("Keychain secrets cannot contain line breaks");
                }
                args.extend([text("-U"), text("-w"), value.to_vec()]);
            }
            Operation::Delete => {}
        }
        Ok(args)
    }
    pub fn complete(&self, operation: Operation, result: &Value) -> Result<Value, Vec<u16>> {
        let code = match result.get("exitCode") {
            Some(Value::Number(number)) if number.is_finite() && number.fract() == 0.0 => *number,
            _ => 1.0,
        };
        if code == 0.0 {
            return Ok(match operation {
                Operation::Get => {
                    let stdout = own_string(result, "stdout").unwrap_or_default();
                    let end = if stdout.ends_with(&[13, 10]) {
                        stdout.len() - 2
                    } else if stdout.last().is_some_and(|unit| matches!(unit, 10 | 13)) {
                        stdout.len() - 1
                    } else {
                        stdout.len()
                    };
                    Value::String(stdout[..end].to_vec())
                }
                _ => Value::Null,
            });
        }
        if code == 44.0 && matches!(operation, Operation::Get | Operation::Delete) {
            return Ok(Value::Null);
        }
        let stderr = trim_ecmascript(own_string(result, "stderr").unwrap_or_default());
        let details = if stderr.is_empty() {
            trim_ecmascript(own_string(result, "stdout").unwrap_or_default())
        } else {
            stderr
        };
        let code = mcp_protocol_rust::json::stringify(&Value::Number(code));
        let mut message = text(&format!(
            "Failed to {}: security exited with code {}",
            operation.label(),
            code
        ));
        if !details.is_empty() {
            message.extend(text(": "));
            message.extend(details);
        }
        Err(message)
    }
    pub fn execution_failure(operation: Operation, reason: &[u16]) -> Vec<u16> {
        let mut message = text(&format!("Failed to {}: ", operation.label()));
        message.extend(reason);
        message
    }
}
pub fn select_backend(configured: Option<&[u16]>) -> Result<&'static str, Vec<u16>> {
    let backend = configured.map(trim_ecmascript);
    if backend.is_none_or(|backend| backend == text("file")) {
        return Ok("file");
    }
    if backend == Some(text("keychain").as_slice()) {
        return Ok("keychain");
    }
    let mut message = text("Unsupported auth store backend: ");
    message.extend(backend.unwrap());
    Err(message)
}
pub fn resolve_backend(
    configured: Option<&[u16]>,
    platform: &[u16],
) -> Result<&'static str, Vec<u16>> {
    let backend = select_backend(configured)?;
    if backend == "keychain" && platform != text("darwin") {
        let mut message = text("Keychain backend is only supported on macOS. Current platform: ");
        message.extend(platform);
        return Err(message);
    }
    Ok(backend)
}
pub fn validate_defaults(
    directory: &[u16],
    absolute: bool,
    file: &[u16],
) -> Result<(), &'static str> {
    let segments = |text: &[u16]| {
        text.split(|unit| matches!(unit, 47 | 92))
            .filter(|part| !part.is_empty())
            .map(<[u16]>::to_vec)
            .collect::<Vec<_>>()
    };
    if absolute || segments(directory).iter().any(|part| part == &text("..")) {
        return Err("defaultDirectory must be a relative path inside the home directory");
    }
    if trim_ecmascript(file).is_empty()
        || file == text(".")
        || file == text("..")
        || segments(file).len() != 1
    {
        return Err("defaultFileName must be a file name without path separators");
    }
    Ok(())
}
pub fn parse_document(raw: &[u16]) -> Option<Value> {
    let parsed = json::parse_utf16(raw, Limits::default()).ok()?;
    if parsed.get("version") != Some(&Value::Number(1.0)) {
        return None;
    }
    let mut fields = vec![property("version", Value::Number(1.0))];
    for key in ["iv", "authTag", "ciphertext"] {
        fields.push(property(
            key,
            Value::String(own_string(&parsed, key)?.to_vec()),
        ));
    }
    Some(Value::Object(fields))
}
pub fn protected_paths(
    resolved: &[u16],
    root_len: usize,
    separator: u16,
    start: Option<&[u16]>,
    inside: bool,
) -> Vec<Vec<u16>> {
    let parent = || {
        resolved
            .iter()
            .rposition(|unit| *unit == separator)
            .map_or(&resolved[..root_len], |index| {
                &resolved[..index.max(root_len)]
            })
    };
    if let Some(start) = start {
        if !inside {
            return vec![parent().to_vec(), resolved.to_vec()];
        }
        let mut paths = vec![start.to_vec()];
        let suffix = resolved.get(start.len()..).unwrap_or_default();
        for (index, unit) in suffix.iter().enumerate() {
            if *unit == separator && index > 0 {
                paths.push(resolved[..start.len() + index].to_vec());
            }
        }
        if resolved != start {
            paths.push(resolved.to_vec());
        }
        return paths;
    }
    let mut paths = vec![];
    for (index, unit) in resolved.iter().enumerate().skip(root_len) {
        if *unit == separator {
            paths.push(resolved[..index].to_vec());
        }
    }
    paths.push(resolved.to_vec());
    if paths.len() > 1 {
        paths.remove(0);
    }
    paths
}
pub fn migration_write_needed(
    primary: Option<&[u16]>,
    captured: &[u16],
    legacy: Option<&[u16]>,
) -> bool {
    primary.is_none() && legacy == Some(captured)
}
pub fn rollback_plan(primary: Option<&[u16]>, legacy: Option<&[u16]>, has_legacy: bool) -> Value {
    let mut steps = vec![];
    for (target, value) in [("primary", primary), ("legacy", legacy)] {
        if target == "legacy" && !has_legacy {
            continue;
        }
        let mut step = vec![
            property("target", Value::String(text(target))),
            property(
                "action",
                Value::String(text(if value.is_some() { "set" } else { "delete" })),
            ),
        ];
        if let Some(value) = value {
            step.push(property("value", Value::String(value.to_vec())));
        }
        steps.push(Value::Object(step));
    }
    Value::Array(steps)
}

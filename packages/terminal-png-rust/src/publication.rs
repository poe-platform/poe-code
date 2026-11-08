//! Portable render admission and atomic output cleanup policy.
use mcp_protocol_rust::json::Value;
pub fn validate(options: &Value) -> Result<(), &'static str> {
    if let Some(padding) = options.get("padding") {
        let valid = if let Value::Number(n) = padding {
            n.is_finite() && *n >= 0.0 && n.fract() == 0.0
        } else {
            false
        };
        if !valid {
            return Err("Padding must be a non-negative integer.");
        }
    }
    if options.get("output") == Some(&Value::String(vec![])) {
        return Err("Output path must not be empty.");
    }
    Ok(())
}
pub struct Publication {
    path: Vec<u16>,
    created: bool,
}
impl Publication {
    pub fn new(output: &[u16], entropy: &[u16]) -> Self {
        let mut path = Vec::with_capacity(output.len() + entropy.len() + 5);
        path.extend(output);
        path.push(46);
        path.extend(entropy);
        path.extend(".tmp".encode_utf16());
        Self {
            path,
            created: false,
        }
    }
    pub fn temporary_path(&self) -> &[u16] {
        &self.path
    }
    pub fn written(&mut self) {
        self.created = true;
    }
    pub fn cleanup(&self, error_instance: bool, own_code: bool, code: &str) -> bool {
        self.created || !(error_instance && own_code && code == "EEXIST")
    }
}

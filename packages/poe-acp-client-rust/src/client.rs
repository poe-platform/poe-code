use crate::{array, o, s};
use mcp_protocol_rust::json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
pub struct Client {
    version: f64,
    skip_auth: bool,
    state: &'static str,
    disposed: bool,
    initializing: bool,
    authenticating: bool,
    negotiated: Option<f64>,
    auth: Vec<Value>,
    capabilities: Option<Value>,
    info: Option<Value>,
    prompts: HashSet<Vec<u16>>,
    terminals: HashMap<Vec<u16>, HashSet<Vec<u16>>>,
    registered: HashSet<&'static str>,
}
impl Client {
    pub fn new(version: f64, skip_auth: bool) -> Self {
        Self {
            version,
            skip_auth,
            state: "uninitialized",
            disposed: false,
            initializing: false,
            authenticating: false,
            negotiated: None,
            auth: vec![],
            capabilities: None,
            info: None,
            prompts: HashSet::new(),
            terminals: HashMap::new(),
            registered: HashSet::new(),
        }
    }
    pub fn state(&self) -> &'static str {
        self.state
    }
    pub fn negotiated_version(&self) -> Option<f64> {
        self.negotiated
    }
    pub fn auth_methods(&self) -> &[Value] {
        &self.auth
    }
    pub fn capabilities(&self) -> Option<&Value> {
        self.capabilities.as_ref()
    }
    pub fn open(&self) -> Result<(), String> {
        if self.disposed {
            Err("ACP client disposed.".into())
        } else {
            Ok(())
        }
    }
    pub fn ready(&self, operation: &str) -> Result<(), String> {
        self.open()?;
        match self.state {
            "ready" => Ok(()),
            "uninitialized" => Err(format!("Cannot call \"{operation}\" before initialize().")),
            _ => Err(format!(
                "Cannot call \"{operation}\" before authentication completes."
            )),
        }
    }
    pub fn begin_initialize(&mut self) -> Result<(), String> {
        self.open()?;
        if self.state != "uninitialized" || self.initializing {
            return Err("initialize() can only be called once.".into());
        }
        if !self.version.is_finite() || self.version.fract() != 0.0 || self.version < 0.0 {
            return Err("Client protocol version must be a non-negative integer.".into());
        }
        self.initializing = true;
        Ok(())
    }
    pub fn end_initialize(&mut self) {
        self.initializing = false;
    }
    pub fn finish_initialize(&mut self, response: &Value) -> Result<Value, String> {
        let Some(Value::Number(version)) = response.get("protocolVersion") else {
            return Err("Agent returned an invalid protocol version.".into());
        };
        if !version.is_finite() || version.fract() != 0.0 || *version < 0.0 {
            return Err("Agent returned an invalid protocol version.".into());
        }
        let auth = if let Some(auth) = response.get("authMethods") {
            if !matches!(auth, Value::Array(_))
                || !array(auth).iter().all(|v| {
                    matches!(v, Value::Object(_))
                        && matches!(v.get("id"), Some(Value::String(_)))
                        && matches!(v.get("name"), Some(Value::String(_)))
                })
            {
                return Err("Agent returned invalid authMethods.".into());
            }
            array(auth).to_vec()
        } else {
            vec![]
        };
        self.negotiated = Some(self.version.min(*version));
        self.auth = auth;
        self.capabilities = response
            .get("agentCapabilities")
            .filter(|v| {
                !matches!(v, Value::Null | Value::Bool(false))
                    && !matches!(v,Value::Number(n) if *n==0.0)
                    && !matches!(v,Value::String(s) if s.is_empty())
            })
            .cloned();
        self.info = response.get("agentInfo").cloned();
        self.state = if !self.auth.is_empty() && !self.skip_auth {
            "initialized"
        } else {
            "ready"
        };
        let mut fields = vec![("protocolVersion", Value::Number(self.negotiated.unwrap()))];
        if let Some(cap) = &self.capabilities {
            fields.push(("agentCapabilities", cap.clone()));
        }
        if let Some(info) = &self.info {
            fields.push(("agentInfo", info.clone()));
        }
        if !self.auth.is_empty() {
            fields.push(("authMethods", Value::Array(self.auth.clone())));
        }
        Ok(o(fields))
    }
    pub fn snapshot(&self) -> Value {
        let mut fields = vec![
            ("state", s(self.state)),
            (
                "protocolVersion",
                self.negotiated.map_or(Value::Null, Value::Number),
            ),
            ("authMethods", Value::Array(self.auth.clone())),
        ];
        if let Some(cap) = &self.capabilities {
            fields.push(("agentCapabilities", cap.clone()));
        }
        if let Some(info) = &self.info {
            fields.push(("agentInfo", info.clone()));
        }
        o(fields)
    }
    pub fn begin_authenticate(&mut self, method: &str) -> Result<(), String> {
        self.open()?;
        if self.state == "uninitialized" {
            return Err("Cannot authenticate before initialize().".into());
        }
        if self.state == "ready" {
            return Err("Authentication is not required for this agent.".into());
        }
        if !self.auth.iter().any(|v| v.get("id") == Some(&s(method))) {
            return Err(format!("Unknown auth method \"{method}\"."));
        }
        if self.authenticating {
            return Err("Authentication is already in progress.".into());
        }
        self.authenticating = true;
        Ok(())
    }
    pub fn end_authenticate(&mut self, success: bool) {
        self.authenticating = false;
        if success {
            self.state = "ready";
        }
    }
    pub fn mcp(&self, servers: &Value) -> Result<(), String> {
        let capabilities = self
            .capabilities
            .as_ref()
            .and_then(|v| v.get("mcpCapabilities"));
        for server in array(servers) {
            for kind in ["http", "sse"] {
                if server.get("type") == Some(&s(kind))
                    && capabilities.and_then(|v| v.get(kind)) != Some(&Value::Bool(true))
                {
                    return Err(format!(
                        "Agent does not support MCP server type \"{kind}\"."
                    ));
                }
            }
        }
        Ok(())
    }
    pub fn loading(&self) -> Result<(), String> {
        if self
            .capabilities
            .as_ref()
            .and_then(|v| v.get("loadSession"))
            == Some(&Value::Bool(true))
        {
            Ok(())
        } else {
            Err(
                "Cannot call \"session/load\" because the agent does not support session loading."
                    .into(),
            )
        }
    }
    pub fn begin_prompt(&mut self, session: &[u16], content: &Value) -> Result<(), String> {
        self.ready("session/prompt")?;
        let capabilities = self
            .capabilities
            .as_ref()
            .and_then(|v| v.get("promptCapabilities"));
        for block in array(content) {
            for (kind, flag) in [
                ("image", "image"),
                ("audio", "audio"),
                ("resource", "embeddedContext"),
            ] {
                if block.get("type") == Some(&s(kind))
                    && capabilities.and_then(|v| v.get(flag)) != Some(&Value::Bool(true))
                {
                    return Err(format!(
                        "Agent does not support prompt content type \"{kind}\"."
                    ));
                }
            }
        }
        if !self.prompts.insert(session.to_vec()) {
            return Err(format!(
                "Cannot call \"session/prompt\" while another prompt is in progress for session \"{}\".",
                String::from_utf16_lossy(session)
            ));
        }
        Ok(())
    }
    pub fn end_prompt(&mut self, session: &[u16]) {
        self.prompts.remove(session);
        if self.prompts.is_empty() {
            self.prompts = HashSet::new();
        }
    }
    pub fn accepts(&self, notification: &Value) -> bool {
        crate::updates::notification(notification)
            && matches!(notification.get("sessionId"),Some(Value::String(s)) if self.prompts.contains(s))
    }
    pub fn register_handlers(
        &mut self,
        caps: &Value,
        read: bool,
        write: bool,
        terminal: bool,
    ) -> Vec<String> {
        let mut methods = vec![];
        for (field, available, method) in [
            ("readTextFile", read, "fs/read_text_file"),
            ("writeTextFile", write, "fs/write_text_file"),
        ] {
            if available
                && caps.get("fs").and_then(|v| v.get(field)) == Some(&Value::Bool(true))
                && self.registered.insert(method)
            {
                methods.push(method.into());
            }
        }
        if terminal
            && caps.get("terminal") == Some(&Value::Bool(true))
            && self.registered.insert("terminal")
        {
            methods.extend(
                [
                    "terminal/create",
                    "terminal/output",
                    "terminal/wait_for_exit",
                    "terminal/kill",
                    "terminal/release",
                ]
                .map(str::to_string),
            );
        }
        methods
    }
    pub fn track(&mut self, session: Vec<u16>, terminal: Vec<u16>) -> Result<(), String> {
        if self
            .terminals
            .entry(session)
            .or_default()
            .insert(terminal.clone())
        {
            Ok(())
        } else {
            Err(format!(
                "Terminal identifier \"{}\" is already active.",
                String::from_utf16_lossy(&terminal)
            ))
        }
    }
    pub fn known(&self, session: &[u16], terminal: &[u16]) -> bool {
        self.terminals
            .get(session)
            .is_some_and(|set| set.contains(terminal))
    }
    pub fn untrack(&mut self, session: &[u16], terminal: &[u16]) {
        if let Some(set) = self.terminals.get_mut(session) {
            set.remove(terminal);
            if set.is_empty() {
                self.terminals.remove(session);
            }
        }
    }
    pub fn dispose(&mut self) {
        self.disposed = true;
        self.prompts = HashSet::new();
        self.terminals = HashMap::new();
    }
}
pub fn response(method: &str, value: &Value) -> Result<(), String> {
    let field = match method {
        "session/new" => Some((
            "sessionId",
            "a string",
            matches!(value.get("sessionId"), Some(Value::String(_))),
        )),
        "session/set_config_option" => Some((
            "configOptions",
            "an array",
            matches!(value.get("configOptions"), Some(Value::Array(_))),
        )),
        "session/prompt" => {
            if !matches!(value.get("stopReason"),Some(Value::String(s)) if ["completed","end_turn","cancelled","max_tokens"].contains(&String::from_utf16_lossy(s).as_str()))
            {
                return Err("Invalid response from \"session/prompt\": \"stopReason\" must be \"completed\", \"end_turn\", \"cancelled\", or \"max_tokens\".".into());
            }
            None
        }
        _ => None,
    };
    if let Some((field, kind, false)) = field {
        return Err(format!(
            "Invalid response from \"{method}\": \"{field}\" must be {kind}."
        ));
    }
    Ok(())
}
pub fn permission(options: &Value, automatic: bool) -> Result<Value, String> {
    if automatic {
        if !matches!(options, Value::Array(_)) {
            return Err("Invalid params: \"options\" must be an array".into());
        }
        for kind in ["allow_always", "allow_once"] {
            if let Some(option) = array(options)
                .iter()
                .find(|v| v.get("kind") == Some(&s(kind)))
            {
                return Ok(o(vec![(
                    "outcome",
                    o(vec![
                        ("outcome", s("selected")),
                        (
                            "optionId",
                            option.get("optionId").cloned().unwrap_or(Value::Null),
                        ),
                    ]),
                )]));
            }
        }
    }
    Ok(o(vec![("outcome", o(vec![("outcome", s("cancelled"))]))]))
}
pub fn index(value: Option<f64>, one_based: bool, field: &str) -> Result<(), String> {
    if value.is_some_and(|value| {
        !value.is_finite() || value.fract() != 0.0 || value < if one_based { 1.0 } else { 0.0 }
    }) {
        Err(format!(
            "Invalid params: \"{field}\" must be {}",
            if one_based {
                "a 1-based integer"
            } else {
                "a non-negative integer"
            }
        ))
    } else {
        Ok(())
    }
}
#[derive(Default)]
pub struct Queue {
    values: VecDeque<Value>,
    closed: bool,
    failure: Option<String>,
}
impl Queue {
    pub fn push(&mut self, value: Value) -> bool {
        if self.closed || self.failure.is_some() {
            return false;
        }
        self.values.push_back(value);
        true
    }
    pub fn complete(&mut self) {
        if self.failure.is_none() {
            self.closed = true;
        }
    }
    pub fn fail(&mut self, message: String) {
        if !self.closed && self.failure.is_none() {
            self.failure = Some(message);
        }
    }
    pub fn poll(&mut self) -> Value {
        if let Some(value) = self.values.pop_front() {
            if self.values.is_empty() && self.values.capacity() > 16 {
                self.values = VecDeque::new();
            }
            return o(vec![("type", s("value")), ("value", value)]);
        }
        if let Some(failure) = &self.failure {
            return o(vec![("type", s("error")), ("message", s(failure))]);
        }
        o(vec![("type", s(if self.closed { "done" } else { "wait" }))])
    }
}

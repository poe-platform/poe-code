use crate::{array, field as f, o, s, text, units};
use mcp_protocol_rust::{
    json::{self, Value},
    strings::trim_ecmascript,
};
use std::collections::HashMap;
fn nonempty(v: &Value) -> bool {
    matches!(v,Value::String(v) if !v.is_empty())
}
fn num(v: &Value) -> Value {
    if matches!(v, Value::Number(_)) {
        v.clone()
    } else {
        Value::Number(0.0)
    }
}
fn is_obj(v: &Value) -> bool {
    matches!(v, Value::Object(_))
}
fn present(v: &Value, key: &str) -> Option<Value> {
    v.get(key).cloned()
}
fn thread(v: &Value) -> Option<Value> {
    [
        "thread_id",
        "threadId",
        "threadID",
        "session_id",
        "sessionId",
        "sessionID",
    ]
    .iter()
    .map(|key| f(v, key))
    .find(|v| nonempty(v))
    .cloned()
}
pub fn truncate(v: &[u16], max: usize) -> Vec<u16> {
    if v.len() <= max {
        v.to_vec()
    } else if max <= 3 {
        v[..max].to_vec()
    } else {
        let mut value = v[..max - 3].to_vec();
        value.extend([46, 46, 46]);
        value
    }
}
fn trunc(v: &Value, max: usize) -> Value {
    Value::String(truncate(units(v), max))
}
fn envelope(value: Value, missing: Vec<Vec<Value>>, malformed: bool) -> Value {
    o(vec![
        ("value", value),
        (
            "undefinedPaths",
            Value::Array(missing.into_iter().map(Value::Array).collect()),
        ),
        ("malformed", Value::Bool(malformed)),
    ])
}
fn event(kind: &str, fields: Vec<(&str, Option<Value>)>) -> Value {
    let mut values = vec![("event", s(kind))];
    let mut missing = vec![];
    for (key, value) in fields {
        if let Some(value) = value {
            values.push((key, value));
        } else {
            missing.push(vec![s(key)]);
        }
    }
    envelope(o(values), missing, false)
}
fn e(kind: &str, fields: Vec<(&str, Value)>) -> Value {
    event(
        kind,
        fields
            .into_iter()
            .map(|(key, value)| (key, Some(value)))
            .collect(),
    )
}
fn stringify(v: Option<&Value>) -> Option<Value> {
    v.map(|v| {
        if matches!(v, Value::String(_)) {
            v.clone()
        } else {
            s(&json::stringify(v))
        }
    })
}
fn join(values: impl Iterator<Item = Value>, separator: &str) -> Value {
    let mut result = vec![];
    for (index, value) in values.enumerate() {
        if index > 0 {
            result.extend(separator.encode_utf16());
        }
        result.extend(units(&value));
    }
    Value::String(result)
}
fn title(name: &Value, input: &Value) -> Value {
    let keys: &[&str] = match text(name).as_str() {
        "Bash" => &["command"],
        "Read" | "Write" | "Edit" => &["file_path"],
        "NotebookEdit" => &["notebook_path"],
        "Glob" | "Grep" => &["pattern"],
        "Task" => &["description", "prompt"],
        _ => &[],
    };
    keys.iter()
        .map(|key| f(input, key))
        .find(|value| nonempty(value))
        .map_or_else(|| name.clone(), |value| trunc(value, 80))
}
pub fn claude_kinds() -> Value {
    o(vec![
        ("Read", s("read")),
        ("Write", s("edit")),
        ("Edit", s("edit")),
        ("NotebookEdit", s("edit")),
        ("Bash", s("exec")),
        ("Glob", s("search")),
        ("Grep", s("search")),
        ("Task", s("think")),
    ])
}
fn guessed_kind(name: &Value, pi: bool) -> Value {
    let name = text(name).to_lowercase();
    let kind = if pi {
        match name.as_str() {
            "bash" | "shell" => "exec",
            "read" => "read",
            "edit" | "write" => "edit",
            "grep" | "find" | "ls" => "search",
            _ => "other",
        }
    } else if ["bash", "shell", "sh"].contains(&name.as_str()) {
        "exec"
    } else if name.contains("read") {
        "read"
    } else if ["write", "edit", "patch"].iter().any(|v| name.contains(v)) {
        "edit"
    } else if ["search", "grep", "glob", "find"]
        .iter()
        .any(|v| name.contains(v))
    {
        "search"
    } else if ["think", "task"].iter().any(|v| name.contains(v)) {
        "think"
    } else {
        "other"
    };
    s(kind)
}
fn terminal(v: &Value) -> bool {
    ["completed", "failed", "cancelled"].contains(&text(v).as_str())
}
#[derive(Clone, Copy)]
enum Format {
    Native,
    Claude,
    Codex,
    Cursor,
    OpenCode,
    Pi,
}
pub struct Adapter {
    format: Format,
    started: bool,
    thread: Option<Value>,
    error: bool,
    usage: Option<Value>,
    tools: HashMap<Vec<u16>, (Value, Value)>,
}
impl Adapter {
    pub fn new(format: &str) -> Result<Self, String> {
        let format = match format {
            "native" => Format::Native,
            "claude" => Format::Claude,
            "codex" => Format::Codex,
            "cursor" => Format::Cursor,
            "opencode" => Format::OpenCode,
            "pi" => Format::Pi,
            _ => return Err(format!("Unknown adapter \"{format}\".")),
        };
        Ok(Self {
            format,
            started: false,
            thread: None,
            error: false,
            usage: None,
            tools: HashMap::new(),
        })
    }
    pub fn tracked_tools(&self) -> usize {
        self.tools.len()
    }
    pub fn line(&mut self, line: &[u16]) -> Vec<Value> {
        let line = trim_ecmascript(line);
        if line.is_empty() {
            return vec![];
        }
        if matches!(self.format, Format::Claude) && ![123, 91].contains(&line[0]) {
            return vec![];
        }
        let v = match json::parse_utf16(line, Default::default()) {
            Ok(v) => v,
            Err(_) => {
                if matches!(self.format, Format::Pi) {
                    self.error = true;
                }
                let name = match self.format {
                    Format::Native => "adaptNative",
                    Format::Claude => "adaptClaude",
                    Format::Codex => "adaptCodex",
                    Format::Cursor => "adaptCursor",
                    Format::OpenCode => "adaptOpenCode",
                    Format::Pi => "adaptPi",
                };
                let mut message = format!("[{name}] Malformed JSON line: ")
                    .encode_utf16()
                    .collect::<Vec<_>>();
                message.extend(truncate(line, 200));
                return vec![envelope(
                    o(vec![
                        ("event", s("error")),
                        ("message", Value::String(message)),
                    ]),
                    vec![],
                    true,
                )];
            }
        };
        match self.format {
            Format::Native => {
                if nonempty(f(&v, "event")) {
                    vec![envelope(v, vec![], false)]
                } else {
                    let mut message = "[adaptNative] Line missing string \"event\" field: "
                        .encode_utf16()
                        .collect::<Vec<_>>();
                    message.extend(truncate(line, 200));
                    vec![e("error", vec![("message", Value::String(message))])]
                }
            }
            Format::Claude => self.claude(&v),
            Format::Codex => self.codex(&v),
            Format::Cursor => self.cursor(&v),
            Format::OpenCode => self.opencode(&v),
            Format::Pi => self.pi(&v),
        }
    }
    fn claude(&mut self, v: &Value) -> Vec<Value> {
        let kind = text(f(v, "type"));
        if kind.is_empty() {
            return vec![];
        }
        let mut result = vec![];
        if !self.started {
            self.started = true;
            result.push(event("session_start", vec![("threadId", thread(v))]));
        }
        if kind == "result" {
            for denial in array(f(v, "permission_denials")) {
                if nonempty(f(denial, "tool_name")) {
                    result.push(e(
                        "permission_rejected",
                        vec![(
                            "title",
                            title(f(denial, "tool_name"), f(denial, "tool_input")),
                        )],
                    ));
                }
            }
            let usage = f(v, "usage");
            let choose = |keys: &[(&Value, &str)]| {
                keys.iter()
                    .map(|(v, k)| f(v, k))
                    .find(|v| matches!(v, Value::Number(_)))
                    .cloned()
            };
            result.push(event(
                "usage",
                vec![
                    (
                        "inputTokens",
                        Some(
                            choose(&[
                                (usage, "input_tokens"),
                                (v, "input_tokens"),
                                (v, "num_input_tokens"),
                            ])
                            .unwrap_or(Value::Number(0.0)),
                        ),
                    ),
                    (
                        "outputTokens",
                        Some(
                            choose(&[
                                (usage, "output_tokens"),
                                (v, "output_tokens"),
                                (v, "num_output_tokens"),
                            ])
                            .unwrap_or(Value::Number(0.0)),
                        ),
                    ),
                    ("costUsd", choose(&[(usage, "cost_usd"), (v, "cost_usd")])),
                ],
            ));
            return result;
        }
        if kind != "assistant" && kind != "user" {
            return result;
        }
        for block in array(f(f(v, "message"), "content")) {
            let typ = text(f(block, "type"));
            let id = f(block, "id");
            let name = f(block, "name");
            if kind == "assistant" {
                if typ == "text" && nonempty(f(block, "text")) {
                    result.push(e("agent_message", vec![("text", f(block, "text").clone())]));
                } else if typ == "tool_use" && nonempty(id) && nonempty(name) {
                    let render = claude_kinds()
                        .get(&text(name))
                        .cloned()
                        .unwrap_or(s("other"));
                    self.tools
                        .insert(units(id).to_vec(), (render.clone(), Value::Null));
                    result.push(event(
                        "tool_start",
                        vec![
                            ("id", Some(id.clone())),
                            ("kind", Some(render)),
                            ("title", Some(title(name, f(block, "input")))),
                            ("input", present(block, "input")),
                        ],
                    ));
                }
            } else if typ == "tool_result" && nonempty(f(block, "tool_use_id")) {
                let id = f(block, "tool_use_id");
                let tracked = self.tools.remove(units(id));
                let mut fields = vec![
                    ("id", Some(id.clone())),
                    ("kind", tracked.map(|v| v.0)),
                    ("path", stringify(block.get("content"))),
                ];
                if let Value::Bool(failed) = f(block, "is_error") {
                    fields.push((
                        "status",
                        Some(s(if *failed { "failed" } else { "completed" })),
                    ));
                }
                result.push(event("tool_complete", fields));
            }
        }
        result
    }
    fn opencode(&mut self, v: &Value) -> Vec<Value> {
        let mut result = vec![];
        if !self.started
            && let Some(thread) = thread(v)
        {
            self.started = true;
            result.push(e("session_start", vec![("threadId", thread)]));
        }
        let typ = text(f(v, "type"));
        let part = f(v, "part");
        if typ == "text" && nonempty(f(part, "text")) {
            result.push(e("agent_message", vec![("text", f(part, "text").clone())]));
        } else if typ == "tool_use"
            && nonempty(f(part, "callID"))
            && nonempty(f(part, "tool"))
            && matches!(f(part, "state"), Value::Object(_) | Value::Array(_))
        {
            let id = f(part, "callID");
            let name = f(part, "tool");
            let state = f(part, "state");
            let render = guessed_kind(name, false);
            if !self.tools.contains_key(units(id)) {
                self.tools
                    .insert(units(id).to_vec(), (render.clone(), Value::Null));
                let title = if render == s("exec") && nonempty(f(f(state, "input"), "command")) {
                    trunc(f(f(state, "input"), "command"), 80)
                } else {
                    name.clone()
                };
                result.push(event(
                    "tool_start",
                    vec![
                        ("id", Some(id.clone())),
                        ("kind", Some(render.clone())),
                        ("title", Some(title)),
                        ("input", present(state, "input")),
                    ],
                ));
            }
            if terminal(f(state, "status")) {
                let render = self.tools.remove(units(id)).map_or(render, |v| v.0);
                result.push(event(
                    "tool_complete",
                    vec![
                        ("id", Some(id.clone())),
                        ("kind", Some(render)),
                        ("path", stringify(state.get("output"))),
                        ("status", Some(f(state, "status").clone())),
                    ],
                ));
            }
        } else if typ == "step_finish" && is_obj(f(part, "tokens")) {
            let tokens = f(part, "tokens");
            let input = num(f(tokens, "input"));
            let output = num(f(tokens, "output"));
            let cached = f(f(tokens, "cache"), "read");
            if input != Value::Number(0.0)
                || output != Value::Number(0.0)
                || matches!(cached, Value::Number(_))
            {
                result.push(event(
                    "usage",
                    vec![
                        ("inputTokens", Some(input)),
                        ("outputTokens", Some(output)),
                        (
                            "cachedTokens",
                            if matches!(cached, Value::Number(_)) {
                                Some(cached.clone())
                            } else {
                                None
                            },
                        ),
                    ],
                ));
            }
        }
        result
    }
    fn pi(&mut self, v: &Value) -> Vec<Value> {
        if !is_obj(v) {
            return vec![];
        }
        let typ = text(f(v, "type"));
        let id = f(v, "toolCallId");
        let name = f(v, "toolName");
        match typ.as_str() {
            "session" => {
                if nonempty(f(v, "id")) && self.thread.is_none() {
                    self.thread = Some(f(v, "id").clone());
                    vec![e("session_start", vec![("threadId", f(v, "id").clone())])]
                } else {
                    vec![]
                }
            }
            "message_update" => {
                let update = f(v, "assistantMessageEvent");
                match text(f(update, "type")).as_str() {
                    "text_delta" | "thinking_delta" if nonempty(f(update, "delta")) => vec![e(
                        if f(update, "type") == &s("text_delta") {
                            "agent_message"
                        } else {
                            "reasoning"
                        },
                        vec![("text", f(update, "delta").clone())],
                    )],
                    "error" => {
                        self.error = true;
                        vec![e(
                            "error",
                            vec![(
                                "message",
                                if nonempty(f(update, "reason")) {
                                    f(update, "reason").clone()
                                } else {
                                    s("Pi agent error")
                                },
                            )],
                        )]
                    }
                    _ => vec![],
                }
            }
            "message_end" => {
                let message = f(v, "message");
                let usage = f(message, "usage");
                if f(message, "role") != &s("assistant") || !is_obj(usage) {
                    return vec![];
                }
                let mut fields = vec![
                    ("inputTokens", num(f(usage, "input"))),
                    ("outputTokens", num(f(usage, "output"))),
                ];
                if matches!(f(usage, "cacheRead"), Value::Number(_)) {
                    fields.push(("cachedTokens", f(usage, "cacheRead").clone()));
                }
                if matches!(f(f(usage, "cost"), "total"), Value::Number(_)) {
                    fields.push(("costUsd", f(f(usage, "cost"), "total").clone()));
                }
                self.usage = Some(o(fields.clone()));
                vec![e("usage", fields)]
            }
            "tool_execution_start" if nonempty(id) && nonempty(name) => {
                let render = guessed_kind(name, true);
                let title = pi_title(name, f(v, "args"));
                self.tools
                    .insert(units(id).to_vec(), (render.clone(), title.clone()));
                vec![event(
                    "tool_start",
                    vec![
                        ("id", Some(id.clone())),
                        ("kind", Some(render)),
                        ("title", Some(title)),
                        ("input", present(v, "args")),
                    ],
                )]
            }
            "tool_execution_end" if nonempty(id) && nonempty(name) => {
                let tracked = self.tools.remove(units(id));
                let title = tracked
                    .as_ref()
                    .map_or_else(|| pi_title(name, f(v, "args")), |v| v.1.clone());
                let path = if title != *name {
                    title
                } else {
                    let output = pi_result(f(v, "result"));
                    if nonempty(&output) {
                        trunc(&output, 80)
                    } else {
                        name.clone()
                    }
                };
                let mut fields = vec![
                    ("id", id.clone()),
                    (
                        "kind",
                        tracked.map_or_else(|| guessed_kind(name, true), |v| v.0),
                    ),
                    ("path", path),
                ];
                if let Value::Bool(failed) = f(v, "isError") {
                    fields.push(("status", s(if *failed { "failed" } else { "completed" })));
                    if *failed {
                        fields.push(("_meta", o(vec![("failed", Value::Bool(true))])));
                    }
                }
                vec![e("tool_complete", fields)]
            }
            "agent_end" => {
                let mut fields = vec![(
                    "exitCode",
                    Value::Number(if self.error || f(v, "willRetry") == &Value::Bool(true) {
                        1.0
                    } else {
                        0.0
                    }),
                )];
                if let Some(thread) = &self.thread {
                    fields.push(("threadId", thread.clone()));
                }
                if let Some(usage) = &self.usage {
                    fields.push(("usage", usage.clone()));
                }
                vec![e("spawn_result", fields)]
            }
            _ => vec![],
        }
    }
    fn cursor(&self, v: &Value) -> Vec<Value> {
        let typ = text(f(v, "type"));
        match typ.as_str() {
            "system" | "init" if matches!(f(v, "session_id"), Value::String(_)) => vec![e(
                "session_start",
                vec![("threadId", f(v, "session_id").clone())],
            )],
            "thinking" | "assistant" => {
                let content = if typ == "thinking" {
                    if matches!(f(v, "delta"), Value::String(_)) {
                        f(v, "delta").clone()
                    } else {
                        cursor_text(f(v, "content"))
                    }
                } else {
                    cursor_text(
                        v.get("content")
                            .filter(|v| **v != Value::Null)
                            .unwrap_or(f(f(v, "message"), "content")),
                    )
                };
                if nonempty(&content) {
                    vec![e(
                        if typ == "thinking" {
                            "reasoning"
                        } else {
                            "agent_message"
                        },
                        vec![("text", content)],
                    )]
                } else {
                    vec![]
                }
            }
            "tool_call" => {
                let tool = v
                    .get("tool_call")
                    .filter(|v| is_obj(v))
                    .or_else(|| v.get("toolCall").filter(|v| is_obj(v)));
                let (name, tool) = tool
                    .and_then(|v| {
                        if let Value::Object(v) = v {
                            v.first()
                        } else {
                            None
                        }
                    })
                    .map(|(key, v)| (Value::String(key.clone()), v))
                    .unwrap_or((s("tool"), &Value::Null));
                let args = tool
                    .get("args")
                    .filter(|v| is_obj(v))
                    .or_else(|| tool.get("arguments").filter(|v| is_obj(v)))
                    .unwrap_or(if is_obj(tool) { tool } else { &Value::Null });
                let input = if is_obj(args) {
                    args.clone()
                } else {
                    o(vec![])
                };
                let path = if matches!(f(args, "path"), Value::String(_)) {
                    f(args, "path").clone()
                } else {
                    s("")
                };
                let render = s(match text(&name).as_str() {
                    "editToolCall" => "edit",
                    "readToolCall" => "read",
                    "shellToolCall" | "bashToolCall" => "exec",
                    _ => "other",
                });
                let id = if matches!(f(v, "call_id"), Value::String(_)) {
                    Some(f(v, "call_id").clone())
                } else {
                    None
                };
                match text(f(v, "subtype")).as_str() {
                    "started" => vec![event(
                        "tool_start",
                        vec![
                            ("kind", Some(render)),
                            ("title", Some(if nonempty(&path) { path } else { name })),
                            ("id", id),
                            ("input", Some(input)),
                        ],
                    )],
                    "completed" => vec![event(
                        "tool_complete",
                        vec![("kind", Some(render)), ("path", Some(path)), ("id", id)],
                    )],
                    _ => vec![],
                }
            }
            "result" => {
                let usage = f(v, "usage");
                let mut fields = vec![
                    ("inputTokens", num(f(usage, "inputTokens"))),
                    ("outputTokens", num(f(usage, "outputTokens"))),
                ];
                if matches!(f(usage, "cacheReadTokens"), Value::Number(_)) {
                    fields.push(("cachedTokens", f(usage, "cacheReadTokens").clone()));
                }
                let mut result = vec![];
                let failed = f(v, "is_error") == &Value::Bool(true);
                if failed {
                    result.push(e(
                        "error",
                        vec![(
                            "message",
                            if matches!(f(v, "result"), Value::String(_)) {
                                f(v, "result").clone()
                            } else {
                                s("Cursor agent failed.")
                            },
                        )],
                    ));
                }
                let mut usage_fields = fields
                    .iter()
                    .map(|(key, value)| (*key, Some(value.clone())))
                    .collect::<Vec<_>>();
                usage_fields.push((
                    "_meta",
                    if matches!(f(usage, "cacheWriteTokens"), Value::Number(_)) {
                        Some(o(vec![(
                            "cacheWriteTokens",
                            f(usage, "cacheWriteTokens").clone(),
                        )]))
                    } else {
                        None
                    },
                ));
                result.push(event("usage", usage_fields));
                result.push(event(
                    "spawn_result",
                    vec![
                        (
                            "exitCode",
                            Some(Value::Number(if failed { 1.0 } else { 0.0 })),
                        ),
                        (
                            "threadId",
                            if matches!(f(v, "session_id"), Value::String(_)) {
                                Some(f(v, "session_id").clone())
                            } else {
                                None
                            },
                        ),
                        ("usage", Some(o(fields))),
                    ],
                ));
                result
            }
            _ => {
                if matches!(f(v, "type"), Value::String(_)) {
                    let mut fields = vec![("event".encode_utf16().collect(), f(v, "type").clone())];
                    if let Value::Object(v) = v {
                        for (key, value) in v {
                            if let Some(existing) =
                                fields.iter_mut().find(|(existing, _)| existing == key)
                            {
                                existing.1 = value.clone();
                            } else {
                                fields.push((key.clone(), value.clone()));
                            }
                        }
                    }
                    vec![envelope(Value::Object(fields), vec![], false)]
                } else {
                    vec![]
                }
            }
        }
    }
    fn codex(&mut self, v: &Value) -> Vec<Value> {
        let typ = text(f(v, "type"));
        match typ.as_str() {
            "thread.started" => return vec![event("session_start", vec![("threadId", thread(v))])],
            "turn.started" => return vec![],
            "turn.completed" => {
                let usage = f(v, "usage");
                return vec![e(
                    "usage",
                    vec![
                        ("inputTokens", num(f(usage, "input_tokens"))),
                        ("outputTokens", num(f(usage, "output_tokens"))),
                        ("cachedTokens", num(f(usage, "cached_input_tokens"))),
                    ],
                )];
            }
            "turn.failed" | "error" => {
                let message = [
                    f(v, "message"),
                    f(v, "error"),
                    f(f(v, "error"), "message"),
                    f(v, "reason"),
                ]
                .into_iter()
                .find(|v| nonempty(v))
                .cloned()
                .unwrap_or(s("Turn failed"));
                return vec![e("error", vec![("message", message)])];
            }
            _ => {}
        }
        let item = f(v, "item");
        let item_type = text(f(item, "type"));
        let id = f(item, "id");
        let mut result = vec![];
        if item_type == "todo_list"
            && ["item.started", "item.updated", "item.completed"].contains(&typ.as_str())
        {
            if let Value::Array(items) = f(item, "items")
                && items.iter().all(|v| {
                    matches!(f(v, "text"), Value::String(_))
                        && matches!(f(v, "completed"), Value::Bool(_))
                })
            {
                let entries = Value::Array(
                    items
                        .iter()
                        .map(|v| {
                            o(vec![
                                ("content", f(v, "text").clone()),
                                (
                                    "status",
                                    s(if f(v, "completed") == &Value::Bool(true) {
                                        "completed"
                                    } else {
                                        "pending"
                                    }),
                                ),
                                ("priority", s("medium")),
                            ])
                        })
                        .collect(),
                );
                let mut fields = vec![("entries", entries)];
                if nonempty(id) {
                    fields.push(("id", id.clone()));
                }
                return vec![e("plan", fields)];
            }
            return vec![];
        }
        if nonempty(id)
            && (typ == "item.started"
                || (typ == "item.completed" && !self.tools.contains_key(units(id))))
        {
            let info = match item_type.as_str() {
                "command_execution" => Some((
                    s("exec"),
                    if nonempty(f(item, "command")) {
                        trunc(f(item, "command"), 80)
                    } else {
                        s("")
                    },
                    Some(o(item
                        .get("command")
                        .map(|v| vec![("command", v.clone())])
                        .unwrap_or_default())),
                )),
                "file_edit" => Some((
                    s("edit"),
                    if nonempty(f(item, "path")) {
                        f(item, "path").clone()
                    } else {
                        s("")
                    },
                    None,
                )),
                "file_change" => Some((
                    s("edit"),
                    if matches!(f(item, "changes"), Value::Array(_)) {
                        join(
                            array(f(item, "changes"))
                                .iter()
                                .map(|v| f(v, "path"))
                                .filter(|v| nonempty(v))
                                .cloned(),
                            ", ",
                        )
                    } else {
                        s("files")
                    },
                    None,
                )),
                "web_search" => Some((
                    s("search"),
                    if nonempty(f(item, "query")) {
                        f(item, "query").clone()
                    } else {
                        s("web")
                    },
                    Some(o(item
                        .get("query")
                        .map(|v| vec![("query", v.clone())])
                        .unwrap_or_default())),
                )),
                "thinking" => Some((s("think"), s("thinking..."), None)),
                "mcp_tool_call" => Some((s("other"), mcp_title(item), present(item, "arguments"))),
                _ => None,
            };
            if let Some((render, title, input)) = info {
                self.tools
                    .insert(units(id).to_vec(), (render.clone(), title.clone()));
                let mut fields = vec![("id", id.clone()), ("kind", render), ("title", title)];
                if let Some(input) = input {
                    fields.push(("input", input));
                }
                let mut value = e("tool_start", fields);
                let absent = if item_type == "command_execution" && item.get("command").is_none() {
                    Some("command")
                } else if item_type == "web_search" && item.get("query").is_none() {
                    Some("query")
                } else {
                    None
                };
                if let Some(key) = absent
                    && let Value::Object(ref mut fields) = value
                    && let Some((_, Value::Array(paths))) = fields.iter_mut().find(|(key, _)| {
                        key == &"undefinedPaths".encode_utf16().collect::<Vec<_>>()
                    })
                {
                    paths.push(Value::Array(vec![s("input"), s(key)]));
                }
                result.push(value);
            }
            if typ == "item.started" {
                return result;
            }
        }
        if typ != "item.completed" {
            return result;
        }
        if item_type == "error" && nonempty(f(item, "message")) {
            result.push(e("error", vec![("message", f(item, "message").clone())]));
            return result;
        }
        if item_type == "agent_message" {
            if nonempty(f(item, "text")) {
                result.push(e("agent_message", vec![("text", f(item, "text").clone())]));
            }
            return result;
        }
        if item_type == "reasoning" {
            if let Some(text) = [f(item, "text"), f(item, "content"), f(item, "summary")]
                .into_iter()
                .find(|v| nonempty(v))
            {
                result.push(e("reasoning", vec![("text", text.clone())]));
            }
            return result;
        }
        if let Some((render, title)) = self.tools.remove(units(id)) {
            let path = if nonempty(f(item, "path")) {
                f(item, "path").clone()
            } else if item_type == "mcp_tool_call" {
                mcp_title(item)
            } else {
                title
            };
            let status = if ["declined", "cancelled"].contains(&text(f(item, "status")).as_str()) {
                Some("cancelled")
            } else if f(item, "status") == &s("failed")
                || (matches!(f(item,"exit_code"),Value::Number(value) if *value!=0.0))
            {
                Some("failed")
            } else if f(item, "status") == &s("completed")
                || f(item, "exit_code") == &Value::Number(0.0)
            {
                Some("completed")
            } else {
                None
            };
            let mut fields = vec![("id", id.clone()), ("kind", render), ("path", path)];
            if let Some(status) = status {
                fields.push(("status", s(status)));
            }
            result.push(e("tool_complete", fields));
            if item_type == "command_execution"
                && status == Some("failed")
                && nonempty(f(item, "aggregated_output"))
            {
                let output = trim_ecmascript(units(f(item, "aggregated_output")));
                if String::from_utf16_lossy(output)
                    .starts_with("bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted")
                {
                    let mut message = output.to_vec();
                    message.extend("\nCodex could not initialize its sandbox: this host rejected bubblewrap network namespace setup.\nFor read-only work, verify the Landlock compatibility sandbox:\n  codex --enable use_legacy_landlock -c 'sandbox_mode=\"read-only\"' sandbox /bin/pwd\nIf that succeeds, start a new session:\n  codex --enable use_legacy_landlock -s read-only\nPoe Code supplies these flags for mode: \"read\".\nFor workspace-write or policies incompatible with Landlock,\nuse a host that supports bubblewrap and the required sandbox policy.".encode_utf16());
                    result.push(e("error", vec![("message", Value::String(message))]));
                }
            }
        }
        result
    }
}
fn pi_title(name: &Value, args: &Value) -> Value {
    let title = [f(args, "command"), f(args, "path"), f(args, "file_path")]
        .into_iter()
        .find(|v| **v != Value::Null);
    if let Some(title) = title
        && nonempty(title)
    {
        trunc(title, 80)
    } else {
        name.clone()
    }
}
fn pi_result(v: &Value) -> Value {
    match v {
        Value::String(_) => v.clone(),
        Value::Number(_) | Value::Bool(_) => s(&json::stringify(v)),
        Value::Object(_) => join(
            array(f(v, "content"))
                .iter()
                .map(|v| f(v, "text"))
                .filter(|v| nonempty(v))
                .cloned(),
            "\n",
        ),
        _ => s(""),
    }
}
fn cursor_text(v: &Value) -> Value {
    if matches!(v, Value::String(_)) {
        v.clone()
    } else {
        join(
            array(v)
                .iter()
                .filter(|v| is_obj(v))
                .map(|v| f(v, "text"))
                .filter(|v| matches!(v, Value::String(_)))
                .cloned(),
            "",
        )
    }
}
fn mcp_title(v: &Value) -> Value {
    join(
        ["server", "tool"].into_iter().map(|key| {
            if nonempty(f(v, key)) {
                f(v, key).clone()
            } else {
                s("unknown")
            }
        }),
        ".",
    )
}

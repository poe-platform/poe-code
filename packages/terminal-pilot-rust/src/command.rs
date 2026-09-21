//! Declarative terminal commands, bounded admission, host effect plans and result policies.
use mcp_protocol_rust::json::{self, Value};
use std::sync::OnceLock;
use toolcraft_schema_rust::{CompiledSchema, ValidationOptions};
fn s(text: &str) -> Value {
    Value::String(text.encode_utf16().collect())
}
fn o(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
fn text(value: &Value) -> String {
    if let Value::String(s) = value {
        String::from_utf16_lossy(s)
    } else {
        String::new()
    }
}
fn array(value: &Value) -> &[Value] {
    if let Value::Array(a) = value { a } else { &[] }
}
fn snake(name: &[u16]) -> Vec<u16> {
    let mut result = Vec::new();
    for c in name {
        if (65..=90).contains(c) {
            if !result.is_empty() {
                result.push(95);
            }
            result.push(c + 32);
        } else {
            result.push(if *c == 45 { 95 } else { *c });
        }
    }
    result
}
pub fn schema(field: &Value, casing: bool) -> Value {
    let kind = text(field.get("kind").unwrap_or(&Value::Null));
    if kind == "optional" {
        return schema(field.get("inner").expect("optional declaration"), casing);
    }
    let mut fields = vec![];
    match kind.as_str() {
        "object" => {
            let Value::Object(shape) = field.get("shape").expect("object declaration") else {
                panic!("object shape");
            };
            let properties = shape
                .iter()
                .map(|(k, v)| (if casing { snake(k) } else { k.clone() }, schema(v, casing)))
                .collect();
            let required = shape
                .iter()
                .filter(|(_, v)| v.get("kind") != Some(&s("optional")))
                .map(|(k, _)| Value::String(if casing { snake(k) } else { k.clone() }))
                .collect();
            fields.extend([
                ("type", s("object")),
                ("properties", Value::Object(properties)),
                ("required", Value::Array(required)),
                ("additionalProperties", Value::Bool(false)),
            ]);
        }
        "array" => fields.extend([
            ("type", s("array")),
            (
                "items",
                schema(field.get("item").expect("array declaration"), casing),
            ),
        ]),
        "enum" => {
            fields.push(("type", s("string")));
            fields.push((
                "enum",
                field.get("values").expect("enum declaration").clone(),
            ));
        }
        "string" | "number" | "boolean" => {
            let ty = if kind == "number" {
                field
                    .get("jsonType")
                    .cloned()
                    .unwrap_or_else(|| s("number"))
            } else {
                s(&kind)
            };
            fields.push((
                "type",
                if field.get("nullable") == Some(&Value::Bool(true)) {
                    Value::Array(vec![ty, s("null")])
                } else {
                    ty
                },
            ));
        }
        _ => panic!("unsupported static command declaration"),
    }
    for key in [
        "description",
        "pattern",
        "minLength",
        "maxLength",
        "minimum",
        "maximum",
        "format",
        "default",
    ] {
        if let Some(value) = field.get(key) {
            fields.push((key, value.clone()));
        }
    }
    o(fields)
}
struct Spec {
    metadata: Value,
    input: CompiledSchema,
    output: CompiledSchema,
    tool: Value,
}
fn specs() -> &'static [Spec] {
    static SPECS: OnceLock<Vec<Spec>> = OnceLock::new();
    SPECS.get_or_init(|| {
        let data = json::parse_utf16(
            &include_str!("commands.json")
                .encode_utf16()
                .collect::<Vec<_>>(),
            Default::default(),
        )
        .expect("static terminal declaration");
        array(data.get("commands").unwrap())
            .iter()
            .map(|meta| {
                let input = schema(meta.get("params").unwrap(), false);
                let output = schema(meta.get("mcpResultSchema").unwrap(), false);
                let name = text(meta.get("name").unwrap());
                let Value::Object(shape) = meta.get("params").unwrap().get("shape").unwrap() else {
                    panic!("params shape");
                };
                let summaries = shape
                    .iter()
                    .map(|(key, field)| {
                        format!(
                            "{}{}",
                            String::from_utf16_lossy(key),
                            if field.get("kind") == Some(&s("optional")) {
                                ""
                            } else {
                                " (required)"
                            }
                        )
                    })
                    .collect::<Vec<_>>();
                let mut description = text(meta.get("description").unwrap_or(&Value::Null));
                if !summaries.is_empty() {
                    description.push_str(&format!(" Parameters: {}.", summaries.join(", ")));
                }
                let tool = o(vec![
                    (
                        "name",
                        Value::String(snake(&name.encode_utf16().collect::<Vec<_>>())),
                    ),
                    ("description", s(&description)),
                    ("inputSchema", input.clone()),
                    (
                        "outputSchema",
                        schema(meta.get("mcpResultSchema").unwrap(), true),
                    ),
                ]);
                Spec {
                    metadata: meta.clone(),
                    input: CompiledSchema::compile(input, Default::default())
                        .expect("static input schema"),
                    output: CompiledSchema::compile(output, Default::default())
                        .expect("static output schema"),
                    tool,
                }
            })
            .collect()
    })
}
pub fn definitions() -> Vec<Value> {
    specs().iter().map(|s| s.metadata.clone()).collect()
}
pub fn tools() -> Vec<Value> {
    let primary = specs().iter().map(|s| s.tool.clone()).collect::<Vec<_>>();
    let mut aliases = primary.clone();
    for tool in &mut aliases {
        let Value::Object(fields) = tool else {
            unreachable!()
        };
        let name = fields
            .iter_mut()
            .find(|(k, _)| *k == "name".encode_utf16().collect::<Vec<_>>())
            .unwrap();
        name.1 = s(&format!("terminal_{}", text(&name.1)));
    }
    primary.into_iter().chain(aliases).collect()
}
#[derive(Debug)]
pub struct Fault {
    pub code: i32,
    pub message: String,
}
fn fault(code: i32, message: impl Into<String>) -> Fault {
    Fault {
        code,
        message: message.into(),
    }
}
fn spec(name: &str) -> Result<&'static Spec, Fault> {
    specs()
        .iter()
        .find(|s| s.metadata.get("name") == Some(&self::s(name)))
        .ok_or_else(|| fault(-32602, format!("Unknown terminal command: {name}")))
}
fn validate(compiled: &CompiledSchema, value: &Value, code: i32) -> Result<(), Fault> {
    let issues = compiled
        .validate(value, ValidationOptions::default())
        .map_err(|e| fault(code, e))?;
    if let Some(issue) = issues.first() {
        let path = issue
            .path
            .iter()
            .map(|p| String::from_utf16_lossy(p))
            .collect::<Vec<_>>()
            .join(".");
        return Err(fault(
            code,
            format!(
                "Invalid value for \"{path}\": {}",
                String::from_utf16_lossy(&issue.message)
            ),
        ));
    }
    Ok(())
}
fn selected(params: &Value, keys: &[&str]) -> Value {
    o(keys
        .iter()
        .filter_map(|key| params.get(key).map(|v| (*key, v.clone())))
        .collect())
}
pub fn prepare(name: &str, params: &Value) -> Result<Value, Fault> {
    let spec = spec(name)?;
    if let Some(Value::String(session)) = params.get("session") {
        crate::names::requested(Some(session)).map_err(|e| fault(-32602, e))?;
    }
    if name == "create-session"
        && let Some(Value::String(cmd)) = params.get("command")
    {
        crate::names::command(cmd).map_err(|e| fault(-32602, e))?;
    }
    if name == "wait-for"
        && params
            .get("pattern")
            .is_some_and(|v| matches!(v,Value::String(s) if crate::names::blank(s)))
    {
        return Err(fault(-32602, "Wait pattern must not be empty."));
    }
    if let Some(Value::Number(timeout)) = params.get("timeout") {
        crate::session::timeout(*timeout).map_err(|e| fault(-32602, e))?;
    }
    if name == "press-key"
        && let Some(Value::String(key)) = params.get("key")
    {
        crate::key_sequence(key).map_err(|e| {
            fault(
                -32602,
                format!(
                    "Invalid value for \"key\": {}",
                    String::from_utf16_lossy(&e)
                ),
            )
        })?;
    }
    validate(&spec.input, params, -32602)?;
    if matches!(name, "create-session" | "resize") {
        let cols = if let Some(Value::Number(n)) = params.get("cols") {
            *n
        } else {
            120.0
        };
        let rows = if let Some(Value::Number(n)) = params.get("rows") {
            *n
        } else {
            40.0
        };
        crate::session::geometry(cols, rows).map_err(|e| fault(-32602, e))?;
    }
    let session = params.get("session").cloned().unwrap_or(Value::Null);
    let mut fields = vec![("action", s(name)), ("session", session)];
    let (route, method, args) = match name {
        "create-session" => ("create", "", vec![params.clone()]),
        "list-sessions" => ("list", "", vec![]),
        "close-session" => ("close", "", vec![]),
        "get-session" => ("get", "", vec![]),
        "fill" | "type" => ("session", name, vec![params.get("text").unwrap().clone()]),
        "press-key" => ("session", "press", vec![params.get("key").unwrap().clone()]),
        "send-signal" => (
            "session",
            "signal",
            vec![params.get("signal").unwrap().clone()],
        ),
        "resize" => (
            "session",
            "resize",
            vec![
                params.get("cols").unwrap().clone(),
                params.get("rows").unwrap().clone(),
            ],
        ),
        "wait-for" => {
            fields.push((
                "regexp",
                Value::Bool(params.get("literal") != Some(&Value::Bool(true))),
            ));
            let options = selected(params, &["timeout", "scope"]);
            (
                "session",
                "waitFor",
                vec![
                    params.get("pattern").unwrap().clone(),
                    if matches!(&options,Value::Object(v) if v.is_empty()) {
                        Value::Null
                    } else {
                        options
                    },
                ],
            )
        }
        "wait-for-exit" => {
            let options = selected(params, &["timeout"]);
            (
                "session",
                "waitForExit",
                vec![if matches!(&options,Value::Object(v) if v.is_empty()) {
                    Value::Null
                } else {
                    options
                }],
            )
        }
        "read-screen" => ("session", "screen", vec![]),
        "read-history" => ("session", "history", vec![selected(params, &["last"])]),
        _ => unreachable!(),
    };
    fields.extend([
        ("route", s(route)),
        ("method", s(method)),
        ("args", Value::Array(args)),
    ]);
    Ok(o(fields))
}
pub fn returns_value(name: &str) -> bool {
    !matches!(
        name,
        "fill" | "type" | "press-key" | "send-signal" | "resize"
    )
}
pub fn finish(name: &str, payload: &Value, casing: bool) -> Result<Value, Fault> {
    let spec = spec(name)?;
    let field = |key| payload.get(key).cloned().unwrap_or(Value::Null);
    let result = match name {
        "create-session" => o(vec![("session", field("name")), ("pid", field("pid"))]),
        "get-session" => o(vec![
            ("session", field("name")),
            ("pid", field("pid")),
            ("command", field("command")),
            ("exitCode", field("exitCode")),
        ]),
        "list-sessions" => o(vec![(
            "sessions",
            Value::Array(
                array(&field("result"))
                    .iter()
                    .map(|p| {
                        o(vec![
                            ("session", p.get("name").cloned().unwrap_or(Value::Null)),
                            ("command", p.get("command").cloned().unwrap_or(Value::Null)),
                            ("pid", p.get("pid").cloned().unwrap_or(Value::Null)),
                        ])
                    })
                    .collect(),
            ),
        )]),
        "close-session" | "wait-for-exit" => o(vec![("exitCode", field("result"))]),
        "wait-for" => o(vec![
            ("matched", Value::Bool(true)),
            ("line", field("result")),
        ]),
        "read-history" => o(vec![
            ("lines", field("result")),
            ("exitCode", field("exitCode")),
        ]),
        "read-screen" => {
            let screen = field("result");
            o(vec![
                ("lines", screen.get("lines").cloned().unwrap_or(Value::Null)),
                (
                    "cursor",
                    screen.get("cursor").cloned().unwrap_or(Value::Null),
                ),
                ("size", screen.get("size").cloned().unwrap_or(Value::Null)),
                ("exitCode", field("exitCode")),
            ])
        }
        _ => o(vec![]),
    };
    validate(&spec.output, &result, -32603)?;
    if casing {
        if let Value::Object(fields) = result {
            Ok(Value::Object(
                fields.into_iter().map(|(k, v)| (snake(&k), v)).collect(),
            ))
        } else {
            Ok(result)
        }
    } else {
        Ok(result)
    }
}

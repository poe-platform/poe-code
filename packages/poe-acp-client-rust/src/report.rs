use crate::stream::{Collector, nonblank};
use crate::{array, o, s, text};
use mcp_protocol_rust::json::{self, Value};
fn number(value: Option<&Value>, integer: bool, field: &str) -> Result<f64, String> {
    match value {
        Some(Value::Number(n)) if n.is_finite() && *n >= 0.0 && (!integer || n.fract() == 0.0) => {
            Ok(*n)
        }
        _ => Err(format!(
            "{field} must be {}.",
            if integer {
                "a non-negative integer"
            } else {
                "a finite non-negative number"
            }
        )),
    }
}
pub fn generate(collector: &Collector, options: &Value) -> Result<Value, String> {
    let run = nonblank(options.get("runId"))
        .or_else(|| collector.session().cloned())
        .ok_or("Run id is required via options.runId or session/update stream items")?;
    let mut used = 0.0;
    let mut size = 0.0;
    let mut cost = None;
    for update in collector.usage() {
        used += number(update.get("used"), true, "usage.used")?;
        size += number(update.get("size"), true, "usage.size")?;
        if let Some(value) = update.get("cost") {
            if value != &Value::Null {
                number(value.get("amount"), false, "usage.cost.amount")?;
            }
            cost = Some(value.clone());
        }
    }
    let mut usage = vec![
        ("used", Value::Number(used)),
        ("size", Value::Number(size)),
        ("updates", Value::Number(collector.usage().len() as f64)),
    ];
    if let Some(cost) = cost {
        usage.push(("cost", cost));
    }
    let tools = collector.tools();
    let mut errors = vec![];
    for tool in array(&tools) {
        if tool.get("status") == Some(&s("failed")) {
            let message = match tool.get("rawOutput") {
                Some(Value::String(message)) if !message.is_empty() => {
                    Value::String(message.clone())
                }
                Some(value) if value != &Value::Null => s(&json::stringify(value)),
                _ => s(&format!(
                    "{} failed",
                    tool.get("title").map(text).unwrap_or_default()
                )),
            };
            errors.push(o(vec![
                (
                    "toolCallId",
                    tool.get("toolCallId").cloned().unwrap_or(Value::Null),
                ),
                ("message", message),
            ]));
        }
    }
    for error in options.get("errors").map(array).unwrap_or_default() {
        if matches!(error,Value::String(s) if !s.is_empty()) {
            errors.push(o(vec![("message", error.clone())]));
        }
    }
    let exit = match options.get("exitStatus") {
        None => s(if errors.is_empty() {
            "success"
        } else {
            "failed"
        }),
        Some(value) if value == &s("success") || value == &s("failed") => value.clone(),
        _ => return Err("exitStatus must be \"success\" or \"failed\".".into()),
    };
    Ok(o(vec![
        ("runId", run),
        (
            "startTime",
            options.get("startTime").cloned().unwrap_or(Value::Null),
        ),
        (
            "endTime",
            options.get("endTime").cloned().unwrap_or(Value::Null),
        ),
        ("exitStatus", exit),
        ("toolCalls", tools),
        ("usage", o(usage)),
        ("errors", Value::Array(errors)),
    ]))
}
fn replace(value: &Value, key: &str, replacement: Value) -> Value {
    let Value::Object(fields) = value else {
        return value.clone();
    };
    Value::Object(
        fields
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    if k == &key.encode_utf16().collect::<Vec<_>>() {
                        replacement.clone()
                    } else {
                        v.clone()
                    },
                )
            })
            .collect(),
    )
}
pub fn redact(report: &Value) -> Value {
    let tools = report.get("toolCalls").map(array).unwrap_or_default();
    let redacted = tools
        .iter()
        .map(|tool| {
            let mut tool = tool.clone();
            for key in ["rawInput", "rawOutput"] {
                if tool.get(key).is_some() {
                    tool = replace(&tool, key, s("[redacted]"));
                }
            }
            tool
        })
        .collect();
    let errors = report
        .get("errors")
        .map(array)
        .unwrap_or_default()
        .iter()
        .map(|error| {
            if let Some(id) = error.get("toolCallId")
                && tools.iter().any(|tool| {
                    tool.get("toolCallId") == Some(id) && tool.get("rawOutput").is_some()
                })
            {
                return replace(error, "message", s("[redacted]"));
            }
            error.clone()
        })
        .collect();
    let report = replace(report, "toolCalls", Value::Array(redacted));
    replace(&report, "errors", Value::Array(errors))
}
pub fn safe_segment(value: &str) -> String {
    let result = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>();
    if result.is_empty() {
        "run".into()
    } else {
        result
    }
}
pub fn summary(report: &Value, duration: &str) -> String {
    let get = |key| report.get(key).map(text).unwrap_or_default();
    let usage = report.get("usage").unwrap_or(&Value::Null);
    let numeric = |value: Option<&Value>| {
        value
            .map(json::stringify)
            .unwrap_or_else(|| "undefined".into())
    };
    let mut lines = vec![
        format!(
            "Run ID: {}",
            get("runId").replace('\r', "\\r").replace('\n', "\\n")
        ),
        format!("Start time: {}", get("startTime")),
        format!("End time: {}", get("endTime")),
        format!("Duration: {duration}"),
        format!("Exit status: {}", get("exitStatus")),
        format!(
            "Tool count: {}",
            report.get("toolCalls").map(array).unwrap_or_default().len()
        ),
        format!(
            "Token usage: {}/{}",
            numeric(usage.get("used")),
            numeric(usage.get("size"))
        ),
        format!(
            "Error count: {}",
            report.get("errors").map(array).unwrap_or_default().len()
        ),
    ];
    if let Some(cost) = usage.get("cost").filter(|v| **v != Value::Null) {
        lines.push(format!(
            "Cost: {} {}",
            numeric(cost.get("amount")),
            cost.get("currency").map(text).unwrap_or_default()
        ));
    }
    lines.join("\n")
}

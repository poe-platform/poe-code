//! Dashboard demonstration data, counters and lifecycle decisions.
use crate::feedback::Host;
use mcp_protocol_rust::json::Value;

const OUTPUT_INTERVAL: f64 = 500.;
const STATS_INTERVAL: f64 = 1_000.;
const DURATION: f64 = 30_000.;
const INITIAL_ACTION: &str = "Connecting to provider";
const MESSAGES: [(&str, [&str; 3]); 5] = [
    (
        "info",
        [
            "Analyzing repository state",
            "Inspecting agent configuration",
            "Collecting recent command output",
        ],
    ),
    (
        "success",
        [
            "Generated provider config",
            "Updated dashboard layout",
            "Saved session checkpoint",
        ],
    ),
    (
        "error",
        [
            "Retrying transient network request",
            "Tool execution returned a non-zero exit code",
            "Encountered a recoverable validation error",
        ],
    ),
    (
        "tool",
        [
            "Running npm test -- --runInBand",
            "Executing npm run lint:types",
            "Opening task plan documentation",
        ],
    ),
    (
        "status",
        [
            "Waiting for follow-up task",
            "Streaming model response",
            "Syncing derived metrics",
        ],
    ),
];
const ACTIONS: [&str; 5] = [
    "Planning next step",
    "Executing tool call",
    "Reviewing tool results",
    "Updating working memory",
    "Preparing final response",
];

fn string(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
pub fn config() -> Value {
    Value::Object(
        [
            ("outputInterval", Value::Number(OUTPUT_INTERVAL)),
            ("statsInterval", Value::Number(STATS_INTERVAL)),
            ("duration", Value::Number(DURATION)),
            (
                "kinds",
                Value::Array(MESSAGES.iter().map(|(kind, _)| string(kind)).collect()),
            ),
            (
                "messages",
                Value::Object(
                    MESSAGES
                        .iter()
                        .map(|(kind, messages)| {
                            (
                                kind.encode_utf16().collect(),
                                Value::Array(messages.iter().map(|text| string(text)).collect()),
                            )
                        })
                        .collect(),
                ),
            ),
            (
                "actions",
                Value::Array(ACTIONS.iter().map(|action| string(action)).collect()),
            ),
        ]
        .into_iter()
        .map(|(key, value)| (key.encode_utf16().collect(), value))
        .collect(),
    )
}
fn assign<H: Host>(
    host: &mut H,
    object: H::Value,
    key: &'static str,
    value: H::Value,
) -> Result<(), H::Error> {
    let key = host.literal(key)?;
    host.call("assign", vec![object, key, value])?;
    Ok(())
}
fn object<H: Host>(
    host: &mut H,
    fields: &[(&'static str, H::Value)],
) -> Result<H::Value, H::Error> {
    let result = host.call("object", vec![])?;
    for (key, value) in fields {
        assign(host, result, key, *value)?;
    }
    Ok(result)
}
fn nullish<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    let result = host.call("nullish", vec![value])?;
    host.is_true(result)
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("init", [state, dashboard]) => {
            let zero = host.number(0.)?;
            let no = host.call("false", vec![])?;
            assign(host, *state, "outputCount", zero)?;
            assign(host, *state, "iterations", zero)?;
            assign(host, *state, "cleanedUp", no)?;
            let method = host.get(*dashboard, "updateStats")?;
            let status = host.literal("running")?;
            let action = host.literal(INITIAL_ACTION)?;
            let item = object(host, &[("status", status), ("currentAction", action)])?;
            host.call("invokeStats", vec![method, *dashboard, item])?;
        }
        ("output", [state, dashboard, config, random, now]) => {
            let kinds = host.get(*config, "kinds")?;
            let count = host.get(*state, "outputCount")?;
            let length = host.get(kinds, "length")?;
            let index = host.call("mod", vec![count, length])?;
            let mut kind = host.call("at", vec![kinds, index])?;
            if nullish(host, kind)? {
                kind = host.literal("info")?;
            }
            let method = host.get(*dashboard, "appendOutput")?;
            let messages = host.get(*config, "messages")?;
            let options = host.call("at", vec![messages, kind])?;
            let ceiling = host.number(0.999_999)?;
            let capped = host.call("clampRandom", vec![*random, ceiling])?;
            let length = host.get(options, "length")?;
            let index = host.call("floorIndex", vec![capped, length])?;
            let mut text = host.call("at", vec![options, index])?;
            if nullish(host, text)? {
                let zero = host.number(0.)?;
                text = host.call("at", vec![options, zero])?;
                if nullish(host, text)? {
                    text = kind;
                }
            }
            let ts = host.call("clock", vec![*now])?;
            let item = object(host, &[("kind", kind), ("text", text), ("ts", ts)])?;
            host.call("invokeAppend", vec![method, *dashboard, item])?;
            let count = host.get(*state, "outputCount")?;
            let one = host.number(1.)?;
            let count = host.call("add", vec![count, one])?;
            assign(host, *state, "outputCount", count)?;
        }
        ("stats" | "finish", [state, dashboard, config]) => {
            if operation == "stats" {
                let iterations = host.get(*state, "iterations")?;
                let one = host.number(1.)?;
                let iterations = host.call("add", vec![iterations, one])?;
                assign(host, *state, "iterations", iterations)?;
            }
            let method = host.get(*dashboard, "updateStats")?;
            let status = host.literal(if operation == "stats" {
                "running"
            } else {
                "done"
            })?;
            let iterations = host.get(*state, "iterations")?;
            let input = host.number(137.)?;
            let output = host.number(89.)?;
            let tokens_in = host.call("mul", vec![iterations, input])?;
            let tokens_out = host.call("mul", vec![iterations, output])?;
            let elapsed = if operation == "stats" {
                let interval = host.number(STATS_INTERVAL)?;
                host.call("mul", vec![iterations, interval])?
            } else {
                host.number(DURATION)?
            };
            let action = if operation == "stats" {
                let actions = host.get(*config, "actions")?;
                let one = host.number(1.)?;
                let index = host.call("sub", vec![iterations, one])?;
                let length = host.get(actions, "length")?;
                let index = host.call("mod", vec![index, length])?;
                let action = host.call("at", vec![actions, index])?;
                if nullish(host, action)? {
                    host.literal(INITIAL_ACTION)?
                } else {
                    action
                }
            } else {
                host.literal("Completed")?
            };
            let item = object(
                host,
                &[
                    ("status", status),
                    ("iterations", iterations),
                    ("tokensIn", tokens_in),
                    ("tokensOut", tokens_out),
                    ("elapsedMs", elapsed),
                    ("currentAction", action),
                ],
            )?;
            host.call("invokeStats", vec![method, *dashboard, item])?;
        }
        ("cleanup", [state]) => {
            let cleaned = host.get(*state, "cleanedUp")?;
            if host.is_true(cleaned)? {
                return host.call("false", vec![]);
            }
            let yes = host.call("true", vec![])?;
            assign(host, *state, "cleanedUp", yes)?;
            return Ok(yes);
        }
        ("options", []) => {
            let title = host.literal("Agent Output")?;
            let stats = host.literal("Stats")?;
            return object(host, &[("title", title), ("statsTitle", stats)]);
        }
        ("quit", [command]) => {
            let quit = host.is_kind(*command, "quit")?;
            return host.call(if quit { "true" } else { "false" }, vec![]);
        }
        ("shutdown", [state, dashboard, stop_demo, exit_code]) => {
            let stopped = host.get(*state, "shutDown")?;
            if !host.is_true(stopped)? {
                let yes = host.call("true", vec![])?;
                assign(host, *state, "shutDown", yes)?;
                host.call("stopDemo", vec![*stop_demo])?;
                host.call("destroy", vec![*dashboard])?;
                if !host.is_undefined(*exit_code)? {
                    host.call("exit", vec![*exit_code])?;
                }
            }
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    host.call("undefined", vec![])
}

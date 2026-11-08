//! Pipeline QA scenario data, output sequencing and timer policy.
use crate::feedback::Host;

fn object<H: Host>(
    host: &mut H,
    fields: &[(&'static str, H::Value)],
) -> Result<H::Value, H::Error> {
    let object = host.call("object", vec![])?;
    for (key, value) in fields {
        let key = host.literal(key)?;
        host.call("define", vec![object, key, *value])?;
    }
    Ok(object)
}
fn concat<H: Host>(
    host: &mut H,
    prefix: &'static str,
    value: H::Value,
    suffix: &'static str,
) -> Result<H::Value, H::Error> {
    let prefix = host.literal(prefix)?;
    let text = host.call("add", vec![prefix, value])?;
    let suffix = host.literal(suffix)?;
    host.call("add", vec![text, suffix])
}
fn repeated<H: Host>(
    host: &mut H,
    value: &'static str,
    count: f64,
    prefix: &'static str,
    suffix: &'static str,
) -> Result<H::Value, H::Error> {
    let value = host.literal(value)?;
    let count = host.number(count)?;
    let value = host.call("repeat", vec![value, count])?;
    concat(host, prefix, value, suffix)
}
fn append<H: Host>(
    host: &mut H,
    state: H::Value,
    dashboard: H::Value,
    kind: H::Value,
    text: H::Value,
) -> Result<(), H::Error> {
    let method = host.get(dashboard, "appendOutput")?;
    let count = host.get(state, "count")?;
    let one = host.number(1.)?;
    let next = host.call("add", vec![count, one])?;
    let key = host.literal("count")?;
    host.call("define", vec![state, key, next])?;
    let item = object(host, &[("kind", kind), ("text", text), ("ts", count)])?;
    let name = host.literal("dashboard.appendOutput")?;
    host.call("invoke", vec![method, dashboard, item, name])?;
    Ok(())
}
fn output<H: Host>(
    host: &mut H,
    state: H::Value,
    dashboard: H::Value,
    kind: &'static str,
    text: &'static str,
) -> Result<(), H::Error> {
    let kind = host.literal(kind)?;
    let text = host.literal(text)?;
    append(host, state, dashboard, kind, text)
}
fn stats<H: Host>(
    host: &mut H,
    dashboard: H::Value,
    method: H::Value,
    fields: &[(&'static str, H::Value)],
) -> Result<(), H::Error> {
    let item = object(host, fields)?;
    let name = host.literal("dashboard.updateStats")?;
    host.call("invoke", vec![method, dashboard, item, name])?;
    Ok(())
}
fn push<H: Host>(
    host: &mut H,
    buffer: H::Value,
    method: H::Value,
    text: H::Value,
) -> Result<(), H::Error> {
    let name = host.literal("output.push")?;
    host.call("invoke", vec![method, buffer, text, name])?;
    Ok(())
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! s {
        ($text:expr) => {
            host.literal($text)?
        };
    }
    macro_rules! n {
        ($number:expr) => {
            host.number($number)?
        };
    }
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    match (operation, args) {
        ("label", [scenario]) => {
            return if host.is_kind(*scenario, "label-controls")? {
                repeated(host, "HIDDEN_", 100., "\x1b]52;c;", "\x07")
            } else {
                host.literal("")
            };
        }
        ("options", [scenario, label]) => {
            let title = if host.is_kind(*scenario, "unicode-title")? {
                let text = s!("Pipeline · 界界 · 👩‍💻 · é · ");
                let count = n!(3.);
                c!("repeat", text, count)
            } else {
                let text = c!("template", *scenario);
                let text = concat(host, "Pipeline · ", text, "")?;
                c!("add", text, *label)
            };
            let stats_title = if host.is_kind(*scenario, "unicode-title")? {
                s!("Run · 界界 · 👩‍💻 · é")
            } else {
                concat(host, "Run", *label, "")?
            };
            let width = n!(44.);
            let key = s!("q");
            let label = concat(host, "Quit", *label, "")?;
            let quit = object(host, &[("key", key), ("label", label)])?;
            let key = s!("↑↓");
            let label = s!("Scroll");
            let scroll = object(host, &[("key", key), ("label", label)])?;
            let key = s!("F");
            let label = s!("Follow");
            let follow = object(host, &[("key", key), ("label", label)])?;
            let hints = c!("array", quit, scroll, follow);
            return object(
                host,
                &[
                    ("title", title),
                    ("statsTitle", stats_title),
                    ("rightPaneWidth", width),
                    ("hints", hints),
                ],
            );
        }
        ("append", [state, dashboard, kind, text]) => {
            append(host, *state, *dashboard, *kind, *text)?
        }
        ("quit", [command]) => {
            let quit = host.is_kind(*command, "quit")? || host.is_kind(*command, "forceQuit")?;
            return host.call(if quit { "true" } else { "false" }, vec![]);
        }
        ("tick", [state, dashboard, burst]) => {
            let burst = host.is_true(*burst)?;
            for _ in 0..if burst { 100 } else { 1 } {
                let count = host.get(*state, "count")?;
                let text = c!("template", count);
                let text = concat(
                    host,
                    if burst {
                        "burst output "
                    } else {
                        "Streaming response "
                    },
                    text,
                    if burst {
                        ""
                    } else {
                        " · working on the current task"
                    },
                )?;
                let kind = s!(if burst { "tool" } else { "info" });
                append(host, *state, *dashboard, kind, text)?;
            }
        }
        ("initial", [state, dashboard, scenario, label]) => {
            let empty = host.is_kind(*scenario, "empty")?;
            let resumed =
                host.is_kind(*scenario, "resumed")? || host.is_kind(*scenario, "queue")?;
            if !empty {
                let method = host.get(*dashboard, "updateStats")?;
                let status = s!("running");
                let label = concat(host, "Tasks", *label, "")?;
                let iterations = n!(if resumed { 68. } else { 1. });
                let total = n!(if resumed { 90. } else { 8. });
                let context = if host.is_kind(*scenario, "queue")? {
                    c!(
                        "array",
                        s!(
                            "Plan 1/3: docs/plans/improve-pipeline-task-counts-and-restart-progress.md"
                        ),
                        s!("Next 2/3: docs/plans/agent-conversation-recovery.md"),
                        s!("Next 3/3: docs/plans/界界-unicode-long-plan-title.md")
                    )
                } else {
                    c!(
                        "array",
                        s!(
                            "Plan 1/1: docs/plans/improve-pipeline-task-counts-and-restart-progress.md"
                        )
                    )
                };
                let input = n!(24000.);
                let out = n!(7000.);
                let elapsed = n!(65000.);
                let action = s!(if resumed {
                    "Task 69/90 · Improve persisted pipeline progress · implement · step 1/2"
                } else {
                    "Improve streaming output (implement)"
                });
                stats(
                    host,
                    *dashboard,
                    method,
                    &[
                        ("status", status),
                        ("iterationsLabel", label),
                        ("iterations", iterations),
                        ("iterationsTotal", total),
                        ("context", context),
                        ("tokensIn", input),
                        ("tokensOut", out),
                        ("elapsedMs", elapsed),
                        ("currentAction", action),
                    ],
                )?;
            }
            output(
                host,
                *state,
                *dashboard,
                "info",
                "Config · codex · model-example · docs/plans/fake-pipeline.md",
            )?;
            if !empty {
                output(
                    host,
                    *state,
                    *dashboard,
                    "status",
                    if resumed {
                        "Task 69/90 · Improve persisted pipeline progress (implement)"
                    } else {
                        "Task 2/8 · Improve streaming output (implement)"
                    },
                )?;
            }
            if empty {
                let method = host.get(*dashboard, "updateStats")?;
                let status = s!("done");
                let label = s!("Tasks");
                let zero = n!(0.);
                let action = s!("Nothing to run");
                stats(
                    host,
                    *dashboard,
                    method,
                    &[
                        ("status", status),
                        ("iterationsLabel", label),
                        ("iterations", zero),
                        ("tokensIn", zero),
                        ("tokensOut", zero),
                        ("elapsedMs", zero),
                        ("currentAction", action),
                    ],
                )?;
                output(
                    host,
                    *state,
                    *dashboard,
                    "info",
                    "All tasks are already complete.",
                )?;
            } else if host.is_kind(*scenario, "oversized")? {
                let text = repeated(host, "output word ", 50000., "", "LATEST RESULT")?;
                let kind = s!("tool");
                append(host, *state, *dashboard, kind, text)?;
            } else if host.is_kind(*scenario, "newline-free")? {
                let buffer = c!("buffer");
                for _ in 0..1000 {
                    let method = host.get(buffer, "push")?;
                    let value = s!("output word ");
                    let count = n!(100.);
                    let text = c!("repeat", value, count);
                    push(host, buffer, method, text)?;
                }
                let method = host.get(buffer, "push")?;
                let text = s!("LATEST RESULT");
                push(host, buffer, method, text)?;
                c!("flush", buffer);
            } else if host.is_kind(*scenario, "execution-error")? {
                output(
                    host,
                    *state,
                    *dashboard,
                    "error",
                    "Fake execution threw before producing a task result",
                )?;
                let method = host.get(*dashboard, "updateStats")?;
                let status = s!("error");
                let action = c!("undefined");
                stats(
                    host,
                    *dashboard,
                    method,
                    &[("status", status), ("currentAction", action)],
                )?;
            } else if host.is_kind(*scenario, "failure")? {
                output(
                    host,
                    *state,
                    *dashboard,
                    "tool",
                    "npm test · checking streaming output",
                )?;
                output(
                    host,
                    *state,
                    *dashboard,
                    "error",
                    "Tool exited with code 1\nExpected task result, received empty output\nRetry after correcting the task.",
                )?;
                let method = host.get(*dashboard, "updateStats")?;
                let status = s!("error");
                let action = s!("Task 2/8 failed (implement)");
                stats(
                    host,
                    *dashboard,
                    method,
                    &[("status", status), ("currentAction", action)],
                )?;
            } else if host.is_kind(*scenario, "unicode")? {
                output(
                    host,
                    *state,
                    *dashboard,
                    "info",
                    "解析中 · 界界 · café · 👩‍💻 · é",
                )?;
                output(
                    host,
                    *state,
                    *dashboard,
                    "tool",
                    "\x1b[31merror\x1b[0m normal \x1b[1;32msuccess\x1b[0m\nindented\tcolumn\nprogress 10%\rprogress 100%",
                )?;
                output(
                    host,
                    *state,
                    *dashboard,
                    "success",
                    "Unicode and ANSI fixture ready",
                )?;
            } else if host.is_kind(*scenario, "label-controls")? {
                output(
                    host,
                    *state,
                    *dashboard,
                    "success",
                    "Label control fixture ready",
                )?;
            } else if host.is_kind(*scenario, "unicode-title")? {
                output(
                    host,
                    *state,
                    *dashboard,
                    "success",
                    "Unicode heading fixture ready",
                )?;
            } else if host.is_kind(*scenario, "cursor-controls")? {
                for text in [
                    "\x1b[32m界界\rA\x1b[0m\n😀\x08X\n👩‍💻\x08X\né\x08X\na\tB\rX",
                    "\x1b]52;c;HIDDEN_OSC_PAYLOAD\x07Visible OSC result",
                    "\x1bP HIDDEN_DCS_PAYLOAD\x1b\\Visible DCS result",
                    "\x1b[2J\x1b[1;1HFrame preserved",
                    "left\x7fright · \u{009b}2JC1 frame preserved",
                    "\u{009d}HIDDEN_C1_OSC\u{009c}Visible C1 OSC result",
                    "\u{0090}HIDDEN_FIRST\x07HIDDEN_SECOND\u{009c}Visible C1 DCS result",
                ] {
                    output(host, *state, *dashboard, "tool", text)?;
                }
                let text = repeated(
                    host,
                    "HIDDEN_LONG_",
                    4000.,
                    "\x1bP",
                    "\x1b\\Visible long DCS result",
                )?;
                let kind = s!("tool");
                append(host, *state, *dashboard, kind, text)?;
                let buffer = c!("buffer");
                for text in [
                    "\x1b]HIDDEN_FIRST\n",
                    "HIDDEN_SECOND\nHIDDEN_THIRD\x1b",
                    "\\Visible multiline OSC result\n",
                ] {
                    let method = host.get(buffer, "push")?;
                    let text = s!(text);
                    push(host, buffer, method, text)?;
                }
                let text = repeated(host, "0;", 20000., "\x1b[", "mVisible long CSI result")?;
                let kind = s!("tool");
                append(host, *state, *dashboard, kind, text)?;
                for text in [
                    "\x1bPHIDDEN_CANCELLED_DCS\x18Visible cancelled DCS result",
                    "\x1b]HIDDEN_CANCELLED_OSC\x1aVisible cancelled OSC result",
                    "\x1b[0;\x1b[32mVisible restarted CSI result\x1b[0m",
                    "Tab preservation fixture\nABCDEF\r\tX",
                    "\x1b[31mABCDEF\x1b[0m\r\tX\n界界AB\r\tX",
                    "Erase-line fixture\nprogress 100%\rprogress 50%\x1b[K\nABCDE\rXX\x1b[1K",
                    "界界\x08\x1b[KX\n界界AB\rXX\x1b[1K",
                ] {
                    output(host, *state, *dashboard, "tool", text)?;
                }
                output(
                    host,
                    *state,
                    *dashboard,
                    "success",
                    "Cursor control fixture ready",
                )?;
            } else {
                for index in 0..200 {
                    let index = n!(f64::from(index));
                    let text = c!("template", index);
                    let text = concat(
                        host,
                        "[implement] Inspecting source file ",
                        text,
                        " and running focused checks",
                    )?;
                    let kind = s!("tool");
                    append(host, *state, *dashboard, kind, text)?;
                }
                let burst = host.is_kind(*scenario, "burst")?;
                let delay = n!(if burst { 100. } else { 500. });
                let burst = c!(if burst { "true" } else { "false" });
                c!("interval", burst, delay);
            }
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    host.call("undefined", vec![])
}

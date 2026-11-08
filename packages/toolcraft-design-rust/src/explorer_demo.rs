//! Explorer demonstration configuration, option parsing and action policy.
use crate::feedback::Host;
use mcp_protocol_rust::json::{self, Limits, Value};

pub fn data() -> Value {
    json::parse(include_bytes!("explorer_demo_data.json"), Limits::default())
        .expect("embedded explorer demo data is valid JSON")
}
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
fn nullish<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    let result = host.call("nullish", vec![value])?;
    host.is_true(result)
}
fn is_mode<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    Ok(host.is_kind(value, "single-detail-mode")? || host.is_kind(value, "list-detail-mode")?)
}
fn actions<H: Host>(host: &mut H) -> Result<H::Value, H::Error> {
    let mut actions = Vec::new();
    for id in ["open", "refresh", "archive"] {
        let action_id = host.literal(id)?;
        let label = match id {
            "open" => host.literal("Open")?,
            "refresh" => host.literal("Refresh")?,
            _ => {
                let label = host.literal("Archive selected")?;
                host.call("label", vec![label])?
            }
        };
        let action = object(host, &[("id", action_id), ("label", label)])?;
        let yes = host.call("true", vec![])?;
        let (key, value) = if id == "open" {
            ("primary", yes)
        } else {
            (
                "accelerator",
                host.literal(if id == "refresh" { "r" } else { "e" })?,
            )
        };
        let key = host.literal(key)?;
        host.call("define", vec![action, key, value])?;
        if id == "archive" {
            let key = host.literal("destructive")?;
            host.call("define", vec![action, key, yes])?;
        }
        let key = host.literal("showInFooter")?;
        host.call("define", vec![action, key, yes])?;
        let handler = host.call(
            if id == "refresh" {
                "refreshHandler"
            } else {
                "handler"
            },
            vec![action_id],
        )?;
        let key = host.literal("handler")?;
        host.call("define", vec![action, key, handler])?;
        actions.push(action);
    }
    host.call("array", actions)
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    match (operation, args) {
        ("initialize", [data]) => {
            let markdown = host.get(*data, "singleDetailMarkdown")?;
            for key in [
                "configure-commands",
                "provider-boilerplate",
                "markdown-reader",
                "design-system-prompts",
            ] {
                let lines = host.get(markdown, key)?;
                let text = c!("joinLines", lines);
                let key = host.literal(key)?;
                c!("define", markdown, key, text);
            }
        }
        ("parse", [argv, env]) => {
            let value = host.get(*env, "EXPLORER_DEMO_MODE")?;
            let mut mode = if is_mode(host, value)? {
                value
            } else {
                host.literal("single-detail-mode")?
            };
            let value = host.get(*env, "EXPLORER_DEMO_SLOW_DETAIL")?;
            let mut slow = if host.is_undefined(value)? {
                c!("false")
            } else {
                c!("truthyEnv", value)
            };
            let mut index = 0.;
            loop {
                let offset = host.number(index)?;
                let length = host.get(*argv, "length")?;
                let within = c!("lt", offset, length);
                if !host.is_true(within)? {
                    break;
                }
                let arg = c!("at", *argv, offset);
                if host.is_kind(arg, "--slow-detail")? {
                    slow = c!("true");
                } else if host.is_kind(arg, "--single-detail-mode")? {
                    mode = host.literal("single-detail-mode")?;
                } else if host.is_kind(arg, "--list-detail-mode")? {
                    mode = host.literal("list-detail-mode")?;
                } else if host.is_kind(arg, "--mode")? {
                    let next = host.number(index + 1.)?;
                    let next = c!("at", *argv, next);
                    if !is_mode(host, next)? {
                        let value = if nullish(host, next)? {
                            host.literal("")?
                        } else {
                            next
                        };
                        return host.call("unsupported", vec![value]);
                    }
                    mode = next;
                    index += 1.;
                } else {
                    let prefix = host.literal("--mode=")?;
                    let starts = c!("startsWith", arg, prefix);
                    let starts = c!("truthy", starts);
                    if host.is_true(starts)? {
                        let offset = host.number(7.)?;
                        let value = c!("slice", arg, offset);
                        if !is_mode(host, value)? {
                            let value = c!("slice", arg, offset);
                            return host.call("unsupported", vec![value]);
                        }
                        mode = value;
                    }
                }
                index += 1.;
            }
            return object(host, &[("mode", mode), ("slowDetail", slow)]);
        }
        ("config", [options, data]) => {
            let mode = host.get(*options, "mode")?;
            let single = host.is_kind(mode, "single-detail-mode")?;
            let rows = host.get(
                *data,
                if single {
                    "singleDetailRows"
                } else {
                    "reviewRows"
                },
            )?;
            let mode = host.get(*options, "mode")?;
            let single = host.is_kind(mode, "single-detail-mode")?;
            let slow = host.get(*options, "slowDetail")?;
            let items = c!(
                if single { "singleItems" } else { "reviewItems" },
                slow,
                *data
            );
            let detail = object(host, &[("items", items)])?;
            if !single {
                let id = host.literal("resolve-comment")?;
                let label = host.literal("Resolve comment")?;
                let key = host.literal("x")?;
                let yes = c!("true");
                let handler = c!("handler", id);
                let action = object(
                    host,
                    &[
                        ("id", id),
                        ("label", label),
                        ("accelerator", key),
                        ("showInFooter", yes),
                        ("handler", handler),
                    ],
                )?;
                let actions = c!("array", action);
                let key = host.literal("actions")?;
                c!("define", detail, key, actions);
            }
            let mode = host.get(*options, "mode")?;
            let title = c!("title", mode);
            let rows = c!("rows", rows);
            let actions = actions(host)?;
            let mut reorder = host.get(*options, "onReorder")?;
            if nullish(host, reorder)? {
                reorder = c!("reorder");
            }
            let reorder = object(host, &[("onReorder", reorder)])?;
            let yes = c!("true");
            let hint = host.literal("No rows match the current filter")?;
            return object(
                host,
                &[
                    ("title", title),
                    ("rows", rows),
                    ("detail", detail),
                    ("actions", actions),
                    ("reorder", reorder),
                    ("multiSelect", yes),
                    ("emptyHint", hint),
                ],
            );
        }
        ("delay", [slow]) => return host.call("truthy", vec![*slow]),
        ("delayMs", []) => return host.number(500.),
        ("singleItems", [data, row]) => {
            let markdown = host.get(*data, "singleDetailMarkdown")?;
            let id = host.get(*row, "id")?;
            let mut markdown = c!("at", markdown, id);
            if nullish(host, markdown)? {
                let title = host.get(*row, "title")?;
                markdown = c!("missing", title);
            }
            let id = host.get(*row, "id")?;
            let render = c!("renderMarkdown", markdown);
            let item = object(host, &[("id", id), ("render", render)])?;
            return host.call("array", vec![item]);
        }
        ("reviewItems", [data, row]) => {
            let comments = host.get(*data, "reviewComments")?;
            let id = host.get(*row, "id")?;
            let mut comments = c!("at", comments, id);
            if nullish(host, comments)? {
                comments = c!("array");
            }
            return host.call("mapComments", vec![comments]);
        }
        ("comment", [comment]) => {
            let id = host.get(*comment, "id")?;
            let title = host.get(*comment, "title")?;
            let subtitle = host.get(*comment, "subtitle")?;
            let label = host.literal("comment")?;
            let tone = host.get(*comment, "tone")?;
            let badge = object(host, &[("text", label), ("tone", tone)])?;
            let render = c!("renderComment", *comment);
            return object(
                host,
                &[
                    ("id", id),
                    ("title", title),
                    ("subtitle", subtitle),
                    ("badge", badge),
                    ("render", render),
                ],
            );
        }
        ("open" | "archive" | "resolve-comment" | "refreshed", [ctx]) => {
            let toast = host.get(*ctx, "toast")?;
            let (message, tone) = match operation {
                "open" => {
                    let row = host.get(*ctx, "row")?;
                    let title = host.get(row, "title")?;
                    (c!("opened", title), host.literal("info")?)
                }
                "archive" => {
                    let rows = host.get(*ctx, "rows")?;
                    let length = host.get(rows, "length")?;
                    // The template coerces this first interpolation before reading length again.
                    let prefix = c!("archivePrefix", length);
                    let rows = host.get(*ctx, "rows")?;
                    let length = host.get(rows, "length")?;
                    let one = host.number(1.)?;
                    let singular = c!("same", length, one);
                    let singular = host.is_true(singular)?;
                    let suffix = host.literal(if singular { "" } else { "s" })?;
                    (c!("concat", prefix, suffix), host.literal("warning")?)
                }
                "resolve-comment" => {
                    let item = host.get(*ctx, "item")?;
                    let mut title = if nullish(host, item)? {
                        c!("undefined")
                    } else {
                        host.get(item, "title")?
                    };
                    if nullish(host, title)? {
                        let row = host.get(*ctx, "row")?;
                        title = host.get(row, "title")?;
                    }
                    (c!("resolved", title), host.literal("success")?)
                }
                _ => (host.literal("Rows refreshed")?, host.literal("success")?),
            };
            c!("toast", toast, *ctx, message, tone);
        }
        _ => return host.call("invalidOperation", vec![]),
    }
    host.call("undefined", vec![])
}

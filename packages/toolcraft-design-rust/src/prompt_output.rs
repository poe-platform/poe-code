//! Prompt output format, guide and lifecycle-message policies.
use crate::feedback::Host;

fn emit<H: Host>(
    host: &mut H,
    frame: &'static str,
    mut args: Vec<H::Value>,
) -> Result<H::Value, H::Error> {
    let frame = host.literal(frame)?;
    args.insert(0, frame);
    host.call("emit", args)?;
    host.call("undefined", vec![])
}
fn gray<H: Host>(host: &mut H, value: &'static str) -> Result<H::Value, H::Error> {
    let value = host.literal(value)?;
    host.call("gray", vec![value])
}
fn inline<H: Host>(host: &mut H, value: H::Value) -> Result<H::Value, H::Error> {
    let value = host.call("strip", vec![value])?;
    host.call("inline", vec![value])
}
fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("intro" | "introPlain", [title]) => {
            let format = host.call("format", vec![])?;
            if host.is_kind(format, "json")? {
                return host.call("undefined", vec![]);
            }
            if host.is_kind(format, "markdown")? {
                return if operation == "intro" {
                    let title = inline(host, *title)?;
                    emit(host, "heading", vec![title])
                } else {
                    emit(host, "plainHeading", vec![*title])
                };
            }
            let plain = host.literal(if operation == "introPlain" {
                "plain"
            } else {
                "brand"
            })?;
            emit(host, "introFrame", vec![*title, plain])
        }
        ("heading", [title]) => host.call("heading", vec![*title]),
        ("plainHeading", [title]) => {
            let title = host.call("strip", vec![*title])?;
            host.call("heading", vec![title])
        }
        ("introFrame", [title, plain]) => {
            let marker = gray(host, "┌")?;
            let prefix = host.call("prefix", vec![marker])?;
            let title = if host.is_kind(*plain, "plain")? {
                *title
            } else {
                host.call("introText", vec![*title])?
            };
            host.call("line", vec![prefix, title])
        }
        ("outro", [message]) => {
            let format = host.call("format", vec![])?;
            let stripped = host.call("strip", vec![*message])?;
            if host.is_kind(format, "markdown")? {
                emit(host, "outroMarkdown", vec![stripped])
            } else if host.is_kind(format, "json")? {
                emit(host, "outroJson", vec![stripped])
            } else {
                emit(host, "outroFrame", vec![*message])
            }
        }
        ("outroMarkdown", [message]) => host.call("outroMarkdown", vec![*message]),
        ("outroJson", [message]) => host.call("outroJson", vec![*message]),
        ("outroFrame", [message]) => {
            let bar = gray(host, "│")?;
            let prefix = host.call("newline", vec![bar])?;
            let end = gray(host, "└")?;
            let prefix = host.call("endPrefix", vec![prefix, end])?;
            host.call("ending", vec![prefix, *message])
        }
        ("cancel", [message]) => {
            let format = host.call("format", vec![])?;
            if host.is_kind(format, "terminal")? {
                emit(host, "cancelFrame", vec![*message])
            } else {
                host.call("undefined", vec![])
            }
        }
        ("cancelFrame", [message]) => {
            let end = gray(host, "└")?;
            let prefix = host.call("prefix", vec![end])?;
            let message = host.call("red", vec![*message])?;
            host.call("ending", vec![prefix, message])
        }
        ("message", [message, options]) => {
            let format = host.call("format", vec![])?;
            if host.is_kind(format, "markdown")? {
                let prefix = host.literal("- ")?;
                return emit(host, "markdownLog", vec![*message, prefix]);
            }
            if host.is_kind(format, "json")? {
                let level = host.literal("message")?;
                return emit(host, "jsonLog", vec![*message, level]);
            }
            run(host, "terminalLog", &[*message, *options])
        }
        ("info" | "success" | "warn" | "error", [message]) => {
            let format = host.call("format", vec![])?;
            let level = host.literal(match operation {
                "info" => "info",
                "success" => "success",
                "warn" => "warn",
                _ => "error",
            })?;
            if host.is_kind(format, "markdown")? {
                let prefix = host.literal(match operation {
                    "info" => "- **info:** ",
                    "success" => "- **success:** ",
                    "warn" => "- **warning:** ",
                    _ => "- **error:** ",
                })?;
                return emit(host, "markdownLog", vec![*message, prefix]);
            }
            if host.is_kind(format, "json")? {
                return emit(host, "jsonLog", vec![*message, level]);
            }
            let symbol = match operation {
                "info" | "success" => host.call("symbol", vec![level])?,
                "warn" => {
                    let value = host.literal("▲")?;
                    host.call("yellow", vec![value])?
                }
                _ => {
                    let value = host.literal("■")?;
                    host.call("red", vec![value])?
                }
            };
            let options = host.call("symbolOptions", vec![symbol])?;
            run(host, "message", &[*message, options])
        }
        ("markdownLog", [message, prefix]) => {
            let message = inline(host, *message)?;
            host.call("line", vec![*prefix, message])
        }
        ("jsonLog", [message, level]) => {
            let message = host.call("strip", vec![*message])?;
            host.call("jsonLog", vec![*level, message])
        }
        ("terminalLog", [message, options]) => {
            let options = host.call("options", vec![*options])?;
            let symbol = host.get(options, "symbol")?;
            let secondary = host.get(options, "secondarySymbol")?;
            let spacing = host.get(options, "spacing")?;
            let with_guide = host.get(options, "withGuide")?;
            let lines = host.call("array", vec![])?;
            let guide = predicate(host, "guide", vec![with_guide])?;
            let content = host.call("split", vec![*message])?;
            let prefix = if guide {
                host.call("prefix", vec![symbol])?
            } else {
                host.literal("")?
            };
            let continuation = if guide {
                host.call("prefix", vec![secondary])?
            } else {
                host.literal("")?
            };
            let empty = if guide { secondary } else { host.literal("")? };
            let mut index = host.number(0.)?;
            while predicate(host, "lt", vec![index, spacing])? {
                host.call("push", vec![lines, empty])?;
                index = host.call("increment", vec![index])?;
            }
            let length = host.get(content, "length")?;
            let zero = host.number(0.)?;
            if predicate(host, "same", vec![length, zero])? {
                return emit(host, "emptyLine", vec![]);
            }
            let split = host.call("first", vec![content])?;
            let first = host.get(split, "firstLine")?;
            let rest = host.get(split, "continuationLines")?;
            let length = host.get(first, "length")?;
            let value = if predicate(host, "gt", vec![length, zero])? {
                host.call("pair", vec![prefix, first])?
            } else if guide {
                symbol
            } else {
                host.literal("")?
            };
            host.call("push", vec![lines, value])?;
            host.call("continuation", vec![rest, lines, continuation, empty])?;
            emit(host, "terminalOutput", vec![lines])
        }
        ("logLine", [line, lines, prefix, empty]) => {
            let length = host.get(*line, "length")?;
            let zero = host.number(0.)?;
            let value = if predicate(host, "gt", vec![length, zero])? {
                host.call("pair", vec![*prefix, *line])?
            } else {
                *empty
            };
            host.call("push", vec![*lines, value])
        }
        ("terminalOutput", [lines]) => host.call("terminalOutput", vec![*lines]),
        ("emptyLine", []) => host.literal("\n"),
        _ => host.call("invalidOperation", vec![]),
    }
}

//! Inline Markdown collection: formatting stacks, links, images and footnotes.
use crate::feedback::Host;
fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
fn boolean<H: Host>(host: &mut H, value: bool) -> Result<H::Value, H::Error> {
    let value = host.number(if value { 1. } else { 0. })?;
    host.call("truthy", vec![value])
}
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("collect", [node, formatters, ctx, tokens]) => {
            let ty = host.get(*node, "type")?;
            if host.is_kind(ty, "text")? {
                host.call("pushText", vec![*tokens, *node, *formatters])?;
            } else if host.is_kind(ty, "strong")?
                || host.is_kind(ty, "emphasis")?
                || host.is_kind(ty, "strikethrough")?
            {
                let style = if host.is_kind(ty, "strong")? {
                    "bold"
                } else if host.is_kind(ty, "emphasis")? {
                    "italic"
                } else {
                    "strikethrough"
                };
                let style = host.literal(style)?;
                host.call(
                    "collectStyled",
                    vec![*node, *formatters, *ctx, *tokens, style],
                )?;
            } else if host.is_kind(ty, "inlineCode")? {
                host.call("pushCode", vec![*tokens, *node, *formatters, *ctx])?;
            } else if host.is_kind(ty, "image")? {
                host.call("pushImage", vec![*tokens, *node, *formatters, *ctx])?;
            } else if host.is_kind(ty, "link")? {
                let autolink = run(host, "autolink", &[*node])?;
                if host.is_true(autolink)? {
                    host.call("pushAutolink", vec![*tokens, *node, *formatters, *ctx])?;
                } else {
                    let child_tokens = host.call("array", vec![])?;
                    let children = host.get(*node, "children")?;
                    host.call("collect", vec![children, *formatters, *ctx, child_tokens])?;
                    let trimmed = host.call("trim", vec![child_tokens])?;
                    host.call("pushTokens", vec![*tokens, trimmed])?;
                    if predicate(host, "someWords", vec![trimmed])? {
                        host.call("pushSpace", vec![*tokens])?;
                    }
                    host.call("pushLink", vec![*tokens, *node, *formatters, *ctx])?;
                }
            } else if host.is_kind(ty, "footnoteReference")? {
                let label = host.get(*node, "label")?;
                let number = run(host, "footnote", &[label, *ctx])?;
                if !predicate(host, "isNull", vec![number])? {
                    host.call("pushFootnote", vec![*tokens, number, *formatters])?;
                }
            } else if host.is_kind(ty, "html")? {
                let value = host.call("htmlValue", vec![*node])?;
                let length = host.get(value, "length")?;
                let zero = host.number(0.)?;
                if predicate(host, "gt", vec![length, zero])? {
                    host.call("pushValue", vec![*tokens, value, *formatters])?;
                }
            } else if host.is_kind(ty, "break")? {
                host.call("pushBreak", vec![*tokens])?;
            } else if predicate(host, "hasChildren", vec![*node])? {
                let children = host.get(*node, "children")?;
                host.call("collect", vec![children, *formatters, *ctx, *tokens])?;
            }
            host.call("undefined", vec![])
        }
        ("autolink", [node]) => {
            let children = host.get(*node, "children")?;
            let length = host.get(children, "length")?;
            let one = host.number(1.)?;
            if !predicate(host, "same", vec![length, one])? {
                return boolean(host, false);
            }
            let ty = host.call("firstType", vec![*node])?;
            if !host.is_kind(ty, "text")? {
                return boolean(host, false);
            }
            let label = host.call("label", vec![*node])?;
            let url = host.get(*node, "url")?;
            if predicate(host, "same", vec![label, url])? {
                return boolean(host, true);
            }
            for prefix in ["http://", "mailto:"] {
                let value = host.literal(prefix)?;
                if predicate(host, "starts", vec![*node, value])? {
                    let start = host.number(prefix.len() as f64)?;
                    let suffix = host.call("urlSuffix", vec![*node, start])?;
                    if predicate(host, "same", vec![label, suffix])? {
                        return boolean(host, true);
                    }
                }
            }
            boolean(host, false)
        }
        ("placeholder", [alt]) => {
            let length = host.get(*alt, "length")?;
            let zero = host.number(0.)?;
            if predicate(host, "gt", vec![length, zero])? {
                host.call("placeholder", vec![*alt])
            } else {
                host.literal("[image]")
            }
        }
        ("footnote", [label, ctx]) => {
            let footnotes = host.get(*ctx, "footnotes")?;
            if host.is_undefined(footnotes)? || !predicate(host, "has", vec![footnotes, *label])? {
                return host.call("null", vec![]);
            }
            let existing = host.call("get", vec![footnotes, *label])?;
            if !host.is_undefined(existing)? {
                return Ok(existing);
            }
            let number = host.call("next", vec![footnotes])?;
            host.call("set", vec![footnotes, *label, number])?;
            host.call("labelAdded", vec![footnotes, *label])?;
            Ok(number)
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

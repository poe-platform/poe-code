//! Plaintext speech-oriented rendering of the public Markdown AST.
use crate::feedback::Host;
fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
fn flag<H: Host>(host: &mut H, ctx: H::Value, key: &str) -> Result<bool, H::Error> {
    let value = host.get(ctx, key)?;
    predicate(host, "truthy", vec![value])
}
fn children<H: Host>(
    host: &mut H,
    node: H::Value,
    ctx: H::Value,
    block: bool,
) -> Result<H::Value, H::Error> {
    let nodes = host.get(node, "children")?;
    host.call(if block { "blocks" } else { "children" }, vec![nodes, ctx])
}
fn kind<H: Host>(host: &mut H, node: H::Value, name: &str) -> Result<bool, H::Error> {
    let value = host.get(node, "type")?;
    host.is_kind(value, name)
}
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("inline", [node, ctx]) => {
            let ty = host.get(*node, "type")?;
            if host.is_kind(ty, "text")? || host.is_kind(ty, "inlineCode")? {
                let value = host.get(*node, "value")?;
                return host.call("strip", vec![value]);
            }
            if host.is_kind(ty, "emphasis")? || host.is_kind(ty, "strong")? {
                return children(host, *node, *ctx, false);
            }
            if host.is_kind(ty, "break")? {
                return host.literal(" ");
            }
            if host.is_kind(ty, "link")? {
                let mut text = children(host, *node, *ctx, false)?;
                if !predicate(host, "truthy", vec![text])? {
                    text = host.get(*node, "url")?;
                }
                if flag(host, *ctx, "expandLinks")? {
                    return host.call("expandLink", vec![text, *node]);
                }
                if flag(host, *ctx, "showLinks")? {
                    return host.call("showLink", vec![text]);
                }
                return Ok(text);
            }
            if host.is_kind(ty, "image")? {
                let alt = host.get(*node, "alt")?;
                return host.call("strip", vec![alt]);
            }
            if host.is_kind(ty, "footnoteReference")? {
                if !predicate(host, "hasReference", vec![*ctx, *node])? {
                    host.call("addReference", vec![*ctx, *node])?;
                }
                return host.call("reference", vec![*ctx, *node]);
            }
            host.literal("")
        }
        ("blocks", [nodes, ctx]) => host.call("blocks", vec![*nodes, *ctx]),
        ("blockChild", [node, ctx]) => {
            let ty = host.get(*node, "type")?;
            let mut block = false;
            for name in [
                "root",
                "paragraph",
                "thematicBreak",
                "heading",
                "blockquote",
                "alert",
                "list",
                "listItem",
                "table",
                "tableRow",
                "tableCell",
                "code",
                "frontmatter",
                "footnoteDefinition",
            ] {
                if host.is_kind(ty, name)? {
                    block = true;
                    break;
                }
            }
            run(host, if block { "block" } else { "inline" }, &[*node, *ctx])
        }
        ("block", [node, ctx]) => {
            let ty = host.get(*node, "type")?;
            if host.is_kind(ty, "root")? {
                let nodes = host.get(*node, "children")?;
                host.call("collect", vec![nodes, *ctx])?;
                let text = children(host, *node, *ctx, true)?;
                let text = run(host, "trim", &[text])?;
                let notes = host.call("notes", vec![*ctx])?;
                let length = host.get(notes, "length")?;
                let zero = host.number(0.)?;
                return if predicate(host, "same", vec![length, zero])? {
                    Ok(text)
                } else {
                    let joined = host.call("withNotes", vec![text, notes])?;
                    run(host, "trim", &[joined])
                };
            }
            if host.is_kind(ty, "paragraph")? {
                let text = children(host, *node, *ctx, false)?;
                return host.call("paragraph", vec![text]);
            }
            if host.is_kind(ty, "heading")? {
                let one = host.number(1.)?;
                let two = host.number(2.)?;
                let prefix = if flag(host, *ctx, "announceHeadings")? && {
                    let depth = host.get(*node, "depth")?;
                    predicate(host, "same", vec![depth, one])?
                } {
                    "Section: "
                } else if flag(host, *ctx, "announceHeadings")? && {
                    let depth = host.get(*node, "depth")?;
                    predicate(host, "same", vec![depth, two])?
                } {
                    "Subsection: "
                } else if flag(host, *ctx, "announceHeadings")? {
                    "Topic: "
                } else {
                    ""
                };
                let prefix = host.literal(prefix)?;
                let text = children(host, *node, *ctx, false)?;
                let text = host.call("trim", vec![text])?;
                return host.call("prefixed", vec![prefix, text]);
            }
            if host.is_kind(ty, "blockquote")? || host.is_kind(ty, "alert")? {
                let prefix = if host.is_kind(ty, "blockquote")? {
                    host.literal("Quote: ")?
                } else if flag(host, *ctx, "announceAlerts")? {
                    host.call("alertPrefix", vec![*node])?
                } else {
                    host.literal("")?
                };
                let text = children(host, *node, *ctx, true)?;
                let text = host.call("trim", vec![text])?;
                return host.call("prefixed", vec![prefix, text]);
            }
            if host.is_kind(ty, "list")? {
                let items = host.call("listItems", vec![*node, *ctx])?;
                return host.call("listJoin", vec![items, *node]);
            }
            if host.is_kind(ty, "listItem")? {
                let text = children(host, *node, *ctx, true)?;
                let text = host.call("trim", vec![text])?;
                let checked = host.get(*node, "checked")?;
                let prefix = if host.is_true(checked)? {
                    Some("done: ")
                } else {
                    let checked = host.get(*node, "checked")?;
                    if predicate(host, "isFalse", vec![checked])? {
                        Some("to do: ")
                    } else {
                        None
                    }
                };
                return if let Some(prefix) = prefix {
                    let prefix = host.literal(prefix)?;
                    host.call("checkedText", vec![prefix, text])
                } else {
                    Ok(text)
                };
            }
            if host.is_kind(ty, "table")? {
                let parts = host.call("tableParts", vec![*node])?;
                let header = host.get(parts, "header")?;
                if !predicate(host, "truthy", vec![header])? {
                    return host.literal("\n\n");
                }
                let headers = host.call("headers", vec![header, *ctx])?;
                let body = host.get(parts, "body")?;
                let sentences = host.call("sentences", vec![body, headers, *ctx])?;
                return host.call("tableText", vec![sentences]);
            }
            if host.is_kind(ty, "code")? {
                let prefix = if flag(host, *ctx, "announceCode")? {
                    "Code: "
                } else {
                    ""
                };
                let prefix = host.literal(prefix)?;
                let value = host.get(*node, "value")?;
                let length = host.get(value, "length")?;
                let zero = host.number(0.)?;
                let value = if predicate(host, "same", vec![length, zero])?
                    && flag(host, *ctx, "announceCode")?
                {
                    host.literal("Code:")?
                } else {
                    host.call("code", vec![prefix, *node])?
                };
                return host.call("paragraph", vec![value]);
            }
            if host.is_kind(ty, "frontmatter")? && flag(host, *ctx, "includeFrontmatter")? {
                return host.call("frontmatter", vec![*node]);
            }
            host.literal("")
        }
        ("collectNode", [node, ctx]) => {
            if kind(host, *node, "footnoteDefinition")? {
                host.call("definition", vec![*node, *ctx])?;
            } else if predicate(host, "hasChildren", vec![*node])? {
                let nodes = host.get(*node, "children")?;
                host.call("collect", vec![nodes, *ctx])?;
            }
            host.call("undefined", vec![])
        }
        ("note", [ctx, label, index]) => {
            let text = host.call("definitionText", vec![*ctx, *label])?;
            if host.is_undefined(text)? {
                host.literal("")
            } else {
                host.call("note", vec![*index, text])
            }
        }
        ("isListItem", [node]) | ("isTableRow", [node]) => {
            let matches = kind(
                host,
                *node,
                if operation == "isListItem" {
                    "listItem"
                } else {
                    "tableRow"
                },
            )?;
            let value = host.number(if matches { 1. } else { 0. })?;
            host.call("truthy", vec![value])
        }
        ("listItem", [child, index, node, ctx]) => {
            let text = run(host, "block", &[*child, *ctx])?;
            let text = host.call("trim", vec![text])?;
            if !flag(host, *node, "ordered")? {
                return Ok(text);
            }
            let mut prefix = "Next, ";
            for (number, candidate) in [(0., "First, "), (1., "Second, "), (2., "Third, ")] {
                let number = host.number(number)?;
                if predicate(host, "same", vec![*index, number])? {
                    prefix = candidate;
                    break;
                }
            }
            let prefix = host.literal(prefix)?;
            host.call("listText", vec![prefix, text])
        }
        ("listSeparator", [node, items]) => {
            if flag(host, *node, "ordered")? {
                return host.literal(" ");
            }
            let length = host.get(*items, "length")?;
            let three = host.number(3.)?;
            let small = predicate(host, "le", vec![length, three])?;
            host.literal(if small { ", " } else { "; " })
        }
        ("tableHeader", [cell, ctx]) => {
            if !kind(host, *cell, "tableCell")? {
                return host.literal("");
            }
            let value = children(host, *cell, *ctx, false)?;
            host.call("trim", vec![value])
        }
        ("tableCell", [cell, index, headers, ctx]) => {
            if !kind(host, *cell, "tableCell")? {
                return host.call("array", vec![]);
            }
            let header = host.call("header", vec![*headers, *index])?;
            let value = children(host, *cell, *ctx, false)?;
            let value = host.call("trim", vec![value])?;
            if host.is_kind(value, "")? {
                host.call("array", vec![])
            } else {
                host.call("sentence", vec![header, value])
            }
        }
        ("trim", [value]) => {
            let mut start = host.number(0.)?;
            let mut end = host.get(*value, "length")?;
            let one = host.number(1.)?;
            while predicate(host, "lt", vec![start, end])? {
                let ch = host.call("at", vec![*value, start])?;
                if !host.is_kind(ch, "\n")? {
                    break;
                }
                start = host.call("add", vec![start, one])?;
            }
            while predicate(host, "gt", vec![end, start])? {
                let last = host.call("subtract", vec![end, one])?;
                let ch = host.call("at", vec![*value, last])?;
                if !host.is_kind(ch, "\n")? {
                    break;
                }
                end = host.call("subtract", vec![end, one])?;
            }
            host.call("slice", vec![*value, start, end])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

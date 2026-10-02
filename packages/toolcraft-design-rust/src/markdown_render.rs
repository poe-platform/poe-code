//! Terminal Markdown AST policy. Node supplies observable formatting,
//! collection operations, ICU width, and numeric built-ins.
use crate::feedback::Host;
pub(crate) fn predicate<H: Host>(
    host: &mut H,
    name: &str,
    args: Vec<H::Value>,
) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
pub(crate) fn empty<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    let length = host.get(value, "length")?;
    let zero = host.number(0.)?;
    predicate(host, "same", vec![length, zero])
}
pub(crate) fn nonempty<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    let length = host.get(value, "length")?;
    let zero = host.number(0.)?;
    predicate(host, "gt", vec![length, zero])
}
fn kind<H: Host>(host: &mut H, node: H::Value, name: &str) -> Result<bool, H::Error> {
    let value = host.get(node, "type")?;
    host.is_kind(value, name)
}
fn flag<H: Host>(host: &mut H, ctx: H::Value, key: &str) -> Result<bool, H::Error> {
    let value = host.get(ctx, key)?;
    predicate(host, "truthy", vec![value])
}
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("width", [value]) => {
            let zero = host.number(0.)?;
            if !predicate(host, "finite", vec![*value])?
                || predicate(host, "le", vec![*value, zero])?
            {
                return host.call("invalidWidth", vec![]);
            }
            host.call("width", vec![*value])
        }
        ("node", [node, ctx]) => {
            let ty = host.get(*node, "type")?;
            if host.is_kind(ty, "root")? {
                let main = host.call("rootChildren", vec![*node, *ctx])?;
                let notes = run(host, "referencedFootnotes", &[*ctx])?;
                return host.call("concat", vec![main, notes]);
            }
            if host.is_kind(ty, "heading")? || host.is_kind(ty, "paragraph")? {
                let lines = host.call("inlineChildren", vec![*node, *ctx])?;
                if empty(host, lines)? {
                    return host.literal("");
                }
                if host.is_kind(ty, "paragraph")? {
                    return host.call("paragraph", vec![lines]);
                }
                let styled = host.call("headingLines", vec![lines, *node, *ctx])?;
                let depth = host.get(*node, "depth")?;
                let one = host.number(1.)?;
                if predicate(host, "same", vec![depth, one])? {
                    let width = host.call("underlineWidth", vec![lines])?;
                    return host.call("heading", vec![styled, width, *ctx]);
                }
                return host.call("paragraph", vec![styled]);
            }
            if host.is_kind(ty, "blockquote")? || host.is_kind(ty, "alert")? {
                let prefix = host.call("prefix", vec![])?;
                let alert = host.is_kind(ty, "alert")?;
                let label = if alert {
                    Some(host.call("labelLine", vec![prefix, *node, *ctx])?)
                } else {
                    None
                };
                let body = host.call("body", vec![*node, prefix, *ctx])?;
                if empty(host, body)? {
                    return if let Some(label) = label {
                        host.call("paragraphText", vec![label])
                    } else {
                        host.call("emptyQuote", vec![])
                    };
                }
                let style = host.literal(if alert { "" } else { "dim" })?;
                let lines = host.call("quoteLines", vec![body, prefix, style])?;
                return if let Some(label) = label {
                    host.call("alert", vec![label, lines])
                } else {
                    host.call("paragraph", vec![lines])
                };
            }
            if host.is_kind(ty, "code")? {
                let indent = host.call("indent", vec![])?;
                let lines = host.call("codeLines", vec![*node])?;
                let separator = host.literal("\n")?;
                let source = host.call("join", vec![lines, separator])?;
                let longest = host.call("longestLine", vec![lines])?;
                let width = host.call("codeBorderWidth", vec![*ctx, indent, longest])?;
                let border = host.call("codeBorder", vec![*ctx, indent, width])?;
                let highlight = host.get(*ctx, "syntaxHighlight")?;
                let highlighted = if host.is_true(highlight)? {
                    host.call("highlight", vec![*node, source, *ctx])?
                } else {
                    host.call("undefined", vec![])?
                };
                let lines = if host.is_undefined(highlighted)?
                    || predicate(host, "isNull", vec![highlighted])?
                {
                    lines
                } else {
                    highlighted
                };
                let content = host.call("codeContent", vec![lines, indent])?;
                return host.call("codeBlock", vec![border, content]);
            }
            if host.is_kind(ty, "list")? {
                let items = host.call("listItems", vec![*node, *ctx])?;
                return if empty(host, items)? {
                    host.literal("")
                } else {
                    host.call("paragraph", vec![items])
                };
            }
            if host.is_kind(ty, "table")? {
                return crate::markdown_table::run(host, "table", &[*node, *ctx]);
            }
            if host.is_kind(ty, "html")? {
                let value = host.call("htmlValue", vec![*node])?;
                if empty(host, value)? {
                    return host.literal("");
                }
                let width = host.get(*ctx, "width")?;
                let lines = host.call("wrapText", vec![value, width])?;
                return if empty(host, lines)? {
                    host.literal("")
                } else {
                    host.call("paragraph", vec![lines])
                };
            }
            for name in [
                "text",
                "strong",
                "emphasis",
                "strikethrough",
                "inlineCode",
                "link",
                "image",
                "break",
                "footnoteReference",
            ] {
                if host.is_kind(ty, name)? {
                    return host.call("inlineNode", vec![*node, *ctx]);
                }
            }
            if host.is_kind(ty, "thematicBreak")? {
                return host.call("divider", vec![*ctx]);
            }
            if host.is_kind(ty, "frontmatter")? {
                if !flag(host, *ctx, "showFrontmatter")? {
                    return host.literal("");
                }
                let data = host.get(*node, "data")?;
                let entries = host.call("entries", vec![data])?;
                if empty(host, entries)? {
                    return host.literal("");
                }
                let lines = host.call("frontmatterLines", vec![entries, *ctx])?;
                return host.call("paragraph", vec![lines]);
            }
            if host.is_kind(ty, "footnoteDefinition")? {
                return host.literal("");
            }
            if predicate(host, "hasChildren", vec![*node])? {
                let children = host.get(*node, "children")?;
                host.call("children", vec![children, *ctx])
            } else {
                host.literal("")
            }
        }
        ("children", [nodes, ctx]) => host.call("children", vec![*nodes, *ctx]),
        ("notDefinition", [node]) | ("isTableRow", [node]) => {
            let yes = if operation == "notDefinition" {
                !kind(host, *node, "footnoteDefinition")?
            } else {
                kind(host, *node, "tableRow")?
            };
            let yes = host.number(if yes { 1. } else { 0. })?;
            host.call("truthy", vec![yes])
        }
        ("styleHeading", [value, depth, ctx]) => {
            let two = host.number(2.)?;
            let four = host.number(4.)?;
            if predicate(host, "le", vec![*depth, two])? {
                host.call("header", vec![*value, *ctx])
            } else if predicate(host, "le", vec![*depth, four])? {
                host.call("bold", vec![*value])
            } else {
                host.call("mutedBold", vec![*value, *ctx])
            }
        }
        ("quoteLine", [line, prefix, style]) => {
            if !nonempty(host, *line)? {
                host.call("bar", vec![])
            } else {
                host.call(
                    if host.is_kind(*style, "dim")? {
                        "dimLine"
                    } else {
                        "prefixed"
                    },
                    vec![*prefix, *line],
                )
            }
        }
        ("alertLabel", [kind, ctx]) => {
            for (name, style, label) in [
                ("NOTE", "info", "Note"),
                ("TIP", "success", "Tip"),
                ("IMPORTANT", "info", "Important"),
                ("WARNING", "warning", "Warning"),
                ("CAUTION", "error", "Caution"),
            ] {
                if host.is_kind(*kind, name)? {
                    let style = host.literal(style)?;
                    let label = host.literal(label)?;
                    return host.call("alertLabel", vec![*ctx, style, label]);
                }
            }
            host.call("undefined", vec![])
        }
        ("codeTokens", [tokens, ctx]) => {
            if host.is_undefined(*tokens)? {
                Ok(*tokens)
            } else {
                host.call("styledTokens", vec![*tokens, *ctx])
            }
        }
        ("codeToken", [token, ctx]) => {
            let kind = host.get(*token, "kind")?;
            if host.is_kind(kind, "plain")? {
                return host.get(*token, "value");
            }
            let kind = host.get(*token, "kind")?;
            let mut formatter = None;
            for (names, style) in [
                (
                    &[
                        "keyword",
                        "type",
                        "tag",
                        "command",
                        "decorator",
                        "directive",
                        "at-rule",
                    ][..],
                    "accentBold",
                ),
                (&["string", "template"][..], "success"),
                (&["number", "boolean", "null", "parameter"][..], "number"),
                (
                    &["comment", "operator", "punctuation", "selector"][..],
                    "muted",
                ),
                (
                    &[
                        "property",
                        "key",
                        "attribute",
                        "variable",
                        "function",
                        "anchor",
                        "label",
                    ][..],
                    "info",
                ),
                (&["regex", "color", "important", "flag"][..], "warning"),
                (&["invalid"][..], "error"),
                (&["identifier", "plain"][..], "identity"),
            ] {
                let mut found = false;
                for name in names {
                    if host.is_kind(kind, name)? {
                        found = true;
                        break;
                    }
                }
                if found {
                    formatter = Some(if style == "accentBold" {
                        host.call("accentFormatter", vec![*ctx])?
                    } else if style == "identity" {
                        host.call("identityFormatter", vec![])?
                    } else {
                        let style = host.literal(style)?;
                        host.call("tokenFormatter", vec![*ctx, style])?
                    });
                    break;
                }
            }
            let formatter = match formatter {
                Some(value) => value,
                None => host.call("undefined", vec![])?,
            };
            host.call("applyToken", vec![formatter, *token])
        }
        ("listChild", [node, list, index, ctx]) => {
            if !kind(host, *node, "listItem")? {
                let value = run(host, "node", &[*node, *ctx])?;
                return host.call("trimEnd", vec![value]);
            }
            let checked = host.get(*node, "checked")?;
            let marker = if host.is_true(checked)? {
                host.call("active", vec![])?
            } else {
                let checked = host.get(*node, "checked")?;
                if predicate(host, "isFalse", vec![checked])? {
                    host.call("inactive", vec![])?
                } else if flag(host, *list, "ordered")? {
                    host.call("orderedMarker", vec![*list, *index])?
                } else {
                    host.literal("•")?
                }
            };
            let indent = host.call("indent", vec![])?;
            let prefix = host.call("firstPrefix", vec![indent, marker])?;
            let body = host.call("body", vec![*node, prefix, *ctx])?;
            let rest = host.call("continuationPrefix", vec![indent, marker])?;
            if empty(host, body)? {
                host.call("trimEnd", vec![prefix])
            } else {
                host.call("prefixBlock", vec![body, prefix, rest])
            }
        }
        ("prefixLine", [line, index, first, rest]) => {
            let zero = host.number(0.)?;
            let prefix = if predicate(host, "same", vec![*index, zero])? {
                *first
            } else {
                *rest
            };
            if nonempty(host, *line)? {
                host.call("prefixed", vec![prefix, *line])
            } else {
                host.call("trimEnd", vec![prefix])
            }
        }
        ("blockChildren", [nodes, ctx]) => {
            let parts = host.call("blockParts", vec![*nodes, *ctx])?;
            if empty(host, parts)? {
                return host.literal("");
            }
            let zero = host.number(0.)?;
            let first = host.call("at", vec![parts, zero])?;
            let mut output = host.get(first, "value")?;
            let mut index = 1.;
            loop {
                let current_index = host.number(index)?;
                let length = host.get(parts, "length")?;
                if !predicate(host, "lt", vec![current_index, length])? {
                    break;
                }
                let previous_index = host.number(index - 1.)?;
                let previous = host.call("at", vec![parts, previous_index])?;
                let current = host.call("at", vec![parts, current_index])?;
                let close = kind(host, previous, "paragraph")? && kind(host, current, "list")?;
                let separator = host.literal(if close { "\n" } else { "\n\n" })?;
                output = host.call("appendBlock", vec![output, separator, current])?;
                index += 1.;
            }
            Ok(output)
        }
        ("footnoteState", [node]) => {
            if kind(host, *node, "root")? {
                let nodes = host.get(*node, "children")?;
                host.call("footnoteState", vec![nodes])
            } else {
                host.call("undefined", vec![])
            }
        }
        ("definitionPair", [node]) => {
            if kind(host, *node, "footnoteDefinition")? {
                host.call("definitionPair", vec![*node])
            } else {
                host.call("array", vec![])
            }
        }
        ("referencedFootnotes", [ctx]) => {
            let footnotes = host.get(*ctx, "footnotes")?;
            if host.is_undefined(footnotes)? {
                return host.literal("");
            }
            let length = host.call("labelLength", vec![footnotes])?;
            let zero = host.number(0.)?;
            if predicate(host, "same", vec![length, zero])? {
                return host.literal("");
            }
            let rendered = host.call("array", vec![])?;
            let mut index = 0.;
            loop {
                let i = host.number(index)?;
                let length = host.call("labelLength", vec![footnotes])?;
                if !predicate(host, "lt", vec![i, length])? {
                    break;
                }
                let label = host.call("labelAt", vec![footnotes, i])?;
                let definition = host.call("definitionAt", vec![footnotes, label])?;
                let number = host.call("numberAt", vec![footnotes, label])?;
                if !host.is_undefined(definition)? && !host.is_undefined(number)? {
                    host.call("appendFootnote", vec![rendered, definition, number, *ctx])?;
                }
                index += 1.;
            }
            if empty(host, rendered)? {
                host.literal("")
            } else {
                host.call("paragraph", vec![rendered])
            }
        }
        ("footnoteDefinition", [node, number, ctx]) => {
            let marker = host.call("footnoteMarker", vec![*number])?;
            let prefix = host.call("footnotePrefix", vec![marker])?;
            let rest = host.call("footnoteRest", vec![*number])?;
            let body = host.call("body", vec![*node, prefix, *ctx])?;
            if empty(host, body)? {
                host.call("trimEnd", vec![prefix])
            } else {
                host.call("prefixBlock", vec![body, prefix, rest])
            }
        }
        ("frontmatterValue", _) | ("jsonValue", _) => crate::html::run(host, operation, args),
        _ => crate::markdown_table::run(host, operation, args),
    }
}

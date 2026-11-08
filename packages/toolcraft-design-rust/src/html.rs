//! HTML policy for the public Markdown AST. Host methods retain ECMAScript
//! getters, iteration, coercion, serialization and collection semantics.
use crate::feedback::Host;
fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
fn flag<H: Host>(host: &mut H, value: H::Value, key: &str) -> Result<bool, H::Error> {
    let value = host.get(value, key)?;
    predicate(host, "truthy", vec![value])
}
fn kind<H: Host>(host: &mut H, node: H::Value, expected: &str) -> Result<bool, H::Error> {
    let value = host.get(node, "type")?;
    host.is_kind(value, expected)
}
fn empty<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    let length = host.get(value, "length")?;
    let zero = host.number(0.)?;
    predicate(host, "same", vec![length, zero])
}
fn nonempty<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    let length = host.get(value, "length")?;
    let zero = host.number(0.)?;
    predicate(host, "gt", vec![length, zero])
}
fn children<H: Host>(
    host: &mut H,
    node: H::Value,
    ctx: H::Value,
    inline: bool,
) -> Result<H::Value, H::Error> {
    let nodes = host.get(node, "children")?;
    host.call(
        if inline { "inlineChildren" } else { "children" },
        vec![nodes, ctx],
    )
}
fn escaped_property<H: Host>(
    host: &mut H,
    node: H::Value,
    key: &str,
) -> Result<H::Value, H::Error> {
    let value = host.get(node, key)?;
    host.call("escape", vec![value])
}
fn wrap<H: Host>(host: &mut H, tag: &'static str, content: H::Value) -> Result<H::Value, H::Error> {
    let tag = host.literal(tag)?;
    host.call("wrap", vec![tag, content])
}
fn attribute<H: Host>(
    host: &mut H,
    key: &'static str,
    value: H::Value,
) -> Result<H::Value, H::Error> {
    let key = host.literal(key)?;
    host.call("attribute", vec![key, value])
}
fn title<H: Host>(host: &mut H, node: H::Value) -> Result<H::Value, H::Error> {
    let value = host.get(node, "title")?;
    if host.is_undefined(value)? {
        host.literal("")
    } else {
        let value = escaped_property(host, node, "title")?;
        attribute(host, "title", value)
    }
}
fn scheme_char<H: Host>(host: &mut H, ch: H::Value, index: f64) -> Result<bool, H::Error> {
    let code = host.call("code", vec![ch])?;
    let mut alpha = false;
    for (lo, hi) in [(65., 90.), (97., 122.)] {
        let lo = host.number(lo)?;
        let hi = host.number(hi)?;
        if predicate(host, "ge", vec![code, lo])? && predicate(host, "le", vec![code, hi])? {
            alpha = true;
            break;
        }
    }
    if index == 0. || alpha {
        return Ok(alpha);
    }
    let lo = host.number(48.)?;
    let hi = host.number(57.)?;
    Ok(
        (predicate(host, "ge", vec![code, lo])? && predicate(host, "le", vec![code, hi])?)
            || host.is_kind(ch, "+")?
            || host.is_kind(ch, "-")?
            || host.is_kind(ch, ".")?,
    )
}
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("node", [node, ctx]) => {
            let ty = host.get(*node, "type")?;
            if host.is_kind(ty, "root")? {
                let nodes = host.get(*node, "children")?;
                let blocks = host.call("rootBlocks", vec![nodes, *ctx])?;
                let notes = run(host, "referencedFootnotes", &[*ctx])?;
                if nonempty(host, notes)? {
                    host.call("append", vec![blocks, notes])?;
                }
                let separator = host.literal("\n")?;
                return host.call("join", vec![blocks, separator]);
            }
            if host.is_kind(ty, "heading")? || host.is_kind(ty, "paragraph")? {
                let content = children(host, *node, *ctx, true)?;
                return if empty(host, content)? {
                    host.literal("")
                } else if host.is_kind(ty, "heading")? {
                    host.call("heading", vec![*node, content])
                } else {
                    wrap(host, "p", content)
                };
            }
            if host.is_kind(ty, "blockquote")? || host.is_kind(ty, "alert")? {
                let content = children(host, *node, *ctx, false)?;
                return if host.is_kind(ty, "blockquote")? {
                    wrap(host, "blockquote", content)
                } else {
                    let kind = escaped_property(host, *node, "kind")?;
                    host.call("alert", vec![kind, content])
                };
            }
            if host.is_kind(ty, "code")? {
                let lang = host.get(*node, "lang")?;
                let class = if host.is_undefined(lang)? || {
                    let lang = host.get(*node, "lang")?;
                    empty(host, lang)?
                } {
                    host.literal("")?
                } else {
                    let lang = escaped_property(host, *node, "lang")?;
                    host.call("language", vec![lang])?
                };
                let tokens = if flag(host, *ctx, "syntaxHighlight")? {
                    host.call("highlight", vec![*node])?
                } else {
                    host.call("undefined", vec![])?
                };
                let content = if host.is_undefined(tokens)? {
                    escaped_property(host, *node, "value")?
                } else {
                    host.call("tokens", vec![tokens])?
                };
                return host.call("codeBlock", vec![class, content]);
            }
            if host.is_kind(ty, "list")? {
                let ordered = flag(host, *node, "ordered")?;
                let tag = host.literal(if ordered { "ol" } else { "ul" })?;
                let start = if flag(host, *node, "ordered")? {
                    let value = host.get(*node, "start")?;
                    if host.is_undefined(value)? {
                        false
                    } else {
                        let value = host.get(*node, "start")?;
                        let one = host.number(1.)?;
                        !predicate(host, "same", vec![value, one])?
                    }
                } else {
                    false
                };
                let start = if start {
                    let value = host.get(*node, "start")?;
                    let value = host.call("string", vec![value])?;
                    let value = host.call("escape", vec![value])?;
                    attribute(host, "start", value)?
                } else {
                    host.literal("")?
                };
                let nodes = host.get(*node, "children")?;
                let items = host.call("listItems", vec![nodes, *ctx])?;
                return if empty(host, items)? {
                    host.literal("")
                } else {
                    host.call("list", vec![tag, start, items])
                };
            }
            if host.is_kind(ty, "table")? {
                let nodes = host.get(*node, "children")?;
                let rows = host.call("tableRows", vec![nodes])?;
                let zero = host.number(0.)?;
                let header = host.call("at", vec![rows, zero])?;
                if host.is_undefined(header)? {
                    return host.literal("");
                }
                let align = host.get(*node, "align")?;
                let tag = host.literal("th")?;
                let header = run(host, "tableRow", &[header, align, tag, *ctx])?;
                let header = wrap(host, "thead", header)?;
                let body = host.call("bodyRows", vec![rows, *node, *ctx])?;
                let body = wrap(host, "tbody", body)?;
                return host.call("table", vec![header, body]);
            }
            if host.is_kind(ty, "html")? {
                return if flag(host, *ctx, "allowRawHtml")? {
                    host.get(*node, "value")
                } else {
                    escaped_property(host, *node, "value")
                };
            }
            if host.is_kind(ty, "thematicBreak")? {
                return host.literal("<hr>");
            }
            if host.is_kind(ty, "frontmatter")? {
                if !flag(host, *ctx, "showFrontmatter")? {
                    return host.literal("");
                }
                let data = host.get(*node, "data")?;
                let lines = host.call("frontmatterLines", vec![data])?;
                return if empty(host, lines)? {
                    host.literal("")
                } else {
                    host.call("frontmatter", vec![lines])
                };
            }
            if host.is_kind(ty, "footnoteDefinition")? {
                return host.literal("");
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
                    return run(host, "inline", &[*node, *ctx]);
                }
            }
            if predicate(host, "hasChildren", vec![*node])? {
                children(host, *node, *ctx, false)
            } else {
                host.literal("")
            }
        }
        ("inline", [node, ctx]) => {
            let ty = host.get(*node, "type")?;
            if host.is_kind(ty, "text")? {
                return escaped_property(host, *node, "value");
            }
            for (name, tag) in [
                ("strong", "strong"),
                ("emphasis", "em"),
                ("strikethrough", "del"),
            ] {
                if host.is_kind(ty, name)? {
                    let content = children(host, *node, *ctx, true)?;
                    return wrap(host, tag, content);
                }
            }
            if host.is_kind(ty, "inlineCode")? {
                let content = escaped_property(host, *node, "value")?;
                return wrap(host, "code", content);
            }
            if host.is_kind(ty, "link")? || host.is_kind(ty, "image")? {
                let link = host.is_kind(ty, "link")?;
                let url = host.get(*node, "url")?;
                let url = run(host, "sanitizeUrl", &[url])?;
                let url = if predicate(host, "isNull", vec![url])? {
                    host.literal("")?
                } else {
                    let value = host.call("escape", vec![url])?;
                    attribute(host, if link { "href" } else { "src" }, value)?
                };
                let attributes = if link {
                    let title = title(host, *node)?;
                    host.call("attributes", vec![url, title])?
                } else {
                    let alt = escaped_property(host, *node, "alt")?;
                    let alt = attribute(host, "alt", alt)?;
                    let title = title(host, *node)?;
                    host.call("imageAttributes", vec![url, alt, title])?
                };
                return if link {
                    host.call("link", vec![attributes, *node, *ctx])
                } else {
                    host.call("image", vec![attributes])
                };
            }
            if host.is_kind(ty, "break")? {
                return host.literal("<br>");
            }
            if host.is_kind(ty, "footnoteReference")? {
                let footnotes = host.get(*ctx, "footnotes")?;
                if host.is_undefined(footnotes)?
                    || !predicate(host, "hasDefinition", vec![footnotes, *node])?
                {
                    return host.literal("");
                }
                let mut number = host.call("number", vec![footnotes, *node])?;
                if host.is_undefined(number)? {
                    host.call("addLabel", vec![footnotes, *node])?;
                    number = host.call("labelCount", vec![footnotes])?;
                    host.call("setNumber", vec![footnotes, *node, number])?;
                }
                let label = host.get(*node, "label")?;
                let id = host.call("id", vec![label])?;
                return host.call("reference", vec![id, number]);
            }
            if host.is_kind(ty, "html")? {
                return if flag(host, *ctx, "allowRawHtml")? {
                    host.get(*node, "value")
                } else {
                    escaped_property(host, *node, "value")
                };
            }
            if predicate(host, "hasChildren", vec![*node])? {
                children(host, *node, *ctx, true)
            } else {
                run(host, "node", &[*node, *ctx])
            }
        }
        ("inlineChildren", [nodes, ctx]) => host.call("inlineChildren", vec![*nodes, *ctx]),
        ("notDefinition", [node]) | ("isTableRow", [node]) => {
            let yes = if operation == "notDefinition" {
                !kind(host, *node, "footnoteDefinition")?
            } else {
                kind(host, *node, "tableRow")?
            };
            let value = host.number(if yes { 1. } else { 0. })?;
            host.call("truthy", vec![value])
        }
        ("token", [token]) => {
            let kind = host.get(*token, "kind")?;
            if host.is_kind(kind, "plain")? {
                escaped_property(host, *token, "value")
            } else {
                let kind = escaped_property(host, *token, "kind")?;
                host.call("token", vec![kind, *token])
            }
        }
        ("listChild", [node, ctx]) => {
            if !kind(host, *node, "listItem")? {
                return run(host, "node", &[*node, *ctx]);
            }
            let nodes = host.get(*node, "children")?;
            let rendered = host.call("itemChildren", vec![nodes, *ctx])?;
            let checked = host.get(*node, "checked")?;
            let checkbox = if host.is_true(checked)? {
                "<input type=\"checkbox\" disabled checked> "
            } else {
                let checked = host.get(*node, "checked")?;
                if predicate(host, "isFalse", vec![checked])? {
                    "<input type=\"checkbox\" disabled> "
                } else {
                    ""
                }
            };
            let checkbox = host.literal(checkbox)?;
            host.call("item", vec![checkbox, rendered])
        }
        ("itemChild", [node, index, ctx]) => {
            let zero = host.number(0.)?;
            if predicate(host, "same", vec![*index, zero])? && kind(host, *node, "paragraph")? {
                children(host, *node, *ctx, true)
            } else {
                run(host, "node", &[*node, *ctx])
            }
        }
        ("tableRow", [node, align, tag, ctx]) => {
            let nodes = host.get(*node, "children")?;
            let cells = host.call("tableCells", vec![nodes, *align, *tag, *ctx])?;
            wrap(host, "tr", cells)
        }
        ("tableCell", [node, index, align, tag, ctx]) => {
            if !kind(host, *node, "tableCell")? {
                return host.literal("");
            }
            let align = host.call("at", vec![*align, *index])?;
            let style = if host.is_undefined(align)? || predicate(host, "isNull", vec![align])? {
                host.literal("")?
            } else {
                host.call("alignment", vec![align])?
            };
            host.call("cell", vec![*tag, style, *node, *ctx])
        }
        ("frontmatterValue", [value]) => {
            if predicate(host, "isNull", vec![*value])? {
                return host.literal("null");
            }
            let ty = host.call("type", vec![*value])?;
            if host.is_kind(ty, "string")? {
                Ok(*value)
            } else if host.is_kind(ty, "number")? || host.is_kind(ty, "boolean")? {
                host.call("string", vec![*value])
            } else {
                host.call("json", vec![*value])
            }
        }
        ("jsonValue", [value, receiver, ancestors]) => {
            let ty = host.call("type", vec![*value])?;
            if !host.is_kind(ty, "object")? || predicate(host, "isNull", vec![*value])? {
                return Ok(*value);
            }
            while nonempty(host, *ancestors)? {
                let last = host.call("last", vec![*ancestors])?;
                if predicate(host, "same", vec![last, *receiver])? {
                    break;
                }
                host.call("pop", vec![*ancestors])?;
            }
            if predicate(host, "includes", vec![*ancestors, *value])? {
                return host.literal("[Circular]");
            }
            host.call("append", vec![*ancestors, *value])?;
            Ok(*value)
        }
        ("footnoteState", [node]) => {
            if kind(host, *node, "root")? {
                let nodes = host.get(*node, "children")?;
                host.call("createFootnotes", vec![nodes])
            } else {
                host.call("undefined", vec![])
            }
        }
        ("collect", [node, definitions]) => {
            if kind(host, *node, "footnoteDefinition")? {
                host.call("definition", vec![*definitions, *node])?;
            } else if predicate(host, "hasChildren", vec![*node])? {
                let nodes = host.get(*node, "children")?;
                host.call("collect", vec![nodes, *definitions])?;
            }
            host.call("undefined", vec![])
        }
        ("referencedFootnotes", [ctx]) => {
            let footnotes = host.get(*ctx, "footnotes")?;
            if host.is_undefined(footnotes)? {
                return host.literal("");
            }
            let labels = host.get(footnotes, "labelsInOrder")?;
            if empty(host, labels)? {
                return host.literal("");
            }
            let items = host.call("notes", vec![footnotes, *ctx])?;
            if empty(host, items)? {
                host.literal("")
            } else {
                host.call("footnotes", vec![items])
            }
        }
        ("note", [label, footnotes, ctx]) => {
            let definition = host.call("getDefinition", vec![*footnotes, *label])?;
            if host.is_undefined(definition)? {
                return host.literal("");
            }
            let id = host.call("id", vec![*label])?;
            let content = children(host, definition, *ctx, false)?;
            host.call("note", vec![id, content])
        }
        ("sanitizeUrl", [url]) => {
            let trimmed = host.call("trim", vec![*url])?;
            let prefix = host.literal("//")?;
            let starts = host.call("startsWith", vec![trimmed, prefix])?;
            if predicate(host, "truthy", vec![starts])? {
                return host.call("null", vec![]);
            }
            let mut value = host.literal("")?;
            let mut index = 0.;
            loop {
                let i = host.number(index)?;
                let length = host.get(trimmed, "length")?;
                if !predicate(host, "lt", vec![i, length])? {
                    return Ok(trimmed);
                }
                let ch = host.call("at", vec![trimmed, i])?;
                if host.is_kind(ch, "/")? || host.is_kind(ch, "?")? || host.is_kind(ch, "#")? {
                    return Ok(trimmed);
                }
                if host.is_kind(ch, ":")? {
                    if empty(host, value)? {
                        return Ok(trimmed);
                    }
                    let scheme = host.call("lower", vec![value])?;
                    for name in ["http", "https", "mailto", "tel"] {
                        if host.is_kind(scheme, name)? {
                            return Ok(trimmed);
                        }
                    }
                    return host.call("null", vec![]);
                }
                if !scheme_char(host, ch, index)? {
                    return Ok(trimmed);
                }
                value = host.call("add", vec![value, ch])?;
                index += 1.;
            }
        }
        ("escape", [ch]) => {
            for (value, escaped) in [
                ("&", "&amp;"),
                ("<", "&lt;"),
                (">", "&gt;"),
                ("\"", "&quot;"),
            ] {
                if host.is_kind(*ch, value)? {
                    return host.literal(escaped);
                }
            }
            Ok(*ch)
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

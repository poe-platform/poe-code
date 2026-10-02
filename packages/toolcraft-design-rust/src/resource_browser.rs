//! Resource browser grouping, optional fields, empty states and format selection.
use crate::table::Host;

fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}

fn has_content<H: Host>(host: &mut H, item: H::Value, key: &str) -> Result<bool, H::Error> {
    let value = host.get(item, key)?;
    if host.is_undefined(value)? {
        return Ok(false);
    }
    let value = host.get(item, key)?;
    Ok(!predicate(host, "emptyArray", vec![value])?)
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("render", [options, format]) => {
            if host.is_kind(*format, "json")? {
                return host.call("json", vec![*options]);
            }
            let operation = if host.is_kind(*format, "markdown")? {
                "markdown"
            } else {
                "terminal"
            };
            run(host, operation, &[*options])
        }
        ("title", [options]) => {
            let header = host.call("header", vec![*options])?;
            let subtitle = host.get(*options, "subtitle")?;
            let subtitle = if host.is_undefined(subtitle)? {
                subtitle
            } else {
                host.call("subtitle", vec![*options])?
            };
            host.call("title", vec![header, subtitle])
        }
        ("terminal", [options]) => {
            let title = run(host, "title", &[*options])?;
            let blocks = host.call("single", vec![title])?;
            host.call("terminalGroups", vec![*options, blocks])?;
            let footer = host.get(*options, "footer")?;
            if !host.is_undefined(footer)? {
                host.call("terminalFooter", vec![*options, blocks])?;
            }
            host.call("blocks", vec![blocks])
        }
        ("terminalGroup", [theme, group]) => {
            let lines = host.call("groupLines", vec![*theme, *group])?;
            let items = host.get(*group, "items")?;
            if predicate(host, "emptyArray", vec![items])? {
                host.call("emptyLines", vec![*theme, *group, lines])?;
            } else {
                host.call("entries", vec![*theme, *group, lines])?;
            }
            host.call("lines", vec![lines])
        }
        ("description", [theme, group]) => {
            let description = host.get(*group, "description")?;
            host.call(
                if host.is_undefined(description)? {
                    "array"
                } else {
                    "description"
                },
                vec![*theme, *group],
            )
        }
        ("emptyHint", [value]) => {
            if predicate(host, "nullish", vec![*value])? {
                host.call("noItems", vec![])
            } else {
                Ok(*value)
            }
        }
        ("entry", [theme, group, lines, index, item]) => {
            host.call("appendItem", vec![*theme, *lines, *item])?;
            if predicate(host, "beforeLast", vec![*index, *group])? {
                host.call("separator", vec![*lines])?;
            }
            host.call("undefined", vec![])
        }
        ("badge", [theme, item]) => {
            let badge = host.get(*item, "badge")?;
            host.call(
                if host.is_undefined(badge)? {
                    "empty"
                } else {
                    "badge"
                },
                vec![*theme, *item],
            )
        }
        ("meta", [theme, item]) => {
            let content = has_content(host, *item, "meta")?;
            host.call(if content { "meta" } else { "array" }, vec![*theme, *item])
        }
        ("preview", [theme, item]) => {
            let content = has_content(host, *item, "preview")?;
            host.call(
                if content { "preview" } else { "array" },
                vec![*theme, *item],
            )
        }
        ("markdown", [options]) => {
            let blocks = host.call("markdownStart", vec![*options])?;
            let subtitle = host.get(*options, "subtitle")?;
            if !host.is_undefined(subtitle)? {
                host.call("markdownSubtitle", vec![*options, blocks])?;
            }
            host.call("markdownGroups", vec![*options, blocks])?;
            let footer = host.get(*options, "footer")?;
            if !host.is_undefined(footer)? {
                host.call("markdownFooter", vec![*options, blocks])?;
            }
            host.call("blocks", vec![blocks])
        }
        ("markdownGroup", [group, blocks]) => {
            let lines = host.call("markdownHeader", vec![*group])?;
            let description = host.get(*group, "description")?;
            if !host.is_undefined(description)? {
                host.call("markdownDescription", vec![*group, lines])?;
            }
            let items = host.get(*group, "items")?;
            if predicate(host, "emptyArray", vec![items])? {
                host.call("markdownEmpty", vec![*group, lines])?;
            } else {
                host.call("markdownItems", vec![*group, lines])?;
            }
            host.call("markdownBlock", vec![*blocks, lines])
        }
        ("markdownItem", [item]) => {
            let meta = if has_content(host, *item, "meta")? {
                host.call("markdownMeta", vec![*item])?
            } else {
                host.call("empty", vec![])?
            };
            let preview = if has_content(host, *item, "preview")? {
                host.call("markdownPreview", vec![*item])?
            } else {
                host.call("empty", vec![])?
            };
            host.call("markdownItem", vec![*item, meta, preview])
        }
        ("optional", [object, key]) => {
            let value = host.call("field", vec![*object, *key])?;
            if host.is_undefined(value)? {
                return host.call("object", vec![]);
            }
            host.call(
                if host.is_kind(*key, "meta")? {
                    "optionalMeta"
                } else {
                    "optional"
                },
                vec![*object, *key],
            )
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

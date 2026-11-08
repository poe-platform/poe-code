//! Catalog admission, grouping and output-format policy over observable host values.
use crate::table::Host;

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
        ("tone", [theme, value, tone]) => {
            if host.is_undefined(*tone)? {
                Ok(*value)
            } else {
                host.call("tone", vec![*theme, *value, *tone])
            }
        }
        ("terminal", [options]) => {
            let header = host.call("header", vec![*options])?;
            let subtitle = host.get(*options, "subtitle")?;
            let subtitle = if host.is_undefined(subtitle)? {
                subtitle
            } else {
                host.call("subtitle", vec![*options])?
            };
            let title = host.call("title", vec![header, subtitle])?;
            let metrics = if predicate(host, "hasMetrics", vec![*options])? {
                host.call("metrics", vec![*options])?
            } else {
                host.call("undefined", vec![])?
            };
            let blocks = host.call("start", vec![title, metrics])?;
            host.call("terminalGroups", vec![*options, blocks])?;
            host.call("blocks", vec![blocks])
        }
        ("group", [options, group, blocks]) => {
            let label_width = host.call("labelWidth", vec![*group])?;
            let value_width = host.call("valueWidth", vec![*group])?;
            host.call(
                "groupLines",
                vec![*options, *group, label_width, value_width, *blocks],
            )
        }
        ("description", [options, group]) => {
            let description = host.get(*group, "description")?;
            host.call(
                if host.is_undefined(description)? {
                    "array"
                } else {
                    "description"
                },
                vec![*options, *group],
            )
        }
        ("item", [options, item, label_width, value_width]) => {
            let identity = host.call(
                "identity",
                vec![*options, *item, *label_width, *value_width],
            )?;
            let detail = host.get(*item, "detail")?;
            if host.is_undefined(detail)? {
                host.call("trimEnd", vec![identity])
            } else {
                host.call("detail", vec![*options, *item, identity])
            }
        }
        ("markdown", [options]) => {
            let blocks = host.call("markdownStart", vec![*options])?;
            let subtitle = host.get(*options, "subtitle")?;
            if !host.is_undefined(subtitle)? {
                host.call("markdownSubtitle", vec![*options, blocks])?;
            }
            if predicate(host, "hasMetrics", vec![*options])? {
                host.call("markdownMetrics", vec![*options, blocks])?;
            }
            host.call("markdownGroups", vec![*options, blocks])?;
            host.call("blocks", vec![blocks])
        }
        ("markdownGroup", [group, blocks]) => {
            let header = host.call("markdownHeader", vec![*group])?;
            let description = host.get(*group, "description")?;
            if !host.is_undefined(description)? {
                host.call("markdownDescription", vec![*group, header])?;
            }
            let items = host.call("markdownItems", vec![*group])?;
            host.call("markdownGroup", vec![header, items, *blocks])
        }
        ("markdownItem", [item]) => {
            let detail = host.get(*item, "detail")?;
            let detail = if host.is_undefined(detail)? {
                host.call("empty", vec![])?
            } else {
                host.call("markdownDetail", vec![*item])?
            };
            host.call("markdownItem", vec![*item, detail])
        }
        ("optional", [object, key]) => {
            let value = host.call("field", vec![*object, *key])?;
            host.call(
                if host.is_undefined(value)? {
                    "object"
                } else {
                    "optional"
                },
                vec![*object, *key],
            )
        }
        ("metricValue", [metric]) => {
            let value = host.get(*metric, "value")?;
            if predicate(host, "string", vec![value])? {
                host.call("strippedValue", vec![*metric])
            } else {
                host.get(*metric, "value")
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

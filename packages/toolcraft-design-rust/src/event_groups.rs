//! Bounded grouped events and visible row traversal with host iterator cleanup.
use crate::feedback::Host;
fn predicate<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
fn full<H: Host>(host: &mut H, state: H::Value, height: H::Value) -> Result<bool, H::Error> {
    let length = host.call("length", vec![state])?;
    predicate(host, "ge", vec![length, height])
}
pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("validate", [capacity, children]) => {
            let one = host.number(1.)?;
            for value in [*capacity, *children] {
                if !predicate(host, "integer", vec![value])?
                    || predicate(host, "lt", vec![value, one])?
                {
                    return host.call("invalidCapacity", vec![]);
                }
            }
            host.call("undefined", vec![])
        }
        ("append", [groups, capacity, children, id, event]) => {
            let mut group = host.call("mapGet", vec![*groups, *id])?;
            if !predicate(host, "truthy", vec![group])? {
                group = host.call("group", vec![])?;
                host.call("set", vec![*groups, *id, group])?;
            }
            host.call("publish", vec![group, *event])?;
            let events = host.get(group, "events")?;
            let size = host.get(events, "size")?;
            if predicate(host, "gt", vec![size, *children])? {
                host.call("evictChild", vec![group])?;
            }
            let error = host.get(*event, "error")?;
            if predicate(host, "truthy", vec![error])? {
                host.call("expand", vec![group])?;
            }
            let size = host.get(*groups, "size")?;
            if predicate(host, "gt", vec![size, *capacity])? {
                host.call("evict", vec![*groups])?;
            }
            host.call("undefined", vec![])
        }
        ("toggle", [groups, id]) => {
            let group = host.call("mapGet", vec![*groups, *id])?;
            if predicate(host, "truthy", vec![group])? {
                host.call("toggle", vec![group])?;
            }
            host.call("undefined", vec![])
        }
        ("rows", [groups, offset, height]) => {
            host.call("visitGroups", vec![*groups, *offset, *height])
        }
        ("visitGroup", [state, id, group, offset, height]) => {
            let index = host.call("index", vec![*state])?;
            if predicate(host, "ge", vec![index, *offset])? {
                host.call("header", vec![*state, *id, *group])?;
            }
            if full(host, *state, *height)? {
                return host.call("false", vec![]);
            }
            let expanded = host.get(*group, "expanded")?;
            if predicate(host, "truthy", vec![expanded])? {
                host.call("visitChildren", vec![*state, *id, *group, *offset, *height])?;
            }
            let complete = full(host, *state, *height)?;
            host.call(if complete { "false" } else { "true" }, vec![])
        }
        ("visitChild", [state, id, event, offset, height]) => {
            let index = host.call("index", vec![*state])?;
            if predicate(host, "ge", vec![index, *offset])? {
                host.call("child", vec![*state, *id, *event])?;
            }
            let complete = full(host, *state, *height)?;
            host.call(if complete { "false" } else { "true" }, vec![])
        }
        ("finishRows", [rows, height]) => {
            let zero = host.number(0.)?;
            if predicate(host, "gt", vec![*height, zero])? {
                Ok(*rows)
            } else {
                host.call("array", vec![])
            }
        }
        ("render", [row, width]) => {
            let header = host.get(*row, "header")?;
            let marker = if predicate(host, "truthy", vec![header])? {
                let expanded = host.get(*row, "expanded")?;
                if predicate(host, "truthy", vec![expanded])? {
                    "▾"
                } else {
                    "▸"
                }
            } else {
                let error = host.get(*row, "error")?;
                if predicate(host, "truthy", vec![error])? {
                    "  ■"
                } else {
                    "  │"
                }
            };
            let marker = host.literal(marker)?;
            let text = host.get(*row, "text")?;
            let text = host.call("plain", vec![text])?;
            let text = host.call("text", vec![marker, text])?;
            host.call("fit", vec![text, *width])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

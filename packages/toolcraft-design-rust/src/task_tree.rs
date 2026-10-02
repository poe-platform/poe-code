//! Indexed task hierarchy and iterative viewport traversal.
use crate::feedback::Host;
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
        ("validate", [capacity]) => {
            let one = host.number(1.)?;
            if !predicate(host, "integer", vec![*capacity])?
                || predicate(host, "lt", vec![*capacity, one])?
            {
                return host.call("invalidCapacity", vec![]);
            }
            host.call("undefined", vec![])
        }
        ("upsert", [nodes, children, capacity, node]) => {
            if !predicate(host, "hasNode", vec![*nodes, *node])? {
                let size = host.get(*nodes, "size")?;
                if predicate(host, "ge", vec![size, *capacity])? {
                    return host.call("capacityExceeded", vec![]);
                }
            }
            let mut parent = host.get(*node, "parentId")?;
            let seen = host.call("seen", vec![*node])?;
            while !host.is_undefined(parent)? {
                if predicate(host, "has", vec![seen, parent])? {
                    return host.call("cycle", vec![]);
                }
                host.call("add", vec![seen, parent])?;
                parent = host.call("parent", vec![*nodes, parent])?;
            }
            let previous = host.call("previous", vec![*nodes, *node])?;
            if predicate(host, "truthy", vec![previous])? {
                host.call("unlinkPrevious", vec![*children, previous, *node])?;
            }
            host.call("store", vec![*nodes, *node])?;
            let mut siblings = host.call("siblings", vec![*children, *node])?;
            if !predicate(host, "truthy", vec![siblings])? {
                siblings = host.call("set", vec![])?;
                host.call("setSiblings", vec![*children, *node, siblings])?;
            }
            host.call("addSibling", vec![siblings, *node])?;
            host.call("undefined", vec![])
        }
        ("remove", [nodes, children, collapsed, id]) => {
            let node = host.call("get", vec![*nodes, *id])?;
            if !predicate(host, "truthy", vec![node])? {
                return host.call("undefined", vec![]);
            }
            host.call("unlink", vec![*children, node, *id])?;
            let pending = host.call("pending", vec![*id])?;
            loop {
                let length = host.get(pending, "length")?;
                if !predicate(host, "truthy", vec![length])? {
                    break;
                }
                let current = host.call("pop", vec![pending])?;
                host.call("queueChildren", vec![*children, current, pending])?;
                for collection in [*children, *nodes, *collapsed] {
                    host.call("delete", vec![collection, current])?;
                }
            }
            host.call("undefined", vec![])
        }
        ("toggle", [collapsed, id]) => {
            let exists = predicate(host, "has", vec![*collapsed, *id])?;
            host.call(if exists { "delete" } else { "add" }, vec![*collapsed, *id])?;
            host.call("undefined", vec![])
        }
        ("rows", [nodes, children, collapsed, offset, height]) => {
            let result = host.call("array", vec![])?;
            let stack = host.call("stack", vec![*children])?;
            let mut index = 0.0;
            loop {
                let length = host.get(stack, "length")?;
                if !predicate(host, "truthy", vec![length])? {
                    break;
                }
                let length = host.get(result, "length")?;
                if !predicate(host, "lt", vec![length, *height])? {
                    break;
                }
                let frame = host.call("frame", vec![stack])?;
                let next = host.call("next", vec![frame])?;
                let done = host.get(next, "done")?;
                if predicate(host, "truthy", vec![done])? {
                    host.call("pop", vec![stack])?;
                    continue;
                }
                let node = host.call("nextNode", vec![*nodes, next])?;
                let previous = host.number(index)?;
                index += 1.0;
                if predicate(host, "ge", vec![previous, *offset])? {
                    host.call("row", vec![result, node, frame, *collapsed])?;
                }
                if !predicate(host, "collapsed", vec![*collapsed, node])?
                    && predicate(host, "hasChildren", vec![*children, node])?
                {
                    host.call("descend", vec![stack, *children, node, frame])?;
                }
            }
            Ok(result)
        }
        ("renderRows", [rows, width]) => {
            let pending = host.literal("○")?;
            let running = host.literal("●")?;
            let success = host.literal("✓")?;
            let error = host.literal("■")?;
            let markers = host.call("markers", vec![pending, running, success, error])?;
            host.call("renderRows", vec![*rows, *width, markers])
        }
        ("render", [row, width, markers]) => {
            let indent = host.call("indent", vec![*row, *width])?;
            let duration = host.get(*row, "durationMs")?;
            let duration = if !host.is_undefined(duration)?
                && predicate(host, "finiteDuration", vec![*row])?
            {
                host.call("duration", vec![*row])?
            } else {
                host.literal("")?
            };
            let indent = host.call("coerce", vec![indent])?;
            let collapsed = host.get(*row, "collapsed")?;
            let collapsed = predicate(host, "truthy", vec![collapsed])?;
            let arrow = host.literal(if collapsed { "▸" } else { "▾" })?;
            let marker = host.call("marker", vec![*markers, *row])?;
            let marker = host.call("coerce", vec![marker])?;
            let label = host.get(*row, "label")?;
            let label = host.call("plain", vec![label])?;
            let text = host.call("text", vec![indent, arrow, marker, label, duration])?;
            host.call("fit", vec![text, *width])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

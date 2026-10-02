//! Interaction policy with host-owned commands, collections and cancellation.
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
        ("register", [bindings, ids, command]) => {
            if predicate(host, "idHas", vec![*ids, *command])? {
                return host.call("duplicateId", vec![*command]);
            }
            host.call("idAdd", vec![*ids, *command])?;
            host.call("bindKeys", vec![*bindings, *command])
        }
        ("bind", [bindings, key, command]) => {
            if predicate(host, "has", vec![*bindings, *key])? {
                return host.call("duplicateKey", vec![*key]);
            }
            host.call("set", vec![*bindings, *key, *command])
        }
        ("enabled", [command]) => {
            let enabled = host.call("enabled", vec![*command])?;
            let disabled = predicate(host, "isFalse", vec![enabled])?;
            host.call(if disabled { "false" } else { "true" }, vec![])
        }
        ("dispatch", [bindings, key]) => {
            let command = host.call("mapGet", vec![*bindings, *key])?;
            if !predicate(host, "truthy", vec![command])?
                || !predicate(host, "registryEnabled", vec![command])?
            {
                return host.call("false", vec![]);
            }
            host.call("run", vec![command])?;
            host.call("true", vec![])
        }
        ("overlayOpen", [stack, focus]) => {
            let controller = host.call("controller", vec![])?;
            host.call("pushOverlay", vec![*stack, *focus, controller])?;
            host.get(controller, "signal")
        }
        ("overlayClose", [stack]) => {
            let overlay = host.call("pop", vec![*stack])?;
            host.call("abortOptional", vec![overlay])?;
            host.call("notUndefined", vec![overlay])
        }
        ("overlayFocus", [stack, initial]) => {
            let focus = host.call("lastFocus", vec![*stack])?;
            if predicate(host, "nullish", vec![focus])? {
                Ok(*initial)
            } else {
                Ok(focus)
            }
        }
        ("overlayDispose", [stack]) => {
            loop {
                let length = host.get(*stack, "length")?;
                if !predicate(host, "truthy", vec![length])? {
                    break;
                }
                host.call("popAbort", vec![*stack])?;
            }
            host.call("undefined", vec![])
        }
        ("viewportValidate", [capacity]) => {
            if !predicate(host, "integer", vec![*capacity])?
                || predicate(host, "belowOne", vec![*capacity])?
            {
                return host.call("invalidCapacity", vec![]);
            }
            host.call("undefined", vec![])
        }
        ("viewportAppend", [state, item, capacity]) => {
            let live = host.get(*state, "live")?;
            host.call("appendItem", vec![live, *item])?;
            let size = host.get(live, "size")?;
            if predicate(host, "gt", vec![size, *capacity])? {
                host.call("evict", vec![live])?;
            }
            let held = host.get(*state, "held")?;
            if predicate(host, "truthy", vec![held])? {
                host.call("unseenIncrement", vec![*state])?;
            }
            host.call("undefined", vec![])
        }
        ("viewportScroll", [state, delta]) => {
            host.call("advancePosition", vec![*state, *delta])?;
            let position = host.get(*state, "position")?;
            if predicate(host, "truthy", vec![position])? {
                let held = host.get(*state, "held")?;
                if !predicate(host, "truthy", vec![held])? {
                    host.call("hold", vec![*state])?;
                }
            }
            // Snapshot callbacks can reenter and change position.
            let position = host.get(*state, "position")?;
            if !predicate(host, "truthy", vec![position])? {
                host.call("clearHeld", vec![*state])?;
            }
            host.call("undefined", vec![])
        }
        ("viewportItems", [state]) => {
            let held = host.get(*state, "held")?;
            if predicate(host, "nullish", vec![held])? {
                host.call("liveItems", vec![*state])
            } else {
                Ok(held)
            }
        }
        ("viewportFollow", [state]) => host.call("follow", vec![*state]),
        ("tail", [items, height, offset, render]) => {
            let height = host.call("normalize", vec![*height])?;
            let offset = host.call("normalize", vec![*offset])?;
            let zero = host.call("zero", vec![])?;
            if !predicate(host, "truthy", vec![height])? {
                let rows = host.call("array", vec![])?;
                return host.call("selection", vec![rows, zero]);
            }
            let selected = host.call("array", vec![])?;
            let oldest = host.call("array", vec![])?;
            let mut visited = zero;
            let length = host.get(*items, "length")?;
            let mut index = host.call("decrement", vec![length])?;
            while predicate(host, "ge", vec![index, zero])? {
                let rows = host.call("renderRows", vec![*render, *items, index])?;
                let length = host.get(rows, "length")?;
                let mut row = host.call("decrement", vec![length])?;
                while predicate(host, "ge", vec![row, zero])? {
                    let value = host.call("at", vec![rows, row])?;
                    host.call("push", vec![oldest, value])?;
                    let length = host.get(oldest, "length")?;
                    if predicate(host, "gt", vec![length, height])? {
                        host.call("shift", vec![oldest])?;
                    }
                    if predicate(host, "ge", vec![visited, offset])? {
                        let length = host.get(selected, "length")?;
                        if predicate(host, "lt", vec![length, height])? {
                            host.call("push", vec![selected, value])?;
                        }
                    }
                    visited = host.call("increment", vec![visited])?;
                    let length = host.get(selected, "length")?;
                    if predicate(host, "same", vec![length, height])? {
                        let rows = host.call("reverse", vec![selected])?;
                        return host.call("selection", vec![rows, offset]);
                    }
                    row = host.call("decrement", vec![row])?;
                }
                index = host.call("decrement", vec![index])?;
            }
            let rows = host.call("reverse", vec![oldest])?;
            let offset = host.call("tailOffset", vec![offset, visited, height])?;
            host.call("selection", vec![rows, offset])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

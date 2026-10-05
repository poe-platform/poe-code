//! Approval storage/cache policies and persisted payload admission.
use crate::host::Host;

pub const STATE_MACHINE_JSON: &str = r#"{"initial":"pending","states":["pending","prompting","approved-running","approved-done","approved-failed","declined"],"events":{"claim":{"from":["pending"],"to":"prompting"},"start":{"from":["prompting"],"to":"approved-running"},"succeed":{"from":["approved-running"],"to":"approved-done"},"fail":{"from":["prompting","approved-running"],"to":"approved-failed"},"decline":{"from":["pending","prompting"],"to":"declined"}}}"#;

fn define<H: Host>(
    host: &mut H,
    object: H::Value,
    key: &str,
    value: H::Value,
) -> Result<(), H::Error> {
    host.call(&format!("define:{key}"), vec![object, value])?;
    Ok(())
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("prepare", [runtime, deps]) => {
            if host.is_nullish(*runtime)? {
                return host.call("missingList", vec![]);
            }
            let list = host.get(*runtime, "taskList")?;
            if host.is_undefined(list)? {
                return host.call("missingList", vec![]);
            }
            let mut name = host.get(*runtime, "listName")?;
            if host.is_nullish(name)? {
                name = host.call("defaultName", vec![])?;
            }
            let list = host.get(*runtime, "taskList")?;
            let mut open = host.get(*deps, "openTaskList")?;
            if host.is_nullish(open)? {
                open = host.call("defaultOpen", vec![])?;
            }
            let mut create = host.get(*deps, "create")?;
            if host.is_nullish(create)? {
                create = host.call("true", vec![])?;
            }
            let pending = host.call("resolveList", vec![*runtime, list, open, create])?;
            host.call("prepared", vec![name, pending])
        }
        ("resolve", [runtime, list, open, create]) => {
            let config = run(host, "isConfig", &[*list])?;
            if !host.is_true(config)? {
                return Ok(*list);
            }
            let creating = host.call("truthy", vec![*create])?;
            if host.is_true(creating)? {
                let cached = host.call("opened", vec![*runtime])?;
                if !host.is_undefined(cached)? {
                    return Ok(cached);
                }
            }
            let format = host.get(*list, "format")?;
            let path = host.get(*list, "dir")?;
            let opened = host.call("open", vec![*open, *create, format, path])?;
            if host.is_true(creating)? {
                host.call("cacheOpen", vec![*runtime, opened])?;
            }
            Ok(opened)
        }
        ("finish", [runtime, name, list]) => {
            let tasks = host.call("list", vec![*list, *name])?;
            let validated = host.call("validated", vec![*runtime, *name])?;
            if !host.is_true(validated)? {
                let machine = host.get(tasks, "stateMachine")?;
                let expected = host.call("machine", vec![])?;
                let valid = if host.same(machine, expected)? {
                    true
                } else {
                    let result = run(host, "equalMachine", &[machine, expected])?;
                    host.is_true(result)?
                };
                if !valid {
                    let config = host.get(*runtime, "taskList")?;
                    let is_config = run(host, "isConfig", &[config])?;
                    let directory = if host.is_true(is_config)? {
                        host.get(config, "dir")?
                    } else {
                        host.call("unknown", vec![])?
                    };
                    return host.call("differentMachine", vec![directory]);
                }
                let names = host.call("validatedNames", vec![*runtime])?;
                if host.is_undefined(names)? {
                    let names = host.call("nameSet", vec![*name])?;
                    host.call("cacheValidated", vec![*runtime, names])?;
                } else {
                    host.call("addName", vec![names, *name])?;
                }
            }
            host.call("resolved", vec![*list, *name, tasks])
        }
        ("isConfig", [list]) => {
            if host.is_undefined(*list)? {
                host.call("false", vec![])
            } else {
                host.call("hasDir", vec![*list])
            }
        }
        ("equalMachine", [left, right]) => {
            let left_initial = host.get(*left, "initial")?;
            let right_initial = host.get(*right, "initial")?;
            if !host.same(left_initial, right_initial)? {
                return host.call("false", vec![]);
            }
            let left_states = host.get(*left, "states")?;
            let right_states = host.get(*right, "states")?;
            let same = run(host, "equalStrings", &[left_states, right_states])?;
            if !host.is_true(same)? {
                return Ok(same);
            }
            let events = host.get(*left, "events")?;
            let names = host.call("keys", vec![events])?;
            let events = host.get(*right, "events")?;
            let right_names = host.call("keys", vec![events])?;
            let same = run(host, "equalStrings", &[names, right_names])?;
            if !host.is_true(same)? {
                return Ok(same);
            }
            host.call("equalEvents", vec![*left, *right, names])
        }
        ("equalEvent", [left, right, name]) => {
            let events = host.get(*left, "events")?;
            let left = host.call("property", vec![events, *name])?;
            let events = host.get(*right, "events")?;
            let right = host.call("property", vec![events, *name])?;
            if host.is_undefined(left)? || host.is_undefined(right)? {
                return host.call("false", vec![]);
            }
            let left_to = host.get(left, "to")?;
            let right_to = host.get(right, "to")?;
            if !host.same(left_to, right_to)? {
                return host.call("false", vec![]);
            }
            let left_from = host.get(left, "from")?;
            let right_from = host.get(right, "from")?;
            if host.is_kind(left_from, "*")? || host.is_kind(right_from, "*")? {
                return host.call(
                    if host.same(left_from, right_from)? {
                        "true"
                    } else {
                        "false"
                    },
                    vec![],
                );
            }
            run(host, "equalStrings", &[left_from, right_from])
        }
        ("equalStrings", [left, right]) => {
            let left_len = host.get(*left, "length")?;
            let right_len = host.get(*right, "length")?;
            if !host.same(left_len, right_len)? {
                return host.call("false", vec![]);
            }
            let mut index = host.call("zero", vec![])?;
            loop {
                let length = host.get(*left, "length")?;
                let more = host.call("lt", vec![index, length])?;
                if !host.is_true(more)? {
                    break;
                }
                let left = host.call("property", vec![*left, index])?;
                let right = host.call("property", vec![*right, index])?;
                if !host.same(left, right)? {
                    return host.call("false", vec![]);
                }
                index = host.call("increment", vec![index])?;
            }
            host.call("true", vec![])
        }
        ("record", [payload, time]) => {
            let id = host.call("id", vec![*time])?;
            let record = host.call("record", vec![*payload, *time, id])?;
            let plan = host.get(*payload, "plan")?;
            if !host.is_undefined(plan)? {
                let hash = host.get(*payload, "planHash")?;
                if !host.is_undefined(hash)? {
                    host.call("attachPlan", vec![record, *payload])?;
                }
            }
            Ok(record)
        }
        ("payload", [task]) => {
            let metadata = host.get(*task, "metadata")?;
            let object = host.call("object", vec![metadata])?;
            if !host.is_true(object)? || host.is_nullish(metadata)? {
                return host.call("undefined", vec![]);
            }
            let version = host.get(metadata, "schemaVersion")?;
            let valid = host.call("version", vec![version])?;
            if !host.is_true(valid)? {
                return host.call("undefined", vec![]);
            }
            for key in ["approvalId", "commandPath", "message", "enqueuedAt"] {
                let value = host.get(metadata, key)?;
                let valid = host.call("string", vec![value])?;
                if !host.is_true(valid)? {
                    return host.call("undefined", vec![]);
                }
            }
            let params = host.get(metadata, "params")?;
            let object = host.call("object", vec![params])?;
            if !host.is_true(object)? {
                return host.call("undefined", vec![]);
            }
            let params = host.get(metadata, "params")?;
            let null = host.call("null", vec![params])?;
            if host.is_true(null)? {
                return host.call("undefined", vec![]);
            }
            let output = host.call("recordObject", vec![])?;
            for key in ["approvalId", "commandPath", "params", "message"] {
                let value = host.get(metadata, key)?;
                define(host, output, key, value)?;
            }
            let prompt = optional(host, metadata, "declineInputPrompt", "string", true)?;
            define(host, output, "declineInputPrompt", prompt)?;
            let plan = optional(host, metadata, "plan", "plan", false)?;
            define(host, output, "plan", plan)?;
            let hash = optional(host, metadata, "planHash", "string", false)?;
            define(host, output, "planHash", hash)?;
            let time = host.get(metadata, "enqueuedAt")?;
            define(host, output, "enqueuedAt", time)?;
            let pid = optional(host, metadata, "pid", "number", true)?;
            define(host, output, "pid", pid)?;
            for key in ["result", "error"] {
                let value = host.get(metadata, key)?;
                define(host, output, key, value)?;
            }
            Ok(output)
        }
        ("enqueueError", [error]) => {
            let collision = host.call("collision", vec![*error])?;
            if !host.is_true(collision)? {
                return host.call("throw", vec![*error]);
            }
            Ok(collision)
        }
        ("loadError", [error]) => {
            let missing = host.call("missing", vec![*error])?;
            if host.is_true(missing)? {
                host.call("undefined", vec![])
            } else {
                host.call("throw", vec![*error])
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

pub(crate) fn optional<H: Host>(
    host: &mut H,
    metadata: H::Value,
    key: &str,
    kind: &str,
    nullable: bool,
) -> Result<H::Value, H::Error> {
    let value = host.get(metadata, key)?;
    let accepted = host.call(kind, vec![value])?;
    let mut accepted = host.is_true(accepted)?;
    if !accepted && nullable {
        let value = host.get(metadata, key)?;
        let null = host.call("null", vec![value])?;
        accepted = host.is_true(null)?;
    }
    if accepted {
        host.get(metadata, key)
    } else {
        host.call("undefined", vec![])
    }
}

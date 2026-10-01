//! Queued approval execution, metadata admission and command lookup policies.
use crate::{approval_tasks::optional, host::Host};

fn set<H: Host>(host: &mut H, state: H::Value, key: &str, value: H::Value) -> Result<(), H::Error> {
    host.call(&format!("set:{key}"), vec![state, value])?;
    Ok(())
}
fn phase<H: Host>(host: &mut H, state: H::Value, name: &str) -> Result<(), H::Error> {
    host.call(&format!("phase:{name}"), vec![state])?;
    Ok(())
}
fn define<H: Host>(host: &mut H, object: H::Value, key: &str, value: H::Value) -> Result<(), H::Error> {
    host.call(&format!("define:{key}"), vec![object, value])?;
    Ok(())
}

pub fn run<H: Host>(host: &mut H, operation: &str, args: &[H::Value]) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("begin", [state]) => {
            let runtime = host.get(*state, "runtime")?;
            let pending = host.call("ensureList", vec![runtime])?;
            host.call("step:listed", vec![pending])
        }
        ("listed", [state, result]) => {
            let tasks = host.get(*result, "tasks")?;
            set(host, *state, "tasks", tasks)?;
            let id = host.get(*state, "id")?;
            let task = host.call("getTask", vec![tasks, id])?;
            host.call("step:loaded", vec![task])
        }
        ("loaded", [state, task]) => {
            let status = host.get(*task, "state")?;
            if !host.is_kind(status, "pending")? { return host.call("done", vec![]); }
            let approval = run(host, "payload", &[*task])?;
            set(host, *state, "approval", approval)?;
            let runtime = host.get(*state, "runtime")?;
            let provider = host.get(runtime, "provider")?;
            set(host, *state, "provider", provider)?;
            phase(host, *state, "claim")?;
            let pending = host.call("claim", vec![*state])?;
            host.call("step:claimed", vec![pending])
        }
        ("claimed", [state, _]) => {
            phase(host, *state, "prompt")?;
            let approval = host.get(*state, "approval")?;
            run(host, "verifyStored", &[approval])?;
            let provider = host.get(*state, "provider")?;
            let request = host.call("request", vec![provider, approval])?;
            host.call("step:prompted", vec![request])
        }
        ("prompted", [state, result]) => {
            let outcome = host.get(*result, "outcome")?;
            if host.is_kind(outcome, "declined")? {
                let pending = host.call("decline", vec![*state, *result])?;
                return host.call("step:finished", vec![pending]);
            }
            phase(host, *state, "prepare")?;
            let root = host.get(*state, "root")?;
            let approval = host.get(*state, "approval")?;
            let path = host.get(approval, "commandPath")?;
            let command = run(host, "find", &[root, path])?;
            set(host, *state, "command", command)?;
            let params = host.get(approval, "params")?;
            let context = host.call("context", vec![command, params])?;
            set(host, *state, "context", context)?;
            let hash = host.get(approval, "planHash")?;
            if !host.is_undefined(hash)? {
                let config = host.get(command, "humanInLoop")?;
                if host.is_nullish(config)? { return host.call("unverifiable", vec![]); }
                let hook = host.get(config, "plan")?;
                if host.is_undefined(hook)? { return host.call("unverifiable", vec![]); }
                let pending = host.call("executionPlan", vec![command, approval])?;
                return host.call("step:planned", vec![pending]);
            }
            run(host, "start", &[*state])
        }
        ("planned", [state, value]) => {
            let plan = host.call("createPlan", vec![*value])?;
            let approval = host.get(*state, "approval")?;
            let expected = host.get(approval, "planHash")?;
            let actual = host.get(plan, "hash")?;
            host.call("assertHash", vec![expected, actual])?;
            run(host, "start", &[*state])
        }
        ("start", [state]) => {
            phase(host, *state, "propagate")?;
            let pending = host.call("start", vec![*state])?;
            host.call("step:started", vec![pending])
        }
        ("started", [state, _]) => {
            phase(host, *state, "execute")?;
            let command = host.get(*state, "command")?;
            let context = host.get(*state, "context")?;
            let pending = host.call("handler", vec![command, context])?;
            host.call("step:handled", vec![pending])
        }
        ("handled", [state, result]) => {
            let serialized = host.call("serialize", vec![*result])?;
            let valid = host.get(serialized, "ok")?;
            let pending = if host.is_true(valid)? {
                host.call("succeed", vec![*state, serialized])?
            } else { host.call("notJson", vec![*state])? };
            host.call("step:finished", vec![pending])
        }
        ("finished", [_, _]) => host.call("done", vec![]),
        ("failed", [state, error]) => {
            let current = host.get(*state, "phase")?;
            if host.is_kind(current, "claim")? {
                let conflict = host.call("conflict", vec![*error])?;
                return if host.is_true(conflict)? { host.call("done", vec![]) }
                    else { host.call("throw", vec![*error]) };
            }
            if host.is_kind(current, "propagate")? { return host.call("throw", vec![*error]); }
            phase(host, *state, "propagate")?;
            let pending = host.call("fail", vec![*state, *error])?;
            host.call("step:finished", vec![pending])
        }
        ("verifyStored", [approval]) => {
            let plan = host.get(*approval, "plan")?;
            let hash = host.get(*approval, "planHash")?;
            if host.is_undefined(plan)? && host.is_undefined(hash)? { return host.call("undefined", vec![]); }
            let plan = host.get(*approval, "plan")?;
            if host.is_undefined(plan)? { return host.call("malformedPlan", vec![]); }
            let hash = host.get(*approval, "planHash")?;
            if host.is_undefined(hash)? { return host.call("malformedPlan", vec![]); }
            let plan = host.get(*approval, "plan")?;
            let stored = host.call("createPlan", vec![plan])?;
            let expected = host.get(*approval, "planHash")?;
            let actual = host.get(stored, "hash")?;
            host.call("assertHash", vec![expected, actual])?;
            let matches = host.call("promptMatches", vec![*approval, stored])?;
            if !host.is_true(matches)? { return host.call("mismatchedPrompt", vec![]); }
            host.call("undefined", vec![])
        }
        ("payload", [task]) => {
            let metadata = host.get(*task, "metadata")?;
            let object = host.call("object", vec![metadata])?;
            if !host.is_true(object)? || host.is_nullish(metadata)? { return host.call("malformed", vec![*task]); }
            let version = host.get(metadata, "schemaVersion")?;
            let valid = host.call("version", vec![version])?;
            if !host.is_true(valid)? { return host.call("malformed", vec![*task]); }
            for key in ["commandPath", "message"] {
                let value = host.get(metadata, key)?;
                let valid = host.call("string", vec![value])?;
                if !host.is_true(valid)? { return host.call("malformed", vec![*task]); }
            }
            let params = host.get(metadata, "params")?;
            let object = host.call("object", vec![params])?;
            if !host.is_true(object)? { return host.call("malformed", vec![*task]); }
            let params = host.get(metadata, "params")?;
            let null = host.call("null", vec![params])?;
            if host.is_true(null)? { return host.call("malformed", vec![*task]); }
            let prompt = optional(host, metadata, "declineInputPrompt", "string", true)?;
            let output = host.call("record", vec![])?;
            let id = optional(host, metadata, "approvalId", "string", false)?;
            define(host, output, "approvalId", id)?;
            for key in ["commandPath", "params", "message"] {
                let value = host.get(metadata, key)?;
                define(host, output, key, value)?;
            }
            define(host, output, "declineInputPrompt", prompt)?;
            for (key, kind, nullable) in [("plan", "planValue", false), ("planHash", "string", false), ("enqueuedAt", "string", false), ("pid", "number", true)] {
                let value = optional(host, metadata, key, kind, nullable)?;
                define(host, output, key, value)?;
            }
            for key in ["result", "error"] {
                let value = host.get(metadata, key)?;
                define(host, output, key, value)?;
            }
            Ok(output)
        }
        ("find", [root, path]) => {
            let segments = host.call("segments", vec![*path])?;
            let empty = host.call("empty", vec![segments])?;
            if host.is_true(empty)? { return host.call("unknown", vec![*root, *path]); }
            let current = host.call("walk", vec![*root, *path, segments])?;
            let kind = host.get(current, "kind")?;
            if !host.is_kind(kind, "command")? { return host.call("unknown", vec![*root, *path]); }
            Ok(current)
        }
        ("segment", [current, segment, root, path]) => {
            let kind = host.get(*current, "kind")?;
            if !host.is_kind(kind, "group")? { return host.call("unknown", vec![*root, *path]); }
            let next = host.call("findChild", vec![*current, *segment])?;
            if host.is_undefined(next)? { return host.call("unknown", vec![*root, *path]); }
            Ok(next)
        }
        ("available", [root]) => {
            let paths = host.call("list", vec![])?;
            let kind = host.get(*root, "kind")?;
            if host.is_kind(kind, "command")? {
                let name = host.get(*root, "name")?;
                let path = host.call("singleton", vec![name])?;
                run(host, "visit", &[*root, path, paths])?;
            } else {
                let children = run(host, "visibleChildren", &[*root])?;
                host.call("visitRoots", vec![children, paths])?;
            }
            host.call("formatPaths", vec![paths])
        }
        ("visit", [node, path, paths]) => {
            let kind = host.get(*node, "kind")?;
            if host.is_kind(kind, "command")? { return host.call("pushPath", vec![*paths, *path]); }
            let children = run(host, "visibleChildren", &[*node])?;
            host.call("visitChildren", vec![children, *path, *paths])
        }
        ("visibleChildren", [node]) => {
            let kind = host.get(*node, "kind")?;
            if host.is_kind(kind, "group")? { host.call("filterChildren", vec![*node]) }
            else { host.call("list", vec![]) }
        }
        ("visible", [node]) => {
            let kind = host.get(*node, "kind")?;
            if host.is_kind(kind, "command")? {
                let scope = host.get(*node, "scope")?;
                return host.call("includesCli", vec![scope]);
            }
            let children = run(host, "visibleChildren", &[*node])?;
            let nonempty = host.call("nonempty", vec![children])?;
            if host.is_true(nonempty)? { return Ok(nonempty); }
            let default = host.get(*node, "default")?;
            let truthy = host.call("truthy", vec![default])?;
            if host.is_true(truthy)? {
                let default = host.get(*node, "default")?;
                let scope = host.get(default, "scope")?;
                let cli = host.call("includesCli", vec![scope])?;
                if host.is_true(cli)? { return Ok(cli); }
            }
            let scope = host.get(*node, "scope")?;
            if host.is_undefined(scope)? { return host.call("true", vec![]); }
            let scope = host.get(*node, "scope")?;
            host.call("includesCli", vec![scope])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

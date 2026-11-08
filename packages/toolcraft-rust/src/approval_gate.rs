//! Approval invocation continuations. The host owns promises and callback values.
use crate::host::Host;

fn set<H: Host>(host: &mut H, state: H::Value, key: &str, value: H::Value) -> Result<(), H::Error> {
    host.call(&format!("set:{key}"), vec![state, value])?;
    Ok(())
}
fn handler<H: Host>(host: &mut H, state: H::Value) -> Result<H::Value, H::Error> {
    let node = host.get(state, "node")?;
    let context = host.get(state, "ctx")?;
    let result = host.call("handler", vec![node, context])?;
    host.call("step:return", vec![result])
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("start", [state]) => {
            let ctx = host.get(*state, "ctx")?;
            host.call("abort", vec![ctx])?;
            let node = host.get(*state, "node")?;
            let config = host.get(node, "humanInLoop")?;
            let gated = host.call("truthy", vec![config])?;
            if !host.is_true(gated)? {
                return handler(host, *state);
            }
            let path = host.get(*state, "path")?;
            let context = host.call("planContext", vec![ctx, path])?;
            set(host, *state, "planContext", context)?;
            let config = host.get(node, "humanInLoop")?;
            let message = host.call("message", vec![config, context])?;
            set(host, *state, "baseMessage", message)?;
            let config = host.get(node, "humanInLoop")?;
            let plan = host.get(config, "plan")?;
            if host.is_undefined(plan)? {
                run(host, "afterPlan", &[*state])
            } else {
                let plan = host.call("plan", vec![node, context])?;
                host.call("step:planned", vec![plan])
            }
        }
        ("planned", [state, value]) => {
            let plan = host.call("createPlan", vec![*value])?;
            set(host, *state, "approvalPlan", plan)?;
            run(host, "afterPlan", &[*state])
        }
        ("afterPlan", [state]) => {
            let ctx = host.get(*state, "ctx")?;
            host.call("abort", vec![ctx])?;
            let plan = host.get(*state, "approvalPlan")?;
            let base = host.get(*state, "baseMessage")?;
            let message = if host.is_undefined(plan)? {
                base
            } else {
                host.call("format", vec![base, plan])?
            };
            set(host, *state, "message", message)?;
            let node = host.get(*state, "node")?;
            let config = host.get(node, "humanInLoop")?;
            let mode = host.get(config, "mode")?;
            let runtime = host.get(*state, "runtime")?;
            if host.is_kind(mode, "async")? {
                let list = host.call("ensureList", vec![runtime])?;
                host.call("step:listed", vec![list])
            } else {
                let response = host.call("request", vec![runtime, node, message])?;
                host.call("step:approved", vec![response])
            }
        }
        ("listed", [state, result]) => {
            let tasks = host.get(*result, "tasks")?;
            let ctx = host.get(*state, "ctx")?;
            host.call("abort", vec![ctx])?;
            let options = host.get(*state, "options")?;
            let mut enqueue = host.get(options, "enqueueApproval")?;
            if host.is_nullish(enqueue)? {
                enqueue = host.call("defaultEnqueue", vec![])?;
            }
            let pending = host.call("enqueue", vec![enqueue, tasks, *state])?;
            host.call("step:queued", vec![pending])
        }
        ("queued", [state, result]) => {
            let id = host.get(*result, "approvalId")?;
            let pending = host.get(*result, "pending")?;
            let ctx = host.get(*state, "ctx")?;
            host.call("abort", vec![ctx])?;
            let options = host.get(*state, "options")?;
            let spawn = host.get(options, "spawnRunner")?;
            let allowed = host.call("spawnAllowed", vec![spawn])?;
            if host.is_true(allowed)? {
                let runtime = host.get(*state, "runtime")?;
                host.call("spawn", vec![id, runtime])?;
            }
            host.call("step:return", vec![pending])
        }
        ("approved", [state, result]) => {
            let ctx = host.get(*state, "ctx")?;
            host.call("abort", vec![ctx])?;
            let outcome = host.get(*result, "outcome")?;
            if host.is_kind(outcome, "declined")? {
                let reason = host.get(*result, "reason")?;
                let path = host.get(*state, "path")?;
                return host.call("declined", vec![reason, path]);
            }
            let plan = host.get(*state, "approvalPlan")?;
            if !host.is_undefined(plan)? {
                let node = host.get(*state, "node")?;
                let config = host.get(node, "humanInLoop")?;
                let hook = host.get(config, "plan")?;
                if !host.is_undefined(hook)? {
                    let context = host.get(*state, "planContext")?;
                    let value = host.call("plan", vec![node, context])?;
                    return host.call("step:verified", vec![value]);
                }
            }
            handler(host, *state)
        }
        ("verified", [state, value]) => {
            let execution = host.call("createPlan", vec![*value])?;
            let ctx = host.get(*state, "ctx")?;
            host.call("abort", vec![ctx])?;
            let approval = host.get(*state, "approvalPlan")?;
            let expected = host.get(approval, "hash")?;
            let actual = host.get(execution, "hash")?;
            host.call("assertHash", vec![expected, actual])?;
            handler(host, *state)
        }
        ("spawn", [id, runtime, spawn]) => {
            let mut bin = host.get(*runtime, "binPath")?;
            if host.is_nullish(bin)? {
                bin = host.call("defaultBin", vec![])?;
            }
            let exec = host.get(bin, "execPath")?;
            let args = host.get(bin, "entryArgs")?;
            let spawn = if host.is_nullish(*spawn)? {
                host.call("defaultSpawn", vec![])?
            } else {
                *spawn
            };
            let child = host.call("spawnChild", vec![spawn, exec, args, *id])?;
            host.call("unref", vec![child])?;
            host.call("undefined", vec![])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

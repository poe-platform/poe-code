//! Runtime service admission and approval wiring, independent of host I/O.
use crate::host::Host;

pub const RESERVED_SERVICE_NAMES: &[&str] = &[
    "params",
    "secrets",
    "fetch",
    "fs",
    "env",
    "diagnostics",
    "progress",
    "runtimeOptions",
    "root",
    "signal",
    "stdin",
    "stdout",
    "stderr",
    "cwd",
    "regex",
    "registerCleanup",
    "invoke",
    "inputBudget",
];

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("services", [services, reserved, message]) => {
            let names = host.call("keys", vec![*services])?;
            host.call("eachService", vec![names, *reserved, *message])
        }
        ("service", [name, reserved, message]) => {
            let has = host.call("has", vec![*reserved, *name])?;
            if host.is_true(has)? {
                host.call("reserved", vec![*name, *message])?;
            }
            host.call("undefined", vec![])
        }
        ("assertWired", [root, runtime]) => {
            if host.is_undefined(*runtime)? {
                let path = host.call("array", vec![])?;
                let command = host.call("find", vec![*root, path])?;
                if !host.is_undefined(command)? {
                    host.call("unwired", vec![command])?;
                }
            }
            host.call("undefined", vec![])
        }
        ("find", [node, path]) => {
            let kind = host.get(*node, "kind")?;
            if host.is_kind(kind, "command")? {
                let config = host.get(*node, "humanInLoop")?;
                let gated = host.call("truthy", vec![config])?;
                if host.is_true(gated)? {
                    let path = host.call("joinPath", vec![*path])?;
                    let nonempty = host.call("truthy", vec![path])?;
                    return if host.is_true(nonempty)? {
                        Ok(path)
                    } else {
                        host.get(*node, "name")
                    };
                }
                host.call("undefined", vec![])
            } else {
                let children = host.get(*node, "children")?;
                host.call("findChildren", vec![children, *path])
            }
        }
        ("merge", [root, options]) => {
            let approvals = host.get(*options, "approvals")?;
            if !host.is_true(approvals)? {
                return Ok(*root);
            }
            let runtime = host.get(*options, "humanInLoop")?;
            if host.is_undefined(runtime)? {
                host.call("missingRuntime", vec![])?;
            }
            let runtime = host.get(*options, "humanInLoop")?;
            host.call("mergeRoot", vec![runtime, *root])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

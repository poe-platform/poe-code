//! SDK tree assembly and invocation policies over opaque host values.
use crate::host::Host;

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("create", [root, options]) => {
            host.call("sourceMaps", vec![])?;
            let root = host.call("merge", vec![*root, *options])?;
            let runtime = host.get(*options, "humanInLoop")?;
            host.call("assertWired", vec![root, runtime])?;
            let proxies = host.call("hasProxies", vec![root])?;
            if host.is_true(proxies)? {
                host.call("deferred", vec![root, *options])
            } else {
                run(host, "resolved", &[root, *options])
            }
        }
        ("resolved", [root, options]) => {
            let mut services = host.get(*options, "services")?;
            if host.is_nullish(services)? {
                services = host.call("record", vec![])?;
            }
            let runtime = host.get(*options, "humanInLoop")?;
            let mut fetch = host.get(*options, "fetch")?;
            if host.is_nullish(fetch)? {
                fetch = host.call("globalFetch", vec![])?;
            }
            let level = host.get(*options, "logLevel")?;
            let logger = host.get(*options, "logger")?;
            let diagnostics = host.call("logger", vec![level, logger])?;
            host.get(*options, "casing")?;
            host.call("services", vec![services])?;
            let state = host.call(
                "state",
                vec![*root, *options, services, runtime, fetch, diagnostics],
            )?;
            let path = host.call("list", vec![])?;
            host.call("build", vec![*root, path, state])
        }
        ("build", [node, path, state]) => {
            let kind = host.get(*node, "kind")?;
            if host.is_kind(kind, "command")? {
                let params = host.get(*node, "params")?;
                let schema = host.call("scope", vec![params])?;
                if !host.is_nullish(schema)? {
                    let kind = host.get(schema, "kind")?;
                    if host.is_kind(kind, "object")? {
                        host.call("members", vec![schema])?;
                    }
                }
                let stream = host.get(*node, "stream")?;
                return host.call(
                    if host.is_undefined(stream)? {
                        "method"
                    } else {
                        "streamMethod"
                    },
                    vec![*node, *path, *state],
                );
            }
            let output = host.call("record", vec![])?;
            let names = host.call("map", vec![])?;
            let root = host.get(*state, "root")?;
            let path = if host.same(*node, root)? {
                *path
            } else {
                host.call("appendPath", vec![*path, *node])?
            };
            host.call("children", vec![*node, path, *state, output, names])?;
            Ok(output)
        }
        ("child", [child, path, state, output, names]) => {
            let kind = host.get(*child, "kind")?;
            let value = if host.is_kind(kind, "command")? {
                let scope = host.get(*child, "scope")?;
                let includes = host.call("includesSdk", vec![scope])?;
                if !host.is_true(includes)? {
                    return host.call("undefined", vec![]);
                }
                host.call("build", vec![*child, *path, *state])?
            } else {
                let value = host.call("build", vec![*child, *path, *state])?;
                let plain = host.call("plain", vec![value])?;
                if !host.is_true(plain)? {
                    return host.call("undefined", vec![]);
                }
                let empty = host.call("emptyKeys", vec![value])?;
                if host.is_true(empty)? {
                    return host.call("undefined", vec![]);
                }
                value
            };
            let name = host.get(*child, "name")?;
            let member = host.call("format", vec![name])?;
            if host.is_kind(member, "then")? {
                return host.call("reserved", vec![*child]);
            }
            let existing = host.call("mapGet", vec![*names, member])?;
            if !host.is_undefined(existing)? {
                return host.call("conflict", vec![existing, *child, member]);
            }
            let name = host.get(*child, "name")?;
            host.call("mapSet", vec![*names, member, name])?;
            let own = host.call("own", vec![*output, member])?;
            if host.is_true(own)? {
                return host.call("duplicate", vec![member]);
            }
            host.call("defineMember", vec![*output, member, value])
        }
        ("validate", [node, params]) => {
            let schema = host.get(*node, "params")?;
            let schema = host.call("scope", vec![schema])?;
            if host.is_undefined(schema)? {
                return host.call("invalidSchema", vec![*node]);
            }
            let kind = host.get(schema, "kind")?;
            if !host.is_kind(kind, "object")? {
                return host.call("invalidSchema", vec![*node]);
            }
            let errors = host.call("list", vec![])?;
            let params = if host.is_nullish(*params)? {
                host.call("record", vec![])?
            } else {
                *params
            };
            let result = host.call("validate", vec![schema, params, errors])?;
            run(host, "validationErrors", &[errors])?;
            Ok(result)
        }
        ("validationErrors", [errors]) => {
            let empty = host.call("empty", vec![*errors])?;
            if host.is_true(empty)? {
                return host.call("undefined", vec![]);
            }
            let single = host.call("single", vec![*errors])?;
            host.call(
                if host.is_true(single)? {
                    "singleError"
                } else {
                    "multipleErrors"
                },
                vec![*errors],
            )
        }
        ("invoke", [node, context, state, path, stream]) => {
            if host.is_true(*stream)? {
                return host.call("handler", vec![*node, *context]);
            }
            let runtime = host.get(*state, "humanInLoop")?;
            if host.is_undefined(runtime)? {
                host.call("handler", vec![*node, *context])
            } else {
                host.call("runtimeInvoke", vec![runtime, *node, *context, *path])
            }
        }
        ("result", [node, result]) => {
            let schema = host.get(*node, "result")?;
            if !host.is_undefined(schema)? {
                let marked = host.call("isMcpResult", vec![*result])?;
                if host.is_true(marked)? {
                    let error = host.get(*result, "isError")?;
                    if host.is_true(error)? {
                        return host.call("mcpError", vec![*result]);
                    }
                }
            }
            Ok(*result)
        }
        ("deferredResolve", [state, root, options]) => {
            let promise = host.get(*state, "promise")?;
            if host.is_nullish(promise)? {
                let promise = host.call("pendingSDK", vec![*state, *root, *options])?;
                host.call("setPromise", vec![*state, promise])?;
                Ok(promise)
            } else {
                Ok(promise)
            }
        }
        ("deferredRejected", [state, error]) => {
            let undefined = host.call("undefined", vec![])?;
            host.call("setPromise", vec![*state, undefined])?;
            host.call("throw", vec![*error])
        }
        ("proxyGet", [path, property, resolve, proxy]) => {
            if host.is_kind(*property, "then")? {
                let empty = host.call("empty", vec![*path])?;
                if host.is_true(empty)? {
                    host.call("rootThen", vec![*resolve])
                } else {
                    host.call("undefined", vec![])
                }
            } else {
                host.call("nextProxy", vec![*proxy, *path, *property])
            }
        }
        ("pathSegment", [state, segment]) => {
            let valid = host.call("validSegment", vec![*segment])?;
            if !host.is_true(valid)? {
                return Ok(valid);
            }
            let value = host.get(*state, "current")?;
            let current = host.call("property", vec![value, *segment])?;
            host.call("setCurrent", vec![*state, current])?;
            Ok(valid)
        }
        ("callPath", [value, path, args]) => {
            let callable = host.call("callable", vec![*value])?;
            if !host.is_true(callable)? {
                return host.call("notCallable", vec![*path]);
            }
            host.call("call", vec![*value, *args])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

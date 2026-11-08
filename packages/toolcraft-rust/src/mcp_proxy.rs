//! MCP proxy discovery, graph mutation, cache and connection policies.
use crate::host::Host;

fn yes<H: Host>(host: &mut H, operation: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(operation, args)?;
    host.is_true(value)
}
fn boolean<H: Host>(host: &mut H, value: bool) -> Result<H::Value, H::Error> {
    host.call(if value { "true" } else { "false" }, vec![])
}
fn set<H: Host>(
    host: &mut H,
    target: H::Value,
    key: &str,
    value: H::Value,
) -> Result<(), H::Error> {
    host.call(&format!("define:{key}"), vec![target, value])?;
    Ok(())
}
fn copy<H: Host>(
    host: &mut H,
    target: H::Value,
    source: H::Value,
    key: &str,
) -> Result<(), H::Error> {
    let value = host.get(source, key)?;
    set(host, target, key, value)
}
fn internal<H: Host>(host: &mut H, group: H::Value) -> Result<H::Value, H::Error> {
    let symbols = host.call("symbols", vec![group])?;
    let symbol = host.call("findConfigSymbol", vec![symbols])?;
    if host.is_undefined(symbol)? {
        return host.call("record", vec![]);
    }
    let value = host.call("property", vec![group, symbol])?;
    if host.is_nullish(value)? {
        host.call("record", vec![])
    } else {
        Ok(value)
    }
}
fn error_code<H: Host>(host: &mut H, error: H::Value, code: &str) -> Result<bool, H::Error> {
    if !yes(host, "objectType", vec![error])?
        || yes(host, "nullValue", vec![error])?
        || !yes(host, "ownCode", vec![error])?
    {
        return Ok(false);
    }
    let value = host.get(error, "code")?;
    host.is_kind(value, code)
}
fn visit_children<H: Host>(
    host: &mut H,
    group: H::Value,
    operation: &str,
    state: H::Value,
) -> Result<H::Value, H::Error> {
    let operation = host.call(&format!("literal:{operation}"), vec![])?;
    host.call("visitChildren", vec![group, operation, state])
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("configSymbol", [symbol]) => {
            let description = host.get(*symbol, "description")?;
            boolean(host, host.is_kind(description, "toolcraft.group.config")?)
        }
        ("proxySymbol", [node, symbol]) => {
            let description = host.get(*symbol, "description")?;
            if !host.is_kind(description, "toolcraft.mcpProxyNode")? {
                return boolean(host, false);
            }
            let value = host.call("reflect", vec![*node, *symbol])?;
            boolean(host, host.is_true(value)?)
        }
        ("groups", [root]) | ("hasGroups", [root]) => {
            let groups = host.call("collectState", vec![])?;
            host.call("collect", vec![*root, groups])?;
            if operation == "groups" {
                Ok(groups)
            } else {
                host.call("nonEmpty", vec![groups])
            }
        }
        ("collect", [group, groups]) => {
            let config = internal(host, *group)?;
            let mcp = host.get(config, "mcp")?;
            if !host.is_undefined(mcp)? {
                host.call("push", vec![*groups, *group])?;
            }
            visit_children(host, *group, "collectChild", *groups)
        }
        ("collectChild", [child, groups])
        | ("snapshotChild", [child, groups])
        | ("removeChild", [child, groups]) => {
            let kind = host.get(*child, "kind")?;
            if !host.is_kind(kind, "group")? {
                return host.call("undefined", vec![]);
            }
            host.call(
                match operation {
                    "collectChild" => "collect",
                    "snapshotChild" => "snapshotGroup",
                    _ => "remove",
                },
                vec![*child, *groups],
            )
        }
        ("refresh", [value]) => {
            let trimmed = if host.is_nullish(*value)? {
                host.call("undefined", vec![])?
            } else {
                host.call("trim", vec![*value])?
            };
            if host.is_undefined(trimmed)? || yes(host, "empty", vec![trimmed])? {
                return host.call("undefined", vec![]);
            }
            if host.is_kind(trimmed, "1")? || host.is_kind(trimmed, "true")? {
                return host.call("literal:all", vec![]);
            }
            let names = host.call("refreshNames", vec![trimmed])?;
            if yes(host, "empty", vec![names])? {
                host.call("undefined", vec![])
            } else {
                host.call("set", vec![names])
            }
        }
        ("refreshRequested", [name, refresh]) => {
            if host.is_kind(*refresh, "all")? {
                return boolean(host, true);
            }
            if host.is_nullish(*refresh)? {
                return boolean(host, false);
            }
            let result = host.call("has", vec![*refresh, *name])?;
            boolean(host, host.is_true(result)?)
        }
        ("cachePath", [name, root]) => {
            let root = if host.is_nullish(*root)? {
                host.call("root", vec![])?
            } else {
                *root
            };
            if host.is_undefined(root)? {
                return host.call("missingRoot", vec![]);
            }
            if yes(host, "empty", vec![*name])?
                || host.is_kind(*name, ".")?
                || host.is_kind(*name, "..")?
                || yes(host, "fileUnsafe", vec![*name])?
            {
                return host.call("unsafeName", vec![*name]);
            }
            host.call("cachePath", vec![root, *name])
        }
        ("checkStat", [stat, path]) => {
            if yes(host, "symlink", vec![*stat])? {
                host.call("symlinkError", vec![*path])?;
            }
            host.call("undefined", vec![])
        }
        ("parentPath", [path]) => {
            let base = host.call("basename", vec![*path])?;
            if host.is_kind(base, ".toolcraft")? {
                return host.call("undefined", vec![]);
            }
            let parent = host.call("dirname", vec![*path])?;
            if host.same(parent, *path)? {
                host.call("undefined", vec![])
            } else {
                Ok(parent)
            }
        }
        ("missingFile", [error]) => {
            let missing = error_code(host, *error, "ENOENT")?;
            boolean(host, missing)
        }
        ("ignoreReadError", [error]) => {
            if !error_code(host, *error, "ENOENT")? {
                host.call("syntaxError", vec![*error])?;
            }
            host.call("undefined", vec![])
        }
        ("cleanupTemp", [created, error]) => {
            let cleanup =
                yes(host, "truthy", vec![*created])? || !error_code(host, *error, "EEXIST")?;
            boolean(host, cleanup)
        }
        ("readCache", [parsed]) => {
            if yes(host, "nullValue", vec![*parsed])? || !yes(host, "objectType", vec![*parsed])? {
                return host.call("undefined", vec![]);
            }
            let tools = host.get(*parsed, "tools")?;
            if !yes(host, "array", vec![tools])? {
                return host.call("undefined", vec![]);
            }
            let upstream = host.get(*parsed, "upstream")?;
            if host.is_undefined(upstream)? {
                return host.call("undefined", vec![]);
            }
            for key in ["name", "version"] {
                let upstream = host.get(*parsed, "upstream")?;
                let field = host.get(upstream, key)?;
                if !yes(host, "string", vec![field])? {
                    return host.call("undefined", vec![]);
                }
            }
            let result = host.call("record", vec![])?;
            for (key, fallback) in [("$schema", "schemaUrl"), ("fetchedAt", "epoch")] {
                let field = host.get(*parsed, key)?;
                let field = if yes(host, "string", vec![field])? {
                    host.get(*parsed, key)?
                } else {
                    host.call(fallback, vec![])?
                };
                set(host, result, key, field)?;
            }
            for key in ["tools", "upstream"] {
                copy(host, result, *parsed, key)?;
            }
            let fingerprint = host.get(*parsed, "configFingerprint")?;
            let fingerprint = if yes(host, "string", vec![fingerprint])? {
                host.get(*parsed, "configFingerprint")?
            } else {
                host.call("undefined", vec![])?
            };
            set(host, result, "configFingerprint", fingerprint)?;
            host.get(*parsed, "version")?;
            let version = host.call("one", vec![])?;
            set(host, result, "version", version)?;
            Ok(result)
        }
        ("matches", [cache, config]) => {
            if !yes(host, "truthy", vec![*cache])? {
                return boolean(host, false);
            }
            let cached = host.get(*cache, "configFingerprint")?;
            let expected = host.call("fingerprint", vec![*config])?;
            boolean(host, host.same(cached, expected)?)
        }
        ("start", [group]) => {
            let internal = internal(host, *group)?;
            let config = host.get(internal, "mcp")?;
            if host.is_undefined(config)? {
                return host.call("undefined", vec![]);
            }
            let name = host.get(*group, "name")?;
            host.call("cacheState", vec![internal, config, name])
        }
        ("prepare", [group, cache, internal, name, config]) => {
            let tools = host.get(*cache, "tools")?;
            let allowlist = host.get(*internal, "tools")?;
            let tools = if host.is_undefined(allowlist)? {
                tools
            } else {
                let names = host.call("set", vec![allowlist])?;
                host.call("allowed", vec![tools, names])?
            };
            let rename = host.get(*internal, "rename")?;
            if !host.is_undefined(rename)? {
                let names = host.call("toolNames", vec![tools])?;
                host.call("checkRenames", vec![*name, names, rename])?;
            }
            let previous = host.call("connection", vec![*group])?;
            let connection = host.call("createConnection", vec![*name, *config])?;
            let snapshot = host.call("map", vec![])?;
            host.call("snapshotGroup", vec![*group, snapshot])?;
            host.call("replacement", vec![tools, previous, connection, snapshot])
        }
        ("renameKey", [name, names, key]) => {
            if !yes(host, "has", vec![*names, *key])? {
                host.call("unknownRename", vec![*name, *key])?;
            }
            host.call("undefined", vec![])
        }
        ("snapshotGroup", [group, snapshot]) => {
            host.call("snapshot", vec![*snapshot, *group])?;
            visit_children(host, *group, "snapshotChild", *snapshot)
        }
        ("remove", [group, state]) => {
            let children = host.call("filteredChildren", vec![*group])?;
            host.call("set:children", vec![*group, children])?;
            visit_children(host, *group, "removeChild", *state)
        }
        ("populateGroup", [group, tools, rename, connection]) => {
            let state = host.call("undefined", vec![])?;
            host.call("remove", vec![*group, state])?;
            host.call("populate", vec![*group, *tools, *rename, *connection])
        }
        ("place", [group, tool, rename, connection]) => {
            let mut target = if host.is_nullish(*rename)? {
                host.call("undefined", vec![])?
            } else {
                let name = host.get(*tool, "name")?;
                host.call("property", vec![*rename, name])?
            };
            if host.is_nullish(target)? {
                target = host.get(*tool, "name")?;
            }
            let renamed = if host.is_undefined(*rename)? {
                false
            } else {
                let name = host.get(*tool, "name")?;
                yes(host, "own", vec![*rename, name])?
            };
            let segments = if renamed {
                host.call("splitPath", vec![target])?
            } else {
                let name = host.get(*tool, "name")?;
                host.call("singleton", vec![name])?
            };
            let command = host.call("last", vec![segments])?;
            if host.is_undefined(command)? || yes(host, "empty", vec![command])? {
                return host.call("collision", vec![target]);
            }
            let parent = host.call("placeParents", vec![*group, segments, target])?;
            let existing = host.call("findChild", vec![parent, command])?;
            if !host.is_undefined(existing)? {
                return host.call("collision", vec![target]);
            }
            host.call("appendCommand", vec![parent, *tool, command, *connection])
        }
        ("parent", [parent, segment, target]) => {
            let existing = host.call("findChild", vec![*parent, *segment])?;
            if host.is_undefined(existing)? {
                let created = host.call("group", vec![*parent, *segment])?;
                host.call("appendChild", vec![*parent, created])?;
                return Ok(created);
            }
            let kind = host.get(existing, "kind")?;
            if !host.is_kind(kind, "group")? {
                return host.call("collision", vec![*target]);
            }
            Ok(existing)
        }
        ("group", [parent, name]) => {
            let output = host.call("record", vec![])?;
            let kind = host.call("literal:group", vec![])?;
            set(host, output, "kind", kind)?;
            set(host, output, "name", *name)?;
            let value = host.call("undefined", vec![])?;
            set(host, output, "description", value)?;
            let aliases = host.call("list", vec![])?;
            set(host, output, "aliases", aliases)?;
            let scope = host.get(*parent, "scope")?;
            let scope = host.call("cloneScope", vec![scope])?;
            set(host, output, "scope", scope)?;
            let secrets = host.get(*parent, "secrets")?;
            let secrets = host.call("clone", vec![secrets])?;
            set(host, output, "secrets", secrets)?;
            copy(host, output, *parent, "requires")?;
            let children = host.call("list", vec![])?;
            set(host, output, "children", children)?;
            set(host, output, "default", value)?;
            host.call("mark", vec![output])
        }
        ("command", [parent, tool, name, connection]) => {
            let input = host.get(*tool, "inputSchema")?;
            let params = host.call("convert", vec![input])?;
            let kind = host.get(params, "kind")?;
            if !host.is_kind(kind, "object")? {
                return host.call("invalidParams", vec![*tool]);
            }
            let output_schema = host.get(*tool, "outputSchema")?;
            let result = if host.is_undefined(output_schema)? {
                host.call("undefined", vec![])?
            } else {
                let schema = host.get(*tool, "outputSchema")?;
                host.call("convert", vec![schema])?
            };
            let output = host.call("record", vec![])?;
            let kind = host.call("literal:command", vec![])?;
            set(host, output, "kind", kind)?;
            set(host, output, "name", *name)?;
            for key in ["title", "description"] {
                copy(host, output, *tool, key)?;
            }
            let annotations = host.get(*tool, "annotations")?;
            let annotations = if host.is_undefined(annotations)? {
                annotations
            } else {
                let annotations = host.get(*tool, "annotations")?;
                host.call("clone", vec![annotations])?
            };
            set(host, output, "annotations", annotations)?;
            let false_value = boolean(host, false)?;
            set(host, output, "hidden", false_value)?;
            for key in ["examples", "aliases", "positional"] {
                let value = host.call("list", vec![])?;
                set(host, output, key, value)?;
            }
            set(host, output, "params", params)?;
            if !host.is_undefined(result)? {
                set(host, output, "result", result)?;
            }
            let secrets = host.get(*parent, "secrets")?;
            let secrets = host.call("clone", vec![secrets])?;
            set(host, output, "secrets", secrets)?;
            let scope = host.get(*parent, "scope")?;
            let mut scope = host.call("cloneScope", vec![scope])?;
            if host.is_nullish(scope)? {
                scope = host.call("defaultScope", vec![])?;
            }
            set(host, output, "scope", scope)?;
            set(host, output, "confirm", false_value)?;
            copy(host, output, *parent, "requires")?;
            let handler = host.call("commandHandler", vec![*tool, result, *connection])?;
            set(host, output, "handler", handler)?;
            let value = host.call("undefined", vec![])?;
            set(host, output, "render", value)?;
            host.call("mark", vec![output])
        }
        ("toolResult", [tool, schema, result]) => {
            let failed = if host.is_undefined(*schema)? {
                true
            } else {
                let is_error = host.get(*result, "isError")?;
                host.is_true(is_error)?
            };
            if failed {
                return host.call("result", vec![*result]);
            }
            let content = host.get(*result, "structuredContent")?;
            if host.is_undefined(content)? {
                return host.call("missingResult", vec![*tool]);
            }
            let content = host.get(*result, "structuredContent")?;
            let validation = host.call("validate", vec![*schema, content])?;
            let valid = host.get(validation, "ok")?;
            if !yes(host, "truthy", vec![valid])? {
                return host.call("invalidResult", vec![*tool, validation]);
            }
            host.get(*result, "structuredContent")
        }
        ("dispose", [connection]) => {
            let closing = host.get(*connection, "closing")?;
            if !host.is_undefined(closing)? {
                host.get(*connection, "closing")
            } else {
                host.call("closeConnection", vec![*connection])
            }
        }
        ("takeClient", [connection]) => {
            let client = host.get(*connection, "client")?;
            let value = host.call("undefined", vec![])?;
            host.call("set:client", vec![*connection, value])?;
            Ok(client)
        }
        ("isClosing", [connection]) => {
            let closing = host.get(*connection, "closing")?;
            boolean(host, !host.is_undefined(closing)?)
        }
        ("connected", [connection]) => {
            let client = host.get(*connection, "client")?;
            if !host.is_undefined(client)? {
                let client = host.get(*connection, "client")?;
                let state = host.get(client, "state")?;
                if host.is_kind(state, "ready")? {
                    return host.get(*connection, "client");
                }
            }
            let connecting = host.get(*connection, "connecting")?;
            if !host.is_undefined(connecting)? {
                return host.get(*connection, "connecting");
            }
            let name = host.get(*connection, "name")?;
            let config = host.get(*connection, "config")?;
            host.call("connectPending", vec![*connection, name, config])
        }
        ("previous", [replacement]) => {
            let previous = host.get(*replacement, "previous")?;
            let next = host.get(*replacement, "connection")?;
            if !host.is_undefined(previous)? && !host.same(previous, next)? {
                Ok(previous)
            } else {
                host.call("undefined", vec![])
            }
        }
        ("disposeOutcomes", [outcomes]) => {
            let failures = host.call("failures", vec![*outcomes])?;
            if yes(host, "nonEmpty", vec![failures])? {
                host.call("aggregate", vec![failures])?;
            }
            host.call("undefined", vec![])
        }
        ("wrapError", [name, error]) => {
            if yes(host, "error", vec![*error])?
                && yes(host, "wrappedMessage", vec![*name, *error])?
            {
                return Ok(*error);
            }
            host.call("discoveryError", vec![*name, *error])
        }
        ("pageParams", [state]) => {
            let cursor = host.get(*state, "cursor")?;
            host.call(
                if host.is_undefined(cursor)? {
                    "record"
                } else {
                    "cursorParams"
                },
                vec![cursor],
            )
        }
        ("page", [state, page]) => {
            host.call("increment", vec![*state])?;
            host.call("appendTools", vec![*state, *page])?;
            let cursor = host.get(*page, "nextCursor")?;
            set(host, *state, "cursor", cursor)?;
            if !host.is_undefined(cursor)? {
                let seen = host.get(*state, "seen")?;
                if yes(host, "has", vec![seen, cursor])? {
                    return host.call("repeatedCursor", vec![]);
                }
                host.call("add", vec![seen, cursor])?;
                if yes(host, "pageLimit", vec![*state])? {
                    return host.call("paginationLimit", vec![]);
                }
            }
            host.call("undefined", vec![])
        }
        ("morePages", [state]) => {
            let cursor = host.get(*state, "cursor")?;
            boolean(host, !host.is_undefined(cursor)?)
        }
        ("dial", [name, config]) => {
            let client = host.call("client", vec![*name])?;
            let transport = host.get(*config, "transport")?;
            let stdio = host.is_kind(transport, "stdio")?;
            let options = host.call("record", vec![])?;
            copy(
                host,
                options,
                *config,
                if stdio { "command" } else { "url" },
            )?;
            for key in if stdio {
                &["args", "env"][..]
            } else {
                &["headers"][..]
            } {
                let value = host.get(*config, key)?;
                if !host.is_undefined(value)? {
                    copy(host, options, *config, key)?;
                }
            }
            let transport = host.call(if stdio { "stdio" } else { "http" }, vec![options])?;
            host.call("connectionPair", vec![client, transport])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

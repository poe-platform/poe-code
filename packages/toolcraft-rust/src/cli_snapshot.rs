//! Command-tree snapshot admission and ordered metadata construction.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! yes {
        ($value:expr) => {{
            let value = $value;
            let truthy = c!("truthy", value);
            host.is_true(truthy)?
        }};
    }
    match (operation, args) {
        ("snapshot", [roots, options]) => {
            let argv = c!("argv", *options);
            let normalized = run(host, "normalize", &[*roots, argv])?;
            let root = c!("merge", normalized, *options);
            let controls = host.get(*options, "controls")?;
            let controls = c!("controls", controls);
            let presets = host.get(*options, "presets")?;
            let presets = host.call(
                if host.is_true(presets)? {
                    "true"
                } else {
                    "false"
                },
                vec![],
            )?;
            let version = host.get(*options, "version")?;
            let version = host.call(
                if host.is_undefined(version)? {
                    "false"
                } else {
                    "true"
                },
                vec![],
            )?;
            let globals = c!("globals", presets, version, controls);
            let version = host.get(*options, "version")?;
            let version = host.call(
                if host.is_undefined(version)? {
                    "false"
                } else {
                    "true"
                },
                vec![],
            )?;
            let global_options = c!("globalOptions", presets, version, controls);
            let casing = host.get(*options, "casing")?;
            let casing = if host.is_nullish(casing)? {
                host.literal("kebab")?
            } else {
                casing
            };
            let path = c!("list");
            let default = c!("false");
            let root = run(host, "group", &[root, casing, globals, path, default])?;
            host.call("snapshot", vec![global_options, root])
        }
        ("normalize", [roots, argv]) => {
            let array = c!("isArray", *roots);
            if !yes!(array) {
                return Ok(*roots);
            }
            let entrypoint = c!("entrypoint", *argv);
            let string = c!("isString", entrypoint);
            let name = if !host.is_true(string)? {
                host.literal("toolcraft")?
            } else {
                let length = host.get(entrypoint, "length")?;
                let empty = c!("zero", length);
                if host.is_true(empty)? {
                    host.literal("toolcraft")?
                } else {
                    let parsed = c!("parse", entrypoint);
                    let name = host.get(parsed, "name")?;
                    let length = host.get(name, "length")?;
                    let nonempty = c!("positive", length);
                    if host.is_true(nonempty)? {
                        host.get(parsed, "name")?
                    } else {
                        host.literal("toolcraft")?
                    }
                }
            };
            host.call("normalized", vec![name, *roots])
        }
        ("visible", [node, scope]) => {
            let kind = host.get(*node, "kind")?;
            if host.is_kind(kind, "command")? {
                return host.call("scope", vec![*node, *scope]);
            }
            let children = c!("visibleChildren", *node, *scope);
            let length = host.get(children, "length")?;
            let any = c!("positive", length);
            if host.is_true(any)? {
                return host.call("true", vec![]);
            }
            let default = c!("defaultVisible", *node, *scope);
            if yes!(default) {
                return Ok(default);
            }
            let scopes = host.get(*node, "scope")?;
            if host.is_undefined(scopes)? {
                return host.call("true", vec![]);
            }
            host.call("scope", vec![*node, *scope])
        }
        ("defaultScope", [node, scope]) => {
            let default = host.get(*node, "default")?;
            if !yes!(default) {
                return Ok(default);
            }
            host.call("defaultIncludes", vec![*node, *scope])
        }
        ("group", [group, casing, globals, path, default]) => {
            let children = c!("groupChildren", *group, *casing, *globals, *path);
            let name = host.get(*group, "name")?;
            let aliases = c!("groupAliases", *group);
            let description = run(host, "description", &[*group])?;
            host.call(
                "group",
                vec![name, *path, aliases, *default, description, children],
            )
        }
        ("node", [node, casing, globals, path, default]) => {
            let kind = host.get(*node, "kind")?;
            if host.is_kind(kind, "group")? {
                return run(host, "group", args);
            }
            let params = host.get(*node, "params")?;
            let collected = c!("collect", params, *casing, *globals);
            let fields = host.get(collected, "fields")?;
            let positional = host.get(*node, "positional")?;
            let fields = c!("assign", fields, positional);
            c!("validate", fields, *globals);
            let name = host.get(*node, "name")?;
            let aliases = c!("aliases", *node);
            let hidden = host.get(*node, "hidden")?;
            let description = run(host, "description", &[*node])?;
            let options = c!("options", fields, collected, *globals, *casing);
            host.call(
                "command",
                vec![name, *path, aliases, hidden, *default, description, options],
            )
        }
        ("description", [value]) => {
            let description = host.get(*value, "description")?;
            if host.is_undefined(description)? {
                return host.call("empty", vec![]);
            }
            let description = host.get(*value, "description")?;
            host.call("description", vec![description])
        }
        ("default", [field]) => {
            let default = host.get(*field, "hasDefault")?;
            if !yes!(default) {
                return host.call("empty", vec![]);
            }
            let default = host.get(*field, "defaultValue")?;
            host.call("default", vec![default])
        }
        ("field", [field, globals]) => {
            let name = host.get(*field, "displayPath")?;
            let flags = c!("fieldFlags", *field, *globals);
            let schema = host.get(*field, "schema")?;
            let schema_type = c!("schemaType", schema);
            let schema = host.get(*field, "schema")?;
            let kind = host.get(schema, "kind")?;
            let choices = if host.is_kind(kind, "enum")? {
                let schema = host.get(*field, "schema")?;
                c!("choices", schema)
            } else {
                c!("empty")
            };
            let required = host.get(*field, "requiredWhenActive")?;
            let description = run(host, "description", &[*field])?;
            let default = run(host, "default", &[*field])?;
            let positional = host.get(*field, "positionalIndex")?;
            let positional = host.call(
                if host.is_undefined(positional)? {
                    "empty"
                } else {
                    "positional"
                },
                vec![],
            )?;
            let global = host.get(*field, "global")?;
            let global = host.call(
                if host.is_true(global)? {
                    "global"
                } else {
                    "empty"
                },
                vec![],
            )?;
            host.call(
                "field",
                vec![
                    name,
                    flags,
                    schema_type,
                    choices,
                    required,
                    description,
                    default,
                    positional,
                    global,
                ],
            )
        }
        ("dynamic", [field, casing]) => host.call("dynamic", vec![*field, *casing]),
        ("dynamicRow", [field, row]) => {
            let name = host.get(*field, "displayPath")?;
            let flags = c!("dynamicFlags", *row);
            let schema_type = c!("dynamicType", *field);
            let required = host.get(*field, "requiredWhenActive")?;
            let description = run(host, "description", &[*field])?;
            let default = run(host, "default", &[*field])?;
            host.call(
                "dynamicRow",
                vec![name, flags, schema_type, required, description, default],
            )
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

//! Commander tree construction, lazy field wiring and parser policy.
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
        (
            "create",
            [
                node,
                casing,
                globals,
                execute,
                presets,
                controls,
                loaders,
                path,
            ],
        ) => {
            let path = c!("path", *path, *node);
            let kind = host.get(*node, "kind")?;
            if host.is_kind(kind, "command")? {
                if !yes!(c!("scope", *node)) {
                    return host.call("null", vec![]);
                }
                let command = c!("command", *node);
                let state = c!(
                    "state", *node, *casing, *globals, *execute, *presets, *controls, *loaders,
                    path, command
                );
                c!("hidden", command, *node);
                c!("original", command, *node);
                let description = host.get(*node, "description")?;
                if !host.is_undefined(description)? {
                    c!("description", command, *node);
                }
                c!("aliases", command, *node);
                c!("noHelp", command);
                run(host, "globals", &[command, *presets, *controls])?;
                c!("excess", command);
                c!("loader", state);
                return Ok(command);
            }
            if !yes!(c!("visible", *node)) {
                return host.call("null", vec![]);
            }
            let reserved = c!("reserved", *node);
            let children = c!(
                "children", *node, *casing, *globals, *execute, *presets, *controls, *loaders, path
            );
            let group = c!("command", *node);
            c!("reserve", group, reserved);
            let description = host.get(*node, "description")?;
            if !host.is_undefined(description)? {
                c!("description", group, *node);
            }
            c!("aliases", group, *node);
            c!("noHelp", group);
            run(host, "globals", &[group, *presets, *controls])?;
            let names = c!("childNames", children);
            c!("childrenEach", *node, group, children, names);
            Ok(group)
        }
        ("load", [state]) => {
            let loaded = host.get(*state, "loadedFields")?;
            if !host.is_undefined(loaded)? {
                return Ok(loaded);
            }
            let collected = c!("collect", *state);
            let node = host.get(*state, "node")?;
            let fields = c!("assign", collected, node);
            let globals = host.get(*state, "globals")?;
            c!("validate", fields, globals);
            if yes!(c!("hasDynamic", collected)) {
                let command = host.get(*state, "command")?;
                c!("unknown", command);
            }
            let numeric = c!("set");
            c!("fields", *state, fields, numeric);
            c!("parser", *state, numeric);
            c!("action", *state, collected, fields);
            host.call("loaded", vec![*state, collected])
        }
        ("field", [state, field, numeric]) => {
            let position = host.get(*field, "positionalIndex")?;
            if !host.is_undefined(position)? {
                let command = host.get(*state, "command")?;
                c!("argument", command, *field);
            } else {
                c!("options", *state, *field, *numeric);
            }
            host.call("undefined", vec![])
        }
        ("positional", [field]) => {
            let variadic = host.get(*field, "variadicPosition")?;
            host.call(
                if host.is_true(variadic)? {
                    "variadic"
                } else {
                    "positional"
                },
                vec![*field],
            )
        }
        ("numeric", [field, numeric, option]) => {
            let schema = host.get(*field, "schema")?;
            let kind = host.get(schema, "kind")?;
            if host.is_kind(kind, "array")? {
                let item = c!("unwrap", *field);
                let kind = host.get(item, "kind")?;
                if host.is_kind(kind, "number")? {
                    c!("addNumeric", *numeric, *option);
                }
            }
            host.call("undefined", vec![])
        }
        ("parsed", [state, parsed]) => {
            let first = c!("firstUnknown", *parsed);
            let count = if yes!(c!("negative", first)) {
                c!("unknownLength", *parsed)
            } else {
                first
            };
            c!("operands", *parsed, count);
            let first = c!("first", *parsed);
            if host.is_kind(first, "--")? {
                c!("tail", *parsed);
                c!("clear", *parsed);
            }
            c!("keepUnknown", *state, *parsed);
            Ok(*parsed)
        }
        ("child", [node, group, child, names]) => {
            let default = host.get(*node, "default")?;
            let is_default = !host.is_undefined(default)?
                && yes!(c!("defaultScope", *node))
                && (yes!(c!("defaultName", *child, *node))
                    || yes!(c!("defaultAlias", *child, *node)));
            let default = c!(if is_default { "true" } else { "undefined" });
            run(host, "add", &[*group, *child, default, *names])
        }
        ("add", [parent, child, default, siblings]) => {
            if yes!(*default)
                && (yes!(c!("emptyName", *child)) || yes!(c!("hiddenCommander", *child)))
            {
                let mut name = host.literal("__toolcraft_default__")?;
                let mut suffix = c!("two");
                while yes!(c!("hasName", *siblings, name)) {
                    name = c!("internalName", suffix);
                    suffix = c!("increment", suffix);
                }
                c!("rename", *child, name);
                c!("hiddenNames", *parent, *child);
                c!("addHidden", *parent, *child);
            } else {
                let mut options = if yes!(*default) {
                    c!("defaultOptions")
                } else {
                    c!("emptyOptions")
                };
                if yes!(c!("hiddenCommander", *child)) {
                    options = c!("hiddenOptions", options);
                }
                c!("add", *parent, *child, options);
            }
            host.call("undefined", vec![])
        }
        ("hidden", [command]) => host.call("hiddenCommander", vec![*command]),
        ("hiddenNames" | "reservedNames", [command]) => {
            let key = host.literal(if operation == "hiddenNames" {
                "_toolcraftHiddenDefaultNames"
            } else {
                "_toolcraftReservedChildNames"
            })?;
            let value = c!("reflected", *command, key);
            if yes!(c!("isArray", value)) {
                host.call("strings", vec![value])
            } else {
                host.call("list", vec![])
            }
        }
        ("names", [node]) => host.call("names", vec![*node]),
        ("globals", [command, presets, controls]) => {
            let options = c!("list");
            if yes!(*presets) {
                c!("presetOption", options);
            }
            let yes = host.get(*controls, "yes")?;
            if yes!(yes) {
                c!("yesOption", options);
            }
            let output = host.get(*controls, "output")?;
            if yes!(output) {
                let choices = c!("formats", *controls);
                c!("outputOption", options, choices, *controls);
            }
            let debug = host.get(*controls, "debug")?;
            if yes!(debug) {
                c!("debugOption", options);
            }
            let log = host.get(*controls, "logLevel")?;
            if yes!(log) {
                c!("logOption", options);
            }
            let verbose = host.get(*controls, "verbose")?;
            if yes!(verbose) {
                c!("verboseOption", options);
            }
            c!("install", *command, options);
            host.call("undefined", vec![])
        }
        ("output", [value, controls, choices]) => {
            if host.is_kind(*value, "rich")?
                || host.is_kind(*value, "md")?
                || host.is_kind(*value, "json")?
            {
                return Ok(*value);
            }
            if host.is_kind(*value, "markdown")? {
                return host.literal("md");
            }
            if yes!(c!("hasFormat", *controls, *value)) {
                return Ok(*value);
            }
            host.call("invalidOutput", vec![*value, *controls, *choices])
        }
        ("debug", [value]) => {
            if host.is_true(*value)? || host.is_kind(*value, "trim")? {
                return host.literal("trim");
            }
            if host.is_kind(*value, "raw")? {
                return host.literal("raw");
            }
            host.call("invalidDebug", vec![*value])
        }
        ("logLevel", [value]) => {
            if yes!(c!("validLevel", *value)) {
                Ok(*value)
            } else {
                host.call("invalidLevel", vec![*value])
            }
        }
        ("enumMessage", [label, value, values, opts]) => {
            let suggestions = c!("suggestions", *value, *values, *opts);
            let line = if yes!(c!("hasSuggestions", suggestions)) {
                c!("suggestionLine", suggestions)
            } else {
                host.literal(" ")?
            };
            host.call("enumMessage", vec![*label, *value, *values, line])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

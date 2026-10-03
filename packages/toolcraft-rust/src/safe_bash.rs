//! Safe Bash registration, schema admission and invocation policy.
use crate::host::TextHost;

#[derive(Default)]
pub struct OutputBudget {
    pending: f64,
}

impl OutputBudget {
    pub fn enqueue(&mut self, amount: f64) -> bool {
        self.pending += amount;
        // Match JavaScript Number comparison, including unordered values.
        self.pending.partial_cmp(&1_048_576.0) != Some(std::cmp::Ordering::Greater)
    }

    pub fn complete(&mut self, amount: f64) {
        self.pending -= amount;
    }
}

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
        ("defaults", [defaults]) => host.call("clone", vec![*defaults]),
        ("roots", [library]) => {
            if yes!(c!("isArray", *library)) {
                Ok(*library)
            } else {
                host.call("singleton", vec![*library])
            }
        }
        ("rootVisible", [root]) => {
            let scope = host.get(*root, "scope")?;
            let visible = !yes!(scope) || yes!(c!("cliScope", *root));
            host.call(if visible { "true" } else { "false" }, vec![])
        }
        ("nodeVisible", [node]) => {
            let kind = host.get(*node, "kind")?;
            if host.is_kind(kind, "command")? {
                let visible = yes!(c!("cliScope", *node)) && !yes!(host.get(*node, "hidden")?);
                host.call(if visible { "true" } else { "false" }, vec![])
            } else {
                run(host, "rootVisible", &[*node])
            }
        }
        ("discover", [root, prefix]) => {
            let commands = c!("map");
            if yes!(run(host, "rootVisible", &[*root])?) {
                c!("rootChildren", *root, *prefix, commands);
            }
            Ok(commands)
        }
        ("discoverRoot", [root, multiple]) => {
            let prefix = if yes!(*multiple) {
                c!("rootPrefix", *root)
            } else {
                c!("emptyPrefix")
            };
            run(host, "discover", &[*root, prefix])
        }
        ("visit", [node, path, commands]) => {
            let kind = host.get(*node, "kind")?;
            if host.is_kind(kind, "command")? {
                if yes!(c!("cliScope", *node)) && !yes!(host.get(*node, "hidden")?) {
                    c!("setCommand", *commands, *path, *node);
                }
            } else if yes!(run(host, "rootVisible", &[*node])?) {
                c!("childCommands", *node, *path, *commands);
            }
            host.call("undefined", vec![])
        }
        ("aliases", [node]) => {
            let name = c!("kebabName", *node);
            let original = host.get(*node, "name")?;
            let existing = host.same(name, original)? || yes!(c!("hasAlias", *node, name));
            host.call(
                if existing { "copyAliases" } else { "addAlias" },
                vec![*node, name],
            )
        }
        ("visible", [root]) => {
            let children = c!("visibleChildren", *root);
            let default = c!("defaultChild", children, *root);
            // Spreading the root precedes reads needed for alias calculation.
            let copy = c!("spread", *root);
            let aliases = run(host, "aliases", &[*root])?;
            host.call("projectRoot", vec![copy, aliases, children, default])
        }
        ("visibleChild", [child]) => {
            let kind = host.get(*child, "kind")?;
            if host.is_kind(kind, "group")? {
                run(host, "visible", &[*child])
            } else {
                let copy = c!("spread", *child);
                let aliases = run(host, "aliases", &[*child])?;
                host.call("projectChild", vec![copy, aliases])
            }
        }
        ("defaultChild", [child, root]) => {
            let kind = host.get(*child, "kind")?;
            let matches = host.is_kind(kind, "command")? && yes!(c!("defaultName", *child, *root));
            host.call(if matches { "true" } else { "false" }, vec![])
        }
        ("schema", [schema, path]) => {
            if !yes!(c!("schemaObject", *schema)) {
                return host.call("undefined", vec![]);
            }
            let pattern = host.get(*schema, "pattern")?;
            if !host.is_undefined(pattern)? || {
                let value = host.get(*schema, "patternProperties")?;
                !host.is_undefined(value)?
            } {
                return host.call("regexError", vec![*path]);
            }
            for key in [
                "properties",
                "$defs",
                "definitions",
                "dependentSchemas",
                "dependencies",
            ] {
                let map = host.get(*schema, key)?;
                if yes!(c!("schemaObject", map)) {
                    c!("schemaValues", map, *path);
                }
            }
            for key in [
                "allOf",
                "anyOf",
                "oneOf",
                "prefixItems",
                "items",
                "additionalItems",
                "additionalProperties",
                "contains",
                "if",
                "then",
                "else",
                "not",
                "propertyNames",
                "unevaluatedItems",
                "unevaluatedProperties",
            ] {
                let child = host.get(*schema, key)?;
                if yes!(c!("isArray", child)) {
                    c!("schemaItems", child, *path);
                } else {
                    // Re-enter through the host's bounded callback frame.
                    c!("schemaChild", child, *path);
                }
            }
            host.call("undefined", vec![])
        }
        ("commandSchema", [path, command]) => {
            let schema = c!("paramsJson", *command);
            run(host, "schema", &[schema, *path])?;
            let stream = host.get(*command, "stream")?;
            if yes!(stream) {
                let schema = c!("eventJson", *command);
                run(host, "schema", &[schema, *path])?;
            }
            host.call("undefined", vec![])
        }
        ("create", [library, options]) => {
            let normalized = run(host, "roots", &[*library])?;
            let roots = c!("filterRoots", normalized);
            let multiple = c!("isArray", *library);
            let commands = c!("commands", roots, multiple);
            c!("schemas", commands);
            let defaults = c!("configuredDefaults", *options);
            c!("validateDefaults", defaults, commands);
            let services = host.get(*options, "services")?;
            if yes!(services) {
                let services = host.get(*options, "services")?;
                if !yes!(c!("isFunction", services)) {
                    c!("validateServices", *options);
                }
            }
            host.call("executor", vec![roots, multiple, defaults, *options])
        }
        ("defaultCommand", [path, values, commands]) => {
            let command = c!("commandAt", *commands, *path);
            if !yes!(command) {
                return host.call("unknownDefault", vec![*path]);
            }
            host.call("defaultValues", vec![*path, *values, command])
        }
        ("defaultValue", [path, key, value, command]) => {
            if !yes!(c!("ownsParam", *command, *key)) {
                return host.call("unknownParam", vec![*path, *key]);
            }
            let result = c!("validateParam", *command, *key, *value);
            let ok = host.get(result, "ok")?;
            if !yes!(ok) {
                return host.call("invalidParam", vec![*path, *key, result]);
            }
            host.call("undefined", vec![])
        }
        ("select", [roots, multiple, options, argv, invocation]) => {
            let services = host.get(*options, "services")?;
            let configured = if yes!(c!("isFunction", services)) {
                c!("servicesFactory", *options, *invocation)
            } else {
                host.get(*options, "services")?
            };
            let services = c!("mergeServices", configured, *invocation);
            let (name, root) = if yes!(*multiple) {
                let name = c!("first", *argv);
                (name, c!("findRoot", *roots, name))
            } else {
                let name = c!("firstRootName", *roots);
                (name, c!("first", *roots))
            };
            if !yes!(root) {
                return host.call("unknownRoot", vec![name]);
            }
            host.call("selection", vec![services, root])
        }
        ("matchesRoot", [candidate, name]) => {
            let original = host.get(*candidate, "name")?;
            let matches = host.same(original, *name)?
                || {
                    let value = c!("kebabName", *candidate);
                    host.same(value, *name)?
                }
                || yes!(c!("hasRootAlias", *candidate, *name));
            host.call(if matches { "true" } else { "false" }, vec![])
        }
        ("humanInLoop", [invocation, options]) => {
            let object = if yes!(c!("ownsHuman", *invocation)) {
                *invocation
            } else {
                *options
            };
            host.get(object, "humanInLoop")
        }
        ("args", [multiple, argv]) => {
            if yes!(*multiple) {
                host.call("tail", vec![*argv])
            } else {
                Ok(*argv)
            }
        }
        ("invocationDefaults", [multiple, defaults, root]) => {
            if yes!(*multiple) {
                host.call("rootDefaults", vec![*defaults, *root])
            } else {
                Ok(*defaults)
            }
        }
        ("commandArgs", [library, root, context]) => {
            if yes!(c!("isArray", *library)) {
                host.call("prefixedArgs", vec![*root, *context])
            } else {
                host.call("contextArgs", vec![*context])
            }
        }
        ("write", [fs, target, bytes, options, signal, flag]) => {
            if host.is_kind(*flag, "a")? {
                host.call("appendFile", vec![*fs, *target, *bytes, *options, *signal])
            } else if host.is_kind(*flag, "w")? || host.is_kind(*flag, "wx")? {
                host.call(
                    "writeFile",
                    vec![*fs, *target, *bytes, *options, *signal, *flag],
                )
            } else {
                host.call("writeFlagError", vec![*flag])
            }
        }
        ("existsError", [error]) => {
            if yes!(c!("object", *error)) && yes!(c!("hasCode", *error)) {
                let code = host.get(*error, "code")?;
                if host.is_kind(code, "ENOENT")? {
                    return host.call("false", vec![]);
                }
            }
            host.call("throw", vec![*error])
        }
        ("unlink", [fs]) => {
            if !yes!(host.get(*fs, "unlink")?) {
                return host.call("unlinkError", vec![]);
            }
            host.call("undefined", vec![])
        }
        ("plugin", [library, options]) => {
            let executor = run(host, "create", &[*library, *options])?;
            let roots = run(host, "roots", &[*library])?;
            host.call("plugin", vec![*library, executor, roots])
        }
        ("setup", [library, executor, roots, shell]) => {
            let provide = host.get(*shell, "provideCapabilities")?;
            if !yes!(c!("isFunction", provide)) {
                return host.call("capabilityError", vec![]);
            }
            host.call("registerRoots", vec![*library, *executor, *roots, *shell])
        }
        ("registerRoot", [library, executor, root, shell]) => {
            if yes!(run(host, "rootVisible", &[*root])?) {
                c!("registerNames", *library, *executor, *root, *shell);
            }
            host.call("undefined", vec![])
        }
        ("capabilities", [context, capabilities]) => {
            let invocation = c!("contextCapabilities", *context, *capabilities);
            let object = if host.is_nullish(*capabilities)? {
                c!("empty")
            } else {
                *capabilities
            };
            if yes!(c!("ownsHuman", object)) {
                return host.call("capabilityHuman", vec![invocation, *capabilities]);
            }
            Ok(invocation)
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

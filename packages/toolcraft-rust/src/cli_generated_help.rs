//! Generated CLI help policy composed with native field and design capabilities.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! r { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];run(host,$name,&args)?}}; }
    macro_rules! g {
        ($value:expr,$key:expr) => {{
            let value = $value;
            host.get(value, $key)?
        }};
    }
    macro_rules! yes {
        ($value:expr) => {{
            let value = $value;
            let result = c!("truthy", value);
            host.is_true(result)?
        }};
    }
    macro_rules! is {
        ($value:expr,$kind:expr) => {{
            let value = $value;
            host.is_kind(value, $kind)?
        }};
    }
    macro_rules! undef {
        ($value:expr) => {{
            let value = $value;
            host.is_undefined(value)?
        }};
    }
    macro_rules! strict {
        ($value:expr) => {{
            let value = $value;
            host.is_true(value)?
        }};
    }
    macro_rules! literal {
        ($value:expr) => {
            host.literal($value)?
        };
    }
    macro_rules! keep {
        ($state:expr,$key:expr,$value:expr) => {{
            let value = $value;
            let key = literal!($key);
            c!("keep", $state, key, value);
        }};
    }
    macro_rules! flags {
        ($globals:expr) => {{
            let globals = $globals;
            let preset = g!(globals, "presetsEnabled");
            let version = g!(globals, "showVersion");
            let controls = g!(globals, "controls");
            c!("globalFlags", preset, version, controls)
        }};
    }
    match (operation, args) {
        ("output", [argv]) => {
            let mut index = c!("zero");
            while yes!(c!("more", *argv, index)) {
                let token = c!("token", *argv, index);
                let value = if is!(token, "--output") {
                    let next = c!("next", index);
                    c!("at", *argv, next)
                } else if yes!(c!("startsOutput", token)) {
                    c!("outputValue", token)
                } else {
                    c!("undefined")
                };
                if is!(value, "rich") || is!(value, "md") || is!(value, "json") {
                    return Ok(value);
                }
                if is!(value, "markdown") {
                    return host.literal("md");
                }
                index = c!("next", index);
            }
            host.literal("rich")
        }
        ("helpChild", [child]) => {
            if is!(g!(*child, "kind"), "command") && strict!(g!(*child, "hidden")) {
                host.call("false", vec![])
            } else {
                host.call("true", vec![])
            }
        }
        ("target", _) => host.call("target", args.to_vec()),
        ("targetToken", [current, token, scope, usage, breadcrumb]) => {
            if yes!(c!("startsFlag", *token))
                || is!(*token, "help")
                || !is!(g!(*current, "kind"), "group")
            {
                return host.call("stop", vec![]);
            }
            let child = c!("findChild", *current, *token, *scope);
            if host.is_undefined(child)? {
                let suggestions = c!("suggestions", *current, *token, *scope);
                let path = c!("commandPath", *breadcrumb);
                let target = if yes!(c!("empty", path)) {
                    *usage
                } else {
                    c!("helpTarget", *usage, path)
                };
                let message = c!("unknown", *token, suggestions, target);
                return host.call("userError", vec![message]);
            }
            host.call("child", vec![child])
        }
        ("suggestions", [values]) => {
            if yes!(c!("empty", *values)) {
                host.literal("")
            } else {
                host.call("suggestionsText", vec![*values])
            }
        }
        ("secretDescription", [secret]) => {
            if !undef!(g!(*secret, "description"))
                && yes!(c!("nonempty", g!(*secret, "description")))
            {
                return host.get(*secret, "description");
            }
            let optional = strict!(g!(*secret, "optional"));
            host.literal(if optional {
                "Optional secret"
            } else {
                "Required secret"
            })
        }
        ("exampleValue", [value]) => {
            if yes!(c!("isString", *value))
                && yes!(c!("nonempty", *value))
                && !yes!(c!("includesSpace", *value))
            {
                Ok(*value)
            } else {
                host.call("json", vec![*value])
            }
        }
        ("exampleFlag", [key, value]) => {
            let flag = c!("flag", *key);
            if yes!(c!("isBoolean", *value)) {
                if yes!(*value) {
                    Ok(flag)
                } else {
                    host.call("negativeFlag", vec![*key])
                }
            } else {
                let value = r!("exampleValue", *value);
                host.call("flagValue", vec![flag, value])
            }
        }
        ("exampleCommand", [breadcrumb, usage, params]) => {
            let empty = literal!("");
            let command = r!("usage", *breadcrumb, *usage, empty);
            let flags = c!("exampleFlags", *params);
            host.call("exampleCommand", vec![command, flags])
        }
        ("parameterToken", [value, optional]) => {
            let text = if yes!(*optional) {
                c!("bracket", *value)
            } else {
                *value
            };
            let tokens = c!("tokenize", *value);
            let tokens = if yes!(*optional) {
                c!("wrap", tokens)
            } else {
                tokens
            };
            host.call("parameterToken", vec![text, *optional, tokens])
        }
        ("dynamicTokens", [field, casing]) => {
            let optional = g!(*field, "optional");
            let optional = if yes!(optional) {
                optional
            } else {
                g!(*field, "hasDefault")
            };
            host.call("dynamicTokens", vec![*field, *casing, optional])
        }
        ("fieldParameter", [field, globals]) => {
            let text = c!("parameterFlags", *field, *globals);
            let optional = if undef!(g!(*field, "positionalIndex")) {
                let optional = g!(*field, "optional");
                if yes!(optional) {
                    optional
                } else {
                    g!(*field, "hasDefault")
                }
            } else {
                c!("false")
            };
            Ok(r!("parameterToken", text, optional))
        }
        ("parameters", [command, casing, globals]) => {
            let collected = c!("collect", g!(*command, "params"), *casing, *globals);
            let fields = c!(
                "assign",
                g!(collected, "fields"),
                g!(*command, "positional")
            );
            let scalar = c!("parameterFields", fields, *globals);
            let dynamic = c!("dynamicParameters", collected, *casing);
            host.call("concat", vec![scalar, dynamic])
        }
        ("collapse", [tokens, budget]) => {
            let count = c!("optionalCount", *tokens);
            if yes!(c!("zeroValue", count)) {
                return Ok(*tokens);
            }
            let width = c!("inlineWidth", *tokens);
            if yes!(c!("countFits", count)) && yes!(c!("widthFits", width, *budget)) {
                return Ok(*tokens);
            }
            let required = c!("requiredParameters", *tokens);
            let text = c!("collapsedText", count);
            host.call("collapsed", vec![required, text])
        }
        ("rowName", [node, casing, globals]) => {
            let base = if yes!(c!("empty", g!(*node, "aliases"))) {
                g!(*node, "name")
            } else {
                c!("aliasName", *node)
            };
            let tokens = c!("nameTokens", base);
            let budget = c!("inlineBudget", base);
            let parameters = if is!(g!(*node, "kind"), "command") {
                let values = r!("parameters", *node, *casing, *globals);
                r!("collapse", values, budget)
            } else {
                c!("list")
            };
            c!("appendTokens", tokens, parameters);
            let name = if yes!(c!("empty", parameters)) {
                base
            } else {
                c!("parameterName", base, parameters)
            };
            host.call("nameResult", vec![name, tokens])
        }
        ("normalizeCharacter", [text, character]) => {
            for skip in [" ", "\t", "\n", "\r", "_", ".", "-"] {
                if host.is_kind(*character, skip)? {
                    return Ok(*text);
                }
            }
            host.call("append", vec![*text, *character])
        }
        ("description", [description, name]) => {
            if yes!(c!("nonempty", *description)) {
                let left = c!("normalizeDescription", *description);
                let right = c!("normalizeDescription", *name);
                if host.same(left, right)? {
                    return host.literal("");
                }
            }
            Ok(*description)
        }
        ("commandRow", [child, casing, globals, depth]) => {
            let name = r!("rowName", *child, *casing, *globals);
            let text = g!(name, "name");
            let tokens = g!(name, "nameTokens");
            let description = r!("description", c!("description", *child), g!(*child, "name"));
            let kind = g!(*child, "kind");
            host.call("rowResult", vec![text, tokens, description, kind, *depth])
        }
        ("commandRows", [group, scope, casing, globals, help]) => {
            if is!(*help, "concise") {
                return host.call("conciseRows", vec![*group, *scope, *casing, *globals]);
            }
            let rows = c!("list");
            let depth = c!("zero");
            c!("visitRows", *group, *scope, *casing, *globals, rows, depth);
            Ok(rows)
        }
        ("visitGroup", [child, scope, casing, globals, rows, depth]) => {
            if is!(g!(*child, "kind"), "group") {
                let next = c!("next", *depth);
                c!("visitRows", *child, *scope, *casing, *globals, *rows, next);
            }
            host.call("undefined", vec![])
        }
        ("globalLine", [ctx]) => {
            let flags = c!("list");
            if yes!(g!(*ctx, "presetsEnabled")) {
                c!("push", flags, literal!("--preset <path>"));
            }
            if yes!(g!(g!(*ctx, "controls"), "yes")) {
                c!("push", flags, literal!("--yes"));
            }
            if yes!(g!(g!(*ctx, "controls"), "output")) {
                let value = c!("globalOutput", g!(*ctx, "controls"));
                c!("push", flags, value);
            }
            if yes!(g!(g!(*ctx, "controls"), "verbose")) {
                c!("push", flags, literal!("-v, --verbose"));
            }
            if yes!(g!(*ctx, "showVersion")) {
                c!("push", flags, literal!("--version"));
            }
            if yes!(c!("nonempty", flags)) {
                host.call("globalLine", vec![flags])
            } else {
                host.literal("")
            }
        }
        ("leafGlobals", [ctx]) => {
            if yes!(g!(g!(*ctx, "controls"), "verbose")) {
                host.call("leafGlobals", vec![])
            } else {
                host.literal("")
            }
        }
        ("globalRows", [group, scope, casing, globals]) => {
            let seen = c!("seen");
            r!("globalVisit", *group, *scope, *casing, *globals, seen);
            host.call("values", vec![seen])
        }
        ("globalVisit", [node, scope, casing, globals, seen]) => {
            if is!(g!(*node, "kind"), "command") {
                let collected = c!("collect", g!(*node, "params"), *casing, *globals);
                c!("globalFields", g!(collected, "fields"), *globals, *seen);
            } else {
                c!("globalChildren", *node, *scope, *casing, *globals, *seen);
            }
            host.call("undefined", vec![])
        }
        ("globalField", [field, globals, seen]) => {
            if !strict!(g!(*field, "global")) || yes!(c!("has", *globals, g!(*field, "optionFlag")))
            {
                return host.call("undefined", vec![]);
            }
            let key = c!("dedupeKey", *field);
            if !yes!(c!("has", *seen, key)) {
                c!("saveGlobal", *seen, key, *field, *globals);
            }
            host.call("undefined", vec![])
        }
        ("commandList" | "optionList", [rows]) => {
            let tty = strict!(c!("tty"));
            host.call(
                match (operation, tty) {
                    ("commandList", true) => "richCommands",
                    ("commandList", false) => "plainCommands",
                    (_, true) => "richOptions",
                    _ => "plainOptions",
                },
                vec![*rows],
            )
        }
        ("sortField", [field, required, optional]) => {
            let target = if !yes!(g!(*field, "optional")) && !yes!(g!(*field, "hasDefault")) {
                *required
            } else {
                *optional
            };
            host.call("push", vec![target, *field])
        }
        ("usage", [breadcrumb, usage, suffix]) => {
            let visible = c!("usageVisible", *breadcrumb);
            let breadcrumbs = if is!(c!("first", *breadcrumb), "") {
                c!("prepend", *usage, visible)
            } else {
                visible
            };
            host.call("usage", vec![*usage, breadcrumbs, *suffix])
        }
        ("groupSuffix", [group, scope, casing, globals]) => {
            if !undef!(g!(*group, "default"))
                && strict!(g!(g!(*group, "default"), "hidden"))
                && yes!(c!("includes", g!(g!(*group, "default"), "scope"), *scope))
            {
                let parameters = r!("parameters", g!(*group, "default"), *casing, *globals);
                let budget = c!("infinity");
                let collapsed = r!("collapse", parameters, budget);
                return host.call("groupSuffix", vec![collapsed]);
            }
            host.literal("[command] [OPTIONS]")
        }
        ("styledUsage", [usage]) => {
            let parts = c!("usageParts", *usage);
            if yes!(c!("empty", parts)) {
                return host.call("styleUsage", vec![*usage]);
            }
            let end = c!("commandEnd", parts);
            let commands = if yes!(c!("minusOne", end)) {
                parts
            } else {
                let zero = c!("zero");
                c!("slice", parts, zero, end)
            };
            let args = if yes!(c!("minusOne", end)) {
                c!("list")
            } else {
                c!("tail", parts, end)
            };
            let command = c!("join", commands);
            if yes!(c!("empty", args)) {
                host.call("styleUsage", vec![command])
            } else {
                host.call("styledUsage", vec![command, args])
            }
        }
        (
            "group",
            [
                group,
                breadcrumb,
                scope,
                casing,
                global_options,
                usage,
                is_root,
            ],
        ) => {
            let sections = c!("list");
            let globals = flags!(*global_options);
            let rows = r!(
                "commandRows",
                *group,
                *scope,
                *casing,
                globals,
                g!(g!(*global_options, "controls"), "help")
            );
            if yes!(c!("nonempty", rows)) {
                let section = c!("commandSection", rows);
                c!("push", sections, section);
            }
            if yes!(*is_root) {
                let global_rows = r!("globalRows", *group, *scope, *casing, globals);
                let line = r!("globalLine", *global_options);
                let section = if yes!(c!("nonempty", global_rows)) {
                    c!("globalSection", global_rows, line)
                } else {
                    line
                };
                c!("push", sections, section);
            }
            if yes!(c!("nonempty", rows)) {
                let footer = c!("footer", *usage);
                c!("push", sections, footer);
            }
            let suffix = r!("groupSuffix", *group, *scope, *casing, globals);
            let usage_line = r!("usage", *breadcrumb, *usage, suffix);
            let input = c!(
                "documentInput",
                *breadcrumb,
                *usage,
                usage_line,
                g!(*group, "description"),
                c!("auth", *group),
                sections
            );
            run(host, "document", &[input])
        }
        ("leaf", [command, breadcrumb, casing, global_options, usage]) => {
            let sections = c!("list");
            let globals = flags!(*global_options);
            let collected = c!("collect", g!(*command, "params"), *casing, globals);
            let fields = c!(
                "assign",
                g!(collected, "fields"),
                g!(*command, "positional")
            );
            let local = c!("localFields", fields);
            let arguments = c!("fieldRows", c!("positionals", local), globals);
            let options = c!("fieldRows", c!("sortFields", c!("options", local)), globals);
            let options = c!("concat", options, c!("dynamicRows", collected, *casing));
            if yes!(c!("nonempty", arguments)) {
                let section = c!("section", literal!("Arguments:"), arguments);
                c!("push", sections, section);
            }
            if yes!(c!("nonempty", options)) {
                let section = c!("section", literal!("Options:"), options);
                c!("push", sections, section);
            }
            let line = r!("leafGlobals", *global_options);
            if yes!(c!("nonempty", line)) {
                c!("push", sections, line);
            }
            let secrets = c!("secretRows", g!(*command, "secrets"));
            if yes!(c!("nonempty", secrets)) {
                let section = c!("section", literal!("Secrets (environment):"), secrets);
                c!("push", sections, section);
            }
            if yes!(c!("nonempty", g!(*command, "examples"))) {
                let examples = c!("exampleRows", g!(*command, "examples"), *breadcrumb, *usage);
                let section = c!("exampleSection", examples);
                c!("push", sections, section);
            }
            let suffix = r!("positionalSuffix", c!("positionals", fields));
            let usage_line = r!("usage", *breadcrumb, *usage, suffix);
            let input = c!(
                "documentInput",
                *breadcrumb,
                *usage,
                usage_line,
                g!(*command, "description"),
                c!("auth", *command),
                sections
            );
            run(host, "document", &[input])
        }
        ("positionalSuffix", [fields]) => {
            if yes!(c!("nonempty", *fields)) {
                host.call("usagePositionals", vec![*fields])
            } else {
                host.literal("[OPTIONS]")
            }
        }
        ("positional", [field]) => {
            let optional = yes!(g!(*field, "optional")) || yes!(g!(*field, "hasDefault"));
            let variadic = strict!(g!(*field, "variadicPosition"));
            let open = host.literal(if optional { "[" } else { "<" })?;
            let close = host.literal(match (optional, variadic) {
                (true, true) => "...]",
                (false, true) => "...>",
                (true, false) => "]",
                _ => ">",
            })?;
            host.call("positionalText", vec![*field, open, close])
        }
        ("document", [input]) => {
            let title = c!("title", *input);
            let description = c!("documentDescription", *input);
            let end = c!("sentenceEnd", description);
            let heading = if yes!(c!("minusOne", end)) {
                description
            } else {
                c!("headingDescription", description, end)
            };
            let remaining = if yes!(c!("minusOne", end)) {
                literal!("")
            } else {
                c!("remainingDescription", description, end)
            };
            let heading = if yes!(c!("nonempty", heading)) {
                c!("heading", title, heading)
            } else {
                title
            };
            let lines = c!("headingLines", heading);
            if yes!(c!("nonempty", remaining)) {
                c!("descriptionLines", lines, remaining);
            }
            c!("usageLines", lines, g!(*input, "usageLine"));
            if yes!(g!(*input, "requiresAuth")) {
                c!("push", lines, literal!("Requires: authentication"));
            }
            if yes!(g!(*input, "requiresAuth")) {
                c!("push", lines, literal!(""));
            }
            let sections = c!("sections", g!(*input, "sections"));
            c!("push", lines, sections);
            host.call("endDocument", vec![lines])
        }
        ("jsonHelp", [target, root, casing, global_options, usage]) => {
            let globals = flags!(*global_options);
            let node = g!(*target, "node");
            let scope = literal!("cli");
            if is!(g!(node, "kind"), "group") {
                let rows = r!(
                    "commandRows",
                    node,
                    scope,
                    *casing,
                    globals,
                    g!(g!(*global_options, "controls"), "help")
                );
                let is_root = host.same(node, *root)?;
                let name = c!("jsonName", *target, *usage);
                let path = c!("jsonPath", *target);
                let breadcrumb = g!(*target, "breadcrumb");
                let suffix = r!("groupSuffix", node, scope, *casing, globals);
                let usage_line = r!("usage", breadcrumb, *usage, suffix);
                let description = c!("jsonDescription", node);
                let commands = c!("jsonCommands", rows);
                let options = if is_root {
                    let rows = r!("globalRows", node, scope, *casing, globals);
                    c!("jsonGlobals", rows)
                } else {
                    c!("list")
                };
                return host.call(
                    "jsonGroup",
                    vec![name, path, usage_line, description, commands, options],
                );
            }
            let collected = c!("collect", g!(node, "params"), *casing, globals);
            let fields = c!("assign", g!(collected, "fields"), g!(node, "positional"));
            let suffix = r!("positionalSuffix", c!("positionals", fields));
            // The result object reads name and path before the usage and description.
            let name = g!(node, "name");
            let path = c!("jsonPath", *target);
            let usage_line = r!("usage", g!(*target, "breadcrumb"), *usage, suffix);
            let description = c!("jsonDescription", node);
            host.call(
                "jsonLeaf",
                vec![node, name, path, usage_line, description, fields, globals],
            )
        }
        ("jsonGlobalName", [flags]) => host.call("globalName", vec![*flags]),
        ("jsonOption", [field, globals]) => {
            let name = g!(*field, "displayPath");
            let flags = c!("jsonFlags", *field, *globals);
            let schema = g!(*field, "schema");
            let schema_type = c!("schemaType", schema);
            let choices = if is!(g!(g!(*field, "schema"), "kind"), "enum") {
                c!("choices", *field)
            } else {
                c!("object")
            };
            let description = if undef!(g!(*field, "description")) {
                c!("object")
            } else {
                c!("fieldDescription", *field)
            };
            let required = g!(*field, "requiredWhenActive");
            let defaults = if yes!(g!(*field, "hasDefault")) {
                c!("defaultValue", *field)
            } else {
                c!("object")
            };
            let positional = if undef!(g!(*field, "positionalIndex")) {
                c!("object")
            } else {
                c!("positional")
            };
            host.call(
                "jsonOption",
                vec![
                    name,
                    flags,
                    schema_type,
                    choices,
                    description,
                    required,
                    defaults,
                    positional,
                ],
            )
        }
        ("inferName", [argv]) => {
            let entry = c!("entrypoint", *argv);
            if !yes!(c!("isString", entry)) || yes!(c!("empty", entry)) {
                return host.literal("toolcraft");
            }
            let parsed = c!("parsePath", entry);
            if yes!(c!("nonempty", g!(parsed, "name"))) {
                host.get(parsed, "name")
            } else {
                host.literal("toolcraft")
            }
        }
        ("initialize", [root, argv, options, invocation]) => {
            let state = c!("init", *root, *argv, *options, *invocation);
            keep!(state, "write", c!("writer", *invocation));
            keep!(state, "output", r!("output", *argv));
            let casing = g!(*options, "casing");
            let casing = if host.is_nullish(casing)? {
                literal!("kebab")
            } else {
                casing
            };
            keep!(state, "casing", casing);
            let usage = g!(*options, "rootUsageName");
            let usage = if host.is_nullish(usage)? {
                r!("inferName", *argv)
            } else {
                usage
            };
            keep!(state, "usage", usage);
            let scope = literal!("cli");
            let target = r!(
                "target",
                *root,
                *argv,
                scope,
                usage,
                g!(*options, "rootDisplayName")
            );
            keep!(state, "target", target);
            keep!(state, "controls", c!("controls", g!(*options, "controls")));
            Ok(state)
        }
        ("json", [state]) => {
            let output = g!(*state, "output");
            host.call(
                if host.is_kind(output, "json")? {
                    "true"
                } else {
                    "false"
                },
                vec![],
            )
        }
        ("designOutput", [state]) => host.call("designOutput", vec![*state]),
        ("writeJson", [state]) => {
            let target = g!(*state, "target");
            let root = g!(*state, "root");
            let casing = g!(*state, "casing");
            let globals = c!("globalOptions", *state);
            let usage = g!(*state, "usage");
            let rendered = r!("jsonHelp", target, root, casing, globals, usage);
            host.call("write", vec![*state, rendered])
        }
        ("writeDocument", [state]) => {
            let target = g!(*state, "target");
            let rendered = if is!(g!(g!(target, "node"), "kind"), "group") {
                let node = g!(target, "node");
                let breadcrumb = g!(target, "breadcrumb");
                let scope = literal!("cli");
                let casing = g!(*state, "casing");
                let globals = c!("globalOptions", *state);
                let usage = g!(*state, "usage");
                let current = g!(target, "node");
                let root = g!(*state, "root");
                let is_root = c!(if host.same(current, root)? {
                    "true"
                } else {
                    "false"
                });
                r!(
                    "group", node, breadcrumb, scope, casing, globals, usage, is_root
                )
            } else {
                r!(
                    "leaf",
                    g!(target, "node"),
                    g!(target, "breadcrumb"),
                    g!(*state, "casing"),
                    c!("globalOptions", *state),
                    g!(*state, "usage")
                )
            };
            host.call("write", vec![*state, rendered])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

//! CLI diagnostics, Commander admission and HTTP presentation policy.
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
    macro_rules! literal {
        ($value:expr) => {
            host.literal($value)?
        };
    }
    macro_rules! own {
        ($value:expr,$key:expr) => {{
            let key = literal!($key);
            yes!(c!("own", $value, key))
        }};
    }
    match (operation, args) {
        ("pattern", [pattern, output]) => {
            let logger = c!("logger", *output);
            if is!(g!(*pattern, "kind"), "usage") {
                let message = c!("patternUsage", *pattern);
                c!("log", logger, message);
                return host.call("failed", vec![]);
            }
            if is!(g!(*pattern, "kind"), "runtime-user") {
                c!("log", logger, g!(*pattern, "message"));
                return host.call("failed", vec![]);
            }
            if is!(g!(*pattern, "kind"), "definition") {
                let prefix = c!("definitionMessage", *pattern);
                let hint = if yes!(g!(*pattern, "debugControlEnabled")) {
                    literal!("\nRun with --debug for a stack trace.")
                } else {
                    literal!("")
                };
                let message = c!("append", prefix, hint);
                c!("log", logger, message);
                if !undef!(g!(*pattern, "debugStackMode"))
                    && yes!(g!(g!(*pattern, "error"), "stack"))
                {
                    let stack = c!(
                        "stack",
                        g!(g!(*pattern, "error"), "stack"),
                        g!(*pattern, "debugStackMode")
                    );
                    c!("stderr", stack);
                }
                return host.call("failed", vec![]);
            }
            if is!(g!(*pattern, "kind"), "toolcraft-bug") {
                let prefix = c!("bugMessage", *pattern);
                let hint = if yes!(g!(*pattern, "debugControlEnabled")) {
                    literal!(" Re-run with --debug for a stack trace and file an issue.")
                } else {
                    literal!(" File an issue.")
                };
                let message = c!("append", prefix, hint);
                c!("log", logger, message);
                if !undef!(g!(*pattern, "debugStackMode"))
                    && yes!(g!(g!(*pattern, "error"), "stack"))
                {
                    let stack = c!(
                        "stack",
                        g!(g!(*pattern, "error"), "stack"),
                        g!(*pattern, "debugStackMode")
                    );
                    c!("stderr", stack);
                }
                return host.call("failed", vec![]);
            }
            let message = if !undef!(g!(*pattern, "debugStackMode"))
                || !yes!(g!(*pattern, "debugControlEnabled"))
            {
                g!(*pattern, "message")
            } else {
                c!("unexpectedMessage", *pattern)
            };
            c!("log", logger, message);
            if !undef!(g!(*pattern, "debugStackMode")) && !undef!(g!(*pattern, "stack")) {
                let stack = c!(
                    "stack",
                    g!(*pattern, "stack"),
                    g!(*pattern, "debugStackMode")
                );
                c!("stderr", stack);
            }
            host.call("failed", vec![])
        }
        ("handle", [error, options, logger]) => {
            if yes!(c!("isUserError", *error)) {
                let pattern = if is!(g!(*options, "userErrorPattern"), "definition") {
                    c!("definitionPattern", *error, *options)
                } else if is!(g!(*options, "userErrorPattern"), "usage") {
                    c!("usagePattern", *error, *options)
                } else {
                    c!("runtimePattern", *error)
                };
                let output = g!(*options, "outputEmitter");
                return run(host, "pattern", &[pattern, output]);
            }
            if yes!(c!("isError", *error)) && is!(g!(*error, "name"), "ToolcraftBugError") {
                let pattern = c!("bugPattern", *error, *options);
                let output = g!(*options, "outputEmitter");
                return run(host, "pattern", &[pattern, output]);
            }
            if yes!(c!("isCommander", *error)) {
                c!("exit", g!(*error, "exitCode"));
                if is!(g!(*error, "code"), "commander.helpDisplayed")
                    || is!(g!(*error, "code"), "commander.version")
                {
                    return host.call("undefined", vec![]);
                }
                let message = if is!(g!(*error, "code"), "commander.unknownCommand") {
                    c!("unknownCommandUsage", *error, *options)
                } else if is!(g!(*error, "code"), "commander.unknownOption") {
                    let argv = c!("argv", *options);
                    let message = r!("unknownOption", *error, g!(*options, "program"), argv);
                    c!("optionUsage", message, *options, argv)
                } else {
                    let message = r!("commanderMessage", *error);
                    c!("otherUsage", message, *options)
                };
                c!("log", *logger, message);
                return host.call("undefined", vec![]);
            }
            if yes!(c!("isHttpErrorLike", *error)) {
                r!("http", *error, *options);
                return host.call("failed", vec![]);
            }
            let message = if yes!(c!("isError", *error)) {
                g!(*error, "message")
            } else {
                c!("string", *error)
            };
            let stack = if yes!(c!("isError", *error)) {
                g!(*error, "stack")
            } else {
                c!("undefined")
            };
            let pattern = c!("unexpectedPattern", message, stack, *options);
            let output = g!(*options, "outputEmitter");
            run(host, "pattern", &[pattern, output])
        }
        ("errorPath", [options, argv]) => {
            if yes!(c!("nonempty", g!(*options, "commandPath"))) {
                host.get(*options, "commandPath")
            } else {
                let program = g!(*options, "program");
                run(host, "currentPath", &[program, *argv])
            }
        }
        ("otherErrorPath", [options]) => {
            if yes!(c!("nonempty", g!(*options, "commandPath"))) {
                host.get(*options, "commandPath")
            } else {
                let program = g!(*options, "program");
                let argv = c!("argv", *options);
                run(host, "currentPath", &[program, argv])
            }
        }
        ("usagePointer", [message, options]) => {
            if yes!(c!("helpIncluded", *message)) {
                return Ok(*message);
            }
            let target = if yes!(c!("empty", g!(*options, "commandPath"))) {
                g!(*options, "rootUsageName")
            } else {
                c!("usageTarget", *options)
            };
            host.call("usageMessage", vec![*message, target])
        }
        ("commanderMessage", [error]) => {
            if yes!(c!("errorPrefix", *error)) {
                host.get(*error, "message")
            } else {
                host.call("commanderMessage", vec![*error])
            }
        }
        ("cliPath", [path]) => host.call("cliPath", vec![*path]),
        ("unknownMessage", [input, current]) => {
            let suggestions = if host.is_undefined(*current)? {
                c!("list")
            } else {
                let names = c!("commandNames", *current);
                c!("suggest", *input, names)
            };
            let message = c!("unknownCommandMessage", *input);
            run(host, "suggestion", &[message, suggestions])
        }
        ("unknownCommand" | "unknownOption", [error, program, argv]) => {
            let quoted = r!("quoted", g!(*error, "message"));
            let input = if host.is_nullish(quoted)? {
                literal!("")
            } else {
                quoted
            };
            let current = if host.is_undefined(*program)? {
                c!("undefined")
            } else {
                r!("current", *program, *argv)
            };
            if operation == "unknownCommand" {
                return run(host, "unknownMessage", &[input, current]);
            }
            let suggestions = if host.is_undefined(current)? {
                c!("list")
            } else {
                let names = c!("optionNames", current);
                c!("suggest", input, names)
            };
            let message = c!("unknownOptionMessage", input);
            run(host, "suggestion", &[message, suggestions])
        }
        ("suggestion", [message, suggestions]) => {
            if yes!(c!("empty", *suggestions)) {
                Ok(*message)
            } else {
                host.call("suggestionMessage", vec![*message, *suggestions])
            }
        }
        ("quoted", [message]) => {
            let single = literal!("'");
            let value = r!("betweenQuotes", *message, single);
            if !host.is_undefined(value)? {
                Ok(value)
            } else {
                let double = literal!("\"");
                run(host, "betweenQuotes", &[*message, double])
            }
        }
        ("betweenQuotes", [message, quote]) => {
            let start = c!("quoteIndex", *message, *quote);
            if yes!(c!("minusOne", start)) {
                return host.call("undefined", vec![]);
            }
            let end = c!("quoteEnd", *message, *quote, start);
            if yes!(c!("minusOne", end)) {
                return host.call("undefined", vec![]);
            }
            host.call("quoteSlice", vec![*message, start, end])
        }
        ("current" | "currentPath" | "unknown", [program, argv]) => {
            if operation == "currentPath" && host.is_undefined(*program)? {
                return host.literal("");
            }
            let mut current = *program;
            let path = if operation == "current" {
                c!("undefined")
            } else {
                c!("list")
            };
            let tokens = c!("tail", *argv);
            let mut index = c!("zero");
            while yes!(c!("more", tokens, index)) {
                let token = c!("at", tokens, index);
                if host.is_undefined(token)? || is!(token, "--") {
                    break;
                }
                if yes!(c!("hyphen", token)) {
                    if operation == "currentPath" {
                        break;
                    }
                    let option = c!("option", current, token);
                    if yes!(c!("required", option)) && !yes!(c!("attached", token)) {
                        index = c!("next", index);
                    }
                    index = c!("next", index);
                    continue;
                }
                if operation == "unknown" {
                    if yes!(c!("hiddenIncludes", current, token))
                        || yes!(c!("reservedIncludes", current, token))
                    {
                        return host.call("unknown", vec![token, current, path]);
                    }
                    if yes!(c!("empty", g!(current, "commands"))) {
                        return host.call("undefined", vec![]);
                    }
                }
                let child = c!("child", current, token);
                if host.is_undefined(child)? {
                    if operation == "unknown" {
                        if !undef!(c!("defaultName", current))
                            && !yes!(r!("rejectDefault", current, token, path))
                        {
                            return host.call("undefined", vec![]);
                        }
                        return host.call("unknown", vec![token, current, path]);
                    }
                    break;
                }
                current = child;
                if operation != "current" {
                    let name = c!("name", child);
                    c!("push", path, name);
                }
                index = c!("next", index);
            }
            match operation {
                "current" => Ok(current),
                "currentPath" => host.call("joinPath", vec![path]),
                _ => host.call("undefined", vec![]),
            }
        }
        ("rejectDefault", [command, token, path]) => {
            let rejected = yes!(c!("empty", *path))
                && yes!(r!("bare", *token))
                && yes!(r!("nonDefault", *command));
            host.call(if rejected { "true" } else { "false" }, vec![])
        }
        ("nonDefault", [command]) => {
            let default = c!("defaultName", *command);
            host.call("somePublic", vec![*command, default])
        }
        ("publicChild", [child, command, default]) => {
            let name = c!("name", *child);
            let public = !host.same(name, *default)?
                && !yes!(c!("hidden", *child))
                && !yes!(c!("reservedIncludes", *command, c!("name", *child)));
            host.call(if public { "true" } else { "false" }, vec![])
        }
        ("bare", [token]) => {
            if yes!(c!("empty", *token)) {
                host.call("false", vec![])
            } else {
                host.call("bareCharacters", vec![*token])
            }
        }
        ("nameCharacter", [character]) => {
            let code = c!("code", *character);
            if host.is_undefined(code)? {
                return host.call("false", vec![]);
            }
            let lower = c!("lower", code);
            let upper = c!("upper", code);
            let digit = c!("digit", code);
            let admitted = yes!(lower)
                || yes!(upper)
                || yes!(digit)
                || is!(*character, "-")
                || is!(*character, "_");
            host.call(if admitted { "true" } else { "false" }, vec![])
        }
        ("configure", [command, version]) => {
            c!("exitOverride", *command);
            c!("positionalOptions", *command);
            c!("noHelp", *command);
            if !host.is_undefined(*version)? && !yes!(c!("versionOption", *command)) {
                c!("version", *command, *version);
            }
            c!("configureOutput", *command);
            c!("configureChildren", *command, *version);
            host.call("undefined", vec![])
        }
        ("nonemptyString", [value]) => {
            let nonempty = yes!(c!("isString", *value)) && yes!(c!("nonblank", *value));
            host.call(if nonempty { "true" } else { "false" }, vec![])
        }
        ("ownNonempty", [value, key]) => {
            let nonempty = yes!(c!("own", *value, *key))
                && yes!(r!("nonemptyString", c!("member", *value, *key)));
            host.call(if nonempty { "true" } else { "false" }, vec![])
        }
        ("problem", [body]) => {
            if !yes!(c!("object", *body)) {
                return host.call("false", vec![]);
            }
            for (key, type_name) in [
                ("type", "string"),
                ("title", "string"),
                ("status", "number"),
                ("detail", "string"),
                ("instance", "string"),
            ] {
                let key = host.literal(key)?;
                if yes!(c!("own", *body, key)) {
                    let value = c!("member", *body, key);
                    let type_name = host.literal(type_name)?;
                    if !yes!(c!("type", value, type_name)) {
                        return host.call("false", vec![]);
                    }
                }
            }
            let title = literal!("title");
            let detail = literal!("detail");
            let found =
                yes!(r!("ownNonempty", *body, title)) || yes!(r!("ownNonempty", *body, detail));
            host.call(if found { "true" } else { "false" }, vec![])
        }
        ("graph", [body]) => {
            if !yes!(c!("object", *body))
                || !yes!(c!("isArray", g!(*body, "errors")))
                || yes!(c!("empty", g!(*body, "errors")))
            {
                host.call("false", vec![])
            } else {
                host.call("graphErrors", vec![*body])
            }
        }
        ("graphError", [error]) => {
            if !yes!(c!("object", *error)) || !yes!(c!("isString", g!(*error, "message"))) {
                return host.call("false", vec![]);
            }
            if own!(*error, "path") {
                let path = g!(*error, "path");
                if !yes!(c!("isArray", path)) || !yes!(c!("graphPath", path)) {
                    return host.call("false", vec![]);
                }
            }
            if own!(*error, "extensions") {
                if !yes!(c!("object", g!(*error, "extensions"))) {
                    return host.call("false", vec![]);
                }
                if own!(g!(*error, "extensions"), "code")
                    && !yes!(c!("isString", g!(g!(*error, "extensions"), "code")))
                {
                    return host.call("false", vec![]);
                }
            }
            host.call("true", vec![])
        }
        ("problemBody", [body]) => {
            let lines = c!("list");
            for (key, operation) in [("title", "problemTitle"), ("detail", "problemDetail")] {
                let key = host.literal(key)?;
                if yes!(r!("ownNonempty", *body, key)) {
                    let line = c!(operation, *body);
                    c!("push", lines, line);
                }
            }
            for (key, operation) in [
                ("type", "problemType"),
                ("instance", "problemInstance"),
                ("status", "problemStatus"),
            ] {
                let property = host.literal(key)?;
                if yes!(c!("own", *body, property)) && !undef!(g!(*body, key)) {
                    let line = c!(operation, *body);
                    c!("push", lines, line);
                }
            }
            host.call("lines", vec![lines])
        }
        ("graphBody", [error]) => {
            let message = c!("graphMessage", *error);
            let lines = c!("list", message);
            if own!(*error, "path") && !undef!(g!(*error, "path")) {
                let line = c!("graphPathLine", *error);
                c!("push", lines, line);
            }
            if own!(*error, "extensions")
                && !undef!(g!(*error, "extensions"))
                && own!(g!(*error, "extensions"), "code")
                && !undef!(g!(g!(*error, "extensions"), "code"))
            {
                let line = c!("graphCodeLine", *error);
                c!("push", lines, line);
            }
            host.call("lines", vec![lines])
        }
        ("httpBody", [body]) => {
            let value = c!("redact", *body);
            if yes!(c!("isString", value)) {
                return Ok(value);
            }
            if yes!(r!("problem", value)) {
                return run(host, "problemBody", &[value]);
            }
            if yes!(r!("graph", value)) {
                return host.call("graphBodies", vec![value]);
            }
            let serialized = c!("json", value);
            if host.is_undefined(serialized)? {
                host.call("string", vec![value])
            } else {
                Ok(serialized)
            }
        }
        ("style", [value, style]) => {
            if yes!(c!("tty")) {
                host.call("style", vec![*style, *value])
            } else {
                Ok(*value)
            }
        }
        ("http", [error, options]) => {
            let detailed = yes!(g!(*options, "verbose")) || !undef!(g!(*options, "debugStackMode"));
            let summary = c!("summary", *error);
            let request = c!("requestLine", *error);
            let muted = c!("muted");
            let request = r!("style", request, muted);
            let lines = c!("list", request);
            if detailed {
                c!("requestHeaders", lines, *error);
                if !undef!(g!(g!(*error, "request"), "body")) {
                    c!("requestBody", lines, *error);
                }
            }
            let status = c!("statusLine", *error);
            let style = c!("errorStyle");
            let status = r!("style", status, style);
            c!("push", lines, status);
            if detailed {
                c!("responseDetails", lines, *error);
            } else {
                let summary_lines = c!("summaryLines", summary);
                if !undef!(g!(summary, "fieldErrors"))
                    && yes!(c!("nonempty", g!(summary, "fieldErrors")))
                {
                    c!("fieldErrors", summary_lines, summary);
                }
                c!("push", lines, literal!(""));
                if yes!(c!("nonempty", summary_lines)) {
                    c!("appendLines", lines, summary_lines);
                } else {
                    let snippet = c!("bodySnippet", *error);
                    c!("push", lines, snippet);
                }
                if yes!(g!(*options, "verboseControlEnabled")) {
                    c!(
                        "push",
                        lines,
                        literal!("Re-run with --verbose to see headers and full body.")
                    );
                }
            }
            let rendered = c!("lines", lines);
            c!("stderr", rendered);
            let stack = if yes!(c!("isError", *error)) {
                g!(*error, "stack")
            } else {
                c!("undefined")
            };
            if !undef!(g!(*options, "debugStackMode")) && yes!(stack) {
                let formatted = c!("stack", stack, g!(*options, "debugStackMode"));
                c!("stderr", formatted);
            }
            host.call("undefined", vec![])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

//! CLI command execution policy; async and iterator boundaries remain in Node.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! g {
        ($value:expr,$key:expr) => {{
            let value = $value;
            host.get(value, $key)?
        }};
    }
    macro_rules! yes {
        ($value:expr) => {{
            let value = $value;
            let truthy = c!("truthy", value);
            host.is_true(truthy)?
        }};
    }
    macro_rules! undefined {
        ($value:expr) => {{
            let value = $value;
            host.is_undefined(value)?
        }};
    }
    macro_rules! kind {
        ($value:expr,$kind:expr) => {{
            let value = $value;
            host.is_kind(value, $kind)?
        }};
    }
    macro_rules! keep {
        ($state:expr,$key:expr,$value:expr) => {{
            let key = host.literal($key)?;
            c!("keep", $state, key, $value);
        }};
    }
    match (operation, args) {
        ("flags", [command]) => {
            let flags = c!("object");
            let commands = c!("list");
            let mut current = *command;
            while !yes!(c!("isNull", current)) {
                c!("unshift", commands, current);
                current = g!(current, "parent");
            }
            c!("assignFlags", flags, commands);
            Ok(flags)
        }
        ("initialize", _) => {
            let state = host.call("state", args.to_vec())?;
            let logger = c!("logger", g!(state, "outputEmitter"));
            keep!(state, "logger", logger);
            let action = g!(g!(state, "execution"), "actionCommand");
            let flags = run(host, "flags", &[action])?;
            keep!(state, "optionValues", flags);
            let output = c!("resolveOutput", flags);
            keep!(state, "output", output);
            let invocation = g!(state, "invocation");
            let note = if yes!(invocation) {
                c!("invocationNote", invocation)
            } else {
                c!("standardNote")
            };
            let primitives = c!("primitives", logger, note, output);
            keep!(state, "primitives", primitives);
            let options = g!(state, "diagnosticsOptions");
            let level = g!(flags, "logLevel");
            let level = if host.is_nullish(level)? {
                if yes!(g!(options, "verboseControlEnabled")) && yes!(g!(flags, "verbose")) {
                    host.literal("trace")?
                } else {
                    g!(options, "logLevel")
                }
            } else {
                level
            };
            let sink = g!(options, "logger");
            let sink = if host.is_nullish(sink)? {
                if yes!(invocation) {
                    c!("invocationSink", invocation)
                } else {
                    c!("diagnosticSink")
                }
            } else {
                sink
            };
            let diagnostics = c!("diagnostics", level, sink);
            keep!(state, "diagnostics", diagnostics);
            let streams = g!(state, "promptStreams");
            let input = c!("input", streams, invocation);
            let output_stream = c!("output", streams, invocation);
            let stdin = c!("tty", input);
            let stdout = c!("tty", output_stream);
            let should_prompt = !yes!(g!(flags, "yes")) && host.is_true(stdin)?;
            let prompt = host.call(if should_prompt { "true" } else { "false" }, vec![])?;
            keep!(state, "shouldPrompt", prompt);
            let missing = if !yes!(g!(flags, "yes"))
                && host.is_kind(output, "rich")?
                && host.is_true(stdin)?
                && host.is_true(stdout)?
            {
                c!("missingContext", state, stdin, stdout)
            } else {
                c!("undefined")
            };
            keep!(state, "missingParameterContext", missing);
            Ok(state)
        }
        ("runtime", [state]) => host.call("runtime", vec![*state]),
        ("preflight", [state, runtime]) => host.call("preflight", vec![*state, *runtime]),
        ("designOutput", [state]) => host.call("designOutput", vec![*state]),
        ("beforeParams", [state]) => {
            if !yes!(g!(*state, "invocation")) {
                let pending = c!("requirements", *state);
                host.call("step:await", vec![pending])
            } else {
                host.call("step:done", vec![])
            }
        }
        ("params", [state]) => host.call("params", vec![*state]),
        ("afterParams", [state, params]) => {
            let schema = g!(g!(g!(*state, "execution"), "command"), "params");
            if !host.is_undefined(schema)? && !undefined!(c!("schemaMarker", schema)) {
                let validation = c!("validate", schema, *params);
                if !yes!(g!(validation, "ok")) {
                    c!("validationErrors", validation);
                }
            }
            if yes!(g!(*state, "invocation")) {
                let schema = g!(g!(g!(*state, "execution"), "command"), "params");
                let validation = c!("validate", schema, *params);
                if !yes!(g!(validation, "ok")) {
                    c!("validationErrors", validation);
                    return host.call("step:return", vec![]);
                }
                c!("assignParams", *params, validation);
                c!("abort", *state);
                let pending = c!("invocationRequirements", *state, *params);
                host.call("step:await", vec![pending])
            } else {
                host.call("step:done", vec![])
            }
        }
        ("context", [state, params]) => {
            if yes!(g!(*state, "invocation"))
                && yes!(g!(g!(g!(*state, "execution"), "command"), "confirm"))
                && !yes!(g!(g!(g!(*state, "execution"), "command"), "humanInLoop"))
                && !yes!(g!(g!(*state, "optionValues"), "yes"))
            {
                return host.call("confirmationRequired", vec![]);
            }
            host.call("context", vec![*state, *params])
        }
        ("stream", [state]) => {
            if !undefined!(g!(g!(g!(*state, "execution"), "command"), "stream")) {
                let stream = c!("managed", *state);
                host.call("step:stream", vec![stream])
            } else {
                host.call("step:done", vec![])
            }
        }
        ("streamStatus", [state, event]) => {
            c!("statusDiagnostic", *state, *event);
            if kind!(g!(*state, "output"), "rich") && !undefined!(g!(*event, "message")) {
                c!("statusInfo", *state, *event);
            }
            host.call("undefined", vec![])
        }
        ("listen" | "unlisten", [state, interrupt]) => {
            if !yes!(g!(*state, "invocation")) {
                c!(operation, *interrupt);
            }
            host.call("undefined", vec![])
        }
        ("event", [state, event]) => {
            c!("optionalAbort", *state);
            if kind!(g!(*state, "output"), "json") {
                let line = c!("json", *event);
                let output = g!(*state, "outputEmitter");
                if host.is_undefined(output)? {
                    c!("stdoutLine", line);
                } else {
                    c!("emitLine", output, line);
                }
            } else {
                c!("renderStream", *state, *event);
            }
            host.call("undefined", vec![])
        }
        ("afterStream", [state]) => host.call("optionalAbort", vec![*state]),
        ("confirmation", [state]) => {
            if yes!(g!(g!(g!(*state, "execution"), "command"), "confirm"))
                && !yes!(g!(g!(g!(*state, "execution"), "command"), "humanInLoop"))
                && yes!(g!(*state, "shouldPrompt"))
            {
                c!("logResolved", *state);
                let pending = c!("confirm", *state);
                host.call("step:confirm", vec![pending])
            } else {
                host.call("step:done", vec![])
            }
        }
        ("confirmationField", [state, field]) => {
            let value = c!("fieldValue", *state, *field);
            if !host.is_undefined(value)? {
                c!("resolvedLog", *state, *field, value);
            }
            host.call("undefined", vec![])
        }
        ("confirmed", [value]) => {
            if yes!(c!("isCancel", *value)) || !host.is_true(*value)? {
                host.call("cancelled", vec![])
            } else {
                host.call("undefined", vec![])
            }
        }
        ("handler", [state]) => {
            if yes!(g!(g!(g!(*state, "execution"), "command"), "humanInLoop"))
                && !undefined!(g!(*state, "humanInLoop"))
            {
                host.call("approval", vec![*state])
            } else {
                host.call("handler", vec![*state])
            }
        }
        ("afterHandler", [state, result]) => {
            if kind!(g!(*state, "output"), "rich") && yes!(g!(g!(*state, "runtime"), "isFixture")) {
                c!("fixtureHeader", *state);
            }
            c!("optionalAbort", *state);
            let pending = run(host, "pending", &[*result])?;
            if yes!(pending) && kind!(g!(*state, "output"), "rich") {
                c!("pendingOutput", *state, *result);
                return host.call("undefined", vec![]);
            }
            let status = c!("renderHandler", *state, *result, pending);
            if yes!(g!(status, "mcpError")) {
                if yes!(g!(*state, "invocation")) {
                    c!("invocationError", *state);
                } else {
                    c!("processError");
                }
            }
            host.call("undefined", vec![])
        }
        ("errorContext", [state]) => host.call("errorContext", vec![*state]),
        ("diagnostic", [event]) => {
            let transcript = c!("transcript", *event);
            if yes!(c!("isString", transcript)) {
                c!("stderr", transcript);
                return host.call("undefined", vec![]);
            }
            if kind!(g!(*event, "category"), "progress") || kind!(g!(*event, "level"), "trace") {
                return host.call("undefined", vec![]);
            }
            c!("diagnostic", *event);
            host.call("undefined", vec![])
        }
        ("header", [title]) => {
            let padding = c!("padding", *title);
            c!("header", *title, padding);
            host.call("undefined", vec![])
        }
        ("pending", [result]) => {
            if yes!(c!("isObject", *result))
                && !yes!(c!("isNull", *result))
                && kind!(g!(*result, "status"), "pending-approval")
                && yes!(c!("isString", g!(*result, "approvalId")))
                && yes!(c!("isString", g!(*result, "message")))
                && yes!(c!("isString", g!(*result, "enqueuedAt")))
            {
                host.call("true", vec![])
            } else {
                host.call("false", vec![])
            }
        }
        ("pendingOutput", [pending, root, output]) => {
            let message = c!("pendingMessage", *pending, *root);
            if host.is_undefined(*output)? {
                c!("stdoutLine", message);
            } else {
                c!("emitLine", *output, message);
            }
            host.call("undefined", vec![])
        }
        (
            "render",
            [
                command,
                path,
                result,
                output,
                primitives,
                formats,
                write,
                exact,
            ],
        ) => {
            let renderer = c!("customRenderer", *formats, *output);
            if host.is_undefined(renderer)? {
                return host.call(
                    "defaultRender",
                    vec![*command, *result, *output, *primitives, *write],
                );
            }
            let payload = c!(
                "customRender",
                renderer,
                *command,
                *path,
                *primitives,
                *result
            );
            if !host.is_undefined(payload)? && yes!(c!("positiveLength", payload)) {
                if !host.is_undefined(*exact)? {
                    c!("exact", *exact, payload);
                } else if host.is_undefined(*write)? {
                    c!("stdout", payload);
                } else {
                    c!("write", *write, payload);
                }
            }
            host.call("status", vec![])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

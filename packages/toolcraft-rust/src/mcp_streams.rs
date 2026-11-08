//! Session-owned MCP subscription, event and notification policies.
use crate::host::TextHost;
use crate::sdk_validation::yes;
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
    macro_rules! keep {
        ($state:expr,$key:expr,$value:expr) => {{
            let key = host.literal($key)?;
            c!("keep", $state, key, $value);
        }};
    }
    match (operation, args) {
        ("list", [tools, casing]) => host.call("list", vec![*tools, *casing]),
        ("services", [state]) => {
            let request = g!(*state, "request");
            let name = c!("name", request);
            let name = if yes(host, "isString", vec![name])? {
                g!(request, "name")
            } else {
                c!("undefined")
            };
            let tools = g!(*state, "streamTools");
            let tool = c!("find", tools, name);
            if host.is_undefined(tool)? {
                return host.call("missing", vec![name]);
            }
            keep!(*state, "tool", tool);
            let definition = g!(g!(tool, "command"), "stream");
            if host.is_undefined(definition)? {
                return host.call("notStream", vec![tool]);
            }
            keep!(*state, "streamDefinition", definition);
            let schema = c!("schema", definition, g!(*state, "casing"));
            keep!(*state, "eventSchema", schema);
            let validator = c!("compile", schema);
            keep!(*state, "eventValidator", validator);
            let arguments = c!("arguments", request);
            let arguments = if yes(host, "isRecord", vec![arguments])? {
                g!(request, "arguments")
            } else {
                c!("object")
            };
            keep!(*state, "argumentsValue", arguments);
            let secrets = c!("secrets", *state);
            keep!(*state, "secrets", secrets);
            host.call("services", vec![*state])
        }
        ("requirements", [state, services]) => {
            c!("context", *state, *services);
            host.call("requirements", vec![*state])
        }
        ("params", [state]) => {
            let params = c!("params", *state);
            keep!(*state, "params", params);
            let id = c!("next", g!(*state, "shared"));
            keep!(*state, "subscriptionId", id);
            host.call("undefined", vec![])
        }
        ("start", [state]) => {
            let stream = c!("managed", *state);
            keep!(*state, "stream", stream);
            host.call("remember", vec![*state])
        }
        ("canNotify", [state]) => {
            let failed = g!(*state, "notificationFailed");
            let blocked = yes(host, "truthy", vec![failed])? || yes(host, "aborted", vec![*state])?;
            host.call(if blocked { "false" } else { "true" }, vec![])
        }
        ("notify", [state, params]) => host.call("notify", vec![*state, *params]),
        ("deliveryFailed", [state, params, error]) => {
            let failed = c!("true");
            keep!(*state, "notificationFailed", failed);
            c!("forget", *state);
            c!("cancelFailed", *state, *error);
            if !yes(host, "aborted", vec![*state])? {
                c!("deliveryDiagnostic", *state, *params);
            }
            host.call("undefined", vec![])
        }
        ("event", [state, event]) => {
            let errors = c!("errors");
            let value = c!("serialize", *state, *event, errors);
            c!("throwErrors", errors);
            let validation = c!("validate", *state, value);
            let ok = g!(validation, "ok");
            if !yes(host, "truthy", vec![ok])? {
                return host.call("invalidEvent", vec![validation]);
            }
            host.call("data", vec![*state, value])
        }
        ("end", [state]) => {
            if yes(host, "aborted", vec![*state])? {
                host.call("step:done", vec![])
            } else {
                let value = c!("end", *state);
                host.call("step:notify", vec![value])
            }
        }
        ("error", [state, error]) => {
            if yes(host, "aborted", vec![*state])? {
                return host.call("step:done", vec![]);
            }
            let message = if yes(host, "isError", vec![*error])? {
                g!(*error, "message")
            } else {
                c!("string", *error)
            };
            let value = c!("error", *state, message);
            host.call("step:notify", vec![value])
        }
        ("cleanup", [state]) => {
            c!("forget", *state);
            host.call("cancel", vec![*state])
        }
        ("result", [state]) => host.call("result", vec![*state]),
        ("unsubscribe", [shared, request, session]) => {
            let id = c!("id", *request);
            let id = if yes(host, "isString", vec![id])? {
                g!(*request, "subscriptionId")
            } else {
                c!("undefined")
            };
            let subscription = if host.is_undefined(id)? {
                c!("undefined")
            } else {
                c!("subscription", *shared, id)
            };
            let missing = host.is_undefined(id)? || host.is_undefined(subscription)?;
            let mismatch = if missing {
                true
            } else {
                let owner = g!(subscription, "signal");
                let signal = g!(*session, "signal");
                !host.same(owner, signal)?
            };
            if mismatch {
                let no = c!("false");
                let result = c!("unsubscribed", no);
                host.call("step:return", vec![result])
            } else {
                let pending = c!("cancelSubscription", subscription);
                host.call("step:await", vec![pending, id])
            }
        }
        ("unsubscribed", [shared, id]) => {
            c!("deleteSubscription", *shared, *id);
            let yes = c!("true");
            host.call("unsubscribed", vec![yes])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

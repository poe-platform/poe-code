//! MCP invocation policy with Node-owned await and callback boundaries.
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
        ("services", [state]) => {
            c!("abort", *state);
            let secrets = c!("secrets", *state);
            keep!(*state, "secrets", secrets);
            host.call("services", vec![*state])
        }
        ("requirements", [state, services]) => {
            c!("abort", *state);
            c!("context", *state, *services);
            host.call("requirements", vec![*state])
        }
        ("handler", [state]) => {
            c!("abort", *state);
            let params = c!("params", *state);
            keep!(*state, "params", params);
            c!("handlerContext", *state);
            let approval = g!(*state, "humanInLoop");
            host.call(
                if host.is_undefined(approval)? {
                    "handler"
                } else {
                    "approval"
                },
                vec![*state],
            )
        }
        ("result", [state, result]) => {
            if yes(host, "pending", vec![*result])? {
                return host.call("renderPending", vec![*result]);
            }
            let tool = g!(*state, "tool");
            if yes(host, "mcp", vec![*result])? {
                let error = g!(*result, "isError");
                if host.is_true(error)? {
                    return Ok(*result);
                }
                let schema = g!(tool, "resultSchema");
                if host.is_undefined(schema)? {
                    return Ok(*result);
                }
            }
            let schema = g!(tool, "resultSchema");
            if !host.is_undefined(schema)? {
                let mut value = if yes(host, "mcp", vec![*result])? {
                    g!(*result, "structuredContent")
                } else {
                    *result
                };
                let projection = g!(g!(tool, "command"), "mcpResult");
                if !host.is_undefined(projection)? {
                    value = c!("project", *state, *result);
                }
                let structured = c!("validate", *state, value);
                return if yes(host, "mcp", vec![*result])? {
                    host.call("mergeResult", vec![*result, structured])
                } else {
                    host.call("structured", vec![structured])
                };
            }
            host.call("content", vec![*result])
        }
        ("error", [state, error]) => {
            let aborted = c!("aborted", *state);
            if yes(host, "truthy", vec![aborted])? {
                c!("abort", *state);
            }
            if yes(host, "declined", vec![*error])? {
                let result = c!("renderDeclined", *error);
                host.call("step:return", vec![result])
            } else {
                let report = c!("report", *state, *error);
                host.call("step:report", vec![report])
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

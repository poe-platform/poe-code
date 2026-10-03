//! MCP approval rendering and protocol error classification policy.
use crate::host::Host;
use crate::sdk_validation::yes;

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    match (operation, args) {
        ("pending", [value]) => {
            if !yes(host, "isObject", vec![*value])? || yes(host, "isNull", vec![*value])? {
                return host.call("false", vec![]);
            }
            let status = host.get(*value, "status")?;
            if !host.is_kind(status, "pending-approval")? {
                return host.call("false", vec![]);
            }
            for key in ["approvalId", "message", "enqueuedAt"] {
                let member = host.get(*value, key)?;
                if !yes(host, "isString", vec![member])? {
                    return host.call("false", vec![]);
                }
            }
            host.call("true", vec![])
        }
        ("renderPending", [pending]) => {
            let text = c!("pendingText", *pending);
            let json = c!("json", *pending);
            let error = c!("false");
            host.call("approvalContent", vec![error, text, json])
        }
        ("renderDeclined", [error]) => {
            let reason = host.get(*error, "reason")?;
            let text = if host.is_undefined(reason)? {
                c!("declinedText")
            } else {
                c!("declinedReason", *error)
            };
            let json = c!("declinedJson", *error);
            let error = c!("true");
            host.call("approvalContent", vec![error, text, json])
        }
        ("toolError", [error, report_path]) => {
            if yes(host, "isToolError", vec![*error])? {
                return Ok(*error);
            }
            if yes(host, "isHttp", vec![*error])? {
                let client = yes(host, "statusAtLeast400", vec![*error])?
                    && yes(host, "statusBelow500", vec![*error])?;
                let code = c!(if client {
                    "invalidParams"
                } else {
                    "internalError"
                });
                let envelope = c!("envelope", *error, *report_path);
                let message = host.get(envelope, "message")?;
                return host.call("errorWithData", vec![code, message, envelope]);
            }
            if yes(host, "isUserError", vec![*error])? {
                let code = c!("invalidParams");
                let message = host.get(*error, "message")?;
                return host.call("error", vec![code, message]);
            }
            let is_error = yes(host, "isError", vec![*error])?;
            let code = c!("internalError");
            let message = if is_error {
                host.get(*error, "message")?
            } else {
                c!("string", *error)
            };
            host.call("error", vec![code, message])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

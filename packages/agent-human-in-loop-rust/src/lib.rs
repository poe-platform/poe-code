//! Human approval policies over opaque Node values and capabilities.
pub mod host;
use host::Host;

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("request", [request]) => {
            let message = host.get(*request, "message")?;
            let string = host.call("string", vec![message])?;
            if !host.is_true(string)? {
                return host.call("blankMessage", vec![]);
            }
            let message = host.get(*request, "message")?;
            let blank = host.call("blank", vec![message])?;
            if host.is_true(blank)? {
                return host.call("blankMessage", vec![]);
            }
            let prompt = host.get(*request, "declineInputPrompt")?;
            if !host.is_undefined(prompt)? {
                let prompt = host.get(*request, "declineInputPrompt")?;
                let string = host.call("string", vec![prompt])?;
                if !host.is_true(string)? {
                    return host.call("invalidPrompt", vec![]);
                }
            }
            let prompt = host.get(*request, "declineInputPrompt")?;
            let message = host.get(*request, "message")?;
            if host.is_undefined(prompt)? {
                host.call("requestMessage", vec![message])
            } else {
                let prompt = host.get(*request, "declineInputPrompt")?;
                host.call("requestPrompt", vec![message, prompt])
            }
        }
        ("result", [result]) => {
            let object = host.call("objectRecord", vec![*result])?;
            if !host.is_true(object)? {
                return host.call("invalidResult", vec![]);
            }
            let outcome = host.call("ownOutcome", vec![*result])?;
            if host.is_kind(outcome, "approved")? {
                return host.call("approved", vec![]);
            }
            if host.is_kind(outcome, "declined")? {
                let reason = host.call("ownReason", vec![*result])?;
                if host.is_undefined(reason)? {
                    return host.call("declined", vec![]);
                }
                let string = host.call("string", vec![reason])?;
                if host.is_true(string)? {
                    return host.call("declinedReason", vec![reason]);
                }
            }
            host.call("invalidResult", vec![])
        }
        ("clone", [result]) => {
            let outcome = host.get(*result, "outcome")?;
            if host.is_kind(outcome, "approved")? {
                return host.call("approved", vec![]);
            }
            let reason = host.get(*result, "reason")?;
            if host.is_undefined(reason)? {
                return host.call("declined", vec![]);
            }
            let reason = host.get(*result, "reason")?;
            host.call("declinedReason", vec![reason])
        }
        ("options", [options]) => {
            let mut title = host.get(*options, "title")?;
            if host.is_nullish(title)? {
                title = host.call("defaultTitle", vec![])?;
            }
            let mut binary = host.get(*options, "binary")?;
            if host.is_nullish(binary)? {
                binary = host.call("defaultBinary", vec![])?;
            }
            host.call("options", vec![title, binary])
        }
        ("escape", [value]) => {
            let value = host.call("escapeSlashes", vec![*value])?;
            host.call("escapeQuotes", vec![value])
        }
        ("script", [request, title]) => {
            let message = host.get(*request, "message")?;
            let message = run(host, "escape", &[message])?;
            let title = run(host, "escape", &[*title])?;
            let prompt = host.get(*request, "declineInputPrompt")?;
            if host.is_undefined(prompt)? {
                return host.call("singleScript", vec![message, title]);
            }
            let prompt = host.get(*request, "declineInputPrompt")?;
            let prompt = run(host, "escape", &[prompt])?;
            host.call("reasonScript", vec![message, title, prompt])
        }
        ("stdout", [out]) => {
            let mut value = *out;
            for (ending, trim) in [
                ("endsCrlf", "trimTwo"),
                ("endsLf", "trimOne"),
                ("endsCr", "trimOne"),
            ] {
                let matches = host.call(ending, vec![*out])?;
                if host.is_true(matches)? {
                    value = host.call(trim, vec![*out])?;
                    break;
                }
            }
            if host.is_kind(value, "Approve")? || host.is_kind(value, "APPROVED")? {
                return host.call("approved", vec![]);
            }
            if host.is_kind(value, "Decline")? {
                return host.call("declined", vec![]);
            }
            let prefixed = host.call("declinePrefix", vec![value])?;
            if host.is_true(prefixed)? {
                let reason = host.call("reasonSuffix", vec![value])?;
                return if host.is_kind(reason, "")? {
                    host.call("declined", vec![])
                } else {
                    host.call("declinedReason", vec![reason])
                };
            }
            host.call("unexpected", vec![*out])
        }
        ("error", [error]) => {
            let missing = host.call("missingBinary", vec![*error])?;
            if host.is_true(missing)? {
                return host.call("binaryNotFound", vec![]);
            }
            let message = host.call("errorMessage", vec![*error])?;
            let stderr = host.call("optionalStderr", vec![*error])?;
            let cancelled = host.call("cancelled", vec![message, stderr])?;
            if host.is_true(cancelled)? {
                return host.call("declined", vec![]);
            }
            let mut stderr = host.get(*error, "stderr")?;
            if host.is_nullish(stderr)? {
                stderr = host.call("toString", vec![*error])?;
            }
            host.call("failed", vec![stderr])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

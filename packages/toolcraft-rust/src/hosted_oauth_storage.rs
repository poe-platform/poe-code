//! Hosted credential/interaction storage and update lifecycle policy.
//! The host retains opaque credentials, promise queues and cryptographic keys.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{ let args=vec![$($arg),*]; host.call($name,args)? }}; }
    macro_rules! g {
        ($value:expr,$key:expr) => {{
            let value = $value;
            host.get(value, $key)?
        }};
    }
    match (operation, args) {
        ("create", [options]) => {
            let development = g!(*options, "development");
            if !host.is_true(development)? {
                let message = host.literal(
                    "In-memory hosted OAuth storage requires explicit development mode.",
                )?;
                return host.call("error", vec![message]);
            }
            let state = c!("state");
            host.call("expose", vec![state])
        }
        ("getCredential" | "current", [state, subject]) => {
            let value = c!("get", g!(*state, "credentials"), *subject);
            if operation == "current" && host.is_undefined(value)? {
                let message =
                    host.literal("Provider credential is missing; reconnect required.")?;
                return host.call("error", vec![message]);
            }
            Ok(value)
        }
        ("setCredential", [state, subject, credential]) => {
            c!("set", g!(*state, "credentials"), *subject, *credential);
            host.call("undefined", vec![])
        }
        ("deleteCredential" | "deleteInteraction", [state, id]) => {
            let collection = if operation == "deleteCredential" {
                "credentials"
            } else {
                "interactions"
            };
            c!("delete", g!(*state, collection), *id);
            host.call("undefined", vec![])
        }
        ("setInteraction", [state, transaction]) => {
            let id = g!(*transaction, "id");
            let cloned = c!("clone", *transaction);
            c!("set", g!(*state, "interactions"), id, cloned);
            host.call("undefined", vec![])
        }
        ("getInteraction", [state, id]) => {
            let value = c!("get", g!(*state, "interactions"), *id);
            if host.is_undefined(value)? {
                Ok(value)
            } else {
                host.call("clone", vec![value])
            }
        }
        ("previous", [state, subject]) => {
            let previous = c!("get", g!(*state, "updates"), *subject);
            if host.is_nullish(previous)? {
                host.call("resolved", vec![])
            } else {
                Ok(previous)
            }
        }
        ("queue", [state, subject, next]) => {
            c!("set", g!(*state, "updates"), *subject, *next);
            host.call("undefined", vec![])
        }
        ("release", [state, subject, next]) => {
            let queued = c!("get", g!(*state, "updates"), *subject);
            if host.same(queued, *next)? {
                c!("delete", g!(*state, "updates"), *subject);
            }
            host.call("undefined", vec![])
        }
        ("key", [state]) => {
            let key = g!(*state, "signingKeyPromise");
            if host.is_nullish(key)? {
                let key = c!("createKey");
                c!("keepKey", *state, key);
                Ok(key)
            } else {
                Ok(key)
            }
        }
        ("subject", [state, provider, account]) => {
            host.call("subject", vec![*state, *provider, *account])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

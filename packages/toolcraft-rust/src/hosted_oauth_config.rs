//! Hosted OAuth URL, configuration and login field admission policies.
use crate::host::TextHost;
use crate::sdk_validation::yes;

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
    macro_rules! eq {
        ($value:expr,$text:expr) => {{
            let value = $value;
            let text = host.literal($text)?;
            host.same(value, text)?
        }};
    }
    macro_rules! error {
        ($text:expr) => {{
            let text = host.literal($text)?;
            return host.call("error", vec![text]);
        }};
    }
    macro_rules! optional {
        ($value:expr,$key:expr) => {{
            let value = $value;
            if host.is_nullish(value)? {
                c!("undefined")
            } else {
                g!(value, $key)
            }
        }};
    }
    macro_rules! or {
        ($value:expr,$fallback:expr) => {{
            let value = $value;
            if host.is_nullish(value)? {
                c!($fallback)
            } else {
                value
            }
        }};
    }
    match (operation, args) {
        ("isHosted", [value]) => {
            let matches = yes(host, "object", vec![*value])?
                && yes(host, "hasKind", vec![*value])?
                && eq!(g!(*value, "kind"), "hosted");
            host.call(if matches { "true" } else { "false" }, vec![])
        }
        ("url", [value]) => {
            let url = c!("url", *value);
            let hash = g!(url, "hash");
            let has_fragment = yes(host, "nonempty", vec![hash])?;
            if has_fragment || {
                let search = g!(url, "search");
                yes(host, "nonempty", vec![search])?
            } {
                error!("hosted OAuth publicUrl must not contain a query or fragment.");
            }
            let username = g!(url, "username");
            if yes(host, "nonempty", vec![username])? || {
                let password = g!(url, "password");
                yes(host, "nonempty", vec![password])?
            } {
                error!("hosted OAuth publicUrl must not contain credentials.");
            }
            if eq!(g!(url, "pathname"), "/") || {
                let path = g!(url, "pathname");
                yes(host, "endsSlash", vec![path])?
            } {
                error!(
                    "hosted OAuth publicUrl must contain a non-root path without a trailing slash."
                );
            }
            Ok(url)
        }
        ("invalidScope", [scope]) => {
            let invalid = yes(host, "empty", vec![*scope])?
                || {
                    let trimmed = c!("trim", *scope);
                    !host.same(trimmed, *scope)?
                }
                || {
                    let space = host.literal(" ")?;
                    let found = c!("includes", *scope, space);
                    yes(host, "truthy", vec![found])?
                };
            host.call(if invalid { "true" } else { "false" }, vec![])
        }
        ("errors", [config, production]) => {
            let errors = c!("array");
            let scopes = or!(
                optional!(g!(*config, "advanced"), "scopes"),
                "defaultScopes"
            );
            let mcp = host.literal("mcp")?;
            let found = c!("includes", scopes, mcp);
            if !yes(host, "truthy", vec![found])? {
                let message = host.literal("scopes containing required mcp scope")?;
                c!("push", errors, message);
            }
            let invalid = c!("invalidScopes", scopes);
            if yes(host, "truthy", vec![invalid])? {
                let message = host.literal("valid space-free scope names")?;
                c!("push", errors, message);
            }
            if yes(host, "truthy", vec![*production])? {
                let public_url = g!(*config, "publicUrl");
                let url = run(host, "url", &[public_url])?;
                if !eq!(g!(url, "protocol"), "https:") {
                    let message = host.literal("HTTPS publicUrl")?;
                    c!("push", errors, message);
                }
                for (capability, message) in [
                    ("durable", "durable storage"),
                    ("encryptedCredentials", "encrypted credentials"),
                    ("stableKeys", "stable signing and subject keys"),
                ] {
                    let value = g!(g!(g!(*config, "storage"), "capabilities"), capability);
                    if !yes(host, "truthy", vec![value])? {
                        let message = host.literal(message)?;
                        c!("push", errors, message);
                    }
                }
            }
            Ok(errors)
        }
        ("fieldName", [field]) => {
            if yes(host, "string", vec![*field])? {
                Ok(*field)
            } else {
                host.get(*field, "name")
            }
        }
        ("invalidName", [name]) => {
            let invalid = yes(host, "empty", vec![*name])?
                || eq!(*name, "signal")
                || eq!(*name, "csrf")
                || eq!(*name, "transaction");
            host.call(if invalid { "true" } else { "false" }, vec![])
        }
        ("invalidPath", [path, options]) => {
            if !yes(host, "startsSlash", vec![*path])? {
                return host.call("true", vec![]);
            }
            let value = g!(*options, "publicUrl");
            let url = run(host, "url", &[value])?;
            let public_path = g!(url, "pathname");
            host.call("reservedPath", vec![*path, public_path])
        }
        ("create", [options]) => {
            let name = g!(g!(*options, "provider"), "name");
            let trimmed = c!("trim", name);
            if yes(host, "empty", vec![trimmed])? {
                error!("provider.name is required.");
            }
            let interaction = optional!(g!(*options, "advanced"), "interaction");
            if host.is_undefined(interaction)? {
                let login = g!(g!(*options, "provider"), "login");
                if host.is_undefined(login)? || {
                    let connect = g!(g!(*options, "provider"), "connect");
                    host.is_undefined(connect)?
                } {
                    error!(
                        "provider.login and provider.connect are required without an advanced interaction."
                    );
                }
            }
            let login = g!(g!(*options, "provider"), "login");
            if !host.is_undefined(login)? {
                let fields = g!(g!(g!(*options, "provider"), "login"), "fields");
                if yes(host, "empty", vec![fields])? {
                    error!("provider.login.fields must contain at least one field.");
                }
            }
            let fields = or!(
                optional!(g!(g!(*options, "provider"), "login"), "fields"),
                "array"
            );
            let names = c!("fieldNames", fields);
            if yes(host, "differentSetSize", vec![names])? || {
                let invalid = c!("invalidNames", names);
                yes(host, "truthy", vec![invalid])?
            } {
                error!("provider.login.fields must have unique, non-reserved names.");
            }
            let interaction = optional!(g!(*options, "advanced"), "interaction");
            if !host.is_undefined(interaction)? {
                let paths = g!(g!(g!(*options, "advanced"), "interaction"), "paths");
                let empty = yes(host, "empty", vec![paths])?;
                let invalid = if empty {
                    true
                } else {
                    // Each source expression rereads the live options and paths.
                    let paths = g!(g!(g!(*options, "advanced"), "interaction"), "paths");
                    let size = c!("pathSetSize", paths);
                    let length = g!(
                        g!(g!(g!(*options, "advanced"), "interaction"), "paths"),
                        "length"
                    );
                    if !host.same(size, length)? {
                        true
                    } else {
                        let paths = g!(g!(g!(*options, "advanced"), "interaction"), "paths");
                        let invalid = c!("invalidPaths", paths, *options);
                        yes(host, "truthy", vec![invalid])?
                    }
                };
                if invalid {
                    error!(
                        "advanced.interaction.paths must contain unique, non-reserved absolute paths."
                    );
                }
            }
            let value = g!(*options, "publicUrl");
            run(host, "url", &[value])?;
            host.call("configuration", vec![*options])
        }
        ("prepare", [config, production]) => {
            let errors = run(host, "errors", &[*config, *production])?;
            if yes(host, "nonempty", vec![errors])? {
                return host.call("invalidConfiguration", vec![errors]);
            }
            let value = g!(*config, "publicUrl");
            let public_url = run(host, "url", &[value])?;
            // Construct the issuer before reading the live scopes, as the reference does.
            let issuer = c!("issuer", public_url);
            let scopes = or!(
                optional!(g!(*config, "advanced"), "scopes"),
                "defaultScopes"
            );
            host.call("prepared", vec![public_url, issuer, scopes])
        }
        ("loginField", [field]) => {
            if !yes(host, "string", vec![*field])? {
                return Ok(*field);
            }
            let label = if eq!(*field, "apiKey") {
                host.literal("API key")?
            } else {
                c!("fieldLabel", *field)
            };
            let kind = if eq!(*field, "password") || eq!(*field, "apiKey") {
                "password"
            } else if eq!(*field, "email") {
                "email"
            } else {
                "text"
            };
            let kind = host.literal(kind)?;
            host.call("field", vec![*field, label, kind])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

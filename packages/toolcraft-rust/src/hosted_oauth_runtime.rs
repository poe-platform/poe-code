//! Hosted OAuth runtime routing, admission, response and identity policies.
use crate::host::TextHost;
use crate::sdk_validation::yes;

pub trait RuntimeHost: TextHost {
    fn integer(&mut self, value: u32) -> Result<Self::Value, Self::Error>;
}

pub fn run<H: RuntimeHost>(
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
    macro_rules! error {
        ($message:expr) => {{
            let message = host.literal($message)?;
            return host.call("error", vec![message]);
        }};
    }
    match (operation, args) {
        ("state", [config, prepared]) => {
            let fields = optional!(g!(g!(*config, "provider"), "login"), "fields");
            let fields = if host.is_nullish(fields)? {
                c!("array")
            } else {
                fields
            };
            let fields = c!("fields", fields);
            let custom = optional!(g!(*config, "advanced"), "interaction");
            let title = optional!(optional!(g!(*config, "advanced"), "branding"), "title");
            let title = if host.is_nullish(title)? {
                g!(g!(*config, "provider"), "name")
            } else {
                title
            };
            host.call("state", vec![*config, *prepared, fields, custom, title])
        }
        ("start", [state, request, transaction]) => {
            let custom = g!(*state, "customInteraction");
            if !host.is_undefined(custom)? {
                return host.call("customStart", vec![custom, *request, *transaction]);
            }
            let security = c!("security", *transaction);
            let title = g!(*state, "displayName");
            let fields = g!(*state, "fields");
            let csrf = g!(security, "csrfToken");
            let login = c!("render", title, fields, *transaction, csrf);
            let html = g!(login, "html");
            let status = host.integer(200)?;
            let csp = g!(login, "contentSecurityPolicy");
            let cookie = g!(security, "setCookie");
            let headers = c!("startHeaders", csp, cookie);
            host.call("response", vec![html, status, headers])
        }
        ("prefix", [state]) => {
            let prepared = g!(*state, "prepared");
            let issuer = g!(g!(prepared, "issuer"), "href");
            let resource = g!(g!(prepared, "publicUrl"), "href");
            let supported = g!(prepared, "scopes");
            let defaults = g!(prepared, "scopes");
            host.call("prefix", vec![issuer, resource, supported, defaults])
        }
        ("options", [state, prefix, key]) => {
            let config = g!(*state, "config");
            let jwks = optional!(g!(config, "advanced"), "additionalPublicJwks");
            let store = g!(g!(config, "storage"), "authorizationServer");
            let interaction = g!(*state, "interaction");
            let access = optional!(g!(config, "advanced"), "accessTokenTtlSeconds");
            let code = optional!(g!(config, "advanced"), "authorizationCodeTtlSeconds");
            let transaction =
                optional!(g!(config, "advanced"), "authorizationTransactionTtlSeconds");
            let refresh = optional!(g!(config, "advanced"), "refreshTokenTtlSeconds");
            let revoked = g!(g!(config, "storage"), "onGrantRevoked");
            host.call(
                "options",
                vec![
                    *prefix,
                    *key,
                    jwks,
                    store,
                    interaction,
                    access,
                    code,
                    transaction,
                    refresh,
                    revoked,
                ],
            )
        }
        ("runtime", [state, server]) => {
            let prepared = g!(*state, "prepared");
            let path = g!(g!(prepared, "publicUrl"), "pathname");
            let resource = g!(g!(prepared, "publicUrl"), "href");
            let issuer = g!(*server, "issuer");
            let required = host.literal("mcp")?;
            let scopes = c!("copy", g!(prepared, "scopes"));
            host.call(
                "runtime",
                vec![*state, *server, path, resource, issuer, required, scopes],
            )
        }
        ("verified", [server, input, verified]) => {
            let token = g!(*input, "token");
            let issuer = g!(*server, "issuer");
            let resource = g!(*verified, "resource");
            let scopes = c!("copy", g!(*verified, "scopes"));
            let expires = g!(*verified, "expiresAt");
            let sub = g!(*verified, "subject");
            let client_claim = g!(*verified, "clientId");
            let jti = g!(*verified, "tokenId");
            let subject = g!(*verified, "subject");
            let client = g!(*verified, "clientId");
            host.call(
                "verified",
                vec![
                    token,
                    issuer,
                    resource,
                    scopes,
                    expires,
                    sub,
                    client_claim,
                    jti,
                    subject,
                    client,
                ],
            )
        }
        ("requestUrl", [state, request]) => {
            let prepared = g!(*state, "prepared");
            host.call("requestUrl", vec![*request, prepared])
        }
        ("route", [state, request, url]) => {
            if eq!(g!(*request, "method"), "GET") && eq!(g!(*url, "pathname"), "/healthz") {
                return host.literal("health");
            }
            let custom = g!(*state, "customInteraction");
            if yes(host, "customPath", vec![custom, *url])? {
                return host.literal("custom");
            }
            if eq!(g!(*request, "method"), "POST") && eq!(g!(*url, "pathname"), "/oauth/connect") {
                return host.literal("form");
            }
            let paths = c!("array");
            for path in [
                "/.well-known/oauth-authorization-server",
                "/.well-known/jwks.json",
                "/authorize",
                "/register",
                "/token",
                "/revoke",
            ] {
                let path = host.literal(path)?;
                c!("push", paths, path);
            }
            let paths = c!("pathSet", paths);
            let supported = yes(host, "hasPath", vec![paths, *url])?;
            host.literal(if supported { "oauth" } else { "unhandled" })
        }
        ("customBody", [request]) => {
            let body = !(eq!(g!(*request, "method"), "GET") || eq!(g!(*request, "method"), "HEAD"));
            host.call(if body { "true" } else { "false" }, vec![])
        }
        ("oauthBody", [request]) => {
            let body = eq!(g!(*request, "method"), "POST");
            host.call(if body { "true" } else { "false" }, vec![])
        }
        ("health", [response, healthy]) => {
            let method = g!(*response, "writeHead");
            let healthy = host.is_true(*healthy)?;
            let status = host.integer(if healthy { 200 } else { 503 })?;
            let headers = c!("healthHeaders");
            c!("head", method, *response, status, headers);
            let body = host.literal(if healthy {
                "{\"ok\":true}"
            } else {
                "{\"ok\":false}"
            })?;
            c!("end", *response, body);
            host.call("undefined", vec![])
        }
        ("formValue", [body, key]) => {
            let value = c!("formValue", *body, *key);
            if host.is_nullish(value)? {
                host.literal("")
            } else {
                Ok(value)
            }
        }
        ("valid", [request, transaction, id, csrf]) => {
            let valid = !host.is_undefined(*transaction)?
                && yes(host, "csrf", vec![*request, *csrf, *id])?
                && {
                    let expires = g!(*transaction, "expiresAt");
                    !yes(host, "expiredAt", vec![expires])?
                };
            host.call(if valid { "true" } else { "false" }, vec![])
        }
        ("expired", [response]) => {
            let method = g!(*response, "writeHead");
            let status = host.integer(400)?;
            let csp=host.literal("default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")?;
            let headers = c!("loginHeaders", csp);
            c!("head", method, *response, status, headers);
            let html = c!("expired");
            c!("end", *response, html);
            host.call("undefined", vec![])
        }
        ("values", [state, request, body]) => {
            let fields = g!(*state, "fields");
            host.call("values", vec![*request, fields, *body])
        }
        ("connect", [state, values]) => {
            let connect = g!(g!(g!(*state, "config"), "provider"), "connect");
            if host.is_undefined(connect)? {
                error!("Provider form connection is not configured.");
            }
            host.call("connect", vec![connect, *values])
        }
        ("connected", [connected]) => {
            let account = g!(*connected, "accountId");
            if yes(host, "emptyAccount", vec![account])? {
                error!("Provider returned an empty accountId.");
            }
            host.call("undefined", vec![])
        }
        ("redirect", [response, completed]) => {
            let method = g!(*response, "writeHead");
            let status = host.integer(303)?;
            let location = g!(g!(*completed, "redirectUrl"), "href");
            let headers = c!("redirectHeaders", location);
            c!("head", method, *response, status, headers);
            c!("end", *response);
            host.call("undefined", vec![])
        }
        ("redirectResponse", [completed]) => {
            let constructor = c!("responseConstructor");
            let status = host.integer(303)?;
            let location = g!(g!(*completed, "redirectUrl"), "href");
            let headers = c!("redirectHeaders", location);
            host.call("redirectResponse", vec![constructor, status, headers])
        }
        ("failure", [state, response, transaction, csrf, error, values]) => {
            let safe = if yes(host, "loginError", vec![*error])? {
                g!(*error, "message")
            } else {
                host.literal("Sign-in failed. Please try again.")?
            };
            let title = g!(*state, "displayName");
            let fields = g!(*state, "fields");
            let login = c!("render", title, fields, *transaction, *csrf, safe, *values);
            let method = g!(*response, "writeHead");
            let status = host.integer(400)?;
            let csp = g!(login, "contentSecurityPolicy");
            let headers = c!("loginHeaders", csp);
            c!("head", method, *response, status, headers);
            let html = g!(login, "html");
            c!("end", *response, html);
            host.call("undefined", vec![])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

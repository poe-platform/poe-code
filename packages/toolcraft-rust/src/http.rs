//! Public HTTP adapter policies, authorization projection and hosted path admission.
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
    macro_rules! put {
        ($object:expr,$key:expr,$value:expr) => {{
            let key = host.literal($key)?;
            let value = $value;
            c!("set", $object, key, value);
        }};
    }
    macro_rules! error {
        ($message:expr) => {{
            let message = host.literal($message)?;
            return host.call("error", vec![message]);
        }};
    }
    match (operation, args) {
        ("authorization", [options]) => {
            let issuer = g!(g!(*options, "authorizationServer"), "issuer");
            let resource = c!("resource", *options);
            let required = g!(*options, "requiredScopes");
            let supported = g!(*options, "scopesSupported");
            let supported = if host.is_nullish(supported)? {
                g!(*options, "requiredScopes")
            } else {
                supported
            };
            host.call(
                "authorization",
                vec![*options, issuer, resource, required, supported],
            )
        }
        ("verify", [input, issuer, resource]) => {
            let issuers = g!(*input, "authorizationServers");
            if !yes(host, "one", vec![issuers])? || {
                let candidate = g!(g!(*input, "authorizationServers"), "0");
                !host.same(candidate, *issuer)?
            } {
                error!("authorization server issuer does not match");
            }
            let candidate = c!("resource", *input);
            if !host.same(candidate, *resource)? {
                error!("protected resource does not match");
            }
            host.call("undefined", vec![])
        }
        ("verified", [token, issuer, verified]) => {
            let resource = g!(*verified, "resource");
            let scopes = c!("scopes", g!(*verified, "scopes"));
            let expires = g!(*verified, "expiresAt");
            let subject_claim = g!(*verified, "subject");
            let client_claim = g!(*verified, "clientId");
            let audience_claim = g!(*verified, "resource");
            let token_claim = g!(*verified, "tokenId");
            let subject = g!(*verified, "subject");
            let client = g!(*verified, "clientId");
            host.call(
                "verified",
                vec![
                    *token,
                    *issuer,
                    resource,
                    scopes,
                    expires,
                    subject_claim,
                    client_claim,
                    audience_claim,
                    token_claim,
                    subject,
                    client,
                ],
            )
        }
        ("transport", [options, server_options]) => {
            let output = c!("copy", *server_options);
            put!(
                output,
                "toolCallTimeoutMs",
                g!(*options, "toolCallTimeoutMs")
            );
            let key = host.literal("sessionIdGenerator")?;
            if yes(host, "owns", vec![*options, key])? {
                put!(
                    output,
                    "sessionIdGenerator",
                    g!(*options, "sessionIdGenerator")
                );
            }
            for key in [
                "enableJsonResponse",
                "allowedOrigins",
                "allowedHosts",
                "maxRequestBytes",
                "maxResponseBytes",
                "maxBatchSize",
                "maxSessions",
                "maxSessionsPerSubject",
                "sessionTtlMs",
                "maxStreamsPerSession",
                "maxStreamBufferBytes",
                "maxSseEventHistory",
                "sseKeepAliveMs",
                "maxConcurrentToolCalls",
                "maxQueuedToolCalls",
                "sessionStore",
                "requestIdGenerator",
                "observability",
                "trustedProxy",
                "oauth",
                "requestHandler",
            ] {
                let value = host.get(*options, key)?;
                let key = host.literal(key)?;
                c!("set", output, key, value);
            }
            Ok(output)
        }
        ("listen", [options]) => {
            let output = c!("object");
            for key in [
                "hostname",
                "port",
                "path",
                "signal",
                "requestTimeoutMs",
                "headersTimeoutMs",
                "keepAliveTimeoutMs",
            ] {
                let value = host.get(*options, key)?;
                let key = host.literal(key)?;
                c!("set", output, key, value);
            }
            Ok(output)
        }
        ("hosted", [options]) => {
            let oauth = g!(*options, "oauth");
            host.call("hosted", vec![oauth])
        }
        ("resolved", [options, runtime]) => {
            let application = g!(*options, "requestServices");
            let path = g!(*runtime, "mcpPath");
            let session = c!("undefined");
            let json = c!("true");
            host.call(
                "resolved",
                vec![*options, *runtime, application, path, session, json],
            )
        }
        ("subject", [context]) => {
            let auth = g!(*context, "auth");
            let subject = if host.is_nullish(auth)? {
                c!("undefined")
            } else {
                g!(auth, "subject")
            };
            if host.is_undefined(auth)? || host.is_undefined(subject)? {
                error!("Hosted OAuth request is missing a verified subject.");
            }
            host.call("subject", vec![auth, subject])
        }
        ("hasApplication", [application]) => host.call(
            if host.is_undefined(*application)? {
                "false"
            } else {
                "true"
            },
            vec![],
        ),
        ("identity", [identity]) => {
            let auth = g!(*identity, "auth");
            let issuer = g!(auth, "issuer");
            let subject = g!(*identity, "subject");
            let client = g!(auth, "clientId");
            let scopes = g!(auth, "scopes");
            let resource = g!(g!(auth, "resource"), "href");
            host.call("identity", vec![issuer, subject, client, scopes, resource])
        }
        ("streaming", [options]) => {
            let key = host.literal("sessionIdGenerator")?;
            let supported = !yes(host, "owns", vec![*options, key])? || {
                let generator = g!(*options, "sessionIdGenerator");
                !host.is_undefined(generator)?
            };
            host.call(if supported { "true" } else { "false" }, vec![])
        }
        ("finish", [server, path]) => {
            if host.is_undefined(*server)? {
                error!("Toolcraft HTTP MCP server was not created.");
            }
            if !host.is_undefined(*path)? {
                c!("wrap", *server, *path);
            }
            Ok(*server)
        }
        ("hostedListen", [options, path]) => {
            let candidate = g!(*options, "path");
            if !host.is_undefined(candidate)? {
                let leading = yes(host, "startsSlash", vec![*options])?;
                let candidate = g!(*options, "path");
                let leading = if leading {
                    candidate
                } else {
                    c!("prefix", candidate)
                };
                let normalized = if yes(host, "long", vec![leading])?
                    && yes(host, "endsSlash", vec![leading])?
                {
                    c!("trimSlash", leading)
                } else {
                    leading
                };
                if !host.same(normalized, *path)? {
                    return host.call("conflict", vec![normalized, *path]);
                }
            }
            host.call("listen", vec![*options, *path])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

//! Hosted OAuth HTTP conversion, bounded body admission and credential policies.
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
    match (operation, args) {
        ("chunk", [state, chunk, limit]) => {
            let buffer = if yes(host, "isBuffer", vec![*chunk])? {
                *chunk
            } else {
                c!("buffer", *chunk)
            };
            let length = g!(buffer, "length");
            let size = c!("addSize", *state, length);
            if yes(host, "exceeds", vec![size, *limit])? {
                let message = host.literal("Request body is too large.")?;
                return host.call("error", vec![message]);
            }
            c!("retain", *state, buffer);
            host.call("undefined", vec![])
        }
        ("body", [state]) => host.call("concat", vec![*state]),
        ("header", [headers, name, value]) => {
            if !host.is_undefined(*value)? {
                let value = if yes(host, "isArray", vec![*value])? {
                    c!("join", *value)
                } else {
                    *value
                };
                c!("setHeader", *headers, *name, value);
            }
            host.call("undefined", vec![])
        }
        ("request", [request, issuer, body]) => {
            let headers = c!("headers");
            let source = g!(*request, "headers");
            c!("eachHeader", source, headers);
            let request_constructor = c!("requestConstructor");
            let url_constructor = c!("urlConstructor");
            let path = g!(*request, "url");
            let path = if host.is_nullish(path)? {
                host.literal("/")?
            } else {
                path
            };
            let url = c!("url", url_constructor, path, *issuer);
            let method = g!(*request, "method");
            let mut options = c!("options", method, headers);
            if !host.is_undefined(*body)? && yes(host, "nonempty", vec![*body])? {
                let body = c!("utf8", *body);
                options = c!("body", options, body);
            }
            host.call("request", vec![request_constructor, url, options])
        }
        ("response", [response, web_response]) => {
            let headers = g!(*web_response, "headers");
            c!("responseHeaders", headers, *response);
            let status = g!(*web_response, "status");
            c!("status", *response, status);
            host.call("responseBody", vec![*response, *web_response])
        }
        ("credentials", [storage, subject]) => host.call("credentials", vec![*storage, *subject]),
        ("credential", [credential]) => {
            if host.is_undefined(*credential)? {
                let message =
                    host.literal("Provider credential is missing; reconnect required.")?;
                host.call("error", vec![message])
            } else {
                Ok(*credential)
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

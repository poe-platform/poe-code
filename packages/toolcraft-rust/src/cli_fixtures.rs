//! Fixture scenario selection, capability construction and matching policy.
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
    macro_rules! plain {
        ($value:expr) => {{
            let value = $value;
            let result = crate::cli_presets::run(host, "plain", &[value])?;
            host.is_true(result)?
        }};
    }
    match (operation, args) {
        ("httpMethod", [value]) => {
            let value = if host.is_nullish(*value)? {
                host.literal("GET")?
            } else {
                *value
            };
            host.call("upper", vec![value])
        }
        ("readLike" | "writeLike", [name]) => {
            let name = c!("lower", *name);
            let (exact, prefixes): (&[&'static str], &[&'static str]) = if operation == "readLike" {
                (
                    &["get", "head", "options"],
                    &[
                        "read", "get", "find", "list", "load", "fetch", "query", "exists", "has",
                    ],
                )
            } else {
                (
                    &["post", "put", "patch", "delete"],
                    &[
                        "write", "set", "save", "create", "update", "delete", "remove", "insert",
                    ],
                )
            };
            for word in exact {
                if host.is_kind(name, word)? {
                    return host.call("true", vec![]);
                }
            }
            let mut result = c!("false");
            for prefix in prefixes {
                let prefix = host.literal(prefix)?;
                result = c!("prefix", name, prefix);
                if yes!(result) {
                    return Ok(result);
                }
            }
            Ok(result)
        }
        ("matches", [expected, actual]) => {
            if yes!(c!("isString", *expected))
                && yes!(c!("isString", *actual))
                && yes!(c!("wildcard", *expected))
            {
                return host.call("matchPrefix", vec![*expected, *actual]);
            }
            if yes!(c!("isArray", *expected)) {
                if !yes!(c!("isArray", *actual)) || !yes!(c!("sameLength", *expected, *actual)) {
                    return host.call("false", vec![]);
                }
                return host.call("arrayMatches", vec![*expected, *actual]);
            }
            if plain!(*expected) {
                if !plain!(*actual) {
                    return host.call("false", vec![]);
                }
                return host.call("objectMatches", vec![*expected, *actual]);
            }
            host.call("same", vec![*expected, *actual])
        }
        ("url", [input]) => {
            if yes!(c!("isString", *input)) {
                return Ok(*input);
            }
            if yes!(c!("isUrl", *input)) {
                host.call("urlString", vec![*input])
            } else {
                host.get(*input, "url")
            }
        }
        ("response", [response]) => {
            let status = g!(*response, "status");
            let status = if host.is_nullish(status)? {
                c!("status")
            } else {
                status
            };
            let headers = c!("headers", *response);
            if undefined!(g!(*response, "body")) {
                return host.call("nullResponse", vec![status, headers]);
            }
            if yes!(c!("isString", g!(*response, "body"))) {
                return host.call("stringResponse", vec![*response, status, headers]);
            }
            if !yes!(c!("hasContentType", headers)) {
                c!("setContentType", headers);
            }
            host.call("jsonResponse", vec![*response, status, headers])
        }
        ("fetch", [entries]) => host.call("fetch", vec![*entries]),
        ("fetchCall", [entries, input, init]) => {
            let method = c!("initMethod", *init);
            let method = if host.is_nullish(method)? {
                if yes!(c!("isRequest", *input)) {
                    g!(*input, "method")
                } else {
                    c!("undefined")
                }
            } else {
                method
            };
            let method = run(host, "httpMethod", &[method])?;
            let url = run(host, "url", &[*input])?;
            let matched = if host.is_nullish(*entries)? {
                c!("undefined")
            } else {
                c!("entriesFind", *entries, method, url)
            };
            if !host.is_undefined(matched)? {
                let response = g!(matched, "response");
                return run(host, "response", &[response]);
            }
            if yes!(run(host, "readLike", &[method])?) {
                host.call("null", vec![])
            } else {
                host.call("noContent", vec![])
            }
        }
        ("fetchEntry", [entry, method, url]) => {
            let request_method = g!(g!(*entry, "request"), "method");
            let request_method = run(host, "httpMethod", &[request_method])?;
            if host.same(request_method, *method)? {
                let request_url = g!(g!(*entry, "request"), "url");
                host.call(
                    if host.same(request_url, *url)? {
                        "true"
                    } else {
                        "false"
                    },
                    vec![],
                )
            } else {
                host.call("false", vec![])
            }
        }
        ("fs", [definition]) => {
            let definition = if plain!(*definition) {
                *definition
            } else {
                c!("object")
            };
            let read = g!(definition, "readFile");
            let read = if plain!(read) {
                g!(definition, "readFile")
            } else {
                c!("object")
            };
            let exists = g!(definition, "exists");
            let exists = if plain!(exists) {
                g!(definition, "exists")
            } else {
                c!("object")
            };
            host.call("filesystem", vec![read, exists])
        }
        ("readFile", [entries, path]) => {
            if yes!(c!("own", *entries, *path)) {
                host.call("readString", vec![*entries, *path])
            } else {
                host.call("null", vec![])
            }
        }
        ("exists", [read, exists, path]) => {
            if yes!(c!("own", *exists, *path)) {
                host.call("readBoolean", vec![*exists, *path])
            } else {
                host.call("own", vec![*read, *path])
            }
        }
        ("methodEntry", [entry, args]) => {
            if !plain!(*entry) {
                return host.call("step:skip", vec![]);
            }
            let request = g!(*entry, "request");
            let explicit = if plain!(request) {
                g!(*entry, "request")
            } else {
                c!("undefined")
            };
            let matcher = if host.is_nullish(explicit)? {
                c!("implicitMatcher", *entry)
            } else {
                explicit
            };
            let first = c!("first", *args);
            let matched = if yes!(c!("isArray", g!(matcher, "args"))) {
                let expected = g!(matcher, "args");
                run(host, "matches", &[expected, *args])?
            } else if yes!(c!("noKeys", matcher)) {
                c!("true")
            } else if plain!(first) {
                run(host, "matches", &[matcher, first])?
            } else if yes!(c!("singleArg", *args)) && yes!(c!("singleKey", matcher)) {
                let expected = c!("expected", matcher);
                run(host, "matches", &[expected, first])?
            } else {
                c!("false")
            };
            if !yes!(matched) {
                return host.call("step:skip", vec![]);
            }
            if !undefined!(g!(*entry, "error")) {
                return host.call("methodError", vec![*entry]);
            }
            for key in ["result", "response"] {
                let key = host.literal(key)?;
                if yes!(c!("own", *entry, key)) {
                    let result = c!("resolveProperty", *entry, key);
                    return host.call("step:matched", vec![result]);
                }
            }
            let result = c!("resolveNull");
            host.call("step:matched", vec![result])
        }
        ("methodResult", [name, definition, args]) => {
            if yes!(c!("isArray", *definition)) {
                let step = c!("methodEntries", *definition, *args);
                let kind = g!(step, "kind");
                if host.is_kind(kind, "matched")? {
                    return host.get(step, "value");
                }
            }
            if plain!(*definition) {
                let first = c!("first", *args);
                if yes!(c!("isString", first)) && yes!(c!("own", *definition, first)) {
                    return host.call("resolveProperty", vec![*definition, first]);
                }
            }
            if yes!(run(host, "writeLike", &[*name])?) {
                host.call("resolveUndefined", vec![])
            } else {
                host.call("resolveNull", vec![])
            }
        }
        ("service", [definition]) => {
            let methods = if plain!(*definition) {
                *definition
            } else {
                c!("object")
            };
            host.call("service", vec![methods])
        }
        ("serviceProperty", [methods, property]) => {
            if host.is_kind(*property, "then")? {
                return host.call("undefined", vec![]);
            }
            let name = c!("string", *property);
            host.call("method", vec![*methods, name])
        }
        ("path", [command_path]) => {
            let parsed = c!("parsePath", *command_path);
            host.call("fixturePath", vec![parsed])
        }
        ("scenario", [scenarios, selector, path]) => {
            if yes!(c!("numeric", *selector)) {
                let scenario = c!("indexed", *scenarios, *selector);
                if host.is_undefined(scenario)? {
                    return host.call("outOfRange", vec![*scenarios, *selector]);
                }
                return Ok(scenario);
            }
            let scenario = c!("named", *scenarios, *selector);
            if !host.is_undefined(scenario)? {
                return Ok(scenario);
            }
            let names = c!("names", *scenarios);
            let available = if yes!(c!("empty", names)) {
                c!("noFixtures", *path)
            } else {
                c!("available", names)
            };
            host.call("missingScenario", vec![*selector, available])
        }
        ("loadStart", [command]) => {
            let source = c!("source", *command);
            if host.is_undefined(source)? {
                return host.call("noSource", vec![*command]);
            }
            run(host, "path", &[source])
        }
        ("missingFile", [command, path]) => host.call("missingFile", vec![*command, *path]),
        ("loadResult", [raw, selector, path]) => {
            let parsed = c!("parse", *raw);
            let ok = g!(parsed, "ok");
            if !host.is_true(ok)? {
                let error = g!(parsed, "error");
                return host.call("jsonError", vec![*path, *raw, error]);
            }
            let value = g!(parsed, "value");
            if !yes!(c!("isArray", value)) {
                return host.call("notScenarios", vec![*path]);
            }
            run(host, "scenario", &[value, *selector, *path])
        }
        ("secrets", [command]) => {
            let value = host.literal("fixture-secret")?;
            host.call("secrets", vec![*command, value])
        }
        ("envFallback", [value]) => {
            if host.is_nullish(*value)? {
                host.literal("fixture-secret")
            } else {
                Ok(*value)
            }
        }
        ("env", [command]) => {
            let values = c!("envBase");
            c!("envSecrets", values, *command);
            Ok(values)
        }
        ("selector", [embedded]) => {
            if yes!(*embedded) {
                host.call("undefined", vec![])
            } else {
                host.call("selector", vec![])
            }
        }
        ("runtimeStart", [state, selector]) => {
            if host.is_undefined(*selector)? || yes!(c!("empty", *selector)) {
                let runtime = c!("normalRuntime", *state);
                host.call("step:return", vec![runtime])
            } else {
                let pending = c!("load", *state, *selector);
                host.call("step:scenario", vec![pending])
            }
        }
        ("runtimeResult", [state, scenario]) => {
            let services = g!(*scenario, "services");
            let services = if plain!(services) {
                g!(*scenario, "services")
            } else {
                c!("object")
            };
            let names = c!("serviceNames", g!(*state, "services"), services);
            let fixture_services = c!("services", names, services);
            let command = g!(*state, "command");
            let env = run(host, "env", &[command])?;
            host.call(
                "fixtureRuntime",
                vec![*state, services, fixture_services, env],
            )
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

//! Public MCP assembly and startup policy.
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
        ("prepare", [roots, options]) => {
            let normalized = c!("normalize", *roots);
            let root = c!("merge", normalized, *options);
            let approval = g!(*options, "humanInLoop");
            c!("wired", root, approval);
            Ok(root)
        }
        ("create", [roots, options]) => {
            let root = run(host, "prepare", &[*roots, *options])?;
            let proxy = yes(host, "proxies", vec![root])?;
            host.call(
                if proxy { "deferred" } else { "resolved" },
                vec![root, *options],
            )
        }
        ("isStream", [tool]) => {
            let stream = g!(g!(*tool, "command"), "stream");
            host.call(
                if host.is_undefined(stream)? {
                    "false"
                } else {
                    "true"
                },
                vec![],
            )
        }
        ("version", [version]) => {
            let value = if host.is_nullish(*version)? {
                c!("entryVersion")
            } else {
                *version
            };
            if host.is_undefined(value)? {
                host.call("missingVersion", vec![])
            } else {
                Ok(value)
            }
        }
        ("resolved", [root, options, runtime]) => {
            let runtime = if host.is_undefined(*runtime)? {
                c!("object")
            } else {
                *runtime
            };
            let state = c!("state", *root, *options, runtime);
            let casing = g!(*options, "casing");
            let casing = if host.is_nullish(casing)? {
                host.literal("snake")?
            } else {
                casing
            };
            keep!(state, "casing", casing);
            let services = g!(*options, "services");
            let services = if host.is_nullish(services)? {
                c!("object")
            } else {
                services
            };
            keep!(state, "services", services);
            let approval = g!(*options, "humanInLoop");
            keep!(state, "humanInLoop", approval);
            let fetch = g!(*options, "fetch");
            let fetch = if host.is_nullish(fetch)? {
                c!("globalFetch")
            } else {
                fetch
            };
            keep!(state, "runtimeFetch", fetch);
            let diagnostics = c!("diagnostics", *options);
            keep!(state, "diagnostics", diagnostics);
            c!("validateServices", services);
            let tools = c!("enumerate", state);
            keep!(state, "tools", tools);
            let streams = c!("streamTools", tools);
            keep!(state, "streamTools", streams);
            let supported = g!(runtime, "supportsStreaming");
            let no = c!("false");
            if host.same(supported, no)? && yes(host, "hasItems", vec![streams])? {
                return host.call("unsupported", vec![streams]);
            }
            let version = g!(*options, "version");
            let version = run(host, "version", &[version])?;
            let server = c!("customServer", state, version);
            let server = if host.is_nullish(server)? {
                c!("defaultServer", state, version)
            } else {
                server
            };
            keep!(state, "server", server);
            c!("streams", state);
            c!("tools", state);
            host.call("exposed", vec![state])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

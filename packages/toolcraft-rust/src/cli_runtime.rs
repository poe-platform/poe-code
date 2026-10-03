//! Public CLI orchestration; asynchronous host work retains its original awaits.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! r { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];run(host,$name,&args)?}}; }
    macro_rules! g {
        ($value:expr,$key:expr) => {{
            let value = $value;
            host.get(value, $key)?
        }};
    }
    macro_rules! yes {
        ($value:expr) => {{
            let value = $value;
            let result = c!("truthy", value);
            host.is_true(result)?
        }};
    }
    macro_rules! strict {
        ($value:expr) => {{
            let value = $value;
            host.is_true(value)?
        }};
    }
    macro_rules! undef {
        ($value:expr) => {{
            let value = $value;
            host.is_undefined(value)?
        }};
    }
    macro_rules! literal {
        ($value:expr) => {
            host.literal($value)?
        };
    }
    macro_rules! keep {
        ($state:expr,$key:expr,$value:expr) => {{
            let value = $value;
            let key = literal!($key);
            c!("keep", $state, key, value);
        }};
    }
    match (operation, args) {
        ("initialize", [roots, options, invocation]) => {
            let controls = c!("controls", g!(*options, "controls"));
            let argv = c!("argv", *options);
            let usage = g!(*options, "rootUsageName");
            let usage = if host.is_nullish(usage)? {
                c!("inferName", argv)
            } else {
                usage
            };
            host.call(
                "state",
                vec![*roots, *options, *invocation, controls, argv, usage],
            )
        }
        ("root", [state]) => {
            let normalized = c!("normalize", g!(*state, "roots"), g!(*state, "argv"));
            let root = c!("merge", normalized, g!(*state, "options"));
            keep!(*state, "root", root);
            c!(
                "assertWired",
                root,
                g!(g!(*state, "options"), "humanInLoop")
            );
            if yes!(c!("hasProxy", root)) {
                if yes!(g!(*state, "invocation")) {
                    return host.call("embeddedProxy", vec![]);
                }
                return host.call("step:proxy", vec![]);
            }
            host.call("step:ready", vec![])
        }
        ("proxyReady", [state, proxy]) => host.call("proxyCleanup", vec![*state, *proxy]),
        ("prepare", [state]) => {
            let options = g!(*state, "options");
            let casing = g!(options, "casing");
            let casing = if host.is_nullish(casing)? {
                literal!("kebab")
            } else {
                casing
            };
            keep!(*state, "casing", casing);
            keep!(*state, "services", c!("services", options));
            keep!(*state, "humanInLoop", g!(options, "humanInLoop"));
            keep!(*state, "runtimeFetch", c!("runtimeFetch", options));
            let version = g!(options, "version");
            let version = if host.is_nullish(version)? {
                if yes!(g!(*state, "invocation")) {
                    c!("undefined")
                } else {
                    c!("metadata", *state)
                }
            } else {
                version
            };
            keep!(*state, "version", version);
            keep!(*state, "servicesWithBuiltIns", c!("builtIns", *state));
            keep!(*state, "requirementOptions", c!("requirements", options));
            c!("validateServices", g!(*state, "services"));
            if yes!(c!("noArgs", g!(*state, "argv")))
                && !strict!(c!("defaultCli", g!(*state, "root")))
            {
                keep!(*state, "userErrorPattern", literal!("usage"));
                let pending = c!("help", *state, g!(*state, "argv"));
                return host.call("step:help", vec![pending]);
            }
            host.call("step:ready", vec![])
        }
        ("commands", [state]) => {
            let program = c!("program");
            keep!(*state, "program", program);
            c!("name", program, g!(*state, "root"));
            c!("exitOverride", program);
            c!("showHelp", program);
            c!("noHelpCommand", program);
            let presets = strict!(g!(g!(*state, "options"), "presets"));
            let presets = c!(if presets { "true" } else { "false" });
            keep!(*state, "presetsEnabled", presets);
            let has_version = !undef!(g!(*state, "version"));
            let has_version = c!(if has_version { "true" } else { "false" });
            let globals = c!("globals", presets, has_version, g!(*state, "controls"));
            keep!(*state, "globalLongOptionFlags", globals);
            keep!(*state, "fieldLoaders", c!("loaders"));
            c!("addGlobals", program, presets, g!(*state, "controls"));
            if !undef!(g!(*state, "version")) {
                c!("version", program, g!(*state, "version"));
            }
            c!("reserved", program, g!(*state, "root"));
            keep!(*state, "execute", c!("action", *state));
            keep!(
                *state,
                "rootChildNames",
                c!("childNames", g!(*state, "root"))
            );
            c!("children", *state);
            c!("configure", program, g!(*state, "version"));
            if yes!(g!(*state, "invocation")) {
                c!("configureInvocation", program, g!(*state, "invocation"));
            }
            let prepared = c!("prepare", *state);
            keep!(*state, "argv", g!(prepared, "argv"));
            if !undef!(g!(prepared, "helpArgv")) {
                keep!(*state, "userErrorPattern", literal!("usage"));
                let pending = c!("help", *state, g!(prepared, "helpArgv"));
                return host.call("step:help", vec![pending]);
            }
            host.call("step:ready", vec![])
        }
        ("child", [state, child]) => {
            let command = c!("createChild", *state, *child);
            if yes!(c!("isNull", command)) {
                return host.call("undefined", vec![]);
            }
            let root = g!(*state, "root");
            let is_default = !undef!(g!(root, "default")) && yes!(c!("defaultScope", root)) && {
                let name = c!("commandName", command);
                let default = g!(g!(root, "default"), "name");
                host.same(name, default)?
                    || yes!(c!(
                        "includes",
                        c!("aliases", command),
                        g!(g!(root, "default"), "name")
                    ))
            };
            let is_default = c!(if is_default { "true" } else { "false" });
            host.call("addChild", vec![*state, command, is_default])
        }
        ("unknown", [state]) => {
            c!("loadFields", *state);
            let unknown = c!("unknown", *state);
            if !host.is_undefined(unknown)? {
                if yes!(g!(*state, "invocation")) {
                    return host.call("unknownError", vec![unknown]);
                }
                return host.call("step:unknown", vec![unknown]);
            }
            host.call("step:ready", vec![])
        }
        ("unknownOutput", [state]) => host.call("unknownOutput", vec![*state]),
        ("unknownRender", [state, unknown]) => host.call("unknownRender", vec![*state, *unknown]),
        ("parse", [state]) => {
            keep!(*state, "userErrorPattern", literal!("usage"));
            host.call("parse", vec![*state])
        }
        ("caught", [state, error]) => {
            let invocation = g!(*state, "invocation");
            if yes!(invocation) {
                if yes!(c!("aborted", invocation)) {
                    return host.call("abortReason", vec![invocation]);
                }
                let code = if yes!(c!("isCommander", *error)) {
                    g!(*error, "exitCode")
                } else {
                    c!("one")
                };
                c!("invocationExit", invocation, code);
                if !(yes!(c!("isCommander", *error)) && yes!(c!("zero", g!(*error, "exitCode")))) {
                    c!("invocationError", invocation, *error);
                }
                return host.call("step:done", vec![]);
            }
            let flags = if yes!(g!(*state, "lastActionCommand")) {
                c!("flags", g!(*state, "lastActionCommand"))
            } else {
                c!("undefined")
            };
            keep!(*state, "resolvedFlags", flags);
            if yes!(c!("isDeclined", *error)) {
                host.call("step:declined", vec![])
            } else {
                host.call("step:report", vec![])
            }
        }
        ("resolvedOutput", [state]) => {
            if !undef!(g!(*state, "resolvedFlags")) {
                host.call("flagsOutput", vec![*state])
            } else {
                host.call("argvOutput", vec![*state])
            }
        }
        ("declinedOutput", [state]) => {
            let output = r!("resolvedOutput", *state);
            host.call("designOutput", vec![output])
        }
        ("declinedRender", [state, error]) => host.call("declinedRender", vec![*state, *error]),
        ("report", [state, error]) => host.call("report", vec![*state, *error]),
        ("reportReady", [report]) => {
            if !host.is_undefined(*report)? {
                c!("savedReport", *report);
            }
            host.call("undefined", vec![])
        }
        ("handleError", [state, error]) => {
            let debug = g!(g!(*state, "controls"), "debug");
            let debug_mode = if yes!(g!(g!(*state, "controls"), "debug")) {
                if !undef!(g!(*state, "resolvedFlags")) {
                    c!("debugFlags", *state)
                } else {
                    c!("debugArgv", *state)
                }
            } else {
                c!("undefined")
            };
            let output = r!("resolvedOutput", *state);
            let verbose = if yes!(g!(*state, "resolvedFlags")) {
                c!("flagsVerbose", *state)
            } else {
                c!("argvVerbose", *state)
            };
            let verbose_control = g!(g!(*state, "controls"), "verbose");
            // Later option getters precede the final error-pattern discriminator.
            let options = c!(
                "errorOptionsStart",
                *state,
                debug,
                debug_mode,
                output,
                verbose,
                verbose_control
            );
            let pattern = if undef!(c!("errorParams", *state)) {
                g!(*state, "userErrorPattern")
            } else {
                literal!("runtime-user")
            };
            c!("errorPattern", options, pattern);
            host.call("handleError", vec![*error, options])
        }
        ("hasCleanup", [state]) => {
            let has = !undef!(g!(*state, "proxyCleanup"));
            host.call(if has { "true" } else { "false" }, vec![])
        }
        ("cleanup", [state]) => host.call("cleanup", vec![*state]),
        ("cleanupError", [error]) => host.call("cleanupError", vec![*error]),
        _ => host.call("invalidOperation", vec![]),
    }
}

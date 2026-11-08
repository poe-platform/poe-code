//! Command selection and argument normalization before Commander parsing.
use crate::host::TextHost;

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! yes {
        ($value:expr) => {{
            let value = $value;
            let truthy = c!("truthy", value);
            host.is_true(truthy)?
        }};
    }
    match (operation, args) {
        ("defaultName", [command]) => {
            if yes!(c!("defaultString", *command)) {
                host.call("defaultName", vec![*command])
            } else {
                host.call("undefined", vec![])
            }
        }
        ("prepare", [program, argv, loaders, casing, controls]) => {
            let normalized = c!("prefix", *argv);
            let path = c!("list");
            let mut current = *program;
            let mut help_path = c!("undefined");
            let mut output = c!("undefined");
            let mut index = c!("two");
            while yes!(c!("more", index, *argv)) {
                let mut token = c!("at", *argv, index);
                if host.is_kind(token, "--")? {
                    c!("tail", normalized, *argv, index);
                    break;
                }
                if yes!(c!("help", token)) {
                    if host.is_nullish(help_path)? {
                        help_path = c!("copy", path);
                    }
                    c!("push", normalized, token);
                    index = c!("increment", index);
                    continue;
                }
                if yes!(c!("verbose", *controls)) && host.is_kind(token, "-v")? {
                    token = host.literal("--verbose")?;
                }
                let fields = c!("load", *loaders, current);
                let equals = if yes!(c!("long", token)) {
                    c!("equals", token)
                } else {
                    c!("minusOne")
                };
                let flag = if yes!(c!("unattached", equals)) {
                    token
                } else {
                    c!("flag", token, equals)
                };
                let mut option = c!("option", current, flag);
                let mut attached = c!("attached", equals);
                if host.is_undefined(option)?
                    && yes!(c!("hyphen", token))
                    && !yes!(c!("long", token))
                    && yes!(c!("cluster", token))
                {
                    let mut offset = c!("one");
                    while yes!(c!("clusterMore", offset, token)) {
                        let candidate = c!("clusterOption", current, token, offset);
                        if host.is_undefined(candidate)? {
                            break;
                        }
                        option = candidate;
                        if yes!(c!("required", candidate)) || yes!(c!("optional", candidate)) {
                            attached = c!("clusterAttached", offset, token);
                            break;
                        }
                        offset = c!("increment", offset);
                    }
                }
                if !host.is_undefined(option)? {
                    c!("push", normalized, token);
                    let next = c!("next", *argv, index);
                    if host.is_kind(flag, "--output")? && yes!(c!("output", *controls)) {
                        output = if yes!(attached) {
                            c!("outputValue", token, equals)
                        } else {
                            next
                        };
                    }
                    if !yes!(attached)
                        && !host.is_undefined(next)?
                        && (yes!(c!("required", option))
                            || (yes!(c!("optional", option))
                                && !(yes!(c!("nextMulti", next)) && yes!(c!("nextHyphen", next)))))
                    {
                        c!("push", normalized, next);
                        index = c!("increment", index);
                    }
                    index = c!("increment", index);
                    continue;
                }
                let child = c!("child", current, token);
                if !host.is_undefined(child)? {
                    current = child;
                    c!("pathPush", path, token);
                    c!("push", normalized, token);
                    index = c!("increment", index);
                    continue;
                }
                let default_name = run(host, "defaultName", &[current])?;
                let default_command = c!("defaultCommand", current, default_name);
                if !host.is_undefined(default_command)? {
                    current = default_command;
                    index = c!("decrement", index);
                    index = c!("increment", index);
                    continue;
                }
                if yes!(c!("long", token)) && yes!(c!("unattached", equals)) {
                    let normalized_flag = if yes!(c!("negated", token)) {
                        c!("negatedFlag", token)
                    } else {
                        c!("dynamicFlag", token)
                    };
                    let result = c!("resolve", fields, normalized_flag, *casing);
                    let ok = host.get(result, "ok")?;
                    let dynamic = if host.is_true(ok)? {
                        host.get(result, "value")?
                    } else {
                        let error = host.get(result, "error")?;
                        if !yes!(c!("userError", error)) {
                            return host.call("raise", vec![error]);
                        }
                        c!("undefined")
                    };
                    let next = c!("next", *argv, index);
                    if !host.is_undefined(dynamic)? && !host.is_undefined(next)? {
                        let kind = c!("kind", dynamic);
                        if !host.is_kind(kind, "boolean")? {
                            let kind = c!("kind", dynamic);
                            if !host.is_kind(kind, "array")? {
                                c!("pushAttached", normalized, token, next);
                                index = c!("increment", index);
                                index = c!("increment", index);
                                continue;
                            }
                        }
                    }
                }
                if !yes!(c!("hyphen", token)) && yes!(c!("hasCommands", current)) {
                    c!("pathPush", path, token);
                }
                c!("push", normalized, token);
                index = c!("increment", index);
            }
            if host.is_undefined(help_path)? {
                host.call("result", vec![normalized])
            } else {
                host.call("helpResult", vec![normalized, *argv, help_path, output])
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

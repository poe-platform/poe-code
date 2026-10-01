//! Error-report redaction and persistence policy over opaque host values.
use crate::host::Host;

fn yes<H: Host>(host: &mut H, name: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(name, args)?;
    host.is_true(value)
}
fn undefined<H: Host>(host: &mut H) -> Result<H::Value, H::Error> {
    host.call("undefined", vec![])
}
fn unwrap<H: Host>(host: &mut H, mut schema: H::Value) -> Result<H::Value, H::Error> {
    for _ in 0..16_384 {
        let kind = host.get(schema, "kind")?;
        if !host.is_kind(kind, "optional")? {
            return Ok(schema);
        }
        schema = host.get(schema, "inner")?;
    }
    host.call("overflow", vec![])
}
fn kind<H: Host>(host: &mut H, schema: H::Value, expected: &str) -> Result<bool, H::Error> {
    let kind = host.get(schema, "kind")?;
    host.is_kind(kind, expected)
}
fn sensitive<H: Host>(host: &mut H, name: H::Value, schema: H::Value) -> Result<bool, H::Error> {
    let schema = unwrap(host, schema)?;
    if kind(host, schema, "string")? || kind(host, schema, "number")? {
        let secret = host.get(schema, "secret")?;
        if !host.is_undefined(secret)? {
            return yes(host, "truthy", vec![secret]);
        }
    }
    yes(host, "sensitive", vec![name])
}
fn add_secret<H: Host>(host: &mut H, value: H::Value, values: H::Value) -> Result<(), H::Error> {
    if !host.is_undefined(value)? && yes(host, "positiveLength", vec![value])? {
        host.call("add", vec![values, value])?;
    }
    Ok(())
}
fn declared_secret<H: Host>(
    host: &mut H,
    context: H::Value,
    env: H::Value,
    name: H::Value,
    secret: H::Value,
) -> Result<H::Value, H::Error> {
    let secrets = host.get(context, "secrets")?;
    let value = if host.is_nullish(secrets)? {
        undefined(host)?
    } else {
        host.call("property", vec![secrets, name])?
    };
    if host.is_nullish(value)? {
        let name = host.get(secret, "env")?;
        host.call("property", vec![env, name])
    } else {
        Ok(value)
    }
}
fn within<H: Host>(host: &mut H, parent: H::Value, child: H::Value) -> Result<bool, H::Error> {
    let relative = host.call("relative", vec![parent, child])?;
    Ok(host.is_kind(relative, "")?
        || (!yes(host, "absolute", vec![relative])?
            && !host.is_kind(relative, "..")?
            && !yes(host, "parentPrefix", vec![relative])?))
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("findProjectRoot", [from]) => {
            let cwd = host.call("cwd", vec![])?;
            let mut current = if host.same(*from, cwd)? {
                host.call("cwd", vec![])?
            } else {
                host.call("resolve", vec![*from])?
            };
            loop {
                let path = host.call("packagePath", vec![current])?;
                if yes(host, "exists", vec![path])? {
                    return Ok(current);
                }
                let parent = host.call("parent", vec![current])?;
                if host.same(parent, current)? {
                    return undefined(host);
                }
                current = parent;
            }
        }
        ("redactParam", [value, raw, name]) | ("collectParam", [value, raw, name, _]) => {
            let collecting = operation == "collectParam";
            if sensitive(host, *name, *raw)? {
                return if collecting {
                    host.call("leaves", vec![*value, args[3]])
                } else {
                    host.call("redacted", vec![])
                };
            }
            let schema = unwrap(host, *raw)?;
            if kind(host, schema, "object")? && yes(host, "object", vec![*value])? {
                return if collecting {
                    host.call("collectObject", vec![*value, schema, args[3]])
                } else {
                    host.call("redactObject", vec![*value, schema])
                };
            }
            if kind(host, schema, "array")? && yes(host, "array", vec![*value])? {
                return if collecting {
                    host.call("collectArray", vec![*value, schema, *name, args[3]])
                } else {
                    host.call("redactArray", vec![*value, schema, *name])
                };
            }
            if collecting {
                undefined(host)
            } else {
                Ok(*value)
            }
        }
        ("paramChild", [value, schema, key]) | ("collectChild", [value, schema, key, _]) => {
            let shape = host.get(*schema, "shape")?;
            let child = host.call("property", vec![shape, *key])?;
            if host.is_undefined(child)? {
                return if operation == "collectChild" {
                    undefined(host)
                } else {
                    Ok(*value)
                };
            }
            if operation == "collectChild" {
                host.call("collectParam", vec![*value, child, *key, args[3]])
            } else {
                host.call("redactParam", vec![*value, child, *key])
            }
        }
        ("redactParams", [params, command]) => {
            if host.is_undefined(*command)? {
                return Ok(*params);
            }
            let schema = host.get(*command, "params")?;
            let name = host.call("emptyString", vec![])?;
            host.call("redactParam", vec![*params, schema, name])
        }
        ("leaves", [value, values]) => {
            if yes(host, "string", vec![*value])? {
                add_secret(host, *value, *values)?;
            } else if yes(host, "array", vec![*value])? {
                host.call("eachLeaf", vec![*value, *values])?;
            } else if yes(host, "object", vec![*value])? {
                let entries = host.call("values", vec![*value])?;
                host.call("eachLeaf", vec![entries, *values])?;
            }
            undefined(host)
        }
        ("addSecret", [value, values]) => {
            add_secret(host, *value, *values)?;
            undefined(host)
        }
        ("declaredSecret", [context, env, name, secret, values]) => {
            let value = declared_secret(host, *context, *env, *name, *secret)?;
            add_secret(host, value, *values)?;
            undefined(host)
        }
        ("secretLine", [context, env, name, secret]) => {
            let value = declared_secret(host, *context, *env, *name, *secret)?;
            host.call(
                if host.is_undefined(value)? {
                    "unsetSecretLine"
                } else {
                    "setSecretLine"
                },
                vec![*secret, value],
            )
        }
        ("redactor", [context, env]) => {
            let values = host.call("set", vec![])?;
            host.call("contextSecrets", vec![*context, values])?;
            host.call("declaredSecrets", vec![*context, *env, values])?;
            let command = host.get(*context, "command")?;
            if !host.is_undefined(command)? {
                let params = host.get(*context, "params")?;
                let command = host.get(*context, "command")?;
                let schema = host.get(command, "params")?;
                let name = host.call("emptyString", vec![])?;
                host.call("collectParam", vec![params, schema, name, values])?;
            }
            host.call("stringRedactor", vec![values])
        }
        ("structured", [name, value, redact]) => {
            if yes(host, "string", vec![*value])? {
                let redacted = host.call("redactHeader", vec![*name, *value])?;
                if !host.same(redacted, *value)? {
                    return Ok(redacted);
                }
                return host.call("redactString", vec![*redact, *value]);
            }
            if yes(host, "array", vec![*value])? {
                return host.call("structuredArray", vec![*name, *value, *redact]);
            }
            if yes(host, "object", vec![*value])? {
                return host.call("structuredObject", vec![*value, *redact]);
            }
            Ok(*value)
        }
        ("ownFields", [error, redact]) => {
            let output = host.call("record", vec![])?;
            if yes(host, "error", vec![*error])? {
                host.call("eachOwnField", vec![*error, *redact, output])?;
            }
            Ok(output)
        }
        ("ownField", [error, redact, output, key]) => {
            for excluded in ["name", "message", "stack", "cause"] {
                if host.is_kind(*key, excluded)? {
                    return undefined(host);
                }
            }
            let value = host.call("property", vec![*error, *key])?;
            let value = host.call("redactFields", vec![value, *key])?;
            let value = host.call("structured", vec![*key, value, *redact])?;
            host.call("define", vec![*output, *key, value])
        }
        ("errorName", [error]) => {
            if yes(host, "error", vec![*error])? {
                host.get(*error, "name")
            } else {
                host.call("typeof", vec![*error])
            }
        }
        ("errorMessage", [error]) => {
            if yes(host, "error", vec![*error])? {
                host.get(*error, "message")
            } else {
                host.call("stringify", vec![*error])
            }
        }
        ("stack", [error, redact]) => {
            let lines = host.call("list", vec![])?;
            let seen = host.call("set", vec![])?;
            let mut current = *error;
            let mut first = true;
            while !host.is_undefined(current)? {
                if yes(host, "error", vec![current])? {
                    if yes(host, "has", vec![seen, current])? {
                        host.call("circular", vec![lines])?;
                        break;
                    }
                    host.call("add", vec![seen, current])?;
                    let mut stack = host.get(current, "stack")?;
                    if host.is_nullish(stack)? {
                        stack = host.call("stringify", vec![current])?;
                    }
                    if !first {
                        stack = host.call("causePrefix", vec![stack])?;
                    }
                    let stack = host.call("redactString", vec![*redact, stack])?;
                    host.call("push", vec![lines, stack])?;
                    current = host.get(current, "cause")?;
                } else {
                    let mut message = host.call("stringify", vec![current])?;
                    if !first {
                        message = host.call("causePrefix", vec![message])?;
                    }
                    let message = host.call("redactString", vec![*redact, message])?;
                    host.call("push", vec![lines, message])?;
                    current = undefined(host)?;
                }
                first = false;
            }
            host.call("joinLines", vec![lines])
        }
        ("argv", [argv, options]) => {
            if host.is_undefined(*argv)? {
                return host.call("list", vec![]);
            }
            let state = host.call("argvState", vec![*options])?;
            host.call("eachArg", vec![*argv, state])?;
            host.get(state, "output")
        }
        ("arg", [arg, state]) => {
            let next = host.get(*state, "redactNext")?;
            if yes(host, "truthy", vec![next])? {
                return host.call("redactNextArg", vec![*state]);
            }
            let index = host.call("equalsIndex", vec![*arg])?;
            let absent = yes(host, "minusOne", vec![index])?;
            let option = if absent {
                *arg
            } else {
                host.call("sliceOption", vec![*arg, index])?
            };
            let name = host.call("optionName", vec![option])?;
            let sensitive =
                yes(host, "sensitive", vec![name])? || yes(host, "secretName", vec![*state, name])?;
            if !absent && sensitive {
                return host.call("redactEqualsArg", vec![*state, option]);
            }
            if yes(host, "dashPrefix", vec![*arg])? && sensitive {
                return host.call("deferArg", vec![*state, *arg]);
            }
            host.call("redactArgValues", vec![*state, *arg])
        }
        ("commandPath", [context]) => {
            let path = host.get(*context, "commandPath")?;
            if host.is_undefined(path)? {
                return host.call("root", vec![]);
            }
            let path = host.get(*context, "commandPath")?;
            if yes(host, "zeroLength", vec![path])? {
                host.call("root", vec![])
            } else {
                host.get(*context, "commandPath")
            }
        }
        ("writeStart", [context]) => {
            let mut env = host.get(*context, "env")?;
            if host.is_nullish(env)? {
                env = host.call("env", vec![])?;
            }
            let option = host.get(*context, "errorReports")?;
            let forced = host.get(env, "TOOLCRAFT_ERROR_REPORTS")?;
            if !host.is_kind(forced, "1")?
                && (host.is_undefined(option)? || yes(host, "false", vec![option])?)
            {
                return undefined(host);
            }
            let error = host.get(*context, "error")?;
            if yes(host, "approvalError", vec![error])? {
                return undefined(host);
            }
            if yes(host, "commanderError", vec![error])? {
                let code = host.get(error, "code")?;
                if host.is_kind(code, "commander.helpDisplayed")? {
                    return undefined(host);
                }
                let code = host.get(error, "code")?;
                if host.is_kind(code, "commander.version")? {
                    return undefined(host);
                }
            }
            if yes(host, "userError", vec![error])? {
                let cause = host.get(error, "cause")?;
                if host.is_undefined(cause)? && !yes(host, "httpError", vec![error])? {
                    return undefined(host);
                }
            }
            let mut root = host.get(*context, "projectRoot")?;
            if host.is_undefined(root)? {
                root = host.call("findRoot", vec![])?;
                if host.is_nullish(root)? {
                    root = host.call("tmpdir", vec![])?;
                }
            }
            let option = host.get(*context, "errorReports")?;
            let dir = host.call("reportDir", vec![option, root])?;
            host.call("writeState", vec![*context, root, dir])
        }
        ("reportDir", [option, root]) | ("confine", [option, root]) => {
            let configured = if yes(host, "objectType", vec![*option])? {
                host.get(*option, "dir")?
            } else {
                undefined(host)?
            };
            let default =
                host.is_undefined(configured)? || yes(host, "zeroLength", vec![configured])?;
            if operation == "confine" {
                let confines = default || !yes(host, "absolute", vec![configured])?;
                return host.call(if confines { "true" } else { "falseValue" }, vec![]);
            }
            if default {
                host.call("defaultDir", vec![*root])
            } else if yes(host, "absolute", vec![configured])? {
                Ok(configured)
            } else {
                host.call("join", vec![*root, configured])
            }
        }
        ("assertWithin", [parent, child]) => {
            if !within(host, *parent, *child)? {
                host.call("outside", vec![])?;
            }
            undefined(host)
        }
        ("displayPath", [root, absolute]) => {
            let relative = host.call("relative", vec![*root, *absolute])?;
            if yes(host, "zeroLength", vec![relative])?
                || yes(host, "dotDotPrefix", vec![relative])?
            {
                Ok(*absolute)
            } else {
                Ok(relative)
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

pub fn timestamp(iso: &[u16]) -> Vec<u16> {
    let prefix = &iso[..iso.len().min(16)];
    let colon = prefix.iter().position(|unit| *unit == u16::from(b':'));
    prefix
        .iter()
        .enumerate()
        .filter_map(|(index, unit)| (Some(index) != colon).then_some(*unit))
        .collect()
}

pub fn slug(characters: &[Vec<u16>]) -> Vec<u16> {
    let mut output = Vec::new();
    let mut dashed = false;
    for lower in characters {
        let text = lower.as_slice();
        if ((&[97][..]..=&[122][..]).contains(&text)) || ((&[48][..]..=&[57][..]).contains(&text)) {
            output.extend(lower);
            dashed = false;
        } else if !dashed {
            output.push(45);
            dashed = true;
        }
    }
    let start = output
        .iter()
        .position(|unit| *unit != 45)
        .unwrap_or(output.len());
    let end = output
        .iter()
        .rposition(|unit| *unit != 45)
        .map_or(start, |index| index + 1);
    if start == end {
        "root".encode_utf16().collect()
    } else {
        output[start..end].to_vec()
    }
}

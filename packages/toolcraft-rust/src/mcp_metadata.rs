//! MCP root, parameter-description, example and allowlist policies.
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
            let result = c!("truthy", value);
            host.is_true(result)?
        }};
    }
    match (operation, args) {
        ("roots", [roots]) => {
            if yes!(c!("isArray", *roots)) {
                host.call("root", vec![*roots])
            } else {
                Ok(*roots)
            }
        }
        ("unwrap", [schema]) => {
            let kind = host.get(*schema, "kind")?;
            if host.is_kind(kind, "optional")? {
                let inner = host.get(*schema, "inner")?;
                host.call("unwrap", vec![inner])
            } else {
                Ok(*schema)
            }
        }
        ("summaries", [schema, casing, path, optional]) => {
            let summaries = c!("array");
            let shape = host.get(*schema, "shape")?;
            c!("members", shape, *casing, *path, *optional, summaries);
            Ok(summaries)
        }
        ("member", [key, raw, casing, path, inherited, summaries]) => {
            let child = c!("unwrap", *raw);
            let next = c!("path", *path, *key, *casing);
            let optional = if yes!(*inherited) {
                *inherited
            } else {
                let kind = host.get(*raw, "kind")?;
                if host.is_kind(kind, "optional")? {
                    c!("true")
                } else {
                    let default = host.get(child, "default")?;
                    c!(if host.is_undefined(default)? {
                        "false"
                    } else {
                        "true"
                    })
                }
            };
            let kind = host.get(child, "kind")?;
            if host.is_kind(kind, "object")? {
                let nested = c!("summaries", child, *casing, next, optional);
                c!("append", *summaries, nested);
            } else {
                let suffix = if yes!(optional) { "" } else { " (required)" };
                let suffix = host.literal(suffix)?;
                c!("summary", *summaries, next, suffix);
            }
            host.call("undefined", vec![])
        }
        ("description", [description, params, examples, name, casing]) => {
            let path = c!("array");
            let optional = c!("false");
            let summary = c!("summaries", *params, *casing, path, optional);
            let parameter = if yes!(c!("empty", summary)) {
                host.literal("")?
            } else {
                c!("parameterText", summary)
            };
            let example = if yes!(c!("empty", *examples)) {
                host.literal("")?
            } else {
                c!("exampleText", *examples, *name)
            };
            if host.is_undefined(*description)? {
                host.call("concat", vec![parameter, example])
            } else if yes!(c!("empty", parameter)) {
                host.call("concat", vec![*description, example])
            } else {
                host.call("descriptionText", vec![*description, parameter, example])
            }
        }
        ("exampleValue", [value]) => {
            if yes!(c!("isString", *value)) {
                Ok(*value)
            } else {
                host.call("json", vec![*value])
            }
        }
        ("allowlist", [name, allowlist]) => {
            if host.is_undefined(*allowlist)? {
                host.call("true", vec![])
            } else {
                let candidates = c!("candidates", *name);
                host.call("matches", vec![candidates, *allowlist])
            }
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

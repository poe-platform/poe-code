//! JSON parse-error location precedence, offset scanning and diagnostic policy.
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
    macro_rules! null {
        ($value:expr) => {{
            let value = $value;
            let null = c!("isNull", value);
            host.is_true(null)?
        }};
    }
    match (operation, args) {
        ("format", [label, path, source, error, options]) => {
            let location = run(host, "errorLocation", &[*error, *source])?;
            let missing = null!(location);
            let message = c!("errorMessage", *error);
            let message = if missing {
                message
            } else {
                run(host, "remove", &[message, location])?
            };
            let position = if missing {
                host.literal("")?
            } else {
                c!("positionText", location)
            };
            let quote = host.get(*options, "quotePath")?;
            let formatted_path = if yes!(quote) {
                c!("quotedPath", *path)
            } else {
                *path
            };
            let snippet = if missing {
                host.literal("")?
            } else {
                c!("snippet", *source, location, *path)
            };
            host.call(
                "formatted",
                vec![*label, formatted_path, message, position, snippet],
            )
        }
        ("remove", [message, location]) => {
            let suffix = c!("suffix", *location);
            let matches = c!("endsWith", *message, suffix);
            if yes!(matches) {
                host.call("removeSuffix", vec![*message, suffix])
            } else {
                Ok(*message)
            }
        }
        ("errorLocation", [error, source]) => {
            let cause = run(host, "causeLocation", &[*error])?;
            if !null!(cause) {
                return Ok(cause);
            }
            let key = host.literal("position")?;
            let position = run(host, "numeric", &[*error, key])?;
            if !null!(position) {
                return run(host, "offsetLocation", &[*source, position]);
            }
            let message = c!("errorMessage", *error);
            let position = run(host, "messagePosition", &[message])?;
            if !null!(position) {
                run(host, "offsetLocation", &[*source, position])
            } else {
                host.call("null", vec![])
            }
        }
        ("causeLocation", [error]) => {
            let object = c!("isObject", *error);
            if !host.is_true(object)? || null!(*error) {
                return host.call("null", vec![]);
            }
            let key = host.literal("cause")?;
            let own = c!("own", *error, key);
            if !yes!(own) {
                return host.call("null", vec![]);
            }
            let cause = host.get(*error, "cause")?;
            let key = host.literal("line")?;
            let line = run(host, "numeric", &[cause, key])?;
            let key = host.literal("column")?;
            let column = run(host, "numeric", &[cause, key])?;
            let column = if host.is_nullish(column)? {
                let key = host.literal("col")?;
                run(host, "numeric", &[cause, key])?
            } else {
                column
            };
            if null!(line) || null!(column) {
                host.call("null", vec![])
            } else {
                host.call("location", vec![line, column])
            }
        }
        ("numeric", [value, key]) => {
            let object = c!("isObject", *value);
            if !host.is_true(object)? || null!(*value) {
                return host.call("null", vec![]);
            }
            let own = c!("own", *value, *key);
            if !yes!(own) {
                return host.call("null", vec![]);
            }
            let property = c!("property", *value, *key);
            let number = c!("isNumber", property);
            if host.is_true(number)? {
                let finite = c!("finite", property);
                if yes!(finite) {
                    return Ok(property);
                }
            }
            host.call("null", vec![])
        }
        ("messagePosition", [message]) => {
            let marker = host.literal(" at position ")?;
            let marker_index = c!("findMarker", *message, marker);
            let missing = c!("minusOne", marker_index);
            if host.is_true(missing)? {
                return host.call("null", vec![]);
            }
            let start = c!("startIndex", marker_index, marker);
            let mut end = start;
            loop {
                let more = c!("messageMore", end, *message);
                if !host.is_true(more)? {
                    break;
                }
                let character = c!("at", *message, end);
                let character = if host.is_nullish(character)? {
                    host.literal("")?
                } else {
                    character
                };
                let digit = run(host, "digit", &[character])?;
                if !host.is_true(digit)? {
                    break;
                }
                end = c!("increment", end);
            }
            if host.same(start, end)? {
                host.call("null", vec![])
            } else {
                host.call("parsePosition", vec![*message, start, end])
            }
        }
        ("digit", [value]) => {
            let lower = c!("digitLower", *value);
            if host.is_true(lower)? {
                host.call("digitUpper", vec![*value])
            } else {
                host.call("false", vec![])
            }
        }
        ("offsetLocation", [source, offset]) => {
            let mut line = c!("one");
            let mut column = c!("one");
            let bounded = c!("bounded", *offset);
            let mut index = c!("zero");
            loop {
                let before = c!("beforeBound", index, bounded);
                if !host.is_true(before)? {
                    break;
                }
                let more = c!("sourceMore", index, *source);
                if !host.is_true(more)? {
                    break;
                }
                let character = c!("at", *source, index);
                if host.is_kind(character, "\n")? {
                    line = c!("increment", line);
                    column = c!("one");
                } else {
                    column = c!("increment", column);
                }
                index = c!("increment", index);
            }
            host.call("location", vec![line, column])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

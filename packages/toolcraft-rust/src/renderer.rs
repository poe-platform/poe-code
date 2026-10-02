//! Result presentation policies. Host calls retain live objects and observable methods.
use crate::host::TextHost;

fn yes<H: TextHost>(host: &mut H, operation: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(operation, args)?;
    let value = host.call("truthy", vec![value])?;
    host.is_true(value)
}

pub fn run<H: TextHost>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! r { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=[$($arg),*];run(host,$name,&args)?}}; }
    macro_rules! b { ($name:expr $(,$arg:expr)* $(,)?) => {{let value=r!($name $(,$arg)*);host.is_true(value)?}}; }
    match (operation, args) {
        ("render", [command, result, output, primitives, write]) => {
            let envelope = r!("unwrap", *result);
            let failed = host.get(envelope, "mcpError")?;
            if host.is_true(failed)? {
                let result = host.get(envelope, "result")?;
                let payload = r!("auto", *command, result, *output, *primitives);
                if yes(host, "nonempty", vec![payload])? {
                    c!("writeError", *write, payload);
                }
                return host.call("status", vec![failed]);
            }
            for (mode, member, operation) in [
                ("json", "json", "customJson"),
                ("md", "markdown", "customMarkdown"),
                ("rich", "rich", "customRich"),
            ] {
                if !host.is_kind(*output, mode)? {
                    continue;
                }
                let renderer = host.get(*command, "render")?;
                if host.is_nullish(renderer)? {
                    continue;
                }
                let candidate = host.get(renderer, member)?;
                if !yes(host, "truthy", vec![candidate])? {
                    continue;
                }
                let payload = c!(operation, *command, *result, *primitives);
                match mode {
                    "json" if !host.is_undefined(payload)? => {
                        let payload = c!("jsonPretty", payload);
                        c!("write", *write, payload);
                    }
                    "md" if yes(host, "isString", vec![payload])?
                        && yes(host, "nonempty", vec![payload])? =>
                    {
                        c!("write", *write, payload);
                    }
                    _ => {}
                }
                return host.call("status", vec![failed]);
            }
            let result = host.get(envelope, "result")?;
            let payload = r!("auto", *command, result, *output, *primitives);
            if yes(host, "nonempty", vec![payload])? {
                c!("write", *write, payload);
            }
            host.call("status", vec![failed])
        }
        ("unwrap", [result]) => {
            if !yes(host, "isMcp", vec![*result])? {
                let no = c!("false");
                return host.call("envelope", vec![*result, no]);
            }
            let payload = r!("extract", *result);
            let failed = host.get(*result, "isError")?;
            let failed = c!("strictTrue", failed);
            host.call("envelope", vec![payload, failed])
        }
        ("extract", [envelope]) => {
            let structured = host.get(*envelope, "structuredContent")?;
            if yes(host, "isObject", vec![structured])? {
                let keys = c!("keys", structured);
                let length = host.get(keys, "length")?;
                if yes(host, "one", vec![length])? {
                    let key = host.get(keys, "0")?;
                    if host.is_kind(key, "result")? {
                        return host.get(structured, "result");
                    }
                }
            }
            if !host.is_undefined(structured)? {
                return Ok(structured);
            }
            let content = host.get(*envelope, "content")?;
            if yes(host, "isArray", vec![content])? {
                let text = c!("mcpText", *envelope);
                if yes(host, "nonempty", vec![text])? {
                    return Ok(text);
                }
                let failed = host.get(*envelope, "isError")?;
                if host.is_true(failed)? {
                    return host.literal("Upstream tool failed.");
                }
            }
            host.call("undefined", vec![])
        }
        ("mcpText", [value]) => {
            if yes(host, "isObject", vec![*value])? {
                let kind = host.get(*value, "type")?;
                if host.is_kind(kind, "text")? {
                    let text = host.get(*value, "text")?;
                    return host.call("isString", vec![text]);
                }
            }
            host.call("false", vec![])
        }
        ("auto", [command, result, output, primitives]) => {
            if host.is_nullish(*result)? {
                if host.is_kind(*output, "json")? {
                    let ok = c!("ok");
                    return host.call("jsonPretty", vec![ok]);
                }
                return host.literal("Done.");
            }
            if yes(host, "isString", vec![*result])? {
                if host.is_kind(*output, "json")? {
                    let wrapped = c!("result", *result);
                    return host.call("jsonPretty", vec![wrapped]);
                }
                return Ok(*result);
            }
            if host.is_kind(*output, "rich")?
                && yes(host, "isArray", vec![*result])?
                && yes(host, "stringArray", vec![*result])?
            {
                let newline = host.literal("\n")?;
                return host.call("join", vec![*result, newline]);
            }
            if yes(host, "isObject", vec![*result])? {
                if host.is_kind(*output, "md")? {
                    return host.call("objectMarkdown", vec![*result]);
                }
                if host.is_kind(*output, "json")? {
                    return host.call("jsonPretty", vec![*result]);
                }
                let title = r!("title", *command);
                return run(host, "card", &[*result, *primitives, title]);
            }
            if yes(host, "isArray", vec![*result])? && yes(host, "objectArray", vec![*result])? {
                if host.is_kind(*output, "md")? {
                    return run(host, "arrayMarkdown", &[*result]);
                }
                if host.is_kind(*output, "json")? {
                    return host.call("jsonPretty", vec![*result]);
                }
                return run(host, "arrayTable", &[*result, *primitives]);
            }
            host.call(
                if host.is_kind(*output, "rich")? {
                    "yaml"
                } else {
                    "jsonPretty"
                },
                vec![*result],
            )
        }
        ("stringify", [value]) => {
            if host.is_undefined(*value)? {
                host.literal("")
            } else if yes(host, "isString", vec![*value])? {
                Ok(*value)
            } else {
                host.call("json", vec![*value])
            }
        }
        ("jsonValue", [value]) => {
            if yes(host, "isBigint", vec![*value])? {
                host.call("toString", vec![*value])
            } else {
                Ok(*value)
            }
        }
        ("scalar", [value]) => {
            if yes(host, "isBoolean", vec![*value])? {
                return host.literal(if host.is_true(*value)? { "Yes" } else { "No" });
            }
            let text =
                if yes(host, "isArray", vec![*value])? && yes(host, "scalarArray", vec![*value])? {
                    let separator = host.literal(", ")?;
                    c!("scalarList", *value, separator)
                } else {
                    r!("stringify", *value)
                };
            if yes(host, "truthy", vec![text])? {
                Ok(text)
            } else {
                host.literal("—")
            }
        }
        ("scalarField", [value]) => {
            let scalar =
                !yes(host, "isObject", vec![*value])? && !yes(host, "isArray", vec![*value])?;
            host.call(if scalar { "true" } else { "false" }, vec![])
        }
        ("nonemptyObjects", [value]) => {
            let objects = yes(host, "isArray", vec![*value])?
                && yes(host, "nonempty", vec![*value])?
                && yes(host, "objectArray", vec![*value])?;
            host.call(if objects { "true" } else { "false" }, vec![])
        }
        ("humanize", [key]) => {
            let state = c!("humanState");
            c!("eachCharacter", *key, state);
            host.get(state, "output")
        }
        ("character", [character, state]) => {
            if host.is_kind(*character, "_")? || host.is_kind(*character, "-")? {
                let space = host.literal(" ")?;
                c!("humanAppend", *state, space);
                c!("humanUncapitalize", *state);
            } else {
                if yes(host, "asciiUpper", vec![*character])? {
                    let output = host.get(*state, "output")?;
                    if yes(host, "nonempty", vec![output])?
                        && !yes(host, "endsSpace", vec![output])?
                    {
                        let space = host.literal(" ")?;
                        c!("humanAppend", *state, space);
                    }
                }
                let capitalize = host.get(*state, "capitalizeNext")?;
                if host.is_true(capitalize)? {
                    let upper = c!("upper", *character);
                    c!("humanAppend", *state, upper);
                    c!("humanUncapitalize", *state);
                } else {
                    c!("humanAppend", *state, *character);
                }
            }
            host.call("undefined", vec![])
        }
        ("labels", [result]) => {
            let labels = c!("map");
            let counts = c!("map");
            c!("eachKey", *result, labels, counts);
            c!("eachLabel", labels, counts);
            Ok(labels)
        }
        ("label", [key, labels, counts]) => {
            let label = r!("humanize", *key);
            c!("set", *labels, *key, label);
            let count = c!("incrementCount", *counts, label);
            c!("set", *counts, label, count);
            host.call("undefined", vec![])
        }
        ("collision", [key, label, labels, counts]) => {
            let count = c!("get", *counts, *label);
            if yes(host, "moreThanOne", vec![count])? {
                c!("set", *labels, *key, *key);
            }
            host.call("undefined", vec![])
        }
        ("rows", [result, depth]) => {
            let rows = c!("list");
            let labels = r!("labels", *result);
            c!("detailEntries", *result, *depth, labels, rows);
            Ok(rows)
        }
        ("detail", [value, label, depth, rows]) => {
            if yes(host, "isObject", vec![*value])? {
                let keys = c!("keys", *value);
                let length = host.get(keys, "length")?;
                if yes(host, "zero", vec![length])? {
                    let text = host.literal("{}")?;
                    let row = c!("row", *label, text);
                    c!("push", *rows, row);
                } else {
                    let empty = host.literal("")?;
                    let row = c!("row", *label, empty);
                    c!("push", *rows, row);
                    let next = c!("increment", *depth);
                    let nested = r!("rows", *value, next);
                    c!("extend", *rows, nested);
                }
            } else if b!("nonemptyObjects", *value) {
                let empty = host.literal("")?;
                let row = c!("row", *label, empty);
                c!("push", *rows, row);
                let next = c!("increment", *depth);
                let nested = c!("arrayDetails", *value, next);
                c!("extend", *rows, nested);
            } else {
                let text = r!("scalar", *value);
                let row = c!("row", *label, text);
                c!("push", *rows, row);
            }
            host.call("undefined", vec![])
        }
        ("arrayDetail", [value, entry, index, depth]) => {
            let length = host.get(*value, "length")?;
            if yes(host, "one", vec![length])? {
                return run(host, "rows", &[*entry, *depth]);
            }
            let label = c!("indexLabel", *depth, *index);
            let empty = host.literal("")?;
            let row = c!("row", label, empty);
            let next = c!("increment", *depth);
            let rows = r!("rows", *entry, next);
            host.call("prepend", vec![row, rows])
        }
        ("listField", [value]) => {
            let array = yes(host, "isArray", vec![*value])? && !b!("nonemptyObjects", *value);
            host.call(if array { "true" } else { "false" }, vec![])
        }
        ("stacked", [value]) => {
            let separator = host.literal("\n")?;
            let text = c!("scalarList", *value, separator);
            if yes(host, "truthy", vec![text])? {
                Ok(text)
            } else {
                host.literal("—")
            }
        }
        ("arraySections", [value, labels, key]) => {
            if !b!("nonemptyObjects", *value) {
                return host.call("list", vec![]);
            }
            let title = c!("get", *labels, *key);
            host.call("arraySections", vec![*value, title])
        }
        ("arraySection", [value, title, entry, index]) => {
            let length = host.get(*value, "length")?;
            let title = if yes(host, "one", vec![length])? {
                *title
            } else {
                c!("indexTitle", *title, *index)
            };
            let zero = c!("zeroValue");
            let rows = r!("rows", *entry, zero);
            host.call("section", vec![title, rows])
        }
        ("card", [result, primitives, title]) => {
            let labels = r!("labels", *result);
            let scalar = c!("scalarRows", *result, labels);
            let objects = c!("objectSections", *result, labels);
            let arrays = c!("objectArraySections", *result, labels);
            let lists = c!("listRows", *result, labels);
            host.call(
                "card",
                vec![*primitives, *title, scalar, objects, lists, arrays],
            )
        }
        ("title", [command]) => {
            let description = c!("description", *command);
            if yes(host, "truthy", vec![description])?
                && !yes(host, "hasNewline", vec![description])?
                && yes(host, "shortTitle", vec![description])?
            {
                return Ok(description);
            }
            let name = host.get(*command, "name")?;
            if yes(host, "truthy", vec![name])? {
                let name = host.get(*command, "name")?;
                run(host, "humanize", &[name])
            } else {
                host.literal("Result")
            }
        }
        ("objectTable", [result, primitives]) => {
            let zero = c!("zeroValue");
            let rows = r!("rows", *result, zero);
            let length = host.get(rows, "length")?;
            if yes(host, "zero", vec![length])? {
                host.literal("{}")
            } else {
                host.call("objectTable", vec![*primitives, rows])
            }
        }
        ("columns", [rows]) => {
            let names = c!("setObject");
            c!("columnNames", *rows, names);
            host.call("spread", vec![names])
        }
        ("arrayTable", [result, primitives]) => {
            let length = host.get(*result, "length")?;
            if yes(host, "zero", vec![length])? {
                return host.literal("[]");
            }
            let names = r!("columns", *result);
            host.call("arrayTable", vec![*primitives, *result, names])
        }
        ("cell", [row, name]) => {
            if yes(host, "hasOwn", vec![*row, *name])? {
                let value = c!("property", *row, *name);
                run(host, "stringify", &[value])
            } else {
                host.literal("")
            }
        }
        ("cellLength", [row, name]) => {
            if yes(host, "hasOwn", vec![*row, *name])? {
                let value = c!("property", *row, *name);
                let text = r!("stringify", value);
                host.get(text, "length")
            } else {
                host.call("zeroValue", vec![])
            }
        }
        ("markdownCell", [row, name]) => {
            if yes(host, "hasOwn", vec![*row, *name])? {
                let value = c!("property", *row, *name);
                let text = r!("stringify", value);
                host.call("escapePipe", vec![text])
            } else {
                host.literal("")
            }
        }
        ("arrayMarkdown", [result]) => {
            let length = host.get(*result, "length")?;
            if yes(host, "zero", vec![length])? {
                return host.literal("[]");
            }
            let names = r!("columns", *result);
            host.call("arrayMarkdown", vec![*result, names])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

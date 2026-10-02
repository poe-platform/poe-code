//! CLI prompt choice and result parsing with explicit async continuation points.
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
        ("format", [value]) => {
            if yes!(c!("isArray", *value)) {
                host.call("arrayValue", vec![*value])
            } else if yes!(c!("isString", *value)) {
                Ok(*value)
            } else {
                host.call("json", vec![*value])
            }
        }
        ("label", [field]) => {
            let index = host.get(*field, "positionalIndex")?;
            if host.is_undefined(index)? {
                host.get(*field, "optionFlag")
            } else {
                host.call("label", vec![*field])
            }
        }
        ("enumLabel", [schema, value]) => {
            let key = c!("string", *value);
            let labels = host.get(*schema, "labels")?;
            if host.is_undefined(labels)? || !yes!(c!("ownsLabel", *schema, key)) {
                return Ok(key);
            }
            let label = c!("labelValue", *schema, key);
            if host.is_nullish(label)? {
                Ok(key)
            } else {
                Ok(label)
            }
        }
        ("streams", [options, streams]) => {
            let mut options = c!("copy", *options);
            let input = host.get(*streams, "input")?;
            if !host.is_undefined(input)? {
                options = c!("input", options, *streams);
            }
            let output = host.get(*streams, "output")?;
            if !host.is_undefined(output)? {
                options = c!("output", options, *streams);
            }
            Ok(options)
        }
        ("cancel", []) => host.call("cancelled", vec![]),
        ("start", [state]) => {
            let field = host.get(*state, "field")?;
            let schema = host.get(field, "schema")?;
            let kind = host.get(schema, "kind")?;
            if host.is_kind(kind, "enum")? {
                let load = host.get(schema, "loadOptions")?;
                if yes!(load) {
                    let value = c!("load", schema);
                    return host.call("step:loaded", vec![value]);
                }
                let options = c!("enumOptions", schema);
                return run(host, "loaded", &[*state, options]);
            }
            let schema = host.get(field, "schema")?;
            let kind = host.get(schema, "kind")?;
            if host.is_kind(kind, "boolean")? {
                let value = c!("confirm", *state);
                host.call("step:selected", vec![value])
            } else {
                let value = c!("text", *state);
                host.call("step:entered", vec![value])
            }
        }
        ("loaded", [state, options]) => {
            let value = c!("select", *state, *options);
            host.call("step:selected", vec![value])
        }
        ("selectionOptions", [field, options, streams]) => {
            let description = host.get(*field, "description")?;
            let message = if host.is_nullish(description)? {
                run(host, "label", &[*field])?
            } else {
                description
            };
            let has_default = host.get(*field, "hasDefault")?;
            let initial = if yes!(has_default) {
                host.get(*field, "defaultValue")?
            } else {
                c!("undefined")
            };
            let options = c!("selectionOptions", message, *options, initial);
            run(host, "streams", &[options, *streams])
        }
        ("booleanOptions" | "textOptions", [field, streams]) => {
            let message = run(host, "label", &[*field])?;
            let has_default = host.get(*field, "hasDefault")?;
            let mut initial = c!("undefined");
            if yes!(has_default) {
                if operation == "booleanOptions" {
                    initial = c!("initialBoolean", *field);
                } else {
                    let default = host.get(*field, "defaultValue")?;
                    if !host.is_undefined(default)? {
                        let default = host.get(*field, "defaultValue")?;
                        initial = run(host, "format", &[default])?;
                    }
                }
            }
            let options = c!("promptOptions", message, initial);
            run(host, "streams", &[options, *streams])
        }
        ("selected", [_, selected]) => {
            if yes!(c!("isCancel", *selected)) {
                return host.call("cancelled", vec![]);
            }
            host.call("step:return", vec![*selected])
        }
        ("entered", [state, entered]) => {
            if yes!(c!("isCancel", *entered)) {
                return host.call("cancelled", vec![]);
            }
            let field = host.get(*state, "field")?;
            if !yes!(c!("isString", *entered)) {
                return host.call("missing", vec![field]);
            }
            if yes!(c!("blank", *entered)) {
                let has_default = host.get(field, "hasDefault")?;
                if yes!(has_default) {
                    let value = c!("clone", field);
                    return host.call("step:return", vec![value]);
                }
            }
            let schema = host.get(field, "schema")?;
            let kind = host.get(schema, "kind")?;
            if host.is_kind(kind, "array")? {
                let value = c!("array", *entered, field);
                return host.call("step:return", vec![value]);
            }
            let schema = host.get(field, "schema")?;
            let kind = host.get(schema, "kind")?;
            let value = if host.is_kind(kind, "json")? {
                let nullable = if host.is_kind(*entered, "null")? {
                    let schema = host.get(field, "schema")?;
                    let nullable = host.get(schema, "nullable")?;
                    host.is_true(nullable)?
                } else {
                    false
                };
                if nullable {
                    c!("null")
                } else {
                    c!("jsonValue", *entered, field)
                }
            } else {
                c!("scalar", *entered, field)
            };
            host.call("step:return", vec![value])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

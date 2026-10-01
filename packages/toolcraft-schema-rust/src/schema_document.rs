//! DSL-to-JSON-Schema conversion and Standard Schema document policies.
use crate::builders::{fail, object};
use crate::host_values::Kind;
use crate::validate::{Host, MAX_TRAVERSAL_DEPTH, cat, entries, get, is, text, truthy, u, yes};

fn assign<H: Host>(
    host: &mut H,
    target: H::Value,
    name: &str,
    value: H::Value,
) -> Result<(), H::Error> {
    let key = host.make_string(u(name))?;
    host.call("assign", vec![target, key, value]).map(|_| ())
}
fn nullish<H: Host>(host: &mut H, value: H::Value) -> Result<bool, H::Error> {
    Ok(matches!(host.kind(value)?, Kind::Null | Kind::Undefined))
}
fn typed<H: Host>(host: &mut H, kind: &str) -> Result<H::Value, H::Error> {
    let kind = host.make_string(u(kind))?;
    object(host, vec![("type", kind)])
}
fn unwrap<H: Host>(host: &mut H, mut schema: H::Value) -> Result<H::Value, H::Error> {
    for _ in 0..MAX_TRAVERSAL_DEPTH {
        let kind = get(host, schema, "kind")?;
        if !is(host, kind, "optional")? {
            return Ok(schema);
        }
        schema = get(host, schema, "inner")?;
    }
    host.call("stackOverflow", vec![])
}
fn copy_metadata<H: Host>(
    host: &mut H,
    schema: H::Value,
    result: H::Value,
    fields: &[&str],
) -> Result<(), H::Error> {
    for name in fields {
        let value = get(host, schema, name)?;
        if host.kind(value)? != Kind::Undefined {
            let value = get(host, schema, name)?;
            assign(host, result, name, value)?;
        }
    }
    Ok(())
}
fn metadata<H: Host>(
    host: &mut H,
    schema: H::Value,
    result: H::Value,
) -> Result<H::Value, H::Error> {
    copy_metadata(host, schema, result, &["description"])?;
    let default = get(host, schema, "default")?;
    if host.kind(default)? != Kind::Undefined {
        let default = get(host, schema, "default")?;
        let copied = host.call("cloneDefault", vec![default])?;
        assign(host, result, "default", copied)?;
    }
    let nullable = get(host, schema, "nullable")?;
    if yes(host, nullable)? {
        let kind = get(host, result, "type")?;
        if host.kind(kind)? != Kind::Undefined {
            let kind = get(host, result, "type")?;
            let array = host.is_array(kind)?;
            let kind = get(host, result, "type")?;
            let kinds = if array {
                kind
            } else {
                host.call("array", vec![kind])?
            };
            let null = host.make_string(u("null"))?;
            let kinds = host.call("appendUnique", vec![kinds, null])?;
            assign(host, result, "type", kinds)?;
        }
        let one_of = get(host, result, "oneOf")?;
        if host.kind(one_of)? != Kind::Undefined {
            let one_of = get(host, result, "oneOf")?;
            let null = host.call("null", vec![])?;
            let values = host.call("array", vec![null])?;
            let branch = object(host, vec![("enum", values)])?;
            host.call("push", vec![one_of, branch])?;
        }
    }
    Ok(result)
}
fn finish<H: Host>(
    host: &mut H,
    schema: H::Value,
    kind: &str,
    result: H::Value,
) -> Result<H::Value, H::Error> {
    match kind {
        "string" => copy_metadata(
            host,
            schema,
            result,
            &["minLength", "maxLength", "pattern", "format"],
        )?,
        "number" => copy_metadata(host, schema, result, &["minimum", "maximum"])?,
        "array" => copy_metadata(host, schema, result, &["minItems", "maxItems"])?,
        "object" => {
            let additional = get(host, schema, "additionalProperties")?;
            let additional = if nullish(host, additional)? {
                host.make_boolean(false)?
            } else {
                additional
            };
            assign(host, result, "additionalProperties", additional)?;
        }
        _ => {}
    }
    metadata(host, schema, result)
}

fn type_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Null | Kind::Object => "object",
        Kind::String => "string",
        Kind::Number => "number",
        Kind::Boolean => "boolean",
        Kind::Function => "function",
        Kind::Symbol => "symbol",
        Kind::BigInt => "bigint",
        _ => "undefined",
    }
}
pub fn enum_type_matches<H: Host>(
    host: &mut H,
    value: H::Value,
    expected: &str,
) -> Result<bool, H::Error> {
    let kind = host.kind(value)?;
    Ok(if expected == "null" {
        kind == Kind::Null
    } else {
        type_name(kind) == expected
    })
}
fn enum_type<H: Host>(host: &mut H, values: H::Value) -> Result<H::Value, H::Error> {
    let first = host.call("first", vec![values])?;
    let kind = host.kind(first)?;
    if kind == Kind::Undefined {
        return host.undefined();
    }
    if kind == Kind::Null {
        let null = host.make_string(u("null"))?;
        let all = host.call("everyEnumType", vec![values, null])?;
        if truthy(host, all)? {
            return Ok(null);
        }
    }
    let name = type_name(kind);
    let expected = host.make_string(u(name))?;
    let all = host.call("everyEnumType", vec![values, expected])?;
    if truthy(host, all)? && matches!(name, "string" | "number" | "boolean") {
        Ok(expected)
    } else {
        host.undefined()
    }
}

struct ObjectFrame<V> {
    schema: V,
    properties: V,
    required: V,
    entries: std::vec::IntoIter<(Vec<u16>, V)>,
    pending: Option<(Vec<u16>, V)>,
    depth: usize,
}
struct OneOfFrame<V> {
    schema: V,
    branches: V,
    entries: std::vec::IntoIter<(Vec<u16>, V)>,
    pending: Option<(V, V)>,
    depth: usize,
}
enum Task<V> {
    Visit(V, usize),
    Container(V, &'static str),
    Object(ObjectFrame<V>),
    OneOf(OneOfFrame<V>),
}

pub fn to_json_schema<H: Host>(
    host: &mut H,
    schema: H::Value,
    options: H::Value,
    symbol: H::Value,
) -> Result<H::Value, H::Error> {
    let mut tasks = vec![Task::Visit(schema, 0)];
    let mut result = host.undefined()?;
    while let Some(task) = tasks.pop() {
        match task {
            Task::Container(schema, kind) => {
                let output = typed(host, if kind == "array" { "array" } else { "object" })?;
                host.define(
                    output,
                    &u(if kind == "array" {
                        "items"
                    } else {
                        "additionalProperties"
                    }),
                    result,
                )?;
                result = finish(host, schema, kind, output)?;
            }
            Task::Object(mut frame) => {
                if let Some((key, child)) = frame.pending.take() {
                    host.define(frame.properties, &key, result)?;
                    let kind = get(host, child, "kind")?;
                    let mut required = !is(host, kind, "optional")?;
                    if !required {
                        let io = get(host, options, "io")?;
                        if is(host, io, "output")? {
                            let child = unwrap(host, child)?;
                            let default = get(host, child, "default")?;
                            required = host.kind(default)? != Kind::Undefined;
                        }
                    }
                    if required {
                        let key = host.make_string(key)?;
                        host.call("push", vec![frame.required, key])?;
                    }
                }
                if let Some((key, child)) = frame.entries.next() {
                    frame.pending = Some((key, child));
                    let depth = frame.depth + 1;
                    tasks.push(Task::Object(frame));
                    tasks.push(Task::Visit(child, depth));
                } else {
                    let output = typed(host, "object")?;
                    host.define(output, &u("properties"), frame.properties)?;
                    host.define(output, &u("required"), frame.required)?;
                    result = finish(host, frame.schema, "object", output)?;
                }
            }
            Task::OneOf(mut frame) => {
                if let Some((discriminator, name)) = frame.pending.take() {
                    result = clear_null_default(host, result)?;
                    result = inject_discriminator(host, result, discriminator, name)?;
                    host.call("push", vec![frame.branches, result])?;
                }
                if let Some((name, branch)) = frame.entries.next() {
                    let discriminator = get(host, frame.schema, "discriminator")?;
                    let name = host.make_string(name)?;
                    let branch = nonnullable_branch(host, branch)?;
                    frame.pending = Some((discriminator, name));
                    let depth = frame.depth + 1;
                    tasks.push(Task::OneOf(frame));
                    tasks.push(Task::Visit(branch, depth));
                } else {
                    let output = object(host, vec![("oneOf", frame.branches)])?;
                    result = metadata(host, frame.schema, output)?;
                }
            }
            Task::Visit(schema, depth) => {
                if depth > MAX_TRAVERSAL_DEPTH {
                    host.call("stackOverflow", vec![])?;
                }
                let schema = unwrap(host, schema)?;
                let native = host.call("getNative", vec![schema, symbol])?;
                if host.kind(native)? != Kind::Undefined {
                    let target = get(host, options, "target")?;
                    if host.kind(target)? != Kind::Undefined {
                        let document = get(host, native, "document")?;
                        let declared = get(host, document, "$schema")?;
                        let draft7 = is(host, declared, "http://json-schema.org/draft-07/schema#")?
                            || is(host, declared, "http://json-schema.org/draft-07/schema")?;
                        let target = get(host, options, "target")?;
                        if !is(
                            host,
                            target,
                            if draft7 { "draft-07" } else { "draft-2020-12" },
                        )? {
                            let target = get(host, options, "target")?;
                            let target = text(host, target, true)?;
                            fail(
                                host,
                                cat(&[
                                    &u("Native JSON Schema dialect does not match target: "),
                                    &target,
                                ]),
                            )?;
                        }
                    }
                    let document = get(host, native, "document")?;
                    result = host.call("structuredClone", vec![document])?;
                    continue;
                }
                let kind = get(host, schema, "kind")?;
                if host.kind(kind)? != Kind::String {
                    result = host.undefined()?;
                    continue;
                }
                match String::from_utf16_lossy(&host.string(kind)?).as_str() {
                    "string" | "boolean" => {
                        let kind = host.string(kind)?;
                        let kind = String::from_utf16_lossy(&kind);
                        let output = typed(host, &kind)?;
                        result = finish(host, schema, &kind, output)?;
                    }
                    "number" => {
                        let kind = get(host, schema, "jsonType")?;
                        let kind = if nullish(host, kind)? {
                            host.make_string(u("number"))?
                        } else {
                            kind
                        };
                        let output = object(host, vec![("type", kind)])?;
                        result = finish(host, schema, "number", output)?;
                    }
                    "enum" => {
                        let nullable = get(host, schema, "nullable")?;
                        let nullable = yes(host, nullable)?;
                        let choices = get(host, schema, "values")?;
                        let choices = host.call("copyArray", vec![choices])?;
                        if nullable {
                            let null = host.call("null", vec![])?;
                            host.call("push", vec![choices, null])?;
                        }
                        let output = object(host, vec![("enum", choices)])?;
                        let kind = get(host, schema, "jsonType")?;
                        let kind = if nullish(host, kind)? {
                            let choices = get(host, schema, "values")?;
                            enum_type(host, choices)?
                        } else {
                            kind
                        };
                        if host.kind(kind)? != Kind::Undefined {
                            assign(host, output, "type", kind)?;
                        }
                        result = metadata(host, schema, output)?;
                    }
                    "array" | "record" => {
                        let array = is(host, kind, "array")?;
                        let child = get(host, schema, if array { "item" } else { "value" })?;
                        tasks.push(Task::Container(
                            schema,
                            if array { "array" } else { "record" },
                        ));
                        tasks.push(Task::Visit(child, depth + 1));
                    }
                    "object" => {
                        let properties = host.call("object", vec![])?;
                        let required = host.call("array", vec![])?;
                        let shape = get(host, schema, "shape")?;
                        let entries = entries(host, shape)?.into_iter();
                        tasks.push(Task::Object(ObjectFrame {
                            schema,
                            properties,
                            required,
                            entries,
                            pending: None,
                            depth,
                        }));
                    }
                    "oneOf" => {
                        let branches = get(host, schema, "branches")?;
                        let entries = entries(host, branches)?.into_iter();
                        let branches = host.call("array", vec![])?;
                        tasks.push(Task::OneOf(OneOfFrame {
                            schema,
                            branches,
                            entries,
                            pending: None,
                            depth,
                        }));
                    }
                    "union" => {
                        let io = get(host, options, "io")?;
                        let output_mode = is(host, io, "output")?;
                        let branches = get(host, schema, "branches")?;
                        let mapped = host.call("mapBranchSchemas", vec![branches, options])?;
                        let mapped = if output_mode {
                            let mapped = host.call("copyArray", vec![mapped])?;
                            let nullable = get(host, schema, "nullable")?;
                            if yes(host, nullable)? {
                                let null = typed(host, "null")?;
                                host.call("push", vec![mapped, null])?;
                            }
                            mapped
                        } else {
                            mapped
                        };
                        let output = object(
                            host,
                            vec![(if output_mode { "anyOf" } else { "oneOf" }, mapped)],
                        )?;
                        result = metadata(host, schema, output)?;
                    }
                    "json" => {
                        let output = host.call("object", vec![])?;
                        for name in ["const", "enum"] {
                            let value = get(host, schema, name)?;
                            if host.kind(value)? != Kind::Undefined {
                                let value = get(host, schema, name)?;
                                host.define(output, &u(name), value)?;
                            }
                        }
                        let nullable = get(host, schema, "nullable")?;
                        let output = if yes(host, nullable)? && !host.keys(output)?.is_empty() {
                            let null = typed(host, "null")?;
                            let choices = host.call("array", vec![output, null])?;
                            object(host, vec![("anyOf", choices)])?
                        } else {
                            output
                        };
                        result = metadata(host, schema, output)?;
                    }
                    _ => result = host.undefined()?,
                }
            }
        }
    }
    Ok(result)
}

fn nonnullable_branch<H: Host>(host: &mut H, schema: H::Value) -> Result<H::Value, H::Error> {
    let false_value = host.make_boolean(false)?;
    let extra = object(host, vec![("nullable", false_value)])?;
    host.call("spread", vec![schema, extra])
}
fn clear_null_default<H: Host>(host: &mut H, result: H::Value) -> Result<H::Value, H::Error> {
    let default = get(host, result, "default")?;
    if host.kind(default)? == Kind::Null {
        let key = host.make_string(u("default"))?;
        host.call("delete", vec![result, key])?;
    }
    Ok(result)
}
pub fn branch_json_schema<H: Host>(
    host: &mut H,
    schema: H::Value,
    options: H::Value,
    symbol: H::Value,
) -> Result<H::Value, H::Error> {
    let schema = nonnullable_branch(host, schema)?;
    let result = to_json_schema(host, schema, options, symbol)?;
    clear_null_default(host, result)
}
fn inject_discriminator<H: Host>(
    host: &mut H,
    schema: H::Value,
    discriminator: H::Value,
    name: H::Value,
) -> Result<H::Value, H::Error> {
    let default = get(host, schema, "default")?;
    if host.kind(default)? != Kind::Undefined {
        let default = get(host, schema, "default")?;
        let default = host.call("spreadWithKey", vec![default, discriminator, name])?;
        assign(host, schema, "default", default)?;
    }
    let properties = get(host, schema, "properties")?;
    let properties = if nullish(host, properties)? {
        host.call("object", vec![])?
    } else {
        properties
    };
    let property = typed(host, "string")?;
    let choices = host.call("array", vec![name])?;
    host.define(property, &u("enum"), choices)?;
    let properties = host.call("spreadWithKey", vec![properties, discriminator, property])?;
    let required = get(host, schema, "required")?;
    let required = if nullish(host, required)? {
        host.call("array", vec![])?
    } else {
        required
    };
    let required = host.call("appendUnique", vec![required, discriminator])?;
    let extra = typed(host, "object")?;
    host.define(extra, &u("properties"), properties)?;
    host.define(extra, &u("required"), required)?;
    host.call("spread", vec![schema, extra])
}

pub fn standard_document<H: Host>(
    host: &mut H,
    schema: H::Value,
    io: H::Value,
    options: H::Value,
    symbol: H::Value,
) -> Result<H::Value, H::Error> {
    let target = get(host, options, "target")?;
    let uri = if is(host, target, "draft-2020-12")? {
        "https://json-schema.org/draft/2020-12/schema"
    } else {
        let target = get(host, options, "target")?;
        if is(host, target, "draft-07")? {
            "http://json-schema.org/draft-07/schema#"
        } else {
            let target = get(host, options, "target")?;
            let target = text(host, target, true)?;
            fail(
                host,
                cat(&[&u("Unsupported JSON Schema target: "), &target]),
            )?;
            unreachable!("host errors throw")
        }
    };
    let target = get(host, options, "target")?;
    let conversion = object(host, vec![("io", io), ("target", target)])?;
    let document = to_json_schema(host, schema, conversion, symbol)?;
    let declared = get(host, document, "$schema")?;
    if host.kind(declared)? != Kind::Undefined {
        let declared = get(host, document, "$schema")?;
        if !is(host, declared, uri)? {
            let declared = get(host, document, "$schema")?;
            if !is(host, declared, uri.strip_suffix('#').unwrap_or(uri))? {
                let target = get(host, options, "target")?;
                let target = text(host, target, true)?;
                fail(
                    host,
                    cat(&[
                        &u("Native JSON Schema dialect does not match target: "),
                        &target,
                    ]),
                )?;
            }
        }
    }
    let kind = get(host, schema, "kind")?;
    let tagged = is(host, kind, "oneOf")?;
    let tagged = if tagged {
        true
    } else {
        let kind = get(host, schema, "kind")?;
        is(host, kind, "union")?
    };
    if tagged {
        let nullable = get(host, schema, "nullable")?;
        if !yes(host, nullable)? {
            let object = host.make_string(u("object"))?;
            assign(host, document, "type", object)?;
        }
    }
    let uri = host.make_string(u(uri))?;
    let base = object(host, vec![("$schema", uri)])?;
    host.call("spread", vec![base, document])
}

pub fn to_document<H: Host>(
    host: &mut H,
    schema: H::Value,
    options: H::Value,
    symbol: H::Value,
) -> Result<H::Value, H::Error> {
    let empty = host.call("object", vec![])?;
    let schema = to_json_schema(host, schema, empty, symbol)?;
    let parts = host.call("documentOptions", vec![options])?;
    let id = get(host, parts, "0")?;
    let uri = get(host, parts, "1")?;
    let metadata = get(host, parts, "2")?;
    let base = object(host, vec![("$schema", uri)])?;
    let document = host.call("spread", vec![base, schema])?;
    if host.kind(id)? != Kind::Undefined {
        assign(host, document, "$id", id)?;
    }
    copy_metadata(host, metadata, document, &["title", "description"])?;
    Ok(document)
}

pub fn with_json_schema<H: Host>(
    host: &mut H,
    projection: H::Value,
    document: H::Value,
    symbol: H::Value,
) -> Result<H::Value, H::Error> {
    let json = host.call("isJson", vec![document])?;
    if !yes(host, json)? || host.is_array(document)? {
        fail(host, u("Native JSON Schema must be a JSON object"))?;
    }
    let snapshot = host.call("structuredClone", vec![document])?;
    let validator = host.call("compileSchema", vec![snapshot])?;
    let metadata = object(host, vec![("document", snapshot), ("validator", validator)])?;
    let schema = host.call("spreadWithKey", vec![projection, symbol, metadata])?;
    host.call("standardize", vec![schema])
}

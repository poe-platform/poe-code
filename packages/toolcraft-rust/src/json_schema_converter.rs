//! JSON-schema projection and reference resolution over identity-preserving host values.
use crate::host::Host;

fn yes<H: Host>(host: &mut H, operation: &str, args: Vec<H::Value>) -> Result<bool, H::Error> {
    let value = host.call(operation, args)?;
    host.is_true(value)
}
fn boolean<H: Host>(host: &mut H, value: bool) -> Result<H::Value, H::Error> {
    host.call(if value { "true" } else { "false" }, vec![])
}
fn field_or<H: Host>(
    host: &mut H,
    value: H::Value,
    key: &str,
    fallback: &str,
) -> Result<H::Value, H::Error> {
    let value = host.get(value, key)?;
    if host.is_nullish(value)? {
        host.call(fallback, vec![])
    } else {
        Ok(value)
    }
}
fn set<H: Host>(
    host: &mut H,
    object: H::Value,
    key: &str,
    value: H::Value,
) -> Result<(), H::Error> {
    host.call(&format!("set:{key}"), vec![object, value])?;
    Ok(())
}
fn next<H: Host>(host: &mut H, iterator: H::Value) -> Result<Option<H::Value>, H::Error> {
    let entry = host.call("next", vec![iterator])?;
    let done = host.get(entry, "done")?;
    if yes(host, "truthy", vec![done])? {
        Ok(None)
    } else {
        Ok(Some(host.get(entry, "value")?))
    }
}
fn metadata<H: Host>(
    host: &mut H,
    schema: H::Value,
    source: H::Value,
    overrides: H::Value,
) -> Result<H::Value, H::Error> {
    let result = host.call("clone", vec![schema])?;
    let mut description = host.get(overrides, "description")?;
    if host.is_nullish(description)? {
        description = host.get(source, "description")?;
    }
    let default = if yes(host, "hasDefault", vec![overrides])? {
        host.get(overrides, "default")?
    } else {
        host.get(source, "default")?
    };
    if !host.is_undefined(description)? {
        set(host, result, "description", description)?;
    }
    if !host.is_undefined(default)? {
        set(host, result, "default", default)?;
    }
    let nullable = host.get(overrides, "nullable")?;
    if host.is_true(nullable)? {
        set(host, result, "nullable", nullable)?;
    }
    Ok(result)
}
fn common<H: Host>(
    host: &mut H,
    schema: H::Value,
    nullable: H::Value,
    default: H::Value,
) -> Result<H::Value, H::Error> {
    let result = host.call("record", vec![])?;
    let description = host.get(schema, "description")?;
    if !host.is_undefined(description)? {
        let description = host.get(schema, "description")?;
        set(host, result, "description", description)?;
    }
    if !host.is_undefined(default)? {
        set(host, result, "default", default)?;
    }
    if yes(host, "truthy", vec![nullable])? {
        let value = boolean(host, true)?;
        set(host, result, "nullable", value)?;
    }
    Ok(result)
}
fn nullable_override<H: Host>(host: &mut H, nullable: H::Value) -> Result<H::Value, H::Error> {
    let overrides = host.call("record", vec![])?;
    set(host, overrides, "nullable", nullable)?;
    Ok(overrides)
}
fn projection_json<H: Host>(host: &mut H, source: H::Value) -> Result<H::Value, H::Error> {
    let schema = host.call("Json", vec![])?;
    let overrides = host.call("record", vec![])?;
    metadata(host, schema, source, overrides)
}
fn present<H: Host>(host: &mut H, value: H::Value, key: &str) -> Result<bool, H::Error> {
    let value = host.get(value, key)?;
    Ok(!host.is_undefined(value)?)
}
fn composition<H: Host>(host: &mut H, schema: H::Value) -> Result<H::Value, H::Error> {
    for keyword in ["oneOf", "anyOf", "allOf"] {
        if present(host, schema, keyword)? {
            let result = host.call("record", vec![])?;
            let key = host.call(&format!("literal:{keyword}"), vec![])?;
            set(host, result, "keyword", key)?;
            let branches = host.get(schema, keyword)?;
            set(host, result, "branches", branches)?;
            return Ok(result);
        }
    }
    host.call("undefined", vec![])
}
fn ref_path<H: Host>(host: &mut H, reference: H::Value) -> Result<H::Value, H::Error> {
    if host.is_undefined(reference)? {
        return host.call("undefined", vec![]);
    }
    if host.is_kind(reference, "#")? || yes(host, "refPrefix", vec![reference])? {
        Ok(reference)
    } else {
        host.call("undefined", vec![])
    }
}
fn local_ref<H: Host>(
    host: &mut H,
    root: H::Value,
    reference: H::Value,
) -> Result<H::Value, H::Error> {
    let path = ref_path(host, reference)?;
    if host.is_undefined(path)? {
        return host.call("undefined", vec![]);
    }
    if host.is_kind(path, "#")? {
        return Ok(root);
    }
    let segments = host.call("refSegments", vec![path])?;
    let iterator = host.call("iterator", vec![segments])?;
    let mut current = root;
    while let Some(segment) = next(host, iterator)? {
        if yes(host, "array", vec![current])? {
            if !yes(host, "validIndex", vec![segment])? {
                return host.call("undefined", vec![]);
            }
            let index = host.call("parseIndex", vec![segment])?;
            current = host.call("property", vec![current, index])?;
        } else {
            if !yes(host, "object", vec![current])? || !yes(host, "own", vec![current, segment])? {
                return host.call("undefined", vec![]);
            }
            current = host.call("property", vec![current, segment])?;
        }
    }
    if yes(host, "boolean", vec![current])? || yes(host, "object", vec![current])? {
        Ok(current)
    } else {
        host.call("undefined", vec![])
    }
}
fn resolve<H: Host>(
    host: &mut H,
    schema: H::Value,
    root: H::Value,
    path: H::Value,
    active: H::Value,
) -> Result<H::Value, H::Error> {
    if yes(host, "boolean", vec![schema])? {
        return host.call("record", vec![]);
    }
    if !present(host, schema, "$ref")? || yes(host, "has", vec![active, schema])? {
        return Ok(schema);
    }
    host.call("add", vec![active, schema])?;
    let reference = host.get(schema, "$ref")?;
    let target = local_ref(host, root, reference)?;
    let siblings = host.call("withoutRef", vec![schema])?;
    if host.is_undefined(target)? || yes(host, "boolean", vec![target])? {
        return Ok(siblings);
    }
    let resolved = host.call("resolve", vec![target, root, path, active])?;
    let keys = host.call("keys", vec![siblings])?;
    if yes(host, "empty", vec![keys])? {
        Ok(resolved)
    } else {
        host.call("mergeReferences", vec![resolved, siblings])
    }
}
fn normalize<H: Host>(host: &mut H, schema: H::Value) -> Result<(H::Value, H::Value), H::Error> {
    let types = host.get(schema, "type")?;
    if !yes(host, "array", vec![types])? {
        let nullable = host.get(schema, "nullable")?;
        let nullable = boolean(host, host.is_true(nullable)?)?;
        return Ok((schema, nullable));
    }
    let types = host.get(schema, "type")?;
    let next_types = host.call("nonNullTypes", vec![types])?;
    let types = host.get(schema, "type")?;
    if yes(host, "sameLength", vec![next_types, types])? {
        let nullable = host.get(schema, "nullable")?;
        return Ok((schema, boolean(host, host.is_true(nullable)?)?));
    }
    let result = host.call("clone", vec![schema])?;
    let new_type = if yes(host, "empty", vec![next_types])? {
        host.call("undefined", vec![])?
    } else if yes(host, "single", vec![next_types])? {
        host.get(next_types, "0")?
    } else {
        next_types
    };
    set(host, result, "type", new_type)?;
    let value = host.call("undefined", vec![])?;
    set(host, result, "nullable", value)?;
    Ok((result, boolean(host, true)?))
}

pub fn run<H: Host>(
    host: &mut H,
    operation: &str,
    args: &[H::Value],
) -> Result<H::Value, H::Error> {
    match (operation, args) {
        ("root", [schema]) => {
            let recursive = yes(host, "selfRoot", vec![*schema, *schema])?;
            if recursive || yes(host, "needsNative", vec![*schema])? {
                let path = host.call("list", vec![])?;
                let resolved = host.call("resolve", vec![*schema, *schema, path])?;
                let kind = host.get(resolved, "type")?;
                let projection = if host.is_kind(kind, "object")? {
                    host.call("nativeObject", vec![*schema])?
                } else if recursive || present(host, *schema, "allOf")? {
                    host.call("Json", vec![])?
                } else {
                    host.call("projection", vec![*schema, *schema, path])?
                };
                let overrides = host.call("record", vec![])?;
                let projection = metadata(host, projection, *schema, overrides)?;
                host.call("withNative", vec![projection, *schema])
            } else {
                let path = host.call("list", vec![])?;
                host.call("convert", vec![*schema, *schema, path])
            }
        }
        ("needsNative", [schema, ..]) => {
            if yes(host, "boolean", vec![*schema])? {
                return boolean(host, true);
            }
            let kind = host.get(*schema, "type")?;
            if yes(host, "array", vec![kind])? {
                return boolean(host, true);
            }
            let kind = host.get(*schema, "type")?;
            if host.is_kind(kind, "array")? && !present(host, *schema, "items")? {
                return boolean(host, true);
            }
            if !present(host, *schema, "type")?
                && !present(host, *schema, "enum")?
                && !present(host, *schema, "const")?
            {
                return boolean(host, true);
            }
            if present(host, *schema, "$ref")? {
                return boolean(host, true);
            }
            let composed = composition(host, *schema)?;
            if !host.is_undefined(composed)? {
                return boolean(host, true);
            }
            if present(host, *schema, "type")?
                && (present(host, *schema, "enum")? || present(host, *schema, "const")?)
            {
                return boolean(host, true);
            }
            let kind = host.get(*schema, "type")?;
            if host.is_kind(kind, "object")? {
                let additional = host.get(*schema, "additionalProperties")?;
                let false_value = boolean(host, false)?;
                if !host.same(additional, false_value)? {
                    return boolean(host, true);
                }
            }
            let keys = host.call("keys", vec![*schema])?;
            if yes(host, "some:unknownKeyword", vec![keys])? {
                return boolean(host, true);
            }
            if present(host, *schema, "enum")? || present(host, *schema, "const")? {
                let keys = host.call("keys", vec![*schema])?;
                if yes(host, "some:unknownLiteralKeyword", vec![keys])? {
                    return boolean(host, true);
                }
            }
            let children = host.call("nativeChildren", vec![*schema])?;
            host.call("some:needsNative", vec![children])
        }
        ("unknownKeyword" | "unknownLiteralKeyword", [key, ..]) => {
            let keywords = if operation == "unknownKeyword" {
                &[
                    "type",
                    "properties",
                    "required",
                    "additionalProperties",
                    "items",
                    "enum",
                    "const",
                    "default",
                    "description",
                    "minLength",
                    "maxLength",
                    "minimum",
                    "maximum",
                    "minItems",
                    "maxItems",
                    "nullable",
                    "pattern",
                ][..]
            } else {
                &[
                    "type",
                    "enum",
                    "const",
                    "default",
                    "description",
                    "nullable",
                ][..]
            };
            for keyword in keywords {
                if host.is_kind(*key, keyword)? {
                    return boolean(host, false);
                }
            }
            boolean(host, true)
        }
        ("selfRoot", [schema, root]) => {
            let path = host.call("rootPath", vec![])?;
            let active = host.call("set", vec![])?;
            host.call("selfRef", vec![*schema, *root, path, active])
        }
        ("selfRef", [schema, root, path, active]) => {
            if yes(host, "boolean", vec![*schema])? {
                return boolean(host, false);
            }
            let active = host.call("selfState", vec![*path, *active])?;
            let reference = host.get(*schema, "$ref")?;
            let reference = ref_path(host, reference)?;
            if !host.is_undefined(reference)? {
                if yes(host, "has", vec![active, reference])? {
                    return boolean(host, true);
                }
                let target = local_ref(host, *root, reference)?;
                if !host.is_undefined(target)?
                    && yes(host, "selfRef", vec![target, *root, reference, active])?
                {
                    return boolean(host, true);
                }
            }
            if present(host, *schema, "items")? {
                let items = host.get(*schema, "items")?;
                let array = yes(host, "array", vec![items])?;
                let items = host.get(*schema, "items")?;
                let found = if array {
                    yes(host, "selfItems", vec![items, *root, *path, active])?
                } else {
                    let path = host.call("selfItemPath", vec![*path])?;
                    yes(host, "selfRef", vec![items, *root, path, active])?
                };
                if found {
                    return boolean(host, true);
                }
            }
            let additional = host.get(*schema, "additionalProperties")?;
            if yes(host, "objectType", vec![additional])? {
                let additional = host.get(*schema, "additionalProperties")?;
                if !yes(host, "nullValue", vec![additional])? {
                    let additional = host.get(*schema, "additionalProperties")?;
                    let path = host.call("selfAdditionalPath", vec![*path])?;
                    if yes(host, "selfRef", vec![additional, *root, path, active])? {
                        return boolean(host, true);
                    }
                }
            }
            host.call("selfChildren", vec![*schema, *root, *path, active])
        }
        ("resolve", [schema, root, path]) => {
            let active = host.call("set", vec![])?;
            resolve(host, *schema, *root, *path, active)
        }
        ("resolve", [schema, root, path, active]) => resolve(host, *schema, *root, *path, *active),
        ("mergeReferences", [base, overlay]) => {
            let mut fields = Vec::new();
            for key in ["properties", "$defs", "required"] {
                let base_value = host.get(*base, key)?;
                let absent = if host.is_undefined(base_value)? {
                    let overlay_value = host.get(*overlay, key)?;
                    host.is_undefined(overlay_value)?
                } else {
                    false
                };
                let merged = if absent {
                    host.call("undefined", vec![])?
                } else {
                    let base_value = host.get(*base, key)?;
                    let overlay_value = host.get(*overlay, key)?;
                    host.call(
                        if key == "required" {
                            "mergeRequired"
                        } else {
                            "mergeObjects"
                        },
                        vec![base_value, overlay_value],
                    )?
                };
                fields.push(merged);
            }
            let result = host.call("mergeObjects", vec![*base, *overlay])?;
            for (key, value) in [
                ("$defs", fields[1]),
                ("properties", fields[0]),
                ("required", fields[2]),
            ] {
                if !host.is_undefined(value)? {
                    set(host, result, key, value)?;
                }
            }
            Ok(result)
        }
        ("projection", [schema, root, path]) => {
            if yes(host, "boolean", vec![*schema])? {
                return host.call("Json", vec![]);
            }
            if present(host, *schema, "$ref")? {
                let reference = host.get(*schema, "$ref")?;
                let target = local_ref(host, *root, reference)?;
                let unavailable = if host.is_undefined(target)? {
                    true
                } else {
                    let reference = host.get(*schema, "$ref")?;
                    let target = local_ref(host, *root, reference)?;
                    yes(host, "boolean", vec![target])?
                };
                if unavailable {
                    return projection_json(host, *schema);
                }
            }
            let kind = host.get(*schema, "type")?;
            if yes(host, "array", vec![kind])? {
                let kind = host.get(*schema, "type")?;
                let types = host.call("nonNullTypes", vec![kind])?;
                if !yes(host, "single", vec![types])? {
                    return projection_json(host, *schema);
                }
                let projected = host.call("clone", vec![*schema])?;
                let kind = host.get(types, "0")?;
                set(host, projected, "type", kind)?;
                let types = host.get(*schema, "type")?;
                let nullable = if yes(host, "containsNullType", vec![types])? {
                    boolean(host, true)?
                } else {
                    host.get(*schema, "nullable")?
                };
                set(host, projected, "nullable", nullable)?;
                return host.call("convert", vec![projected, *root, *path]);
            }
            if yes(host, "selfRoot", vec![*schema, *root])? {
                return projection_json(host, *schema);
            }
            let kind = host.get(*schema, "type")?;
            if host.is_kind(kind, "array")? {
                if !present(host, *schema, "items")? {
                    return projection_json(host, *schema);
                }
                let items = host.get(*schema, "items")?;
                if yes(host, "array", vec![items])? {
                    return projection_json(host, *schema);
                }
            }
            if !present(host, *schema, "type")?
                && !present(host, *schema, "enum")?
                && !present(host, *schema, "const")?
                && !present(host, *schema, "$ref")?
            {
                let composed = composition(host, *schema)?;
                if host.is_undefined(composed)? {
                    return projection_json(host, *schema);
                }
            }
            host.call("convert", vec![*schema, *root, *path])
        }
        ("nativeObject", [root]) => {
            let state = host.call("projectionState", vec![])?;
            let required = boolean(host, true)?;
            host.call("collect", vec![*root, *root, state, required])?;
            let properties = host.get(state, "properties")?;
            let entries = host.call("entries", vec![properties])?;
            let iterator = host.call("iterator", vec![entries])?;
            let shape = host.call("record", vec![])?;
            while let Some(entry) = next(host, iterator)? {
                let key = host.get(entry, "0")?;
                let property = host.get(entry, "1")?;
                let unconditional = host.get(state, "unconditional")?;
                let is_unconditional = yes(host, "own", vec![unconditional, key])?;
                let field = if is_unconditional {
                    let property = host.call("property", vec![unconditional, key])?;
                    let path = host.call("list", vec![])?;
                    let path = host.call("pathProperty", vec![path, key])?;
                    host.call("projection", vec![property, *root, path])?
                } else {
                    let candidates =
                        host.call("conditionalCandidates", vec![state, key, property])?;
                    let projected = host.call("conditional", vec![*root, key, candidates])?;
                    host.call("withoutDefault", vec![projected])?
                };
                let required = host.get(state, "required")?;
                let field = if yes(host, "has", vec![required, key])? {
                    field
                } else {
                    host.call("Optional", vec![field])?
                };
                host.call("define", vec![shape, key, field])?;
            }
            let options = host.call("record", vec![])?;
            let additional = host.get(*root, "additionalProperties")?;
            let false_value = boolean(host, false)?;
            let additional = boolean(host, !host.same(additional, false_value)?)?;
            set(host, options, "additionalProperties", additional)?;
            host.call("Object", vec![shape, options])
        }
        ("collect", [source, root, state, required]) => {
            let visited = host.get(*state, "visited")?;
            if yes(host, "has", vec![visited, *source])? {
                return host.call("undefined", vec![]);
            }
            host.call("add", vec![visited, *source])?;
            let path = host.call("list", vec![])?;
            let resolved = host.call("resolve", vec![*source, *root, path])?;
            host.call("collectProperties", vec![resolved, *state, *required])?;
            host.call("collectBranches", vec![resolved, *root, *state, *required])
        }
        ("conditional", [root, key, candidates]) => {
            let mut branches = host.get(*root, "oneOf")?;
            if host.is_nullish(branches)? {
                branches = field_or(host, *root, "anyOf", "list")?;
            }
            if yes(host, "multiple", vec![branches])?
                && yes(host, "every:hasProperty", vec![branches, *root, *key])?
            {
                let projected =
                    host.call("map:projectCandidate", vec![*candidates, *root, *key])?;
                if yes(host, "every:isEnum", vec![projected])? {
                    let values = host.call("enumValues", vec![projected])?;
                    if !yes(host, "empty", vec![values])? {
                        return host.call("Enum", vec![values]);
                    }
                }
            }
            host.call("Json", vec![])
        }
        ("hasProperty", [branch, _, root, key]) => {
            let path = host.call("list", vec![])?;
            let resolved = host.call("resolve", vec![*branch, *root, path])?;
            let properties = field_or(host, resolved, "properties", "record")?;
            host.call("own", vec![properties, *key])
        }
        ("projectCandidate", [candidate, _, root, key]) => {
            let path = host.call("list", vec![])?;
            let path = host.call("pathProperty", vec![path, *key])?;
            host.call("projection", vec![*candidate, *root, path])
        }
        ("isEnum", [field, ..]) => {
            let kind = host.get(*field, "kind")?;
            boolean(host, host.is_kind(kind, "enum")?)
        }
        ("convert", [schema, root, path]) => {
            if yes(host, "boolean", vec![*schema])? {
                return host.call("Json", vec![]);
            }
            let resolved = host.call("resolve", vec![*schema, *root, *path])?;
            let (schema, nullable) = normalize(host, resolved)?;
            let composed = composition(host, schema)?;
            let kind = host.get(schema, "type")?;
            if yes(host, "array", vec![kind])? {
                let kind = host.get(schema, "type")?;
                return host.call("invalidType", vec![*path, kind]);
            }
            if present(host, resolved, "const")? {
                return host.call("constant", vec![resolved, nullable]);
            }
            if present(host, resolved, "enum")? {
                return host.call("enum", vec![resolved, nullable]);
            }
            if !host.is_undefined(composed)? {
                return host.call("composition", vec![schema, *root, nullable, *path]);
            }
            let properties = field_or(host, schema, "properties", "record")?;
            let keys = host.call("keys", vec![properties])?;
            let kind = host.get(schema, "type")?;
            let mut record = host.is_kind(kind, "object")? && yes(host, "empty", vec![keys])?;
            if record {
                let additional = host.get(schema, "additionalProperties")?;
                record = yes(host, "objectType", vec![additional])?;
                if record {
                    let additional = host.get(schema, "additionalProperties")?;
                    record = !yes(host, "nullValue", vec![additional])?;
                }
            }
            if record {
                let additional = host.get(schema, "additionalProperties")?;
                let path = host.call("pathAdditional", vec![*path])?;
                let item = host.call("convert", vec![additional, *root, path])?;
                let projected = host.call("Record", vec![item])?;
                let overrides = nullable_override(host, nullable)?;
                return metadata(host, projected, schema, overrides);
            }
            let kind = host.get(schema, "type")?;
            for (name, constructor, constraints, default_check) in [
                (
                    "string",
                    "String",
                    &["minLength", "maxLength"][..],
                    "string",
                ),
                ("number", "Number", &["minimum", "maximum"][..], "number"),
                (
                    "integer",
                    "Number",
                    &["minimum", "maximum"][..],
                    "integerDefault",
                ),
                ("boolean", "Boolean", &[][..], "boolean"),
            ] {
                if host.is_kind(kind, name)? {
                    let default = host.get(schema, "default")?;
                    let default = if yes(host, default_check, vec![default])? {
                        default
                    } else {
                        host.call("undefined", vec![])?
                    };
                    let options = common(host, schema, nullable, default)?;
                    if name == "string" && present(host, schema, "pattern")? {
                        let pattern = host.get(schema, "pattern")?;
                        set(host, options, "pattern", pattern)?;
                    }
                    if name == "integer" {
                        let integer = host.call("literal:integer", vec![])?;
                        set(host, options, "jsonType", integer)?;
                    }
                    for key in constraints {
                        let value = host.get(schema, key)?;
                        set(host, options, key, value)?;
                    }
                    return host.call(constructor, vec![options]);
                }
            }
            if host.is_kind(kind, "array")? {
                let items = host.get(schema, "items")?;
                if yes(host, "array", vec![items])? {
                    return projection_json(host, schema);
                }
                if !present(host, schema, "items")? {
                    return host.call("missingItems", vec![*path]);
                }
                let items = host.get(schema, "items")?;
                let path = host.call("pathItems", vec![*path])?;
                let item = host.call("convert", vec![items, *root, path])?;
                let default = host.get(schema, "default")?;
                let default = if yes(host, "array", vec![default])?
                    && yes(host, "every:json", vec![default])?
                {
                    default
                } else {
                    host.call("undefined", vec![])?
                };
                let options = common(host, schema, nullable, default)?;
                for key in ["minItems", "maxItems"] {
                    let value = host.get(schema, key)?;
                    set(host, options, key, value)?;
                }
                return host.call("Array", vec![item, options]);
            }
            if host.is_kind(kind, "object")? {
                let omit = host.call("undefined", vec![])?;
                return host.call("objectSchema", vec![schema, *root, *path, nullable, omit]);
            }
            if host.is_kind(kind, "null")? {
                let null = host.call("null", vec![])?;
                let values = host.call("singleton", vec![null])?;
                let projected = host.call("Enum", vec![values])?;
                let mut default = host.get(schema, "default")?;
                if !yes(host, "json", vec![default])? || host.is_nullish(default)? {
                    default = null;
                }
                let true_value = boolean(host, true)?;
                let overrides = nullable_override(host, true_value)?;
                set(host, overrides, "default", default)?;
                return metadata(host, projected, schema, overrides);
            }
            if host.is_undefined(kind)? {
                if yes(host, "truthy", vec![nullable])? {
                    let projected = host.call("Json", vec![])?;
                    let true_value = boolean(host, true)?;
                    let overrides = nullable_override(host, true_value)?;
                    return metadata(host, projected, schema, overrides);
                }
                return host.call("missingType", vec![*path]);
            }
            let kind = host.get(schema, "type")?;
            host.call("invalidType", vec![*path, kind])
        }
        ("integerDefault", [value, ..]) => {
            let valid = yes(host, "number", vec![*value])? && yes(host, "integer", vec![*value])?;
            boolean(host, valid)
        }
        ("primitive", [value, ..]) => {
            let valid = yes(host, "nullValue", vec![*value])?
                || yes(host, "string", vec![*value])?
                || yes(host, "number", vec![*value])?
                || yes(host, "boolean", vec![*value])?;
            boolean(host, valid)
        }
        ("json", [value, ..]) => {
            if yes(host, "primitive", vec![*value])? {
                return boolean(host, true);
            }
            if yes(host, "array", vec![*value])? {
                return host.call("every:json", vec![*value]);
            }
            if !yes(host, "object", vec![*value])? {
                return boolean(host, false);
            }
            let values = host.call("values", vec![*value])?;
            host.call("every:json", vec![values])
        }
        ("append", [description, addition]) => {
            if host.is_undefined(*addition)? || yes(host, "empty", vec![*addition])? {
                return Ok(*description);
            }
            if host.is_undefined(*description)? || yes(host, "empty", vec![*description])? {
                return Ok(*addition);
            }
            host.call("joinDescription", vec![*description, *addition])
        }
        ("constant", [schema, nullable]) => {
            let value = host.get(*schema, "const")?;
            if yes(host, "primitive", vec![value])? {
                let value = host.get(*schema, "const")?;
                let values = host.call("singleton", vec![value])?;
                let default = host.get(*schema, "const")?;
                let options = common(host, *schema, *nullable, default)?;
                let default = host.get(*schema, "const")?;
                set(host, options, "default", default)?;
                let kind = host.get(*schema, "type")?;
                if host.is_kind(kind, "integer")? {
                    let value = host.get(*schema, "const")?;
                    if yes(host, "number", vec![value])? {
                        let integer = host.call("literal:integer", vec![])?;
                        set(host, options, "jsonType", integer)?;
                    }
                }
                return host.call("Enum", vec![values, options]);
            }
            let options = host.call("record", vec![])?;
            let value = host.get(*schema, "const")?;
            set(host, options, "const", value)?;
            let projected = host.call("Json", vec![options])?;
            let overrides = host.call("record", vec![])?;
            let value = host.get(*schema, "const")?;
            set(host, overrides, "default", value)?;
            let nullable = if yes(host, "truthy", vec![*nullable])? {
                *nullable
            } else {
                let value = host.get(*schema, "const")?;
                host.call("nullValue", vec![value])?
            };
            set(host, overrides, "nullable", nullable)?;
            let description = host.get(*schema, "description")?;
            let value = host.get(*schema, "const")?;
            let addition = host.call("literalDescription", vec![value])?;
            let description = host.call("append", vec![description, addition])?;
            set(host, overrides, "description", description)?;
            metadata(host, projected, *schema, overrides)
        }
        ("enum", [schema, nullable]) => {
            let values = field_or(host, *schema, "enum", "list")?;
            if yes(host, "single", vec![values])? {
                let first = host.get(values, "0")?;
                if yes(host, "nullValue", vec![first])? {
                    let null = host.call("null", vec![])?;
                    let values = host.call("singleton", vec![null])?;
                    let default = host.get(*schema, "default")?;
                    let default = if yes(host, "nullValue", vec![default])? {
                        null
                    } else {
                        host.call("undefined", vec![])?
                    };
                    let options = common(host, *schema, *nullable, default)?;
                    return host.call("Enum", vec![values, options]);
                }
            }
            let non_null = host.call("nonNull", vec![values])?;
            let has_null = !yes(host, "sameLength", vec![non_null, values])?;
            if yes(host, "every:primitive", vec![non_null])? && !yes(host, "empty", vec![non_null])?
            {
                let nullable = if yes(host, "truthy", vec![*nullable])? {
                    *nullable
                } else {
                    boolean(host, has_null)?
                };
                let default = host.get(*schema, "default")?;
                let default = if yes(host, "primitive", vec![default])?
                    && yes(host, "includes", vec![non_null, default])?
                {
                    default
                } else {
                    host.call("undefined", vec![])?
                };
                let options = common(host, *schema, nullable, default)?;
                let kind = host.get(*schema, "type")?;
                if host.is_kind(kind, "integer")?
                    && yes(host, "every:integerValue", vec![non_null])?
                {
                    let integer = host.call("literal:integer", vec![])?;
                    set(host, options, "jsonType", integer)?;
                }
                return host.call("Enum", vec![non_null, options]);
            }
            let options = host.call("record", vec![])?;
            set(host, options, "enum", values)?;
            let projected = host.call("Json", vec![options])?;
            let nullable = if yes(host, "truthy", vec![*nullable])? {
                *nullable
            } else {
                boolean(host, has_null)?
            };
            let overrides = nullable_override(host, nullable)?;
            let description = host.get(*schema, "description")?;
            let addition = host.call("enumDescription", vec![values])?;
            let description = host.call("append", vec![description, addition])?;
            set(host, overrides, "description", description)?;
            metadata(host, projected, *schema, overrides)
        }
        ("integerValue", [value, ..]) => host.call("integer", vec![*value]),
        ("objectSchema", [schema, root, path, nullable, omit]) => {
            let resolved = host.call("resolve", vec![*schema, *root, *path])?;
            let (schema, normalized_nullable) = normalize(host, resolved)?;
            let properties = field_or(host, schema, "properties", "record")?;
            let required = field_or(host, schema, "required", "list")?;
            let required = host.call("set", vec![required])?;
            let shape = host.call("record", vec![])?;
            let kind = host.get(schema, "type")?;
            if !host.is_kind(kind, "object")? && !present(host, schema, "properties")? {
                return host.call("notObject", vec![*path, schema]);
            }
            let entries = host.call("entries", vec![properties])?;
            let iterator = host.call("iterator", vec![entries])?;
            while let Some(entry) = next(host, iterator)? {
                let key = host.get(entry, "0")?;
                let property = host.get(entry, "1")?;
                if host.same(key, *omit)? {
                    continue;
                }
                let path = host.call("pathProperty", vec![*path, key])?;
                let field = host.call("convert", vec![property, *root, path])?;
                let field = if yes(host, "has", vec![required, key])? {
                    field
                } else {
                    host.call("Optional", vec![field])?
                };
                host.call("define", vec![shape, key, field])?;
            }
            let options = host.call("record", vec![])?;
            let additional = host.get(schema, "additionalProperties")?;
            if yes(host, "boolean", vec![additional])? {
                let additional = host.get(schema, "additionalProperties")?;
                set(host, options, "additionalProperties", additional)?;
            }
            let projected = host.call("Object", vec![shape, options])?;
            let nullable = if host.is_nullish(*nullable)? {
                normalized_nullable
            } else {
                *nullable
            };
            let overrides = nullable_override(host, nullable)?;
            metadata(host, projected, schema, overrides)
        }
        ("composition", [schema, root, nullable, path]) => {
            let composed = composition(host, *schema)?;
            let (branch_schemas, keyword) = if host.is_nullish(composed)? {
                (
                    host.call("list", vec![])?,
                    host.call("literal:oneOf", vec![])?,
                )
            } else {
                (
                    field_or(host, composed, "branches", "list")?,
                    field_or(host, composed, "keyword", "literal:oneOf")?,
                )
            };
            let branches = host.call(
                "map:resolveBranch",
                vec![branch_schemas, *root, *path, keyword],
            )?;
            let overrides = nullable_override(host, *nullable)?;
            if yes(host, "some:notObjectBranch", vec![branches])? {
                let projected = host.call("Json", vec![])?;
                return metadata(host, projected, *schema, overrides);
            }
            let discriminator = host.call("discriminator", vec![branches, *root, *path])?;
            if !host.is_undefined(discriminator)? {
                let entries = host.call(
                    "map:discriminatedBranch",
                    vec![branches, *root, *path, keyword, discriminator],
                )?;
                let branches = host.call("fromEntries", vec![entries])?;
                let options = host.call("record", vec![])?;
                set(host, options, "discriminator", discriminator)?;
                set(host, options, "branches", branches)?;
                let projected = host.call("OneOf", vec![options])?;
                return metadata(host, projected, *schema, overrides);
            }
            let fingerprints = host.call("fingerprints", vec![branches])?;
            if !yes(host, "allUnique", vec![fingerprints])? {
                let projected = host.call("Json", vec![])?;
                return metadata(host, projected, *schema, overrides);
            }
            let converted = host.call("map:objectBranch", vec![branches, *root, *path, keyword])?;
            let projected = host.call("Union", vec![converted])?;
            metadata(host, projected, *schema, overrides)
        }
        ("resolveBranch", [branch, index, root, path, keyword]) => {
            let path = host.call("pathBranch", vec![*path, *keyword, *index])?;
            host.call("resolve", vec![*branch, *root, path])
        }
        ("notObjectBranch", [branch, ..]) => {
            let kind = host.get(*branch, "type")?;
            let invalid = !host.is_kind(kind, "object")? && !present(host, *branch, "properties")?;
            boolean(host, invalid)
        }
        ("objectBranch", [branch, index, root, path, keyword]) => {
            let path = host.call("pathBranch", vec![*path, *keyword, *index])?;
            let undefined = host.call("undefined", vec![])?;
            host.call(
                "objectSchema",
                vec![*branch, *root, path, undefined, undefined],
            )
        }
        ("discriminatedBranch", [branch, index, root, path, keyword, discriminator]) => {
            let literal = host.call("literalValue", vec![*branch, *discriminator, *root])?;
            let path = host.call("pathBranch", vec![*path, *keyword, *index])?;
            let undefined = host.call("undefined", vec![])?;
            let projected = host.call(
                "objectSchema",
                vec![*branch, *root, path, undefined, *discriminator],
            )?;
            host.call("pair", vec![literal, projected])
        }
        ("discriminator", [branches, root, path]) => {
            let first = host.call("first", vec![*branches])?;
            if host.is_undefined(first)? {
                return host.call("emptyBranches", vec![*path]);
            }
            let properties = field_or(host, first, "properties", "record")?;
            let keys = host.call("keys", vec![properties])?;
            let iterator = host.call("iterator", vec![keys])?;
            while let Some(candidate) = next(host, iterator)? {
                let values = host.call("list", vec![])?;
                let matches = yes(
                    host,
                    "matchBranches",
                    vec![*branches, candidate, *root, values],
                )?;
                if matches && yes(host, "allUnique", vec![values])? {
                    return Ok(candidate);
                }
            }
            host.call("undefined", vec![])
        }
        ("matchBranch", [branch, candidate, root, values]) => {
            let required = field_or(host, *branch, "required", "list")?;
            let required = host.call("set", vec![required])?;
            if !yes(host, "has", vec![required, *candidate])? {
                return boolean(host, false);
            }
            let literal = host.call("literalValue", vec![*branch, *candidate, *root])?;
            if host.is_undefined(literal)? {
                return boolean(host, false);
            }
            host.call("push", vec![*values, literal])?;
            boolean(host, true)
        }
        ("literalValue", [branch, key, root]) => {
            let properties = host.get(*branch, "properties")?;
            let property = if host.is_nullish(properties)? {
                host.call("undefined", vec![])?
            } else {
                host.call("property", vec![properties, *key])?
            };
            if host.is_undefined(property)? {
                return host.call("undefined", vec![]);
            }
            let path = host.call("list", vec![])?;
            let resolved = host.call("resolve", vec![property, *root, path])?;
            let constant = host.get(resolved, "const")?;
            if yes(host, "string", vec![constant])? {
                return host.get(resolved, "const");
            }
            if present(host, resolved, "enum")? {
                let values = host.get(resolved, "enum")?;
                if yes(host, "single", vec![values])? {
                    let values = host.get(resolved, "enum")?;
                    let first = host.get(values, "0")?;
                    if yes(host, "string", vec![first])? {
                        let values = host.get(resolved, "enum")?;
                        return host.get(values, "0");
                    }
                }
            }
            host.call("undefined", vec![])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

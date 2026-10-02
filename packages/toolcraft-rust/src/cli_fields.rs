//! CLI schema traversal, variant admission, option naming and positional policy.
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
    macro_rules! kind {
        ($value:expr,$kind:expr) => {{
            let kind = host.get($value, "kind")?;
            host.is_kind(kind, $kind)?
        }};
    }
    macro_rules! bool_value {
        ($value:expr) => {{
            let value = $value;
            host.call(if value { "true" } else { "false" }, vec![])?
        }};
    }
    match (operation, args) {
        ("collect", [schema, casing, flags, path, optional, context]) => {
            let collected = c!("collected");
            c!(
                "eachShape",
                *schema,
                *casing,
                *flags,
                *path,
                *optional,
                *context,
                collected
            );
            Ok(collected)
        }
        ("unwrap", [schema]) => {
            if kind!(*schema, "optional") {
                let inner = host.get(*schema, "inner")?;
                host.call("unwrap", vec![inner])
            } else {
                Ok(*schema)
            }
        }
        ("child", [key, raw, casing, flags, path, inherited, context, collected]) => {
            let path = c!("nextPath", *path, *key);
            let optional = if yes!(*inherited) {
                *inherited
            } else {
                bool_value!(kind!(*raw, "optional"))
            };
            let child = c!("unwrap", *raw);
            let required = if kind!(*raw, "optional") {
                false
            } else {
                let default = host.get(child, "default")?;
                host.is_undefined(default)?
            };
            let required = bool_value!(required);
            if kind!(child, "object") {
                let nested = c!("collect", child, *casing, *flags, path, optional, *context);
                c!("appendCollected", *collected, nested);
            } else if kind!(child, "oneOf") {
                let variant_id = c!("oneOfId", path);
                let branch_ids = c!("branchKeys", child);
                let params = vec![
                    child, *casing, *flags, path, optional, required, *context, branch_ids,
                ];
                let control = control_field(host, &params, false)?;
                c!("appendControl", *collected, control);
                let branches = c!("list");
                c!(
                    "appendOneOfVariant",
                    *collected,
                    variant_id,
                    control,
                    optional,
                    required,
                    *context,
                    branches
                );
                c!(
                    "eachOneOf",
                    child,
                    *casing,
                    *flags,
                    path,
                    variant_id,
                    *collected,
                    branches
                );
            } else if kind!(child, "union") {
                let variant_id = c!("unionId", path);
                let control_path = c!("unionPath", path);
                let display = c!("unionDisplay", path);
                let seen = c!("set");
                let branch_ids = c!("unionIds", child, *casing, seen);
                let params = vec![
                    child,
                    *casing,
                    *flags,
                    control_path,
                    optional,
                    required,
                    *context,
                    branch_ids,
                    display,
                ];
                let control = control_field(host, &params, true)?;
                c!("appendControl", *collected, control);
                let branches = c!("list");
                c!(
                    "appendUnionVariant",
                    *collected,
                    variant_id,
                    control,
                    display,
                    optional,
                    required,
                    *context,
                    branches
                );
                c!(
                    "eachUnion",
                    child,
                    *casing,
                    *flags,
                    path,
                    variant_id,
                    *collected,
                    branches,
                    branch_ids
                );
            } else if kind!(child, "record") {
                let suffix = host.literal(".<key>")?;
                c!(
                    "pushDynamic",
                    *collected,
                    child,
                    *casing,
                    path,
                    optional,
                    required,
                    *context,
                    suffix
                );
            } else {
                let dynamic = if kind!(child, "array") {
                    let item = host.get(child, "item")?;
                    let item = c!("unwrap", item);
                    kind!(item, "object")
                } else {
                    false
                };
                if dynamic {
                    let suffix = host.literal(".<index>")?;
                    c!(
                        "pushDynamic",
                        *collected,
                        child,
                        *casing,
                        path,
                        optional,
                        required,
                        *context,
                        suffix
                    );
                } else {
                    c!(
                        "pushField",
                        *collected,
                        child,
                        *casing,
                        *flags,
                        path,
                        optional,
                        required,
                        *context
                    );
                }
            }
            host.call("undefined", vec![])
        }
        ("field", [schema, casing, flags, path, optional, required, context]) => {
            let id = c!("display", *path);
            let display = c!("display", *path);
            let attribute = c!("attribute", *path, *casing);
            let commander = c!("commander", *path, *casing, *flags);
            let flag = c!("flag", *path, *casing);
            let aliases = c!("aliases", *schema);
            let short = host.get(*schema, "short")?;
            let description = host.get(*schema, "cliDescription")?;
            let description = if host.is_nullish(description)? {
                host.get(*schema, "description")?
            } else {
                description
            };
            let default = host.get(*schema, "default")?;
            let has_default = bool_value!(!host.is_undefined(default)?);
            let default = host.get(*schema, "default")?;
            let global = host.get(*schema, "global")?;
            let global = if host.is_true(global)? {
                global
            } else {
                c!("undefined")
            };
            let variant = c!("variantId", *context);
            let branch = c!("variantBranch", *context);
            host.call(
                "field",
                vec![
                    id,
                    *path,
                    display,
                    attribute,
                    commander,
                    flag,
                    aliases,
                    short,
                    *schema,
                    description,
                    *optional,
                    has_default,
                    default,
                    *required,
                    global,
                    variant,
                    branch,
                ],
            )
        }
        ("dynamic", [schema, casing, path, optional, required, context, suffix]) => {
            let id = c!("display", *path);
            let display = c!("display", *path);
            let option_display = c!("display", *path);
            let option_display = c!("suffix", option_display, *suffix);
            let flag = c!("flag", *path, *casing);
            let flag = c!("suffix", flag, *suffix);
            let description = host.get(*schema, "description")?;
            let default = host.get(*schema, "default")?;
            let has_default = bool_value!(!host.is_undefined(default)?);
            let default = host.get(*schema, "default")?;
            let variant = c!("variantId", *context);
            let branch = c!("variantBranch", *context);
            host.call(
                "dynamic",
                vec![
                    id,
                    *path,
                    display,
                    option_display,
                    flag,
                    description,
                    *optional,
                    has_default,
                    default,
                    *required,
                    *schema,
                    variant,
                    branch,
                ],
            )
        }
        ("oneOfVariant", [id, control, optional, required, context, branches]) => {
            let display = host.get(*control, "displayPath")?;
            variant_record(
                host, *id, *control, display, *optional, *required, *context, *branches,
            )
        }
        ("unionVariant", [id, control, display, optional, required, context, branches]) => {
            variant_record(
                host, *id, *control, *display, *optional, *required, *context, *branches,
            )
        }
        ("branchId", [branch, index, casing, seen]) => {
            let fingerprint = c!("fingerprint", *branch, *casing);
            let exists = c!("seenHas", *seen, fingerprint);
            let branch_id = if yes!(exists) {
                c!("indexedFingerprint", fingerprint, *index)
            } else {
                fingerprint
            };
            c!("seenAdd", *seen, fingerprint);
            Ok(branch_id)
        }
        ("requiredSchema", [schema]) => Ok(bool_value!(!kind!(*schema, "optional"))),
        (
            "branch",
            [
                branch_id,
                schema,
                casing,
                flags,
                path,
                variant,
                collected,
                branches,
            ],
        ) => {
            let optional = c!("true");
            let context = c!("context", *variant, *branch_id);
            let branch = c!(
                "collect", *schema, *casing, *flags, *path, optional, context
            );
            c!("appendCollected", *collected, branch);
            host.call("appendBranch", vec![*branches, *branch_id, branch])
        }
        ("commander", [path, casing, flags]) => {
            let attribute = c!("attribute", *path, *casing);
            let flag = c!("flag", *path, *casing);
            let reserved = c!("globalHas", *flags, flag);
            if yes!(reserved) {
                host.call("parameterAttribute", vec![attribute])
            } else {
                Ok(attribute)
            }
        }
        ("attributeSegment", [segment, casing]) => {
            let formatted = c!("formatName", *segment, *casing);
            if host.is_kind(*casing, "snake")? {
                Ok(formatted)
            } else {
                host.call("attributeWords", vec![formatted])
            }
        }
        ("attributeWord", [word, index]) => {
            let first = c!("zero", *index);
            if host.is_true(first)? {
                Ok(*word)
            } else {
                host.call("capitalize", vec![*word])
            }
        }
        ("alias", [alias]) => {
            let prefixed = c!("startsLong", *alias);
            if yes!(prefixed) {
                Ok(*alias)
            } else {
                host.call("longAlias", vec![*alias])
            }
        }
        ("assign", [fields, positional]) => {
            let length = host.get(*positional, "length")?;
            let empty = c!("zero", length);
            if !host.is_true(empty)? {
                let by_path = c!("byPath", *fields);
                let state = c!("positionState");
                c!("eachPositional", *positional, by_path, state);
            }
            Ok(*fields)
        }
        ("positional", [name, index, positional, by_path, state]) => {
            let field = c!("getPath", *by_path, *name);
            if host.is_undefined(field)? {
                return host.call("missingPositional", vec![*name]);
            }
            let schema = host.get(field, "schema")?;
            if kind!(schema, "array") {
                let last = c!("lastPosition", *index, *positional);
                if !host.is_true(last)? {
                    return host.call("arrayNotLast", vec![*name]);
                }
                c!("seenVariadic", *state);
            }
            let seen = host.get(*state, "seen")?;
            if host.is_true(seen)? {
                let schema = host.get(field, "schema")?;
                if !kind!(schema, "array") {
                    return host.call("afterArray", vec![*name]);
                }
            }
            c!("assignIndex", field, *index);
            let schema = host.get(field, "schema")?;
            let variadic = bool_value!(kind!(schema, "array"));
            host.call("assignVariadic", vec![field, variadic])
        }
        ("validate", [fields, flags]) => {
            let by_flag = c!("map");
            host.call("eachField", vec![*fields, *flags, by_flag])
        }
        ("validateField", [field, flags, by_flag]) => {
            let positional = host.get(*field, "positionalIndex")?;
            if !host.is_undefined(positional)? {
                return host.call("undefined", vec![]);
            }
            host.call("eachFlag", vec![*field, *flags, *by_flag])
        }
        ("validateFlag", [flag, field, flags, by_flag]) => {
            let global = c!("globalHas", *flags, *flag);
            if yes!(global) {
                let option_flag = host.get(*field, "optionFlag")?;
                if host.same(*flag, option_flag)? {
                    let short = host.get(*field, "shortFlag")?;
                    if !host.is_undefined(short)? {
                        return host.call("undefined", vec![]);
                    }
                }
                return host.call("reservedAlias", vec![*field, *flag]);
            }
            let existing = c!("getFlag", *by_flag, *flag);
            if !host.is_undefined(existing)? {
                return host.call("conflictingFlag", vec![existing, *field, *flag]);
            }
            c!("setFlag", *by_flag, *flag, *field);
            host.call("undefined", vec![])
        }
        ("formatFlags", [field, flags]) => {
            let global = c!("fieldGlobalHas", *flags, *field);
            if yes!(global) {
                let short = host.get(*field, "shortFlag")?;
                if host.is_undefined(short)? {
                    return host.call("reservedField", vec![*field]);
                }
                return host.call("shortFlag", vec![*field]);
            }
            let short = host.get(*field, "shortFlag")?;
            host.call(
                if host.is_undefined(short)? {
                    "longFlags"
                } else {
                    "allFlags"
                },
                vec![*field],
            )
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

fn control_field<H: TextHost>(
    host: &mut H,
    args: &[H::Value],
    synthetic: bool,
) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    let (schema, casing, flags, path, optional, required, context, branch_ids) = (
        args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7],
    );
    let id = if synthetic {
        args[8]
    } else {
        let path = c!("discriminatorPath", path, schema);
        c!("display", path)
    };
    let field_path = if synthetic {
        path
    } else {
        c!("discriminatorPath", path, schema)
    };
    let display = if synthetic {
        args[8]
    } else {
        let path = c!("discriminatorPath", path, schema);
        c!("display", path)
    };
    let attribute_path = if synthetic {
        path
    } else {
        c!("discriminatorPath", path, schema)
    };
    let attribute = c!("attribute", attribute_path, casing);
    let commander_path = if synthetic {
        path
    } else {
        c!("discriminatorPath", path, schema)
    };
    let commander = c!("commander", commander_path, casing, flags);
    let flag_path = if synthetic {
        path
    } else {
        c!("discriminatorPath", path, schema)
    };
    let flag = c!("flag", flag_path, casing);
    let aliases = c!("list");
    let length = host.get(branch_ids, "length")?;
    let empty = c!("zero", length);
    if host.is_true(empty)? {
        return host.call("emptySyntheticEnum", vec![]);
    }
    let enum_schema = c!("enumSchema", branch_ids);
    let description = host.get(schema, "description")?;
    let variant = c!("variantId", context);
    let branch = c!("variantBranch", context);
    host.call(
        if synthetic {
            "unionControl"
        } else {
            "oneOfControl"
        },
        vec![
            id,
            field_path,
            display,
            attribute,
            commander,
            flag,
            aliases,
            enum_schema,
            description,
            optional,
            required,
            variant,
            branch,
        ],
    )
}

#[allow(clippy::too_many_arguments)]
fn variant_record<H: TextHost>(
    host: &mut H,
    id: H::Value,
    control: H::Value,
    display: H::Value,
    runtime_optional: H::Value,
    required: H::Value,
    context: H::Value,
    branches: H::Value,
) -> Result<H::Value, H::Error> {
    let field_id = host.get(control, "id")?;
    let optional = if host.is_undefined(context)? {
        runtime_optional
    } else {
        host.call(
            if host.is_true(required)? {
                "false"
            } else {
                "true"
            },
            vec![],
        )?
    };
    host.call(
        "variant",
        vec![id, display, field_id, optional, context, branches],
    )
}

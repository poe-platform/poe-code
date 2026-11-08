//! CLI help values, descriptions, dynamic rows and lexical token roles.
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
    match (operation, args) {
        ("unwrap", [schema]) => {
            if kind!(*schema, "optional") {
                let inner = host.get(*schema, "inner")?;
                host.call("unwrap", vec![inner])
            } else {
                Ok(*schema)
            }
        }
        ("fieldFlags", [field, globals]) => {
            let positional = host.get(*field, "positionalIndex")?;
            if !host.is_undefined(positional)? {
                return host.call("positional", vec![*field]);
            }
            let schema = host.get(*field, "schema")?;
            if kind!(schema, "boolean") {
                let default = host.get(*field, "defaultValue")?;
                return host.call(
                    if host.is_true(default)? {
                        "negativeFieldFlag"
                    } else {
                        "optionFlags"
                    },
                    vec![*field, *globals],
                );
            }
            host.call("fieldValueFlags", vec![*field, *globals])
        }
        ("positional", [field]) => {
            let optional = host.get(*field, "optional")?;
            let optional = if yes!(optional) {
                optional
            } else {
                host.get(*field, "hasDefault")?
            };
            let variadic = host.get(*field, "variadicPosition")?;
            let optional = yes!(optional);
            let opening = host.literal(if optional { "[" } else { "<" })?;
            let closing = host.literal(match (optional, host.is_true(variadic)?) {
                (true, true) => "...]",
                (false, true) => "...>",
                (true, false) => "]",
                (false, false) => ">",
            })?;
            host.call("positionalText", vec![*field, opening, closing])
        }
        ("helpValue", [schema, field]) => {
            if kind!(*schema, "array") {
                let item = host.get(*schema, "item")?;
                let item = c!("unwrap", item);
                if kind!(item, "array") || kind!(item, "object") {
                    return host.literal("value...");
                }
                return host.call("arrayValue", vec![item, *field]);
            }
            if kind!(*schema, "json") {
                return host.literal("json");
            }
            if kind!(*schema, "string") {
                let format = host.get(*schema, "format")?;
                let token = run(host, "knownFormat", &[format])?;
                let token = if host.is_nullish(token)? {
                    let pattern = host.get(*schema, "pattern")?;
                    run(host, "knownPattern", &[pattern])?
                } else {
                    token
                };
                if !host.is_undefined(token)? {
                    return Ok(token);
                }
            }
            if kind!(*schema, "enum") {
                return host.literal("value");
            }
            let display = host.get(*field, "displayPath")?;
            let flag = host.get(*field, "optionFlag")?;
            let token = run(host, "nameValue", &[display, flag])?;
            if host.is_nullish(token)? {
                host.literal("value")
            } else {
                Ok(token)
            }
        }
        ("knownFormat", [format]) => {
            for (key, token) in [
                ("date", "date"),
                ("date-time", "datetime"),
                ("uri", "url"),
                ("email", "email"),
            ] {
                if host.is_kind(*format, key)? {
                    return host.literal(token);
                }
            }
            host.call("undefined", vec![])
        }
        ("knownPattern", [pattern]) => {
            if host.is_undefined(*pattern)? {
                return Ok(*pattern);
            }
            if host.is_kind(*pattern, "^\\d{4}-\\d{2}-\\d{2}$")? {
                return host.literal("YYYY-MM-DD");
            }
            let datetime = c!("datetimePattern", *pattern);
            if yes!(datetime) {
                host.literal("YYYY-MM-DDTHH:MM:SS")
            } else {
                host.call("undefined", vec![])
            }
        }
        ("lastSegment", [value]) => {
            let segments = c!("splitSegments", *value);
            let last = c!("lastSegment", segments);
            if host.is_nullish(last)? {
                Ok(*value)
            } else {
                Ok(last)
            }
        }
        ("nameValue", [display, flag]) => {
            let display = run(host, "lastSegment", &[*display])?;
            let prefixed = c!("longPrefix", *flag);
            let flag = if yes!(prefixed) {
                c!("stripPrefix", *flag)
            } else {
                *flag
            };
            let flag = run(host, "lastSegment", &[flag])?;
            let candidates = c!("list", display, flag);
            let mut pairs = Vec::new();
            for (suffix, token) in [
                ("Path", "path"),
                ("Paths", "path"),
                ("File", "path"),
                ("Files", "path"),
                ("Url", "url"),
                ("Email", "email"),
                ("Name", "name"),
                ("Id", "id"),
            ] {
                let suffix = host.literal(suffix)?;
                let token = host.literal(token)?;
                pairs.push(c!("list", suffix, token));
            }
            let suffixes = host.call("list", pairs)?;
            host.call("findSuffix", vec![candidates, suffixes])
        }
        ("suffixChoice", [candidates, suffix, token]) => {
            let found = c!("someSuffix", *candidates, *suffix);
            let selected = yes!(found);
            host.call(
                if selected { "selected" } else { "unselected" },
                vec![*token],
            )
        }
        ("matchesSuffix", [name, suffix]) => {
            let lower_name = c!("nameLower", *name);
            let lower_suffix = c!("suffixLower", *suffix);
            if host.same(lower_name, lower_suffix)? {
                return host.call("true", vec![]);
            }
            let found = c!("nameEnds", *name, *suffix);
            if yes!(found) {
                return Ok(found);
            }
            let found = c!("hyphenSuffix", lower_name, lower_suffix);
            if yes!(found) {
                return Ok(found);
            }
            host.call("underscoreSuffix", vec![lower_name, lower_suffix])
        }
        ("appendMetadata", [description, metadata]) => {
            let length = host.get(*metadata, "length")?;
            let empty = c!("zero", length);
            if host.is_true(empty)? {
                return Ok(*description);
            }
            let length = host.get(*description, "length")?;
            let empty = c!("zero", length);
            host.call(
                if host.is_true(empty)? {
                    "metadataOnly"
                } else {
                    "descriptionMetadata"
                },
                vec![*description, *metadata],
            )
        }
        ("suppressEcho", [description, name]) => {
            let length = host.get(*description, "length")?;
            let empty = c!("zero", length);
            if !host.is_true(empty)? {
                let left = c!("normalize", *description);
                let right = c!("normalize", *name);
                if host.same(left, right)? {
                    return host.literal("");
                }
            }
            Ok(*description)
        }
        ("normalizeCharacter", [normalized, character]) => {
            for ignored in [" ", "\t", "\n", "\r", "_", ".", "-"] {
                if host.is_kind(*character, ignored)? {
                    return Ok(*normalized);
                }
            }
            host.call("appendCharacter", vec![*normalized, *character])
        }
        ("fieldDescription", [field]) => {
            let raw = host.get(*field, "description")?;
            let raw = if host.is_nullish(raw)? {
                host.get(*field, "displayPath")?
            } else {
                raw
            };
            let display = host.get(*field, "displayPath")?;
            let description = run(host, "suppressEcho", &[raw, display])?;
            let metadata = c!("list");
            let schema = host.get(*field, "schema")?;
            if kind!(schema, "enum") {
                let small = c!("smallEnum", *field);
                if host.is_true(small)? {
                    let values = c!("enumDescription", *field);
                    let small = c!("shortEnumDescription", values);
                    if host.is_true(small)? {
                        c!("pushValues", metadata, values);
                    }
                }
            }
            append_field_metadata(host, *field, metadata)?;
            run(host, "appendMetadata", &[description, metadata])
        }
        ("dynamicMetadata", [field]) => {
            let metadata = c!("list");
            append_field_metadata(host, *field, metadata)?;
            Ok(metadata)
        }
        ("resolved", [value]) => {
            let array = c!("isArray", *value);
            if host.is_true(array)? {
                return host.call("resolvedArray", vec![*value]);
            }
            let string = c!("isString", *value);
            if host.is_true(string)? {
                Ok(*value)
            } else {
                host.call("json", vec![*value])
            }
        }
        ("compactEnum", [schema]) => {
            if !kind!(*schema, "enum") {
                return host.call("undefined", vec![]);
            }
            let few = c!("fewEnum", *schema);
            if host.is_true(few)? {
                return host.call("undefined", vec![]);
            }
            let many = c!("manyEnum", *schema);
            if host.is_true(many)? {
                return host.call("undefined", vec![]);
            }
            let tokens = c!("enumTokens", *schema);
            let compact = c!("everyCompact", tokens);
            let compact = yes!(compact);
            host.call(
                if compact { "joinCompact" } else { "undefined" },
                vec![tokens],
            )
        }
        ("compactToken", [token]) => {
            let valid = c!("tokenNonempty", *token);
            if !host.is_true(valid)? {
                return host.call("false", vec![]);
            }
            let valid = c!("tokenFits", *token);
            if !host.is_true(valid)? {
                return host.call("false", vec![]);
            }
            let trimmed = c!("tokenTrim", *token);
            if !host.same(trimmed, *token)? {
                return host.call("false", vec![]);
            }
            for character in ["|", "\t", "\n", "\r", " "] {
                let character = host.literal(character)?;
                let found = c!("tokenIncludes", *token, character);
                if yes!(found) {
                    return host.call("false", vec![]);
                }
            }
            host.call("true", vec![])
        }
        ("parameterFlags", [field, globals]) => {
            let index = host.get(*field, "positionalIndex")?;
            let simple = if !host.is_undefined(index)? {
                true
            } else {
                let schema = host.get(*field, "schema")?;
                kind!(schema, "boolean")
            };
            if simple {
                return host.call("fieldFlags", vec![*field, *globals]);
            }
            let schema = host.get(*field, "schema")?;
            let token = run(host, "compactEnum", &[schema])?;
            if !host.is_undefined(token)? {
                host.call("parameterEnum", vec![*field, *globals, token])
            } else {
                host.call("fieldFlags", vec![*field, *globals])
            }
        }
        ("enumChoices", [schema]) => {
            let choices = c!("enumTokens", *schema);
            let nullable = host.get(*schema, "nullable")?;
            if host.is_true(nullable)? {
                let included = c!("includesNull", choices);
                if !yes!(included) {
                    c!("pushNull", choices);
                }
            }
            Ok(choices)
        }
        ("schemaType", [schema]) => {
            for kind in ["enum", "array", "json"] {
                if kind!(*schema, kind) {
                    return host.literal(kind);
                }
            }
            host.get(*schema, "kind")
        }
        ("dynamicType", [field]) => {
            let schema = host.get(*field, "schema")?;
            if kind!(schema, "record") {
                let schema = host.get(*field, "schema")?;
                let value = host.get(schema, "value")?;
                let value = c!("unwrap", value);
                if kind!(value, "json") {
                    return host.literal("json");
                }
                if kind!(value, "array") {
                    return host.call("dynamicHelpValue", vec![value, *field]);
                }
                if kind!(value, "object") {
                    return host.literal("value");
                }
                return host.call("dynamicHelpValue", vec![value, *field]);
            }
            host.literal("value")
        }
        ("dynamicFields", [field, casing]) => {
            let metadata = run(host, "dynamicMetadata", &[*field])?;
            for (kind, member) in [("record", "value"), ("array", "item")] {
                let schema = host.get(*field, "schema")?;
                if kind!(schema, kind) {
                    let schema = host.get(*field, "schema")?;
                    let value = host.get(schema, member)?;
                    let value = c!("unwrap", value);
                    if kind!(value, "object") {
                        let option = c!("fieldOptionText", *field);
                        let display = c!("fieldDisplayText", *field);
                        return host.call(
                            "objectRows",
                            vec![value, *casing, option, display, metadata],
                        );
                    }
                }
            }
            let flags = c!("dynamicFlags", *field);
            let raw = host.get(*field, "description")?;
            let raw = if host.is_nullish(raw)? {
                host.get(*field, "optionPathDisplay")?
            } else {
                raw
            };
            let display = host.get(*field, "optionPathDisplay")?;
            let description = run(host, "suppressEcho", &[raw, display])?;
            let description = run(host, "appendMetadata", &[description, metadata])?;
            let row = c!("row", flags, description);
            host.call("list", vec![row])
        }
        ("objectRows", [schema, casing, option, display, metadata]) => {
            let rows = c!("list");
            c!(
                "eachDynamic",
                *schema,
                *casing,
                *option,
                *display,
                *metadata,
                rows
            );
            Ok(rows)
        }
        ("dynamicChild", [key, raw, casing, option, display, metadata, rows]) => {
            let child = c!("unwrap", *raw);
            let option = c!("childOption", *option, *key, *casing);
            let display = c!("childDisplay", *display, *key);
            let raw = host.get(child, "description")?;
            let raw = if host.is_nullish(raw)? { display } else { raw };
            let description = run(host, "suppressEcho", &[raw, display])?;
            if kind!(child, "object") {
                return host.call(
                    "pushObjectRows",
                    vec![*rows, child, *casing, option, display, *metadata],
                );
            }
            if kind!(child, "record") {
                return host.call(
                    "pushRecordRow",
                    vec![*rows, child, option, display, description, *metadata],
                );
            }
            if kind!(child, "array") {
                let item = host.get(child, "item")?;
                let item = c!("unwrap", item);
                if kind!(item, "object") {
                    return host.call(
                        "pushArrayRows",
                        vec![*rows, child, *casing, option, display, *metadata],
                    );
                }
            }
            host.call(
                "pushScalarRow",
                vec![*rows, child, option, display, description, *metadata],
            )
        }
        ("arrayRows", [schema, casing, option, display, metadata]) => {
            let item = host.get(*schema, "item")?;
            let item = c!("unwrap", item);
            let option = c!("indexSuffix", *option);
            let display = c!("indexSuffix", *display);
            host.call(
                "objectRows",
                vec![item, *casing, option, display, *metadata],
            )
        }
        ("recordRow", [schema, option, display, description, metadata]) => {
            let flags = c!("recordFlags", *schema, *option, *display);
            let description = run(host, "appendMetadata", &[*description, *metadata])?;
            host.call("row", vec![flags, description])
        }
        ("scalarRow", [schema, option, display, description, metadata]) => {
            let flags = if kind!(*schema, "boolean") {
                let default = host.get(*schema, "default")?;
                if host.is_true(default)? {
                    c!("negativeFlag", *option)
                } else {
                    *option
                }
            } else {
                c!("scalarFlags", *schema, *option, *display)
            };
            let description = run(host, "appendMetadata", &[*description, *metadata])?;
            host.call("row", vec![flags, description])
        }
        ("tokenize", [flags]) => tokenize(host, *flags),
        ("pieceToken", [piece]) => {
            let pipe = c!("piecePipe", *piece);
            let dim = if yes!(pipe) {
                false
            } else {
                let plus = c!("piecePlus", *piece);
                yes!(plus)
            };
            let role = host.literal(if dim { "dim" } else { "literal" })?;
            host.call("token", vec![*piece, role])
        }
        _ => host.call("invalidOperation", vec![]),
    }
}

fn append_field_metadata<H: TextHost>(
    host: &mut H,
    field: H::Value,
    metadata: H::Value,
) -> Result<(), H::Error> {
    let optional = host.get(field, "optional")?;
    let optional = host.call("truthy", vec![optional])?;
    if !host.is_true(optional)? {
        let default = host.get(field, "hasDefault")?;
        let default = host.call("truthy", vec![default])?;
        if !host.is_true(default)? {
            host.call("pushRequired", vec![metadata])?;
        }
    }
    let default = host.get(field, "hasDefault")?;
    let default = host.call("truthy", vec![default])?;
    if host.is_true(default)? {
        host.call("pushDefault", vec![metadata, field])?;
    }
    Ok(())
}

fn scan_end<H: TextHost>(
    host: &mut H,
    flags: H::Value,
    index: H::Value,
    spaces: bool,
) -> Result<H::Value, H::Error> {
    let mut end = host.call("increment", vec![index])?;
    loop {
        let more = host.call("more", vec![flags, end])?;
        if !host.is_true(more)? {
            break;
        }
        if spaces {
            let character = host.call("at", vec![flags, end])?;
            if !host.is_kind(character, " ")? {
                break;
            }
        } else {
            let mut stop = false;
            for delimiter in [" ", "[", "]", "<"] {
                let character = host.call("at", vec![flags, end])?;
                if host.is_kind(character, delimiter)? {
                    stop = true;
                    break;
                }
            }
            if stop {
                break;
            }
        }
        end = host.call("increment", vec![end])?;
    }
    Ok(end)
}

fn tokenize<H: TextHost>(host: &mut H, flags: H::Value) -> Result<H::Value, H::Error> {
    macro_rules! c { ($name:expr $(,$arg:expr)* $(,)?) => {{let args=vec![$($arg),*];host.call($name,args)?}}; }
    macro_rules! at {
        ($position:expr, $character:expr) => {{
            let value = c!("at", flags, $position);
            host.is_kind(value, $character)?
        }};
    }
    let tokens = c!("list");
    let mut index = c!("zeroIndex");
    loop {
        let more = c!("more", flags, index);
        if !host.is_true(more)? {
            break;
        }
        if at!(index, " ") {
            let end = scan_end(host, flags, index, true)?;
            let role = host.literal("literal")?;
            c!("pushSlice", tokens, flags, index, end, role);
            index = end;
            continue;
        }
        if at!(index, "[") || at!(index, "]") {
            let role = host.literal("dim")?;
            c!("pushSingle", tokens, flags, index, role);
            index = c!("increment", index);
            continue;
        }
        if at!(index, "<") {
            let close = c!("close", flags, index);
            let missing = c!("minusOne", close);
            if host.is_true(missing)? {
                let role = host.literal("literal")?;
                c!("pushTail", tokens, flags, index, role);
                break;
            }
            let role = host.literal("argument")?;
            c!("pushClose", tokens, flags, index, close, role);
            index = c!("increment", close);
            continue;
        }
        let long = c!("startsOption", flags, index);
        let long = c!("truthy", long);
        let option = if host.is_true(long)? {
            true
        } else if at!(index, "-") {
            let next = c!("nextAt", flags, index);
            if host.is_undefined(next)? {
                false
            } else {
                let next = c!("nextAt", flags, index);
                !host.is_kind(next, "-")?
            }
        } else {
            false
        };
        let end = scan_end(host, flags, index, false)?;
        if option {
            let role = host.literal("option")?;
            c!("pushSlice", tokens, flags, index, end, role);
        } else {
            let piece = c!("slice", flags, index, end);
            c!("pushPiece", tokens, piece);
        }
        index = end;
    }
    Ok(tokens)
}

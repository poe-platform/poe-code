use super::*;

const MAPS: [&str; 5] = [
    "$defs",
    "definitions",
    "properties",
    "dependentSchemas",
    "dependencies",
];
const ARRAYS: [&str; 4] = ["allOf", "anyOf", "oneOf", "prefixItems"];
const SINGLE: [&str; 11] = [
    "additionalItems",
    "additionalProperties",
    "contains",
    "else",
    "if",
    "items",
    "not",
    "propertyNames",
    "then",
    "unevaluatedItems",
    "unevaluatedProperties",
];
const TYPES: [&str; 7] = [
    "null", "boolean", "object", "array", "number", "integer", "string",
];

impl CompiledSchema {
    pub fn compile(schema: Value) -> Result<Self, String> {
        let mut nodes = Vec::new();
        let mut locations = HashMap::new();
        scan(
            schema,
            Dialect::Modern,
            units("#"),
            0,
            &mut nodes,
            &mut locations,
        )?;
        for node in &mut nodes {
            if let Some(Value::String(reference)) = node.schema.get("$ref") {
                node.reference = Some(*locations.get(reference).ok_or_else(|| {
                    format!(
                        "Unresolved schema reference: {}",
                        String::from_utf16_lossy(reference)
                    )
                })?);
            }
        }
        Ok(CompiledSchema { nodes })
    }
}

fn scan(
    schema: Value,
    inherited: Dialect,
    pointer: Vec<u16>,
    depth: usize,
    nodes: &mut Vec<Node>,
    locations: &mut HashMap<Vec<u16>, usize>,
) -> Result<usize, String> {
    if depth > 128 || nodes.len() >= 262_144 {
        return Err("Schema resource limit exceeded".into());
    }
    let mut dialect = inherited;
    if let Some(Value::String(version)) = schema.get("$schema") {
        let version = String::from_utf16_lossy(version);
        if version.contains("draft-07") {
            dialect = Dialect::Draft7;
        }
        if version.contains("2020-12") {
            dialect = Dialect::Modern;
        }
    }
    validate(&schema, dialect)?;
    let id = nodes.len();
    locations.insert(pointer.clone(), id);
    if let Some(Value::String(anchor)) = schema.get("$anchor") {
        locations.insert([vec![35], anchor.clone()].concat(), id);
    }
    nodes.push(Node {
        schema: shallow_schema(&schema),
        dialect,
        children: HashMap::new(),
        reference: None,
    });
    if let Value::Object(properties) = schema {
        for (key, value) in properties {
            let key_string = String::from_utf16_lossy(&key);
            if MAPS.contains(&key_string.as_str()) {
                if let Value::Object(entries) = value {
                    for (name, child) in entries {
                        if matches!(child, Value::Array(_)) {
                            continue;
                        }
                        let child_pointer = pointer_child(&pointer_child(&pointer, &key), &name);
                        let child_id =
                            scan(child, dialect, child_pointer, depth + 1, nodes, locations)?;
                        nodes[id]
                            .children
                            .insert(child_key(&key_string, &name), child_id);
                    }
                }
            } else if ARRAYS.contains(&key_string.as_str())
                || (key_string == "items" && matches!(value, Value::Array(_)))
            {
                if let Value::Array(entries) = value {
                    for (index, child) in entries.into_iter().enumerate() {
                        let name = units(&index.to_string());
                        let child_id = scan(
                            child,
                            dialect,
                            pointer_child(&pointer_child(&pointer, &key), &name),
                            depth + 1,
                            nodes,
                            locations,
                        )?;
                        nodes[id]
                            .children
                            .insert(child_key(&key_string, &name), child_id);
                    }
                }
            } else if SINGLE.contains(&key_string.as_str()) {
                let child_id = scan(
                    value,
                    dialect,
                    pointer_child(&pointer, &key),
                    depth + 1,
                    nodes,
                    locations,
                )?;
                nodes[id].children.insert(key, child_id);
            }
        }
    }
    Ok(id)
}

// The graph owns child schemas once. Keeping the original subtree at every
// ancestor would multiply retained strings by the schema's nesting depth.
fn shallow_schema(schema: &Value) -> Value {
    let Value::Object(properties) = schema else {
        return schema.clone();
    };
    Value::Object(
        properties
            .iter()
            .map(|(key, value)| {
                let keyword = String::from_utf16_lossy(key);
                let value = if MAPS.contains(&keyword.as_str()) {
                    match value {
                        Value::Object(entries) => Value::Object(
                            entries
                                .iter()
                                .map(|(name, value)| {
                                    (
                                        name.clone(),
                                        if matches!(value, Value::Array(_)) {
                                            value.clone()
                                        } else {
                                            Value::Bool(true)
                                        },
                                    )
                                })
                                .collect(),
                        ),
                        _ => unreachable!("validated map"),
                    }
                } else if ARRAYS.contains(&keyword.as_str())
                    || (keyword == "items" && matches!(value, Value::Array(_)))
                {
                    match value {
                        Value::Array(entries) => {
                            Value::Array(vec![Value::Bool(true); entries.len()])
                        }
                        _ => unreachable!("validated array"),
                    }
                } else if SINGLE.contains(&keyword.as_str()) {
                    Value::Bool(true)
                } else {
                    value.clone()
                };
                (key.clone(), value)
            })
            .collect(),
    )
}

fn pointer_child(pointer: &[u16], key: &[u16]) -> Vec<u16> {
    let mut result = pointer.to_vec();
    result.push(47);
    for unit in key {
        match unit {
            126 => result.extend([126, 48]),
            47 => result.extend([126, 49]),
            unit => result.push(*unit),
        }
    }
    result
}

fn string_array(value: &Value, keyword: &str) -> Result<(), String> {
    let Value::Array(values) = value else {
        return Err(format!("{keyword} must be an array of strings."));
    };
    let mut seen = HashSet::new();
    for value in values {
        let Value::String(value) = value else {
            return Err(format!("{keyword} must be an array of strings."));
        };
        if !seen.insert(value) {
            return Err(format!("{keyword} must contain unique strings."));
        }
    }
    Ok(())
}

fn schema(value: &Value) -> bool {
    matches!(value, Value::Bool(_) | Value::Object(_))
}

fn validate(value: &Value, dialect: Dialect) -> Result<(), String> {
    if !schema(value) {
        return Err("JSON Schema must be a boolean or object.".into());
    }
    if let Some(value) = value.get("type") {
        let types = match value {
            Value::Array(types) => types.as_slice(),
            value => std::slice::from_ref(value),
        };
        if types.is_empty()
            || !types
                .iter()
                .all(|value| TYPES.iter().any(|name| is_string(value, name)))
            || types
                .iter()
                .enumerate()
                .any(|(index, value)| types[..index].contains(value))
        {
            return Err(
                "type must be a JSON Schema type or a unique array of JSON Schema types.".into(),
            );
        }
    }
    for keyword in ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] {
        if value
            .get(keyword)
            .is_some_and(|value| !matches!(value, Value::Number(number) if number.is_finite()))
        {
            return Err(format!("{keyword} must be a number."));
        }
    }
    if value.get("multipleOf").is_some_and(
        |value| !matches!(value, Value::Number(number) if number.is_finite() && *number > 0.0),
    ) {
        return Err("multipleOf must be a number greater than zero.".into());
    }
    for keyword in [
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "minContains",
        "maxContains",
        "minProperties",
        "maxProperties",
    ] {
        if value.get(keyword).is_some_and(|value| !matches!(value, Value::Number(number) if number.is_finite() && *number >= 0.0 && number.fract() == 0.0)) { return Err(format!("{keyword} must be a non-negative integer.")); }
    }
    if let Some(required) = value.get("required") {
        string_array(required, "required")?;
    }
    if let Some(dependencies) = value.get("dependentRequired") {
        let Value::Object(entries) = dependencies else {
            return Err("dependentRequired must be an object containing string arrays.".into());
        };
        for (_, value) in entries {
            string_array(value, "dependentRequired")?;
        }
    }
    for keyword in MAPS {
        if let Some(value) = value.get(keyword) {
            let Value::Object(entries) = value else {
                return Err(format!("{keyword} must be an object containing schemas."));
            };
            for (_, value) in entries {
                if keyword == "dependencies" && !schema(value) {
                    string_array(value, keyword)?;
                } else if !schema(value) {
                    return Err(format!("{keyword} must be an object containing schemas."));
                }
            }
        }
    }
    for keyword in ARRAYS {
        if let Some(value) = value.get(keyword)
            && !matches!(value, Value::Array(entries) if (keyword == "prefixItems" || !entries.is_empty()) && entries.iter().all(schema))
        {
            return Err(format!(
                "{keyword} must be {}array of schemas.",
                if keyword == "prefixItems" {
                    "an "
                } else {
                    "a non-empty "
                }
            ));
        }
    }
    for keyword in SINGLE {
        if let Some(value) = value.get(keyword) {
            if keyword == "items" && dialect == Dialect::Draft7 && matches!(value, Value::Array(_))
            {
                if !matches!(value, Value::Array(entries) if entries.iter().all(schema)) {
                    return Err("items must contain only schemas.".into());
                }
            } else if !schema(value) {
                return Err(format!("{keyword} must be a schema."));
            }
        }
    }
    if value
        .get("enum")
        .is_some_and(|value| !matches!(value, Value::Array(_)))
    {
        return Err("enum must be an array.".into());
    }
    if value
        .get("uniqueItems")
        .is_some_and(|value| !matches!(value, Value::Bool(_)))
    {
        return Err("uniqueItems must be a boolean.".into());
    }
    if value
        .get("$ref")
        .is_some_and(|value| !matches!(value, Value::String(_)))
    {
        return Err("$ref must be a string.".into());
    }
    for keyword in [
        "$id",
        "$dynamicRef",
        "$recursiveRef",
        "$dynamicAnchor",
        "$vocabulary",
        "pattern",
        "patternProperties",
    ] {
        if value.get(keyword).is_some() {
            return Err(format!("Schema feature not yet implemented: {keyword}"));
        }
    }
    Ok(())
}

use super::*;

const MAPS: [&str; 6] = [
    "$defs",
    "definitions",
    "properties",
    "dependentSchemas",
    "dependencies",
    "patternProperties",
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
    pub fn compile(schema: Value, options: CompileOptions) -> Result<Self, String> {
        let mut builder = Builder::new(options)?;
        builder.document(schema, Dialect::Modern, "https://toolcraft.invalid/root", 0)?;
        let registry = std::mem::take(&mut builder.registry);
        for (uri, schema) in &registry {
            for dialect in [Dialect::Modern, Dialect::Draft7] {
                let document = builder.next_document;
                builder.next_document += 1;
                builder.document(schema.clone(), dialect, uri, document)?;
            }
        }
        builder.finish()
    }
}

struct Scope {
    dialect: Dialect,
    base_uri: Arc<str>,
    resource_root: Option<usize>,
    pointer: Vec<u16>,
    validation_vocabulary: bool,
    document: usize,
}

struct Builder {
    nodes: Vec<Node>,
    registry: Vec<(String, Value)>,
    resources: HashMap<Dialect, HashMap<Arc<str>, usize>>,
    locations: HashMap<usize, HashMap<Vec<u16>, usize>>,
    anchors: HashMap<usize, HashMap<Vec<u16>, usize>>,
    dynamic_anchors: HashMap<usize, HashMap<Vec<u16>, usize>>,
    vocabulary: HashMap<String, bool>,
    next_document: usize,
}

impl Builder {
    fn new(options: CompileOptions) -> Result<Self, String> {
        let mut registry = built_in_registry();
        for (uri, value) in options.registry {
            if let Some((_, existing)) = registry.iter_mut().find(|(key, _)| key == &uri) {
                *existing = value;
            } else {
                registry.push((uri, value));
            }
        }
        let mut vocabulary = HashMap::new();
        for (uri, value) in &registry {
            if !schema(value) {
                return Err(format!(
                    "Registered JSON Schema {uri} must be a boolean or object."
                ));
            }
            if let Some(Value::Object(vocabulary_map)) = value.get("$vocabulary") {
                vocabulary.insert(
                    uri.clone(),
                    vocabulary_map.iter().any(|(name, _)| {
                        name.iter()
                            .copied()
                            .eq("https://json-schema.org/draft/2020-12/vocab/validation"
                                .encode_utf16())
                    }),
                );
            }
        }
        Ok(Self {
            nodes: Vec::new(),
            registry,
            resources: HashMap::new(),
            locations: HashMap::new(),
            anchors: HashMap::new(),
            dynamic_anchors: HashMap::new(),
            vocabulary,
            next_document: 1,
        })
    }

    fn document(
        &mut self,
        schema: Value,
        dialect: Dialect,
        retrieval_uri: &str,
        document: usize,
    ) -> Result<(), String> {
        let base_uri: Arc<str> =
            uri::resolve(retrieval_uri, "https://toolcraft.invalid/root")?.into();
        let root = self.scan(
            schema,
            Scope {
                dialect,
                base_uri: base_uri.clone(),
                resource_root: None,
                pointer: Vec::new(),
                validation_vocabulary: true,
                document,
            },
            0,
        )?;
        self.resources
            .entry(self.nodes[root].dialect)
            .or_default()
            .insert(without_fragment(&base_uri).into(), root);
        Ok(())
    }

    fn scan(&mut self, schema: Value, scope: Scope, depth: usize) -> Result<usize, String> {
        if depth > 128 || self.nodes.len() >= 262_144 {
            return Err("Schema resource limit exceeded".into());
        }
        let mut dialect = scope.dialect;
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
        let declared_id = schema.get("$id").or_else(|| {
            if dialect == Dialect::Draft7 {
                schema.get("id")
            } else {
                None
            }
        });
        let declared_id =
            if dialect == Dialect::Draft7 && matches!(schema.get("$ref"), Some(Value::String(_))) {
                None
            } else {
                declared_id
            };
        let base_uri: Arc<str> = if let Some(Value::String(id)) = declared_id {
            let id = String::from_utf16(id)
                .map_err(|_| "Invalid schema URI: unpaired surrogate".to_owned())?;
            uri::resolve(&id, &scope.base_uri)?.into()
        } else {
            scope.base_uri
        };
        let index = self.nodes.len();
        if let Some(parent_root) = scope.resource_root {
            self.locations
                .entry(parent_root)
                .or_default()
                .insert(scope.pointer.clone(), index);
        }
        let starts_resource = scope.resource_root.is_none()
            || (declared_id.is_some()
                && without_fragment(&base_uri)
                    != self.nodes[scope.resource_root.unwrap()]
                        .resource_uri
                        .as_ref());
        let resource_root = if starts_resource {
            index
        } else {
            scope.resource_root.unwrap()
        };
        let resource_uri: Arc<str> = if starts_resource {
            without_fragment(&base_uri).into()
        } else {
            self.nodes[resource_root].resource_uri.clone()
        };
        let parent_location = starts_resource
            .then(|| {
                scope
                    .resource_root
                    .map(|root| (root, scope.pointer.clone()))
            })
            .flatten();
        let pointer = if starts_resource {
            Vec::new()
        } else {
            scope.pointer
        };
        if starts_resource {
            self.resources
                .entry(dialect)
                .or_default()
                .insert(resource_uri.clone(), index);
        }
        self.locations
            .entry(resource_root)
            .or_default()
            .insert(pointer.clone(), index);
        for keyword in ["$anchor", "$dynamicAnchor"] {
            if let Some(Value::String(anchor)) = schema.get(keyword) {
                self.anchors
                    .entry(resource_root)
                    .or_default()
                    .insert(anchor.clone(), index);
                if keyword == "$dynamicAnchor" {
                    self.dynamic_anchors
                        .entry(resource_root)
                        .or_default()
                        .insert(anchor.clone(), index);
                }
            }
        }
        if dialect == Dialect::Draft7
            && matches!(declared_id, Some(Value::String(_)))
            && !fragment(&base_uri).is_empty()
        {
            self.anchors
                .entry(resource_root)
                .or_default()
                .insert(units(fragment(&base_uri)), index);
        }
        let next_vocabulary = if scope.resource_root.is_none() {
            match schema.get("$schema") {
                Some(Value::String(meta)) => *self
                    .vocabulary
                    .get(&String::from_utf16_lossy(meta))
                    .unwrap_or(&true),
                _ => true,
            }
        } else {
            scope.validation_vocabulary
        };
        let pattern = match schema.get("pattern") {
            Some(Value::String(source)) => Some(pattern::Pattern::compile(source)?),
            _ => None,
        };
        let property_patterns = match schema.get("patternProperties") {
            Some(Value::Object(entries)) => entries
                .iter()
                .map(|(source, _)| Ok((source.clone(), pattern::Pattern::compile(source)?)))
                .collect::<Result<Vec<_>, String>>()?,
            _ => Vec::new(),
        };
        self.nodes.push(Node {
            schema: shallow_schema(&schema),
            dialect,
            children: HashMap::new(),
            reference: None,
            dynamic_reference: None,
            recursive_reference: None,
            resource_root,
            resource_uri,
            base_uri: base_uri.clone(),
            document: scope.document,
            validation_vocabulary: scope.validation_vocabulary,
            pattern,
            property_patterns,
        });
        if let Value::Object(properties) = schema {
            for (key, value) in properties {
                let keyword = String::from_utf16_lossy(&key);
                let mut children = Vec::new();
                if MAPS.contains(&keyword.as_ref()) {
                    if let Value::Object(entries) = value {
                        for (name, child) in entries {
                            if !matches!(child, Value::Array(_)) {
                                children.push((
                                    child_key(&keyword, &name),
                                    pointer_child(&pointer_child(&pointer, &key), &name),
                                    child,
                                ));
                            }
                        }
                    }
                } else if ARRAYS.contains(&keyword.as_ref())
                    || (keyword == "items" && matches!(value, Value::Array(_)))
                {
                    if let Value::Array(entries) = value {
                        for (position, child) in entries.into_iter().enumerate() {
                            let name = units(&position.to_string());
                            children.push((
                                child_key(&keyword, &name),
                                pointer_child(&pointer_child(&pointer, &key), &name),
                                child,
                            ));
                        }
                    }
                } else if SINGLE.contains(&keyword.as_ref()) {
                    children.push((key.clone(), pointer_child(&pointer, &key), value));
                }
                for (child_key, child_pointer, child) in children {
                    let child = self.scan(
                        child,
                        Scope {
                            dialect,
                            base_uri: base_uri.clone(),
                            resource_root: Some(resource_root),
                            pointer: child_pointer,
                            validation_vocabulary: next_vocabulary,
                            document: scope.document,
                        },
                        depth + 1,
                    )?;
                    self.nodes[index].children.insert(child_key, child);
                }
            }
        }
        if let Some((parent_root, parent_pointer)) = parent_location {
            let aliases = self.locations[&resource_root]
                .iter()
                .map(|(pointer, target)| {
                    let mut alias = parent_pointer.clone();
                    alias.extend(pointer);
                    (alias, *target)
                })
                .collect::<Vec<_>>();
            self.locations
                .entry(parent_root)
                .or_default()
                .extend(aliases);
        }
        Ok(index)
    }

    fn resource(&self, dialect: Dialect, uri: &str) -> Option<usize> {
        self.resources
            .get(&dialect)
            .and_then(|resources| resources.get(uri))
            .or_else(|| {
                self.resources
                    .get(&if dialect == Dialect::Modern {
                        Dialect::Draft7
                    } else {
                        Dialect::Modern
                    })
                    .and_then(|resources| resources.get(uri))
            })
            .copied()
    }

    fn resolve(&self, index: usize, reference: &[u16]) -> Result<(usize, Vec<u16>), String> {
        let node = &self.nodes[index];
        let start = reference
            .iter()
            .position(|unit| *unit > 32)
            .unwrap_or(reference.len());
        let end = reference
            .iter()
            .rposition(|unit| *unit > 32)
            .map_or(start, |index| index + 1);
        let normalized = reference[start..end]
            .iter()
            .copied()
            .filter(|unit| ![9, 10, 13].contains(unit))
            .collect::<Vec<_>>();
        let (root, fragment) = if normalized.first() == Some(&35) {
            (
                self.resource(node.dialect, &node.resource_uri),
                normalized[1..].to_vec(),
            )
        } else {
            let reference_text = String::from_utf16(reference)
                .map_err(|_| "Invalid schema URI: unpaired surrogate".to_owned())?;
            let absolute = uri::resolve(&reference_text, &node.base_uri)?;
            (
                self.resource(node.dialect, without_fragment(&absolute)),
                units(fragment(&absolute)),
            )
        };
        if let Some(root) = root {
            if fragment.is_empty() {
                return Ok((root, fragment));
            }
            let key = canonical_fragment(&fragment)?;
            let target = if key.first() == Some(&47) {
                self.locations
                    .get(&root)
                    .and_then(|locations| locations.get(&key))
            } else {
                self.anchors
                    .get(&root)
                    .and_then(|anchors| anchors.get(&key))
            };
            if let Some(target) = target {
                return Ok((*target, fragment));
            }
        }
        Err(format!(
            "Unresolvable $ref: {}",
            String::from_utf16_lossy(reference)
        ))
    }

    fn finish(mut self) -> Result<CompiledSchema, String> {
        let mut pending: HashMap<usize, Vec<(usize, &'static str)>> = HashMap::new();
        for (index, node) in self.nodes.iter().enumerate() {
            for keyword in ["$ref", "$dynamicRef", "$recursiveRef"] {
                if node.schema.get(keyword).is_some() {
                    pending
                        .entry(node.document)
                        .or_default()
                        .push((index, keyword));
                }
            }
        }
        let mut reachable = HashSet::from([0]);
        let mut documents = std::collections::VecDeque::from([0]);
        while let Some(document) = documents.pop_front() {
            for (index, keyword) in pending.remove(&document).unwrap_or_default() {
                let Some(Value::String(reference)) = self.nodes[index].schema.get(keyword) else {
                    unreachable!("validated reference");
                };
                let (target, fragment) = self.resolve(index, reference)?;
                let anchor = if keyword == "$dynamicRef"
                    && !fragment.is_empty()
                    && fragment.first() != Some(&47)
                    && self.nodes[target].schema.get("$dynamicAnchor")
                        == Some(&Value::String(fragment.clone()))
                {
                    Some(fragment)
                } else {
                    None
                };
                let recursive = reference == &[35];
                match keyword {
                    "$ref" => self.nodes[index].reference = Some(target),
                    "$dynamicRef" => self.nodes[index].dynamic_reference = Some((target, anchor)),
                    _ => self.nodes[index].recursive_reference = Some((target, recursive)),
                }
                let target_document = self.nodes[target].document;
                if reachable.insert(target_document) {
                    documents.push_back(target_document);
                }
            }
        }
        Ok(CompiledSchema {
            nodes: self.nodes,
            dynamic_anchors: self.dynamic_anchors,
        })
    }
}

fn without_fragment(uri: &str) -> &str {
    uri.split_once('#').map_or(uri, |(resource, _)| resource)
}
fn fragment(uri: &str) -> &str {
    uri.split_once('#').map_or("", |(_, fragment)| fragment)
}

fn canonical_fragment(fragment: &[u16]) -> Result<Vec<u16>, String> {
    if fragment.first() != Some(&47) {
        return decode_segment(fragment);
    }
    let mut result = Vec::new();
    for segment in fragment[1..].split(|unit| *unit == 47) {
        let decoded = decode_segment(segment)?;
        let mut unescaped = Vec::new();
        let mut index = 0;
        while index < decoded.len() {
            if decoded[index] == 126 && matches!(decoded.get(index + 1), Some(48 | 49)) {
                unescaped.push(if decoded[index + 1] == 48 { 126 } else { 47 });
                index += 2;
            } else {
                unescaped.push(decoded[index]);
                index += 1;
            }
        }
        result = pointer_child(&result, &unescaped);
    }
    Ok(result)
}

fn decode_segment(segment: &[u16]) -> Result<Vec<u16>, String> {
    let mut result = Vec::new();
    let mut index = 0;
    while index < segment.len() {
        if segment[index] != 37 {
            result.push(segment[index]);
            index += 1;
            continue;
        }
        let mut bytes = Vec::new();
        while segment.get(index) == Some(&37) {
            let digit = |unit: Option<&u16>| {
                unit.and_then(|unit| match *unit {
                    48..=57 => Some((*unit - 48) as u8),
                    65..=70 => Some((*unit - 65 + 10) as u8),
                    97..=102 => Some((*unit - 97 + 10) as u8),
                    _ => None,
                })
            };
            let high = digit(segment.get(index + 1)).ok_or_else(|| "URI malformed".to_owned())?;
            let low = digit(segment.get(index + 2)).ok_or_else(|| "URI malformed".to_owned())?;
            bytes.push((high << 4) | low);
            index += 3;
        }
        let text = std::str::from_utf8(&bytes).map_err(|_| "URI malformed".to_owned())?;
        result.extend(text.encode_utf16());
    }
    Ok(result)
}

fn built_in_registry() -> Vec<(String, Value)> {
    use mcp_protocol_rust::json::{self, Limits};
    let types = r#"["null","boolean","object","array","number","integer","string"]"#;
    let property_types = format!(
        r#""type":{{"anyOf":[{{"enum":{types}}},{{"type":"array","items":{{"enum":{types}}},"minItems":1,"uniqueItems":true}}]}}"#
    );
    let bounds = [
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "minProperties",
        "maxProperties",
    ]
    .iter()
    .map(|keyword| format!(r#""{keyword}":{{"type":"integer","minimum":0}}"#))
    .collect::<Vec<_>>()
    .join(",");
    [("https://json-schema.org/draft/2020-12/schema", "$defs"), ("http://json-schema.org/draft-07/schema", "definitions")].into_iter().map(|(uri, definitions)| {
        let source = format!(r##"{{"$id":"{uri}","type":["object","boolean"],"properties":{{{property_types},{bounds},"{definitions}":{{"type":"object","additionalProperties":{{"$ref":"#"}}}}}}}}"##);
        (uri.into(), json::parse(source.as_bytes(), Limits::default()).expect("built-in meta schema"))
    }).collect()
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
    for keyword in ["$ref", "$dynamicRef", "$recursiveRef"] {
        if value
            .get(keyword)
            .is_some_and(|value| !matches!(value, Value::String(_)))
        {
            return Err(format!("{keyword} must be a string."));
        }
    }
    if value
        .get("$recursiveAnchor")
        .is_some_and(|value| !matches!(value, Value::Bool(_)))
    {
        return Err("$recursiveAnchor must be a boolean.".into());
    }
    if value
        .get("pattern")
        .is_some_and(|value| !matches!(value, Value::String(_)))
    {
        return Err("pattern must be a string.".into());
    }
    Ok(())
}

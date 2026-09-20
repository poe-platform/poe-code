use super::*;

#[derive(Default)]
pub(super) struct Evaluation {
    pub issues: Vec<ValidationIssue>,
    properties: HashSet<Vec<u16>>,
    items: HashSet<usize>,
}

impl Evaluation {
    fn merge(&mut self, other: Self) {
        self.issues.extend(other.issues);
        self.properties.extend(other.properties);
        self.items.extend(other.items);
    }
    fn problem(
        &mut self,
        path: &[Vec<u16>],
        expected: &str,
        value: Option<&Value>,
        message: Vec<u16>,
        keyword: &str,
    ) {
        self.issues.push(ValidationIssue {
            path: path.to_vec(),
            expected: expected.into(),
            received: value.map_or("undefined", received).into(),
            message,
            keyword: keyword.into(),
        });
    }
}

pub(super) struct Evaluator<'a> {
    pub graph: &'a CompiledSchema,
    pub active: HashSet<(usize, usize)>,
    pub calls: usize,
}

impl Evaluator<'_> {
    pub fn evaluate(
        &mut self,
        id: usize,
        value: &Value,
        path: &[Vec<u16>],
        depth: usize,
    ) -> Result<Evaluation, String> {
        self.calls += 1;
        if depth > 512 || self.calls > 262_144 {
            return Err("Schema evaluation resource limit exceeded".into());
        }
        let pair = (id, std::ptr::from_ref(value) as usize);
        if !self.active.insert(pair) {
            return Ok(Evaluation::default());
        }
        let result = self.node(id, value, path, depth);
        self.active.remove(&pair);
        result
    }

    fn child(
        &mut self,
        node: &Node,
        key: &[u16],
        value: &Value,
        path: &[Vec<u16>],
        depth: usize,
    ) -> Result<Evaluation, String> {
        node.children.get(key).map_or_else(
            || Ok(Evaluation::default()),
            |id| self.evaluate(*id, value, path, depth + 1),
        )
    }

    fn at_child(
        &mut self,
        node: &Node,
        schema_key: &[u16],
        key: Vec<u16>,
        value: &Value,
        path: &[Vec<u16>],
        depth: usize,
    ) -> Result<Evaluation, String> {
        let mut child_path = path.to_vec();
        child_path.push(key);
        let mut result = self.child(node, schema_key, value, &child_path, depth)?;
        result.properties.clear();
        result.items.clear();
        Ok(result)
    }

    fn node(
        &mut self,
        id: usize,
        value: &Value,
        path: &[Vec<u16>],
        depth: usize,
    ) -> Result<Evaluation, String> {
        let graph = self.graph;
        let node = &graph.nodes[id];
        let schema = &node.schema;
        let mut result = Evaluation::default();
        if let Value::Bool(valid) = schema {
            if !valid {
                result.problem(
                    path,
                    "valid schema",
                    Some(value),
                    units("must NOT be valid"),
                    "false schema",
                );
            }
            return Ok(result);
        }
        if let Some(reference) = node.reference {
            result.merge(self.evaluate(reference, value, path, depth + 1)?);
            if node.dialect == Dialect::Draft7 {
                return Ok(result);
            }
        }
        for keyword in ["allOf", "anyOf", "oneOf"] {
            if let Some(Value::Array(schemas)) = schema.get(keyword) {
                let mut successful = Vec::new();
                for index in 0..schemas.len() {
                    let branch = self.child(
                        node,
                        &child_key(keyword, &units(&index.to_string())),
                        value,
                        path,
                        depth,
                    )?;
                    if keyword == "allOf" {
                        result.merge(branch);
                    } else if branch.issues.is_empty() {
                        successful.push(branch);
                    }
                }
                if keyword != "allOf" {
                    if successful.is_empty() || (keyword == "oneOf" && successful.len() != 1) {
                        result.problem(
                            path,
                            keyword,
                            Some(value),
                            units(if keyword == "anyOf" {
                                "must match a schema in anyOf"
                            } else {
                                "must match exactly one schema in oneOf"
                            }),
                            keyword,
                        );
                    } else {
                        for branch in successful {
                            result.merge(branch);
                        }
                    }
                }
            }
        }
        if schema.get("not").is_some()
            && self
                .child(node, &units("not"), value, path, depth)?
                .issues
                .is_empty()
        {
            result.problem(path, "not", Some(value), units("must NOT be valid"), "not");
        }
        if schema.get("if").is_some() {
            let condition = self.child(node, &units("if"), value, path, depth)?;
            let selected = if condition.issues.is_empty() {
                result.merge(condition);
                "then"
            } else {
                "else"
            };
            result.merge(self.child(node, &units(selected), value, path, depth)?);
        }
        if let Value::Object(properties) = value {
            self.object(node, properties, value, path, depth, &mut result)?;
        }
        if let Value::Array(items) = value {
            self.array(node, items, value, path, depth, &mut result)?;
        }
        validation(schema, node.dialect, value, path, &mut result);
        if node.dialect == Dialect::Modern {
            if let Value::Object(properties) = value
                && schema.get("unevaluatedProperties").is_some()
            {
                for (key, value) in properties {
                    if !result.properties.contains(key) {
                        let mut child = self.at_child(
                            node,
                            &units("unevaluatedProperties"),
                            key.clone(),
                            value,
                            path,
                            depth,
                        )?;
                        child.properties.insert(key.clone());
                        result.merge(child);
                    }
                }
            }
            if let Value::Array(items) = value
                && schema.get("unevaluatedItems").is_some()
            {
                for (index, value) in items.iter().enumerate() {
                    if !result.items.contains(&index) {
                        let mut child = self.at_child(
                            node,
                            &units("unevaluatedItems"),
                            units(&index.to_string()),
                            value,
                            path,
                            depth,
                        )?;
                        child.items.insert(index);
                        result.merge(child);
                    }
                }
            }
        }
        if result.issues.len() > 10_000 {
            return Err("Schema issue limit exceeded".into());
        }
        Ok(result)
    }

    fn object(
        &mut self,
        node: &Node,
        properties: &[(Vec<u16>, Value)],
        value: &Value,
        path: &[Vec<u16>],
        depth: usize,
        result: &mut Evaluation,
    ) -> Result<(), String> {
        let mut evaluated = HashSet::new();
        if let Some(Value::Object(schemas)) = node.schema.get("properties") {
            for (key, _) in schemas {
                if let Some((_, value)) = properties.iter().find(|(name, _)| name == key) {
                    let mut child = self.at_child(
                        node,
                        &child_key("properties", key),
                        key.clone(),
                        value,
                        path,
                        depth,
                    )?;
                    evaluated.insert(key.clone());
                    child.properties.insert(key.clone());
                    result.merge(child);
                }
            }
        }
        for (key, property) in properties {
            if node.schema.get("additionalProperties").is_some() && !evaluated.contains(key) {
                let mut child = self.at_child(
                    node,
                    &units("additionalProperties"),
                    key.clone(),
                    property,
                    path,
                    depth,
                )?;
                child.properties.insert(key.clone());
                result.merge(child);
            }
            if node.schema.get("propertyNames").is_some() {
                result.merge(self.at_child(
                    node,
                    &units("propertyNames"),
                    key.clone(),
                    &Value::String(key.clone()),
                    path,
                    depth,
                )?);
            }
        }
        for keyword in ["dependentSchemas", "dependencies"] {
            if keyword == "dependencies" && node.dialect != Dialect::Draft7 {
                continue;
            }
            if let Some(Value::Object(schemas)) = node.schema.get(keyword) {
                for (key, schema) in schemas {
                    if !matches!(schema, Value::Array(_))
                        && properties.iter().any(|(name, _)| name == key)
                    {
                        result.merge(self.child(
                            node,
                            &child_key(keyword, key),
                            value,
                            path,
                            depth,
                        )?);
                    }
                }
            }
        }
        Ok(())
    }

    fn array(
        &mut self,
        node: &Node,
        items: &[Value],
        value: &Value,
        path: &[Vec<u16>],
        depth: usize,
        result: &mut Evaluation,
    ) -> Result<(), String> {
        let schema = &node.schema;
        let tuple_keyword = if node.dialect == Dialect::Modern {
            "prefixItems"
        } else {
            "items"
        };
        let tuple = match schema.get(tuple_keyword) {
            Some(Value::Array(items)) => items.as_slice(),
            _ => &[],
        };
        for (index, value) in items.iter().enumerate() {
            let key = if index < tuple.len() {
                Some(child_key(tuple_keyword, &units(&index.to_string())))
            } else if node.dialect == Dialect::Draft7
                && matches!(schema.get("items"), Some(Value::Array(_)))
            {
                schema
                    .get("additionalItems")
                    .map(|_| units("additionalItems"))
            } else {
                schema.get("items").map(|_| units("items"))
            };
            if let Some(key) = key {
                let mut child =
                    self.at_child(node, &key, units(&index.to_string()), value, path, depth)?;
                child.items.insert(index);
                result.merge(child);
            }
        }
        if schema.get("contains").is_some() {
            let mut matches = Vec::new();
            for (index, value) in items.iter().enumerate() {
                if self
                    .child(node, &units("contains"), value, path, depth)?
                    .issues
                    .is_empty()
                {
                    matches.push(index);
                }
            }
            let minimum = if node.dialect == Dialect::Modern {
                number(schema, "minContains").unwrap_or(1.0)
            } else {
                1.0
            };
            let maximum = if node.dialect == Dialect::Modern {
                number(schema, "maxContains").unwrap_or(f64::INFINITY)
            } else {
                f64::INFINITY
            };
            if (matches.len() as f64) < minimum || (matches.len() as f64) > maximum {
                result.problem(
                    path,
                    "contains",
                    Some(value),
                    units("must contain required matching items"),
                    "contains",
                );
            } else if node.dialect == Dialect::Modern {
                result.items.extend(matches);
            }
        }
        Ok(())
    }
}

fn number(schema: &Value, keyword: &str) -> Option<f64> {
    match schema.get(keyword) {
        Some(Value::Number(number)) => Some(*number),
        _ => None,
    }
}

fn validation(
    schema: &Value,
    dialect: Dialect,
    value: &Value,
    path: &[Vec<u16>],
    result: &mut Evaluation,
) {
    if let Some(types) = schema.get("type") {
        let types = match types {
            Value::Array(types) => types.as_slice(),
            value => std::slice::from_ref(value),
        };
        if !types.iter().any(|kind| matches_type(kind, value)) {
            let expected = types
                .iter()
                .map(|value| match value {
                    Value::String(name) => String::from_utf16_lossy(name),
                    _ => unreachable!(),
                })
                .collect::<Vec<_>>()
                .join(",");
            result.problem(
                path,
                &expected,
                Some(value),
                units(&format!("must be {expected}")),
                if types.len() == 1 { "type" } else { &expected },
            );
            return;
        }
    }
    if let Some(constant) = schema.get("const")
        && !equal(constant, value)
    {
        result.problem(
            path,
            "const",
            Some(value),
            units("must be equal to constant"),
            "const",
        );
    }
    if let Some(Value::Array(values)) = schema.get("enum")
        && !values.iter().any(|other| equal(other, value))
    {
        result.problem(
            path,
            "enum",
            Some(value),
            units("must be equal to one of the allowed values"),
            "enum",
        );
    }
    if let Value::Number(value_number) = value
        && value_number.is_finite()
    {
        if let Some(divisor) = number(schema, "multipleOf") {
            let quotient = value_number / divisor;
            if !(quotient - quotient.round())
                .abs()
                .le(&(f64::EPSILON * quotient.abs().max(1.0) * 4.0))
            {
                result.problem(
                    path,
                    &format!("multiple of {divisor}"),
                    Some(value),
                    units(&format!("must be multiple of {divisor}")),
                    "multipleOf",
                );
            }
        }
        for (keyword, operator) in [
            ("maximum", "<="),
            ("minimum", ">="),
            ("exclusiveMaximum", "<"),
            ("exclusiveMinimum", ">"),
        ] {
            if let Some(bound) = number(schema, keyword)
                && match operator {
                    "<=" => *value_number > bound,
                    ">=" => *value_number < bound,
                    "<" => *value_number >= bound,
                    _ => *value_number <= bound,
                }
            {
                let expected = format!("{operator} {bound}");
                result.problem(
                    path,
                    &expected,
                    Some(value),
                    units(&format!("must be {expected}")),
                    keyword,
                );
            }
        }
    }
    match value {
        Value::String(text) => {
            let length = char::decode_utf16(text.iter().copied()).count();
            limits(schema, value, path, result, length, "Length");
        }
        Value::Array(items) => {
            limits(schema, value, path, result, items.len(), "Items");
            if schema.get("uniqueItems") == Some(&Value::Bool(true))
                && items.iter().enumerate().any(|(index, value)| {
                    items[index + 1..].iter().any(|other| equal(value, other))
                })
            {
                result.problem(
                    path,
                    "unique items",
                    Some(value),
                    units("must NOT have duplicate items"),
                    "uniqueItems",
                );
            }
        }
        Value::Object(properties) => {
            limits(schema, value, path, result, properties.len(), "Properties");
            if let Some(Value::Array(required)) = schema.get("required") {
                missing(properties, required, path, result, true);
            }
            for keyword in ["dependentRequired", "dependencies"] {
                if keyword == "dependencies" && dialect != Dialect::Draft7 {
                    continue;
                }
                if let Some(Value::Object(dependencies)) = schema.get(keyword) {
                    for (key, values) in dependencies {
                        if properties.iter().any(|(name, _)| name == key)
                            && let Value::Array(required) = values
                        {
                            missing(properties, required, path, result, false);
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

fn matches_type(kind: &Value, value: &Value) -> bool {
    if is_string(kind, "number") {
        return matches!(value, Value::Number(number) if number.is_finite());
    }
    if is_string(kind, "integer") {
        return received(value) == "integer";
    }
    is_string(kind, received(value))
}

fn limits(
    schema: &Value,
    value: &Value,
    path: &[Vec<u16>],
    result: &mut Evaluation,
    length: usize,
    suffix: &str,
) {
    let prefix = suffix.to_ascii_lowercase();
    let label = if suffix == "Length" {
        "characters"
    } else {
        &prefix
    };
    for (side, operator, message) in [("max", "<=", "more than"), ("min", ">=", "fewer than")] {
        let keyword = format!("{side}{suffix}");
        if let Some(bound) = number(schema, &keyword)
            && if side == "max" {
                length as f64 > bound
            } else {
                (length as f64) < bound
            }
        {
            result.problem(
                path,
                &format!("{prefix} {operator} {bound}"),
                Some(value),
                units(&format!("must NOT have {message} {bound} {label}")),
                &keyword,
            );
        }
    }
}

fn missing(
    properties: &[(Vec<u16>, Value)],
    required: &[Value],
    path: &[Vec<u16>],
    result: &mut Evaluation,
    required_keyword: bool,
) {
    for value in required {
        if let Value::String(key) = value
            && !properties.iter().any(|(name, _)| name == key)
        {
            let mut child_path = path.to_vec();
            child_path.push(key.clone());
            let mut message = units(if required_keyword {
                "must have required property '"
            } else {
                "must have property '"
            });
            message.extend(key);
            message.push(39);
            result.problem(
                &child_path,
                if required_keyword {
                    "required"
                } else {
                    "dependency"
                },
                None,
                message,
                if required_keyword {
                    "required"
                } else {
                    "dependency"
                },
            );
        }
    }
}

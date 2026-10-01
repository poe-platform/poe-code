//! Property hints retain the compiled reference graph and independent candidate
//! evaluations. They do not replace validation of the complete object.
use super::*;
use std::collections::BTreeMap;

pub struct JsonSchemaProperty {
    pub name: Vec<u16>,
    pub required: bool,
    pub schemas: Vec<Value>,
    pub sources: Vec<usize>,
}

fn references(node: &Node) -> Vec<usize> {
    [
        node.reference,
        node.dynamic_reference.as_ref().map(|(id, _)| *id),
        node.recursive_reference.map(|(id, _)| id),
    ]
    .into_iter()
    .flatten()
    .collect()
}

fn ignores_siblings(node: &Node) -> bool {
    node.dialect == Dialect::Draft7 && node.reference.is_some()
}

fn branches(node: &Node, keyword: &str) -> Vec<usize> {
    match node.schema.get(keyword) {
        Some(Value::Array(values)) => (0..values.len())
            .filter_map(|index| {
                node.children
                    .get(&child_key(keyword, &units(&index.to_string())))
                    .copied()
            })
            .collect(),
        _ => Vec::new(),
    }
}

impl CompiledSchema {
    pub fn properties(&self) -> Result<Vec<JsonSchemaProperty>, String> {
        enum Task {
            Visit(usize),
            Local(usize),
        }
        let mut tasks = vec![Task::Visit(0)];
        let mut seen = HashSet::new();
        let mut declarations: BTreeMap<Vec<u16>, Vec<usize>> = BTreeMap::new();
        while let Some(task) = tasks.pop() {
            match task {
                Task::Visit(id) => {
                    let node = &self.nodes[id];
                    if !matches!(node.schema, Value::Object(_)) || !seen.insert(id) {
                        continue;
                    }
                    if !ignores_siblings(node) {
                        tasks.push(Task::Local(id));
                    }
                    tasks.extend(references(node).into_iter().rev().map(Task::Visit));
                }
                Task::Local(id) => {
                    let node = &self.nodes[id];
                    if let Some(Value::Object(properties)) = node.schema.get("properties") {
                        for (name, _) in properties {
                            if let Some(child) = node.children.get(&child_key("properties", name)) {
                                let sources = declarations.entry(name.clone()).or_default();
                                if !sources.contains(child) {
                                    sources.push(*child);
                                }
                            }
                        }
                    }
                    let mut children = Vec::new();
                    for keyword in ["allOf", "anyOf", "oneOf"] {
                        children.extend(branches(node, keyword));
                    }
                    for keyword in ["then", "else", "dependentSchemas", "dependencies"] {
                        if matches!(keyword, "dependentSchemas" | "dependencies") {
                            if let Some(Value::Object(entries)) = node.schema.get(keyword) {
                                children.extend(entries.iter().filter_map(|(key, _)| {
                                    node.children.get(&child_key(keyword, key)).copied()
                                }));
                            }
                        } else if let Some(child) = node.children.get(&units(keyword)) {
                            children.push(*child);
                        }
                    }
                    tasks.extend(children.into_iter().rev().map(Task::Visit));
                }
            }
        }
        let mut budget = 262_144usize;
        declarations
            .into_iter()
            .map(|(name, sources)| {
                let required =
                    self.property_required(0, &name, &mut HashSet::new(), &mut budget)?;
                let mut schemas = Vec::new();
                for source in &sources {
                    schemas.extend(self.property_annotations(*source)?);
                }
                Ok(JsonSchemaProperty {
                    name,
                    required,
                    schemas,
                    sources,
                })
            })
            .collect()
    }

    fn property_required(
        &self,
        id: usize,
        name: &[u16],
        ancestors: &mut HashSet<usize>,
        budget: &mut usize,
    ) -> Result<bool, String> {
        let node = &self.nodes[id];
        if !matches!(node.schema, Value::Object(_)) || ancestors.contains(&id) {
            return Ok(false);
        }
        if *budget == 0 || ancestors.len() > 512 {
            return Err("Schema projection resource limit exceeded".into());
        }
        *budget -= 1;
        ancestors.insert(id);
        let result = (|| {
            let mut referenced = false;
            for target in references(node) {
                if self.property_required(target, name, ancestors, budget)? {
                    referenced = true;
                    break;
                }
            }
            if ignores_siblings(node) {
                return Ok(referenced);
            }
            if referenced
                || matches!(node.schema.get("required"), Some(Value::Array(names)) if names.iter().any(|item| matches!(item, Value::String(key) if key == name)))
            {
                return Ok(true);
            }
            for keyword in ["allOf", "anyOf", "oneOf"] {
                if !matches!(node.schema.get(keyword), Some(Value::Array(_))) {
                    continue;
                }
                let mut some = false;
                let mut every = true;
                for child in branches(node, keyword) {
                    let required = self.property_required(child, name, ancestors, budget)?;
                    some |= required;
                    every &= required;
                }
                if if keyword == "allOf" { some } else { every } {
                    return Ok(true);
                }
            }
            Ok(false)
        })();
        ancestors.remove(&id);
        result
    }

    fn property_annotations(&self, root: usize) -> Result<Vec<Value>, String> {
        let mut seen = HashSet::new();
        let mut pending = vec![root];
        let mut schemas = Vec::new();
        let mut budget = 262_144usize;
        while let Some(id) = pending.pop() {
            if !seen.insert(id) {
                continue;
            }
            let node = &self.nodes[id];
            if !ignores_siblings(node) {
                schemas.push(self.schema_snapshot(id, &mut budget)?);
            }
            let mut children = references(node);
            if !ignores_siblings(node) {
                for keyword in ["allOf", "anyOf", "oneOf"] {
                    children.extend(branches(node, keyword));
                }
            }
            pending.extend(children.into_iter().rev());
        }
        Ok(schemas)
    }

    fn schema_snapshot(&self, id: usize, budget: &mut usize) -> Result<Value, String> {
        if *budget == 0 {
            return Err("Schema projection resource limit exceeded".into());
        }
        *budget -= 1;
        let node = &self.nodes[id];
        let mut value = node.schema.clone();
        if let Value::Object(entries) = &mut value {
            for (key, value) in entries {
                let keyword = String::from_utf16_lossy(key);
                if compile::MAPS.contains(&keyword.as_ref()) {
                    if let Value::Object(entries) = value {
                        for (name, value) in entries {
                            if let Some(child) = node.children.get(&child_key(&keyword, name)) {
                                *value = self.schema_snapshot(*child, budget)?;
                            }
                        }
                    }
                } else if compile::ARRAYS.contains(&keyword.as_ref())
                    || (keyword == "items" && matches!(value, Value::Array(_)))
                {
                    if let Value::Array(entries) = value {
                        for (index, value) in entries.iter_mut().enumerate() {
                            if let Some(child) = node
                                .children
                                .get(&child_key(&keyword, &units(&index.to_string())))
                            {
                                *value = self.schema_snapshot(*child, budget)?;
                            }
                        }
                    }
                } else if compile::SINGLE.contains(&keyword.as_ref())
                    && let Some(child) = node.children.get(key)
                {
                    *value = self.schema_snapshot(*child, budget)?;
                }
            }
        }
        Ok(value)
    }

    pub fn validate_candidates(
        &self,
        sources: &[usize],
        value: &Value,
        mut options: ValidationOptions<'_>,
    ) -> Result<Vec<ValidationIssue>, String> {
        if sources.is_empty() || sources.iter().any(|source| *source >= self.nodes.len()) {
            return Err("Invalid property projection source".into());
        }
        let mut valid = false;
        let mut issues = Vec::new();
        for source in sources {
            let evaluation = evaluate::Evaluator {
                graph: self,
                active: HashSet::new(),
                calls: 0,
                dynamic_scope: Vec::new(),
                formats: options
                    .formats
                    .as_mut()
                    .map(|formats| &mut **formats as &mut dyn FormatValidator),
            }
            .evaluate(*source, value, &[], 0)?;
            valid |= evaluation.issues.is_empty();
            issues.extend(evaluation.issues);
        }
        Ok(if valid { Vec::new() } else { issues })
    }
}

//! Single-crossing record snapshots retain selected host values as opaque handles.
use config_mutations_rust::value::Value;
use std::collections::HashSet;
#[derive(Debug)]
pub struct Field {
    pub key: Vec<u16>,
    pub value: usize,
    pub enumerable: bool,
}
#[derive(Debug)]
pub enum Node {
    Undefined,
    Other,
    Record(Vec<Field>),
}
#[derive(Debug)]
pub struct Graph {
    pub nodes: Vec<Node>,
}
impl Graph {
    pub fn decode(value: Value) -> Result<Self, &'static str> {
        let Value::Array(rows) = value else {
            return Err("Invalid config record graph");
        };
        let mut nodes = Vec::with_capacity(rows.len());
        for row in rows {
            let Value::Array(mut parts) = row else {
                return Err("Invalid config record row");
            };
            if parts.len() != 2 {
                return Err("Invalid config record row length");
            }
            let fields = parts.pop().unwrap();
            let kind = parts.pop().unwrap();
            nodes.push(match kind {
                Value::Number(0.0) => Node::Undefined,
                Value::Number(1.0) => Node::Other,
                Value::Number(2.0) => {
                    let Value::Array(fields) = fields else {
                        return Err("Invalid config record fields");
                    };
                    let fields = fields
                        .into_iter()
                        .map(|field| {
                            let Value::Array(mut field) = field else {
                                return Err("Invalid config record field");
                            };
                            if field.len() != 3 {
                                return Err("Invalid config record field length");
                            }
                            let Value::Bool(enumerable) = field.pop().unwrap() else {
                                return Err("Invalid config record enumeration flag");
                            };
                            let Value::Number(id) = field.pop().unwrap() else {
                                return Err("Invalid config record field handle");
                            };
                            if id < 0.0 || id.fract() != 0.0 || id >= f64::from(u32::MAX) + 1.0 {
                                return Err("Invalid config record field handle");
                            }
                            let Value::String(key) = field.pop().unwrap() else {
                                return Err("Invalid config record field key");
                            };
                            Ok(Field {
                                key,
                                value: id as usize,
                                enumerable,
                            })
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    Node::Record(fields)
                }
                _ => return Err("Invalid config record kind"),
            });
        }
        if !matches!(nodes.first(), Some(Node::Undefined)) {
            return Err("Invalid missing config value handle");
        }
        for node in &nodes {
            if let Node::Record(fields) = node {
                for field in fields {
                    if field.value >= nodes.len() {
                        return Err("Config record handle out of range");
                    }
                }
            }
        }
        Ok(Self { nodes })
    }
    fn fields(&self, id: usize) -> &[Field] {
        if let Node::Record(fields) = &self.nodes[id] {
            fields
        } else {
            &[]
        }
    }
    fn get(&self, id: usize, key: &[u16]) -> usize {
        self.fields(id)
            .iter()
            .find(|field| field.key == key)
            .map_or(0, |field| field.value)
    }
    fn record(&self, id: usize) -> bool {
        matches!(self.nodes[id], Node::Record(_))
    }
    fn undefined(&self, id: usize) -> bool {
        matches!(self.nodes[id], Node::Undefined)
    }
    fn reference(&self, id: usize) -> Value {
        if self.undefined(id) {
            Value::Undefined
        } else {
            Value::Unsupported(id.to_string().encode_utf16().collect())
        }
    }
    fn union(&self, a: usize, b: usize) -> Vec<Vec<u16>> {
        let mut keys = vec![];
        let mut seen = HashSet::new();
        for field in self.fields(a).iter().chain(self.fields(b)) {
            if field.enumerable && seen.insert(field.key.clone()) {
                keys.push(field.key.clone());
            }
        }
        keys
    }
    pub fn normalize_scope(&self, id: usize) -> Result<Value, &'static str> {
        if id >= self.nodes.len() {
            return Err("Config root handle out of range");
        }
        Ok(Value::Object(
            self.fields(id)
                .iter()
                .filter(|field| field.enumerable && !self.undefined(field.value))
                .map(|field| (field.key.clone(), self.reference(field.value)))
                .collect(),
        ))
    }
    pub fn normalize(&self, id: usize) -> Result<Value, &'static str> {
        if id >= self.nodes.len() {
            return Err("Config root handle out of range");
        }
        let mut output = vec![];
        for field in self.fields(id).iter().filter(|field| field.enumerable) {
            let value = self.normalize_scope(field.value)?;
            if let Value::Object(fields) = &value
                && !fields.is_empty()
            {
                output.push((field.key.clone(), value));
            }
        }
        Ok(Value::Object(output))
    }
    pub fn merge(&self, base: usize, over: usize) -> Result<Value, &'static str> {
        if base >= self.nodes.len() || over >= self.nodes.len() {
            return Err("Config root handle out of range");
        }
        let mut output = vec![];
        for scope in self.union(base, over) {
            let a = self.get(base, &scope);
            let b = self.get(over, &scope);
            let fields = if scope == "runtime".encode_utf16().collect::<Vec<_>>() {
                self.runtime(a, b, 0)?
            } else {
                let mut fields: Vec<_> = self
                    .fields(a)
                    .iter()
                    .filter(|field| field.enumerable)
                    .map(|field| (field.key.clone(), self.reference(field.value)))
                    .collect();
                for field in self
                    .fields(b)
                    .iter()
                    .filter(|field| field.enumerable && !self.undefined(field.value))
                {
                    let value = self.reference(field.value);
                    if let Some((_, old)) = fields.iter_mut().find(|(key, _)| *key == field.key) {
                        *old = value;
                    } else {
                        fields.push((field.key.clone(), value));
                    }
                }
                fields
            };
            if !fields.is_empty() {
                output.push((scope, Value::Object(fields)));
            }
        }
        Ok(Value::Object(output))
    }
    fn runtime(
        &self,
        a: usize,
        b: usize,
        depth: usize,
    ) -> Result<Vec<(Vec<u16>, Value)>, &'static str> {
        if depth > 512 {
            return Err("Config runtime merge depth exceeded (512).");
        }
        let mut output = vec![];
        for key in self.union(a, b) {
            let av = self.get(a, &key);
            let bv = self.get(b, &key);
            if self.undefined(bv) {
                if !self.undefined(av) {
                    output.push((key, self.reference(av)));
                }
            } else {
                let value = if self.record(av) && self.record(bv) {
                    Value::Object(self.runtime(av, bv, depth + 1)?)
                } else {
                    self.reference(bv)
                };
                output.push((key, value));
            }
        }
        Ok(output)
    }
}

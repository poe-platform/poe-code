//! Portable layered configuration and prompt composition policies.
pub mod discover;
pub mod document;
pub mod foreign;
pub mod prompt;
pub mod prompt_document;
pub mod resolve;
use config_mutations_rust::value::Value;
use std::collections::{HashMap, HashSet};
#[derive(Clone, Debug)]
pub struct Layer {
    pub source: Vec<u16>,
    pub data: Value,
}
#[derive(Debug, PartialEq)]
pub struct Merged {
    pub data: Value,
    pub sources: Vec<(Vec<u16>, Vec<u16>)>,
}
pub fn escape_path(segments: &[Vec<u16>]) -> Vec<u16> {
    let mut output = vec![];
    for (index, segment) in segments.iter().enumerate() {
        if index > 0 {
            output.push(46);
        }
        for unit in segment {
            if matches!(unit, 46 | 92) {
                output.push(92);
            }
            output.push(*unit);
        }
    }
    output
}
type Fields = [(Vec<u16>, Value)];
#[derive(Clone)]
struct BorrowedLayer<'a> {
    source: &'a [u16],
    fields: &'a Fields,
    indices: Option<HashMap<&'a [u16], usize>>,
}
impl<'a> BorrowedLayer<'a> {
    fn new(source: &'a [u16], fields: &'a Fields) -> Self {
        let indices = if fields.len() > 32 {
            let mut indices = HashMap::with_capacity(fields.len());
            for (index, (key, _)) in fields.iter().enumerate() {
                indices.entry(key.as_slice()).or_insert(index);
            }
            Some(indices)
        } else {
            None
        };
        Self {
            source,
            fields,
            indices,
        }
    }
    fn get(&self, key: &[u16]) -> Option<&'a Value> {
        if let Some(indices) = &self.indices {
            indices.get(key).map(|index| &self.fields[*index].1)
        } else {
            self.fields
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value)
        }
    }
}
struct Entry<'a> {
    key: Vec<u16>,
    path: Vec<u16>,
    source: &'a [u16],
}
enum Task<'a> {
    Merge(Vec<BorrowedLayer<'a>>, Vec<Vec<u16>>, usize),
    Leaf(&'a Value),
    Finish(Vec<Entry<'a>>),
}
fn index(key: &[u16]) -> Option<u64> {
    if key.is_empty() || key.len() > 10 || key.len() > 1 && key[0] == 48 {
        return None;
    }
    let mut value = 0;
    for unit in key {
        if !(48..=57).contains(unit) {
            return None;
        }
        value = value * 10 + u64::from(*unit - 48);
    }
    (value < u64::from(u32::MAX)).then_some(value)
}
fn clone_value(root: &Value) -> Value {
    enum Clone<'a> {
        Visit(&'a Value),
        Array(usize),
        Object(Vec<Vec<u16>>),
    }
    let mut tasks = vec![Clone::Visit(root)];
    let mut output = vec![];
    while let Some(task) = tasks.pop() {
        match task {
            Clone::Visit(Value::Array(items)) => {
                tasks.push(Clone::Array(items.len()));
                for item in items.iter().rev() {
                    tasks.push(Clone::Visit(item));
                }
            }
            Clone::Visit(Value::Object(fields)) => {
                tasks.push(Clone::Object(
                    fields.iter().map(|(key, _)| key.clone()).collect(),
                ));
                for (_, value) in fields.iter().rev() {
                    tasks.push(Clone::Visit(value));
                }
            }
            Clone::Visit(value) => output.push(value.clone()),
            Clone::Array(count) => {
                let items = output.split_off(output.len() - count);
                output.push(Value::Array(items));
            }
            Clone::Object(keys) => {
                let values = output.split_off(output.len() - keys.len());
                output.push(Value::Object(keys.into_iter().zip(values).collect()));
            }
        }
    }
    output.pop().expect("Clone produces one root")
}
pub fn merge_layers(layers: &[Layer]) -> Result<Merged, &'static str> {
    let mut roots = vec![];
    for layer in layers {
        let Value::Object(fields) = &layer.data else {
            return Err("Config layer data must be an object.");
        };
        roots.push(BorrowedLayer::new(&layer.source, fields));
        let mut tasks = vec![(&layer.data, 0)];
        while let Some((value, depth)) = tasks.pop() {
            if depth > 1000 {
                return Err("Maximum configuration depth exceeded");
            }
            match value {
                Value::Object(fields) => {
                    tasks.extend(fields.iter().map(|(_, value)| (value, depth + 1)))
                }
                Value::Array(items) => tasks.extend(items.iter().map(|value| (value, depth + 1))),
                _ => {}
            }
        }
    }
    let mut tasks = vec![Task::Merge(roots, vec![], 0)];
    let mut output: Vec<Merged> = vec![];
    while let Some(task) = tasks.pop() {
        match task {
            Task::Leaf(value) => output.push(Merged {
                data: clone_value(value),
                sources: vec![],
            }),
            Task::Merge(layers, path, depth) => {
                if depth > 1000 {
                    return Err("Maximum configuration depth exceeded");
                }
                let mut keys = vec![];
                let mut seen = HashSet::new();
                for layer in &layers {
                    let mut order: Vec<_> = (0..layer.fields.len()).collect();
                    order.sort_by_key(|position| {
                        index(&layer.fields[*position].0).unwrap_or(u64::MAX)
                    });
                    for position in order {
                        let key = &layer.fields[position].0;
                        if seen.insert(key.clone()) {
                            keys.push(key.clone());
                        }
                    }
                }
                let mut entries = vec![];
                let mut children = vec![];
                for key in keys {
                    let mut winner = None;
                    let mut objects = vec![];
                    for layer in &layers {
                        let Some(value) = layer.get(&key) else {
                            continue;
                        };
                        if matches!(value, Value::Undefined)
                            || key == [112, 114, 111, 109, 112, 116]
                                && matches!(value,Value::String(text) if text.is_empty())
                        {
                            continue;
                        }
                        if winner.is_none() {
                            winner = Some((layer.source, value));
                        }
                        if matches!(winner, Some((_, Value::Object(_))))
                            && let Value::Object(fields) = value
                        {
                            objects.push(BorrowedLayer::new(layer.source, fields));
                        }
                    }
                    let Some((source, value)) = winner else {
                        continue;
                    };
                    if matches!(value, Value::Null) {
                        continue;
                    }
                    let mut child_path = path.clone();
                    child_path.push(key.clone());
                    entries.push(Entry {
                        key,
                        path: escape_path(&child_path),
                        source,
                    });
                    children.push(if matches!(value, Value::Object(_)) {
                        Task::Merge(objects, child_path, depth + 1)
                    } else {
                        Task::Leaf(value)
                    });
                }
                tasks.push(Task::Finish(entries));
                tasks.extend(children.into_iter().rev());
            }
            Task::Finish(entries) => {
                let children = output.split_off(output.len() - entries.len());
                let mut fields = vec![];
                let mut sources = vec![];
                for (entry, child) in entries.into_iter().zip(children) {
                    fields.push((entry.key, child.data));
                    sources.push((entry.path, entry.source.to_vec()));
                    sources.extend(child.sources);
                }
                output.push(Merged {
                    data: Value::Object(fields),
                    sources,
                });
            }
        }
    }
    Ok(output.pop().expect("Merge produces one root"))
}

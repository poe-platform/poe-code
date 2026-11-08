//! Portable owned-value merge/prune over std-only codec values. Work stacks bound
//! depth and avoid recursive clone/merge calls. Foreign identity stays in bindings.
use crate::value::Value;
use std::collections::HashMap;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error(pub &'static str);
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for Error {}
pub struct Pruned {
    pub changed: bool,
    pub result: Value,
}
type Fields<'a> = Vec<(&'a [u16], &'a Value)>;
type Prefixes<'a> = &'a [(Vec<u16>, Vec<u16>)];
enum Task<'a> {
    Clone(&'a Value, usize),
    Merge(Fields<'a>, Fields<'a>, bool, usize),
    Prune(Fields<'a>, Fields<'a>, usize),
    Array(usize),
    Object {
        keys: Vec<(Vec<u16>, bool)>,
        changed: bool,
    },
}
fn fields(value: &Value) -> Result<Fields<'_>, Error> {
    let Value::Object(fields) = value else {
        return Err(Error("Expected configuration object"));
    };
    Ok(fields.iter().map(|(k, v)| (k.as_slice(), v)).collect())
}
fn unique<'a>(fields: Fields<'a>) -> Fields<'a> {
    let mut positions = HashMap::new();
    let mut result: Fields<'a> = vec![];
    for (key, value) in fields {
        if let Some(index) = positions.get(key).copied() {
            result[index] = (key, value);
        } else {
            positions.insert(key, result.len());
            result.push((key, value));
        }
    }
    result
}
fn run<'a>(first: Task<'a>, prefixes: Prefixes<'a>) -> Result<(bool, Value), Error> {
    let mut tasks = vec![first];
    let mut values: Vec<(bool, Value)> = vec![];
    while let Some(task) = tasks.pop() {
        match task {
            Task::Clone(value, depth) => {
                if depth > 1000 {
                    return Err(Error("Maximum configuration depth exceeded"));
                }
                match value {
                    Value::Array(items) => {
                        tasks.push(Task::Array(items.len()));
                        for value in items.iter().rev() {
                            tasks.push(Task::Clone(value, depth + 1));
                        }
                    }
                    Value::Object(entries) => {
                        let fields =
                            unique(entries.iter().map(|(k, v)| (k.as_slice(), v)).collect());
                        tasks.push(Task::Object {
                            keys: fields.iter().map(|(k, _)| (k.to_vec(), false)).collect(),
                            changed: false,
                        });
                        for (_, v) in fields.into_iter().rev() {
                            tasks.push(Task::Clone(v, depth + 1));
                        }
                    }
                    _ => values.push((false, value.clone())),
                }
            }
            Task::Merge(base, patch, shallow, depth) => {
                if depth > 1000 {
                    return Err(Error("Maximum configuration depth exceeded"));
                }
                let base = unique(base);
                let patch = unique(patch);
                let patch_map: HashMap<_, _> = patch.iter().copied().collect();
                let mut positions = HashMap::new();
                let mut keys: Vec<&[u16]> = vec![];
                for (key, _) in &base {
                    positions.insert(*key, keys.len());
                    keys.push(key);
                }
                for (key, value) in &patch {
                    if matches!(value, Value::Undefined) || positions.contains_key(key) {
                        continue;
                    }
                    positions.insert(*key, keys.len());
                    keys.push(key);
                }
                let base_map: HashMap<_, _> = base.into_iter().collect();
                let mut children = vec![];
                for key in &keys {
                    let original = base_map.get(key).copied();
                    let patch = patch_map
                        .get(key)
                        .copied()
                        .filter(|v| !matches!(v, Value::Undefined));
                    let child = match (original, patch) {
                        (Some(Value::Object(base)), Some(Value::Object(patch))) if !shallow => {
                            let prefix = prefixes
                                .iter()
                                .find(|(name, _)| name.as_slice() == *key)
                                .map(|(_, p)| p.as_slice())
                                .filter(|p| !p.is_empty());
                            let base = base
                                .iter()
                                .filter(|(name, _)| prefix.is_none_or(|p| !name.starts_with(p)))
                                .map(|(k, v)| (k.as_slice(), v))
                                .collect();
                            Task::Merge(
                                base,
                                patch.iter().map(|(k, v)| (k.as_slice(), v)).collect(),
                                prefix.is_some(),
                                depth + 1,
                            )
                        }
                        (_, Some(value)) | (Some(value), None) => Task::Clone(value, depth + 1),
                        (None, None) => unreachable!(),
                    };
                    children.push(child);
                }
                tasks.push(Task::Object {
                    keys: keys.into_iter().map(|k| (k.to_vec(), false)).collect(),
                    changed: false,
                });
                tasks.extend(children.into_iter().rev());
            }
            Task::Prune(base, shape, depth) => {
                if depth > 1000 {
                    return Err(Error("Maximum configuration depth exceeded"));
                }
                let base = unique(base);
                let shape: HashMap<_, _> = unique(shape).into_iter().collect();
                let mut changed = false;
                let mut keys = vec![];
                let mut children = vec![];
                for (key, value) in base {
                    match shape.get(key).copied() {
                        None => {
                            keys.push((key.to_vec(), false));
                            children.push(Task::Clone(value, depth + 1));
                        }
                        Some(Value::Object(pattern)) if !pattern.is_empty() => {
                            if let Value::Object(current) = value {
                                keys.push((key.to_vec(), true));
                                children.push(Task::Prune(
                                    current.iter().map(|(k, v)| (k.as_slice(), v)).collect(),
                                    pattern.iter().map(|(k, v)| (k.as_slice(), v)).collect(),
                                    depth + 1,
                                ));
                            } else {
                                keys.push((key.to_vec(), false));
                                children.push(Task::Clone(value, depth + 1));
                            }
                        }
                        Some(_) => changed = true,
                    }
                }
                tasks.push(Task::Object { keys, changed });
                tasks.extend(children.into_iter().rev());
            }
            Task::Array(count) => {
                let start = values.len() - count;
                let items = values.drain(start..).map(|(_, v)| v).collect();
                values.push((false, Value::Array(items)));
            }
            Task::Object { keys, mut changed } => {
                let start = values.len() - keys.len();
                let mut entries = vec![];
                for ((key, pruned), (child_changed, value)) in
                    keys.into_iter().zip(values.drain(start..))
                {
                    changed |= child_changed;
                    if pruned && matches!(&value,Value::Object(properties) if properties.is_empty())
                    {
                        continue;
                    }
                    entries.push((key, value));
                }
                values.push((changed, Value::Object(entries)));
            }
        }
    }
    Ok(values.pop().unwrap())
}
pub fn merge(base: &Value, patch: &Value, prefixes: Option<Prefixes<'_>>) -> Result<Value, Error> {
    let base = fields(base)?;
    let patch = fields(patch)?;
    let (_, value) = run(Task::Merge(base, patch, false, 0), prefixes.unwrap_or(&[]))?;
    Ok(value)
}
pub fn prune(base: &Value, shape: &Value) -> Result<Pruned, Error> {
    let base = fields(base)?;
    let shape = fields(shape)?;
    let (changed, result) = run(Task::Prune(base, shape, 0), &[])?;
    Ok(Pruned { changed, result })
}

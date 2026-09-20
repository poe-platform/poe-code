//! Preserve typed keys and shared aliases before cloning configuration records.
use super::syntax::scanner::TScalarStyle;
use super::{Entry, Error, Node, error, scalar, units};
use crate::value::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
#[derive(Clone, PartialEq, Eq, Hash)]
enum MapKey {
    Null,
    Bool(bool),
    Number(u64),
    String(Vec<u16>),
    Object(usize),
}
fn map_key(value: &Arc<Datum>) -> MapKey {
    match &value.kind {
        Kind::Scalar(Value::Null) => MapKey::Null,
        Kind::Scalar(Value::Bool(value)) => MapKey::Bool(*value),
        Kind::Scalar(Value::String(value)) => MapKey::String(value.clone()),
        Kind::Scalar(Value::Number(value)) => MapKey::Number(if value.is_nan() {
            f64::NAN.to_bits()
        } else if *value == 0.0 {
            0
        } else {
            value.to_bits()
        }),
        _ => MapKey::Object(Arc::as_ptr(value) as usize),
    }
}
struct Pair {
    key: Arc<Datum>,
    value: Arc<Datum>,
    key_node: usize,
}
enum Kind {
    Scalar(Value),
    Array(Vec<Arc<Datum>>),
    Record(Vec<Pair>),
    Set(Vec<Pair>),
    Ordered,
}
struct Datum {
    kind: Kind,
    source: usize,
}
fn tagged(entry: &Entry, kind: &str) -> bool {
    entry.tag.as_deref().is_some_and(|tag| {
        tag.iter().copied().eq("tag:yaml.org,2002:"
            .encode_utf16()
            .chain(kind.encode_utf16()))
    })
}
fn quoted(value: &[u16], style: Option<TScalarStyle>) -> Vec<u16> {
    if style == Some(TScalarStyle::SingleQuoted) {
        let mut out = vec![39];
        for unit in value {
            out.push(*unit);
            if *unit == 39 {
                out.push(39);
            }
        }
        out.push(39);
        return out;
    }
    let text = String::from_utf16_lossy(value);
    let safe = !value.is_empty()
        && scalar::is_core_string(&text)
        && value
            .iter()
            .all(|ch| *ch >= 32 && !matches!(*ch, 44 | 91 | 93 | 123 | 125 | 10 | 13))
        && !matches!(
            value[0],
            33 | 38 | 42 | 35 | 63 | 58 | 45 | 37 | 64 | 96 | 34 | 39 | 62 | 124
        )
        && !value.contains(&58);
    if safe && style != Some(TScalarStyle::DoubleQuoted) {
        return value.to_vec();
    }
    units(&mcp_protocol_rust::json::stringify(
        &mcp_protocol_rust::json::Value::String(value.to_vec()),
    ))
}

fn bytes(properties: &[(Vec<u16>, Value)]) -> Vec<u8> {
    properties
        .iter()
        .filter_map(|(_, value)| match value {
            Value::Number(value) => Some(*value as u8),
            _ => None,
        })
        .collect()
}
fn flow(root: usize, nodes: &[Entry]) -> Vec<u16> {
    enum Task {
        Node(usize),
        Text(&'static str),
    }
    let mut tasks = vec![Task::Node(root)];
    let mut out = vec![];
    while let Some(task) = tasks.pop() {
        let id = match task {
            Task::Text(text) => {
                out.extend(units(text));
                continue;
            }
            Task::Node(id) => id,
        };
        let entry = &nodes[id];
        if let Some(tag) = &entry.tag {
            if let Some(kind) = String::from_utf16_lossy(tag).strip_prefix("tag:yaml.org,2002:") {
                out.extend(units("!!"));
                out.extend(units(kind));
            } else {
                out.extend_from_slice(tag);
            }
            out.push(32);
        }
        match &entry.node {
            Node::Alias(_) => {
                out.push(42);
                out.extend(entry.alias_name.as_ref().unwrap());
            }
            Node::Scalar(value) => match value {
                Value::String(value) => out.extend(quoted(value, entry.style)),
                Value::Null => out.extend(units("null")),
                Value::Bool(value) => out.extend(
                    entry
                        .text
                        .clone()
                        .unwrap_or_else(|| units(if *value { "true" } else { "false" })),
                ),
                Value::Number(value) => out.extend(units(&if value.is_nan() {
                    ".nan".into()
                } else if *value == f64::INFINITY {
                    ".inf".into()
                } else if *value == f64::NEG_INFINITY {
                    "-.inf".into()
                } else {
                    mcp_protocol_rust::numbers::format(*value)
                })),
                Value::Date(value) => {
                    let mut iso = value.to_iso_string();
                    if iso.ends_with(&units(".000Z")) {
                        iso.truncate(iso.len() - 5);
                        if iso.ends_with(&units("T00:00:00")) {
                            iso.truncate(iso.len() - 9);
                        }
                    }
                    out.extend(iso);
                }
                Value::Symbol(value) => out.extend_from_slice(value),
                Value::Object(properties) => {
                    const ALPHABET: &[u8] =
                        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
                    let bytes = bytes(properties);
                    for chunk in bytes.chunks(3) {
                        out.push(u16::from(ALPHABET[(chunk[0] >> 2) as usize]));
                        out.push(u16::from(
                            ALPHABET[(((chunk[0] & 3) << 4)
                                | (chunk.get(1).copied().unwrap_or(0) >> 4))
                                as usize],
                        ));
                        out.push(if chunk.len() > 1 {
                            u16::from(
                                ALPHABET[(((chunk[1] & 15) << 2)
                                    | (chunk.get(2).copied().unwrap_or(0) >> 6))
                                    as usize],
                            )
                        } else {
                            61
                        });
                        out.push(if chunk.len() > 2 {
                            u16::from(ALPHABET[(chunk[2] & 63) as usize])
                        } else {
                            61
                        });
                    }
                }
                _ => unreachable!("parsed YAML scalar"),
            },
            Node::Sequence(items) | Node::Mapping(items) => {
                let sequence = matches!(entry.node, Node::Sequence(_));
                if items.is_empty() {
                    out.extend(units(if sequence { "[]" } else { "{}" }));
                } else {
                    out.extend(units(if sequence { "[ " } else { "{ " }));
                    tasks.push(Task::Text(if sequence { " ]" } else { " }" }));
                    for (index, id) in items.iter().enumerate().rev() {
                        tasks.push(Task::Node(*id));
                        if index > 0 {
                            tasks.push(Task::Text(if !sequence && index % 2 == 1 {
                                ": "
                            } else {
                                ", "
                            }));
                        }
                    }
                }
            }
        }
    }
    out
}

fn property_key(
    value: &Arc<Datum>,
    nodes: &[Entry],
    key_node: usize,
    date_key: &mut Option<&mut dyn FnMut(i64) -> Vec<u16>>,
) -> Vec<u16> {
    match &value.kind {
        Kind::Scalar(Value::String(value)) => value.clone(),
        Kind::Scalar(Value::Null) => vec![],
        Kind::Scalar(Value::Bool(value)) => units(if *value { "true" } else { "false" }),
        Kind::Scalar(Value::Number(value)) => units(&if value.is_nan() {
            "NaN".into()
        } else if *value == f64::INFINITY {
            "Infinity".into()
        } else if *value == f64::NEG_INFINITY {
            "-Infinity".into()
        } else {
            mcp_protocol_rust::numbers::format(*value)
        }),
        Kind::Scalar(Value::Date(value)) if !matches!(nodes[key_node].node, Node::Alias(_)) => {
            match date_key {
                Some(format) => format(value.epoch_millis),
                None => value.to_iso_string(),
            }
        }
        Kind::Scalar(Value::Object(properties))
            if !matches!(nodes[key_node].node, Node::Alias(_)) =>
        {
            units(&String::from_utf8_lossy(&bytes(properties)))
        }
        _ => flow(key_node, nodes),
    }
}
fn merge_key(
    value: &Arc<Datum>,
    nodes: &[Entry],
    date_key: &mut Option<&mut dyn FnMut(i64) -> Vec<u16>>,
) -> Vec<u16> {
    enum Task<'a> {
        Value(&'a Arc<Datum>, bool),
        Comma,
    }
    let mut tasks = vec![Task::Value(value, false)];
    let mut output = vec![];
    while let Some(task) = tasks.pop() {
        let (value, in_array) = match task {
            Task::Comma => {
                output.push(44);
                continue;
            }
            Task::Value(v, a) => (v, a),
        };
        match &value.kind {
            Kind::Array(items) => {
                for (i, item) in items.iter().enumerate().rev() {
                    tasks.push(Task::Value(item, true));
                    if i > 0 {
                        tasks.push(Task::Comma);
                    }
                }
            }
            Kind::Record(_) => output.extend(units("[object Object]")),
            Kind::Set(_) => output.extend(units("[object Set]")),
            Kind::Ordered => output.extend(units("[object Map]")),
            Kind::Scalar(Value::Null | Value::Undefined) => {
                if !in_array {
                    output.extend(units("null"));
                }
            }
            Kind::Scalar(Value::Date(value)) => output.extend(match date_key {
                Some(format) => format(value.epoch_millis),
                None => value.to_iso_string(),
            }),
            Kind::Scalar(Value::Object(properties)) => {
                output.extend(units(&String::from_utf8_lossy(&bytes(properties))))
            }
            _ => output.extend(property_key(value, nodes, value.source, date_key)),
        }
    }
    output
}

fn add_merge(
    target: &mut Vec<Pair>,
    value: &Arc<Datum>,
    nodes: &[Entry],
    mark: super::syntax::scanner::Marker,
    date_key: &mut Option<&mut dyn FnMut(i64) -> Vec<u16>>,
) -> Result<(), Error> {
    let sources: Vec<_> = if let Kind::Array(items) = &value.kind {
        items.iter().collect()
    } else {
        vec![value]
    };
    let mut names: HashSet<_> = target
        .iter()
        .map(|pair| property_key(&pair.key, nodes, pair.key_node, date_key))
        .collect();
    for source in sources {
        let Kind::Record(pairs) = &source.kind else {
            return Err(error("Merge sources must be maps or map aliases", mark));
        };
        let mut keys: HashMap<MapKey, usize> = HashMap::new();
        let mut entries: Vec<&Pair> = vec![];
        for pair in pairs {
            let key = map_key(&pair.key);
            if let Some(index) = keys.get(&key) {
                entries[*index] = pair;
            } else {
                keys.insert(key, entries.len());
                entries.push(pair);
            }
        }
        for pair in entries {
            let name = merge_key(&pair.key, nodes, date_key);
            if names.insert(name.clone()) {
                target.push(Pair {
                    key: Arc::new(Datum {
                        kind: Kind::Scalar(Value::String(name)),
                        source: pair.key.source,
                    }),
                    value: pair.value.clone(),
                    key_node: pair.key_node,
                });
            }
        }
    }
    Ok(())
}
fn build(
    nodes: &[Entry],
    root: usize,
    date_key: &mut Option<&mut dyn FnMut(i64) -> Vec<u16>>,
) -> Result<Arc<Datum>, Error> {
    enum Task {
        Visit(usize, usize),
        Complete(usize),
    }
    let mut tasks = vec![Task::Visit(root, 0)];
    let mut output: Vec<Option<Arc<Datum>>> = vec![None; nodes.len()];
    let mut active = vec![false; nodes.len()];
    while let Some(task) = tasks.pop() {
        match task {
            Task::Visit(id, depth) => {
                if depth > 512 {
                    return Err(error(
                        "Maximum configuration depth exceeded",
                        nodes[id].mark,
                    ));
                }
                if output[id].is_some() {
                    continue;
                }
                if active[id] {
                    return Err(error(
                        "Cyclic YAML alias cannot be cloned into configuration",
                        nodes[id].mark,
                    ));
                }
                active[id] = true;
                match &nodes[id].node {
                    Node::Scalar(value) => {
                        output[id] = Some(Arc::new(Datum {
                            kind: Kind::Scalar(value.clone()),
                            source: id,
                        }));
                        active[id] = false;
                    }
                    Node::Alias(target) => {
                        tasks.push(Task::Complete(id));
                        tasks.push(Task::Visit(*target, depth));
                    }
                    Node::Sequence(items) | Node::Mapping(items) => {
                        tasks.push(Task::Complete(id));
                        for child in items.iter().rev() {
                            tasks.push(Task::Visit(*child, depth + 1));
                        }
                    }
                }
            }
            Task::Complete(id) => {
                let entry = &nodes[id];
                let get = |id: usize| output[id].as_ref().unwrap().clone();
                let kind = match &entry.node {
                    Node::Alias(target) => {
                        output[id] = Some(get(*target));
                        active[id] = false;
                        continue;
                    }
                    Node::Scalar(_) => unreachable!(),
                    Node::Mapping(items) => {
                        let mut pairs: Vec<Pair> = vec![];
                        let mut seen = HashSet::new();
                        for chunk in items.as_chunks::<2>().0 {
                            let key_node = chunk[0];
                            let key = get(key_node);
                            let value = get(chunk[1]);
                            if nodes[key_node].merge {
                                add_merge(&mut pairs, &value, nodes, entry.mark, date_key)?;
                                continue;
                            }
                            if matches!(nodes[key_node].node, Node::Scalar(_)) {
                                let comparable = matches!(
                                    &key.kind,
                                    Kind::Scalar(Value::Null | Value::Bool(_) | Value::String(_))
                                ) || matches!(&key.kind,Kind::Scalar(Value::Number(value)) if !value.is_nan());
                                if comparable && !seen.insert(map_key(&key)) {
                                    return Err(error(
                                        "Map keys must be unique",
                                        nodes[key_node].mark,
                                    ));
                                }
                            }
                            pairs.push(Pair {
                                key,
                                value,
                                key_node,
                            });
                        }
                        if tagged(entry, "set") {
                            if pairs
                                .iter()
                                .any(|pair| !matches!(pair.value.kind, Kind::Scalar(Value::Null)))
                            {
                                return Err(error(
                                    "Set items must all have null values",
                                    entry.mark,
                                ));
                            }
                            Kind::Set(pairs)
                        } else {
                            Kind::Record(pairs)
                        }
                    }
                    Node::Sequence(items) => {
                        if tagged(entry, "pairs") || tagged(entry, "omap") {
                            let mut pairs: Vec<Pair> = vec![];
                            let mut seen = HashSet::new();
                            for child in items {
                                let item = get(*child);
                                let pair = match &item.kind {
                                    Kind::Record(pairs) | Kind::Set(pairs) => {
                                        if pairs.len() > 1 {
                                            return Err(error(
                                                "Each pair must have its own sequence indicator",
                                                entry.mark,
                                            ));
                                        }
                                        if let Some(pair) = pairs.first() {
                                            Pair {
                                                key: pair.key.clone(),
                                                value: pair.value.clone(),
                                                key_node: pair.key_node,
                                            }
                                        } else {
                                            let null = Arc::new(Datum {
                                                kind: Kind::Scalar(Value::Null),
                                                source: *child,
                                            });
                                            Pair {
                                                key: null.clone(),
                                                value: null,
                                                key_node: *child,
                                            }
                                        }
                                    }
                                    _ => Pair {
                                        key: item,
                                        value: Arc::new(Datum {
                                            kind: Kind::Scalar(Value::Null),
                                            source: *child,
                                        }),
                                        key_node: *child,
                                    },
                                };
                                if tagged(entry, "omap") && !seen.insert(map_key(&pair.key)) {
                                    return Err(error(
                                        "Ordered maps must not include duplicate keys",
                                        entry.mark,
                                    ));
                                }
                                pairs.push(pair);
                            }
                            if tagged(entry, "omap") {
                                Kind::Ordered
                            } else {
                                Kind::Array(
                                    pairs
                                        .into_iter()
                                        .map(|pair| {
                                            let source = pair.key_node;
                                            Arc::new(Datum {
                                                kind: Kind::Record(vec![pair]),
                                                source,
                                            })
                                        })
                                        .collect(),
                                )
                            }
                        } else {
                            Kind::Array(items.iter().map(|id| get(*id)).collect())
                        }
                    }
                };
                output[id] = Some(Arc::new(Datum { kind, source: id }));
                active[id] = false;
            }
        }
    }
    Ok(output[root].take().unwrap())
}
pub(super) fn configuration(
    nodes: &[Entry],
    root: usize,
    mut date_key: Option<&mut dyn FnMut(i64) -> Vec<u16>>,
) -> Result<(Value, Vec<usize>, Vec<usize>), Error> {
    enum Task<'a> {
        Visit(&'a Arc<Datum>, usize),
        Array(usize),
        Record(Vec<Vec<u16>>),
    }
    let root = build(nodes, root, &mut date_key)?;
    let mut tasks = vec![Task::Visit(&root, 0)];
    let mut values = vec![];
    let mut visits = 0usize;
    let mut date_ids = vec![];
    let mut symbol_ids = vec![];
    while let Some(task) = tasks.pop() {
        match task {
            Task::Visit(data, depth) => {
                visits += 1;
                if depth > 512 || visits > nodes.len().saturating_mul(100) {
                    return Err(error(
                        "Maximum configuration expansion exceeded",
                        nodes[data.source].mark,
                    ));
                }
                match &data.kind {
                    Kind::Scalar(value) => {
                        if matches!(value, Value::Date(_)) {
                            date_ids.push(data.source);
                        }
                        if matches!(value, Value::Symbol(_)) {
                            symbol_ids.push(data.source);
                        }
                        values.push(value.clone());
                    }
                    Kind::Set(_) | Kind::Ordered => values.push(Value::Object(vec![])),
                    Kind::Array(items) => {
                        tasks.push(Task::Array(items.len()));
                        for child in items.iter().rev() {
                            tasks.push(Task::Visit(child, depth + 1));
                        }
                    }
                    Kind::Record(pairs) => {
                        let mut seen: HashMap<Vec<u16>, usize> = HashMap::new();
                        let mut fields: Vec<(Vec<u16>, usize)> = vec![];
                        for (index, pair) in pairs.iter().enumerate() {
                            let name = property_key(&pair.key, nodes, pair.key_node, &mut date_key);
                            if let Some(index_in_fields) = seen.get(&name) {
                                fields[*index_in_fields].1 = index;
                            } else {
                                seen.insert(name.clone(), fields.len());
                                fields.push((name, index));
                            }
                        }
                        fields.sort_by_key(|(name, _)| {
                            crate::jsonc::property_index(name).map_or(u64::MAX, u64::from)
                        });
                        tasks.push(Task::Record(
                            fields.iter().map(|(name, _)| name.clone()).collect(),
                        ));
                        for (_, index) in fields.into_iter().rev() {
                            tasks.push(Task::Visit(&pairs[index].value, depth + 1));
                        }
                    }
                }
            }
            Task::Array(count) => {
                let items = values.split_off(values.len() - count);
                values.push(Value::Array(items));
            }
            Task::Record(names) => {
                let items = values.split_off(values.len() - names.len());
                values.push(Value::Object(names.into_iter().zip(items).collect()));
            }
        }
    }
    values
        .pop()
        .map(|value| (value, date_ids, symbol_ids))
        .ok_or_else(|| error("Expected YAML object", nodes[root.source].mark))
}

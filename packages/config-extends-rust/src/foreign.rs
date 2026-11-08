//! Merge decisions over foreign handles. Values and observable operations stay in the host.
use crate::escape_path;
use std::{collections::HashSet, hash::Hash};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Undefined,
    Null,
    EmptyString,
    Other,
}
#[derive(Debug, PartialEq, Eq)]
pub enum Error<E> {
    Policy(&'static str),
    Host(E),
}
#[derive(Clone)]
pub enum Layer<V> {
    Static { source: Vec<u16>, data: V },
    Dynamic(V),
}
#[derive(Debug)]
pub struct Merged<V> {
    pub data: V,
    pub sources: Vec<(Vec<u16>, Vec<u16>)>,
}
pub type Entries<V> = Vec<(Vec<u16>, V)>;
pub trait Host {
    type Value: Copy + Eq + Hash;
    type Iterator: Copy;
    type Error;
    fn layer_data(&mut self, layer: Self::Value) -> Result<Self::Value, Self::Error>;
    fn layer_source(&mut self, layer: Self::Value) -> Result<Vec<u16>, Self::Error>;
    fn kind(&mut self, value: Self::Value) -> Result<Kind, Self::Error>;
    fn is_plain(&mut self, value: Self::Value) -> Result<bool, Self::Error>;
    fn is_array(&mut self, value: Self::Value) -> Result<bool, Self::Error>;
    fn keys(&mut self, value: Self::Value) -> Result<Vec<Vec<u16>>, Self::Error>;
    fn own(&mut self, value: Self::Value, key: &[u16]) -> Result<Self::Value, Self::Error>;
    fn entries(&mut self, value: Self::Value) -> Result<Entries<Self::Value>, Self::Error>;
    fn sequence(&mut self, value: Self::Value, array: bool) -> Result<Self::Iterator, Self::Error>;
    fn next(&mut self, iterator: Self::Iterator) -> Result<Option<Self::Value>, Self::Error>;
    /// Successful exhaustion releases a handle; abrupt exit also closes the iterator.
    fn close(&mut self, iterator: Self::Iterator, abrupt: bool);
    fn create(&mut self, prototype: Option<Self::Value>) -> Result<Self::Value, Self::Error>;
    fn define(
        &mut self,
        object: Self::Value,
        key: &[u16],
        value: Self::Value,
    ) -> Result<(), Self::Error>;
    /// Invoke the foreign array's map with clone_value as its mapper, retaining holes/hooks.
    fn map(&mut self, array: Self::Value, depth: usize) -> Result<Self::Value, Self::Error>;
}
enum Check<V, I> {
    Visit(V, usize),
    Next(I, usize),
    Leave(V),
}
fn data<H: Host>(layer: &Layer<H::Value>, host: &mut H) -> Result<H::Value, Error<H::Error>> {
    match layer {
        Layer::Static { data, .. } => Ok(*data),
        Layer::Dynamic(value) => host.layer_data(*value).map_err(Error::Host),
    }
}
fn source<H: Host>(layer: &Layer<H::Value>, host: &mut H) -> Result<Vec<u16>, Error<H::Error>> {
    match layer {
        Layer::Static { source, .. } => Ok(source.clone()),
        Layer::Dynamic(value) => host.layer_source(*value).map_err(Error::Host),
    }
}
fn acyclic<H: Host>(root: H::Value, host: &mut H) -> Result<(), Error<H::Error>> {
    let mut active = HashSet::new();
    let mut tasks = vec![Check::Visit(root, 0)];
    let result = (|| {
        while let Some(task) = tasks.pop() {
            match task {
                Check::Leave(value) => {
                    active.remove(&value);
                }
                Check::Next(iterator, depth) => match host.next(iterator).map_err(Error::Host)? {
                    Some(value) => {
                        tasks.push(Check::Next(iterator, depth));
                        tasks.push(Check::Visit(value, depth + 1));
                    }
                    None => host.close(iterator, false),
                },
                Check::Visit(value, depth) => {
                    let array = host.is_array(value).map_err(Error::Host)?;
                    if !array && !host.is_plain(value).map_err(Error::Host)? {
                        continue;
                    }
                    if active.contains(&value) {
                        return Err(Error::Policy("Cyclic config data is not supported."));
                    }
                    if depth > 1000 {
                        return Err(Error::Policy("Maximum configuration depth exceeded"));
                    }
                    active.insert(value);
                    let iterator = host.sequence(value, array).map_err(Error::Host)?;
                    tasks.push(Check::Leave(value));
                    tasks.push(Check::Next(iterator, depth));
                }
            }
        }
        Ok(())
    })();
    if result.is_err() {
        for task in tasks.iter().rev() {
            if let Check::Next(iterator, _) = task {
                host.close(*iterator, true);
            }
        }
    }
    result
}
struct CloneState<V> {
    object: V,
    entries: std::vec::IntoIter<(Vec<u16>, V)>,
    depth: usize,
}
enum Clone<V> {
    Visit(V, usize),
    Next(CloneState<V>),
    Attach(CloneState<V>, Vec<u16>),
}
pub fn clone_value<H: Host>(
    value: H::Value,
    depth: usize,
    host: &mut H,
) -> Result<H::Value, Error<H::Error>> {
    let mut tasks = vec![Clone::Visit(value, depth)];
    let mut output = vec![];
    while let Some(task) = tasks.pop() {
        match task {
            Clone::Visit(value, depth) => {
                if depth > 1000 {
                    return Err(Error::Policy("Maximum configuration depth exceeded"));
                }
                if host.is_array(value).map_err(Error::Host)? {
                    output.push(host.map(value, depth).map_err(Error::Host)?);
                } else if !host.is_plain(value).map_err(Error::Host)? {
                    output.push(value);
                } else {
                    let object = host.create(Some(value)).map_err(Error::Host)?;
                    let entries = host.entries(value).map_err(Error::Host)?.into_iter();
                    tasks.push(Clone::Next(CloneState {
                        object,
                        entries,
                        depth,
                    }));
                }
            }
            Clone::Next(mut state) => {
                if let Some((key, value)) = state.entries.next() {
                    let depth = state.depth;
                    tasks.push(Clone::Attach(state, key));
                    tasks.push(Clone::Visit(value, depth + 1));
                } else {
                    output.push(state.object);
                }
            }
            Clone::Attach(state, key) => {
                let value = output.pop().expect("Clone child completed");
                host.define(state.object, &key, value)
                    .map_err(Error::Host)?;
                tasks.push(Clone::Next(state));
            }
        }
    }
    Ok(output.pop().expect("Clone produces one value"))
}
struct MergeState<V> {
    layers: Vec<Layer<V>>,
    path: Vec<Vec<u16>>,
    depth: usize,
    object: V,
    keys: std::vec::IntoIter<Vec<u16>>,
    sources: Vec<(Vec<u16>, Vec<u16>)>,
}
enum Task<V> {
    Merge(Vec<Layer<V>>, Vec<Vec<u16>>, usize),
    Leaf(V, usize),
    Next(MergeState<V>),
    Attach(MergeState<V>, Vec<u16>, Vec<u16>, Vec<u16>),
}
pub fn merge_layers<H: Host>(
    layers: &[Layer<H::Value>],
    host: &mut H,
) -> Result<Merged<H::Value>, Error<H::Error>> {
    for layer in layers {
        acyclic(data(layer, host)?, host)?;
    }
    let mut tasks = vec![Task::Merge(layers.to_vec(), vec![], 0)];
    let mut output: Vec<Merged<H::Value>> = vec![];
    while let Some(task) = tasks.pop() {
        match task {
            Task::Leaf(value, depth) => output.push(Merged {
                data: clone_value(value, depth, host)?,
                sources: vec![],
            }),
            Task::Merge(layers, path, depth) => {
                if depth > 1000 {
                    return Err(Error::Policy("Maximum configuration depth exceeded"));
                }
                let object = host.create(None).map_err(Error::Host)?;
                let mut keys = vec![];
                let mut seen = HashSet::new();
                for layer in &layers {
                    let value = data(layer, host)?;
                    for key in host.keys(value).map_err(Error::Host)? {
                        if seen.insert(key.clone()) {
                            keys.push(key);
                        }
                    }
                }
                tasks.push(Task::Next(MergeState {
                    layers,
                    path,
                    depth,
                    object,
                    keys: keys.into_iter(),
                    sources: vec![],
                }));
            }
            Task::Next(mut state) => {
                let Some(key) = state.keys.next() else {
                    output.push(Merged {
                        data: state.object,
                        sources: state.sources,
                    });
                    continue;
                };
                let mut winner: Option<(Vec<u16>, H::Value)> = None;
                let mut objects = vec![];
                for layer in &state.layers {
                    let value = data(layer, host)?;
                    let candidate = host.own(value, &key).map_err(Error::Host)?;
                    let kind = host.kind(candidate).map_err(Error::Host)?;
                    if kind == Kind::Undefined
                        || key == [112, 114, 111, 109, 112, 116] && kind == Kind::EmptyString
                    {
                        continue;
                    }
                    if let Some((_, value)) = &winner {
                        if host.is_plain(*value).map_err(Error::Host)?
                            && host.is_plain(candidate).map_err(Error::Host)?
                        {
                            objects.push(Layer::Static {
                                source: source(layer, host)?,
                                data: candidate,
                            });
                        }
                    } else {
                        winner = Some((source(layer, host)?, candidate));
                        if host.is_plain(candidate).map_err(Error::Host)? {
                            objects.push(Layer::Static {
                                source: source(layer, host)?,
                                data: candidate,
                            });
                        }
                    }
                }
                let Some((winning_source, value)) = winner else {
                    tasks.push(Task::Next(state));
                    continue;
                };
                if host.kind(value).map_err(Error::Host)? == Kind::Null {
                    tasks.push(Task::Next(state));
                    continue;
                }
                let mut path = state.path.clone();
                path.push(key.clone());
                let child = if host.is_plain(value).map_err(Error::Host)? {
                    Task::Merge(objects, path.clone(), state.depth + 1)
                } else {
                    Task::Leaf(value, state.depth + 1)
                };
                tasks.push(Task::Attach(state, key, escape_path(&path), winning_source));
                tasks.push(child);
            }
            Task::Attach(mut state, key, path, source) => {
                let child = output.pop().expect("Merge child completed");
                host.define(state.object, &key, child.data)
                    .map_err(Error::Host)?;
                state.sources.push((path, source));
                state.sources.extend(child.sources);
                tasks.push(Task::Next(state));
            }
        }
    }
    Ok(output.pop().expect("Merge produces one root"))
}

//! Owned data graphs avoid foreign-runtime callbacks for ordinary template values.
use crate::template::{Environment, Error, Lookup, Partials, ValueKind};
use std::collections::HashSet;
#[derive(Clone, Debug, PartialEq)]
pub enum Node {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(Vec<u16>),
    BigInt(Vec<u16>),
    Object(Vec<(Vec<u16>, usize)>),
    Array {
        properties: Vec<(Vec<u16>, usize)>,
        items: Vec<usize>,
    },
}
#[derive(Clone, Debug, PartialEq)]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub root: usize,
}
fn error(text: &str) -> Error {
    Error {
        description: text.encode_utf16().collect(),
        line: None,
        column: None,
    }
}
impl Graph {
    pub fn validate(&self) -> Result<(), Error> {
        if self.root >= self.nodes.len() {
            return Err(error("Invalid template data root"));
        }
        for node in &self.nodes {
            let (properties, items) = match node {
                Node::Object(properties) => (properties.as_slice(), &[][..]),
                Node::Array { properties, items } => (properties.as_slice(), items.as_slice()),
                _ => continue,
            };
            if properties.iter().any(|(_, id)| *id >= self.nodes.len())
                || items.iter().any(|id| *id >= self.nodes.len())
            {
                return Err(error("Invalid template data reference"));
            }
        }
        Ok(())
    }
}
struct Context {
    handle: usize,
    parent: Option<usize>,
}
struct Iterator {
    handle: usize,
    index: usize,
}
pub trait DataHost: Partials {
    fn coerce(&mut self, _: usize) -> Result<Option<Vec<u16>>, Error> {
        Ok(None)
    }
}
pub struct DataEnvironment<'a> {
    graph: &'a Graph,
    host: &'a mut dyn DataHost,
    contexts: Vec<Context>,
    iterators: Vec<Iterator>,
}
impl<'a> DataEnvironment<'a> {
    pub fn new(graph: &'a Graph, host: &'a mut dyn DataHost) -> Result<Self, Error> {
        graph.validate()?;
        Ok(Self {
            graph,
            host,
            contexts: vec![Context {
                handle: graph.root,
                parent: None,
            }],
            iterators: vec![],
        })
    }
    fn classify(&self, handle: usize, hit: bool) -> Lookup {
        if !hit {
            return Lookup {
                handle: 0,
                hit: false,
                truthy: false,
                nullish: true,
                kind: ValueKind::Other,
                empty: false,
            };
        }
        let (truthy, nullish, kind, empty) = match &self.graph.nodes[handle] {
            Node::Undefined | Node::Null => (false, true, ValueKind::Other, false),
            Node::Bool(value) => (*value, false, ValueKind::Other, false),
            Node::Number(value) => (
                *value != 0.0 && !value.is_nan(),
                false,
                ValueKind::Number,
                false,
            ),
            Node::String(value) => (!value.is_empty(), false, ValueKind::String, false),
            Node::BigInt(value) => (value.as_slice() != [48], false, ValueKind::Other, false),
            Node::Object(_) => (true, false, ValueKind::Object, false),
            Node::Array { items, .. } => (true, false, ValueKind::Array, items.is_empty()),
        };
        Lookup {
            handle,
            hit,
            truthy,
            nullish,
            kind,
            empty,
        }
    }
    fn property(&self, handle: usize, name: &[u16]) -> Option<usize> {
        let properties = match &self.graph.nodes[handle] {
            Node::Object(properties) | Node::Array { properties, .. } => properties,
            _ => return None,
        };
        properties
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, id)| *id)
    }
    fn own_text(&self, handle: usize) -> Vec<u16> {
        enum Task {
            Visit(usize, bool),
            End(usize),
            Comma,
        }
        let mut tasks = vec![Task::Visit(handle, false)];
        let mut active = HashSet::new();
        let mut output = vec![];
        while let Some(task) = tasks.pop() {
            let (id, in_array) = match task {
                Task::Comma => {
                    output.push(44);
                    continue;
                }
                Task::End(id) => {
                    active.remove(&id);
                    continue;
                }
                Task::Visit(id, a) => (id, a),
            };
            match &self.graph.nodes[id] {
                Node::Undefined | Node::Null if in_array => {}
                Node::Undefined => output.extend("undefined".encode_utf16()),
                Node::Null => output.extend("null".encode_utf16()),
                Node::Bool(value) => {
                    output.extend(if *value { "true" } else { "false" }.encode_utf16())
                }
                Node::Number(value) => {
                    output.extend(mcp_protocol_rust::numbers::format(*value).encode_utf16())
                }
                Node::String(value) | Node::BigInt(value) => output.extend_from_slice(value),
                Node::Object(_) => output.extend("[object Object]".encode_utf16()),
                Node::Array { items, .. } => {
                    if !active.insert(id) {
                        continue;
                    }
                    tasks.push(Task::End(id));
                    for (i, item) in items.iter().enumerate().rev() {
                        tasks.push(Task::Visit(*item, true));
                        if i > 0 {
                            tasks.push(Task::Comma);
                        }
                    }
                }
            }
        }
        output
    }
}
impl Partials for DataEnvironment<'_> {
    fn has(&mut self, name: &[u16]) -> Result<bool, Error> {
        self.host.has(name)
    }
    fn get(&mut self, name: &[u16]) -> Result<Vec<u16>, Error> {
        self.host.get(name)
    }
}
impl Environment for DataEnvironment<'_> {
    fn lookup(&mut self, context: usize, name: &[u16]) -> Result<Lookup, Error> {
        let context = self
            .contexts
            .get(context)
            .ok_or_else(|| error("Invalid template data context"))?;
        if name == [46] {
            return Ok(self.classify(context.handle, true));
        }
        let parts: Vec<_> = name.split(|ch| *ch == 46).collect();
        let mut cursor = Some(context);
        while let Some(context) = cursor {
            let mut handle = Some(context.handle);
            for part in &parts {
                handle = handle.and_then(|id| self.property(id, part));
                if handle.is_none() {
                    break;
                }
            }
            if let Some(handle) = handle {
                return Ok(self.classify(handle, true));
            }
            cursor = context.parent.map(|id| &self.contexts[id]);
        }
        Ok(self.classify(0, false))
    }
    fn text(&mut self, handle: usize) -> Result<Vec<u16>, Error> {
        if handle >= self.graph.nodes.len() {
            return Err(error("Invalid template data value"));
        }
        if matches!(
            self.graph.nodes[handle],
            Node::Object(_) | Node::Array { .. }
        ) && let Some(text) = self.host.coerce(handle)?
        {
            return Ok(text);
        }
        Ok(self.own_text(handle))
    }
    fn push(&mut self, parent: usize, handle: usize) -> Result<usize, Error> {
        if parent >= self.contexts.len() || handle >= self.graph.nodes.len() {
            return Err(error("Invalid template data scope"));
        }
        let id = self.contexts.len();
        self.contexts.push(Context {
            handle,
            parent: Some(parent),
        });
        Ok(id)
    }
    fn iterate(&mut self, handle: usize) -> Result<usize, Error> {
        if !matches!(self.graph.nodes.get(handle), Some(Node::Array { .. })) {
            return Err(error("Template data value is not an array"));
        }
        let id = self.iterators.len();
        self.iterators.push(Iterator { handle, index: 0 });
        Ok(id)
    }
    fn next(&mut self, iterator: usize) -> Result<Option<usize>, Error> {
        let cursor = self
            .iterators
            .get_mut(iterator)
            .ok_or_else(|| error("Invalid template data iterator"))?;
        let Node::Array { items, .. } = &self.graph.nodes[cursor.handle] else {
            unreachable!()
        };
        let value = items.get(cursor.index).copied();
        cursor.index += usize::from(value.is_some());
        Ok(value)
    }
    fn close(&mut self, iterator: usize) {
        if let Some(cursor) = self.iterators.get_mut(iterator)
            && let Node::Array { items, .. } = &self.graph.nodes[cursor.handle]
        {
            cursor.index = items.len();
        }
    }
    fn lambda(&mut self, _: usize, _: usize, _: &[u16], _: &[Vec<u16>]) -> Result<Vec<u16>, Error> {
        Err(error("Template data graph cannot contain lambdas"))
    }
}
/// Decode a flat little-endian graph with raw UTF-16 text, nonfinite numbers,
/// BigInt, undefined and references; no JSON conversion or hooks are involved.
pub fn decode(source: &[u8]) -> Result<Graph, Error> {
    struct Reader<'a> {
        source: &'a [u8],
        offset: usize,
    }
    impl Reader<'_> {
        fn bytes(&mut self, len: usize) -> Result<&[u8], Error> {
            let end = self
                .offset
                .checked_add(len)
                .ok_or_else(|| error("Invalid template snapshot length"))?;
            let value = self
                .source
                .get(self.offset..end)
                .ok_or_else(|| error("Truncated template snapshot"))?;
            self.offset = end;
            Ok(value)
        }
        fn count(&mut self) -> Result<usize, Error> {
            Ok(u32::from_le_bytes(self.bytes(4)?.try_into().unwrap()) as usize)
        }
        fn text(&mut self) -> Result<Vec<u16>, Error> {
            let count = self.count()?;
            let len = count
                .checked_mul(2)
                .ok_or_else(|| error("Invalid template snapshot text"))?;
            Ok(self
                .bytes(len)?
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| u16::from_le_bytes(*pair))
                .collect())
        }
        fn properties(&mut self) -> Result<Vec<(Vec<u16>, usize)>, Error> {
            let count = self.count()?;
            if count > (self.source.len() - self.offset) / 8 {
                return Err(error("Invalid template property count"));
            }
            (0..count)
                .map(|_| Ok((self.text()?, self.count()?)))
                .collect()
        }
    }
    let mut reader = Reader { source, offset: 0 };
    let root = reader.count()?;
    let count = reader.count()?;
    if count > source.len() - reader.offset {
        return Err(error("Invalid template data count"));
    }
    let mut nodes = Vec::with_capacity(count);
    for _ in 0..count {
        nodes.push(match reader.bytes(1)?[0] {
            0 => Node::Undefined,
            1 => Node::Null,
            2 => Node::Bool(false),
            3 => Node::Bool(true),
            4 => Node::Number(f64::from_le_bytes(reader.bytes(8)?.try_into().unwrap())),
            5 => Node::String(reader.text()?),
            6 => Node::BigInt(reader.text()?),
            7 => Node::Object(reader.properties()?),
            8 => {
                let properties = reader.properties()?;
                let count = reader.count()?;
                if count > (source.len() - reader.offset) / 4 {
                    return Err(error("Invalid template array count"));
                }
                Node::Array {
                    properties,
                    items: (0..count)
                        .map(|_| reader.count())
                        .collect::<Result<_, _>>()?,
                }
            }
            _ => return Err(error("Invalid template snapshot tag")),
        });
    }
    if reader.offset != source.len() {
        return Err(error("Trailing template snapshot data"));
    }
    let graph = Graph { nodes, root };
    graph.validate()?;
    Ok(graph)
}

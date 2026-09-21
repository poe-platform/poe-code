//! Own configuration composition over an adapted std-only YAML event scanner.
mod compose;
mod scalar;
mod stringify;
pub use stringify::{Graph, GraphNode, stringify, stringify_graph};
mod syntax;
use crate::value::Value;
use std::collections::HashMap;
use syntax::parser::{Event, Parser};
use syntax::scanner::Marker;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub reason: String,
    pub offset: usize,
    pub line: usize,
    pub column: usize,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} at line {} column {}",
            self.reason, self.line, self.column
        )
    }
}
impl std::error::Error for Error {}
/// Date IDs follow depth-first value traversal and identify aliases within this document.
#[derive(Clone, Debug, PartialEq)]
pub struct Parsed {
    pub value: Value,
    pub date_ids: Vec<usize>,
    pub symbol_ids: Vec<usize>,
}
fn error(reason: impl Into<String>, mark: Marker) -> Error {
    Error {
        reason: reason.into(),
        offset: mark.index(),
        line: mark.line(),
        column: mark.col() + 1,
    }
}
fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
enum Node {
    Scalar(Value),
    Sequence(Vec<usize>),
    Mapping(Vec<usize>),
    Alias(usize),
}
struct Entry {
    node: Node,
    mark: Marker,
    style: Option<syntax::scanner::TScalarStyle>,
    tag: Option<Vec<u16>>,
    merge: bool,
    text: Option<Vec<u16>>,
    alias_name: Option<Vec<u16>>,
}
fn check_aliases(nodes: &[Entry]) -> Result<(), Error> {
    enum Task {
        Visit(usize),
        Collection(usize),
    }
    let mut counts = vec![1usize; nodes.len()];
    let mut weights = vec![0usize; nodes.len()];
    for entry in nodes {
        let Node::Alias(target) = entry.node else {
            continue;
        };
        counts[target] = counts[target].saturating_add(1);
        if weights[target] == 0 {
            let mut tasks = vec![Task::Visit(target)];
            let mut values = vec![];
            while let Some(task) = tasks.pop() {
                match task {
                    Task::Visit(id) => match &nodes[id].node {
                        Node::Scalar(_) => values.push(1),
                        Node::Alias(target) => {
                            values.push(counts[*target].saturating_mul(weights[*target]))
                        }
                        Node::Sequence(items) | Node::Mapping(items) => {
                            tasks.push(Task::Collection(items.len()));
                            for id in items.iter().rev() {
                                tasks.push(Task::Visit(*id));
                            }
                        }
                    },
                    Task::Collection(count) => {
                        let start = values.len() - count;
                        let weight = values.drain(start..).max().unwrap_or(0);
                        values.push(weight);
                    }
                }
            }
            weights[target] = values.pop().unwrap_or(0);
        }
        if counts[target].saturating_mul(weights[target]) > 100 {
            return Err(error(
                "Excessive alias count indicates a resource exhaustion attack",
                entry.mark,
            ));
        }
    }
    Ok(())
}
/// Supply the host's Date property-key coercion when interoperating with JS values.
pub fn parse(
    source: &[u16],
    date_key: Option<&mut dyn FnMut(i64) -> Vec<u16>>,
) -> Result<Parsed, Error> {
    parse_with_options(source, date_key, ParseOptions::default())
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParseOptions {
    pub unique_keys: bool,
    pub object_root: bool,
}
impl Default for ParseOptions {
    fn default() -> Self {
        Self {
            unique_keys: true,
            object_root: true,
        }
    }
}
/// Frontmatter admits duplicate keys and applies its own root-kind diagnostics.
pub fn parse_with_options(
    source: &[u16],
    date_key: Option<&mut dyn FnMut(i64) -> Vec<u16>>,
    options: ParseOptions,
) -> Result<Parsed, Error> {
    if source.iter().all(|ch| crate::jsonc::trim_space(*ch)) {
        return Ok(Parsed {
            value: if options.object_root {
                Value::Object(vec![])
            } else {
                Value::Null
            },
            date_ids: vec![],
            symbol_ids: vec![],
        });
    }
    let mut parser = Parser::new(source.iter().copied());
    let mut nodes: Vec<Entry> = vec![];
    let mut parents: Vec<usize> = vec![];
    let mut anchors = HashMap::new();
    let mut root = None;
    let mut documents = 0;
    loop {
        let (event, mark) = parser
            .next_token()
            .map_err(|e| error(e.info(), *e.marker()))?;
        let (style, tag) = match &event {
            Event::Scalar(_, style, _, tag) => (Some(*style), tag.as_ref()),
            Event::SequenceStart(_, tag) | Event::MappingStart(_, tag) => (None, tag.as_ref()),
            _ => (None, None),
        };
        let tag = tag.map(|tag| {
            let mut text = tag.handle.clone();
            text.extend_from_slice(&tag.suffix);
            text
        });
        let merge = tag.as_deref().is_some_and(|tag| {
            tag.iter()
                .copied()
                .eq("tag:yaml.org,2002:merge".encode_utf16())
        }) || parser.version == (1, 1)
            && matches!(&event,Event::Scalar(text,syntax::scanner::TScalarStyle::Plain,_,None) if text==&[60,60]);
        let text = match &event {
            Event::Scalar(text, _, _, _) => Some(text.clone()),
            _ => None,
        };
        let alias_name = match &event {
            Event::Alias(anchor) => parser.anchor_names.get(anchor).cloned(),
            _ => None,
        };
        let (node, anchor, container) = match event {
            Event::StreamStart | Event::DocumentEnd | Event::Nothing => continue,
            Event::StreamEnd => break,
            Event::DocumentStart => {
                documents += 1;
                if documents > 1 {
                    return Err(error(
                        "Source contains multiple documents; please use YAML.parseAllDocuments()",
                        mark,
                    ));
                }
                continue;
            }
            Event::SequenceEnd | Event::MappingEnd => {
                parents.pop();
                continue;
            }
            Event::Scalar(text, style, anchor, tag) => (
                Node::Scalar(match String::from_utf16(&text) {
                    Ok(text) => {
                        scalar::resolve(&text, style, tag.as_ref(), mark, parser.version == (1, 1))?
                    }
                    Err(_) => Value::String(text),
                }),
                anchor,
                false,
            ),
            Event::SequenceStart(anchor, _) => (Node::Sequence(vec![]), anchor, true),
            Event::MappingStart(anchor, _) => (Node::Mapping(vec![]), anchor, true),
            Event::Alias(anchor) => (
                Node::Alias(
                    *anchors
                        .get(&anchor)
                        .ok_or_else(|| error("Unresolved alias", mark))?,
                ),
                0,
                false,
            ),
        };
        let id = nodes.len();
        nodes.push(Entry {
            node,
            mark,
            style,
            tag,
            merge,
            text,
            alias_name,
        });
        if anchor != 0 {
            anchors.insert(anchor, id);
        }
        if let Some(parent) = parents.last() {
            match &mut nodes[*parent].node {
                Node::Sequence(items) | Node::Mapping(items) => items.push(id),
                _ => unreachable!(),
            }
        } else {
            root = Some(id);
        }
        if container {
            if parents.len() >= 512 {
                return Err(error("Maximum configuration depth exceeded", mark));
            }
            parents.push(id);
        }
    }
    check_aliases(&nodes)?;
    let (value, date_ids, symbol_ids) = if let Some(root) = root {
        compose::configuration(&nodes, root, date_key, options.unique_keys)?
    } else {
        (Value::Null, vec![], vec![])
    };
    match value {
        Value::Null if options.object_root => Ok(Parsed {
            value: Value::Object(vec![]),
            date_ids,
            symbol_ids,
        }),
        value if !options.object_root || matches!(value, Value::Object(_)) => Ok(Parsed {
            value,
            date_ids,
            symbol_ids,
        }),
        _ => Err(Error {
            reason: "Expected YAML object.".into(),
            offset: 0,
            line: 1,
            column: 1,
        }),
    }
}
pub mod document;

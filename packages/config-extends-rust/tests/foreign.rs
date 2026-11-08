use config_extends_rust::foreign::{Error, Host, Kind, Layer, merge_layers};
use std::collections::HashMap;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[derive(Clone, Debug)]
enum Node {
    Undefined,
    Null,
    Text(Vec<u16>),
    Plain(Vec<(Vec<u16>, usize)>),
    Opaque,
}
#[derive(Default)]
struct Graph {
    nodes: Vec<Node>,
    iterators: HashMap<usize, (Vec<usize>, usize)>,
    next: usize,
    reads: Vec<Vec<u16>>,
}
impl Graph {
    fn add(&mut self, node: Node) -> usize {
        let id = self.nodes.len();
        self.nodes.push(node);
        id
    }
}
impl Host for Graph {
    type Value = usize;
    type Iterator = usize;
    type Error = &'static str;
    fn layer_data(&mut self, _layer: usize) -> Result<usize, Self::Error> {
        unreachable!("Static test layers")
    }
    fn layer_source(&mut self, _layer: usize) -> Result<Vec<u16>, Self::Error> {
        unreachable!("Static test layers")
    }
    fn kind(&mut self, value: usize) -> Result<Kind, Self::Error> {
        Ok(match &self.nodes[value] {
            Node::Undefined => Kind::Undefined,
            Node::Null => Kind::Null,
            Node::Text(text) if text.is_empty() => Kind::EmptyString,
            _ => Kind::Other,
        })
    }
    fn is_plain(&mut self, value: usize) -> Result<bool, Self::Error> {
        Ok(matches!(self.nodes[value], Node::Plain(_)))
    }
    fn is_array(&mut self, _value: usize) -> Result<bool, Self::Error> {
        Ok(false)
    }
    fn keys(&mut self, value: usize) -> Result<Vec<Vec<u16>>, Self::Error> {
        let Node::Plain(fields) = &self.nodes[value] else {
            return Err("not plain");
        };
        Ok(fields.iter().map(|(key, _)| key.clone()).collect())
    }
    fn own(&mut self, value: usize, key: &[u16]) -> Result<usize, Self::Error> {
        self.reads.push(key.to_vec());
        let Node::Plain(fields) = &self.nodes[value] else {
            return Err("not plain");
        };
        Ok(fields
            .iter()
            .find(|(field, _)| field == key)
            .map_or(0, |(_, value)| *value))
    }
    fn entries(&mut self, value: usize) -> Result<Vec<(Vec<u16>, usize)>, Self::Error> {
        let Node::Plain(fields) = &self.nodes[value] else {
            return Err("not plain");
        };
        Ok(fields.clone())
    }
    fn sequence(&mut self, value: usize, _array: bool) -> Result<usize, Self::Error> {
        let Node::Plain(fields) = &self.nodes[value] else {
            return Err("not plain");
        };
        let values = fields.iter().map(|(_, value)| *value).collect();
        let id = self.next;
        self.next += 1;
        self.iterators.insert(id, (values, 0));
        Ok(id)
    }
    fn next(&mut self, iterator: usize) -> Result<Option<usize>, Self::Error> {
        let (values, index) = self.iterators.get_mut(&iterator).unwrap();
        let result = values.get(*index).copied();
        *index += 1;
        Ok(result)
    }
    fn close(&mut self, iterator: usize, _abrupt: bool) {
        self.iterators.remove(&iterator);
    }
    fn create(&mut self, _prototype: Option<usize>) -> Result<usize, Self::Error> {
        Ok(self.add(Node::Plain(vec![])))
    }
    fn define(&mut self, object: usize, key: &[u16], value: usize) -> Result<(), Self::Error> {
        let Node::Plain(fields) = &mut self.nodes[object] else {
            return Err("not plain");
        };
        fields.push((key.to_vec(), value));
        Ok(())
    }
    fn map(&mut self, _array: usize, _depth: usize) -> Result<usize, Self::Error> {
        unreachable!()
    }
}

#[test]
fn nested_value_resolution_finishes_before_reading_the_next_sibling() {
    let mut graph = Graph::default();
    graph.add(Node::Undefined);
    let text = graph.add(Node::Text(u("leaf")));
    let child = graph.add(Node::Plain(vec![(u("x"), text)]));
    let root = graph.add(Node::Plain(vec![(u("a"), child), (u("b"), text)]));
    merge_layers(
        &[Layer::Static {
            source: u("root"),
            data: root,
        }],
        &mut graph,
    )
    .unwrap();
    assert_eq!(graph.reads, [u("a"), u("x"), u("b")]);
}
#[test]
fn host_merge_keeps_opaque_identity_and_records_nested_provenance() {
    let mut graph = Graph::default();
    graph.add(Node::Undefined);
    let opaque = graph.add(Node::Opaque);
    let text = graph.add(Node::Text(u("lower")));
    let high = graph.add(Node::Plain(vec![(u("opaque"), opaque)]));
    let low = graph.add(Node::Plain(vec![(u("extra"), text)]));
    let result = merge_layers(
        &[
            Layer::Static {
                source: u("high"),
                data: high,
            },
            Layer::Static {
                source: u("low"),
                data: low,
            },
        ],
        &mut graph,
    )
    .unwrap();
    assert_eq!(graph.own(result.data, &u("opaque")).unwrap(), opaque);
    assert_eq!(
        result.sources,
        vec![(u("opaque"), u("high")), (u("extra"), u("low"))]
    );
}
#[test]
fn host_merge_detects_cycles_and_prunes_nulls_and_empty_prompts() {
    let mut graph = Graph::default();
    graph.add(Node::Undefined);
    let null = graph.add(Node::Null);
    let empty = graph.add(Node::Text(vec![]));
    let high = graph.add(Node::Plain(vec![(u("remove"), null), (u("prompt"), empty)]));
    let text = graph.add(Node::Text(u("inherited")));
    let low = graph.add(Node::Plain(vec![(u("remove"), text), (u("prompt"), text)]));
    let result = merge_layers(
        &[
            Layer::Static {
                source: u("high"),
                data: high,
            },
            Layer::Static {
                source: u("low"),
                data: low,
            },
        ],
        &mut graph,
    )
    .unwrap();
    assert_eq!(graph.own(result.data, &u("remove")).unwrap(), 0);
    assert_eq!(graph.own(result.data, &u("prompt")).unwrap(), text);
    let cycle = graph.add(Node::Plain(vec![]));
    graph.define(cycle, &u("self"), cycle).unwrap();
    assert_eq!(
        merge_layers(
            &[Layer::Static {
                source: u("cycle"),
                data: cycle
            }],
            &mut graph
        )
        .unwrap_err(),
        Error::Policy("Cyclic config data is not supported.")
    );
    assert!(graph.iterators.is_empty());
}

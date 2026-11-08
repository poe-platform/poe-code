use config_mutations_rust::value::Value;
use poe_code_config_rust::owned::{Field, Graph, Node};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn field(key: &str, value: usize, enumerable: bool) -> Field {
    Field {
        key: u(key),
        value,
        enumerable,
    }
}
#[test]
fn borrowed_runtime_branches_keep_original_handles() {
    let graph = Graph {
        nodes: vec![
            Node::Undefined,
            Node::Other,
            Node::Record(vec![field("A", 1, true)]),
            Node::Record(vec![field("args", 2, true)]),
            Node::Record(vec![field("runtime", 3, true)]),
            Node::Record(vec![]),
        ],
    };
    assert_eq!(
        graph.merge(4, 5).unwrap(),
        Value::Object(vec![(
            u("runtime"),
            Value::Object(vec![(u("args"), Value::Unsupported(u("2")))])
        )])
    );
}
#[test]
fn nonenumerable_own_values_can_participate_when_other_layer_enumerates() {
    let graph = Graph {
        nodes: vec![
            Node::Undefined,
            Node::Other,
            Node::Other,
            Node::Record(vec![field("A", 1, false)]),
            Node::Record(vec![field("B", 2, true), field("A", 0, true)]),
            Node::Record(vec![field("args", 3, true)]),
            Node::Record(vec![field("args", 4, true)]),
            Node::Record(vec![field("runtime", 5, true)]),
            Node::Record(vec![field("runtime", 6, true)]),
        ],
    };
    assert_eq!(
        graph.merge(7, 8).unwrap(),
        Value::Object(vec![(
            u("runtime"),
            Value::Object(vec![(
                u("args"),
                Value::Object(vec![
                    (u("B"), Value::Unsupported(u("2"))),
                    (u("A"), Value::Unsupported(u("1")))
                ])
            )])
        )])
    );
}
#[test]
fn shared_cycles_do_not_escape_recursion_budget() {
    let graph = Graph {
        nodes: vec![
            Node::Undefined,
            Node::Record(vec![field("self", 1, true)]),
            Node::Record(vec![field("runtime", 1, true)]),
        ],
    };
    assert_eq!(
        graph.merge(2, 2),
        Err("Config runtime merge depth exceeded (512).")
    );
}

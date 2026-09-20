use config_mutations_rust::{value::Value, yaml};
fn parse(source: &str) -> Value {
    yaml::parse(&source.encode_utf16().collect::<Vec<_>>(), None)
        .unwrap()
        .value
}
#[test]
fn block_maps_and_sequences_parse_nested_configuration() {
    let value = parse(
        "extensions:\n  terminal:\n    enabled: true\n    cmd: node\n    args:\n      - server.mjs\n      - --stdio\n",
    );
    assert_eq!(
        value
            .get("extensions")
            .unwrap()
            .get("terminal")
            .unwrap()
            .get("enabled"),
        Some(&Value::Bool(true))
    );
}
#[test]
fn quoted_flow_and_multiline_values_preserve_content() {
    let value = parse(
        "flow: {args: [one, 'two', \"three\"], empty: {}}\nliteral: |-\n  one\n  two\nfolded: >-\n  one\n  two\n",
    );
    assert_eq!(
        value.get("literal"),
        Some(&Value::String("one\ntwo".encode_utf16().collect()))
    );
    assert_eq!(
        value.get("folded"),
        Some(&Value::String("one two".encode_utf16().collect()))
    );
}
#[test]
fn scalars_follow_yaml_core_schema_instead_of_toml_rules() {
    let value = parse(
        "yes: yes\nleading: 001\noctal: 0o17\nhex: 0xFF\nnan: .NaN\n'null': ~\nboolean: FALSE\nfloat: 1e+3\ndate: 2026-08-26\n",
    );
    assert_eq!(
        value.get("yes"),
        Some(&Value::String("yes".encode_utf16().collect()))
    );
    assert_eq!(value.get("leading"), Some(&Value::Number(1.0)));
    assert_eq!(value.get("octal"), Some(&Value::Number(15.0)));
    assert_eq!(value.get("null"), Some(&Value::Null));
    assert_eq!(
        value.get("date"),
        Some(&Value::String("2026-08-26".encode_utf16().collect()))
    );
}
#[test]
fn aliases_expand_safely_and_duplicate_keys_reject() {
    let value = parse("defaults: &defaults {enabled: true}\nserver: *defaults\n");
    assert_eq!(value.get("defaults"), value.get("server"));
    assert!(
        yaml::parse(
            &"key: one\nkey: two\n".encode_utf16().collect::<Vec<_>>(),
            None
        )
        .is_err()
    );
}
#[test]
fn literal_and_escaped_utf16_surrogates_match_host_strings() {
    let mut source: Vec<_> = "key: '".encode_utf16().collect();
    source.extend([0xD800, 39]);
    assert_eq!(
        yaml::parse(&source, None).unwrap().value.get("key"),
        Some(&Value::String(vec![0xD800]))
    );
    assert_eq!(
        parse("key: \"\\uD800\"").get("key"),
        Some(&Value::String(vec![0xD800]))
    );
    assert_eq!(
        parse("key: \"\\U0001F980\"").get("key"),
        Some(&Value::String(vec![0xD83E, 0xDD80]))
    );
}
#[test]
fn alias_admission_bounds_expansion_before_cloning_large_values() {
    let source = |count| format!("a: &a text\nitems: [{}]\n", vec!["*a"; count].join(", "));
    assert!(yaml::parse(&source(99).encode_utf16().collect::<Vec<_>>(), None).is_ok());
    assert!(yaml::parse(&source(100).encode_utf16().collect::<Vec<_>>(), None).is_err());
    let source = format!(
        "a: &a [text]\nb: &b [{}]\nc: [{}]\n",
        ["*a"; 10].join(", "),
        ["*b"; 10].join(", ")
    );
    assert!(yaml::parse(&source.encode_utf16().collect::<Vec<_>>(), None).is_err());
    assert!(yaml::parse(&"a: &a [*a]".encode_utf16().collect::<Vec<_>>(), None).is_err());
}
#[test]
fn admitted_literal_depth_uses_explicit_parser_and_composition_stacks() {
    let source = |depth| format!("key: {}1{}", "[".repeat(depth), "]".repeat(depth));
    let value = yaml::parse(&source(511).encode_utf16().collect::<Vec<_>>(), None)
        .unwrap()
        .value;
    let mut current = value.get("key").unwrap();
    for _ in 0..511 {
        let Value::Array(items) = current else {
            panic!("missing array")
        };
        current = &items[0];
    }
    assert_eq!(current, &Value::Number(1.0));
    assert!(yaml::parse(&source(512).encode_utf16().collect::<Vec<_>>(), None).is_err());
}
#[test]
fn date_alias_metadata_preserves_identity_without_coalescing_equal_dates() {
    let source = "first: &date !!timestamp 2026-08-26T12:34:56Z\nsecond: *date\nthird: !!timestamp 2026-08-26T12:34:56Z\n";
    let parsed = yaml::parse(&source.encode_utf16().collect::<Vec<_>>(), None).unwrap();
    assert_eq!(parsed.date_ids.len(), 3);
    assert_eq!(parsed.date_ids[0], parsed.date_ids[1]);
    assert_ne!(parsed.date_ids[0], parsed.date_ids[2]);
}
#[test]
fn serializer_renders_nested_configuration_and_multiline_strings() {
    let value = parse(
        "extensions:\n  terminal:\n    enabled: true\n    args: [one, two]\ntext: 'null'\nscript: |-\n  echo one\n  echo two\n",
    );
    let actual = yaml::stringify(&value).unwrap();
    assert_eq!(
        String::from_utf16(&actual).unwrap(),
        "extensions:\n  terminal:\n    enabled: true\n    args:\n      - one\n      - two\ntext: \"null\"\nscript: |-\n  echo one\n  echo two\n"
    );
}

#[test]
fn serializer_graph_keeps_shared_and_circular_object_anchors() {
    use yaml::{Graph, GraphNode};
    let graph = Graph {
        root: 0,
        nodes: vec![
            GraphNode::Mapping(vec![(1, 2), (3, 4)]),
            GraphNode::Scalar(Value::String("first".encode_utf16().collect())),
            GraphNode::Mapping(vec![(5, 6)]),
            GraphNode::Scalar(Value::String("second".encode_utf16().collect())),
            GraphNode::Alias(2),
            GraphNode::Scalar(Value::String("self".encode_utf16().collect())),
            GraphNode::Alias(2),
        ],
        anchors: vec![
            None,
            None,
            Some("a1".encode_utf16().collect()),
            None,
            None,
            None,
            None,
        ],
    };
    assert_eq!(
        String::from_utf16(&yaml::stringify_graph(&graph).unwrap()).unwrap(),
        "first: &a1\n  self: *a1\nsecond: *a1\n"
    );
    let graph = Graph {
        root: 0,
        nodes: vec![
            GraphNode::Mapping(vec![(1, 4)]),
            GraphNode::Sequence(vec![2, 3]),
            GraphNode::Scalar(Value::String("one".encode_utf16().collect())),
            GraphNode::Scalar(Value::String("two".encode_utf16().collect())),
            GraphNode::Scalar(Value::Number(3.0)),
        ],
        anchors: vec![None; 5],
    };
    assert_eq!(
        String::from_utf16(&yaml::stringify_graph(&graph).unwrap()).unwrap(),
        "? - one\n  - two\n: 3\n"
    );
}
#[test]
fn serializer_rejects_unresolved_and_forward_alias_snapshots() {
    use yaml::{Graph, GraphNode};
    let missing = Graph {
        root: 0,
        nodes: vec![GraphNode::Alias(1)],
        anchors: vec![None],
    };
    assert!(yaml::stringify_graph(&missing).is_err());
    let future = Graph {
        root: 0,
        nodes: vec![
            GraphNode::Sequence(vec![1, 2]),
            GraphNode::Alias(2),
            GraphNode::Scalar(Value::Number(1.0)),
        ],
        anchors: vec![None, None, Some("a1".encode_utf16().collect())],
    };
    assert!(yaml::stringify_graph(&future).is_err());
    let cycle = Graph {
        root: 0,
        nodes: vec![GraphNode::Sequence(vec![0])],
        anchors: vec![None],
    };
    assert!(yaml::stringify_graph(&cycle).is_err());
}

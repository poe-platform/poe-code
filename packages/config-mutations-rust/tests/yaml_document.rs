use config_mutations_rust::yaml::document::{Kind, scan};
fn text(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn block_maps_keep_key_value_offsets_and_comments() {
    let source = text(
        "# store\nlists:\n  work:\n    # task\n    ship:\n      name: 'Ship it' # inline\n      state: draft\n",
    );
    let document = scan(&source).unwrap();
    let root = &document.nodes[document.root];
    assert_eq!(root.kind, Kind::Mapping);
    assert_eq!(root.children.len(), 2);
    let key = &document.nodes[root.children[0]];
    assert_eq!(key.text, text("lists"));
    assert_eq!(&source[key.start..key.start + 5], text("lists"));
    let list = &document.nodes[root.children[1]];
    assert_eq!(list.kind, Kind::Mapping);
    let work = &document.nodes[list.children[1]];
    let task = &document.nodes[work.children[1]];
    let name = &document.nodes[task.children[0]];
    let value = &document.nodes[task.children[1]];
    assert_eq!(name.text, text("name"));
    assert!(value.quoted);
    assert_eq!(value.text, text("Ship it"));
    assert_eq!(root.end, source.len());
}
#[test]
fn flow_sequences_aliases_and_utf16_offsets_remain_distinct() {
    let source = text(
        "lists: {work: {ship: &task {name: A, state: draft}}}\ncopy: *task\nvalues: [one, two]\n",
    );
    let document = scan(&source).unwrap();
    assert!(document.nodes.iter().any(|n| n.kind == Kind::Alias));
    assert!(document.nodes.iter().any(|n| n.kind == Kind::Sequence));
    assert!(document.nodes.iter().any(|n| n.flow));
    let surrogate = [text("name: \""), vec![0xd800], text("\"\n")].concat();
    let doc = scan(&surrogate).unwrap();
    assert_eq!(
        doc.nodes[doc.nodes[doc.root].children[1]].text,
        vec![0xd800]
    );
}
#[test]
fn invalid_input_and_multiple_documents_are_rejected() {
    assert!(scan(&text("lists: [unterminated")).is_err());
    assert!(scan(&text("a: 1\n---\nb: 2\n")).is_err());
}
#[test]
fn block_collection_end_at_eof_includes_the_final_line() {
    let source = text("lists:\n  work:\n    ship:\n      name: A");
    let document = scan(&source).unwrap();
    for node in &document.nodes {
        if node.kind == Kind::Mapping {
            assert_eq!(node.end, source.len());
        }
    }
}
#[test]
fn scalar_types_respect_quoting_tags_and_document_schema() {
    use config_mutations_rust::value::Value;
    let document = scan(&text("values: {1: A, \"2\": B, true: C}\n")).unwrap();
    let values = &document.nodes[document.nodes[document.root].children[1]];
    assert_eq!(
        document.nodes[values.children[0]].scalar,
        Some(Value::Number(1.0))
    );
    assert_eq!(document.nodes[values.children[2]].scalar, None);
    assert_eq!(
        document.nodes[values.children[4]].scalar,
        Some(Value::Bool(true))
    );
    let document = scan(&text("%YAML 1.1\n---\nyes: A\n!!str 1: B\n")).unwrap();
    let root = &document.nodes[document.root];
    assert_eq!(
        document.nodes[root.children[0]].scalar,
        Some(Value::Bool(true))
    );
    assert_eq!(document.nodes[root.children[2]].scalar, None);
}
#[test]
fn syntax_nesting_budget_rejects_before_unbounded_tree_growth() {
    let source = format!("{}x{}", "[".repeat(513), "]".repeat(513));
    assert!(
        scan(&text(&source))
            .unwrap_err()
            .reason
            .contains("syntax budget")
    );
}

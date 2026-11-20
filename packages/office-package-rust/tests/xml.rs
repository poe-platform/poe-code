use office_package_rust::xml::{self, Node, Parser};

#[test]
fn strict_xml_rejects_truncated_namespaces_entities_and_invalid_characters() {
    for source in [
        "<w:document/>",
        "<document><paragraph></document>",
        "<document>&undeclared;</document>",
        "<document>&#x110000;</document>",
        "<document>\0</document>",
        "<!DOCTYPE document [<!ENTITY external SYSTEM 'file:///unread'>]><document>&external;</document>",
    ] {
        assert!(
            xml::parse(source, None, None).is_err(),
            "accepted {source:?}"
        );
    }
}

#[test]
fn streaming_xml_preserves_split_entities_and_namespace_scope() {
    let mut parser = Parser::new(None, None, true);
    for chunk in [
        "<w:doc",
        "ument xmlns:w='urn:word'><w:p>A &a",
        "mp; B</w:p></w:doc",
        "ument>",
    ] {
        parser.feed(chunk).unwrap();
    }
    let document = parser.finish().unwrap();
    let Node::Element(root) = &document.nodes[0] else {
        panic!("missing document root")
    };
    assert_eq!(root.tag, "w:document");
    let Node::Element(paragraph) = &root.children[0] else {
        panic!("missing paragraph")
    };
    let text: String = paragraph
        .children
        .iter()
        .filter_map(|node| match node {
            Node::Text(text, _) => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(text, "A & B");
}

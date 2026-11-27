use document_converter_rust::html::dom::{HtmlNode, bounded_html_dom, parse_html_dom};

#[test]
fn rcdata_decodes_entities_while_raw_text_keeps_them_literal() {
    for (tag, expected) in [
        ("textarea", "one <b>literal</b> & two"),
        ("title", "one <b>literal</b> & two"),
        ("script", "one <b>literal</b> &amp; two"),
        ("style", "one <b>literal</b> &amp; two"),
    ] {
        let source = format!("<{tag}>one <b>literal</b> &amp; two</{tag}>");
        for nodes in [parse_html_dom(&source), bounded_html_dom(&source).unwrap()] {
            let [HtmlNode::Element(element)] = nodes.as_slice() else {
                panic!("expected a {tag} element");
            };
            assert!(
                matches!(element.children.as_slice(), [HtmlNode::Text(text)] if text == expected),
                "{source}: {element:?}"
            );
        }
    }
}

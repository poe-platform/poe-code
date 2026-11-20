use document_converter_rust::html::{
    dom::{HtmlNode, parse_html_dom},
    html_tokens,
};

#[test]
fn html_slashes_belong_to_unquoted_values_but_close_quoted_attributes() {
    for (source, value) in [
        ("<span a=x/>x</span>", "x/"),
        (r#"<span a="x"/>x</span>"#, "x"),
        ("<span a=x />x</span>", "x"),
        ("<div data-x=a/>text</div>", "a/"),
    ] {
        let nodes = parse_html_dom(source);
        let HtmlNode::Element(element) = &nodes[0] else {
            panic!("element missing")
        };
        assert_eq!(element.attrs[0].1, value, "{source}");
        assert!(
            matches!(&element.children[..], [HtmlNode::Text(_)]),
            "{source}: {nodes:?}"
        );
    }
}

#[test]
fn html_nonvoid_selfclosing_syntax_keeps_children_but_raw_admission_stays_strict() {
    for source in ["<div/>a", "<div />a", "<span/>x</span>"] {
        let nodes = parse_html_dom(source);
        assert_eq!(nodes.len(), 1, "{source}: {nodes:?}");
        let HtmlNode::Element(element) = &nodes[0] else {
            panic!("element missing")
        };
        assert!(
            matches!(&element.children[..], [HtmlNode::Text(_)]),
            "{source}: {nodes:?}"
        );
        assert!(html_tokens(source).is_err(), "raw HTML accepted {source}");
    }
    let nodes = parse_html_dom("<br/>a");
    assert!(
        matches!(&nodes[..], [HtmlNode::Element(element), HtmlNode::Text(_)] if element.children.is_empty())
    );
    assert!(html_tokens("<span title=x/>a</span>").is_ok());
}

#[test]
fn svg_selfclosing_elements_leave_following_siblings_outside_the_diagram() {
    for source in [
        "<svg><rect/><text>Label</text><circle/></svg><p>After diagram</p>",
        "<svg/><p>After diagram</p>",
    ] {
        let nodes = parse_html_dom(source);
        let [HtmlNode::Element(svg), HtmlNode::Element(paragraph)] = nodes.as_slice() else {
            panic!("following paragraph swallowed: {nodes:?}");
        };
        assert_eq!(svg.tag, "svg");
        assert_eq!(paragraph.tag, "p");
        assert!(matches!(&paragraph.children[..], [HtmlNode::Text(t)] if t == "After diagram"));
        if !svg.children.is_empty() {
            let [
                HtmlNode::Element(rect),
                HtmlNode::Element(text),
                HtmlNode::Element(circle),
            ] = svg.children.as_slice()
            else {
                panic!("SVG siblings nested incorrectly: {svg:?}");
            };
            assert!(rect.children.is_empty());
            assert!(circle.children.is_empty());
            assert_eq!(text.tag, "text");
        }
    }
}

#[test]
fn svg_html_integration_points_keep_html_slashes_and_reenter_nested_svg() {
    for integration in ["foreignObject", "desc", "title"] {
        let source = format!(
            "<svg><{integration}><div/>HTML</div><svg><rect/><text>Inner</text></svg><p>After inner</p></{integration}><circle/></svg><p>After outer</p>"
        );
        let nodes = parse_html_dom(&source);
        let [HtmlNode::Element(svg), HtmlNode::Element(after)] = nodes.as_slice() else {
            panic!("outer siblings: {nodes:?}");
        };
        assert_eq!(after.tag, "p");
        let [HtmlNode::Element(integration), HtmlNode::Element(circle)] = svg.children.as_slice()
        else {
            panic!("SVG siblings: {svg:?}");
        };
        assert!(circle.children.is_empty());
        let [
            HtmlNode::Element(div),
            HtmlNode::Element(inner),
            HtmlNode::Element(paragraph),
        ] = integration.children.as_slice()
        else {
            panic!("integration children: {integration:?}");
        };
        assert!(matches!(&div.children[..], [HtmlNode::Text(t)] if t == "HTML"));
        assert_eq!(paragraph.tag, "p");
        assert!(
            matches!(&inner.children[..], [HtmlNode::Element(rect), HtmlNode::Element(text)] if rect.children.is_empty() && text.tag == "text")
        );
    }
}

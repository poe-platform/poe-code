use terminal_png_rust::xml::{Node, parse};
#[test]
fn xml_quotes_entities_cdata_and_matching_tags() {
    let root=parse("<?xml version='1.0'?><svg width='5' height=\"4\"><!--x--><text>A&amp;&#x41;<![CDATA[<B>]]></text></svg>").unwrap();
    assert_eq!(root.name, "svg");
    assert_eq!(root.attribute("width"), Some("5"));
    let Node::Element(text) = &root.children[0] else {
        panic!()
    };
    assert_eq!(text.text(), "A&A<B>");
    for input in [
        "<svg><g></svg>",
        "<svg width='1' width='2'/>",
        "<!DOCTYPE svg SYSTEM 'https://external'><svg/>",
        "<svg>&unknown;</svg>",
        "<svg/><svg/>",
    ] {
        assert!(parse(input).is_err(), "{input}");
    }
}
#[test]
fn xml_depth_and_entities_are_bounded() {
    assert!(
        parse(&format!(
            "<svg>{}{}</svg>",
            "<g>".repeat(100),
            "</g>".repeat(100)
        ))
        .is_err()
    );
    assert!(parse("<svg>&#x110000;</svg>").is_err());
}

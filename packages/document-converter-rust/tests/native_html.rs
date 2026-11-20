use document_ast_rust::{Block, Inline};
use document_converter_rust::{Format, html, map_pandoc};
use mcp_protocol_rust::json;
use pdf_ast_rust::PdfOptions;
use std::collections::BTreeMap;

#[test]
fn native_html_entry_points_do_not_require_the_shell_runtime() {
    let document = html::from_html("<p ID='here'><b>bold</b> &eacute;</p>").unwrap();
    let Block::Paragraph(paragraph) = &document.blocks[0] else {
        panic!()
    };
    assert_eq!(paragraph.id, "here");
    assert!(
        matches!(&paragraph.inlines[0], Inline::Text { text, style } if text == "bold" && style.bold)
    );
    let nodes = html::dom::parse_html_dom("<table><tr><td>A</td></tr></table>");
    let html::dom::HtmlNode::Element(table) = &nodes[0] else {
        panic!()
    };
    assert!(
        matches!(&table.children[0], html::dom::HtmlNode::Element(body) if body.tag == "tbody" && body.implicit)
    );
    assert!(html::dom::is_void_html_tag("img"));
}

#[test]
fn native_mapper_accepts_the_existing_json_value_and_resource_map_directly() {
    let input = json::parse(br##"{"metadata":{},"blocks":[{"t":"Para","c":[{"t":"RawInline","c":["html","<strong>"]},{"t":"Str","c":"Native"},{"t":"RawInline","c":["html","</strong>"]}]}]}"##, Default::default()).unwrap();
    let mut options = PdfOptions::default();
    let mut diagnostics = Vec::new();
    let document = document_ast_rust::cooperate::block_on(map_pandoc(
        &input,
        Format::Docx,
        &BTreeMap::new(),
        &mut options,
        false,
        None,
        &mut diagnostics,
    ))
    .unwrap();
    let Block::Paragraph(paragraph) = &document.blocks[0] else {
        panic!()
    };
    assert!(
        matches!(&paragraph.inlines[0], Inline::Text { text, style } if text == "Native" && style.bold)
    );
    assert!(diagnostics.is_empty());
}

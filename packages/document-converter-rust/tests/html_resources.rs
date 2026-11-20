use document_ast_rust::{Block, Inline};
use document_converter_rust::html;
use std::collections::BTreeMap;

const PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
#[test]
fn embedded_html_images_keep_existing_api_and_budget_repeated_decoding() {
    let html = format!("<p><img src='data:image/png;base64,{PNG}'></p>");
    let document = html::from_html(&html).unwrap();
    let Block::Paragraph(p) = &document.blocks[0] else {
        panic!()
    };
    let Inline::Image(image) = &p.inlines[0] else {
        panic!()
    };
    let bytes = image.bytes.len();
    let nodes = html::dom::bounded_html_dom(&html.repeat(3)).unwrap();
    let error = html::from_html_nodes(&nodes, &BTreeMap::new(), 100, bytes * 2).unwrap_err();
    assert!(error.contains("HTML image byte limit"), "{error}");
    assert!(html::from_html_nodes(&nodes, &BTreeMap::new(), 100, bytes * 3).is_ok());
}
#[test]
fn supplied_html_images_are_validated_before_copy_and_keep_pixel_dimensions() {
    let bytes = terminal_png_rust::png::encode(8, 6, &vec![200; 8 * 6 * 4]).unwrap();
    let resources = BTreeMap::from([("pixel.png".into(), bytes)]);
    let nodes = html::dom::bounded_html_dom("<p><img src='pixel.png'></p>").unwrap();
    let document = html::from_html_nodes(&nodes, &resources, 100, 1024 * 1024).unwrap();
    let Block::Paragraph(p) = &document.blocks[0] else {
        panic!()
    };
    let Inline::Image(image) = &p.inlines[0] else {
        panic!()
    };
    assert_eq!((image.width, image.height), (8., 6.));
    let invalid = BTreeMap::from([("pixel.png".into(), b"invalid image".to_vec())]);
    assert!(html::from_html_nodes(&nodes, &invalid, 100, 1024).is_err());
    assert!(
        html::from_html_nodes(&nodes, &resources, 1, 1024)
            .unwrap_err()
            .contains("node limit")
    );
}

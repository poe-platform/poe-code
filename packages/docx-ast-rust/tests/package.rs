use document_ast_rust::{Block, Document, Inline, Paragraph, TextStyle};

#[test]
fn standalone_word_package_has_styles_relationships_and_editable_body() {
    let mut document = Document::default();
    let mut paragraph = Paragraph::default();
    paragraph.inlines.push(Inline::Text {
        text: "Portable authoring".into(),
        style: TextStyle {
            bold: true,
            ..Default::default()
        },
    });
    document.blocks.push(Block::Paragraph(paragraph));
    let mut package = docx_ast_rust::to_package(&document).unwrap();
    for name in [
        "word/styles.xml",
        "word/theme/theme1.xml",
        "word/_rels/document.xml.rels",
        "[Content_Types].xml",
    ] {
        assert!(package.parts.iter().any(|part| part.name == name), "{name}");
    }
    let body = &mut package
        .parts
        .iter_mut()
        .find(|part| part.name == "word/document.xml")
        .unwrap()
        .bytes;
    let source = String::from_utf8(body.clone()).unwrap();
    assert!(source.contains("<w:b/>") && source.contains("Portable authoring"));
    *body = source
        .replace("Portable authoring", "Edited authoring")
        .into_bytes();
    let bytes = package.write().unwrap();
    assert!(
        bytes
            .windows(b"Edited authoring".len())
            .any(|part| part == b"Edited authoring")
    );
}

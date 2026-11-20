use safe_bash_rust::{
    commands::codecs::parse_zip_archive,
    document::{self, Block, Direction, Inline},
};

fn xml(document: &document::Document) -> String {
    let bytes = document::write_docx(document).unwrap();
    String::from_utf8(
        parse_zip_archive(&bytes)
            .unwrap()
            .into_iter()
            .find(|part| part.name == "word/document.xml")
            .unwrap()
            .content,
    )
    .unwrap()
}

#[test]
fn html_block_direction_preserves_paragraphs_lists_and_nested_resets() {
    let d = document::from_html("<div dir='RTL'><h2>Heading</h2><p>ABC 123.</p><ol reversed><li>First</li><li dir='ltr'>Second</li></ol><p dir='ltr'>Reset</p></div>").unwrap();
    let Block::Direction {
        direction: Direction::Rtl,
        blocks,
    } = &d.blocks[0]
    else {
        panic!("{d:?}")
    };
    assert!(matches!(&blocks[0], Block::Heading { .. }));
    assert!(matches!(&blocks[1], Block::Paragraph(_)));
    let Block::List {
        start: Some(1),
        items,
        ..
    } = &blocks[3]
    else {
        panic!("{blocks:?}")
    };
    assert!(matches!(
        &items[0][0],
        Block::Direction {
            direction: Direction::Ltr,
            ..
        }
    ));
    assert!(matches!(
        &blocks[4],
        Block::Direction {
            direction: Direction::Ltr,
            ..
        }
    ));
    let body = xml(&d);
    assert!(body.contains("<w:bidi"), "{body}");
    assert!(body.contains("ABC 123."));
    assert!(
        document::write_pdf(&d)
            .unwrap_err()
            .to_lowercase()
            .contains("direction")
    );
}

#[test]
fn html_isolates_and_override_keep_logical_content_and_whitespace() {
    let d = document::from_html(
        "<p>Before<bdo dir='rtl'> ABC 123</bdo> after <bdi dir='ltr'>Latin</bdi>.</p>",
    )
    .unwrap();
    let Block::Paragraph(p) = &d.blocks[0] else {
        panic!()
    };
    let Inline::Direction {
        direction: Direction::Rtl,
        override_order: true,
        inlines,
    } = &p.inlines[1]
    else {
        panic!("{p:?}")
    };
    assert!(matches!(&inlines[0], Inline::Text {text, ..} if text == " ABC 123"));
    assert!(matches!(
        &p.inlines[3],
        Inline::Direction {
            direction: Direction::Ltr,
            override_order: false,
            ..
        }
    ));
    let body = xml(&d);
    assert!(body.contains("w:bdo"), "{body}");
    assert!(body.contains(" ABC 123"));
    assert!(document::write_pdf(&d).is_err());
}

#[test]
fn html_table_direction_retains_cell_resets_and_header_emphasis() {
    let d = document::from_html("<table dir='rtl'><tbody dir='ltr'><tr dir='rtl'><th dir='ltr'><span dir='rtl'>Header</span></th><td>Value</td></tr></tbody></table>").unwrap();
    let Block::Direction {
        direction: Direction::Rtl,
        blocks,
    } = &d.blocks[0]
    else {
        panic!("{d:?}")
    };
    let Block::Table { rows, .. } = &blocks[0] else {
        panic!()
    };
    let Block::Direction {
        direction: Direction::Rtl,
        blocks,
    } = &rows[0].cells[0].blocks[0]
    else {
        panic!()
    };
    let Block::Direction {
        direction: Direction::Ltr,
        blocks,
    } = &blocks[0]
    else {
        panic!()
    };
    let Block::Paragraph(p) = &blocks[0] else {
        panic!()
    };
    let Inline::Direction { inlines, .. } = &p.inlines[0] else {
        panic!()
    };
    assert!(matches!(&inlines[0], Inline::Text { text, .. } if text == "Header"));
    assert!(rows[0].cells[0].header);
    let body = xml(&d);
    assert!(body.contains("w:bidiVisual"), "{body}");
    assert!(body.find("Header").unwrap() < body.find("Value").unwrap());
}

#[test]
fn unsupported_html_direction_is_explicit_and_css_subset_is_preserved() {
    for html in [
        "<p dir='auto'>Text</p>",
        "<p dir='auto' style='direction:ltr'>Text</p>",
        "<p><span dir='invalid' style='direction:rtl'>Text</span></p>",
        "<p><span dir='invalid' style='unicode-bidi:isolate'>Text</span></p>",
        "<p><bdi>Text</bdi></p>",
        "<p><bdo>Text</bdo></p>",
        "<p style='unicode-bidi:bidi-override;direction:rtl'>Text</p>",
        "<p><span style='direction:rtl'>Text</span></p>",
    ] {
        assert!(document::from_html(html).is_err(), "accepted {html}");
    }
    for html in [
        "<p style='direction:rtl'>Text</p>",
        "<p style='direction:ltr;direction:rtl'>Text</p>",
        "<p><span dir='ltr' style='unicode-bidi:isolate;unicode-bidi:isolate-override'>Text</span></p>",
        "<p dir='ltr' style='direction:rtl'>Text</p>",
        "<p><span style='direction:rtl;unicode-bidi:isolate'>Text</span></p>",
    ] {
        let d = document::from_html(html).unwrap();
        assert!(document::write_pdf(&d).is_err(), "rendered {html}");
        assert!(xml(&d).contains("Text"));
    }
    let plain = document::from_html("<p>Text <b>bold</b>.</p>").unwrap();
    let ltr = document::from_html("<div dir='ltr'><p>Text <b>bold</b>.</p></div>").unwrap();
    assert_eq!(
        document::write_pdf(&plain).unwrap(),
        document::write_pdf(&ltr).unwrap()
    );
}

#[test]
fn direction_scopes_do_not_duplicate_html_collapsed_spaces() {
    let d = document::from_html("<p>Before <span dir='ltr'> inside </span> after</p>").unwrap();
    let body = xml(&d);
    assert!(body.contains(">inside </w:t>"), "{body}");
    assert!(!body.contains("> inside"), "{body}");
    assert!(!body.contains("> after"), "{body}");
    assert!(document::from_html("<pre><code><bdo dir='rtl'>abc</bdo></code></pre>").is_err());
}

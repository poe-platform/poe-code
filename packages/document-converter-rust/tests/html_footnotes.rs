use document_ast_rust::{Block, Inline, TextStyle};
use document_converter_rust::{Format, convert, html};
use std::collections::BTreeMap;

fn request(html: &str, limits: &str, image: Option<&[u8]>) -> Vec<u8> {
    let resources = image.map_or(String::new(), |bytes| {
        format!(
            r#", "resources":[{{"id":"pixel.png","offset":0,"length":{}}}]"#,
            bytes.len()
        )
    });
    let html = mcp_protocol_rust::json::stringify(&mcp_protocol_rust::json::Value::String(
        html.encode_utf16().collect(),
    ));
    let json = format!(r#"{{"mode":"html","html":{html},"limits":{limits}{resources}}}"#);
    let mut request = (json.len() as u32).to_le_bytes().to_vec();
    request.extend_from_slice(json.as_bytes());
    if let Some(bytes) = image {
        request.extend_from_slice(bytes);
    }
    request
}

const BASIC: &str = "<p>Text<sup><a id='ref' role='doc-noteref' href='#note'>1</a></sup>.</p><section class='footnotes' role='doc-endnotes'><ol><li id='note'><p>Note <strong>bold</strong>. <a role='doc-backlink' href='#ref'>↩</a></p></li></ol></section>";

#[test]
fn html_footnotes_become_real_notes_and_leave_unrelated_lists_untouched() {
    let source = format!("{BASIC}<ol><li><p>Ordinary list</p></li></ol>");
    let document = html::from_html(&source).unwrap();
    assert_eq!(document.blocks.len(), 2, "definition list remained in body");
    let Block::Paragraph(paragraph) = &document.blocks[0] else {
        panic!()
    };
    let note = paragraph
        .inlines
        .iter()
        .find_map(|inline| match inline {
            Inline::Note(blocks) => Some(blocks),
            _ => None,
        })
        .expect("native Note missing");
    let Block::Paragraph(body) = &note[0] else {
        panic!()
    };
    assert!(
        body.inlines
            .iter()
            .any(|i| matches!(i, Inline::Text {text,style} if text == "bold" && style.bold))
    );
    assert!(!format!("{note:?}").contains('↩'));
    assert!(matches!(&document.blocks[1], Block::List { .. }));
    let docx = docx_ast_rust::write_docx(&document).unwrap();
    let xml = String::from_utf8_lossy(&docx);
    assert!(xml.contains("word/footnotes.xml"));
    assert_eq!(xml.matches("<w:footnoteReference ").count(), 1);
    assert!(!xml.split("</w:document>").next().unwrap().contains("Note "));
}

#[test]
fn repeated_rich_notes_keep_bookmarks_links_paragraphs_and_resources() {
    let source = "<p><a href='#inner'>Outside</a><sup><a role='doc-noteref' href='#note'>1</a></sup><sup><a role='doc-noteref' href='#note'>1</a></sup></p><section role='doc-endnotes' style='color:#123456'><ol><li id='note'><p id='inner'>Note <strong>bold</strong> <a href='https://example.com'>Link</a></p><p>Second <code>code</code><img src='pixel.png'></p></li></ol></section>";
    let image = terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap();
    for format in [Format::Docx, Format::Pdf] {
        let output = convert(&request(source, "{}", Some(&image)), format).unwrap();
        let text = String::from_utf8_lossy(&output.bytes);
        if format == Format::Docx {
            assert_eq!(text.matches("<w:footnoteReference ").count(), 2);
            assert_eq!(text.matches("<w:footnote w:id=").count(), 2);
            assert_eq!(text.matches("w:name=\"inner\"").count(), 1);
            assert!(text.contains("w:anchor=\"inner\""));
            assert!(text.contains("123456"));
            assert!(text.contains("word/_rels/footnotes.xml.rels"));
            assert!(text.contains("https://example.com"));
            assert!(text.contains("Courier New"));
            assert!(
                output
                    .bytes
                    .windows(image.len())
                    .any(|bytes| bytes == image)
            );
        } else {
            assert!(text.contains("/Subtype /Image"));
            assert!(text.contains("/Dest ["));
        }
        let error = convert(&request(source, "{\"images\":1}", Some(&image)), format)
            .err()
            .expect("repeated note image bypassed limit");
        assert_eq!(error.code, "E_LIMIT");
        let error = convert(
            &request(
                source,
                &format!("{{\"retainedBytes\":{}}}", image.len()),
                Some(&image),
            ),
            format,
        )
        .err()
        .expect("repeated note image bypassed retained-byte limit");
        assert_eq!(error.code, "E_LIMIT");
    }
}

#[test]
fn missing_duplicate_nested_and_circular_footnotes_fail_explicitly() {
    for source in [
        "<p><a role='doc-noteref' href='#missing'>1</a></p>",
        "<p><a role='doc-noteref' href='https://example.com/note'>1</a></p>",
        "<p><a role='doc-noteref' href='#note'>1</a></p><section role='doc-endnotes'><ol><li id='note'><p>A</p></li><li id='note'><p>B</p></li></ol></section>",
        "<p><a role='doc-noteref' href='#note'>1</a></p><section role='doc-endnotes'><ol><li id='note'><p><a role='doc-noteref' href='#note'>1</a></p></li></ol></section>",
        "<p><a role='doc-noteref' href='#note'>1</a></p><section role='doc-endnotes'><ol><li id='note'><p><a role='doc-noteref' href='#other'>2</a></p></li><li id='other'><p><a role='doc-noteref' href='#note'>1</a></p></li></ol></section>",
    ] {
        for format in [Format::Docx, Format::Pdf] {
            let error = convert(&request(source, "{}", None), format)
                .err()
                .expect("malformed footnotes accepted");
            assert!(
                error.message.to_lowercase().contains("footnote"),
                "{}",
                error.message
            );
        }
    }
}

#[test]
fn html_footnote_markers_do_not_leak_superscript_or_link_style_into_the_body() {
    let document = html::from_html(BASIC).unwrap();
    let Block::Paragraph(paragraph) = &document.blocks[0] else {
        panic!()
    };
    let blocks = paragraph
        .inlines
        .iter()
        .find_map(|i| {
            if let Inline::Note(blocks) = i {
                Some(blocks)
            } else {
                None
            }
        })
        .unwrap();
    let Block::Paragraph(note) = &blocks[0] else {
        panic!()
    };
    assert!(matches!(&note.inlines[0],Inline::Text{style,..} if *style == TextStyle::default()));
    let nodes = html::dom::bounded_html_dom(BASIC).unwrap();
    assert!(html::from_html_nodes(&nodes, &BTreeMap::new(), 2, 1024).is_err());
}

#[test]
fn repeated_note_expansion_obeys_node_and_depth_boundaries() {
    let references = "<a role='doc-noteref' href='#note'>1</a>".repeat(10);
    let source = format!(
        "<p><span><span>{references}</span></span></p><section role='doc-endnotes'><ol><li id='note'><p><b>A</b></p></li></ol></section>"
    );
    for format in [Format::Docx, Format::Pdf] {
        assert!(
            convert(
                &request(&source, "{\"nodes\":44,\"depth\":6}", None),
                format
            )
            .is_ok()
        );
        for limits in ["{\"nodes\":43}", "{\"depth\":5}"] {
            let error = convert(&request(&source, limits, None), format)
                .err()
                .expect("expanded note bypassed limit");
            assert_eq!(error.code, "E_LIMIT");
        }
    }
}

#[test]
fn unconsumed_footnote_content_is_rejected_instead_of_disappearing() {
    for source in [
        "<section role='doc-endnotes'><ol><li id='orphan'><p>Visible orphan</p></li></ol></section>",
        "<p><a role='doc-noteref' href='#note'>1</a></p><section role='doc-endnotes'><p>Visible introduction</p><ol><li id='note'><p>Note</p></li></ol></section>",
    ] {
        let error = html::from_html(source).unwrap_err();
        assert!(error.contains("footnote"), "{error}");
    }
}

#[test]
fn acyclic_nested_notes_follow_each_existing_writer_policy() {
    let source = "<p><a role='doc-noteref' href='#one'>1</a></p><section role='doc-endnotes'><ol><li id='one'><p>Outer <a role='doc-noteref' href='#two'>2</a></p></li><li id='two'><p>Inner</p></li></ol></section>";
    assert!(convert(&request(source, "{}", None), Format::Pdf).is_ok());
    let error = convert(&request(source, "{}", None), Format::Docx)
        .err()
        .expect("Word accepted nested notes");
    assert!(
        error.message.contains("Nested footnotes"),
        "{}",
        error.message
    );
}

#[test]
fn definition_container_styles_and_list_item_direction_survive_moving_into_a_note() {
    let source = "<p><a role='doc-noteref' href='#note'>1</a></p><section role='doc-endnotes' style='color:#123456;font-style:italic;text-align:right'><ol style='font-weight:bold'><li id='note' dir='ltr'><p>Styled</p></li></ol></section>";
    let document = html::from_html(source).unwrap();
    let Block::Paragraph(paragraph) = &document.blocks[0] else {
        panic!()
    };
    let Inline::Note(note) = &paragraph.inlines[0] else {
        panic!()
    };
    let Block::Direction { direction, blocks } = &note[0] else {
        panic!("direction was lost")
    };
    assert_eq!(*direction, document_ast_rust::Direction::Ltr);
    let Block::Paragraph(paragraph) = &blocks[0] else {
        panic!()
    };
    assert_eq!(paragraph.align, document_ast_rust::Align::Right);
    assert!(
        matches!(&paragraph.inlines[0],Inline::Text{style,..} if style.bold && style.italic && style.color.as_deref() == Some("123456") && !style.sup && style.link.is_none())
    );
    for format in [Format::Docx, Format::Pdf] {
        assert!(convert(&request(source, "{}", None), format).is_ok());
    }
}

#[test]
fn only_definition_backlinks_are_removed_and_their_images_are_not_loaded() {
    let source = "<p id='intro'>Introduction</p><p><a role='doc-backlink' href='#intro'>Return to introduction</a><a role='doc-noteref' href='#note'>1</a></p><section id='footnotes' role='doc-endnotes'><ol id='notes-list'><li id='note'><p>Note<a role='doc-backlink' href='#ref'><img src='unneeded.png'></a></p></li></ol></section><p><a href='#footnotes'>Notes section</a><a href='#notes-list'>Notes list</a></p>";
    for format in [Format::Docx, Format::Pdf] {
        let output = convert(&request(source, "{}", None), format).unwrap();
        let text = String::from_utf8_lossy(&output.bytes);
        if format == Format::Docx {
            assert!(text.contains("Return to introduction"));
            for id in ["intro", "footnotes", "notes-list"] {
                assert!(
                    text.contains(&format!("w:name=\"{id}\"")),
                    "missing target {id}"
                );
                assert!(
                    text.contains(&format!("w:anchor=\"{id}\"")),
                    "missing link {id}"
                );
            }
        } else {
            assert_eq!(text.matches("/Subtype /Link").count(), 3);
        }
    }
}

#[test]
fn source_node_limits_precede_note_style_indexing() {
    let source = "<a href='https://example.com/long' dir='auto'><span>A</span><span>B</span></a><section role='doc-endnotes'><ol><li id='note'><p>Note</p></li></ol></section>";
    for format in [Format::Docx, Format::Pdf] {
        let error = convert(&request(source, "{\"nodes\":1}", None), format)
            .err()
            .unwrap();
        assert_eq!(error.code, "E_LIMIT", "{}", error.message);
    }
}

#[test]
fn actual_pandoc_html_footnote_separator_is_consumed_without_losing_anchors() {
    let source = include_str!("fixtures/pandoc-footnote.html");
    for source in [
        source.to_string(),
        source.replace("<hr />", "<hr id='note-separator' />"),
    ] {
        let document = html::from_html(&source).unwrap();
        let Block::Paragraph(paragraph) = &document.blocks[0] else {
            panic!()
        };
        assert!(
            paragraph
                .inlines
                .iter()
                .any(|i| matches!(i, Inline::Note(_)))
        );
        assert!(!document.blocks.iter().any(|b| matches!(b, Block::Rule)));
        for format in [Format::Docx, Format::Pdf] {
            let output = convert(&request(&source, "{}", None), format).unwrap();
            let text = String::from_utf8_lossy(&output.bytes);
            if format == Format::Docx {
                assert_eq!(text.matches("<w:footnoteReference ").count(), 1);
                assert!(text.contains("word/footnotes.xml"));
                assert!(text.contains("w:name=\"footnotes\""));
                if source.contains("note-separator") {
                    assert!(text.contains("w:name=\"note-separator\""));
                }
            }
        }
    }
}

#[test]
fn note_references_inside_literal_code_fail_before_consuming_the_definition() {
    for tag in ["pre", "code", "tt", "samp", "var", "kbd"] {
        let source = format!(
            "<{tag}><a role='doc-noteref' href='#note'>1</a></{tag}><section role='doc-endnotes'><ol><li id='note'><p>IMPORTANT NOTE</p></li></ol></section>"
        );
        for format in [Format::Docx, Format::Pdf] {
            let error = convert(&request(&source, "{}", None), format)
                .err()
                .expect("note disappeared inside code");
            assert!(
                error.message.contains("literal code"),
                "{tag}: {}",
                error.message
            );
        }
    }
}

#[test]
fn definitions_inside_literal_code_cannot_be_relocated_or_duplicated() {
    for tag in ["pre", "code", "tt", "samp", "var", "kbd"] {
        let source = format!(
            "<p><a role='doc-noteref' href='#note'>1</a></p><{tag}><section role='doc-endnotes'><ol><li id='note'><p>IMPORTANT NOTE</p></li></ol></section></{tag}>"
        );
        for format in [Format::Docx, Format::Pdf] {
            let error = convert(&request(&source, "{}", None), format)
                .err()
                .expect("literal note definition was relocated");
            assert!(
                error.message.contains("literal code"),
                "{tag}: {}",
                error.message
            );
        }
    }
}

use document_ast_rust::{Align, Block, Inline};
use document_converter_rust::{Format, convert, map_pandoc};
use mcp_protocol_rust::{cooperate::block_on, json};
use pdf_ast_rust::PdfOptions;
use std::collections::BTreeMap;

fn mapped(metadata: &str, format: Format) -> document_ast_rust::Document {
    let input = json::parse(
        format!(
            r#"{{"metadata":{metadata},"blocks":[{{"t":"Para","c":[{{"t":"Str","c":"BODY"}}]}}]}}"#
        )
        .as_bytes(),
        Default::default(),
    )
    .unwrap();
    block_on(map_pandoc(
        &input,
        format,
        &BTreeMap::new(),
        &mut PdfOptions::default(),
        false,
        None,
        &mut vec![],
    ))
    .unwrap()
}
fn paragraph_text(block: &Block) -> String {
    let Block::Paragraph(paragraph) = block else {
        panic!("expected paragraph")
    };
    paragraph
        .inlines
        .iter()
        .filter_map(|inline| match inline {
            Inline::Text { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

#[test]
fn visible_metadata_precedes_body_in_both_formats_without_headings() {
    let metadata = r#"{"title":{"t":"MetaString","c":"TITLE"},"subtitle":{"t":"MetaString","c":"SUBTITLE"},"author":{"t":"MetaList","c":[{"t":"MetaString","c":"FIRST"},{"t":"MetaInlines","c":[{"t":"Str","c":"SECOND"}]}]},"date":{"t":"MetaString","c":"DATE"}}"#;
    for format in [Format::Docx, Format::Pdf] {
        let document = mapped(metadata, format);
        assert_eq!(
            document
                .blocks
                .iter()
                .map(paragraph_text)
                .collect::<Vec<_>>(),
            ["TITLE", "SUBTITLE", "FIRST", "SECOND", "DATE", "BODY"]
        );
        for block in &document.blocks[..5] {
            let Block::Paragraph(paragraph) = block else {
                unreachable!()
            };
            assert_eq!(paragraph.align, Align::Center);
            assert!(paragraph.keep_with_next);
        }
        let Block::Paragraph(title) = &document.blocks[0] else {
            unreachable!()
        };
        assert!(matches!(&title.inlines[0], Inline::Text {style, ..} if style.bold));
        let Block::Paragraph(subtitle) = &document.blocks[1] else {
            unreachable!()
        };
        assert!(matches!(&subtitle.inlines[0], Inline::Text {style, ..} if style.italic));
    }
}

#[test]
fn metadata_shapes_follow_pandoc_and_unused_fields_do_not_render() {
    let metadata = r#"{"title":{"t":"MetaBlocks","c":[{"t":"Plain","c":[{"t":"Str","c":"TITLE"}]}]},"subtitle":{"t":"MetaBlocks","c":[{"t":"Para","c":[{"t":"Str","c":"NO"}]},{"t":"Para","c":[]}]},"author":{"t":"MetaBlocks","c":[{"t":"Para","c":[{"t":"Image","c":[["",[],[]],[],["absent.png",""]]}]}]},"date":{"t":"MetaBool","c":true},"custom":{"t":"MetaInlines","c":[{"t":"Image","c":[["",[],[]],[],["absent.png",""]]}]}}"#;
    for format in [Format::Docx, Format::Pdf] {
        let document = mapped(metadata, format);
        assert_eq!(document.title, "TITLE");
        assert_eq!(
            document
                .blocks
                .iter()
                .map(paragraph_text)
                .collect::<Vec<_>>(),
            ["TITLE", "BODY"]
        );
    }
}

#[test]
fn title_notes_are_visible_but_excluded_from_descriptive_title() {
    let metadata = r#"{"title":{"t":"MetaInlines","c":[{"t":"Str","c":"TITLE"},{"t":"Note","c":[{"t":"Para","c":[{"t":"Str","c":"NOTE"}]}]}]}}"#;
    for format in [Format::Docx, Format::Pdf] {
        let document = mapped(metadata, format);
        assert_eq!(document.title, "TITLE");
        let Block::Paragraph(title) = &document.blocks[0] else {
            unreachable!()
        };
        assert!(matches!(&title.inlines[1], Inline::Note(_)));
    }
}

#[test]
fn html_filename_title_is_only_descriptive() {
    let json = r#"{"mode":"html","title":"FILENAME","html":"<p>BODY</p>"}"#;
    let mut request = (json.len() as u32).to_le_bytes().to_vec();
    request.extend_from_slice(json.as_bytes());
    let output = convert(&request, Format::Docx).unwrap();
    let xml = String::from_utf8_lossy(&output.bytes);
    assert!(!xml.contains(">FILENAME</w:t>"));
    assert!(xml.contains(">BODY</w:t>"));
}

#[test]
fn metadata_strings_and_lists_obey_node_and_depth_limits() {
    for metadata in [
        r#"{"title":{"t":"MetaString","c":"Title"}}"#,
        r#"{"author":{"t":"MetaList","c":[{"t":"MetaString","c":"Author"}]}}"#,
    ] {
        for format in [Format::Docx, Format::Pdf] {
            for (limits, accepted) in [
                (r#"{"depth":0}"#, false),
                (r#"{"depth":1,"nodes":2}"#, true),
                (r#"{"nodes":1}"#, false),
            ] {
                let input = json::parse(
                    format!(r#"{{"metadata":{metadata},"blocks":[]}}"#).as_bytes(),
                    Default::default(),
                )
                .unwrap();
                let limits = json::parse(limits.as_bytes(), Default::default()).unwrap();
                let result = block_on(map_pandoc(
                    &input,
                    format,
                    &BTreeMap::new(),
                    &mut PdfOptions::default(),
                    false,
                    Some(&limits),
                    &mut vec![],
                ));
                if accepted {
                    assert!(result.is_ok());
                } else {
                    assert_eq!(
                        result.err().expect("metadata bypassed limit").code,
                        "E_LIMIT"
                    );
                }
            }
        }
    }
}

#[test]
fn title_raw_markup_is_rendered_but_not_copied_into_document_properties() {
    for format in [Format::Docx, Format::Pdf] {
        let document = mapped(
            r#"{"title":{"t":"MetaInlines","c":[{"t":"RawInline","c":["html","<em>"]},{"t":"Str","c":"TITLE"},{"t":"RawInline","c":["html","</em>"]}]}}"#,
            format,
        );
        assert_eq!(document.title, "TITLE");
        let Block::Paragraph(title) = &document.blocks[0] else {
            unreachable!()
        };
        assert!(
            matches!(&title.inlines[0], Inline::Text {style, ..} if style.italic && style.bold)
        );
    }
}

#[test]
fn visible_metadata_images_share_body_limits_and_resources() {
    let image = terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap();
    let input = json::parse(br#"{"metadata":{"title":{"t":"MetaInlines","c":[{"t":"Image","c":[["",[],[]],[{"t":"Str","c":"ALT"}],["pixel.png",""]]}]}},"blocks":[{"t":"Para","c":[{"t":"Image","c":[["",[],[]],[],["pixel.png",""]]}]}]}"#, Default::default()).unwrap();
    let resources = BTreeMap::from([("pixel.png".into(), image.clone())]);
    for format in [Format::Docx, Format::Pdf] {
        let document = block_on(map_pandoc(
            &input,
            format,
            &resources,
            &mut PdfOptions::default(),
            false,
            None,
            &mut vec![],
        ))
        .unwrap();
        assert_eq!(document.title, "ALT");
        for limit in [
            r#"{"images":1}"#.to_string(),
            format!(r#"{{"retainedBytes":{}}}"#, image.len() * 2 - 1),
        ] {
            let limits = json::parse(limit.as_bytes(), Default::default()).unwrap();
            let error = block_on(map_pandoc(
                &input,
                format,
                &resources,
                &mut PdfOptions::default(),
                false,
                Some(&limits),
                &mut vec![],
            ))
            .err()
            .expect("metadata bypassed image budget");
            assert_eq!(error.code, "E_LIMIT");
        }
    }
}

#[test]
fn metadata_authors_accept_single_inline_blocks_and_preserve_source_order() {
    let metadata = r#"{"author":{"t":"MetaList","c":[{"t":"MetaString","c":"ONE"},{"t":"MetaBlocks","c":[{"t":"Plain","c":[{"t":"Str","c":"TWO"}]}]},{"t":"MetaMap","c":{}},{"t":"MetaBlocks","c":[{"t":"Para","c":[{"t":"Str","c":"THREE"}]}]},{"t":"MetaBool","c":false},{"t":"MetaInlines","c":[{"t":"Str","c":"FOUR"}]}]}}"#;
    for format in [Format::Docx, Format::Pdf] {
        let document = mapped(metadata, format);
        assert_eq!(
            document
                .blocks
                .iter()
                .map(paragraph_text)
                .collect::<Vec<_>>(),
            ["ONE", "TWO", "THREE", "FOUR", "BODY"]
        );
    }
}

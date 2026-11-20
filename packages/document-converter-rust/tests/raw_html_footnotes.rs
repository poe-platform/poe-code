use document_converter_rust::{Format, convert};
use mcp_protocol_rust::json::{Value, stringify};

fn request(html: &str, limits: &str, image: Option<&[u8]>, extra: &str) -> Vec<u8> {
    let html = stringify(&Value::String(html.encode_utf16().collect()));
    let resources = image.map_or(String::new(), |bytes| {
        format!(
            r#", "resources":[{{"id":"pixel.png","offset":0,"length":{}}}]"#,
            bytes.len()
        )
    });
    let json = format!(
        r#"{{"mode":"pandoc","document":{{"blocks":[{{"t":"RawBlock","c":["html",{html}]}}{extra}],"metadata":{{}}}},"limits":{limits}{resources}}}"#
    );
    let mut request = (json.len() as u32).to_le_bytes().to_vec();
    request.extend_from_slice(json.as_bytes());
    if let Some(image) = image {
        request.extend_from_slice(image);
    }
    request
}

const NOTES: &str = "<p id='intro'><a role='doc-backlink' href='#intro'>Return</a><sup data-footnote-label='a'><a id='ref' role='doc-noteref' href='#note'>1</a></sup> again<a role='doc-noteref' href='#note'>1</a></p><section id='footnotes' role='doc-endnotes'><hr/><ol><li id='note'><p>Note <strong>bold</strong><img src='pixel.png'><a role='doc-backlink' href='#ref' aria-label='Back'><img src='ignored.png'></a></p></li></ol></section>";

#[test]
fn complete_raw_block_resolves_forward_notes_and_skips_only_definition_backlink_images() {
    let image = terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap();
    for format in [Format::Docx, Format::Pdf] {
        let output = convert(&request(NOTES, "{}", Some(&image), ""), format).unwrap();
        let text = String::from_utf8_lossy(&output.bytes);
        if format == Format::Docx {
            assert_eq!(text.matches("<w:footnoteReference ").count(), 2);
            assert!(text.contains("word/footnotes.xml"));
            assert!(text.contains("Return"));
            assert!(text.contains("w:anchor=\"intro\""));
            assert!(text.contains("w:name=\"footnotes\""));
        } else {
            assert!(text.contains("/Subtype /Image"));
        }
        let body = NOTES.replace("Return", "<img src='body-missing.png'>");
        let error = convert(&request(&body, "{}", Some(&image), ""), format)
            .err()
            .unwrap();
        assert!(
            error.message.contains("body-missing.png"),
            "{}",
            error.message
        );
    }
}

#[test]
fn raw_note_expansion_obeys_global_image_and_retention_limits_before_copying() {
    let image = terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap();
    for format in [Format::Docx, Format::Pdf] {
        let exact = if format == Format::Docx {
            format!(r#"{{"images":2,"retainedBytes":{}}}"#, image.len() * 2)
        } else {
            "{\"images\":2}".into()
        };
        if let Err(error) = convert(&request(NOTES, &exact, Some(&image), ""), format) {
            panic!("{format:?}: {}", error.message);
        }
        for limits in [
            "{\"images\":1}".to_string(),
            format!(r#"{{"retainedBytes":{}}}"#, image.len() * 2 - 1),
        ] {
            let error = convert(&request(NOTES, &limits, Some(&image), ""), format)
                .err()
                .unwrap();
            assert_eq!(error.code, "E_LIMIT", "{}", error.message);
        }
        let extra = r#",{"t":"Para","c":[{"t":"Image","c":[["",[],[]],[],["pixel.png",""]]}]}"#;
        let error = convert(
            &request(NOTES, "{\"images\":2}", Some(&image), extra),
            format,
        )
        .err()
        .unwrap();
        assert_eq!(error.code, "E_LIMIT", "{}", error.message);
    }
}

#[test]
fn standard_pandoc_html_is_one_complete_raw_note_island() {
    let html = include_str!("fixtures/pandoc-footnote.html");
    for format in [Format::Docx, Format::Pdf] {
        let output = convert(&request(html, "{}", None, ""), format).unwrap();
        if format == Format::Docx {
            assert_eq!(
                String::from_utf8_lossy(&output.bytes)
                    .matches("<w:footnoteReference ")
                    .count(),
                1
            );
        }
    }
}

#[test]
fn fragmented_and_inline_note_markup_fail_instead_of_becoming_visual_links() {
    let cases = [
        r#"{"blocks":[{"t":"Para","c":[{"t":"RawInline","c":["html","<a role='doc-noteref' href='#note'>1</a>"]}]}]}"#,
        r#"{"blocks":[{"t":"RawBlock","c":["html","<p><a role='doc-noteref' href='#note'>1</a></p>"]},{"t":"RawBlock","c":["html","<section role='doc-endnotes'><ol><li id='note'><p>Note</p></li></ol></section>"]}]}"#,
    ];
    for document in cases {
        for format in [Format::Docx, Format::Pdf] {
            let json = format!(r#"{{"mode":"pandoc","document":{document}}}"#);
            let mut request = (json.len() as u32).to_le_bytes().to_vec();
            request.extend_from_slice(json.as_bytes());
            assert!(convert(&request, format).is_err());
        }
    }
}

#[test]
fn raw_note_expansion_and_following_nodes_share_node_and_depth_budgets() {
    let source = format!(
        "<p><span><span>{}</span></span></p><section role='doc-endnotes'><ol><li id='note'><p><b>A</b></p></li></ol></section>",
        "<a role='doc-noteref' href='#note'>1</a>".repeat(10)
    );
    for format in [Format::Docx, Format::Pdf] {
        assert!(
            convert(
                &request(&source, "{\"nodes\":45,\"depth\":7}", None, ""),
                format
            )
            .is_ok()
        );
        for limits in ["{\"nodes\":44}", "{\"depth\":6}"] {
            let error = convert(&request(&source, limits, None, ""), format)
                .err()
                .unwrap();
            assert_eq!(error.code, "E_LIMIT", "{}", error.message);
        }
        let error = convert(
            &request(
                &source,
                "{\"nodes\":45}",
                None,
                r#",{"t":"Para","c":[{"t":"Str","c":"After"}]}"#,
            ),
            format,
        )
        .err()
        .unwrap();
        assert_eq!(error.code, "E_LIMIT", "{}", error.message);
    }
}

#[test]
fn raw_note_retention_limit_precedes_image_decoding() {
    let invalid = vec![0u8; 200];
    for format in [Format::Docx, Format::Pdf] {
        let error = convert(
            &request(NOTES, "{\"retainedBytes\":300}", Some(&invalid), ""),
            format,
        )
        .err()
        .unwrap();
        assert_eq!(error.code, "E_LIMIT", "{}", error.message);
        assert!(
            error.message.contains("HTML image byte limit"),
            "{}",
            error.message
        );
    }
}

#[test]
fn typed_note_div_alignment_matches_html_and_respects_explicit_child_resets() {
    let typed = r#"[{"t":"Div","c":[["",[],[["style","text-align:right"]]],[{"t":"Para","c":[{"t":"Str","c":"Right"}]},{"t":"Div","c":[["",[],[["style","text-align:left"]]],[{"t":"Para","c":[{"t":"Str","c":"Left"}]}]]}]]}]"#;
    let raw = r#"[{"t":"RawBlock","c":["html","<div style='text-align:right'><p>Right</p><div style='text-align:left'><p>Left</p></div></div>"]}]"#;
    for format in [Format::Docx, Format::Pdf] {
        let mut outputs = Vec::new();
        for blocks in [typed, raw] {
            let json = format!(
                r#"{{"mode":"pandoc","document":{{"blocks":[{{"t":"Para","c":[{{"t":"Str","c":"Before"}},{{"t":"Note","c":{blocks}}}]}}]}}}}"#
            );
            let mut bytes = (json.len() as u32).to_le_bytes().to_vec();
            bytes.extend_from_slice(json.as_bytes());
            outputs.push(convert(&bytes, format).unwrap().bytes);
        }
        assert!(
            outputs[0] == outputs[1],
            "{format:?} note alignment differs"
        );
    }
}

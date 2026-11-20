use document_converter_rust::{Format, convert};

fn request(document: &str) -> Vec<u8> {
    let json = format!(r#"{{"mode":"pandoc","document":{document}}}"#);
    let mut bytes = (json.len() as u32).to_le_bytes().to_vec();
    bytes.extend_from_slice(json.as_bytes());
    bytes
}

#[test]
fn pandoc_direction_scopes_reach_word_and_pdf_rejects_unsupported_visual_order() {
    for (document, marker) in [
        (
            r#"{"direction":"rtl","blocks":[{"t":"Para","c":[{"t":"Str","c":"ABC 123"}]}],"metadata":{}}"#,
            "<w:bidi",
        ),
        (
            r#"{"blocks":[{"t":"Header","c":[2,["",[],[["dir","rtl"]]],[{"t":"Str","c":"ABC 123"}]]}],"metadata":{}}"#,
            "<w:bidi",
        ),
        (
            r#"{"blocks":[{"t":"Para","c":[{"t":"Span","c":[["",[],[["dir","ltr"],["style","unicode-bidi:isolate-override"]]],[{"t":"Str","c":"ABC 123"}]]}]}],"metadata":{}}"#,
            "<w:bdo",
        ),
    ] {
        let bytes = request(document);
        let word = convert(&bytes, Format::Docx).unwrap();
        let xml = String::from_utf8_lossy(&word.bytes);
        assert!(xml.contains(marker), "missing {marker}");
        assert!(xml.contains("ABC 123"), "logical text was changed");
        let error = convert(&bytes, Format::Pdf)
            .err()
            .expect("unsupported direction silently rendered");
        assert_eq!(error.code, "E_CAPABILITY");
    }
}

#[test]
fn resolved_ltr_scopes_remain_supported_and_auto_is_never_silently_resolved() {
    let ltr = request(
        r#"{"direction":"ltr","blocks":[{"t":"Div","c":[["",[],[["style","direction:ltr"]]],[{"t":"Para","c":[{"t":"Span","c":[["",[],[["dir","ltr"]]],[{"t":"Str","c":"ABC 123"}]]}]}]]}],"metadata":{}}"#,
    );
    for format in [Format::Docx, Format::Pdf] {
        assert!(!convert(&ltr, format).unwrap().bytes.is_empty());
        for document in [
            r#"{"direction":"auto","blocks":[],"metadata":{}}"#,
            r#"{"blocks":[{"t":"Para","c":[{"t":"Span","c":[["",[],[["dir","auto"],["style","direction:ltr;unicode-bidi:isolate"]]],[{"t":"Str","c":"ABC 123"}]]}]}],"metadata":{}}"#,
        ] {
            let error = convert(&request(document), format)
                .err()
                .expect("auto silently resolved");
            assert_eq!(error.code, "E_CAPABILITY");
        }
    }
}

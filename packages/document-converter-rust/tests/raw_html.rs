use document_converter_rust::{Format, convert};

fn request(blocks: &str, limits: &str, image: Option<&[u8]>) -> Vec<u8> {
    let resources = image.map_or_else(String::new, |bytes| {
        format!(
            r#", "resources":[{{"id":"pixel.png","offset":0,"length":{}}}]"#,
            bytes.len()
        )
    });
    let json = format!(
        r#"{{"mode":"pandoc","document":{{"blocks":{blocks},"metadata":{{}}}},"limits":{limits}{resources}}}"#
    );
    let mut bytes = (json.len() as u32).to_le_bytes().to_vec();
    bytes.extend_from_slice(json.as_bytes());
    if let Some(image) = image {
        bytes.extend_from_slice(image);
    }
    bytes
}

#[test]
fn raw_html_nodes_are_bounded_with_exact_boundary_and_typed_control() {
    let raw = r#"[{"t":"Para","c":[{"t":"RawInline","c":["html","<b>A</b>"]}]}]"#;
    let typed = r#"[{"t":"Para","c":[{"t":"Strong","c":[{"t":"Str","c":"A"}]}]}]"#;
    for format in [Format::Docx, Format::Pdf] {
        assert!(convert(&request(typed, r#"{"nodes":3}"#, None), format).is_ok());
        assert!(convert(&request(raw, r#"{"nodes":4}"#, None), format).is_ok());
        let error = convert(&request(raw, r#"{"nodes":3}"#, None), format)
            .err()
            .unwrap();
        assert_eq!(error.code, "E_LIMIT");
        assert!(error.message.contains("nodes"));
    }
}

#[test]
fn raw_html_images_obey_occurrence_limits_with_shared_supplied_bytes() {
    let raw =
        r#"[{"t":"RawBlock","c":["html","<p><img src='pixel.png'><img src='pixel.png'></p>"]}]"#;
    let image = terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap();
    for format in [Format::Docx, Format::Pdf] {
        assert!(convert(&request(raw, r#"{"images":2}"#, Some(&image)), format).is_ok());
        let error = convert(&request(raw, r#"{"images":1}"#, Some(&image)), format)
            .err()
            .unwrap();
        assert_eq!(error.code, "E_LIMIT");
        assert!(error.message.contains("images"));
    }
}

#[test]
fn raw_html_repeated_images_are_bounded_before_cloning_supplied_bytes() {
    let raw =
        r#"[{"t":"RawBlock","c":["html","<p><img src='pixel.png'><img src='pixel.png'></p>"]}]"#;
    let image = terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap();
    let exact = format!(r#"{{"retainedBytes":{}}}"#, image.len() * 2);
    assert!(convert(&request(raw, &exact, Some(&image)), Format::Docx).is_ok());
    let limited = format!(r#"{{"retainedBytes":{}}}"#, image.len() * 2 - 1);
    let error = convert(&request(raw, &limited, Some(&image)), Format::Docx)
        .err()
        .unwrap();
    assert_eq!(error.code, "E_LIMIT");
    assert!(error.message.contains("retainedBytes"));
}

#[test]
fn raw_html_scopes_and_typed_children_share_the_depth_limit() {
    let raw = r#"[{"t":"RawBlock","c":["html","<div>"]},{"t":"RawBlock","c":["html","<div>"]},{"t":"Para","c":[{"t":"Str","c":"A"}]},{"t":"RawBlock","c":["html","</div></div>"]}]"#;
    for format in [Format::Docx, Format::Pdf] {
        // Two raw containers plus the typed paragraph's inline content.
        assert!(convert(&request(raw, r#"{"depth":3}"#, None), format).is_ok());
        let error = convert(&request(raw, r#"{"depth":2}"#, None), format)
            .err()
            .unwrap();
        assert_eq!(error.code, "E_LIMIT");
        assert!(error.message.contains("depth"));
    }
}

#[test]
fn unknown_raw_formats_fail_instead_of_disappearing_from_word() {
    let raw = r#"[{"t":"Para","c":[{"t":"RawInline","c":["custom-format","content"]}]}]"#;
    for format in [Format::Docx, Format::Pdf] {
        let error = convert(&request(raw, "{}", None), format).err().unwrap();
        assert!(error.message.contains("custom-format"));
    }
}

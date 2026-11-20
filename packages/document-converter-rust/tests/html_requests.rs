use document_converter_rust::{Format, convert};

fn request(html: &str, limits: &str, image: Option<(&str, &[u8])>) -> Vec<u8> {
    let resources = image.map_or_else(
        || "[]".into(),
        |(name, bytes)| format!(r#"[{{"id":"{name}","offset":0,"length":{}}}]"#, bytes.len()),
    );
    let json =
        format!(r#"{{"mode":"html","html":"{html}","limits":{limits},"resources":{resources}}}"#);
    let mut framed = (json.len() as u32).to_le_bytes().to_vec();
    framed.extend(json.bytes());
    if let Some((_, bytes)) = image {
        framed.extend(bytes);
    }
    framed
}

#[test]
fn html_requests_resolve_supplied_resources_without_reading_unused_ones() {
    let png = terminal_png_rust::png::encode(2, 1, &[255, 0, 0, 255, 0, 0, 255, 255]).unwrap();
    for format in [Format::Docx, Format::Pdf] {
        let output = convert(
            &request(
                "<p>Picture<img src='pixel.png'></p>",
                "{}",
                Some(("pixel.png", &png)),
            ),
            format,
        )
        .unwrap();
        assert!(!output.bytes.is_empty());
        let expected = convert(&request("<p>Body</p>", "{}", None), format)
            .unwrap()
            .bytes;
        let actual = convert(
            &request(
                "<head><img src='unused'></head><p>Body</p>",
                "{}",
                Some(("unused", b"invalid image")),
            ),
            format,
        )
        .unwrap()
        .bytes;
        assert_eq!(
            actual, expected,
            "{format:?}: nonrendering image was processed"
        );
    }
}

#[test]
fn html_request_node_and_depth_limits_apply_before_lowering() {
    let html = "<div><p>Text</p></div>";
    for format in [Format::Docx, Format::Pdf] {
        let expected = convert(&request(html, "{}", None), format).unwrap().bytes;
        for (key, exact) in [("nodes", 3), ("depth", 2)] {
            let limits = format!(r#"{{"{key}":{exact}}}"#);
            assert_eq!(
                convert(&request(html, &limits, None), format)
                    .unwrap()
                    .bytes,
                expected
            );
            let limits = format!(r#"{{"{key}":{}}}"#, exact - 1);
            let error = convert(&request(html, &limits, None), format)
                .err()
                .unwrap_or_else(|| panic!("{format:?}: ignored HTML {key} limit"));
            assert_eq!(error.code, "E_LIMIT");
        }
    }
}

#[test]
fn html_request_image_occurrences_and_copied_bytes_obey_limits() {
    let png = terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap();
    let html = "<p><img src='pixel.png'><img src='pixel.png'></p>";
    // PDF also retains decoder buffers; use Word for the exact copied-byte edge.
    for (format, key, exact) in [
        (Format::Docx, "images", 2),
        (Format::Pdf, "images", 2),
        (Format::Docx, "retainedBytes", 2 * png.len()),
    ] {
        let limits = format!(r#"{{"{key}":{exact}}}"#);
        assert!(convert(&request(html, &limits, Some(("pixel.png", &png))), format).is_ok());
        let limits = format!(r#"{{"{key}":{}}}"#, exact - 1);
        let error = convert(&request(html, &limits, Some(("pixel.png", &png))), format)
            .err()
            .unwrap_or_else(|| panic!("{format:?}: ignored HTML {key} limit"));
        assert_eq!(error.code, "E_LIMIT");
    }
}

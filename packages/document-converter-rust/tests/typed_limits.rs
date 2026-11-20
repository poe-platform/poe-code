use document_converter_rust::{Format, convert};

fn request(blocks: &str, limits: &str, image: &[u8]) -> Vec<u8> {
    let json = format!(
        r#"{{"mode":"pandoc","document":{{"blocks":{blocks},"metadata":{{}}}},"limits":{limits},"resources":[{{"id":"pixel.png","offset":0,"length":{}}}]}}"#,
        image.len()
    );
    let mut bytes = (json.len() as u32).to_le_bytes().to_vec();
    bytes.extend(json.bytes());
    bytes.extend(image);
    bytes
}

#[test]
fn typed_nodes_and_nesting_obey_supplied_limits_without_any_raw_html() {
    let blocks = r#"[{"t":"Para","c":[{"t":"Strong","c":[{"t":"Str","c":"Text"}]}]}]"#;
    for format in [Format::Docx, Format::Pdf] {
        let expected = convert(&request(blocks, "{}", &[]), format).unwrap().bytes;
        for (key, exact) in [("nodes", 3), ("depth", 2)] {
            assert_eq!(
                convert(
                    &request(blocks, &format!(r#"{{"{key}":{exact}}}"#), &[]),
                    format
                )
                .unwrap()
                .bytes,
                expected
            );
            let error = convert(
                &request(blocks, &format!(r#"{{"{key}":{}}}"#, exact - 1), &[]),
                format,
            )
            .err()
            .unwrap_or_else(|| panic!("accepted {format:?} over {key}"));
            assert_eq!(error.code, "E_LIMIT");
            assert!(error.message.contains(key), "{}", error.message);
        }
    }
}

#[test]
fn repeated_typed_images_obey_occurrence_and_retention_limits_before_copying() {
    let image = terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap();
    let inline = r#"{"t":"Image","c":[["",[],[]],[],["pixel.png",""]]}"#;
    let blocks = format!(r#"[{{"t":"Para","c":[{inline},{inline}]}}]"#);
    // PDF additionally retains raster decoder buffers, so the exact byte
    // boundary here is checked through the Word writer, which keeps the bytes.
    for (format, key, exact) in [
        (Format::Docx, "images", 2),
        (Format::Pdf, "images", 2),
        (Format::Docx, "retainedBytes", 2 * image.len()),
    ] {
        let expected = convert(&request(&blocks, "{}", &image), format)
            .unwrap()
            .bytes;
        assert_eq!(
            convert(
                &request(&blocks, &format!(r#"{{"{key}":{exact}}}"#), &image),
                format
            )
            .unwrap()
            .bytes,
            expected
        );
        let error = convert(
            &request(&blocks, &format!(r#"{{"{key}":{}}}"#, exact - 1), &image),
            format,
        )
        .err()
        .unwrap_or_else(|| panic!("accepted {format:?} over {key}"));
        assert_eq!(error.code, "E_LIMIT");
        assert!(error.message.contains(key), "{}", error.message);
    }
}

use document_converter_rust::{Format, convert};

fn request(fields: &str) -> Vec<u8> {
    let json =
        format!(r#"{{"mode":"pandoc","document":{{"blocks":[],"metadata":{{}}}},{fields}}}"#);
    let mut bytes = (json.len() as u32).to_le_bytes().to_vec();
    bytes.extend(json.bytes());
    bytes.push(0);
    bytes
}

#[test]
fn resource_admission_honors_limits_even_when_the_document_does_not_use_them() {
    for format in [Format::Docx, Format::Pdf] {
        for (limit, value) in [("resources", 1), ("resourceBytes", 1), ("retainedBytes", 1)] {
            let input = request(&format!(
                r#""limits":{{"{limit}":{value}}},"resources":[{{"id":"first","offset":0,"length":1}},{{"id":"second","offset":0,"length":1}}]"#
            ));
            let error = convert(&input, format)
                .err()
                .unwrap_or_else(|| panic!("accepted {format:?} over {limit}"));
            assert_eq!(error.code, "E_LIMIT");
            assert!(error.message.contains(limit), "{}", error.message);
        }
    }
}

#[test]
fn font_admission_checks_limits_before_parsing_the_font() {
    for (limit, value) in [("fonts", 1), ("binaryBytes", 1), ("retainedBytes", 1)] {
        let input = request(&format!(
            r#""limits":{{"{limit}":{value}}},"options":{{"pdfFonts":[{{"id":"first","offset":0,"length":1}},{{"id":"second","offset":0,"length":1}}]}}"#
        ));
        let error = convert(&input, Format::Pdf).err().unwrap();
        assert_eq!(error.code, "E_LIMIT", "{limit}: {}", error.message);
        assert!(error.message.contains(limit), "{}", error.message);
    }
}

#[test]
fn images_and_fonts_share_the_request_retention_limit() {
    let input = request(
        r#""limits":{"retainedBytes":1},"resources":[{"id":"image","offset":0,"length":1}],"options":{"pdfFonts":[{"id":"font","offset":0,"length":1}]}"#,
    );
    let error = convert(&input, Format::Pdf).err().unwrap();
    assert_eq!(error.code, "E_LIMIT");
    assert!(error.message.contains("retainedBytes"));
}

#[test]
fn admitted_resources_do_not_change_empty_document_output() {
    let with_resources = request(
        r#""limits":{"resources":2,"resourceBytes":2,"retainedBytes":2},"resources":[{"id":"first","offset":0,"length":1},{"id":"second","offset":0,"length":1}]"#,
    );
    let without_resources = request(r#""resources":[]"#);
    for format in [Format::Docx, Format::Pdf] {
        assert_eq!(
            convert(&with_resources, format).unwrap().bytes,
            convert(&without_resources, format).unwrap().bytes,
        );
    }
}

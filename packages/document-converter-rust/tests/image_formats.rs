use document_converter_rust::{Format, convert};

fn request(route: &str, bytes: &[u8], limits: &str) -> Vec<u8> {
    let body = match route {
        "html" => r#""mode":"html","html":"<p><img src='picture'><img src='picture'></p>""#,
        "raw" => {
            r#""mode":"pandoc","document":{"metadata":{},"blocks":[{"t":"RawBlock","c":["html","<p><img src='picture'><img src='picture'></p>"]}]}"#
        }
        _ => {
            r#""mode":"pandoc","document":{"metadata":{},"blocks":[{"t":"Para","c":[{"t":"Image","c":[["",[],[]],[],["picture",""]]},{"t":"Image","c":[["",[],[]],[],["picture",""]]}]}]}"#
        }
    };
    let json = format!(
        r#"{{{body},"limits":{limits},"resources":[{{"id":"picture","offset":0,"length":{}}}]}}"#,
        bytes.len()
    );
    let mut framed = (json.len() as u32).to_le_bytes().to_vec();
    framed.extend(json.bytes());
    framed.extend(bytes);
    framed
}

const IMAGES: &[(&str, &[u8])] = &[
    (
        "GIF",
        include_bytes!("../../safe-bash-rust/tests/fixtures/html-images/pixel.gif"),
    ),
    (
        "BMP",
        include_bytes!("../../safe-bash-rust/tests/fixtures/html-images/pixel.bmp"),
    ),
    (
        "TIFF",
        include_bytes!("../../safe-bash-rust/tests/fixtures/html-images/pixel.tiff"),
    ),
];

#[test]
fn office_rasters_render_through_typed_raw_and_html_resource_routes() {
    for (name, bytes) in IMAGES {
        for route in ["typed", "raw", "html"] {
            for format in [Format::Docx, Format::Pdf] {
                let output = convert(&request(route, bytes, "{}"), format)
                    .unwrap_or_else(|e| panic!("{name}/{route}/{format:?}: {e:?}"));
                if format == Format::Pdf {
                    let raw = String::from_utf8_lossy(&output.bytes);
                    assert!(raw.starts_with("%PDF-"));
                    assert_eq!(
                        raw.matches("/Subtype /Image").count(),
                        1,
                        "{name}/{route}: image deduplication"
                    );
                    assert!(raw.contains("/Width 8 /Height 6"));
                    assert_eq!(
                        output
                            .usage
                            .iter()
                            .find(|(key, _)| *key == "decodedImageBytes")
                            .unwrap()
                            .1,
                        48 * 16 + 65536
                    );
                } else {
                    assert!(output.bytes.starts_with(b"PK\x03\x04"));
                }
            }
        }
    }
}

#[test]
fn raster_resource_routes_enforce_input_occurrences_and_decoded_byte_limits() {
    for (name, bytes) in IMAGES {
        for route in ["typed", "raw", "html"] {
            for format in [Format::Docx, Format::Pdf] {
                assert!(convert(&request(route, bytes, r#"{"images":2}"#), format).is_ok());
                let error = convert(&request(route, bytes, r#"{"images":1}"#), format)
                    .err()
                    .unwrap();
                assert_eq!(error.code, "E_LIMIT", "{name}/{route}/{format:?}");
            }
            let error = convert(
                &request(route, bytes, r#"{"retainedBytes":66303}"#),
                Format::Pdf,
            )
            .err()
            .unwrap();
            assert_eq!(error.code, "E_LIMIT", "{name}/{route}");
            assert!(
                convert(
                    &request(route, bytes, r#"{"retainedBytes":66304}"#),
                    Format::Pdf
                )
                .is_ok()
            );
        }
    }
}

#[test]
fn unsupported_tiff_profiles_fail_explicitly_on_every_pdf_resource_route() {
    let bytes = include_bytes!("../../terminal-png-rust/tests/fixtures/tiff/tiff-cmyk.tiff");
    for route in ["typed", "raw", "html"] {
        let error = convert(&request(route, bytes, "{}"), Format::Pdf)
            .err()
            .unwrap();
        assert!(
            error.message.contains("Unsupported TIFF encoding"),
            "{route}: {error:?}"
        );
    }
}

#[test]
fn malformed_tiff_payload_spans_fail_before_docx_or_pdf_publication() {
    let bytes =
        include_bytes!("../../terminal-png-rust/tests/fixtures/tiff/tiff-truncated-strip.tiff");
    for route in ["typed", "raw", "html"] {
        for format in [Format::Docx, Format::Pdf] {
            assert!(
                convert(&request(route, bytes, "{}"), format).is_err(),
                "{route}/{format:?}"
            );
        }
    }
}

#[test]
fn office_supported_tiff_profiles_are_preserved_without_pdf_decode_support() {
    for bytes in [
        include_bytes!("../../terminal-png-rust/tests/fixtures/tiff/tiff-cmyk.tiff").as_slice(),
        include_bytes!("../../terminal-png-rust/tests/fixtures/tiff/tiff-palette.tiff").as_slice(),
        include_bytes!("../../terminal-png-rust/tests/fixtures/tiff/tiff-planar-separate.tiff")
            .as_slice(),
    ] {
        for route in ["typed", "raw", "html"] {
            assert!(
                convert(&request(route, bytes, "{}"), Format::Docx).is_ok(),
                "{route}"
            );
        }
    }
}

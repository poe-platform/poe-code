use document_converter_rust::{Format, convert};

fn request(json: &str) -> Vec<u8> {
    let mut bytes = (json.len() as u32).to_le_bytes().to_vec();
    bytes.extend_from_slice(json.as_bytes());
    bytes
}

#[test]
fn html_and_pandoc_pdf_exports_refuse_unshaped_text_with_a_capability_error() {
    for (json, reason) in [
        (
            r#"{"mode":"html","html":"<p>Arabic: مرحبا بالعالم</p>"}"#,
            "text shaping is not available",
        ),
        (
            r#"{"mode":"html","html":"<p dir='rtl'>שלום עולם</p>"}"#,
            "right-to-left direction",
        ),
        (
            r#"{"mode":"html","html":"<p>á</p>"}"#,
            "text shaping is not available",
        ),
        (
            r#"{"mode":"pandoc","document":{"metadata":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"مرحبا بالعالم"}]}]}}"#,
            "text shaping is not available",
        ),
        (
            r#"{"mode":"pandoc","document":{"metadata":{},"blocks":[{"t":"Para","c":[{"t":"Span","c":[["",[],[["dir","rtl"]]],[{"t":"Str","c":"שלום עולם"}]]}]}]}}"#,
            "right-to-left direction",
        ),
    ] {
        let error = convert(&request(json), Format::Pdf)
            .err()
            .expect("unsupported text was published as a PDF");
        assert_eq!(error.code, "E_CAPABILITY");
        assert!(error.message.contains(reason), "{}", error.message);
    }
}

#[test]
fn pdf_scalar_profile_does_not_restrict_word_text_or_supported_pdf_text() {
    let rtl = request(r#"{"mode":"html","html":"<p>مرحبا بالعالم</p><p>שלום עולם</p>"}"#);
    let word = convert(&rtl, Format::Docx).unwrap();
    let xml = String::from_utf8_lossy(&word.bytes);
    assert!(xml.contains("مرحبا بالعالم"));
    assert!(xml.contains("שלום עולם"));

    let supported =
        request(r#"{"mode":"html","html":"<p>Zażółć gęślą jaźń. déjà vu. Ελληνικά. Привет.</p>"}"#);
    let pdf = convert(&supported, Format::Pdf).unwrap();
    assert!(pdf.bytes.starts_with(b"%PDF-1.7"));
}

#[test]
fn cjk_paragraphs_and_table_cells_export_in_html_and_pandoc() {
    for json in [
        r#"{"mode":"html","html":"<h1>東京</h1><p>Ω 東京 李 Zoë</p><table><tr><th>担当者</th></tr><tr><td>李</td></tr></table>"}"#,
        r#"{"mode":"pandoc","document":{"metadata":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"Ω 東京 李 Zoë"}]}]}}"#,
    ] {
        let result = convert(&request(json), Format::Pdf).unwrap();
        let pdf = String::from_utf8_lossy(&result.bytes);
        assert!(pdf.starts_with("%PDF-1.7"));
        for c in "Ω東京李Zoë".chars() {
            assert!(pdf.contains(&format!("<{:04X}>", c as u32)), "missing {c}");
        }
        assert!(pdf.contains("/BaseFont /DocumentCjkFallback"));
    }
}

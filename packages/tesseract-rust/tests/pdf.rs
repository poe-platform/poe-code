#![cfg(feature = "pdf")]
use lopdf::{Document, Object, Stream, dictionary};
use poe_tesseract::{
    Options,
    pdf::{PdfOptions, recognize_pdf},
};

fn scanned_pdf() -> Vec<u8> {
    let image = image::load_from_memory(include_bytes!("fixtures/english.png"))
        .unwrap()
        .into_rgb8();
    let mut doc = Document::with_version("1.7");
    let pages = doc.new_object_id();
    let image_id = doc.add_object(Stream::new(dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => image.width(), "Height" => image.height(), "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8 }, image.into_raw()));
    let content = doc.add_object(Stream::new(
        dictionary! {},
        b"q 600 0 0 110 0 0 cm /Scan Do Q".to_vec(),
    ));
    let page = doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages, "MediaBox" => vec![0.into(),0.into(),600.into(),110.into()], "Resources" => dictionary! { "XObject" => dictionary! { "Scan" => image_id } }, "Contents" => content });
    doc.objects.insert(
        pages,
        dictionary! { "Type" => "Pages", "Count" => 1, "Kids" => vec![Object::Reference(page)] }
            .into(),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
    doc.trailer.set("Root", catalog);
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    bytes
}

#[test]
fn scanned_pdf_becomes_searchable_and_retains_original_image() {
    let original = scanned_pdf();
    let result = recognize_pdf(&original, &Options::default(), &PdfOptions::default()).unwrap();
    assert!(result.text.contains("HELLO WORLD"), "{}", result.text);
    let doc = Document::load_mem(&result.pdf).unwrap();
    assert_eq!(doc.get_pages().len(), 1);
    let extracted = doc.extract_text(&[1]).unwrap();
    assert!(extracted.contains("HELLO WORLD"), "{extracted:?}");
    assert!(doc.objects.values().any(|o| o.as_stream().is_ok_and(|s| {
        s.dict
            .get(b"Subtype")
            .is_ok_and(|v| v.as_name().is_ok_and(|name| name == b"Image"))
    })));
}

#[test]
fn overlay_starts_with_the_original_page_graphics_state() {
    let mut doc = Document::load_mem(&scanned_pdf()).unwrap();
    let page = *doc.get_pages().get(&1).unwrap();
    let content_id = doc.get_page_contents(page)[0];
    // A page is allowed to leave its transformation and clipping state in effect.
    doc.get_object_mut(content_id)
        .unwrap()
        .as_stream_mut()
        .unwrap()
        .set_plain_content(b"600 0 0 110 0 0 cm /Scan Do".to_vec());
    let mut input = Vec::new();
    doc.save_to(&mut input).unwrap();
    let result = recognize_pdf(&input, &Options::default(), &PdfOptions::default()).unwrap();
    let doc = Document::load_mem(&result.pdf).unwrap();
    let content = lopdf::content::Content::decode(&doc.get_page_content(page).unwrap()).unwrap();
    let mut saved = Vec::new();
    let mut transformed = false;
    for operation in content.operations {
        match operation.operator.as_str() {
            "q" => saved.push(transformed),
            "Q" => transformed = saved.pop().unwrap(),
            "cm" => transformed = true,
            "Tj" => assert!(!transformed, "OCR text inherited the image transformation"),
            _ => {}
        }
    }
}

#[test]
fn pdf_rejects_invalid_limits_before_parsing() {
    let options = Options {
        limits: poe_tesseract::Limits {
            timeout_ms: 0,
            ..Default::default()
        },
        ..Options::default()
    };
    let error = recognize_pdf(b"not a PDF", &options, &PdfOptions::default()).unwrap_err();
    assert!(error.contains("limits"), "{error}");
}

#[test]
fn cancelled_pdf_does_not_parse_input() {
    let cancelled = std::sync::atomic::AtomicBool::new(true);
    let options = Options {
        cancellation: Some(&cancelled),
        ..Options::default()
    };
    let error = recognize_pdf(b"not a PDF", &options, &PdfOptions::default()).unwrap_err();
    assert!(error.contains("cancelled"), "{error}");
}

#[test]
fn existing_text_requires_an_explicit_policy() {
    let first = recognize_pdf(&scanned_pdf(), &Options::default(), &PdfOptions::default()).unwrap();
    assert!(
        recognize_pdf(&first.pdf, &Options::default(), &PdfOptions::default())
            .unwrap_err()
            .contains("text")
    );
    let skipped = recognize_pdf(
        &first.pdf,
        &Options::default(),
        &PdfOptions {
            skip_text: true,
            ..PdfOptions::default()
        },
    )
    .unwrap();
    assert!(
        Document::load_mem(&skipped.pdf)
            .unwrap()
            .extract_text(&[1])
            .unwrap()
            .contains("HELLO")
    );
}

#[test]
fn malformed_documents_and_page_limits_are_rejected() {
    assert!(recognize_pdf(b"not a pdf", &Options::default(), &PdfOptions::default()).is_err());
    assert!(
        recognize_pdf(
            &scanned_pdf(),
            &Options::default(),
            &PdfOptions {
                max_pages: 0,
                ..PdfOptions::default()
            }
        )
        .is_err()
    );
}

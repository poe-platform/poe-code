use document_ast_rust::{Block, Document, Image, Inline, Paragraph, TextStyle};
use pdf_ast_rust::{Page, Paint, PdfDocument, PdfOptions, layout_document, serialize_pdf};

fn direct_layout(target: &str, anchors: &[(&str, usize, f64)]) -> PdfDocument {
    PdfDocument {
        pages: vec![
            Page {
                width: 200.,
                height: 300.,
                paints: vec![],
                links: vec![(target.into(), [12., 34., 56., 18.])],
            },
            Page {
                width: 200.,
                height: 300.,
                paints: vec![],
                links: vec![],
            },
        ],
        anchors: anchors
            .iter()
            .map(|(id, page, y)| ((*id).into(), (*page, *y)))
            .collect(),
        ..Default::default()
    }
}

fn assert_resolution(target: &str, anchors: &[(&str, usize, f64)], expected: Option<&str>) {
    let layout = direct_layout(target, anchors);
    let mut reference = layout.clone();
    if let Some(expected) = expected {
        reference
            .anchors
            .insert("reference-destination".into(), layout.anchors[expected]);
        reference.pages[0].links[0].0 = "#reference-destination".into();
    } else {
        reference.pages[0].links.clear();
    }
    let limits = PdfOptions::default().limits;
    let bytes = serialize_pdf(&layout, &limits).unwrap();
    assert!(
        bytes == serialize_pdf(&reference, &limits).unwrap(),
        "wrong destination for {target}"
    );
    let raw = String::from_utf8_lossy(&bytes);
    assert_eq!(
        raw.matches("/Subtype /Link").count(),
        usize::from(expected.is_some())
    );
    if expected.is_some() {
        assert!(raw.contains("/Rect [12.000 248.000 68.000 266.000]"));
    }
}

#[test]
fn typed_pdf_links_decode_fragment_identifiers_once_after_exact_lookup() {
    for target in ["#caf%C3%A9", "#caf%c3%a9"] {
        assert_resolution(target, &[("café", 1, 72.)], Some("café"));
    }
    assert_resolution(
        "#caf%C3%A9",
        &[("caf%C3%A9", 0, 40.), ("café", 1, 72.)],
        Some("caf%C3%A9"),
    );
    assert_resolution(
        "#part%2520two",
        &[("part%20two", 1, 80.), ("part two", 0, 50.)],
        Some("part%20two"),
    );
    assert_resolution(
        "#part%20two",
        &[("part%20two", 1, 80.), ("part two", 0, 50.)],
        Some("part%20two"),
    );
    assert_resolution("#part%2520two", &[("part two", 0, 50.)], None);
    assert_resolution("#a%2Bb", &[("a+b", 1, 90.), ("a b", 0, 60.)], Some("a+b"));
    assert_resolution("#a+b", &[("a b", 0, 60.)], None);
    assert_resolution("#caf%C3%A9", &[("cafe\u{301}", 1, 72.)], None);
}

#[test]
fn malformed_fragments_follow_url_decoding_without_inventing_destinations() {
    assert_resolution("#caf%C3%A9%GG", &[("café%GG", 1, 72.)], Some("café%GG"));
    assert_resolution(
        "#bad%2G%20tail",
        &[("bad%2G tail", 1, 75.)],
        Some("bad%2G tail"),
    );
    assert_resolution("#bad%C3%28", &[("bad�(", 1, 90.)], Some("bad�("));
    assert_resolution("#bad%FF%F0%9F", &[("bad��", 1, 100.)], Some("bad��"));
    for target in ["#missing", "#missing%20anchor", "#bad%FF", "#", "#bad%"] {
        assert_resolution(target, &[("other", 1, 30.)], None);
    }
}

#[test]
fn encoded_text_and_image_links_keep_their_real_hit_rectangles() {
    let image = Image {
        bytes: terminal_png_rust::png::encode(2, 2, &[255; 16]).unwrap(),
        mime: "image/png".into(),
        width: 40.,
        height: 30.,
        alt: String::new(),
        title: String::new(),
        link: Some("#part%2520two".into()),
    };
    let source = Document {
        title: String::new(),
        blocks: vec![
            Block::Paragraph(Paragraph {
                inlines: vec![
                    Inline::Text {
                        text: "Jump cafe".into(),
                        style: TextStyle {
                            link: Some("#caf%C3%A9".into()),
                            ..Default::default()
                        },
                    },
                    Inline::Image(image),
                ],
                ..Default::default()
            }),
            Block::Paragraph(Paragraph {
                id: "café".into(),
                inlines: vec![Inline::Text {
                    text: "First target".into(),
                    style: TextStyle::default(),
                }],
                ..Default::default()
            }),
            Block::Paragraph(Paragraph {
                id: "part%20two".into(),
                inlines: vec![Inline::Text {
                    text: "Second target".into(),
                    style: TextStyle::default(),
                }],
                ..Default::default()
            }),
        ],
    };
    let options = PdfOptions::default();
    let layout = layout_document(&source, &options).unwrap();
    assert_eq!(layout.pages.len(), 1);
    let page = &layout.pages[0];
    assert_eq!(page.links.len(), 2);
    let text = page
        .paints
        .iter()
        .find(|paint| matches!(paint, Paint::Text { text, .. } if text == "Jump cafe"))
        .unwrap();
    let Paint::Text { x, y, size, .. } = text else {
        unreachable!()
    };
    assert_eq!(page.links[0].1[0], *x);
    assert_eq!(page.links[0].1[1], y - size);
    assert_eq!(page.links[0].1[3], size * 1.3);
    let image = page
        .paints
        .iter()
        .find(|paint| matches!(paint, Paint::Image { .. }))
        .unwrap();
    let Paint::Image {
        x,
        y,
        width,
        height,
        ..
    } = image
    else {
        unreachable!()
    };
    assert_eq!(page.links[1].1, [*x, *y, *width, *height]);
    let mut reference = layout.clone();
    reference.pages[0].links[0].0 = "#café".into();
    reference.pages[0].links[1].0 = "#part%20two".into();
    let bytes = serialize_pdf(&layout, &options.limits).unwrap();
    assert!(bytes == serialize_pdf(&reference, &options.limits).unwrap());
    let raw = String::from_utf8_lossy(&bytes);
    assert_eq!(raw.matches("/Subtype /Link").count(), 2);
    for (_, [x, y, width, height]) in &page.links {
        assert!(raw.contains(&format!(
            "/Rect [{x:.3} {:.3} {:.3} {:.3}]",
            page.height - y - height,
            x + width,
            page.height - y
        )));
    }
}

#[test]
fn external_uri_fragments_remain_encoded_and_unmodified() {
    for uri in [
        "https://example.com/document#caf%C3%A9",
        "other.pdf#part%2520two",
        "https://example.com/?q=a+b#bad%FF",
    ] {
        let layout = direct_layout(uri, &[("café", 1, 72.)]);
        let bytes = serialize_pdf(&layout, &PdfOptions::default().limits).unwrap();
        let raw = String::from_utf8_lossy(&bytes);
        assert!(raw.contains(&format!("/URI ({uri})")));
        assert!(!raw.contains("/Dest ["));
    }
}

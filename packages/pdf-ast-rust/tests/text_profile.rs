use document_ast_rust::{Block, Document, Inline, Paragraph, TextStyle};
use pdf_ast_rust::{Paint, PdfOptions, layout_document, serialize_pdf, write_pdf};

fn document(text: &str) -> Document {
    Document {
        title: String::new(),
        blocks: vec![Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: text.into(),
                style: TextStyle::default(),
            }],
            ..Default::default()
        })],
    }
}

#[test]
fn unsupported_scripts_fail_explicitly_in_semantic_and_public_pdf_trees() {
    let options = PdfOptions::default();
    for text in [
        "مرحبا بالعالم",
        "שלום עולם",
        "سلام دنیا",
        "ߒߞߏ",
        "क्षि",
        "a\u{0301}",
        "а\u{0483}",
    ] {
        let error = write_pdf(&document(text))
            .err()
            .expect("unsupported text was silently painted");
        assert!(
            error.contains("Unsupported PDF script or combining sequence"),
            "{text}: {error}"
        );
        assert!(error.contains("text shaping is not available"), "{error}");

        let mut layout = layout_document(&document("Body"), &options).unwrap();
        let Paint::Text { text: painted, .. } = &mut layout.pages[0].paints[0] else {
            panic!("missing editable text paint");
        };
        *painted = text.into();
        let error = serialize_pdf(&layout, &options.limits)
            .err()
            .expect("direct display edit bypassed text admission");
        assert!(
            error.contains("Unsupported PDF script or combining sequence"),
            "{text}: {error}"
        );
    }
}

#[test]
fn supported_precomposed_latin_greek_cyrillic_and_symbols_remain_selectable() {
    let text = "Zażółć gęślą jaźń. déjà vu. Ελληνικά. Привет. → ✓ \u{1f50}\u{1fc6} \u{fffd}";
    let bytes = write_pdf(&document(text)).unwrap();
    let pdf = String::from_utf8_lossy(&bytes);
    assert!(pdf.contains("/ToUnicode"));
    for c in text.chars() {
        assert!(
            pdf.contains(&format!("<{:04X}>", c as u32)),
            "missing Unicode mapping for {c}"
        );
    }
}

#[test]
fn nonbreaking_spaces_remain_selectable_at_the_start_of_lines() {
    for space in ['\u{00a0}', '\u{2007}', '\u{202f}'] {
        let text = format!("{space}Body{space}");
        let layout = layout_document(&document(&text), &PdfOptions::default()).unwrap();
        let painted = layout
            .pages
            .iter()
            .flat_map(|page| &page.paints)
            .filter_map(|paint| {
                if let Paint::Text { text, .. } = paint {
                    Some(text.as_str())
                } else {
                    None
                }
            })
            .collect::<String>();
        assert_eq!(
            painted, text,
            "nonbreaking space U+{:04X} was discarded",
            space as u32
        );
    }
}

#[test]
fn nonbreaking_spaces_keep_words_together_when_the_group_fits() {
    let options = PdfOptions {
        page: pdf_ast_rust::PageBox {
            width: 125.,
            height: 300.,
            margin: 10.,
        },
        ..Default::default()
    };
    for space in ['\u{00a0}', '\u{2007}', '\u{202f}'] {
        let text = format!("prefix prefix alpha{space}beta");
        let layout = layout_document(&document(&text), &options).unwrap();
        let mut lines: Vec<(f64, String)> = vec![];
        for paint in &layout.pages[0].paints {
            if let Paint::Text { text, y, .. } = paint {
                if let Some((_, line)) = lines.last_mut().filter(|(baseline, _)| baseline == y) {
                    line.push_str(text);
                } else {
                    lines.push((*y, text.clone()));
                }
            }
        }
        assert!(lines.len() > 1, "fixture must wrap: {lines:?}");
        assert!(
            lines
                .iter()
                .any(|(_, line)| line.contains(&format!("alpha{space}beta"))),
            "nonbreaking group was split: {lines:?}"
        );
    }
}

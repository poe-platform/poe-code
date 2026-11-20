use document_ast_rust::{Block, Document, Inline, Paragraph, TextStyle, cooperate::block_on};
use pdf_ast_rust::{
    Paint, PdfOptions, SuppliedFont, layout_document, serialize_pdf, write_pdf,
    write_pdf_with_options, write_pdf_with_usage_async,
};
use terminal_png_rust::font::Font;

const SYMBOLS: &[u8] = include_bytes!("../src/fonts/DocumentSymbolFallback.ttf");
const DEJAVU: &[u8] = include_bytes!("../src/fonts/DejaVuSans.ttf");
const BODY: &[u8] = include_bytes!("../src/fonts/LiberationSans-Regular.ttf");

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
fn symbols_use_authentic_fallback_outlines_without_replacing_existing_faces() {
    let options = PdfOptions::default();
    let layout = layout_document(&document("Body ⚽ ⚾ ⑪ Ⓐ ⦿ ⮕ 😀"), &options).unwrap();
    assert_eq!(layout.fonts.len(), 3);
    for paint in &layout.pages[0].paints {
        let Paint::Text { text, font, .. } = paint else {
            continue;
        };
        let resource = &layout.fonts[*font];
        let expected = if text.contains('😀') {
            "DejaVuSans"
        } else if text.chars().any(|c| "⚽⚾⑪Ⓐ⦿⮕".contains(c)) {
            "DocumentSymbolFallback"
        } else {
            "LiberationSans"
        };
        assert_eq!(resource.id, expected, "{text}");
    }
    let symbols = Font::new(SYMBOLS).unwrap();
    for c in "⚽⚾⑪Ⓐ⦿⮕".chars() {
        let glyph = symbols.glyph_index(c as u32);
        assert_ne!(glyph, 0, "{c}");
        assert!(symbols.advance(glyph).unwrap() > 0);
        assert!(!symbols.outline(glyph).unwrap().is_empty());
    }
    assert_eq!(
        symbols.outline(symbols.glyph_index(0x26bd)).unwrap().len(),
        6
    );
    let bytes = serialize_pdf(&layout, &options.limits).unwrap();
    let raw = String::from_utf8_lossy(&bytes);
    assert!(raw.contains("/BaseFont /DocumentSymbolFallback"));
    assert!(raw.contains("<26BD>"));
    assert!(raw.contains("<D83DDE00>"));
}

#[test]
fn used_fallback_fonts_obey_exact_font_and_byte_budgets() {
    let input = document("Body ⚽ 😀");
    let mut options = PdfOptions::default();
    options.limits.fonts = 3;
    options.limits.font_bytes = BODY.len() + SYMBOLS.len() + DEJAVU.len();
    let rendered = block_on(write_pdf_with_usage_async(&input, &options)).unwrap();
    assert_eq!(rendered.usage.fonts, 3);
    assert_eq!(rendered.usage.font_bytes, options.limits.font_bytes);
    options.limits.font_bytes -= 1;
    assert!(
        write_pdf_with_options(&input, &options)
            .unwrap_err()
            .contains("fontBytes")
    );
    options.limits.font_bytes += 1;
    options.limits.fonts = 2;
    assert!(
        write_pdf_with_options(&input, &options)
            .unwrap_err()
            .contains("fonts")
    );

    options.limits.fonts = 1;
    options.limits.font_bytes = BODY.len();
    let ordinary = block_on(write_pdf_with_usage_async(&document("Body"), &options)).unwrap();
    assert_eq!(ordinary.usage.fonts, 1);
    assert_eq!(ordinary.usage.font_bytes, BODY.len());
}

#[test]
fn supplied_fonts_remain_exclusive_and_missing_glyphs_fail_explicitly() {
    let mut options = PdfOptions {
        fonts: vec![SuppliedFont {
            id: "body".into(),
            bytes: BODY.to_vec(),
        }],
        ..Default::default()
    };
    for (text, code) in [("⚽", "26BD"), ("😀", "1F600")] {
        let error = write_pdf_with_options(&document(text), &options).unwrap_err();
        assert_eq!(error, format!("No supplied PDF font covers U+{code}"));
    }
    options.fonts.push(SuppliedFont {
        id: "symbols".into(),
        bytes: SYMBOLS.to_vec(),
    });
    options.fonts.push(SuppliedFont {
        id: "emoticons".into(),
        bytes: DEJAVU.to_vec(),
    });
    write_pdf_with_options(&document("Body ⚽ 😀"), &options).unwrap();
    assert_eq!(
        write_pdf(&document("🙏")).unwrap_err(),
        "No supplied PDF font covers U+1F64F"
    );
    assert_eq!(
        write_pdf(&document("➕")).unwrap_err(),
        "No supplied PDF font covers U+2795"
    );
}

#[test]
fn covered_emoticons_have_outlines_and_utf16_mappings() {
    let font = Font::new(DEJAVU).unwrap();
    let text: String = (0x1f600..=0x1f64f)
        .filter(|&c| font.glyph_index(c) != 0)
        .map(|c| {
            let glyph = font.glyph_index(c);
            assert!(font.advance(glyph).unwrap() > 0);
            assert!(!font.outline(glyph).unwrap().is_empty());
            char::from_u32(c).unwrap()
        })
        .collect();
    assert_eq!(text.chars().count(), 63);
    let bytes = write_pdf(&document(&text)).unwrap();
    let pdf = String::from_utf8_lossy(&bytes);
    for c in text.chars() {
        let mut units = [0; 2];
        let mapping = c
            .encode_utf16(&mut units)
            .iter()
            .map(|u| format!("{u:04X}"))
            .collect::<String>();
        assert!(pdf.contains(&format!("<{mapping}>")), "{c}");
    }
}

#[test]
fn emoji_sequences_and_other_scripts_still_fail_in_both_public_trees() {
    let options = PdfOptions::default();
    for text in [
        "😀\u{200d}😀",
        "😀\u{fe0f}",
        "😀\u{1f3fb}",
        "a\u{301}",
        "東京",
    ] {
        assert!(write_pdf(&document(text)).is_err(), "{text}");
        let mut layout = layout_document(&document("😀"), &options).unwrap();
        let Paint::Text { text: painted, .. } = &mut layout.pages[0].paints[0] else {
            panic!("text")
        };
        *painted = text.into();
        assert!(serialize_pdf(&layout, &options.limits).is_err(), "{text}");
    }
}

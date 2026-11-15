#[test]
fn preserves_inline_fonts_and_layout() {
    use super::super::{pdf_docx::render_docx, pdf_render::win_ansi};
    use super::{PageSource, pdf_text_layout::Draw};
    let mut runs = vec![
        (String::new(), "  Plain ".to_owned(), "Helvetica"),
        ("<w:b/>".into(), "Bold".into(), "Helvetica-Bold"),
        ("<w:i/>".into(), "Italic".into(), "Helvetica-Oblique"),
        (
            "<w:b/><w:i/>".into(),
            "Both café € ".into(),
            "Helvetica-BoldOblique",
        ),
    ];
    for value in ["false", "0", "off", "true", "1", "on"] {
        let enabled = matches!(value, "true" | "1" | "on");
        runs.push((
            format!(r#"<w:b w:val="{value}"/><w:i w:val="{value}"/>"#),
            if enabled { "Enabled " } else { "Reset " }.into(),
            if enabled {
                "Helvetica-BoldOblique"
            } else {
                "Helvetica"
            },
        ));
    }
    runs.push(("<w:i/>".into(), "wrapped ".repeat(25), "Helvetica-Oblique"));
    runs.push((String::new(), "end".into(), "Helvetica"));
    for plain in [false, true] {
        for overflow in [false, true] {
            let prefix =
                "<w:p><w:r><w:t>Filler</w:t></w:r></w:p>".repeat(if overflow { 31 } else { 0 });
            let paragraph = runs
                .iter()
                .map(|(properties, text, _)| {
                    format!(
                        "<w:r><w:rPr>{}</w:rPr><w:t>{text}</w:t></w:r>",
                        if plain { "" } else { properties }
                    )
                })
                .collect::<String>();
            let xml = format!(
                r#"<w:document xmlns:w="w"><w:body>{prefix}<w:p/><w:p><w:r><w:br/></w:r>{paragraph}<w:r><w:br/><w:br/><w:t>Tail</w:t><w:cr/></w:r></w:p><w:p/><w:p><w:r><w:t>Last</w:t></w:r></w:p></w:body></w:document>"#
            );
            let input = crate::commands::structured::write_zip_stored(&[(
                "word/document.xml",
                xml.as_bytes(),
            )]);
            let bytes = render_docx(&input, "doc", None, 1 << 20).unwrap();
            let mut pdf = PageSource::open(&bytes, "").unwrap();
            assert_eq!(pdf.len(), if overflow { 2 } else { 1 });
            let mut glyphs = Vec::new();
            let mut codes = Vec::new();
            for index in 0..pdf.len() {
                let page = pdf.objects.page_dict(pdf.pages[index], &pdf.tree).unwrap();
                pdf.draw_page(&page, false, |event, _| {
                    if let Draw::Glyph {
                        code,
                        family,
                        size,
                        baseline,
                        ..
                    } = event
                    {
                        assert_eq!(size, 11.);
                        codes.push(code);
                        if code != 32 {
                            glyphs.push((code, family.to_string(), baseline));
                        }
                    }
                    Some(())
                })
                .unwrap();
            }
            let joined: Vec<_> = b"BoldItalicBoth"
                .iter()
                .map(|&code| u16::from(code))
                .collect();
            assert!(codes.windows(joined.len()).any(|window| window == joined));
            let mut expected = Vec::new();
            for _ in 0..if overflow { 31 } else { 0 } {
                expected.extend(
                    b"Filler"
                        .iter()
                        .map(|&code| (u16::from(code), "Helvetica".to_owned())),
                );
            }
            for (_, text, font) in &runs {
                expected.extend(win_ansi(text).into_iter().filter(|&code| code != 32).map(
                    |code| {
                        (
                            u16::from(code),
                            if plain { "Helvetica" } else { font }.to_string(),
                        )
                    },
                ));
            }
            expected.extend(
                b"TailLast"
                    .iter()
                    .map(|&code| (u16::from(code), "Helvetica".to_owned())),
            );
            assert_eq!(
                glyphs
                    .iter()
                    .map(|(code, font, _)| (*code, font.clone()))
                    .collect::<Vec<_>>(),
                expected
            );
            let body = &glyphs[if overflow { 31 * 6 } else { 0 }..];
            assert_eq!(body[0].2, if overflow { 720. } else { 685. });
            assert!(body.iter().any(|glyph| glyph.2 != body[0].2));
            assert_eq!(body.last().unwrap().2, if overflow { 590. } else { 555. });
        }
    }
}

#[test]
fn preserves_explicit_unicode_advances_across_font_transitions() {
    use super::super::{pdf_docx::render_docx, pdf_render::win_ansi};
    use super::{PageSource, Value, pdf_text_layout::Draw};
    let runs = [
        ("", "café € ", "Helvetica", 54.),
        ("<w:b/>", "naïve ", "Helvetica-Bold", 87.022),
        ("<w:i/>", "€ café ", "Helvetica-Oblique", 118.207),
        ("<w:b/><w:i/>", "élève", "Helvetica-BoldOblique", 151.229),
        ("", " END", "Helvetica", 178.751),
    ];
    let paragraph = runs
        .iter()
        .map(|(properties, text, _, _)| {
            format!(
                r#"<w:r><w:rPr>{properties}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>"#
            )
        })
        .collect::<String>();
    let xml =
        format!(r#"<w:document xmlns:w="w"><w:body><w:p>{paragraph}</w:p></w:body></w:document>"#);
    let input =
        crate::commands::structured::write_zip_stored(&[("word/document.xml", xml.as_bytes())]);
    let bytes = render_docx(&input, "doc", None, 1 << 20).unwrap();
    let mut pdf = PageSource::open(&bytes, "").unwrap();
    assert_eq!(pdf.len(), 1);
    let page = pdf.objects.page_dict(pdf.pages[0], &pdf.tree).unwrap();
    let mut glyphs = Vec::new();
    pdf.draw_page(&page, false, |event, _| {
        if let Draw::Glyph {
            code,
            family,
            size,
            matrix,
            ..
        } = event
        {
            assert_eq!(size, 11.);
            glyphs.push((code, family.to_string(), matrix[4]));
        }
        Some(())
    })
    .unwrap();
    let mut offset = 0;
    for (_, text, font, x) in runs {
        let codes = win_ansi(text);
        assert!((glyphs[offset].2 - x).abs() < 0.00001);
        for (glyph, code) in glyphs[offset..].iter().zip(&codes) {
            assert_eq!(glyph.0, u16::from(*code));
            if *code != 32 {
                assert_eq!(glyph.1, font);
            }
        }
        offset += codes.len();
    }
    assert_eq!(glyphs.len(), offset);
    let resources = pdf
        .objects
        .resolve(page.get(b"Resources").unwrap())
        .unwrap();
    let Value::Dict(fonts) = pdf
        .objects
        .resolve(resources.get(b"Font").unwrap())
        .unwrap()
    else {
        panic!("missing fonts")
    };
    assert_eq!(fonts.len(), 4);
    for (_, reference) in fonts {
        let font = pdf.objects.resolve(&reference).unwrap();
        assert_eq!(font.get(b"FirstChar").and_then(Value::number), Some(32.));
        assert_eq!(font.get(b"LastChar").and_then(Value::number), Some(255.));
        let Value::Array(widths) = pdf.objects.resolve(font.get(b"Widths").unwrap()).unwrap()
        else {
            panic!("missing widths")
        };
        assert_eq!(widths.len(), 224);
        assert_eq!(widths[0x80 - 32].number(), Some(556.));
    }
}

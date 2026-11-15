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
            let joined: Vec<_> = b"BoldItalicBoth".iter().map(|&code| u16::from(code)).collect();
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

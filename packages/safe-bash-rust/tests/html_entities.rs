use safe_bash_rust::document::{self, Block, Inline};

fn text(html: &str) -> String {
    let doc = document::from_html(html).unwrap();
    doc.blocks
        .iter()
        .flat_map(|block| match block {
            Block::Paragraph(p) => p.inlines.as_slice(),
            Block::Heading { inlines, .. } => inlines.as_slice(),
            _ => panic!("expected paragraph/heading"),
        })
        .map(|inline| match inline {
            Inline::Text { text, .. } => text.as_str(),
            _ => panic!("expected text"),
        })
        .collect()
}

#[test]
fn complete_named_references_keep_unicode_and_nonbreaking_spaces() {
    assert_eq!(
        text("<p>A &copy; &nbsp; &mdash; &eacute;</p>"),
        "A © \u{a0} — é"
    );
    assert_eq!(
        text("<p>&NotEqualTilde; &CounterClockwiseContourIntegral; &Afr;</p>"),
        "≂\u{338} ∳ 𝔄"
    );
    assert_eq!(
        text("<p>&nbsp;&nbsp;A&nbsp; <b>B</b>&nbsp;&nbsp;</p>"),
        "\u{a0}\u{a0}A\u{a0} B\u{a0}\u{a0}"
    );
    assert_eq!(
        text("<p>A&nbsp;&nbsp;B  C&#160;D</p>"),
        "A\u{a0}\u{a0}B\u{a0}\u{a0}C\u{a0}D"
    );
    assert_eq!(text("<p> A\t \n B\r\nC\u{c} D </p>"), "A B C D");
}

#[test]
fn named_references_decode_once_with_longest_legacy_match() {
    assert_eq!(
        text("<p>&copy &notit; &notin; &amp;lt; &bogus; &apos</p>"),
        "© ¬it; ∉ &lt; &bogus; &apos"
    );
    assert_eq!(
        text("<p>&lt;strong&gt;plain&lt;/strong&gt;</p>"),
        "<strong>plain</strong>"
    );
    assert_eq!(text("<p>&copy= &COPY; &ampx &AMP! &</p>"), "©= © &x &! &");
}

#[test]
fn attributes_apply_semicolonless_ambiguity_rule_without_losing_normal_entities() {
    for (source, expected) in [
        ("&notit;", "&notit;"),
        ("a&notit", "a&notit"),
        ("a&amp;b", "a&b"),
        ("&copy=", "&copy="),
        ("&ampx", "&ampx"),
        ("&copy!", "©!"),
        ("&notin;", "∉"),
        ("&eacute;", "é"),
        ("&amp;amp;", "&amp;"),
        ("&#65x", "Ax"),
    ] {
        for quote in ["'", "\"", ""] {
            let doc =
                document::from_html(&format!("<p><a href={quote}#{source}{quote}>Link</a></p>"))
                    .unwrap();
            let Block::Paragraph(p) = &doc.blocks[0] else {
                panic!()
            };
            let Inline::Text { style, .. } = &p.inlines[0] else {
                panic!()
            };
            assert_eq!(
                style.link.as_deref(),
                Some(format!("#{expected}").as_str()),
                "{source}, quote {quote}"
            );
        }
    }
    let doc = document::from_html("<h2 id='caf&eacute;'>Target</h2>").unwrap();
    assert!(matches!(&doc.blocks[0], Block::Heading { id, .. } if id == "café"));
}

#[test]
fn numeric_references_use_html_normalization_and_replacement() {
    assert_eq!(
        text("<p>&#128; &#x80; &#0; &#xD800; &#x110000; &#65 x</p>"),
        "€ € � � � A x"
    );
    assert_eq!(
        text("<p>&#x1F30D; &#X41 &#9999999999999999999999999;</p>"),
        "🌍 A �"
    );
    assert_eq!(
        text("<p>&#; &#x; &#-1; &#xGG; &incomplete</p>"),
        "&#; &#x; &#-1; &#xGG; &incomplete"
    );
    assert_eq!(text("<p>&#xA0;&#32;&#xA0;</p>"), "\u{a0} \u{a0}");
}

#[test]
fn decoded_entities_stay_decoded_in_word_and_preformatted_text() {
    let doc =
        document::from_html("<pre><code>&eacute; &nbsp; &amp;lt;\n  &#128;</code></pre>").unwrap();
    assert!(matches!(&doc.blocks[0], Block::Code { text, .. } if text == "é \u{a0} &lt;\n  €"));
    let bytes = document::write_docx(&doc).unwrap();
    let parts = safe_bash_rust::commands::codecs::parse_zip_archive(&bytes).unwrap();
    let xml = String::from_utf8(
        parts
            .into_iter()
            .find(|p| p.name == "word/document.xml")
            .unwrap()
            .content,
    )
    .unwrap();
    assert!(xml.contains("é \u{a0} &amp;lt;"));
    assert!(!xml.contains("&amp;eacute;"));
}

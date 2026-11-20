use document::{Direction, HtmlToken, TextStyle, append_html_text, html_tokens, raw_html_blocks};
use safe_bash_rust::document::{self, Block, Inline};
use std::collections::BTreeMap;

#[test]
fn normal_html_inherits_wrapper_font_styles_without_losing_inner_emphasis() {
    let document = document::from_html("<div style='color:#123456;font-weight:bold'><p>Outer <em>inner</em></p><blockquote><p>Quote</p></blockquote></div>").unwrap();
    let Block::Paragraph(p) = &document.blocks[0] else {
        panic!()
    };
    assert!(p.inlines.iter().all(|inline| matches!(inline, Inline::Text { style, .. } if style.bold && style.color.as_deref() == Some("123456"))));
    assert!(p.inlines.iter().any(
        |inline| matches!(inline, Inline::Text { text, style } if text == "inner" && style.italic)
    ));
    let Block::Quote { blocks, .. } = &document.blocks[1] else {
        panic!()
    };
    let Block::Paragraph(p) = &blocks[0] else {
        panic!()
    };
    assert!(
        matches!(&p.inlines[0], Inline::Text { style, .. } if style.bold && style.color.as_deref() == Some("123456"))
    );
}

#[test]
fn normal_html_attribute_names_are_ascii_case_insensitive() {
    let document =
        document::from_html("<P ID='target'>A</P><P><A HREF='#target'>LINK</A></P>").unwrap();
    let Block::Paragraph(target) = &document.blocks[0] else {
        panic!()
    };
    assert_eq!(target.id, "target");
    let Block::Paragraph(link) = &document.blocks[1] else {
        panic!()
    };
    assert!(
        matches!(&link.inlines[0], Inline::Text { style, .. } if style.link.as_deref() == Some("#target"))
    );
}

#[test]
fn html_style_values_reset_inheritance_and_match_ascii_case() {
    let document = document::from_html("<div style='font-weight:BOLD;font-style:ITALIC;color:RED;text-align:CENTER'><p>Styled <span style='font-weight:normal;font-style:normal'>Reset</span></p><p style='text-align:left'>Left</p></div>").unwrap();
    let Block::Paragraph(p) = &document.blocks[0] else {
        panic!()
    };
    assert_eq!(p.align, document::Align::Center);
    assert!(
        matches!(&p.inlines[0], Inline::Text { style, .. } if style.bold && style.italic && style.color.as_deref() == Some("FF0000"))
    );
    assert!(
        matches!(&p.inlines[1], Inline::Text { text, style } if text == "Reset" && !style.bold && !style.italic)
    );
    let Block::Paragraph(p) = &document.blocks[1] else {
        panic!()
    };
    assert_eq!(p.align, document::Align::Left);
}

#[test]
fn html_block_links_are_inherited_by_text_and_images() {
    let bytes = terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap();
    let resources = BTreeMap::from([("a.png".into(), bytes)]);
    let blocks = raw_html_blocks(
        "<a href='https://example.com?a=1&amp;b=2'><p>First</p><p><img src='a.png'></p></a>",
        &resources,
        &TextStyle::default(),
    )
    .unwrap();
    let Block::Paragraph(p) = &blocks[0] else {
        panic!()
    };
    assert!(
        matches!(&p.inlines[0], Inline::Text { style, .. } if style.link.as_deref() == Some("https://example.com?a=1&b=2"))
    );
    let Block::Paragraph(p) = &blocks[1] else {
        panic!()
    };
    assert!(
        matches!(&p.inlines[0], Inline::Image(image) if image.link.as_deref() == Some("https://example.com?a=1&b=2"))
    );
}

#[test]
fn raw_tokens_retain_source_ranges_quotes_entities_and_first_attributes() {
    let source = "<!-- invisible --><SPAN ID='first' id='second' title='a > b' style='color:#123456'> A &amp; B </SPAN>";
    let tokens = html_tokens(source).unwrap();
    assert_eq!(tokens.len(), 3);
    let (range, HtmlToken::Open(scope)) = &tokens[0] else {
        panic!()
    };
    assert_eq!(
        &source[range.clone()],
        "<SPAN ID='first' id='second' title='a > b' style='color:#123456'>"
    );
    assert_eq!(scope.tag(), "span");
    let style = scope.inline_style(&TextStyle::default()).unwrap();
    assert_eq!(style.color.as_deref(), Some("123456"));
    assert!(matches!(&tokens[1].1, HtmlToken::Text(t) if t == " A & B "));
    assert!(matches!(&tokens[2].1, HtmlToken::Close(t) if t == "span"));
    let runs = scope
        .finish_inlines(vec![], &style, &BTreeMap::new())
        .unwrap();
    assert!(matches!(&runs[0], Inline::Anchor(id) if id == "first"));
}

#[test]
fn raw_inline_scope_keeps_whitespace_anchor_direction_and_link() {
    let tokens = html_tokens("<a id='target' href='#target' dir='rtl' style='color:red'>").unwrap();
    let HtmlToken::Open(scope) = &tokens[0].1 else {
        panic!()
    };
    let style = scope.inline_style(&TextStyle::default()).unwrap();
    let mut children = vec![Inline::Text {
        text: "Before".into(),
        style: style.clone(),
    }];
    append_html_text(&mut children, "  after ", &style, None);
    let runs = scope
        .finish_inlines(children, &style, &BTreeMap::new())
        .unwrap();
    assert!(matches!(&runs[0], Inline::Anchor(id) if id == "target"));
    let Inline::Direction {
        direction: Direction::Rtl,
        inlines,
        ..
    } = &runs[1]
    else {
        panic!()
    };
    assert!(
        matches!(&inlines[0], Inline::Text { text, style } if text == "Before after " && style.link.as_deref() == Some("#target") && style.color.as_deref() == Some("FF0000"))
    );
    let tokens = html_tokens("<br>").unwrap();
    let HtmlToken::Open(scope) = &tokens[0].1 else {
        panic!()
    };
    assert!(scope.is_void());
    assert!(matches!(
        scope
            .finish_inlines(vec![], &style, &BTreeMap::new())
            .unwrap()[0],
        Inline::Break
    ));
    let mut after_word = Vec::new();
    append_html_text(&mut after_word, " two", &style, Some('e'));
    assert!(matches!(&after_word[0], Inline::Text {text, ..} if text == " two"));
    let mut after_space = Vec::new();
    append_html_text(&mut after_space, " two", &style, Some(' '));
    assert!(matches!(&after_space[0], Inline::Text {text, ..} if text == "two"));
}

#[test]
fn complete_raw_islands_preserve_tables_code_and_supplied_resource_bytes() {
    let bytes = terminal_png_rust::png::encode(2, 1, &[255, 0, 0, 255, 0, 255, 0, 255]).unwrap();
    let resources = BTreeMap::from([("images/a&b.png".into(), bytes.clone())]);
    let blocks = raw_html_blocks("<div><table style='color:blue'><tr><th>Header</th><td>Value</td></tr></table><pre><code>a &lt; b\n  c</code></pre><p><img src='images/a&amp;b.png' width=' 4 ' alt='sample'></p></div>", &resources, &TextStyle::default()).unwrap();
    let Block::Table { rows, .. } = &blocks[0] else {
        panic!()
    };
    assert!(rows[0].cells[0].header);
    let Block::Paragraph(p) = &rows[0].cells[1].blocks[0] else {
        panic!()
    };
    assert!(
        matches!(&p.inlines[0], Inline::Text { style, .. } if style.color.as_deref() == Some("0000FF"))
    );
    assert!(matches!(&blocks[1], Block::Code { text, .. } if text == "a < b\n  c"));
    let Block::Paragraph(p) = &blocks[2] else {
        panic!()
    };
    assert!(
        matches!(&p.inlines[0], Inline::Image(image) if image.bytes == bytes && image.width == 4. && image.height == 2. && image.alt == "sample")
    );
    assert!(
        raw_html_blocks("<!-- note -->", &resources, &TextStyle::default())
            .unwrap()
            .is_empty()
    );
    assert!(
        raw_html_blocks("<img src='missing.png'>", &resources, &TextStyle::default())
            .unwrap_err()
            .contains("resource")
    );
}

#[test]
fn split_block_wrappers_reuse_quote_anchor_direction_and_alignment() {
    let tokens =
        html_tokens("<blockquote id='quote' dir='rtl' style='text-align:right;color:red'>")
            .unwrap();
    let HtmlToken::Open(scope) = &tokens[0].1 else {
        panic!()
    };
    let style = scope.inline_style(&TextStyle::default()).unwrap();
    let content = vec![Block::Paragraph(document::Paragraph {
        inlines: vec![Inline::Text {
            text: "Quoted".into(),
            style,
        }],
        ..Default::default()
    })];
    let blocks = scope.finish_blocks(content).unwrap();
    let Block::Direction {
        direction: Direction::Rtl,
        blocks,
    } = &blocks[0]
    else {
        panic!()
    };
    let Block::Quote { blocks, .. } = &blocks[0] else {
        panic!()
    };
    let Block::Paragraph(p) = &blocks[0] else {
        panic!()
    };
    assert_eq!(p.align, document::Align::Right);
    assert_eq!(p.id, "quote");
    for tag in ["table", "ul", "pre", "span"] {
        let tokens = html_tokens(&format!("<{tag}>")).unwrap();
        let HtmlToken::Open(scope) = &tokens[0].1 else {
            panic!()
        };
        assert!(scope.finish_blocks(vec![]).is_err(), "{tag}");
    }
    assert!(
        scope
            .finish_inlines(vec![], &TextStyle::default(), &BTreeMap::new())
            .is_err()
    );
}

#[test]
fn raw_admission_refuses_silent_drops_and_malformed_markup_only_on_raw_path() {
    for html in [
        "<script>alert(1)</script>",
        "<style>p{color:red}</style>",
        "<input>",
        "<button>press</button>",
        "<custom>text</custom>",
        "<span onclick='go()'>x</span>",
        "<a href='java&#x73;cript:go()'>x</a>",
        "<span style='display:none'>hidden</span>",
        "<span style='color:unrecognized'>x</span>",
        "<img src='a' width='20%'>",
        "<span title='unclosed>",
        "<!-- unclosed",
        "<!DOCTYPE html>",
    ] {
        assert!(html_tokens(html).is_err(), "{html}");
    }
    for html in [
        "<p><strong>x</p></strong>",
        "<div><p>unclosed</p>",
        "</div>",
    ] {
        assert!(
            raw_html_blocks(html, &BTreeMap::new(), &TextStyle::default()).is_err(),
            "{html}"
        );
    }
    assert!(document::from_html("<custom>text</custom><script>ignored</script>").is_ok());
}

#[test]
fn raw_islands_reject_structural_content_that_the_semantic_lowerer_cannot_preserve() {
    for html in [
        "<table><p>Lost</p></table>",
        "<ul>Lost<li>Kept</li></ul>",
        "<tr><td>Orphan</td></tr>",
        "<pre><strong>Formatting</strong></pre>",
        "<pre><code id='lost'>Anchor</code></pre>",
        "<a href='#outer'><a href='#inner'>Nested</a></a>",
    ] {
        assert!(
            raw_html_blocks(html, &BTreeMap::new(), &TextStyle::default()).is_err(),
            "{html}"
        );
    }
}

#[test]
fn raw_image_expansion_is_bounded_before_repeated_resources_are_cloned() {
    let resources = BTreeMap::from([("large.png".into(), vec![0; 33 * 1024 * 1024])]);
    let error = raw_html_blocks(
        "<img src='large.png'><img src='large.png'>",
        &resources,
        &TextStyle::default(),
    )
    .unwrap_err();
    assert!(
        error.starts_with("E_LIMIT: HTML image byte limit"),
        "{error}"
    );
}

#[test]
fn raw_presentation_values_must_be_supported_by_the_lowerer() {
    for value in ["50%", "2em", "2rem", "auto", "0", "NaN", "100001"] {
        assert!(
            html_tokens(&format!("<img src='a.png' width='{value}'>")).is_err(),
            "{value}"
        );
        assert!(
            html_tokens(&format!("<img src='a.png' style='height:{value}'>")).is_err(),
            "{value}"
        );
    }
    for html in [
        "<span style='font-weight:bolder'>",
        "<span style='font-style:oblique'>",
        "<tr style='text-align:center'>",
        "<h1 style='text-align:right'>",
        "<col id='lost'>",
    ] {
        assert!(html_tokens(html).is_err(), "{html}");
    }
}

#[test]
fn raw_links_allow_relative_colons_but_nonvoid_self_closing_tags_are_rejected() {
    for href in ["?next=https:example.com", "notes/part:two.md", "#part:two"] {
        assert!(html_tokens(&format!("<a href='{href}'>")).is_ok(), "{href}");
    }
    for html in ["<strong/>", "<span />", "<div/>"] {
        assert!(html_tokens(html).is_err(), "{html}");
    }
    assert!(html_tokens("<img src='a.png'/>").is_ok());
}

#[test]
fn raw_header_bold_resets_fail_instead_of_publishing_unchanged_heading_styles() {
    for html in [
        "<h1 style='font-weight:normal'>Heading</h1>",
        "<table><tr><th><span style='font-weight:400'>Cell</span></th></tr></table>",
        "<table><thead><tr><td style='font-weight:normal'>Header</td></tr></thead></table>",
        "<table><tr><td role='rowheader'><span style='font-weight:normal'>Header</span></td></tr></table>",
    ] {
        let error = raw_html_blocks(html, &BTreeMap::new(), &TextStyle::default()).unwrap_err();
        assert!(
            error.contains("header") && error.contains("weight"),
            "{error}"
        );
    }
}

#[test]
fn raw_code_blocks_refuse_inherited_styles_and_links_the_code_ast_cannot_store() {
    for html in [
        "<div style='color:red'><pre>Code</pre></div>",
        "<strong><pre>Code</pre></strong>",
        "<a href='https://example.com'><pre>Code</pre></a>",
    ] {
        let error = raw_html_blocks(html, &BTreeMap::new(), &TextStyle::default()).unwrap_err();
        assert!(error.contains("code") && error.contains("style"), "{error}");
    }
    let inherited = TextStyle {
        italic: true,
        ..Default::default()
    };
    assert!(raw_html_blocks("<pre><code>Code</code></pre>", &BTreeMap::new(), &inherited).is_err());
    assert!(
        raw_html_blocks(
            "<pre><code>Code</code></pre>",
            &BTreeMap::new(),
            &TextStyle::default()
        )
        .is_ok()
    );
    assert!(document::from_html("<div style='color:red'><pre>Code</pre></div>").is_ok());
}

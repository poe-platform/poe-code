use document_ast_rust::*;
fn text(value: &str) -> Inline {
    Inline::Text {
        text: value.into(),
        style: Default::default(),
    }
}
fn paragraph(inlines: Vec<Inline>) -> Block {
    Block::Paragraph(Paragraph {
        inlines,
        ..Default::default()
    })
}
fn part(package: &docx_ast_rust::Package, name: &str) -> String {
    String::from_utf8(
        package
            .parts
            .iter()
            .find(|p| p.name == name)
            .unwrap()
            .bytes
            .clone(),
    )
    .unwrap()
}
#[test]
fn native_notes_have_owned_relationships_and_body_references() {
    let note = vec![paragraph(vec![
        text("Footnote "),
        Inline::Text {
            text: "link".into(),
            style: TextStyle {
                link: Some("https://example.com".into()),
                ..Default::default()
            },
        },
    ])];
    let d = Document {
        title: "Title".into(),
        blocks: vec![paragraph(vec![text("Main"), Inline::Note(note)])],
    };
    let p = docx_ast_rust::to_package(&d).unwrap();
    let body = part(&p, "word/document.xml");
    assert!(body.contains("<w:footnoteReference w:id=\"1\"/>"));
    assert!(!body.contains("Footnote "));
    let notes = part(&p, "word/footnotes.xml");
    assert!(notes.contains("<w:footnote w:id=\"1\">"));
    assert!(notes.contains("<w:footnoteRef/>"));
    assert!(notes.contains("Footnote "));
    assert!(part(&p, "word/_rels/footnotes.xml.rels").contains("https://example.com"));
    assert!(part(&p, "word/_rels/document.xml.rels").contains("Target=\"footnotes.xml\""));
}
#[test]
fn raw_openxml_is_validated_before_serialization() {
    let mut d = Document {
        title: String::new(),
        blocks: vec![paragraph(vec![Inline::RawOpenXml("<w:r>".into())])],
    };
    assert!(docx_ast_rust::write_docx(&d).unwrap_err().contains("XML"));
    d.blocks = vec![paragraph(vec![Inline::RawOpenXml(
        "<w:r><w:rPr><w:b/></w:rPr><w:t>raw</w:t></w:r>".into(),
    )])];
    assert!(
        part(&docx_ast_rust::to_package(&d).unwrap(), "word/document.xml")
            .contains("<w:rPr><w:b/></w:rPr><w:t>raw</w:t>")
    );
}
#[test]
fn plain_and_loose_list_paragraphs_keep_their_distinction() {
    let d = Document {
        title: String::new(),
        blocks: vec![Block::List {
            start: None,
            style: Default::default(),
            delimiter: Default::default(),
            items: vec![
                vec![Block::Paragraph(Paragraph {
                    inlines: vec![text("tight")],
                    compact: true,
                    ..Default::default()
                })],
                vec![paragraph(vec![text("loose")])],
            ],
        }],
    };
    let p = docx_ast_rust::to_package(&d).unwrap();
    let body = part(&p, "word/document.xml");
    assert_eq!(body.matches("<w:pStyle w:val=\"Compact\"/>").count(), 1);
    assert!(part(&p, "word/styles.xml").contains("<w:spacing w:before=\"0\" w:after=\"0\"/>"));
}

#[test]
fn body_defaults_use_modern_word_theme() {
    let d = Document {
        title: String::new(),
        blocks: vec![paragraph(vec![text("Body")])],
    };
    let styles = part(&docx_ast_rust::to_package(&d).unwrap(), "word/styles.xml");
    let defaults = styles.split("</w:docDefaults>").next().unwrap();
    assert!(defaults.contains("w:asciiTheme=\"minorHAnsi\""));
    assert!(defaults.contains("w:hAnsiTheme=\"minorHAnsi\""));
    assert!(defaults.contains("w:sz w:val=\"24\""));
    assert!(defaults.contains("w:after=\"160\" w:line=\"276\""));
    assert!(!defaults.contains("Times New Roman"));
    assert!(defaults.contains("<w:color w:val=\"auto\"/>"));
    let package = docx_ast_rust::to_package(&d).unwrap();
    let theme = part(&package, "word/theme/theme1.xml");
    assert!(theme.contains("<a:majorFont><a:latin typeface=\"Aptos Display\"/>"));
    assert!(theme.contains("<a:minorFont><a:latin typeface=\"Aptos\"/>"));
    assert!(
        part(&package, "word/_rels/document.xml.rels")
            .contains("/theme\" Target=\"theme/theme1.xml\"")
    );
    assert!(
        part(&package, "[Content_Types].xml")
            .contains("application/vnd.openxmlformats-officedocument.theme+xml")
    );
    assert!(styles.contains("w:asciiTheme=\"majorHAnsi\""));
    assert!(!defaults.contains("<w:b/>"));
    assert!(!defaults.contains("<w:i/>"));
}

#[test]
fn quotes_in_lists_emit_one_indentation_property() {
    let d = Document {
        title: String::new(),
        blocks: vec![Block::List {
            start: None,
            style: Default::default(),
            delimiter: Default::default(),
            items: vec![vec![
                paragraph(vec![text("item")]),
                Block::Quote {
                    kind: None,
                    blocks: vec![paragraph(vec![text("quoted continuation")])],
                },
            ]],
        }],
    };
    let body = part(&docx_ast_rust::to_package(&d).unwrap(), "word/document.xml");
    for properties in body.split("<w:pPr>").skip(1) {
        assert!(
            properties
                .split("</w:pPr>")
                .next()
                .unwrap()
                .matches("<w:ind ")
                .count()
                <= 1
        );
    }
}
#[test]
fn numbering_definitions_precede_number_instances() {
    let list = || Block::List {
        start: Some(1),
        style: Default::default(),
        delimiter: Default::default(),
        items: vec![vec![paragraph(vec![text("item")])]],
    };
    let d = Document {
        title: String::new(),
        blocks: vec![list(), list()],
    };
    let numbering = part(
        &docx_ast_rust::to_package(&d).unwrap(),
        "word/numbering.xml",
    );
    assert!(numbering.rfind("</w:abstractNum>").unwrap() < numbering.find("<w:num ").unwrap());
}
#[test]
fn horizontal_rule_has_a_reader_compatible_border_only_paragraph() {
    let d = Document {
        title: String::new(),
        blocks: vec![Block::Rule],
    };
    let body = part(&docx_ast_rust::to_package(&d).unwrap(), "word/document.xml");
    assert!(body.contains("<w:p><w:pPr><w:pBdr><w:bottom "));
    assert!(body.contains("/></w:pBdr></w:pPr></w:p>"));
}

#[test]
fn async_package_builder_yields_within_large_text_and_matches_sync_output() {
    use std::{
        future::Future,
        pin::pin,
        task::{Context, Poll, Waker},
    };
    let d = Document {
        title: String::new(),
        blocks: vec![paragraph(vec![text(&"A & B ".repeat(12000))])],
    };
    let expected = docx_ast_rust::write_docx(&d).unwrap();
    let mut future = pin!(docx_ast_rust::to_package_async(&d));
    let mut context = Context::from_waker(Waker::noop());
    let mut yields = 0;
    let actual = loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(result) => break result.unwrap().write().unwrap(),
            Poll::Pending => yields += 1,
        }
    };
    assert!(
        yields >= 16,
        "one large run must yield during text serialization"
    );
    assert_eq!(actual, expected);
}

#[test]
fn loose_list_continuation_keeps_indentation_without_another_marker() {
    let d = Document {
        title: String::new(),
        blocks: vec![Block::List {
            start: None,
            style: Default::default(),
            delimiter: Default::default(),
            items: vec![
                vec![
                    paragraph(vec![text("First item")]),
                    paragraph(vec![text("Continuation paragraph")]),
                ],
                vec![paragraph(vec![text("Second item")])],
            ],
        }],
    };
    let body = part(&docx_ast_rust::to_package(&d).unwrap(), "word/document.xml");
    let continuation = body
        .split("<w:p>")
        .find(|p| p.contains("Continuation paragraph"))
        .unwrap();
    let properties = continuation.split("</w:pPr>").next().unwrap();
    assert!(properties.contains("<w:ind w:left=\"360\"/>"));
    assert!(!properties.contains("<w:numPr>"));
    assert_eq!(body.matches("<w:numPr>").count(), 2);
}

#[test]
fn image_hyperlinks_use_the_owning_document_or_note_relationships() {
    let image = |link: &str| Image {
        bytes: vec![137, 80, 78, 71],
        mime: "image/png".into(),
        width: 20.,
        height: 10.,
        alt: "Preview".into(),
        title: String::new(),
        link: Some(link.into()),
    };
    let d = Document {
        title: String::new(),
        blocks: vec![paragraph(vec![
            Inline::Image(image("https://example.com/report?a=1&b=2")),
            Inline::Image(image("#section")),
            Inline::Note(vec![paragraph(vec![Inline::Image(image(
                "https://example.com/note",
            ))])]),
        ])],
    };
    let p = docx_ast_rust::to_package(&d).unwrap();
    let body = part(&p, "word/document.xml");
    assert_eq!(body.matches("<w:hyperlink ").count(), 2);
    assert!(body.contains("<w:hyperlink w:anchor=\"section\"><w:r><w:drawing"));
    assert!(body.contains("</w:drawing></w:r></w:hyperlink>"));
    let body_rels = part(&p, "word/_rels/document.xml.rels");
    assert!(body_rels.contains("Target=\"https://example.com/report?a=1&amp;b=2\""));
    assert!(!body_rels.contains("https://example.com/note"));
    let notes = part(&p, "word/footnotes.xml");
    assert!(notes.contains("<w:hyperlink r:id="));
    assert!(notes.contains("</w:drawing></w:r></w:hyperlink>"));
    assert!(
        part(&p, "word/_rels/footnotes.xml.rels").contains("Target=\"https://example.com/note\"")
    );
    assert_eq!(
        p.parts
            .iter()
            .filter(|p| p.name.starts_with("word/media/"))
            .count(),
        1
    );
}

#[test]
fn word_embeds_legacy_raster_formats_without_reencoding() {
    for (mime, extension) in [
        ("image/gif", "gif"),
        ("image/bmp", "bmp"),
        ("image/tiff", "tiff"),
    ] {
        let bytes = vec![1, 2, 3, 4];
        let d = Document {
            title: String::new(),
            blocks: vec![Block::Image(Image {
                bytes: bytes.clone(),
                mime: mime.into(),
                width: 20.,
                height: 10.,
                alt: String::new(),
                title: String::new(),
                link: None,
            })],
        };
        let p = docx_ast_rust::to_package(&d).unwrap();
        assert_eq!(
            p.parts
                .iter()
                .find(|p| p.name == format!("word/media/image-1.{extension}"))
                .unwrap()
                .bytes,
            bytes
        );
        assert!(
            part(&p, "[Content_Types].xml")
                .contains(&format!("Extension=\"{extension}\" ContentType=\"{mime}\""))
        );
    }
}

#[test]
fn code_first_list_items_use_their_own_numbered_paragraph() {
    let code = || Block::Code {
        language: String::new(),
        text: "foo".into(),
    };
    let d = Document {
        title: String::new(),
        blocks: vec![Block::List {
            start: None,
            style: Default::default(),
            delimiter: Default::default(),
            items: vec![
                vec![code()],
                vec![code(), paragraph(vec![text("Continuation")])],
            ],
        }],
    };
    let body = part(&docx_ast_rust::to_package(&d).unwrap(), "word/document.xml");
    assert_eq!(
        body.matches("<w:p>").count(),
        3,
        "code list items must not gain empty marker paragraphs"
    );
    assert_eq!(
        body.matches("<w:pStyle w:val=\"SourceCode\"/><w:numPr>")
            .count(),
        2
    );
    assert_eq!(body.matches("<w:numPr>").count(), 2);
    let continuation = body
        .split("<w:p>")
        .find(|p| p.contains("Continuation"))
        .unwrap();
    assert!(!continuation.contains("<w:numPr>"));
    assert!(continuation.contains("<w:ind w:left=\"360\"/>"));
}

#[test]
fn caption_paragraph_can_stay_with_the_following_table() {
    let d = Document {
        title: String::new(),
        blocks: vec![
            Block::Paragraph(Paragraph {
                inlines: vec![text("Table caption")],
                align: Align::Center,
                keep_with_next: true,
                ..Default::default()
            }),
            Block::Table {
                width: None,
                column_widths: Vec::new(),
                rows: vec![TableRow {
                    header: false,
                    cells: vec![TableCell {
                        header: false,
                        blocks: vec![paragraph(vec![text("Cell")])],
                        align: Align::Default,
                        colspan: 1,
                        rowspan: 1,
                    }],
                }],
            },
            paragraph(vec![text("Following prose")]),
        ],
    };
    let body = part(&docx_ast_rust::to_package(&d).unwrap(), "word/document.xml");
    assert!(body.contains("<w:pStyle w:val=\"BodyText\"/><w:keepNext/><w:jc w:val=\"center\"/>"));
    assert_eq!(body.matches("<w:keepNext/>").count(), 1);
}

#[test]
fn leading_list_anchors_do_not_take_the_visible_items_number() {
    let anchor = |id: &str| {
        Block::Paragraph(Paragraph {
            id: format!("{id}-container"),
            inlines: vec![Inline::Anchor(id.into())],
            ..Default::default()
        })
    };
    let d = Document {
        title: String::new(),
        blocks: vec![Block::List {
            start: None,
            style: Default::default(),
            delimiter: Default::default(),
            items: vec![
                vec![
                    anchor("code-item"),
                    Block::Code {
                        language: String::new(),
                        text: "code".into(),
                    },
                ],
                vec![anchor("text-item"), paragraph(vec![text("text")])],
                vec![anchor("empty-item")],
            ],
        }],
    };
    let body = part(&docx_ast_rust::to_package(&d).unwrap(), "word/document.xml");
    assert_eq!(body.matches("<w:p>").count(), 3);
    assert_eq!(body.matches("<w:numPr>").count(), 3);
    assert!(body.contains("<w:pStyle w:val=\"SourceCode\"/><w:numPr>"));
    for id in ["code-item", "text-item", "empty-item"] {
        assert!(body.contains(&format!("w:name=\"{id}\"")));
        assert!(body.contains(&format!("w:name=\"{id}-container\"")));
    }
    let empty = body
        .split("<w:p>")
        .find(|p| p.contains("w:name=\"empty-item\""))
        .unwrap();
    assert!(
        empty.contains("<w:numPr>"),
        "an entirely empty anchored item still needs its marker"
    );
}

#[test]
fn list_anchor_placement_preserves_the_footnote_reference() {
    let d = Document {
        title: String::new(),
        blocks: vec![paragraph(vec![Inline::Note(vec![
            paragraph(vec![Inline::Anchor("note".into())]),
            Block::List {
                start: None,
                style: Default::default(),
                delimiter: Default::default(),
                items: vec![vec![
                    paragraph(vec![Inline::Anchor("note-code".into())]),
                    Block::Code {
                        language: String::new(),
                        text: "code".into(),
                    },
                ]],
            },
        ])])],
    };
    let notes = part(
        &docx_ast_rust::to_package(&d).unwrap(),
        "word/footnotes.xml",
    );
    assert_eq!(notes.matches("<w:p>").count(), 2);
    assert_eq!(notes.matches("<w:footnoteRef/>").count(), 1);
    assert_eq!(notes.matches("<w:numPr>").count(), 1);
    assert!(notes.contains("<w:pStyle w:val=\"SourceCode\"/><w:numPr>"));
    assert!(notes.contains("w:name=\"note\""));
    assert!(notes.contains("w:name=\"note-code\""));
}

#[test]
fn quote_first_list_items_number_the_quoted_paragraph() {
    let d = Document {
        title: String::new(),
        blocks: vec![Block::Quote {
            kind: None,
            blocks: vec![Block::List {
                start: Some(1),
                style: Default::default(),
                delimiter: Default::default(),
                items: vec![vec![Block::Quote {
                    kind: None,
                    blocks: vec![
                        paragraph(vec![text("Blockquote continued here.")]),
                        paragraph(vec![text("Second paragraph")]),
                    ],
                }]],
            }],
        }],
    };
    let body = part(&docx_ast_rust::to_package(&d).unwrap(), "word/document.xml");
    assert_eq!(
        body.matches("<w:p>").count(),
        2,
        "a quote-first item must not gain an empty marker paragraph"
    );
    assert_eq!(body.matches("<w:numPr>").count(), 1);
    assert!(body.contains("<w:pStyle w:val=\"BlockText\"/><w:numPr>"));
    let continuation = body
        .split("<w:p>")
        .find(|p| p.contains("Second paragraph"))
        .unwrap();
    assert!(!continuation.contains("<w:numPr>"));
}

#[test]
fn quote_first_list_items_keep_one_marker_for_titles_and_empty_quotes() {
    let d = Document {
        title: String::new(),
        blocks: vec![Block::List {
            start: None,
            style: Default::default(),
            delimiter: Default::default(),
            items: vec![
                vec![Block::Quote {
                    kind: Some("Note".into()),
                    blocks: vec![paragraph(vec![text("Callout body")])],
                }],
                vec![Block::Quote {
                    kind: None,
                    blocks: Vec::new(),
                }],
            ],
        }],
    };
    let body = part(&docx_ast_rust::to_package(&d).unwrap(), "word/document.xml");
    assert_eq!(body.matches("<w:p>").count(), 3);
    assert_eq!(body.matches("<w:numPr>").count(), 2);
    let title = body
        .split("<w:p>")
        .find(|p| p.contains(">Note</w:t>"))
        .unwrap();
    assert!(title.contains("<w:numPr>"));
    let content = body
        .split("<w:p>")
        .find(|p| p.contains("Callout body"))
        .unwrap();
    assert!(!content.contains("<w:numPr>"));
}

#[test]
fn word_rejects_nested_notes_in_paragraphs_and_note_tables() {
    let nested = paragraph(vec![
        text("Outer "),
        Inline::Note(vec![paragraph(vec![text("Inner")])]),
    ]);
    let table = Block::Table {
        width: None,
        column_widths: Vec::new(),
        rows: vec![TableRow {
            header: false,
            cells: vec![TableCell {
                header: false,
                blocks: vec![nested.clone()],
                align: Align::Default,
                colspan: 1,
                rowspan: 1,
            }],
        }],
    };
    for content in [nested, table] {
        let d = Document {
            title: String::new(),
            blocks: vec![paragraph(vec![text("Main"), Inline::Note(vec![content])])],
        };
        let result = docx_ast_rust::write_docx(&d);
        assert!(
            result.is_err(),
            "Word must reject a footnote reference inside another footnote"
        );
        assert_eq!(
            result.unwrap_err(),
            "Nested footnotes are not supported in Word documents"
        );
    }
}

#[test]
fn independent_notes_keep_all_content_and_only_main_document_references() {
    let d = Document {
        title: String::new(),
        blocks: vec![paragraph(vec![
            text("Main"),
            Inline::Note(vec![paragraph(vec![text("First note")])]),
            Inline::Note(vec![paragraph(vec![text("Second note")])]),
        ])],
    };
    let package = docx_ast_rust::to_package(&d).unwrap();
    let body = part(&package, "word/document.xml");
    let notes = part(&package, "word/footnotes.xml");
    for id in [1, 2] {
        assert!(body.contains(&format!("<w:footnoteReference w:id=\"{id}\"/>")));
        assert!(notes.contains(&format!("<w:footnote w:id=\"{id}\">")));
    }
    assert_eq!(notes.matches("First note").count(), 1);
    assert_eq!(notes.matches("Second note").count(), 1);
    assert_eq!(notes.matches("<w:footnoteRef/>").count(), 2);
    assert!(!notes.contains("<w:footnoteReference"));
    assert!(!body.contains("First note"));
    assert!(!body.contains("Second note"));
}

#[test]
fn missing_grid_slots_do_not_shift_vertical_merge_continuations() {
    let cell = |label: &str, colspan, rowspan| TableCell {
        header: false,
        blocks: if label.is_empty() {
            Vec::new()
        } else {
            vec![paragraph(vec![text(label)])]
        },
        align: Align::Default,
        colspan,
        rowspan,
    };
    for gap in [1, 2] {
        for span in [1, 2] {
            let columns = 1 + gap + span;
            let mut first = vec![cell("A", 1, 1)];
            first.extend((0..gap).map(|col| cell(&format!("B{col}"), 1, 1)));
            first.push(cell("C", span, 2));
            let mut d = Document {
                title: String::new(),
                blocks: vec![Block::Table {
                    width: None,
                    column_widths: Vec::new(),
                    rows: vec![
                        TableRow {
                            header: false,
                            cells: first,
                        },
                        TableRow {
                            header: false,
                            cells: vec![cell("D", 1, 1)],
                        },
                        TableRow {
                            header: false,
                            cells: (0..columns)
                                .map(|col| cell(&format!("End{col}"), 1, 1))
                                .collect(),
                        },
                    ],
                }],
            };
            let body = part(&docx_ast_rust::to_package(&d).unwrap(), "word/document.xml");
            let row = body
                .split("<w:tr>")
                .nth(2)
                .unwrap()
                .split("</w:tr>")
                .next()
                .unwrap();
            let cells: Vec<_> = row.split("<w:tc>").skip(1).collect();
            assert_eq!(
                cells.len(),
                gap + 2,
                "missing grid slots must remain before the continuation"
            );
            assert!(cells[0].contains(">D</w:t>"));
            for blank in &cells[1..=gap] {
                assert!(!blank.contains("<w:vMerge"));
                assert!(!blank.contains("<w:t "));
            }
            assert!(cells[gap + 1].contains("<w:vMerge/>"));
            if span > 1 {
                assert!(cells[gap + 1].contains("<w:gridSpan w:val=\"2\"/>"));
            }
            assert_eq!(body.matches("<w:gridCol ").count(), columns);
            let Block::Table { rows, .. } = &mut d.blocks[0] else {
                unreachable!()
            };
            rows[1].cells.extend((0..gap).map(|_| cell("", 1, 1)));
            let explicit = part(&docx_ast_rust::to_package(&d).unwrap(), "word/document.xml");
            assert_eq!(
                body, explicit,
                "ragged input must match an otherwise identical fully covered table"
            );
        }
    }
}

use document_ast_rust::*;

fn text(value: &str) -> Inline {
    Inline::Text {
        text: value.into(),
        style: TextStyle::default(),
    }
}
fn paragraph(value: &str) -> Block {
    Block::Paragraph(Paragraph {
        inlines: vec![text(value)],
        ..Default::default()
    })
}
fn scope(direction: Direction, blocks: Vec<Block>) -> Block {
    Block::Direction { direction, blocks }
}
fn part(document: &Document, name: &str) -> String {
    String::from_utf8(
        docx_ast_rust::to_package(document)
            .unwrap()
            .parts
            .into_iter()
            .find(|p| p.name == name)
            .unwrap()
            .bytes,
    )
    .unwrap()
}
fn cell(blocks: Vec<Block>) -> TableCell {
    TableCell {
        header: false,
        blocks,
        align: Align::Default,
        colspan: 1,
        rowspan: 1,
    }
}
pub fn fixture() -> Document {
    Document {
        title: "Direction semantics".into(),
        blocks: vec![scope(
            Direction::Rtl,
            vec![
                Block::Heading {
                    level: 2,
                    id: "heading".into(),
                    inlines: vec![text("Heading ABC 123.")],
                },
                paragraph("RTL ABC 123."),
                scope(Direction::Ltr, vec![paragraph("LTR reset ABC 123.")]),
                Block::Paragraph(Paragraph {
                    inlines: vec![
                        text("Before "),
                        Inline::Direction {
                            direction: Direction::Rtl,
                            override_order: true,
                            inlines: vec![text("ABC 123")],
                        },
                        text(" after "),
                        Inline::Direction {
                            direction: Direction::Rtl,
                            override_order: false,
                            inlines: vec![
                                text("XYZ "),
                                Inline::Direction {
                                    direction: Direction::Ltr,
                                    override_order: false,
                                    inlines: vec![text("DEF 456")],
                                },
                            ],
                        },
                    ],
                    ..Default::default()
                }),
                Block::List {
                    start: Some(3),
                    style: ListStyle::Decimal,
                    delimiter: ListDelimiter::Period,
                    items: vec![
                        vec![scope(
                            Direction::Rtl,
                            vec![
                                Block::Paragraph(Paragraph {
                                    inlines: vec![Inline::Anchor("item-anchor".into())],
                                    ..Default::default()
                                }),
                                paragraph("RTL item"),
                            ],
                        )],
                        vec![scope(Direction::Ltr, vec![paragraph("LTR item reset")])],
                    ],
                },
                Block::Quote {
                    kind: None,
                    blocks: vec![paragraph("RTL quoted")],
                },
                Block::Table {
                    width: None,
                    column_widths: vec![],
                    rows: vec![TableRow {
                        header: true,
                        cells: vec![
                            cell(vec![paragraph("FIRST cell")]),
                            cell(vec![scope(Direction::Ltr, vec![paragraph("SECOND cell")])]),
                            cell(vec![scope(
                                Direction::Rtl,
                                vec![Block::Paragraph(Paragraph {
                                    inlines: vec![Inline::Direction {
                                        direction: Direction::Ltr,
                                        override_order: false,
                                        inlines: vec![Inline::Anchor("cell-anchor".into())],
                                    }],
                                    ..Default::default()
                                })],
                            )]),
                        ],
                    }],
                },
                scope(
                    Direction::Ltr,
                    vec![Block::Table {
                        width: None,
                        column_widths: vec![],
                        rows: vec![TableRow {
                            header: false,
                            cells: vec![cell(vec![paragraph("LTR table")])],
                        }],
                    }],
                ),
                Block::Paragraph(Paragraph {
                    inlines: vec![
                        Inline::Text {
                            text: "אבג".into(),
                            style: TextStyle {
                                bold: true,
                                italic: true,
                                ..Default::default()
                            },
                        },
                        Inline::Note(vec![paragraph("RTL note")]),
                    ],
                    ..Default::default()
                }),
            ],
        )],
    }
}

#[test]
fn explicit_scopes_keep_ascii_in_logical_order_and_emit_isolation_and_override() {
    let xml = part(&fixture(), "word/document.xml");
    assert!(xml.contains("<w:r><w:t>\u{2068}</w:t></w:r><w:bdo w:val=\"rtl\">"));
    assert!(xml.contains("ABC 123</w:t></w:r></w:bdo><w:r><w:t>\u{2069}</w:t></w:r>"));
    assert!(xml.contains("<w:r><w:t>\u{2067}</w:t></w:r>"));
    assert!(xml.contains("<w:r><w:t>\u{2066}</w:t></w:r>"));
    assert!(!xml.contains("321 CBA"));
    assert!(!xml.contains("<w:rtl"));
    assert_eq!(
        xml.matches('\u{2069}').count(),
        3,
        "anchor-only scopes emit no bidi controls"
    );
    assert!(xml.contains("<w:b/><w:bCs/><w:i/><w:iCs/>"));
}

#[test]
fn block_direction_and_ltr_resets_reach_headings_lists_tables_and_notes() {
    let document = fixture();
    let xml = part(&document, "word/document.xml");
    let paragraph = |needle: &str| {
        xml.split("<w:p>")
            .find(|p| p.contains(needle))
            .unwrap()
            .split("</w:p>")
            .next()
            .unwrap()
    };
    for text in [
        "Heading ABC",
        "RTL ABC",
        "RTL item",
        "RTL quoted",
        "FIRST cell",
    ] {
        let p = paragraph(text);
        assert!(p.contains("<w:bidi w:val=\"true\"/>"), "{text}: {p}");
        assert!(p.contains("<w:jc w:val=\"right\"/>"), "{text}");
        assert!(p.contains("<w:dir w:val=\"rtl\">"), "{text}");
    }
    for text in ["LTR reset", "LTR item reset", "SECOND cell", "LTR table"] {
        let p = paragraph(text);
        assert!(p.contains("<w:bidi w:val=\"false\"/>"), "{text}");
        assert!(p.contains("<w:jc w:val=\"left\"/>"), "{text}");
        assert!(p.contains("<w:dir w:val=\"ltr\">"), "{text}");
    }
    assert_eq!(xml.matches("<w:numPr>").count(), 2);
    assert!(paragraph("RTL item").contains("<w:numPr>"));
    assert!(paragraph("LTR item reset").contains("<w:numPr>"));
    assert_eq!(xml.matches("w:name=\"item-anchor\"").count(), 1);
    assert!(xml.contains("<w:tblPr><w:bidiVisual/>"));
    assert!(xml.contains("<w:tblPr><w:bidiVisual w:val=\"false\"/>"));
    assert!(xml.find("FIRST cell").unwrap() < xml.find("SECOND cell").unwrap());
    let anchored_cell = xml
        .split("<w:tc>")
        .find(|c| c.contains("cell-anchor"))
        .unwrap()
        .split("</w:tc>")
        .next()
        .unwrap();
    assert!(anchored_cell.ends_with("<w:p/>"));
    assert!(
        !xml.contains("SECOND cell</w:t></w:r></w:dir></w:p><w:p/>"),
        "a wrapped real paragraph needs no extra cell paragraph"
    );
    let notes = part(&document, "word/footnotes.xml");
    assert!(notes.contains("<w:bidi w:val=\"true\"/>"));
    assert_eq!(notes.matches("<w:p>").count(), 1);
    assert_eq!(notes.matches("<w:footnoteRef/>").count(), 1);
}

#[test]
fn physical_alignment_is_not_replaced_by_direction() {
    let document = Document {
        title: String::new(),
        blocks: vec![scope(
            Direction::Rtl,
            vec![Block::Paragraph(Paragraph {
                align: Align::Left,
                inlines: vec![text("left")],
                ..Default::default()
            })],
        )],
    };
    let xml = part(&document, "word/document.xml");
    assert!(xml.contains("<w:bidi w:val=\"true\"/><w:jc w:val=\"left\"/>"));
}

#[test]
fn undirected_documents_have_no_directional_markup_or_controls() {
    let document = Document {
        title: String::new(),
        blocks: vec![paragraph("ABC 123.")],
    };
    let xml = part(&document, "word/document.xml");
    assert!(xml.contains("<w:p><w:pPr><w:pStyle w:val=\"BodyText\"/></w:pPr><w:r><w:rPr></w:rPr><w:t xml:space=\"preserve\">ABC 123.</w:t></w:r></w:p>"));
    for token in [
        "<w:dir", "<w:bidi", "<w:rtl", "<w:bdo", "\u{2066}", "\u{2067}", "\u{2068}", "\u{2069}",
    ] {
        assert!(!xml.contains(token), "{token}");
    }
}

#[test]
fn directed_lists_keep_continuation_indents_and_table_first_marker_direction() {
    let document = Document {
        title: String::new(),
        blocks: vec![Block::List {
            start: Some(9),
            style: ListStyle::Decimal,
            delimiter: ListDelimiter::Period,
            items: vec![
                vec![scope(
                    Direction::Rtl,
                    vec![
                        scope(Direction::Ltr, vec![]),
                        paragraph("numbered"),
                        paragraph("continuation"),
                    ],
                )],
                vec![scope(
                    Direction::Rtl,
                    vec![scope(
                        Direction::Ltr,
                        vec![Block::Table {
                            width: None,
                            column_widths: vec![],
                            rows: vec![TableRow {
                                header: false,
                                cells: vec![cell(vec![paragraph("table first")])],
                            }],
                        }],
                    )],
                )],
            ],
        }],
    };
    let xml = part(&document, "word/document.xml");
    let paragraphs: Vec<_> = xml
        .split("<w:p>")
        .skip(1)
        .map(|p| p.split("</w:p>").next().unwrap())
        .collect();
    assert_eq!(paragraphs.len(), 4);
    assert!(paragraphs[0].contains("numbered") && paragraphs[0].contains("<w:numPr>"));
    assert!(paragraphs[1].contains("continuation") && !paragraphs[1].contains("<w:numPr>"));
    assert!(paragraphs[1].contains("<w:ind w:start=\"360\"/>"));
    assert!(
        paragraphs[2].contains("<w:numPr>") && paragraphs[2].contains("<w:bidi w:val=\"false\"/>")
    );
    assert!(paragraphs[3].contains("table first") && !paragraphs[3].contains("<w:numPr>"));
    let numbering = part(&document, "word/numbering.xml");
    assert!(
        !numbering.contains("<w:lvlJc"),
        "Word's default follows each numbered paragraph's direction"
    );
    assert!(numbering.contains("<w:ind w:start=\"360\" w:hanging=\"240\"/>"));
}

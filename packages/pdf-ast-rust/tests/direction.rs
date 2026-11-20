use document_ast_rust::{
    Block, Direction, Document, Inline, ListDelimiter, ListStyle, Paragraph, TableCell, TableRow,
    TextStyle,
};
use pdf_ast_rust::{PageBox, PdfOptions, layout_document, write_pdf_with_options};

fn text(value: &str) -> Inline {
    Inline::Text {
        text: value.into(),
        style: TextStyle::default(),
    }
}

fn paragraph(inlines: Vec<Inline>) -> Block {
    Block::Paragraph(Paragraph {
        inlines,
        ..Default::default()
    })
}

fn table(blocks: Vec<Block>) -> Block {
    Block::Table {
        rows: vec![TableRow {
            header: false,
            cells: vec![TableCell {
                header: false,
                blocks,
                colspan: 1,
                rowspan: 1,
                align: Default::default(),
            }],
        }],
        width: None,
        column_widths: vec![],
    }
}

fn ltr_inlines(inlines: Vec<Inline>) -> Vec<Inline> {
    inlines
        .into_iter()
        .map(|inline| Inline::Direction {
            direction: Direction::Ltr,
            override_order: false,
            inlines: vec![match inline {
                Inline::Note(blocks) => Inline::Note(ltr_blocks(blocks)),
                other => other,
            }],
        })
        .collect()
}

fn ltr_blocks(blocks: Vec<Block>) -> Vec<Block> {
    blocks
        .into_iter()
        .map(|block| {
            let block = match block {
                Block::Paragraph(mut p) => {
                    p.inlines = ltr_inlines(p.inlines);
                    Block::Paragraph(p)
                }
                Block::Heading { level, id, inlines } => Block::Heading {
                    level,
                    id,
                    inlines: ltr_inlines(inlines),
                },
                Block::Quote { kind, blocks } => Block::Quote {
                    kind,
                    blocks: ltr_blocks(blocks),
                },
                Block::List {
                    start,
                    style,
                    delimiter,
                    items,
                } => Block::List {
                    start,
                    style,
                    delimiter,
                    items: items.into_iter().map(ltr_blocks).collect(),
                },
                Block::Table {
                    mut rows,
                    width,
                    column_widths,
                } => {
                    for row in &mut rows {
                        for cell in &mut row.cells {
                            cell.blocks = ltr_blocks(std::mem::take(&mut cell.blocks));
                        }
                    }
                    Block::Table {
                        rows,
                        width,
                        column_widths,
                    }
                }
                other => other,
            };
            Block::Direction {
                direction: Direction::Ltr,
                blocks: vec![block],
            }
        })
        .collect()
}

#[test]
fn ordinary_ltr_scopes_preserve_layout_links_anchors_outlines_and_notes() {
    let source = Document {
        title: "Direction parity".into(),
        blocks: vec![
            paragraph(vec![text("Before")]),
            Block::Heading {
                level: 2,
                id: "heading".into(),
                inlines: vec![text("Visible heading")],
            },
            paragraph(vec![Inline::Anchor("table".into())]),
            table(vec![
                Block::Quote {
                    kind: None,
                    blocks: vec![paragraph(vec![text("Quoted cell")])],
                },
                Block::List {
                    start: None,
                    style: ListStyle::Decimal,
                    delimiter: ListDelimiter::Period,
                    items: vec![vec![paragraph(vec![text("Item")])]],
                },
                table(vec![paragraph(vec![
                    Inline::Anchor("nested".into()),
                    text("Nested"),
                ])]),
                Block::Rule,
            ]),
            paragraph(vec![
                Inline::Text {
                    text: "Jump".into(),
                    style: TextStyle {
                        link: Some("#nested".into()),
                        ..Default::default()
                    },
                },
                Inline::Note(vec![paragraph(vec![text("Footnote")])]),
            ]),
            paragraph(vec![Inline::Anchor("terminal".into())]),
        ],
    };
    let wrapped = Document {
        title: source.title.clone(),
        blocks: vec![Block::Direction {
            direction: Direction::Ltr,
            blocks: ltr_blocks(source.blocks.clone()),
        }],
    };
    let options = PdfOptions::default();
    let plain = layout_document(&source, &options).unwrap();
    let directional = layout_document(&wrapped, &options).unwrap();
    assert_eq!(
        format!("{:?}", plain.pages),
        format!("{:?}", directional.pages)
    );
    assert_eq!(plain.anchors, directional.anchors);
    assert_eq!(
        format!("{:?}", plain.outlines),
        format!("{:?}", directional.outlines)
    );
    assert_eq!(
        write_pdf_with_options(&source, &options).unwrap(),
        write_pdf_with_options(&wrapped, &options).unwrap()
    );
}

#[test]
fn ltr_block_boundaries_do_not_separate_headings_from_following_tables() {
    let mut blocks = (0..4)
        .map(|_| paragraph(vec![text("Before")]))
        .collect::<Vec<_>>();
    blocks.push(Block::Direction {
        direction: Direction::Ltr,
        blocks: vec![Block::Heading {
            level: 2,
            id: "heading".into(),
            inlines: vec![text("Tables")],
        }],
    });
    blocks.push(Block::Direction {
        direction: Direction::Ltr,
        blocks: vec![table(vec![paragraph(vec![text(
            "First\nSecond\nThird\nFourth",
        )])])],
    });
    let layout = layout_document(
        &Document {
            title: String::new(),
            blocks,
        },
        &PdfOptions {
            page: PageBox {
                width: 300.,
                height: 250.,
                margin: 20.,
            },
            ..Default::default()
        },
    )
    .unwrap();
    let first = layout
        .pages
        .iter()
        .position(|page| {
            page.paints.iter().any(
                |paint| matches!(paint, pdf_ast_rust::Paint::Text { text, .. } if text == "First"),
            )
        })
        .unwrap();
    assert!(first > 0);
    assert_eq!(layout.anchors["heading"].0, first);
}

#[test]
fn unsupported_inline_direction_is_rejected_even_for_ascii_links_and_nested_notes() {
    for (direction, override_order, message) in [
        (Direction::Rtl, false, "right-to-left"),
        (Direction::Rtl, true, "directional overrides"),
        (Direction::Ltr, true, "directional overrides"),
    ] {
        let inline = Inline::Direction {
            direction,
            override_order,
            inlines: vec![Inline::Text {
                text: "ASCII link (123)".into(),
                style: TextStyle {
                    link: Some("https://example.com".into()),
                    ..Default::default()
                },
            }],
        };
        let node = paragraph(vec![Inline::Direction {
            direction: Direction::Ltr,
            override_order: false,
            inlines: vec![inline.clone()],
        }]);
        for block in [
            node.clone(),
            Block::Heading {
                level: 2,
                id: String::new(),
                inlines: vec![inline],
            },
            table(vec![Block::Quote {
                kind: None,
                blocks: vec![node.clone()],
            }]),
            paragraph(vec![Inline::Note(vec![table(vec![node])])]),
        ] {
            let error = write_pdf_with_options(
                &Document {
                    title: String::new(),
                    blocks: vec![block],
                },
                &PdfOptions::default(),
            )
            .unwrap_err();
            assert!(error.contains(message) && error.contains("DOCX"), "{error}");
        }
    }
}

#[test]
fn rtl_block_scopes_are_rejected_before_they_can_be_flattened() {
    for contents in [Vec::new(), vec![paragraph(vec![text("ASCII (123)")])]] {
        let rtl = Block::Direction {
            direction: Direction::Rtl,
            blocks: contents,
        };
        for block in [
            rtl.clone(),
            Block::Direction {
                direction: Direction::Ltr,
                blocks: vec![rtl.clone()],
            },
            table(vec![rtl.clone()]),
            Block::List {
                start: None,
                style: ListStyle::Decimal,
                delimiter: ListDelimiter::Period,
                items: vec![vec![rtl.clone()]],
            },
            paragraph(vec![Inline::Note(vec![rtl])]),
        ] {
            let error = write_pdf_with_options(
                &Document {
                    title: String::new(),
                    blocks: vec![block],
                },
                &PdfOptions::default(),
            )
            .unwrap_err();
            assert!(
                error.contains("right-to-left") && error.contains("DOCX"),
                "{error}"
            );
        }
    }
}

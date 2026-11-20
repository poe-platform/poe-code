use document_ast_rust::{Block, Document, Inline, Paragraph, TextStyle, validate};

#[test]
fn format_independent_validation_rejects_ambiguous_style() {
    let mut document = Document::default();
    let mut paragraph = Paragraph::default();
    paragraph.inlines.push(Inline::Text {
        text: "x".into(),
        style: TextStyle {
            sub: true,
            sup: true,
            ..Default::default()
        },
    });
    document.blocks.push(Block::Paragraph(paragraph));
    assert!(validate(&document).unwrap_err().contains("subscript"));
}

#[test]
fn oversized_title_is_rejected_even_without_blocks() {
    let document = Document {
        title: "x".repeat(64 * 1024 * 1024 + 1),
        blocks: Vec::new(),
    };
    assert!(validate(&document).unwrap_err().contains("content limit"));
}

#[test]
fn direction_scopes_preserve_validation_and_nesting_limits() {
    use document_ast_rust::*;
    let mut run = Inline::Text {
        text: "invalid".into(),
        style: TextStyle {
            color: Some("red".into()),
            ..Default::default()
        },
    };
    run = Inline::Direction {
        direction: Direction::Rtl,
        override_order: false,
        inlines: vec![run],
    };
    let mut document = Document {
        title: String::new(),
        blocks: vec![Block::Direction {
            direction: Direction::Ltr,
            blocks: vec![Block::Paragraph(Paragraph {
                inlines: vec![run],
                ..Default::default()
            })],
        }],
    };
    assert!(validate(&document).unwrap_err().contains("six hexadecimal"));
    let mut run = Inline::Anchor("deep".into());
    for _ in 0..66 {
        run = Inline::Direction {
            direction: Direction::Ltr,
            override_order: false,
            inlines: vec![run],
        };
    }
    document.blocks = vec![Block::Paragraph(Paragraph {
        inlines: vec![run],
        ..Default::default()
    })];
    assert!(validate(&document).unwrap_err().contains("nesting limit"));
    let mut block = Block::Rule;
    for _ in 0..66 {
        block = Block::Direction {
            direction: Direction::Rtl,
            blocks: vec![block],
        };
    }
    document.blocks = vec![block];
    assert!(validate(&document).unwrap_err().contains("nesting limit"));
}

#[test]
fn source_anchors_attach_inside_direction_scopes() {
    use document_ast_rust::*;
    let mut blocks = vec![Block::Direction {
        direction: Direction::Rtl,
        blocks: vec![Block::Paragraph(Paragraph::default())],
    }];
    anchor_blocks(&mut blocks, 0, "source".into());
    let Block::Direction { blocks, .. } = &blocks[0] else {
        panic!()
    };
    let Block::Paragraph(p) = &blocks[0] else {
        panic!()
    };
    assert_eq!(p.id, "source");
}

#[test]
fn repeating_table_headers_must_form_a_leading_prefix() {
    use document_ast_rust::{Align, TableCell, TableRow};
    let table = |headers: &[bool]| Block::Table {
        rows: headers
            .iter()
            .map(|&header| TableRow {
                header,
                cells: vec![TableCell {
                    // Body headings remain valid and do not restart repeating headers.
                    header: true,
                    blocks: vec![Block::Paragraph(Paragraph::default())],
                    align: Align::Default,
                    colspan: 1,
                    rowspan: 1,
                }],
            })
            .collect(),
        width: None,
        column_widths: Vec::new(),
    };
    for headers in [
        &[][..],
        &[false],
        &[true],
        &[true, true],
        &[false, false],
        &[true, true, false, false],
    ] {
        let document = Document {
            title: String::new(),
            blocks: vec![table(headers)],
        };
        assert!(validate(&document).is_ok(), "valid prefix: {headers:?}");
    }
    for headers in [
        &[false, true][..],
        &[true, false, true],
        &[true, true, false, true],
    ] {
        let document = Document {
            title: String::new(),
            blocks: vec![table(headers)],
        };
        assert_eq!(
            validate(&document).unwrap_err(),
            "Repeating table header rows must precede body rows; use TableCell.header for body headings"
        );
    }
    // Prefix state belongs to each table, not the document's traversal order.
    let document = Document {
        title: String::new(),
        blocks: vec![table(&[false]), table(&[true, false])],
    };
    assert!(validate(&document).is_ok());
}

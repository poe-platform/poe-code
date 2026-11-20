use document_ast_rust::{Block, Document, Inline, Paragraph, TableCell, TableRow, TextStyle};
use pdf_ast_rust::{
    PageBox, Paint, PdfDocument, PdfOptions, layout_document, write_pdf_with_options,
};

fn cell(text: &str, header: bool) -> TableCell {
    TableCell {
        header,
        blocks: vec![Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: text.into(),
                style: TextStyle::default(),
            }],
            ..Default::default()
        })],
        align: Default::default(),
        colspan: 1,
        rowspan: 1,
    }
}

fn table(rows: Vec<TableRow>) -> Block {
    Block::Table {
        rows,
        width: None,
        column_widths: vec![],
    }
}

fn layout(rows: Vec<TableRow>, options: &PdfOptions) -> PdfDocument {
    layout_document(
        &Document {
            title: String::new(),
            blocks: vec![table(rows)],
        },
        options,
    )
    .unwrap()
}

fn appearances<'a>(layout: &'a PdfDocument, label: &str) -> Vec<(usize, &'a Paint)> {
    layout
        .pages
        .iter()
        .enumerate()
        .flat_map(|(page, p)| {
            p.paints.iter().filter_map(move |paint| {
                matches!(paint, Paint::Text { text, .. } if text == label).then_some((page, paint))
            })
        })
        .collect()
}

fn is_shaded(layout: &PdfDocument, label: &str) -> bool {
    let (page, paint) = appearances(layout, label)[0];
    let Paint::Text { x, y, .. } = paint else {
        unreachable!()
    };
    layout.pages[page].paints.iter().any(|paint| match paint {
        Paint::Rect {
            x: left,
            y: top,
            width,
            height,
            color,
        } => {
            *color == [0.93, 0.95, 0.97]
                && x >= left
                && x < &(left + width)
                && y >= top
                && y < &(top + height)
        }
        _ => false,
    })
}

#[test]
fn individual_header_cells_are_bold_and_shaded_without_styling_their_neighbors() {
    let layout = layout(
        vec![TableRow {
            header: false,
            cells: vec![cell("Row heading", true), cell("Body", false)],
        }],
        &PdfOptions::default(),
    );
    let Paint::Text { style: heading, .. } = appearances(&layout, "Row heading")[0].1 else {
        unreachable!()
    };
    let Paint::Text { style: body, .. } = appearances(&layout, "Body")[0].1 else {
        unreachable!()
    };
    assert!(heading.bold, "a row heading must use header typography");
    assert!(!body.bold);
    assert!(is_shaded(&layout, "Row heading"));
    assert!(!is_shaded(&layout, "Body"));
}

#[test]
fn intermediate_body_headers_do_not_repeat_with_leading_column_headers() {
    let mut rows = vec![TableRow {
        header: true,
        cells: vec![cell("Column A", false), cell("Column B", false)],
    }];
    for n in 0..20 {
        if n == 7 {
            rows.push(TableRow {
                header: false,
                cells: vec![cell("Section A", true), cell("Section B", true)],
            });
        }
        rows.push(TableRow {
            header: false,
            cells: vec![
                cell(&format!("Row {n}"), true),
                cell(&format!("Value {n}"), false),
            ],
        });
    }
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 180.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout(rows, &options);
    assert!(layout.pages.len() > 3);
    assert_eq!(appearances(&layout, "Column A").len(), layout.pages.len());
    assert_eq!(appearances(&layout, "Section A").len(), 1);
    assert!(is_shaded(&layout, "Section A"));
    for n in 0..20 {
        assert_eq!(appearances(&layout, &format!("Row {n}")).len(), 1);
        assert_eq!(appearances(&layout, &format!("Value {n}")).len(), 1);
        assert!(is_shaded(&layout, &format!("Row {n}")));
        assert!(!is_shaded(&layout, &format!("Value {n}")));
    }
}

#[test]
fn section_header_stays_with_the_first_following_body_row_when_the_pair_fits() {
    let rows = vec![
        TableRow {
            header: true,
            cells: vec![cell("Columns", false)],
        },
        TableRow {
            header: false,
            cells: vec![cell("Before 1", false)],
        },
        TableRow {
            header: false,
            cells: vec![cell("Before 2", false)],
        },
        TableRow {
            header: false,
            cells: vec![cell("Section", true)],
        },
        TableRow {
            header: false,
            cells: vec![cell("First body line\nSecond body line", false)],
        },
    ];
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 180.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout(rows, &options);
    assert_eq!(
        appearances(&layout, "Section")[0].0,
        appearances(&layout, "First body line")[0].0
    );
}

#[test]
fn single_column_row_header_tables_remain_splittable_without_repetition() {
    let rows = (0..40)
        .map(|n| TableRow {
            header: false,
            cells: vec![cell(&format!("Heading {n}"), true)],
        })
        .collect::<Vec<_>>();
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 180.,
            margin: 20.,
        },
        ..Default::default()
    };
    let source = Document {
        title: String::new(),
        blocks: vec![table(rows)],
    };
    let layout = layout_document(&source, &options).unwrap();
    assert!(layout.pages.len() > 5);
    for n in 0..40 {
        assert_eq!(appearances(&layout, &format!("Heading {n}")).len(), 1);
        assert!(is_shaded(&layout, &format!("Heading {n}")));
    }
    assert!(
        write_pdf_with_options(&source, &options)
            .unwrap()
            .starts_with(b"%PDF-1.7")
    );
}

#[test]
fn row_header_roles_survive_oversized_row_fragments_inside_nested_tables() {
    let heading = (0..40)
        .map(|n| format!("Heading {n}"))
        .collect::<Vec<_>>()
        .join("\n");
    let body = (0..40)
        .map(|n| format!("Body {n}"))
        .collect::<Vec<_>>()
        .join("\n");
    let nested = table(vec![
        TableRow {
            header: true,
            cells: vec![cell("Column A", false), cell("Column B", false)],
        },
        TableRow {
            header: false,
            cells: vec![cell(&heading, true), cell(&body, false)],
        },
    ]);
    let mut outer = cell("", false);
    outer.blocks = vec![nested];
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 180.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout(
        vec![TableRow {
            header: false,
            cells: vec![outer],
        }],
        &options,
    );
    assert!(layout.pages.len() > 5);
    assert_eq!(appearances(&layout, "Column A").len(), layout.pages.len());
    for n in 0..40 {
        let label = format!("Heading {n}");
        let body = format!("Body {n}");
        let heading_paints = appearances(&layout, &label);
        let body_paints = appearances(&layout, &body);
        assert_eq!(heading_paints.len(), 1);
        assert_eq!(body_paints.len(), 1);
        let Paint::Text {
            style,
            font: heading_font,
            ..
        } = heading_paints[0].1
        else {
            unreachable!()
        };
        assert!(style.bold);
        let Paint::Text {
            style,
            font: body_font,
            ..
        } = body_paints[0].1
        else {
            unreachable!()
        };
        assert!(!style.bold);
        assert_ne!(heading_font, body_font);
        assert!(is_shaded(&layout, &label));
        assert!(!is_shaded(&layout, &body));
    }
}

#[test]
fn merged_header_cells_shade_the_whole_span_without_styling_body_columns() {
    let mut merged = cell("Merged heading", true);
    merged.colspan = 2;
    merged.rowspan = 2;
    let rows = vec![
        TableRow {
            header: true,
            cells: vec![
                cell("Column A", false),
                cell("Column B", false),
                cell("Column C", false),
            ],
        },
        TableRow {
            header: false,
            cells: vec![merged, cell("Body upper", false)],
        },
        TableRow {
            header: false,
            cells: vec![cell("Body lower", false)],
        },
    ];
    let options = PdfOptions::default();
    let layout = layout(rows, &options);
    let (_, Paint::Text { x, y, style, .. }) = appearances(&layout, "Merged heading")[0] else {
        unreachable!()
    };
    assert!(style.bold);
    let (_, Paint::Text { y: lower_y, .. }) = appearances(&layout, "Body lower")[0] else {
        unreachable!()
    };
    let merged_rect = layout.pages[0]
        .paints
        .iter()
        .find_map(|paint| match paint {
            Paint::Rect {
                x: left,
                y: top,
                width,
                height,
                color,
            } if *color == [0.93, 0.95, 0.97]
                && x >= left
                && x < &(left + width)
                && y >= top
                && y < &(top + height) =>
            {
                Some((*width, *top, *height))
            }
            _ => None,
        })
        .unwrap();
    assert!(
        (merged_rect.0 - (options.page.width - 2. * options.page.margin) * 2. / 3.).abs() < 0.001
    );
    assert!(merged_rect.1 + merged_rect.2 > *lower_y);
    assert!(!is_shaded(&layout, "Body upper"));
    assert!(!is_shaded(&layout, "Body lower"));
}

#[test]
fn section_heading_keeps_with_an_oversized_following_row_fragment() {
    let body = (0..25)
        .map(|n| format!("Body {n}"))
        .collect::<Vec<_>>()
        .join("\n");
    let rows = vec![
        TableRow {
            header: true,
            cells: vec![cell("Columns", false)],
        },
        TableRow {
            header: false,
            cells: vec![cell("Before 1", false)],
        },
        TableRow {
            header: false,
            cells: vec![cell("Before 2", false)],
        },
        TableRow {
            header: false,
            cells: vec![cell("Section", true)],
        },
        TableRow {
            header: false,
            cells: vec![cell(&body, false)],
        },
    ];
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 180.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout(rows, &options);
    assert!(layout.pages.len() > 3);
    assert_eq!(
        appearances(&layout, "Section")[0].0,
        appearances(&layout, "Body 0")[0].0
    );
    assert_eq!(appearances(&layout, "Section").len(), 1);
    for n in 0..25 {
        assert_eq!(appearances(&layout, &format!("Body {n}")).len(), 1);
    }
}

#[test]
fn heading_before_table_keeps_with_its_leading_section_and_first_body_row() {
    let mut blocks = (0..4)
        .flat_map(|_| cell("Before", false).blocks)
        .collect::<Vec<_>>();
    blocks.push(Block::Heading {
        level: 2,
        id: "heading".into(),
        inlines: vec![Inline::Text {
            text: "Table".into(),
            style: TextStyle::default(),
        }],
    });
    blocks.push(table(vec![
        TableRow {
            header: true,
            cells: vec![cell("Columns", false)],
        },
        TableRow {
            header: false,
            cells: vec![cell("Section", true)],
        },
        TableRow {
            header: false,
            cells: vec![cell("Body first\nBody second", false)],
        },
    ]));
    let options = PdfOptions {
        page: PageBox {
            width: 300.,
            height: 250.,
            margin: 20.,
        },
        ..Default::default()
    };
    let layout = layout_document(
        &Document {
            title: String::new(),
            blocks,
        },
        &options,
    )
    .unwrap();
    let page = layout.anchors["heading"].0;
    assert!(page > 0);
    assert_eq!(appearances(&layout, "Section")[0].0, page);
    assert_eq!(appearances(&layout, "Body first")[0].0, page);
}

#[test]
fn heading_cell_context_reaches_code_quotes_lists_directions_and_note_markers() {
    use document_ast_rust::{Direction, ListDelimiter, ListStyle};
    let code = |text: &str| Block::Code {
        language: String::new(),
        text: text.into(),
    };
    for (row_header, cell_header) in [(false, true), (true, false), (false, false)] {
        let header = row_header || cell_header;
        let mut rich = cell("", cell_header);
        rich.blocks = vec![
            code("Code"),
            Block::Quote {
                kind: None,
                blocks: vec![
                    code("Quoted code"),
                    cell("Quoted text", false).blocks.remove(0),
                ],
            },
            Block::List {
                start: Some(1),
                style: ListStyle::Decimal,
                delimiter: ListDelimiter::Period,
                items: vec![vec![Block::Direction {
                    direction: Direction::Ltr,
                    blocks: vec![
                        code("List code"),
                        Block::Paragraph(Paragraph {
                            inlines: vec![Inline::Note(cell("Footnote", false).blocks)],
                            ..Default::default()
                        }),
                    ],
                }]],
            },
            Block::Paragraph(Paragraph {
                inlines: vec![Inline::Direction {
                    direction: Direction::Ltr,
                    override_order: false,
                    inlines: vec![Inline::Text {
                        text: "Directional text".into(),
                        style: TextStyle::default(),
                    }],
                }],
                ..Default::default()
            }),
        ];
        let layout = layout(
            vec![TableRow {
                header: row_header,
                cells: vec![rich],
            }],
            &PdfOptions::default(),
        );
        for label in [
            "Code",
            "Quoted code",
            "Quoted text",
            "List code",
            "1. ",
            "[1]",
            "Directional text",
        ] {
            let paints = appearances(&layout, label);
            assert_eq!(paints.len(), 1, "expected one {label:?}");
            let Paint::Text { style, font, .. } = paints[0].1 else {
                unreachable!()
            };
            assert_eq!(style.bold, header, "heading context lost for {label:?}");
            assert_eq!(
                layout.fonts[*font].id.contains("Bold"),
                header,
                "wrong font for {label:?}"
            );
        }
        let Paint::Text { style, .. } = appearances(&layout, "[1] Footnote")[0].1 else {
            unreachable!()
        };
        assert!(!style.bold, "the footnote body remains ordinary prose");
    }
}

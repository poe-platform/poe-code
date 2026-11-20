use document_ast_rust::{
    Block, Direction, Document, Image, Inline, Paragraph, TableCell, TableRow, TextStyle,
    cooperate::block_on,
};
use pdf_ast_rust::{
    PageBox, Paint, PdfDocument, PdfOptions, SuppliedFont, layout_document, serialize_pdf,
    write_pdf_with_options, write_pdf_with_usage_async,
};

fn paragraph(text: &str, checked: Option<bool>) -> Block {
    Block::Paragraph(Paragraph {
        inlines: vec![Inline::Text {
            text: text.into(),
            style: TextStyle::default(),
        }],
        list_checked: checked,
        ..Default::default()
    })
}

fn list(items: Vec<Vec<Block>>) -> Block {
    Block::List {
        start: None,
        style: Default::default(),
        delimiter: Default::default(),
        items,
    }
}

fn document(blocks: Vec<Block>) -> Document {
    Document {
        title: String::new(),
        blocks,
    }
}

fn boxes(layout: &PdfDocument) -> Vec<(usize, f64, f64, f64, bool)> {
    layout
        .pages
        .iter()
        .enumerate()
        .flat_map(|(page, p)| {
            p.paints.iter().filter_map(move |paint| {
                if let Paint::Checkbox {
                    x,
                    y,
                    size,
                    checked,
                } = paint
                {
                    Some((page, *x, *y, *size, *checked))
                } else {
                    None
                }
            })
        })
        .collect()
}

fn texts(layout: &PdfDocument) -> Vec<(usize, f64, f64, &str)> {
    layout
        .pages
        .iter()
        .enumerate()
        .flat_map(|(page, p)| {
            p.paints.iter().filter_map(move |paint| {
                if let Paint::Text { x, y, text, .. } = paint {
                    Some((page, *x, *y, text.as_str()))
                } else {
                    None
                }
            })
        })
        .collect()
}

fn table(blocks: Vec<Block>) -> Block {
    Block::Table {
        width: None,
        column_widths: vec![],
        rows: vec![TableRow {
            header: false,
            cells: vec![TableCell {
                header: false,
                blocks,
                align: Default::default(),
                colspan: 1,
                rowspan: 1,
            }],
        }],
    }
}

fn small_page() -> PdfOptions {
    PdfOptions {
        page: PageBox {
            width: 240.,
            height: 240.,
            margin: 20.,
        },
        ..Default::default()
    }
}

#[test]
fn task_items_replace_bullets_and_share_the_hanging_text_column() {
    let input = document(vec![list(vec![
        vec![paragraph("Pending", Some(false))],
        vec![paragraph("Completed", Some(true))],
        vec![paragraph("Ordinary", None)],
    ])]);
    let layout = layout_document(&input, &PdfOptions::default()).unwrap();
    let text = texts(&layout);
    assert_eq!(
        text.iter().map(|t| t.3).collect::<Vec<_>>(),
        ["Pending", "Completed", "•", "Ordinary"]
    );
    assert_eq!(text[0].1, text[1].1);
    assert_eq!(text[1].1, text[3].1);
    let markers = boxes(&layout);
    assert_eq!(markers.len(), 2);
    assert!(!markers[0].4);
    assert!(markers[1].4);
    for (marker, text) in markers.iter().zip(&text) {
        assert_eq!(marker.1 + marker.3 + 7., text.1);
        assert!((marker.2 + marker.3 * 0.9 - text.2).abs() < 0.0001);
    }
}

#[test]
fn ordered_tasks_replace_numbers_without_renumbering_ordinary_items() {
    let input = document(vec![Block::List {
        start: Some(9),
        style: Default::default(),
        delimiter: Default::default(),
        items: vec![
            vec![Block::Direction {
                direction: Direction::Ltr,
                blocks: vec![paragraph("Done", Some(true))],
            }],
            vec![paragraph("Next", None)],
        ],
    }]);
    let layout = layout_document(&input, &PdfOptions::default()).unwrap();
    assert_eq!(
        texts(&layout).iter().map(|t| t.3).collect::<Vec<_>>(),
        ["Done", "10.", "Next"]
    );
    assert_eq!(boxes(&layout).len(), 1);
}

#[test]
fn nested_wrapped_tasks_keep_their_hanging_indent_in_body_and_cells() {
    for in_cell in [false, true] {
        let input_list = list(vec![vec![
            paragraph("Parent", Some(false)),
            list(vec![vec![paragraph(
                "Nested words wrap onto several lines with a consistent indent",
                Some(true),
            )]]),
        ]]);
        let input = document(vec![if in_cell {
            table(vec![input_list])
        } else {
            input_list
        }]);
        let layout = layout_document(&input, &small_page()).unwrap();
        let markers = boxes(&layout);
        assert_eq!(markers.len(), 2);
        assert_eq!(markers[1].1 - markers[0].1, if in_cell { 17. } else { 27. });
        let text = texts(&layout);
        let wrapped: Vec<_> = text.iter().filter(|t| t.3 != "Parent").collect();
        assert!(wrapped.len() >= 2);
        assert!(wrapped.iter().all(|t| (t.1 - wrapped[0].1).abs() < 0.0001));
        assert_eq!(wrapped[0].1, markers[1].1 + markers[1].3 + 7.);
    }
}

#[test]
fn task_marker_moves_with_a_kept_caption_and_image() {
    let mut blocks: Vec<_> = (0..4).map(|_| paragraph("Before", None)).collect();
    let Block::Paragraph(mut caption) = paragraph("Caption", Some(true)) else {
        unreachable!()
    };
    caption.keep_with_next = true;
    blocks.push(list(vec![vec![
        Block::Paragraph(caption),
        Block::Image(Image {
            bytes: terminal_png_rust::png::encode(1, 1, &[128, 128, 128, 255]).unwrap(),
            mime: "image/png".into(),
            width: 100.,
            height: 100.,
            alt: String::new(),
            title: String::new(),
            link: None,
        }),
    ]]));
    let layout = layout_document(&document(blocks), &small_page()).unwrap();
    let marker = boxes(&layout)[0];
    let caption = texts(&layout)
        .into_iter()
        .find(|t| t.3 == "Caption")
        .unwrap();
    let image_page = layout
        .pages
        .iter()
        .position(|p| p.paints.iter().any(|p| matches!(p, Paint::Image { .. })))
        .unwrap();
    assert!(image_page > 0);
    assert_eq!(marker.0, image_page);
    assert_eq!(caption.0, image_page);
    assert!((marker.2 + marker.3 * 0.9 - caption.2).abs() < 0.0001);
}

#[test]
fn task_table_cells_split_across_pages_without_repeating_markers() {
    let long = (0..40).map(|n| format!("Line {n}\n")).collect::<String>();
    let input = document(vec![table(vec![list(vec![
        vec![paragraph(&long, Some(true))],
        vec![paragraph("Last", Some(false))],
    ])])]);
    let layout = layout_document(&input, &small_page()).unwrap();
    assert!(layout.pages.len() > 2);
    let markers = boxes(&layout);
    assert_eq!(markers.len(), 2);
    let text = texts(&layout);
    for (marker, label) in markers.iter().zip(["Line 0", "Last"]) {
        let first = text.iter().find(|t| t.3 == label).unwrap();
        assert_eq!(marker.0, first.0);
        assert!((marker.2 + marker.3 * 0.9 - first.2).abs() < 0.0001);
    }
    let x = text[0].1;
    assert!(text.iter().all(|t| t.1 == x));
    for n in 0..40 {
        assert_eq!(
            text.iter().filter(|t| t.3 == format!("Line {n}")).count(),
            1
        );
    }
}

#[test]
fn empty_tasks_have_a_marker_in_body_and_cells() {
    for in_cell in [false, true] {
        let input_list = list(vec![
            vec![paragraph("", Some(false))],
            vec![paragraph("", Some(true))],
        ]);
        let input = document(vec![if in_cell {
            table(vec![input_list])
        } else {
            input_list
        }]);
        let layout = layout_document(&input, &PdfOptions::default()).unwrap();
        let markers = boxes(&layout);
        assert_eq!(markers.len(), 2);
        assert!(markers[1].2 > markers[0].2);
    }
}

#[test]
fn vector_tasks_do_not_require_checkbox_font_glyphs_and_obey_budgets() {
    let font = include_bytes!("../src/fonts/LiberationSans-Regular.ttf");
    assert_eq!(
        terminal_png_rust::font::Font::new(font)
            .unwrap()
            .glyph_index(0x2611),
        0
    );
    let input = document(vec![list(vec![vec![paragraph("Done", Some(true))]])]);
    let mut options = PdfOptions {
        fonts: vec![SuppliedFont {
            id: "body".into(),
            bytes: font.to_vec(),
        }],
        ..Default::default()
    };
    options.limits.fonts = 1;
    options.limits.glyphs = 4;
    let output = block_on(write_pdf_with_usage_async(&input, &options)).unwrap();
    assert_eq!(output.usage.fonts, 1);
    assert_eq!(output.usage.glyphs, 4);
    options.limits.output_bytes = output.bytes.len() - 1;
    assert!(
        write_pdf_with_options(&input, &options)
            .unwrap_err()
            .contains("outputBytes")
    );
    options.limits.output_bytes = usize::MAX;
    options.limits.layout_work = 0;
    assert!(
        write_pdf_with_options(&input, &options)
            .unwrap_err()
            .contains("layoutWork")
    );
}

#[test]
fn public_checkbox_geometry_is_validated_before_serialization() {
    let options = PdfOptions::default();
    let mut layout = layout_document(&document(vec![]), &options).unwrap();
    for (x, y, size) in [
        (0., 0., 0.),
        (0., 0., -1.),
        (f64::NAN, 0., 12.),
        (0., f64::INFINITY, 12.),
        (0., 0., f64::NAN),
        (0., 0., f64::INFINITY),
    ] {
        layout.pages[0].paints = vec![Paint::Checkbox {
            x,
            y,
            size,
            checked: true,
        }];
        assert!(
            serialize_pdf(&layout, &options.limits)
                .unwrap_err()
                .contains("Invalid PDF")
        );
    }
    layout.pages[0].paints = vec![Paint::Checkbox {
        x: 20.,
        y: 20.,
        size: 12.,
        checked: true,
    }];
    assert!(
        serialize_pdf(&layout, &options.limits)
            .unwrap()
            .starts_with(b"%PDF-1.7")
    );
}

#[test]
fn heading_stays_with_a_task_table_that_fits_a_page_without_its_heading() {
    let cell = |blocks| TableCell {
        header: false,
        blocks,
        align: Default::default(),
        colspan: 1,
        rowspan: 1,
    };
    let tasks = (0..12)
        .map(|n| {
            vec![paragraph(
                &format!(
                    "Task {}: a longer table-cell label that wraps and stays with its checkbox",
                    n + 1
                ),
                Some(n % 2 == 0),
            )]
        })
        .collect();
    let input = document(vec![
        paragraph("Before the checklist", None),
        Block::Heading {
            level: 2,
            id: "checklist".into(),
            inlines: vec![Inline::Text {
                text: "Table checklist".into(),
                style: Default::default(),
            }],
        },
        Block::Table {
            width: None,
            column_widths: vec![],
            rows: vec![
                TableRow {
                    header: true,
                    cells: vec![cell(vec![paragraph("Tasks across pages", None)])],
                },
                TableRow {
                    header: false,
                    cells: vec![cell(vec![list(tasks)])],
                },
            ],
        },
    ]);
    let options = PdfOptions {
        page: PageBox {
            width: 360.,
            height: 520.,
            margin: 30.,
        },
        ..Default::default()
    };
    let layout = layout_document(&input, &options).unwrap();
    let heading_page = layout.anchors["checklist"].0;
    assert_eq!(
        heading_page,
        boxes(&layout)[0].0,
        "a heading must share the first task's page even if their whole table row cannot fit beside it"
    );
    assert_eq!(boxes(&layout).len(), 12);
    assert_eq!(
        texts(&layout)
            .iter()
            .find(|t| t.3 == "Tasks across pages")
            .unwrap()
            .0,
        heading_page
    );
}

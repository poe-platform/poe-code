use document_ast_rust::{Block, Document, Inline, Paragraph, TextStyle};
use pdf_ast_rust::{PageBox, Paint, PdfOptions, layout_document};

fn text(text: &str) -> Inline {
    Inline::Text {
        text: text.into(),
        style: TextStyle::default(),
    }
}
fn paragraph(label: &str) -> Block {
    Block::Paragraph(Paragraph {
        inlines: vec![text(label)],
        ..Default::default()
    })
}
fn heading(level: u8, label: &str) -> Block {
    Block::Heading {
        level,
        id: label.into(),
        inlines: vec![text(label)],
    }
}
fn options(size: f64) -> PdfOptions {
    PdfOptions {
        font_size: size,
        line_height: 1.65,
        page: PageBox {
            width: 500.,
            height: 1000.,
            margin: 20.,
        },
        ..Default::default()
    }
}
fn render(blocks: Vec<Block>, options: &PdfOptions) -> pdf_ast_rust::PdfDocument {
    layout_document(
        &Document {
            title: String::new(),
            blocks,
        },
        options,
    )
    .unwrap()
}
fn location(layout: &pdf_ast_rust::PdfDocument, label: &str) -> (usize, f64, f64) {
    layout
        .pages
        .iter()
        .enumerate()
        .find_map(|(page, p)| {
            p.paints.iter().find_map(|p| match p {
                Paint::Text { y, size, text, .. } if text == label => Some((page, *y, *size)),
                _ => None,
            })
        })
        .unwrap()
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 0.001, "{a} != {b}");
}

#[test]
fn all_heading_levels_scale_with_the_requested_body_font_size() {
    for size in [9., 16., 20.] {
        let layout = render(
            (1..=6).map(|n| heading(n, &format!("H{n}"))).collect(),
            &options(size),
        );
        for (level, scale) in [2., 1.5, 1.25, 1.1, 1., 1.].iter().enumerate() {
            near(
                location(&layout, &format!("H{}", level + 1)).2,
                size * scale,
            );
        }
    }
}

#[test]
fn wrapped_headings_use_their_own_line_height() {
    let layout = render(
        vec![heading(2, "First\nSecond"), paragraph("Body")],
        &options(16.),
    );
    near(
        location(&layout, "Second").1 - location(&layout, "First").1,
        24. * 1.25,
    );
    near(
        location(&layout, "Body").1 - location(&layout, "Second").1,
        24. * 0.6 + 16.,
    );
}

#[test]
fn adjacent_heading_and_paragraph_margins_collapse() {
    let layout = render(
        vec![
            paragraph("Before"),
            heading(1, "Large"),
            heading(2, "Medium"),
            paragraph("After"),
        ],
        &options(16.),
    );
    let before = location(&layout, "Before").1;
    let large = location(&layout, "Large").1;
    let medium = location(&layout, "Medium").1;
    let after = location(&layout, "After").1;
    near(large - before, 16. * 0.65 + 32. * 2.3);
    near(medium - large, 32. * 0.25 + 24. * 1.3 + 24.);
    near(after - medium, 24. * 0.6 + 16.);
}

#[test]
fn direct_list_paragraphs_stay_compact_while_body_paragraphs_have_space() {
    let layout = render(
        vec![
            paragraph("Body one"),
            paragraph("Body two"),
            Block::List {
                start: None,
                style: Default::default(),
                delimiter: Default::default(),
                items: vec![vec![paragraph("Item one")], vec![paragraph("Item two")]],
            },
        ],
        &options(16.),
    );
    near(
        location(&layout, "Body two").1 - location(&layout, "Body one").1,
        16. * (1.65 + 0.8),
    );
    near(
        location(&layout, "Item two").1 - location(&layout, "Item one").1,
        16. * (1.65 + 0.3),
    );
}

#[test]
fn inline_and_block_code_use_the_same_body_relative_font_size() {
    for size in [9., 16., 20.] {
        let inline = Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: "Inline code".into(),
                style: TextStyle {
                    code: true,
                    ..Default::default()
                },
            }],
            ..Default::default()
        });
        let layout = render(
            vec![
                inline,
                Block::Code {
                    text: "Block code".into(),
                    language: String::new(),
                },
            ],
            &options(size),
        );
        near(location(&layout, "Inline code").2, size * 0.88);
        near(location(&layout, "Block code").2, size * 0.88);
    }
}

#[test]
fn code_line_spacing_uses_the_code_font_size_in_body_and_table_cells() {
    use document_ast_rust::{TableCell, TableRow};
    for size in [9., 12., 20.] {
        let code = || Block::Code {
            text: "first line\n\nthird line".into(),
            language: String::new(),
        };
        for in_cell in [false, true] {
            let block = if in_cell {
                Block::Table {
                    width: None,
                    column_widths: vec![],
                    rows: vec![TableRow {
                        header: false,
                        cells: vec![TableCell {
                            header: false,
                            blocks: vec![code()],
                            align: Default::default(),
                            colspan: 1,
                            rowspan: 1,
                        }],
                    }],
                }
            } else {
                code()
            };
            let layout = render(vec![block], &options(size));
            let first = location(&layout, "first line");
            let third = location(&layout, "third line");
            let base = if in_cell { 10. } else { size };
            near(first.2, base * 0.88);
            near(third.1 - first.1, 2. * base * 0.88 * 1.5);
        }
    }
}

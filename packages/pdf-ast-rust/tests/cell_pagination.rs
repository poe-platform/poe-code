use document_ast_rust::{
    Block, Document, Image, Inline, Paragraph, TableCell, TableRow, TextStyle,
};
use pdf_ast_rust::{PageBox, Paint, PdfOptions, layout_document};

fn paragraph(text: &str) -> Block {
    Block::Paragraph(Paragraph {
        inlines: vec![Inline::Text {
            text: text.into(),
            style: TextStyle::default(),
        }],
        ..Default::default()
    })
}

fn heading(text: &str) -> Block {
    Block::Heading {
        level: 2,
        id: text.into(),
        inlines: vec![Inline::Text {
            text: text.into(),
            style: TextStyle::default(),
        }],
    }
}

fn image(height: f64) -> Block {
    Block::Image(Image {
        bytes: terminal_png_rust::png::encode(1, 1, &[128, 128, 128, 255]).unwrap(),
        mime: "image/png".into(),
        width: 100.,
        height,
        alt: String::new(),
        title: String::new(),
        link: None,
    })
}

fn nested(blocks: Vec<Block>) -> Document {
    let wrap = |title: &str, blocks: Vec<Block>| {
        let cell = |blocks| TableCell {
            header: false,
            blocks,
            align: Default::default(),
            colspan: 1,
            rowspan: 1,
        };
        Block::Table {
            width: None,
            column_widths: vec![],
            rows: vec![
                TableRow {
                    header: true,
                    cells: vec![cell(vec![paragraph(title)])],
                },
                TableRow {
                    header: false,
                    cells: vec![cell(blocks)],
                },
            ],
        }
    };
    Document {
        title: String::new(),
        blocks: vec![wrap("OUTERHEADER", vec![wrap("INNERHEADER", blocks)])],
    }
}

fn options() -> PdfOptions {
    PdfOptions {
        page: PageBox {
            width: 360.,
            height: 240.,
            margin: 20.,
        },
        ..Default::default()
    }
}

#[test]
fn nested_cell_heading_moves_with_its_image_past_repeated_headers() {
    for title in [
        "IMAGEHEADING",
        "This heading wraps across two lines before the image",
    ] {
        let mut blocks = (0..5)
            .map(|n| paragraph(&format!("PRE{n}")))
            .collect::<Vec<_>>();
        blocks.extend([heading(title), image(100.), paragraph("AFTERIMAGE")]);
        let layout = layout_document(&nested(blocks), &options()).unwrap();
        let image_page = layout
            .pages
            .iter()
            .position(|page| {
                page.paints
                    .iter()
                    .any(|paint| matches!(paint, Paint::Image { .. }))
            })
            .unwrap();
        assert!(image_page > 0);
        assert_eq!(
            layout.anchors[title].0, image_page,
            "a cell heading must follow its image to the next fragment"
        );
        for label in ["OUTERHEADER", "INNERHEADER"] {
            for page in &layout.pages {
                assert_eq!(
                    page.paints
                        .iter()
                        .filter(|paint| matches!(paint, Paint::Text { text, .. } if text == label))
                        .count(),
                    1
                );
            }
        }
        for n in 0..5 {
            let label = format!("PRE{n}");
            assert_eq!(
                layout
                    .pages
                    .iter()
                    .flat_map(|page| &page.paints)
                    .filter(|paint| matches!(paint, Paint::Text { text, .. } if text == &label))
                    .count(),
                1
            );
        }
    }
}

#[test]
fn oversized_images_still_fail_when_the_nested_cell_cannot_fit_them() {
    let error =
        layout_document(&nested(vec![heading("Heading"), image(200.)]), &options()).unwrap_err();
    assert!(error.contains("printable page height"), "{error}");
}

#[test]
fn cell_caption_keep_is_respected_without_grouping_ordinary_paragraphs() {
    for keep in [false, true] {
        let mut blocks = (0..5)
            .map(|n| paragraph(&format!("PRE{n}")))
            .collect::<Vec<_>>();
        let Block::Paragraph(mut caption) = paragraph("Caption") else {
            unreachable!()
        };
        caption.id = "caption".into();
        caption.keep_with_next = keep;
        blocks.extend([Block::Paragraph(caption), image(100.)]);
        let layout = layout_document(&nested(blocks), &options()).unwrap();
        let image_page = layout
            .pages
            .iter()
            .position(|page| {
                page.paints
                    .iter()
                    .any(|paint| matches!(paint, Paint::Image { .. }))
            })
            .unwrap();
        assert_eq!(layout.anchors["caption"].0 == image_page, keep);
    }
}

#[test]
fn long_cell_heading_chains_split_and_keep_the_final_heading_with_its_image() {
    let mut blocks = (0..40)
        .map(|n| heading(&format!("Heading {n}")))
        .collect::<Vec<_>>();
    blocks.push(image(100.));
    let layout = layout_document(&nested(blocks), &options()).unwrap();
    assert!(layout.pages.len() > 5 && layout.pages.len() <= 12);
    let images = layout
        .pages
        .iter()
        .enumerate()
        .flat_map(|(page, p)| {
            p.paints
                .iter()
                .filter_map(move |paint| matches!(paint, Paint::Image { .. }).then_some(page))
        })
        .collect::<Vec<_>>();
    assert_eq!(images.len(), 1);
    assert_eq!(layout.anchors["Heading 39"].0, images[0]);
    for n in 0..40 {
        let label = format!("Heading {n}");
        assert_eq!(
            layout
                .pages
                .iter()
                .flat_map(|page| &page.paints)
                .filter(|paint| matches!(paint, Paint::Text { text, .. } if text == &label))
                .count(),
            1
        );
    }
}

#[test]
fn cell_heading_keeps_with_nested_table_headers_and_first_body_fragment() {
    let inner_cell = |blocks| TableCell {
        header: false,
        blocks,
        align: Default::default(),
        colspan: 1,
        rowspan: 1,
    };
    let table = Block::Table {
        width: None,
        column_widths: vec![],
        rows: vec![
            TableRow {
                header: true,
                cells: vec![inner_cell(vec![paragraph("THIRDHEADER")])],
            },
            TableRow {
                header: false,
                cells: vec![inner_cell(vec![paragraph(
                    &(0..40).map(|n| format!("Body {n}\n")).collect::<String>(),
                )])],
            },
        ],
    };
    let mut blocks = (0..5)
        .map(|n| paragraph(&format!("PRE{n}")))
        .collect::<Vec<_>>();
    blocks.extend([heading("TABLEHEADING"), table]);
    let layout = layout_document(&nested(blocks), &options()).unwrap();
    let first_body = layout
        .pages
        .iter()
        .position(|page| {
            page.paints
                .iter()
                .any(|paint| matches!(paint, Paint::Text { text, .. } if text == "Body 0"))
        })
        .unwrap();
    assert_eq!(layout.anchors["TABLEHEADING"].0, first_body);
    assert!(layout.pages.len() > 3);
    for n in 0..40 {
        let label = format!("Body {n}");
        assert_eq!(
            layout
                .pages
                .iter()
                .flat_map(|page| &page.paints)
                .filter(|paint| matches!(paint, Paint::Text { text, .. } if text == &label))
                .count(),
            1
        );
    }
}

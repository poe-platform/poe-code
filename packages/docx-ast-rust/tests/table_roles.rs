use document_ast_rust::*;

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
        align: Align::Default,
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

pub fn fixture() -> Document {
    let mut section = cell("Section heading", true);
    section.colspan = 2;
    let mut label = cell("Row heading", true);
    label.rowspan = 2;
    let mut reset = cell("LTR value", false);
    reset.blocks = vec![Block::Direction {
        direction: Direction::Ltr,
        blocks: reset.blocks,
    }];
    Document {
        title: "Table heading roles".into(),
        blocks: vec![Block::Direction {
            direction: Direction::Rtl,
            blocks: vec![table(vec![
                TableRow {
                    header: true,
                    cells: vec![cell("Column A", false), cell("Column B", false)],
                },
                TableRow {
                    header: false,
                    cells: vec![section],
                },
                TableRow {
                    header: false,
                    cells: vec![label, cell("Regular value", false)],
                },
                TableRow {
                    header: false,
                    cells: vec![reset],
                },
                TableRow {
                    header: false,
                    cells: vec![cell("Next section", true), cell("Details", true)],
                },
                TableRow {
                    header: false,
                    cells: vec![cell("Ordinary A", false), cell("Ordinary B", false)],
                },
            ])],
        }],
    }
}

fn body(document: &Document) -> String {
    String::from_utf8(
        docx_ast_rust::to_package(document)
            .unwrap()
            .parts
            .into_iter()
            .find(|p| p.name == "word/document.xml")
            .unwrap()
            .bytes,
    )
    .unwrap()
}
fn rows(xml: &str) -> Vec<&str> {
    xml.split("<w:tr>")
        .skip(1)
        .map(|row| row.split("</w:tr>").next().unwrap())
        .collect()
}
fn cells(row: &str) -> Vec<&str> {
    row.split("<w:tc>")
        .skip(1)
        .map(|cell| cell.split("</w:tc>").next().unwrap())
        .collect()
}
fn heading(cell: &str) -> bool {
    cell.contains("<w:shd w:val=\"clear\" w:fill=\"EDF2F7\"/>")
}

#[test]
fn body_and_row_headings_are_styled_without_repeating_their_rows() {
    let xml = body(&fixture());
    let rows = rows(&xml);
    assert_eq!(rows.len(), 6);
    assert_eq!(xml.matches("<w:tblHeader/>").count(), 1);
    assert!(rows[0].contains("<w:tblHeader/>"));
    for row in &rows[1..] {
        assert!(!row.contains("<w:tblHeader/>"));
    }
    for (i, expected) in [
        [true, true].as_slice(),
        &[true],
        &[true, false],
        &[true, false],
        &[true, true],
        &[false, false],
    ]
    .iter()
    .enumerate()
    {
        assert_eq!(
            cells(rows[i])
                .iter()
                .map(|cell| heading(cell))
                .collect::<Vec<_>>(),
            *expected,
            "row {i}"
        );
    }
    for label in [
        "Column A",
        "Column B",
        "Section heading",
        "Row heading",
        "Next section",
        "Details",
    ] {
        let cell = rows
            .iter()
            .flat_map(|row| cells(row))
            .find(|cell| cell.contains(label))
            .unwrap();
        assert!(cell.contains("<w:b/><w:bCs/>"), "{label}");
    }
    for label in ["Regular value", "LTR value", "Ordinary A", "Ordinary B"] {
        let cell = rows
            .iter()
            .flat_map(|row| cells(row))
            .find(|cell| cell.contains(label))
            .unwrap();
        assert!(!cell.contains("<w:b/>"), "{label}");
    }
}

#[test]
fn merged_headings_keep_their_grid_and_shading_with_direction_resets() {
    let xml = body(&fixture());
    let rows = rows(&xml);
    assert!(xml.contains("<w:bidiVisual/>"));
    assert_eq!(xml.matches("<w:gridCol ").count(), 2);
    assert!(rows[1].contains("<w:gridSpan w:val=\"2\"/>"));
    let start = cells(rows[2]);
    let continuation = cells(rows[3]);
    assert!(start[0].contains("<w:vMerge w:val=\"restart\"/>"));
    assert!(continuation[0].contains("<w:vMerge/>"));
    assert!(heading(continuation[0]));
    assert!(continuation[0].ends_with("<w:p/>"));
    assert!(continuation[1].contains("<w:bidi w:val=\"false\"/>"));
    assert!(!heading(continuation[1]));
    assert!(xml.find("Row heading").unwrap() < xml.find("Regular value").unwrap());
}

#[test]
fn repeatable_rows_keep_their_existing_default_cell_emphasis() {
    let document = |cell_header| Document {
        title: String::new(),
        blocks: vec![table(vec![TableRow {
            header: true,
            cells: vec![cell("Column", cell_header)],
        }])],
    };
    assert_eq!(body(&document(false)), body(&document(true)));
    let plain = Document {
        title: String::new(),
        blocks: vec![table(vec![TableRow {
            header: false,
            cells: vec![cell("Value", false)],
        }])],
    };
    let xml = body(&plain);
    assert!(!xml.contains("<w:tblHeader") && !xml.contains("<w:shd") && !xml.contains("<w:b/>"));
    assert!(xml.contains("<w:r><w:rPr></w:rPr><w:t xml:space=\"preserve\">Value</w:t></w:r>"));
}

#[test]
fn a_merged_heading_after_ragged_gaps_does_not_style_the_gap_cells() {
    let mut label = cell("Heading", true);
    label.colspan = 2;
    label.rowspan = 2;
    let document = Document {
        title: String::new(),
        blocks: vec![table(vec![
            TableRow {
                header: false,
                cells: vec![cell("A", false), cell("B", false), label],
            },
            TableRow {
                header: false,
                cells: vec![],
            },
        ])],
    };
    let xml = body(&document);
    let rows = rows(&xml);
    let continuation = cells(rows[1]);
    assert_eq!(continuation.len(), 3);
    assert!(!heading(continuation[0]) && !heading(continuation[1]));
    assert!(heading(continuation[2]));
    assert!(continuation[2].contains("<w:gridSpan w:val=\"2\"/><w:vMerge/>"));
}

use document_ast_rust::*;

fn text(value: &str, link: Option<&str>) -> Inline {
    Inline::Text {
        text: value.into(),
        style: TextStyle {
            link: link.map(str::to_owned),
            ..Default::default()
        },
    }
}
fn paragraph(inlines: Vec<Inline>) -> Block {
    Block::Paragraph(Paragraph {
        inlines,
        ..Default::default()
    })
}
fn heading(id: &str) -> Block {
    Block::Heading {
        level: 2,
        id: id.into(),
        inlines: vec![text("Target", None)],
    }
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
fn targets(xml: &str) -> Vec<&str> {
    xml.split("<w:hyperlink w:anchor=\"")
        .skip(1)
        .map(|s| s.split('"').next().unwrap())
        .collect()
}

#[test]
fn fragments_resolve_forward_targets_once_without_changing_literal_ids() {
    for (fragment, ids, expected) in [
        ("caf%C3%A9", vec!["café"], "café"),
        ("caf%C3%A9", vec!["café", "caf%C3%A9"], "caf%C3%A9"),
        ("café", vec!["caf%C3%A9", "café"], "café"),
        ("part%2520two", vec!["part%20two"], "part%20two"),
        ("part%2520two", vec!["part two"], "part%2520two"),
        ("caf%C3%A9%zz", vec!["café%zz"], "café%zz"),
        ("bad%FF", vec!["bad�"], "bad�"),
        ("a+b", vec!["a b", "a+b"], "a+b"),
        ("a+b", vec!["a b"], "a+b"),
        ("bad%zz", vec!["bad%zz"], "bad%zz"),
        ("missing%20target", vec!["other"], "missing%20target"),
    ] {
        let mut blocks = vec![paragraph(vec![text("Link", Some(&format!("#{fragment}")))])];
        blocks.extend(ids.iter().map(|id| heading(id)));
        let document = Document {
            title: String::new(),
            blocks,
        };
        let xml = part(
            &docx_ast_rust::to_package(&document).unwrap(),
            "word/document.xml",
        );
        assert_eq!(targets(&xml), [expected], "fragment {fragment}");
        for id in ids {
            assert!(
                xml.contains(&format!("w:name=\"{id}\"")),
                "literal bookmark {id}"
            );
        }
    }
}

#[test]
fn modeled_targets_are_collected_through_scopes_tables_lists_and_footnotes() {
    let mut table_cell = TableCell {
        header: false,
        align: Align::Default,
        colspan: 1,
        rowspan: 1,
        blocks: vec![paragraph(vec![Inline::Direction {
            direction: Direction::Ltr,
            override_order: false,
            inlines: vec![Inline::Anchor("inline café".into())],
        }])],
    };
    table_cell.blocks.push(Block::Paragraph(Paragraph {
        id: "paragraph café".into(),
        inlines: vec![text("Paragraph", None)],
        ..Default::default()
    }));
    let links = [
        "heading%20caf%C3%A9",
        "inline%20caf%C3%A9",
        "paragraph%20caf%C3%A9",
        "note%20caf%C3%A9",
    ];
    let document = Document {
        title: String::new(),
        blocks: vec![
            paragraph(
                links
                    .iter()
                    .map(|id| text("Link", Some(&format!("#{id}"))))
                    .collect(),
            ),
            Block::Direction {
                direction: Direction::Ltr,
                blocks: vec![Block::List {
                    start: None,
                    style: ListStyle::Decimal,
                    delimiter: ListDelimiter::Period,
                    items: vec![vec![Block::Quote {
                        kind: None,
                        blocks: vec![
                            heading("heading café"),
                            Block::Table {
                                width: None,
                                column_widths: vec![],
                                rows: vec![TableRow {
                                    header: false,
                                    cells: vec![table_cell],
                                }],
                            },
                        ],
                    }]],
                }],
            },
            paragraph(vec![Inline::Note(vec![paragraph(vec![
                Inline::Anchor("note café".into()),
                text("Back", Some("#heading%20caf%C3%A9")),
            ])])]),
        ],
    };
    let package = docx_ast_rust::to_package(&document).unwrap();
    assert_eq!(
        targets(&part(&package, "word/document.xml")),
        ["heading café", "inline café", "paragraph café", "note café"]
    );
    assert_eq!(
        targets(&part(&package, "word/footnotes.xml")),
        ["heading café"]
    );
}

#[test]
fn image_hyperlinks_resolve_fragments_and_leave_external_uris_unchanged() {
    let image = |link: &str| Image {
        bytes: vec![137, 80, 78, 71],
        mime: "image/png".into(),
        width: 20.,
        height: 10.,
        alt: "Image".into(),
        title: String::new(),
        link: Some(link.into()),
    };
    let document = Document {
        title: String::new(),
        blocks: vec![
            Block::Image(image("#caf%C3%A9")),
            paragraph(vec![
                Inline::Image(image("#caf%C3%A9")),
                Inline::Note(vec![paragraph(vec![Inline::Image(image("#caf%C3%A9"))])]),
            ]),
            paragraph(vec![text(
                "External",
                Some("https://example.com/path#caf%C3%A9"),
            )]),
            heading("café"),
        ],
    };
    let package = docx_ast_rust::to_package(&document).unwrap();
    assert_eq!(
        targets(&part(&package, "word/document.xml")),
        ["café", "café"]
    );
    assert_eq!(targets(&part(&package, "word/footnotes.xml")), ["café"]);
    assert!(
        part(&package, "word/_rels/document.xml.rels")
            .contains("https://example.com/path#caf%C3%A9")
    );
}

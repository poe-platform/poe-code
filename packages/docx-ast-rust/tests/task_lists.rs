use document_ast_rust::*;

fn paragraph(text: &str, checked: Option<bool>) -> Block {
    Block::Paragraph(Paragraph {
        list_checked: checked,
        compact: true,
        inlines: vec![Inline::Text {
            text: text.into(),
            style: Default::default(),
        }],
        ..Default::default()
    })
}
fn list(start: Option<i64>, items: Vec<Vec<Block>>) -> Block {
    Block::List {
        start,
        items,
        style: ListStyle::Decimal,
        delimiter: ListDelimiter::Period,
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
fn paragraph_xml<'a>(body: &'a str, text: &str) -> &'a str {
    body.split("<w:p>")
        .find(|p| p.split("</w:p>").next().unwrap().contains(text))
        .unwrap()
        .split("</w:p>")
        .next()
        .unwrap()
}
fn definition<'a>(numbering: &'a str, paragraph: &str) -> &'a str {
    let id = paragraph
        .split("<w:numId w:val=\"")
        .nth(1)
        .unwrap()
        .split('"')
        .next()
        .unwrap();
    numbering
        .split(&format!("<w:abstractNum w:abstractNumId=\"{id}\">"))
        .nth(1)
        .unwrap()
        .split("</w:abstractNum>")
        .next()
        .unwrap()
}
#[test]
fn task_markers_replace_bullets_and_share_hanging_alignment() {
    let document = Document {
        blocks: vec![list(
            None,
            vec![
                vec![
                    paragraph("Pending item that wraps onto another line", Some(false)),
                    paragraph("Continuation", None),
                ],
                vec![paragraph("Completed item", Some(true))],
                vec![paragraph("Ordinary bullet", None)],
                vec![paragraph("Another completed item", Some(true))],
            ],
        )],
        ..Default::default()
    };
    let package = docx_ast_rust::to_package(&document).unwrap();
    let body = part(&package, "word/document.xml");
    let numbering = part(&package, "word/numbering.xml");
    for (text, marker) in [
        ("Pending item", "☐"),
        ("Completed item", "☑"),
        ("Ordinary bullet", "•"),
    ] {
        let p = paragraph_xml(&body, text);
        assert_eq!(p.matches("<w:numPr>").count(), 1);
        let d = definition(&numbering, p);
        assert!(
            d.contains(&format!("<w:lvlText w:val=\"{marker}\"/>")),
            "{d}"
        );
        assert!(d.contains("<w:ind w:left=\"360\" w:hanging=\"240\"/>"));
        if marker != "•" {
            assert!(!d.contains("w:val=\"•\""));
            assert!(d.contains("w:ascii=\"Segoe UI Symbol\""));
        }
    }
    let continued = paragraph_xml(&body, "Continuation");
    assert!(!continued.contains("<w:numPr>"));
    assert!(continued.contains("<w:ind w:left=\"360\"/>"));
    assert_eq!(
        definition(&numbering, paragraph_xml(&body, "Completed item")),
        definition(&numbering, paragraph_xml(&body, "Another completed item"))
    );
    assert!(
        !body.contains("[x]")
            && !body.contains("[ ]")
            && !body.contains('☐')
            && !body.contains('☑')
    );
}
#[test]
fn nested_tasks_and_direction_scopes_keep_one_marker_per_item() {
    let document = Document {
        blocks: vec![list(
            None,
            vec![vec![
                paragraph("Outer task", Some(false)),
                list(
                    None,
                    vec![vec![Block::Direction {
                        direction: Direction::Rtl,
                        blocks: vec![
                            paragraph("Nested completed", Some(true)),
                            paragraph("Nested continuation", None),
                        ],
                    }]],
                ),
            ]],
        )],
        ..Default::default()
    };
    let package = docx_ast_rust::to_package(&document).unwrap();
    let body = part(&package, "word/document.xml");
    let numbering = part(&package, "word/numbering.xml");
    assert_eq!(body.matches("<w:numPr>").count(), 2);
    assert!(!numbering.contains("w:val=\"•\""));
    assert!(
        definition(&numbering, paragraph_xml(&body, "Outer task"))
            .contains("<w:lvlText w:val=\"☐\"/>")
    );
    assert!(
        definition(&numbering, paragraph_xml(&body, "Nested completed"))
            .contains("<w:lvlText w:val=\"☑\"/>")
    );
    let nested = paragraph_xml(&body, "Nested completed");
    assert!(
        nested.contains("<w:ilvl w:val=\"1\"/>") && nested.contains("<w:bidi w:val=\"true\"/>")
    );
    assert!(definition(&numbering, nested).contains("<w:ind w:start=\"720\" w:hanging=\"240\"/>"));
    assert!(paragraph_xml(&body, "Nested continuation").contains("<w:ind w:start=\"720\"/>"));
}
#[test]
fn ordinary_ordered_items_keep_their_positions_around_tasks() {
    let document = Document {
        blocks: vec![list(
            Some(7),
            vec![
                vec![paragraph("Seventh", None)],
                vec![paragraph("Eighth task", Some(true))],
                vec![paragraph("Ninth", None)],
                vec![paragraph("Tenth", None)],
            ],
        )],
        ..Default::default()
    };
    let package = docx_ast_rust::to_package(&document).unwrap();
    let body = part(&package, "word/document.xml");
    let numbering = part(&package, "word/numbering.xml");
    assert!(
        definition(&numbering, paragraph_xml(&body, "Seventh")).contains("<w:start w:val=\"7\"/>")
    );
    assert!(
        definition(&numbering, paragraph_xml(&body, "Eighth task"))
            .contains("<w:lvlText w:val=\"☑\"/>")
    );
    let ninth = definition(&numbering, paragraph_xml(&body, "Ninth"));
    assert!(ninth.contains("<w:start w:val=\"9\"/>"));
    assert_eq!(ninth, definition(&numbering, paragraph_xml(&body, "Tenth")));
}

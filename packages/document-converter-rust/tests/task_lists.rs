use document_ast_rust::{Block, Direction, Document, Inline, Paragraph, list_item_checked};
use document_converter_rust::{Format, html, map_pandoc};
use mcp_protocol_rust::{cooperate::block_on, json};
use pdf_ast_rust::PdfOptions;
use std::collections::BTreeMap;

fn mapped(blocks: &str, format: Format) -> Document {
    let input = json::parse(
        format!(r#"{{"metadata":{{}},"blocks":{blocks}}}"#).as_bytes(),
        Default::default(),
    )
    .unwrap();
    let mut diagnostics = Vec::new();
    let document = block_on(map_pandoc(
        &input,
        format,
        &BTreeMap::new(),
        &mut PdfOptions::default(),
        false,
        None,
        &mut diagnostics,
    ))
    .unwrap();
    assert!(diagnostics.is_empty());
    document
}

fn items(block: &Block) -> &[Vec<Block>] {
    let Block::List { items, .. } = block else {
        panic!("expected list, got {block:?}")
    };
    items
}

fn paragraph(mut blocks: &[Block]) -> &Paragraph {
    loop {
        match blocks.first().expect("missing item paragraph") {
            Block::Direction { blocks: nested, .. } => blocks = nested,
            Block::Paragraph(paragraph) => return paragraph,
            block => panic!("expected paragraph, got {block:?}"),
        }
    }
}

fn text(inlines: &[Inline]) -> String {
    inlines
        .iter()
        .map(|inline| match inline {
            Inline::Text { text, .. } => text.clone(),
            Inline::Direction { inlines, .. } => text(inlines),
            Inline::Anchor(_) => String::new(),
            inline => panic!("unexpected inline {inline:?}"),
        })
        .collect()
}

fn assert_item(blocks: &[Block], checked: Option<bool>, label: &str) {
    assert_eq!(list_item_checked(blocks), checked);
    let paragraph = paragraph(blocks);
    assert_eq!(paragraph.list_checked, checked);
    assert_eq!(text(&paragraph.inlines), label);
}

#[test]
fn html_tasks_keep_checkbox_state_separate_from_rich_and_nested_item_text() {
    let document = html::from_html("<ul><li><input type='checkbox' checked>Done <b>bold</b><ol start='4'><li><input type='checkbox'>Nested pending</li><li>Nested ordinary</li></ol></li><li>Ordinary item</li></ul>").unwrap();
    assert_eq!(document.blocks.len(), 1);
    let outer = items(&document.blocks[0]);
    assert_eq!(outer.len(), 2);
    assert_eq!(outer[0].len(), 2);
    assert_item(&outer[0], Some(true), "Done bold");
    assert!(paragraph(&outer[0]).inlines.iter().any(
        |inline| matches!(inline, Inline::Text { text, style } if text == "bold" && style.bold)
    ));
    let Block::List {
        start,
        items: nested,
        ..
    } = &outer[0][1]
    else {
        panic!("missing nested list")
    };
    assert_eq!(*start, Some(4));
    assert_eq!(nested.len(), 2);
    assert_item(&nested[0], Some(false), "Nested pending");
    assert_item(&nested[1], None, "Nested ordinary");
    assert_item(&outer[1], None, "Ordinary item");
}

#[test]
fn pandoc_mixed_ordered_tasks_keep_start_nested_lists_and_rich_labels() {
    let blocks = r#"[{"t":"OrderedList","c":[[7,{"t":"Decimal"},{"t":"Period"}],[[{"t":"Plain","c":[{"t":"Str","c":"☑"},{"t":"Space"},{"t":"Strong","c":[{"t":"Str","c":"Done"}]}]},{"t":"BulletList","c":[[{"t":"Plain","c":[{"t":"Str","c":"☐"},{"t":"Space"},{"t":"Str","c":"Nested"}]}]]}],[{"t":"Plain","c":[{"t":"Str","c":"Ordinary"}]}],[{"t":"Plain","c":[{"t":"Str","c":"☒"},{"t":"Space"},{"t":"Emph","c":[{"t":"Str","c":"Crossed"}]}]}]]]}]"#;
    for format in [Format::Docx, Format::Pdf] {
        let document = mapped(blocks, format);
        assert_eq!(document.blocks.len(), 1);
        let Block::List {
            start,
            items: outer,
            ..
        } = &document.blocks[0]
        else {
            panic!("missing list")
        };
        assert_eq!(*start, Some(7));
        assert_eq!(outer.len(), 3);
        assert_item(&outer[0], Some(true), "Done");
        assert!(
            matches!(&paragraph(&outer[0]).inlines[..], [Inline::Text { style, .. }] if style.bold)
        );
        assert_item(&items(&outer[0][1])[0], Some(false), "Nested");
        assert_item(&outer[1], None, "Ordinary");
        assert_item(&outer[2], Some(true), "Crossed");
        assert!(
            matches!(&paragraph(&outer[2]).inlines[..], [Inline::Text { style, .. }] if style.italic)
        );
    }
}

#[test]
fn html_task_state_survives_block_direction_and_keeps_item_anchors() {
    let document = html::from_html("<ul><li id='task' dir='rtl'><p><input type='checkbox' checked>Directed</p></li><li><p dir='ltr'><input type='checkbox'>Pending</p></li></ul>").unwrap();
    let list = items(&document.blocks[0]);
    assert!(matches!(
        &list[0][0],
        Block::Direction {
            direction: Direction::Rtl,
            ..
        }
    ));
    assert!(matches!(
        &list[1][0],
        Block::Direction {
            direction: Direction::Ltr,
            ..
        }
    ));
    assert_item(&list[0], Some(true), "Directed");
    assert_item(&list[1], Some(false), "Pending");
    assert_eq!(paragraph(&list[0]).id, "task");
}

#[test]
fn html_tasks_inside_inline_direction_keep_the_direction_and_label() {
    let document = html::from_html(
        "<ul><li><span dir='rtl'><input type='checkbox' checked>Directed</span></li></ul>",
    )
    .unwrap();
    let item = &items(&document.blocks[0])[0];
    assert_item(item, Some(true), "Directed");
    assert!(matches!(
        &paragraph(item).inlines[..],
        [Inline::Direction {
            direction: Direction::Rtl,
            ..
        }]
    ));
}

#[test]
fn pandoc_tasks_survive_block_and_inline_direction_scopes() {
    let blocks = r#"[{"t":"BulletList","c":[[{"t":"Div","c":[["task",[],[["dir","rtl"]]],[{"t":"Plain","c":[{"t":"Str","c":"☐"},{"t":"Space"},{"t":"Str","c":"Block"}]}]]}],[{"t":"Plain","c":[{"t":"Span","c":[["",[],[["dir","ltr"]]],[{"t":"Str","c":"☑"},{"t":"Space"},{"t":"Str","c":"Inline"}]]}]}]]}]"#;
    for format in [Format::Docx, Format::Pdf] {
        let document = mapped(blocks, format);
        let list = items(&document.blocks[0]);
        assert!(matches!(
            &list[0][0],
            Block::Direction {
                direction: Direction::Rtl,
                ..
            }
        ));
        assert_item(&list[0], Some(false), "Block");
        assert_eq!(paragraph(&list[0]).id, "task");
        assert_item(&list[1], Some(true), "Inline");
        assert!(matches!(
            &paragraph(&list[1]).inlines[..],
            [Inline::Direction {
                direction: Direction::Ltr,
                ..
            }]
        ));
    }
}

#[test]
fn html_empty_tasks_remain_distinct_from_empty_ordinary_items() {
    let document = html::from_html("<ul><li><input type='checkbox' checked></li><li><input type='checkbox'></li><li></li></ul>").unwrap();
    let list = items(&document.blocks[0]);
    assert_eq!(list.len(), 3);
    assert_item(&list[0], Some(true), "");
    assert_item(&list[1], Some(false), "");
    assert!(paragraph(&list[0]).inlines.is_empty());
    assert!(paragraph(&list[1]).inlines.is_empty());
    assert!(list[2].is_empty());
    assert_eq!(list_item_checked(&list[2]), None);
}

#[test]
fn pandoc_empty_tasks_preserve_state_without_a_synthetic_text_label() {
    let blocks = r#"[{"t":"BulletList","c":[[{"t":"Plain","c":[{"t":"Str","c":"☑"},{"t":"Space"}]}],[{"t":"Plain","c":[{"t":"Str","c":"☐"}]}],[{"t":"Plain","c":[]}]]}]"#;
    for format in [Format::Docx, Format::Pdf] {
        let document = mapped(blocks, format);
        let list = items(&document.blocks[0]);
        assert_eq!(list.len(), 3);
        assert_item(&list[0], Some(true), "");
        assert_item(&list[1], Some(false), "");
        assert_item(&list[2], None, "");
        assert!(list.iter().all(|item| paragraph(item).inlines.is_empty()));
    }
}

#[test]
fn html_literal_code_and_nonleading_checkboxes_do_not_become_task_state() {
    let document = html::from_html("<p>☐ Outside a list</p><ul><li>[x] Literal</li><li>☐joined</li><li><code>☑ Code</code></li><li>Before <input type='checkbox' checked>after</li><li><p>First</p><p><input type='checkbox'>Second</p></li><li><pre>☐ Code block</pre></li></ul>").unwrap();
    assert_item(&document.blocks[..1], None, "☐ Outside a list");
    let list = items(&document.blocks[1]);
    for (item, label) in list[..5].iter().zip([
        "[x] Literal",
        "☐joined",
        "☑ Code",
        "Before ☑ after",
        "First",
    ]) {
        assert_item(item, None, label);
    }
    assert!(matches!(&paragraph(&list[2]).inlines[..], [Inline::Text { style, .. }] if style.code));
    assert_item(&list[4][1..], None, "☐ Second");
    assert_eq!(list_item_checked(&list[5]), None);
    assert!(matches!(&list[5][0], Block::Code { text, .. } if text == "☐ Code block"));
}

#[test]
fn pandoc_literal_and_code_markers_remain_text_and_do_not_mark_later_paragraphs() {
    let blocks = r#"[{"t":"Para","c":[{"t":"Str","c":"☐ Outside"}]},{"t":"BulletList","c":[[{"t":"Plain","c":[{"t":"Str","c":"[ ] Literal"}]}],[{"t":"Plain","c":[{"t":"Str","c":"☑joined"}]}],[{"t":"Plain","c":[{"t":"Code","c":[["",[],[]],"☑ Code"]}]}],[{"t":"Plain","c":[{"t":"Str","c":"First"}]},{"t":"Para","c":[{"t":"Str","c":"☐ Second"}]}],[{"t":"CodeBlock","c":[["",[],[]],"☐ Code block"]}]]}]"#;
    for format in [Format::Docx, Format::Pdf] {
        let document = mapped(blocks, format);
        assert_item(&document.blocks[..1], None, "☐ Outside");
        let list = items(&document.blocks[1]);
        for (item, label) in list[..4]
            .iter()
            .zip(["[ ] Literal", "☑joined", "☑ Code", "First"])
        {
            assert_item(item, None, label);
        }
        assert!(
            matches!(&paragraph(&list[2]).inlines[..], [Inline::Text { style, .. }] if style.code)
        );
        assert_item(&list[3][1..], None, "☐ Second");
        assert_eq!(list_item_checked(&list[4]), None);
        assert!(matches!(&list[4][0], Block::Code { text, .. } if text == "☐ Code block"));
    }
}

#[test]
fn formatted_ballot_symbols_need_whitespace_before_the_label() {
    let document =
        html::from_html("<ul><li><b>☑</b>joined</li><li><b>☑</b> separated</li></ul>").unwrap();
    let list = items(&document.blocks[0]);
    assert_item(&list[0], None, "☑joined");
    assert_item(&list[1], Some(true), "separated");
    let blocks = r#"[{"t":"BulletList","c":[[{"t":"Plain","c":[{"t":"Strong","c":[{"t":"Str","c":"☐"}]},{"t":"Str","c":"joined"}]}],[{"t":"Plain","c":[{"t":"Strong","c":[{"t":"Str","c":"☐"}]},{"t":"Space"},{"t":"Str","c":"separated"}]}]]}]"#;
    for format in [Format::Docx, Format::Pdf] {
        let document = mapped(blocks, format);
        let list = items(&document.blocks[0]);
        assert_item(&list[0], None, "☐joined");
        assert_item(&list[1], Some(false), "separated");
    }
}

#[test]
fn task_boundaries_cross_direction_scopes_without_losing_anchors_or_label_style() {
    let document = html::from_html("<ul><li><span dir='rtl'>☑</span>joined</li><li>☐<span dir='ltr'>joined</span></li><li><span dir='rtl'>☑</span><span dir='ltr'> separated</span></li><li><span id='before'></span><span dir='rtl'><span id='inside'></span><input type='checkbox' checked><b>Label</b></span></li></ul>").unwrap();
    let list = items(&document.blocks[0]);
    assert_item(&list[0], None, "☑joined");
    assert_item(&list[1], None, "☐joined");
    assert_item(&list[2], Some(true), "separated");
    assert_item(&list[3], Some(true), "Label");
    let [
        Inline::Anchor(before),
        Inline::Direction {
            direction, inlines, ..
        },
    ] = &paragraph(&list[3]).inlines[..]
    else {
        panic!("anchors or direction changed")
    };
    assert_eq!(before, "before");
    assert_eq!(*direction, Direction::Rtl);
    assert!(
        matches!(&inlines[..], [Inline::Anchor(inside), Inline::Text { text, style }] if inside == "inside" && text == "Label" && style.bold)
    );

    let blocks = r#"[{"t":"BulletList","c":[[{"t":"Plain","c":[{"t":"Span","c":[["",[],[["dir","rtl"]]],[{"t":"Str","c":"☑"}]]},{"t":"Str","c":"joined"}]}],[{"t":"Plain","c":[{"t":"Str","c":"☐"},{"t":"Span","c":[["",[],[["dir","ltr"]]],[{"t":"Str","c":"joined"}]]}]}],[{"t":"Plain","c":[{"t":"Span","c":[["",[],[["dir","rtl"]]],[{"t":"Str","c":"☑"}]]},{"t":"Span","c":[["",[],[["dir","ltr"]]],[{"t":"Space"},{"t":"Str","c":"separated"}]]}]}]]}]"#;
    for format in [Format::Docx, Format::Pdf] {
        let document = mapped(blocks, format);
        let list = items(&document.blocks[0]);
        assert_item(&list[0], None, "☑joined");
        assert_item(&list[1], None, "☐joined");
        assert_item(&list[2], Some(true), "separated");
    }
}

#[test]
fn stripping_task_prefix_preserves_whitespace_inside_code_labels() {
    let document =
        html::from_html("<ul><li><input type='checkbox' checked><code>  label</code></li></ul>")
            .unwrap();
    let item = &items(&document.blocks[0])[0];
    assert_item(item, Some(true), "  label");
    assert!(matches!(&paragraph(item).inlines[..], [Inline::Text { style, .. }] if style.code));
    let blocks = r#"[{"t":"BulletList","c":[[{"t":"Plain","c":[{"t":"Str","c":"☑"},{"t":"Space"},{"t":"Code","c":[["",[],[]],"  label"]}]}]]}]"#;
    for format in [Format::Docx, Format::Pdf] {
        let document = mapped(blocks, format);
        let item = &items(&document.blocks[0])[0];
        assert_item(item, Some(true), "  label");
        assert!(matches!(&paragraph(item).inlines[..], [Inline::Text { style, .. }] if style.code));
    }
}

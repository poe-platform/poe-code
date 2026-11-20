use safe_bash_rust::{
    commands::codecs::parse_zip_archive,
    document::{self, Block, Inline},
};

fn part(bytes: &[u8], name: &str) -> String {
    let entries = parse_zip_archive(bytes).unwrap();
    String::from_utf8(
        entries
            .into_iter()
            .find(|p| p.name == name)
            .unwrap()
            .content,
    )
    .unwrap()
}

#[test]
fn word_styles_are_visible_and_internal_links_resolve() {
    let doc = document::from_html("<h1 id='intro'>Title</h1><p>A <a href='#intro'>link</a> with <mark>highlight</mark>.</p><pre><code>let x = 1;\n  x + 2</code></pre>").unwrap();
    let bytes = document::write_docx(&doc).unwrap();
    let styles = part(&bytes, "word/styles.xml");
    assert!(styles.contains("w:styleId=\"Heading1\""));
    assert!(styles.contains("<w:sz w:val=\"40\"/>"));
    assert!(styles.contains("<w:keepNext/>"));
    assert!(styles.contains("w:styleId=\"SourceCode\""));
    assert!(styles.contains("w:ascii=\"Courier New\""));
    let body = part(&bytes, "word/document.xml");
    assert!(body.contains("w:bookmarkStart"));
    assert!(body.contains("w:anchor=\"intro\""));
    assert!(body.contains("w:fill=\"FFF3A3\""));
    assert!(body.contains("w:pStyle w:val=\"SourceCode\""));
}

#[test]
fn shared_content_preserves_custom_wrappers_runs_and_list_numbers() {
    let doc = document::from_html("<custom-block><h2>Custom</h2><p><b>bold <i>both</i></b> <u>under</u><sub>2</sub><sup>3</sup></p></custom-block><ol start='5'><li>fifth<ul><li>nested</li></ul></li><li>sixth</li></ol>").unwrap();
    assert!(matches!(&doc.blocks[0], Block::Heading { level: 2, .. }));
    let Block::Paragraph(p) = &doc.blocks[1] else {
        panic!()
    };
    assert!(p.inlines.iter().any(
        |i| matches!(i, Inline::Text{text,style} if text == "both" && style.bold && style.italic)
    ));
    assert!(matches!(&doc.blocks[2], Block::List {start:Some(5),items,..} if items.len()==2));
    let bytes = document::write_docx(&doc).unwrap();
    let numbering = part(&bytes, "word/numbering.xml");
    assert!(numbering.contains("<w:start w:val=\"5\"/>"));
    let body = part(&bytes, "word/document.xml");
    assert!(body.contains("<w:b/><w:i/>"));
    assert!(body.contains("<w:u w:val=\"single\"/>"));
}

#[test]
fn table_alignment_and_spans_have_word_geometry() {
    let doc = document::from_html("<table><thead><tr><th>Left</th><th align='center'>Center</th><th style='text-align:right'>Right</th></tr></thead><tbody><tr><td colspan='2'>Wide</td><td>End</td></tr></tbody></table>").unwrap();
    let bytes = document::write_docx(&doc).unwrap();
    let body = part(&bytes, "word/document.xml");
    assert!(body.contains("<w:tblBorders>"));
    assert!(body.contains("<w:tcMar>"));
    assert!(body.contains("<w:jc w:val=\"center\"/>"));
    assert!(body.contains("<w:jc w:val=\"right\"/>"));
    assert!(body.contains("<w:gridSpan w:val=\"2\"/>"));
    assert!(body.contains("<w:tblHeader/>"));
}

#[test]
fn html_list_item_values_and_reverse_order_survive_both_writers() {
    use pdf_ast_rust::{Paint, PdfOptions, layout_document};
    for (html, expected) in [
        (
            "<ol><li>One</li><li value='5'>Five</li><li>Six</li></ol>",
            vec![1, 5, 6],
        ),
        (
            "<ol reversed><li>Three</li><li>Two</li><li>One</li></ol>",
            vec![3, 2, 1],
        ),
        (
            "<ol reversed start='8'><li>Eight</li><li>Seven</li><li>Six</li></ol>",
            vec![8, 7, 6],
        ),
        (
            "<ol reversed><li>Three</li><li value='0'>Zero</li><li>Negative</li></ol>",
            vec![3, 0, -1],
        ),
        (
            "<ol start='0'><li>Zero</li><li value='-2'>Negative</li><li>Next</li></ol>",
            vec![0, -2, -1],
        ),
        (
            "<ol start='8'><li>Eight</li><li value='9'>Nine</li><li>Ten</li></ol>",
            vec![8, 9, 10],
        ),
    ] {
        let doc = document::from_html(html).unwrap();
        let layout = layout_document(&doc, &PdfOptions::default()).unwrap();
        let markers: Vec<_> = layout
            .pages
            .iter()
            .flat_map(|page| &page.paints)
            .filter_map(|paint| {
                let Paint::Text { text, .. } = paint else {
                    return None;
                };
                text.strip_suffix('.')
                    .and_then(|number| number.parse::<i64>().ok())
            })
            .collect();
        assert_eq!(markers, expected, "{html}");
        let word = document::write_docx(&doc).unwrap();
        let numbering = part(&word, "word/numbering.xml");
        let mut actual = Vec::new();
        let mut counts = doc.blocks.iter().filter_map(|block| match block {
            Block::List { items, .. } => Some(items.len()),
            _ => None,
        });
        for level in numbering.split("<w:lvl w:ilvl=\"0\">").skip(1) {
            let value = level
                .split("<w:start w:val=\"")
                .nth(1)
                .unwrap()
                .split('"')
                .next()
                .unwrap()
                .parse::<i64>()
                .unwrap();
            actual.extend((0..counts.next().unwrap()).map(|offset| value + offset as i64));
        }
        assert_eq!(actual, expected, "Word numbering: {html}");
    }
}

#[test]
fn external_images_are_never_silently_omitted() {
    assert!(
        document::from_html("<p>Before<img src='https://example.org/image.png'>After</p>")
            .unwrap_err()
            .contains("embedded")
    );
}

#[test]
fn callout_title_is_shared_once_by_both_writers() {
    let doc = document::from_html(
        "<div data-tone='note'><p class='md-alert-title'>Note</p><p>Body</p></div>",
    )
    .unwrap();
    let Block::Quote { kind, blocks } = &doc.blocks[0] else {
        panic!()
    };
    assert_eq!(kind.as_deref(), Some("Note"));
    assert_eq!(blocks.len(), 1);
    let body = part(&document::write_docx(&doc).unwrap(), "word/document.xml");
    assert_eq!(body.matches(">Note</w:t>").count(), 1);
}

#[test]
fn pandoc_public_commands_use_complete_portable_files() {
    use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
    use std::sync::Arc;
    let fs = MemoryVfs::new();
    fs.write_file(
        "/input.html",
        b"<h1 id='intro'>Portable</h1><p><u>Underlined</u> <mark>marked</mark></p>",
    )
    .unwrap();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    for format in ["docx", "pdf"] {
        let result = shell
            .exec(&format!(
                "pandoc -f html -t {format} /input.html -o /output.{format}"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let bytes = fs.read_file(&format!("/output.{format}")).unwrap();
        if format == "docx" {
            let body = part(&bytes, "word/document.xml");
            assert!(body.contains("<w:u w:val=\"single\"/>"));
            assert!(body.contains("FFF3A3"));
        } else {
            let text = String::from_utf8_lossy(&bytes);
            assert!(text.starts_with("%PDF-"));
            assert!(text.contains("startxref"));
            assert!(text.contains("/Type /Catalog"));
            assert!(!text.contains("SAFE_PDF_V2"));
        }
    }
}

#[test]
fn merged_word_cells_continue_with_the_same_grid_span() {
    let doc=document::from_html("<table><tr><td rowspan='2' colspan='2'>Merged</td><td>A</td></tr><tr><td>B</td></tr></table>").unwrap();
    let body = part(&document::write_docx(&doc).unwrap(), "word/document.xml");
    assert_eq!(body.matches("<w:gridSpan w:val=\"2\"/>").count(), 2);
    assert!(body.contains("<w:gridSpan w:val=\"2\"/><w:vMerge/>"));
    assert_eq!(body.matches("<w:gridCol ").count(), 3);
}

#[test]
fn embedded_media_and_metadata_are_complete() {
    use document::{Document, Image, Paragraph};
    let image=Image{bytes:safe_bash_rust::commands::archive::base64_decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC").unwrap(),mime:"image/png".into(),width:120.,height:40.,alt:"A & B".into(),title:String::new(),link:None};
    let doc = Document {
        title: "A <title>".into(),
        blocks: vec![Block::Paragraph(Paragraph {
            inlines: vec![Inline::Image(image)],
            ..Default::default()
        })],
    };
    let bytes = document::write_docx(&doc).unwrap();
    let entries = parse_zip_archive(&bytes).unwrap();
    assert!(entries.iter().any(|e| e.name == "word/media/image-1.png"));
    let rels = part(&bytes, "word/_rels/document.xml.rels");
    assert!(rels.contains("Target=\"media/image-1.png\""));
    let body = part(&bytes, "word/document.xml");
    assert!(body.contains("descr=\"A &amp; B\""));
    assert!(body.contains("cx=\"1143000\" cy=\"381000\""));
    assert!(part(&bytes, "docProps/core.xml").contains("A &lt;title&gt;"));
}

#[test]
fn custom_inline_lowering_can_produce_a_block_without_losing_structure() {
    let doc = document::from_html(
        "<p id='custom'>Before <table><tr><td>Cell</td></tr></table> after</p>",
    )
    .unwrap();
    assert_eq!(doc.blocks.len(), 3);
    assert!(matches!(&doc.blocks[1], Block::Table { .. }));
    let Block::Paragraph(before) = &doc.blocks[0] else {
        panic!()
    };
    assert_eq!(before.id, "custom");
    let body = part(&document::write_docx(&doc).unwrap(), "word/document.xml");
    assert_eq!(body.matches("<w:tbl>").count(), 1);
}

#[test]
fn inline_code_preserves_authored_spaces() {
    let doc = document::from_html("<p><code> a  b </code></p>").unwrap();
    let Block::Paragraph(p) = &doc.blocks[0] else {
        panic!()
    };
    assert!(matches!(&p.inlines[0],Inline::Text{text,style} if text==" a  b " && style.code));
}

#[test]
fn ordered_list_styles_and_delimiters_survive_the_shared_model() {
    use document::{ListDelimiter, ListStyle};
    for (kind, format) in [
        ("a", "lowerLetter"),
        ("A", "upperLetter"),
        ("i", "lowerRoman"),
        ("I", "upperRoman"),
    ] {
        let doc = document::from_html(&format!(
            "<ol type='{kind}' start='5' data-list-delimiter='TwoParens'><li>Five</li></ol>"
        ))
        .unwrap();
        let numbering = part(&document::write_docx(&doc).unwrap(), "word/numbering.xml");
        assert!(numbering.contains(&format!("<w:numFmt w:val=\"{format}\"/>")));
        assert!(numbering.contains("<w:lvlText w:val=\"(%1)\"/>"));
        assert!(numbering.contains("<w:start w:val=\"5\"/>"));
    }
    assert_eq!(
        ListStyle::UpperRoman.marker(14, ListDelimiter::OneParen),
        "XIV)"
    );
    assert_eq!(
        ListStyle::LowerAlpha.marker(27, ListDelimiter::Period),
        "aa."
    );
    assert_eq!(
        ListStyle::Decimal.marker(-2, ListDelimiter::TwoParens),
        "(-2)"
    );
}

#[test]
fn explicit_table_and_column_widths_are_kept() {
    let doc=document::from_html("<table style='width:50%'><colgroup><col style='width:25%'><col style='width:75%'></colgroup><tr><td>Small</td><td>Large</td></tr></table>").unwrap();
    let Block::Table {
        width,
        column_widths,
        ..
    } = &doc.blocks[0]
    else {
        panic!()
    };
    assert_eq!(*width, Some(0.5));
    assert_eq!(column_widths, &[0.25, 0.75]);
    let body = part(&document::write_docx(&doc).unwrap(), "word/document.xml");
    assert!(body.contains("<w:tblW w:w=\"2500\" w:type=\"pct\"/>"));
    assert!(body.contains("<w:gridCol w:w=\"990\"/><w:gridCol w:w=\"2970\"/>"));
}

#[test]
fn pandoc_json_ordered_numbering_remains_compatible() {
    use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
    use std::sync::Arc;
    let fs = MemoryVfs::new();
    fs.write_file("/input.json",br#"{"pandoc-api-version":[1,23,1],"meta":{},"blocks":[{"t":"OrderedList","c":[[4,{"t":"UpperRoman"},{"t":"TwoParens"}],[[{"t":"Plain","c":[{"t":"Str","c":"Four"}]}]]]}]}"#).unwrap();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell
        .exec("pandoc -f json -t docx /input.json -o /output.docx")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let numbering = part(&fs.read_file("/output.docx").unwrap(), "word/numbering.xml");
    assert!(numbering.contains("<w:numFmt w:val=\"upperRoman\"/>"));
    assert!(numbering.contains("<w:lvlText w:val=\"(%1)\"/>"));
    assert!(numbering.contains("<w:start w:val=\"4\"/>"));
}

#[test]
fn images_in_html_links_keep_their_destination() {
    let html = "<p><a href='https://example.com/report'><img src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC' alt='Report'></a></p>";
    let d = document::from_html(html).unwrap();
    let Block::Paragraph(p) = &d.blocks[0] else {
        panic!("paragraph")
    };
    let Inline::Image(image) = &p.inlines[0] else {
        panic!("image")
    };
    assert_eq!(image.link.as_deref(), Some("https://example.com/report"));
    let bytes = document::write_docx(&d).unwrap();
    assert!(part(&bytes, "word/document.xml").contains("<w:hyperlink r:id="));
    assert!(
        part(&bytes, "word/_rels/document.xml.rels")
            .contains("Target=\"https://example.com/report\"")
    );
}

#[test]
fn html_wrapper_anchors_and_table_captions_preserve_semantics_without_blank_lines() {
    let d = document::from_html("<div id='wrapper'><p>Visible</p></div><a id='standalone'></a><pre id='code'>let x = 1;</pre><table id='table'><caption><strong>Caption</strong> <a href='https://example.com/caption'>link</a></caption><tr><td>Cell</td></tr></table><ul id='list'><li>Item</li></ul><blockquote id='quote'><p>Quoted</p></blockquote>").unwrap();
    let bytes = document::write_docx(&d).unwrap();
    let body = part(&bytes, "word/document.xml");
    for id in ["wrapper", "standalone", "code", "table", "list", "quote"] {
        assert!(
            body.contains(&format!("w:name=\"{id}\"")),
            "missing anchor {id}"
        );
    }
    assert!(body.contains("Caption"));
    assert!(body.contains("<w:b/>"));
    assert!(part(&bytes, "word/_rels/document.xml.rels").contains("https://example.com/caption"));
    assert_eq!(
        body.matches("<w:p>").count(),
        6,
        "anchors must not add visible paragraphs"
    );
}

#[test]
fn only_table_captions_keep_with_the_following_block() {
    let d=document::from_html("<figure><p>Figure content</p><figcaption>Figure caption</figcaption></figure><p>Ordinary prose</p><table><caption>Table caption</caption><tr><td>Cell</td></tr></table>").unwrap();
    for block in &d.blocks {
        if let Block::Paragraph(p) = block {
            let text = p
                .inlines
                .iter()
                .filter_map(|i| {
                    if let Inline::Text { text, .. } = i {
                        Some(text.as_str())
                    } else {
                        None
                    }
                })
                .collect::<String>();
            assert_eq!(p.keep_with_next, text == "Table caption", "{text}");
        }
    }
}

#[test]
fn html_table_structure_identifiers_remain_word_bookmarks() {
    let d = document::from_html("<table id='table'><thead id='head'><tr id='head-row'><th id='head-cell'>Header</th></tr></thead><tbody id='body'><tr id='body-row'><td id='body-cell'><p id='paragraph'>Body</p></td></tr></tbody><tfoot id='foot'><tr id='foot-row'><td id='foot-cell'>Foot</td></tr></tfoot></table>").unwrap();
    let body = part(&document::write_docx(&d).unwrap(), "word/document.xml");
    for id in [
        "table",
        "head",
        "head-row",
        "head-cell",
        "body",
        "body-row",
        "body-cell",
        "paragraph",
        "foot",
        "foot-row",
        "foot-cell",
    ] {
        assert_eq!(
            body.matches(&format!("w:name=\"{id}\"")).count(),
            1,
            "missing or duplicated bookmark {id}"
        );
    }
    assert_eq!(
        body.matches("<w:p>").count(),
        3,
        "IDs must not add visible paragraphs"
    );
}

#[test]
fn anchor_only_word_cells_still_contain_a_paragraph() {
    for tag in ["p", "h2"] {
        let html = format!(
            "<table><tr><td><{tag} id='cell-block'><a id='empty'></a></{tag}></td><td>Neighbor</td></tr></table>"
        );
        let d = document::from_html(&html).unwrap();
        let body = part(&document::write_docx(&d).unwrap(), "word/document.xml");
        let first_cell = body
            .split("<w:tc>")
            .nth(1)
            .unwrap()
            .split("</w:tc>")
            .next()
            .unwrap();
        assert!(first_cell.contains("w:name=\"empty\""));
        assert!(
            first_cell.contains("<w:p>") || first_cell.contains("<w:p/>"),
            "Word requires a paragraph inside an anchored empty cell: {first_cell}"
        );
    }
}

#[test]
fn empty_html_table_parts_preserve_ids_without_inventing_cells() {
    let d = document::from_html("<table><thead id='empty-head'></thead><tbody><tr id='empty-row'></tr><tr><td id='empty-cell'></td><td>Content</td></tr></tbody><tfoot id='empty-foot'></tfoot></table><p>After table</p>").unwrap();
    let body = part(&document::write_docx(&d).unwrap(), "word/document.xml");
    for id in ["empty-head", "empty-row", "empty-cell", "empty-foot"] {
        assert_eq!(
            body.matches(&format!("w:name=\"{id}\"")).count(),
            1,
            "missing or duplicated bookmark {id}"
        );
    }
    assert_eq!(body.matches("<w:tr>").count(), 1);
    assert_eq!(body.matches("<w:tc>").count(), 2);
    let first_cell = body
        .split("<w:tc>")
        .nth(1)
        .unwrap()
        .split("</w:tc>")
        .next()
        .unwrap();
    assert!(first_cell.contains("<w:p/>") || first_cell.contains("<w:p>"));
    assert!(first_cell.contains("w:name=\"empty-head\""));
    assert!(first_cell.contains("w:name=\"empty-row\""));
    assert!(body.find("</w:tbl>").unwrap() < body.find("w:name=\"empty-foot\"").unwrap());
}

#[test]
fn mixed_header_cells_keep_emphasis_without_changing_nested_table_semantics() {
    let doc = document::from_html("<table><tr><th scope='row' id='label'><p>Label</p><p>Second <em>Italic</em></p><ul><li>Nested</li></ul><table><tr><td>Inner</td></tr></table></th><td>Value</td></tr></table>").unwrap();
    let body = part(&document::write_docx(&doc).unwrap(), "word/document.xml");
    assert_eq!(
        body.matches("<w:p>").count(),
        5,
        "cell paragraphs stay separate"
    );
    for (label, bold) in [
        ("Label", true),
        ("Second ", true),
        ("Italic", true),
        ("Nested", true),
        ("Inner", false),
        ("Value", false),
    ] {
        let run = body
            .split("<w:r>")
            .skip(1)
            .map(|run| run.split("</w:r>").next().unwrap())
            .find(|run| run.contains(&format!(">{label}<")))
            .unwrap();
        assert_eq!(run.contains("<w:b/>"), bold, "Word font weight for {label}");
    }
    assert!(body.contains("w:name=\"label\""));
    let pdf = document::pdf::layout_document(&doc, &Default::default()).unwrap();
    for (label, bold) in [
        ("Label", true),
        ("Second ", true),
        ("Italic", true),
        ("Nested", true),
        ("Inner", false),
        ("Value", false),
    ] {
        let font = pdf
            .pages
            .iter()
            .flat_map(|page| &page.paints)
            .find_map(|paint| {
                if let document::pdf::Paint::Text { text, font, .. } = paint {
                    (text == label).then_some(&pdf.fonts[*font].id)
                } else {
                    None
                }
            })
            .unwrap();
        assert_eq!(
            font.contains("Bold"),
            bold,
            "PDF font weight for {label}: {font}"
        );
    }
}

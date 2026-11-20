use safe_bash_rust::{commands::codecs::parse_zip_archive, document};

fn body(html: &str) -> String {
    let document = document::from_html(html).unwrap();
    let bytes = document::write_docx(&document).unwrap();
    String::from_utf8(
        parse_zip_archive(&bytes)
            .unwrap()
            .into_iter()
            .find(|part| part.name == "word/document.xml")
            .unwrap()
            .content,
    )
    .unwrap()
}

#[test]
fn only_column_headers_repeat_and_section_headers_keep_their_emphasis() {
    let xml = body(
        "<table><thead><tr><th>Column A</th><th>Column B</th></tr></thead><tbody><tr><th>Section one</th><th>Details</th></tr><tr><th>Row label</th><td>Regular value</td></tr></tbody><tbody><tr><th>Section two</th><th>Details</th></tr><tr><td>Body</td><td>Value</td></tr></tbody></table>",
    );
    assert_eq!(
        xml.matches("<w:tblHeader/>").count(),
        1,
        "Only the actual column-header row repeats: {xml}"
    );
    for label in ["Column A", "Section one", "Section two", "Row label"] {
        let run = xml.split("<w:r>").find(|run| run.contains(label)).unwrap();
        assert!(
            run.split("</w:r>").next().unwrap().contains("<w:b/>"),
            "Heading cell {label} must remain emphasized"
        );
    }
}

#[test]
fn html_table_groups_follow_rendered_header_body_footer_order() {
    let xml = body(
        "<table><tfoot><tr><td>Foot</td></tr></tfoot><tbody><tr><td>Body</td></tr></tbody><thead><tr><th>Head</th></tr></thead></table>",
    );
    assert!(
        xml.find("Head").unwrap() < xml.find(">Body<").unwrap(),
        "{xml}"
    );
    assert!(
        xml.find(">Body<").unwrap() < xml.find(">Foot<").unwrap(),
        "{xml}"
    );
    assert_eq!(xml.matches("<w:tblHeader/>").count(), 1);
}

#[test]
fn heading_cell_role_reaches_code_blocks_without_styling_neighboring_data() {
    let xml = body(
        "<table><tbody><tr><th><pre>Heading code</pre></th><td><pre>Data code</pre></td></tr></tbody></table>",
    );
    let heading = xml
        .split("<w:r>")
        .find(|run| run.contains("Heading code"))
        .unwrap()
        .split("</w:r>")
        .next()
        .unwrap();
    let data = xml
        .split("<w:r>")
        .find(|run| run.contains("Data code"))
        .unwrap()
        .split("</w:r>")
        .next()
        .unwrap();
    assert!(heading.contains("<w:b/>"), "{heading}");
    assert!(!data.contains("<w:b/>"), "{data}");
}

#[test]
fn html_row_spans_stay_inside_their_groups_and_zero_reaches_group_end() {
    let d = document::from_html("<table><thead><tr><th rowspan='8'>Head</th><th>Value</th></tr><tr id='empty'></tr></thead><tbody><tr><th rowspan='0'>Label</th><td>First</td></tr><tr><td>Second</td></tr></tbody><tfoot><tr><td>Foot</td><td>Total</td></tr></tfoot></table>").unwrap();
    let document::Block::Table { rows, .. } = &d.blocks[0] else {
        panic!()
    };
    assert_eq!(rows.len(), 4);
    assert_eq!(
        rows[0].cells[0].rowspan, 1,
        "heading span cannot spill into the body or count omitted empty rows"
    );
    assert_eq!(
        rows[1].cells[0].rowspan, 2,
        "zero span covers remaining body rows"
    );
    assert!(rows[1].cells[0].header);
    assert!(!rows[1].header);
    assert_eq!(rows[3].cells[0].rowspan, 1);
    document::write_docx(&d).unwrap();
    document::write_pdf(&d).unwrap();
}

#[test]
fn cell_roles_mark_headings_but_invalid_td_scope_does_not() {
    let d = document::from_html("<table><tr><td role=' rowheader '><pre>Label</pre></td><td scope='row'>Data</td></tr></table>").unwrap();
    let document::Block::Table { rows, .. } = &d.blocks[0] else {
        panic!()
    };
    assert!(rows[0].cells[0].header);
    assert!(!rows[0].cells[1].header);
    assert!(!rows[0].header);
}

#[test]
fn native_raw_pandoc_exports_ignore_data_cell_scope() {
    use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
    use std::sync::Arc;
    let fs = MemoryVfs::new();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let source = r#"{"pandoc-api-version":[1,23,1],"meta":{},"blocks":[{"t":"RawBlock","c":["html","<table><tr><td scope='row'>Data</td><td>Value</td></tr></table>"]}]}"#;
    fs.write_file("/scope.json", source.as_bytes()).unwrap();
    fs.write_file("/plain.json", source.replace(" scope='row'", "").as_bytes())
        .unwrap();
    for format in ["docx", "pdf"] {
        for input in ["scope", "plain"] {
            let result = shell
                .exec(&format!(
                    "pandoc -f json -t {format} /{input}.json -o /{input}.{format}"
                ))
                .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
        }
        assert_eq!(
            fs.read_file(&format!("/scope.{format}")).unwrap(),
            fs.read_file(&format!("/plain.{format}")).unwrap()
        );
    }
}

#[test]
fn an_empty_explicit_head_does_not_promote_body_headings_to_repeating_rows() {
    let d = document::from_html("<table><thead id='head'></thead><tr><th>Section</th><th>Details</th></tr><tr><td>Body</td><td>Value</td></tr></table>").unwrap();
    let document::Block::Table { rows, .. } = &d.blocks[0] else {
        panic!()
    };
    assert!(!rows[0].header);
    assert!(rows[0].cells.iter().all(|cell| cell.header));
    assert!(!rows[1].header);
    document::write_docx(&d).unwrap();
    document::write_pdf(&d).unwrap();
}

#[test]
fn empty_authored_rows_and_groups_consume_implicit_header_inference() {
    for empty in ["<tr id='empty'></tr>", "<tbody id='empty'></tbody>"] {
        let html = format!(
            "<table>{empty}<tr><th>Section</th><th>Details</th></tr><tr><td>Body</td><td>Value</td></tr></table>"
        );
        let d = document::from_html(&html).unwrap();
        let document::Block::Table { rows, .. } = &d.blocks[0] else {
            panic!()
        };
        assert_eq!(rows.len(), 2);
        assert!(!rows[0].header);
        assert!(rows[0].cells.iter().all(|cell| cell.header));
        let xml = body(&html);
        assert!(xml.contains("w:name=\"empty\""));
        assert!(!xml.contains("<w:tblHeader/>"));
        document::write_pdf(&d).unwrap();
    }
}

#[test]
fn inferred_headers_use_effective_group_bounded_rowspans() {
    for span in ["0", "99"] {
        let d = document::from_html(&format!(
            "<table><tr><th rowspan='{span}'>Head</th><th>Other</th></tr><tr></tr></table>"
        ))
        .unwrap();
        let document::Block::Table { rows, .. } = &d.blocks[0] else {
            panic!()
        };
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].cells[0].rowspan, 1);
        assert!(
            rows[0].header,
            "effective span cannot cross a boundary when only the header remains"
        );
    }
}

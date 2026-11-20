use document_converter_rust::{Format, convert};

fn request(json: &str) -> Vec<u8> {
    let mut bytes = (json.len() as u32).to_le_bytes().to_vec();
    bytes.extend(json.bytes());
    bytes
}

#[test]
fn pandoc_ast_preserves_native_footnotes_without_html_projection() {
    let input = request(
        r#"{"mode":"pandoc","document":{"blocks":[{"t":"Para","c":[{"t":"Str","c":"Before"},{"t":"Note","c":[{"t":"Para","c":[{"t":"Strong","c":[{"t":"Str","c":"Note body"}]}]}]}]}],"metadata":{}}}"#,
    );
    let output = convert(&input, Format::Docx).unwrap();
    let text = String::from_utf8_lossy(&output.bytes);
    assert!(text.contains("word/footnotes.xml"));
    assert!(text.contains("w:footnoteReference"));
    assert!(text.contains("Note body"));
}

#[test]
fn html_and_pandoc_inputs_share_the_document_writers() {
    let html = request(
        r#"{"mode":"html","title":"Sample","html":"<h1 id='title'>Title</h1><p>Body</p>"}"#,
    );
    for format in [Format::Docx, Format::Pdf] {
        let output = convert(&html, format).unwrap();
        assert!(output.bytes.len() > 100);
    }
}

#[test]
fn invalid_resource_ranges_and_malformed_requests_fail_without_partial_output() {
    assert!(convert(&[99, 0, 0, 0], Format::Docx).is_err());
    let input = request(
        r#"{"mode":"pandoc","document":{"blocks":[],"metadata":{}},"resources":[{"id":"image","offset":3,"length":10}]}"#,
    );
    assert!(convert(&input, Format::Docx).is_err());
}

#[test]
fn table_caption_keeps_its_following_table_in_the_word_document() {
    let input = request(
        r#"{"mode":"pandoc","document":{"blocks":[{"t":"Table","c":[["",[],[]],[null,[{"t":"Para","c":[{"t":"Str","c":"Table caption"}]}]],[["AlignDefault",{"t":"ColWidthDefault"}]],[["",[],[]],[]],[[["",[],[]],0,[],[[["",[],[]],[[["",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"Cell"}]}]]]]]]],[["",[],[]],[]]]}],"metadata":{}}}"#,
    );
    let output = convert(&input, Format::Docx).unwrap();
    let xml = String::from_utf8_lossy(&output.bytes);
    let caption = xml.find("Table caption").unwrap();
    let paragraph = xml[..caption].rfind("<w:p>").unwrap();
    assert!(xml[paragraph..caption].contains("<w:keepNext/>"));
    assert!(xml[caption..].contains("<w:tbl>"));
}

#[test]
fn pandoc_table_identifiers_become_real_docx_and_pdf_destinations() {
    let input = request(
        r##"{"mode":"pandoc","document":{"blocks":[{"t":"Para","c":[{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"0"}],["#table",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"1"}],["#head",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"2"}],["#headrow",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"3"}],["#headcell",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"4"}],["#body",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"5"}],["#bodyrow",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"6"}],["#bodycell",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"7"}],["#foot",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"8"}],["#footrow",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"9"}],["#footcell",""]]},{"t":"Space"}]},{"t":"Table","c":[["table",[],[]],[null,[]],[["AlignDefault",{"t":"ColWidthDefault"}]],[["head",[],[]],[[["headrow",[],[]],[[["headcell",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"head"}]}]]]]]],[[["body",[],[]],0,[],[[["bodyrow",[],[]],[[["bodycell",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"body"}]}]]]]]]],[["foot",[],[]],[[["footrow",[],[]],[[["footcell",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"foot"}]}]]]]]]]}],"metadata":{}}}"##,
    );
    let docx = convert(&input, Format::Docx).unwrap();
    let xml = String::from_utf8_lossy(&docx.bytes);
    for id in [
        "table", "head", "headrow", "headcell", "body", "bodyrow", "bodycell", "foot", "footrow",
        "footcell",
    ] {
        assert_eq!(
            xml.matches(&format!("w:name=\"{id}\"")).count(),
            1,
            "missing or repeated bookmark {id}"
        );
        assert!(
            xml.contains(&format!("w:anchor=\"{id}\"")),
            "missing link to {id}"
        );
    }
    let pdf = convert(&input, Format::Pdf).unwrap();
    let pdf = String::from_utf8_lossy(&pdf.bytes);
    assert_eq!(pdf.matches("/Subtype /Link").count(), 10);
    assert_eq!(pdf.matches("/Dest [").count(), 10);
}

#[test]
fn empty_table_groups_rows_and_cells_preserve_destinations_without_extra_cells() {
    let input = request(
        r##"{"mode":"pandoc","document":{"blocks":[{"t":"Para","c":[{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"0"}],["#table",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"1"}],["#emptyhead",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"2"}],["#emptybody",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"3"}],["#emptyrow",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"4"}],["#body",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"5"}],["#actualrow",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"6"}],["#emptycell",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"7"}],["#tailgroup",""]]},{"t":"Space"},{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"8"}],["#tailrow",""]]},{"t":"Space"}]},{"t":"Table","c":[["table",[],[]],[null,[]],[["AlignDefault",{"t":"ColWidthDefault"}],["AlignDefault",{"t":"ColWidthDefault"}]],[["emptyhead",[],[]],[]],[[["emptybody",[],[]],0,[],[[["emptyrow",[],[]],[]]]],[["body",[],[]],0,[],[[["actualrow",[],[]],[[["emptycell",[],[]],"AlignDefault",1,1,[]],[["",[],[]],"AlignDefault",1,1,[{"t":"Plain","c":[{"t":"Str","c":"Body"}]}]]]]]]],[["tailgroup",[],[]],[[["tailrow",[],[]],[]]]]]}],"metadata":{}}}"##,
    );
    let docx = convert(&input, Format::Docx).unwrap();
    let xml = String::from_utf8_lossy(&docx.bytes);
    for id in [
        "table",
        "emptyhead",
        "emptybody",
        "emptyrow",
        "body",
        "actualrow",
        "emptycell",
        "tailgroup",
        "tailrow",
    ] {
        assert_eq!(
            xml.matches(&format!("w:name=\"{id}\"")).count(),
            1,
            "missing or repeated bookmark {id}"
        );
    }
    assert_eq!(xml.matches("<w:tc>").count(), 2);
    assert!(xml.find("w:name=\"tailgroup\"").unwrap() > xml.find("</w:tbl>").unwrap());
    let pdf = convert(&input, Format::Pdf).unwrap();
    let pdf = String::from_utf8_lossy(&pdf.bytes);
    assert_eq!(pdf.matches("/Subtype /Link").count(), 9);
    assert_eq!(pdf.matches("/Dest [").count(), 9);
}

#[test]
fn pdf_cells_preserve_wrappers_and_reject_unsupported_content() {
    let json = r##"{"mode":"pandoc","document":{"blocks":[{"t":"Para","c":[{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"Jump"}],["#target",""]]}]},{"t":"Table","c":[["",[],[]],[null,[]],[["AlignDefault",{"t":"ColWidthDefault"}]],[["",[],[]],[]],[[["",[],[]],0,[],[[["",[],[]],[[["",[],[]],"AlignDefault",1,1,[{"t":"Div","c":[["wrapper",[],[]],[{"t":"Div","c":[["target",[],[]],[{"t":"Para","c":[{"t":"Str","c":"Target"}]}]]}]]}]]]]]]],[["",[],[]],[]]]}],"metadata":{}}}"##;
    let output = convert(&request(json), Format::Pdf).unwrap();
    assert_eq!(
        String::from_utf8_lossy(&output.bytes)
            .matches("/Dest [")
            .count(),
        1
    );
    let unsupported = json.replace(
        r#"{"t":"Para","c":[{"t":"Str","c":"Target"}]}"#,
        r#"{"t":"RawBlock","c":["openxml","<w:p/>"]}"#,
    );
    let error = convert(&request(&unsupported), Format::Pdf).err().unwrap();
    assert_eq!(error.code, "E_CAPABILITY");
    assert_eq!(error.message, "Unsupported Pdf block: RawBlock");
}

#[test]
fn malformed_pandoc_spans_are_rejected_before_layout_or_range_arithmetic() {
    let json = r#"{"mode":"pandoc","document":{"blocks":[{"t":"Table","c":[["",[],[]],[null,[]],[["AlignDefault",{"t":"ColWidthDefault"}]],[["",[],[]],[]],[[["",[],[]],0,[],[[["",[],[]],[[["",[],[]],"AlignDefault",ROWSPAN,COLSPAN,[{"t":"Plain","c":[{"t":"Str","c":"Cell"}]}]]]]]]],[["",[],[]],[]]]}],"metadata":{}}}"#;
    for format in [Format::Docx, Format::Pdf] {
        for (rowspan, colspan) in [
            ("1.5", "1"),
            ("1", "1.5"),
            ("0", "1"),
            ("1", "0"),
            ("-1", "1"),
            ("1", "-1"),
            ("10001", "1"),
            ("1", "1001"),
            ("1", "4294967296"),
            ("1", "18446744073709551616"),
            ("1", "1e100"),
            ("1e100", "1"),
        ] {
            let input = request(&json.replace("ROWSPAN", rowspan).replace("COLSPAN", colspan));
            let error = convert(&input, format)
                .err()
                .unwrap_or_else(|| panic!("accepted {format:?} span {rowspan}/{colspan}"));
            assert_eq!(error.code, "E_AST", "{format:?} span {rowspan}/{colspan}");
        }
        let input = request(&json.replace("ROWSPAN", "1").replace("COLSPAN", "1"));
        assert!(convert(&input, format).is_ok());
    }
}

#[test]
fn pandoc_pdf_preserves_nondecimal_lists_and_rich_spanned_table_cells() {
    let json = r##"{"mode":"pandoc","document":{"blocks":[{"t":"OrderedList","c":[[3,"LISTSTYLE","Period"],[[{"t":"Para","c":[{"t":"Str","c":"First item"}]}],[{"t":"Para","c":[{"t":"Str","c":"Second item"}]}]]]},{"t":"Para","c":[{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"Jump"}],["#target",""]]}]},{"t":"Table","c":[["",[],[]],[null,[]],[["AlignDefault",{"t":"ColWidthDefault"}],["AlignDefault",{"t":"ColWidthDefault"}]],[["",[],[]],[]],[[["",[],[]],0,[],[[["",[],[]],[[["",[],[]],"AlignDefault",1,1,[{"t":"Header","c":[2,["target",[],[]],[{"t":"Str","c":"Cell heading"}]]},{"t":"CodeBlock","c":[["",[],[]],"Code line\n  Indented line"]},{"t":"BulletList","c":[[{"t":"Para","c":[{"t":"Str","c":"List first"}]}],[{"t":"Para","c":[{"t":"Str","c":"List second"}]}]]},{"t":"BlockQuote","c":[{"t":"Para","c":[{"t":"Str","c":"Quoted cell"}]}]},{"t":"HorizontalRule"},{"t":"Table","c":[["",[],[]],[null,[]],[["AlignDefault",{"t":"ColWidthDefault"}],["AlignDefault",{"t":"ColWidthDefault"}]],[["",[],[]],[]],[[["",[],[]],0,[],[[["",[],[]],[[["",[],[]],"AlignDefault",1,2,[{"t":"Para","c":[{"t":"Str","c":"Wide nested"}]}]]]],[["",[],[]],[[["",[],[]],"AlignDefault",1,1,[{"t":"Para","c":[{"t":"Str","c":"Nested left"}]}]],[["",[],[]],"AlignDefault",1,1,[{"t":"Para","c":[{"t":"Str","c":"Nested right"}]}]]]]]]],[["",[],[]],[]]]}]],[["",[],[]],"AlignDefault",2,1,[{"t":"Para","c":[{"t":"Str","c":"Tall cell"}]}]]]],[["",[],[]],[[["",[],[]],"AlignDefault",1,1,[{"t":"Para","c":[{"t":"Str","c":"Bottom cell"}]}]]]]]]],[["",[],[]],[]]]}],"metadata":{}}}"##;
    for style in ["LowerAlpha", "UpperAlpha", "LowerRoman", "UpperRoman"] {
        let output = convert(&request(&json.replace("LISTSTYLE", style)), Format::Pdf).unwrap();
        assert!(output.bytes.starts_with(b"%PDF-"));
        assert_eq!(
            String::from_utf8_lossy(&output.bytes)
                .matches("/Dest [")
                .count(),
            1
        );
    }
}

#[test]
fn combined_spans_cannot_exceed_the_document_column_limit() {
    let cell = r#"[["",[],[]],"AlignDefault",1,1000,[]]"#;
    let json = r#"{"mode":"pandoc","document":{"blocks":[{"t":"Table","c":[["",[],[]],[null,[]],[["AlignDefault",{"t":"ColWidthDefault"}]],[["",[],[]],[]],[[["",[],[]],0,[],[[["",[],[]],[CELLS]]]]],[["",[],[]],[]]]}],"metadata":{}}}"#;
    let input = request(&json.replace("CELLS", &format!("{cell},{cell}")));
    for format in [Format::Docx, Format::Pdf] {
        let error = convert(&input, format).err().unwrap();
        assert_eq!(error.code, "E_AST");
        assert_eq!(error.message, "Document table column limit exceeded");
    }
}

use document_converter_rust::{Format, convert};

fn request(blocks: &str) -> Vec<u8> {
    let json = format!(r#"{{"mode":"pandoc","document":{{"blocks":{blocks},"metadata":{{}}}}}}"#);
    let mut bytes = (json.len() as u32).to_le_bytes().to_vec();
    bytes.extend_from_slice(json.as_bytes());
    bytes
}

#[test]
fn complete_details_preserve_summary_body_formatting_and_anchors_when_open_or_closed() {
    let details = r##"[{"t":"RawBlock","c":["html","<details id='options'OPEN><summary id='summary'><em>Options</em> <a href='#body'>Jump</a></summary><p id='body'>Body <strong>bold</strong>.</p></details>"]}]"##;
    let expected = r##"[{"t":"RawBlock","c":["html","<div id='options'><p id='summary'><strong><em>Options</em> <a href='#body'>Jump</a></strong></p><p id='body'>Body <strong>bold</strong>.</p></div>"]}]"##;
    for format in [Format::Docx, Format::Pdf] {
        let expected = convert(&request(expected), format).unwrap();
        for open in ["", " open", " open='open'", " open='false'"] {
            let actual = convert(&request(&details.replace("OPEN", open)), format).unwrap();
            assert!(
                actual.bytes == expected.bytes,
                "{format:?} differs for {open:?}"
            );
        }
    }
}

#[test]
fn split_gfm_details_preserve_typed_body_and_nested_details_in_source_order() {
    // GFM produces an opening RawBlock containing the complete summary, typed body
    // blocks, and a separate closing RawBlock for ordinary README disclosures.
    let split = r##"[{"t":"RawBlock","c":["html","<details id='outer'><summary>Outer</summary>"]},{"t":"Para","c":[{"t":"Str","c":"Before"}]},{"t":"RawBlock","c":["html","<details open><summary id='inner'><em>Inner</em></summary>"]},{"t":"Para","c":[{"t":"Str","c":"Body"},{"t":"Space"},{"t":"Strong","c":[{"t":"Str","c":"bold"}]}]},{"t":"RawBlock","c":["html","</details>"]},{"t":"Para","c":[{"t":"Str","c":"After"}]},{"t":"RawBlock","c":["html","</details>"]}]"##;
    let complete = r##"[{"t":"RawBlock","c":["html","<div id='outer'><p><strong>Outer</strong></p><p>Before</p><div><p id='inner'><strong><em>Inner</em></strong></p><p>Body <strong>bold</strong></p></div><p>After</p></div>"]}]"##;
    let nested = r##"[{"t":"RawBlock","c":["html","<details id='outer'><summary>Outer</summary><p>Before</p><details open><summary id='inner'><em>Inner</em></summary><p>Body <strong>bold</strong></p></details><p>After</p></details>"]}]"##;
    for format in [Format::Docx, Format::Pdf] {
        let expected = convert(&request(complete), format).unwrap();
        for source in [split, nested] {
            let actual = convert(&request(source), format).unwrap();
            assert!(
                actual.bytes == expected.bytes,
                "{format:?} nested details changed content"
            );
        }
    }
}

#[test]
fn split_summary_keeps_typed_inline_formatting_and_bookmark() {
    let split = r##"[{"t":"RawBlock","c":["html","<details><summary id='summary'>"]},{"t":"Para","c":[{"t":"Emph","c":[{"t":"Str","c":"Options"}]}]},{"t":"RawBlock","c":["html","</summary>"]},{"t":"Para","c":[{"t":"Str","c":"Body"}]},{"t":"RawBlock","c":["html","</details>"]}]"##;
    let expected = r##"[{"t":"RawBlock","c":["html","<div><p id='summary'><strong><em>Options</em></strong></p><p>Body</p></div>"]}]"##;
    for format in [Format::Docx, Format::Pdf] {
        let actual = convert(&request(split), format).unwrap();
        let expected = convert(&request(expected), format).unwrap();
        assert!(
            actual.bytes == expected.bytes,
            "{format:?} split summary changed content"
        );
    }
}

#[test]
fn malformed_details_scopes_and_unrelated_boolean_attributes_still_fail() {
    for (blocks, message) in [
        (
            r#"[{"t":"RawBlock","c":["html","<details><summary>Options</summary>"]}]"#,
            "Unclosed raw HTML block tag: details",
        ),
        (
            r#"[{"t":"RawBlock","c":["html","<details><summary>Options</details></summary>"]}]"#,
            "Mismatched raw HTML closing tag",
        ),
        (
            r#"[{"t":"RawBlock","c":["html","</details>"]}]"#,
            "Unmatched raw HTML closing tag: details",
        ),
        (
            r#"[{"t":"RawBlock","c":["html","<details/>"]}]"#,
            "requires an explicit closing tag",
        ),
        (
            r#"[{"t":"RawBlock","c":["html","<summary open>Options</summary>"]}]"#,
            "Unsupported raw HTML attribute open",
        ),
        (
            r#"[{"t":"RawBlock","c":["html","<details hidden><summary>Options</summary></details>"]}]"#,
            "Unsupported raw HTML attribute hidden",
        ),
    ] {
        for format in [Format::Docx, Format::Pdf] {
            let error = convert(&request(blocks), format)
                .err()
                .expect("malformed details accepted");
            assert!(
                error.message.contains(message),
                "{format:?}: {}",
                error.message
            );
        }
    }
}

#[test]
fn summary_weight_resets_survive_complete_and_split_scopes() {
    let expected = r#"[{"t":"RawBlock","c":["html","<p id='summary'>Normal</p>"]}]"#;
    let complete = r#"[{"t":"RawBlock","c":["html","<details><summary id='summary' style='font-weight:normal'>Normal</summary></details>"]}]"#;
    let split = r#"[{"t":"RawBlock","c":["html","<details><summary id='summary' style='font-weight:normal'>"]},{"t":"Para","c":[{"t":"Str","c":"Normal"}]},{"t":"RawBlock","c":["html","</summary></details>"]}]"#;
    let mut failures = Vec::new();
    for format in [Format::Docx, Format::Pdf] {
        let expected = convert(&request(expected), format).unwrap();
        for (name, source) in [("complete", complete), ("split", split)] {
            let actual = convert(&request(source), format).unwrap();
            if actual.bytes != expected.bytes {
                failures.push(format!("{format:?} {name} discarded summary normal weight"));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("; "));
}

#[test]
fn summary_descendant_weight_resets_survive_directional_spans() {
    let expected =
        r#"[{"t":"RawBlock","c":["html","<p id='summary'><span dir='ltr'>Normal</span></p>"]}]"#;
    let complete = r#"[{"t":"RawBlock","c":["html","<details><summary id='summary'><span dir='ltr' style='font-weight:normal'>Normal</span></summary></details>"]}]"#;
    let split = r#"[{"t":"RawBlock","c":["html","<details><summary id='summary'>"]},{"t":"Para","c":[{"t":"Span","c":[["",[],[["dir","ltr"],["style","font-weight:normal"]]],[{"t":"Str","c":"Normal"}]]}]},{"t":"RawBlock","c":["html","</summary></details>"]}]"#;
    let mut failures = Vec::new();
    for format in [Format::Docx, Format::Pdf] {
        let expected = convert(&request(expected), format).unwrap();
        for (name, source) in [("complete", complete), ("split", split)] {
            let actual = convert(&request(source), format).unwrap();
            if actual.bytes != expected.bytes {
                failures.push(format!(
                    "{format:?} {name} discarded descendant normal weight"
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("; "));
}

#[test]
fn summary_paragraphs_inherit_default_emphasis_across_complete_and_split_scopes() {
    let expected = r#"[{"t":"RawBlock","c":["html","<p id='summary' dir='ltr'><strong>Summary</strong></p>"]}]"#;
    let complete = r#"[{"t":"RawBlock","c":["html","<details><summary id='summary'><p dir='ltr'>Summary</p></summary></details>"]}]"#;
    let split = r#"[{"t":"RawBlock","c":["html","<details><summary id='summary'>"]},{"t":"Div","c":[["",[],[["dir","ltr"]]],[{"t":"Para","c":[{"t":"Str","c":"Summary"}]}]]},{"t":"RawBlock","c":["html","</summary></details>"]}]"#;
    let complete_paragraph = r#"[{"t":"RawBlock","c":["html","<details><summary id='summary' dir='ltr'><p>Summary</p></summary></details>"]}]"#;
    let split_paragraph = r#"[{"t":"RawBlock","c":["html","<details><summary id='summary' dir='ltr'>"]},{"t":"Para","c":[{"t":"Str","c":"Summary"}]},{"t":"RawBlock","c":["html","</summary></details>"]}]"#;
    let mut failures = Vec::new();
    for format in [Format::Docx, Format::Pdf] {
        let expected = convert(&request(expected), format).unwrap();
        for (name, source) in [
            ("complete direction wrapper", complete),
            ("split direction wrapper", split),
            ("complete paragraph", complete_paragraph),
            ("split paragraph", split_paragraph),
        ] {
            let actual = convert(&request(source), format).unwrap();
            if actual.bytes != expected.bytes {
                failures.push(format!("{format:?} {name} lost default summary weight"));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("; "));
}

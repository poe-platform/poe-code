use document_converter_rust::{Format, convert};

fn request(blocks: &str) -> Vec<u8> {
    let json = format!(r#"{{"mode":"pandoc","document":{{"blocks":{blocks},"metadata":{{}}}}}}"#);
    let mut bytes = (json.len() as u32).to_le_bytes().to_vec();
    bytes.extend_from_slice(json.as_bytes());
    bytes
}

#[test]
fn canonical_spans_and_divs_share_raw_html_text_style_in_both_writers() {
    let span = r##"[{"t":"Para","c":[{"t":"Span","c":[["",[],[["style","CSS"]]],[{"t":"Str","c":"Styled"}]]}]}]"##;
    let raw_span = r##"[{"t":"Para","c":[{"t":"RawInline","c":["html","<span style='CSS'>Styled</span>"]}]}]"##;
    let div = r##"[{"t":"Div","c":[["",[],[["style","CSS"]]],[{"t":"Para","c":[{"t":"Str","c":"Styled"}]}]]}]"##;
    let raw_div = r##"[{"t":"RawBlock","c":["html","<div style='CSS'><p>Styled</p></div>"]}]"##;
    for css in [
        "color:#ff0000;font-weight:bold",
        "color:RGB(0,128,255);font-style:ITALIC",
        "background-color:yellow",
        "color:#abc;font-weight:700;font-style:italic",
    ] {
        for format in [Format::Docx, Format::Pdf] {
            for (typed, raw) in [(span, raw_span), (div, raw_div)] {
                let typed = convert(&request(&typed.replace("CSS", css)), format).unwrap();
                let raw = convert(&request(&raw.replace("CSS", css)), format).unwrap();
                assert!(typed.bytes == raw.bytes, "{format:?} differs for {css}");
            }
        }
    }
}

#[test]
fn nested_typed_style_resets_match_raw_html() {
    let typed = r##"[{"t":"Div","c":[["",[],[["style","color:#ff0000;font-weight:bold;font-style:italic"]]],[{"t":"Para","c":[{"t":"Span","c":[["",[],[["style","font-weight:normal;font-style:normal;color:#000000"]]],[{"t":"Str","c":"Reset"}]]}]}]]}]"##;
    let raw = r##"[{"t":"RawBlock","c":["html","<div style='color:#ff0000;font-weight:bold;font-style:italic'><p><span style='font-weight:normal;font-style:normal;color:#000000'>Reset</span></p></div>"]}]"##;
    for format in [Format::Docx, Format::Pdf] {
        assert!(
            convert(&request(typed), format).unwrap().bytes
                == convert(&request(raw), format).unwrap().bytes,
            "{format:?} reset differs"
        );
    }
}

#[test]
fn typed_styles_reject_unrepresentable_heading_resets_and_code_inheritance() {
    let heading = r##"[{"t":"Header","c":[1,["",[],[]],[{"t":"Span","c":[["",[],[["style","font-weight:normal"]]],[{"t":"Str","c":"Reset"}]]}]]}]"##;
    let code = r##"[{"t":"Div","c":[["",[],[["style","color:#ff0000"]]],[{"t":"CodeBlock","c":[["",[],[]],"Styled code"]}]]}]"##;
    for format in [Format::Docx, Format::Pdf] {
        for (blocks, message) in [
            (heading, "font-weight reset"),
            (code, "styling cannot be represented on a code block"),
        ] {
            let error = convert(&request(blocks), format)
                .err()
                .expect("styling silently lost");
            assert!(error.message.contains(message), "{}", error.message);
        }
    }
}

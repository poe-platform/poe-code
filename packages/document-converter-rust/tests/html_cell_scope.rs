use document_ast_rust::{Block, Document};
use document_converter_rust::{Format, convert, html, map_pandoc};
use mcp_protocol_rust::{
    cooperate::block_on,
    json::{self, Value},
};
use pdf_ast_rust::PdfOptions;
use std::collections::BTreeMap;

fn raw_document(source: &str) -> Value {
    let source = json::stringify(&Value::String(source.encode_utf16().collect()));
    json::parse(
        format!(r#"{{"metadata":{{}},"blocks":[{{"t":"RawBlock","c":["html",{source}]}}]}}"#)
            .as_bytes(),
        Default::default(),
    )
    .unwrap()
}

fn assert_cell_roles(document: &Document) {
    let [Block::Table { rows, .. }] = &document.blocks[..] else {
        panic!("expected one table")
    };
    assert_eq!(rows.len(), 1);
    assert!(
        !rows[0].header,
        "scope on data cells must not create a repeating header row"
    );
    assert_eq!(rows[0].cells.len(), 2);
    assert!(!rows[0].cells[0].header, "scope on td is inert");
    assert!(
        rows[0].cells[1].header,
        "an explicit rowheader role still marks its cell"
    );
}

#[test]
fn data_cell_scope_is_inert_in_direct_html_and_raw_pandoc_ast() {
    for scope in ["row", "col", "rowgroup", "colgroup", " ROW ", "custom", ""] {
        let source = format!(
            "<table><tr><td scope='{scope}'>Data</td><td role=' rowheader '>Label</td></tr></table>"
        );
        assert_cell_roles(&html::from_html(&source).unwrap());
        for format in [Format::Docx, Format::Pdf] {
            let document = block_on(map_pandoc(
                &raw_document(&source),
                format,
                &BTreeMap::new(),
                &mut PdfOptions::default(),
                false,
                None,
                &mut vec![],
            ))
            .unwrap();
            assert_cell_roles(&document);
        }
    }
}

fn request(source: &str, raw: bool) -> Vec<u8> {
    let json = if raw {
        format!(
            r#"{{"mode":"pandoc","document":{}}}"#,
            json::stringify(&raw_document(source))
        )
    } else {
        format!(
            r#"{{"mode":"html","html":{}}}"#,
            json::stringify(&Value::String(source.encode_utf16().collect()))
        )
    };
    let mut input = (json.len() as u32).to_le_bytes().to_vec();
    input.extend_from_slice(json.as_bytes());
    input
}

#[test]
fn inert_data_cell_scope_does_not_change_word_or_pdf_output() {
    let source = "<table><tr><td scope='row'>Data</td><td>Value</td></tr></table>";
    let without_scope = source.replace(" scope='row'", "");
    for raw in [false, true] {
        for format in [Format::Docx, Format::Pdf] {
            let expected = convert(&request(&without_scope, raw), format)
                .unwrap()
                .bytes;
            assert_eq!(
                convert(&request(source, raw), format).unwrap().bytes,
                expected
            );
        }
    }
}

#[test]
fn accepting_inert_td_scope_does_not_relax_other_raw_attribute_validation() {
    for source in ["<th scope='custom'>", "<p scope='row'>", "<tr scope='row'>"] {
        assert!(
            html::html_tokens(source)
                .unwrap_err()
                .contains("Unsupported raw HTML attribute scope")
        );
    }
    assert!(html::html_tokens("<th scope='row'>").is_ok());
}

use super::super::Spreadsheet;
use crate::commands::structured::{read_office_archive, write_zip_stored};

const LIMIT: usize = 10_000_000;

fn workbook(content: &str, shared: bool) -> Vec<u8> {
    let mut parts = read_office_archive(&Spreadsheet::new().export_xlsx(LIMIT).unwrap());
    let cells = if shared {
        parts.insert("xl/sharedStrings.xml".into(), format!(r#"<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si>{content}</si></sst>"#).into_bytes());
        let rels = String::from_utf8(parts["xl/_rels/workbook.xml.rels"].clone()).unwrap().replace("</Relationships>", r#"<Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>"#);
        parts.insert("xl/_rels/workbook.xml.rels".into(), rels.into_bytes());
        r#"<c r="D2" t="s"><v>0</v></c><c r="E2" t="s"><v>0</v></c>"#.to_owned()
    } else {
        format!(r#"<c r="D2" t="inlineStr"><is>{content}</is></c>"#)
    };
    parts.insert("xl/worksheets/sheet1.xml".into(), format!(r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2">{cells}</row></sheetData></worksheet>"#).into_bytes());
    write_zip_stored(
        &parts
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect::<Vec<_>>(),
    )
}

#[test]
fn xlsx_rich_text_round_trip_preserves_inline_and_shared_runs() {
    let content = r#"<r><t xml:space="preserve">Keep </t></r><r><rPr><b/></rPr><t>critical</t></r><r><t xml:space="preserve"> parts</t></r>"#;
    for shared in [false, true] {
        let book = Spreadsheet::import_xlsx(&workbook(content, shared), LIMIT).unwrap();
        let parts = read_office_archive(&book.export_xlsx(LIMIT).unwrap());
        // Inspect the exported package, independently of our importer.
        let path = if shared {
            "xl/sharedStrings.xml"
        } else {
            "xl/worksheets/sheet1.xml"
        };
        let xml = std::str::from_utf8(&parts[path]).unwrap();
        assert!(
            xml.contains(r#"<r><t xml:space="preserve">Keep </t></r>"#),
            "{xml}"
        );
        assert!(
            xml.contains(r#"<r><rPr><b val="1"/></rPr><t>critical</t></r>"#),
            "{xml}"
        );
        assert!(
            xml.contains(r#"<r><t xml:space="preserve"> parts</t></r>"#),
            "{xml}"
        );
        if shared {
            assert!(std::sync::Arc::ptr_eq(
                book.sheets[0].cells[&(1, 3)].rich_text.as_ref().unwrap(),
                book.sheets[0].cells[&(1, 4)].rich_text.as_ref().unwrap()
            ));
        }
    }
}

#[test]
fn xlsx_rich_text_retains_supported_font_properties_and_escaped_text() {
    let content = r#"<r><rPr><b val="false"/><i/><strike/><outline/><shadow val="0"/><sz val="12.5"/><rFont val="A&amp;B"/><family val="2"/><charset val="1"/><color rgb="FF123456"/><u val="double"/><vertAlign val="superscript"/></rPr><t xml:space="preserve"> a&amp;b_x0009_ </t></r><r><rPr><color theme="4"/><vertAlign val="subscript"/></rPr><t>end</t></r>"#;
    for shared in [false, true] {
        let book = Spreadsheet::import_xlsx(&workbook(content, shared), LIMIT).unwrap();
        let book = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
        let parts = read_office_archive(&book.export_xlsx(LIMIT).unwrap());
        let path = if shared {
            "xl/sharedStrings.xml"
        } else {
            "xl/worksheets/sheet1.xml"
        };
        let xml = std::str::from_utf8(&parts[path]).unwrap();
        for property in [
            r#"<b val="0"/>"#,
            r#"<i val="1"/>"#,
            r#"<strike val="1"/>"#,
            r#"<outline val="1"/>"#,
            r#"<shadow val="0"/>"#,
            r#"<sz val="12.5"/>"#,
            r#"<rFont val="A&amp;B"/>"#,
            r#"<family val="2"/>"#,
            r#"<charset val="1"/>"#,
            r#"<color rgb="FF123456"/>"#,
            r#"<u val="double"/>"#,
            r#"<vertAlign val="superscript"/>"#,
            r#"<color rgb="FF4472C4"/>"#,
            r#"<vertAlign val="subscript"/>"#,
        ] {
            assert!(xml.contains(property), "missing {property}: {xml}");
        }
        let runs = book.sheets[0].cells[&(1, 3)].rich_text.as_ref().unwrap();
        assert_eq!(runs[0].text, " a&b\t ");
        assert_eq!(runs[1].text, "end");
    }
}

#[test]
fn xlsx_rich_text_excludes_phonetics_and_preserves_authored_controls() {
    let content = r#"<r><rPr><b/></rPr><t>one_x000D_</t></r><r><t>two</t></r><rPh sb="0" eb="3"><t>guide</t></rPh>"#;
    for shared in [false, true] {
        let book = Spreadsheet::import_xlsx(&workbook(content, shared), LIMIT).unwrap();
        let cell = &book.sheets[0].cells[&(1, 3)];
        assert!(matches!(&cell.value, Some(super::Value::Text(text)) if text == "one\rtwo"));
        let runs = cell.rich_text.as_ref().unwrap();
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0].text, "one\r");
        assert_eq!(runs[1].text, "two");
        let parts = read_office_archive(&book.export_xlsx(LIMIT).unwrap());
        let path = if shared {
            "xl/sharedStrings.xml"
        } else {
            "xl/worksheets/sheet1.xml"
        };
        let xml = std::str::from_utf8(&parts[path]).unwrap();
        assert!(!xml.contains("guide"), "{xml}");
        assert!(xml.contains("one&#13;"), "{xml}");
    }
}

#[test]
fn xlsx_rich_text_charges_each_retained_run_against_the_limit() {
    let source = format!("<is>{}</is>", "<r><rPr><b/></rPr><t>x</t></r>".repeat(100));
    let nodes = super::xml::parse(&source, None, None).unwrap().nodes;
    let container = super::elements(&nodes, "is")[0];
    let palette = super::colors::Palette::read(&[], &[], &mut 10_000).unwrap();
    assert!(super::rich_text::read(&container.children, &palette, &mut 1000).is_err());
    let runs = super::rich_text::read(&container.children, &palette, &mut 100_000)
        .unwrap()
        .unwrap();
    assert_eq!(runs.len(), 100);
}

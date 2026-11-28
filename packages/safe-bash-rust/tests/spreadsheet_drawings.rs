use safe_bash_rust::commands::{
    codecs::{parse_zip_archive, serialize_zip_archive},
    spreadsheet::Spreadsheet,
};

const LIMIT: usize = 10_000_000;
const SOURCE: &[u8] = include_bytes!("fixtures/workbook-chart.xlsx");

#[test]
fn chart_workbook_cannot_be_silently_saved_without_its_chart() {
    // Inspect the package itself, independently of Spreadsheet's importer.
    let parts = parse_zip_archive(SOURCE).unwrap();
    assert!(parts.iter().any(|part| part.name == "xl/charts/chart1.xml"));
    match Spreadsheet::import_xlsx(SOURCE, LIMIT).and_then(|book| book.export_xlsx(LIMIT)) {
        Err(error) => assert!(error.contains("drawings"), "{error}"),
        Ok(output) => {
            let exported = parse_zip_archive(&output).unwrap();
            for name in [
                "xl/charts/chart1.xml",
                "xl/drawings/drawing1.xml",
                "xl/drawings/_rels/drawing1.xml.rels",
                "xl/worksheets/_rels/sheet1.xml.rels",
            ] {
                assert!(
                    exported.iter().any(|part| part.name == name),
                    "successful round trip lost {name}"
                );
            }
            let sheet = exported
                .iter()
                .find(|part| part.name == "xl/worksheets/sheet1.xml")
                .unwrap();
            assert!(String::from_utf8_lossy(&sheet.content).contains("<drawing"));
        }
    }
}

#[test]
fn editable_import_rejects_drawings_on_later_sheets_with_namespace_prefixes() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Drawing").unwrap();
    let mut parts = parse_zip_archive(&book.export_xlsx(LIMIT).unwrap()).unwrap();
    let sheet = parts
        .iter_mut()
        .find(|part| part.name == "xl/worksheets/sheet2.xml")
        .unwrap();
    sheet.content = String::from_utf8(sheet.content.clone())
        .unwrap()
        .replace(
            "</worksheet>",
            r#"<s:drawing xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main" r:id="drawing"/></worksheet>"#,
        )
        .into_bytes();
    let result = Spreadsheet::import_xlsx(&serialize_zip_archive(&parts), LIMIT);
    let error = result.err().expect("unsupported drawing must be rejected");
    assert!(error.contains("drawings"), "{error}");
}

#[test]
fn empty_google_sheets_drawings_still_allow_excel_round_trips() {
    let source =
        include_bytes!("../src/commands/spreadsheet/fixtures/ironcalc_freeze_google_sheets.xlsx");
    let book = Spreadsheet::import_xlsx(source, LIMIT).unwrap();
    let reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(reopened.sheets[0].frozen_rows, 2);
    assert_eq!(reopened.sheets[0].frozen_columns, 1);
}

#[test]
fn unresolved_or_external_drawing_relationships_cannot_bypass_rejection() {
    for (before, after) in [
        (
            "<Relationship Type=",
            "<Relationship TargetMode=\"External\" Type=",
        ),
        ("/xl/drawings/drawing1.xml", "/xl/drawings/missing.xml"),
        ("relationships/drawing", "relationships/image"),
        ("Id=\"rId1\"", "Id=\"other\""),
    ] {
        let mut parts = parse_zip_archive(SOURCE).unwrap();
        let rels = parts
            .iter_mut()
            .find(|part| part.name == "xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap();
        let xml = String::from_utf8(rels.content.clone()).unwrap();
        assert!(xml.contains(before));
        rels.content = xml.replace(before, after).into_bytes();
        let result = Spreadsheet::import_xlsx(&serialize_zip_archive(&parts), LIMIT);
        let error = result.err().expect("unsupported drawing must be rejected");
        assert!(error.contains("drawings"), "{before}: {error}");
    }
}

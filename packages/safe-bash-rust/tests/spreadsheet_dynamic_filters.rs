use safe_bash_rust::commands::spreadsheet::Spreadsheet;

const LIMIT: usize = 128 * 1024 * 1024;

#[test]
fn closedxml_dynamic_filter_imports_and_roundtrips() {
    // ClosedXML 057f5976c788d97e8eac86d1a528bd5411d9386e (MIT),
    // ClosedXML.Tests/Resource/Examples/AutoFilter/DynamicAutoFilter.xlsx.
    let book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/closedxml-dynamic-filter.xlsx"),
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.sheets.len(), 2);
    assert_eq!(book.filtered_rows(0, LIMIT).unwrap(), [1, 2, 3, 5].into());
    assert_eq!(book.filtered_rows(1, LIMIT).unwrap(), [2, 3, 4, 6].into());
    let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for restored in [&json, &excel] {
        for sheet in 0..book.sheets.len() {
            assert_eq!(
                book.filtered_rows(sheet, LIMIT).unwrap(),
                restored.filtered_rows(sheet, LIMIT).unwrap()
            );
        }
    }
}

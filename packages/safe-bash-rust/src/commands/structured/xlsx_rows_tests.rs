use super::*;

#[test]
fn xlsx_rows_retain_leading_and_internal_gaps() {
    let rows = parse_xlsx_worksheet_xml(r#"<worksheet><sheetData><row r="2"><c r="B2" t="inlineStr"><is><t>B2</t></is></c></row><row r="5"><c r="C5" t="inlineStr"><is><t>C5</t></is></c></row><row r="6"><c r="A6" t="inlineStr"><is><t>A6</t></is></c></row></sheetData></worksheet>"#, &[], ["FALSE", "TRUE"], &mut 8192, &mut Vec::new()).unwrap();
    assert_eq!(rows, vec![vec!["", "", ""], vec!["", "B2", ""], vec!["", "", ""], vec!["", "", ""], vec!["", "", "C5"], vec!["A6", "", ""]]);
}

#[test]
fn xlsx_rows_keep_self_closing_and_implicit_rows() {
    let rows = parse_xlsx_worksheet_xml(r#"<worksheet><sheetData><row r="2"/><row><c t="inlineStr"><is><t>A3</t></is></c></row><row r="5"><c t="inlineStr"><is><t>A5</t></is></c></row></sheetData></worksheet>"#, &[], ["FALSE", "TRUE"], &mut 8192, &mut Vec::new()).unwrap();
    assert_eq!(rows, vec![vec![""], vec![""], vec!["A3"], vec![""], vec!["A5"]]);
}

#[test]
fn xlsx_rows_use_explicit_addresses_and_last_record_for_repeated_cells() {
    let rows = parse_xlsx_worksheet_xml(r#"<worksheet><sheetData><row r="2"><c r="A4" t="inlineStr"><is><t>old</t></is></c><c t="inlineStr"><is><t>B2</t></is></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>A4</t></is></c></row></sheetData></worksheet>"#, &[], ["FALSE", "TRUE"], &mut 8192, &mut Vec::new()).unwrap();
    assert_eq!(rows, vec![vec!["", ""], vec!["", "B2"], vec!["", ""], vec!["A4", ""]]);
}

#[test]
fn xlsx_rows_reject_invalid_coordinates_before_expanding_the_grid() {
    for row in ["0", "1048577", "18446744073709551616", "x"] {
        let xml = format!(r#"<worksheet><sheetData><row r="{row}"><c><v>1</v></c></row></sheetData></worksheet>"#);
        assert!(parse_xlsx_worksheet_xml(&xml, &[], ["FALSE", "TRUE"], &mut 8192, &mut Vec::new()).unwrap_err().contains("coordinate"));
    }
    for cell in ["A0", "A1048577", "XFE1", "AAAAAAAAAAAAAAAAAAAAAAAAAAAA1", "no-row"] {
        let xml = format!(r#"<worksheet><sheetData><row><c r="{cell}"><v>1</v></c></row></sheetData></worksheet>"#);
        assert!(parse_xlsx_worksheet_xml(&xml, &[], ["FALSE", "TRUE"], &mut 8192, &mut Vec::new()).unwrap_err().contains("coordinate"));
    }
    let distant = r#"<worksheet><sheetData><row r="1048576"><c r="XFD1048576"><v>1</v></c></row></sheetData></worksheet>"#;
    assert!(parse_xlsx_worksheet_xml(distant, &[], ["FALSE", "TRUE"], &mut 8192, &mut Vec::new()).unwrap_err().contains("input limit"));
}

#[test]
fn xlsx_rows_charge_the_expanded_grid_and_reused_strings() {
    let source = r#"<worksheet><sheetData><row r="2"><c r="B2" t="s"><v>0</v></c></row></sheetData></worksheet>"#;
    let storage = 4 * std::mem::size_of::<String>() + 2 * std::mem::size_of::<Vec<String>>() + 5;
    assert!(parse_xlsx_worksheet_xml(source, &["hello".into()], ["FALSE", "TRUE"], &mut (storage - 1), &mut Vec::new()).is_err());
    let mut remaining = storage;
    let rows = parse_xlsx_worksheet_xml(source, &["hello".into()], ["FALSE", "TRUE"], &mut remaining, &mut Vec::new()).unwrap();
    assert_eq!(rows, vec![vec!["", ""], vec!["", "hello"]]);
    assert_eq!(remaining, 0);
}

#[test]
fn xlsx_rows_failure_preserves_ssconvert_and_pandoc_outputs() {
    let file = write_zip_stored(&[
        ("xl/workbook.xml", br#"<workbook><sheets><sheet name="Sparse" r:id="rId1"/></sheets></workbook>"#),
        ("xl/_rels/workbook.xml.rels", br#"<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>"#),
        ("xl/worksheets/sheet1.xml", br#"<worksheet><sheetData><row r="0"><c><v>1</v></c></row></sheetData></worksheet>"#),
    ]);
    let fs = crate::MemoryVfs::new();
    fs.write_file("/input.xlsx", &file).unwrap();
    fs.write_file("/keep.csv", b"existing export").unwrap();
    for (command, args) in [("ssconvert", vec!["/input.xlsx", "/keep.csv"]), ("pandoc", vec!["-f", "xlsx", "-t", "json", "/input.xlsx", "-o", "/keep.csv"])] {
        let args: Vec<String> = args.into_iter().map(String::from).collect();
        let result = try_run_structured_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_ne!(result.exit_code, 0, "{command} accepted the invalid row");
        assert_eq!(fs.read_file("/keep.csv").unwrap(), b"existing export");
    }
}

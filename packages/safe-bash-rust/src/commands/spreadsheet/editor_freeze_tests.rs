// IronCalc base/test/test_frozen_rows{_columns,_and_columns}.rs and
// xlsx/tests/{freeze,freeze_google_sheets}.xlsx at f936620 (MIT, LICENSE.IronCalc).
use super::Spreadsheet;
use mcp_protocol_rust::json::Value as Json;
const LIMIT: usize = 10_000_000;

#[test]
fn upstream_excel_frozen_panes_survive_import_and_export() {
    for (source, rows, columns) in [
        (
            include_bytes!("fixtures/ironcalc_freeze.xlsx").as_slice(),
            2.,
            3.,
        ),
        (
            include_bytes!("fixtures/ironcalc_freeze_google_sheets.xlsx").as_slice(),
            2.,
            1.,
        ),
    ] {
        let book = Spreadsheet::import_xlsx(source, LIMIT).unwrap();
        for book in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            let document = book.to_json();
            let Some(Json::Array(sheets)) = document.get("sheets") else {
                panic!()
            };
            assert_eq!(sheets[0].get("frozen_rows"), Some(&Json::Number(rows)));
            assert_eq!(
                sheets[0].get("frozen_columns"),
                Some(&Json::Number(columns))
            );
        }
    }
}

#[test]
fn frozen_counts_defaults_axes_reset_sheet_and_boundary_validation() {
    let mut book = Spreadsheet::new();
    assert_eq!(
        (book.sheets[0].frozen_rows, book.sheets[0].frozen_columns),
        (0, 0)
    );
    for (rows, columns) in [(3, 0), (3, 53), (0, 53), (0, 0), (1_048_575, 16_383)] {
        book.set_frozen(0, rows, columns).unwrap();
        assert_eq!(
            (book.sheets[0].frozen_rows, book.sheets[0].frozen_columns),
            (rows, columns)
        );
    }
    for (sheet, rows, columns) in [
        (1, 3, 0),
        (3, 0, 5),
        (0, 1_048_576, 0),
        (0, 0, 16_384),
        (0, usize::MAX, usize::MAX),
    ] {
        let before = book.to_json();
        assert!(book.set_frozen(sheet, rows, columns).is_err());
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn frozen_json_defaults_are_backward_compatible_and_invalid_counts_are_rejected() {
    let original = Spreadsheet::new().to_json();
    for name in ["frozen_rows", "frozen_columns"] {
        for value in [
            None,
            Some(Json::Number(0.)),
            Some(Json::Number(-1.)),
            Some(Json::Number(1.5)),
            Some(Json::Number(f64::INFINITY)),
            Some(Json::Number(1_048_576.)),
            Some(Json::String("3".encode_utf16().collect())),
        ] {
            let mut document = original.clone();
            let Json::Object(fields) = &mut document else {
                panic!()
            };
            let Json::Array(sheets) = &mut fields
                .iter_mut()
                .find(|(k, _)| String::from_utf16_lossy(k) == "sheets")
                .unwrap()
                .1
            else {
                panic!()
            };
            let Json::Object(sheet) = &mut sheets[0] else {
                panic!()
            };
            sheet.retain(|(k, _)| String::from_utf16_lossy(k) != name);
            let valid = value.is_none() || value == Some(Json::Number(0.));
            if let Some(value) = value {
                sheet.push((name.encode_utf16().collect(), value));
            }
            assert_eq!(
                Spreadsheet::from_json(&document, LIMIT).is_ok(),
                valid,
                "{name}: {document:?}"
            );
        }
    }
}

#[test]
fn frozen_export_uses_standard_pane_and_selection_metadata() {
    use crate::commands::structured::read_office_archive;
    for (rows, columns, cell, pane) in [
        (23, 0, "A24", "bottomLeft"),
        (0, 42, "AQ1", "topRight"),
        (23, 42, "AQ24", "bottomRight"),
        (1_048_575, 16_383, "XFD1048576", "bottomRight"),
        (0, 0, "A1", ""),
    ] {
        let mut book = Spreadsheet::new();
        book.set_frozen(0, rows, columns).unwrap();
        let bytes = book.export_xlsx(LIMIT).unwrap();
        let files = read_office_archive(&bytes);
        let xml = String::from_utf8(files["xl/worksheets/sheet1.xml"].clone()).unwrap();
        assert!(xml.contains(&format!(r#"activeCell="{cell}" sqref="{cell}""#)));
        if pane.is_empty() {
            assert!(!xml.contains("<pane "));
        } else {
            assert!(xml.contains(&format!(
                r#"topLeftCell="{cell}" activePane="{pane}" state="frozen""#
            )));
        }
        let restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        assert_eq!(
            (
                restored.sheets[0].frozen_rows,
                restored.sheets[0].frozen_columns
            ),
            (rows, columns)
        );
        assert!(restored.sheets[0].cells.is_empty());
    }
}

#[test]
fn frozen_boundaries_follow_insertions_and_deletions_before_the_boundary() {
    for columns in [false, true] {
        let mut book = Spreadsheet::new();
        book.set_frozen(0, 3, 3).unwrap();
        for (start, delta, expected) in [(3, 2, 3), (2, 2, 5), (0, -1, 4), (3, -3, 3), (0, -3, 0)] {
            book.edit_axis(0, columns, start, delta, LIMIT).unwrap();
            assert_eq!(
                if columns {
                    book.sheets[0].frozen_columns
                } else {
                    book.sheets[0].frozen_rows
                },
                expected
            );
            assert_eq!(
                if columns {
                    book.sheets[0].frozen_rows
                } else {
                    book.sheets[0].frozen_columns
                },
                3
            );
        }
    }
}

#[test]
fn excel_split_numbers_are_bounded_and_scrolling_splits_are_not_frozen() {
    use crate::commands::structured::write_zip_stored;
    for (pane, expected) in [
        (r#"state="frozen" xSplit="3.0" ySplit="2e0""#, (2, 3)),
        (r#"state="frozenSplit" xSplit="2.6" ySplit="1.4""#, (1, 3)),
        (r#"state="frozen" ySplit="-1" xSplit="NaN""#, (0, 0)),
        (r#"state="frozen" ySplit="1048576" xSplit="1e308""#, (0, 0)),
        (r#"state="frozen" ySplit="inf" xSplit="16384""#, (0, 0)),
        (r#"state="frozen" ySplit="2""#, (2, 0)),
        (r#"state="split" ySplit="2" xSplit="3""#, (0, 0)),
        (r#"ySplit="2" xSplit="3""#, (0, 0)),
        (r#"state="frozen""#, (0, 0)),
    ] {
        let worksheet = format!(
            r#"<worksheet><sheetViews><sheetView workbookViewId="0"><pane {pane}/></sheetView></sheetViews><sheetData/></worksheet>"#
        );
        let bytes=write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),
            ("xl/worksheets/sheet1.xml",worksheet.as_bytes()),
        ]);
        let book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        assert_eq!(
            (book.sheets[0].frozen_rows, book.sheets[0].frozen_columns),
            expected,
            "{pane}"
        );
    }
}

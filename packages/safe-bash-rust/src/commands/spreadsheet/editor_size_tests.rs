// Sizing/style cases adapted from IronCalc user_model/test_column_style.rs and
// test_general.rs, f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT, LICENSE.IronCalc).
use super::{Axis, Spreadsheet, Style};
use std::sync::Arc;
const LIMIT: usize = 10_000_000;

#[test]
fn axis_sizes_preserve_styles_hidden_rows_and_formulas() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "7"), (0, 0, 1, "=A1*2")], LIMIT)
        .unwrap();
    let style = Arc::new(Style {
        attributes: vec![("Bold", "1".into())],
        ..Default::default()
    });
    book.sheets[0].columns.insert(
        0,
        Axis {
            size: Some(48.),
            hidden: true,
            level: 2,
            style: Some(style.clone()),
        },
    );
    book.resize_axis(0, true, 0, 2, Some(240.), LIMIT).unwrap();
    book.resize_axis(0, false, 0, 2, Some(56.), LIMIT).unwrap();
    assert_eq!(book.sheets[0].columns[&0].size, Some(180.));
    assert!(book.sheets[0].columns[&0].hidden);
    assert_eq!(book.sheets[0].columns[&0].level, 2);
    assert!(Arc::ptr_eq(
        book.sheets[0].columns[&0].style.as_ref().unwrap(),
        &style
    ));
    assert_eq!(book.sheets[0].rows[&1].size, Some(42.));
    assert_eq!(book.input(0, 0, 1), "=A1*2");
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "14");
    book.resize_axis(0, true, 0, 2, None, LIMIT).unwrap();
    assert!(book.sheets[0].columns[&0].size.is_none());
    assert!(book.sheets[0].columns[&0].hidden);
    assert!(!book.sheets[0].columns.contains_key(&1));
}

#[test]
fn resized_axes_follow_insertions_and_survive_json_and_excel() {
    let mut book = Spreadsheet::new();
    book.resize_axis(0, true, 3, 1, Some(233.5), LIMIT).unwrap();
    book.resize_axis(0, false, 4, 1, Some(47.25), LIMIT)
        .unwrap();
    book.edit(&[(0, 4, 3, "42")], LIMIT).unwrap();
    book.edit_axis(0, true, 2, 1, LIMIT).unwrap();
    book.edit_axis(0, false, 2, 1, LIMIT).unwrap();
    for book in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert!((book.sheets[0].columns[&4].size.unwrap() - 233.5 * 0.75).abs() < 0.01);
        assert!((book.sheets[0].rows[&5].size.unwrap() - 47.25 * 0.75).abs() < 0.01);
        assert_eq!(book.display(0, 5, 4, LIMIT).unwrap(), "42");
    }
}

#[test]
fn invalid_sizes_ranges_and_resource_limits_are_atomic() {
    let mut book = Spreadsheet::new();
    book.resize_axis(0, true, 0, 1, Some(200.), LIMIT).unwrap();
    let before = book.to_json();
    for (columns, start, count, size, limit) in [
        (true, 0, 1, Some(0.), LIMIT),
        (false, 0, 1, Some(-1.), LIMIT),
        (true, 0, 1, Some(f64::NAN), LIMIT),
        (false, 0, 1, Some(f64::INFINITY), LIMIT),
        (false, 0, 1, Some(547.), LIMIT),
        (true, 0, 1, Some(1786.), LIMIT),
        (true, 16383, 2, Some(200.), LIMIT),
        (false, 1048575, 2, Some(40.), LIMIT),
        (true, 0, 0, Some(200.), LIMIT),
        (true, 0, 16384, Some(200.), 100),
        (false, usize::MAX, 2, None, LIMIT),
    ] {
        assert!(
            book.resize_axis(0, columns, start, count, size, limit)
                .is_err()
        );
        assert_eq!(book.to_json(), before);
    }
    assert!(book.resize_axis(1, true, 0, 1, Some(200.), LIMIT).is_err());
    assert_eq!(book.to_json(), before);
    book.resize_axis(0, true, 16383, 1, Some(1785.), LIMIT)
        .unwrap();
    book.resize_axis(0, false, 1048575, 1, Some(546.), LIMIT)
        .unwrap();
    assert_eq!(book.sheets[0].columns.len(), 2);
    assert_eq!(book.sheets[0].rows.len(), 1);
}

#[test]
fn worksheet_defaults_and_merged_extents_survive_excel_without_sizing_every_column() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "Title")], LIMIT).unwrap();
    book.merge_cells(0, &[[0, 0, 4, 1]], false, LIMIT).unwrap();
    book.resize_axis(0, true, 0, 1, Some(260.), LIMIT).unwrap();
    book.resize_axis(0, true, 1, 1, Some(160.), LIMIT).unwrap();
    let reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    let width: f64 = (0..4)
        .map(|c| {
            reopened.sheets[0]
                .columns
                .get(&c)
                .and_then(|a| a.size)
                .unwrap_or(90.)
                / 0.75
        })
        .sum();
    assert!(
        (width - 660.).abs() < 0.01,
        "Merged width changed to {width}"
    );
    assert_eq!(reopened.sheets[0].merges, book.sheets[0].merges);
    assert_eq!(reopened.sheets[0].columns.len(), 2);
}

#[test]
fn per_sheet_defaults_survive_json_excel_and_reset_on_sparse_sheets() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Wide").unwrap();
    book.sheets[1].default_row_height = Some(36.);
    book.sheets[1].default_column_width = Some(150.);
    book.edit(&[(1, 900_000, 15_000, "42")], LIMIT).unwrap();
    book.resize_axis(1, true, 2, 1, Some(300.), LIMIT).unwrap();
    book.resize_axis(1, true, 2, 1, None, LIMIT).unwrap();
    book.resize_axis(1, false, 2, 1, Some(100.), LIMIT).unwrap();
    book.resize_axis(1, false, 2, 1, None, LIMIT).unwrap();
    assert!(book.sheets[1].columns.is_empty());
    assert!(book.sheets[1].rows.is_empty());
    for restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.sheets[0].default_row_height, Some(21.));
        assert!((restored.sheets[0].default_column_width.unwrap() - 90.).abs() < 0.001);
        assert_eq!(restored.sheets[1].default_row_height, Some(36.));
        assert!((restored.sheets[1].default_column_width.unwrap() - 150.).abs() < 0.001);
        assert_eq!(restored.display(1, 900_000, 15_000, LIMIT).unwrap(), "42");
        assert!(restored.sheets[1].rows.is_empty());
        assert!(restored.sheets[1].columns.is_empty());
    }
}

#[test]
fn json_rejects_invalid_worksheet_defaults() {
    for size in [0., -1., f64::INFINITY, f64::NAN] {
        for column in [true, false] {
            let mut book = Spreadsheet::new();
            if column {
                book.sheets[0].default_column_width = Some(size);
            } else {
                book.sheets[0].default_row_height = Some(size);
            }
            assert!(Spreadsheet::from_json(&book.to_json(), LIMIT).is_err());
        }
    }
}

#[test]
fn excel_worksheet_defaults_are_read_without_expanding_sparse_axes() {
    use crate::commands::structured::write_zip_stored;
    for (attributes, row, column) in [
        (
            "defaultRowHeight=\"30\" defaultColWidth=\"18.5703125\"",
            Some(30.),
            Some(97.5),
        ),
        (
            "defaultRowHeight=\"-1\" defaultColWidth=\"NaN\"",
            None,
            None,
        ),
        (
            "defaultRowHeight=\"0\" defaultColWidth=\"1e308\"",
            None,
            None,
        ),
        ("", None, None),
    ] {
        let worksheet = format!(
            r#"<worksheet><sheetFormatPr {attributes}/><sheetData><row r="900001"><c r="WDX900001"><v>42</v></c></row></sheetData></worksheet>"#
        );
        let bytes=write_zip_stored(&[
            ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="sheet"/></sheets></workbook>"#.as_slice()),
            ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.as_slice()),
            ("_rels/.rels", include_bytes!("xlsx/root.rels").as_slice()),
            ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#.as_slice()),
            ("xl/worksheets/sheet1.xml",worksheet.as_bytes()),
        ]);
        let book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        assert_eq!(book.sheets[0].default_row_height, row.or(Some(15.)));
        match (book.sheets[0].default_column_width, column.or(Some(48.))) {
            (Some(actual), Some(expected)) => assert!((actual - expected).abs() < 0.001),
            (actual, expected) => assert_eq!(actual, expected),
        }
        assert!(book.sheets[0].rows.is_empty());
        assert!(book.sheets[0].columns.is_empty());
        assert_eq!(book.sheets[0].cells.len(), 1);
        let restored = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert_eq!(
            restored.sheets[0].default_row_height,
            book.sheets[0].default_row_height
        );
        assert!(
            (restored.sheets[0].default_column_width.unwrap()
                - book.sheets[0].default_column_width.unwrap())
            .abs()
                < 0.001
        );
        assert!(restored.sheets[0].columns.is_empty());
    }
}

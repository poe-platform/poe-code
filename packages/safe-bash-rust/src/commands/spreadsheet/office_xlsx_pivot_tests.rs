use super::*;
use crate::commands::spreadsheet::Spreadsheet;
use crate::commands::structured::{read_office_archive, write_zip_stored};

const LIMIT: usize = 128 * 1024 * 1024;

fn fixture(date: &str, serial: f64, date1904: bool, comparison: bool) -> Vec<u8> {
    let mut parts = read_office_archive(include_bytes!(
        "../../../tests/fixtures/pivot-cache-date-selection.xlsx"
    ));
    for (path, bytes) in &mut parts {
        let text = String::from_utf8(bytes.clone()).unwrap();
        let text = match path.as_str() {
            "xl/pivotCache/pivotCacheDefinition1.xml" => text.replace("2026-01-01T00:00:00", date),
            "xl/worksheets/sheet1.xml" => text.replace("<v>46023</v>", &format!("<v>{serial}</v>")),
            "xl/workbook.xml" if date1904 => text.replace("date1904=\"0\"", "date1904=\"1\""),
            "xl/pivotTables/pivotTable1.xml" if comparison => text.replace(" h=\"1\"", "").replace(
                "subtotal=\"sum\"",
                "subtotal=\"sum\" showDataAs=\"difference\" baseField=\"0\" baseItem=\"0\"",
            ),
            _ => text,
        };
        *bytes = text.into_bytes();
    }
    write_zip_stored(
        &parts
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect::<Vec<_>>(),
    )
}

#[test]
fn pivot_cached_dates_use_the_workbook_null_date() {
    // ClosedXML 057f5976, PivotCacheRecordsReaderTests.Can_read_all_record_item_types
    // supplies the date-only case. VariousDataTypesInTableColumns/input.xlsx
    // supplies 1899-12-31 (1), 12:30 (1.5208333333333335), 2020-12-24
    // (44189), and 1899-12-30T16:30 (.6875). These are pivot-cache dates,
    // not worksheet DATEVALUE dates (which differ before March 1900).
    let cases = [
        ("2020-10-05", 44109.),
        ("1899-12-31T00:00:00", 1.),
        ("1899-12-31T12:30:00", 1.5208333333333335),
        ("2020-12-24T00:00:00", 44189.),
        ("1899-12-30T16:30:00", 0.6875),
        ("1899-12-29T12:00:00", -0.5),
        ("1900-02-28T00:00:00", 60.),
        ("1900-03-01T00:00:00", 61.),
        ("1904-01-01T00:00:00", 1462.),
        ("2026-01-01T12:00:00.125", 46023. + 43200.125 / 86400.),
        ("2026-01-01T01:00:00+01:00", 46023.),
        ("2025-12-31T19:00:00-05:00", 46023.),
        ("2026-01-01T00:00:00Z", 46023.),
    ];
    for (date, serial) in cases {
        for date1904 in [false, true] {
            let serial = serial - if date1904 { 1462. } else { 0. };
            let book = Spreadsheet::import_xlsx(&fixture(date, serial, date1904, false), LIMIT)
                .unwrap_or_else(|e| panic!("{date}, 1904={date1904}: {e}"));
            let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
            let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
            for restored in [&book, &json, &excel] {
                let pivot = restored.options.pivots.values().next().unwrap();
                assert!(
                    matches!(pivot.filters[0].selected.as_deref(), Some([Value::Number(n)]) if *n == serial),
                    "{date}, 1904={date1904}: serial mismatch"
                );
                assert_eq!(
                    restored.display(pivot.sheet, 1, 1, LIMIT).unwrap(),
                    "10",
                    "{date}, 1904={date1904}: filter mismatch"
                );
            }
        }
    }
}

#[test]
fn date_cache_items_can_be_named_comparison_bases() {
    for date1904 in [false, true] {
        let serial = if date1904 { 44561. } else { 46023. };
        let mut book = Spreadsheet::import_xlsx(
            &fixture("2026-01-01T00:00:00", serial, date1904, true),
            LIMIT,
        )
        .unwrap();
        let pivot = book.options.pivots.values().next().unwrap().clone();
        assert!(
            matches!(pivot.values[0].calculation.as_ref().unwrap().base_item.as_ref(), Some(PivotItem::Value(Value::Number(n))) if *n == serial)
        );
        assert_eq!(book.display(pivot.sheet, 2, 1, LIMIT).unwrap(), "10");
        book.edit(&[(pivot.source_sheet, 1, 1, "40")], LIMIT)
            .unwrap();
        let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
        let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        for restored in [&book, &json, &excel] {
            assert_eq!(restored.display(pivot.sheet, 2, 1, LIMIT).unwrap(), "-20");
        }
    }
}

#[test]
fn invalid_pivot_cached_dates_fail_explicitly() {
    for date in [
        "",
        "@0",
        "20261005",
        "2026-1-01",
        "1900-02-29",
        "2026-02-30",
        "0000-01-01",
        "2026-01-01T12:00",
        "2026-01-01T25:00:00",
        "2026-01-01T00:60:00",
        "2026-01-01T00:00:60",
        "2026-01-01T00:00:00.",
        "2026-01-01T00:00:00+24:00",
        "2026-01-01T00:00:00+14:01",
        "2026-01-01T00:00:00+01:60",
        "2026-01-01T00:00:00 UTC",
        "2026-01-01 junk",
        "2026-01-01Txx:yy:zz",
        "2026-01-01T00:00:00💥",
    ] {
        match Spreadsheet::import_xlsx(&fixture(date, 46023., false, false), LIMIT) {
            Ok(_) => panic!("Accepted invalid date: {date}"),
            Err(e) => assert!(e.contains("Invalid pivot item date"), "{date}: {e}"),
        }
    }
}

//! Relative aggregate contracts from LibreOffice abf91474804c dptabres.cxx
//! (MPL-2.0, LICENSE.LibreOffice) and ClosedXML 057f5976 XLPivotDataField.cs
//! (MIT, LICENSE.ClosedXML). Expected values use the source records, never
//! the displayed subtotals, including for non-additive aggregates.
use super::Spreadsheet;
use mcp_protocol_rust::json::{self, Value as Json};
const LIMIT: usize = 128 * 1024 * 1024;

fn workbook(kind: &str, aggregate: &str, base: &str) -> Spreadsheet {
    let mut book = Spreadsheet::new();
    book.add_sheet("Pivot").unwrap();
    let source = "Region\tMonth\tSales\nEast\tJan\t10\nEast\tJan\t30\nEast\tFeb\t60\nWest\tJan\t40\nWest\tFeb\t60";
    let edits: Vec<_> = source
        .lines()
        .enumerate()
        .flat_map(|(r, line)| {
            line.split('\t')
                .enumerate()
                .map(move |(c, text)| (0, r, c, text))
        })
        .collect();
    book.edit(&edits, LIMIT).unwrap();
    let mut document = book.to_json();
    let Json::Object(root) = &mut document else {
        panic!()
    };
    let (_, Json::Object(options)) = root
        .iter_mut()
        .find(|(k, _)| k == &"options".encode_utf16().collect::<Vec<_>>())
        .unwrap()
    else {
        panic!()
    };
    options.retain(|(k, _)| k != &"pivots".encode_utf16().collect::<Vec<_>>());
    let definition = format!(
        r#"{{"relative":{{"name":"Sales","sheet":1,"row":0,"column":0,
        "source_sheet":0,"source":[0,0,5,2],"rows":[0],"columns":[1],
        "values":[{{"field":2,"aggregate":"{aggregate}","name":"Sales",
        "calculation":{{"kind":"{kind}"{base}}}}}],
        "filters":[],"row_totals":true,"column_totals":true}}}}"#
    );
    options.push((
        "pivots".encode_utf16().collect(),
        json::parse(definition.as_bytes(), json::Limits::default()).unwrap(),
    ));
    Spreadsheet::from_json(&document, LIMIT).unwrap()
}

fn number(book: &Spreadsheet, row: usize, column: usize, expected: f64) {
    let value = book.display(1, row, column, LIMIT).unwrap();
    let actual: f64 = value
        .parse()
        .unwrap_or_else(|_| panic!("{row},{column}: {value}"));
    assert!(
        (actual - expected).abs() < 1e-12 * expected.abs().max(1.),
        "{row},{column}: {actual} != {expected}"
    );
}

#[test]
fn relative_pivot_total_percentages_use_source_aggregates() {
    for (kind, expected) in [
        ("totalPercent", 0.3),
        ("rowPercent", 0.6),
        ("colPercent", 0.5),
        ("index", 1.),
    ] {
        let book = workbook(kind, "sum", "");
        // Column keys sort Feb before Jan.
        number(&book, 1, 1, expected);
        number(&book, 3, 3, 1.);
    }
    let book = workbook("totalPercent", "average", "");
    number(&book, 1, 1, 1.5); // 60 / (200 / 5), not 60 / sum(group averages).
    let restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    number(&restored, 1, 1, 1.5);
}

#[test]
fn relative_pivot_item_comparisons_keep_original_aggregates() {
    let base = r#", "base_field":1,"base_item":{"value":{"type":"text","value":"Feb"}}"#;
    for (kind, expected) in [
        ("difference", -20.),
        ("percent", 2. / 3.),
        ("percentDiff", -1. / 3.),
    ] {
        let book = workbook(kind, "sum", base);
        number(&book, 1, 2, expected);
    }
}

#[test]
fn relative_pivot_libreoffice_field_reference_contracts() {
    // Port of testPivotTableFieldReference in LibreOffice's ucalc_pivottable.cxx.
    // Use original source A=1, B=2, C=4, D=8 and original expected values.
    for (kind, expected) in [
        ("difference", ["", "1", "3", "7", ""]),
        ("percent", ["1", "2", "4", "8", ""]),
        ("percentDiff", ["", "1", "3", "7", ""]),
        ("runTotal", ["1", "3", "7", "15", ""]),
    ] {
        let mut book = workbook(
            kind,
            "sum",
            r#", "base_field":0,"base_item":{"value":{"type":"text","value":"A"}}"#,
        );
        book.set_pivot("relative", None, LIMIT).unwrap();
        book.edit(
            &[
                (0, 1, 0, "A"),
                (0, 1, 2, "1"),
                (0, 2, 0, "B"),
                (0, 2, 2, "2"),
                (0, 3, 0, "C"),
                (0, 3, 2, "4"),
                (0, 4, 0, "D"),
                (0, 4, 2, "8"),
            ],
            LIMIT,
        )
        .unwrap();
        let mut pivot = workbook(
            kind,
            "sum",
            r#", "base_field":0,"base_item":{"value":{"type":"text","value":"A"}}"#,
        )
        .options
        .pivots
        .remove("relative")
        .unwrap();
        pivot.columns.clear();
        pivot.source[2] = 4;
        book.set_pivot("relative", Some(pivot), LIMIT).unwrap();
        for (r, expected) in expected.iter().enumerate() {
            assert_eq!(
                book.display(1, r + 1, 1, LIMIT).unwrap(),
                *expected,
                "{kind} row {r}"
            );
        }
    }
}

#[test]
fn relative_pivot_previous_next_and_running_totals_use_display_order() {
    for (kind, expected) in [
        ("difference", -20.),
        ("percent", 2. / 3.),
        ("percentDiff", -1. / 3.),
    ] {
        let book = workbook(kind, "sum", r#", "base_field":1,"base_item":"previous""#);
        assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "");
        number(&book, 1, 2, expected);
        assert_eq!(book.display(1, 1, 3, LIMIT).unwrap(), "");
    }
    let book = workbook(
        "difference",
        "sum",
        r#", "base_field":1,"base_item":"next""#,
    );
    number(&book, 1, 1, 20.);
    assert_eq!(book.display(1, 1, 2, LIMIT).unwrap(), "");
    let book = workbook("runTotal", "average", r#", "base_field":1"#);
    number(&book, 1, 1, 60.);
    number(&book, 1, 2, 80.);
    let book = workbook("percentOfRunningTotal", "average", r#", "base_field":1"#);
    number(&book, 1, 1, 0.75);
    number(&book, 1, 2, 1.);
}

#[test]
fn relative_pivot_rank_ties_and_parent_totals() {
    for (kind, first, second) in [("rankAscending", 2., 1.), ("rankDescending", 1., 2.)] {
        let book = workbook(kind, "sum", r#", "base_field":1"#);
        number(&book, 1, 1, first);
        number(&book, 1, 2, second);
        assert_eq!(book.display(1, 1, 3, LIMIT).unwrap(), "");
        let book = workbook(kind, "sum", r#", "base_field":0"#);
        number(&book, 1, 1, 1.);
        number(&book, 2, 1, 1.);
    }
    for (kind, expected, base) in [
        ("percentOfParentRow", 0.5, ""),
        ("percentOfParentCol", 0.6, ""),
        ("percentOfParent", 0.5, r#", "base_field":0"#),
    ] {
        let book = workbook(kind, "sum", base);
        number(&book, 1, 1, expected);
        number(&book, 3, 3, 1.);
    }
}

#[test]
fn relative_pivot_calculations_roundtrip_and_recalculate_excel_and_json() {
    for kind in [
        "totalPercent",
        "rowPercent",
        "colPercent",
        "index",
        "percent",
        "difference",
        "percentDiff",
        "runTotal",
        "percentOfParentRow",
        "percentOfParentCol",
        "percentOfParent",
        "percentOfRunningTotal",
        "rankAscending",
        "rankDescending",
    ] {
        let book = workbook(
            kind,
            "sum",
            r#", "base_field":1,"base_item":{"value":{"type":"text","value":"Feb"}}"#,
        );
        let expected: Vec<_> = (1..=3)
            .flat_map(|r| (1..=3).map(move |c| (r, c)))
            .map(|(r, c)| book.display(1, r, c, LIMIT).unwrap())
            .collect();
        let bytes = book.export_xlsx(LIMIT).unwrap();
        let mut restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        let pivot = restored.options.pivots.values().next().unwrap();
        assert_eq!(pivot.values[0].calculation.as_ref().unwrap().kind, kind);
        let header = pivot.header_size().0;
        for ((r, c), expected) in (1..=3)
            .flat_map(|r| (1..=3).map(move |c| (r, c)))
            .zip(&expected)
        {
            assert_eq!(
                restored.display(1, header + r - 1, c, LIMIT).unwrap(),
                *expected,
                "{kind}: {r},{c}"
            );
        }
        let document = restored.to_json();
        restored = Spreadsheet::from_json(&document, LIMIT).unwrap();
        restored.edit(&[(0, 3, 2, "120")], LIMIT).unwrap();
        let (column, expected) = match kind {
            "totalPercent" => (1, 120. / 260.),
            "rowPercent" | "percentOfParentCol" | "percentOfParent" | "percentOfRunningTotal" => {
                (1, 0.75)
            }
            "colPercent" | "percentOfParentRow" => (1, 2. / 3.),
            "index" => (1, 13. / 12.),
            "percent" => (2, 1. / 3.),
            "difference" => (2, -80.),
            "percentDiff" => (2, -2. / 3.),
            "runTotal" => (2, 160.),
            "rankAscending" => (1, 2.),
            "rankDescending" => (1, 1.),
            _ => unreachable!(),
        };
        number(&restored, header, column, expected);
    }
}

#[test]
fn relative_pivot_empty_zero_error_and_missing_reference() {
    let mut book = workbook("rowPercent", "sum", "");
    book.edit(&[(0, 1, 2, "0"), (0, 2, 2, "0"), (0, 3, 2, "0")], LIMIT)
        .unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "#DIV/0!");
    book.edit(&[(0, 3, 2, "=NA()")], LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "#N/A");
    let book = workbook(
        "difference",
        "sum",
        r#", "base_field":1,"base_item":{"value":{"type":"text","value":"Absent"}}"#,
    );
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "#N/A");
    let book = workbook(
        "difference",
        "sum",
        r#", "base_field":2,"base_item":"previous""#,
    );
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "#REF!");
}

#[test]
fn relative_pivot_hidden_totals_still_supply_denominators() {
    let mut book = workbook("totalPercent", "average", "");
    let mut pivot = book.options.pivots["relative"].clone();
    pivot.row_totals = false;
    pivot.column_totals = false;
    book.set_pivot("relative", Some(pivot), LIMIT).unwrap();
    number(&book, 1, 1, 1.5);
    assert_eq!(book.display(1, 3, 3, LIMIT).unwrap(), "");
}

#[test]
fn relative_pivot_base_fields_follow_structural_edits_and_never_capture_replacements() {
    let mut book = workbook(
        "percent",
        "sum",
        r#", "base_field":1,"base_item":"previous""#,
    );
    book.edit_axis(0, true, 1, 1, LIMIT).unwrap();
    book.edit(&[(0, 0, 1, "New")], LIMIT).unwrap();
    assert_eq!(
        book.options.pivots["relative"].values[0]
            .calculation
            .as_ref()
            .unwrap()
            .base_field,
        Some(2)
    );
    number(&book, 1, 2, 2. / 3.);
    book.edit_axis(0, true, 2, -1, LIMIT).unwrap();
    assert_eq!(
        book.options.pivots["relative"].values[0]
            .calculation
            .as_ref()
            .unwrap()
            .base_field,
        None
    );
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "#REF!");
    let restored = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(restored.display(1, 1, 1, LIMIT).unwrap(), "#REF!");
    book.edit_axis(0, true, 2, 1, LIMIT).unwrap();
    book.edit(&[(0, 0, 2, "Replacement")], LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "#REF!");
}

#[test]
fn relative_pivot_source_edits_remain_atomic_when_calculation_budget_exhausts() {
    let mut book = workbook("rankAscending", "sum", r#", "base_field":1"#);
    let before = book.to_json();
    assert!(book.edit(&[(0, 1, 2, "100")], 128).is_err());
    assert_eq!(book.to_json(), before);
    number(&book, 1, 1, 2.);
}

#[test]
fn relative_pivot_nested_parent_totals_and_running_series_do_not_require_visible_subtotals() {
    for (kind, expected) in [
        ("percentOfParentRow", [1.8, 0.6, 1.2, 0.8]),
        ("percentOfParent", [1.8, 0.6, 1.2, 0.8]),
        ("runTotal", [60., 80., 60., 100.]),
        ("rankAscending", [2., 1., 2., 1.]),
    ] {
        let mut book = workbook(kind, "average", r#", "base_field":1"#);
        let mut pivot = book.options.pivots["relative"].clone();
        pivot.rows = vec![0, 1];
        pivot.columns.clear();
        book.set_pivot("relative", Some(pivot), LIMIT).unwrap();
        for (index, expected) in expected.into_iter().enumerate() {
            number(&book, index + 1, 2, expected);
        }
    }
}

#[test]
fn relative_pivot_excel_uses_cache_item_indexes_and_standard_extension_metadata() {
    use crate::commands::structured::read_office_archive;
    let book = workbook(
        "percent",
        "sum",
        r#", "base_field":1,"base_item":{"value":{"type":"text","value":"Feb"}}"#,
    );
    let parts = read_office_archive(&book.export_xlsx(LIMIT).unwrap());
    let xml = String::from_utf8(parts["xl/pivotTables/pivotTable1.xml"].clone()).unwrap();
    assert!(xml.contains("showDataAs=\"percent\""));
    assert!(xml.contains("baseField=\"1\" baseItem=\"1\"")); // Jan appears first in source; display sorts Feb first.
    let book = workbook("rankAscending", "sum", r#", "base_field":1"#);
    let parts = read_office_archive(&book.export_xlsx(LIMIT).unwrap());
    let xml = String::from_utf8(parts["xl/pivotTables/pivotTable1.xml"].clone()).unwrap();
    assert!(xml.contains("{E15A36E0-9728-4e99-A89B-3F7291B0FE68}"));
    assert!(xml.contains("<x14:dataField pivotShowAs=\"rankAscending\"/>"));
    assert!(!xml.contains("showDataAs="));
}

#[test]
fn relative_pivot_deleted_extended_base_field_needs_repair_before_excel_export() {
    let mut book = workbook("rankAscending", "sum", r#", "base_field":1"#);
    book.edit_axis(0, true, 1, -1, LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "#REF!");
    // MS-XLSX 2.6.25 requires a nonnegative baseField for ranking/parent/running extensions.
    assert!(book.export_xlsx(LIMIT).is_err());
    let restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    assert_eq!(restored.display(1, 1, 1, LIMIT).unwrap(), "#REF!");
}

#[test]
fn relative_pivot_index_avoids_spurious_overflow_and_underflow() {
    let mut book = workbook("index", "sum", "");
    book.edit(
        &[
            (0, 1, 2, "0"),
            (0, 2, 2, "1e308"),
            (0, 3, 2, "1e-308"),
            (0, 4, 2, "0"),
            (0, 5, 2, "0"),
        ],
        LIMIT,
    )
    .unwrap();
    number(&book, 1, 1, 1.);
    number(&book, 1, 2, 1.);
    number(&book, 3, 3, 1.);
}

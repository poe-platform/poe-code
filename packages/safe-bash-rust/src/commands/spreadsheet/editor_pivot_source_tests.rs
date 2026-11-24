use super::{NamedExpression, Spreadsheet};
use mcp_protocol_rust::json::{self, Value as Json};
const LIMIT: usize = 64 * 1024 * 1024;

fn source() -> Spreadsheet {
    let mut book = Spreadsheet::new();
    book.add_sheet("Summary").unwrap();
    book.edit(
        &[
            (0, 0, 0, "Group"),
            (0, 0, 1, "Value"),
            (0, 1, 0, "a"),
            (0, 1, 1, "10"),
            (0, 2, 0, "a"),
            (0, 2, 1, "20"),
            (0, 3, 0, "a"),
            (0, 3, 1, "30"),
        ],
        LIMIT,
    )
    .unwrap();
    book
}
fn pivot(book: &Spreadsheet, binding: &str) -> Spreadsheet {
    let mut json = book.to_json();
    let Json::Object(root) = &mut json else {
        panic!()
    };
    let (_, Json::Object(options)) = root
        .iter_mut()
        .find(|(key, _)| key.iter().copied().eq("options".encode_utf16()))
        .unwrap()
    else {
        panic!()
    };
    options.push(("pivots".encode_utf16().collect(), Json::Null));
    let pivots = &mut options.last_mut().unwrap().1;
    *pivots=json::parse(format!(r#"{{"summary":{{"name":"Summary","sheet":1,"row":0,"column":0,"source_sheet":0,"source":[0,0,1,1],"source_binding":{binding},"rows":[0],"columns":[],"values":[{{"field":1,"aggregate":"sum","name":"Total"}}],"filters":[],"row_totals":true,"column_totals":true}}}}"#).as_bytes(),json::Limits::default()).unwrap();
    Spreadsheet::from_json(&json, LIMIT).unwrap()
}
#[test]
fn table_pivot_source_follows_resizes_renames_conversion_and_excel_roundtrips() {
    let mut book = source();
    book.add_table(0, "Sales", [0, 0, 2, 1], LIMIT).unwrap();
    let mut book = pivot(&book, r#"{"table":0}"#);
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "30");
    book.rename_table(0, "Revenue", LIMIT).unwrap();
    book.resize_table(0, 3, 1, LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "60");
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let mut reopened = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(reopened.display(1, 1, 1, LIMIT).unwrap(), "60");
    reopened.resize_table(0, 1, 1, LIMIT).unwrap();
    assert_eq!(reopened.display(1, 1, 1, LIMIT).unwrap(), "10");
    book.convert_table_to_range(0, LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "60");
}
#[test]
fn named_pivot_source_follows_dynamic_ranges_and_does_not_capture_reused_names() {
    let mut book = source();
    book.edit(&[(0, 0, 3, "3")], LIMIT).unwrap();
    let name = NamedExpression {
        name: "Data".into(),
        expression: "OFFSET(Sheet1!$A$1,0,0,Sheet1!$D$1,2)".into(),
        sheet: None,
        position: (0, 0, 0),
        openformula: None,
        compiled: None,
    };
    book.set_named_expression(None, name.clone(), LIMIT)
        .unwrap();
    let mut book = pivot(&book, r#"{"name":0}"#);
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "30");
    book.edit(&[(0, 0, 3, "4")], LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "60");
    let mut renamed = name.clone();
    renamed.name = "Renamed".into();
    book.set_named_expression(Some(0), renamed, LIMIT).unwrap();
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let mut reopened = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(reopened.display(1, 1, 1, LIMIT).unwrap(), "60");
    reopened.edit(&[(0, 0, 3, "2")], LIMIT).unwrap();
    assert_eq!(reopened.display(1, 1, 1, LIMIT).unwrap(), "10");
    book.remove_named_expression(0, LIMIT).unwrap();
    assert_eq!(book.display(1, 0, 0, LIMIT).unwrap(), "#REF!");
    book.set_named_expression(None, name, LIMIT).unwrap();
    assert_eq!(book.display(1, 0, 0, LIMIT).unwrap(), "#REF!");
}

fn named(book: &mut Spreadsheet, label: &str, expression: &str, sheet: Option<usize>) {
    book.set_named_expression(
        None,
        NamedExpression {
            name: label.into(),
            expression: expression.into(),
            sheet,
            position: (sheet.unwrap_or(0), 0, 0),
            openformula: None,
            compiled: None,
        },
        LIMIT,
    )
    .unwrap();
}

#[test]
fn scoped_pivot_names_survive_excel_and_unrelated_name_deletion() {
    let mut book = source();
    named(&mut book, "Data", "Sheet1!$A$1:$B$2", None);
    named(&mut book, "Data", "Sheet1!$A$1:$B$4", Some(1));
    let mut book = pivot(&book, r#"{"name":1}"#);
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "60");
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let mut reopened = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(reopened.display(1, 1, 1, LIMIT).unwrap(), "60");
    reopened.remove_named_expression(0, LIMIT).unwrap();
    assert_eq!(reopened.display(1, 1, 1, LIMIT).unwrap(), "60");
    book.remove_named_expression(0, LIMIT).unwrap();
    let book = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "60");
}

#[test]
fn shrinking_dynamic_sources_report_reference_errors_and_recover() {
    let mut book = source();
    book.edit(&[(0, 0, 3, "2")], LIMIT).unwrap();
    named(
        &mut book,
        "Data",
        "OFFSET(Sheet1!$A$1,0,0,4,Sheet1!$D$1)",
        None,
    );
    let mut book = pivot(&book, r#"{"name":0}"#);
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "60");
    book.edit(&[(0, 0, 3, "1")], LIMIT).unwrap();
    assert_eq!(book.display(1, 0, 0, LIMIT).unwrap(), "#REF!");
    assert_eq!(book.pivot_source_range("summary"), None);
    book = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    book.edit(&[(0, 0, 3, "2")], LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "60");
}

#[test]
fn table_totals_are_not_counted_and_unrelated_conversions_preserve_identity() {
    let mut book = source();
    book.edit(&[(0, 0, 4, "Other"), (0, 1, 4, "9")], LIMIT)
        .unwrap();
    book.add_table(0, "Other", [0, 4, 1, 4], LIMIT).unwrap();
    book.add_table(0, "Sales", [0, 0, 3, 1], LIMIT).unwrap();
    book.options.tables[1].totals = true;
    let mut book = pivot(&book, r#"{"table":1}"#);
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "30");
    book.convert_table_to_range(0, LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "30");
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let reopened = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(reopened.display(1, 1, 1, LIMIT).unwrap(), "30");
    book.convert_table_to_range(0, LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "30");
}

#[test]
fn deleting_an_unrelated_sheet_remaps_pivot_table_and_name_sources() {
    for binding in [r#"{"table":1}"#, r#"{"name":1}"#] {
        let mut book = Spreadsheet::new();
        book.add_sheet("DataSheet").unwrap();
        book.add_sheet("Summary").unwrap();
        book.edit(
            &[
                (0, 0, 0, "Other"),
                (0, 1, 0, "1"),
                (1, 0, 0, "Group"),
                (1, 0, 1, "Value"),
                (1, 1, 0, "a"),
                (1, 1, 1, "60"),
            ],
            LIMIT,
        )
        .unwrap();
        book.add_table(0, "Other", [0, 0, 1, 0], LIMIT).unwrap();
        book.add_table(1, "Sales", [0, 0, 1, 1], LIMIT).unwrap();
        named(&mut book, "Local", "Sheet1!$A$1:$A$2", Some(0));
        named(&mut book, "Local", "DataSheet!$A$1:$B$2", Some(1));
        // Move the fixture's destination to Summary and its saved source to DataSheet.
        let definition = super::PivotTable {
            data_axis: None,
            subtotals: Vec::new(),
            name: "Summary".into(),
            sheet: 2,
            row: 0,
            column: 0,
            source_sheet: 1,
            source: [0, 0, 1, 1],
            source_binding: Some(if binding.contains("table") {
                super::PivotSource::Table(1)
            } else {
                super::PivotSource::Name(1)
            }),
            rows: vec![0],
            columns: vec![],
            values: vec![super::PivotValue {
                field: 1,
                aggregate: "sum".into(),
                name: "Total".into(),
            }],
            filters: vec![],
            row_totals: true,
            column_totals: true,
        };
        book.set_pivot("summary", Some(definition.clone()), LIMIT)
            .unwrap();
        assert_eq!(book.display(2, 1, 1, LIMIT).unwrap(), "60");
        book.delete_sheet(0, LIMIT).unwrap();
        assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "60", "{binding}");
        // Deleting the actual source must leave a visible error, not delete the pivot.
        book.delete_sheet(0, LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#REF!");
    }
}

#[test]
fn dynamic_pivot_sources_follow_axis_edits_after_growing() {
    for binding in [r#"{"table":0}"#, r#"{"name":0}"#] {
        let mut book = source();
        book.add_table(0, "Sales", [0, 0, 3, 1], LIMIT).unwrap();
        named(&mut book, "Data", "Sheet1!$A$1:$B$4", None);
        let mut book = pivot(&book, binding);
        assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "60");
        book.edit_axis(0, true, 0, 1, LIMIT).unwrap();
        book.edit_axis(0, false, 0, 2, LIMIT).unwrap();
        assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "60");
        assert_eq!(book.pivot_source_range("summary"), Some((0, [2, 1, 5, 2])));
        book.edit_axis(0, false, 5, -1, LIMIT).unwrap();
        assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "30");
        // Delete the entire source. A bound source stays attached and erroneous.
        book.edit_axis(0, true, 1, -2, LIMIT).unwrap();
        assert_eq!(book.display(1, 0, 0, LIMIT).unwrap(), "#REF!");
    }
}

#[test]
fn named_pivot_can_read_a_dynamic_spill() {
    let mut book = source();
    book.edit(&[(0, 0, 5, "=VSTACK(A1:B1,A2:B4)")], LIMIT)
        .unwrap();
    named(&mut book, "Spilled", "Sheet1!$F$1#", None);
    let mut book = pivot(&book, r#"{"name":0}"#);
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "60");
    book.edit(&[(0, 2, 1, "40")], LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "80");
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let reopened = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(reopened.display(1, 1, 1, LIMIT).unwrap(), "80");
}

#[test]
fn removing_an_earlier_table_with_axis_edits_keeps_the_bound_source() {
    let mut book = source();
    book.edit_axis(0, true, 0, 2, LIMIT).unwrap();
    book.edit(&[(0, 0, 0, "Other"), (0, 1, 0, "1")], LIMIT)
        .unwrap();
    book.add_table(0, "Other", [0, 0, 1, 0], LIMIT).unwrap();
    book.add_table(0, "Sales", [0, 2, 3, 3], LIMIT).unwrap();
    let mut book = pivot(&book, r#"{"table":1}"#);
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "60");
    book.edit_axis(0, true, 0, -1, LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "60");
    assert_eq!(
        book.options.pivots["summary"].source_binding,
        Some(super::PivotSource::Table(0))
    );
    book.resize_table(0, 2, 2, LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "30");
}

#[test]
fn invalid_bound_fields_are_rejected_before_structural_edits() {
    let mut book = source();
    book.add_table(0, "Sales", [0, 0, 3, 1], LIMIT).unwrap();
    let mut book = pivot(&book, r#"{"table":0}"#);
    let before = book.to_json();
    let mut definition = book.options.pivots["summary"].clone();
    definition.values[0].field = usize::MAX;
    assert!(book.set_pivot("summary", Some(definition), LIMIT).is_err());
    for binding in [super::PivotSource::Name(99), super::PivotSource::Table(99)] {
        let mut definition = book.options.pivots["summary"].clone();
        definition.source_binding = Some(binding);
        assert!(book.set_pivot("summary", Some(definition), LIMIT).is_err());
    }
    assert_eq!(book.to_json(), before);
}

#[test]
fn converting_a_headerless_source_keeps_a_visible_reference_error() {
    let mut book = source();
    book.add_table(0, "Sales", [0, 0, 3, 1], LIMIT).unwrap();
    book.options.tables[0].header = false;
    let mut book = pivot(&book, r#"{"table":0}"#);
    assert_eq!(book.display(1, 0, 0, LIMIT).unwrap(), "#REF!");
    book.convert_table_to_range(0, LIMIT).unwrap();
    let book = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    assert_eq!(book.display(1, 0, 0, LIMIT).unwrap(), "#REF!");
}

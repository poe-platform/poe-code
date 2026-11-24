use super::Spreadsheet;
use mcp_protocol_rust::json::{self, Value as Json};
const LIMIT: usize = 128 * 1024 * 1024;

fn book(axis: &str, rows: &str, columns: &str) -> Spreadsheet {
    let mut book = Spreadsheet::new();
    book.add_sheet("Pivot").unwrap();
    let source = "Region\tItem\tQuarter\tAmount\nEast\tApple\tQ1\t10\nEast\tPear\tQ1\t20\nEast\tApple\tQ2\t30\nWest\tApple\tQ1\t40\nWest\tPear\tQ2\t50";
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
    let text = format!(
        r#"{{"sales":{{"name":"Sales","sheet":1,"row":0,"column":0,"source_sheet":0,"source":[0,0,5,3],"rows":{rows},"columns":{columns},"data_axis":{axis},"values":[{{"field":3,"aggregate":"sum","name":"Sum"}},{{"field":3,"aggregate":"average","name":"Avg"}}],"filters":[],"row_totals":true,"column_totals":true}}}}"#
    );
    options.push((
        "pivots".encode_utf16().collect(),
        json::parse(text.as_bytes(), json::Limits::default()).unwrap(),
    ));
    Spreadsheet::from_json(&document, LIMIT).unwrap()
}
fn displayed(book: &Spreadsheet, row: usize, width: usize) -> Vec<String> {
    (0..width)
        .map(|c| book.display(1, row, c, LIMIT).unwrap())
        .collect()
}
#[test]
fn pivot_layout_values_between_row_fields_and_record_weighted_totals() {
    let book = book(r#"{"rows":true,"position":1}"#, "[0,1]", "[2]");
    assert_eq!(
        displayed(&book, 0, 6),
        ["Region", "Values", "Item", "Q1", "Q2", "Grand Total"]
    );
    assert_eq!(
        displayed(&book, 1, 6),
        ["East", "Sum", "Apple", "10", "30", "40"]
    );
    assert_eq!(
        displayed(&book, 2, 6),
        ["East", "Sum", "Pear", "20", "", "20"]
    );
    assert_eq!(
        displayed(&book, 3, 6),
        ["East", "Avg", "Apple", "10", "30", "20"]
    );
    assert_eq!(
        displayed(&book, 9, 6),
        ["Grand Total", "Sum", "", "70", "80", "150"]
    );
    assert_eq!(
        displayed(&book, 10, 6),
        ["Grand Total", "Avg", "", "23.3333333333333", "40", "30"]
    );
    let restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    assert_eq!(displayed(&restored, 3, 6), displayed(&book, 3, 6));
    assert!(restored.sheets[1].cells.is_empty());
}
#[test]
fn pivot_layout_values_before_column_fields() {
    let book = book(r#"{"rows":false,"position":0}"#, "[0]", "[1,2]");
    assert_eq!(
        displayed(&book, 0, 11),
        [
            "", "Sum", "Sum", "Sum", "Sum", "Avg", "Avg", "Avg", "Avg", "Sum", "Avg"
        ]
    );
    assert_eq!(
        displayed(&book, 1, 11),
        [
            "",
            "Apple",
            "Apple",
            "Pear",
            "Pear",
            "Apple",
            "Apple",
            "Pear",
            "Pear",
            "Grand Total",
            "Grand Total"
        ]
    );
    assert_eq!(
        displayed(&book, 2, 11),
        [
            "Region", "Q1", "Q2", "Q1", "Q2", "Q1", "Q2", "Q1", "Q2", "", ""
        ]
    );
    assert_eq!(book.display(1, 5, 10, LIMIT).unwrap(), "30");
}

#[test]
fn pivot_layout_single_value_axis_survives_multiple_excel_saves() {
    // Port of ClosedXML 057f5976, XLPivotTableTests.MaintainPivotTableLabelsOrder
    // (MIT, LICENSE.ClosedXML): two row labels followed by the Values sentinel,
    // one column label and one SUM measure must retain that order after loading.
    let mut book = book(r#"{"rows":true,"position":2}"#, "[0,1]", "[2]");
    let mut definition = book.options.pivots["sales"].clone();
    definition.values.truncate(1);
    book.set_pivot("sales", Some(definition), LIMIT).unwrap();
    for _ in 0..3 {
        let bytes = book.export_xlsx(LIMIT).unwrap();
        book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        let pivot = book.options.pivots.values().next().unwrap();
        assert_eq!(pivot.rows, [0, 1]);
        assert_eq!(pivot.columns, [2]);
        assert_eq!(
            pivot.data_axis,
            Some(super::PivotDataAxis {
                rows: true,
                position: 2
            })
        );
        assert_eq!(
            displayed(&book, 0, 6),
            ["Region", "Item", "Values", "Q1", "Q2", "Grand Total"]
        );
        assert_eq!(
            displayed(&book, 1, 6),
            ["East", "Apple", "Sum", "10", "30", "40"]
        );
    }
}

#[test]
fn pivot_layout_all_axis_positions_and_empty_measures_round_trip() {
    for rows in [true, false] {
        for position in 0..=2 {
            for measures in [0, 1, 2] {
                let axis = format!(r#"{{"rows":{rows},"position":{position}}}"#);
                let mut book = if rows {
                    book(&axis, "[0,1]", "[2]")
                } else {
                    book(&axis, "[0]", "[1,2]")
                };
                let mut pivot = book.options.pivots["sales"].clone();
                pivot.values.truncate(measures);
                book.set_pivot("sales", Some(pivot), LIMIT).unwrap();
                let restored =
                    Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
                assert_eq!(
                    restored.options.pivots.values().next().unwrap().data_axis,
                    book.options.pivots["sales"].data_axis
                );
                for r in 0..15 {
                    assert_eq!(
                        displayed(&restored, r, 12),
                        displayed(&book, r, 12),
                        "{axis}, {measures} values, row {r}"
                    );
                }
                assert_eq!(
                    restored
                        .options
                        .pivots
                        .values()
                        .next()
                        .unwrap()
                        .values
                        .len(),
                    measures
                );
            }
        }
    }
}

#[test]
fn pivot_layout_deleting_fields_before_values_keeps_their_position() {
    for rows in [true, false] {
        let axis = format!(r#"{{"rows":{rows},"position":1}}"#);
        let mut book = if rows {
            book(&axis, "[0,1]", "[2]")
        } else {
            book(&axis, "[2]", "[0,1]")
        };
        book.edit_axis(0, true, 0, -1, LIMIT).unwrap();
        let pivot = &book.options.pivots["sales"];
        assert_eq!(pivot.data_axis.unwrap().position, 0);
        assert_eq!(if rows { &pivot.rows } else { &pivot.columns }, &[0]);
        let restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
        assert_eq!(displayed(&restored, 2, 8), displayed(&book, 2, 8));
    }
}

#[test]
fn pivot_layout_invalid_position_and_budget_failure_are_atomic() {
    let mut book = book(r#"{"rows":true,"position":1}"#, "[0,1]", "[2]");
    let before = book.to_json();
    let mut pivot = book.options.pivots["sales"].clone();
    pivot.data_axis.as_mut().unwrap().position = 3;
    assert!(
        book.set_pivot("sales", Some(pivot), LIMIT)
            .unwrap_err()
            .contains("position")
    );
    assert_eq!(book.to_json(), before);
    let pivot = book.options.pivots["sales"].clone();
    assert!(book.set_pivot("sales", Some(pivot), 256).is_err());
    assert_eq!(book.to_json(), before);
    assert!(book.edit(&[(1, 3, 1, "overwrite")], LIMIT).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn pivot_layout_without_group_fields_and_with_empty_filter() {
    let mut book = book(r#"{"rows":true,"position":0}"#, "[]", "[]");
    assert_eq!(displayed(&book, 0, 2), ["Values", ""]);
    assert_eq!(displayed(&book, 1, 2), ["Sum", "150"]);
    assert_eq!(displayed(&book, 2, 2), ["Avg", "30"]);
    let mut pivot = book.options.pivots["sales"].clone();
    pivot.filters.push(super::PivotFilter {
        field: 0,
        selected: Some(vec![]),
    });
    book.set_pivot("sales", Some(pivot), LIMIT).unwrap();
    assert_eq!(displayed(&book, 1, 2), ["Sum", ""]);
    assert_eq!(displayed(&book, 2, 2), ["Avg", ""]);
}

fn change_definition(book: &Spreadsheet, transform: impl Fn(&str) -> String) -> Vec<u8> {
    use crate::commands::structured::{read_office_archive, write_zip_stored};
    let mut parts = read_office_archive(&book.export_xlsx(LIMIT).unwrap());
    for (name, bytes) in &mut parts {
        if name.starts_with("xl/pivotTables/") && name.ends_with(".xml") {
            *bytes = transform(std::str::from_utf8(bytes).unwrap()).into_bytes();
        }
    }
    write_zip_stored(
        &parts
            .iter()
            .map(|(name, bytes)| (name.as_str(), bytes.as_slice()))
            .collect::<Vec<_>>(),
    )
}

#[test]
fn pivot_layout_excel_root_attributes_and_malformed_axes() {
    let book = book(r#"{"rows":true,"position":1}"#, "[0,1]", "[2]");
    // Producers may omit the sentinel when root attributes supply the placement.
    let bytes = change_definition(&book, |xml| xml.replace(r#"<field x="-2"/>"#, ""));
    let restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(displayed(&restored, 3, 6), displayed(&book, 3, 6));
    for (from, to) in [
        (r#"dataOnRows="1""#, r#"dataOnRows="0""#),
        (r#"dataPosition="1""#, r#"dataPosition="2""#),
        (r#"dataPosition="1""#, r#"dataPosition="100""#),
        (r#"<field x="-2"/>"#, r#"<field x="-2"/><field x="-2"/>"#),
        (
            r#"<colFields count="1">"#,
            r#"<colFields count="2"><field x="-2"/>"#,
        ),
    ] {
        let bytes = change_definition(&book, |xml| {
            assert!(xml.contains(from));
            xml.replace(from, to)
        });
        assert!(
            Spreadsheet::import_xlsx(&bytes, LIMIT).is_err(),
            "accepted {to}"
        );
    }
}

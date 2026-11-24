use mcp_protocol_rust::json::{self, Value as Json};
use safe_bash_rust::commands::spreadsheet::{
    PivotDataAxis, PivotSubtotal, PivotValue, Spreadsheet, Value,
};

const LIMIT: usize = 128 * 1024 * 1024;

fn book(rows: &str, columns: &str, axis: &str, subtotals: &str) -> Spreadsheet {
    let mut book = Spreadsheet::new();
    book.add_sheet("Pivot").unwrap();
    let source = "Region\tItem\tQuarter\tAmount\nEast\tApple\tQ1\t10\nEast\tApple\tQ1\t30\nEast\tPear\tQ2\t80\nWest\tApple\tQ1\t40\nWest\tPear\tQ2\t50";
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
        .find(|(k, _)| k.iter().copied().eq("options".encode_utf16()))
        .unwrap()
    else {
        panic!()
    };
    options.retain(|(k, _)| !k.iter().copied().eq("pivots".encode_utf16()));
    let definition = format!(
        r#"{{"sales":{{"name":"Sales","sheet":1,"row":0,"column":0,"source_sheet":0,"source":[0,0,5,3],"rows":{rows},"columns":{columns},"data_axis":{axis},"subtotals":{subtotals},"values":[{{"field":3,"aggregate":"average","name":"Average"}}],"filters":[],"row_totals":true,"column_totals":true}}}}"#
    );
    options.push((
        "pivots".encode_utf16().collect(),
        json::parse(definition.as_bytes(), json::Limits::default()).unwrap(),
    ));
    Spreadsheet::from_json(&document, LIMIT).unwrap()
}

fn row(book: &Spreadsheet, row: usize, width: usize) -> Vec<String> {
    (0..width)
        .map(|c| book.display(1, row, c, LIMIT).unwrap())
        .collect()
}

#[test]
fn automatic_subtotals_use_original_records_and_survive_json_and_excel() {
    let book = book(
        "[0,1]",
        "[]",
        "null",
        r#"[{"field":0,"aggregates":["automatic"],"at_top":false}]"#,
    );
    let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for book in [&book, &json, &excel] {
        assert_eq!(row(book, 1, 3), ["East", "Apple", "20"]);
        assert_eq!(row(book, 2, 3), ["East", "Pear", "80"]);
        assert_eq!(row(book, 3, 3), ["East Total", "", "40"]);
        assert_eq!(row(book, 6, 3), ["West Total", "", "45"]);
        assert_eq!(row(book, 7, 3), ["Grand Total", "", "42"]);
    }
}

#[test]
fn custom_subtotals_override_measure_aggregate_and_can_precede_details() {
    let book = book(
        "[0,1]",
        "[]",
        "null",
        r#"[{"field":0,"aggregates":["sum","countNums"],"at_top":true}]"#,
    );
    assert_eq!(row(&book, 1, 3), ["East Sum", "", "120"]);
    assert_eq!(row(&book, 2, 3), ["East Count", "", "3"]);
    assert_eq!(row(&book, 3, 3), ["East", "Apple", "20"]);
}

#[test]
fn original_closedxml_subtotals_fixture_keeps_nested_subtotals() {
    // ClosedXML 057f5976c788d97e8eac86d1a528bd5411d9386e, MIT.
    // XLPivotTableTests.PivotSubtotalsLoadingTest: original input.xlsx, unmodified.
    let book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/closedxml-pivot-subtotals.xlsx"),
        LIMIT,
    )
    .unwrap();
    let cells: Vec<_> = (0..20)
        .flat_map(|r| (0..10).map(move |c| (r, c)))
        .map(|(r, c)| book.display(1, r, c, LIMIT).unwrap())
        .collect();
    assert!(cells.iter().any(|s| s == "MC Total"), "{cells:?}");
    assert!(cells.iter().any(|s| s == "Action Club Total"));
    assert!(cells.iter().any(|s| s == "21112.8"));
    let mut book = book;
    book.sheets[1].merges.push([25, 0, 2, 1]);
    let mut restored = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(restored.sheets[1].merges, [[25, 0, 2, 1]]);
    restored.edit(&[(0, 5, 7, "2000")], LIMIT).unwrap();
    let subtotal_row = (0..20)
        .find(|&r| restored.display(1, r, 2, LIMIT).unwrap() == "MC Total")
        .unwrap();
    assert_eq!(
        restored.display(1, subtotal_row, 4, LIMIT).unwrap(),
        "22108"
    );
}

#[test]
fn every_custom_subtotal_uses_original_records() {
    for (aggregate, expected) in [
        ("sum", 120.),
        ("count", 3.),
        ("countNums", 3.),
        ("average", 40.),
        ("min", 10.),
        ("max", 80.),
        ("product", 24000.),
        ("stdDev", 1300f64.sqrt()),
        ("stdDevp", (2600f64 / 3.).sqrt()),
        ("var", 1300.),
        ("varp", 2600. / 3.),
    ] {
        let mut book = book("[0,1]", "[]", "null", "[]");
        let mut pivot = book.options.pivots["sales"].clone();
        pivot.subtotals.push(PivotSubtotal {
            field: 0,
            aggregates: vec![aggregate.into()],
            at_top: false,
        });
        book.set_pivot("sales", Some(pivot), LIMIT).unwrap();
        let cell = book.cell(1, 3, 2).unwrap();
        let Value::Number(actual) = cell.value.as_ref().unwrap() else {
            panic!("{aggregate}")
        };
        assert!(
            (actual - expected).abs() < 1e-8,
            "{aggregate}: {actual} != {expected}"
        );
    }
}

#[test]
fn row_and_column_subtotals_and_intersections() {
    let mut book = book("[0,1]", "[2,3]", "null", "[]");
    let mut pivot = book.options.pivots["sales"].clone();
    pivot.subtotals = vec![
        PivotSubtotal {
            field: 0,
            aggregates: vec!["sum".into()],
            at_top: false,
        },
        PivotSubtotal {
            field: 2,
            aggregates: vec!["average".into()],
            at_top: false,
        },
    ];
    book.set_pivot("sales", Some(pivot), LIMIT).unwrap();
    assert_eq!(book.display(1, 4, 0, LIMIT).unwrap(), "East Sum");
    assert_eq!(book.display(1, 0, 5, LIMIT).unwrap(), "Q1 Average");
    assert_eq!(book.display(1, 2, 5, LIMIT).unwrap(), "20");
    assert_eq!(book.display(1, 4, 5, LIMIT).unwrap(), "");
    assert_eq!(book.display(1, 4, 9, LIMIT).unwrap(), "120");
}

#[test]
fn values_on_either_axis_keep_subtotals_with_each_group() {
    for rows in [true, false] {
        for position in 0..=2 {
            let mut book = if rows {
                book("[0,1]", "[]", "null", "[]")
            } else {
                book("[]", "[0,1]", "null", "[]")
            };
            let mut pivot = book.options.pivots["sales"].clone();
            pivot.values.push(PivotValue {
                field: 3,
                aggregate: "sum".into(),
                name: "Sum".into(),
            });
            pivot.data_axis = Some(PivotDataAxis { rows, position });
            pivot.subtotals.push(PivotSubtotal {
                field: 0,
                aggregates: vec!["automatic".into()],
                at_top: false,
            });
            book.set_pivot("sales", Some(pivot), LIMIT).unwrap();
            let restored =
                Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
            for book in [&book, &restored] {
                let mut totals = Vec::new();
                for i in 1..20 {
                    let label = if rows {
                        book.display(1, i, usize::from(position == 0), LIMIT)
                    } else {
                        book.display(1, usize::from(position == 0), i, LIMIT)
                    }
                    .unwrap();
                    if label == "East Total" {
                        totals.push(
                            if rows {
                                book.display(1, i, 3, LIMIT)
                            } else {
                                book.display(1, 3, i, LIMIT)
                            }
                            .unwrap(),
                        );
                    }
                }
                assert_eq!(totals, ["40", "120"], "rows={rows} position={position}");
            }
        }
    }
}

#[test]
fn subtotal_validation_is_atomic() {
    let mut book = book("[0,1]", "[]", "null", "[]");
    for (field, aggregates) in [
        (3, vec!["sum"]),
        (0, vec![]),
        (0, vec!["automatic", "sum"]),
        (0, vec!["sum", "sum"]),
        (0, vec!["unknown"]),
    ] {
        let before = book.to_json();
        let mut pivot = book.options.pivots["sales"].clone();
        pivot.subtotals.push(PivotSubtotal {
            field,
            aggregates: aggregates.into_iter().map(str::to_owned).collect(),
            at_top: false,
        });
        assert!(book.set_pivot("sales", Some(pivot), LIMIT).is_err());
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn custom_subtotal_order_matches_excel_flag_order() {
    let book = book(
        "[0,1]",
        "[]",
        "null",
        r#"[{"field":0,"aggregates":["average","sum","countNums"],"at_top":false}]"#,
    );
    let restored = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for r in 0..12 {
        assert_eq!(row(&book, r, 3), row(&restored, r, 3), "row {r}");
    }
}

#[test]
fn legacy_definitions_without_subtotals_remain_unchanged_and_limits_are_atomic() {
    let mut book = book("[0,1]", "[]", "null", "[]");
    let mut document = book.to_json();
    let mut current = &mut document;
    for name in ["options", "pivots", "sales"] {
        let Json::Object(fields) = current else {
            panic!()
        };
        current = &mut fields
            .iter_mut()
            .find(|(k, _)| k.iter().copied().eq(name.encode_utf16()))
            .unwrap()
            .1;
    }
    let Json::Object(fields) = current else {
        panic!()
    };
    fields.retain(|(k, _)| !k.iter().copied().eq("subtotals".encode_utf16()));
    let legacy = Spreadsheet::from_json(&document, LIMIT).unwrap();
    assert!(legacy.options.pivots["sales"].subtotals.is_empty());
    assert_eq!(row(&legacy, 3, 3), ["West", "Apple", "40"]);
    let before = book.to_json();
    let mut pivot = book.options.pivots["sales"].clone();
    pivot.subtotals.push(PivotSubtotal {
        field: 0,
        aggregates: vec!["automatic".into()],
        at_top: false,
    });
    assert!(book.set_pivot("sales", Some(pivot), 256).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn imported_merges_crossing_pivot_boundary_remain_obstructions() {
    let mut book = book(
        "[0,1]",
        "[]",
        "null",
        r#"[{"field":0,"aggregates":["automatic"],"at_top":false}]"#,
    );
    let mut pivot = book.options.pivots["sales"].clone();
    pivot.row = 1;
    pivot.column = 1;
    book.set_pivot("sales", Some(pivot), LIMIT).unwrap();
    book.sheets[1].merges.push([0, 1, 1, 3]);
    let restored = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(restored.sheets[1].merges, [[0, 1, 1, 3]]);
    assert_eq!(restored.display(1, 1, 1, LIMIT).unwrap(), "#SPILL!");
}

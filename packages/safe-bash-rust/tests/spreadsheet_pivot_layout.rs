use safe_bash_rust::commands::spreadsheet::Spreadsheet;

const LIMIT: usize = 128 * 1024 * 1024;

#[test]
fn original_outline_fixture_matches_its_excel_cached_output() {
    // Unmodified ClosedXML 057f5976, MIT:
    // Resource/TryToLoad/LO/xlsx/pivottable_outline_mode.xlsx.
    // Expected cells are the original cached F1:H8, not engine-generated data.
    let book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/closedxml-pivot-outline.xlsx"),
        LIMIT,
    )
    .unwrap();
    let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    let expected = [
        ["field1", "field2", "Sum of field3"],
        ["1", "", "3"],
        ["", "a", "1"],
        ["", "s", "2"],
        ["2", "", "3"],
        ["", "a", "2"],
        ["", "s", "1"],
        ["Grand Total", "", "6"],
    ];
    for book in [&book, &json, &excel] {
        for (row, values) in expected.iter().enumerate() {
            for (column, value) in values.iter().enumerate() {
                assert_eq!(
                    book.display(0, row, 5 + column, LIMIT).unwrap(),
                    *value,
                    "cell row={row} column={column}"
                );
            }
        }
    }
}

#[test]
fn closedxml_global_layout_updates_every_field_including_unused_fields() {
    // XLPivotTableTests.Property_layout_sets_layout_of_pivot_table_and_all_fields.
    for (bytes, compact, outline) in [
        (
            include_bytes!("fixtures/closedxml-pivot-layout-compact.xlsx").as_slice(),
            true,
            true,
        ),
        (
            include_bytes!("fixtures/closedxml-pivot-layout-outline.xlsx").as_slice(),
            false,
            true,
        ),
        (
            include_bytes!("fixtures/closedxml-pivot-layout-tabular.xlsx").as_slice(),
            false,
            false,
        ),
    ] {
        let book = Spreadsheet::import_xlsx(bytes, LIMIT).unwrap();
        let json = book.to_json();
        let pivot = json
            .get("options")
            .unwrap()
            .get("pivots")
            .unwrap()
            .get("pivot table")
            .unwrap();
        let layout = pivot.get("layout").expect("XLSX layout must be preserved");
        let mcp_protocol_rust::json::Value::Array(fields) = layout.get("fields").unwrap() else {
            panic!()
        };
        assert_eq!(fields.len(), 6, "includes the unused Currency field");
        for field in fields {
            assert_eq!(
                field.get("compact"),
                Some(&mcp_protocol_rust::json::Value::Bool(compact))
            );
            assert_eq!(
                field.get("outline"),
                Some(&mcp_protocol_rust::json::Value::Bool(outline))
            );
        }
    }
}

fn outline_book() -> Spreadsheet {
    Spreadsheet::import_xlsx(
        include_bytes!("fixtures/closedxml-pivot-outline.xlsx"),
        LIMIT,
    )
    .unwrap()
}

fn row(book: &Spreadsheet, row: usize, width: usize) -> Vec<String> {
    (5..5 + width)
        .map(|c| book.display(0, row, c, LIMIT).unwrap())
        .collect()
}

#[test]
fn compact_layout_shares_the_label_column_without_changing_cell_values() {
    let mut book = outline_book();
    let (id, mut pivot) = book
        .options
        .pivots
        .iter()
        .next()
        .map(|(id, p)| (id.clone(), p.clone()))
        .unwrap();
    let layout = pivot.layout.as_mut().unwrap();
    layout.compact = true;
    layout.indent = 2;
    for field in &mut layout.fields {
        field.compact = true;
    }
    book.set_pivot(&id, Some(pivot), LIMIT).unwrap();
    let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for book in [&book, &json, &excel] {
        for (r, expected) in [
            ["Row Labels", "Sum of field3"],
            ["1", "3"],
            ["a", "1"],
            ["s", "2"],
            ["2", "3"],
            ["a", "2"],
            ["s", "1"],
            ["Grand Total", "6"],
        ]
        .iter()
        .enumerate()
        {
            assert_eq!(row(book, r, 2), *expected, "row={r}");
        }
        let style = book.cell_style(0, 2, 5).unwrap();
        assert!(style.attributes.contains(&("Indent", "2".into())));
        assert!(
            matches!(book.cell(0, 2, 5).unwrap().value.as_ref(), Some(safe_bash_rust::commands::spreadsheet::Value::Text(value)) if value == "a")
        );
    }
}

#[test]
fn outline_without_subtotals_keeps_group_headers_and_tabular_uses_first_detail() {
    let mut book = outline_book();
    let (id, mut pivot) = book
        .options
        .pivots
        .iter()
        .next()
        .map(|(id, p)| (id.clone(), p.clone()))
        .unwrap();
    pivot.subtotals.clear();
    book.set_pivot(&id, Some(pivot.clone()), LIMIT).unwrap();
    assert_eq!(row(&book, 1, 3), ["1", "", ""]);
    assert_eq!(row(&book, 2, 3), ["", "a", "1"]);
    for field in &mut pivot.layout.as_mut().unwrap().fields {
        field.outline = false;
    }
    book.set_pivot(&id, Some(pivot.clone()), LIMIT).unwrap();
    assert_eq!(row(&book, 1, 3), ["1", "a", "1"]);
    assert_eq!(row(&book, 2, 3), ["", "s", "2"]);
    for field in &mut pivot.layout.as_mut().unwrap().fields {
        field.repeat_labels = true;
    }
    book.set_pivot(&id, Some(pivot), LIMIT).unwrap();
    let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(row(&excel, 2, 3), ["1", "s", "2"]);
    assert!(
        excel
            .options
            .pivots
            .values()
            .next()
            .unwrap()
            .layout
            .as_ref()
            .unwrap()
            .fields
            .iter()
            .all(|f| f.repeat_labels)
    );
}

#[test]
fn tabular_subtotals_are_below_details_even_when_top_flag_is_retained() {
    let mut book = outline_book();
    let (id, mut pivot) = book
        .options
        .pivots
        .iter()
        .next()
        .map(|(id, p)| (id.clone(), p.clone()))
        .unwrap();
    for field in &mut pivot.layout.as_mut().unwrap().fields {
        field.outline = false;
    }
    book.set_pivot(&id, Some(pivot), LIMIT).unwrap();
    assert_eq!(row(&book, 1, 3), ["1", "a", "1"]);
    assert_eq!(row(&book, 2, 3), ["", "s", "2"]);
    assert_eq!(row(&book, 3, 3), ["1 Total", "", "3"]);
    let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(row(&excel, 3, 3), ["1 Total", "", "3"]);
    assert!(excel.options.pivots.values().next().unwrap().subtotals[0].at_top);
}

#[test]
fn blank_row_follows_groups_but_not_the_last_field() {
    let mut book = outline_book();
    let (id, mut pivot) = book
        .options
        .pivots
        .iter()
        .next()
        .map(|(id, p)| (id.clone(), p.clone()))
        .unwrap();
    for field in &mut pivot.layout.as_mut().unwrap().fields {
        field.blank_row = true;
    }
    book.set_pivot(&id, Some(pivot), LIMIT).unwrap();
    assert_eq!(row(&book, 3, 3), ["", "s", "2"]);
    assert_eq!(row(&book, 4, 3), ["", "", ""]);
    assert_eq!(row(&book, 5, 3), ["2", "", "3"]);
    assert_eq!(row(&book, 8, 3), ["", "", ""]);
    assert_eq!(row(&book, 9, 3), ["Grand Total", "", "6"]);
}

#[test]
fn compact_values_on_rows_do_not_overwrite_group_or_grand_total_labels() {
    use safe_bash_rust::commands::spreadsheet::{PivotDataAxis, PivotValue};
    let mut book = outline_book();
    let (id, mut pivot) = book
        .options
        .pivots
        .iter()
        .next()
        .map(|(id, p)| (id.clone(), p.clone()))
        .unwrap();
    let layout = pivot.layout.as_mut().unwrap();
    layout.indent = 1;
    layout.compact_data = true;
    layout.outline_data = true;
    for field in &mut layout.fields {
        field.compact = true;
    }
    pivot.values.push(PivotValue {
        field: 2,
        aggregate: "count".into(),
        name: "Count of field3".into(),
    });
    pivot.data_axis = Some(PivotDataAxis {
        rows: true,
        position: 2,
    });
    book.set_pivot(&id, Some(pivot), LIMIT).unwrap();
    let labels: Vec<_> = (0..30)
        .map(|r| book.display(0, r, 5, LIMIT).unwrap())
        .collect();
    assert!(
        labels.iter().any(|s| s == "Total Sum of field3"),
        "{labels:?}"
    );
    for expected in ["1", "2", "a", "s", "Sum of field3", "Count of field3"] {
        assert!(
            labels.iter().any(|s| s == expected),
            "missing {expected}: {labels:?}"
        );
    }
}

#[test]
fn libreoffice_original_compact_and_outline_workbooks_match_cached_excel_cells() {
    // LibreOffice abf91474804cd93cdf7d5308e96f03ac5bfc895a (MPL-2.0).
    // Original sc/qa/unit/data/xlsx/{pivot,pivot-table} workbooks; TSV expectations
    // are extracted from their saved worksheet caches, without recalculation.
    for (bytes, expected, sheet, top, left) in [
        (
            include_bytes!("fixtures/libreoffice-pivot-compact.xlsx").as_slice(),
            include_str!("fixtures/libreoffice-pivot-compact.tsv"),
            0,
            0,
            10,
        ),
        (
            include_bytes!("fixtures/libreoffice-pivot-compact-groups.xlsx").as_slice(),
            include_str!("fixtures/libreoffice-pivot-compact-groups.tsv"),
            1,
            2,
            0,
        ),
        (
            include_bytes!("fixtures/libreoffice-pivot-two-column-fields.xlsx").as_slice(),
            include_str!("fixtures/libreoffice-pivot-two-column-fields.tsv"),
            0,
            3,
            6,
        ),
        (
            include_bytes!("fixtures/libreoffice-pivot-values-rows.xlsx").as_slice(),
            include_str!("fixtures/libreoffice-pivot-values-rows.tsv"),
            0,
            3,
            6,
        ),
    ] {
        let book = Spreadsheet::import_xlsx(bytes, LIMIT).unwrap();
        let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
        let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        for book in [&book, &json, &excel] {
            for (row, line) in expected.lines().enumerate() {
                for (column, expected) in line.split('\t').enumerate() {
                    assert_eq!(
                        book.display(sheet, top + row, left + column, LIMIT)
                            .unwrap(),
                        expected,
                        "sheet={sheet} row={} col={}",
                        top + row,
                        left + column
                    );
                }
            }
            let height = expected.lines().count();
            assert_eq!(
                book.display(sheet, top + height, left, LIMIT).unwrap(),
                "",
                "must not add a disabled grand total"
            );
        }
    }
}

#[test]
fn layout_validation_and_failed_recalculation_leave_the_workbook_unchanged() {
    let mut book = outline_book();
    let (id, pivot) = book
        .options
        .pivots
        .iter()
        .next()
        .map(|(id, p)| (id.clone(), p.clone()))
        .unwrap();
    let before = book.to_json();
    let mut invalid = pivot.clone();
    let layout = invalid.layout.as_mut().unwrap();
    layout.fields.push(layout.fields[0].clone());
    assert!(book.set_pivot(&id, Some(invalid), LIMIT).is_err());
    assert_eq!(book.to_json(), before);
    assert!(book.set_pivot(&id, Some(pivot), 300).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn compact_repeat_flags_do_not_repeat_column_labels_and_generated_styles_do_not_enter_json() {
    let mut book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/libreoffice-pivot-compact.xlsx"),
        LIMIT,
    )
    .unwrap();
    let (id, mut pivot) = book
        .options
        .pivots
        .iter()
        .next()
        .map(|(id, p)| (id.clone(), p.clone()))
        .unwrap();
    let layout = pivot.layout.as_mut().unwrap();
    layout.indent = 2;
    for field in &mut layout.fields {
        field.repeat_labels = true;
    }
    book.set_pivot(&id, Some(pivot), LIMIT).unwrap();
    assert_eq!(book.display(0, 3, 10, LIMIT).unwrap(), "bbb");
    let style = book.cell_style(0, 3, 10).unwrap();
    assert!(style.attributes.contains(&("Indent", "2".into())));
    let authored = book.sheets[0].cells.get(&(3, 10));
    assert!(authored.is_none_or(|cell| cell.value.is_none()));
    assert!(
        authored
            .and_then(|c| c.style.as_ref())
            .is_none_or(|s| !s.attributes.contains(&("Indent", "2".into())))
    );
    let reopened = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    assert!(
        reopened
            .cell_style(0, 3, 10)
            .unwrap()
            .attributes
            .contains(&("Indent", "2".into()))
    );
    let mut columns = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/libreoffice-pivot-two-column-fields.xlsx"),
        LIMIT,
    )
    .unwrap();
    let (id, mut pivot) = columns
        .options
        .pivots
        .iter()
        .next()
        .map(|(id, p)| (id.clone(), p.clone()))
        .unwrap();
    for field in &mut pivot.layout.as_mut().unwrap().fields {
        field.compact = true;
        field.repeat_labels = true;
    }
    columns.set_pivot(&id, Some(pivot), LIMIT).unwrap();
    assert_eq!(columns.display(0, 4, 7, LIMIT).unwrap(), "3");
    assert_eq!(columns.display(0, 4, 8, LIMIT).unwrap(), "");
}

#[test]
fn excel_location_distinguishes_caption_row_from_axis_headers() {
    let book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/libreoffice-pivot-compact.xlsx"),
        LIMIT,
    )
    .unwrap();
    let bytes = book.export_xlsx(LIMIT).unwrap();
    // The original fixture's location declares firstHeaderRow=1 and firstDataRow=2:
    // its measure/field captions occupy row 0, above the actual column labels.
    let fs = safe_bash_rust::MemoryVfs::new();
    use safe_bash_rust::SafeBashFs;
    fs.write_file("/pivot.xlsx", &bytes).unwrap();
    let mut shell = safe_bash_rust::Shell::new(
        std::sync::Arc::new(fs),
        safe_bash_rust::ShellOptions::default(),
    );
    let xml = shell.exec("unzip -p /pivot.xlsx xl/pivotTables/pivotTable1.xml").unwrap();
    assert_eq!(xml.exit_code, 0, "{}", xml.stderr);
    assert!(xml.stdout.contains("firstHeaderRow=\"1\" firstDataRow=\"2\" firstDataCol=\"1\""), "{}", xml.stdout);
}

#[test]
fn suppressed_pivot_labels_are_empty_cells_for_formulas() {
    let mut book = outline_book();
    book.edit(
        &[(0, 0, 9, "=ISBLANK(F3)"), (0, 1, 9, "=COUNTA(F2:F7)")],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 9, LIMIT).unwrap(), "TRUE");
    assert_eq!(book.display(0, 1, 9, LIMIT).unwrap(), "2");
    let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(excel.display(0, 0, 9, LIMIT).unwrap(), "TRUE");
    assert_eq!(excel.display(0, 1, 9, LIMIT).unwrap(), "2");
}

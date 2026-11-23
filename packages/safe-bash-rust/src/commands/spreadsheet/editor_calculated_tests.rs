use super::Spreadsheet;
const LIMIT: usize = 20_000_000;

#[test]
fn calculated_columns_mix_local_table_and_other_sheet_references() {
    let formula = "[@Price]*Sheet1!$A$1+Sheet1!A2";
    assert_eq!(
        super::formulas::qualify_columns(formula, "Orders", &mut { LIMIT }).unwrap(),
        "Orders[@Price]*Sheet1!$A$1+Sheet1!A2"
    );
    for array in [false, true] {
        let mut book = Spreadsheet::new();
        book.add_sheet("Data").unwrap();
        book.edit(
            &[
                (0, 0, 0, "2"),
                (0, 1, 0, "3"),
                (1, 0, 0, "Price"),
                (1, 0, 1, "Amount"),
                (1, 1, 0, "7"),
                (1, 2, 0, "9"),
            ],
            LIMIT,
        )
        .unwrap();
        book.add_table(1, "Orders", [0, 0, 2, 1], LIMIT).unwrap();
        book.set_calculated_column(0, 1, formula, array, LIMIT)
            .unwrap();
        assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "17");
        assert_eq!(book.display(1, 2, 1, LIMIT).unwrap(), "18");
    }
}

#[test]
fn table_references_end_before_operators_and_keep_external_qualifiers() {
    for (operator, expected) in [
        ("+", "9"),
        ("-", "5"),
        ("*", "14"),
        ("/", "3.5"),
        ("^", "49"),
        ("&", "72"),
        ("=", "FALSE"),
        ("<>", "TRUE"),
        ("<", "FALSE"),
        (">=", "TRUE"),
        ("%+", "207.00%"),
    ] {
        let formula = format!("[@Price]{operator}Sheet1!$A$1");
        let qualified = format!("Orders{formula}");
        assert_eq!(
            super::formulas::qualify_columns(&formula, "Orders", &mut { LIMIT }).unwrap(),
            qualified
        );
        let mut book = Spreadsheet::new();
        book.add_sheet("Data").unwrap();
        book.edit(
            &[
                (0, 0, 0, "2"),
                (1, 0, 0, "Price"),
                (1, 0, 1, "Amount"),
                (1, 1, 0, "7"),
            ],
            LIMIT,
        )
        .unwrap();
        book.add_table(1, "Orders", [0, 0, 1, 1], LIMIT).unwrap();
        book.edit(&[(1, 1, 1, &format!("={formula}"))], LIMIT)
            .unwrap();
        assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), expected, "{formula}");
        book.set_calculated_column(0, 1, &formula, false, LIMIT)
            .unwrap();
        assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), expected, "{formula}");
    }
    for source in [
        "[Book.xlsx]Data!A1",
        "'[Book.xlsx]Data'!A1",
        "[Book.xlsx]Data!Orders[Price]",
        "[Book.xlsx]Data!A1^[@Price]",
    ] {
        let expected = source.replace("[@Price]", "Orders[@Price]");
        assert_eq!(
            super::formulas::qualify_columns(source, "Orders", &mut { LIMIT }).unwrap(),
            expected
        );
    }
}

#[test]
fn inserted_table_rows_fill_calculated_columns_and_keep_exceptions_and_totals() {
    for array in [false, true] {
        for start in [1, 2, 4] {
            for formula in ["A2*$E$1", "[@Price]*$E$1"] {
                let mut book = Spreadsheet::new();
                book.edit(
                    &[
                        (0, 0, 0, "Price"),
                        (0, 0, 1, "Amount"),
                        (0, 0, 4, "2"),
                        (0, 1, 0, "1"),
                        (0, 2, 0, "2"),
                        (0, 3, 0, "3"),
                        (0, 4, 0, "Total"),
                        (0, 4, 1, "=SUM(B2:B4)"),
                    ],
                    LIMIT,
                )
                .unwrap();
                book.add_table(0, "Orders", [0, 0, 4, 1], LIMIT).unwrap();
                book.options.tables[0].totals = true;
                book.set_calculated_column(0, 1, formula, array, LIMIT)
                    .unwrap();
                book.edit(&[(0, 2, 1, "99"), (0, 4, 1, "=SUM(Orders[Amount])")], LIMIT)
                    .unwrap();
                book.edit_axis(0, false, start, 2, LIMIT).unwrap();
                assert_eq!(book.options.tables[0].area, [0, 0, 6, 1]);
                for row in start..start + 2 {
                    assert!(
                        book.input(0, row, 1).starts_with('='),
                        "array={array} start={start} formula={formula}"
                    );
                    assert_eq!(book.display(0, row, 1, LIMIT).unwrap(), "0");
                }
                assert_eq!(
                    book.display(0, if start <= 2 { 4 } else { 2 }, 1, LIMIT)
                        .unwrap(),
                    "99"
                );
                assert_eq!(book.input(0, 6, 0), "Total");
                book.edit(&[(0, start, 0, "4"), (0, start + 1, 0, "6")], LIMIT)
                    .unwrap();
                assert_eq!(book.display(0, start, 1, LIMIT).unwrap(), "8");
                assert_eq!(book.display(0, start + 1, 1, LIMIT).unwrap(), "12");
                assert_eq!(book.display(0, 6, 1, LIMIT).unwrap(), "127");
                for reopened in [
                    Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
                    Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
                ] {
                    assert_eq!(reopened.display(0, start + 1, 1, LIMIT).unwrap(), "12");
                    assert_eq!(reopened.sheets[0].arrays.len(), if array { 4 } else { 0 });
                }
            }
        }
    }
}

#[test]
fn calculated_row_insertion_obeys_table_boundaries_and_rolls_back_limit_failures() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Price"),
            (0, 0, 1, "Amount"),
            (0, 1, 0, "7"),
            (0, 2, 0, "9"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Orders", [0, 0, 2, 1], LIMIT).unwrap();
    book.set_calculated_column(0, 1, "A2*2", true, LIMIT)
        .unwrap();
    let before = book.to_json();
    assert!(book.edit_axis(0, false, 1, 100_000, 100_000).is_err());
    assert_eq!(book.to_json(), before);
    for start in [0, 3] {
        let mut copied = Spreadsheet::from_json(&before, LIMIT).unwrap();
        copied.edit_axis(0, false, start, 2, LIMIT).unwrap();
        assert_eq!(copied.input(0, start, 1), "");
        assert_eq!(copied.input(0, start + 1, 1), "");
        assert_eq!(copied.sheets[0].arrays.len(), 2);
    }
    book.edit_axis(0, true, 1, 1, LIMIT).unwrap();
    assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "14");
    book.edit_axis(0, false, 1, 1, LIMIT).unwrap();
    assert_eq!(book.input(0, 1, 2), "=A2*2");
    assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "0");
    let mut headerless = Spreadsheet::from_json(&before, LIMIT).unwrap();
    headerless.options.tables[0].header = false;
    headerless.edit(&[(0, 0, 0, "5")], LIMIT).unwrap();
    headerless
        .set_calculated_column(0, 1, "A1*2", true, LIMIT)
        .unwrap();
    headerless.edit_axis(0, false, 1, 1, LIMIT).unwrap();
    assert_eq!(headerless.input(0, 1, 1), "=A2*2");
    headerless.edit(&[(0, 1, 0, "4")], LIMIT).unwrap();
    assert_eq!(headerless.display(0, 1, 1, LIMIT).unwrap(), "8");
}

#[test]
fn complete_fixed_array_batches_replace_or_clear_and_survive_roundtrips() {
    for clear in [false, true] {
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 0, "=SEQUENCE(2,2)"),
                (0, 0, 1, "2"),
                (0, 1, 0, "3"),
                (0, 1, 1, "4"),
            ],
            LIMIT,
        )
        .unwrap();
        book.sheets[0].arrays.push(super::ArrayFormula {
            range: [0, 0, 2, 2],
            expression: "SEQUENCE(2,2)".into(),
            openformula: None,
            formula_display: None,
        });
        book.edit(&[], LIMIT).unwrap();
        let edits = if clear {
            vec![(0, 0, 0, ""), (0, 0, 1, ""), (0, 1, 0, ""), (0, 1, 1, "")]
        } else {
            vec![
                (0, 1, 1, "99"),
                (0, 0, 1, "=A1*2"),
                (0, 0, 0, "7"),
                (0, 1, 0, "TRUE"),
                (0, 1, 1, "=SUM(A1:B1)"),
            ]
        };
        book.edit(&edits, LIMIT).unwrap();
        assert!(book.sheets[0].arrays.is_empty());
        for reopened in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            assert!(reopened.sheets[0].arrays.is_empty());
            for (r, c, expected) in [(0, 0, "7"), (0, 1, "14"), (1, 0, "TRUE"), (1, 1, "21")] {
                assert_eq!(
                    reopened.display(0, r, c, LIMIT).unwrap(),
                    if clear { "" } else { expected }
                );
            }
        }
    }
}

#[test]
fn fixed_array_batch_coverage_and_calculation_failures_are_atomic() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=SEQUENCE(2)"),
            (0, 1, 0, "2"),
            (0, 0, 2, "=SEQUENCE(2)"),
            (0, 1, 2, "2"),
        ],
        LIMIT,
    )
    .unwrap();
    for c in [0, 2] {
        book.sheets[0].arrays.push(super::ArrayFormula {
            range: [0, c, 1, 2],
            expression: "SEQUENCE(2)".into(),
            openformula: None,
            formula_display: None,
        });
    }
    book.edit(&[], LIMIT).unwrap();
    let before = book.to_json();
    for edits in [
        vec![(0, 0, 0, "7"), (0, 0, 0, "8")],
        vec![(0, 0, 0, "7"), (0, 1, 0, "8"), (0, 1, 2, "9")],
        vec![(0, 0, 0, "7"), (0, 1, 0, "8"), (1, 0, 0, "9")],
    ] {
        assert!(book.edit(&edits, LIMIT).is_err());
        assert_eq!(book.to_json(), before);
    }
    for limit in [0, 100, 1000, 10_000] {
        assert!(
            book.edit(&[(0, 0, 0, "=SUM(SEQUENCE(100000))"), (0, 1, 0, "")], limit)
                .is_err()
        );
        assert_eq!(book.to_json(), before, "limit={limit}");
    }
    book.edit(&[(0, 1, 0, "8"), (0, 0, 0, "7")], LIMIT).unwrap();
    assert_eq!(book.sheets[0].arrays.len(), 1);
    assert_eq!(book.sheets[0].arrays[0].range, [0, 2, 1, 2]);
    assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "2");
}

#[test]
fn table_sort_moves_fixed_array_records_and_exceptions_through_roundtrips() {
    for formula in ["A2:A3*$F$1", "[@Price]*$F$1"] {
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 0, "Price"),
                (0, 0, 1, "Item"),
                (0, 0, 2, "Amount"),
                (0, 0, 5, "2"),
                (0, 1, 0, "7"),
                (0, 1, 1, "Paper"),
                (0, 2, 0, "3"),
                (0, 2, 1, "Pens"),
                (0, 3, 0, "10"),
                (0, 3, 1, "Folders"),
                (0, 4, 0, "7"),
                (0, 4, 1, "Pads"),
                (0, 5, 1, "Total"),
                (0, 5, 2, "=SUM(C2:C5)"),
            ],
            LIMIT,
        )
        .unwrap();
        book.add_table(0, "Orders", [0, 0, 5, 2], LIMIT).unwrap();
        book.options.tables[0].totals = true;
        book.set_calculated_column(0, 2, formula, true, LIMIT)
            .unwrap();
        book.edit(&[(0, 3, 2, "99")], LIMIT).unwrap();
        book.sheets[0].cells.get_mut(&(4, 2)).unwrap().format = Some("$0.00".into());
        book.sheets[0].comments.push(super::model::Comment {
            row: 4,
            column: 2,
            author: "Reviewer".into(),
            runs: Vec::new(),
        });
        let before = book.to_json();
        assert!(book.sort_table(0, 2, false, 1).is_err());
        assert_eq!(book.to_json(), before);
        book.sort_table(0, 2, false, LIMIT).unwrap();
        for (row, label, value) in [
            (1, "Pens", "6"),
            (2, "Paper", "14"),
            (3, "Pads", "$14.00"),
            (4, "Folders", "99"),
        ] {
            assert_eq!(book.input(0, row, 1), label);
            assert_eq!(book.display(0, row, 2, LIMIT).unwrap(), value);
        }
        assert_eq!(book.sheets[0].comments[0].row, 3);
        assert_eq!(book.display(0, 5, 2, LIMIT).unwrap(), "$133.00");
        assert_eq!(book.sheets[0].arrays.len(), 3);
        assert!(
            book.sheets[0]
                .arrays
                .iter()
                .all(|a| (1..=3).contains(&a.range[0]))
        );
        let sorted = book.to_json();
        assert!(book.sort_table(0, 2, false, LIMIT).unwrap().is_empty());
        assert_eq!(book.to_json(), sorted);
        for mut reopened in [
            Spreadsheet::from_json(&sorted, LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            reopened.sort_table(0, 2, true, LIMIT).unwrap();
            assert_eq!(
                (1..=4).map(|r| reopened.input(0, r, 1)).collect::<Vec<_>>(),
                ["Folders", "Paper", "Pads", "Pens"]
            );
            assert!(!reopened.sheets[0].arrays.iter().any(|a| a.range[0] == 1));
            assert_eq!(reopened.display(0, 4, 2, LIMIT).unwrap(), "6");
            reopened.edit(&[(0, 4, 0, "5")], LIMIT).unwrap();
            assert_eq!(reopened.display(0, 4, 2, LIMIT).unwrap(), "10");
        }
    }
}

#[test]
fn single_cell_arrays_allow_complete_replacement_without_changing_other_rows() {
    for text in ["99", "=A2*3", ""] {
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 0, "Price"),
                (0, 0, 1, "Amount"),
                (0, 1, 0, "7"),
                (0, 2, 0, "8"),
            ],
            LIMIT,
        )
        .unwrap();
        book.add_table(0, "Orders", [0, 0, 2, 1], LIMIT).unwrap();
        book.set_calculated_column(0, 1, "A2:A3*2", true, LIMIT)
            .unwrap();
        book.edit(&[(0, 1, 1, text)], LIMIT).unwrap();
        assert_eq!(book.sheets[0].arrays.len(), 1);
        assert_eq!(book.sheets[0].arrays[0].range, [2, 1, 1, 1]);
        assert_eq!(
            book.display(0, 1, 1, LIMIT).unwrap(),
            match text {
                "99" => "99",
                "" => "",
                _ => "21",
            }
        );
        assert_eq!(book.display(0, 2, 1, LIMIT).unwrap(), "16");
        assert!(book.options.tables[0].calculated_columns[&1].array);
        for reopened in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            assert_eq!(
                reopened.display(0, 1, 1, LIMIT).unwrap(),
                book.display(0, 1, 1, LIMIT).unwrap()
            );
            assert_eq!(reopened.sheets[0].arrays.len(), 1);
        }
    }
}

#[test]
fn single_cell_array_replacement_rolls_back_metadata_and_mixed_batches() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Price"),
            (0, 0, 1, "Amount"),
            (0, 1, 0, "7"),
            (0, 2, 0, "8"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Orders", [0, 0, 2, 1], LIMIT).unwrap();
    book.set_calculated_column(0, 1, "A2*2", true, LIMIT)
        .unwrap();
    let before = book.to_json();
    for limit in [0, 100, 1000, 10_000] {
        assert!(
            book.edit(&[(0, 1, 1, "=SUM(SEQUENCE(100000))")], limit)
                .is_err()
        );
        assert_eq!(book.to_json(), before, "limit={limit}");
    }
    book.sheets[0].arrays[1].range[3] = 2;
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 1, 1, "99"), (0, 3, 1, "99")], LIMIT)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
    book.sheets[0].arrays[1].range[3] = 1;
    book.edit(
        &[(0, 2, 1, "99"), (0, 1, 1, "=A2*3"), (0, 2, 1, "=A3*4")],
        LIMIT,
    )
    .unwrap();
    assert!(book.sheets[0].arrays.is_empty());
    assert_eq!(book.display(0, 1, 1, LIMIT).unwrap(), "21");
    assert_eq!(book.display(0, 2, 1, LIMIT).unwrap(), "32");
}

#[test]
fn calculated_columns_keep_the_first_data_row_as_the_template_origin() {
    for delta in [1, -1] {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, "Price"), (0, 0, 1, "Amount")], LIMIT)
            .unwrap();
        book.add_table(0, "Orders", [0, 0, 3, 1], LIMIT).unwrap();
        book.set_calculated_column(0, 1, "A2*2", false, LIMIT)
            .unwrap();
        book.edit_axis(0, false, 1, delta, LIMIT).unwrap();
        assert_eq!(
            book.options.tables[0].calculated_columns[&1].formula, "A2*2",
            "delta={delta}"
        );
        let bottom = book.options.tables[0].area[2] + 1;
        book.resize_table(0, bottom, 1, LIMIT).unwrap();
        assert_eq!(
            book.input(0, bottom, 1),
            format!("=A{}*2", bottom + 1),
            "delta={delta}"
        );
    }
}

#[test]
fn calculated_column_origins_preserve_absolute_cross_sheet_and_range_semantics() {
    for (formula, start, delta, expected) in [
        ("A2+$A2+A$2+$A$2", 1, 1, "A2+$A2+A$3+$A$3"),
        ("A2+$A2+A$2+$A$2", 1, -1, "A2+$A2+#REF!+#REF!"),
        ("SUM(A2:A4)", 1, 1, "SUM(A2:A4)"),
        ("SUM(A2:A4)", 1, -1, "SUM(A2:A4)"),
        ("SUM(A2:A4)", 2, 1, "SUM(A2:A5)"),
        ("SUM(A2:A4)", 2, -1, "SUM(A2:A3)"),
        ("Other!A2", 1, 1, "Other!A1"),
        ("Other!A2", 1, -1, "Other!A3"),
        ("'[external.xlsx]Data'!A2", 1, 1, "'[external.xlsx]Data'!A1"),
        (
            "'[external.xlsx]Data'!A2",
            1,
            -1,
            "'[external.xlsx]Data'!A3",
        ),
        ("LET(rate,A2,rate*2)", 1, 1, "LET(rate,A2,rate*2)"),
        ("LET(rate,A2,rate*2)", 1, -1, "LET(rate,A2,rate*2)"),
    ] {
        let mut book = Spreadsheet::new();
        book.add_sheet("Other").unwrap();
        book.edit(&[(0, 0, 0, "Price"), (0, 0, 1, "Amount")], LIMIT)
            .unwrap();
        book.add_table(0, "Orders", [0, 0, 5, 1], LIMIT).unwrap();
        book.set_calculated_column(0, 1, formula, false, LIMIT)
            .unwrap();
        book.edit_axis(0, false, start, delta, LIMIT).unwrap();
        assert_eq!(
            book.options.tables[0].calculated_columns[&1].formula, expected,
            "{formula}, row={start}, delta={delta}"
        );
    }
}

#[test]
fn calculated_column_origin_tracks_the_authored_row_through_successive_edits() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Other").unwrap();
    book.add_table(0, "Orders", [0, 0, 5, 1], LIMIT).unwrap();
    book.set_calculated_column(0, 1, "Other!A2", false, LIMIT)
        .unwrap();
    book.edit_axis(0, false, 1, 1, LIMIT).unwrap();
    assert_eq!(
        book.options.tables[0].calculated_columns[&1].formula,
        "Other!A1"
    );
    book.edit_axis(0, false, 2, -1, LIMIT).unwrap();
    // The first remaining authored formula is Other!A3 in row 3. Its copy to
    // the inserted first data row is Other!A2, independent of an empty cell.
    assert_eq!(
        book.options.tables[0].calculated_columns[&1].formula,
        "Other!A2"
    );
    book = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    book.edit_axis(0, false, 1, -1, LIMIT).unwrap();
    assert_eq!(
        book.options.tables[0].calculated_columns[&1].formula,
        "Other!A3"
    );
}

#[test]
fn formula_translation_rejects_unbounded_offsets_without_panicking() {
    for offset in [(i64::MAX, 0), (i64::MIN, 0), (0, i64::MAX), (0, i64::MIN)] {
        let result = std::panic::catch_unwind(|| {
            Spreadsheet::translate_formula("B2", &["Sheet1".into()], 0, offset, &mut { LIMIT })
        });
        assert!(result.is_ok_and(|result| result.is_err()), "{offset:?}");
    }
}

#[test]
fn table_shrink_keeps_local_formula_bindings_outside_the_new_range() {
    for (bottom, right, current, total) in [
        (1, 2, "#REF!", "7"),
        (3, 0, "16", "24"),
        (1, 0, "#REF!", "7"),
    ] {
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 0, "Price"),
                (0, 0, 1, "Amount"),
                (0, 0, 2, "Total"),
                (0, 1, 0, "7"),
                (0, 2, 0, "8"),
                (0, 3, 0, "9"),
            ],
            LIMIT,
        )
        .unwrap();
        book.add_table(0, "Orders", [0, 0, 3, 2], LIMIT).unwrap();
        book.edit(
            &[
                (0, 1, 1, "=[@Price]*2"),
                (0, 2, 1, "=[@Price]*2"),
                (0, 2, 2, "=SUM([Price])"),
                (0, 3, 2, "=IF(TRUE,\"[@Price]\",[Price])"),
            ],
            LIMIT,
        )
        .unwrap();
        assert_eq!(book.display(0, 2, 1, LIMIT).unwrap(), "16");
        assert_eq!(book.display(0, 2, 2, LIMIT).unwrap(), "24");
        book.resize_table(0, bottom, right, LIMIT).unwrap();
        assert_eq!(book.input(0, 2, 1), "=Orders[@Price]*2");
        assert_eq!(book.input(0, 2, 2), "=SUM(Orders[Price])");
        assert_eq!(book.input(0, 3, 2), "=IF(TRUE,\"[@Price]\",Orders[Price])");
        assert_eq!(book.display(0, 2, 1, LIMIT).unwrap(), current);
        assert_eq!(book.display(0, 2, 2, LIMIT).unwrap(), total);
        assert_eq!(book.input(0, 2, 0), "8");
        let mut restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
        assert_eq!(restored.display(0, 2, 1, LIMIT).unwrap(), current);
        restored.resize_table(0, 3, 2, LIMIT).unwrap();
        assert_eq!(restored.display(0, 2, 1, LIMIT).unwrap(), "16");
        assert_eq!(restored.display(0, 2, 2, LIMIT).unwrap(), "24");
        let imported = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert_eq!(imported.display(0, 2, 1, LIMIT).unwrap(), current);
        assert_eq!(imported.display(0, 2, 2, LIMIT).unwrap(), total);
    }
}

#[test]
fn table_shrink_retains_array_and_named_expression_bindings() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Price"),
            (0, 0, 1, "Amount"),
            (0, 0, 2, "Other"),
            (0, 1, 0, "7"),
            (0, 2, 0, "8"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Orders", [0, 0, 2, 2], LIMIT).unwrap();
    book.edit(&[(0, 2, 1, "=[@Price]*2"), (0, 2, 2, "=A3*2")], LIMIT)
        .unwrap();
    book.sheets[0].cells.get_mut(&(2, 2)).unwrap().openformula = Some("of:=[.A3]*2".into());
    book.sheets[0].arrays.push(super::model::ArrayFormula {
        range: [2, 1, 1, 1],
        expression: "[@Price]*2".into(),
        openformula: Some("msoxl:=[@Price]*2".into()),
        formula_display: None,
    });
    book.options.names.push(super::model::NamedExpression {
        name: "Revenue".into(),
        sheet: None,
        position: (0, 2, 1),
        expression: "SUM([Price])".into(),
        openformula: Some("msoxl:=SUM([Price])".into()),
        compiled: None,
    });
    book.edit(&[(0, 5, 0, "=Revenue")], LIMIT).unwrap();
    assert_eq!(book.display(0, 5, 0, LIMIT).unwrap(), "15");
    assert_eq!(book.display(0, 2, 2, LIMIT).unwrap(), "16");
    book.resize_table(0, 1, 1, LIMIT).unwrap();
    assert_eq!(book.sheets[0].arrays[0].expression, "Orders[@Price]*2");
    assert_eq!(book.options.names[0].expression, "SUM(Orders[Price])");
    assert_eq!(book.display(0, 2, 1, LIMIT).unwrap(), "#REF!");
    assert_eq!(book.display(0, 5, 0, LIMIT).unwrap(), "7");
    assert_eq!(book.display(0, 2, 2, LIMIT).unwrap(), "16");
    assert_eq!(
        book.sheets[0].cells[&(2, 2)].openformula.as_deref(),
        Some("of:=[.A3]*2")
    );
    let imported = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(imported.display(0, 2, 1, LIMIT).unwrap(), "#REF!");
    assert_eq!(imported.display(0, 5, 0, LIMIT).unwrap(), "7");
}

#[test]
fn calculated_columns_fill_relative_references_and_formal_arrays() {
    // Ported behavior from Univer 4767b3b calculated-column.spec.ts (LICENSE.Univer).
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 4, "Name"),
            (0, 0, 5, "Amount"),
            (0, 0, 6, "Array"),
            (0, 7, 0, "5"),
            (0, 8, 0, "7"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Orders", [0, 4, 9, 6], LIMIT).unwrap();
    book.set_calculated_column(0, 1, "A2*2", false, LIMIT)
        .unwrap();
    book.set_calculated_column(0, 2, "=$A2", true, LIMIT)
        .unwrap();
    for (row, value) in [(7, "10"), (8, "14")] {
        assert_eq!(book.input(0, row, 5), format!("=A{}*2", row + 1));
        assert_eq!(book.input(0, row, 6), format!("=$A{}", row + 1));
        assert_eq!(book.display(0, row, 5, LIMIT).unwrap(), value);
        assert!(
            book.sheets[0]
                .arrays
                .iter()
                .any(|a| a.range == [row, 6, 1, 1])
        );
    }
    let before = book.input(0, 7, 5);
    book.set_calculated_column(0, 1, " ", false, LIMIT).unwrap();
    assert!(!book.options.tables[0].calculated_columns.contains_key(&1));
    assert_eq!(book.input(0, 7, 5), before);
    let imported = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert!(imported.options.tables[0].calculated_columns[&2].array);
    assert!(
        imported.sheets[0]
            .arrays
            .iter()
            .any(|a| a.range == [7, 6, 1, 1])
    );
}

#[test]
fn calculated_columns_preserve_structured_reference_literals_and_external_qualifiers() {
    // All eight cases from Univer's calculated-column fill regression. Poe supports
    // the concise current-row form; local references acquire the table name.
    for (formula, expected) in [
        ("[@单价]*[@数量]", "Orders[@单价]*Orders[@数量]"),
        ("[@[单价]]*[@[数量]]", "Orders[@[单价]]*Orders[@[数量]]"),
        (
            "SUM([单价])+SUM([[#Data],[数量]])",
            "SUM(Orders[单价])+SUM(Orders[[#Data],[数量]])",
        ),
        (
            "SUM([@[单价]:[数量]])+$A2",
            "SUM(Orders[@[单价]:[数量]])+$A8",
        ),
        ("Other[@单价]*[@数量]", "Other[@单价]*Orders[@数量]"),
        (
            "IF(A2=\"[@单价]\",[@数量],\"a\"\"[数量]\")",
            "IF(A8=\"[@单价]\",Orders[@数量],\"a\"\"[数量]\")",
        ),
        ("[@[Tax'] rate]]", "Orders[@[Tax'] rate]]"),
        (
            "SUM('[other.xlsx]Sheet 1'!A2)+SUM([other]Other[单价])",
            "SUM('[other.xlsx]Sheet 1'!A8)+SUM([other]Other[单价])",
        ),
    ] {
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 0, "单价"),
                (0, 0, 1, "数量"),
                (0, 0, 2, "金额"),
                (0, 0, 3, "Tax] rate"),
            ],
            LIMIT,
        )
        .unwrap();
        book.add_table(0, "Orders", [0, 0, 9, 3], LIMIT).unwrap();
        book.set_calculated_column(0, 2, formula, false, LIMIT)
            .unwrap();
        assert_eq!(book.input(0, 7, 2), format!("={expected}"), "{formula}");
    }
}

#[test]
fn calculated_columns_grow_without_overwriting_existing_exceptions() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Price"),
            (0, 0, 1, "Amount"),
            (0, 1, 0, "7"),
            (0, 2, 0, "8"),
            (0, 3, 0, "9"),
            (0, 3, 1, "99"),
            (0, 4, 0, "10"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Orders", [0, 0, 2, 1], LIMIT).unwrap();
    book.set_calculated_column(0, 1, "[@Price]*2", false, LIMIT)
        .unwrap();
    book.edit(&[(0, 2, 1, "77")], LIMIT).unwrap();
    book.resize_table(0, 4, 2, LIMIT).unwrap();
    assert_eq!(book.options.tables[0].area, [0, 0, 4, 2]);
    assert_eq!(
        book.options.tables[0].columns,
        vec!["Price", "Amount", "Column3"]
    );
    assert_eq!(
        book.options.tables[0].filter.as_ref().unwrap().area,
        [0, 0, 4, 2]
    );
    for (row, value) in [(1, "14"), (2, "77"), (3, "99"), (4, "20")] {
        assert_eq!(book.display(0, row, 1, LIMIT).unwrap(), value);
    }
    book.resize_table(0, 2, 1, LIMIT).unwrap();
    assert_eq!(book.display(0, 4, 1, LIMIT).unwrap(), "#REF!"); // Formula remains outside its table.
    assert_eq!(book.input(0, 4, 1), "=Orders[@Price]*2");
}

#[test]
fn calculated_columns_reject_overlap_and_budget_failures_atomically() {
    let mut book = Spreadsheet::new();
    book.add_table(0, "Orders", [0, 0, 3, 1], LIMIT).unwrap();
    book.add_table(0, "Other", [5, 0, 7, 1], LIMIT).unwrap();
    let before = book.to_json();
    assert!(book.resize_table(0, 6, 1, LIMIT).is_err());
    assert!(book.resize_table(0, 1_048_576, 1, LIMIT).is_err());
    assert!(
        book.set_calculated_column(0, 2, "A2", false, LIMIT)
            .is_err()
    );
    assert!(book.set_calculated_column(0, 1, "A2", false, 100).is_err());
    assert!(book.resize_table(0, 4, 1, 100).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn table_regrowth_preserves_single_cell_arrays_after_shrinking() {
    for (bottom, right) in [(1, 1), (3, 0), (1, 0)] {
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 0, "Price"),
                (0, 0, 1, "Amount"),
                (0, 1, 0, "7"),
                (0, 2, 0, "8"),
                (0, 3, 0, "9"),
            ],
            LIMIT,
        )
        .unwrap();
        book.add_table(0, "Orders", [0, 0, 3, 1], LIMIT).unwrap();
        book.set_calculated_column(0, 1, "[@Price]*2", true, LIMIT)
            .unwrap();
        book.resize_table(0, bottom, right, LIMIT).unwrap();
        assert_eq!(book.sheets[0].arrays.len(), 3);
        let json = book.to_json();
        let xlsx = book.export_xlsx(LIMIT).unwrap();
        for mut reopened in [
            Spreadsheet::from_json(&json, LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&xlsx, LIMIT).unwrap(),
        ] {
            reopened.resize_table(0, 3, 1, LIMIT).unwrap();
            assert_eq!(reopened.sheets[0].arrays.len(), 3);
            for (row, expected) in [(1, "14"), (2, "16"), (3, "18")] {
                assert_eq!(
                    reopened.display(0, row, 1, LIMIT).unwrap(),
                    expected,
                    "shrink to {bottom},{right}"
                );
            }
        }
    }
}

#[test]
fn table_growth_keeps_fixed_array_exceptions_and_rejects_multi_cell_groups() {
    for range in [[3, 1, 1, 1], [3, 1, 1, 2], [3, 1, 2, 1]] {
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 0, "Price"),
                (0, 0, 1, "Amount"),
                (0, 1, 0, "7"),
                (0, 2, 0, "8"),
                (0, 3, 0, "9"),
                (0, 3, 1, "17"),
                (0, 4, 1, "19"),
                (0, 3, 2, "19"),
            ],
            LIMIT,
        )
        .unwrap();
        book.add_table(0, "Orders", [0, 0, 1, 1], LIMIT).unwrap();
        book.set_calculated_column(0, 1, "[@Price]*2", false, LIMIT)
            .unwrap();
        book.sheets[0].arrays.push(super::model::ArrayFormula {
            range,
            expression: "{17;19}".into(),
            openformula: None,
            formula_display: None,
        });
        let mut book = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
        if range[2] == 1 && range[3] == 1 {
            book.resize_table(0, 3, 1, LIMIT).unwrap();
            assert_eq!(book.display(0, 2, 1, LIMIT).unwrap(), "16");
            assert_eq!(book.display(0, 3, 1, LIMIT).unwrap(), "17");
            assert_eq!(book.sheets[0].arrays[0].range, range);
        } else {
            let before = book.to_json();
            for (bottom, right) in [(3, 1), (4, 2)] {
                assert!(book.resize_table(0, bottom, right, LIMIT).is_err());
                assert_eq!(book.to_json(), before);
            }
        }
    }
}

#[test]
fn calculated_column_excel_export_uses_dynamic_array_and_variable_namespaces() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 1, 0, "=SEQUENCE(3)")], LIMIT).unwrap();
    book.add_table(0, "Orders", [0, 2, 3, 2], LIMIT).unwrap();
    book.set_calculated_column(0, 0, "SUM($A$2#)+LET(rate,2,rate)", false, LIMIT)
        .unwrap();
    assert_eq!(
        book.options.tables[0].calculated_columns[&0].formula,
        "SUM($A$2#)+LET(rate,2,rate)"
    );
    assert_eq!(book.input(0, 1, 2), "=SUM($A$2#)+LET(rate,2,rate)");
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let entries = crate::commands::structured::read_office_archive(&bytes);
    let table = std::str::from_utf8(&entries["xl/tables/table1.xml"]).unwrap();
    assert!(table.contains("_xlfn.ANCHORARRAY($A$2)"), "{table}");
    assert!(
        table.contains("_xlfn.LET(_xlpm.rate,2,_xlpm.rate)"),
        "{table}"
    );
    let imported = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(imported.display(0, 1, 2, LIMIT).unwrap(), "8");
    assert_eq!(imported.options.tables[0].calculated_columns.len(), 1);
    let formula = &imported.options.tables[0].calculated_columns[&0].formula;
    assert!(formula.contains("LET(rate,2,rate)"), "{formula}");
    assert!(
        !formula.contains("_xlfn.") && !formula.contains("_xlpm."),
        "{formula}"
    );
}

#[test]
fn copied_external_workbook_coordinates_keep_case_and_absolute_axes() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(
            0,
            0,
            0,
            "='[Book.xlsx]Data O''Brien'!A2+'[Book.xlsx]Data O''Brien'!$B$3+[book.xlsx]Sheet1!C$4",
        )],
        LIMIT,
    )
    .unwrap();
    let cell = book.sheets[0].cells.get(&(0, 0)).unwrap();
    let moved = book.relocate_cell(cell, (0, 0), (2, 1), 0, LIMIT).unwrap();
    assert_eq!(
        moved.formula.as_deref(),
        Some("'[Book.xlsx]Data O''Brien'!B4+'[Book.xlsx]Data O''Brien'!$B$3+[book.xlsx]Sheet1!D$4")
    );
}

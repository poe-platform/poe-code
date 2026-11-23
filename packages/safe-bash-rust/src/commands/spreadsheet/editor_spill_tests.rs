// Adapted from IronCalc array_formulas/test_dynamic_arrays.rs and
// dynamic_evaluation/test_wrong_order.rs (MIT, LICENSE.IronCalc,
// f93662006b8fb1c401dc870bbda26c5d60ac6037).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn spill_range_identifies_anchors_children_and_non_spill_cells_after_recalculation() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Other").unwrap();
    book.edit(
        &[
            (0, 1, 1, "=SEQUENCE(2,3)"),
            (0, 5, 1, "=SEQUENCE(1)"),
            (0, 7, 1, "=1"),
            (0, 8, 1, "value"),
            (1, 1, 1, "=SEQUENCE(3,2)"),
            (1, 1_048_574, 16_382, "=SEQUENCE(2,2)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (s, [r, c, w, h]) in [
        (0, [1, 1, 3, 2]),
        (0, [5, 1, 1, 1]),
        (1, [1, 1, 2, 3]),
        (1, [1_048_574, 16_382, 2, 2]),
    ] {
        for row in r..r + h {
            for col in c..c + w {
                assert_eq!(book.spill_range(s, row, col), Some([r, c, w, h]));
            }
        }
        for (row, col) in [(r - 1, c), (r, c - 1), (r + h, c), (r, c + w)] {
            assert_eq!(book.spill_range(s, row, col), None);
        }
    }
    for (s, r, c) in [(0, 7, 1), (0, 8, 1), (0, 900_000, 1), (2, 1, 1)] {
        assert_eq!(book.spill_range(s, r, c), None);
    }
    book.edit(&[(0, 1, 1, "=SEQUENCE(1,2)")], LIMIT).unwrap();
    assert_eq!(book.spill_range(0, 1, 1), Some([1, 1, 2, 1]));
    assert_eq!(book.spill_range(0, 1, 2), Some([1, 1, 2, 1]));
    assert_eq!(book.spill_range(0, 1, 3), None);
    assert_eq!(book.spill_range(0, 2, 1), None);
    book.edit(&[(0, 1, 1, "=SEQUENCE(1,2)"), (0, 1, 2, "blocked")], LIMIT)
        .unwrap();
    assert_eq!(book.display(0, 1, 1, LIMIT).unwrap(), "#SPILL!");
    assert_eq!(book.spill_range(0, 1, 1), None);
    assert_eq!(book.spill_range(0, 1, 2), None);
    book.edit(&[(0, 1, 2, "")], LIMIT).unwrap();
    assert_eq!(book.spill_range(0, 1, 2), Some([1, 1, 2, 1]));
    book.edit(&[(0, 1, 1, "=42")], LIMIT).unwrap();
    assert_eq!(book.spill_range(0, 1, 1), None);
    assert_eq!(book.spill_range(0, 1, 2), None);
    assert_eq!(book.spill_range(1, 1, 2), Some([1, 1, 2, 3]));
}

#[test]
fn cached_arrays_ignore_missing_values_outside_their_rectangle() {
    for dirty in [
        (0, 9, 11),
        (0, 10, 9),
        (0, 10, 13),
        (0, 11, 9),
        (0, 11, 13),
        (0, 12, 11),
        (1, 10, 10),
    ] {
        let mut book = Spreadsheet::new();
        book.add_sheet("Other").unwrap();
        book.edit(
            &[(0, 10, 10, "=123"), (dirty.0, dirty.1, dirty.2, "=7")],
            LIMIT,
        )
        .unwrap();
        book.sheets[0].arrays.push(super::ArrayFormula {
            range: [10, 10, 3, 2],
            expression: "UNSUPPORTED_FUNCTION()".into(),
            openformula: None,
            formula_display: None,
        });
        book.options.recalculate = false;
        book.sheets[dirty.0]
            .cells
            .get_mut(&(dirty.1, dirty.2))
            .unwrap()
            .value = None;
        super::formulas::cache(&mut book.sheets, &book.options, None, LIMIT, false).unwrap();
        assert_eq!(book.display(0, 10, 10, LIMIT).unwrap(), "123", "{dirty:?}");
        assert_eq!(
            book.display(dirty.0, dirty.1, dirty.2, LIMIT).unwrap(),
            "7",
            "{dirty:?}"
        );
    }
}

#[test]
fn array_cache_bounds_include_the_last_cell_and_preserve_cached_followers() {
    for recalculate in [false, true] {
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 10, 10, "=123"),
                (0, 10, 11, "9"),
                (0, 10, 12, "9"),
                (0, 11, 10, "9"),
                (0, 11, 11, "9"),
                (0, 11, 12, "9"),
                (0, 1_048_575, 16_383, "=123"),
            ],
            LIMIT,
        )
        .unwrap();
        for (range, expression) in [
            ([10, 10, 3, 2], "{1,2,3;4,5,6}"),
            ([1_048_575, 16_383, 1, 1], "42"),
        ] {
            book.sheets[0].arrays.push(super::ArrayFormula {
                range,
                expression: expression.into(),
                openformula: None,
                formula_display: None,
            });
            book.sheets[0]
                .cells
                .get_mut(&(range[0], range[1]))
                .unwrap()
                .value = None;
        }
        book.options.recalculate = recalculate;
        super::formulas::cache(&mut book.sheets, &book.options, None, LIMIT, false).unwrap();
        assert_eq!(book.display(0, 10, 10, LIMIT).unwrap(), "1");
        assert_eq!(
            book.display(0, 11, 12, LIMIT).unwrap(),
            if recalculate { "6" } else { "9" }
        );
        assert_eq!(book.display(0, 1_048_575, 16_383, LIMIT).unwrap(), "42");
    }
    // The cache can also receive programmatically constructed empty groups.
    for range in [[0, 0, 0, 1], [0, 0, 1, 0]] {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, "=7")], LIMIT).unwrap();
        book.sheets[0].arrays.push(super::ArrayFormula {
            range,
            expression: "123".into(),
            openformula: None,
            formula_display: None,
        });
        super::formulas::cache(&mut book.sheets, &book.options, None, LIMIT, false).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "7");
    }
}

#[test]
fn array_results_display_empty_cells_as_zero_but_keep_empty_text() {
    for fixed in [false, true] {
        let mut book = Spreadsheet::new();
        book.edit(
            &[(0, 1, 0, "'"), (0, 2, 0, "0"), (0, 0, 2, "=A1:A3")],
            LIMIT,
        )
        .unwrap();
        if fixed {
            book.edit(&[(0, 1, 2, "0"), (0, 2, 2, "0")], LIMIT).unwrap();
            book.sheets[0].arrays.push(super::ArrayFormula {
                range: [0, 2, 1, 3],
                expression: "A1:A3".into(),
                openformula: Some("msoxl:=A1:A3".into()),
                formula_display: None,
            });
            book.edit(&[], LIMIT).unwrap();
        }
        for restored in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            for (row, expected) in [(0, "0"), (1, ""), (2, "0")] {
                assert_eq!(
                    restored.display(0, row, 2, LIMIT).unwrap(),
                    expected,
                    "fixed={fixed} row={row}"
                );
            }
        }
        book.edit(&[(0, 0, 0, "7")], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "7");
        book.edit(&[(0, 0, 0, "")], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "0");
    }
}

#[test]
fn arrays_spill_typed_values_and_json_keeps_only_authored_cells() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "={1,TRUE;\"text\",#N/A}")], LIMIT)
        .unwrap();
    for (r, c, expected) in [(0, 0, "1"), (0, 1, "TRUE"), (1, 0, "text"), (1, 1, "#N/A")] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), expected, "{r},{c}");
    }
    assert_eq!(
        book.sheets[0].cells.len(),
        1,
        "derived cells must not become authored data"
    );
    let reopened = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    assert_eq!(reopened.display(0, 1, 0, LIMIT).unwrap(), "text");
    assert_eq!(reopened.sheets[0].cells.len(), 1);
}

#[test]
fn spill_dependencies_work_before_their_anchors_and_in_sparse_aggregates() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=B2+D2"),
            (0, 0, 1, "=D1:D2"),
            (0, 0, 3, "=E1:E2"),
            (0, 0, 4, "10"),
            (0, 1, 4, "20"),
            (0, 1, 0, "=SUM(B:B)"),
            (0, 2, 0, "=COUNTIF(B:B,\">15\")"),
            (0, 3, 0, "=CONCAT(B1:B2)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, expected) in [
        (0, 0, "40"),
        (1, 0, "30"),
        (2, 0, "1"),
        (3, 0, "1020"),
        (0, 1, "10"),
        (1, 1, "20"),
        (0, 3, "10"),
        (1, 3, "20"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), expected, "{r},{c}");
    }
    book.edit(&[(0, 1, 4, "25")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "50");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "35");
}

#[test]
fn blockers_break_spills_without_losing_data_and_clearing_restores_them() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "={1;2;3}")], LIMIT).unwrap();
    assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), "3");
    book.edit(&[(0, 1, 0, "peer data")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#SPILL!");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "peer data");
    assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), "");
    book.edit(&[(0, 1, 0, "")], LIMIT).unwrap();
    assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), "3");
    book.edit(&[(0, 0, 0, "={7;8}")], LIMIT).unwrap();
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "8");
    assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), "");
    book.edit(&[(0, 0, 0, "plain")], LIMIT).unwrap();
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "");
}

#[test]
fn spill_bounds_and_merges_block_output_without_partial_writes() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 1_048_575, 0, "={1;2}"), (0, 0, 16_383, "={3,4}")],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 1_048_575, 0, LIMIT).unwrap(), "#SPILL!");
    assert_eq!(book.display(0, 0, 16_383, LIMIT).unwrap(), "#SPILL!");
    book.sheets[0].merges.push([1, 0, 2, 1]);
    book.edit(&[(0, 0, 0, "={1;2;3}")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#SPILL!");
    assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), "");
}

#[test]
fn indirect_readers_recalculate_after_late_spills() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, "=B1"), (0, 0, 1, "=C2*4"), (0, 0, 2, "={4;5}")],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "20");
    // B1 may already be cached when a later root reads it.
    book.edit(&[(0, 0, 0, "=B1+B2"), (0, 1, 1, "=C2")], LIMIT)
        .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "25");
}

#[test]
fn spill_self_dependencies_report_cycles_and_downstream_can_recover() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=B1:B2"),
            (0, 0, 1, "=A1:A2"),
            (0, 0, 3, "=IFERROR(A1,42)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert!(book.display(0, 0, 0, LIMIT).unwrap().starts_with('#'));
    assert_eq!(book.display(0, 0, 3, LIMIT).unwrap(), "42");
}

#[test]
fn spill_cells_keep_independent_styles_and_failure_keeps_previous_cache() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "={1;2}")], LIMIT).unwrap();
    let mut cell = book.sheets[0].cells[&(0, 0)].clone();
    cell.formula = None;
    cell.openformula = None;
    cell.value = None;
    cell.format = Some("0.00".into());
    book.replace_cells(vec![(0, 1, 0, Some(cell))], LIMIT)
        .unwrap();
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "2.00");
    assert!(book.edit(&[(0, 0, 0, "={4;5}")], 10).is_err());
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "2.00");
    assert!(book.sheets[0].cells[&(1, 0)].value.is_none());
}

#[test]
fn sequence_filter_and_spill_references_recalculate_and_keep_typed_values() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=SUM(C1#)"),
            (0, 0, 2, "=SEQUENCE(3,2,10,-2)"),
            (0, 0, 5, "=FILTER(C1:D3,C1:C3>3)"),
            (0, 4, 5, "=SUM(_xlfn.ANCHORARRAY(C1))"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "30");
    assert_eq!(book.display(0, 2, 3, LIMIT).unwrap(), "0");
    assert_eq!(book.display(0, 1, 6, LIMIT).unwrap(), "4");
    assert_eq!(book.display(0, 2, 5, LIMIT).unwrap(), "");
    assert_eq!(book.display(0, 4, 5, LIMIT).unwrap(), "30");
    book.edit(&[(0, 0, 2, "=SEQUENCE(2,,5,2)")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "12");
    assert_eq!(book.display(0, 4, 5, LIMIT).unwrap(), "12");
    book.edit(
        &[
            (0, 4, 0, "=FILTER({TRUE,2;FALSE,4},{0;1})"),
            (0, 7, 0, "=FILTER({1;2},{0;0},\"none\")"),
            (0, 8, 0, "=FILTER({1;2},{0;0})"),
            (0, 9, 0, "=SUM(Z1#)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 4, 0, LIMIT).unwrap(), "FALSE");
    assert_eq!(book.display(0, 4, 1, LIMIT).unwrap(), "4");
    assert_eq!(book.display(0, 7, 0, LIMIT).unwrap(), "none");
    assert_eq!(book.display(0, 8, 0, LIMIT).unwrap(), "#CALC!");
    assert_eq!(book.display(0, 9, 0, LIMIT).unwrap(), "#REF!");
}

#[test]
fn excel_marks_dynamic_arrays_and_cached_children_stay_editable_after_import() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "={1,TRUE;2,\"hello\"}"),
            (0, 4, 0, "=SEQUENCE(2)"),
            (0, 7, 0, "=SUM(A5#)"),
        ],
        LIMIT,
    )
    .unwrap();
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let archive = crate::commands::structured::read_office_archive(&bytes);
    let xml = std::str::from_utf8(&archive["xl/worksheets/sheet1.xml"]).unwrap();
    assert!(xml.contains("cm=\"1\""), "{xml}");
    assert!(xml.contains("ref=\"A1:B2\""), "{xml}");
    assert!(
        xml.contains("<c r=\"B2\" t=\"str\"><v>hello</v></c>"),
        "{xml}"
    );
    assert!(archive.contains_key("xl/metadata.xml"));
    let mut imported = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert!(
        imported.sheets[0].arrays.is_empty(),
        "dynamic arrays must not become fixed CSE arrays"
    );
    assert_eq!(imported.sheets[0].cells.len(), 3);
    assert_eq!(imported.display(0, 1, 1, LIMIT).unwrap(), "hello");
    assert_eq!(imported.display(0, 7, 0, LIMIT).unwrap(), "3");
    imported.edit(&[(0, 4, 0, "=SEQUENCE(3)")], LIMIT).unwrap();
    assert_eq!(imported.display(0, 6, 0, LIMIT).unwrap(), "3");
    assert_eq!(imported.display(0, 7, 0, LIMIT).unwrap(), "6");
    imported.edit(&[(0, 1, 1, "peer")], LIMIT).unwrap();
    assert_eq!(imported.display(0, 0, 0, LIMIT).unwrap(), "#SPILL!");
}

#[test]
fn dynamic_conditions_and_selectors_keep_boolean_values() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=IF(2>3,TRUE)"),
            (0, 1, 0, "={1;3}>2"),
            (0, 4, 0, "=IF({TRUE;FALSE},TRUE,FALSE)"),
            (0, 7, 0, "=IFERROR({TRUE;#N/A},FALSE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, expected) in [
        (0, "FALSE"),
        (1, "FALSE"),
        (2, "TRUE"),
        (4, "TRUE"),
        (5, "FALSE"),
        (7, "TRUE"),
        (8, "FALSE"),
    ] {
        assert_eq!(book.display(0, r, 0, LIMIT).unwrap(), expected, "row {r}");
    }
}

#[test]
fn excel_sort_preserves_records_types_and_default_optional_arguments() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=SORT({\"b\",2;\"a\",1;\"c\",3},2,-1)"),
            (0, 4, 0, "=SORT({3,1,2},,,TRUE)"),
            (0, 6, 0, "=SORT({TRUE;\"b\";1;#N/A;\"a\"})"),
            (0, 12, 0, "=SORT({1;2},0)"),
            (0, 13, 0, "=SORT({1;2},,0)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, value) in [
        (0, 0, "c"),
        (0, 1, "3"),
        (2, 0, "a"),
        (4, 0, "1"),
        (4, 1, "2"),
        (4, 2, "3"),
        (6, 0, "1"),
        (7, 0, "a"),
        (8, 0, "b"),
        (9, 0, "TRUE"),
        (10, 0, "#N/A"),
        (12, 0, "#VALUE!"),
        (13, 0, "#VALUE!"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), value, "{r},{c}");
    }
}

#[test]
fn scalar_hyperlink_does_not_spill_its_metadata_into_a_neighbor() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=HYPERLINK(\"https://example.com\",\"Website\")"),
            (0, 1, 0, "Keep me"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "Website");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "Keep me");
}

#[test]
fn filter_propagates_source_errors_before_an_empty_fallback() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=FILTER(NA(),FALSE,\"none\")")], LIMIT)
        .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#N/A");
}

// Excel SORT.xlsx orders errors by error code, not their source position or label.
#[test]
fn sort_and_sortby_order_errors_and_keep_equal_records_stable() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=#N/A"),
            (0, 0, 1, "first"),
            (0, 1, 0, "=#NAME?"),
            (0, 1, 1, "second"),
            (0, 2, 0, "=#DIV/0!"),
            (0, 2, 1, "third"),
            (0, 3, 0, "=#N/A"),
            (0, 3, 1, "fourth"),
            (0, 4, 0, "'#N/A"),
            (0, 4, 1, "text"),
            (0, 0, 3, "=SORT(A1:B6)"),
            (0, 0, 6, "=SORT(A1:B6,1,-1)"),
            (0, 0, 9, "=SORTBY(B1:B6,A1:A6)"),
            (0, 0, 11, "=SORTBY(B1:B6,A1:A6,-1)"),
        ],
        LIMIT,
    )
    .unwrap();
    for changed in [false, true] {
        if changed {
            book.edit(&[(0, 1, 0, "=#NULL!")], LIMIT).unwrap();
        }
        let restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
        let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        for current in [&book, &restored, &excel] {
            let ascending = if changed {
                ["text", "second", "third", "first", "fourth", "0"]
            } else {
                ["text", "third", "second", "first", "fourth", "0"]
            };
            let descending = if changed {
                ["first", "fourth", "third", "second", "text", "0"]
            } else {
                ["first", "fourth", "second", "third", "text", "0"]
            };
            for (columns, expected) in [([4, 9], ascending), ([7, 11], descending)] {
                for col in columns {
                    for (row, expected) in expected.iter().enumerate() {
                        assert_eq!(
                            current.display(0, row, col, LIMIT).unwrap(),
                            *expected,
                            "{changed} {row},{col}"
                        );
                    }
                }
            }
        }
    }
}

// Adapted from IronCalc spill_functions and lookup_and_reference tests,
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT; LICENSE.IronCalc).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn filter_compound_whole_columns_keep_and_or_arithmetic_and_last_row() {
    let mut base = Spreadsheet::new();
    base.add_sheet("Data").unwrap();
    base.edit(
        &[
            (1, 0, 0, "Open"),
            (1, 1, 0, "open"),
            (1, 2, 0, "Closed"),
            (1, 1_048_575, 0, "Open"),
            (1, 0, 1, "10"),
            (1, 1, 1, "20"),
            (1, 2, 1, "-1"),
            (1, 1_048_575, 1, "30"),
        ],
        100_000,
    )
    .unwrap();
    for (predicate, expected) in [
        ("(Data!A:A=\"OPEN\")*(Data!B:B>=20)", vec!["20", "30"]),
        (
            "(Data!A:A=\"Closed\")+(Data!B:B>=20)",
            vec!["20", "-1", "30"],
        ),
        ("EXACT(Data!A:A,\"Open\")*(Data!B:B>=20)", vec!["30"]),
        (
            "((Data!A:A=\"Open\")+(Data!A:A=\"Closed\"))*(Data!B:B<20)",
            vec!["10", "-1"],
        ),
        ("(Data!B:B+5)*2>=50", vec!["20", "30"]),
        ("(Data!B:B/10-1)^2>1", vec!["-1", "30"]),
        ("EXACT(Data!B:B+1,31)", vec!["30"]),
        ("(Data!B:B>0)*(1/Data!B:B>0)", vec!["#DIV/0!"]),
    ] {
        let mut book = Spreadsheet::from_json(&base.to_json(), 100_000).unwrap();
        let formula = format!("=FILTER(Data!B:B,{predicate})");
        book.edit(&[(0, 0, 0, &formula)], 100_000).unwrap();
        for (row, value) in expected.iter().enumerate() {
            assert_eq!(
                book.display(0, row, 0, LIMIT).unwrap(),
                *value,
                "{formula} row {row}"
            );
        }
        assert_eq!(
            book.display(0, expected.len(), 0, LIMIT).unwrap(),
            "",
            "{formula} trailing output"
        );
    }
}

#[test]
fn filter_compound_masks_preserve_intermediate_shapes_and_eager_errors() {
    for (data, predicate, expected) in [
        ("{10;20;30}", "({1;2;3}>1)*({1;2;3}<3)", vec!["20"]),
        (
            "{10;20;30}",
            "({1;2;3}>1)+({1;2;3}<3)",
            vec!["10", "20", "30"],
        ),
        ("{10;20;30}", "({1;2}={1;2;3})*0", vec!["#VALUE!"]),
        ("{10;20}", "({1;2}+{1;2;3})>3", vec!["20"]),
        ("{10;20;30}", "({1;2}+{1;2;3})={1;4;6}", vec!["#VALUE!"]),
        ("{10;20;30}", "EXACT({1;2}+{1;2;3},{1;4;6})", vec!["#N/A"]),
        (
            "{10;20;30}",
            "({0;1;2}>0)*({1;#N/A;3}=1/0)",
            vec!["#DIV/0!"],
        ),
        (
            "{10;20;30}",
            "({0;#N/A;2}>0)*({#NUM!;1;3}>0)",
            vec!["#NUM!"],
        ),
        ("{10;20;30}", "(A1:A3=\"\")*(B1:B3=0)", vec!["10"]),
        ("{10;20;30}", "(A1:A3=0)+(B1:B3=\"\")", vec!["10", "30"]),
        ("1", "(A1,A2)*(1=1)", vec!["#REF!"]),
        ("1", "((A1,A2)*(1=1))+NA()", vec!["#REF!"]),
        ("1", "(A1,A2)*(NA()+1)", vec!["#N/A"]),
        ("1", "(LAMBDA(x,x)=1)*0", vec!["#CALC!"]),
        ("1", "EXACT(NA(),1)+(A1,A2)", vec!["#N/A"]),
        ("1", "EXACT((A1,A2),1)+(A1,A2)", vec!["#VALUE!"]),
    ] {
        for wrapped in [false, true] {
            let mut book = Spreadsheet::new();
            let predicate = if wrapped {
                format!("IF(TRUE,{predicate},FALSE)")
            } else {
                predicate.into()
            };
            let formula = format!("=FILTER({data},{predicate},\"none\")");
            book.edit(
                &[
                    (0, 1, 0, "=\"\""),
                    (0, 2, 0, "0"),
                    (0, 1, 1, "1"),
                    (0, 2, 1, "'"),
                    (0, 0, 5, &formula),
                ],
                LIMIT,
            )
            .unwrap();
            for (row, value) in expected.iter().enumerate() {
                assert_eq!(
                    book.display(0, row, 5, LIMIT).unwrap(),
                    *value,
                    "{formula} row {row}"
                );
            }
            assert_eq!(
                book.display(0, expected.len(), 5, LIMIT).unwrap(),
                "",
                "{formula} trailing output"
            );
        }
    }
}

#[test]
fn filter_compound_dense_inputs_reuse_bounded_evaluation_storage() {
    for wrapper in [false, true] {
        let mut book = Spreadsheet::new();
        let predicate = "(SEQUENCE(20000)>10000)*(SEQUENCE(20000)<10003)";
        let predicate = if wrapper {
            format!("IF(TRUE,{predicate},FALSE)")
        } else {
            predicate.into()
        };
        let formula = format!("=SUM(FILTER(SEQUENCE(20000),{predicate}))");
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "20003");
    }
}

#[test]
fn filter_compound_long_chains_keep_scalar_and_array_results() {
    let mut book = Spreadsheet::new();
    let arithmetic = format!(
        "{}>200",
        std::iter::repeat_n("A1:A3", 200)
            .collect::<Vec<_>>()
            .join("+")
    );
    let formula = format!("=FILTER(B1:B3,{arithmetic})");
    book.edit(
        &[
            (0, 0, 0, "1"),
            (0, 1, 0, "2"),
            (0, 2, 0, "3"),
            (0, 0, 1, "10"),
            (0, 1, 1, "20"),
            (0, 2, 1, "30"),
            (0, 0, 4, &formula),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 4, LIMIT).unwrap(), "20");
    assert_eq!(book.display(0, 1, 4, LIMIT).unwrap(), "30");
    let wrapped = format!("=FILTER(B1:B3,IF(TRUE,{arithmetic},FALSE))");
    book.edit(&[(0, 0, 4, &wrapped)], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 4, LIMIT).unwrap(), "20");
    assert_eq!(book.display(0, 1, 4, LIMIT).unwrap(), "30");
}

#[test]
fn filter_comparison_whole_columns_keep_case_and_numeric_rules() {
    let mut base = Spreadsheet::new();
    base.add_sheet("Data").unwrap();
    base.edit(
        &[
            (1, 0, 0, "Open"),
            (1, 1, 0, "open"),
            (1, 2, 0, "Closed"),
            (1, 1_048_575, 0, "Open"),
            (1, 0, 1, "10"),
            (1, 1, 1, "20"),
            (1, 2, 1, "-1"),
            (1, 1_048_575, 1, "30"),
            (1, 0, 2, "10"),
            (1, 1, 2, "99"),
            (1, 1_048_575, 2, "30"),
        ],
        100_000,
    )
    .unwrap();
    for (formula, expected) in [
        (
            "=FILTER(Data!B:B,Data!A:A=\"OPEN\")",
            vec!["10", "20", "30"],
        ),
        ("=FILTER(Data!A:A,Data!B:B>=20)", vec!["open", "Open"]),
        (
            "=FILTER(Data!B:B,Data!A:A<>\"\")",
            vec!["10", "20", "-1", "30"],
        ),
        ("=FILTER(Data!A:A,Data!B:B<0)", vec!["Closed"]),
        ("=FILTER(Data!A:A,Data!B:B<=-1)", vec!["Closed"]),
        ("=FILTER(Data!A:A,20<Data!B:B)", vec!["Open"]),
        ("=FILTER(Data!B:B,Data!B:B<>Data!C:C)", vec!["20", "-1"]),
    ] {
        let mut book = Spreadsheet::from_json(&base.to_json(), 100_000).unwrap();
        book.edit(&[(0, 0, 0, formula)], 100_000).unwrap();
        for (row, value) in expected.iter().enumerate() {
            assert_eq!(
                book.display(0, row, 0, LIMIT).unwrap(),
                *value,
                "{formula} row {row}"
            );
        }
        assert_eq!(
            book.display(0, expected.len(), 0, LIMIT).unwrap(),
            "",
            "{formula} trailing output"
        );
    }
}

#[test]
fn filter_comparison_masks_keep_blank_types_padding_and_error_order() {
    for (data, predicate, expected) in [
        ("B1:B6", "A1:A6=0", vec!["10", "30"]),
        ("B1:B6", "A1:A6=\"0\"", vec!["40"]),
        ("B1:B6", "A1:A6=\"\"", vec!["10", "20"]),
        ("B1:B6", "A1:A6<>0", vec!["20", "40", "50", "60"]),
        ("B1:B6", "A1:A6>0", vec!["20", "40", "50"]),
        ("B1:B6", "A1:A6<=0", vec!["10", "30", "60"]),
        ("{1;2;3}", "{1;2}={1;2;3}", vec!["#VALUE!"]),
        ("{1;2;3}", "{#N/A;1;2}=1/0", vec!["#N/A"]),
        ("{1;2;3}", "{1;#N/A;2}=1/0", vec!["#DIV/0!"]),
        ("{1;2;3}", "A1:A3=1/0", vec!["#DIV/0!"]),
        ("1", "(A1,A2)=0", vec!["#REF!"]),
        ("1", "(A1,A2)=NA()", vec!["#N/A"]),
        ("1", "LAMBDA(x,x)=1", vec!["#CALC!"]),
        (
            "{1;2;3}",
            "{\"Open\";\"open\";\"Closed\"}=\"OPEN\"",
            vec!["1", "2"],
        ),
        ("{1;2;3}", "{\"Σ\";\"ς\";\"σ\"}=\"Σ\"", vec!["1", "2", "3"]),
    ] {
        for wrapper in [false, true] {
            let mut book = Spreadsheet::new();
            let predicate = if wrapper {
                format!("IF(TRUE,{predicate},FALSE)")
            } else {
                predicate.into()
            };
            let formula = format!("=FILTER({data},{predicate},\"none\")");
            book.edit(
                &[
                    (0, 1, 0, "=\"\""),
                    (0, 2, 0, "0"),
                    (0, 3, 0, "'0"),
                    (0, 4, 0, "TRUE"),
                    (0, 5, 0, "-1"),
                    (0, 0, 1, "10"),
                    (0, 1, 1, "20"),
                    (0, 2, 1, "30"),
                    (0, 3, 1, "40"),
                    (0, 4, 1, "50"),
                    (0, 5, 1, "60"),
                    (0, 0, 5, &formula),
                ],
                LIMIT,
            )
            .unwrap();
            for (row, value) in expected.iter().enumerate() {
                assert_eq!(
                    book.display(0, row, 5, LIMIT).unwrap(),
                    *value,
                    "{formula} row {row}"
                );
            }
            assert_eq!(
                book.display(0, expected.len(), 5, LIMIT).unwrap(),
                "",
                "{formula} trailing output"
            );
        }
    }
}

#[test]
fn filter_whole_columns_reads_only_selected_source_cells() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Data").unwrap();
    book.edit(
        &[
            (1, 0, 0, "the"),
            (1, 1, 0, "The"),
            (1, 2, 0, "THE"),
            (1, 0, 1, "1169"),
            (1, 1, 1, "464"),
            (1, 2, 1, "10970"),
            (1, 1, 2, "TRUE"),
            (1, 1_048_575, 0, "The"),
            (1, 1_048_575, 1, "99"),
            (1, 1_048_575, 2, "TRUE"),
            (0, 0, 0, "The"),
            (
                0,
                0,
                1,
                "=IF(A1=\"\",\"\",FILTER(Data!B:B,EXACT(Data!A:A,A1)))",
            ),
            (0, 0, 3, "=FILTER(Data!B:B,Data!C:C)"),
        ],
        100_000,
    )
    .unwrap();
    for column in [1, 3] {
        assert_eq!(book.display(0, 0, column, LIMIT).unwrap(), "464");
        assert_eq!(book.display(0, 1, column, LIMIT).unwrap(), "99");
    }
}

#[test]
fn filter_exact_masks_keep_blank_coercion_errors_and_broadcasting() {
    // Compare the fused predicate with the ordinary evaluator and explicit
    // expected values. IF's wrapper prevents fusion without changing its result.
    for (data, predicate, expected) in [
        ("B1:B5", "EXACT(A1:A5,\"\")", vec!["10", "20"]),
        ("B1:B5", "EXACT(A1:A5,0)", vec!["30", "40"]),
        ("B1:B5", "EXACT(TRUE,A1:A5)", vec!["50"]),
        (
            "B1:B5",
            "EXACT(A1:A5,C1:C5)",
            vec!["10", "20", "30", "40", "50"],
        ),
        (
            "{1;2;3}",
            "EXACT({\"a\";\"A\";\"a\"},\"a\")",
            vec!["1", "3"],
        ),
        ("{1;2;3}", "EXACT({\"a\";\"A\"},\"a\")", vec!["#VALUE!"]),
        (
            "{1;2;3}",
            "EXACT({\"a\";\"A\"},{\"a\";\"b\";\"a\"})",
            vec!["#N/A"],
        ),
        ("{1;2;3}", "EXACT({#N/A;\"A\";\"a\"},1/0)", vec!["#N/A"]),
        ("{1;2;3}", "EXACT({\"a\";#N/A;\"a\"},1/0)", vec!["#DIV/0!"]),
        ("{1;2;3}", "EXACT(A1:A3,1/0)", vec!["#DIV/0!"]),
        (
            "{1;2;3}",
            "EXACT({TRUE;1;\"1\"},{\"TRUE\";\"1\";1})",
            vec!["1", "2", "3"],
        ),
        ("B1:B5", "EXACT(A1:A5,\"missing\")", vec!["none"]),
    ] {
        for wrapper in [false, true] {
            let mut book = Spreadsheet::new();
            let predicate = if wrapper {
                format!("IF(TRUE,{predicate},FALSE)")
            } else {
                predicate.into()
            };
            let formula = format!("=FILTER({data},{predicate},\"none\")");
            book.edit(
                &[
                    (0, 1, 0, "=\"\""),
                    (0, 2, 0, "0"),
                    (0, 3, 0, "'0"),
                    (0, 4, 0, "TRUE"),
                    (0, 0, 1, "10"),
                    (0, 1, 1, "20"),
                    (0, 2, 1, "30"),
                    (0, 3, 1, "40"),
                    (0, 4, 1, "50"),
                    (0, 1, 2, "'"),
                    (0, 2, 2, "'0"),
                    (0, 3, 2, "0"),
                    (0, 4, 2, "'TRUE"),
                    (0, 0, 5, &formula),
                ],
                LIMIT,
            )
            .unwrap();
            for (row, expected) in expected.iter().enumerate() {
                assert_eq!(
                    book.display(0, row, 5, LIMIT).unwrap(),
                    *expected,
                    "{formula} row {row}"
                );
            }
            assert_eq!(
                book.display(0, expected.len(), 5, LIMIT).unwrap(),
                "",
                "{formula} trailing output"
            );
        }
    }
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=FILTER({1;2;3},EXACT(A1:A3,\"x\"))")], LIMIT)
        .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#CIRC!");
}

#[test]
fn filter_sparse_masks_follow_late_spills_edits_and_roundtrips() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Data").unwrap();
    book.edit(
        &[
            (0, 0, 0, "=FILTER(Data!B:B,EXACT(Data!A:A,\"hit\"))"),
            (0, 0, 2, "=FILTER(Data!B:B,Data!A:A=\"HIT\")"),
            (
                0,
                0,
                4,
                "=FILTER(Data!B:B,(Data!A:A=\"HIT\")*(Data!B:B>20))",
            ),
            (1, 2, 0, "=IF(E1=1,{\"hit\";\"hit\"},{\"miss\";\"hit\"})"),
            (1, 2, 1, "11"),
            (1, 3, 1, "22"),
            (1, 0, 4, "1"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "11");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "22");
    assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "11");
    assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "22");
    assert_eq!(book.display(0, 0, 4, LIMIT).unwrap(), "22");
    assert_eq!(book.display(0, 1, 4, LIMIT).unwrap(), "");
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        restored.edit(&[(1, 0, 4, "2")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 0, 0, LIMIT).unwrap(), "22");
        assert_eq!(restored.display(0, 1, 0, LIMIT).unwrap(), "");
        assert_eq!(restored.display(0, 0, 2, LIMIT).unwrap(), "22");
        assert_eq!(restored.display(0, 1, 2, LIMIT).unwrap(), "");
        assert_eq!(restored.display(0, 0, 4, LIMIT).unwrap(), "22");
        assert_eq!(restored.display(0, 1, 4, LIMIT).unwrap(), "");
        restored
            .edit(
                &[(1, 1_048_575, 0, "hit"), (1, 1_048_575, 1, "last")],
                LIMIT,
            )
            .unwrap();
        assert_eq!(restored.display(0, 1, 0, LIMIT).unwrap(), "last");
        assert_eq!(restored.display(0, 1, 2, LIMIT).unwrap(), "last");
        assert_eq!(restored.display(0, 1, 4, LIMIT).unwrap(), "last");
    }
}

#[test]
fn filter_horizontal_masks_keep_typed_values_and_budget_failures_atomic() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "yes"),
            (0, 0, 1, "no"),
            (0, 0, 16_383, "yes"),
            (0, 1, 0, "TRUE"),
            (0, 1, 16_383, "tail"),
            (0, 3, 0, "=FILTER(2:2,EXACT(1:1,\"yes\"))"),
        ],
        1_000_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 3, 0, LIMIT).unwrap(), "TRUE");
    assert_eq!(book.display(0, 3, 1, LIMIT).unwrap(), "tail");
    book.edit(&[(0, 3, 0, "=FILTER(2:2,1:1=\"YES\")")], 1_000_000)
        .unwrap();
    assert_eq!(book.display(0, 3, 0, LIMIT).unwrap(), "TRUE");
    assert_eq!(book.display(0, 3, 1, LIMIT).unwrap(), "tail");
    book.edit(
        &[(0, 3, 0, "=FILTER(2:2,(1:1=\"YES\")*(2:2<>\"\"))")],
        1_000_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 3, 0, LIMIT).unwrap(), "TRUE");
    assert_eq!(book.display(0, 3, 1, LIMIT).unwrap(), "tail");
    let saved = book.to_json();
    // Blank criteria really select every empty row; do not trim a full column.
    assert!(
        book.edit(&[(0, 5, 5, "=FILTER(D:D,EXACT(C:C,\"\"))")], 1_000_000)
            .is_err()
    );
    assert_eq!(book.to_json(), saved);
    assert!(
        book.edit(&[(0, 5, 5, "=FILTER(D:D,C:C=0)")], 1_000_000)
            .is_err()
    );
    assert_eq!(book.to_json(), saved);
    assert!(
        book.edit(&[(0, 5, 5, "=FILTER(D:D,(C:C=0)*(D:D=0))")], 1_000_000)
            .is_err()
    );
    assert_eq!(book.to_json(), saved);
    assert!(
        book.edit(&[(0, 5, 5, "=FILTER(D:D,EXACT(C:C,\"x\"))")], 100)
            .is_err()
    );
    assert_eq!(book.to_json(), saved);
}

#[test]
fn sortby_uses_multiple_stable_keys_and_preserves_typed_rows() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0,0,0,"=SORTBY({\"first\",TRUE;\"second\",FALSE;\"third\",TRUE;\"fourth\",FALSE},{\"B\";\"A\";\"A\";\"A\"},,{1;1;3;1},-1)")],LIMIT).unwrap();
    for (row, a, b) in [
        (0, "third", "TRUE"),
        (1, "second", "FALSE"),
        (2, "fourth", "FALSE"),
        (3, "first", "TRUE"),
    ] {
        assert_eq!(book.display(0, row, 0, LIMIT).unwrap(), a);
        assert_eq!(book.display(0, row, 1, LIMIT).unwrap(), b);
    }
}

#[test]
fn take_and_drop_slice_whole_columns_before_allocating_values() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "10"),
            (0, 1, 0, "20"),
            (0, 1_048_575, 0, "99"),
            (0, 0, 2, "=TAKE(A:A,2)"),
            (0, 0, 4, "=TAKE(A:A,-1)"),
            (0, 0, 6, "=DROP(A:A,1048575)"),
            (0, 0, 8, "=DROP(A:A,-1048574)"),
        ],
        100_000,
    )
    .unwrap();
    for (row, col, value) in [
        (0, 2, "10"),
        (1, 2, "20"),
        (0, 4, "99"),
        (0, 6, "99"),
        (0, 8, "10"),
        (1, 8, "20"),
    ] {
        assert_eq!(
            book.display(0, row, col, LIMIT).unwrap(),
            value,
            "{row},{col}"
        );
    }
}

#[test]
fn stack_pad_select_and_flatten_preserve_error_and_blank_distinctions() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=HSTACK({1;2},TRUE)"),
            (0, 4, 0, "=VSTACK({\"a\",\"b\"},FALSE)"),
            (0, 8, 0, "=CHOOSECOLS({1,2,3;4,5,6},-1,1,-1)"),
            (0, 12, 0, "=CHOOSEROWS({1,2;3,4;5,6},-1,1,-1)"),
            (0, 18, 0, "=TOROW(HSTACK({1;2},TRUE),2,TRUE)"),
            (0, 20, 0, "=TOCOL({1,2;3,4},0,TRUE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, v) in [
        (0, 1, "TRUE"),
        (1, 1, "#N/A"),
        (5, 0, "FALSE"),
        (5, 1, "#N/A"),
        (8, 0, "3"),
        (8, 1, "1"),
        (9, 2, "6"),
        (12, 0, "5"),
        (13, 1, "2"),
        (14, 1, "6"),
        (18, 0, "1"),
        (18, 1, "2"),
        (18, 2, "TRUE"),
        (20, 0, "1"),
        (21, 0, "3"),
        (22, 0, "2"),
        (23, 0, "4"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), v, "{r},{c}");
    }
    book.edit(
        &[
            (0, 0, 5, "'"),
            (0, 1, 5, "#N/A"),
            (0, 3, 5, "5"),
            (0, 0, 7, "=TOCOL(F1:F4,3)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 7, LIMIT).unwrap(), ""); // Empty text is not a blank cell.
    assert_eq!(book.display(0, 1, 7, LIMIT).unwrap(), "5");
}

#[test]
fn selected_rows_of_future_spill_recalculate_and_output_stays_derived() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=TAKE(C2:C4,2)"),
            (0, 4, 0, "=CHOOSECOLS(C2:D4,1)"),
            (0, 0, 2, "=SEQUENCE(4)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "2");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "3");
    assert_eq!(book.display(0, 6, 0, LIMIT).unwrap(), "4");
    let reopened = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    assert_eq!(reopened.sheets[0].cells.len(), 3);
    assert_eq!(reopened.display(0, 6, 0, LIMIT).unwrap(), "4");
    let reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(reopened.display(0, 1, 0, LIMIT).unwrap(), "3");
}

#[test]
fn sortby_keeps_signed_zero_ties_and_sorts_horizontal_records() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=SORTBY({\"first\";\"second\"},{0;-0})"),
            (0, 4, 0, "=SORTBY({\"C\",\"A\",\"B\"},{3,1,2})"),
            (0, 6, 0, "=SORTBY({2;1},D:D)"),
        ],
        100_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "first");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "second");
    assert_eq!(book.display(0, 4, 0, LIMIT).unwrap(), "A");
    assert_eq!(book.display(0, 4, 2, LIMIT).unwrap(), "C");
    assert_eq!(book.display(0, 6, 0, LIMIT).unwrap(), "#VALUE!");
}

#[test]
fn sparse_flatten_sees_late_spills_and_counts_empty_strings_as_values() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=TOCOL(D:D,3)"),
            (0, 0, 3, "=VSTACK(SEQUENCE(3),\"\",NA())"),
        ],
        100_000,
    )
    .unwrap();
    // A top-level source error aborts VSTACK; an error within an array can be skipped.
    assert_eq!(book.display(0, 0, 3, LIMIT).unwrap(), "#N/A");
    book.edit(&[(0, 0, 3, "=VSTACK(SEQUENCE(3),{\"\";#N/A})")], 100_000)
        .unwrap();
    for (r, v) in [(0, "1"), (1, "2"), (2, "3"), (3, "")] {
        assert_eq!(book.display(0, r, 0, LIMIT).unwrap(), v);
    }
    assert_eq!(book.input(0, 3, 0), "'");
    book.edit(&[(0, 6, 5, "=TOROW(D:D,3,TRUE)")], 100_000)
        .unwrap();
    assert_eq!(book.display(0, 6, 7, LIMIT).unwrap(), "3");
    assert_eq!(book.input(0, 6, 8), "'");
}

#[test]
fn shape_argument_errors_and_huge_counts_are_bounded_and_failed_edits_are_atomic() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=SEQUENCE(2)")], LIMIT).unwrap();
    let before = book.to_json();
    assert!(
        book.edit(
            &[(0, 0, 0, "=HSTACK(SEQUENCE(1000),SEQUENCE(1,1000))")],
            200_000
        )
        .is_err()
    );
    assert_eq!(book.to_json(), before);
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "2");
    let cases = [
        ("=TAKE({1;2},-1E300)", "1"),
        ("=DROP({1;2},1E300)", "#CALC!"),
        ("=CHOOSECOLS({1,2},-1E300)", "#VALUE!"),
        ("=TAKE({1;2},NA())", "#N/A"),
        ("=TOCOL({1;2},4)", "#VALUE!"),
        ("=TOROW({#N/A},2)", "#CALC!"),
        ("=DROP({1;2})", "#ERROR!"),
        ("=HSTACK()", "#ERROR!"),
        ("=TAKE({1;2},0)", "#CALC!"),
    ];
    for (formula, expected) in cases {
        book.edit(&[(0, 0, 3, formula)], 100_000).unwrap();
        assert_eq!(book.display(0, 0, 3, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn sparse_aggregates_see_children_when_evaluating_their_anchor_creates_a_spill() {
    for (formula, expected) in [
        ("=SUM(D:D)", "6"),
        ("=COUNTIF(D:D,\">0\")", "3"),
        ("=CONCAT(D:D)", "123"),
    ] {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, formula), (0, 0, 3, "=SEQUENCE(3)")], 100_000)
            .unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

// Starts with IronCalc test_implicit_intersection::return_of_array_spills
// (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT; LICENSE.IronCalc).
use super::Spreadsheet;
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn compact_aggregate_observation_counts_exceed_the_wasm_pointer_width() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Data").unwrap();
    book.edit(&[(1, 0, 0, "1")], LIMIT).unwrap();
    for count in [8, 9, 255] {
        let formula = format!(
            "=AVERAGE({})",
            std::iter::repeat_n("SIGN(Data!A:SR)", count)
                .collect::<Vec<_>>()
                .join(",")
        );
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        let actual = book
            .display(0, 0, 0, LIMIT)
            .unwrap()
            .parse::<f64>()
            .unwrap();
        assert!(
            (actual - 1. / 536_870_912.).abs() < 1e-22,
            "{count}: {actual}"
        );
    }
}

#[test]
fn mathematical_aggregates_keep_whole_columns_and_last_row_with_bounded_memory() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "1"),
            (0, 1, 0, "2"),
            (0, 2, 0, "3"),
            (0, 1, 3, "=SUM(SIN(A:A)"),
        ],
        100_000,
    )
    .unwrap();
    let expected = 1_f64.sin() + 2_f64.sin() + 3_f64.sin();
    assert!(
        (book
            .display(0, 1, 3, LIMIT)
            .unwrap()
            .parse::<f64>()
            .unwrap()
            - expected)
            .abs()
            < 1e-14
    );
    book.edit(&[(0, 1_048_575, 0, "4")], 100_000).unwrap();
    assert!(
        (book
            .display(0, 1, 3, LIMIT)
            .unwrap()
            .parse::<f64>()
            .unwrap()
            - expected
            - 4_f64.sin())
        .abs()
            < 1e-14
    );
    book.edit(
        &[
            (0, 3, 3, "=AVERAGE(SIGN(A:A))"),
            (0, 4, 3, "=SUMSQ(SIGN(A:A))"),
            (0, 5, 3, "=MAX(SIN(A:A))"),
            (0, 6, 3, "=MIN(SIN(A:A))"),
        ],
        100_000,
    )
    .unwrap();
    assert_eq!(
        book.display(0, 3, 3, LIMIT).unwrap(),
        "0.000003814697265625"
    );
    assert_eq!(book.display(0, 4, 3, LIMIT).unwrap(), "4");
}

#[test]
fn mathematical_aggregates_count_transformed_blanks_and_nested_functions() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=SUM(COS(B:B))"),
            (0, 1, 0, "=AVERAGE(COS(B:B))"),
            (0, 2, 0, "=PRODUCT(COS(B:B))"),
            (0, 3, 0, "=XOR(COS(B:B))"),
            (0, 4, 0, "=SUM(SIN(SIGN(B:B)))"),
        ],
        4_000_000,
    )
    .unwrap();
    for (row, want) in [(0, "1048576"), (1, "1"), (2, "1"), (3, "FALSE"), (4, "0")] {
        assert_eq!(book.display(0, row, 0, LIMIT).unwrap(), want);
    }
    book.edit(&[(0, 0, 1, "-1")], 4_000_000).unwrap();
    assert!(
        (book
            .display(0, 0, 0, LIMIT)
            .unwrap()
            .parse::<f64>()
            .unwrap()
            - (1048575. + 1_f64.cos()))
        .abs()
            < 1e-8
    );
}

#[test]
fn sparse_mathematical_aggregates_match_dense_evaluation_and_error_order() {
    for data in [
        vec!["0", "1", "-1", "0.5", "TRUE", "'2", "", ""],
        vec!["", "=NA()", "=1/0", "", "", "", "", ""],
        vec!["=\"\"", "text", "", "", "", "", "", ""],
        vec!["", "", "", "", "", "", "", ""],
        vec!["1", "2", "3", "4", "5", "6", "7", "8"],
    ] {
        let mut base = Spreadsheet::new();
        let edits: Vec<_> = data
            .iter()
            .enumerate()
            .map(|(i, v)| (0, i / 2, i % 2, *v))
            .collect();
        base.edit(&edits, LIMIT).unwrap();
        for function in [
            "SIN",
            "COS",
            "SIGN",
            "EXP",
            "LN",
            "ACOS",
            "COT",
            "FACTDOUBLE",
            "FISHER",
            "SIN(COS",
        ] {
            let call = |range: &str| {
                if function == "SIN(COS" {
                    format!("SIN(COS({range}))")
                } else {
                    format!("{function}({range})")
                }
            };
            for aggregate in [
                "SUM",
                "SUMSQ",
                "AVERAGE",
                "MIN",
                "MAX",
                "PRODUCT",
                "AND",
                "OR",
                "XOR",
                "GCD",
                "LCM",
                "MULTINOMIAL",
                "MEDIAN",
                "STDEV.P",
            ] {
                let mut book = Spreadsheet::from_json(&base.to_json(), LIMIT).unwrap();
                let sparse = format!("={aggregate}({})", call("A1:B4"));
                let dense = format!("={aggregate}({})", call("IF(TRUE,A1:B4)"));
                book.edit(&[(0, 0, 3, &sparse), (0, 0, 4, &dense)], LIMIT)
                    .unwrap();
                assert_eq!(
                    book.display(0, 0, 3, LIMIT).unwrap(),
                    book.display(0, 0, 4, LIMIT).unwrap(),
                    "{sparse} {data:?}"
                );
            }
        }
    }
}

#[test]
fn sparse_mathematical_aggregates_track_late_spills_and_reopen_files() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Data").unwrap();
    book.edit(
        &[(0, 0, 0, "=SUM(SIGN(Data!A:A))"), (1, 4, 0, "=SEQUENCE(3)")],
        100_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "3");
    for mut reopened in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        reopened
            .edit(&[(1, 4, 0, "=SEQUENCE(5)")], 100_000)
            .unwrap();
        assert_eq!(reopened.display(0, 0, 0, LIMIT).unwrap(), "5");
        reopened.edit(&[(1, 4, 0, "")], 100_000).unwrap();
        assert_eq!(reopened.display(0, 0, 0, LIMIT).unwrap(), "0");
    }
    let before = book.to_json();
    assert!(
        book.edit(
            &[
                (1, 0, 0, "changed"),
                (0, 1, 0, "=SUM(SIN(SEQUENCE(10000)))")
            ],
            1000
        )
        .is_err()
    );
    assert_eq!(book.to_json(), before);
    book.edit(&[(0, 0, 0, "=SUM(SIN(A:A))")], 100_000).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#CIRC!");
}

#[test]
fn sparse_mathematical_aggregates_support_rows_tables_names_and_scalar_fallbacks() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Data").unwrap();
    book.edit(
        &[
            (1, 1, 0, "-1"),
            (1, 1, 16383, "2"),
            (0, 0, 0, "=SUM(SIGN(Data!2:2))"),
        ],
        100_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "0");
    book.options.names.push(super::NamedExpression {
        name: "Amounts".into(),
        expression: "Data!2:2".into(),
        sheet: None,
        openformula: None,
        position: (0, 0, 0),
        compiled: None,
    });
    book.edit(&[(0, 0, 0, "=SUM(SIGN(Amounts))")], 100_000)
        .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "0");
    book.edit(
        &[(1, 0, 2, "Amount"), (1, 1, 2, "1"), (1, 2, 2, "-1")],
        100_000,
    )
    .unwrap();
    book.add_table(1, "Sales", [0, 2, 2, 2], LIMIT).unwrap();
    book.edit(&[(0, 1, 0, "=SUM(SIGN(Sales[Amount]))")], 100_000)
        .unwrap();
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "0");
    book.edit(&[(1, 2, 2, "2")], 100_000).unwrap();
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "2");
    for (source, want) in [
        ("=SUM(COS(0))", "1"),
        ("=SUM(SIGN({-1;0;2}))", "0"),
        ("=SUM(SIN(NA()))", "#N/A"),
        ("=SUM(SIN(#REF!))", "#REF!"),
        ("=SUM(COS(Data!Z1))", "1"),
        ("=SUM(SIGN(SEQUENCE(3)))", "3"),
    ] {
        book.edit(&[(0, 2, 0, source)], LIMIT).unwrap();
        assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), want, "{source}");
    }
}

#[test]
fn repeated_nonzero_math_values_preserve_compensated_summation_order() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, "-1"), (0, 499, 0, "1"), (0, 999, 0, "0.3")],
        LIMIT,
    )
    .unwrap();
    for aggregate in ["SUM", "AVERAGE", "SUMSQ", "PRODUCT"] {
        for function in ["COS", "EXP", "ACOS", "SECH"] {
            let sparse = format!("={aggregate}(SIN({function}(A1:A1000)),1e-10,-1e-10)");
            let dense = format!("={aggregate}(SIN({function}(IF(TRUE,A1:A1000))),1e-10,-1e-10)");
            book.edit(&[(0, 0, 3, &sparse), (0, 0, 4, &dense)], LIMIT)
                .unwrap();
            assert_eq!(
                book.display(0, 0, 3, LIMIT).unwrap(),
                book.display(0, 0, 4, LIMIT).unwrap(),
                "{sparse}"
            );
        }
    }
}

// IronCalc test_fn_row_column::whole_column_and_whole_row, unchanged values,
// plus the far worksheet boundaries and a budget too small for dense arrays.
#[test]
fn coordinate_extrema_cover_whole_axes_without_allocating_them() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Sheet2").unwrap();
    book.edit(
        &[
            (1, 0, 1, "a"),
            (1, 1, 1, "b"),
            (1, 3, 1, "c"),
            (1, 6, 3, "d"),
            (0, 0, 0, "=MAX(ROW(Sheet2!B:B))"),
            (0, 1, 0, "=MAX(COLUMN(Sheet2!7:7))"),
            (0, 2, 0, "=MAX((Sheet2!B:B<>\"\")*ROW(Sheet2!B:B))"),
            (0, 3, 0, "=MAX((Sheet2!7:7<>\"\")*COLUMN(Sheet2!7:7))"),
            (0, 4, 0, "=MIN(ROW(Sheet2!B:B))"),
            (0, 5, 0, "=MIN((Sheet2!B:B=\"\")*ROW(Sheet2!B:B))"),
            (0, 6, 0, "=MAX(ROW(Sheet2!B:B)*(Sheet2!B:B=\"\"))"),
        ],
        100_000,
    )
    .unwrap();
    for (r, want) in [
        (0, "1048576"),
        (1, "16384"),
        (2, "4"),
        (3, "4"),
        (4, "1"),
        (5, "0"),
        (6, "1048576"),
    ] {
        assert_eq!(book.display(0, r, 0, LIMIT).unwrap(), want);
    }
    book.edit(
        &[(1, 1_048_575, 1, "last"), (1, 6, 16_383, "last")],
        100_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), "1048576");
    assert_eq!(book.display(0, 3, 0, LIMIT).unwrap(), "16384");
    assert_eq!(book.display(0, 6, 0, LIMIT).unwrap(), "1048575");
}

#[test]
fn coordinate_extrema_match_dense_arrays_for_masks_broadcasts_and_errors() {
    for data in [
        ["-3", "2", "", "4", "0", "-1", "", "5"],
        ["TRUE", "FALSE", "'2", "'3%", "", "=\"\"", "text", "1"],
        ["", "=NA()", "", "=1/0", "2", "", "", ""],
        ["", "", "", "", "", "", "", ""],
    ] {
        let mut base = Spreadsheet::new();
        let edits: Vec<_> = data
            .iter()
            .enumerate()
            .map(|(i, v)| (0, i / 2, i % 2, *v))
            .collect();
        base.edit(&edits, LIMIT).unwrap();
        for coordinate in ["ROW(C4:C7)", "COLUMN(C4:D7)", "ROW(C4)", "COLUMN(C4)"] {
            for mask in [
                "A1:B4",
                "A1:A4",
                "A1:B1",
                "(A1:B4<>\"\")",
                "(A1:A4=\"\")",
                "(A1:A4>0)+(B1:B4<0)",
                "2",
                "-2",
                "0",
                "NA()",
                "(1/A1:A4)",
            ] {
                for aggregate in ["MIN", "MAX"] {
                    for reversed in [false, true] {
                        let expression = |dense: bool| {
                            let coordinate = if dense {
                                format!("IF(TRUE,{coordinate})")
                            } else {
                                coordinate.into()
                            };
                            if reversed {
                                format!("={aggregate}({coordinate}*{mask})")
                            } else {
                                format!("={aggregate}({mask}*{coordinate})")
                            }
                        };
                        let mut book = Spreadsheet::from_json(&base.to_json(), LIMIT).unwrap();
                        book.edit(
                            &[(0, 0, 5, &expression(false)), (0, 0, 6, &expression(true))],
                            LIMIT,
                        )
                        .unwrap();
                        assert_eq!(
                            book.display(0, 0, 5, LIMIT).unwrap(),
                            book.display(0, 0, 6, LIMIT).unwrap(),
                            "{} {data:?}",
                            expression(false)
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn coordinate_extrema_preserve_spills_errors_and_file_roundtrips() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Data").unwrap();
    book.edit(
        &[
            (0, 0, 0, "=MAX((Data!B:B<>\"\")*ROW(Data!B:B))"),
            (1, 8, 1, "=SEQUENCE(3)"),
        ],
        100_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "11");
    for mut reopened in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        reopened
            .edit(&[(1, 8, 1, "=SEQUENCE(5)")], 100_000)
            .unwrap();
        assert_eq!(reopened.display(0, 0, 0, LIMIT).unwrap(), "13");
        reopened.edit(&[(1, 20, 1, "=NA()")], 100_000).unwrap();
        assert_eq!(reopened.display(0, 0, 0, LIMIT).unwrap(), "#N/A");
        reopened
            .edit(&[(1, 20, 1, ""), (1, 8, 1, "=\"\"")], 100_000)
            .unwrap();
        assert_eq!(reopened.display(0, 0, 0, LIMIT).unwrap(), "0");
    }
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 1, 0, "=MAX(SEQUENCE(10000)*ROW(A1:A10000))")], 1000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
    book.edit(&[(0, 0, 0, "=MAX((A:A<>\"\")*ROW(A:A))")], 100_000)
        .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#CIRC!");
}

#[test]
fn legacy_coordinate_formulas_do_not_allocate_unused_array_elements() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "D:D"), (0, 0, 1, "=ROW(A1)")], LIMIT)
        .unwrap();
    let mut cell = book.sheets[0].cells[&(0, 1)].clone();
    cell.legacy_formula = true;
    cell.openformula = None;
    cell.formula_display = None;
    cell.formula = Some("ROW(INDIRECT(A1))".into());
    book.replace_cells(vec![(0, 0, 1, Some(cell))], 100_000)
        .unwrap();
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "1");
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        restored.edit(&[(0, 0, 0, "D7:D1048576")], 100_000).unwrap();
        assert_eq!(restored.display(0, 0, 1, LIMIT).unwrap(), "7");
        assert_eq!(restored.display(0, 1, 1, LIMIT).unwrap(), "");
        // Editing the legacy formula activates modern dynamic-array behavior.
        restored
            .edit(
                &[(0, 0, 0, "D7:D9"), (0, 0, 1, "=ROW(INDIRECT(A1))")],
                100_000,
            )
            .unwrap();
        for (r, want) in [(0, "7"), (1, "8"), (2, "9")] {
            assert_eq!(restored.display(0, r, 1, LIMIT).unwrap(), want);
        }
    }
}

#[test]
fn coordinate_extrema_reuse_lambda_and_let_reference_bindings() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Data").unwrap();
    book.edit(
        &[
            (1, 4, 1, "last"),
            (
                0,
                0,
                0,
                "=LAMBDA(range,MAX((range<>\"\")*ROW(range)))(Data!B:B)",
            ),
            (0, 1, 0, "=LET(range,Data!B:B,MAX(ROW(range)))"),
            (0, 2, 0, "=LET(range,3,MAX(ROW(range)))"),
        ],
        100_000,
    )
    .unwrap();
    for (r, want) in [(0, "5"), (1, "1048576"), (2, "Err:504")] {
        assert_eq!(book.display(0, r, 0, LIMIT).unwrap(), want);
    }
    book.edit(&[(1, 1_048_575, 1, "last")], 100_000).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "1048576");
}

#[test]
fn named_coordinate_lambdas_share_the_bounded_aggregate_path() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Data").unwrap();
    book.options.names.push(super::NamedExpression {
        name: "LastRow".into(),
        expression: "=LAMBDA(range,SUMPRODUCT(MAX((range<>\"\")*ROW(range))))".into(),
        sheet: None,
        openformula: None,
        position: (0, 0, 0),
        compiled: None,
    });
    book.edit(
        &[(1, 4, 1, "last"), (0, 0, 0, "=LastRow(Data!B:B)")],
        100_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "5");
    let mut reopened = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    reopened
        .edit(&[(1, 1_048_575, 1, "last")], 100_000)
        .unwrap();
    assert_eq!(reopened.display(0, 0, 0, LIMIT).unwrap(), "1048576");
}

// Adapted from IronCalc math_and_trigonometry/{sumproduct,matrix,mmult}.rs and
// their test files (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc).
// Argument cases also follow Univer math/{sumproduct,mmult,mdeterm,minverse,munit}
// tests (4767b3b309467c283bbd52b725536ca73861e0fc, Apache-2.0, LICENSE.Univer).
use super::{Spreadsheet, Value};
const LIMIT: usize = 10_000_000;
fn number(book: &Spreadsheet, r: usize, c: usize) -> f64 {
    match book.cell(0, r, c).and_then(|cell| cell.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!("{}", book.display(0, r, c, LIMIT).unwrap()),
    }
}
fn close(a: f64, b: f64) {
    assert!((a - b).abs() <= b.abs().max(1e-300) * 1e-10, "{a} != {b}");
}

#[test]
fn sumproduct_preserves_shape_and_distinguishes_coercion_from_arithmetic() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=SUMPRODUCT({1,2,3},{4,5,6})", "32"),
        ("=SUMPRODUCT({1,2;3,4},{5,6;7,8})", "70"),
        ("=SUMPRODUCT({1,2},{3,4},{5,6})", "63"),
        ("=SUMPRODUCT({1,2,3})", "6"),
        ("=SUMPRODUCT({2,\"4\",TRUE},{3,5,7})", "6"),
        ("=SUMPRODUCT({2,\"4\",TRUE}*{3,5,7})", "33"),
        ("=SUMPRODUCT({1;2},{1;2;3})", "#VALUE!"),
        ("=SUMPRODUCT({1;2;3},{1;2})", "#VALUE!"),
        ("=SUMPRODUCT({1,2},{1,2,3})", "#VALUE!"),
        ("=SUMPRODUCT({1,2,3},{1,2})", "#VALUE!"),
        ("=SUMPRODUCT(2,{1,2})", "#VALUE!"),
        ("=SUMPRODUCT(0,NA())", "#N/A"),
        ("=SUMPRODUCT({0,0},{1,#NUM!})", "#NUM!"),
        ("=SUMPRODUCT()", "#ERROR!"),
        ("=SUMPRODUCT(1e300,1e300)", "#NUM!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn sumproduct_visits_only_stored_cells_but_does_not_skip_errors_or_future_spills() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=SUMPRODUCT(D:D,E:E)"),
            (0, 0, 3, "=SEQUENCE(3)"),
            (0, 0, 4, "5"),
            (0, 1, 4, "6"),
            (0, 2, 4, "7"),
            (0, 1_048_575, 3, "10"),
            (0, 1_048_575, 4, "20"),
            (0, 0, 1, "=SUMPRODUCT(D2:D1048576,E1:E1048575)"),
        ],
        100_000,
    )
    .unwrap();
    close(number(&book, 0, 0), 238.);
    close(number(&book, 0, 1), 28.);
    book.edit(&[(0, 100, 4, "=NA()")], 100_000).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#N/A");
    book.edit(&[(0, 100, 4, "")], 100_000).unwrap();
    close(number(&book, 0, 0), 238.);
}

#[test]
fn matrix_multiplication_handles_rectangles_and_all_transpose_combinations() {
    let mut book = Spreadsheet::new();
    for formula in [
        "=MMULT({1,2,3;4,5,6},{7,8;9,10;11,12})",
        "=MMULT(TRANSPOSE({1,4;2,5;3,6}),{7,8;9,10;11,12})",
        "=MMULT({1,2,3;4,5,6},TRANSPOSE({7,9,11;8,10,12}))",
        "=MMULT(TRANSPOSE({1,4;2,5;3,6}),TRANSPOSE(TRANSPOSE(TRANSPOSE({7,9,11;8,10,12}))))",
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        for (r, c, n) in [(0, 0, 58.), (0, 1, 64.), (1, 0, 139.), (1, 1, 154.)] {
            close(number(&book, r, c), n);
        }
    }
}

#[test]
fn matrix_invalid_arguments_propagate_the_first_visible_error() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 3, "1"),
            (0, 0, 4, "text"),
            (0, 1, 3, "=1/0"),
            (0, 1, 4, "4"),
        ],
        LIMIT,
    )
    .unwrap();
    for (formula, error) in [
        ("=MMULT(D1:E2,{1,2;3,4})", "#VALUE!"),
        ("=MMULT(TRANSPOSE(D1:E2),{1,2;3,4})", "#DIV/0!"),
        ("=MMULT({1,2;3,4},TRANSPOSE(D1:E2))", "#DIV/0!"),
        ("=MMULT({1,2},{1;2;3})", "#VALUE!"),
        ("=MMULT(,)", "#VALUE!"),
        ("=MMULT(1)", "#ERROR!"),
        ("=MMULT(TRUE,1)", "#VALUE!"),
        ("=MMULT(\"1\",1)", "#VALUE!"),
        ("=MMULT(1e300,1e300)", "#NUM!"),
        ("=MDETERM({1,2,3;4,5,6})", "#VALUE!"),
        ("=MINVERSE({1,2;2,4})", "#NUM!"),
        ("=MDETERM(TRUE)", "#VALUE!"),
        ("=MINVERSE(Z1)", "#VALUE!"),
        ("=MDETERM(NA())", "#N/A"),
        ("=MINVERSE({1,#REF!;2,3})", "#REF!"),
        ("=MUNIT(0)", "#VALUE!"),
        ("=MUNIT(-1)", "#VALUE!"),
        ("=MUNIT(\"text\")", "#VALUE!"),
        ("=MUNIT(NA())", "#N/A"),
        ("=MUNIT(1000000)", "#VALUE!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), error, "{formula}");
    }
}

#[test]
fn determinant_and_inverse_keep_small_pivots_and_extreme_finite_scales() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=MDETERM({1,2;3,4})", -2.),
        ("=MDETERM({0,2;3,4})", -6.),
        ("=MDETERM({1,2;2,4})", 0.),
        ("=MDETERM({1e-100,0;0,1e-100})", 1e-200),
        (
            "=MDETERM({1e200,0,0,0;0,1e200,0,0;0,0,1e-200,0;0,0,0,1e-200})",
            1.,
        ),
        ("=MINVERSE(1e-200)", 1e200),
        ("=MDETERM(MUNIT(3))", 1.),
        ("=MUNIT(TRUE)", 1.),
        ("=MUNIT(\"1.9\")", 1.),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        if expected == 0. {
            assert_eq!(number(&book, 0, 0), 0.);
        } else {
            close(number(&book, 0, 0), expected);
        }
    }
    book.edit(&[(0, 0, 0, "=MINVERSE({1,2;3,4})")], LIMIT)
        .unwrap();
    for (r, c, n) in [(0, 0, -2.), (0, 1, 1.), (1, 0, 1.5), (1, 1, -0.5)] {
        close(number(&book, r, c), n);
    }
    book.edit(&[(0, 0, 0, "=MINVERSE({1e308,1e-200;0,1e-200})")], LIMIT)
        .unwrap();
    assert!((number(&book, 0, 1) + 1e-308).abs() < 1e-320);
    book.edit(&[(0, 0, 0, "=MINVERSE({1e308,1e308;0,1e-200})")], LIMIT)
        .unwrap();
    close(number(&book, 0, 1), -1e200);
    book.edit(&[(0, 0, 0, "=MINVERSE({1e308,1e308;1e308,-1e308})")], LIMIT)
        .unwrap();
    for (r, c, n) in [
        (0, 0, 5e-309),
        (0, 1, 5e-309),
        (1, 0, 5e-309),
        (1, 1, -5e-309),
    ] {
        assert!((number(&book, r, c) - n).abs() < 1e-320);
    }
}

#[test]
fn multiplying_an_inverse_recovers_identity_and_recalculates_after_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "4"),
            (0, 0, 1, "7"),
            (0, 1, 0, "2"),
            (0, 1, 1, "6"),
            (0, 0, 3, "=MINVERSE(A1:B2)"),
            (0, 4, 0, "=ROUND(MMULT(A1:B2,D1#),10)"),
            (0, 4, 3, "=SUMPRODUCT(A1:B2,A1:B2)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut book in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, c, n) in [(4, 0, 1.), (4, 1, 0.), (5, 0, 0.), (5, 1, 1.), (4, 3, 105.)] {
            assert_eq!(number(&book, r, c), n);
        }
        close(number(&book, 0, 3), 0.6);
        book.edit(&[(0, 0, 0, "5")], LIMIT).unwrap();
        close(number(&book, 0, 3), 0.375);
        assert_eq!(number(&book, 4, 0), 1.);
        assert_eq!(number(&book, 4, 3), 114.);
    }
}

#[test]
fn matrix_allocations_and_cubic_work_are_charged_before_execution() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=MUNIT(2)")], LIMIT).unwrap();
    let before = book.to_json();
    for formula in [
        "=MUNIT(10000)",
        "=MINVERSE(MUNIT(100))",
        "=MMULT(MUNIT(100),MUNIT(100))",
    ] {
        assert!(
            book.edit(&[(0, 0, 0, formula)], 50_000).is_err(),
            "{formula}"
        );
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn matrix_cubic_work_is_bounded_even_when_input_and_output_fit() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=MUNIT(64)")], 1_000_000).unwrap();
    let before = book.to_json();
    for formula in ["=MINVERSE(MUNIT(64))", "=MMULT(MUNIT(64),MUNIT(64))"] {
        assert!(
            book.edit(&[(0, 0, 0, formula)], 1_000_000).is_err(),
            "{formula}"
        );
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn matrix_inverse_residuals_and_transposed_products_match_independent_oracles() {
    let mut book = Spreadsheet::new();
    let mut seed = 7u64;
    for n in 2..=8 {
        let mut matrix = vec![vec![0.; n]; n];
        for (r, row) in matrix.iter_mut().enumerate() {
            for (c, value) in row.iter_mut().enumerate() {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                *value = ((seed >> 32) % 17) as f64 - 8.;
                if r == c {
                    *value += 100.;
                }
            }
        }
        let literal = format!(
            "{{{}}}",
            matrix
                .iter()
                .map(|r| r.iter().map(f64::to_string).collect::<Vec<_>>().join(","))
                .collect::<Vec<_>>()
                .join(";")
        );
        book.edit(&[(0, 0, 0, &format!("=MINVERSE({literal})"))], LIMIT)
            .unwrap();
        for r in 0..n {
            for c in 0..n {
                let actual = (0..n)
                    .map(|k| matrix[r][k] * number(&book, k, c))
                    .sum::<f64>();
                assert!(
                    (actual - f64::from(r == c)).abs() < 1e-12,
                    "n={n} [{r},{c}]: {actual}"
                );
            }
        }
        for left_transpose in [false, true] {
            for right_transpose in [false, true] {
                let left = if left_transpose {
                    format!("TRANSPOSE({literal})")
                } else {
                    literal.clone()
                };
                let right = if right_transpose {
                    format!("TRANSPOSE({literal})")
                } else {
                    literal.clone()
                };
                book.edit(&[(0, 0, 0, &format!("=MMULT({left},{right})"))], LIMIT)
                    .unwrap();
                for r in 0..n {
                    for c in 0..n {
                        let expected = (0..n)
                            .map(|k| {
                                let x = if left_transpose {
                                    matrix[k][r]
                                } else {
                                    matrix[r][k]
                                };
                                let y = if right_transpose {
                                    matrix[c][k]
                                } else {
                                    matrix[k][c]
                                };
                                x * y
                            })
                            .sum::<f64>();
                        assert_eq!(number(&book, r, c), expected);
                    }
                }
            }
        }
    }
}

#[test]
fn sparse_full_sheet_products_preserve_distant_cell_positions() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Summary").unwrap();
    book.edit(
        &[
            (0, 0, 0, "2"),
            (0, 262144, 0, "3"),
            (1, 0, 0, "=SUMPRODUCT(Sheet1!A1:XFD1048576)"),
            (
                1,
                1,
                0,
                "=SUMPRODUCT(Sheet1!A1:XFD1048576,Sheet1!A1:XFD1048576)",
            ),
        ],
        100_000,
    )
    .unwrap();
    assert_eq!(book.display(1, 0, 0, LIMIT).unwrap(), "5");
    assert_eq!(book.display(1, 1, 0, LIMIT).unwrap(), "13");
}

// All eight test groups for each function from Univer math/{sumx2my2,
// sumx2py2,sumxmy2}/__tests__/index.spec.ts (4767b3b, Apache-2.0).
#[test]
fn squared_pairs_match_upstream_scalar_and_mixed_array_cases() {
    for (name, normal, text, array) in [
        ("SUMX2MY2", "-3", "5", "28"),
        ("SUMX2PY2", "5", "13", "56"),
        ("SUMXMY2", "1", "25", "8"),
    ] {
        let transposed = if name == "SUMX2PY2" { "10" } else { "0" };
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 7, "1"),
                (0, 1, 7, "test"),
                (0, 1, 8, "2"),
                (0, 2, 7, "3"),
                (0, 2, 8, "TRUE"),
                (0, 1, 25, "=#N/A"),
            ],
            LIMIT,
        )
        .unwrap();
        for (args, expected) in [
            ("1,2", normal),
            (r#""-3",2"#, text),
            (r#"1,"test""#, "#DIV/0!"),
            ("1,TRUE", "#DIV/0!"),
            ("1,FALSE", "#DIV/0!"),
            ("1,Z1", "#VALUE!"),
            ("1,#NAME?", "#NAME?"),
            ("Z1,Z2", "#N/A"),
            (r#""text",Z2"#, "#N/A"),
            ("TRUE,Z1", "#VALUE!"),
            ("1,{1,0;0,#VALUE!}", "#N/A"),
            ("{1,2,3;4,5,6},H1:I3", array),
            ("", "#ERROR!"),
            ("1", "#ERROR!"),
            ("1,2,3", "#ERROR!"),
            ("{1,2},TRANSPOSE({1;2})", transposed),
        ] {
            let formula = format!("={name}({args})");
            book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
        }
    }
}

#[test]
fn squared_pairs_keep_sparse_coordinates_errors_and_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=SUMX2MY2(D:D,E:E)"),
            (0, 0, 1, "=SUMX2PY2(D:D,E:E)"),
            (0, 0, 2, "=SUMXMY2(D:D,E:E)"),
            (0, 0, 3, "=SEQUENCE(3)"),
            (0, 0, 4, "5"),
            (0, 1, 4, "6"),
            (0, 2, 4, "7"),
            (0, 1_048_575, 3, "10"),
            (0, 1_048_575, 4, "20"),
        ],
        100_000,
    )
    .unwrap();
    for (col, expected) in [-396., 624., 148.].iter().enumerate() {
        close(number(&book, 0, col), *expected);
    }
    book.edit(&[(0, 1_048_575, 4, "12")], 100_000).unwrap();
    for (col, expected) in [-140., 368., 52.].iter().enumerate() {
        close(number(&book, 0, col), *expected);
    }
    let restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for copy in [&restored, &excel] {
        for (col, expected) in [-140., 368., 52.].iter().enumerate() {
            close(number(copy, 0, col), *expected);
        }
    }
    book.edit(&[(0, 100, 4, "=NA()")], 100_000).unwrap();
    for col in 0..3 {
        assert_eq!(book.display(0, 0, col, LIMIT).unwrap(), "#N/A");
    }
    for (formula, expected) in [
        ("=SUMX2MY2(1e308,1e308)", "0"),
        ("=SUMX2MY2(1e308,-1e308)", "0"),
        ("=SUMXMY2(1e308,1e308)", "0"),
        ("=SUMXMY2(1e308,-1e308)", "#NUM!"),
        ("=SUMX2PY2(1e308,1e308)", "#NUM!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

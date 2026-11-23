// Cases adapted from IronCalc statistical functions (f936620, MIT) and Univer
// statistical tests (4767b3b, Apache-2.0); see LICENSE.IronCalc / LICENSE.Univer.
use super::{Spreadsheet, Value};
const LIMIT: usize = 10_000_000;
fn number(book: &Spreadsheet, row: usize, col: usize) -> f64 {
    match book.cell(0, row, col).and_then(|c| c.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!(
            "{}: {}",
            book.input(0, row, col),
            book.display(0, row, col, LIMIT).unwrap()
        ),
    }
}
fn near(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= expected.abs().max(1e-300) * 1e-12,
        "{actual} != {expected}"
    );
}
#[test]
fn order_statistics_upstream_examples_and_legacy_aliases() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=PERCENTILE.INC({1,2,3,4,5,6,7,8,9,10},0.3)", 3.7),
        ("=PERCENTILE({1,2,3,4},0.25)", 1.75),
        ("=PERCENTILE.EXC({1,2,3,4},0.25)", 1.25),
        ("=QUARTILE({1,2,3,4},1.9)", 1.75),
        ("=QUARTILE.INC({1,2,3,4,5},2)", 3.),
        ("=QUARTILE.EXC({1,2,3,4},3)", 3.75),
        ("=MEDIAN(1,6,3,2)", 2.5),
        ("=LARGE({1,3,4,2},2)", 3.),
        ("=SMALL({1,3,4,2},2)", 2.),
        ("=TRIMMEAN({1,2,3,4,5,6,7,8,9,100},0.2)", 5.5),
        ("=TRIMMEAN({1,2,3,4,100},0.39)", 22.),
        ("=MODE({4,2,4,2,8})", 4.),
        ("=MODE.SNGL({1,2,3;2,3,4;4,5,6})", 2.),
        ("=RANK(3,{5,3,3,1})", 2.),
        ("=RANK.EQ(3,{5,3,3,1},1)", 2.),
        ("=RANK.AVG(3,{5,3,3,1})", 2.5),
        ("=RANK.AVG(5,{5,3,3,1},-1)", 4.),
        ("=PERCENTRANK({1,2,3,4,5},3)", 0.5),
        ("=PERCENTRANK.INC({1,2,3,4},2)", 0.333),
        ("=PERCENTRANK.EXC({1,2,3,4,5},3)", 0.5),
        ("=PERCENTRANK.INC({1,2,2,4},2)", 0.333),
        ("=PERCENTRANK.INC({1,2,2,4},3)", 0.833),
        ("=PERCENTRANK.EXC({5},5)", 0.5),
        ("=PERCENTRANK.INC({1,2,3,4},2,1E100)", 1. / 3.),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(number(&book, 0, 0), expected);
    }
}
#[test]
fn order_statistics_errors_and_empty_data() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=PERCENTILE.INC({1,2},-0.01)", "#NUM!"),
        ("=PERCENTILE.EXC({1,2,3,4},0.19)", "#NUM!"),
        ("=PERCENTILE.EXC({1,2,3,4},0.81)", "#NUM!"),
        ("=PERCENTILE.INC(B1:B4,0.5)", "#NUM!"),
        ("=PERCENTILE.INC({1,#N/A},0.5)", "#N/A"),
        ("=QUARTILE.INC({1,2},-0.1)", "#NUM!"),
        ("=QUARTILE.EXC({1,2},0)", "#NUM!"),
        ("=QUARTILE.INC({1,2},5)", "#NUM!"),
        ("=TRIMMEAN({1,2},1)", "#NUM!"),
        ("=TRIMMEAN(B1:B4,0)", "#NUM!"),
        ("=MODE.SNGL({1,2,3})", "#N/A"),
        ("=MODE.MULT({TRUE,FALSE,\"text\"})", "#N/A"),
        ("=MODE(1,1,NA())", "#N/A"),
        ("=MODE(1,1,\"bad\")", "#VALUE!"),
        ("=MEDIAN(B1:B4)", "#NUM!"),
        ("=MEDIAN(1,\"bad\")", "#VALUE!"),
        ("=RANK.EQ(2,{1,3})", "#N/A"),
        ("=RANK.AVG(1,{1,#REF!})", "#REF!"),
        ("=SMALL({1,2},0)", "#NUM!"),
        ("=LARGE({1,2},1E100)", "#NUM!"),
        ("=PERCENTRANK.INC({1,2},3)", "#N/A"),
        ("=PERCENTRANK.INC({1},1)", "#N/A"),
        ("=PERCENTRANK.EXC(B1:B3,1)", "#N/A"),
        ("=PERCENTRANK.INC({1,2},1,0.9)", "#NUM!"),
        ("=FREQUENCY({1,2},{1,#DIV/0!})", "#DIV/0!"),
        ("=PERCENTILE.INC(1)", "#ERROR!"),
        ("=MODE()", "#ERROR!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}
#[test]
fn order_statistics_reference_coercion_and_sparse_whole_columns() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "1"),
            (0, 1, 0, "'100"),
            (0, 2, 0, "=TRUE()"),
            (0, 3, 0, "text"),
            (0, 1_048_575, 0, "3"),
            (0, 0, 2, "=MEDIAN(A:A)"),
            (0, 1, 2, "=PERCENTILE.INC(A:A,0.5)"),
            (0, 2, 2, "=MEDIAN(TRUE,\"3\",5)"),
            (0, 3, 2, "=MEDIAN({TRUE,\"3\",5})"),
            (0, 4, 2, "=LARGE(A1,1)"),
            (0, 5, 2, "=PERCENTILE.INC(FALSE,0.5)"),
            (0, 6, 2, "=FREQUENCY(A:A,D:D)"),
        ],
        40_000,
    )
    .unwrap();
    for (r, expected) in [2., 2., 3., 5., 1., 0., 2.].into_iter().enumerate() {
        near(number(&book, r, 2), expected);
    }
    book.edit(&[(0, 1, 0, "=1/0")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "#DIV/0!");
}
#[test]
fn order_statistics_modes_preserve_first_encounter_and_merge_signed_zero() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=MODE.MULT({4,2,4;2,0,0})"),
            (0, 0, 2, "=MODE.SNGL(-0,0,3)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, expected) in [4., 2., 0.].into_iter().enumerate() {
        near(number(&book, r, 0), expected);
    }
    near(number(&book, 0, 2), 0.);
    book.edit(&[(0, 0, 0, "=MODE.MULT({4,2,4;2,2,0})")], LIMIT)
        .unwrap();
    near(number(&book, 0, 0), 2.);
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "");
    assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), "");
}
#[test]
fn order_statistics_frequency_unsorted_duplicate_and_empty_bins() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=FREQUENCY({1,2,3,4,5,6},{4,2,4})"),
            (0, 0, 2, "=FREQUENCY(D1:D10,{4,2,4})"),
            (0, 5, 0, "=FREQUENCY({1,2,3},D1:D10)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, expected) in [2., 2., 0., 2.].into_iter().enumerate() {
        near(number(&book, r, 0), expected);
        near(number(&book, r, 2), 0.);
    }
    near(number(&book, 5, 0), 3.);
}
#[test]
fn order_statistics_parameters_broadcast_with_per_element_errors() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (
                0,
                0,
                0,
                "=PERCENTILE.INC({1,2,3,4,5,6,7,8,9,10},{0.09,0.5,3})",
            ),
            (0, 2, 0, "=PERCENTRANK.INC({1,2,3,4},{2;3},{1,3})"),
            (0, 5, 0, "=RANK.AVG({3;5},{5,3,3,1},{0,1})"),
        ],
        LIMIT,
    )
    .unwrap();
    near(number(&book, 0, 0), 1.81);
    near(number(&book, 0, 1), 5.5);
    assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "#NUM!");
    for (r, expected) in [[0.3, 0.333], [0.6, 0.666]].iter().enumerate() {
        for (c, n) in expected.iter().enumerate() {
            near(number(&book, r + 2, c), *n);
        }
    }
    for (r, expected) in [[2.5, 2.5], [1., 4.]].iter().enumerate() {
        for (c, n) in expected.iter().enumerate() {
            near(number(&book, r + 5, c), *n);
        }
    }
}
#[test]
fn order_statistics_extreme_interpolation_and_compensated_means() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=MEDIAN(1E308,1E308)", 1e308),
        ("=MEDIAN(-1E308,1E308)", 0.),
        ("=PERCENTILE.INC({-1E308,1E308},0.75)", 5e307),
        ("=PERCENTILE.EXC({-1E308,1E308},0.5)", 0.),
        ("=PERCENTRANK.INC({-1E308,1E308},5E307)", 0.75),
        ("=TRIMMEAN({1E308,1E308},0)", 1e308),
        ("=TRIMMEAN({-1E308,1,1E308},0)", 1. / 3.),
        ("=TRIMMEAN({-1E308,-1E308,1,1E308,1E308},0)", 0.2),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(number(&book, 0, 0), expected);
    }
}
#[test]
fn order_statistics_limits_rollback_without_large_allocations() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "42")], LIMIT).unwrap();
    let before = book.to_json();
    for formula in [
        "=MEDIAN(SEQUENCE(1000000))",
        "=MODE.MULT(SEQUENCE(1000000))",
        "=FREQUENCY(1,SEQUENCE(1000000))",
        "=PERCENTILE.INC({1,2},SEQUENCE(1000000))",
        "=TRIMMEAN(SEQUENCE(1000000),0.2)",
    ] {
        assert!(
            book.edit(&[(0, 0, 0, formula)], 10000).is_err(),
            "{formula}"
        );
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn trimmed_means_remain_finite_at_float_boundaries() {
    let mut book = Spreadsheet::new();
    for n in [3, 6, 7, 11, 64, 100] {
        for sign in [1., -1.] {
            let extreme = sign * f64::MAX;
            let values = std::iter::repeat_n(extreme.to_string(), n)
                .collect::<Vec<_>>()
                .join(",");
            let formula = format!("=TRIMMEAN({{{values}}},0)");
            book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            assert_eq!(number(&book, 0, 0), extreme);
        }
    }
    book.edit(
        &[(
            0,
            0,
            0,
            "=TRIMMEAN(HSTACK(1E-300/1E23,1E-300/1E23,1E-300/1E23),0)",
        )],
        LIMIT,
    )
    .unwrap();
    assert_eq!(number(&book, 0, 0), 1e-323);
}
#[test]
fn order_statistics_table_roundtrips_and_spill_recalculation() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Score"),
            (0, 1, 0, "1"),
            (0, 2, 0, "2"),
            (0, 3, 0, "2"),
            (0, 4, 0, "5"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Scores", [0, 0, 4, 0], LIMIT).unwrap();
    book.edit(
        &[
            (0, 0, 2, "=PERCENTILE.INC(Scores[Score],{0,0.5,1})"),
            (0, 2, 2, "=MODE.MULT(Scores[Score])"),
            (0, 4, 2, "=FREQUENCY(Scores[Score],{2,4})"),
            (0, 0, 6, "=MEDIAN(C1#)"),
            (0, 1, 6, "=SUM(C5#)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(number(&restored, 0, 6), 2.);
        near(number(&restored, 1, 6), 4.);
        restored.edit(&[(0, 3, 0, "4")], LIMIT).unwrap();
        near(number(&restored, 0, 6), 3.);
        assert_eq!(restored.display(0, 2, 2, LIMIT).unwrap(), "#N/A");
        near(number(&restored, 4, 2), 2.);
        near(number(&restored, 5, 2), 1.);
        near(number(&restored, 6, 2), 1.);
    }
}

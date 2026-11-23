// Adapted from IronCalc f936620 mathematical/test_seriessum.rs (MIT) and
// Univer 4767b3b math/seriessum (Apache-2.0). See the bundled licenses.
use super::{Spreadsheet, Value};
const LIMIT: usize = 20_000_000;

fn near(book: &Spreadsheet, row: usize, col: usize, expected: f64) {
    let Some(Value::Number(n)) = book.cell(0, row, col).and_then(|c| c.value.clone()) else {
        panic!("{row},{col}: {}", book.display(0, row, col, LIMIT).unwrap());
    };
    assert!(
        (n - expected).abs() <= expected.abs() * 2e-12,
        "{n} != {expected}"
    );
}

#[test]
fn series_upstream_values_and_power_domains() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=SERIESSUM(2,1,1,{1,2,3})", 34.),
        ("=SERIESSUM(0.5,0,1,{1,1,1,1})", 1.875),
        ("=SERIESSUM(3,2,0,5)", 45.),
        ("=SERIESSUM(1,0,1,{1,1,1})", 3.),
        ("=SERIESSUM(2,0,1,{1,2,3})", 17.),
        ("=SERIESSUM(0.5,1,2,{2,2,2})", 1.3125),
        ("=SERIESSUM(-1,0,2,{1,2,3})", 6.),
        (
            "=SERIESSUM(0.785398163,0,2,{1,-0.5,0.041666667,-0.001388889})",
            0.707103215205,
        ),
        (
            "=SERIESSUM(0.785398163,-1,2,{1,-0.5,0.041666667,-0.001388889})",
            0.900311776264,
        ),
        (
            "=SERIESSUM(0.785398163,\"1.5\",2,{1,-0.5,0.041666667,-0.001388889})",
            0.492172828361,
        ),
        ("=SERIESSUM(\"2\",\"1\",\"1\",{\"1\",\"2\",\"3\"})", 34.),
        ("=SERIESSUM({2},{1},{1},{1,2,3})", 34.),
        ("=SERIESSUM(2,Z1,1,{1,2,3})", 17.),
        ("=SERIESSUM(2,1,Z1,{1,2,3})", 12.),
        ("=SERIESSUM(2,1,1,Z1)", 0.),
        ("=SERIESSUM(0,1,1,{1,2,3})", 0.),
        ("=SERIESSUM(-2,1,1,{1,2,3})", -18.),
        ("=SERIESSUM(4,0.5,0.5,{1,2,3})", 34.),
        ("=SERIESSUM(2,3,-1,{1,2,3})", 22.),
        ("=SERIESSUM(1E-300,2,1,{1,2})", 0.),
        ("=SERIESSUM(1,0,1,{1E16,1,-1E16})", 1.),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(&book, 0, 0, expected);
        let restored = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        near(&restored, 0, 0, expected);
    }
}

#[test]
fn series_arity_types_and_invalid_powers() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=SERIESSUM()", "#ERROR!"),
        ("=SERIESSUM(1,0,1)", "#ERROR!"),
        ("=SERIESSUM(1,0,1,2,3)", "#ERROR!"),
        ("=SERIESSUM(,0,1,2)", "#N/A"),
        ("=SERIESSUM(1,,1,2)", "#N/A"),
        ("=SERIESSUM(1,0,,2)", "#N/A"),
        ("=SERIESSUM(1,0,1,)", "#N/A"),
        ("=SERIESSUM(TRUE,0,1,2)", "#VALUE!"),
        ("=SERIESSUM(1,FALSE,1,2)", "#VALUE!"),
        ("=SERIESSUM(1,0,TRUE,2)", "#VALUE!"),
        ("=SERIESSUM(1,0,1,TRUE)", "#VALUE!"),
        ("=SERIESSUM(\"TRUE\",0,1,2)", "#VALUE!"),
        ("=SERIESSUM(1,0,1,{1,FALSE,2})", "#VALUE!"),
        ("=SERIESSUM(1,0,1,{1,\"test\",2})", "#VALUE!"),
        ("=SERIESSUM(1,0,1,{1,\" \",2})", "#VALUE!"),
        ("=SERIESSUM(1,0,1,\"FALSE\")", "#VALUE!"),
        ("=SERIESSUM({1,2},0,1,2)", "#VALUE!"),
        ("=SERIESSUM(1,{0;1},1,2)", "#VALUE!"),
        ("=SERIESSUM(1,0,{1,2},2)", "#VALUE!"),
        ("=SERIESSUM(#NAME?,0,1,2)", "#NAME?"),
        ("=SERIESSUM(1,NA(),1,2)", "#N/A"),
        ("=SERIESSUM(1,0,1,{2;#N/A;3})", "#N/A"),
        ("=SERIESSUM(1,0,1,{TRUE,#N/A})", "#VALUE!"),
        ("=SERIESSUM(1,0,1,{#N/A,TRUE})", "#N/A"),
        ("=SERIESSUM(1E300,1000,1,{1,#N/A})", "#N/A"),
        ("=SERIESSUM(0,0,1,{1,#N/A})", "#N/A"),
        ("=SERIESSUM(0,0,2,{1,2,3})", "#NUM!"),
        ("=SERIESSUM(0,-1,1,{1,2,3})", "#NUM!"),
        ("=SERIESSUM(0,2,-1,{1,2,3})", "#NUM!"),
        ("=SERIESSUM(-2,0.5,1,1)", "#NUM!"),
        ("=SERIESSUM(1E300,1000,1,1)", "#NUM!"),
        ("=SERIESSUM(1E300,1000,1,0)", "#NUM!"),
        (
            "=SERIESSUM(9000,-0.5,90000,{0.785398163,0.785398163;9000,1;-0.5,-0.5;0.041666667,0.041666667;-0.001388889,-0.001388889})",
            "#NUM!",
        ),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn series_coefficients_keep_row_major_order_blanks_and_transpose() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "1"),
            (0, 0, 1, "2"),
            (0, 1, 0, "3"),
            (0, 1, 1, "4"),
            (0, 0, 3, "=SERIESSUM(2,0,1,A1:B2)"),
            (0, 1, 3, "=SERIESSUM(2,0,1,TRANSPOSE(A1:B2))"),
            (0, 2, 3, "=SERIESSUM(2,0,1,{1,2;3,4})"),
            (0, 3, 3, "=SERIESSUM(2,0,1,TRANSPOSE({1,2;3,4}))"),
            (0, 5, 0, "1"),
            (0, 7, 0, "3"),
            (0, 5, 3, "=SERIESSUM(2,0,1,A6:A8)"),
            (0, 10, 0, "=SEQUENCE(3)"),
            (0, 10, 3, "=SERIESSUM(2,0,1,A11#)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, n) in [(0, 49.), (1, 47.), (2, 49.), (3, 47.), (5, 13.), (10, 17.)] {
        near(&book, r, 3, n);
    }
    book.edit(&[(0, 6, 0, "TRUE")], LIMIT).unwrap();
    assert_eq!(book.display(0, 5, 3, LIMIT).unwrap(), "#VALUE!");
    book.edit(&[(0, 6, 0, "'2")], LIMIT).unwrap();
    near(&book, 5, 3, 17.);
    // The reader precedes a spill whose anchor is outside its source range.
    book.edit(
        &[
            (0, 0, 7, "=SERIESSUM(2,0,1,J10:J12)"),
            (0, 8, 9, "=SEQUENCE(4)"),
        ],
        LIMIT,
    )
    .unwrap();
    near(&book, 0, 7, 24.);
    book.edit(&[(0, 8, 9, "=SEQUENCE(4,1,2)")], LIMIT).unwrap();
    near(&book, 0, 7, 31.);
}

#[test]
fn series_table_roundtrips_and_map_recalculate() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Coefficient"),
            (0, 1, 0, "1"),
            (0, 2, 0, "2"),
            (0, 3, 0, "3"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Polynomial", [0, 0, 3, 0], LIMIT)
        .unwrap();
    book.edit(
        &[
            (0, 1, 2, "=SERIESSUM(2,0,1,Polynomial[Coefficient])"),
            (
                0,
                1,
                4,
                "=MAP({1;2;3},LAMBDA(x,SERIESSUM(x,0,1,Polynomial[Coefficient])))",
            ),
        ],
        LIMIT,
    )
    .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&restored, 1, 2, 17.);
        for (r, n) in [(1, 6.), (2, 17.), (3, 34.)] {
            near(&restored, r, 4, n);
        }
        restored.edit(&[(0, 3, 0, "4")], LIMIT).unwrap();
        near(&restored, 1, 2, 21.);
        near(&restored, 3, 4, 43.);
        restored.edit_axis(0, false, 0, 1, LIMIT).unwrap();
        near(&restored, 2, 2, 21.);
        near(&restored, 4, 4, 43.);
    }
}

#[test]
fn series_range_work_is_bounded_without_materializing_a_matrix() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 9999, 0, "2"), (0, 0, 2, "=SERIESSUM(1,0,1,A1:A10000)")],
        100_000,
    )
    .unwrap();
    near(&book, 0, 2, 2.);
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 2, "=SERIESSUM(1,0,1,A:A)")], 10_000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
}

#[test]
fn series_legacy_parameters_keep_scalar_intersection_on_reopening() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "1"),
            (0, 1, 0, "2"),
            (0, 2, 0, "3"),
            (0, 1, 1, "=SERIESSUM(A:A,0,1,{1,2,3})"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 1, 1, LIMIT).unwrap(), "#VALUE!");
    let mut cell = book.sheets[0].cells[&(1, 1)].clone();
    cell.legacy_formula = true;
    book.replace_cells(vec![(0, 1, 1, Some(cell))], LIMIT)
        .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&restored, 1, 1, 17.);
        restored.edit(&[(0, 1, 0, "3")], LIMIT).unwrap();
        near(&restored, 1, 1, 34.);
        restored
            .edit(&[(0, 1, 1, "=SERIESSUM(A:A,0,1,{1,2,3})")], LIMIT)
            .unwrap();
        assert_eq!(restored.display(0, 1, 1, LIMIT).unwrap(), "#VALUE!");
    }
}

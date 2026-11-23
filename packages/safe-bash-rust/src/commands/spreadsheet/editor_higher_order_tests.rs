// MAP/REDUCE/SCAN cases adapted from IronCalc logical/{map_reduce,scan}.rs
// and test_fn_{map_reduce,scan}.rs, f93662006b8fb1c401dc870bbda26c5d60ac6037.
// MIT, LICENSE.IronCalc. Additional regressions cover shared captures and limits.
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;
#[test]
fn map_and_scan_spill_in_row_major_order_and_reduce_returns_the_last_accumulator() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "1"),
            (0, 0, 1, "2"),
            (0, 1, 0, "3"),
            (0, 1, 1, "4"),
            (0, 0, 3, "=MAP(A1:B2,LAMBDA(x,x*x))"),
            (0, 3, 3, "=MAP(A1:B2,{10,20;30,40},LAMBDA(a,b,a+b))"),
            (0, 6, 3, "=SCAN(0,A1:B2,LAMBDA(a,x,a*10+x))"),
            (0, 9, 3, "=SCAN(A1:B2,LAMBDA(a,x,a+x))"),
            (0, 12, 3, "=REDUCE(0,A1:B2,LAMBDA(a,x,a*10+x))"),
            (0, 13, 3, "=REDUCE(A1:B2,LAMBDA(a,x,a+x))"),
            (0, 14, 3, "=REDUCE(1,A1:B2,LAMBDA(a,x,a*x))"),
        ],
        LIMIT,
    )
    .unwrap();
    for book in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, c, want) in [
            (0, 3, "1"),
            (0, 4, "4"),
            (1, 3, "9"),
            (1, 4, "16"),
            (3, 3, "11"),
            (3, 4, "22"),
            (4, 3, "33"),
            (4, 4, "44"),
            (6, 3, "1"),
            (6, 4, "12"),
            (7, 3, "123"),
            (7, 4, "1234"),
            (9, 3, "1"),
            (9, 4, "3"),
            (10, 3, "6"),
            (10, 4, "10"),
            (12, 3, "1234"),
            (13, 3, "10"),
            (14, 3, "24"),
        ] {
            assert_eq!(book.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
        }
    }
}
#[test]
fn higher_order_functions_preserve_closures_types_and_element_errors() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 3, "text"),
            (0, 1, 3, "0"),
            (
                0,
                0,
                0,
                "=MAP(D1:D3,LAMBDA(x,IF(ISBLANK(x),\"blank\",TYPE(x))))",
            ),
            (0, 4, 0, "=MAP({1,0,2},LAMBDA(x,1/x))"),
            (0, 6, 0, "=MAP({1,#N/A,2},LAMBDA(x,IFERROR(x,7)))"),
            (0, 8, 0, "=LET(offset,5,f,LAMBDA(x,x+offset),MAP({1,2},f))"),
            (
                0,
                10,
                0,
                "=REDUCE(\"\",{\"a\",\"b\";\"c\",\"d\"},LAMBDA(a,x,a&x))",
            ),
            (0, 12, 0, "=SCAN(0,{1,0,2},LAMBDA(a,x,a+1/x))"),
            (0, 14, 0, "=REDUCE(0,{1,0,2},LAMBDA(a,x,IFERROR(a,0)+1/x))"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, want) in [
        (0, 0, "2"),
        (1, 0, "1"),
        (2, 0, "blank"),
        (4, 0, "1"),
        (4, 1, "#DIV/0!"),
        (4, 2, "0.5"),
        (6, 0, "1"),
        (6, 1, "7"),
        (6, 2, "2"),
        (8, 0, "6"),
        (8, 1, "7"),
        (10, 0, "abcd"),
        (12, 0, "1"),
        (12, 1, "#DIV/0!"),
        (12, 2, "#DIV/0!"),
        (14, 0, "0.5"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
    }
}
#[test]
fn higher_order_functions_check_shapes_and_lambda_parameter_counts() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=MAP({1;2},{3},LAMBDA(a,b,a+b))", "#VALUE!"),
        ("=MAP({1;2},LAMBDA(a,b,a+b))", "#VALUE!"),
        ("=REDUCE(1,LAMBDA(x,x))", "#VALUE!"),
        ("=SCAN(1,LAMBDA(x,x))", "#VALUE!"),
        ("=MAP({1;2},4)", "#VALUE!"),
        ("=MAP({1;2})", "#ERROR!"),
        ("=REDUCE(0,{1;2},LAMBDA(a,b,a+b),1)", "#ERROR!"),
        ("=SCAN({1;2})", "#ERROR!"),
        ("=MAP({1;2},LAMBDA(x,SEQUENCE(1)))", "1"),
        ("=MAP({1;2},LAMBDA(x,SEQUENCE(2)))", "#CALC!"),
        ("=SCAN(0,{1;2},LAMBDA(a,x,SEQUENCE(2)))", "#CALC!"),
        ("=REDUCE(0,{1;2},LAMBDA(a,x,VSTACK(a,x)))", "0"),
        ("=MAP(3,LAMBDA(x,x*2))", "6"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
    book.edit(
        &[(0, 0, 0, "=REDUCE(0,{1;2},LAMBDA(a,x,VSTACK(a,x)))")],
        LIMIT,
    )
    .unwrap();
    for (r, want) in [(0, "0"), (1, "1"), (2, "2")] {
        assert_eq!(book.display(0, r, 0, LIMIT).unwrap(), want);
    }
}
#[test]
fn repeated_lambda_calls_share_captured_arrays_instead_of_copying_them() {
    let mut book = Spreadsheet::new();
    let calls = (1..=100)
        .map(|n| format!("f({n})"))
        .collect::<Vec<_>>()
        .join(",");
    let formula = format!("=LET(data,SEQUENCE(1000),f,LAMBDA(x,x+1),SUM({calls}))");
    book.edit(&[(0, 0, 0, &formula)], 500_000).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "5150");
    book.edit(
        &[(
            0,
            0,
            0,
            "=LET(data,SEQUENCE(1000),SUM(MAP(data,LAMBDA(x,x+1))))",
        )],
        1_000_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "501500");
}
#[test]
fn higher_order_allocation_and_work_failures_leave_the_document_unchanged() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "42")], LIMIT).unwrap();
    let before = book.to_json();
    for formula in [
        "=MAP(D:D,LAMBDA(x,x+1))",
        "=SCAN(0,D:D,LAMBDA(a,x,a+x))",
        "=REDUCE(0,D:D,LAMBDA(a,x,a+x))",
        "=MAP(SEQUENCE(10000),LAMBDA(x,REPT(\"x\",10000)))",
    ] {
        assert!(
            book.edit(&[(0, 0, 0, formula)], 40_000).is_err(),
            "{formula}"
        );
        assert_eq!(book.to_json(), before, "{formula}");
    }
}
#[test]
fn higher_order_reads_later_spill_cells_and_recalculates_after_source_edits() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=SUM(MAP(Z2:Z3,LAMBDA(x,x*2)))"),
            (0, 1, 0, "=REDUCE(0,Z2:Z3,LAMBDA(a,x,a+x))"),
            (0, 0, 25, "=SEQUENCE(3)"),
            (0, 4, 0, "=SCAN(0,Z1:Z3,LAMBDA(a,x,a+x))"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "10");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "5");
    assert_eq!(book.display(0, 6, 0, LIMIT).unwrap(), "6");
    book.edit(&[(0, 0, 25, "=SEQUENCE(3,1,4)")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "22");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "11");
    assert_eq!(book.display(0, 6, 0, LIMIT).unwrap(), "15");
}

#[test]
fn row_column_and_generated_callbacks_preserve_sparse_references() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 3, "2"),
            (0, 1_048_575, 3, "9"),
            (0, 0, 5, "3"),
            (0, 2, 0, "=BYCOL(D:F,LAMBDA(c,SUM(c)))"),
            (0, 4, 0, "=BYROW(D1:F2,LAMBDA(r,SUM(r)))"),
            (0, 7, 0, "=MAKEARRAY(2,3,LAMBDA(r,c,r*10+c))"),
            (0, 10, 0, "=BYROW({72;105},LAMBDA(r,CHAR(r)))"),
        ],
        100_000,
    )
    .unwrap();
    for book in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, c, want) in [
            (2, 0, "11"),
            (2, 1, "0"),
            (2, 2, "3"),
            (4, 0, "5"),
            (5, 0, "0"),
            (7, 0, "11"),
            (7, 1, "12"),
            (7, 2, "13"),
            (8, 0, "21"),
            (8, 1, "22"),
            (8, 2, "23"),
            (10, 0, "H"),
            (11, 0, "i"),
        ] {
            assert_eq!(book.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
        }
    }
}
#[test]
fn generated_dimensions_and_row_callback_results_are_bounded() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=MAKEARRAY(0,2,LAMBDA(r,c,r))", "#VALUE!"),
        ("=MAKEARRAY(2,-1,LAMBDA(r,c,c))", "#VALUE!"),
        ("=MAKEARRAY(1048577,1,LAMBDA(r,c,r))", "#VALUE!"),
        ("=MAKEARRAY(1,16385,LAMBDA(r,c,c))", "#VALUE!"),
        ("=MAKEARRAY(1.9,1.9,LAMBDA(r,c,r+c))", "2"),
        ("=BYROW({1,2},LAMBDA(r,r))", "#CALC!"),
        ("=BYCOL({1;2},LAMBDA(c,c))", "#CALC!"),
        ("=BYROW({1,2},LAMBDA(a,b,SUM(a)+SUM(b)))", "#VALUE!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
    let before = book.to_json();
    for formula in [
        "=MAKEARRAY(1048576,16384,LAMBDA(r,c,r*c))",
        "=BYROW(D:D,LAMBDA(r,SUM(r)))",
    ] {
        assert!(book.edit(&[(0, 0, 0, formula)], 50_000).is_err());
        assert_eq!(book.to_json(), before);
    }
}

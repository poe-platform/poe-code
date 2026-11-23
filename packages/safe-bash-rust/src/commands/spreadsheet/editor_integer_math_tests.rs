// Adapted from IronCalc f936620 mathematical.rs/gcd_lcm.rs and Univer 4767b3b
// math/{gcd,lcm,mround}; see LICENSE.IronCalc and LICENSE.Univer.
use super::{Spreadsheet, Value};
const LIMIT: usize = 128 * 1024 * 1024;
fn near(b: &Spreadsheet, r: usize, c: usize, e: f64) {
    let n = match b.cell(0, r, c).and_then(|c| c.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!(
            "{}: {}",
            b.input(0, r, c),
            b.display(0, r, c, LIMIT).unwrap()
        ),
    };
    assert!(
        (n - e).abs() <= e.abs() * 2e-14,
        "{}: {n} != {e}",
        b.input(0, r, c)
    );
}
#[test]
fn integer_aggregates_upstream_numbers_arrays_and_coercions() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=GCD(5,2)", 1.),
        ("=LCM(5,2)", 10.),
        ("=GCD(1000000,3222)", 2.),
        ("=LCM(1000000,3222)", 1611000000.),
        ("=GCD(\"1.5\",8)", 1.),
        ("=LCM(\"1.5\",8)", 8.),
        ("=GCD({10,25},{35,40,50})", 5.),
        ("=LCM({2,3},{4,5,6})", 60.),
        ("=GCD({4.8,8.4,12})", 4.),
        ("=LCM({4.8,8.4,12})", 24.),
        ("=GCD(0,0)", 0.),
        ("=LCM(0,0)", 0.),
        ("=GCD(0,8)", 8.),
        ("=LCM(0,8)", 0.),
        ("=GCD(A100,8)", 8.),
        ("=LCM(A100,8)", 8.),
        ("=GCD(A100:A105)", 0.),
        ("=LCM(A100:A105)", 0.),
        ("=GCD(9007199254740991,3)", 1.),
        ("=LCM(9007199254740991,1)", 9007199254740991.),
        ("=GCD({4,\"8\",12})", 4.),
        ("=LCM({4,\"8\",12})", 24.),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, e);
    }
}
#[test]
fn integer_math_errors_limits_and_omitted_arguments() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=GCD()", "#ERROR!"),
        ("=LCM()", "#ERROR!"),
        ("=GCD(-0.1,2)", "#NUM!"),
        ("=LCM(\"-0.1\",2)", "#NUM!"),
        ("=GCD(9007199254740992,1)", "#NUM!"),
        ("=LCM(1E100,1)", "#NUM!"),
        ("=LCM(9007199254740991,2)", "#NUM!"),
        ("=GCD(TRUE,8)", "#VALUE!"),
        ("=LCM(\"TRUE\",8)", "#VALUE!"),
        (
            "=GCD({1,\" \",1.23,TRUE,FALSE;0,\"100\",\"2.34\",\"test\",-3})",
            "#VALUE!",
        ),
        (
            "=LCM({1,\" \",1.23,TRUE,FALSE;0,\"100\",\"2.34\",\"test\",-3})",
            "#VALUE!",
        ),
        ("=GCD(1,#N/A)", "#N/A"),
        ("=LCM(0,#REF!)", "#REF!"),
        ("=GCD(1,\"bad\")", "#VALUE!"),
        ("=LCM(0,-1)", "#NUM!"),
        ("=GCD(,8)", "#N/A"),
        ("=LCM(8,)", "#N/A"),
        ("=GCD(A100,A101)", "#VALUE!"),
        ("=LCM(A100,A101)", "#VALUE!"),
        ("=MROUND()", "#ERROR!"),
        ("=MROUND(10)", "#ERROR!"),
        ("=MROUND(10,3,1)", "#ERROR!"),
        ("=MROUND(-7.5,5)", "#NUM!"),
        ("=MROUND(7.5,-5)", "#NUM!"),
        ("=MROUND(2.15,TRUE)", "#VALUE!"),
        ("=MROUND(\"TRUE\",1)", "#VALUE!"),
        ("=MROUND(\"test\",1)", "#VALUE!"),
        ("=MROUND(\"\",1)", "#VALUE!"),
        ("=MROUND(,1)", "#N/A"),
        ("=MROUND(1,)", "#N/A"),
        ("=MROUND(1,#REF!)", "#REF!"),
        ("=TRUNC()", "#ERROR!"),
        ("=TRUNC(1,2,3)", "#ERROR!"),
        ("=INT()", "#ERROR!"),
        ("=INT(1,2)", "#ERROR!"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
    let f = format!("=GCD({})", vec!["1"; 256].join(","));
    b.edit(&[(0, 0, 0, &f)], LIMIT).unwrap();
    assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "#ERROR!");
}
#[test]
fn mround_ties_zero_extreme_quotients_and_array_parameters() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=MROUND(10,3)", 9.),
        ("=MROUND(11,3)", 12.),
        ("=MROUND(7.5,5)", 10.),
        ("=MROUND(-7.5,-5)", -10.),
        ("=MROUND(2.675,0.01)", 2.68),
        ("=MROUND(\"21.5\",\"1\")", 22.),
        ("=MROUND(0,0)", 0.),
        ("=MROUND(5,0)", 0.),
        ("=MROUND(2.15,A100)", 0.),
        ("=MROUND(A100,2)", 0.),
        ("=MROUND(1E308,1E-100)", 1e308),
        ("=MROUND(1E-100,1E308)", 0.),
        ("=MROUND(1.5E308,1E308)", f64::INFINITY),
        ("=MROUND(1,3.141592653589793)", 0.),
        ("=TRUNC(10.22,1)", 10.2),
        ("=INT(-10.22)", -11.),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        if e.is_infinite() {
            assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "#NUM!");
        } else {
            near(&b, 0, 0, e);
        }
    }
    b.edit(&[(0, 2, 0, "=MROUND({7.5,-7.5;10,11},{5,-5})")], LIMIT)
        .unwrap();
    near(&b, 2, 0, 10.);
    near(&b, 2, 1, -10.);
    near(&b, 3, 0, 10.);
    assert_eq!(b.display(0, 3, 1, LIMIT).unwrap(), "#NUM!");
}
#[test]
fn integer_math_sparse_ranges_delayed_spills_and_budget_rollback() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 9997, 0, "4"),
            (0, 9998, 0, "8"),
            (0, 9999, 0, "12"),
            (0, 0, 2, "=GCD(A:A)"),
            (0, 1, 2, "=LCM(A:A)"),
        ],
        100_000,
    )
    .unwrap();
    near(&b, 0, 2, 4.);
    near(&b, 1, 2, 0.);
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 4, "=SEQUENCE(1,1,LCM(H:H))"),
            (0, 0, 6, "=SEQUENCE(3,1,10)"),
            (0, 0, 7, "=SEQUENCE(5)"),
        ],
        100_000,
    )
    .unwrap();
    near(&b, 0, 4, 60.);
    let before = b.to_json();
    assert!(b.edit(&[(0, 0, 4, "=LCM(SEQUENCE(1000))")], 1000).is_err());
    assert_eq!(b.to_json(), before);
}
#[test]
fn integer_math_table_recalculation_and_json_excel_reopening() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Quantity"),
            (0, 1, 0, "4"),
            (0, 2, 0, "8"),
            (0, 3, 0, "12"),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Batches", [0, 0, 3, 0], LIMIT).unwrap();
    b.edit(
        &[
            (0, 1, 2, "=GCD(Batches[Quantity])"),
            (0, 2, 2, "=LCM(Batches[Quantity])"),
            (0, 1, 4, "=MROUND(Batches[Quantity],5)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut x in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&x, 1, 2, 4.);
        near(&x, 2, 2, 24.);
        near(&x, 1, 4, 5.);
        near(&x, 2, 4, 10.);
        near(&x, 3, 4, 10.);
        x.edit(&[(0, 1, 0, "6")], LIMIT).unwrap();
        near(&x, 1, 2, 2.);
        near(&x, 2, 2, 24.);
    }
}
#[test]
fn integer_math_fixture_regressions_for_dates_references_and_precision() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=GCD(\" 2024-01-10 \",7)", "#VALUE!"),
        ("=LCM(\" 2024-01-10 \",7)", "#VALUE!"),
        ("=MROUND(\" 2024-01-10 \",7)", "#VALUE!"),
        ("=TRUNC(\" 2024-01-10 \",0)", "#VALUE!"),
        ("=SQRT(-1)", "#NUM!"),
        ("=LCM(SQRT(-1),4)", "#NUM!"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
    for (f, e) in [
        ("=INT(\"2024-01-10\")", 45301.),
        ("=TRUNC(1E100,1E50)", 1e100),
        ("=TRUNC(5,9.99999E307)", 5.),
        ("=TRUNC(5,-1E100)", 0.),
        ("=TRUNC(\" 10.25 \",1)", 10.2),
        ("=LCM(\" 10.25 \",3)", 30.),
        ("=MROUND(\" 10.25 \",0.5)", 10.5),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, e);
    }
    b.edit(
        &[
            (0, 0, 2, "=D100"),
            (0, 0, 3, "5"),
            (0, 1, 3, "8"),
            (0, 0, 5, "=LCM(C1:D1)"),
            (0, 1, 5, "=GCD(C1:D1)"),
            (0, 1, 6, "=LCM(4,_xlfn.SINGLE(D:D))"),
            (0, 1, 7, "=GCD(4,_xlfn.SINGLE(D:D))"),
        ],
        LIMIT,
    )
    .unwrap();
    near(&b, 0, 5, 0.);
    near(&b, 1, 5, 5.);
    near(&b, 1, 6, 8.);
    near(&b, 1, 7, 4.);
    b.edit(
        &[
            (0, 0, 9, "=LCM(L10:M10)"),
            (0, 9, 11, "=N100"),
            (0, 9, 12, "5"),
        ],
        LIMIT,
    )
    .unwrap();
    near(&b, 0, 9, 0.);
    b.edit(
        &[
            (0, 15, 11, "4"),
            (0, 17, 11, "8"),
            (0, 0, 10, "=LCM(L16:L18)"),
        ],
        LIMIT,
    )
    .unwrap();
    near(&b, 0, 10, 0.);
}

#[test]
fn rounding_multiples_validate_date_text_before_later_errors() {
    let mut book = Spreadsheet::new();
    for name in [
        "FLOOR",
        "CEILING",
        "FLOOR.MATH",
        "CEILING.MATH",
        "FLOOR.PRECISE",
        "CEILING.PRECISE",
        "ISO.CEILING",
    ] {
        for (args, want) in [
            ("\" 2024-01-10 \",2", "#VALUE!"),
            ("2,\" 2024-01-10 \"", "#VALUE!"),
            ("\" 2024-01-10 \",#DIV/0!", "#VALUE!"),
            ("\" 2024-01-10 \",1/0", "#VALUE!"),
            ("#REF!,\" 2024-01-10 \"", "#REF!"),
            ("\" 4 \",2", "4"),
            ("\"2024-01-10\",1", "45301"),
        ] {
            let formula = format!("={name}({args})");
            book.edit(&[(0, 0, 0, &formula)], 32 * 1024 * 1024).unwrap();
            assert_eq!(
                book.display(0, 0, 0, 32 * 1024 * 1024).unwrap(),
                want,
                "{formula}"
            );
        }
        let formula = format!("={name}({{\" 2024-01-10 \",4}},{{#REF!,2}})");
        book.edit(&[(0, 0, 0, &formula)], 32 * 1024 * 1024).unwrap();
        assert_eq!(book.display(0, 0, 0, 32 * 1024 * 1024).unwrap(), "#VALUE!");
        assert_eq!(book.display(0, 0, 1, 32 * 1024 * 1024).unwrap(), "4");
    }
}

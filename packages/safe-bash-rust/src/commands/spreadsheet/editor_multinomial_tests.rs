// Cases adapted from IronCalc f936620 mathematical/test_multinomial.rs (MIT)
// and Univer 4767b3b math/multinomial (Apache-2.0).
// See LICENSE.IronCalc and LICENSE.Univer. Large results use integer identities.
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
fn multinomial_upstream_values_and_finite_large_results() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=MULTINOMIAL(2,3,4)", 1260.),
        ("=MULTINOMIAL(5)", 1.),
        ("=MULTINOMIAL(0,0,1)", 1.),
        ("=MULTINOMIAL(2,2)", 6.),
        ("=MULTINOMIAL(5,2)", 21.),
        ("=MULTINOMIAL(\"1.5\",8)", 9.),
        ("=MULTINOMIAL(1.7,1.2,3.4,2.3)", 420.),
        ("=MULTINOMIAL(0.9,0.9)", 1.),
        ("=MULTINOMIAL(Z1,8)", 1.),
        ("=MULTINOMIAL(,8)", 1.),
        ("=MULTINOMIAL({2,5,7})", 72072.),
        ("=MULTINOMIAL({1,0;3,0})", 4.),
        ("=MULTINOMIAL({\"1.5\",8})", 9.),
        ("=MULTINOMIAL(1000)", 1.),
        ("=MULTINOMIAL(1000,1)", 1001.),
        ("=MULTINOMIAL(1E308)", 1.),
        ("=MULTINOMIAL(1E308,0,1)", 1e308),
        ("=MULTINOMIAL(1,1E308)", 1e308),
        ("=MULTINOMIAL(500,500)", 2.7028824094543655e299),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(&book, 0, 0, expected);
        let reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        near(&reopened, 0, 0, expected);
    }
}

#[test]
fn multinomial_arity_errors_types_and_overflow() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=MULTINOMIAL()", "#ERROR!"),
        ("=MULTINOMIAL(2,-1)", "#NUM!"),
        ("=MULTINOMIAL(-0.1,2)", "#NUM!"),
        ("=MULTINOMIAL(100000,100000)", "#NUM!"),
        ("=MULTINOMIAL(1000000,3222)", "#NUM!"),
        ("=MULTINOMIAL(1E308,1E308)", "#NUM!"),
        ("=MULTINOMIAL(TRUE,8)", "#VALUE!"),
        ("=MULTINOMIAL(FALSE,8)", "#VALUE!"),
        ("=MULTINOMIAL(\"TRUE\",8)", "#VALUE!"),
        ("=MULTINOMIAL(\"FALSE\",8)", "#VALUE!"),
        ("=MULTINOMIAL(\"test\",8)", "#VALUE!"),
        ("=MULTINOMIAL(\" \",8)", "#VALUE!"),
        ("=MULTINOMIAL({TRUE,1,2})", "#VALUE!"),
        ("=MULTINOMIAL({1,\"test\"})", "#VALUE!"),
        ("=MULTINOMIAL(#NAME?,8)", "#NAME?"),
        ("=MULTINOMIAL({2;#N/A;3})", "#N/A"),
        ("=MULTINOMIAL({-1;#N/A})", "#NUM!"),
        ("=MULTINOMIAL({#N/A;-1})", "#N/A"),
        ("=MULTINOMIAL(2,1/0)", "#DIV/0!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
    let formula = format!("=MULTINOMIAL({})", vec!["0"; 256].join(","));
    book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
    // The shared compiler rejects more than 255 arguments before dispatch.
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "Err:512");
    let formula = format!("=MULTINOMIAL({})", vec!["0"; 255].join(","));
    book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
    near(&book, 0, 0, 1.);
}

#[test]
fn multinomial_sparse_ranges_spills_and_references_keep_types() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "2"),
            (0, 2, 0, "3"),
            (0, 4, 0, "4"),
            (0, 0, 2, "=MULTINOMIAL(A:A)"),
            (0, 1, 2, "=MULTINOMIAL(A1:A5,3)"),
            (0, 2, 2, "=MULTINOMIAL(A1)"),
            (0, 0, 4, "=SEQUENCE(3,1,2)"),
            (0, 4, 4, "=MULTINOMIAL(E1#)"),
            (0, 0, 6, "'1.5"),
            (0, 1, 6, "8"),
            (0, 4, 6, "=MULTINOMIAL(G1:G2)"),
        ],
        LIMIT,
    )
    .unwrap();
    near(&book, 0, 2, 1260.);
    near(&book, 1, 2, 277200.);
    near(&book, 2, 2, 1.);
    near(&book, 4, 4, 1260.);
    near(&book, 4, 6, 9.);
    for text in ["TRUE", "FALSE", "test", "'TRUE"] {
        book.edit(&[(0, 1, 0, text)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "#VALUE!");
    }
    book.edit(&[(0, 1, 0, "=NA()")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "#N/A");
    book.edit(&[(0, 1, 0, "")], LIMIT).unwrap();
    near(&book, 0, 2, 1260.);
}

#[test]
fn multinomial_table_roundtrips_and_structural_edits_recalculate() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Count"),
            (0, 1, 0, "2"),
            (0, 2, 0, "3"),
            (0, 3, 0, "4"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Groups", [0, 0, 3, 0], LIMIT).unwrap();
    book.edit(&[(0, 1, 2, "=MULTINOMIAL(Groups[Count])")], LIMIT)
        .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&restored, 1, 2, 1260.);
        restored.edit(&[(0, 1, 0, "1")], LIMIT).unwrap();
        near(&restored, 1, 2, 280.);
        restored.edit_axis(0, false, 0, 1, LIMIT).unwrap();
        near(&restored, 2, 2, 280.);
        restored.edit(&[(0, 2, 0, "2")], LIMIT).unwrap();
        near(&restored, 2, 2, 1260.);
    }
}

#[test]
fn multinomial_limits_restore_saved_content() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "saved")], LIMIT).unwrap();
    let before = book.to_json();
    for formula in ["=MULTINOMIAL(SEQUENCE(100000))", "=MULTINOMIAL(500,500)"] {
        assert!(book.edit(&[(0, 0, 2, formula)], 300).is_err(), "{formula}");
        assert_eq!(book.to_json(), before);
    }
}

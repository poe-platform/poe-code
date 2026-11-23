// IronCalc f936620 statistical/test_fn_chisq*.rs (MIT) and Univer 4767b3b
// statistical/chisq-* (Apache-2.0). See bundled licenses.
use super::{Spreadsheet, Value};
const LIMIT: usize = 128 * 1024 * 1024;
fn near(book: &Spreadsheet, r: usize, c: usize, expected: f64) {
    let Some(Value::Number(actual)) = book.cell(0, r, c).and_then(|c| c.value.clone()) else {
        panic!("{r},{c}: {}", book.display(0, r, c, LIMIT).unwrap())
    };
    assert!(
        (actual - expected).abs() <= expected.abs() * 3e-12,
        "{actual:.17e} != {expected:.17e}"
    );
}
#[test]
fn chisquare_distributions_inverse_and_legacy_names() {
    let mut book = Spreadsheet::new();
    for (f, e) in [
        ("=CHISQ.DIST(0.5,4,TRUE)", 0.026499021160743912),
        ("=CHISQ.DIST(0.5,4,FALSE)", 0.09735009788392561),
        ("=CHISQ.DIST.RT(5,4)", 0.2872974951836458),
        ("=CHIDIST(5,4)", 0.2872974951836458),
        ("=CHISQ.INV(0.95,4)", 9.487729036781154),
        ("=CHISQ.INV.RT(0.05,4)", 9.487729036781154),
        ("=CHIINV(0.05,4)", 9.487729036781154),
        ("=CHISQ.DIST(0,2,FALSE)", 0.5),
        ("=CHISQ.DIST(0,4,FALSE)", 0.),
        ("=CHISQ.DIST(0,1,TRUE)", 0.),
        ("=CHISQ.DIST.RT(0,1)", 1.),
        ("=CHISQ.INV(0,10000000000)", 0.),
        ("=CHISQ.INV.RT(1,10000000000)", 0.),
        ("=CHISQ.DIST(0.5,4.9,TRUE)", 0.026499021160743912),
        ("=CHISQ.DIST(\"0.5\",\"4\",\"TRUE\")", 0.026499021160743912),
        ("=CHISQ.DIST.RT(7,TRUE)", 0.008150971593502705),
    ] {
        book.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&book, 0, 0, e);
        let x = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        near(&x, 0, 0, e);
    }
}
#[test]
fn chisquare_domain_and_arity_errors() {
    let mut book = Spreadsheet::new();
    for (f, e) in [
        ("=CHISQ.DIST()", "#ERROR!"),
        ("=CHISQ.DIST(1,2)", "#ERROR!"),
        ("=CHISQ.INV(0.5)", "#ERROR!"),
        ("=CHISQ.DIST.RT(1,2,TRUE)", "#ERROR!"),
        ("=CHISQ.INV.RT(0.5,2,1)", "#ERROR!"),
        ("=CHISQ.DIST(-1,2,TRUE)", "#NUM!"),
        ("=CHISQ.DIST(1,0,TRUE)", "#NUM!"),
        ("=CHISQ.DIST(1,10000000001,TRUE)", "#NUM!"),
        ("=CHISQ.DIST(0,1,FALSE)", "#NUM!"),
        ("=CHISQ.INV(1,2)", "#NUM!"),
        ("=CHISQ.INV.RT(0,2)", "#NUM!"),
        ("=CHISQ.INV(-0.1,2)", "#NUM!"),
        ("=CHISQ.INV.RT(1.1,2)", "#NUM!"),
        ("=CHISQ.DIST(\"TRUE\",2,TRUE)", "#VALUE!"),
        ("=CHISQ.DIST(1,2,\"bad\")", "#VALUE!"),
        ("=CHISQ.DIST(1,#REF!,TRUE)", "#REF!"),
        ("=CHISQ.TEST()", "#ERROR!"),
        ("=CHISQ.TEST({1,2},{1})", "#N/A"),
        ("=CHISQ.TEST(1,1)", "#N/A"),
        ("=CHISQ.TEST({1,2},{1,0})", "#DIV/0!"),
        ("=CHISQ.TEST({1,-2},{1,2})", "#NUM!"),
        ("=CHISQ.TEST({1,2},{1,-2})", "#NUM!"),
        ("=CHISQ.TEST({TRUE,\"2\"},{1,2})", "#DIV/0!"),
        ("=CHISQ.TEST({\"text\",1},{#REF!,2})", "#REF!"),
    ] {
        book.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}
#[test]
fn chisquare_test_pairs_preserve_shapes_and_ignored_positions() {
    let mut book = Spreadsheet::new();
    for (f, e) in [
        ("=CHISQ.TEST({TRUE,4,\"3\"},{2,2,2})", 0.36787944117144233),
        ("=CHISQ.TEST({1,2,3},{3;3;4})", 0.3835315728763107),
        ("=CHISQ.TEST({1,2;3,4},{2,3;2,2})", 0.06788915486182895),
        ("=CHISQ.TEST({1,2,3,4},{2,3,4,5})", 0.7330944949612943),
        ("=CHITEST({1,2,3},{4,5,6})", 0.0623494766896737),
        ("=CHISQ.TEST({4,5,6},{1,2,3})", 0.00026125855730166754),
        (
            "=CHISQ.TEST({1,2;3,4},TRANSPOSE({2,4;3,5}))",
            0.25728017715417834,
        ),
    ] {
        book.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&book, 0, 0, e);
    }
}
#[test]
fn chisquare_tables_spills_and_reopening_recalculate() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Observed"),
            (0, 0, 1, "Expected"),
            (0, 1, 0, "1"),
            (0, 1, 1, "4"),
            (0, 2, 0, "2"),
            (0, 2, 1, "5"),
            (0, 3, 0, "3"),
            (0, 3, 1, "6"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Counts", [0, 0, 3, 1], LIMIT).unwrap();
    book.edit(
        &[
            (0, 1, 3, "=CHISQ.TEST(Counts[Observed],Counts[Expected])"),
            (0, 1, 5, "=CHISQ.DIST(Counts[Observed],2,{FALSE,TRUE})"),
            (0, 6, 0, "=CHISQ.DIST({1,#N/A,-1},2,TRUE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut x in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&x, 1, 3, 0.0623494766896737);
        near(&x, 1, 5, 0.3032653298563167);
        near(&x, 3, 6, 0.7768698398515702);
        assert_eq!(x.display(0, 6, 1, LIMIT).unwrap(), "#N/A");
        assert_eq!(x.display(0, 6, 2, LIMIT).unwrap(), "#NUM!");
        x.edit(&[(0, 1, 0, "4"), (0, 2, 0, "5"), (0, 3, 0, "6")], LIMIT)
            .unwrap();
        near(&x, 1, 3, 1.);
    }
}
#[test]
fn chisquare_extreme_tails_and_large_degrees() {
    let mut book = Spreadsheet::new();
    for (f, e) in [
        ("=CHISQ.DIST.RT(1000,2)", 7.124576406741286e-218),
        ("=CHISQ.INV.RT(1E-200,2)", 921.0340371976183),
        ("=CHISQ.INV(1E-150,1)", 1.5707963267948966e-300),
        ("=CHISQ.DIST(1E-300,1,TRUE)", 7.978845608028654e-151),
        (
            "=CHISQ.DIST(10000000000,10000000000,TRUE)",
            0.5000018806319452,
        ),
        (
            "=CHISQ.DIST(10000000000,10000000000,FALSE)",
            2.8209479176917656e-6,
        ),
        ("=CHISQ.INV(0.5,10000000000)", 9999999999.333334),
        ("=CHISQ.TEST({0,0,0},{1000,1000,1000})", 0.),
    ] {
        book.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&book, 0, 0, e);
    }
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 0, "=CHISQ.INV(0.123,123)")], 100)
            .is_err()
    );
    assert_eq!(before, book.to_json());
}

#[test]
fn chisquare_inverse_roundtrips_both_tails_across_scales() {
    let mut book = Spreadsheet::new();
    for degrees in [1., 2., 3., 30., 1000., 1e6, 1e10] {
        for p in [1e-150_f64, 1e-30, 0.01, 0.5, 0.99] {
            for upper in [false, true] {
                let inverse = if upper { "CHISQ.INV.RT" } else { "CHISQ.INV" };
                let formula = format!("={inverse}({p:e},{degrees})");
                let check = if upper {
                    format!("=CHISQ.DIST.RT(A1,{degrees})")
                } else {
                    format!("=CHISQ.DIST(A1,{degrees},TRUE)")
                };
                let density = format!("=CHISQ.DIST(A1,{degrees},FALSE)");
                book.edit(
                    &[(0, 0, 0, &formula), (0, 1, 0, &check), (0, 2, 0, &density)],
                    LIMIT,
                )
                .unwrap();
                let number = |r| match book.cell(0, r, 0).and_then(|c| c.value.clone()) {
                    Some(Value::Number(n)) => n,
                    _ => panic!("{formula}: {r} {}", book.display(0, r, 0, LIMIT).unwrap()),
                };
                let (x, actual, pdf) = (number(0), number(1), number(2));
                // At large degrees adjacent representable quantiles have distinguishable
                // probabilities. Include that unavoidable x-spacing in the error bound.
                let tolerance = (p * 3e-11).max(pdf * x * f64::EPSILON * 8.);
                assert!(
                    (actual - p).abs() <= tolerance,
                    "{formula}: {actual:e} != {p:e}, tolerance {tolerance:e}"
                );
            }
        }
    }
}

#[test]
fn chisquare_sparse_columns_delayed_spills_and_small_expected_counts() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 9999, 0, "100"),
            (0, 9999, 1, "101"),
            (0, 0, 3, "=CHISQ.TEST(A:A,B:B)"),
        ],
        100_000,
    )
    .unwrap();
    near(&book, 0, 3, 1.);
    book.edit(
        &[
            (0, 0, 7, "=CHISQ.TEST(J10:J12,K10:K12)"),
            (0, 8, 9, "=SEQUENCE(4)"),
            (0, 8, 10, "=SEQUENCE(4,1,2)"),
        ],
        LIMIT,
    )
    .unwrap();
    near(&book, 0, 7, 0.6759293862085685);
    book.edit(&[(0, 8, 10, "=SEQUENCE(4,1,3)")], LIMIT).unwrap();
    near(&book, 0, 7, 0.29131989113347107);
    book.edit(
        &[(
            0,
            2,
            7,
            "=CHISQ.TEST({1E-160,1E-160},{1E-160,1E-160}*1E-160)",
        )],
        LIMIT,
    )
    .unwrap();
    near(&book, 2, 7, 0.15729689638588215);
}

#[test]
fn chisquare_inverse_preserves_representable_subnormals_and_underflows_to_zero() {
    let mut book = Spreadsheet::new();
    for (p, expected) in [(1e-160_f64, 1.5706e-320_f64), (1e-200, 0.)] {
        let formula = format!("=CHISQ.INV({p:e},1)");
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        let Some(Value::Number(actual)) = book.cell(0, 0, 0).and_then(|c| c.value.clone()) else {
            panic!("{formula}: {}", book.display(0, 0, 0, LIMIT).unwrap());
        };
        assert!(
            actual.to_bits().abs_diff(expected.to_bits()) <= 1,
            "{formula}: {actual:e}"
        );
    }
}

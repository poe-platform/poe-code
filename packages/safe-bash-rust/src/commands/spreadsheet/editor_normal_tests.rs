// Adapted from IronCalc f936620 statistical/{test_fn_norm_dist,test_fn_log_norm}
// (MIT) and Univer 4767b3b {norm-dist,norm-inv,norm-s-dist,lognorm-dist,lognorm-inv}
// (Apache-2.0). See adjacent license files. Extreme cases use analytic limits.
use super::{Spreadsheet, Value};
const LIMIT: usize = 20_000_000;

fn near(book: &Spreadsheet, row: usize, col: usize, expected: f64) {
    let Some(Value::Number(n)) = book.cell(0, row, col).and_then(|c| c.value.clone()) else {
        panic!(
            "{}: {}",
            book.input(0, row, col),
            book.display(0, row, col, LIMIT).unwrap()
        );
    };
    assert!(
        (n - expected).abs() <= expected.abs() * 3e-12,
        "{n} != {expected}"
    );
}

#[test]
fn normal_upstream_values_and_legacy_names() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=NORM.DIST(1,0,1,TRUE)", 0.8413447460685429),
        ("=NORM.DIST(1,0,1,FALSE)", 0.24197072451914337),
        ("=NORMDIST(1,0,1,TRUE)", 0.8413447460685429),
        ("=NORM.S.DIST(0,TRUE)", 0.5),
        ("=NORM.S.DIST(0,FALSE)", 0.3989422804014327),
        ("=NORM.S.DIST(0.2,FALSE)", 0.3910426939754559),
        ("=NORM.S.DIST(2.2,TRUE)", 0.9860965524865014),
        ("=NORMSDIST(1)", 0.8413447460685429),
        ("=NORM.INV(0.5,0,1)", 0.),
        ("=NORM.INV(0.7,0.2,1)", 0.7244005127080407),
        ("=NORMINV(0.7,0.2,5)", 2.8220025635402037),
        ("=NORM.S.INV(0.5)", 0.),
        ("=NORMSINV(0.7)", 0.5244005127080407),
        ("=LOGNORM.DIST(4,3.5,1.2,TRUE)", 0.0390835557068005),
        ("=LOGNORM.DIST(4,3.5,1.2,FALSE)", 0.01761759668181924),
        ("=LOGNORMDIST(4,3.5,1.2)", 0.0390835557068005),
        ("=LOGNORM.INV(0.5,3.5,1.2)", 33.11545195869231),
        ("=LOGINV(0.5,3.5,1.2)", 33.11545195869231),
        ("=NORM.DIST(15.2069,6,4,FALSE)", 0.007053707723785455),
        ("=LOGNORM.DIST(15.2069,6,4,TRUE)", 0.20623272748031884),
        ("=LOGNORM.DIST(15.2069,6,4,FALSE)", 0.004687651063329814),
        ("=NORM.DIST(\"1\",\"0\",\"1\",\"TRUE\")", 0.8413447460685429),
        ("=NORM.DIST(TRUE,FALSE,TRUE,-1)", 0.8413447460685429),
        ("=NORM.DIST(Z1,0,1,TRUE)", 0.5),
        ("=LOGNORM.DIST(TRUE,6,4,TRUE)", 0.06680720126885809),
        ("=STANDARDIZE(42,40,1.5)", 1.3333333333333333),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(&book, 0, 0, expected);
    }
}

#[test]
fn normal_arity_errors_follow_excel_for_every_alias() {
    let mut book = Spreadsheet::new();
    for (name, count) in [
        ("NORM.DIST", 4),
        ("NORMDIST", 4),
        ("NORM.INV", 3),
        ("NORMINV", 3),
        ("NORM.S.DIST", 2),
        ("NORMSDIST", 1),
        ("NORM.S.INV", 1),
        ("NORMSINV", 1),
        ("LOGNORM.DIST", 4),
        ("LOGNORMDIST", 3),
        ("LOGNORM.INV", 3),
        ("LOGINV", 3),
        ("STANDARDIZE", 3),
    ] {
        for args in 0..=count + 1 {
            if args == count {
                continue;
            }
            let formula = format!("={name}({})", vec!["0.5"; args].join(","));
            book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            assert_eq!(
                book.display(0, 0, 0, LIMIT).unwrap(),
                "#ERROR!",
                "{formula}"
            );
            let reopened =
                Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
            assert_eq!(
                reopened.display(0, 0, 0, LIMIT).unwrap(),
                "#ERROR!",
                "{formula}"
            );
        }
    }
}

#[test]
fn normal_domains_types_and_error_precedence() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=NORM.DIST(1,0,0,TRUE)", "#NUM!"),
        ("=NORMDIST(1,0,-1,FALSE)", "#NUM!"),
        ("=NORM.INV(0,0,1)", "#NUM!"),
        ("=NORM.INV(1,0,1)", "#NUM!"),
        ("=NORMINV(0.5,0,0)", "#NUM!"),
        ("=NORM.S.INV(-0.1)", "#NUM!"),
        ("=NORM.S.INV(0)", "#NUM!"),
        ("=NORMSINV(1)", "#NUM!"),
        ("=LOGNORM.DIST(0,0,1,TRUE)", "#NUM!"),
        ("=LOGNORMDIST(-1,0,1)", "#NUM!"),
        ("=LOGNORM.DIST(1,0,0,FALSE)", "#NUM!"),
        ("=LOGNORM.INV(0,0,1)", "#NUM!"),
        ("=LOGINV(1,0,1)", "#NUM!"),
        ("=LOGNORM.INV(0.5,0,-1)", "#NUM!"),
        ("=STANDARDIZE(1,0,0)", "#NUM!"),
        ("=STANDARDIZE(1,0,-1)", "#NUM!"),
        ("=NORM.DIST(\"TRUE\",0,1,TRUE)", "#VALUE!"),
        ("=NORM.S.INV(\"FALSE\")", "#VALUE!"),
        ("=LOGNORM.DIST(1,0,1,\"bad\")", "#VALUE!"),
        ("=NORM.DIST(\" \",0,1,TRUE)", "#VALUE!"),
        ("=NORM.DIST({#N/A},0,{#DIV/0!},TRUE)", "#N/A"),
        ("=LOGNORM.DIST(\"bad\",0,{#REF!},TRUE)", "#REF!"),
        ("=NORM.S.INV(NA(),2)", "#ERROR!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn normal_arrays_keep_types_errors_and_broadcast_parameters() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "1"),
            (0, 0, 1, "' "),
            (0, 0, 2, "1.23"),
            (0, 0, 3, "TRUE"),
            (0, 0, 4, "FALSE"),
            (0, 1, 0, "0"),
            (0, 1, 1, "'100"),
            (0, 1, 2, "'2.34"),
            (0, 1, 3, "test"),
            (0, 1, 4, "-3"),
            (0, 1, 5, "=#NAME?"),
            (0, 4, 0, "=LOGNORM.DIST(A1:F2,6,4,TRUE)"),
            (0, 8, 0, "=NORM.DIST({0;1},{0,1},{1;2},{FALSE;TRUE})"),
            (0, 12, 0, "=NORM.S.INV({0.5;0;0.7})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, e) in [
        (4, 1, "#VALUE!"),
        (4, 4, "#NUM!"),
        (4, 5, "#NUM!"),
        (5, 0, "#NUM!"),
        (5, 3, "#VALUE!"),
        (5, 4, "#NUM!"),
        (5, 5, "#NAME?"),
        (13, 0, "#NUM!"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), e);
    }
    for (r, c, n) in [
        (4, 0, 0.06680720126885809),
        (4, 2, 0.07377406798431951),
        (4, 3, 0.06680720126885809),
        (5, 1, 0.36365447401019085),
        (5, 2, 0.09896660651880765),
        (8, 0, 0.3989422804014327),
        (8, 1, 0.24197072451914337),
        (9, 0, 0.6914624612740131),
        (9, 1, 0.5),
        (12, 0, 0.),
        (14, 0, 0.5244005127080407),
    ] {
        near(&book, r, c, n);
    }
}

#[test]
fn normal_extreme_scales_retain_finite_results() {
    let mut book = Spreadsheet::new();
    for (formula, n) in [
        ("=STANDARDIZE(1E308,-1E308,1E308)", 2.),
        ("=NORM.INV(0.9772498680518208,-1E308,1E308)", 1e308),
        ("=NORM.DIST(1E308,-1E308,1E308,TRUE)", 0.9772498680518208),
        (
            "=NORM.DIST(1E308,-1E308,1E308,FALSE)",
            5.399096651318806e-310,
        ),
        ("=NORM.DIST(40E-300,0,1E-300,FALSE)", 1.463270250838303e-48),
        ("=NORM.S.INV(1E-300)", -37.0470962993612),
        ("=NORM.S.DIST(NORM.S.INV(1E-100),TRUE)", 1e-100),
        (
            "=LOGNORM.DIST(1E-300,LN(1E-300),1,FALSE)",
            3.989422804014327e299,
        ),
        (
            "=LOGNORM.DIST(1E300,LN(1E300),1,FALSE)",
            3.989422804014327e-301,
        ),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(&book, 0, 0, n);
    }
}

#[test]
fn normal_table_arrays_roundtrip_and_recalculate() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, "Observation"), (0, 1, 0, "1"), (0, 2, 0, "2")],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Samples", [0, 0, 2, 0], LIMIT).unwrap();
    book.edit(
        &[
            (0, 1, 2, "=NORM.DIST(Samples[Observation],0,1,TRUE)"),
            (0, 1, 4, "=NORM.S.INV(C2#)"),
            (0, 1, 6, "=LOGNORM.DIST(Samples[Observation],0,1,TRUE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&restored, 1, 2, 0.8413447460685429);
        near(&restored, 2, 4, 2.);
        near(&restored, 1, 6, 0.5);
        restored.edit(&[(0, 1, 0, "0")], LIMIT).unwrap();
        near(&restored, 1, 2, 0.5);
        near(&restored, 1, 4, 0.);
        assert_eq!(restored.display(0, 1, 6, LIMIT).unwrap(), "#NUM!");
    }
}

#[test]
fn normal_arrays_fail_atomically_at_the_work_limit() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "saved")], LIMIT).unwrap();
    let before = book.to_json();
    for f in [
        "=NORM.DIST(SEQUENCE(100000),0,1,TRUE)",
        "=LOGNORM.DIST(A:A,0,1,TRUE)",
    ] {
        assert!(book.edit(&[(0, 0, 2, f)], 1000).is_err());
        assert_eq!(book.to_json(), before);
    }
}

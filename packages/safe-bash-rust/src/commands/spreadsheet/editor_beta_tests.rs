// Contracts from IronCalc f936620 and Univer 4767b3b beta tests.
// See LICENSE.IronCalc and LICENSE.Univer. Reference values use binary64
// SciPy 1.13.1, exact beta polynomials, and the uniform distribution.
use super::{Spreadsheet, Value};
const LIMIT: usize = 128 * 1024 * 1024;
fn number(b: &Spreadsheet, r: usize, c: usize) -> f64 {
    match b.cell(0, r, c).and_then(|c| c.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!("{},{}: {}", r, c, b.display(0, r, c, LIMIT).unwrap()),
    }
}
fn near(b: &Spreadsheet, r: usize, c: usize, expected: f64) {
    let actual = number(b, r, c);
    assert!(
        (actual - expected).abs() <= expected.abs() * 3e-12,
        "{actual:e} != {expected:e}"
    );
}
#[test]
fn beta_distributions_inverses_and_optional_intervals() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=BETA.DIST(0.23,2,3,TRUE)", 0.22845923),
        ("=BETA.DIST(2,8,10,TRUE,1,3)", 0.6854705810546875),
        ("=BETA.DIST(2,8,10,FALSE,1,3)", 1.4837646484375),
        ("=BETA.INV(0.6854705810546875,8,10,1,3)", 2.),
        ("=BETADIST(2,8,10,1,3)", 0.6854705810546875),
        ("=BETAINV(0.6854705810546875,8,10,1,3)", 2.),
        ("=BETA.DIST(0.23,2,3,TRUE,,1)", 0.22845923),
        ("=BETA.DIST(0.23,2,3,TRUE,0,)", 0.22845923),
        ("=BETA.INV(0.5,2,2,,)", 0.5),
        ("=BETA.DIST(0.234,2,2.5,,0.15,1.2)", 0.5882886668596943),
        ("=BETA.DIST(0.234,2,2.5,Z1,0.15,1.2)", 0.5882886668596943),
        ("=BETA.DIST(0,1,3,FALSE)", 3.),
        ("=BETA.DIST(1,3,1,FALSE)", 3.),
        ("=BETA.DIST(0,2,3,FALSE)", 0.),
        ("=BETA.DIST(1,2,3,FALSE)", 0.),
        ("=BETA.DIST(0,1,1,FALSE)", 1.),
        ("=BETA.DIST(1,1,1,FALSE)", 1.),
        ("=BETA.DIST(0.5,0.1,0.1,FALSE)", 0.17663027797787373),
        ("=BETA.DIST(0.5,520,520,FALSE)", 25.724819337162778),
        ("=BETA.DIST(0.5,350,350,FALSE)", 21.102503276491962),
        ("=BETA.INV(0.25,1,1,-2,2)", -1.),
        ("=BETA.DIST(\"0.23\",\"2\",\"3\",\"TRUE\")", 0.22845923),
        ("=BETA.DIST(TRUE,1,1,TRUE)", 1.),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, e);
    }
}
#[test]
fn beta_argument_type_domain_and_source_errors() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=BETA.DIST()", "#ERROR!"),
        ("=BETA.DIST(1,2,3)", "#ERROR!"),
        ("=BETA.DIST(1,2,3,TRUE,0,1,2)", "#ERROR!"),
        ("=BETA.INV(0.5,2)", "#ERROR!"),
        ("=BETADIST(1,2)", "#ERROR!"),
        ("=BETAINV(0.5,2,2,0,1,2)", "#ERROR!"),
        ("=BETA.INV(0,2,3)", "#NUM!"),
        ("=BETA.INV(1,2,3)", "#NUM!"),
        ("=BETA.DIST(2,2,3,TRUE)", "#NUM!"),
        ("=BETA.DIST(-1,2,3,TRUE)", "#NUM!"),
        ("=BETA.DIST(0.5,0,3,TRUE)", "#NUM!"),
        ("=BETA.INV(0.5,1,-1)", "#NUM!"),
        ("=BETA.DIST(0.5,1,1,TRUE,1,0)", "#NUM!"),
        ("=BETA.DIST(0.5,1,1,TRUE,0,Z1)", "#NUM!"),
        ("=BETA.DIST(0,0.5,1,FALSE)", "#NUM!"),
        ("=BETA.DIST(1,1,0.5,FALSE)", "#NUM!"),
        ("=BETA.DIST(\"TRUE\",1,1,TRUE)", "#VALUE!"),
        ("=BETA.DIST(0.5,1,1,\"bad\")", "#VALUE!"),
        ("=BETA.DIST(0.5,1,1,TRUE,0,#REF!)", "#REF!"),
        ("=BETA.INV(#N/A,1,1)", "#N/A"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}
#[test]
fn beta_table_arrays_source_edits_and_reopening() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Value"),
            (0, 1, 0, "0.25"),
            (0, 2, 0, "0.5"),
            (0, 3, 0, "0.75"),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Samples", [0, 0, 3, 0], LIMIT).unwrap();
    b.edit(
        &[
            (0, 1, 2, "=BETA.DIST(Samples[Value],2,2,{FALSE,TRUE})"),
            (0, 1, 5, "=BETA.INV(Samples[Value],1,1,{-2,0},{2,10})"),
            (0, 6, 0, "=BETA.DIST({0.5,#N/A,2},2,2,TRUE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut x in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&x, 1, 2, 1.125);
        near(&x, 1, 3, 0.15625);
        near(&x, 3, 3, 0.84375);
        near(&x, 1, 5, -1.);
        near(&x, 3, 6, 7.5);
        assert_eq!(x.display(0, 6, 1, LIMIT).unwrap(), "#N/A");
        assert_eq!(x.display(0, 6, 2, LIMIT).unwrap(), "#NUM!");
        x.edit(&[(0, 1, 0, "0.5")], LIMIT).unwrap();
        near(&x, 1, 2, 1.5);
        near(&x, 1, 3, 0.5);
    }
}
#[test]
fn beta_extreme_scales_and_budget_rollback() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=BETA.DIST(1E-150,2,1,TRUE)", 1e-300),
        ("=BETA.INV(1E-300,2,1)", 1e-150),
        ("=BETA.INV(1E-200,0.5,1)", 0.),
        ("=BETA.DIST(0.5,10000000000,10000000000,TRUE)", 0.5),
        (
            "=BETA.DIST(0.5,10000000000,10000000000,FALSE)",
            112837.91670814079,
        ),
        ("=BETA.DIST(0,1,1,TRUE,-1E308,1E308)", 0.5),
        ("=BETA.DIST(-1E308,1,1E308,FALSE,-1E308,1E308)", 0.5),
        ("=BETA.DIST(0,1,1,FALSE,-1E308,1E308)", 5e-309),
        ("=BETA.INV(0.75,1,1,-1E308,1E308)", 5e307),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, e);
    }
    let before = b.to_json();
    assert!(
        b.edit(&[(0, 0, 0, "=BETA.INV(0.123,1000,1000)")], 100)
            .is_err()
    );
    assert_eq!(b.to_json(), before);
}

#[test]
fn beta_scaled_intervals_preserve_values_beyond_normalized_f64_range() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=BETA.DIST(1E-200,0.5,1,TRUE,0,1E200)", 1e-200),
        ("=BETA.DIST(1E-200,0.5,1,FALSE,0,1E200)", 0.5),
        ("=BETA.INV(1E-200,0.5,1,0,1E200)", 1e-200),
        ("=BETA.INV(0.5,1E20,2,-1E20,0)", -1.6783469900166612),
        ("=BETA.INV(0.99,1,0.01,-1E200,0)", -1.0000000000000984),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, e);
    }
}

#[test]
fn beta_inverse_tiny_probabilities_use_the_tail_not_a_normal_approximation() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=BETA.INV(1E-300,2,2)", 5.773502691896258e-151),
        ("=BETA.INV(1E-150,0.5,2)", 4.444444444444444e-301),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, e);
    }
}

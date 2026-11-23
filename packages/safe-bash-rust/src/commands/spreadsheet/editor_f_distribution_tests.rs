// IronCalc f936620 statistical/fisher.rs and Univer 4767b3b f-* contracts.
// See LICENSE.IronCalc and LICENSE.Univer. Numerical references include exact
// F(1,1)/F(2,2) identities and SciPy 1.13.1.
use super::{Spreadsheet, Value};
const LIMIT: usize = 128 * 1024 * 1024;
fn number(b: &Spreadsheet, r: usize, c: usize) -> f64 {
    match b.cell(0, r, c).and_then(|c| c.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!("{r},{c}: {}", b.display(0, r, c, LIMIT).unwrap()),
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
fn f_distribution_scalar_legacy_and_endpoint_contracts() {
    let mut b = Spreadsheet::new();
    for (formula, expected) in [
        ("=F.DIST(15,6,4,TRUE)", 0.9897419523940192),
        ("=F.DIST(15,6,4,FALSE)", 0.001271446907932906),
        ("=F.DIST.RT(15,6,4)", 0.010258047605980844),
        ("=FDIST(15,6,4)", 0.010258047605980844),
        ("=F.INV(0.9897419523940192,6,4)", 15.),
        ("=F.INV.RT(0.010258047605980844,6,4)", 15.),
        ("=FINV(0.010258047605980844,6,4)", 15.),
        ("=F.DIST(0,2,4,FALSE)", 1.),
        ("=F.DIST(0,4,4,FALSE)", 0.),
        ("=F.DIST(0,1,1,TRUE)", 0.),
        ("=F.DIST.RT(0,1,1)", 1.),
        ("=F.INV(0,2,3)", 0.),
        ("=F.INV.RT(1,2,3)", 0.),
        ("=F.DIST(1,2.9,2.9,TRUE)", 0.5),
        ("=F.DIST(\"1\",\"2\",\"2\",\"TRUE\")", 0.5),
        ("=F.DIST(TRUE,TRUE,TRUE,TRUE)", 0.5),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(&b, 0, 0, expected);
    }
}
#[test]
fn f_distribution_type_domain_and_arity_errors() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=F.DIST(1,2,3)", "#ERROR!"),
        ("=F.INV(0.5,2)", "#ERROR!"),
        ("=FDIST(1,2,3,TRUE)", "#ERROR!"),
        ("=FINV()", "#ERROR!"),
        ("=F.DIST(-1,2,2,TRUE)", "#NUM!"),
        ("=F.DIST(0,1,2,FALSE)", "#NUM!"),
        ("=F.INV(1,2,2)", "#NUM!"),
        ("=F.INV.RT(0,2,2)", "#NUM!"),
        ("=F.INV(-0.1,2,2)", "#NUM!"),
        ("=F.INV.RT(1.1,2,2)", "#NUM!"),
        ("=F.DIST(1,0,2,TRUE)", "#NUM!"),
        ("=F.DIST(1,2,10000000001,TRUE)", "#NUM!"),
        ("=F.DIST(\"TRUE\",2,2,TRUE)", "#VALUE!"),
        ("=F.DIST(1,2,2,\"bad\")", "#VALUE!"),
        ("=F.DIST(1,#REF!,2,TRUE)", "#REF!"),
        ("=F.TEST({1,2})", "#ERROR!"),
        ("=FTEST(1,{1,2})", "#DIV/0!"),
        ("=F.TEST({1,1},{1,2})", "#DIV/0!"),
        ("=F.TEST({TRUE,\"2\"},{1,2})", "#DIV/0!"),
        ("=F.TEST({1,#REF!},{1,2})", "#REF!"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}
#[test]
fn f_test_unequal_independent_samples_and_ignored_positions() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        (
            "=F.TEST({9,12,14,16,18,20},{11,10,15,17,19,21})",
            0.8592843017856634,
        ),
        ("=F.TEST({1,2,3,\"4\",TRUE},{1,2,3,4})", 0.7926367789592619),
        ("=F.TEST({-1,1},{-1,0,1})", 0.5857864376269049),
        ("=F.TEST({-1,0,1},{-1,1})", 0.5857864376269049),
        ("=FTEST({1,2,3},{2,4,6})", 0.4),
        (
            "=F.TEST({58,35;11,25;10,23},{45.35,47.65;17.56,18.44;16.09,16.91})",
            0.7283721824914722,
        ),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, e);
    }
}
#[test]
fn f_distribution_tails_large_degrees_and_variance_scales() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=F.DIST(1E-300,1,1,TRUE)", 6.366197723675814e-151),
        ("=F.DIST.RT(1E300,1,1)", 6.366197723675814e-151),
        ("=F.DIST(1E150,2,2,FALSE)", 1e-300),
        ("=F.INV(1E-150,1,1)", 2.4674011002723395e-300),
        ("=F.INV.RT(1E-150,1,1)", 4.052847345693511e299),
        ("=F.DIST(1,10000000000,10000000000,TRUE)", 0.5),
        ("=F.INV(0.5,10000000000,10000000000)", 1.),
        (
            "=F.DIST(1,10000000000,10000000000,FALSE)",
            19947.11401957296,
        ),
        (
            "=F.TEST({1E-300,2E-300,3E-300},{2E-300,4E-300,6E-300})",
            0.4,
        ),
        ("=F.TEST({1E300,2E300,3E300},{2E300,4E300,6E300})", 0.4),
        ("=F.TEST({-1E308,1E308},{-5E307,5E307})", 0.590334470601733),
        ("=F.TEST({0,1E150},{0,1E-150})", 1.2732395447351627e-300),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, e);
    }
    b.edit(&[(0, 0, 0, "=F.INV(1E-160,1,10000000000)")], LIMIT)
        .unwrap();
    assert!(
        number(&b, 0, 0)
            .to_bits()
            .abs_diff(1.5706e-320_f64.to_bits())
            <= 1
    );
    let before = b.to_json();
    assert!(
        b.edit(&[(0, 0, 0, "=F.INV(0.123,1000,1000)")], 100)
            .is_err()
    );
    assert_eq!(b.to_json(), before);
}
#[test]
fn f_distribution_tables_spills_and_reopening() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "One"),
            (0, 0, 1, "Two"),
            (0, 1, 0, "1"),
            (0, 1, 1, "2"),
            (0, 2, 0, "2"),
            (0, 2, 1, "4"),
            (0, 3, 0, "3"),
            (0, 3, 1, "6"),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Samples", [0, 0, 3, 1], LIMIT).unwrap();
    b.edit(
        &[
            (0, 1, 3, "=F.TEST(Samples[One],Samples[Two])"),
            (0, 1, 5, "=F.DIST(Samples[One],2,2,{FALSE,TRUE})"),
            (0, 6, 0, "=F.DIST({1,#N/A,-1},2,2,TRUE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut x in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&x, 1, 3, 0.4);
        near(&x, 1, 5, 0.25);
        near(&x, 3, 6, 0.75);
        assert_eq!(x.display(0, 6, 1, LIMIT).unwrap(), "#N/A");
        assert_eq!(x.display(0, 6, 2, LIMIT).unwrap(), "#NUM!");
        x.edit(&[(0, 1, 0, "2"), (0, 2, 0, "4"), (0, 3, 0, "6")], LIMIT)
            .unwrap();
        near(&x, 1, 3, 1.);
        near(&x, 3, 6, 6. / 7.);
    }
}
#[test]
fn f_test_sparse_columns_and_delayed_spills() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 9998, 0, "1"),
            (0, 9999, 0, "2"),
            (0, 9998, 1, "2"),
            (0, 9999, 1, "4"),
            (0, 0, 3, "=F.TEST(A:A,B:B)"),
        ],
        100_000,
    )
    .unwrap();
    near(&b, 0, 3, 0.590334470601733);
    b.edit(
        &[
            (0, 0, 7, "=F.TEST(J10:J12,K10:K12)"),
            (0, 8, 9, "=SEQUENCE(4)"),
            (0, 8, 10, "=SEQUENCE(4,1,2,2)"),
        ],
        LIMIT,
    )
    .unwrap();
    near(&b, 0, 7, 0.4);
    b.edit(&[(0, 8, 10, "=SEQUENCE(4)")], LIMIT).unwrap();
    near(&b, 0, 7, 1.);
}

#[test]
fn f_distribution_independent_references_and_inverse_roundtrips() {
    let cases: &[[f64; 6]] = include!("office_formula_f_reference.rs");
    let mut b = Spreadsheet::new();
    for &[x, d1, d2, lower, upper, density] in cases {
        for (f, expected) in [
            (format!("=F.DIST({x},{d1},{d2},TRUE)"), lower),
            (format!("=F.DIST.RT({x},{d1},{d2})"), upper),
            (format!("=F.DIST({x},{d1},{d2},FALSE)"), density),
        ] {
            b.edit(&[(0, 0, 0, &f)], LIMIT).unwrap();
            let actual = number(&b, 0, 0);
            assert!(
                (actual - expected).abs() <= expected.abs() * 2e-11 + 1e-320,
                "{f}: {actual:e} != {expected:e}"
            );
        }
        for (p, name) in [(lower, "F.INV"), (upper, "F.INV.RT")] {
            if !(1e-250..=0.99).contains(&p) {
                continue;
            }
            let f = format!("={name}({p},{d1},{d2})");
            b.edit(&[(0, 0, 0, &f)], LIMIT).unwrap();
            let actual = number(&b, 0, 0);
            assert!((actual - x).abs() <= x * 2e-10, "{f}: {actual:e} != {x:e}");
        }
    }
}

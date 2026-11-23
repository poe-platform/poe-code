// Contracts adapted from IronCalc f936620 t_dist.rs and Univer 4767b3b
// statistical/t-*; see LICENSE.IronCalc and LICENSE.Univer. Independent numeric
// references: SciPy 1.13.1 and exact Cauchy (one degree of freedom) identities.
use super::{Spreadsheet, Value};
const LIMIT: usize = 128 * 1024 * 1024;
fn number(b: &Spreadsheet, r: usize, c: usize) -> f64 {
    match b.cell(0, r, c).and_then(|c| c.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!("{r},{c}: {}", b.display(0, r, c, LIMIT).unwrap()),
    }
}
fn near(b: &Spreadsheet, r: usize, c: usize, e: f64) {
    let actual = number(b, r, c);
    assert!(
        (actual - e).abs() <= e.abs() * 4e-12 + 2. * f64::from_bits(1),
        "{actual:e} != {e:e}"
    );
}
#[test]
fn student_t_scalar_legacy_and_endpoints() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=T.DIST(2,10,TRUE)", 0.9633059826146297),
        ("=T.DIST(2,10,FALSE)", 0.06114576632121821),
        ("=T.DIST(-2,10,TRUE)", 0.036694017385370196),
        ("=T.DIST.RT(-2,10)", 0.9633059826146297),
        ("=T.DIST.RT(2,10)", 0.036694017385370196),
        ("=T.DIST.2T(2,10)", 0.07338803477074039),
        ("=T.INV(0.95,10)", 1.8124611228116764),
        ("=T.INV(0.05,10)", -1.8124611228116764),
        ("=T.INV.2T(0.05,10)", 2.2281388519862744),
        ("=TINV(0.05,10)", 2.2281388519862744),
        ("=TDIST(2,10,1)", 0.036694017385370196),
        ("=TDIST(2,10,2.9)", 0.07338803477074039),
        ("=T.DIST(0,10,TRUE)", 0.5),
        ("=T.DIST.RT(0,10)", 0.5),
        ("=T.DIST.2T(0,10)", 1.),
        ("=T.INV(0.5,10)", 0.),
        ("=T.INV.2T(1,10)", 0.),
        ("=T.DIST(TRUE,TRUE,TRUE)", 0.75),
        ("=T.DIST(\"1\",\"1.9\",\"TRUE\")", 0.75),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, e);
    }
}
#[test]
fn student_t_type_domain_and_arity_errors() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=T.DIST(2,10)", "#ERROR!"),
        ("=T.INV(0.5)", "#ERROR!"),
        ("=T.DIST.RT(2,10,TRUE)", "#ERROR!"),
        ("=T.TEST({1,2},{2,3},2)", "#ERROR!"),
        ("=TDIST(1,2,3)", "#NUM!"),
        ("=TDIST(-1,2,1)", "#NUM!"),
        ("=T.DIST.2T(-1,2)", "#NUM!"),
        ("=T.INV(0,10)", "#NUM!"),
        ("=T.INV(1,10)", "#NUM!"),
        ("=T.INV.2T(0,10)", "#NUM!"),
        ("=T.INV.2T(1.1,10)", "#NUM!"),
        ("=T.DIST(1,0,TRUE)", "#NUM!"),
        ("=T.INV(0.5,10000000001)", "#NUM!"),
        ("=T.DIST.RT(1,10000000001)", "#NUM!"),
        ("=T.DIST(\"TRUE\",2,TRUE)", "#VALUE!"),
        ("=T.DIST(1,2,\"bad\")", "#VALUE!"),
        ("=T.DIST(1,#REF!,TRUE)", "#REF!"),
        ("=T.TEST({1,2},{2,3},0,1)", "#NUM!"),
        ("=T.TEST({1,2},{2,3},2,4)", "#NUM!"),
        ("=T.TEST({1,2},{2,3,4},2,1)", "#N/A"),
        ("=T.TEST({1,2},{2,3},2,1)", "#DIV/0!"),
        ("=T.TEST({1,1},{2,2},2,2)", "#DIV/0!"),
        ("=T.TEST({1,1},{2,2},2,3)", "#DIV/0!"),
        ("=T.TEST(1,{2,3},2,2)", "#DIV/0!"),
        ("=T.TEST({1,#REF!},{2,3},2,3)", "#REF!"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}
#[test]
fn student_t_paired_pooled_welch_and_control_arrays() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[(
            0,
            0,
            0,
            "=T.TEST({3,4,5,6,10,3,2,4,7},{6,19,3,2,13,4,5,17,3},{1;2},{1,2,3})",
        )],
        LIMIT,
    )
    .unwrap();
    for (c, e) in [0.2076737766262283, 0.2004891974380108, 0.21072063898626894]
        .into_iter()
        .enumerate()
    {
        near(&b, 0, c, e / 2.);
        near(&b, 1, c, e);
    }
    for (f, e) in [
        ("=TTEST({1,2,3},{2,4,6},2,1)", 0.07417990022744853),
        (
            "=T.TEST({1,\"ignored\",3},{2,100,6},2,1)",
            0.2951672353008664,
        ),
        ("=T.TEST({-10,1;-8,3},{1,2},2,2)", 0.36090710624013156),
        ("=T.TEST({-10,1;-8,3},{1,2},2,3)", 0.21930610218284027),
        ("=T.TEST({1,1},{2,3},2,2)", 0.09546596626670913),
        ("=T.TEST({1,1},{2,3},2,3)", 0.20483276469913345),
        ("=T.TEST({1,2,3},{1,2,3},2,2)", 1.),
        (
            "=T.TEST({1,2,3},{2,4,6},\"2.9\",\"1.9\")",
            0.07417990022744853,
        ),
    ] {
        b.edit(&[(0, 4, 0, f)], LIMIT).unwrap();
        near(&b, 4, 0, e);
    }
    b.edit(
        &[(
            0,
            8,
            0,
            "=T.TEST({1,2,3},{2,4,6},{1,2,0,TRUE,FALSE,\"bad\",#REF!},1)",
        )],
        LIMIT,
    )
    .unwrap();
    for (c, e) in [
        (0, 0.037089950113724265),
        (1, 0.07417990022744853),
        (3, 0.037089950113724265),
    ] {
        near(&b, 8, c, e);
    }
    for (c, e) in [(2, "#NUM!"), (4, "#NUM!"), (5, "#VALUE!"), (6, "#REF!")] {
        assert_eq!(b.display(0, 8, c, LIMIT).unwrap(), e);
    }
}
#[test]
fn student_t_extreme_tails_and_scaled_samples() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=T.DIST.RT(1E300,1)", 3.183098861837907e-301),
        ("=T.DIST.2T(1E300,1)", 6.366197723675814e-301),
        ("=T.DIST(-1E300,1,TRUE)", 3.183098861837907e-301),
        ("=T.DIST(1E150,1,FALSE)", 3.183098861837907e-301),
        ("=T.INV(1E-300,1)", -3.183098861837907e299),
        ("=T.INV.2T(1E-300,1)", 6.366197723675814e299),
        ("=T.DIST(0,1E20,FALSE)", 0.3989422804014327),
        ("=T.DIST(1,1E308,TRUE)", 0.8413447460685429),
        ("=T.DIST(-38,1E308,TRUE)", 2.88542835e-316),
        (
            "=T.TEST({1E300,2E300,3E300},{2E300,4E300,6E300},2,1)",
            0.07417990022744853,
        ),
        (
            "=T.TEST({1E-300,2E-300,3E-300},{2E-300,4E-300,6E-300},2,1)",
            0.07417990022744853,
        ),
        (
            "=T.TEST({1E300,2E300,3E300},{2E300,4E300,6E300},2,2)",
            0.19626117814926947,
        ),
        (
            "=T.TEST({1E-300,2E-300,3E-300},{2E-300,4E-300,6E-300},2,3)",
            0.2208808404940958,
        ),
        ("=T.TEST({-1E308,1E308},{-5E307,5E307},2,2)", 1.),
        ("=T.TEST({1E308,0},{-1E308,0},2,1)", 0.5),
        ("=T.TEST({1,1},{0,1E-300},2,3)", 3.183098861837907e-301),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, e);
    }
    let before = b.to_json();
    assert!(b.edit(&[(0, 0, 0, "=T.INV(0.123,1000)")], 100).is_err());
    assert_eq!(b.to_json(), before);
}
#[test]
fn student_t_tables_spills_and_reopening() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "First"),
            (0, 0, 1, "Second"),
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
            (0, 1, 3, "=T.TEST(Samples[First],Samples[Second],2,{1,2,3})"),
            (0, 6, 0, "=T.DIST(Samples[First],1,{FALSE,TRUE})"),
            (0, 10, 0, "=T.DIST({0,#N/A,1},1,TRUE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut x in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&x, 1, 3, 0.07417990022744853);
        near(&x, 1, 4, 0.19626117814926947);
        near(&x, 1, 5, 0.2208808404940958);
        near(&x, 6, 1, 0.75);
        near(&x, 10, 0, 0.5);
        assert_eq!(x.display(0, 10, 1, LIMIT).unwrap(), "#N/A");
        x.edit(&[(0, 1, 0, "2"), (0, 2, 0, "4"), (0, 3, 0, "6")], LIMIT)
            .unwrap();
        near(&x, 1, 4, 1.);
        near(&x, 1, 5, 1.);
        assert_eq!(x.display(0, 1, 3, LIMIT).unwrap(), "#DIV/0!");
    }
}
#[test]
fn student_t_sparse_columns_and_delayed_spills() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 9997, 0, "1"),
            (0, 9998, 0, "2"),
            (0, 9999, 0, "3"),
            (0, 9997, 1, "2"),
            (0, 9998, 1, "4"),
            (0, 9999, 1, "6"),
            (0, 0, 3, "=T.TEST(A:A,B:B,2,1)"),
        ],
        100_000,
    )
    .unwrap();
    near(&b, 0, 3, 0.07417990022744853);
    b.edit(
        &[
            (0, 0, 7, "=T.TEST(J10:J12,K10:K12,2,3)"),
            (0, 9, 9, "=SEQUENCE(3)"),
            (0, 9, 10, "=SEQUENCE(3,1,2,2)"),
        ],
        LIMIT,
    )
    .unwrap();
    near(&b, 0, 7, 0.2208808404940958);
}

#[test]
fn student_t_reference_grid_and_inverse_roundtrips() {
    let cases: &[[f64; 5]] = include!("office_formula_t_reference.rs");
    let mut b = Spreadsheet::new();
    for &[x, df, lower, upper, density] in cases {
        for (f, e) in [
            (format!("=T.DIST({x},{df},TRUE)"), lower),
            (format!("=T.DIST.RT({x},{df})"), upper),
            (format!("=T.DIST({x},{df},FALSE)"), density),
        ] {
            b.edit(&[(0, 0, 0, &f)], LIMIT).unwrap();
            let actual = number(&b, 0, 0);
            assert!(
                (actual - e).abs() <= e.abs() * 3e-11 + 1e-320,
                "{f}: {actual:e} != {e:e}"
            );
        }
        if x > 0. && upper >= 1e-150 {
            let f = format!("=T.INV.2T({}, {df})", upper * 2.);
            b.edit(&[(0, 0, 0, &f)], LIMIT).unwrap();
            let actual = number(&b, 0, 0);
            assert!((actual - x).abs() <= x * 3e-10, "{f}: {actual:e} != {x:e}");
        }
    }
}

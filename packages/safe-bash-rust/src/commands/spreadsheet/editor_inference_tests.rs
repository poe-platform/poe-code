// Contracts from IronCalc f936620 statistical/{normal,t_dist,z_test}.rs and
// Univer 4767b3b statistical/{confidence-norm,confidence-t,z-test}.
// See LICENSE.IronCalc and LICENSE.Univer. Normal references use SciPy 1.13.1.
// Student quantiles are verified by 75-digit Decimal integration (odd degrees)
// and the closed-form degree-2 survival probability; SciPy inverse differs.
use super::{Spreadsheet, Value};
const LIMIT: usize = 128 * 1024 * 1024;
fn near(b: &Spreadsheet, r: usize, c: usize, e: f64) {
    let n = match b.cell(0, r, c).and_then(|c| c.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!("{r},{c}: {}", b.display(0, r, c, LIMIT).unwrap()),
    };
    assert!(
        (n - e).abs() <= e.abs() * 4e-12 + 2. * f64::from_bits(1),
        "{n:e} != {e:e}"
    );
}
#[test]
fn confidence_scalar_alias_and_truncated_size() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=CONFIDENCE.NORM(0.05,2.5,50)", 0.6929519121748389),
        ("=CONFIDENCE(0.05,2.5,50.9)", 0.6929519121748389),
        ("=CONFIDENCE.NORM(0.05,2.5,1)", 4.899909961350135),
        ("=CONFIDENCE.T(0.05,2.5,50)", 0.7104921387393248),
        ("=CONFIDENCE.T(0.05,50000,100)", 9921.084757932087),
        ("=CONFIDENCE.T(0.3,0.5,2.9)", 0.693887598635325),
        ("=CONFIDENCE.NORM(\"0.05\",TRUE,TRUE)", 1.959963984540054),
        ("=Z.TEST({3,6,7,8,6,5,4,2,1,9},4)", 0.09057419685136381),
        ("=ZTEST({3,6,7,8,6,5,4,2,1,9},6)", 0.86304338912953),
        ("=Z.TEST({5,2,3,4},4,123)", 0.5032433974434887),
        ("=Z.TEST({5,2,3,4},4)", 0.7807109869595001),
        ("=Z.TEST({1,\"20\",TRUE,3},2)", 0.5),
        ("=Z.TEST(3,3,1)", 0.5),
        ("=Z.TEST({3,3},3,1)", 0.5),
        ("=Z.TEST({3,4},\"3.5\",TRUE)", 0.5),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, e);
    }
}
#[test]
fn inference_type_domain_arity_and_missing_arguments() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=CONFIDENCE.NORM()", "#ERROR!"),
        ("=CONFIDENCE.T(0.3,1)", "#ERROR!"),
        ("=CONFIDENCE(0.3,1,2,4)", "#ERROR!"),
        ("=Z.TEST({1,2})", "#ERROR!"),
        ("=Z.TEST({1,2},1,2,3)", "#ERROR!"),
        ("=CONFIDENCE.NORM(0,1,2)", "#NUM!"),
        ("=CONFIDENCE.T(1,1,2)", "#NUM!"),
        ("=CONFIDENCE.NORM(0.05,0,2)", "#NUM!"),
        ("=CONFIDENCE.T(0.05,-1,2)", "#NUM!"),
        ("=CONFIDENCE.T(0.05,1,0.99)", "#NUM!"),
        ("=CONFIDENCE.T(0.05,1,1.9)", "#DIV/0!"),
        ("=CONFIDENCE.NORM(\"TRUE\",1,2)", "#VALUE!"),
        ("=CONFIDENCE.T(0.05,\" \",2)", "#VALUE!"),
        ("=CONFIDENCE.NORM(0.05,1,#REF!)", "#REF!"),
        ("=Z.TEST({\"1\",TRUE},1)", "#N/A"),
        ("=Z.TEST(A100:A103,1)", "#N/A"),
        ("=Z.TEST({1},1)", "#DIV/0!"),
        ("=Z.TEST({1,1},1)", "#DIV/0!"),
        ("=Z.TEST({1,2},1,0)", "#NUM!"),
        ("=Z.TEST({1,2},1,-1)", "#NUM!"),
        ("=Z.TEST({1,2},1,)", "#NUM!"),
        ("=Z.TEST({1,2},1,A100)", "#NUM!"),
        ("=Z.TEST({1,2},\"bad\")", "#VALUE!"),
        ("=Z.TEST({1,2},1,\"TRUE\")", "#VALUE!"),
        ("=Z.TEST({1,#REF!},1)", "#REF!"),
        ("=Z.TEST({1,2},#N/A)", "#N/A"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}
#[test]
fn inference_arrays_keep_shape_and_per_cell_errors() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=CONFIDENCE.T({0.05,0,#REF!,\"bad\"},2.5,{50;1})"),
            (0, 4, 0, "=Z.TEST({1,2,3},{2;3},{1,0,#N/A,\"bad\"})"),
        ],
        LIMIT,
    )
    .unwrap();
    near(&b, 0, 0, 0.7104921387393248);
    near(&b, 4, 0, 0.5);
    near(&b, 5, 0, 0.9583677416682248);
    for (r, c, e) in [
        (0, 1, "#NUM!"),
        (0, 2, "#REF!"),
        (0, 3, "#VALUE!"),
        (1, 0, "#DIV/0!"),
        (4, 1, "#NUM!"),
        (5, 1, "#NUM!"),
        (4, 2, "#N/A"),
        (4, 3, "#VALUE!"),
    ] {
        assert_eq!(b.display(0, r, c, LIMIT).unwrap(), e);
    }
}
#[test]
fn inference_extreme_scales_and_direct_small_tails() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=CONFIDENCE.NORM(1E-300,1,1)", 37.06578788077213),
        (
            "=CONFIDENCE.NORM(1E-300*4.940656458412465E-24,1,1)",
            38.485408335567335,
        ),
        (
            "=CONFIDENCE.T(1E-300*4.940656458412465E-24,1E-300/1E8,2)",
            911130255397676.6,
        ),
        ("=CONFIDENCE.T(0.05,1,100000000001)", 6.197950323089645e-6),
        ("=CONFIDENCE.NORM(0.05,1E308,100)", 1.959963984540054e307),
        ("=CONFIDENCE.T(0.05,1E308,100)", 1.9842169515864175e307),
        ("=CONFIDENCE.T(0.05,1,1E30)", 1.959963984540054e-15),
        ("=Z.TEST({1E300,2E300,3E300},2E300)", 0.5),
        ("=Z.TEST({1E-300,2E-300,3E-300},2E-300)", 0.5),
        ("=Z.TEST({1E300,2E300,3E300},1E300)", 0.0416322583317752),
        ("=Z.TEST({1E-300,2E-300,3E-300},1E-300)", 0.0416322583317752),
        ("=Z.TEST({1E308,1E308},-1E308,1E308)", 0.002338867490523633),
        ("=Z.TEST({1,2,3},2-8/SQRT(3),1)", 6.220960574271784e-16),
        ("=Z.TEST({1E308,1E308},1E308,1E-300/1E8)", 0.5),
        ("=Z.TEST({1E308,1E308},-1E308,1E-300/1E8)", 0.),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, e);
    }
    let before = b.to_json();
    assert!(
        b.edit(&[(0, 0, 0, "=CONFIDENCE.T(SEQUENCE(100)/1000,1,10)")], 1000)
            .is_err()
    );
    assert_eq!(b.to_json(), before);
}
#[test]
fn inference_sparse_columns_delayed_spills_and_reopening() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 9997, 0, "1"),
            (0, 9998, 0, "2"),
            (0, 9999, 0, "3"),
            (0, 0, 2, "=Z.TEST(A:A,1)"),
            (0, 0, 4, "=Z.TEST(J10:J12,2)"),
            (0, 9, 9, "=SEQUENCE(3)"),
        ],
        100_000,
    )
    .unwrap();
    near(&b, 0, 2, 0.0416322583317752);
    near(&b, 0, 4, 0.5);
    b.edit(
        &[
            (0, 0, 6, "Data"),
            (0, 1, 6, "1"),
            (0, 2, 6, "2"),
            (0, 3, 6, "3"),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Samples", [0, 6, 3, 6], LIMIT).unwrap();
    b.edit(
        &[
            (0, 6, 2, "=Z.TEST(Samples[Data],{1,2})"),
            (
                0,
                7,
                2,
                "=CONFIDENCE.T(0.05,STDEV.S(Samples[Data]),COUNT(Samples[Data]))",
            ),
        ],
        LIMIT,
    )
    .unwrap();
    for mut x in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&x, 6, 2, 0.0416322583317752);
        near(&x, 6, 3, 0.5);
        near(&x, 7, 2, 2.484137711750331);
        x.edit(&[(0, 1, 6, "2"), (0, 2, 6, "3"), (0, 3, 6, "4")], LIMIT)
            .unwrap();
        near(&x, 6, 3, 0.0416322583317752);
        near(&x, 7, 2, 2.484137711750331);
    }
}

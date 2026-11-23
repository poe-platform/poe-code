// Cases adapted from IronCalc f936620 statistical/{covariance,pearson,correl,forecast}
// (MIT) and Univer 4767b3b statistical tests (Apache-2.0); adjacent licenses apply.
use super::{Spreadsheet, Value};
const LIMIT: usize = 20_000_000;
fn number(b: &Spreadsheet, r: usize, c: usize) -> f64 {
    match b.cell(0, r, c).and_then(|cell| cell.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!(
            "{}: {}",
            b.input(0, r, c),
            b.display(0, r, c, LIMIT).unwrap()
        ),
    }
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() <= b.abs().max(1e-300) * 1e-10, "{a} != {b}");
}
#[test]
fn paired_statistics_upstream_values_and_aliases() {
    let cases = [
        ("=CORREL({3,2,4,5,6},{9,7,12,15,17})", 0.9970544855015815),
        ("=PEARSON({9,7,12,15,17},{3,2,4,5,6})", 0.9970544855015815),
        ("=RSQ({3,2,4,5,6},{9,7,12,15,17})", 0.9941176470588236),
        ("=SLOPE({2,3,9,1,8},{6,5,11,7,5})", 83. / 124.),
        ("=INTERCEPT({2,3,9,1,8},{6,5,11,7,5})", 3. / 62.),
        ("=FORECAST(8,{2,3,9,1,8},{6,5,11,7,5})", 335. / 62.),
        ("=FORECAST.LINEAR(8,{2,3,9,1,8},{6,5,11,7,5})", 335. / 62.),
        ("=STEYX({3,5,6},{1,2,3})", (1_f64 / 6.).sqrt()),
        (
            "=COVARIANCE.P({3,9,2,7,4,12},{5,15,6,17,8,20})",
            19.1944444444444,
        ),
        ("=COVAR({3,9,2,7,4,12},{5,15,6,17,8,20})", 19.1944444444444),
        (
            "=COVARIANCE.S({3,9,2,7,4,12},{5,15,6,17,8,20})",
            23.0333333333333,
        ),
        (
            "=COVARIANCE.P({58,35;11,25;10,23},{45.35,47.65;17.56,18.44;16.09,16.91})",
            188.006666666667,
        ),
    ];
    let mut b = Spreadsheet::new();
    b.edit(
        &cases
            .iter()
            .enumerate()
            .map(|(r, (f, _))| (0, r, 0, *f))
            .collect::<Vec<_>>(),
        LIMIT,
    )
    .unwrap();
    for (r, (_, n)) in cases.into_iter().enumerate() {
        near(number(&b, r, 0), n);
    }
}
#[test]
fn paired_statistics_skip_pairs_without_compressing_each_column() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "1"),
            (0, 0, 1, "3"),
            (0, 1, 0, "ignored"),
            (0, 1, 1, "1000"),
            (0, 2, 0, "3"),
            (0, 2, 1, "7"),
            (0, 3, 0, "4"),
            (0, 3, 1, "TRUE"),
            (0, 4, 0, "0"),
            (0, 4, 1, "1"),
            (0, 5, 1, "999"),
            (0, 6, 0, "=\"\""),
            (0, 6, 1, "999"),
            (0, 0, 3, "=SLOPE(B1:B7,A1:A7)"),
            (0, 1, 3, "=INTERCEPT(B1:B7,A1:A7)"),
            (0, 2, 3, "=CORREL(B1:B7,A1:A7)"),
            (0, 3, 3, "=COVARIANCE.P(B1:B7,A1:A7)"),
            (0, 4, 3, "=COVARIANCE.S({1,2,\"x\",4},{3,FALSE,7,9})"),
            (0, 5, 3, "=SLOPE({1,\"2\",3},{1,100,3})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, n) in [2., 1., 1., 28. / 9., 9., 1.].into_iter().enumerate() {
        near(number(&b, r, 3), n);
    }
}
#[test]
fn paired_statistics_flatten_shapes_and_transpose_views() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=SLOPE({3,5,7,9},{1;2;3;4})"),
            (0, 1, 0, "=CORREL({3,5;7,9},{1;2;3;4})"),
            (0, 2, 0, "=SLOPE(TRANSPOSE({3,7;5,9}),{1,2;3,4})"),
            (0, 3, 0, "=COVARIANCE.P({2;4;6;8},{1,3,5,7})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, n) in [2., 1., 2., 5.].into_iter().enumerate() {
        near(number(&b, r, 0), n);
    }
}
#[test]
fn paired_statistics_errors_degeneracy_and_constant_y() {
    let cases = [
        ("=SLOPE()", "#ERROR!"),
        ("=FORECAST(1,2)", "#ERROR!"),
        ("=CORREL({1,2},{1,2,3})", "#N/A"),
        ("=SLOPE({1,2,3},{5,5,5})", "#DIV/0!"),
        ("=CORREL({5,5,5},{1,2,3})", "#DIV/0!"),
        ("=PEARSON({5,5,5},{1,2,3})", "#DIV/0!"),
        ("=RSQ({5,5,5},{1,2,3})", "#DIV/0!"),
        ("=STEYX({1,2},{1,2})", "#DIV/0!"),
        ("=COVARIANCE.S({1},{2})", "#DIV/0!"),
        ("=COVARIANCE.P({\"x\"},{2})", "#DIV/0!"),
        ("=SLOPE({1,#REF!,3},{1,\"x\",3})", "#REF!"),
        ("=CORREL({1,\"x\",3},{1,#N/A,3})", "#N/A"),
        ("=FORECAST(\"bad\",{3,5,7},{1,2,3})", "#VALUE!"),
    ];
    let mut b = Spreadsheet::new();
    b.edit(
        &cases
            .iter()
            .enumerate()
            .map(|(r, (f, _))| (0, r, 0, *f))
            .collect::<Vec<_>>(),
        LIMIT,
    )
    .unwrap();
    for (r, (f, e)) in cases.into_iter().enumerate() {
        assert_eq!(b.display(0, r, 0, LIMIT).unwrap(), e, "{f}");
    }
    for (f, n) in [
        ("=COVARIANCE.P({1},{2})", 0.),
        ("=SLOPE({5,5,5},{1,2,3})", 0.),
        ("=INTERCEPT({5,5,5},{1,2,3})", 5.),
        ("=FORECAST(1E308,{5,5,5},{1,2,3})", 5.),
        ("=STEYX({5,5,5},{1,2,3})", 0.),
    ] {
        b.edit(&[(0, 0, 2, f)], LIMIT).unwrap();
        near(number(&b, 0, 2), n);
    }
}
#[test]
fn paired_statistics_center_and_scale_before_products() {
    let cases = [
        ("=CORREL({1E200,2E200,3E200},{3E200,2E200,1E200})", -1.),
        (
            "=PEARSON({1E-200,2E-200,3E-200},{1E-200,2E-200,3E-200})",
            1.,
        ),
        ("=RSQ({-1E308,0,1E308},{-1E308,0,1E308})", 1.),
        ("=SLOPE({-1E308,0,1E308},{-1E308,0,1E308})", 1.),
        (
            "=SLOPE({3,5,7},{1000000000000,1000000000001,1000000000002})",
            2.,
        ),
        (
            "=INTERCEPT({3,5,7},{1000000000000,1000000000001,1000000000002})",
            -1999999999997.,
        ),
        (
            "=FORECAST(1000000000004,{3,5,7},{1000000000000,1000000000001,1000000000002})",
            11.,
        ),
        (
            "=FORECAST(1E308,{1E-200,2E-200,3E-200},{1E-200,2E-200,3E-200})",
            1E308,
        ),
        (
            "=COVARIANCE.P({-1E200,0,1E200},{-1E-200,0,1E-200})",
            2. / 3.,
        ),
        ("=COVARIANCE.S({-1E200,0,1E200},{-1E-200,0,1E-200})", 1.),
        ("=STEYX({1E200,2E200,3E200},{1,2,3})", 0.),
    ];
    let mut b = Spreadsheet::new();
    b.edit(
        &cases
            .iter()
            .enumerate()
            .map(|(r, (f, _))| (0, r, 0, *f))
            .collect::<Vec<_>>(),
        LIMIT,
    )
    .unwrap();
    for (r, (_, n)) in cases.into_iter().enumerate() {
        near(number(&b, r, 0), n);
    }
}
#[test]
fn paired_statistics_forecast_array_parameters_propagate_errors_per_cell() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (
                0,
                0,
                0,
                "=FORECAST.LINEAR({4,5;TRUE,\"6\"},{3,5,7},{1,2,3})",
            ),
            (0, 3, 0, "=FORECAST({4,#N/A;\"bad\",0},{3,5,7},{1,2,3})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, n) in [
        (0, 0, 9.),
        (0, 1, 11.),
        (1, 0, 3.),
        (1, 1, 13.),
        (3, 0, 9.),
        (4, 1, 1.),
    ] {
        near(number(&b, r, c), n);
    }
    assert_eq!(b.display(0, 3, 1, LIMIT).unwrap(), "#N/A");
    assert_eq!(b.display(0, 4, 0, LIMIT).unwrap(), "#VALUE!");
}
#[test]
fn paired_statistics_sparse_full_columns_track_blanks_and_spill_children() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "1"),
            (0, 0, 1, "3"),
            (0, 1000, 0, "3"),
            (0, 1000, 1, "7"),
            (0, 0, 3, "=SLOPE(B:B,A:A)"),
            (0, 1, 3, "=COVARIANCE.P(B:B,A:A)"),
            (0, 0, 5, "=SEQUENCE(3)"),
            (0, 0, 6, "=SEQUENCE(3,,3,2)"),
            (0, 2, 3, "=SLOPE(G:G,F:F)"),
        ],
        LIMIT,
    )
    .unwrap();
    near(number(&b, 0, 3), 2.);
    near(number(&b, 1, 3), 2.);
    near(number(&b, 2, 3), 2.);
    b.edit(&[(0, 1000, 0, "")], LIMIT).unwrap();
    assert_eq!(b.display(0, 0, 3, LIMIT).unwrap(), "#DIV/0!");
    near(number(&b, 1, 3), 0.);
}
#[test]
fn paired_statistics_work_limits_roll_back_edits() {
    let mut b = Spreadsheet::new();
    b.edit(&[(0, 0, 0, "42")], LIMIT).unwrap();
    let before = b.to_json();
    for f in [
        "=SLOPE(SEQUENCE(1000000),SEQUENCE(1000000))",
        "=FORECAST(SEQUENCE(1000000),{3,5,7},{1,2,3})",
    ] {
        assert!(b.edit(&[(0, 0, 0, f)], 10000).is_err(), "{f}");
        assert_eq!(b.to_json(), before);
    }
}

#[test]
fn paired_statistics_zero_slope_preserves_finite_extreme_mean() {
    let mut b = Spreadsheet::new();
    b.edit(&[(0,0,0,"=FORECAST(1E308,{-1.7976931348623157E308,1.7976931348623157E308,1.7976931348623157E308},{0,-1,1})"),
        (0,1,0,"=INTERCEPT({-1.7976931348623157E308,1.7976931348623157E308,1.7976931348623157E308},{0,-1,1})")],LIMIT).unwrap();
    near(number(&b, 0, 0), f64::MAX / 3.);
    near(number(&b, 1, 0), f64::MAX / 3.);
}

#[test]
fn paired_statistics_tables_roundtrip_and_recalculate_numeric_pair_masks() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Y"),
            (0, 0, 1, "X"),
            (0, 1, 0, "3"),
            (0, 1, 1, "1"),
            (0, 2, 0, "5"),
            (0, 2, 1, "2"),
            (0, 3, 0, "7"),
            (0, 3, 1, "3"),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Samples", [0, 0, 3, 1], LIMIT).unwrap();
    b.edit(
        &[
            (0, 0, 3, "=SLOPE(Samples[Y],Samples[X])"),
            (0, 1, 3, "=CORREL(Samples[Y],Samples[X])"),
            (0, 2, 3, "=COVARIANCE.S(Samples[Y],Samples[X])"),
            (0, 3, 3, "=FORECAST.LINEAR({4;5},Samples[Y],Samples[X])"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, n) in [2., 1., 2., 9., 11.].into_iter().enumerate() {
            near(number(&restored, r, 3), n);
        }
        restored.edit(&[(0, 2, 0, "skipped")], LIMIT).unwrap();
        near(number(&restored, 0, 3), 2.);
        near(number(&restored, 2, 3), 4.);
        restored.edit(&[(0, 3, 0, "=1/0")], LIMIT).unwrap();
        for r in 0..4 {
            assert_eq!(restored.display(0, r, 3, LIMIT).unwrap(), "#DIV/0!");
        }
    }
}

#[test]
fn paired_statistics_forecast_parameter_errors_precede_invalid_fit_per_cell() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (
                0,
                0,
                0,
                "=FORECAST.LINEAR({#N/A,\"bad\";2,3},{1,2,3},{5,5,5})",
            ),
            (0, 3, 0, "=FORECAST(#REF!,{1,2},{1})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, e) in [
        (0, 0, "#N/A"),
        (0, 1, "#VALUE!"),
        (1, 0, "#DIV/0!"),
        (1, 1, "#DIV/0!"),
        (3, 0, "#REF!"),
    ] {
        assert_eq!(b.display(0, r, c, LIMIT).unwrap(), e);
    }
}

#[test]
fn paired_statistics_errors_follow_pair_order_in_arrays_and_sparse_ranges() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=CORREL({1,#N/A,3},{#REF!,2,3})"),
            (0, 1, 0, "=COVARIANCE.P({#N/A,2,3},{#REF!,2,3})"),
            (0, 2, 0, "=FORECAST(1,{1,#N/A,3},{#REF!,2,3})"),
            (0, 0, 2, "1"),
            (0, 1, 2, "=NA()"),
            (0, 0, 3, "=#REF!"),
            (0, 1, 3, "2"),
            (0, 3, 0, "=SLOPE(C:C,D:D)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, e) in [(0, "#REF!"), (1, "#N/A"), (2, "#REF!"), (3, "#REF!")] {
        assert_eq!(b.display(0, r, 0, LIMIT).unwrap(), e);
    }
}

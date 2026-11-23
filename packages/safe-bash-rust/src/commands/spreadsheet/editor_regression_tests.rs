// Regression cases adapted from IronCalc f936620 (MIT) and Univer 4767b3b
// statistical/{linest,logest,trend,growth} tests (Apache-2.0). See adjacent licenses.
use super::{Spreadsheet, Value};
const LIMIT: usize = 20_000_000;
fn number(book: &Spreadsheet, row: usize, col: usize) -> f64 {
    match book.cell(0, row, col).and_then(|c| c.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!(
            "{}: {}",
            book.input(0, row, col),
            book.display(0, row, col, LIMIT).unwrap()
        ),
    }
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() <= b.abs().max(1.) * 1e-10, "{a} != {b}");
}
#[test]
fn regression_simple_fits_defaults_and_output_orientation() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=LINEST({3;5;7},{1;2;3})"),
            (0, 2, 0, "=LOGEST({6,18,54},{1,2,3})"),
            (0, 4, 0, "=TREND({3,5,7},,{4,5;6,7})"),
            (0, 7, 0, "=GROWTH({6;18;54},,{4;5})"),
            (
                0,
                10,
                0,
                "=LINEST({33100;47300;69000;102000;150000;220000})",
            ),
            (0, 12, 0, "=TREND({1,3;5,7})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, n) in [
        (0, 0, 2.),
        (0, 1, 1.),
        (2, 0, 3.),
        (2, 1, 2.),
        (4, 0, 9.),
        (4, 1, 11.),
        (5, 0, 13.),
        (5, 1, 15.),
        (7, 0, 162.),
        (8, 0, 486.),
        (10, 0, 36445.7142857143),
        (10, 1, -23993.3333333333),
        (12, 0, 1.),
        (12, 1, 3.),
        (13, 0, 5.),
        (13, 1, 7.),
    ] {
        near(number(&b, r, c), n);
    }
}
#[test]
fn regression_statistics_match_univer_with_and_without_intercept() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=LINEST({1;2;3;4},{5;6;7;8},TRUE,TRUE)"),
            (0, 0, 3, "=LINEST({1;2;3;4},{5;6;7;8},FALSE,TRUE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, values) in [[1., -4.], [0., 0.], [1., 0.], [f64::NAN, 2.], [5., 0.]]
        .iter()
        .enumerate()
    {
        for (c, &v) in values.iter().enumerate() {
            if v.is_nan() {
                assert_eq!(b.display(0, r, c, LIMIT).unwrap(), "#NUM!");
            } else {
                near(number(&b, r, c), v);
            }
        }
    }
    for (r, values) in [
        [0.402298850575, 0.],
        [0.0593560666085, f64::NAN],
        [0.938697318008, 0.782960292686],
        [45.9375, 3.],
        [28.1609195402, 1.83908045977],
    ]
    .iter()
    .enumerate()
    {
        for (c, &v) in values.iter().enumerate() {
            if v.is_nan() {
                assert_eq!(b.display(0, r, c + 3, LIMIT).unwrap(), "#N/A");
            } else {
                near(number(&b, r, c + 3), v);
            }
        }
    }
}
#[test]
fn regression_multiple_predictors_and_transposed_data() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=LINEST({9;12;19;22},{1,2;2,2;3,4;4,4},TRUE,TRUE)"),
            (0, 6, 0, "=LINEST({9,12,19,22},{1,2,3,4;2,2,4,4})"),
            (0, 8, 0, "=TREND({9;12;19;22},{1,2;2,2;3,4;4,4},{5,6;6,6})"),
            (0, 11, 0, "=TREND({9,12,19,22},{1,2,3,4;2,2,4,4},{5,6;6,6})"),
        ],
        LIMIT,
    )
    .unwrap();
    for row in [0, 6] {
        for (c, n) in [2., 3., 2.].into_iter().enumerate() {
            near(number(&b, row, c), n);
        }
    }
    near(number(&b, 8, 0), 29.);
    near(number(&b, 9, 0), 32.);
    near(number(&b, 11, 0), 29.);
    near(number(&b, 11, 1), 32.);
    for row in 2..5 {
        assert_eq!(b.display(0, row, 2, LIMIT).unwrap(), "#N/A");
    }
}
#[test]
fn regression_redundant_predictors_constant_data_and_degrees_of_freedom() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=LINEST({3;5;7;9},{1,2;2,4;3,6;4,8},TRUE,TRUE)"),
            (0, 6, 0, "=LINEST({2,2},{20,14200},TRUE,TRUE)"),
            (0, 12, 0, "=LINEST({2;4;6},{1;1;1},TRUE,TRUE)"),
            (0, 18, 0, "=LINEST({0;0;0},{0;0;0},FALSE,TRUE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, n) in [
        (0, 0, 0.),
        (0, 1, 2.),
        (0, 2, 1.),
        (1, 0, 0.),
        (3, 1, 2.),
        (6, 0, 0.),
        (6, 1, 2.),
        (7, 0, 0.),
        (8, 0, 1.),
        (9, 1, 0.),
        (12, 0, 0.),
        (12, 1, 4.),
        (14, 0, 0.),
        (15, 1, 2.),
        (18, 0, 0.),
        (18, 1, 0.),
        (21, 1, 3.),
    ] {
        near(number(&b, r, c), n);
    }
    assert_eq!(b.display(0, 9, 0, LIMIT).unwrap(), "#NUM!");
}
#[test]
fn regression_validates_shapes_types_flags_and_exponential_domain() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=LINEST()", "#ERROR!"),
        ("=LINEST({1;2;3},{1;2})", "#REF!"),
        ("=TREND({1;2;3},{1,2;2,3;3,5},{1;2})", "#REF!"),
        ("=LINEST({1;2},{1,2;2,4})", "#N/A"),
        ("=LINEST({1;TRUE;3})", "#VALUE!"),
        ("=LINEST({1;\"2\";3})", "#VALUE!"),
        ("=LINEST({1;#N/A;3})", "#N/A"),
        ("=LINEST({1;2;3},,\"bad\")", "#VALUE!"),
        ("=LINEST({1;2;3},,TRUE,NA())", "#N/A"),
        ("=LOGEST({1;0;3})", "#NUM!"),
        ("=GROWTH({1;-2;3})", "#NUM!"),
        ("=LINEST(B1:B3)", "#VALUE!"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}
#[test]
fn regression_scaling_preserves_extreme_and_offset_data() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=LINEST({-5E307;0;5E307},{-1E308;0;1E308},FALSE)"),
            (0, 2, 0, "=LINEST({2;4;6},{1E-200;2E-200;3E-200},FALSE)"),
            (0, 4, 0, "=LINEST({1E308;1E308;1E308})"),
            (
                0,
                6,
                0,
                "=TREND({1;2;3},{1E-300;2E-300;3E-300}/1E8,3E-300/1E8,FALSE)",
            ),
            (0, 8, 0, "=GROWTH({1;2;4},{0;1E-10;2E-10},3E-10)"),
            (0, 10, 0, "1000000000000"),
            (0, 11, 0, "1000000000001"),
            (0, 12, 0, "1000000000002"),
            (0, 10, 2, "=LINEST({3;5;7},A11:A13)"),
            (0, 12, 2, "=TREND({3;5;7},A11:A13,1000000000004)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, n) in [
        (0, 0, 0.5),
        (2, 0, 2e200),
        (4, 0, 0.),
        (4, 1, 1e308),
        (6, 0, 3.),
        (8, 0, 8.),
        (10, 2, 2.),
        (10, 3, -1999999999997.),
        (12, 2, 11.),
    ] {
        near(number(&b, r, c), n);
    }
}
#[test]
fn regression_univer_high_order_polynomial_coefficients() {
    let xs = [
        155_f64, 178., 195., 205., 189., 179., 142., 130., 152., 166., 194.,
    ];
    let ys = [
        975097., 1076088.07, 985880.56, 1264998.15, 1487692.02, 879096.99, 1013152.71, 480886.67,
        651359.67, 472135.74, 720614.91,
    ];
    let mut inputs = Vec::new();
    for (r, (&x, y)) in xs.iter().zip(ys).enumerate() {
        inputs.push((0, r, 0, y.to_string()));
        for c in 1..=6 {
            inputs.push((0, r, c, x.powi(c as i32).to_string()));
        }
    }
    inputs.push((0, 13, 0, "=LINEST(A1:A11,B1:G11)".into()));
    let mut b = Spreadsheet::new();
    b.edit(
        &inputs
            .iter()
            .map(|(s, r, c, v)| (*s, *r, *c, v.as_str()))
            .collect::<Vec<_>>(),
        LIMIT,
    )
    .unwrap();
    for (c, n) in [
        0.003030803284094725,
        -3.014286876228756,
        1242.0301184586228,
        -271378.1017228177,
        33159765.83632094,
        -2148345015.0620275,
        57656015344.78786,
    ]
    .into_iter()
    .enumerate()
    {
        let a = number(&b, 13, c);
        assert!(
            (a - n).abs() < n.abs().max(1.) * 1e-8,
            "column {c}: {a} != {n}"
        );
    }
}
#[test]
fn regression_work_limits_are_atomic_before_matrix_allocation() {
    let mut b = Spreadsheet::new();
    b.edit(&[(0, 0, 0, "42")], LIMIT).unwrap();
    let before = b.to_json();
    for f in [
        "=LINEST(B:B,C:D)",
        "=TREND(SEQUENCE(1000000))",
        "=LINEST(SEQUENCE(1000),SEQUENCE(1000,1000),TRUE,TRUE)",
        "=GROWTH({1;2;3},,SEQUENCE(1000000))",
    ] {
        assert!(b.edit(&[(0, 0, 0, f)], 10000).is_err(), "{f}");
        assert_eq!(b.to_json(), before);
    }
}

#[test]
fn regression_predictions_ignore_removed_columns_and_rescale_finite_results() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=TREND({2;4;6},{1E308;1E308;1E308},-1E308)"),
            (
                0,
                2,
                0,
                "=TREND({1E-200;2E-200;3E-200},{1E-200;2E-200;3E-200},1E308,FALSE)",
            ),
        ],
        LIMIT,
    )
    .unwrap();
    near(number(&b, 0, 0), 4.);
    near(number(&b, 2, 0), 1e308);
}

#[test]
fn regression_multiple_variable_statistics_match_univer() {
    let mut b = Spreadsheet::new();
    b.edit(&[(0,0,0,"=LINEST({14200;14400;15100;150000;13900;16900;12600;14290;16300;16900;14900},{2310,2,2,20;2333,2,2,1.2;2356,3,1.5,33;2379,3,2,43;2402,2,3,53;2425,4,2,23;2448,2,1.5,99;2471,2,2,34;2494,3,3,23;2517,4,4,55;2540,2,3,22},TRUE,TRUE)")],LIMIT).unwrap();
    for (r, values) in [
        vec![
            204.080843005,
            -3407.54648311873,
            12743.5528364872,
            -127.712022706613,
            303849.431233932,
        ],
        vec![
            651.098478042223,
            27243.5182021205,
            20457.1543147677,
            281.254697108,
            634296.647114014,
        ],
        vec![0.107464822024, 49689.6546787527],
        vec![0.180606027654, 6.],
        vec![1783709761.98333, 14814370692.5621],
    ]
    .iter()
    .enumerate()
    {
        for (c, &expected) in values.iter().enumerate() {
            near(number(&b, r, c), expected);
        }
    }
}

#[test]
fn regression_table_fits_recalculate_after_json_and_excel_reopening() {
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
            (0, 0, 3, "=LINEST(Samples[Y],Samples[X],TRUE,TRUE)"),
            (0, 6, 3, "=TREND(Samples[Y],Samples[X],{4;5})"),
            (0, 0, 6, "=LOGEST(Samples[Y],Samples[X],FALSE,TRUE)"),
            (0, 6, 6, "=GROWTH(Samples[Y],Samples[X],{4;5},FALSE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, c) in [
            (0, 3),
            (0, 4),
            (6, 3),
            (7, 3),
            (0, 6),
            (0, 7),
            (6, 6),
            (7, 6),
        ] {
            near(number(&restored, r, c), number(&b, r, c));
        }
        restored.edit(&[(0, 3, 0, "9")], LIMIT).unwrap();
        near(number(&restored, 0, 3), 3.);
        near(number(&restored, 6, 3), 35. / 3.);
        assert!(number(&restored, 6, 6) > number(&b, 6, 6));
    }
}

#[test]
fn regression_omitted_flags_keep_defaults_but_blank_cell_flags_are_false() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=LINEST({3;5;7},,,TRUE)"),
            (0, 6, 0, "=TREND({3;5;7},,{4;5},)"),
            (0, 9, 0, "=LINEST({3;5;7},,D1,TRUE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, n) in [
        (0, 0, 2.),
        (0, 1, 1.),
        (3, 1, 1.),
        (6, 0, 9.),
        (7, 0, 11.),
        (9, 0, 17. / 7.),
        (9, 1, 0.),
    ] {
        near(number(&b, r, c), n);
    }
}

#[test]
fn regression_statistics_keep_finite_intercept_error_when_residual_error_overflows() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[(
            0,
            0,
            0,
            "=LINEST({-1.7976931348623157E308;1.7976931348623157E308},{1;1},TRUE,TRUE)",
        )],
        LIMIT,
    )
    .unwrap();
    near(number(&b, 0, 1), 0.);
    near(number(&b, 1, 1), f64::MAX);
    assert_eq!(b.display(0, 2, 1, LIMIT).unwrap(), "#NUM!");
}

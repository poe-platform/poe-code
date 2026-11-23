// Adapted from IronCalc f936620 statistical/{test_fn_expon_dist,test_fn_weibull}
// (MIT) and Univer 4767b3b {expon-dist,weibull-dist} (Apache-2.0).
// See adjacent license files. Extreme-value expectations use the analytic limits.
use super::{Spreadsheet, Value};
const LIMIT: usize = 20_000_000;

fn number(book: &Spreadsheet, row: usize, col: usize) -> f64 {
    match book.cell(0, row, col).and_then(|cell| cell.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!(
            "{}: {}",
            book.input(0, row, col),
            book.display(0, row, col, LIMIT).unwrap()
        ),
    }
}
fn near(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= expected.abs() * 2e-12,
        "{actual} != {expected}"
    );
}

#[test]
fn lifetime_upstream_values_and_legacy_names() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=EXPON.DIST(0.5,1,TRUE)", 0.3934693402873666),
        ("=EXPON.DIST(0.5,1,FALSE)", 0.6065306597126334),
        ("=EXPONDIST(0.5,1,TRUE)", 0.3934693402873666),
        ("=EXPON.DIST(0.5,10000000001,TRUE)", 1.),
        ("=EXPON.DIST(TRUE,1,TRUE)", 0.6321205588285577),
        ("=EXPON.DIST(,1,TRUE)", 0.),
        ("=EXPON.DIST(0,5,FALSE)", 5.),
        ("=EXPON.DIST(0.2,10,)", 1.353352832366127),
        ("=EXPON.DIST(\"0.2\",\"10\",\"true\")", 0.8646647167633873),
        ("=EXPON.DIST(0.2,10,-2)", 0.8646647167633873),
        ("=WEIBULL.DIST(1,2,1,TRUE)", 0.6321205588285577),
        ("=WEIBULL.DIST(1,2,1,FALSE)", 0.7357588823428847),
        ("=WEIBULL(1,2,1,FALSE)", 0.7357588823428847),
        ("=WEIBULL.DIST(10,8,2,TRUE)", 1.),
        ("=WEIBULL.DIST(10,8,2,FALSE)", 0.),
        ("=WEIBULL.DIST(10,1,1,FALSE)", 0.000045399929762484854),
        ("=WEIBULL.DIST(3,1,1,FALSE)", 0.04978706836786394),
        ("=WEIBULL.DIST(10,0.1,0.1,FALSE)", 0.0032485505723701605),
        ("=WEIBULL.DIST(TRUE,8,2,TRUE)", 0.00389863052988251),
        ("=WEIBULL.DIST(0,8,2,FALSE)", 0.),
        ("=WEIBULL.DIST(0,1,2,FALSE)", 0.5),
        ("=WEIBULL.DIST(0,0.5,2,TRUE)", 0.),
        ("=WEIBULL.DIST(,8,2,TRUE)", 0.),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(number(&book, 0, 0), expected);
    }
}

#[test]
fn lifetime_errors_validate_arity_types_and_domains() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=EXPON.DIST()", "#ERROR!"),
        ("=EXPON.DIST(1)", "#ERROR!"),
        ("=EXPON.DIST(1,2)", "#ERROR!"),
        ("=EXPON.DIST(1,2,TRUE,4)", "#ERROR!"),
        ("=EXPONDIST(1,2)", "#ERROR!"),
        ("=WEIBULL.DIST(1,2,1)", "#ERROR!"),
        ("=WEIBULL.DIST(1,2,1,TRUE,FALSE)", "#ERROR!"),
        ("=WEIBULL(1,2,1)", "#ERROR!"),
        ("=EXPON.DIST(-1,1,TRUE)", "#NUM!"),
        ("=EXPON.DIST(1,0,TRUE)", "#NUM!"),
        ("=EXPON.DIST(1,-1,FALSE)", "#NUM!"),
        ("=EXPON.DIST(,,)", "#NUM!"),
        ("=WEIBULL.DIST(-1,2,1,TRUE)", "#NUM!"),
        ("=WEIBULL.DIST(1,0,1,TRUE)", "#NUM!"),
        ("=WEIBULL.DIST(1,-1,1,TRUE)", "#NUM!"),
        ("=WEIBULL.DIST(1,2,0,TRUE)", "#NUM!"),
        ("=WEIBULL.DIST(1,2,-1,TRUE)", "#NUM!"),
        ("=WEIBULL.DIST(0,0.5,1,FALSE)", "#NUM!"),
        ("=EXPON.DIST(\"bad\",1,TRUE)", "#VALUE!"),
        ("=EXPON.DIST(1,\"bad\",TRUE)", "#VALUE!"),
        ("=EXPON.DIST(\"TRUE\",1,TRUE)", "#VALUE!"),
        ("=WEIBULL.DIST(1,2,\"bad\",TRUE)", "#VALUE!"),
        ("=WEIBULL.DIST(1,2,1,\"bad\")", "#VALUE!"),
        ("=EXPON.DIST(NA(),1,TRUE)", "#N/A"),
        ("=WEIBULL.DIST(1,2,1,1/0)", "#DIV/0!"),
        ("=EXPON.DIST({#N/A},1,{#DIV/0!})", "#N/A"),
        ("=WEIBULL.DIST(\"bad\",2,{#REF!},FALSE)", "#REF!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn lifetime_arrays_keep_upstream_types_and_broadcast_parameters() {
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
            (0, 4, 0, "=EXPON.DIST(A1:F2,1,TRUE)"),
            (0, 8, 0, "=WEIBULL.DIST(A1:F2,8,2,TRUE)"),
            (0, 12, 0, "=EXPON.DIST({0;1},{1,2},{FALSE;TRUE})"),
            (0, 16, 0, "=WEIBULL.DIST({1,2,3},{1,2},1,TRUE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (start, expected) in [
        (
            4,
            [
                0.6321205588285577,
                0.,
                0.7077074223191406,
                0.6321205588285577,
                0.,
                0.,
                0.,
                1.,
                0.9036723617695069,
                0.,
                0.,
                0.,
            ],
        ),
        (
            8,
            [
                0.00389863052988251,
                0.,
                0.020256513462792808,
                0.00389863052988251,
                0.,
                0.,
                0.,
                1.,
                0.9701465024693558,
                0.,
                0.,
                0.,
            ],
        ),
    ] {
        for (i, expected) in expected.into_iter().enumerate() {
            let (r, c) = (start + i / 6, i % 6);
            match i {
                1 | 9 => assert_eq!(book.display(0, r, c, LIMIT).unwrap(), "#VALUE!"),
                10 => assert_eq!(book.display(0, r, c, LIMIT).unwrap(), "#NUM!"),
                11 => assert_eq!(book.display(0, r, c, LIMIT).unwrap(), "#NAME?"),
                _ => near(number(&book, r, c), expected),
            }
        }
    }
    for (r, c, expected) in [
        (12, 0, 1.),
        (12, 1, 2.),
        (13, 0, 0.6321205588285577),
        (13, 1, 0.8646647167633873),
    ] {
        near(number(&book, r, c), expected);
    }
    assert_eq!(book.display(0, 16, 2, LIMIT).unwrap(), "#N/A");
}

#[test]
fn lifetime_extreme_scales_preserve_finite_probabilities_and_densities() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=EXPON.DIST(1E-20,1,TRUE)", 1e-20),
        ("=EXPON.DIST(1E-300,1E-20,TRUE)", 1e-320),
        ("=EXPON.DIST(8E-306,1E308,FALSE)", 3.667874584177687e-40),
        ("=EXPON.DIST(1E308,1E308,TRUE)", 1.),
        ("=EXPON.DIST(1E308,1E308,FALSE)", 0.),
        ("=WEIBULL.DIST(1E-10,2,1,TRUE)", 1e-20),
        ("=WEIBULL.DIST(1E-200,2,1,TRUE)", 0.),
        ("=WEIBULL.DIST(1E-200,2,1,FALSE)", 2e-200),
        ("=WEIBULL.DIST(1E200,2,1E200,FALSE)", 7.357588823428847e-201),
        (
            "=WEIBULL.DIST(1E-200,2,1E-200,FALSE)",
            7.357588823428847e199,
        ),
        ("=WEIBULL.DIST(1E-300,0.5,1E300,TRUE)", 1e-300),
        ("=WEIBULL.DIST(1E-300,0.5,1E300,FALSE)", 0.5),
        ("=WEIBULL.DIST(1E300,0.001,1E-300,TRUE)", 0.9813343754384811),
        ("=WEIBULL.DIST(10,520,520,FALSE)", 0.),
        ("=WEIBULL.DIST(10,350,350,FALSE)", 0.),
        (
            "=WEIBULL.DIST(1E308,1E308,1E308,FALSE)",
            0.36787944117144233,
        ),
        ("=WEIBULL.DIST(1E308,2,1E-300/1E8,FALSE)", 0.),
        ("=WEIBULL.DIST(1E308,2,1E-300/1E8,TRUE)", 1.),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(number(&book, 0, 0), expected);
    }
}

#[test]
fn lifetime_table_formulas_recalculate_after_rename_copy_and_json_excel_reopening() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Time"),
            (0, 1, 0, "0"),
            (0, 2, 0, "1"),
            (0, 3, 0, "2"),
            (0, 0, 2, "1"),
            (0, 1, 2, "2"),
            (0, 2, 2, "1"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Times", [0, 0, 3, 0], LIMIT).unwrap();
    book.edit(
        &[
            (0, 0, 4, "=EXPON.DIST(Times[Time],$C$1,TRUE)"),
            (0, 0, 5, "=WEIBULL.DIST(Times[Time],$C$2,$C$3,FALSE)"),
            (0, 6, 0, "=EXPONDIST(A3,$C$1,TRUE)"),
        ],
        LIMIT,
    )
    .unwrap();
    let copied = book
        .relocate_cell(&book.sheets[0].cells[&(6, 0)], (6, 0), (7, 0), 0, LIMIT)
        .unwrap();
    book.replace_cells(vec![(0, 7, 0, Some(copied))], LIMIT)
        .unwrap();
    book.rename_table(0, "Durations", LIMIT).unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert!(
            restored
                .input(0, 0, 4)
                .to_ascii_lowercase()
                .contains("durations[time]"),
            "{}",
            restored.input(0, 0, 4)
        );
        assert!(restored.input(0, 7, 0).contains("A4"));
        near(number(&restored, 7, 0), 0.8646647167633873);
        for (r, c, n) in [
            (0, 4, 0.),
            (1, 4, 0.6321205588285577),
            (2, 4, 0.8646647167633873),
            (0, 5, 0.),
            (1, 5, 0.7357588823428847),
            (2, 5, 0.07326255555493671),
        ] {
            near(number(&restored, r, c), n);
        }
        restored.edit(&[(0, 2, 0, "3")], LIMIT).unwrap();
        near(number(&restored, 1, 4), 0.950212931632136);
        near(number(&restored, 6, 0), 0.950212931632136);
        restored.convert_table_to_range(0, LIMIT).unwrap();
        near(number(&restored, 1, 4), 0.950212931632136);
        restored.edit(&[(0, 0, 2, "2")], LIMIT).unwrap();
        near(number(&restored, 1, 4), 0.9975212478233336);
    }
}

#[test]
fn lifetime_weibull_shape_one_agrees_with_exponential_across_scales() {
    let mut book = Spreadsheet::new();
    for scale in [1e-200, 1e-20, 1., 1e20, 1e200] {
        for time in [0., 1e-10, 0.5, 1., 10., 700.] {
            for cumulative in ["TRUE", "FALSE"] {
                let a = format!("=WEIBULL.DIST({},1,{scale},{cumulative})", time * scale);
                let b = format!("=EXPON.DIST({},{},{cumulative})", time * scale, 1. / scale);
                book.edit(&[(0, 0, 0, &a), (0, 0, 1, &b)], LIMIT).unwrap();
                near(number(&book, 0, 0), number(&book, 0, 1));
            }
        }
    }
}

#[test]
fn lifetime_arrays_fail_atomically_at_the_work_limit() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "saved")], LIMIT).unwrap();
    let before = book.to_json();
    for formula in [
        "=EXPON.DIST(SEQUENCE(100000),1,TRUE)",
        "=WEIBULL.DIST(A:A,2,1,TRUE)",
    ] {
        assert!(book.edit(&[(0, 0, 2, formula)], 1000).is_err());
        assert_eq!(book.to_json(), before);
    }
}

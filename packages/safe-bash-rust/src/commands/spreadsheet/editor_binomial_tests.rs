// IronCalc f936620 statistical/test_fn_binom.rs (MIT) and Univer 4767b3b
// statistical/binom-* contracts (Apache-2.0). See bundled licenses.
use super::{Spreadsheet, Value};
const LIMIT: usize = 128 * 1024 * 1024;
fn near(book: &Spreadsheet, row: usize, column: usize, expected: f64) {
    let Some(Value::Number(actual)) = book.cell(0, row, column).and_then(|c| c.value.clone())
    else {
        panic!(
            "{},{}: {}",
            row,
            column,
            book.display(0, row, column, LIMIT).unwrap()
        )
    };
    assert!(
        (actual - expected).abs() <= expected.abs() * 3e-12,
        "{actual:.17e} != {expected:.17e}"
    );
}
#[test]
fn binomial_probabilities_inverse_and_legacy_names() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=BINOM.DIST(6,10,0.5,TRUE)", 0.828125),
        ("=BINOM.DIST(6,10,0.5,FALSE)", 0.205078125),
        ("=BINOMDIST(6,10,0.5,TRUE)", 0.828125),
        ("=BINOM.DIST.RANGE(10,0.5,6)", 0.205078125),
        ("=BINOM.DIST.RANGE(10,0.5,6,10)", 0.376953125),
        ("=BINOM.INV(6,0.5,0.75)", 4.),
        ("=CRITBINOM(6,0.5,0.75)", 4.),
        ("=BINOM.INV(1,0.001,0.1)", 0.),
        ("=BINOM.INV(10,0.01,0.999)", 2.),
        ("=BINOM.INV(1000000,0.3,0.9)", 300587.),
        ("=BINOM.DIST(0,0,0.5,FALSE)", 1.),
        ("=BINOM.DIST(0,10,0,FALSE)", 1.),
        ("=BINOM.DIST(10,10,1,FALSE)", 1.),
        ("=BINOM.DIST(9,10,1,TRUE)", 0.),
        ("=BINOM.DIST.RANGE(10,0,0,1)", 1.),
        ("=BINOM.DIST.RANGE(10,1,9,10)", 1.),
        ("=BINOM.DIST(1.9,3.9,0.5,FALSE)", 0.375),
        ("=BINOM.DIST(1,TRUE,0.7,TRUE)", 1.),
        ("=BINOM.DIST(\"1\",\"3\",\"0.5\",\"FALSE\")", 0.375),
        ("=NEGBINOM.DIST(10,5,0.25,FALSE)", 0.05504866037517786),
        ("=NEGBINOM.DIST(10,5,0.25,TRUE)", 0.3135140584781766),
        ("=NEGBINOMDIST(10,5,0.25)", 0.05504866037517786),
        ("=NEGBINOM.DIST(0,TRUE,0.7,TRUE)", 0.7),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(&book, 0, 0, expected);
        let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        near(&excel, 0, 0, expected);
    }
}
#[test]
fn binomial_domain_type_errors_and_argument_counts() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=BINOM.DIST()", "#ERROR!"),
        ("=BINOM.DIST(1,3,0.5)", "#ERROR!"),
        ("=BINOM.DIST(1,3,0.5,FALSE,TRUE)", "#ERROR!"),
        ("=BINOM.DIST.RANGE(3,0.5)", "#ERROR!"),
        ("=BINOM.INV(3,0.5)", "#ERROR!"),
        ("=NEGBINOM.DIST(1,3,0.5)", "#ERROR!"),
        ("=NEGBINOMDIST(1,3,0.5,TRUE)", "#ERROR!"),
        ("=BINOM.DIST(-1,3,0.5,FALSE)", "#NUM!"),
        ("=BINOM.DIST(4,3,0.5,TRUE)", "#NUM!"),
        ("=BINOM.DIST(1,3,1.01,TRUE)", "#NUM!"),
        ("=BINOM.DIST.RANGE(3,0.5,2,1)", "#NUM!"),
        ("=BINOM.INV(3,0,0.5)", "#NUM!"),
        ("=BINOM.INV(3,1,0.5)", "#NUM!"),
        ("=BINOM.INV(3,0.5,0)", "#NUM!"),
        ("=BINOM.INV(3,0.5,1)", "#NUM!"),
        ("=NEGBINOM.DIST(1,0,0.5,FALSE)", "#NUM!"),
        ("=NEGBINOM.DIST(1,3,0,FALSE)", "#NUM!"),
        ("=NEGBINOM.DIST(1,3,1,FALSE)", "#NUM!"),
        ("=BINOM.DIST(\"TRUE\",3,0.5,FALSE)", "#VALUE!"),
        ("=BINOM.DIST(1,3,0.5,\"bad\")", "#VALUE!"),
        ("=BINOM.DIST(1,#REF!,0.5,FALSE)", "#REF!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}
#[test]
fn binomial_arrays_tables_map_and_errors_survive_reopening() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Successes"),
            (0, 1, 0, "0"),
            (0, 2, 0, "1"),
            (0, 3, 0, "2"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Outcomes", [0, 0, 3, 0], LIMIT).unwrap();
    book.edit(
        &[
            (0, 1, 2, "=BINOM.DIST(Outcomes[Successes],3,0.5,FALSE)"),
            (0, 1, 4, "=BINOM.DIST(Outcomes[Successes],3,{0.5,1},TRUE)"),
            (
                0,
                6,
                0,
                "=MAP({0.25;0.5;0.75},LAMBDA(a,BINOM.INV(3,0.5,a)))",
            ),
            (0, 10, 0, "=BINOM.DIST({1,#N/A,1},3,{0.5,0.5,2},FALSE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, c, v) in [
            (1, 2, 0.125),
            (2, 2, 0.375),
            (3, 2, 0.375),
            (1, 4, 0.125),
            (3, 4, 0.875),
            (3, 5, 0.),
            (6, 0, 1.),
            (7, 0, 1.),
            (8, 0, 2.),
        ] {
            near(&restored, r, c, v);
        }
        assert_eq!(restored.display(0, 10, 1, LIMIT).unwrap(), "#N/A");
        assert_eq!(restored.display(0, 10, 2, LIMIT).unwrap(), "#NUM!");
        restored.edit(&[(0, 3, 0, "3")], LIMIT).unwrap();
        near(&restored, 3, 2, 0.125);
        near(&restored, 3, 5, 1.);
    }
}

#[test]
fn binomial_large_trials_and_tiny_tails_remain_finite() {
    // Independent 70-digit Decimal recurrence normalized by its full mass;
    // SciPy's log-gamma PMF loses ~3e-11 relative precision at n=1,000,000.
    let mut book = Spreadsheet::new();
    for (f, e) in [
        ("=BINOM.DIST(500,1000,0.5,FALSE)", 0.0252250181783608),
        ("=BINOM.DIST(500,1000,0.5,TRUE)", 0.5126125090891804),
        (
            "=BINOM.DIST(300000,1000000,0.3,FALSE)",
            0.0008705631546366808,
        ),
        ("=BINOM.DIST(300000,1000000,0.3,TRUE)", 0.5004933190666793),
        ("=BINOM.DIST(200,1000,0.01,FALSE)", 2.1321955003017422e-188),
        ("=BINOM.DIST(900,1000,0.5,FALSE)", 5.958935980362645e-162),
        (
            "=BINOM.DIST.RANGE(1000,0.5,900,910)",
            6.701717789895613e-162,
        ),
        (
            "=BINOM.DIST.RANGE(1000,0.01,200,210)",
            2.221482673839489e-188,
        ),
        ("=BINOM.DIST(0,1000000,1E-8,TRUE)", 0.9900498336996656),
        ("=BINOM.DIST(1,1000000,1E-8,FALSE)", 0.009900498436001624),
        (
            "=BINOM.DIST(999999,1000000,0.99999999,TRUE)",
            0.009950166350082057,
        ),
    ] {
        book.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&book, 0, 0, e);
    }
    book.edit(&[(0, 0, 0, "=BINOM.INV(1000000,0.3,0.9)")], 1_000_000)
        .unwrap();
    near(&book, 0, 0, 300587.);
    let before = book.to_json();
    assert!(
        book.edit(
            &[(0, 0, 0, "=BINOM.DIST(500000000000,1000000000000,0.5,TRUE)")],
            10_000
        )
        .is_err()
    );
    assert_eq!(book.to_json(), before);
}

#[test]
fn binomial_inverse_selects_first_integer_at_exact_cdf_boundaries() {
    let mut book = Spreadsheet::new();
    for n in 1..=24 {
        for k in 0..n {
            let f = format!("=BINOM.INV({n},0.5,BINOM.DIST({k},{n},0.5,TRUE))");
            book.edit(&[(0, 0, 0, &f)], LIMIT).unwrap();
            near(&book, 0, 0, k as f64);
        }
    }
}

#[test]
fn binomial_symmetric_large_cdf_accounts_for_the_remaining_tail() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0,0,0,"=BINOM.DIST(5000000000,10000000000,0.5,TRUE)-(0.5+BINOM.DIST(5000000000,10000000000,0.5,FALSE)/2)")],LIMIT).unwrap();
    let Some(Value::Number(error)) = book.cell(0, 0, 0).and_then(|c| c.value.clone()) else {
        panic!()
    };
    assert!(error.abs() < 3e-15, "Symmetry error: {error:.17e}");
}

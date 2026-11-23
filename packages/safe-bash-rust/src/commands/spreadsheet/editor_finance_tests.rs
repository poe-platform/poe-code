// Adapted from IronCalc financial/mod.rs and test_fn_financial.rs,
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT; LICENSE.IronCalc).
use super::{Spreadsheet, Value};
const LIMIT: usize = 10_000_000;
fn value(book: &Spreadsheet, r: usize, c: usize) -> f64 {
    match book.cell(0, r, c).and_then(|cell| cell.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!(
            "expected number at {r},{c}: {}",
            book.display(0, r, c, LIMIT).unwrap()
        ),
    }
}
fn close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= 1e-8 * expected.abs().max(1.),
        "{actual} != {expected}"
    );
}

#[test]
fn mortgage_payments_and_present_future_values_follow_excel_examples() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=PMT(5%/12,360,100000)"),
            (0, 1, 0, "=PV(5%/12,360,A1)"),
            (0, 2, 0, "=FV(5%/12,360,A1,100000)"),
            (0, 3, 0, "=NPER(5%/12,A1,100000)"),
            (0, 4, 0, "=PMT(0,12,1200)"),
            (0, 5, 0, "=FV(0,12,-100,1200)"),
            (0, 6, 0, "=PV(0,12,-100)"),
            (0, 7, 0, "=NPER(0,-100,1200)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, n) in [
        (0, -536.8216230121399),
        (1, 100000.),
        (2, 0.),
        (3, 360.),
        (4, -100.),
        (5, 0.),
        (6, 1200.),
        (7, 12.),
    ] {
        close(value(&book, r, 0), n);
    }
}

#[test]
fn annuity_inverses_remain_accurate_for_tiny_and_negative_rates() {
    for rate in [0., 1e-14, 1e-10, 0.003, 0.2, -0.01] {
        for periods in [1., 12., 360.] {
            // At extreme growth the payment loses the information needed to recover nper.
            if rate > 0. && periods * f64::ln_1p(rate) > 20. {
                continue;
            }
            for kind in [0, 1] {
                let mut book = Spreadsheet::new();
                let payment = format!("=PMT({rate},{periods},1000,25,{kind})");
                let present = format!("=PV({rate},{periods},A1,25,{kind})");
                let count = format!("=NPER({rate},A1,1000,25,{kind})");
                let future = format!("=FV({rate},{periods},A1,1000,{kind})");
                book.edit(
                    &[
                        (0, 0, 0, &payment),
                        (0, 1, 0, &present),
                        (0, 2, 0, &count),
                        (0, 3, 0, &future),
                    ],
                    LIMIT,
                )
                .unwrap();
                close(value(&book, 1, 0), 1000.);
                close(value(&book, 2, 0), periods);
                close(value(&book, 3, 0), 25.);
            }
        }
    }
}

#[test]
fn rate_uses_the_guess_handles_zero_and_returns_real_roots() {
    let mut book = Spreadsheet::new();
    for (r, formula) in [
        "=RATE(2,230,-100,-362,0,0.05)",
        "=RATE(2,230,-100,-362,0,0.25)",
        "=RATE(48,-200,8000,0,0,0)",
        "=RATE(12,-1000,10000,0,1,0)",
        "=RATE(12,-100,1200,0,0,0)",
        "=RATE(12,100,1200)",
    ]
    .into_iter()
    .enumerate()
    {
        book.edit(&[(0, r, 0, formula)], LIMIT).unwrap();
    }
    for (r, n) in [
        (0, 0.1),
        (1, 0.2),
        (2, 0.007701472488195906),
        (3, 0.03503153036128806),
        (4, 0.),
    ] {
        close(value(&book, r, 0), n);
    }
    assert_eq!(book.display(0, 5, 0, LIMIT).unwrap(), "#NUM!");
}

#[test]
fn interest_and_principal_arrays_agree_with_cumulative_payments() {
    for kind in [0, 1] {
        let mut book = Spreadsheet::new();
        let interest = format!("=IPMT(9%/12,SEQUENCE(12,1,13),360,125000,0,{kind})");
        let principal = format!("=PPMT(9%/12,SEQUENCE(12,1,13),360,125000,0,{kind})");
        let ci = format!("=CUMIPMT(9%/12,360,125000,13,24,{kind})");
        let cp = format!("=CUMPRINC(9%/12,360,125000,13,24,{kind})");
        book.edit(
            &[
                (0, 0, 0, &interest),
                (0, 0, 1, &principal),
                (0, 0, 3, &ci),
                (0, 1, 3, &cp),
                (0, 2, 3, "=SUM(A1#)"),
                (0, 3, 3, "=SUM(B1#)"),
            ],
            LIMIT,
        )
        .unwrap();
        close(value(&book, 0, 3), value(&book, 2, 3));
        close(value(&book, 1, 3), value(&book, 3, 3));
        if kind == 0 {
            close(value(&book, 0, 3), -11135.232130750896);
            close(value(&book, 1, 3), -934.1071234208911);
        }
    }
}

#[test]
fn growth_fractional_prices_and_depreciation_have_typed_results() {
    let mut book = Spreadsheet::new();
    for (r, formula) in [
        "=ISPMT(1,2,5,4)",
        "=RRI(12,100,200)",
        "=PDURATION(0.1,100,200)",
        "=SLN(30000,7500,10)",
        "=SYD(30000,7500,10,1)",
        "=DDB(2400,300,10,1)",
        "=DB(1000000,100000,6,1,7)",
        "=NOMINAL(EFFECT(0.12,12),12)",
        "=DOLLARDE(1.02,16)",
        "=DOLLARFR(1.125,16)",
    ]
    .into_iter()
    .enumerate()
    {
        book.edit(&[(0, r, 0, formula)], LIMIT).unwrap();
    }
    for (r, n) in [
        (0, -2.4),
        (1, 2_f64.powf(1. / 12.) - 1.),
        (2, 2_f64.ln() / 1.1_f64.ln()),
        (3, 2250.),
        (4, 4090.90909090909),
        (5, 480.),
        (6, 186083.33333333334),
        (7, 0.12),
        (8, 1.125),
        (9, 1.02),
    ] {
        close(value(&book, r, 0), n);
    }
}

#[test]
fn financial_argument_errors_and_resource_failures_preserve_the_workbook() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=PMT()", "#ERROR!"),
        ("=PMT(0,0,100)", "#NUM!"),
        ("=NPER(0,0,100)", "#DIV/0!"),
        ("=RATE(12,-100,1000,0,0,-1)", "#VALUE!"),
        ("=IPMT(0.1,0,12,1000)", "#NUM!"),
        ("=CUMIPMT(0.1,12,1000,1,12,2)", "#NUM!"),
        ("=NOMINAL(TRUE,12)", "#VALUE!"),
        ("=SLN(10,2,0)", "#DIV/0!"),
        ("=DOLLARDE(1.2,0)", "#DIV/0!"),
        ("=PMT(NA(),12,1000)", "#N/A"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
    book.edit(&[(0, 0, 0, "=PMT(0,12,1200)")], LIMIT).unwrap();
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 0, "=CUMIPMT(0.1,1E15,1000,1,1E15,0)")], 100_000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
    let book = Spreadsheet::from_json(&before, LIMIT).unwrap();
    let mut book = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    close(value(&book, 0, 0), -100.);
    book.edit(&[(0, 0, 0, "=PMT(0,12,2400)")], LIMIT).unwrap();
    close(value(&book, 0, 0), -200.);
}

#[test]
fn finite_financial_results_survive_extreme_growth_and_close_large_values() {
    let mut book = Spreadsheet::new();
    for (r, formula) in [
        "=PMT(0.2,10000,1000)",
        "=FV(0.2,10000,-200,1000)",
        "=RRI(1000,1E-300,1E300)",
        "=PDURATION(1E-14,1E300,1E300*(1+1E-14))",
        "=DB(1E308,0,6,1,12)",
        "=DOLLARDE(1.125,1.5E308)",
        "=DOLLARFR(1.8333333333333333,1.5E308)",
    ]
    .into_iter()
    .enumerate()
    {
        book.edit(&[(0, r, 0, formula)], LIMIT).unwrap();
    }
    close(value(&book, 0, 0), -200.);
    close(value(&book, 1, 0), -1000.);
    close(value(&book, 2, 0), 10_f64.powf(0.6) - 1.);
    let pv = 1e300_f64;
    let fv = pv * (1. + 1e-14);
    close(
        value(&book, 3, 0),
        ((fv - pv) / pv).ln_1p() / 1e-14_f64.ln_1p(),
    );
    close(value(&book, 4, 0), 1e308);
    close(value(&book, 5, 0), 1.8333333333333333);
    close(value(&book, 6, 0), 1.125);
}

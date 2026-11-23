// Cash-flow examples from IronCalc financial/{mod,financial_util}.rs and
// Univer financial/{npv,irr,xnpv,xirr,mirr}/__tests__/index.spec.ts.
// See LICENSE.IronCalc and LICENSE.Univer for the pinned upstream licenses.
use super::{Spreadsheet, Value};
const LIMIT: usize = 10_000_000;

fn number(book: &Spreadsheet, row: usize, column: usize) -> f64 {
    match book.cell(0, row, column).and_then(|c| c.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!(
            "expected number at {row},{column}: {}",
            book.display(0, row, column, LIMIT).unwrap()
        ),
    }
}
fn close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-9 * expected.abs().max(1.),
        "{actual} != {expected}"
    );
}

#[test]
fn npv_preserves_cashflow_order_and_distinguishes_blanks_from_zero() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "-10000"),
            (0, 2, 0, "3000"),
            (0, 3, 0, "4200"),
            (0, 5, 0, "6800"),
            (0, 1, 0, "ignored"),
            (0, 4, 0, "TRUE"),
            (0, 0, 2, "=NPV(0.1,A:A)"),
            (0, 1, 2, "=NPV(0.1,{-10000,3000,4200,6800},TRUE)"),
            (0, 2, 2, "=NPV(0.1,{-10000,3000;4200,6800})"),
            (0, 3, 2, "=NPV(0,1E16,1,-1E16)"),
            (0, 4, 2, "=NPV(0.1,100,0,100)"),
            (0, 5, 2, "=NPV(0.1,100,100)"),
        ],
        LIMIT,
    )
    .unwrap();
    close(number(&book, 0, 2), 1188.44341233522);
    close(number(&book, 1, 2), 1189.06433365828);
    close(number(&book, 2, 2), 1188.44341233522);
    close(number(&book, 3, 2), 1.);
    close(number(&book, 4, 2), 100. / 1.1 + 100. / 1.1_f64.powi(3));
    close(number(&book, 5, 2), 100. / 1.1 + 100. / 1.1_f64.powi(2));
}

#[test]
fn irr_finds_guess_dependent_roots_and_long_cashflow_returns() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (
                0,
                0,
                0,
                "=IRR({-700000,120000,150000,180000,210000,260000})",
            ),
            (0, 1, 0, "=IRR({-100,230,-132},0.05)"),
            (0, 2, 0, "=IRR({-100,230,-132},0.25)"),
            (0, 3, 0, "=IRR({-100,50},0)"),
            (0, 4, 0, "=IRR({-1,1E50})"),
            (0, 5, 0, "=IRR({-1E-300,1E300})"),
            (0, 6, 0, "=IRR({-100,100},0)"),
        ],
        LIMIT,
    )
    .unwrap();
    close(number(&book, 0, 0), 0.0866309480365);
    close(number(&book, 1, 0), 0.1);
    close(number(&book, 2, 0), 0.2);
    close(number(&book, 3, 0), -0.5);
    close(number(&book, 4, 0), 1E50);
    assert_eq!(book.display(0, 5, 0, LIMIT).unwrap(), "#NUM!");
    close(number(&book, 6, 0), 0.);
    let owned: Vec<_> = (0..301)
        .map(|r| {
            (
                0,
                r,
                3,
                if r == 0 {
                    "-149150"
                } else if r <= 24 {
                    "250"
                } else {
                    "832.1256634329588"
                }
                .to_owned(),
            )
        })
        .collect();
    let mut edits: Vec<_> = owned
        .iter()
        .map(|(s, r, c, v)| (*s, *r, *c, v.as_str()))
        .collect();
    edits.push((0, 0, 5, "=IRR(D:D)"));
    book.edit(&edits, LIMIT).unwrap();
    close(number(&book, 0, 5), 0.00308889248291);
}

#[test]
fn dated_cashflows_use_truncated_dates_and_keep_values_paired() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (
                0,
                0,
                0,
                "=XNPV(0.1,{-10000,2750,4250,3250,2750},{39448,39508,39751,39859,39904})",
            ),
            (
                0,
                1,
                0,
                "=XIRR({-10000,2750,4250,3250,2750},{39448,39508,39751,39859,39904})",
            ),
            (
                0,
                2,
                0,
                "=XNPV(A2,{-10000,2750,4250,3250,2750},{39448,39508,39751,39859,39904})",
            ),
            (0, 3, 0, "=XNPV(0,{-100,120},{40000,40365})"),
            (0, 4, 0, "=XNPV(0.1,{-100,120},{40000.9,40365.1})"),
            (0, 5, 0, "=XIRR({-100,50},{40000,40365})"),
            (0, 6, 0, "=XNPV(0.1,{-100,30,80},{40000,40730,40365})"),
            (0, 7, 0, "=XIRR({-100,120},{40000,40365},0)"),
        ],
        LIMIT,
    )
    .unwrap();
    close(number(&book, 0, 0), 1994.51004065326);
    close(number(&book, 1, 0), 0.373362533519);
    close(number(&book, 2, 0), 0.);
    close(number(&book, 3, 0), 20.);
    close(number(&book, 4, 0), -100. + 120. / 1.1);
    close(number(&book, 5, 0), -0.5);
    close(number(&book, 6, 0), -100. + 30. / 1.21 + 80. / 1.1);
    close(number(&book, 7, 0), 0.2);
}

#[test]
fn modified_returns_growth_schedules_and_rate_arrays_recalculate() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (
                0,
                0,
                0,
                "=MIRR({-120000,39000,30000,21000,37000,46000},0.1,0.12)",
            ),
            (0, 1, 0, "=MIRR({-30,-20,-10,5,5,5},-1,2)"),
            (0, 2, 0, "=FVSCHEDULE(1,{0.09,0.11,0.1})"),
            (0, 3, 0, "=FVSCHEDULE(1000,{-1.5})"),
            (0, 4, 0, "=NPV({0.1,-0.1,-1},{-10000,3000,4200,6800})"),
            (0, 5, 0, "=IRR({-100,230,-132},{0.05,0.25})"),
            (
                0,
                6,
                0,
                "=MIRR({-700000,120000,150000,180000,210000,260000},{0.1,0.12},0.12)",
            ),
            (0, 7, 0, "=FVSCHEDULE({100,200},{0.1,0.2})"),
        ],
        LIMIT,
    )
    .unwrap();
    close(number(&book, 0, 0), 0.1260941303659051);
    close(number(&book, 1, 0), -1.);
    close(number(&book, 2, 0), 1.33089);
    close(number(&book, 3, 0), -500.);
    close(number(&book, 4, 0), 1188.44341233522);
    close(number(&book, 4, 1), 8718.18320378);
    assert_eq!(book.display(0, 4, 2, LIMIT).unwrap(), "#DIV/0!");
    close(number(&book, 5, 0), 0.1);
    close(number(&book, 5, 1), 0.2);
    close(number(&book, 6, 0), 0.0986691073372);
    close(number(&book, 6, 1), 0.0986691073372);
    close(number(&book, 7, 0), 132.);
    close(number(&book, 7, 1), 264.);
}

#[test]
fn cashflow_errors_and_atomic_resource_failures_do_not_corrupt_data() {
    let mut book = Spreadsheet::new();
    for (formula, error) in [
        ("=NPV()", "#ERROR!"),
        ("=XNPV(1,1)", "#ERROR!"),
        ("=IRR({1,2,3})", "#NUM!"),
        ("=IRR({-1,1},-1)", "#VALUE!"),
        ("=IRR({0,0})", "#NUM!"),
        ("=NPV(0.1,\"oops\")", "#VALUE!"),
        ("=NPV(0.1,{1,#N/A})", "#N/A"),
        ("=XNPV(0.1,{-100,120},{40000})", "#NUM!"),
        ("=XNPV(0.1,{-100,120},{40000,39999})", "#NUM!"),
        ("=XNPV(0.1,{-100,120},{40000,2958466})", "#NUM!"),
        ("=XIRR({-100,120},{40000,40000})", "#NUM!"),
        ("=MIRR({1,2,3},0.1,0.2)", "#DIV/0!"),
        ("=FVSCHEDULE(100,{0.1,\"oops\"})", "#VALUE!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), error, "{formula}");
    }
    book.edit(&[(0, 0, 0, "=IRR({-100,120})")], LIMIT).unwrap();
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 0, "=IRR(SEQUENCE(1000000))")], 100_000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
    assert!(book.edit(&[(0, 0, 0, "=IRR({-1,1E50})")], 2_000).is_err());
    assert_eq!(book.to_json(), before);
    let book = Spreadsheet::from_json(&before, LIMIT).unwrap();
    let mut book = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    close(number(&book, 0, 0), 0.2);
    book.edit(&[(0, 0, 0, "=IRR({-100,130})")], LIMIT).unwrap();
    close(number(&book, 0, 0), 0.3);
}

#[test]
fn cashflow_sparse_ranges_read_all_spill_children_without_dense_allocation() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=NPV(0.1,D:D)"),
            (0, 0, 3, "=SEQUENCE(5)"),
            (0, 1, 0, "=IRR(F:F)"),
            (0, 0, 5, "=VSTACK(-100,120)"),
            (0, 2, 0, "=FVSCHEDULE(100,H:H)"),
            (0, 900000, 7, "0.1"),
        ],
        100_000,
    )
    .unwrap();
    close(number(&book, 0, 0), 10.652588311);
    close(number(&book, 1, 0), 0.2);
    close(number(&book, 2, 0), 110.);
}

#[test]
fn finite_cashflow_results_survive_intermediate_overflow_and_underflow() {
    let mut book = Spreadsheet::new();
    book.edit(&[
        (0,0,0,"=FVSCHEDULE(1E300,{1E100,-0.9999999999,-0.9999999999,-0.9999999999,-0.9999999999,-0.9999999999,-0.9999999999,-0.9999999999,-0.9999999999,-0.9999999999,-0.9999999999})"),
        (0,1,0,"=FVSCHEDULE(1E-300,{-0.9999999999,-0.9999999999,-0.9999999999,1E100})"),
        (0,2,0,"=FVSCHEDULE(1E300,{1E100,-1})"),
        (0,5,0,"=IRR({-1E-300,1.1E-300})"),
        (0,6,0,"=IRR({-1E300,1.1E300})"),
    ],LIMIT).unwrap();
    let small = 1. - 0.9999999999_f64;
    close(number(&book, 0, 0), 1E300 * (small / 1E-10).powi(10));
    let expected = 1E-200 * small.powi(3);
    assert!((number(&book, 1, 0) / expected - 1.).abs() < 1E-10);
    close(number(&book, 2, 0), 0.);
    close(number(&book, 5, 0), 0.1);
    close(number(&book, 6, 0), 0.1);
}

#[test]
fn modified_return_can_be_finite_when_future_value_overflows() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=MIRR({-1,1E300,1E300},0.1,1E100)")], LIMIT)
        .unwrap();
    close(number(&book, 0, 0), 1E200);
}

#[test]
fn present_value_can_be_finite_when_a_partial_sum_overflows() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=NPV(0,1E308,1E308,-1E308)")], LIMIT)
        .unwrap();
    close(number(&book, 0, 0), 1E308);
}

#[test]
fn dated_ranges_preserve_blanks_and_the_workbooks_date_system() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        book.edit(
            &[
                (0, 0, 0, "-100"),
                (0, 2, 0, "120"),
                (0, 0, 1, "40000"),
                (0, 1, 1, "40100"),
                (0, 2, 1, "40365"),
                (0, 0, 3, "=XIRR(A1:A3,B1:B3)"),
                (0, 1, 3, "=XNPV(0.1,A1:A3,B1:B3)"),
                (0, 2, 3, "=XNPV(0.1,{-100,120},{2957003,2957004})"),
            ],
            LIMIT,
        )
        .unwrap();
        close(number(&book, 0, 3), 0.2);
        assert_eq!(book.display(0, 1, 3, LIMIT).unwrap(), "#NUM!");
        if date1904 {
            assert_eq!(book.display(0, 2, 3, LIMIT).unwrap(), "#NUM!");
        } else {
            close(number(&book, 2, 3), -100. + 120. / 1.1_f64.powf(1. / 365.));
        }
        book.edit(&[(0, 1, 0, "0")], LIMIT).unwrap();
        close(number(&book, 1, 3), -100. + 120. / 1.1);
        let before = book.to_json();
        let json = Spreadsheet::from_json(&before, LIMIT).unwrap();
        let xlsx = Spreadsheet::import_xlsx(&json.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert_eq!(xlsx.options.date1904, date1904);
        close(number(&xlsx, 0, 3), 0.2);
        close(number(&xlsx, 1, 3), -100. + 120. / 1.1);
    }
}

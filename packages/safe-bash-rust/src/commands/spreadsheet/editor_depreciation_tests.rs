// Examples and edge cases adapted from IronCalc test_fn_depreciation.rs
// (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc) and
// Univer financial/{vdb,amorlinc,amordegrc}/__tests__/index.spec.ts
// (4767b3b309467c283bbd52b725536ca73861e0fc, Apache-2.0, LICENSE.Univer).
use super::{Spreadsheet, Value};
const LIMIT: usize = 10_000_000;

fn number(book: &Spreadsheet, row: usize, column: usize) -> f64 {
    match book
        .cell(0, row, column)
        .and_then(|cell| cell.value.clone())
    {
        Some(Value::Number(n)) => n,
        _ => panic!("{}", book.display(0, row, column, LIMIT).unwrap()),
    }
}
fn close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= expected.abs().max(1.) * 1e-10,
        "{actual} != {expected}"
    );
}

#[test]
fn degressive_late_period_charge_matches_calc_and_gnumeric() {
    // Period four was independently recalculated as 345 by Calc and Gnumeric.
    // Continue past the nominal five-year life through the salvage crossing.
    let mut book = Spreadsheet::new();
    for (period, expected) in [1003., 1599., 959., 576., 345., 207., 124., 75., 56., 0.]
        .into_iter()
        .enumerate()
    {
        let formula =
            format!("=AMORDEGRC(5000,DATE(2019,7,1),DATE(2019,12,31),100,{period},0.2,1)");
        book.edit(&[(0, 0, 0, &formula)], 2_000_000).unwrap();
        let actual = number(&book, 0, 0);
        assert!(
            (actual - expected).abs() <= 1e-8,
            "period {period}: {actual} != {expected}"
        );
    }
}

#[test]
fn variable_depreciation_matches_documented_examples_and_fractional_periods() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=VDB(2400,300,10,0,1)", 480.),
        ("=VDB(2400,300,10,0,0.875,1.5)", 315.),
        // Exact geometric balance, beyond the documented example's rounding.
        ("=VDB(2400,300,120,6,18)", 396.3060532647511),
        ("=VDB(2400,300,10,0,10,1)", 2100.),
        ("=VDB(2400,300,10,0,10,1,TRUE)", 1563.17174376),
        ("=VDB(24000,3000,10,1,2)", 3840.),
        ("=VDB(24000,3000,10,1,2,,TRUE)", 3840.),
        // One tenth of period seven: 24000 * 0.8^6 * 0.2 * 0.1.
        ("=VDB(24000,3000,10,6.1,6.2)", 125.82912),
        ("=VDB(2400,3000,10,1,2)", 0.),
        ("=VDB(2400,3000,10,0.1,2)", -600.),
        ("=VDB(2400,3000,10,0.1,0.2)", -60.),
        ("=VDB(2400,300,10,0,1,0)", 210.),
        ("=VDB(2400,300,10,0,1,0,TRUE)", 0.),
        ("=VDB(100,0,2,0,0)", 0.),
        ("=VDB(100,0,2,2,2)", 0.),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        close(number(&book, 0, 0), expected);
    }
}

#[test]
fn variable_depreciation_prorates_the_original_schedule() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=VDB(12000,200,6,1.75,2,2,0)", 666.666666666667),
        ("=VDB(12000,200,6,1.75,2,2,1)", 666.666666666667),
        ("=VDB(12000,200,6,1,1.75)", 2000.),
        ("=VDB(12000,200,6,1.75,2.5)", 1555.555555555556),
        ("=VDB(12000,200,6,0.25,0.75)", 2000.),
        // Factor one switches immediately to a constant straight-line rate.
        ("=VDB(12000,0,6,1.75,2.25,1)", 1000.),
        // The final two periods use straight-line depreciation.
        ("=VDB(12000,200,6,4.75,6)", 1356.481481481481),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let actual = number(&book, 0, 0);
        assert!(
            (actual - expected).abs() < 1e-8,
            "{formula}: {actual} != {expected}"
        );
    }
}

#[test]
fn french_depreciation_matches_complete_period_schedules_and_bases() {
    let mut book = Spreadsheet::new();
    for (salvage, expected) in [
        (300., [330., 776., 485., 303., 190., 158., 0., 0.]),
        (0., [330., 776., 485., 303., 190., 119., 74., 46.]),
    ] {
        for (period, expected) in expected.into_iter().enumerate() {
            book.edit(&[(0,0,0,&format!("=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),{salvage},{period},0.15,1)"))],LIMIT).unwrap();
            close(number(&book, 0, 0), expected);
        }
    }
    for (basis, linc, degrc) in [
        (0, 132., 330.),
        (1, 131.80327868852459, 330.),
        (3, 132.16438356164383, 330.),
        (4, 131., 328.),
    ] {
        for (name, expected) in [("AMORLINC", linc), ("AMORDEGRC", degrc)] {
            book.edit(
                &[(
                    0,
                    0,
                    0,
                    &format!("={name}(2400,DATE(2008,8,19),DATE(2008,12,31),300,0,0.15,{basis})"),
                )],
                LIMIT,
            )
            .unwrap();
            close(number(&book, 0, 0), expected);
        }
    }
    for (period, expected) in [
        (0., 132.),
        (0.5, 360.),
        (1., 360.),
        (1.9, 360.),
        (6., 168.),
        (7., 0.),
    ] {
        book.edit(
            &[(
                0,
                0,
                0,
                &format!("=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,{period},0.15)"),
            )],
            LIMIT,
        )
        .unwrap();
        close(number(&book, 0, 0), expected);
    }
}

#[test]
fn degressive_rounding_salvage_and_asset_life_follow_excel_regressions() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        (
            "=AMORDEGRC(9940.54,DATE(2019,3,31),DATE(2020,3,30),4677,0,0.441321,0)",
            5264.,
        ),
        (
            "=AMORDEGRC(9940.54,DATE(2019,3,31),DATE(2020,3,30),4677,1,0.441321,0)",
            0.,
        ),
        (
            "=AMORDEGRC(100,DATE(1998,2,28),DATE(2000,2,29),10,1,0.3,1)",
            5.,
        ),
        (
            "=AMORDEGRC(2400,DATE(2020,5,15),DATE(2020,5,15),300,0,0.15,1)",
            900.,
        ),
        (
            "=AMORDEGRC(2400,DATE(2020,5,15),DATE(2020,5,15),300,1,0.15,1)",
            563.,
        ),
        (
            "=AMORDEGRC(2400,DATE(2024,2,29),DATE(2024,12,31),300,1,0.15,1)",
            617.,
        ),
        (
            "=AMORDEGRC(100,DATE(1998,2,28),DATE(1999,2,28),10,0,0.15,0)",
            38.,
        ),
        (
            "=AMORDEGRC(100,DATE(1998,2,28),DATE(1999,2,28),10,1,0.15,0)",
            23.,
        ),
        (
            "=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,0.5,0.15,1)",
            0.,
        ),
        (
            "=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1.9,0.15,1)",
            776.,
        ),
        (
            "=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.333333333333333,1)",
            980.,
        ),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        close(number(&book, 0, 0), expected);
    }
    for (rate, expected) in [
        (0.3, 902.),
        (0.25, 776.),
        (0.24, 949.),
        (0.2222, 893.),
        (0.21, 853.),
        (0.1, 545.),
    ] {
        book.edit(
            &[(
                0,
                0,
                0,
                &format!("=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,{rate},1)"),
            )],
            LIMIT,
        )
        .unwrap();
        close(number(&book, 0, 0), expected);
    }
}

#[test]
fn depreciation_errors_and_long_schedules_are_bounded() {
    let mut book = Spreadsheet::new();
    for (formula, error) in [
        ("=VDB(1,0,2,0)", "#ERROR!"),
        ("=AMORLINC(1,2,3)", "#ERROR!"),
        ("=VDB(-1,0,2,0,1)", "#NUM!"),
        ("=VDB(1,-1,2,0,1)", "#NUM!"),
        ("=VDB(1,0,-2,0,1)", "#NUM!"),
        ("=VDB(1,0,2,1,0)", "#NUM!"),
        ("=VDB(1,0,2,0,3)", "#NUM!"),
        ("=VDB(1,0,2,0,1,-1)", "#NUM!"),
        ("=VDB(1,0,0,0,0)", "#DIV/0!"),
        ("=VDB(\"test\",0,2,0,1)", "#VALUE!"),
        ("=VDB(NA(),0,2,0,1)", "#N/A"),
        ("=AMORLINC(100,0,366,200,1,0.1)", "#NUM!"),
        ("=AMORLINC(100,0,366,0,1,0.1,2)", "#NUM!"),
        ("=AMORLINC(100,0,366,0,1,0.1,-0.5)", "#NUM!"),
        ("=AMORDEGRC(100,0,366,0,1,0.1,-0.5)", "#NUM!"),
        ("=AMORLINC(100,366,0,0,1,0.1)", "#NUM!"),
        ("=AMORLINC(100,-1,366,0,1,0.1)", "#NUM!"),
        ("=AMORLINC(100,0,1e20,0,1,0.1)", "#NUM!"),
        ("=AMORDEGRC(100,0,366,0,1,0.5)", "#NUM!"),
        ("=AMORDEGRC(TRUE,0,366,0,1,0.1)", "#VALUE!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), error, "{formula}");
    }
    book.edit(
        &[(
            0,
            0,
            0,
            "=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1e6,1e-9,1)",
        )],
        50_000,
    )
    .unwrap();
    close(number(&book, 0, 0), 0.);
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 0, "=VDB(2400,300,1e9,0,1e9)")], 50_000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
}

#[test]
fn depreciation_arrays_and_roundtrips_keep_typed_results_in_both_date_systems() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        book.edit(
            &[
                (0, 0, 0, "=VDB(2400,300,10,SEQUENCE(3,1,0),SEQUENCE(3))"),
                (0, 0, 2, "=AMORLINC(100,0,366,0,1,0.1,1)"),
                (
                    0,
                    1,
                    2,
                    "=AMORDEGRC(5000,DATE(2019,7,1),DATE(2019,12,31),100,4,0.2,1)",
                ),
            ],
            LIMIT,
        )
        .unwrap();
        for book in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            assert_eq!(book.options.date1904, date1904);
            for (r, n) in [(0, 480.), (1, 384.), (2, 307.2)] {
                close(number(&book, r, 0), n);
            }
            close(number(&book, 0, 2), 10.);
            close(number(&book, 1, 2), 345.);
        }
    }
}

#[test]
fn degressive_schedules_finish_when_rounded_charges_reach_zero() {
    let mut book = Spreadsheet::new();
    for period in [18., 1e6, 1e308] {
        let formula =
            format!("=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),0,{period},0.15,1)");
        book.edit(&[(0, 0, 0, &formula)], 50_000).unwrap();
        assert_eq!(number(&book, 0, 0), 0.);
    }
    let before = book.to_json();
    assert!(
        book.edit(
            &[(
                0,
                0,
                0,
                "=AMORDEGRC(1e15,DATE(2019,7,1),DATE(2019,12,31),0,1e6,1e-9,1)"
            )],
            50_000,
        )
        .is_err()
    );
    assert_eq!(book.to_json(), before);
}

#[test]
fn immediately_straight_line_schedules_do_not_require_per_period_work() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=VDB(2400,300,1e9,0,1e9,0)", 2100.),
        ("=VDB(2400,300,1e9,0,1e9,0.5)", 2100.),
        ("=VDB(2400,300,1e9,5e8,1e9,0)", 1050.),
    ] {
        book.edit(&[(0, 0, 0, formula)], 50_000).unwrap();
        close(number(&book, 0, 0), expected);
    }
}

// Cases adapted from IronCalc test_days360_month_end.rs / test_days_days360.rs
// (MIT, f93662006b8fb1c401dc870bbda26c5d60ac6037) and Univer date/{days,days360}
// (Apache-2.0, 4767b3b309467c283bbd52b725536ca73861e0fc).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn day_counts_use_excel_dates_and_distinct_360_day_month_end_rules() {
    let mut book = Spreadsheet::new();
    let mut failures = Vec::new();
    for (formula, want) in [
        ("=DAYS()", "#ERROR!"),
        ("=DAYS(1)", "#ERROR!"),
        ("=DAYS(1,2,3)", "#ERROR!"),
        ("=DAYS(DATE(2026,8,8),DATE(2026,8,6))", "2"),
        ("=DAYS(43832.233,FALSE)", "43832"),
        ("=DAYS(\"2021-12-31\",\"2021-01-01\")", "364"),
        ("=DAYS(\"2021-12-31\",\"test\")", "#VALUE!"),
        ("=DAYS(1.9,0.1)", "1"),
        ("=DAYS(-0.1,0)", "#NUM!"),
        ("=DAYS(2958466,0)", "#NUM!"),
        ("=DAYS(\"1900-03-01\",\"1900-02-28\")", "2"),
        ("=DAYS360()", "#ERROR!"),
        ("=DAYS360(1)", "#ERROR!"),
        ("=DAYS360(1,2,TRUE,FALSE)", "#ERROR!"),
        ("=DAYS360(DATE(2026,8,8),DATE(2026,8,6))", "-2"),
        ("=DAYS360(DATE(2021,1,31),DATE(2021,2,28))", "28"),
        ("=DAYS360(DATE(2020,1,31),DATE(2020,2,28))", "28"),
        ("=DAYS360(DATE(2020,2,28),DATE(2020,3,31))", "33"),
        ("=DAYS360(DATE(2021,4,30),DATE(2021,5,31))", "30"),
        ("=DAYS360(DATE(2021,1,31),DATE(2021,2,28),TRUE)", "28"),
        ("=DAYS360(DATE(2020,1,31),DATE(2020,2,29),TRUE)", "29"),
        ("=DAYS360(DATE(2021,8,31),DATE(2021,9,30),TRUE)", "30"),
        ("=DAYS360(\"2021/1/29\",\"2021/3/31\")", "62"),
        ("=DAYS360(\"2021/1/29\",\"2021/3/31\",1)", "61"),
        ("=DAYS360(\"2021/3/31\",\"2021/1/29\")", "-61"),
        ("=DAYS360(\"2021/3/31\",\"2021/1/29\",1)", "-61"),
        ("=DAYS360(FALSE,43832.233)", "43202"),
        ("=DAYS360(FALSE,43832.233,TRUE)", "43202"),
        ("=DAYS360(\"test\",\"2021-12-31\")", "#VALUE!"),
        ("=DAYS360(1,#NAME?)", "#NAME?"),
        ("=DAYS360(-0.5,0)", "#NUM!"),
        ("=DAYS360(-0.000001,0)", "0"),
        ("=DAYS360(46000.999999,46001)", "0"),
        ("=DAYS360(\"2026-01-01 23:59:59.999\",\"2026-01-02\")", "0"),
        ("=DAYS360(-1,0)", "#NUM!"),
        ("=DAYS360(0,2958466)", "#NUM!"),
        ("=DAYS360(\"2021-02-28\",\"2021-03-31\")", "30"),
        ("=DAYS360(\"2021-02-28\",\"2021-03-31\",\"tRuE\")", "32"),
        ("=DAYS360(0,1,\"1\")", "#VALUE!"),
        ("=DAYS360(0,1,\"test\")", "#VALUE!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let actual = book.display(0, 0, 0, LIMIT).unwrap();
        if actual != want {
            failures.push(format!("{formula}: {actual} != {want}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn days_broadcasts_dates_with_typed_blanks_errors_and_booleans() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "'2012-2-12"),
            (0, 0, 1, "test"),
            (0, 0, 2, "TRUE"),
            (0, 0, 3, "FALSE"),
            (0, 0, 4, "=#NAME?"),
            (0, 1, 7, "'1900-1-1"),
            (0, 3, 0, "=DAYS(A1:F1,H1:H2)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, row) in [
        ["40951", "#VALUE!", "1", "0", "#NAME?", "0"],
        ["40950", "#VALUE!", "0", "-1", "#NAME?", "-1"],
    ]
    .into_iter()
    .enumerate()
    {
        for (c, want) in row.into_iter().enumerate() {
            assert_eq!(book.display(0, r + 3, c, LIMIT).unwrap(), want, "{r},{c}");
        }
    }
}

#[test]
fn days360_broadcasts_and_pads_inputs_then_recalculates_after_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "'2012-3-29"),
            (0, 0, 1, "test"),
            (0, 0, 2, "TRUE"),
            (0, 0, 3, "FALSE"),
            (0, 0, 4, "=#NAME?"),
            (0, 0, 6, "'2008-3-1"),
            (0, 2, 6, "'2013-3-31"),
            (0, 2, 8, "1"),
            (0, 6, 0, "=DAYS360(A1:E1,G1:G3,I1:I5)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, row) in [
        ["-1468", "#VALUE!", "38940", "38941", "#NAME?"],
        ["-40409", "#VALUE!", "-1", "0", "#NAME?"],
        ["361", "#VALUE!", "40769", "40770", "#NAME?"],
        ["#N/A", "#VALUE!", "#N/A", "#N/A", "#NAME?"],
        ["#N/A", "#VALUE!", "#N/A", "#N/A", "#NAME?"],
    ]
    .into_iter()
    .enumerate()
    {
        for (c, want) in row.into_iter().enumerate() {
            assert_eq!(book.display(0, r + 6, c, LIMIT).unwrap(), want, "{r},{c}");
        }
    }
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.display(0, 8, 0, LIMIT).unwrap(), "361");
        restored.edit(&[(0, 2, 6, "'2014-3-31")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 8, 0, LIMIT).unwrap(), "721");
        restored.edit(&[(0, 2, 8, "FALSE")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 8, 0, LIMIT).unwrap(), "722");
    }
}

#[test]
fn day_counts_respect_both_excel_epochs_and_atomic_work_limits() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        book.edit(
            &[
                (0, 0, 0, "=DAYS(366,0)"),
                (0, 1, 0, "=DAYS360(0,31)"),
                (0, 2, 0, "=DAYS360(0,366)"),
            ],
            LIMIT,
        )
        .unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "366");
        assert_eq!(
            book.display(0, 1, 0, LIMIT).unwrap(),
            if date1904 { "30" } else { "31" }
        );
        assert_eq!(
            book.display(0, 2, 0, LIMIT).unwrap(),
            if date1904 { "360" } else { "361" }
        );
        let saved = book.to_json();
        assert!(
            book.edit(&[(0, 4, 0, "=DAYS360(SEQUENCE(10000),10000)")], 20_000)
                .is_err()
        );
        assert_eq!(book.to_json(), saved);
    }
}

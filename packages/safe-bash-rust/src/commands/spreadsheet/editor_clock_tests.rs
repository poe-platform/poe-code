// Cases adapted from IronCalc test_fn_time.rs / test_fn_minute_second_rounding.rs
// (MIT, f93662006b8fb1c401dc870bbda26c5d60ac6037) and Univer date/time tests
// (Apache-2.0, 4767b3b309467c283bbd52b725536ca73861e0fc).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn time_discards_fractional_components_and_bounds_inputs_before_normalizing() {
    let mut book = Spreadsheet::new();
    let mut failures = Vec::new();
    for (args, want) in [
        ("0,0,0", "00:00:00"),
        ("12,0,0", "12:00:00"),
        ("14,30,0", "14:30:00"),
        ("23,59,59", "23:59:59"),
        ("25,0,0", "01:00:00"),
        ("48,0,0", "00:00:00"),
        ("0,90,0", "01:30:00"),
        ("0,0,90", "00:01:30"),
        ("14.9,30.9,59.9", "14:30:59"),
        ("14,30,45.999", "14:30:45"),
        ("24,60,60", "01:01:00"),
        ("0,0,0.001", "00:00:00"),
        ("TRUE,FALSE,\"2\"", "01:00:02"),
        ("27,750,3661", "16:31:01"),
        ("32767,0,0", "07:00:00"),
        ("32768,0,0", "#NUM!"),
        ("48,1439,86400", "#NUM!"),
        ("-1,0,0", "#NUM!"),
        ("0,-1,0", "#NUM!"),
        ("0,0,-1", "#NUM!"),
        ("-1,120,0", "01:00:00"),
        ("10,-1,0", "09:59:00"),
        ("2147483647,0,0", "#NUM!"),
        ("0,2147483647,0", "#NUM!"),
        ("0,0,2147483647", "#NUM!"),
    ] {
        let formula = format!("=TEXT(TIME({args}),\"hh:mm:ss\")");
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        let actual = book.display(0, 0, 0, LIMIT).unwrap();
        if actual != want {
            failures.push(format!("{formula}: {actual} != {want}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn clock_parts_round_together_across_seconds_minutes_hours_and_midnight() {
    let mut book = Spreadsheet::new();
    let mut failures = Vec::new();
    for (formula, want) in [
        ("=MINUTE(0.520833333)", "30"),
        ("=SECOND(0.520833333)", "0"),
        ("=SECOND(TIME(14,30,45.999))", "45"),
        ("=SECOND(0.9996/86400)", "1"),
        ("=MINUTE(0.99999999999)", "0"),
        ("=SECOND(65.8/86400)", "6"),
        ("=SECOND(59.6/86400)", "0"),
        ("=MINUTE(59.6/86400)", "1"),
        ("=SECOND(0.5+0.4/86400)", "0"),
        ("=SECOND(0.5+0.6/86400)", "1"),
        ("=HOUR(TIME(10,59,59)+0.6/86400)", "11"),
        ("=MINUTE(TIME(10,59,59)+0.6/86400)", "0"),
        ("=HOUR(TIME(10,59,59)+0.4/86400)", "10"),
        ("=HOUR(0.041666666)", "1"),
        ("=HOUR(1.5)", "12"),
        ("=HOUR(1000000.25)", "6"),
        ("=HOUR(0.999999999)", "0"),
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
fn clock_arrays_keep_types_errors_and_roundtrip_recalculation() {
    let mut book = Spreadsheet::new();
    let inputs = [
        "1", "' ", "1.23", "TRUE", "FALSE", "", "0", "'100", "'2.34", "test", "-3", "=#VALUE!",
    ];
    let mut edits: Vec<_> = inputs
        .iter()
        .enumerate()
        .map(|(i, s)| (0, i / 6, i % 6, *s))
        .collect();
    edits.push((0, 4, 0, "=TEXT(TIME(A1:F2,59,59),\"hh:mm:ss\")"));
    edits.push((0, 8, 0, "=HOUR(TIME(A1:F2,59,59))"));
    book.edit(&edits, LIMIT).unwrap();
    for (i, want) in [
        "01:59:59", "#VALUE!", "01:59:59", "01:59:59", "00:59:59", "00:59:59", "00:59:59",
        "04:59:59", "02:59:59", "#VALUE!", "#NUM!", "#VALUE!",
    ]
    .into_iter()
    .enumerate()
    {
        assert_eq!(book.display(0, 4 + i / 6, i % 6, LIMIT).unwrap(), want);
    }
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.display(0, 9, 1, LIMIT).unwrap(), "4");
        restored.edit(&[(0, 1, 1, "'25.9")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 5, 1, LIMIT).unwrap(), "01:59:59");
        assert_eq!(restored.display(0, 9, 1, LIMIT).unwrap(), "1");
    }
}

#[test]
fn clock_parts_reject_out_of_bounds_dates_and_honor_negative_1904_times() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        let max = if date1904 { 2_957_003 } else { 2_958_465 };
        for (name, negative) in [("HOUR", "6"), ("MINUTE", "0"), ("SECOND", "0")] {
            let formula = format!("={name}(-0.25)");
            book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            assert_eq!(
                book.display(0, 0, 0, LIMIT).unwrap(),
                if date1904 { negative } else { "#NUM!" }
            );
            for value in [(max + 1).to_string(), format!("{max}.9999999")] {
                let formula = format!("={name}({value})");
                book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
                assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#NUM!", "{formula}");
            }
        }
    }
}

#[test]
fn displayed_times_round_like_clock_parts_and_preserve_excel_calendar_dates() {
    for (formula, want) in [
        ("=TIME(10,59,59)+0.6/86400", "11:00:00 AM"),
        ("=TIME(23,59,59)+0.6/86400", "12:00:00 AM"),
        ("=DATE(1900,1,1)", "01/01/00"),
        ("=DATE(1900,2,29)", "02/29/00"),
        ("=DATE(1900,1,0)", "01/00/00"),
    ] {
        // Fresh cells retain the inferred format for each formula category.
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        for restored in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            assert_eq!(restored.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
        }
    }
}

#[test]
fn current_date_and_time_share_one_calculation_clock() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, "=TODAY()=INT(NOW())"), (0, 1, 0, "=NOW()-NOW()")],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "TRUE");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "00:00:00");
}

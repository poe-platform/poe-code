// Date/time parsing cases adapted from IronCalc date_and_time.rs and
// test_fn_datevalue_datedif.rs / test_fn_time.rs (MIT, f93662006b8fb1c401dc870bbda26c5d60ac6037),
// and Univer date/{datevalue,timevalue} tests (Apache-2.0, 4767b3b309467c283bbd52b725536ca73861e0fc).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn datevalue_parses_numeric_named_months_and_midnight_rollover() {
    let mut book = Spreadsheet::new();
    let mut failures = Vec::new();
    for (input, want) in [
        ("2/1/2023", "44958"),
        ("02/01/2023", "44958"),
        ("2023-01-02", "44928"),
        ("2-Jan-23", "44928"),
        ("01/02/2023", "44928"),
        ("15/01/2023", "44941"),
        ("29/02/2020", "43890"),
        ("2023/Jan/15", "44941"),
        ("6/15/2021", "44362"),
        ("2026 - 01 - 01", "46023"),
        ("1 / 2 /2026", "46024"),
        ("4 - Feb - 2026", "46057"),
        ("2026-01-01 24:00:00", "46024"),
        ("2026-01-01 25:00:00", "46024"),
        ("2026-01-01 23:59:59", "46023"),
        ("2026-01-01T24:00:00", "46024"),
        ("2020-01-02 13:14:15", "43832"),
        ("10:11:12", "0"),
        ("January 2, 2023", "44928"),
        ("2 January 2023", "44928"),
        ("2-SEPT-2023", "45171"),
        ("1900-01-01", "1"),
        ("1900-02-28", "59"),
        ("1900-02-29", "60"),
        ("1900-03-01", "61"),
        ("31/04/2023", "#VALUE!"),
        ("13/13/2023", "#VALUE!"),
        ("not a date", "#VALUE!"),
        ("1899-12-31", "#VALUE!"),
        ("10000-01-01", "#VALUE!"),
        ("9999-12-31 24:00", "#VALUE!"),
        ("2026-01-01 garbage", "#VALUE!"),
        ("2026-01/01", "#VALUE!"),
        ("２０２６-01-01", "#VALUE!"),
    ] {
        let formula = format!("=DATEVALUE(\"{input}\")");
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        let actual = book.display(0, 0, 0, LIMIT).unwrap();
        if actual != want {
            failures.push(format!("{input}: {actual} != {want}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn timevalue_retains_fractional_seconds_and_normalizes_midnight() {
    let mut book = Spreadsheet::new();
    for (input, seconds) in [
        ("2:24 AM", 8640.),
        ("2 PM", 50400.),
        ("6:45 PM", 67500.),
        ("18:45", 67500.),
        ("22-Aug-2011 6:35 AM", 23700.),
        ("2023-01-01T14:30:00", 52200.),
        ("12:00 AM", 0.),
        ("12:00 PM", 43200.),
        ("11:59:59 PM", 86399.),
        ("4:35:00.5", 16500.5),
        ("4:35:00.999", 16500.999),
        ("0:00:00.001", 0.001),
        ("4:35:00.25 PM", 59700.25),
        ("2023-01-01 14:30:00.5", 52200.5),
        ("4 : 35", 16500.),
        ("12 : 00 : 00", 43200.),
        ("3 : 30 PM", 55800.),
        ("  2  am  ", 7200.),
        ("2 PM.", 50400.),
        ("24:00:00", 0.),
        ("23:60:00", 0.),
        ("23:59:60", 0.),
        ("2020-01-02", 0.),
        ("2020-01-02 13:14:15", 47655.),
        ("10:11:12", 36672.),
    ] {
        let formula = format!("=TIMEVALUE(\"{input}\")");
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        let actual = book
            .display(0, 0, 0, LIMIT)
            .unwrap()
            .parse::<f64>()
            .unwrap_or(f64::NAN);
        assert!(
            (actual - seconds / 86400.).abs() < 1e-12,
            "{input}: {actual}"
        );
    }
    for input in [
        "invalid",
        "25:00",
        "14:70",
        "",
        "2PM",
        "2 p.m.",
        "-1:00",
        "1:02:NaN",
        "1:02:inf",
        "2023-02-29 12:00",
    ] {
        let formula = format!("=TIMEVALUE(\"{input}\")");
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#VALUE!", "{input}");
    }
}

#[test]
fn date_text_arrays_keep_types_errors_and_date_systems() {
    let mut book = Spreadsheet::new();
    let inputs = [
        "1",
        "' ",
        "1.23",
        "TRUE",
        "FALSE",
        "",
        "0",
        "'2024-8-8 12:47:55",
        "'2024-8-8",
        "test",
        "-3",
        "=#NAME?",
    ];
    let mut edits: Vec<_> = inputs
        .iter()
        .enumerate()
        .map(|(i, v)| (0, i / 6, i % 6, *v))
        .collect();
    edits.extend([
        (0, 4, 0, "=DATEVALUE(A1:F2)"),
        (0, 7, 0, "=TIMEVALUE(A1:F2)"),
    ]);
    book.edit(&edits, LIMIT).unwrap();
    for (i, _) in inputs.iter().enumerate() {
        let want = if i == 7 || i == 8 {
            "45512"
        } else if i == 11 {
            "#NAME?"
        } else {
            "#VALUE!"
        };
        assert_eq!(book.display(0, 4 + i / 6, i % 6, LIMIT).unwrap(), want);
        let actual = book.display(0, 7 + i / 6, i % 6, LIMIT).unwrap();
        if i == 7 {
            assert!((actual.parse::<f64>().unwrap() - 46075. / 86400.).abs() < 1e-12);
        } else {
            assert_eq!(actual, if i == 8 { "0" } else { want });
        }
    }
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        let actual = restored
            .display(0, 8, 1, LIMIT)
            .unwrap()
            .parse::<f64>()
            .unwrap();
        assert!((actual - 46075. / 86400.).abs() < 1e-12);
        restored
            .edit(&[(0, 1, 1, "'2024-8-8 04:35:00.5")], LIMIT)
            .unwrap();
        let actual = restored
            .display(0, 8, 1, LIMIT)
            .unwrap()
            .parse::<f64>()
            .unwrap();
        assert!((actual - 16500.5 / 86400.).abs() < 1e-12);
        assert_eq!(restored.display(0, 5, 1, LIMIT).unwrap(), "45512");
    }
    for date1904 in [false, true] {
        book.options.date1904 = date1904;
        book.edit(
            &[
                (0, 11, 0, "=DATEVALUE(\"1904-1-1\")"),
                (0, 12, 0, "=DATEVALUE(\"1904-2-2\")"),
            ],
            LIMIT,
        )
        .unwrap();
        assert_eq!(
            book.display(0, 11, 0, LIMIT).unwrap(),
            if date1904 { "0" } else { "1462" }
        );
        assert_eq!(
            book.display(0, 12, 0, LIMIT).unwrap(),
            if date1904 { "32" } else { "1494" }
        );
    }
    for formula in [
        "=DATEVALUE()",
        "=TIMEVALUE()",
        "=DATEVALUE(1,2)",
        "=TIMEVALUE(1,2)",
    ] {
        book.edit(&[(0, 15, 0, formula)], LIMIT).unwrap();
        assert_eq!(
            book.display(0, 15, 0, LIMIT).unwrap(),
            "#ERROR!",
            "{formula}"
        );
    }
}

#[test]
fn named_month_text_and_calendar_arrays_recalculate_after_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0,1,1,"2026"),(0,5,1,"May"),(0,8,1,r#"=LET(mo,MONTH(DATEVALUE("1/"&B6&"/2026")),yr,$B$2,anchor,DATE(yr,mo,1),first_mon,anchor-(WEEKDAY(anchor,2)-1),grid,SEQUENCE(6,7,0),d,first_mon+grid,IF(MONTH(d)=mo,DAY(d),""))"#),
        (0,0,3,r#"=TEXT("2-Jan-2023 12:30","yyyy-mm-dd hh:mm")"#)],LIMIT).unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.display(0, 9, 1, LIMIT).unwrap(), "4");
        assert_eq!(restored.display(0, 9, 2, LIMIT).unwrap(), "5");
        assert_eq!(restored.display(0, 12, 7, LIMIT).unwrap(), "31");
        assert_eq!(
            restored.display(0, 0, 3, LIMIT).unwrap(),
            "2023-01-02 12:30"
        );
        restored.edit(&[(0, 5, 1, "June")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 8, 1, LIMIT).unwrap(), "1");
        assert_eq!(restored.display(0, 9, 1, LIMIT).unwrap(), "8");
        restored.edit(&[(0, 5, 1, "invalid")], LIMIT).unwrap();
        // The SEQUENCE keeps its shape: errors broadcast through all 42 dates.
        assert_eq!(restored.display(0, 8, 1, LIMIT).unwrap(), "#VALUE!");
        assert_eq!(restored.display(0, 12, 7, LIMIT).unwrap(), "#VALUE!");
        restored.edit(&[(0, 5, 1, "May")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 12, 7, LIMIT).unwrap(), "31");
    }
}

#[test]
fn separator_space_scanning_and_date_text_spills_are_bounded() {
    let mut book = Spreadsheet::new();
    for formula in [
        r#"=TIMEVALUE("4"&REPT(" ",32000)&":35")"#,
        r#"=DATEVALUE("2026-"&REPT(" ",32000)&"01-01")"#,
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert!(!book.display(0, 0, 0, LIMIT).unwrap().starts_with('#'));
    }
    let saved = book.to_json();
    for formula in [
        r#"=DATEVALUE(TEXT(SEQUENCE(10000),"yyyy-mm-dd"))"#.to_owned(),
        format!("=DATEVALUE(\"2026-{}01-01\")", " ".repeat(32000)),
    ] {
        assert!(book.edit(&[(0, 1, 0, &formula)], 20_000).is_err());
        assert_eq!(book.to_json(), saved);
    }
}

#[test]
fn editor_datetime_input_preserves_calendar_values_and_literal_text() {
    use super::model::Value;
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        for (row, (input, display, seconds)) in [
            ("2026-12-31 23:30", "2026-12-31 23:30", 84600.),
            ("2026-12-31T23:30:15", "2026-12-31 23:30:15", 84615.),
            (
                "2026-12-31 23:30:15.125",
                "2026-12-31 23:30:15.125",
                84615.125,
            ),
            ("2026-12-31 00:00", "2026-12-31 00:00", 0.),
        ]
        .iter()
        .enumerate()
        {
            book.edit(&[(0, row, 0, input)], 1_000_000).unwrap();
            let cell = book.cell(0, row, 0).unwrap();
            let Some(Value::Number(n)) = &cell.value else {
                panic!("{input} must be numeric");
            };
            assert!(
                (n - (46387. - if date1904 { 1462. } else { 0. } + seconds / 86400.)).abs() < 1e-10
            );
            assert_eq!(book.display(0, row, 0, 1_000_000).unwrap(), *display);
            let literal = format!("'{input}");
            book.edit(&[(0, row, 2, &literal)], 1_000_000).unwrap();
            assert_eq!(book.input(0, row, 2), literal);
            let replay = book.input(0, row, 2);
            book.edit(&[(0, row, 2, &replay)], 1_000_000).unwrap();
            assert!(
                matches!(&book.cell(0, row, 2).unwrap().value, Some(Value::Text(text)) if text == input)
            );
        }
        book.edit(
            &[(0, 0, 1, r#"=TEXT(A1+1.5/24,"yyyy-mm-dd hh:mm")"#)],
            1_000_000,
        )
        .unwrap();
        assert_eq!(
            book.display(0, 0, 1, 1_000_000).unwrap(),
            "2027-01-01 01:00"
        );
        for input in [
            "2026-02-30 23:30",
            "2026-12-31 23:70",
            "2026-12-31T23:30Z",
            "2026-12-31",
            "23:30",
            "2",
        ] {
            book.edit(&[(0, 5, 0, input)], 1_000_000).unwrap();
            if input.contains(' ') || input.ends_with('Z') || input == "23:30" {
                assert!(
                    matches!(&book.cell(0, 5, 0).unwrap().value, Some(Value::Text(text)) if text == input)
                );
            }
        }
    }
}

// Calendar cases adapted from IronCalc test_date_system.rs (MIT,
// f93662006b8fb1c401dc870bbda26c5d60ac6037) and Univer date/date tests
// (Apache-2.0, 4767b3b309467c283bbd52b725536ca73861e0fc).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn weekday_coerces_dates_before_return_type_errors() {
    // IronCalc test_weekday_arg_order.rs, issue #1502 (same MIT revision above).
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        for (formula, want) in [
            ("=WEEKDAY(\"1/1/10000\",1/0)", "#VALUE!"),
            ("=WEEKDAY(\"1/1/10000\",NA())", "#VALUE!"),
            ("=WEEKDAY(\"abc\",1/0)", "#VALUE!"),
            ("=WEEKDAY(\"abc\",NA())", "#VALUE!"),
            ("=WEEKDAY(44561,1/0)", "#DIV/0!"),
            ("=WEEKDAY(44561,NA())", "#N/A"),
            ("=WEEKDAY(\"abc\")", "#VALUE!"),
            ("=WEEKDAY(#REF!,NA())", "#REF!"),
            ("=WEEKDAY(\"44561\",NA())", "#N/A"),
        ] {
            book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
            assert_eq!(
                book.display(0, 0, 0, LIMIT).unwrap(),
                want,
                "{date1904}: {formula}"
            );
        }
        book.edit(
            &[
                (0, 0, 0, "bad date"),
                (0, 1, 0, "44561"),
                (0, 2, 0, "#REF!"),
                (0, 0, 2, "=WEEKDAY(A1:A3,NA())"),
            ],
            LIMIT,
        )
        .unwrap();
        for mut copy in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
            book,
        ] {
            for (row, want) in ["#VALUE!", "#N/A", "#REF!"].iter().enumerate() {
                assert_eq!(copy.display(0, row, 2, LIMIT).unwrap(), *want);
            }
            copy.edit(&[(0, 0, 0, "44561"), (0, 1, 0, "not a date")], LIMIT)
                .unwrap();
            assert_eq!(copy.display(0, 0, 2, LIMIT).unwrap(), "#N/A");
            assert_eq!(copy.display(0, 1, 2, LIMIT).unwrap(), "#VALUE!");
        }
    }
}

#[test]
fn date_constructs_excel_years_and_counts_the_fictitious_leap_day() {
    let mut book = Spreadsheet::new();
    let mut failures = Vec::new();
    for (args, want) in [
        ("2024,1,1", "45292"),
        ("1900,1,1", "1"),
        ("1900,2,28", "59"),
        ("1900,2,29", "60"),
        ("1900,2,30", "61"),
        ("1900,3,0", "60"),
        ("1900,1,0", "0"),
        ("1900,1,-1", "#NUM!"),
        ("0,1,1", "1"),
        ("29,1,1", "10594"),
        ("100,1,1", "36526"),
        ("1899,12,30", "693961"),
        ("-1,1,1", "#NUM!"),
        ("10000,1,1", "#NUM!"),
        ("9999,12,31", "2958465"),
        ("9999,12,32", "#NUM!"),
        ("10000,0,1", "#NUM!"),
        ("1900,0,32", "#NUM!"),
        ("2024.9,1.9,1.9", "45292"),
        ("2024,1,-0.1", "45290"),
        ("2024,1,1E15", "78058"),
        ("2024,32767,1", "#NUM!"),
        ("2024,-32768,1", "#NUM!"),
    ] {
        let formula = format!("=TEXT(DATE({args}),\"0\")");
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        let actual = book.display(0, 0, 0, LIMIT).unwrap();
        if actual != want {
            failures.push(format!("{formula}: {actual} != {want}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn calendar_parts_honor_excel_epochs_zero_leap_day_and_bounds() {
    let mut failures = Vec::new();
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        let max = if date1904 { 2_957_003 } else { 2_958_465 };
        for (value, parts) in [
            (0, if date1904 { [1904, 1, 1] } else { [1900, 1, 0] }),
            (1, if date1904 { [1904, 1, 2] } else { [1900, 1, 1] }),
            (
                60,
                if date1904 {
                    [1904, 3, 1]
                } else {
                    [1900, 2, 29]
                },
            ),
            (max, [9999, 12, 31]),
        ] {
            for (name, part) in ["YEAR", "MONTH", "DAY"].into_iter().zip(parts) {
                let formula = format!("={name}({value}+0.9)");
                book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
                let actual = book.display(0, 0, 0, LIMIT).unwrap();
                if actual != part.to_string() {
                    failures.push(format!("{date1904} {formula}: {actual} != {part}"));
                }
            }
        }
        for name in ["YEAR", "MONTH", "DAY"] {
            for value in [-1, max + 1, 95_051_806] {
                let formula = format!("={name}({value})");
                book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
                let actual = book.display(0, 0, 0, LIMIT).unwrap();
                if actual != "#NUM!" {
                    failures.push(format!("{date1904} {formula}: {actual} != #NUM!"));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn date_arrays_preserve_upstream_coercion_and_recalculate_after_reopening() {
    let cases = [
        (
            vec![
                "1", "' ", "1.23", "TRUE", "FALSE", "", "18", "0", "'100", "'2.34", "test", "-3",
                "1900", "108",
            ],
            7,
            "=DATE(A1:G2,1,1)+0",
            vec![
                "367", "#VALUE!", "367", "367", "1", "1", "6576", "1", "36526", "732", "#VALUE!",
                "#NUM!", "1", "39448",
            ],
        ),
        (
            vec![
                "1", "' ", "1.23", "TRUE", "FALSE", "", "0", "'100", "'2.34", "test", "-3", "14",
            ],
            6,
            "=DATE(2024,A1:F2,1)+0",
            vec![
                "45292", "#VALUE!", "45292", "45292", "45261", "45261", "45261", "48305", "45323",
                "#VALUE!", "45170", "45689",
            ],
        ),
        (
            vec![
                "1", "' ", "1.23", "TRUE", "FALSE", "", "0", "'100", "'2.34", "test", "-3", "32",
            ],
            6,
            "=DATE(2024,1,A1:F2)+0",
            vec![
                "45292", "#VALUE!", "45292", "45292", "45291", "45291", "45291", "45391", "45293",
                "#VALUE!", "45288", "45323",
            ],
        ),
    ];
    for (inputs, cols, formula, wants) in cases {
        let mut book = Spreadsheet::new();
        let mut edits: Vec<_> = inputs
            .iter()
            .enumerate()
            .map(|(i, s)| (0, i / cols, i % cols, *s))
            .collect();
        edits.push((0, 4, 0, formula));
        book.edit(&edits, LIMIT).unwrap();
        for (i, want) in wants.iter().enumerate() {
            assert_eq!(
                book.display(0, 4 + i / cols, i % cols, LIMIT).unwrap(),
                *want,
                "{formula} element {i}"
            );
        }
        for mut restored in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            for (i, want) in wants.iter().enumerate() {
                assert_eq!(
                    restored.display(0, 4 + i / cols, i % cols, LIMIT).unwrap(),
                    *want,
                    "{formula} element {i}"
                );
            }
            restored.edit(&[(0, 0, 1, "1")], LIMIT).unwrap();
            assert_eq!(restored.display(0, 4, 1, LIMIT).unwrap(), wants[0]);
        }
    }
}

#[test]
fn date_1904_year_offsets_and_zero_are_preserved() {
    let mut book = Spreadsheet::new();
    book.options.date1904 = true;
    for (args, want) in [
        ("2024,1,1", "43830"),
        ("1904,1,1", "0"),
        ("0,1,1", "0"),
        ("108,1,2", "39448"),
        ("1904,1,0", "#NUM!"),
        ("9999,12,31", "2957003"),
    ] {
        let formula = format!("=TEXT(DATE({args}),\"0\")");
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn calendar_parts_parse_text_in_the_same_excel_calendar_as_datevalue() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=DAY(\"1900-01-01\")", "1"),
        ("=DAY(\"1900-02-29\")", "29"),
        ("=MONTH(\"29-Feb-1900\")", "2"),
        ("=DAY(\"2-Jan-2023\")", "2"),
        ("=YEAR(\"2024-02-29 23:59:60\")", "2024"),
        ("=MONTH(\"2024-02-29 23:59:60\")", "3"),
        ("=DAY(\"2024-02-29 23:59:60\")", "1"),
        ("=DAY(\"60\")", "29"),
        ("=DAY(\"bad date\")", "#VALUE!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn calendar_week_numbers_use_excel_serials_around_the_1900_epoch() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=WEEKNUM(DATE(1900,1,1))", "1"),
        ("=WEEKNUM(2)", "1"),
        ("=WEEKNUM(8)", "2"),
        ("=WEEKNUM(2,2)", "2"),
        ("=WEEKNUM(60)", "9"),
        ("=WEEKDAY(1)", "1"),
        ("=WEEKDAY(60)", "4"),
        ("=ISOWEEKNUM(1)", "52"),
        ("=ISOWEEKNUM(2)", "1"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

// Original IronCalc WEEKDAY_WEEKNUM_ISOWEEKNUM.xlsx distinguishes coercion
// order, numeric domain validation and errors in the optional return type.
#[test]
fn excel_week_functions_validate_dates_and_return_types() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        let maximum = if date1904 { 2957003 } else { 2958465 };
        let mut cases = vec![
            ("=WEEKDAY(46023,0)".to_string(), "#NUM!"),
            ("=WEEKDAY(46023,21)".into(), "#NUM!"),
            ("=WEEKDAY(46023,150)".into(), "#NUM!"),
            ("=WEEKDAY(46023,32768)".into(), "#NUM!"),
            ("=WEEKNUM(46023,3)".into(), "#NUM!"),
            ("=WEEKNUM(46023,150)".into(), "#NUM!"),
            ("=WEEKNUM(46023,-32769)".into(), "#NUM!"),
            ("=WEEKNUM(TRUE)".into(), "#VALUE!"),
            ("=WEEKNUM(46023,TRUE)".into(), "#VALUE!"),
            ("=WEEKNUM(\"abc\",NA())".into(), "#VALUE!"),
            ("=WEEKNUM(\"1/1/10000\",1/0)".into(), "#VALUE!"),
            ("=WEEKNUM(-1,NA())".into(), "#NUM!"),
            ("=WEEKNUM(-1,\"abc\")".into(), "#NUM!"),
            ("=WEEKDAY(-1,NA())".into(), "#N/A"),
            ("=WEEKDAY(-1,\"abc\")".into(), "#VALUE!"),
            ("=WEEKNUM(46023,NA())".into(), "#N/A"),
            ("=WEEKNUM(#REF!,NA())".into(), "#REF!"),
        ];
        for name in ["WEEKDAY", "WEEKNUM", "ISOWEEKNUM"] {
            for serial in [
                "-1".to_string(),
                "-0.1".into(),
                (maximum + 1).to_string(),
                "1E100".into(),
            ] {
                cases.push((format!("={name}({serial})"), "#NUM!"));
            }
            // The last day's fractional time remains inside the supported epoch.
            book.edit(&[(0, 0, 0, &format!("={name}({maximum}.9)"))], LIMIT)
                .unwrap();
            assert!(!book.display(0, 0, 0, LIMIT).unwrap().starts_with('#'));
        }
        let edits: Vec<_> = cases
            .iter()
            .enumerate()
            .map(|(r, (formula, _))| (0, r, 0, formula.as_str()))
            .collect();
        book.edit(&edits, LIMIT).unwrap();
        for current in [
            &book,
            &Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            &Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            for (row, (formula, want)) in cases.iter().enumerate() {
                assert_eq!(
                    current.display(0, row, 0, LIMIT).unwrap(),
                    *want,
                    "{date1904}: {formula}"
                );
            }
        }
    }
}

#[test]
fn excel_week_validation_preserves_array_errors_and_source_edits() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        book.edit(
            &[
                (0, 0, 0, "-1"),
                (0, 1, 0, "46023"),
                (0, 2, 0, "not a date"),
                (0, 3, 0, "TRUE"),
                (0, 0, 2, "=WEEKNUM(A1:A5)"),
                (0, 0, 4, "=WEEKDAY(A1:A5,0)"),
            ],
            LIMIT,
        )
        .unwrap();
        for mut current in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
            book,
        ] {
            // Univer's serial-zero boundary: default WEEKNUM is 0 in 1900,
            // and 1 in 1904. A blank reference retains that distinction.
            let blank_week = if date1904 { "1" } else { "0" };
            for (col, expected) in [
                (2, ["#NUM!", "1", "#VALUE!", "#VALUE!", blank_week]),
                (4, ["#NUM!", "#NUM!", "#VALUE!", "#NUM!", "#NUM!"]),
            ] {
                for (row, want) in expected.iter().enumerate() {
                    assert_eq!(
                        current.display(0, row, col, LIMIT).unwrap(),
                        *want,
                        "{date1904} {row},{col}"
                    );
                }
            }
            current
                .edit(&[(0, 0, 0, "46023"), (0, 3, 0, "-1")], LIMIT)
                .unwrap();
            assert_eq!(current.display(0, 0, 2, LIMIT).unwrap(), "1");
            assert_eq!(current.display(0, 3, 2, LIMIT).unwrap(), "#NUM!");
        }
    }
}

use super::{ConditionalFormat, ConditionalRule, Spreadsheet, Style, Value, formulas::clock};
use crate::commands::{
    coreutils::days_from_civil,
    structured::{read_office_archive, write_zip_stored},
};
const LIMIT: usize = 20_000_000;
fn instant(y: i64, m: i64, d: i64) -> f64 {
    days_from_civil(y, m, d) as f64 * 86_400_000.
}
fn number(book: &Spreadsheet, row: usize) -> f64 {
    match book.cell(0, row, 0).unwrap().value.as_ref().unwrap() {
        Value::Number(n) => *n,
        _ => panic!("expected number"),
    }
}
fn rule(period: &str) -> ConditionalFormat {
    ConditionalFormat {
        sheet: 0,
        ranges: vec![[0, 0, 1_048_575, 16_383], [0, 0, 1, 0]],
        priority: 1,
        stop_if_true: true,
        rule: ConditionalRule::TimePeriod {
            period: period.into(),
        },
        style: Style {
            attributes: vec![("Back", "FFFF0000".into()), ("Shade", "1".into())],
            ..Default::default()
        },
        format: None,
    }
}
fn matches(book: &Spreadsheet, rows: usize) -> Vec<bool> {
    let positions = (0..rows).map(|r| (r, 0)).collect::<Vec<_>>();
    let styles = book.conditional_styles(0, &positions, LIMIT).unwrap();
    positions
        .iter()
        .map(|p| {
            styles.get(p).is_some_and(|s| {
                s.style
                    .attributes
                    .iter()
                    .any(|(key, color)| *key == "Back" && color == "FFFF0000")
            })
        })
        .collect()
}

// UTC timestamp and calendar assertions adapted from IronCalc f936620
// test_today.rs / test_now.rs (MIT). Keep their 1679319865208 timestamp.
// Explicit TEXT formats retain this engine's existing default date display.
#[test]
fn current_time_utc_timestamp_formats_and_argument_errors() {
    clock::with_time(1679319865208., || {
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 0, "=TODAY()"),
                (0, 1, 0, "=NOW()"),
                (0, 2, 0, "=TEXT(A1,\"yyyy/m/d\")"),
                (0, 3, 0, "=TEXT(A2,\"yyyy/m/d hh:mm:ss\")"),
                (0, 4, 0, "=TODAY(1)"),
                (0, 5, 0, "=NOW(1,2)"),
            ],
            LIMIT,
        )
        .unwrap();
        assert_eq!(number(&book, 0), 45005.);
        assert!(
            (number(&book, 1) - (45005. + (13. * 3600. + 44. * 60. + 25.208) / 86400.)).abs()
                < 1e-10
        );
        assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), "2023/3/20");
        assert_eq!(book.display(0, 3, 0, LIMIT).unwrap(), "2023/3/20 13:44:25");
        for row in [4, 5] {
            assert_eq!(book.display(0, row, 0, LIMIT).unwrap(), "#ERROR!");
        }
        assert!(
            book.cell(0, 0, 0)
                .unwrap()
                .value_format
                .as_ref()
                .is_some_and(|s| s.contains("yy"))
        );
        assert!(
            book.cell(0, 1, 0)
                .unwrap()
                .value_format
                .as_ref()
                .is_some_and(|s| s.contains("hh"))
        );
    });
}
#[test]
fn current_time_calendar_boundaries_and_invalid_host_clock() {
    for (date, serial) in [
        ((1900, 1, 1), 1.),
        ((1900, 2, 28), 59.),
        ((1900, 3, 1), 61.),
        ((1904, 1, 1), 1462.),
        ((1970, 1, 1), 25569.),
        ((2024, 2, 29), 45351.),
    ] {
        for date1904 in [false, true] {
            for milliseconds in [0., 1., 43_200_000., 86_399_999.] {
                clock::with_time(instant(date.0, date.1, date.2) + milliseconds, || {
                    let mut book = Spreadsheet::new();
                    book.options.date1904 = date1904;
                    book.edit(
                        &[
                            (0, 0, 0, "=TODAY()"),
                            (0, 1, 0, "=NOW()"),
                            (0, 2, 0, "=NOW()-NOW()"),
                        ],
                        LIMIT,
                    )
                    .unwrap();
                    let expected = serial - if date1904 { 1462. } else { 0. }
                        + if date1904 && serial < 60. { 1. } else { 0. };
                    assert_eq!(number(&book, 0), expected, "{date:?}, 1904={date1904}");
                    assert!(
                        (number(&book, 1) - expected - milliseconds / 86_400_000.).abs() < 1e-10
                    );
                    assert_eq!(number(&book, 2), 0.);
                });
            }
        }
    }
    for invalid in [
        f64::NAN,
        f64::INFINITY,
        instant(10000, 1, 1),
        instant(1899, 12, 31),
    ] {
        clock::with_time(invalid, || {
            let mut book = Spreadsheet::new();
            book.edit(&[(0, 0, 0, "=TODAY()"), (0, 1, 0, "=NOW()")], LIMIT)
                .unwrap();
            for row in [0, 1] {
                assert_eq!(book.display(0, row, 0, LIMIT).unwrap(), "#NUM!");
            }
        });
    }
}

// Five original data/assertion sets from IronCalc f936620 conditional_formatting/
// time_period.rs: today, yesterday, tomorrow, last-seven-days, arbitrary number.
#[test]
fn time_period_ironcalc_day_assertions() {
    clock::with_time(instant(2024, 2, 29) + 43_200_000., || {
        for (period, values, expected) in [
            (
                "today",
                vec!["=TODAY()", "=TODAY()-1", "=TODAY()+1"],
                vec![true, false, false],
            ),
            (
                "yesterday",
                vec!["=TODAY()-1", "=TODAY()", "=TODAY()-2"],
                vec![true, false, false],
            ),
            (
                "tomorrow",
                vec!["=TODAY()+1", "=TODAY()", "=TODAY()+2"],
                vec![true, false, false],
            ),
            (
                "last7Days",
                vec![
                    "=TODAY()",
                    "=TODAY()-3",
                    "=TODAY()-6",
                    "=TODAY()-7",
                    "=TODAY()+1",
                ],
                vec![true, true, true, false, false],
            ),
            ("today", vec!["42"], vec![false]),
        ] {
            let mut book = Spreadsheet::new();
            book.edit(
                &values
                    .iter()
                    .enumerate()
                    .map(|(r, s)| (0, r, 0, *s))
                    .collect::<Vec<_>>(),
                LIMIT,
            )
            .unwrap();
            book.set_conditional_formats(vec![rule(period)], LIMIT)
                .unwrap();
            assert_eq!(matches(&book, values.len()), expected, "{period}");
        }
    });
}
#[test]
fn time_period_weeks_months_times_and_both_calendars() {
    for date1904 in [false, true] {
        for (today, period, start, end) in [
            ((2024, 2, 29), "thisWeek", (2024, 2, 25), (2024, 3, 3)),
            ((2024, 3, 3), "lastWeek", (2024, 2, 25), (2024, 3, 3)),
            ((2024, 2, 24), "nextWeek", (2024, 2, 25), (2024, 3, 3)),
            ((2024, 2, 29), "thisMonth", (2024, 2, 1), (2024, 3, 1)),
            ((2024, 1, 31), "nextMonth", (2024, 2, 1), (2024, 3, 1)),
            ((2024, 3, 1), "lastMonth", (2024, 2, 1), (2024, 3, 1)),
            ((2024, 1, 1), "lastMonth", (2023, 12, 1), (2024, 1, 1)),
            ((2023, 12, 31), "nextMonth", (2024, 1, 1), (2024, 2, 1)),
        ] {
            clock::with_time(instant(today.0, today.1, today.2), || {
                let start = (days_from_civil(start.0, start.1, start.2) + 25569
                    - if date1904 { 1462 } else { 0 }) as f64;
                let end = (days_from_civil(end.0, end.1, end.2) + 25569
                    - if date1904 { 1462 } else { 0 }) as f64;
                let values = [
                    (start - 1. / 86400.).to_string(),
                    start.to_string(),
                    (start + 0.5).to_string(),
                    (end - 1. / 86400.).to_string(),
                    end.to_string(),
                    "TRUE".into(),
                    "'2024-02-29".into(),
                    "=#N/A".into(),
                    "".into(),
                ];
                let mut book = Spreadsheet::new();
                book.options.date1904 = date1904;
                book.edit(
                    &values
                        .iter()
                        .enumerate()
                        .map(|(r, s)| (0, r, 0, s.as_str()))
                        .collect::<Vec<_>>(),
                    LIMIT,
                )
                .unwrap();
                book.set_conditional_formats(vec![rule(period)], LIMIT)
                    .unwrap();
                assert_eq!(
                    matches(&book, values.len()),
                    vec![false, true, true, true, false, false, false, false, false],
                    "{today:?}, {period}, {date1904}"
                );
                let json = book.to_json();
                let restored = Spreadsheet::from_json(&json, LIMIT).unwrap();
                assert_eq!(restored.to_json(), json);
                let bytes = book.export_xlsx(LIMIT).unwrap();
                let reopened = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
                assert_eq!(
                    matches(&reopened, values.len()),
                    matches(&book, values.len())
                );
                let mut parts = read_office_archive(&bytes);
                let sheet = parts.get_mut("xl/worksheets/sheet1.xml").unwrap();
                let xml = String::from_utf8(sheet.clone()).unwrap();
                assert!(xml.contains(&format!("timePeriod=\"{period}\"")));
                // The generated standard Excel formula must match the native fast path.
                *sheet = xml
                    .replace("type=\"timePeriod\"", "type=\"expression\"")
                    .into_bytes();
                let formula = Spreadsheet::import_xlsx(
                    &write_zip_stored(
                        &parts
                            .iter()
                            .map(|(name, data)| (name.as_str(), data.as_slice()))
                            .collect::<Vec<_>>(),
                    ),
                    LIMIT,
                )
                .unwrap();
                assert_eq!(
                    matches(&formula, values.len()),
                    matches(&book, values.len()),
                    "exported formula for {period}"
                );
            });
        }
    }
}
#[test]
fn time_period_keeps_formula_clock_until_next_successful_calculation() {
    let mut book = clock::with_time(instant(2024, 2, 29) + 86_399_999., || {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, "=NOW()"), (0, 1, 0, "=TODAY()")], LIMIT)
            .unwrap();
        book.set_conditional_formats(vec![rule("today")], LIMIT)
            .unwrap();
        book
    });
    let before = book.to_json();
    clock::with_time(instant(2024, 3, 1), || {
        assert_eq!(matches(&book, 2), vec![true, true]);
        assert_eq!(book.to_json(), before);
        assert!(book.edit(&[(0, 2, 0, "=TODAY()")], 1).is_err());
        assert_eq!(book.to_json(), before);
        assert_eq!(matches(&book, 2), vec![true, true]);
        book.edit(&[], LIMIT).unwrap();
        assert_eq!(number(&book, 0), 45352.);
        assert_eq!(matches(&book, 2), vec![true, true]);
    });
}
#[test]
fn time_period_rejects_invalid_json_xml_and_rolls_back() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=TODAY()")], LIMIT).unwrap();
    book.set_conditional_formats(vec![rule("today")], LIMIT)
        .unwrap();
    let before = book.to_json();
    for period in ["", "Today", "lastYear", "today\" <bad>"] {
        assert!(
            book.set_conditional_formats(vec![rule(period)], LIMIT)
                .is_err()
        );
        assert_eq!(book.to_json(), before);
    }
    book.options.conditional_formats[0].rule = rule("invalid").rule;
    assert!(Spreadsheet::from_json(&book.to_json(), LIMIT).is_err());
    book.options.conditional_formats[0].rule = rule("today").rule;
    assert_eq!(book.to_json(), before);
    let bytes = book.export_xlsx(LIMIT).unwrap();
    for replacement in ["timePeriod=\"invalid\"", ""] {
        let mut parts = read_office_archive(&bytes);
        let sheet = parts.get_mut("xl/worksheets/sheet1.xml").unwrap();
        *sheet = String::from_utf8(sheet.clone())
            .unwrap()
            .replace("timePeriod=\"today\"", replacement)
            .into_bytes();
        assert!(
            Spreadsheet::import_xlsx(
                &write_zip_stored(
                    &parts
                        .iter()
                        .map(|(name, data)| (name.as_str(), data.as_slice()))
                        .collect::<Vec<_>>()
                ),
                LIMIT
            )
            .is_err()
        );
    }
}

#[test]
fn authored_number_formats_replace_inferred_clock_formats() {
    clock::with_time(instant(2024, 2, 29) + 43_200_000., || {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, "=NOW()")], LIMIT).unwrap();
        for (pattern, want) in [
            (Some("yyyy-mm-dd hh:mm"), "2024-02-29 12:00"),
            (Some("0.00"), "45351.50"),
            (None, "02/29/24 12:00 PM"),
        ] {
            let mut cell = book.sheets[0].cells[&(0, 0)].clone();
            cell.format = pattern.map(str::to_owned);
            let before = book.to_json();
            assert!(
                book.replace_cells(vec![(0, 0, 0, Some(cell.clone()))], 1)
                    .is_err()
            );
            assert_eq!(book.to_json(), before);
            book.replace_cells(vec![(0, 0, 0, Some(cell))], LIMIT)
                .unwrap();
            assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want);
            let restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
            assert_eq!(restored.display(0, 0, 0, LIMIT).unwrap(), want);
            let restored =
                Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
            assert_eq!(restored.display(0, 0, 0, LIMIT).unwrap(), want);
        }
    });
}

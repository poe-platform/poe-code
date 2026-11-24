//! Average filters follow ClosedXML 057f5976 DynamicFilterTests (MIT).
//! Calendar intervals follow PhpSpreadsheet f03bcf6 AutoFilter.php (MIT):
//! Sunday-based weeks, exclusive upper bounds, and year-to-date including today.
use super::{
    LIMIT, Spreadsheet,
    model::{DynamicFilter, Value},
};

pub(super) fn valid(filter: &DynamicFilter) -> bool {
    matches!(
        filter.kind.as_str(),
        "null"
            | "aboveAverage"
            | "belowAverage"
            | "yesterday"
            | "today"
            | "tomorrow"
            | "lastWeek"
            | "thisWeek"
            | "nextWeek"
            | "lastMonth"
            | "thisMonth"
            | "nextMonth"
            | "lastQuarter"
            | "thisQuarter"
            | "nextQuarter"
            | "lastYear"
            | "thisYear"
            | "nextYear"
            | "yearToDate"
            | "Q1"
            | "Q2"
            | "Q3"
            | "Q4"
            | "M1"
            | "M2"
            | "M3"
            | "M4"
            | "M5"
            | "M6"
            | "M7"
            | "M8"
            | "M9"
            | "M10"
            | "M11"
            | "M12"
    ) && filter.value.is_none_or(f64::is_finite)
        && filter.max_value.is_none_or(f64::is_finite)
}

pub(super) fn prepare(
    book: &Spreadsheet,
    sheet: usize,
    area: [usize; 4],
    column: usize,
    filter: &DynamicFilter,
    now: f64,
    work: &mut usize,
) -> Result<DynamicFilter, String> {
    // External XLSX files carry the thresholds used for their saved rows.
    // Reopening must not turn an old "today" filter into today's selection.
    if matches!(filter.kind.as_str(), "null")
        || filter.kind.starts_with(['M', 'Q'])
        || filter.value.is_some()
            && (matches!(filter.kind.as_str(), "aboveAverage" | "belowAverage")
                || filter.max_value.is_some())
    {
        return Ok(filter.clone());
    }
    let mut result = DynamicFilter {
        kind: filter.kind.clone(),
        value: None,
        max_value: None,
    };
    if matches!(filter.kind.as_str(), "aboveAverage" | "belowAverage") {
        let mut values = Vec::new();
        for row in area[0] + 1..=area[2] {
            *work = work.checked_sub(128).ok_or(LIMIT)?;
            if let Some(Value::Number(value)) = book
                .cell(sheet, row, area[1] + column)
                .as_deref()
                .and_then(|cell| cell.value.as_ref())
            {
                values.push(*value);
            }
        }
        if !values.is_empty() {
            // Normalize before summing so finite observations have a finite mean.
            let scale = values
                .iter()
                .fold(0_f64, |scale, value| scale.max(value.abs()));
            result.value = Some(if scale == 0. {
                0.
            } else {
                (super::super::formulas::regression::sum(values.iter().map(|n| n / scale))
                    / values.len() as f64)
                    .clamp(-1., 1.)
                    * scale
            });
        }
    } else if !matches!(filter.kind.as_str(), "null") && !filter.kind.starts_with(['M', 'Q']) {
        let (start, end) =
            super::super::formulas::clock::period_bounds(&filter.kind, now, book.options.date1904)
                .ok_or("Current date is unavailable for this filter")?;
        result.value = Some(start);
        result.max_value = Some(end);
    }
    Ok(result)
}

pub(super) fn matches(
    filter: &DynamicFilter,
    value: Option<&Value<String>>,
    date1904: bool,
) -> bool {
    if filter.kind == "null" {
        return true;
    }
    let Some(Value::Number(value)) = value else {
        return false;
    };
    if !value.is_finite() {
        return false;
    }
    match filter.kind.as_str() {
        "aboveAverage" => filter.value.is_some_and(|mean| *value > mean),
        "belowAverage" => filter.value.is_some_and(|mean| *value < mean),
        _ => {
            if *value < 0. || *value >= if date1904 { 2_957_004. } else { 2_958_466. } {
                return false;
            }
            if filter.kind.starts_with(['M', 'Q']) {
                // The workbook calendar includes serial zero and 1900-02-29.
                let (_, month, _) = super::super::formulas::date_difference::calendar(
                    value.floor() as i64,
                    date1904,
                );
                let period = filter.kind[1..].parse::<u32>().unwrap();
                if filter.kind.starts_with('M') {
                    month == period
                } else {
                    (month - 1) / 3 + 1 == period
                }
            } else {
                filter
                    .value
                    .zip(filter.max_value)
                    .is_some_and(|(start, end)| *value >= start && *value < end)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::super::formulas::clock;
    use super::super::model::FilterField;
    use super::*;
    use crate::commands::coreutils::days_from_civil;
    const BUDGET: usize = 128 * 1024 * 1024;

    fn field(kind: &str) -> FilterField {
        FilterField {
            dynamic: Some(DynamicFilter {
                kind: kind.into(),
                value: None,
                max_value: None,
            }),
            top: None,
            date_groups: vec![],
            hidden_rows: None,
            custom: false,
            conditions: vec![],
            conjunction: false,
        }
    }
    fn table(inputs: &[&str]) -> Spreadsheet {
        let mut book = Spreadsheet::new();
        let edits = inputs
            .iter()
            .enumerate()
            .map(|(row, text)| (0, row + 1, 0, *text))
            .collect::<Vec<_>>();
        book.edit(&edits, BUDGET).unwrap();
        book.add_table(0, "Data", [0, 0, inputs.len(), 0], BUDGET)
            .unwrap();
        book
    }
    fn shown(book: &Spreadsheet) -> Vec<usize> {
        let hidden = book.filtered_rows(0, BUDGET).unwrap();
        (1..=book.options.tables[0].area[2])
            .filter(|row| !hidden.contains(row))
            .collect()
    }
    fn filter(book: &Spreadsheet) -> &DynamicFilter {
        book.options.tables[0]
            .filter
            .as_ref()
            .unwrap()
            .fields
            .as_ref()
            .unwrap()[&0]
            .dynamic
            .as_ref()
            .unwrap()
    }
    #[test]
    fn closedxml_average_filters() {
        // All five DynamicFilterTests.cs groups from ClosedXML 057f5976 (MIT).
        for (kind, inputs, expected) in [
            (
                "aboveAverage",
                vec!["1", "2", "3", "4", "5", "10"],
                vec![5, 6],
            ),
            ("belowAverage", vec!["1", "2", "3"], vec![1]),
            ("aboveAverage", vec!["3", "2", "1"], vec![1]),
            (
                "belowAverage",
                vec![
                    "=DATE(1900,1,1)",
                    "1.1",
                    "1.2",
                    "=#N/A",
                    "TRUE",
                    "FALSE",
                    "'-100",
                    "Text",
                    "",
                ],
                vec![1],
            ),
            (
                "aboveAverage",
                vec!["", "TRUE", "FALSE", "'-100", "Text", "=#N/A"],
                vec![],
            ),
        ] {
            let mut book = table(&inputs);
            book.filter_table(0, 0, Some(field(kind)), BUDGET).unwrap();
            assert_eq!(shown(&book), expected, "{kind}");
            assert!(book.table_filter_values(0, 0, BUDGET).unwrap().iter().all(|(_, _, selected)| *selected));
            for mut restored in [
                Spreadsheet::from_json(&book.to_json(), BUDGET).unwrap(),
                Spreadsheet::import_xlsx(&book.export_xlsx(BUDGET).unwrap(), BUDGET).unwrap(),
            ] {
                assert_eq!(shown(&restored), expected);
                restored.reapply_table_filter(0, BUDGET).unwrap();
                assert_eq!(shown(&restored), expected);
                assert_eq!(filter(&restored).kind, kind);
            }
        }
    }
    #[test]
    fn average_reapply_keeps_saved_rows_until_requested_and_handles_extremes() {
        let mut book = table(&["1", "2", "3"]);
        book.filter_table(0, 0, Some(field("aboveAverage")), BUDGET)
            .unwrap();
        book.edit(&[(0, 1, 0, "100")], BUDGET).unwrap();
        assert_eq!(shown(&book), vec![3]);
        assert_eq!(filter(&book).value, Some(2.));
        book.reapply_table_filter(0, BUDGET).unwrap();
        assert_eq!(shown(&book), vec![1]);
        assert_eq!(filter(&book).value, Some(35.));
        for (inputs, expected) in [
            (vec!["1E308", "1E308", "-1E308"], vec![1, 2]),
            (vec!["-1E308", "0", "1E308"], vec![3]),
            (vec!["0", "0", "0"], vec![]),
            (vec!["1E-308", "2E-308", "3E-308"], vec![3]),
        ] {
            let mut book = table(&inputs);
            book.filter_table(0, 0, Some(field("aboveAverage")), BUDGET)
                .unwrap();
            assert_eq!(shown(&book), expected);
            assert!(filter(&book).value.unwrap().is_finite());
        }
    }
    fn ms(year: i64, month: i64, day: i64) -> f64 {
        days_from_civil(year, month, day) as f64 * 86_400_000.
    }
    fn serial(year: i64, month: i64, day: i64, date1904: bool) -> f64 {
        (days_from_civil(year, month, day)
            - days_from_civil(
                if date1904 { 1904 } else { 1899 },
                if date1904 { 1 } else { 12 },
                if date1904 { 1 } else { 31 },
            )) as f64
            + f64::from(!date1904 && (year, month, day) >= (1900, 3, 1))
    }
    #[test]
    fn relative_date_filters_cover_every_interval_in_both_calendars() {
        // PhpSpreadsheet f03bcf6 uses inclusive starts and exclusive ends.
        for date1904 in [false, true] {
            for (kind, start, end) in [
                ("yesterday", (2024, 2, 28), (2024, 2, 29)),
                ("today", (2024, 2, 29), (2024, 3, 1)),
                ("tomorrow", (2024, 3, 1), (2024, 3, 2)),
                ("lastWeek", (2024, 2, 18), (2024, 2, 25)),
                ("thisWeek", (2024, 2, 25), (2024, 3, 3)),
                ("nextWeek", (2024, 3, 3), (2024, 3, 10)),
                ("lastMonth", (2024, 1, 1), (2024, 2, 1)),
                ("thisMonth", (2024, 2, 1), (2024, 3, 1)),
                ("nextMonth", (2024, 3, 1), (2024, 4, 1)),
                ("lastQuarter", (2023, 10, 1), (2024, 1, 1)),
                ("thisQuarter", (2024, 1, 1), (2024, 4, 1)),
                ("nextQuarter", (2024, 4, 1), (2024, 7, 1)),
                ("lastYear", (2023, 1, 1), (2024, 1, 1)),
                ("thisYear", (2024, 1, 1), (2025, 1, 1)),
                ("nextYear", (2025, 1, 1), (2026, 1, 1)),
                ("yearToDate", (2024, 1, 1), (2024, 3, 1)),
            ] {
                let start = serial(start.0, start.1, start.2, date1904);
                let end = serial(end.0, end.1, end.2, date1904);
                let values = [start - 0.25, start, end - 0.25, end];
                let text = values.map(|n| n.to_string());
                let mut book = table(&text.iter().map(String::as_str).collect::<Vec<_>>());
                book.options.date1904 = date1904;
                clock::with_time(ms(2024, 2, 29) + 43_200_000., || {
                    book.filter_table(0, 0, Some(field(kind)), BUDGET).unwrap()
                });
                assert_eq!(shown(&book), vec![2, 3], "{kind} {date1904}");
                assert_eq!(filter(&book).value, Some(start));
                assert_eq!(filter(&book).max_value, Some(end));
                // A later reopen preserves the saved snapshot and thresholds.
                clock::with_time(ms(2025, 1, 1), || {
                    for restored in [
                        Spreadsheet::from_json(&book.to_json(), BUDGET).unwrap(),
                        Spreadsheet::import_xlsx(&book.export_xlsx(BUDGET).unwrap(), BUDGET)
                            .unwrap(),
                    ] {
                        assert_eq!(shown(&restored), vec![2, 3], "{kind}");
                        assert_eq!(filter(&restored).value, Some(start));
                        assert_eq!(filter(&restored).max_value, Some(end));
                    }
                });
            }
        }
    }
    #[test]
    fn month_and_quarter_filters_recur_across_years_and_reject_nondates() {
        for date1904 in [false, true] {
            for (prefix, count, width) in [("M", 12, 1), ("Q", 4, 3)] {
                for period in 1..=count {
                    let kind = format!("{prefix}{period}");
                    let mut book = Spreadsheet::new();
                    book.options.date1904 = date1904;
                    let mut expected = Vec::new();
                    let mut row = 1;
                    for year in [2023, 2024] {
                        for month in 1..=12 {
                            book.edit(
                                &[(0, row, 0, &serial(year, month, 15, date1904).to_string())],
                                BUDGET,
                            )
                            .unwrap();
                            if (month - 1) / width + 1 == period {
                                expected.push(row);
                            }
                            row += 1;
                        }
                    }
                    for value in ["TRUE", "FALSE", "'2024-01-01", "=#N/A", "-1", "2958466", ""] {
                        book.edit(&[(0, row, 0, value)], BUDGET).unwrap();
                        row += 1;
                    }
                    book.add_table(0, "Data", [0, 0, row - 1, 0], BUDGET)
                        .unwrap();
                    book.filter_table(0, 0, Some(field(&kind)), BUDGET).unwrap();
                    assert_eq!(shown(&book), expected, "{kind} {date1904}");
                }
            }
        }
    }
    #[test]
    fn date_reapply_uses_current_clock_and_retains_source_edits() {
        let mut book = table(&["=DATE(2024,12,31)", "=DATE(2025,1,1)", "=DATE(2025,1,2)"]);
        clock::with_time(ms(2024, 12, 31), || {
            book.filter_table(0, 0, Some(field("today")), BUDGET)
                .unwrap()
        });
        assert_eq!(shown(&book), vec![1]);
        clock::with_time(ms(2025, 1, 1), || {
            book.reapply_table_filter(0, BUDGET).unwrap()
        });
        assert_eq!(shown(&book), vec![2]);
        clock::with_time(ms(2025, 1, 1), || {
            book.filter_table(0, 0, Some(field("lastQuarter")), BUDGET)
                .unwrap()
        });
        assert_eq!(shown(&book), vec![1]);
        book.filter_table(0, 0, Some(field("null")), BUDGET)
            .unwrap();
        assert_eq!(shown(&book), vec![1, 2, 3]);
    }
    #[test]
    fn imported_dynamic_thresholds_stay_fixed_until_reapply() {
        let mut book = table(&["=DATE(2024,1,1)", "=DATE(2024,1,2)"]);
        clock::with_time(ms(2024, 1, 1), || {
            book.filter_table(0, 0, Some(field("today")), BUDGET)
                .unwrap()
        });
        // External Excel files store their saved mask in row.hidden, without
        // our per-column snapshots. Their cached date bounds still apply.
        let saved = book.options.tables[0].filter.as_mut().unwrap();
        saved.column_visibility = false;
        saved
            .fields
            .as_mut()
            .unwrap()
            .get_mut(&0)
            .unwrap()
            .hidden_rows = None;
        book.sheets[0].rows.entry(2).or_default().hidden = true;
        let bytes = book.export_xlsx(BUDGET).unwrap();
        clock::with_time(ms(2024, 1, 2), || {
            let mut imported = Spreadsheet::import_xlsx(&bytes, BUDGET).unwrap();
            assert_eq!(shown(&imported), vec![1]);
            assert_eq!(filter(&imported).value, Some(serial(2024, 1, 1, false)));
            assert_eq!(
                imported.options.tables[0]
                    .filter
                    .as_ref()
                    .unwrap()
                    .fields
                    .as_ref()
                    .unwrap()[&0]
                    .hidden_rows,
                Some(vec![2])
            );
            imported.reapply_table_filter(0, BUDGET).unwrap();
            assert_eq!(shown(&imported), vec![2]);
            assert_eq!(filter(&imported).value, Some(serial(2024, 1, 2, false)));
        });
    }
    #[test]
    fn average_filters_ignore_headers_totals_and_other_column_visibility() {
        let mut book = table(&["1", "2", "3", "1000"]);
        book.options.tables[0].totals = true;
        book.options.tables[0].filter = None;
        book.filter_table(0, 0, Some(field("aboveAverage")), BUDGET)
            .unwrap();
        assert_eq!(shown(&book), vec![3, 4]);
        assert_eq!(filter(&book).value, Some(2.));
        book.edit(
            &[
                (0, 0, 1, "Other"),
                (0, 1, 1, "6"),
                (0, 2, 1, "5"),
                (0, 3, 1, "1"),
            ],
            BUDGET,
        )
        .unwrap();
        book.resize_table(0, 4, 1, BUDGET).unwrap();
        book.filter_table(0, 1, Some(field("aboveAverage")), BUDGET)
            .unwrap();
        assert_eq!(shown(&book), vec![4]);
        assert_eq!(filter(&book).value, Some(2.));
    }
    #[test]
    fn invalid_dynamic_filters_and_exhausted_budgets_leave_workbook_unchanged() {
        let mut book = table(&["1", "2", "3"]);
        let before = book.to_json();
        for kind in ["", "invalid", "M0", "M13", "Q0", "Q5", "Today"] {
            assert!(book.filter_table(0, 0, Some(field(kind)), BUDGET).is_err());
            assert_eq!(book.to_json(), before);
        }
        let mut conflict = field("today");
        conflict.date_groups.push(vec![2024]);
        assert!(book.filter_table(0, 0, Some(conflict), BUDGET).is_err());
        let mut conflict = field("aboveAverage");
        conflict.conditions.push(("equal", "1".into()));
        assert!(book.filter_table(0, 0, Some(conflict), BUDGET).is_err());
        assert!(
            book.filter_table(0, 0, Some(field("aboveAverage")), 100)
                .is_err()
        );
        assert_eq!(book.to_json(), before);
        assert!(
            clock::with_time(f64::NAN, || book.filter_table(
                0,
                0,
                Some(field("today")),
                BUDGET
            ))
            .is_err()
        );
        assert_eq!(book.to_json(), before);
    }
}

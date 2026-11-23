// Cases adapted from IronCalc test_date_and_time.rs / test_date_system.rs
// (MIT, f93662006b8fb1c401dc870bbda26c5d60ac6037) and Univer date/edate
// and date/eomonth tests (Apache-2.0, 4767b3b309467c283bbd52b725536ca73861e0fc).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn month_shifts_clamp_gregorian_month_ends_and_truncate_month_offsets() {
    let mut book = Spreadsheet::new();
    let mut failures = Vec::new();
    for (formula, want) in [
        ("=EDATE(43831,1)", "43862"),
        ("=EDATE(40558,1.5)", "40589"),
        ("=EDATE(40558,-1.5)", "40527"),
        ("=EDATE(40558,-0.5)", "40558"),
        ("=EDATE(DATE(2025,8,31),-2)", "45838"),
        ("=EDATE(DATE(2025,3,31),-1)", "45716"),
        ("=EDATE(1,1)", "32"),
        ("=EDATE(31,1)", "59"),
        ("=EDATE(89,-1)", "59"),
        ("=EDATE(0,1)", "31"),
        ("=EDATE(60,0)", "59"),
        ("=EOMONTH(61,-1)", "59"),
        ("=EOMONTH(32,0)", "59"),
        ("=EOMONTH(0,0)", "31"),
        ("=EOMONTH(31,0)", "31"),
        ("=EOMONTH(60,0)", "59"),
        ("=EOMONTH(\"2011/1/1\",1)", "40602"),
        ("=EOMONTH(\"2011/1/1\",-3)", "40482"),
        ("=EOMONTH(\"2011/1/15\",1.5)", "40602"),
        ("=EOMONTH(\"2011/1/15\",-1.5)", "40543"),
        ("=EOMONTH(\"2011/1/15\",-0.5)", "40574"),
        ("=EOMONTH(\"1Feb2016\",0)", "42429"),
        ("=EDATE(\"1-Jan-1900\",1)", "32"),
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
fn month_shift_argument_errors_distinguish_omitted_inputs_from_empty_cells() {
    let mut book = Spreadsheet::new();
    let mut failures = Vec::new();
    for name in ["EDATE", "EOMONTH"] {
        for (args, want) in [
            ("", "#ERROR!"),
            ("1", "#ERROR!"),
            ("1/0", "#ERROR!"),
            ("1,2,NA()", "#ERROR!"),
            ("1,2,3", "#ERROR!"),
            (",9", "#N/A"),
            ("45658,", "#N/A"),
            ("TRUE,1", "#VALUE!"),
            ("1,FALSE", "#VALUE!"),
            ("\"TRUE\",1", "#VALUE!"),
            ("1,\"false\"", "#VALUE!"),
            ("-1,1", "#NUM!"),
            ("1,1E15", "#NUM!"),
            ("1,-1E15", "#NUM!"),
            ("2958466,-1", "#NUM!"),
            ("2958465,1", "#NUM!"),
            ("1,-1", "#NUM!"),
            ("1,1/0", "#DIV/0!"),
            ("\"bad\",1/0", "#VALUE!"),
            ("-1,1/0", "#NUM!"),
        ] {
            let formula = format!("={name}({args})");
            book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            let actual = book.display(0, 0, 0, LIMIT).unwrap();
            if actual != want {
                failures.push(format!("{formula}: {actual} != {want}"));
            }
        }
        let formula = format!("={name}(B1,1)");
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        let want = if name == "EDATE" { "31" } else { "59" };
        let actual = book.display(0, 0, 0, LIMIT).unwrap();
        if actual != want {
            failures.push(format!("{formula}: {actual} != {want}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn month_shifts_follow_both_workbook_epochs_and_bound_intermediate_results() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        for (formula, want) in [
            ("=EDATE(0,1)", "31"),
            ("=EDATE(31,1)", if date1904 { "60" } else { "59" }),
            ("=EOMONTH(0,0)", if date1904 { "30" } else { "31" }),
            ("=EOMONTH(31,0)", if date1904 { "59" } else { "31" }),
            ("=EDATE(0,-1)", "#NUM!"),
            ("=EOMONTH(0,-1)", "#NUM!"),
            (
                "=EOMONTH(DATE(9999,12,1),0)",
                if date1904 { "2957003" } else { "2958465" },
            ),
            ("=EOMONTH(DATE(9999,12,1),1)", "#NUM!"),
            ("=EOMONTH(DATE(2023,3,2),-12000)", "#NUM!"),
        ] {
            book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
            assert_eq!(
                book.display(0, 0, 0, LIMIT).unwrap(),
                want,
                "{date1904}: {formula}"
            );
        }
    }
}

#[test]
fn month_shift_arrays_keep_types_and_recalculate_after_json_and_excel_reopening() {
    let inputs = [
        "1", "' ", "1.23", "TRUE", "FALSE", "", "0", "'100", "'2.34", "test", "-3", "1900",
    ];
    let mut book = Spreadsheet::new();
    let mut edits: Vec<_> = inputs
        .iter()
        .enumerate()
        .map(|(i, s)| (0, i / 6, i % 6, *s))
        .collect();
    edits.extend([
        (0, 4, 0, "=EDATE(A1:F2,1)"),
        (0, 8, 0, "=EDATE(43831,A1:F2)"),
        (0, 12, 0, "=EOMONTH(A1:F2,1)"),
    ]);
    book.edit(&edits, LIMIT).unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (row, wants) in [
            (
                4,
                [
                    "32", "#VALUE!", "32", "#VALUE!", "#VALUE!", "31", "31", "130", "33",
                    "#VALUE!", "#NUM!", "1931",
                ],
            ),
            (
                8,
                [
                    "43862", "#VALUE!", "43862", "#VALUE!", "#VALUE!", "43831", "43831", "46874",
                    "43891", "#VALUE!", "43739", "101660",
                ],
            ),
            (
                12,
                [
                    "59", "#VALUE!", "59", "#VALUE!", "#VALUE!", "59", "59", "152", "59",
                    "#VALUE!", "#NUM!", "1947",
                ],
            ),
        ] {
            for (i, want) in wants.iter().enumerate() {
                assert_eq!(
                    restored.display(0, row + i / 6, i % 6, LIMIT).unwrap(),
                    *want,
                    "row {row} element {i}"
                );
            }
        }
        restored.edit(&[(0, 0, 0, "31")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 4, 0, LIMIT).unwrap(), "59");
        restored.edit(&[(0, 0, 0, "60")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 4, 0, LIMIT).unwrap(), "89");
    }
}

#[test]
fn month_shift_output_and_text_parsing_obey_resource_limits() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "saved")], LIMIT).unwrap();
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 0, "=EDATE(SEQUENCE(100000),1)")], 1_000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
    let text = format!("'{}1Feb2016", " ".repeat(20_000));
    book.edit(&[(0, 0, 1, &text)], LIMIT).unwrap();
    let before = book.to_json();
    assert!(book.edit(&[(0, 0, 0, "=EOMONTH(B1,0)")], 30_000).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn compact_month_names_use_the_shared_bounded_date_parser() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=DATEVALUE(\"1Feb2016\")", "42401"),
        ("=TEXT(\"2016Feb1\",\"yyyy-mm-dd\")", "2016-02-01"),
        ("=TEXT(\"29Feb1900\",\"yyyy-mm-dd\")", "1900-02-29"),
        ("=DAY(\"29Feb2024 23:59:60\")", "1"),
        ("=MONTH(\"29Feb2024 23:59:60\")", "3"),
        ("=DATEVALUE(\"1Feb201\")", "#VALUE!"),
        ("=DATEVALUE(\"30Feb2016\")", "#VALUE!"),
        ("=DATEVALUE(\"1Feb2016garbage\")", "#VALUE!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

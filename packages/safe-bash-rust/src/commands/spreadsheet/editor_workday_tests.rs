// Scalar cases adapted from IronCalc test_networkdays.rs and
// test_workday_workdayintl.rs (MIT, LICENSE.IronCalc), and Univer's WORKDAY/
// NETWORKDAYS tests (Apache-2.0, LICENSE.Univer). See editor_tests.rs for revisions.
use super::Spreadsheet;

#[test]
fn workday_and_networkdays_handle_weekends_holidays_and_excel_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 1, "44928"),
            (0, 1, 1, "44932"),
            (0, 2, 1, "44928"),
            (0, 3, 1, "44933"),
        ],
        10_000_000,
    )
    .unwrap();
    let cases = [
        ("=NETWORKDAYS(44927,44936)", "7"),
        ("=NETWORKDAYS(44936,44927)", "-7"),
        ("=NETWORKDAYS(44935,44935)", "1"),
        ("=NETWORKDAYS(44926,44927)", "0"),
        ("=NETWORKDAYS(44927,44936,44935)", "6"),
        ("=NETWORKDAYS(44927,44936,B1:B5)", "5"),
        ("=NETWORKDAYS(44927,44936,B:B)", "5"),
        ("=NETWORKDAYS(44927,44936,44999)", "7"),
        ("=NETWORKDAYS(44927,44936,C1:C3)", "7"),
        ("=NETWORKDAYS(44927,44936,)", "7"),
        ("=NETWORKDAYS(-1,100)", "72"),
        ("=NETWORKDAYS(1,7)", "5"),
        ("=NETWORKDAYS.INTL(44927,44936)", "7"),
        ("=NETWORKDAYS.INTL(44927,44936,2)", "6"),
        ("=NETWORKDAYS.INTL(44927,44936,11)", "8"),
        (r#"=NETWORKDAYS.INTL(44927,44936,"0000110")"#, "8"),
        (r#"=NETWORKDAYS.INTL(44927,44936,"0000000")"#, "10"),
        (r#"=NETWORKDAYS.INTL(44927,44936,"1111111")"#, "0"),
        (r#"=NETWORKDAYS.INTL(44927,44936,"0000110",44935)"#, "7"),
        ("=NETWORKDAYS.INTL(44927,44936,,B1:B5)", "5"),
        ("=WORKDAY(46000,5)", "46007"),
        ("=WORKDAY(46000,5,46001)", "46008"),
        ("=WORKDAY.INTL(46000,5,11)", "46006"),
        ("=WORKDAY.INTL(46000,5,11,46001)", "46007"),
        ("=WORKDAY(44935,-5,B:B)", "44924"),
        ("=WORKDAY(44928,-1.9)", "44925"),
        ("=WORKDAY(44928,1.9)", "44929"),
        ("=WORKDAY(44933,0,B1:B5)", "44933"),
        ("=WORKDAY(44933,1)", "44935"),
        ("=WORKDAY(44933,-1)", "44932"),
        ("=WORKDAY(44928,5,)", "44935"),
        ("=WORKDAY.INTL(44928,5,)", "44935"),
        ("=WORKDAY.INTL(44928,5,,B1:B5)", "44936"),
        ("=WORKDAY(0,1)", "2"),
        ("=WORKDAY(0,-1)", "-1"),
        (r#"=NETWORKDAYS("2012-10-1","2013-3-1")"#, "110"),
        (
            r#"=NETWORKDAYS("2012-10-1","2013-3-1",{"2012-11-22";"2012-12-4";"2013-1-21"})"#,
            "107",
        ),
        (r#"=WORKDAY("2008-10-1",151)"#, "39933"),
        (r#"=WORKDAY.INTL("2008-10-1",151,6,"2008-11-26")"#, "39936"),
        (
            r#"=WORKDAY.INTL("2008-10-1",151,"0011001",{"2008-11-26";"2008-12-4";"2009-1-21"})"#,
            "39986",
        ),
        (r#"=SUM(NETWORKDAYS({44927,44935},44936))"#, "9"),
        (r#"=SUM(WORKDAY(44928,{1;2}))"#, "89859"),
        (r#"=SUM(NETWORKDAYS.INTL(44927,44936,{1,2;11,12}))"#, "29"),
        ("=_xlfn.WORKDAY.INTL(46000,5,11)", "46006"),
        ("=_xlfn.NETWORKDAYS.INTL(44927,44936,11)", "8"),
    ];
    let edits: Vec<_> = cases
        .iter()
        .enumerate()
        .map(|(row, (input, _))| (0, row, 0, *input))
        .collect();
    book.edit(&edits, 10_000_000).unwrap();
    for (row, (input, expected)) in cases.iter().enumerate() {
        assert_eq!(
            book.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "{input}"
        );
    }
    let imported =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    for (row, (input, expected)) in cases.iter().enumerate() {
        assert_eq!(
            imported.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "Excel: {input}"
        );
    }
}

#[test]
fn working_date_functions_preserve_errors_and_validate_weekends_and_bounds() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 1, "invalid"), (0, 1, 1, "=NA()")], 10_000_000)
        .unwrap();
    let cases = [
        ("=NETWORKDAYS()", "#ERROR!"),
        ("=WORKDAY(1)", "#ERROR!"),
        ("=NETWORKDAYS(1,2,3,4)", "#ERROR!"),
        ("=WORKDAY.INTL(1,2,3,4,5)", "#ERROR!"),
        ("=NETWORKDAYS(,100)", "#N/A"),
        ("=WORKDAY(1,)", "#N/A"),
        ("=NETWORKDAYS.INTL(,100)", "#N/A"),
        ("=WORKDAY.INTL(1,)", "#N/A"),
        ("=NETWORKDAYS(1,3000000)", "#NUM!"),
        ("=NETWORKDAYS(-1E100,1)", "#NUM!"),
        ("=WORKDAY(2958465,1)", "#NUM!"),
        ("=WORKDAY(44928,1E100)", "#NUM!"),
        ("=WORKDAY(44928,-1E100)", "#NUM!"),
        ("=NETWORKDAYS(1,2,B1)", "#VALUE!"),
        ("=NETWORKDAYS(1,2,B2)", "#N/A"),
        ("=WORKDAY(44928,1,B2)", "#N/A"),
        ("=NETWORKDAYS(TRUE,1)", "#VALUE!"),
        ("=WORKDAY(44928,FALSE)", "#VALUE!"),
        ("=NETWORKDAYS(1,2,TRUE)", "#VALUE!"),
        ("=NETWORKDAYS.INTL(1,10,99)", "#NUM!"),
        ("=NETWORKDAYS.INTL(1,10,1.5)", "#NUM!"),
        ("=NETWORKDAYS.INTL(1,10,C1)", "#NUM!"),
        ("=WORKDAY.INTL(44928,1,C1)", "#NUM!"),
        (r#"=NETWORKDAYS.INTL(1,10,"111110")"#, "#VALUE!"),
        (r#"=NETWORKDAYS.INTL(1,10,"11111000")"#, "#VALUE!"),
        (r#"=NETWORKDAYS.INTL(1,10,"1111102")"#, "#VALUE!"),
        (r#"=WORKDAY.INTL(44928,0,"11111111")"#, "#VALUE!"),
        (r#"=WORKDAY.INTL(44928,0,"1111111")"#, "#VALUE!"),
        ("=WORKDAY(44928,1,#REF!)", "#REF!"),
        ("=NETWORKDAYS(#N/A,1)", "#N/A"),
        ("=WORKDAY(44928,1,{1;#N/A})", "#N/A"),
    ];
    let edits: Vec<_> = cases
        .iter()
        .enumerate()
        .map(|(row, (input, _))| (0, row, 0, *input))
        .collect();
    book.edit(&edits, 10_000_000).unwrap();
    for (row, (input, expected)) in cases.iter().enumerate() {
        assert_eq!(
            book.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "{input}"
        );
    }
}

#[test]
fn working_date_functions_follow_the_workbook_1904_epoch() {
    let mut book = Spreadsheet::new();
    book.options.date1904 = true;
    let cases = [
        ("=NETWORKDAYS(0,0)", "1"),
        ("=NETWORKDAYS(0,366)", "261"),
        ("=WORKDAY(0,1)", "3"),
        ("=WORKDAY.INTL(0,1,11)", "1"),
        ("=NETWORKDAYS(DATE(2023,1,1),DATE(2023,1,10))", "7"),
        ("=WORKDAY(DATE(2023,1,2),5)", "43473"),
        (
            r#"=NETWORKDAYS("2012-10-1","2013-3-1","2012-11-22")"#,
            "109",
        ),
        ("=WORKDAY(2957003,1)", "#NUM!"),
    ];
    let edits: Vec<_> = cases
        .iter()
        .enumerate()
        .map(|(row, (input, _))| (0, row, 0, *input))
        .collect();
    book.edit(&edits, 10_000_000).unwrap();
    let imported =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    assert!(imported.options.date1904);
    for (row, (input, expected)) in cases.iter().enumerate() {
        assert_eq!(
            book.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "{input}"
        );
        assert_eq!(
            imported.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "Excel: {input}"
        );
    }
}

#[test]
fn excel_array_error_literals_remain_local_to_their_elements() {
    let mut book = Spreadsheet::new();
    let mut cases = vec![
        ("=IFERROR(SUM({1,#N/A}),7)".to_owned(), "7"),
        ("=INDEX({#N/A,2},1,2)".to_owned(), "2"),
        ("=SUM(IFERROR({#N/A,2},0))".to_owned(), "2"),
    ];
    for error in [
        "#N/A", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#NULL!",
    ] {
        cases.push((format!("=SUM({{1,{error}}})"), error));
        cases.push((format!("=IFERROR(SUM({{{error};2}}),7)"), "7"));
    }
    let edits: Vec<_> = cases
        .iter()
        .enumerate()
        .map(|(row, (input, _))| (0, row, 0, input.as_str()))
        .collect();
    book.edit(&edits, 10_000_000).unwrap();
    for (row, (input, expected)) in cases.iter().enumerate() {
        assert_eq!(
            book.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "{input}"
        );
    }
    let imported =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    for (row, (input, expected)) in cases.iter().enumerate() {
        assert_eq!(
            imported.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "Excel: {input}"
        );
    }
}

#[test]
fn excel_week_numbers_keep_the_last_calendar_week() {
    // IronCalc test_weeknum_return_types.rs, plus the Excel week-54 boundary.
    let mut book = Spreadsheet::new();
    for method in [1, 2, 11, 12, 13, 14, 15, 16, 17, 21] {
        let formula = format!("=WEEKNUM(44561,{method})");
        book.edit(&[(0, 0, 0, &formula)], 10_000_000).unwrap();
        assert_eq!(
            book.display(0, 0, 0, 1_000_000).unwrap(),
            if method == 21 { "52" } else { "53" },
            "{formula}"
        );
    }
    for (formula, want) in [
        ("=WEEKNUM(DATE(2000,12,31),1)", "54"),
        ("=WEEKNUM(DATE(2022,1,1))", "1"),
        ("=WEEKNUM(DATE(2022,1,1),21)", "52"),
        ("=ISOWEEKNUM(DATE(2022,1,1))", "52"),
    ] {
        book.edit(&[(0, 0, 0, formula)], 10_000_000).unwrap();
        assert_eq!(book.display(0, 0, 0, 1_000_000).unwrap(), want, "{formula}");
    }
    let restored =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    assert_eq!(restored.display(0, 0, 0, 1_000_000).unwrap(), "52");
}

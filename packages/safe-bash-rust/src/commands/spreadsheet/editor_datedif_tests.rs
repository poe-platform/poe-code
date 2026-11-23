// Cases adapted from IronCalc test_fn_datevalue_datedif.rs (MIT,
// f93662006b8fb1c401dc870bbda26c5d60ac6037) and Univer date/datedif tests
// (Apache-2.0, 4767b3b309467c283bbd52b725536ca73861e0fc).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn datedif_calculates_all_units_and_partial_months() {
    let mut book = Spreadsheet::new();
    let mut failures = Vec::new();
    for (start, end, expected) in [
        ("2020-01-01", "2021-06-15", [1, 17, 531, 5, 165, 14]),
        ("2011/1/29", "2021/3/31", [10, 122, 3714, 2, 61, 2]),
        ("2011/1/1", "2013/9/1", [2, 32, 974, 8, 243, 0]),
        ("2014/3/1", "2016/2/1", [1, 23, 702, 11, 337, 0]),
        ("2009/1/2", "2012/1/1", [2, 35, 1094, 11, 364, 30]),
        ("2010-7-29", "2012-1-28", [1, 17, 548, 5, 183, 30]),
    ] {
        for (unit, want) in ["Y", "M", "D", "YM", "yD", "md"].into_iter().zip(expected) {
            let formula = format!("=DATEDIF(\"{start}\",\"{end}\",\"{unit}\")");
            book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            let actual = book.display(0, 0, 0, LIMIT).unwrap();
            if actual != want.to_string() {
                failures.push(format!("{formula}: {actual} != {want}"));
            }
        }
    }
    for (end, want) in [
        ("2012-2-28", 30),
        ("2012-3-28", 28),
        ("2012-4-28", 30),
        ("2012-5-28", 29),
    ] {
        let formula = format!("=DATEDIF(\"2010-7-29\",\"{end}\",\"MD\")");
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        let actual = book.display(0, 0, 0, LIMIT).unwrap();
        if actual != want.to_string() {
            failures.push(format!("{formula}: {actual} != {want}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn datedif_validates_dates_units_and_error_order() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=DATEDIF(\"2/28/2020\",\"3/1/2020\",\"D\")", "2"),
        ("=DATEDIF(\"2/1/2021\",\"1/1/2021\",\"D\")", "#NUM!"),
        ("=DATEDIF(0,1,\"Z\")", "#NUM!"),
        ("=DATEDIF(0,1,TRUE)", "#NUM!"),
        ("=DATEDIF(0,1,11)", "#NUM!"),
        ("=DATEDIF(0,1,\" D\")", "#NUM!"),
        ("=DATEDIF(\"bad\",\"bad\",\"Y\")", "#VALUE!"),
        ("=DATEDIF(1,\"bad\",\"Y\")", "#VALUE!"),
        ("=DATEDIF(#N/A,1,\"D\")", "#N/A"),
        ("=DATEDIF(0,#REF!,\"D\")", "#REF!"),
        ("=DATEDIF(0,1,#NAME?)", "#NAME?"),
        ("=DATEDIF(FALSE,43832.233,\"D\")", "43832"),
        ("=DATEDIF(\"0\",\"10.9\",\"D\")", "10"),
        ("=DATEDIF(1.9,2.1,\"D\")", "1"),
        (
            "=DATEDIF(\"2026-01-01\",\"2026-01-01 24:00:00\",\"D\")",
            "1",
        ),
        ("=DATEDIF(-1,1,\"D\")", "#NUM!"),
        ("=DATEDIF(0,2958466,\"D\")", "#NUM!"),
        ("=DATEDIF()", "#ERROR!"),
        ("=DATEDIF(0)", "#ERROR!"),
        ("=DATEDIF(0,1)", "#ERROR!"),
        ("=DATEDIF(0,1,\"D\",0)", "#ERROR!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn datedif_preserves_excel_epochs_and_fictitious_leap_day() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        book.edit(
            &[
                (0, 0, 0, "=DATEDIF(0,60,\"M\")"),
                (0, 1, 0, "=DATEDIF(0,366,\"Y\")"),
                (0, 2, 0, "=DATEDIF(0,366,\"D\")"),
                (0, 3, 0, "=DATEDIF(60,90,\"MD\")"),
            ],
            LIMIT,
        )
        .unwrap();
        assert_eq!(
            book.display(0, 0, 0, LIMIT).unwrap(),
            if date1904 { "2" } else { "1" }
        );
        assert_eq!(
            book.display(0, 1, 0, LIMIT).unwrap(),
            if date1904 { "1" } else { "0" }
        );
        assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), "366");
        assert_eq!(
            book.display(0, 3, 0, LIMIT).unwrap(),
            if date1904 { "30" } else { "1" }
        );
    }
}

#[test]
fn datedif_reference_edits_and_top_left_array_values_survive_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0,0,0,"'2012-3-29"),(0,0,1,"'2018-3-1"),(0,0,2,"Y"),(0,0,3,"=DATEDIF(A1,B1,C1)"),(0,2,0,"=DATEDIF({\"2012-3-29\",\"test\",TRUE,FALSE,#NAME?},{\"2018-3-1\";0;\"2013-3-31\"},{\"Y\";0;1;0;0})")],LIMIT).unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.display(0, 0, 3, LIMIT).unwrap(), "5");
        assert_eq!(restored.display(0, 2, 0, LIMIT).unwrap(), "5");
        assert_eq!(restored.display(0, 2, 1, LIMIT).unwrap(), "");
        restored.edit(&[(0, 0, 1, "'2018-3-29")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 0, 3, LIMIT).unwrap(), "6");
    }
}

#[test]
fn datedif_date_text_parsing_obeys_the_batch_budget() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "42")], LIMIT).unwrap();
    let saved = book.to_json();
    let formula = format!(
        "=DATEDIF(\"2026-{}01-01\",\"2026-01-02\",\"D\")",
        " ".repeat(32000)
    );
    assert!(book.edit(&[(0, 0, 0, &formula)], 20_000).is_err());
    assert_eq!(book.to_json(), saved);
    book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "1");
}

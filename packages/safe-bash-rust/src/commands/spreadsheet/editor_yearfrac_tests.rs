// Cases adapted from IronCalc test_yearfrac_basis.rs and date_and_time.rs
// (MIT, f93662006b8fb1c401dc870bbda26c5d60ac6037) and Univer date/yearfrac
// (Apache-2.0, 4767b3b309467c283bbd52b725536ca73861e0fc).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn yearfrac_supports_five_bases_and_reversed_intervals() {
    let mut book = Spreadsheet::new();
    for (start, end, basis, want) in [
        ("\"2012/2/2\"", "\"2021/3/11\"", 0, 9.108333333333333),
        ("\"2012/2/2\"", "\"2021/3/11\"", 1, 9.102107856556255),
        ("44561", "44921", 2, 1.),
        ("43831", "44197", 2, 366. / 360.),
        ("44561", "44926", 3, 1.),
        ("43831", "44197", 3, 366. / 365.),
        ("44561", "44561", 3, 0.),
        ("44620", "44985", 0, 1.),
        ("44804", "44985", 0, 178. / 360.),
        ("DATE(2021,1,31)", "DATE(2021,2,28)", 4, 28. / 360.),
        ("DATE(2021,2,28)", "DATE(2021,3,31)", 0, 31. / 360.),
        ("DATE(2021,2,28)", "DATE(2021,3,31)", 4, 32. / 360.),
        ("DATE(2020,1,1)", "DATE(2020,2,1)", 1, 31. / 366.),
        ("DATE(2019,3,1)", "DATE(2020,2,28)", 1, 364. / 365.),
        ("DATE(2019,3,1)", "DATE(2020,2,29)", 1, 365. / 366.),
        ("DATE(2020,2,29)", "DATE(2021,2,28)", 1, 365. / 366.),
        ("DATE(2020,3,1)", "DATE(2021,3,1)", 1, 1.),
    ] {
        for (start, end) in [(start, end), (end, start)] {
            let formula = format!("=YEARFRAC({start},{end},{basis})");
            book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            let text = book.display(0, 0, 0, LIMIT).unwrap();
            let actual = text.parse::<f64>().unwrap_or(f64::NAN);
            assert!((actual - want).abs() < 1e-11, "{formula}: {text} != {want}");
        }
    }
}

#[test]
fn yearfrac_validates_arguments_types_and_basis() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=YEARFRAC()", "#ERROR!"),
        ("=YEARFRAC(0)", "#ERROR!"),
        ("=YEARFRAC(0,365,3,0)", "#ERROR!"),
        ("=YEARFRAC(,365)", "#N/A"),
        ("=YEARFRAC(0,)", "#N/A"),
        ("=YEARFRAC(0,1,-1)", "#NUM!"),
        ("=YEARFRAC(0,1,5)", "#NUM!"),
        ("=YEARFRAC(0,1,\"test\")", "#VALUE!"),
        ("=YEARFRAC(FALSE,43832.233)", "#VALUE!"),
        ("=YEARFRAC(0,TRUE)", "#VALUE!"),
        ("=YEARFRAC(0,365,TRUE)", "#VALUE!"),
        ("=YEARFRAC(\"test\",365)", "#VALUE!"),
        ("=YEARFRAC(0,\"test\")", "#VALUE!"),
        ("=YEARFRAC(#N/A,1)", "#N/A"),
        ("=YEARFRAC(1,#NAME?)", "#NAME?"),
        ("=YEARFRAC(0,1,#DIV/0!)", "#DIV/0!"),
        (
            "=YEARFRAC({\"2012-3-29\",\"test\",TRUE,FALSE,#NAME?},\"2021-12-31\")",
            "#VALUE!",
        ),
        ("=YEARFRAC(0,365,3.9)", "1"),
        ("=YEARFRAC({0},{365},{3})", "1"),
        ("=YEARFRAC(0,{365;366},3)", "#VALUE!"),
        ("=YEARFRAC(0,365,{2,3})", "#VALUE!"),
        ("=YEARFRAC(\"0\",\"365.9\",\"3\")", "1"),
        ("=YEARFRAC(\"2025-1-1\",\"2026-1-1\")", "1"),
        ("=YEARFRAC(\"2025-1-1\",\"2026-1-1\",)", "1"),
        ("=YEARFRAC(-1,0)", "#NUM!"),
        ("=YEARFRAC(0,2958466)", "#NUM!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn yearfrac_retains_excel_calendar_boundaries_and_roundtrip_values() {
    for date1904 in [false, true] {
        let mut book = Spreadsheet::new();
        book.options.date1904 = date1904;
        book.edit(
            &[
                (0, 0, 0, "0"),
                (0, 0, 1, "365"),
                (0, 0, 2, "=YEARFRAC(A1,B1,1)"),
                (0, 1, 0, "=YEARFRAC(0,366,1)"),
                (0, 2, 0, "=YEARFRAC(1,367,1)"),
            ],
            LIMIT,
        )
        .unwrap();
        for mut restored in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            for (r, c, want) in [
                (0, 2, 365. / if date1904 { 366. } else { 365. }),
                (1, 0, 366. / if date1904 { 366. } else { 365. }),
                (2, 0, if date1904 { 1. } else { 366. / 365. }),
            ] {
                let text = restored.display(0, r, c, LIMIT).unwrap();
                let actual = text.parse::<f64>().unwrap_or(f64::NAN);
                assert!(
                    (actual - want).abs() < 1e-11,
                    "{date1904},({r},{c}): {text} != {want}"
                );
            }
            restored.edit(&[(0, 0, 1, "366")], LIMIT).unwrap();
            assert_eq!(
                restored.display(0, 0, 2, LIMIT).unwrap(),
                restored.display(0, 1, 0, LIMIT).unwrap()
            );
        }
    }
}

#[test]
fn yearfrac_long_intervals_use_bounded_calendar_arithmetic() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=YEARFRAC(1,2958465,1)")], 20_000)
        .unwrap();
    let result = book
        .display(0, 0, 0, LIMIT)
        .unwrap()
        .parse::<f64>()
        .unwrap();
    assert!((result - 8100.).abs() < 0.01);
    let saved = book.to_json();
    let formula = format!(
        "=YEARFRAC(\"2026-{}01-01\",\"2026-01-02\",3)",
        " ".repeat(32000)
    );
    assert!(book.edit(&[(0, 0, 0, &formula)], 20_000).is_err());
    assert_eq!(book.to_json(), saved);
}

// IronCalc f936620 address_areas.rs (MIT, LICENSE.IronCalc) and Univer
// 4767b3b lookup/address (Apache-2.0, LICENSE.Univer), plus editor regressions.
use super::Spreadsheet;
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn address_excel_sheet_text_and_arguments() {
    let mut book = Spreadsheet::new();
    let mut failures = Vec::new();
    for (formula, expected) in [
        ("=ADDRESS(1,1,1,TRUE,\"Sheet1\")", "Sheet1!$A$1"),
        ("=ADDRESS(1,1,1,TRUE,\"My Sheet\")", "'My Sheet'!$A$1"),
        ("=ADDRESS(1,1,1,TRUE,\"O'Brien\")", "'O''Brien'!$A$1"),
        ("=ADDRESS(1,1,1,TRUE,\"\")", "!$A$1"),
        ("=ADDRESS(1,1,,,,)", "#ERROR!"),
        ("=ADDRESS(1,1,,,)", "$A$1"),
        ("=ADDRESS(1,1,1,TRUE,TRUE)", "TRUE!$A$1"),
        ("=ADDRESS(1,1,1,TRUE,12)", "'12'!$A$1"),
        ("=ADDRESS(1,1,5)", "#VALUE!"),
        ("=ADDRESS(0,1)", "#VALUE!"),
        ("=ADDRESS(1,16385)", "#VALUE!"),
        ("=ADDRESS(1048577,1)", "#VALUE!"),
        ("=ADDRESS(1048576,16384)", "$XFD$1048576"),
        ("=ADDRESS(23.4,34.7,2)", "AH$23"),
        ("=ADDRESS(1,1,1,\"bad\")", "#VALUE!"),
        ("=ADDRESS(1)", "#ERROR!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let actual = book.display(0, 0, 0, LIMIT).unwrap();
        if actual != expected {
            failures.push(format!("{formula}: {actual} != {expected}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn address_arrays_keep_sheet_types_and_element_errors() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (
                0,
                0,
                0,
                "=ADDRESS({1;2},{4,5},1,TRUE,{\"Sheet1\";\"O'Brien\"})",
            ),
            (0, 3, 0, "=ADDRESS({1;2;3},1,1,TRUE,{12;TRUE;\"\"})"),
            (0, 7, 0, "=ADDRESS({1;2},1,1,TRUE,{\"Sheet1\";#N/A})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, expected) in [
        (0, 0, "Sheet1!$D$1"),
        (0, 1, "Sheet1!$E$1"),
        (1, 0, "'O''Brien'!$D$2"),
        (1, 1, "'O''Brien'!$E$2"),
        (3, 0, "'12'!$A$1"),
        (4, 0, "TRUE!$A$2"),
        (5, 0, "!$A$3"),
        (7, 0, "Sheet1!$A$1"),
        (8, 0, "#N/A"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), expected, "{r},{c}");
    }
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 0, "=ADDRESS(SEQUENCE(10000),1)")], 100_000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
}

#[test]
fn address_indirect_recalculate_across_sheets_and_roundtrips() {
    let mut book = Spreadsheet::new();
    book.add_sheet("O'Brien").unwrap();
    book.edit(
        &[
            (1, 1, 2, "42"),
            (0, 0, 0, "O'Brien"),
            (0, 0, 1, "=ADDRESS(2,3,1,TRUE,A1)"),
            (0, 0, 2, "=INDIRECT(B1)"),
            (0, 1, 1, "=INDIRECT(\"'O''Brien'!C2\")"),
            (0, 2, 1, "=INDIRECT(ADDRESS(2,3,1,FALSE,A1),FALSE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for stage in 0..3 {
        for (r, c) in [(0, 2), (1, 1), (2, 1)] {
            assert_eq!(
                book.display(0, r, c, LIMIT).unwrap(),
                "42",
                "stage {stage} {r},{c}"
            );
        }
        if stage == 0 {
            book = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
        }
        if stage == 1 {
            book = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        }
    }
    book.edit(&[(1, 1, 2, "99")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "99");
}

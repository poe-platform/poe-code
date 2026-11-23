use super::{Spreadsheet, Value};
const LIMIT: usize = 128 * 1024 * 1024;

#[test]
fn database_criteria_edits_recalculate_and_roundtrip() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "City"),
            (0, 0, 1, "Amount"),
            (0, 0, 2, "Flag"),
            (0, 1, 0, "Berlin"),
            (0, 1, 1, "10"),
            (0, 1, 2, "TRUE"),
            (0, 2, 0, "Berlino"),
            (0, 2, 1, "20"),
            (0, 2, 2, "1"),
            (0, 3, 0, "Paris"),
            (0, 3, 1, "30"),
            (0, 3, 2, "FALSE"),
            (0, 0, 4, "City"),
            (0, 1, 4, "Berlin"),
            (0, 0, 6, "=DSUM(A1:C4,\"Amount\",E1:E2)"),
            (0, 1, 6, "=DCOUNT(A1:C4,\"Amount\",E1:E2)"),
            (0, 2, 6, "=DGET(A1:C4,\"Flag\",E1:E2)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 6, LIMIT).unwrap(), "30");
    assert_eq!(book.display(0, 1, 6, LIMIT).unwrap(), "2");
    assert_eq!(book.display(0, 2, 6, LIMIT).unwrap(), "#NUM!");
    book.edit(&[(0, 1, 4, "'=Berlin")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 6, LIMIT).unwrap(), "10");
    assert!(matches!(
        book.cell(0, 2, 6).and_then(|c| c.value.clone()),
        Some(Value::Bool(true))
    ));
    book.edit(&[(0, 0, 4, "Flag"), (0, 1, 4, "1")], LIMIT)
        .unwrap();
    let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for book in [&book, &json, &excel] {
        assert_eq!(book.display(0, 0, 6, LIMIT).unwrap(), "20");
        assert_eq!(book.display(0, 1, 6, LIMIT).unwrap(), "1");
        assert_eq!(book.display(0, 2, 6, LIMIT).unwrap(), "1");
    }
}

#[test]
fn database_errors_counts_and_blank_or_rows() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Key"),
            (0, 0, 1, "Value"),
            (0, 1, 0, "a"),
            (0, 1, 1, "TRUE"),
            (0, 2, 0, "a"),
            (0, 2, 1, "#N/A"),
            (0, 3, 0, "a"),
            (0, 3, 1, "2"),
            (0, 4, 0, "b"),
            (0, 4, 1, "3"),
            (0, 0, 3, "Key"),
            (0, 1, 3, "a"),
        ],
        LIMIT,
    )
    .unwrap();
    for (formula, expected) in [
        ("=DCOUNT(A1:B5,2,D1:D2)", "1"),
        ("=DCOUNTA(A1:B5,2,D1:D2)", "3"),
        ("=DSUM(A1:B5,2,D1:D2)", "2"),
        ("=DSUM(A1:B5,2,D1:D3)", "5"),
        ("=DVAR(A1:B5,2,D1:D2)", "#DIV/0!"),
        ("=DVARP(A1:B5,2,D1:D2)", "0"),
        ("=DGET(A1:B5,2,D1:D2)", "#NUM!"),
        ("=DSUM(A1:B5,0,D1:D2)", "#VALUE!"),
        ("=DSUM(A1:B5,1/3,D1:D2)", "#VALUE!"),
        ("=DSUM(A1:B5,65538,D1:D2)", "#VALUE!"),
        ("=DSUM(A1:B1,2,D1:D2)", "#VALUE!"),
        ("=DSUM(A1:B5,2,D1:D1)", "#VALUE!"),
    ] {
        book.edit(&[(0, 0, 5, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 5, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn database_not_equal_criteria_include_error_records() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Key"),
            (0, 0, 1, "Amount"),
            (0, 1, 0, "a"),
            (0, 1, 1, "10"),
            (0, 2, 0, "#N/A"),
            (0, 2, 1, "20"),
            (0, 3, 0, "b"),
            (0, 3, 1, "30"),
            (0, 0, 3, "Key"),
            (0, 1, 3, "<>b"),
            (0, 0, 5, "=DSUM(A1:B4,2,D1:D2)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 5, LIMIT).unwrap(), "30");
}

#[test]
fn database_work_limits_preserve_the_previous_document() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Key"),
            (0, 0, 1, "Amount"),
            (0, 1, 0, "a"),
            (0, 1, 1, "12"),
            (0, 0, 3, "Key"),
            (0, 1, 3, "a"),
        ],
        LIMIT,
    )
    .unwrap();
    let before = book.to_json();
    for formula in ["=DSUM(A1:B1048576,2,D1:D2)", "=DCOUNT(A1:B2,2,D1:D1048576)"] {
        assert!(book.edit(&[(0, 0, 5, formula)], 4096).is_err());
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn database_text_prefixes_do_not_extend_wildcard_patterns() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Key"),
            (0, 0, 1, "Amount"),
            (0, 1, 0, "bb"),
            (0, 1, 1, "1"),
            (0, 2, 0, "bbeta"),
            (0, 2, 1, "2"),
            (0, 3, 0, "b"),
            (0, 3, 1, "4"),
            (0, 4, 0, "b*"),
            (0, 4, 1, "8"),
            (0, 5, 0, "b*tail"),
            (0, 5, 1, "16"),
            (0, 6, 0, "bbetaZ"),
            (0, 6, 1, "32"),
            (0, 0, 3, "Key"),
            (0, 0, 5, "=DSUM(A1:B7,2,D1:D2)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (criterion, expected) in [
        ("b?", "9"),
        ("b", "63"),
        ("b~*", "8"),
        ("*eta", "2"),
        ("'=b", "4"),
        ("b*", "63"),
        ("<>b?", "54"),
    ] {
        book.edit(&[(0, 1, 3, criterion)], LIMIT).unwrap();
        assert_eq!(
            book.display(0, 0, 5, LIMIT).unwrap(),
            expected,
            "{criterion}"
        );
    }
}

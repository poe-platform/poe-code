// Reference contracts from IronCalc f936620 information::fn_cell (MIT) and
// Univer 4767b3b information/cell (Apache-2.0); see adjacent license files.
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn cell_metadata_reads_references_without_evaluating_contents() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=CELL(\"address\",A1)", "$A$1"),
        ("=CELL(\"address\")", "$A$1"),
        ("=CELL(\"row\",A:A)", "1"),
        ("=CELL(\"col\",1:1048576)", "1"),
        ("=CELL(\"address\",XFD1048576)", "$XFD$1048576"),
        ("=CELL(\"address\",INDIRECT(\"C8:B2\"))", "$B$2"),
        ("=CELL(\"col\",INDEX(A:A,1))", "1"),
        ("=CELL(\"address\",OFFSET(A1,1,1))", "$B$2"),
        ("=CELL(\"type\",Z1048576)", "b"),
        ("=CELL(\"contents\",Z1048576)", "0"),
        ("=TYPE(CELL(\"address\",A1))", "2"),
    ] {
        book.edit(&[(0, 0, 0, formula)], 100_000).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn cell_selector_arrays_and_cross_sheet_references_keep_shape_and_names() {
    let mut book = Spreadsheet::new();
    book.add_sheet("O'Brien").unwrap();
    book.edit(
        &[
            (1, 1, 2, "=1/0"),
            (
                0,
                0,
                0,
                "=CELL({\"address\",\"row\",\"col\";\"type\",\"contents\",#N/A},'O''Brien'!C2)",
            ),
            (0, 3, 0, "address"),
            (0, 4, 0, "type"),
            (0, 3, 1, "=CELL(A4:A5,'O''Brien'!C2)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (row, column, expected) in [
        (0, 0, "'O''Brien'!$C$2"),
        (0, 1, "2"),
        (0, 2, "3"),
        (1, 0, "v"),
        (1, 1, "#DIV/0!"),
        (1, 2, "#N/A"),
        (3, 1, "'O''Brien'!$C$2"),
        (4, 1, "v"),
    ] {
        assert_eq!(book.display(0, row, column, LIMIT).unwrap(), expected);
    }
    let before = book.to_json();
    assert!(book.edit(&[(0, 0, 4, "=CELL(A:A,B1)")], 100_000).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn cell_type_classifies_errors_and_contents_recalculates_after_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=1/0"),
            (0, 1, 0, "text"),
            (0, 2, 0, "TRUE"),
            (0, 3, 0, "=\"\""),
            (0, 4, 0, "3.4"),
            (0, 0, 1, "=CELL(\"type\",A1)"),
            (0, 1, 1, "=CELL(\"type\",A2)"),
            (0, 2, 1, "=CELL(\"TYPE\",A3)"),
            (0, 3, 1, "=CELL(\"type\",A4)"),
            (0, 4, 1, "=CELL(\"contents\",A5:A1048576)"),
            (0, 5, 1, "=CELL(\"contents\",A1:A5)"),
            (0, 6, 1, "=CELL(\"address\",A1:A5)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut copy in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        book,
    ] {
        for (row, expected) in ["v", "l", "v", "l", "3.4", "#DIV/0!", "$A$1"]
            .iter()
            .enumerate()
        {
            assert_eq!(
                copy.display(0, row, 1, LIMIT).unwrap(),
                *expected,
                "row {row}"
            );
        }
        copy.edit(&[(0, 4, 0, "42"), (0, 0, 0, "changed")], LIMIT)
            .unwrap();
        assert_eq!(copy.display(0, 4, 1, LIMIT).unwrap(), "42");
        assert_eq!(copy.display(0, 0, 1, LIMIT).unwrap(), "l");
        assert_eq!(copy.display(0, 5, 1, LIMIT).unwrap(), "changed");
    }
}

#[test]
fn cell_rejects_invalid_info_types_and_non_references() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=CELL()", "#ERROR!"),
        ("=CELL(\"row\",A1,A2)", "#ERROR!"),
        ("=CELL(\"unknown\",A1)", "#VALUE!"),
        ("=CELL(TRUE)", "#VALUE!"),
        ("=CELL(2)", "#VALUE!"),
        ("=CELL(\"\")", "#VALUE!"),
        ("=CELL(NA(),A1)", "#N/A"),
        ("=CELL(\"row\",#REF!)", "#REF!"),
        ("=CELL(\"row\",42)", "#N/A"),
        ("=CELL(\"row\",{1,2})", "#N/A"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

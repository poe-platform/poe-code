// Error tokens and ERROR.TYPE codes adapt IronCalc f936620
// expressions/lexer/test/test_common.rs and functions/information/mod.rs.
// See LICENSE.IronCalc. GETTING_DATA additionally covers the Excel code 8.
use super::{Spreadsheet, Value};
const LIMIT: usize = 32 * 1024 * 1024;
const ERRORS: [&str; 5] = ["#CALC!", "#SPILL!", "#GETTING_DATA", "#CIRC!", "#ERROR!"];
fn error(book: &Spreadsheet, r: usize, c: usize, expected: &str) {
    assert!(
        matches!(book.cell(0,r,c).and_then(|c|c.value.clone()), Some(Value::Error(e)) if e == expected),
        "{r},{c}: {}",
        book.display(0, r, c, LIMIT).unwrap()
    );
}
#[test]
fn modern_error_literals_and_stored_errors_propagate_without_becoming_text() {
    for e in ERRORS {
        let mut b = Spreadsheet::new();
        b.edit(
            &[
                (0, 0, 0, &e.to_ascii_lowercase()),
                (0, 0, 1, "=A1"),
                (0, 1, 0, &format!("={}", e.to_ascii_lowercase())),
                (0, 2, 0, &format!("=UNICODE({e})")),
                (0, 3, 0, &format!("=ENCODEURL({e})")),
                (0, 4, 0, &format!("=IFNA({e},0)")),
                (0, 5, 0, &format!("=IFERROR({e},7)")),
                (0, 6, 0, &format!("=ISERROR({e})")),
                (0, 7, 0, &format!("=ISERR({e})")),
                (0, 8, 0, &format!("=ISNA({e})")),
            ],
            LIMIT,
        )
        .unwrap();
        for r in 0..=4 {
            error(&b, r, 0, e);
        }
        error(&b, 0, 1, e);
        for (r, value) in [(5, "7"), (6, "TRUE"), (7, "TRUE"), (8, "FALSE")] {
            assert_eq!(b.display(0, r, 0, LIMIT).unwrap(), value, "{e}");
        }
        b.edit(&[(0, 9, 0, "unrelated")], LIMIT).unwrap();
        error(&b, 0, 1, e);
    }
}
#[test]
fn modern_errors_in_arrays_keep_error_type_codes_and_per_cell_fallbacks() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (
                0,
                0,
                0,
                "={#SPILL!,#CALC!,#GETTING_DATA;#N/A,#REF!,#DIV/0!}",
            ),
            (0, 3, 0, "=ERROR.TYPE(A1:C2)"),
            (0, 6, 0, "=IFERROR(A1:C2,42)"),
            (0, 9, 0, "=IFNA(A1:C2,7)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, expected) in [
        ["#SPILL!", "#CALC!", "#GETTING_DATA"],
        ["#N/A", "#REF!", "#DIV/0!"],
    ]
    .into_iter()
    .enumerate()
    {
        for (c, e) in expected.into_iter().enumerate() {
            error(&b, r, c, e);
        }
    }
    for (r, expected) in [["9", "14", "8"], ["7", "4", "2"]].into_iter().enumerate() {
        for (c, e) in expected.into_iter().enumerate() {
            assert_eq!(b.display(0, r + 3, c, LIMIT).unwrap(), e);
            assert_eq!(b.display(0, r + 6, c, LIMIT).unwrap(), "42");
        }
    }
    error(&b, 9, 0, "#SPILL!");
    error(&b, 9, 1, "#CALC!");
    error(&b, 9, 2, "#GETTING_DATA");
    assert_eq!(b.display(0, 10, 0, LIMIT).unwrap(), "7");
    error(&b, 10, 1, "#REF!");
    error(&b, 10, 2, "#DIV/0!");
}
#[test]
fn quoted_error_text_and_real_errors_keep_types_through_json_and_excel() {
    let mut b = Spreadsheet::new();
    for (r, e) in ERRORS.into_iter().enumerate() {
        b.edit(
            &[
                (0, r, 0, e),
                (0, r, 1, &format!("'{e}")),
                (0, r, 2, &format!("=A{}", r + 1)),
                (0, r, 3, &format!("=B{}", r + 1)),
                (0, r, 4, &format!("={e}")),
            ],
            LIMIT,
        )
        .unwrap();
    }
    for book in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, e) in ERRORS.into_iter().enumerate() {
            for c in [0, 2, 4] {
                error(&book, r, c, e);
            }
            for c in [1, 3] {
                assert!(
                    matches!(book.cell(0,r,c).and_then(|c|c.value.clone()),Some(Value::Text(t)) if t==e)
                );
            }
            assert_eq!(book.input(0, r, 1), format!("'{e}"));
        }
    }
}
#[test]
fn error_literals_survive_table_and_sheet_rewrites_and_row_insertion() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Result"),
            (0, 1, 0, "#CALC!"),
            (0, 2, 0, "#SPILL!"),
            (0, 4, 0, "=IFERROR(SUM(Checks[Result]),#GETTING_DATA)"),
            (0, 5, 0, "=IFERROR(Sheet1!A2,#CIRC!)"),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Checks", [0, 0, 2, 0], LIMIT).unwrap();
    b.edit(&[], LIMIT).unwrap();
    error(&b, 4, 0, "#GETTING_DATA");
    error(&b, 5, 0, "#CIRC!");
    b.rename_table(0, "Results", LIMIT).unwrap();
    b.rename_sheet(0, "CALC", LIMIT).unwrap();
    b.edit_axis(0, false, 1, 1, LIMIT).unwrap();
    assert!(b.input(0, 5, 0).contains("Results[Result]"));
    assert!(b.input(0, 6, 0).contains("CALC!A3"));
    error(&b, 5, 0, "#GETTING_DATA");
    error(&b, 6, 0, "#CIRC!");
    b.convert_table_to_range(0, LIMIT).unwrap();
    error(&b, 5, 0, "#GETTING_DATA");
    error(&b, 6, 0, "#CIRC!");
    let source = "IFERROR(#CALC!,#CIRC!)+#ERROR!+#SPILL!+#GETTING_DATA";
    let mapping = [
        ("CALC", Some("Calculation")),
        ("CIRC", Some("Circular")),
        ("ERROR", Some("Errors")),
        ("SPILL", Some("Spills")),
    ];
    let (mapped, refs) = super::map_sheet_references(source, &mapping, &mut { LIMIT }).unwrap();
    assert_eq!(mapped, source);
    assert!(refs.is_empty());
}

#[test]
fn copied_error_formulas_preserve_literals_and_rebase_only_references() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 1, 1, "=IFERROR(A2,#GETTING_DATA)+#CALC!"),
            (0, 1, 2, "=IFERROR(A2,#CIRC!)+#ERROR!"),
        ],
        LIMIT,
    )
    .unwrap();
    for (column, expected) in [
        (1, "IFERROR(C5,#GETTING_DATA)+#CALC!"),
        (2, "IFERROR(C5,#CIRC!)+#ERROR!"),
    ] {
        let cell = b.sheets[0].cells.get(&(1, column)).unwrap();
        let copied = b
            .relocate_cell(cell, (1, column), (4, column + 2), 0, LIMIT)
            .unwrap();
        assert_eq!(copied.formula.as_deref(), Some(expected));
        assert!(copied.value.is_none());
    }
    // A suffix belongs to the unknown token, not to a valid error prefix.
    assert_eq!(
        super::xlsx_import::error_token("#GETTING_DATA_MORE+1"),
        "#GETTING_DATA_MORE"
    );
    b.edit(&[(0, 0, 0, "=ERROR.TYPE(#GETTING_DATA_MORE)")], LIMIT)
        .unwrap();
    assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "5");
    let before = b.to_json();
    assert!(
        b.edit(&[(0, 0, 0, "=ERROR.TYPE(A1:XFD1048576)")], 1024)
            .is_err()
    );
    assert_eq!(b.to_json(), before);
}

#[test]
fn excel_exports_modern_error_metadata_with_and_without_dynamic_arrays() {
    for dynamic in [false, true] {
        let mut b = Spreadsheet::new();
        b.edit(
            &[
                (0, 0, 0, "#SPILL!"),
                (0, 0, 1, "#CALC!"),
                (0, 0, 2, "'#CALC!"),
            ],
            LIMIT,
        )
        .unwrap();
        if dynamic {
            b.edit(&[(0, 0, 3, "=SEQUENCE(2)")], LIMIT).unwrap();
        }
        let bytes = b.export_xlsx(LIMIT).unwrap();
        let mut entries = crate::commands::structured::read_office_archive(&bytes);
        let sheet = std::str::from_utf8(&entries["xl/worksheets/sheet1.xml"]).unwrap();
        assert!(sheet.contains(r#"vm="1""#), "{sheet}");
        assert!(sheet.contains(r#"vm="2""#), "{sheet}");
        assert_eq!(sheet.matches("<v>#VALUE!</v>").count(), 2);
        let restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        error(&restored, 0, 0, "#SPILL!");
        error(&restored, 0, 1, "#CALC!");
        assert!(
            matches!(restored.cell(0,0,2).and_then(|c|c.value.clone()),Some(Value::Text(s)) if s=="#CALC!")
        );
        if dynamic {
            assert_eq!(restored.display(0, 1, 3, LIMIT).unwrap(), "2");
        }
        // Older readers, and files missing rich metadata, retain the explicit fallback.
        entries.remove("xl/richData/rdrichvalue.xml");
        let fallback = office_package_rust::write_zip_stored(
            &entries
                .iter()
                .map(|(n, b)| (n.as_str(), b.as_slice()))
                .collect::<Vec<_>>(),
        );
        let fallback = Spreadsheet::import_xlsx(&fallback, LIMIT).unwrap();
        error(&fallback, 0, 0, "#VALUE!");
        error(&fallback, 0, 1, "#VALUE!");
    }
}

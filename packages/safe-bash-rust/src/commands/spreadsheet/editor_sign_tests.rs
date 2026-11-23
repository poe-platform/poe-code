// Signed entry follows IronCalc f936620 model::formula_without_prefix and
// test_fn_formulatext.rs (MIT; LICENSE.IronCalc), using the editor's existing
// supported number/percentage/date forms. Keep authored text types intact.
use super::{Spreadsheet, Value};
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn signed_expressions_use_the_formula_ast_and_canonical_equals_prefix() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 1, "3"), (0, 1, 1, "5")], LIMIT).unwrap();
    for (source, expected) in [
        ("-B1-B2", "-8"),
        ("-4-2", "-6"),
        ("-B", "#NAME?"),
        ("-B1", "-3"),
        ("+B1+B2", "8"),
        ("+SUM(B1:B2)", "8"),
        ("-SUM(B1:B2)", "-8"),
        ("--B1", "3"),
        ("+ B1", "3"),
        ("-2^2", "4"),
        ("-B1/0", "#DIV/0!"),
    ] {
        book.edit(&[(0, 0, 0, source), (0, 0, 3, "=FORMULATEXT(A1)")], LIMIT)
            .unwrap();
        assert_eq!(book.input(0, 0, 0), format!("={source}"));
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{source}");
        assert_eq!(book.display(0, 0, 3, LIMIT).unwrap(), format!("={source}"));
    }
}

#[test]
fn signed_numbers_percentages_and_unquoted_nonformulas_keep_their_types() {
    let mut book = Spreadsheet::new();
    for (source, expected, number) in [
        ("-42", "-42", true),
        ("+42", "42", true),
        ("-1.25e2", "-125", true),
        ("+0.5", "0.5", true),
        ("-25%", "-25%", true),
        ("+25%", "25%", true),
        ("+", "+", false),
        ("-", "-", false),
        ("=", "=", false),
        ("--42", "--42", false),
        ("+-42", "+-42", false),
        ("- 42", "- 42", false),
        (" -B1", " -B1", false),
        ("-2026-11-21", "-2026-11-21", false),
    ] {
        // A fresh cell keeps the existing percentage format from affecting later cases.
        let row = book.sheets[0].cells.len();
        book.edit(&[(0, row, 0, source)], LIMIT).unwrap();
        let cell = book.cell(0, row, 0).unwrap();
        assert!(cell.formula.is_none(), "{source}");
        assert_eq!(
            matches!(cell.value, Some(Value::Number(_))),
            number,
            "{source}"
        );
        assert_eq!(
            book.display(0, row, 0, LIMIT).unwrap(),
            expected,
            "{source}"
        );
    }
}

#[test]
fn signed_function_entry_completes_parentheses_and_binds_quoted_sheets() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Sales data").unwrap();
    book.edit(
        &[
            (1, 0, 0, "7"),
            (1, 1, 0, "11"),
            (0, 0, 0, "-SUM('Sales data'!A1:A2"),
            (0, 1, 0, "+SUM('Sales data'!A1:A2)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.input(0, 0, 0), "=-SUM('Sales data'!A1:A2)");
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "-18");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "18");
    book.rename_sheet(1, "Orders", LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "-18");
    assert!(book.input(0, 0, 0).contains("Orders!A1:A2"));
}

#[test]
fn signed_literal_text_survives_editing_json_excel_and_relocation() {
    let mut book = Spreadsheet::new();
    let literals = [
        "-B1-B2",
        "+SUM(A1:A2)",
        "-4-2",
        "-42",
        "+25%",
        "--B1",
        "-note",
        "+",
        "-",
        "=",
    ];
    for (row, text) in literals.iter().enumerate() {
        book.edit(&[(0, row, 0, &format!("'{text}"))], LIMIT)
            .unwrap();
    }
    for mut reopened in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (row, text) in literals.iter().enumerate() {
            let input = reopened.input(0, row, 0);
            if text.len() > 1 {
                assert!(input.starts_with('\''), "{text}: {input}");
            }
            reopened.edit(&[(0, row, 0, &input)], LIMIT).unwrap();
            assert!(reopened.cell(0, row, 0).unwrap().formula.is_none());
            assert_eq!(reopened.display(0, row, 0, LIMIT).unwrap(), *text);
            let cell = reopened.cell(0, row, 0).unwrap();
            let copied = reopened
                .relocate_cell(&cell, (row, 0), (row, 2), 0, LIMIT)
                .unwrap();
            assert!(matches!(copied.value,Some(Value::Text(ref value)) if value == text));
            assert!(copied.formula.is_none());
        }
    }
}

#[test]
fn signed_formulas_relocate_and_recalculate_after_json_excel_and_table_changes() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Amount"),
            (0, 1, 0, "3"),
            (0, 2, 0, "5"),
            (0, 0, 3, "-B1*D4"),
        ],
        LIMIT,
    )
    .unwrap();
    let copied = book
        .relocate_cell(&book.cell(0, 0, 3).unwrap(), (0, 3), (29, 3), 0, LIMIT)
        .unwrap();
    assert_eq!(copied.formula.as_deref(), Some("-B30*D33")); // Original extend test.
    book.add_table(0, "Sales", [0, 0, 2, 0], LIMIT).unwrap();
    book.edit(
        &[
            (0, 0, 0, "-Amount"),
            (0, 1, 2, "-SUM(Sales[-Amount])"),
            (0, 4, 2, "-SEQUENCE(3)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert!(book.cell(0, 0, 0).unwrap().formula.is_none());
    for mut reopened in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(reopened.display(0, 1, 2, LIMIT).unwrap(), "-8");
        for (r, want) in [(4, "-1"), (5, "-2"), (6, "-3")] {
            assert_eq!(reopened.display(0, r, 2, LIMIT).unwrap(), want);
        }
        reopened.edit(&[(0, 2, 0, "9")], LIMIT).unwrap();
        assert_eq!(reopened.display(0, 1, 2, LIMIT).unwrap(), "-12");
    }
}

#[test]
fn signed_formula_budget_failures_restore_the_whole_batch() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "kept")], LIMIT).unwrap();
    let before = book.to_json();
    assert!(
        book.edit(
            &[(0, 0, 0, "changed"), (0, 1, 0, "-SEQUENCE(10000)")],
            100_000
        )
        .is_err()
    );
    assert_eq!(book.to_json(), before);
}

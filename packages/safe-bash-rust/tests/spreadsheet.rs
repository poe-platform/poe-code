use safe_bash_rust::commands::spreadsheet::Spreadsheet;

#[test]
fn public_workbook_api_recalculates_after_json_and_excel_reopening() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "2"),
            (0, 1, 0, "3"),
            (0, 0, 1, "=SUM(A1:A2)"),
            (0, 0, 2, "=SEQUENCE(3)"),
            (0, 0, 3, "=GAMMA(0)"),
        ],
        1_000_000,
    )
    .unwrap();
    for mut reopened in [
        Spreadsheet::from_json(&book.to_json(), 1_000_000).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(1_000_000).unwrap(), 1_000_000).unwrap(),
    ] {
        assert_eq!(reopened.display(0, 0, 1, 1_000_000).unwrap(), "5");
        assert_eq!(reopened.display(0, 2, 2, 1_000_000).unwrap(), "3");
        assert_eq!(reopened.display(0, 0, 3, 1_000_000).unwrap(), "#NUM!");
        reopened.edit(&[(0, 0, 0, "7")], 1_000_000).unwrap();
        assert_eq!(reopened.display(0, 0, 1, 1_000_000).unwrap(), "10");
    }
}

#[test]
fn rejected_public_edit_batches_preserve_the_saved_workbook() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "2"), (0, 0, 1, "=A1*3")], 1_000_000)
        .unwrap();
    let saved = book.to_json();
    assert!(
        book.edit(&[(0, 0, 0, "99"), (0, 0, 16_384, "1")], 1_000_000)
            .is_err()
    );
    assert_eq!(book.to_json(), saved);
    assert_eq!(book.display(0, 0, 1, 1_000_000).unwrap(), "6");
}

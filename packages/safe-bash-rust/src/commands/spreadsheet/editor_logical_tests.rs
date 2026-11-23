// Cases from IronCalc test/logical/test_fn_not_array.rs and the information
// test_fn_is_type_arrays.rs / test_fn_type_array.rs tests at
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT, LICENSE.IronCalc).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn not_recognizes_logical_text_and_rejects_numeric_text() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=NOT(TRUE)", "FALSE"),
        ("=NOT(0)", "TRUE"),
        ("=NOT(B3)", "TRUE"),
        ("=NOT(\"false\")", "TRUE"),
        ("=NOT(\"TRUE\")", "FALSE"),
        ("=NOT(\"FaLsE\")", "TRUE"),
        ("=NOT(\"x\")", "#VALUE!"),
        ("=NOT(\" true\")", "#VALUE!"),
        ("=NOT(\"FALSE \" )", "#VALUE!"),
        // Excel's NOT.xlsx caches reject numeric text even in direct arguments.
        ("=NOT(\"0\")", "#VALUE!"),
        ("=NOT(\"2\")", "#VALUE!"),
        ("=NOT(-3)", "FALSE"),
        ("=NOT(1/0)", "#DIV/0!"),
        ("=NOT(#N/A)", "#N/A"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn not_maps_logical_text_and_errors_without_losing_typed_array_values() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=NOT({\"TRUE\",\"false\",\"x\",0,2,#N/A})"),
            (0, 2, 0, "=ISLOGICAL(A1:B1)"),
            (0, 4, 0, "=NOT({TRUE;FALSE})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, want) in [
        (0, 0, "FALSE"),
        (0, 1, "TRUE"),
        (0, 2, "#VALUE!"),
        (0, 3, "TRUE"),
        (0, 4, "FALSE"),
        (0, 5, "#N/A"),
        (2, 0, "TRUE"),
        (2, 1, "TRUE"),
        (4, 0, "FALSE"),
        (5, 0, "TRUE"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
    }
}

#[test]
fn not_reference_text_updates_after_json_and_excel_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "'FALSE"),
            (0, 1, 0, "'TRUE"),
            (0, 3, 0, "=1/0"),
            (0, 0, 2, "=NOT(A1:A4)"),
            (0, 0, 4, "=NOT(A1)"),
            (0, 1, 4, "=TYPE(C1)"),
            (0, 2, 4, "=ISNUMBER(C1)"),
            (0, 3, 4, "=ISLOGICAL(C1:C4)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, want) in [(0, "TRUE"), (1, "FALSE"), (2, "TRUE"), (3, "#DIV/0!")] {
            assert_eq!(restored.display(0, r, 2, LIMIT).unwrap(), want);
        }
        assert_eq!(restored.display(0, 0, 4, LIMIT).unwrap(), "TRUE");
        assert_eq!(restored.display(0, 1, 4, LIMIT).unwrap(), "4");
        assert_eq!(restored.display(0, 2, 4, LIMIT).unwrap(), "FALSE");
        for (r, want) in [(3, "TRUE"), (4, "TRUE"), (5, "TRUE"), (6, "FALSE")] {
            assert_eq!(restored.display(0, r, 4, LIMIT).unwrap(), want);
        }
        restored.edit(&[(0, 0, 0, "'true")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 0, 2, LIMIT).unwrap(), "FALSE");
        assert_eq!(restored.display(0, 0, 4, LIMIT).unwrap(), "FALSE");
    }
}

#[test]
fn editable_information_functions_use_value_types_instead_of_display_formats() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "1"),
            (0, 1, 0, "TRUE"),
            (0, 2, 0, "=NOT(FALSE)"),
            (0, 3, 0, "=1+1"),
        ],
        LIMIT,
    )
    .unwrap();
    book.sheets[0].cells.get_mut(&(0, 0)).unwrap().format = Some("BOOLEAN".into());
    for (formula, want) in [
        ("=ISNUMBER(TRUE)", "FALSE"),
        ("=ISNUMBER(A2)", "FALSE"),
        ("=ISNUMBER(A1)", "TRUE"),
        ("=ISLOGICAL(A1)", "FALSE"),
        ("=ISLOGICAL(A2)", "TRUE"),
        ("=ISLOGICAL(A3)", "TRUE"),
        ("=TYPE(TRUE)", "4"),
        ("=TYPE(A2)", "4"),
        ("=TYPE(A3)", "4"),
        ("=TYPE(A4)", "1"),
        ("=TYPE(\"true\")", "2"),
        ("=TYPE(1/0)", "16"),
        ("=TYPE(Z1)", "1"),
        ("=ISFORMULA(A3)", "TRUE"),
        ("=ISFORMULA(A2)", "FALSE"),
        ("=ISFORMULA(1)", "#VALUE!"),
    ] {
        book.edit(&[(0, 0, 3, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 3, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn type_reports_an_array_once_without_spilling_or_colliding_with_neighbors() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 1, 0, "occupied"), (0, 0, 1, "occupied")], LIMIT)
        .unwrap();
    for formula in [
        "=TYPE({1,2,3})",
        "=TYPE(SEQUENCE(3))",
        "=TYPE({1})",
        "=TYPE(B1:B3)",
        "=TYPE(NOT({TRUE,FALSE}))",
        // Inspect a sparse full-sheet reference without a dense allocation.
        "=TYPE(A1:XFD1048576)",
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "64", "{formula}");
        assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "occupied");
        assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "occupied");
    }
}

#[test]
fn ifs_and_switch_select_values_without_coercing_case_types() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=IFS(TRUE,7,FALSE,1/0)", "7"),
        ("=IFS(FALSE,1/0,TRUE,9)", "9"),
        ("=IFS(FALSE,1)", "#N/A"),
        ("=IFS(\"true\",3)", "3"),
        ("=IFS(\"1\",3)", "#VALUE!"),
        ("=IFS(TRUE,Z99)", "0"),
        ("=IFS(#REF!,7,TRUE,9)", "#REF!"),
        ("=IFS(TRUE,7,#REF!,9)", "7"),
        ("=IFS()", "#ERROR!"),
        ("=IFS(TRUE)", "#ERROR!"),
        ("=IFS(TRUE,7,FALSE)", "#ERROR!"),
        ("=SWITCH(2,1,\"one\",2,\"two\",\"other\")", "two"),
        ("=SWITCH(3,1,7)", "#N/A"),
        ("=SWITCH(3,1,7,99)", "99"),
        ("=SWITCH(\"TEXT\",\"text\",7)", "7"),
        ("=SWITCH(1,\"1\",7,9)", "9"),
        ("=SWITCH(TRUE,1,7,9)", "9"),
        ("=SWITCH(1,TRUE,7,9)", "9"),
        ("=SWITCH(1,1,Z99)", "0"),
        ("=SWITCH(2,1,1/0,2,7)", "7"),
        ("=SWITCH(1,1,7,#REF!,9)", "7"),
        ("=SWITCH(1,#REF!,7,9)", "#REF!"),
        ("=SWITCH(#N/A,1,7)", "#N/A"),
        ("=SWITCH()", "#ERROR!"),
        ("=SWITCH(1,1)", "#ERROR!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn ifs_and_switch_keep_arrays_and_dependencies_after_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "1"),
            (0, 1, 0, "2"),
            (0, 2, 0, "3"),
            (
                0,
                0,
                2,
                "=IFS(A1:A3=1,{\"one\",TRUE},A1:A3=2,{\"two\",FALSE},TRUE,{\"other\",#N/A})",
            ),
            (
                0,
                0,
                5,
                "=SWITCH(A1:A3,1,{\"one\",TRUE},2,{\"two\",FALSE},{\"other\",#N/A})",
            ),
        ],
        LIMIT,
    )
    .unwrap();
    let before = book.to_json();
    for mut restored in [
        Spreadsheet::from_json(&before, LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        book,
    ] {
        for column in [2, 5] {
            for (row, offset, want) in [
                (0, 0, "one"),
                (0, 1, "TRUE"),
                (1, 0, "two"),
                (1, 1, "FALSE"),
                (2, 0, "other"),
                (2, 1, "#N/A"),
            ] {
                assert_eq!(
                    restored.display(0, row, column + offset, LIMIT).unwrap(),
                    want
                );
            }
        }
        restored.edit(&[(0, 0, 0, "2")], LIMIT).unwrap();
        for column in [2, 5] {
            assert_eq!(restored.display(0, 0, column, LIMIT).unwrap(), "two");
        }
    }
}

#[test]
fn ifs_and_switch_bound_arguments_and_broadcasts() {
    let mut book = Spreadsheet::new();
    let pairs = vec!["FALSE,1"; 126].join(",");
    let formula = format!("=IFS({pairs},TRUE,7)");
    book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "7");
    let cases = vec!["2,1"; 126].join(",");
    let formula = format!("=SWITCH(1,{cases},1,7)");
    book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "7");
    for formula in [
        format!("=IFERROR(IFS({pairs},TRUE,7,TRUE,8),99)"),
        format!("=IFERROR(SWITCH(1,{cases},1,7,8),99)"),
    ] {
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "99");
    }
    let before = book.to_json();
    for formula in ["=IFS(Z:Z,{1,2},TRUE,3)", "=SWITCH(Z:Z,1,{1,2},3)"] {
        assert!(book.edit(&[(0, 0, 0, formula)], 100_000).is_err());
        assert_eq!(book.to_json(), before);
    }
}

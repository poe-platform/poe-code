// Table-name cases adapted from DreamNum Co., Ltd.'s Univer (Apache-2.0),
// commit 4767b3b309467c283bbd52b725536ca73861e0fc. See LICENSE.Univer.
use crate::commands::spreadsheet::Spreadsheet;

// Aggregate coercion cases from IronCalc's test_fn_sum.rs,
// test_fn_average.rs and test_fn_product.rs (LICENSE.IronCalc).
// Cases from Univer countif/__tests__/index.spec.ts (LICENSE.Univer).
#[test]
fn conditional_criteria_preserve_typed_empty_strings_and_blank_references() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 5, "=\"\""), (0, 2, 5, "2")], 1_000_000)
        .unwrap();
    let cases = [
        (r#"=COUNTIF(F1:F3,"<>")"#, "2"),
        (r#"=COUNTIF(F1:F2,"*")"#, "1"),
        (r#"=COUNTIF(F1:F2,"<>*")"#, "1"),
        (r#"=COUNTIF(F1:F3,F2)"#, "0"),
        (r#"=SUM(COUNTIF(F1:F3,F1:F2))"#, "2"),
        (r#"=SUM(COUNTIF(F1:F3,{"";0}))"#, "2"),
        (r#"=COUNTIF(F1:F3,">")"#, "0"),
        (r#"=COUNTIF(F1:F3,">=")"#, "0"),
        (r#"=COUNTIF(F1:F3,"<")"#, "0"),
        (r#"=COUNTIF(F1:F3,"<=")"#, "0"),
        (r#"=COUNTIF(F1:F2,"<1 hour")"#, "1"),
    ];
    let edits: Vec<_> = cases
        .iter()
        .enumerate()
        .map(|(row, (formula, _))| (0, row, 0, *formula))
        .collect();
    book.edit(&edits, 1_000_000).unwrap();
    for (row, (formula, expected)) in cases.iter().enumerate() {
        assert_eq!(
            book.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "{formula}"
        );
    }
}

#[test]
fn conditional_aggregates_match_criteria_and_keep_errors_local() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 1, "5"),
            (0, 1, 1, "4"),
            (0, 2, 1, "15"),
            (0, 3, 1, "22"),
            (0, 4, 1, "=NA()"),
            (0, 0, 2, "Apples"),
            (0, 1, 2, "Bananas"),
            (0, 2, 2, "Almonds"),
            (0, 3, 2, "Yoni"),
            (0, 4, 2, "Mandarin"),
        ],
        10_000_000,
    )
    .unwrap();
    // Scalar cases from IronCalc test_fn_{averageifs,minifs,maxifs}.
    let cases = [
        (r#"=SUMIF(C1:C5,"a*",B1:B5)"#, "20"),
        (r#"=SUMIFS(B1:B5,C1:C5,"A*",B1:B5,">10")"#, "15"),
        (r#"=AVERAGEIF(C1:C5,"A*",B1:B5)"#, "10"),
        (r#"=AVERAGEIFS(B1:B5,C1:C5,"A*")"#, "10"),
        (r#"=MINIFS(B1:B5,C1:C5,"A*")"#, "5"),
        (r#"=MAXIFS(B1:B5,C1:C5,"A*")"#, "15"),
        (r#"=COUNTIFS(C1:C5,"A*",B1:B5,">10")"#, "1"),
        (r#"=COUNTIF(C1:C5,"A*")"#, "2"),
        (r#"=SUMIF(C1:C5,"M*",B1:B5)"#, "#N/A"),
        (r#"=SUMIF(C1:C5,"A*",B1)"#, "20"),
        (r#"=AVERAGEIF(C1:C5,"A*",B1)"#, "10"),
        (r#"=SUMIFS(B1:B4,C1:C5,"A*")"#, "#VALUE!"),
        (r#"=COUNTIFS(C1:C5,"A*",B1:B4,">10")"#, "#VALUE!"),
        (r#"=AVERAGEIFS(B1:B5,C1:C5,"missing")"#, "#DIV/0!"),
        (r#"=MINIFS(B1:B5,C1:C5,"missing")"#, "0"),
        (r#"=MAXIFS(B1:B5,C1:C5,"missing")"#, "0"),
        (r#"=SUM(SUMIF(C1:C5,{"Apples","Almonds"},B1:B5))"#, "20"),
        (r#"=SUMIF(B1:B4,">10")"#, "37"),
        (r#"=AVERAGEIF(B1:B4,">10")"#, "18.5"),
        (r##"=COUNTIF(B1:B5,"#N/A")"##, "1"),
        (r#"=SUMIF(C1:C5,"A*",B1048576)"#, "#REF!"),
        (r#"=SUMIF({1,2},">0")"#, "#VALUE!"),
        (r#"=SUM(SUMIFS(B1:B5,C1:C5,{"Apples","Almonds"}))"#, "20"),
    ];
    let edits: Vec<_> = cases
        .iter()
        .enumerate()
        .map(|(row, (formula, _))| (0, row, 0, *formula))
        .collect();
    book.edit(&edits, 10_000_000).unwrap();
    for (row, (formula, expected)) in cases.iter().enumerate() {
        assert_eq!(
            book.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "{formula}"
        );
    }
    let imported =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    for (row, (formula, expected)) in cases.iter().enumerate() {
        assert_eq!(
            imported.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "import {formula}"
        );
    }
}

#[test]
fn conditional_criteria_handle_blanks_types_dates_and_escaped_wildcards() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 1, "5"),
            (0, 1, 1, "'5"),
            (0, 2, 1, "TRUE"),
            (0, 3, 1, "'TRUE"),
            (0, 5, 1, "=\"\""),
            (0, 0, 2, "Star*"),
            (0, 1, 2, "Star?"),
            (0, 2, 2, "Äpfel"),
            (0, 3, 2, "line\nbreak"),
            (0, 0, 3, "=DATE(2023,7,30)"),
            (0, 1, 3, "=DATE(2023,8,1)"),
        ],
        10_000_000,
    )
    .unwrap();
    let cases = [
        (r#"=COUNTIF(B1:B6,5)"#, "2"),
        (r#"=COUNTIF(B1:B6,">4")"#, "1"),
        (r#"=COUNTIF(B1:B6,TRUE)"#, "1"),
        (r#"=COUNTIF(B1:B6,"TRUE")"#, "1"),
        (r#"=COUNTIF(B1:B6,"")"#, "2"),
        (r#"=COUNTIF(B1:B6,"<>")"#, "5"),
        (r#"=COUNTIF(C1:C4,"star~*")"#, "1"),
        (r#"=COUNTIF(C1:C4,"star~?")"#, "1"),
        (r#"=COUNTIF(C1:C4,"ä*")"#, "1"),
        (r#"=COUNTIF(C1:C4,"line*break")"#, "1"),
        (r#"=COUNTIF(D1:D2,"<7/31/2023")"#, "1"),
        (r#"=COUNTIF(C1:C4,"<=Star?")"#, "3"),
        (r#"=COUNTIF(C1:C4,">=Star?")"#, "2"),
    ];
    let edits: Vec<_> = cases
        .iter()
        .enumerate()
        .map(|(row, (formula, _))| (0, row, 0, *formula))
        .collect();
    book.edit(&edits, 10_000_000).unwrap();
    for (row, (formula, expected)) in cases.iter().enumerate() {
        assert_eq!(
            book.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "{formula}"
        );
    }
}

#[test]
fn conditional_aggregates_count_sparse_blank_ranges_without_materializing_them() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 1, "3"),
            (0, 999999, 1, "4"),
            (0, 2, 2, "9"),
            (0, 0, 3, "7"),
        ],
        1_000_000,
    )
    .unwrap();
    let cases = [
        (r#"=COUNTIF(B:B,"")"#, "1048574"),
        (r#"=COUNTIFS(B:B,"",C:C,"")"#, "1048573"),
        (r#"=SUMIF(B:B,">0")"#, "7"),
        (r#"=SUMIF(B:B,"",C:C)"#, "9"),
        (r#"=COUNTIF(B1:XFD1048576,"")"#, "17178820604"),
        (r#"=MINIFS(D:D,B:B,"3")"#, "7"),
        (r#"=MAXIFS(D:D,B:B,"4")"#, "0"),
    ];
    let edits: Vec<_> = cases
        .iter()
        .enumerate()
        .map(|(row, (formula, _))| (0, row, 0, *formula))
        .collect();
    book.edit(&edits, 1_000_000).unwrap();
    for (row, (formula, expected)) in cases.iter().enumerate() {
        assert_eq!(
            book.display(0, row, 0, 100_000).unwrap(),
            *expected,
            "{formula}"
        );
    }
}

#[test]
fn excel_aggregates_distinguish_references_from_direct_arguments() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 1, "1"),
            (0, 1, 1, "2"),
            (0, 2, 1, "3"),
            (0, 3, 1, "'2"),
            (0, 5, 1, "true"),
        ],
        10_000_000,
    )
    .unwrap();
    let cases = [
        ("=SUM(B1:B6)", "6"),
        ("=AVERAGE(B1:B6)", "2"),
        ("=AVERAGEA(B1:B6)", "1.4"),
        ("=PRODUCT(B1:B6)", "6"),
        ("=MIN(B6)", "0"),
        ("=MAX(B6)", "0"),
        ("=SUM(\"1\",\"1e2\",TRUE)", "102"),
        ("=PRODUCT(\"2\",\"3\")", "6"),
        ("=SUMSQ(B1:B6)", "14"),
        ("=MINA(B1:B6)", "0"),
        ("=MAXA(B1:B6)", "3"),
        ("=SUM(INDIRECT(\"B4\"))", "0"),
        ("=AVERAGE(B5)", "#DIV/0!"),
        ("=SUM(\"not a number\")", "#VALUE!"),
    ];
    for (row, (formula, _)) in cases.iter().enumerate() {
        book.edit(&[(0, row, 0, formula)], 10_000_000).unwrap();
    }
    for (row, (formula, expected)) in cases.iter().enumerate() {
        assert_eq!(
            book.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "{formula}"
        );
    }
    let imported =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    for (row, (formula, expected)) in cases.iter().enumerate() {
        assert_eq!(
            imported.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "import {formula}"
        );
        assert!(!imported.input(0, row, 0).contains(".XLSX"));
    }
}

#[test]
fn editing_a_covered_merged_cell_rejects_the_entire_batch() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "heading")], 1_000_000).unwrap();
    book.sheets[0].merges.push([0, 0, 3, 2]);
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 0, "changed"), (0, 1, 2, "covered")], 1_000_000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
    book.edit(&[(0, 0, 0, "updated")], 1_000_000).unwrap();
    assert_eq!(book.input(0, 0, 0), "updated");
}

#[test]
fn sheet_reference_mapping_tracks_bindings_and_renames_simultaneously() {
    use crate::commands::spreadsheet::map_sheet_references;
    let mapping = [
        ("One", Some("Two")),
        ("Two", Some("One")),
        ("Unused", Some("Renamed")),
    ];
    let (formula, bindings) = map_sheet_references(
        "One!A1+Two!B2+SUM(One!C:C)+\"Two!D4\"",
        &mapping,
        &mut 1_000_000,
    )
    .unwrap();
    assert_eq!(formula, "Two!A1+One!B2+SUM(Two!C:C)+\"Two!D4\"");
    assert_eq!(bindings, vec![0, 1]);
    let source = "'One'!Local+SUM('One'!A:A)";
    assert_eq!(
        map_sheet_references(source, &[("One", Some("One"))], &mut 1_000_000)
            .unwrap()
            .0,
        source
    );
    let (formula, bindings) = map_sheet_references(
        "SUM(One:Two!A1)+[Other.xlsx]One!A1+Table[Two]",
        &mapping,
        &mut 1_000_000,
    )
    .unwrap();
    assert_eq!(formula, "SUM(Two:One!A1)+[Other.xlsx]One!A1+Table[Two]");
    assert_eq!(bindings, vec![0, 1]);
    assert!(map_sheet_references("One!A1", &mapping, &mut 1).is_none());
}

#[test]
fn sheet_reference_mapping_never_binds_error_literals_as_sheet_names() {
    let source = "IFERROR(#DIV/0!,#REF!)+#SPILL!";
    let mapping = [
        ("0", Some("Zero")),
        ("REF", Some("References")),
        ("SPILL", Some("Spilled")),
    ];
    let (formula, bindings) =
        super::map_sheet_references(source, &mapping, &mut 1_000_000).unwrap();
    assert_eq!(formula, source);
    assert!(bindings.is_empty());
}

#[test]
fn sheet_name_validation_uses_the_formula_parsers_unicode_comparison() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Σ").unwrap();
    assert!(book.add_sheet("ς").is_err());
    book.add_sheet("Other").unwrap();
    assert!(book.rename_sheet(2, "σ", 10_000_000).is_err());
    book.sheets[2].name = "ς".into();
    assert!(Spreadsheet::from_json(&book.to_json(), 10_000_000).is_err());
}

fn change_sheet(
    source: &str,
    sheets: &[String],
    changed: usize,
    replacement: Option<&str>,
    work: &mut usize,
) -> Option<String> {
    super::map_sheet_references(
        source,
        &sheets
            .iter()
            .enumerate()
            .map(|(i, name)| {
                (
                    name.as_str(),
                    if i == changed {
                        replacement
                    } else {
                        Some(name.as_str())
                    },
                )
            })
            .collect::<Vec<_>>(),
        work,
    )
    .map(|(formula, _)| formula)
}

// Missing-sheet cases extend IronCalc test_sheets.rs (MIT, LICENSE.IronCalc).
#[test]
fn missing_sheet_references_keep_reference_errors_distinct_from_unknown_names() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=Missing!A1", "#REF!"),
        ("=SUM(Missing!A1:C3)", "#REF!"),
        ("=SUM(Sheet1!A1:Missing!A2)", "#REF!"),
        ("=SUM(Sheet1!A1 : Missing!A2)", "#REF!"),
        ("=SUM(A1:Missing!A2)", "#REF!"),
        ("=SUM(Sheet1!A1:'O''Brien'!A2)", "#REF!"),
        ("=SUM(Missing!A1:Sheet1!A2)", "#REF!"),
        ("=SUM(Missing!A1 : Sheet1!A2)", "#REF!"),
        ("=SUM(Sheet1:Missing!A1)", "#REF!"),
        ("=SUM('Sheet1:Missing'!A1)", "#REF!"),
        ("=SUM(Missing!A:A)", "#REF!"),
        ("=SUM(Missing!1:3)", "#REF!"),
        ("='O''Brien'!$A$1", "#REF!"),
        ("=ERROR.TYPE(Missing!A1)", "4"),
        ("=IFERROR(Missing!A1,7)", "7"),
        ("=UnknownName", "#NAME?"),
        ("=Sheet1!UnknownName", "#NAME?"),
        ("=Missing!UnknownName", "#NAME?"),
        ("=Missing!A0", "#NAME?"),
        ("='[book.xlsx]Missing'!A1", "#NAME?"),
        ("=[book.xlsx]Missing!A1", "#NAME?"),
        ("=SUM('[book.xlsx]Missing'!A:A)", "#NAME?"),
        ("=SUM('[book.xlsx]Missing'!1:3)", "#NAME?"),
    ] {
        book.edit(&[(0, 5, 5, formula)], 10_000_000).unwrap();
        assert_eq!(
            book.display(0, 5, 5, 10_000_000).unwrap(),
            expected,
            "{formula}"
        );
        for mut restored in [
            Spreadsheet::from_json(&book.to_json(), 10_000_000).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap(),
        ] {
            restored.edit(&[], 10_000_000).unwrap();
            assert_eq!(
                restored.display(0, 5, 5, 10_000_000).unwrap(),
                expected,
                "reopened {formula}"
            );
        }
    }
}

#[test]
fn unresolved_sheet_ranges_do_not_bind_to_the_known_endpoint() {
    let source = "SUM(Sheet1!A1:Missing!A2)";
    let mapped = super::map_grid_references(
        source,
        &["Sheet1".into()],
        0,
        &mut 10_000_000,
        |reference, _| {
            assert!(
                reference.unresolved,
                "unresolved range must not acquire local grid identities"
            );
            Ok(None) // Even a deletion request must retain the unresolved source.
        },
    )
    .unwrap();
    assert_eq!(mapped, source);
    let (renamed, _) =
        super::map_sheet_references(source, &[("Sheet1", Some("Data"))], &mut 10_000_000).unwrap();
    assert_eq!(renamed, "SUM(Data!A1:Missing!A2)");
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "4"),
            (0, 1, 0, "6"),
            (0, 5, 5, &format!("={source}")),
        ],
        10_000_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 5, 5, 10_000_000).unwrap(), "#REF!");
    let copied = book
        .relocate_cell(
            &book.sheets[0].cells[&(5, 5)],
            (5, 5),
            (6, 5),
            0,
            10_000_000,
        )
        .unwrap();
    book.replace_cells(vec![(0, 6, 5, Some(copied))], 10_000_000)
        .unwrap();
    assert_eq!(book.display(0, 6, 5, 10_000_000).unwrap(), "#REF!");
    book.rename_sheet(0, "Data", 10_000_000).unwrap();
    for row in [5, 6] {
        assert_eq!(book.display(0, row, 5, 10_000_000).unwrap(), "#REF!");
        assert!(book.input(0, row, 5).contains("Missing!"));
    }
    book.add_sheet("Missing").unwrap();
    book.edit(&[(1, 0, 0, "2")], 10_000_000).unwrap();
    assert_eq!(book.display(0, 5, 5, 10_000_000).unwrap(), "12");
}

#[test]
fn missing_sheet_references_resolve_on_creation_and_stay_broken_after_deletion() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=Sheet2!C3"),
            (0, 1, 0, "=SUM(Sheet2!A1:C3)*Sheet3!A2"),
            (0, 2, 0, "=SUM(Sheet2!A:A)"),
            (0, 3, 0, "=SUM(Sheet2!1:3)"),
        ],
        10_000_000,
    )
    .unwrap();
    for row in 0..4 {
        assert_eq!(book.display(0, row, 0, 10_000_000).unwrap(), "#REF!");
    }
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), 10_000_000).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap(),
    ] {
        restored.add_sheet("Sheet2").unwrap();
        restored.edit(&[], 10_000_000).unwrap();
        assert_eq!(restored.display(0, 0, 0, 10_000_000).unwrap(), "0");
        assert_eq!(restored.display(0, 1, 0, 10_000_000).unwrap(), "#REF!");
        restored.add_sheet("Sheet3").unwrap();
        restored
            .edit(&[(1, 0, 0, "2"), (2, 1, 0, "42")], 10_000_000)
            .unwrap();
        for (row, expected) in [(0, "0"), (1, "84"), (2, "2"), (3, "2")] {
            assert_eq!(restored.display(0, row, 0, 10_000_000).unwrap(), expected);
        }
        restored.rename_sheet(1, "O'Brien", 10_000_000).unwrap();
        assert!(restored.input(0, 1, 0).contains("'O''Brien'!"));
        restored.delete_sheet(1, 10_000_000).unwrap();
        restored.add_sheet("O'Brien").unwrap();
        restored.edit(&[(2, 0, 0, "9")], 10_000_000).unwrap();
        for row in 0..4 {
            assert_eq!(restored.display(0, row, 0, 10_000_000).unwrap(), "#REF!");
        }
    }
}

// Adapted from IronCalc test_sheets.rs (MIT); includes its quoting and
// cross-sheet dependency cases, plus the editor's JSON/Excel roundtrip.
#[test]
fn sheet_rename_preserves_references_quoting_literals_and_roundtrips() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Sheet2").unwrap();
    book.edit(
        &[
            (1, 2, 1, "400"),
            (0, 0, 0, "=Sheet2!B3*2"),
            (0, 1, 0, "=SUM(Sheet2!B3:B4)"),
            (0, 2, 0, "=\"Sheet2!B3\""),
            (0, 3, 0, "=SUM(Sheet2!B:B)"),
        ],
        10_000_000,
    )
    .unwrap();
    book.rename_sheet(1, "New Sheet", 10_000_000).unwrap();
    assert_eq!(book.display(0, 0, 0, 10_000).unwrap(), "800");
    assert_eq!(book.input(0, 0, 0), "='New Sheet'!B3*2");
    assert_eq!(book.input(0, 1, 0), "=SUM('New Sheet'!B3:B4)");
    assert_eq!(book.display(0, 2, 0, 10_000).unwrap(), "Sheet2!B3");
    assert_eq!(book.display(0, 3, 0, 10_000).unwrap(), "400");
    let bytes = book.export_xlsx(10_000_000).unwrap();
    let mut book = Spreadsheet::import_xlsx(&bytes, 10_000_000).unwrap();
    book.rename_sheet(1, "O'Brien", 10_000_000).unwrap();
    book.edit(&[(1, 2, 1, "5")], 10_000_000).unwrap();
    assert_eq!(book.display(0, 0, 0, 10_000).unwrap(), "10");
    assert_eq!(book.input(0, 0, 0), "='O''Brien'!B3*2");
    let before = book.to_json();
    for name in [
        "Sheet1",
        "Invalid[]",
        "",
        "'bad",
        "longlonglonglonglonglonglonglonglong",
    ] {
        assert!(book.rename_sheet(1, name, 10_000_000).is_err());
        assert_eq!(book.to_json(), before);
    }
    assert!(book.rename_sheet(1, "Good", 1).is_err());
    assert_eq!(book.to_json(), before);
    book.rename_sheet(1, "o'brien", 10_000_000).unwrap();
    assert_eq!(book.sheets[1].name, "o'brien");
}

#[test]
fn sheet_delete_keeps_other_sheets_and_does_not_rebind_broken_references() {
    let mut book = Spreadsheet::new();
    assert!(book.delete_sheet(0, 10_000_000).is_err());
    book.add_sheet("Costs").unwrap();
    book.add_sheet("Other").unwrap();
    book.edit(
        &[
            (1, 0, 0, "7"),
            (2, 0, 0, "3"),
            (0, 0, 0, "=Costs!A1"),
            (0, 1, 0, "=Other!A1"),
            (0, 2, 0, "=SUM(Costs!A:A)"),
        ],
        10_000_000,
    )
    .unwrap();
    let before = book.to_json();
    assert!(book.delete_sheet(1, 1).is_err());
    assert_eq!(book.to_json(), before);
    book.delete_sheet(1, 10_000_000).unwrap();
    assert_eq!(book.sheets.len(), 2);
    assert_eq!(book.display(0, 0, 0, 10_000).unwrap(), "#REF!");
    assert_eq!(book.display(0, 1, 0, 10_000).unwrap(), "3");
    assert_eq!(book.display(0, 2, 0, 10_000).unwrap(), "#REF!");
    book.add_sheet("Costs").unwrap();
    book.edit(&[(2, 0, 0, "12")], 10_000_000).unwrap();
    assert_eq!(book.display(0, 0, 0, 10_000).unwrap(), "#REF!");
    let bytes = book.export_xlsx(10_000_000).unwrap();
    let restored = Spreadsheet::import_xlsx(&bytes, 10_000_000).unwrap();
    assert_eq!(restored.display(0, 0, 0, 10_000).unwrap(), "#REF!");
    assert_eq!(restored.display(0, 1, 0, 10_000).unwrap(), "3");
}

#[test]
fn imported_cross_sheet_formulas_are_editable_and_copy_with_excel_references() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Quarterly costs").unwrap();
    book.edit(
        &[
            (1, 0, 0, "8"),
            (1, 1, 0, "11"),
            (0, 0, 0, "='Quarterly costs'!A1*2"),
        ],
        10_000_000,
    )
    .unwrap();
    let mut book =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    assert_eq!(book.input(0, 0, 0), "='Quarterly costs'!A1*2");
    let copied = book
        .relocate_cell(
            &book.sheets[0].cells[&(0, 0)],
            (0, 0),
            (1, 0),
            0,
            10_000_000,
        )
        .unwrap();
    book.replace_cells(vec![(0, 1, 0, Some(copied))], 10_000_000)
        .unwrap();
    assert_eq!(book.display(0, 1, 0, 10_000).unwrap(), "22");
    let text = book.input(0, 0, 0);
    book.edit(&[(0, 0, 0, &text)], 10_000_000).unwrap();
    assert_eq!(book.display(0, 0, 0, 10_000).unwrap(), "16");
}

#[test]
fn sheet_reference_changes_preserve_literals_tables_external_links_and_spans() {
    let sheets = vec!["Sheet1".to_owned(), "Costs".to_owned(), "Last".to_owned()];
    let cases = [
        ("Costs!A1+Costs!$B$3", "'New Sheet'!A1+'New Sheet'!$B$3"),
        ("SUM(Costs!A:A)", "SUM('New Sheet'!A:A)"),
        ("Costs!Local", "'New Sheet'!Local"),
        (
            "\"Costs!A1\"&\"say \"\"Costs\"\"\"",
            "\"Costs!A1\"&\"say \"\"Costs\"\"\"",
        ),
        (
            "[Book.xlsx]Costs!A1+'[Other.xlsx]Costs'!A1",
            "[Book.xlsx]Costs!A1+'[Other.xlsx]Costs'!A1",
        ),
        ("Table[[Costs!A1],[Costs]]", "Table[[Costs!A1],[Costs]]"),
        ("SUM('Sheet1:Costs'!A1)", "SUM('Sheet1:New Sheet'!A1)"),
    ];
    for (source, expected) in cases {
        assert_eq!(
            change_sheet(source, &sheets, 1, Some("New Sheet"), &mut 1_000_000).unwrap(),
            expected
        );
    }
    assert_eq!(
        change_sheet("SUM(Sheet1:Last!A1)", &sheets, 1, None, &mut 1_000_000).unwrap(),
        "SUM(Sheet1:Last!A1)"
    );
    assert_eq!(
        change_sheet("SUM(Costs:Last!A1)", &sheets, 1, None, &mut 1_000_000).unwrap(),
        "SUM(Last!A1)"
    );
}

#[test]
fn sheet_changes_update_named_expressions_arrays_and_table_indices() {
    use super::model::{ArrayFormula, NamedExpression, Table};
    let mut book = Spreadsheet::new();
    book.add_sheet("Costs").unwrap();
    book.add_sheet("Other").unwrap();
    book.options.names.push(NamedExpression {
        name: "Amount".into(),
        sheet: None,
        expression: "Costs!A1".into(),
        openformula: Some("msoxl:=Costs!A1".into()),
        position: (0, 0, 0),
        compiled: None,
    });
    book.options.names.push(NamedExpression {
        name: "Local".into(),
        sheet: Some(2),
        expression: "Other!A1".into(),
        openformula: Some("msoxl:=Other!A1".into()),
        position: (2, 0, 0),
        compiled: None,
    });
    book.options.tables.push(Table {
        calculated_columns: Default::default(),
        columns: Vec::new(),
        totals: false,
        name: "CostTable".into(),
        sheet: 1,
        area: [0, 0, 1, 1],
        header: true,
        filter: None,
    });
    book.options.tables.push(Table {
        calculated_columns: Default::default(),
        columns: Vec::new(),
        totals: false,
        name: "OtherTable".into(),
        sheet: 2,
        area: [0, 0, 1, 1],
        header: true,
        filter: None,
    });
    book.edit(
        &[
            (1, 0, 0, "5"),
            (2, 0, 0, "9"),
            (0, 0, 0, "=Amount*2"),
            (0, 2, 0, "=Costs!A1"),
        ],
        10_000_000,
    )
    .unwrap();
    book.sheets[0].arrays.push(ArrayFormula {
        range: [2, 0, 1, 1],
        expression: "Costs!A1".into(),
        openformula: Some("msoxl:=Costs!A1".into()),
        formula_display: None,
    });
    book.rename_sheet(1, "New Costs", 10_000_000).unwrap();
    assert_eq!(book.display(0, 0, 0, 10_000).unwrap(), "10");
    assert_eq!(book.options.names[0].expression, "'New Costs'!A1");
    assert_eq!(book.sheets[0].arrays[0].expression, "'New Costs'!A1");
    book.delete_sheet(1, 10_000_000).unwrap();
    assert_eq!(book.display(0, 0, 0, 10_000).unwrap(), "#REF!");
    assert_eq!(book.sheets[0].arrays[0].expression, "#REF!");
    assert_eq!(book.options.names[1].sheet, Some(1));
    assert_eq!(book.options.names[1].position.0, 1);
    assert_eq!(book.options.tables.len(), 1);
    assert_eq!(book.options.tables[0].sheet, 1);
    let restored = Spreadsheet::from_json(&book.to_json(), 10_000_000).unwrap();
    assert_eq!(restored.options.names[1].sheet, Some(1));
}

#[test]
fn imported_shared_and_array_formulas_keep_their_origins_when_edited() {
    let entries: &[(&str, &[u8])] = &[
        ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
        ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/><sheet name="Data" sheetId="2" r:id="rId2"/></sheets></workbook>"#),
        ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>"#),
        ("xl/worksheets/sheet1.xml", br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f t="shared" ref="A1:A2" si="0">Data!A1*2</f><v>8</v></c><c r="C1"><f t="array" ref="C1:C2">Data!A1:A2*3</f><v>12</v></c></row><row r="2"><c r="A2"><f t="shared" si="0"/><v>18</v></c><c r="C2"><v>27</v></c></row></sheetData></worksheet>"#),
        ("xl/worksheets/sheet2.xml", br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>4</v></c></row><row r="2"><c r="A2"><v>9</v></c></row></sheetData></worksheet>"#),
    ];
    let mut book =
        Spreadsheet::import_xlsx(&office_package_rust::write_zip_stored(entries), 10_000_000)
            .unwrap();
    assert_eq!(book.input(0, 1, 0), "=Data!A2*2");
    assert!(book.options.formula_origins.is_empty());
    book.edit(&[(1, 1, 0, "7")], 10_000_000).unwrap();
    assert_eq!(book.display(0, 0, 0, 10_000).unwrap(), "8");
    assert_eq!(book.display(0, 1, 0, 10_000).unwrap(), "14");
    assert_eq!(book.display(0, 0, 2, 10_000).unwrap(), "12");
    assert_eq!(book.display(0, 1, 2, 10_000).unwrap(), "21");
    book.rename_sheet(1, "Inputs", 10_000_000).unwrap();
    book.edit(&[(1, 1, 0, "8")], 10_000_000).unwrap();
    assert_eq!(book.display(0, 1, 0, 10_000).unwrap(), "16");
    assert_eq!(book.display(0, 1, 2, 10_000).unwrap(), "24");
}

#[test]
fn imported_array_after_an_ordinary_formula_materializes_the_group_origin() {
    let entries: &[(&str, &[u8])] = &[
        ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
        ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
        ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
        ("xl/worksheets/sheet1.xml", br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>2</v></c><c r="C1"><f>A1*2</f><v>4</v></c></row><row r="2"><c r="A2"><v>3</v></c><c r="C2"><f t="array" ref="C2">A2*2</f><v>6</v></c></row></sheetData></worksheet>"#),
    ];
    let mut book =
        Spreadsheet::import_xlsx(&office_package_rust::write_zip_stored(entries), 10_000_000)
            .unwrap();
    assert_eq!(book.display(0, 0, 2, 10_000).unwrap(), "4");
    assert_eq!(book.display(0, 1, 2, 10_000).unwrap(), "6");
    assert!(
        book.options.formula_origins.is_empty(),
        "{:?}",
        book.options.formula_origins
    );
    assert_eq!(book.sheets[0].arrays[0].expression, "A2*2");
    book.edit_axis(0, false, 1, 1, 10_000_000).unwrap();
    assert_eq!(book.display(0, 2, 2, 10_000).unwrap(), "6");
    assert_eq!(book.sheets[0].arrays[0].expression, "A3*2");
}

#[test]
fn materializing_legacy_arrays_uses_the_array_source_for_its_anchor_cell() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 1, 0, "3"), (0, 1, 2, "=A2*2")], 10_000_000)
        .unwrap();
    book.sheets[0].arrays.push(super::model::ArrayFormula {
        range: [1, 2, 1, 1],
        expression: "A1*2".into(),
        openformula: Some("msoxl:=A1*2".into()),
        formula_display: None,
    });
    book.options.formula_origins.insert((0, 1, 2), (0, 0, 2));
    let book = book.materialize_formulas(10_000_000).unwrap();
    assert_eq!(book.input(0, 1, 2), "=A2*2");
    assert_eq!(book.sheets[0].arrays[0].expression, "A2*2");
    assert_eq!(book.display(0, 1, 2, 10_000).unwrap(), "6");
    assert!(book.options.formula_origins.is_empty());
    assert!(
        Spreadsheet::from_json(&book.to_json(), 10_000_000)
            .unwrap()
            .materialize_formulas(1)
            .is_err()
    );
    assert_eq!(
        book.to_json(),
        Spreadsheet::from_json(&book.to_json(), 10_000_000)
            .unwrap()
            .materialize_formulas(10_000_000)
            .unwrap()
            .to_json()
    );
}

#[test]
fn batches_recalculate_dependencies_and_cross_sheet_references() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Costs").unwrap();
    book.edit(
        &[
            (0, 0, 0, "2"),
            (0, 1, 0, "3"),
            (1, 0, 0, "7"),
            (0, 0, 1, "=SUM(A1:A2)*Costs!A1"),
        ],
        10_000_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 1, 10_000).unwrap(), "35");
    book.edit(&[(0, 1, 0, "4")], 10_000_000).unwrap();
    assert_eq!(book.display(0, 0, 1, 10_000).unwrap(), "42");
}

#[test]
fn xlsx_numeric_storage_and_formula_caches_retain_full_precision() {
    use super::{Value, xml_attribute, xml_elements, xml_text};
    use crate::commands::structured::{read_office_archive, xml};
    let inputs = [
        "10000000000000000",
        "10000000000000002",
        "10000000000000004",
        "0.12345678901234567",
        "-0",
        "=1/3",
        "=1.2345678901234567E-100",
        "1.7976931348623157e308",
        "5e-324",
    ];
    let mut book = Spreadsheet::new();
    let edits: Vec<_> = inputs
        .iter()
        .enumerate()
        .map(|(row, text)| (0, row, 0, *text))
        .collect();
    book.edit(&edits, 10_000_000).unwrap();
    book.edit(&[(0, inputs.len(), 0, "=FALSE()")], 10_000_000)
        .unwrap();
    let logical = book.sheets[0].cells.get_mut(&(inputs.len(), 0)).unwrap();
    logical.value = Some(Value::Number(-0.));
    logical.value_format = Some("BOOLEAN".into());
    let bytes = book.export_xlsx(10_000_000).unwrap();
    let reexported = super::xlsx_import::export_xlsx(&bytes, 10_000_000).unwrap();
    for bytes in [&bytes, &reexported] {
        let parts = read_office_archive(&bytes);
        let source = String::from_utf8(parts["xl/worksheets/sheet1.xml"].clone()).unwrap();
        let document = xml::parse(&source, None, None).unwrap();
        let restored = Spreadsheet::import_xlsx(&bytes, 10_000_000).unwrap();
        let logical = xml_elements(&document.nodes, "c")
            .into_iter()
            .find(|c| xml_attribute(c, "r") == Some(format!("A{}", inputs.len() + 1).as_str()))
            .unwrap();
        assert_eq!(xml_attribute(logical, "t"), Some("b"));
        assert_eq!(xml_text(xml_elements(&logical.children, "v")[0]), "0");
        for (row, input) in inputs.iter().enumerate() {
            let Some(Value::Number(expected)) = book.sheets[0].cells[&(row, 0)].value else {
                panic!("numeric input: {input}")
            };
            let cell = xml_elements(&document.nodes, "c")
                .into_iter()
                .find(|c| xml_attribute(c, "r") == Some(format!("A{}", row + 1).as_str()))
                .unwrap();
            let cache = xml_elements(&cell.children, "v");
            assert_eq!(
                xml_text(cache[0]).parse::<f64>().unwrap().to_bits(),
                expected.to_bits(),
                "cache: {input}"
            );
            let Some(Value::Number(actual)) = restored.sheets[0].cells[&(row, 0)].value else {
                panic!("reopened numeric input: {input}")
            };
            assert_eq!(actual.to_bits(), expected.to_bits(), "reopened: {input}");
        }
    }
}

#[test]
fn xlsx_roundtrip_preserves_formulas_text_and_sparse_cells() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "'0012"),
            (0, 0, 1, "4"),
            (0, 0, 2, "=B1*2"),
            (0, 999999, 99, "last"),
        ],
        10_000_000,
    )
    .unwrap();
    let bytes = book.export_xlsx(10_000_000).unwrap();
    let restored = Spreadsheet::import_xlsx(&bytes, 10_000_000).unwrap();
    assert_eq!(restored.display(0, 0, 0, 10_000).unwrap(), "0012");
    assert_eq!(restored.input(0, 0, 2), "=B1*2");
    assert_eq!(restored.display(0, 0, 2, 10_000).unwrap(), "8");
    assert_eq!(restored.display(0, 999999, 99, 10_000).unwrap(), "last");
    assert_eq!(restored.sheets[0].cells.len(), 4);
}

#[test]
fn failed_batches_do_not_apply_partial_edits() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "3"), (0, 0, 1, "=A1*2")], 10_000_000)
        .unwrap();
    assert!(
        book.edit(&[(0, 0, 0, "9"), (0, 1048576, 0, "1")], 10_000_000)
            .is_err()
    );
    assert_eq!(book.display(0, 0, 0, 10_000).unwrap(), "3");
    assert!(book.edit(&[(0, 0, 0, "9")], 1).is_err());
    assert_eq!(book.display(0, 0, 0, 10_000).unwrap(), "3");
    assert_eq!(book.display(0, 0, 1, 10_000).unwrap(), "6");
}

#[test]
fn literals_and_formula_errors_are_visible() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "25%"),
            (0, 0, 1, "TRUE"),
            (0, 0, 2, "=1/0"),
            (0, 0, 3, "=NO_SUCH_FUNCTION(1)"),
        ],
        10_000_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, 10_000).unwrap(), "25%");
    assert_eq!(book.display(0, 0, 1, 10_000).unwrap(), "TRUE");
    assert_eq!(book.display(0, 0, 2, 10_000).unwrap(), "#DIV/0!");
    assert_eq!(book.display(0, 0, 3, 10_000).unwrap(), "#NAME?");
}

#[test]
fn json_is_text_and_preserves_typed_cells_and_formatting() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, "'0007"), (0, 0, 1, "12%"), (0, 0, 2, "=B1*2")],
        10_000_000,
    )
    .unwrap();
    book.sheets[0].cells.get_mut(&(0, 2)).unwrap().format = Some("0%".into());
    let json = book.to_json();
    let restored = Spreadsheet::from_json(&json, 10_000_000).unwrap();
    assert_eq!(restored.input(0, 0, 0), "'0007");
    assert_eq!(restored.display(0, 0, 1, 10_000).unwrap(), "12%");
    assert_eq!(restored.display(0, 0, 2, 10_000).unwrap(), "24%");
    assert_eq!(restored.to_json(), json);
}

#[test]
fn typed_cell_replacement_supports_undo_without_reinterpreting_text() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "'009"), (0, 0, 1, "=A1+1")], 10_000_000)
        .unwrap();
    let original = book.sheets[0].cells[&(0, 0)].to_json();
    book.edit(&[(0, 0, 0, "20")], 10_000_000).unwrap();
    let cell = crate::commands::spreadsheet::TypedCell::from_json(&original).unwrap();
    book.replace_cells(vec![(0, 0, 0, Some(cell))], 10_000_000)
        .unwrap();
    assert_eq!(book.input(0, 0, 0), "'009");
    assert_eq!(book.display(0, 0, 1, 10_000).unwrap(), "10");
}

#[test]
fn ironcalc_math_ports_cover_domains_and_composed_formulas() {
    let mut book = Spreadsheet::new();
    let cases = [
        ("=SIN(PI()/2)", "1"),
        ("=LN(EXP(1))", "1"),
        ("=COTH(1000)", "1"),
        ("=COT(0)", "#DIV/0!"),
        ("=ACOTH(1)", "#NUM!"),
        ("=LOG(1,1)", "#DIV/0!"),
        ("=POWER(-8,1/3)", "-2"),
        ("=QUOTIENT(-10,3)", "-3"),
        ("=FACTDOUBLE(-1)", "1"),
        ("=FACTDOUBLE(1e100)", "#NUM!"),
        ("=ODD(0)", "1"),
    ];
    let edits: Vec<_> = cases
        .iter()
        .enumerate()
        .map(|(r, (f, _))| (0, r, 0, *f))
        .collect();
    book.edit(&edits, 10_000_000).unwrap();
    for (r, (formula, expected)) in cases.iter().enumerate() {
        assert_eq!(
            book.display(0, r, 0, 100_000).unwrap(),
            *expected,
            "{formula}"
        );
    }
}

#[test]
fn excel_editor_import_retains_cell_appearance_dimensions_merges_and_tables() {
    use super::{Axis, Style, Table};
    use std::sync::Arc;
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "Heading"), (0, 1, 0, "42")], 10_000_000)
        .unwrap();
    book.sheets[0].cells.get_mut(&(0, 0)).unwrap().style = Some(Arc::new(Style {
        font: vec![("Bold", "1".into())],
        family: "Arial".into(),
        attributes: vec![
            ("Back", "FF0044AA".into()),
            ("Shade", "1".into()),
            ("HAlign", "center".into()),
        ],
        borders: vec![("Bottom", 1, "FFFF0000".into())],
    }));
    book.sheets[0].columns.insert(
        0,
        Axis {
            size: Some(120.),
            ..Default::default()
        },
    );
    book.sheets[0].rows.insert(
        1,
        Axis {
            size: Some(24.),
            hidden: true,
            ..Default::default()
        },
    );
    book.sheets[0].merges.push([3, 0, 2, 1]);
    book.options.tables.push(Table {
        calculated_columns: Default::default(),
        columns: Vec::new(),
        totals: false,
        name: "Data".into(),
        sheet: 0,
        area: [0, 0, 1, 0],
        header: true,
        filter: None,
    });
    let bytes = book.export_xlsx(10_000_000).unwrap();
    let restored = Spreadsheet::import_xlsx(&bytes, 10_000_000).unwrap();
    let sheet = &restored.sheets[0];
    let style = sheet.cells[&(0, 0)].style.as_ref().expect("imported style");
    assert!(style.font.contains(&("Bold", "1".into())));
    assert!(style.attributes.contains(&("Back", "FF0044AA".into())));
    assert!(style.attributes.contains(&("HAlign", "center".into())));
    assert_eq!(style.family, "Arial");
    assert!(style.borders.contains(&("Bottom", 1, "FFFF0000".into())));
    assert_eq!(sheet.rows[&1].size, Some(24.));
    assert!(sheet.rows[&1].hidden);
    assert!((sheet.columns[&0].size.unwrap() - 120.).abs() < 0.01);
    assert_eq!(sheet.merges, vec![[3, 0, 2, 1]]);
    assert_eq!(restored.options.tables[0].name, "Data");
}

#[test]
fn excel_empty_border_edges_are_compact_without_changing_style_inheritance() {
    use super::{Axis, ConditionalFormat, ConditionalRule, Style};
    use std::sync::Arc;
    const LIMIT: usize = 10_000_000;
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "1"), (0, 0, 1, "2")], LIMIT).unwrap();
    let empty = Style {
        borders: ["Left", "Right", "Top", "Bottom"]
            .into_iter()
            .map(|side| (side, 0, "FF000000".into()))
            .collect(),
        ..Default::default()
    };
    book.sheets[0].rows.insert(
        0,
        Axis {
            style: Some(Arc::new(Style {
                borders: vec![("Top", 1, "FF336699".into())],
                ..Default::default()
            })),
            ..Default::default()
        },
    );
    book.sheets[0].cells.get_mut(&(0, 0)).unwrap().style = Some(Arc::new(empty.clone()));
    book.sheets[0].cells.get_mut(&(0, 1)).unwrap().style = Some(Arc::new(Style {
        borders: vec![
            ("Left", 0, "FFFF0000".into()),
            ("Right", 2, "FF0000FF".into()),
        ],
        ..Default::default()
    }));
    book.set_conditional_formats(
        vec![ConditionalFormat {
            sheet: 0,
            ranges: vec![[0, 0, 0, 0]],
            priority: 1,
            stop_if_true: false,
            rule: ConditionalRule::Formula("TRUE".into()),
            style: empty,
            format: None,
        }],
        LIMIT,
    )
    .unwrap();
    for _ in 0..2 {
        book = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        // A complete empty cell style still overrides the row's visible border.
        assert!(book.sheets[0].cells[&(0, 0)].style.is_some());
        assert!(book.cell_style(0, 0, 0).unwrap().borders.is_empty());
        assert_eq!(
            book.cell_style(0, 0, 2).unwrap().borders,
            vec![("Top", 1, "FF336699".into())]
        );
        assert_eq!(
            book.cell_style(0, 0, 1).unwrap().borders,
            vec![
                ("Left", 0, "FFFF0000".into()),
                ("Right", 2, "FF0000FF".into())
            ]
        );
        // Differential styles merge with existing appearance, so explicit
        // removal of a border must remain present even when its color is black.
        assert_eq!(book.options.conditional_formats[0].style.borders.len(), 4);
        assert!(
            book.options.conditional_formats[0]
                .style
                .borders
                .iter()
                .all(|(_, line, _)| *line == 0)
        );
        book = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    }
}

#[test]
fn input_quotes_only_text_that_would_be_reinterpreted() {
    let mut book = Spreadsheet::new();
    let cases = [
        ("hello", "hello"),
        ("'0012", "'0012"),
        ("'=SUM(A1:A2)", "'=SUM(A1:A2)"),
        ("'TRUE", "'TRUE"),
        ("'25%", "'25%"),
        ("'2026-11-21", "'2026-11-21"),
        ("''quoted", "''quoted"),
        ("'", "'"),
        ("' 12 ", "' 12 "),
        ("'text with spaces", "text with spaces"),
        ("=1+2", "=1+2"),
    ];
    for (i, (input, expected)) in cases.iter().enumerate() {
        book.edit(&[(0, i, 0, input)], 10_000_000).unwrap();
        assert_eq!(book.input(0, i, 0), *expected);
        let before = book.sheets[0].cells[&(i, 0)].to_json();
        let text = book.input(0, i, 0);
        book.edit(&[(0, i, 0, &text)], 10_000_000).unwrap();
        assert_eq!(book.sheets[0].cells[&(i, 0)].to_json(), before);
    }
}

#[test]
fn copied_cells_rebase_relative_references_with_the_existing_formula_parser() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Other sheet").unwrap();
    book.edit(
        &[(
            0,
            9,
            10,
            "=SUM(A1,$B2,C$3,$D$4,'Other sheet'!A1,A:A,2:3)+LEN(\"A1\")",
        )],
        10_000_000,
    )
    .unwrap();
    let cell = book.sheets[0].cells.get(&(9, 10)).unwrap();
    let copied = book
        .relocate_cell(cell, (9, 10), (11, 13), 0, 10_000_000)
        .unwrap();
    assert_eq!(
        copied.formula.as_deref(),
        Some("SUM(D3,$B4,F$3,$D$4,'Other sheet'!D3,D:D,4:5)+LEN(\"A1\")")
    );
    assert!(copied.value.is_none());
    book.edit(&[(0, 1, 1, "=A1+$A$1")], 10_000_000).unwrap();
    let cell = book.sheets[0].cells.get(&(1, 1)).unwrap();
    let copied = book
        .relocate_cell(cell, (1, 1), (0, 0), 0, 10_000_000)
        .unwrap();
    assert_eq!(copied.formula.as_deref(), Some("#REF!+$A$1"));
    assert!(book.relocate_cell(cell, (1, 1), (0, 0), 0, 1).is_err());
}

#[test]
fn editing_an_imported_error_keeps_it_an_error_and_literal_error_text_can_be_quoted() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=1/0"), (0, 0, 1, "=ISERROR(A1)")], 10_000_000)
        .unwrap();
    book.sheets[0].cells.get_mut(&(0, 0)).unwrap().formula = None;
    let input = book.input(0, 0, 0);
    book.edit(&[(0, 0, 0, &input)], 10_000_000).unwrap();
    assert_eq!(book.display(0, 0, 1, 10_000).unwrap(), "TRUE");
    book.edit(&[(0, 0, 0, "'#DIV/0!")], 10_000_000).unwrap();
    assert_eq!(book.input(0, 0, 0), "'#DIV/0!");
    assert_eq!(book.display(0, 0, 1, 10_000).unwrap(), "FALSE");
}

// IronCalc mathematical.rs and test_floor.rs, revision f9366200 (MIT).
#[test]
fn rounding_functions_preserve_precision_signs_and_excel_roundtrips() {
    let cases = [
        ("=FLOOR(7.1,0.1)", "7.1"),
        ("=FLOOR(-2.5,-2)", "-2"),
        ("=FLOOR(-2.5,2)", "-4"),
        ("=FLOOR(2.5,-2)", "#NUM!"),
        ("=FLOOR(5,0)", "#DIV/0!"),
        ("=FLOOR(0,0)", "0"),
        ("=CEILING(4.5,0)", "0"),
        ("=CEILING(-2.5,-2)", "-4"),
        ("=CEILING.PRECISE(-2.5,-2)", "-2"),
        ("=CEILING.MATH(-2.5,2,1)", "-4"),
        ("=FLOOR.MATH(-2.5,2,1)", "-2"),
        ("=FLOOR.PRECISE(7.1,-0.1)", "7.1"),
        ("=ISO.CEILING(-2.5,-2)", "-2"),
        ("=FLOOR(1)", "Err:511"),
        ("=FLOOR(1,2,3)", "Err:504"),
    ];
    let mut book = Spreadsheet::new();
    let edits: Vec<_> = cases
        .iter()
        .enumerate()
        .map(|(r, (formula, _))| (0, r, 0, *formula))
        .collect();
    book.edit(&edits, 10_000_000).unwrap();
    for (r, (formula, expected)) in cases.iter().enumerate() {
        assert_eq!(
            book.display(0, r, 0, 100_000).unwrap(),
            *expected,
            "{formula}"
        );
    }
    let bytes = book.export_xlsx(10_000_000).unwrap();
    let mut restored = Spreadsheet::import_xlsx(&bytes, 10_000_000).unwrap();
    restored
        .edit(&[(0, 0, 1, "recalculate")], 10_000_000)
        .unwrap();
    for (r, (formula, expected)) in cases.iter().enumerate() {
        assert_eq!(
            restored.display(0, r, 0, 100_000).unwrap(),
            *expected,
            "roundtrip: {formula}"
        );
    }
}

#[test]
fn editor_formula_namespaces_do_not_change_display_strings_or_copied_references() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "-2.5"),
            (0, 0, 1, "=CEILING.MATH(A1,2,1)&\" FLOOR.MATH(A1)\""),
        ],
        10_000_000,
    )
    .unwrap();
    assert_eq!(
        book.input(0, 0, 1),
        "=CEILING.MATH(A1,2,1)&\" FLOOR.MATH(A1)\""
    );
    assert_eq!(book.display(0, 0, 1, 100_000).unwrap(), "-4 FLOOR.MATH(A1)");
    let copied = book
        .relocate_cell(&book.sheets[0].cells[&(0, 1)], (0, 1), (1, 1), 0, 100_000)
        .unwrap();
    book.replace_cells(vec![(0, 1, 1, Some(copied))], 10_000_000)
        .unwrap();
    book.edit(&[(0, 1, 0, "-4.5")], 10_000_000).unwrap();
    assert_eq!(
        book.input(0, 1, 1),
        "=CEILING.MATH(A2,2,1)&\" FLOOR.MATH(A1)\""
    );
    assert_eq!(book.display(0, 1, 1, 100_000).unwrap(), "-6 FLOOR.MATH(A1)");
    let restored = Spreadsheet::from_json(&book.to_json(), 10_000_000).unwrap();
    assert_eq!(restored.input(0, 1, 1), book.input(0, 1, 1));
}

#[test]
fn structured_table_references_use_columns_rows_and_cross_sheet_ranges() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Second Sheet").unwrap();
    book.edit(
        &[
            (0, 0, 0, "Jan"),
            (0, 0, 1, "Dec"),
            (0, 1, 0, "10"),
            (0, 1, 1, "20"),
            (0, 2, 0, "30"),
            (0, 2, 1, "40"),
        ],
        10_000_000,
    )
    .unwrap();
    book.add_table(0, "tblIncome", [0, 0, 2, 1], 10_000_000)
        .unwrap();
    // IronCalc parser/tests/test_tables.rs simple_table, adapted to evaluated
    // numeric values using the same structured-reference expressions.
    book.edit(
        &[
            (0, 1, 2, "=SUM(tblIncome[[#This Row],[Jan]:[Dec]])"),
            (1, 3, 0, "=SUBTOTAL(109,tblIncome[Jan])"),
            (1, 4, 0, "=SUM(tblIncome)"),
            (1, 5, 0, "=SUM(tblIncome[[#Data],[Jan]:[Dec]])"),
            (1, 6, 0, "=tblIncome[[#Headers],[Dec]]"),
            (1, 7, 0, "=SUM(tblIncome[#Totals])"),
            (0, 2, 1, "=[@Jan]*2"),
        ],
        10_000_000,
    )
    .unwrap();
    for (sheet, row, column, text) in [
        (0, 1, 2, "30"),
        (1, 3, 0, "40"),
        (1, 4, 0, "120"),
        (1, 5, 0, "120"),
        (1, 6, 0, "Dec"),
        (1, 7, 0, "#REF!"),
        (0, 2, 1, "60"),
    ] {
        assert_eq!(
            book.display(sheet, row, column, 1_000_000).unwrap(),
            text,
            "at {sheet}/{row}/{column}"
        );
    }
    let json = book.to_json();
    let roundtrip = Spreadsheet::from_json(&json, 10_000_000).unwrap();
    assert_eq!(roundtrip.to_json(), json);
    let bytes = book.export_xlsx(10_000_000).unwrap();
    let restored = Spreadsheet::import_xlsx(&bytes, 10_000_000).unwrap();
    assert_eq!(restored.display(1, 3, 0, 1_000_000).unwrap(), "40");
    assert_eq!(restored.input(0, 2, 1), "=[@Jan]*2");
}

#[test]
fn table_creation_validates_names_overlap_and_headers_transactionally() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, "Amount"), (0, 0, 1, "amount"), (0, 1, 0, "1")],
        10_000_000,
    )
    .unwrap();
    let before = book.to_json();
    // Univer table-name.spec.ts validation cases plus Excel reference names.
    for name in ["", "Sales Table", "1SalesTable", "A1", "R1C1", "r", "C"] {
        assert!(
            book.add_table(0, name, [0, 0, 2, 2], 10_000_000).is_err(),
            "{name}"
        );
        assert_eq!(book.to_json(), before);
    }
    assert!(book.add_table(0, "Sales", [0, 0, 2, 2], 1).is_err());
    assert_eq!(book.to_json(), before);
    book.add_table(0, "Sales", [0, 0, 2, 2], 10_000_000)
        .unwrap();
    assert_eq!(book.input(0, 0, 0), "Amount");
    assert_eq!(book.input(0, 0, 1), "amount2");
    assert_eq!(book.input(0, 0, 2), "Column3");
    let before = book.to_json();
    assert!(
        book.add_table(0, "sales", [5, 0, 7, 2], 10_000_000)
            .is_err()
    );
    assert!(
        book.add_table(0, "Other", [1, 2, 4, 5], 10_000_000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
}

#[test]
fn subtotals_ignore_nested_subtotals_and_respect_hidden_rows() {
    let mut book = Spreadsheet::new();
    book.sheets[0].rows.insert(
        1,
        super::Axis {
            hidden: true,
            ..Default::default()
        },
    );
    book.edit(
        &[
            (0, 0, 0, "2"),
            (0, 1, 0, "8"),
            (0, 2, 0, "4"),
            (0, 0, 1, "=SUBTOTAL(10,A1:A3)"),
            (0, 1, 1, "=SUBTOTAL(11,A1:A3)"),
            (0, 2, 1, "=SUBTOTAL(110,A1:A3)"),
            (0, 3, 1, "=SUBTOTAL(111,A1:A3)"),
            (0, 3, 0, "=SUBTOTAL(9,A1:A3)"),
            (0, 4, 0, "=SUBTOTAL(9,A1:A4)"),
            (0, 5, 0, "=SUBTOTAL(109,A1:A4)"),
            (0, 6, 0, "=SUBTOTAL(6,C1:C2)"),
            (0, 7, 0, "=SUBTOTAL(12,A1:A3)"),
        ],
        10_000_000,
    )
    .unwrap();
    for (row, col, expected) in [
        (2, 1, "2"),
        (3, 1, "1"),
        (3, 0, "14"),
        (4, 0, "14"),
        (5, 0, "6"),
        (6, 0, "0"),
        (7, 0, "#VALUE!"),
    ] {
        assert_eq!(book.display(0, row, col, 1_000_000).unwrap(), expected);
    }
    let number = |r, c| match book.sheets[0].cells[&(r, c)].value {
        Some(super::Value::Number(n)) => n,
        _ => panic!("Expected a number"),
    };
    assert!((number(0, 1) - 9.333333333333334).abs() < 1e-12);
    assert!((number(1, 1) - 6.222222222222222).abs() < 1e-12);
}

#[test]
fn structured_table_references_escape_headers_and_reject_invalid_sections() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "#Amount"),
            (0, 0, 1, "End]Month"),
            (0, 1, 0, "7"),
            (0, 1, 1, "9"),
            (0, 2, 0, "3"),
        ],
        10_000_000,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 0, 2, 1], 10_000_000)
        .unwrap();
    book.edit(
        &[
            (0, 4, 0, "=SUM(Sales['#Amount])"),
            (0, 5, 0, "=SUM(Sales[End']Month])"),
            (0, 6, 0, "=SUM(sales[[#Data],['#Amount]:[End']Month]])"),
            (0, 7, 0, "=Sales[#This Row]"),
            (0, 8, 0, "=SUM(Sales[Missing])"),
            (0, 9, 0, "=SUM(Missing[Amount])"),
            (0, 10, 0, "=SUM(Sales[[#Headers],[#Totals]])"),
        ],
        10_000_000,
    )
    .unwrap();
    for (row, expected) in [
        (4, "10"),
        (5, "9"),
        (6, "19"),
        (7, "#REF!"),
        (8, "#REF!"),
        (9, "#NAME?"),
        (10, "#REF!"),
    ] {
        assert_eq!(
            book.display(0, row, 0, 1_000_000).unwrap(),
            expected,
            "row {row}"
        );
    }
    book.options.tables[0].totals = true;
    book.edit(
        &[
            (0, 11, 0, "=SUM(Sales[#All])"),
            (0, 12, 0, "=SUM(Sales[#Data])"),
            (0, 13, 0, "=SUM(Sales[#Totals])"),
        ],
        10_000_000,
    )
    .unwrap();
    for (row, expected) in [(11, "19"), (12, "16"), (13, "3")] {
        assert_eq!(book.display(0, row, 0, 1_000_000).unwrap(), expected);
    }
    let restored =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    assert_eq!(restored.display(0, 13, 0, 1_000_000).unwrap(), "3");
}

#[test]
fn editing_table_headers_rewrites_only_bound_structured_references() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Amount"),
            (0, 0, 1, "Tax"),
            (0, 1, 0, "7"),
            (0, 1, 1, "2"),
        ],
        10_000_000,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 0, 2, 1], 10_000_000)
        .unwrap();
    book.edit(
        &[
            (0, 2, 0, "=[@Tax]*3"),
            (0, 2, 1, "4"),
            (0, 4, 0, "=SUM(Sales[Amount])"),
            (0, 5, 0, "=\"Sales[Amount]\""),
        ],
        10_000_000,
    )
    .unwrap();
    book.edit(&[(0, 0, 0, "Total] paid"), (0, 0, 1, "Rate")], 10_000_000)
        .unwrap();
    assert_eq!(book.input(0, 4, 0), "=SUM(Sales[Total'] paid])");
    assert_eq!(book.input(0, 2, 0), "=[@Rate]*3");
    assert_eq!(book.input(0, 5, 0), "=\"Sales[Amount]\"");
    assert_eq!(book.display(0, 4, 0, 1_000_000).unwrap(), "19");
    let before = book.to_json();
    assert!(book.edit(&[(0, 0, 0, "Too small budget")], 1).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn table_headers_remain_text_and_malformed_columns_do_not_load() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "Amount"), (0, 1, 0, "7")], 10_000_000)
        .unwrap();
    book.add_table(0, "Sales", [0, 0, 2, 0], 10_000_000)
        .unwrap();
    book.edit(&[(0, 0, 0, "=1+2")], 10_000_000).unwrap();
    assert_eq!(book.display(0, 0, 0, 1_000_000).unwrap(), "=1+2");
    assert!(book.sheets[0].cells[&(0, 0)].formula.is_none());
    book.options.tables[0].columns.push("Extra".into());
    assert!(Spreadsheet::from_json(&book.to_json(), 10_000_000).is_err());
}

#[test]
fn imported_filters_preserve_subtotal_visibility_and_criteria() {
    use super::model::{Axis, Filter, FilterField};
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 1, "Region"),
            (0, 0, 2, "Amount"),
            (0, 1, 1, "Spain"),
            (0, 1, 2, "2"),
            (0, 2, 1, "France"),
            (0, 2, 2, "8"),
            (0, 3, 1, "Spain"),
            (0, 3, 2, "4"),
            (0, 4, 2, "16"),
            (0, 6, 2, "=SUBTOTAL(9,C2:C5)"),
            (0, 7, 2, "=SUBTOTAL(109,C2:C5)"),
        ],
        10_000_000,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 1, 3, 2], 10_000_000)
        .unwrap();
    book.options.tables[0].filter = Some(Filter {
        column_visibility: false,
        area: [0, 1, 3, 2],
        show_buttons: true,
        fields: Some(
            [(
                0,
                FilterField {
                    dynamic: None,
                    date_groups: Vec::new(),
                    top: None,
                    hidden_rows: None,
                    custom: false,
                    conditions: vec![("equal", "Spain".into())],
                    conjunction: false,
                },
            )]
            .into(),
        ),
    });
    for row in [2, 4] {
        book.sheets[0].rows.insert(
            row,
            Axis {
                hidden: true,
                ..Default::default()
            },
        );
    }
    book.spills =
        super::formulas::cache(&mut book.sheets, &book.options, None, 10_000_000, true).unwrap();
    assert_eq!(book.display(0, 6, 2, 1_000_000).unwrap(), "22");
    assert_eq!(book.display(0, 7, 2, 1_000_000).unwrap(), "6");
    let bytes = book.export_xlsx(10_000_000).unwrap();
    let mut restored = Spreadsheet::import_xlsx(&bytes, 10_000_000).unwrap();
    let filter = restored.options.tables[0].filter.as_ref().unwrap();
    assert_eq!(filter.area, [0, 1, 3, 2]);
    assert!(filter.show_buttons);
    assert_eq!(
        filter.fields.as_ref().unwrap()[&0].conditions,
        vec![("equal", "Spain".into())]
    );
    assert_eq!(restored.display(0, 6, 2, 1_000_000).unwrap(), "22");
    // Excel filters retain row visibility until explicitly reapplied.
    restored.edit(&[(0, 2, 1, "Spain")], 10_000_000).unwrap();
    assert_eq!(restored.display(0, 6, 2, 1_000_000).unwrap(), "22");
    restored.options.tables.clear();
    restored.sheets[0].filter = Some(Filter {
        column_visibility: false,
        area: [0, 1, 3, 2],
        show_buttons: true,
        fields: Some(
            [(
                1,
                FilterField {
                    dynamic: None,
                    date_groups: Vec::new(),
                    top: None,
                    hidden_rows: None,
                    custom: false,
                    conditions: vec![("greaterThan", "1".into()), ("lessThanOrEqual", "4".into())],
                    conjunction: true,
                },
            )]
            .into(),
        ),
    });
    let bytes = restored.export_xlsx(10_000_000).unwrap();
    let restored = Spreadsheet::import_xlsx(&bytes, 10_000_000).unwrap();
    assert_eq!(restored.display(0, 6, 2, 1_000_000).unwrap(), "22");
    assert_eq!(
        restored.sheets[0]
            .filter
            .as_ref()
            .unwrap()
            .fields
            .as_ref()
            .unwrap()[&1]
            .conditions
            .len(),
        2
    );
}

#[test]
fn excel_count_excludes_reference_booleans_and_concat_flattens_in_row_order() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "TRUE"),
            (0, 0, 1, "hello"),
            (0, 1, 0, "7"),
            (0, 1, 1, "world"),
            (0, 2, 0, "'8"),
            (0, 0, 3, "=COUNT(A1:A3)"),
            (0, 1, 3, "=COUNT(TRUE,\"8\",A1,A2,A3)"),
            (0, 2, 3, "=COUNT({TRUE,7,\"8\"})"),
            (0, 3, 3, "=CONCAT(A1:B2,\"!\")"),
            (0, 4, 3, "=_xlfn.CONCAT(A1:B2)"),
            (0, 5, 3, "=CONCAT(\"x\",#N/A)"),
            (0, 6, 3, "=CONCAT(A1:A1048576)"),
        ],
        10_000_000,
    )
    .unwrap();
    for (row, expected) in [
        (0, "1"),
        (1, "3"),
        (2, "1"),
        (3, "TRUEhello7world!"),
        (4, "TRUEhello7world"),
        (5, "#N/A"),
        (6, "TRUE78"),
    ] {
        assert_eq!(
            book.display(0, row, 3, 1_000_000).unwrap(),
            expected,
            "row {row}"
        );
    }
}

#[test]
fn excel_sheet_accepts_table_and_named_references_and_propagates_errors() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Other").unwrap();
    book.edit(&[(1, 0, 0, "Value"), (1, 1, 0, "3")], 10_000_000)
        .unwrap();
    book.add_table(1, "Sales", [0, 0, 1, 0], 10_000_000)
        .unwrap();
    book.edit(
        &[
            (0, 0, 0, "=SHEET()"),
            (0, 1, 0, "=SHEET(Other!A2)"),
            (0, 2, 0, "=SHEET(\"Other\")"),
            (0, 3, 0, "=SHEET(Sales)"),
            (0, 4, 0, "=SHEET(1)"),
            (0, 5, 0, "=SHEET(Unknown)"),
            (0, 6, 0, "=SHEET(\"Unknown\")"),
            (0, 7, 0, "=SHEET(#REF!)"),
            (0, 8, 0, "=SHEET(A1,A2)"),
        ],
        10_000_000,
    )
    .unwrap();
    for (row, expected) in [
        (0, "1"),
        (1, "2"),
        (2, "2"),
        (3, "2"),
        (4, "#N/A"),
        (5, "#NAME?"),
        (6, "#N/A"),
        (7, "#REF!"),
        (8, "#VALUE!"),
    ] {
        assert_eq!(
            book.display(0, row, 0, 1_000_000).unwrap(),
            expected,
            "row {row}"
        );
    }
}

#[test]
fn imported_defined_names_export_excel_reference_syntax() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Other").unwrap();
    book.options.names.push(super::model::NamedExpression {
        name: "Fancy".into(),
        sheet: None,
        expression: "$Other.$A$2".into(),
        openformula: Some("msoxl:=Other!$A$2".into()),
        position: (0, 0, 0),
        compiled: None,
    });
    book.edit(
        &[
            (1, 1, 0, "7"),
            (0, 0, 0, "=SUM(Fancy)"),
            (0, 1, 0, "=SHEET(Fancy)"),
        ],
        10_000_000,
    )
    .unwrap();
    let bytes = book.export_xlsx(10_000_000).unwrap();
    let restored = Spreadsheet::import_xlsx(&bytes, 10_000_000).unwrap();
    assert_eq!(restored.display(0, 0, 0, 1_000_000).unwrap(), "7");
    assert_eq!(restored.display(0, 1, 0, 1_000_000).unwrap(), "2");
}

#[test]
fn table_reference_mapping_tracks_names_columns_local_refs_and_deletions() {
    use super::{TableReferenceMap, map_table_references};
    let maps = [
        TableReferenceMap {
            name: "Sales",
            replacement: Some("Costs"),
            local: true,
            columns: vec![("Amount", Some("Net]Revenue"))],
        },
        TableReferenceMap {
            name: "Costs",
            replacement: Some("Sales"),
            local: false,
            columns: vec![],
        },
    ];
    let (formula, used) = map_table_references(
        "SUM(Sales[Amount],Costs)+[@Amount]+\"Sales[Amount]\"",
        &maps,
        &mut 1_000_000,
    )
    .unwrap();
    assert_eq!(
        formula,
        "SUM(Costs[Net']Revenue],Sales)+[@Net']Revenue]+\"Sales[Amount]\""
    );
    assert_eq!(used, vec![(0, vec![0]), (1, vec![])]);
    let (formula, _) = map_table_references(
        "SUM([Other.xlsx]Sheet1!Sales[Amount])+Sales!A1+Sales(A1)",
        &maps,
        &mut 1_000_000,
    )
    .unwrap();
    assert_eq!(
        formula,
        "SUM([Other.xlsx]Sheet1!Sales[Amount])+Sales!A1+Sales(A1)"
    );
    let maps = [TableReferenceMap {
        name: "Sales",
        replacement: None,
        local: true,
        columns: vec![("Amount", None)],
    }];
    assert_eq!(
        map_table_references(
            "SUM(Sales[Amount])+[@Amount]+SUM(Sales)",
            &maps,
            &mut 1_000_000
        )
        .unwrap()
        .0,
        "SUM(#REF!)+#REF!+SUM(#REF!)"
    );
    assert!(map_table_references("Sales[Amount]", &maps, &mut 1).is_none());
}

#[test]
fn deleting_a_table_worksheet_invalidates_structured_references() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Data").unwrap();
    book.edit(&[(1, 0, 0, "Amount"), (1, 1, 0, "7")], 10_000_000)
        .unwrap();
    book.add_table(1, "Sales", [0, 0, 1, 0], 10_000_000)
        .unwrap();
    book.edit(
        &[(0, 0, 0, "=SUM(Sales[Amount])"), (0, 1, 0, "=SUM(Sales)")],
        10_000_000,
    )
    .unwrap();
    book.delete_sheet(1, 10_000_000).unwrap();
    assert_eq!(book.input(0, 0, 0), "=SUM(#REF!)");
    assert_eq!(book.display(0, 1, 0, 1_000_000).unwrap(), "#REF!");
}

#[test]
fn table_reference_mapping_preserves_error_literals_and_escaped_external_refs() {
    use super::{TableReferenceMap, map_table_references};
    let maps = [
        TableReferenceMap {
            name: "N",
            replacement: Some("Numbers"),
            columns: vec![],
            local: false,
        },
        TableReferenceMap {
            name: "Sales",
            replacement: Some("Orders"),
            columns: vec![],
            local: false,
        },
    ];
    let source = "IFNA(#N/A,SUM([Book.xlsx]Data!Sales['#Amount]))+SUM(Sales)";
    assert_eq!(
        map_table_references(source, &maps, &mut 1_000_000)
            .unwrap()
            .0,
        "IFNA(#N/A,SUM([Book.xlsx]Data!Sales['#Amount]))+SUM(Orders)"
    );
}

#[test]
fn renaming_a_table_rewrites_references_and_is_atomic() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "Amount"), (0, 1, 0, "7")], 10_000_000)
        .unwrap();
    book.add_table(0, "Sales", [0, 0, 2, 0], 10_000_000)
        .unwrap();
    book.edit(
        &[
            (0, 4, 0, "=SUM(Sales[Amount])"),
            (0, 5, 0, "=\"Sales[Amount]\""),
            (0, 2, 0, "=[@Amount]"),
        ],
        10_000_000,
    )
    .unwrap();
    let before = book.to_json();
    for name in ["A1", "Bad name", "R1C1", ""] {
        assert!(book.rename_table(0, name, 10_000_000).is_err());
        assert_eq!(book.to_json(), before);
    }
    assert!(book.rename_table(0, "Revenue", 1).is_err());
    assert_eq!(book.to_json(), before);
    assert!(book.rename_table(1, "Revenue", 10_000_000).is_err());
    book.rename_table(0, "Revenue", 10_000_000).unwrap();
    assert_eq!(book.input(0, 4, 0), "=SUM(Revenue[Amount])");
    assert_eq!(book.input(0, 5, 0), "=\"Sales[Amount]\"");
    assert_eq!(book.input(0, 2, 0), "=[@Amount]");
    book.edit(&[(0, 2, 0, "3")], 10_000_000).unwrap();
    assert_eq!(book.display(0, 4, 0, 1_000_000).unwrap(), "10");
    let bytes = book.export_xlsx(20_000_000).unwrap();
    let imported = Spreadsheet::import_xlsx(&bytes, 20_000_000).unwrap();
    assert_eq!(imported.options.tables[0].name, "Revenue");
    assert_eq!(imported.display(0, 4, 0, 1_000_000).unwrap(), "10");
    book.add_table(0, "Other", [10, 0, 11, 0], 10_000_000)
        .unwrap();
    let before = book.to_json();
    assert!(book.rename_table(0, "other", 10_000_000).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn table_sort_uses_typed_values_stable_ties_and_blanks_last() {
    // Adapted from Univer sheets-sort/controllers/__tests__/utils.spec.ts:
    // numeric/text/logical/error groups, literal numeric/error text, stable
    // errors and case-insensitive ties, and blanks last in both directions.
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "Key"), (0, 0, 1, "Record")], 10_000_000)
        .unwrap();
    let records = [
        ("=NA()", "error1"),
        ("10", "ten"),
        ("apple", "apple1"),
        ("=TRUE()", "logical-true"),
        ("'002", "text-number"),
        ("", "blank"),
        ("2", "two"),
        ("APPLE", "apple2"),
        ("=FALSE()", "logical-false"),
        ("=1/0", "error2"),
    ];
    for (i, (value, id)) in records.iter().enumerate() {
        book.edit(&[(0, i + 1, 0, value), (0, i + 1, 1, id)], 10_000_000)
            .unwrap();
    }
    book.add_table(0, "Records", [0, 0, 10, 1], 10_000_000)
        .unwrap();
    book.sort_table(0, 0, false, 10_000_000).unwrap();
    let names = |book: &Spreadsheet| (1..=10).map(|r| book.input(0, r, 1)).collect::<Vec<_>>();
    assert_eq!(
        names(&book),
        [
            "two",
            "ten",
            "text-number",
            "apple1",
            "apple2",
            "logical-false",
            "logical-true",
            "error1",
            "error2",
            "blank"
        ]
    );
    book.sort_table(0, 0, true, 10_000_000).unwrap();
    assert_eq!(
        names(&book),
        [
            "error1",
            "error2",
            "logical-true",
            "logical-false",
            "apple1",
            "apple2",
            "text-number",
            "ten",
            "two",
            "blank"
        ]
    );
    assert_eq!(book.input(0, 0, 0), "Key");
}

#[test]
fn table_sort_moves_formulas_styles_and_comments_and_preserves_totals() {
    use super::model::{Axis, Comment};
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Product"),
            (0, 0, 1, "Amount"),
            (0, 0, 2, "Tax"),
            (0, 0, 5, "2"),
            (0, 1, 0, "Paper"),
            (0, 1, 1, "7"),
            (0, 1, 2, "=B2*$F$1"),
            (0, 2, 0, "Pens"),
            (0, 2, 1, "3"),
            (0, 2, 2, "=B3*$F$1"),
            (0, 3, 0, "Folders"),
            (0, 3, 1, "15"),
            (0, 3, 2, "=B4*$F$1"),
            (0, 4, 0, "Total"),
            (0, 4, 1, "=SUM(B2:B4)"),
            (0, 8, 0, "=B2"),
        ],
        10_000_000,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 0, 4, 2], 10_000_000)
        .unwrap();
    book.options.tables[0].totals = true;
    book.sheets[0].cells.get_mut(&(1, 1)).unwrap().format = Some("$0.00".into());
    book.sheets[0].comments.push(Comment {
        row: 1,
        column: 1,
        author: "Reviewer".into(),
        runs: Vec::new(),
    });
    book.sheets[0].rows.insert(
        1,
        Axis {
            hidden: true,
            ..Default::default()
        },
    );
    book.sort_table(0, 1, false, 10_000_000).unwrap();
    assert_eq!(book.input(0, 1, 0), "Pens");
    assert_eq!(book.input(0, 2, 0), "Paper");
    assert_eq!(book.input(0, 1, 2), "=B2*$F$1");
    assert_eq!(book.display(0, 1, 2, 1_000_000).unwrap(), "6");
    assert_eq!(book.display(0, 2, 1, 1_000_000).unwrap(), "$7.00");
    assert_eq!(book.sheets[0].comments[0].row, 2);
    assert_eq!(book.input(0, 4, 1), "=SUM(B2:B4)");
    assert_eq!(book.display(0, 4, 1, 1_000_000).unwrap(), "25");
    assert_eq!(book.input(0, 8, 0), "=B2");
    assert!(matches!(
        book.sheets[0].cells[&(8, 0)].value,
        Some(super::Value::Number(3.0))
    ));
    let before = book.to_json();
    assert!(book.sort_table(0, 1, true, 1).is_err());
    assert_eq!(book.to_json(), before);
    assert!(book.sort_table(0, 3, true, 10_000_000).is_err());
    assert_eq!(book.to_json(), before);
    book.sheets[0].merges.push([1, 0, 1, 2]);
    let before = book.to_json();
    assert!(book.sort_table(0, 1, true, 10_000_000).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn table_sort_rejects_intersecting_multi_cell_arrays_and_overlapping_tables() {
    use super::model::ArrayFormula;
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, "Key"), (0, 1, 0, "2"), (0, 2, 0, "1")],
        10_000_000,
    )
    .unwrap();
    book.add_table(0, "Records", [0, 0, 2, 1], 10_000_000)
        .unwrap();
    book.sheets[0].arrays.push(ArrayFormula {
        range: [1, 0, 1, 2],
        expression: "2".into(),
        openformula: None,
        formula_display: None,
    });
    let before = book.to_json();
    assert!(book.sort_table(0, 0, false, 10_000_000).is_err());
    assert_eq!(book.to_json(), before);
    book.sheets[0].arrays.clear();
    book.add_table(0, "Other", [5, 0, 6, 1], 10_000_000)
        .unwrap();
    // Two offline table creations can merge to overlapping ranges.
    book.options.tables[1].area = [1, 0, 2, 1];
    let before = book.to_json();
    assert!(book.sort_table(0, 0, false, 10_000_000).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn table_sort_keeps_sparse_records_local_references_and_excel_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Amount"),
            (0, 0, 1, "Note"),
            (0, 0, 2, "Double"),
            (0, 1, 0, "7"),
            (0, 1, 1, "Paper"),
            (0, 2, 0, "3"),
            (0, 3, 0, "10"),
            (0, 3, 1, "Folder"),
        ],
        10_000_000,
    )
    .unwrap();
    book.add_table(0, "Records", [0, 0, 3, 2], 10_000_000)
        .unwrap();
    book.edit(
        &[
            (0, 1, 2, "=[@Amount]*2"),
            (0, 2, 2, "=[@Amount]*2"),
            (0, 3, 2, "=[@Amount]*2"),
        ],
        10_000_000,
    )
    .unwrap();
    assert_eq!(
        book.display(0, 2, 2, 1_000_000).unwrap(),
        "6",
        "before sorting"
    );
    let roundtrip = Spreadsheet::from_json(&book.to_json(), 10_000_000).unwrap();
    assert_eq!(
        roundtrip.display(0, 2, 2, 1_000_000).unwrap(),
        "6",
        "after JSON"
    );
    book.sort_table(0, 0, false, 10_000_000).unwrap();
    assert_eq!(book.input(0, 1, 1), "");
    assert_eq!(book.input(0, 2, 1), "Paper");
    assert_eq!(book.input(0, 1, 2), "=[@Amount]*2");
    assert_eq!(book.display(0, 1, 2, 1_000_000).unwrap(), "6");
    assert_eq!(book.display(0, 2, 2, 1_000_000).unwrap(), "14");
    let before = book.to_json();
    assert!(book.sort_table(0, 0, false, 10_000_000).unwrap().is_empty());
    assert_eq!(book.to_json(), before);
    let imported =
        Spreadsheet::import_xlsx(&book.export_xlsx(20_000_000).unwrap(), 20_000_000).unwrap();
    assert_eq!(imported.input(0, 1, 1), "");
    assert_eq!(imported.display(0, 1, 2, 1_000_000).unwrap(), "6");
}

#[test]
fn csv_conversion_does_not_require_editable_filter_metadata() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "Amount"), (0, 1, 0, "7")], 10_000_000)
        .unwrap();
    book.add_table(0, "Sales", [0, 0, 1, 0], 10_000_000)
        .unwrap();
    let bytes = book.export_xlsx(10_000_000).unwrap();
    let mut entries = crate::commands::structured::read_office_archive(&bytes);
    let table = entries.get_mut("xl/tables/table1.xml").unwrap();
    let source = String::from_utf8(table.clone()).unwrap();
    let source = source.replace(
        "</autoFilter>",
        "<filterColumn colId=\"0\"><top10 val=\"10\"/></filterColumn></autoFilter>",
    );
    assert!(source.contains("top10"));
    *table = source.into_bytes();
    let bytes = office_package_rust::write_zip_stored(
        &entries
            .iter()
            .map(|(name, bytes)| (name.as_str(), bytes.as_slice()))
            .collect::<Vec<_>>(),
    );
    assert!(super::xlsx_import::export_csv(&bytes, None, 10_000_000).is_ok());
}

#[test]
fn table_filters_keep_column_snapshots_manual_hiding_and_subtotals() {
    use super::model::{Axis, FilterField};
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Region"),
            (0, 0, 1, "Amount"),
            (0, 1, 0, "Spain"),
            (0, 1, 1, "2"),
            (0, 2, 0, "France"),
            (0, 2, 1, "8"),
            (0, 3, 0, "Spain"),
            (0, 3, 1, "4"),
            (0, 5, 1, "=SUBTOTAL(9,B2:B4)"),
            (0, 6, 1, "=SUBTOTAL(109,B2:B4)"),
        ],
        10_000_000,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 0, 3, 1], 10_000_000)
        .unwrap();
    book.sheets[0].rows.insert(
        3,
        Axis {
            hidden: true,
            ..Default::default()
        },
    );
    let field = |operator, value: &str| FilterField {
        dynamic: None,
        date_groups: Vec::new(),
        top: None,
        custom: true,
        conditions: vec![(operator, value.into())],
        conjunction: false,
        hidden_rows: None,
    };
    book.filter_table(0, 0, Some(field("equal", "Spain")), 10_000_000)
        .unwrap();
    assert_eq!(
        book.filtered_rows(0, 100_000)
            .unwrap()
            .into_iter()
            .collect::<Vec<_>>(),
        vec![2]
    );
    assert_eq!(book.display(0, 5, 1, 100_000).unwrap(), "6");
    assert_eq!(book.display(0, 6, 1, 100_000).unwrap(), "2");
    book.filter_table(0, 1, Some(field("greaterThan", "3")), 10_000_000)
        .unwrap();
    assert_eq!(
        book.filtered_rows(0, 100_000)
            .unwrap()
            .into_iter()
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
    book.filter_table(0, 0, None, 10_000_000).unwrap();
    assert_eq!(
        book.filtered_rows(0, 100_000)
            .unwrap()
            .into_iter()
            .collect::<Vec<_>>(),
        vec![1]
    );
    assert!(book.sheets[0].rows[&3].hidden);
    book.edit(&[(0, 1, 1, "7")], 10_000_000).unwrap();
    assert_eq!(
        book.filtered_rows(0, 100_000)
            .unwrap()
            .into_iter()
            .collect::<Vec<_>>(),
        vec![1]
    );
    book.reapply_table_filter(0, 10_000_000).unwrap();
    assert!(book.filtered_rows(0, 100_000).unwrap().is_empty());
    let before = book.to_json();
    assert!(
        book.filter_table(0, 1, Some(field("unknown", "3")), 10_000_000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
    assert!(
        book.filter_table(0, 1, Some(field("equal", "7")), 8)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
    book.filter_table(0, 1, Some(field("lessThan", "8")), 10_000_000)
        .unwrap();
    let restored = Spreadsheet::from_json(&book.to_json(), 10_000_000).unwrap();
    assert_eq!(
        restored.filtered_rows(0, 100_000).unwrap(),
        book.filtered_rows(0, 100_000).unwrap()
    );
    let restored =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    assert_eq!(restored.display(0, 6, 1, 100_000).unwrap(), "7");
    assert_eq!(restored.display(0, 5, 1, 100_000).unwrap(), "11");
    // One record is hidden both manually and by the filter. Clearing the
    // reopened filter must retain its manual hiding, including SUBTOTAL(109).
    book.filter_table(0, 1, Some(field("greaterThan", "6")), 10_000_000)
        .unwrap();
    let mut restored =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    assert!(restored.sheets[0].rows[&3].hidden);
    restored.filter_table(0, 1, None, 10_000_000).unwrap();
    assert!(restored.sheets[0].rows[&3].hidden);
    assert_eq!(restored.display(0, 5, 1, 100_000).unwrap(), "19");
    assert_eq!(restored.display(0, 6, 1, 100_000).unwrap(), "15");
}

#[test]
fn empty_value_filter_and_sort_preserve_visibility_across_excel() {
    use super::model::FilterField;
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Amount"),
            (0, 1, 0, "7"),
            (0, 2, 0, "3"),
            (0, 3, 0, "9"),
            (0, 5, 0, "=SUBTOTAL(9,A2:A4)"),
        ],
        10_000_000,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 0, 3, 0], 10_000_000)
        .unwrap();
    book.filter_table(
        0,
        0,
        Some(FilterField {
            dynamic: None,
            date_groups: Vec::new(),
            top: None,
            custom: true,
            conditions: vec![("greaterThan", "5".into())],
            conjunction: false,
            hidden_rows: None,
        }),
        10_000_000,
    )
    .unwrap();
    book.sort_table(0, 0, false, 10_000_000).unwrap();
    assert_eq!(
        book.filtered_rows(0, 100_000)
            .unwrap()
            .into_iter()
            .collect::<Vec<_>>(),
        vec![1]
    );
    assert_eq!(book.display(0, 5, 0, 100_000).unwrap(), "16");
    book.filter_table(
        0,
        0,
        Some(FilterField {
            dynamic: None,
            date_groups: Vec::new(),
            top: None,
            custom: false,
            conditions: vec![],
            conjunction: false,
            hidden_rows: None,
        }),
        10_000_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 5, 0, 100_000).unwrap(), "0");
    let mut restored =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    assert_eq!(restored.display(0, 5, 0, 100_000).unwrap(), "0");
    restored.filter_table(0, 0, None, 10_000_000).unwrap();
    assert!(restored.filtered_rows(0, 100_000).unwrap().is_empty());
    assert_eq!(restored.display(0, 5, 0, 100_000).unwrap(), "19");
}

#[test]
fn value_filter_checklist_groups_case_and_applies_large_lists_with_bounded_work() {
    let mut book = Spreadsheet::new();
    let rows: Vec<_> = (0..1000).map(|i| format!("Value {i:04}")).collect();
    let mut edits: Vec<_> = rows
        .iter()
        .enumerate()
        .map(|(i, text)| (0, i + 1, 0, text.as_str()))
        .collect();
    edits.push((0, 0, 0, "Item"));
    edits.push((0, 1001, 0, "VALUE 0000"));
    book.edit(&edits, 10_000_000).unwrap();
    book.add_table(0, "Data", [0, 0, 1001, 0], 10_000_000)
        .unwrap();
    let choices = book.table_filter_values(0, 0, 10_000_000).unwrap();
    assert_eq!(choices.len(), 1000);
    assert_eq!(choices[0], ("Value 0000".into(), 2, true));
    book.filter_table_selection(
        0,
        0,
        false,
        &rows[..500],
        &[("VALUE 0000".into(), false)],
        30_000_000,
    )
    .unwrap();
    assert_eq!(book.filtered_rows(0, 1_000_000).unwrap().len(), 502);
    let choices = book.table_filter_values(0, 0, 10_000_000).unwrap();
    assert!(!choices[0].2);
    assert!(choices[1].2);
    book.filter_table_selection(0, 0, true, &[], &[("value 0000".into(), false)], 30_000_000)
        .unwrap();
    assert_eq!(
        book.filtered_rows(0, 1_000_000)
            .unwrap()
            .into_iter()
            .collect::<Vec<_>>(),
        vec![1, 1001]
    );
}

#[test]
fn convert_table_to_range_resolves_structured_references_without_touching_literals() {
    let mut book = Spreadsheet::new();
    book.rename_sheet(0, "O'Brien Sales", 10_000_000).unwrap();
    book.edit(
        &[
            (0, 0, 0, "Item"),
            (0, 0, 1, "Amount"),
            (0, 0, 2, "Total"),
            (0, 1, 0, "Paper"),
            (0, 1, 1, "7"),
            (0, 2, 0, "Pens"),
            (0, 2, 1, "3"),
        ],
        10_000_000,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 0, 2, 2], 10_000_000)
        .unwrap();
    book.add_sheet("Summary").unwrap();
    book.edit(
        &[
            (0, 1, 2, "=[@Amount]*2"),
            (0, 2, 2, "=Sales[@Amount]*3"),
            (1, 0, 0, "=SUM(Sales[Amount])"),
            (1, 1, 0, "=SUM(Sales[[Amount]:[Total]])"),
            (1, 2, 0, "=Sales[[#Headers],[Amount]]"),
            (1, 3, 0, "=\"Sales[Amount]\""),
        ],
        10_000_000,
    )
    .unwrap();
    book.edit(&[(0, 8, 0, "=4+5")], 10_000_000).unwrap();
    book.sheets[0].cells.get_mut(&(8, 0)).unwrap().openformula = Some("of:=4+5".into());
    let unrelated = book.sheets[0].cells[&(8, 0)].to_json();
    book.convert_table_to_range(0, 10_000_000).unwrap();
    assert_eq!(book.sheets[0].cells[&(8, 0)].to_json(), unrelated);
    assert!(book.options.tables.is_empty());
    assert_eq!(
        book.sheets[0].cells[&(1, 2)].formula.as_deref(),
        Some("$B2*2")
    );
    assert_eq!(
        book.sheets[0].cells[&(2, 2)].formula.as_deref(),
        Some("$B3*3")
    );
    assert_eq!(
        book.sheets[1].cells[&(0, 0)].formula.as_deref(),
        Some("SUM('O''Brien Sales'!$B$2:$B$3)")
    );
    for (row, expected) in [(0, "10"), (1, "33"), (2, "Amount"), (3, "Sales[Amount]")] {
        assert_eq!(book.display(1, row, 0, 100_000).unwrap(), expected);
    }
    let restored =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    assert!(restored.options.tables.is_empty());
    assert_eq!(restored.display(1, 1, 0, 100_000).unwrap(), "33");
    book.edit(&[(0, 1, 1, "9")], 10_000_000).unwrap();
    assert_eq!(book.display(0, 1, 2, 100_000).unwrap(), "18");
    assert_eq!(book.display(1, 0, 0, 100_000).unwrap(), "12");
}

#[test]
fn converting_a_filtered_table_reveals_records_and_preserves_manual_hiding_atomically() {
    use super::model::{Axis, FilterField};
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Amount"),
            (0, 1, 0, "7"),
            (0, 2, 0, "3"),
            (0, 4, 0, "=SUBTOTAL(9,Sales[Amount])"),
            (0, 5, 0, "=SUBTOTAL(109,Sales[Amount])"),
        ],
        10_000_000,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 0, 2, 0], 10_000_000)
        .unwrap();
    book.sheets[0].rows.insert(
        2,
        Axis {
            hidden: true,
            ..Default::default()
        },
    );
    book.filter_table(
        0,
        0,
        Some(FilterField {
            dynamic: None,
            date_groups: Vec::new(),
            top: None,
            custom: false,
            conjunction: false,
            hidden_rows: None,
            conditions: vec![("equal", "7".into())],
        }),
        10_000_000,
    )
    .unwrap();
    let before = book.to_json();
    assert!(book.convert_table_to_range(0, 10).is_err());
    assert_eq!(book.to_json(), before);
    assert!(book.convert_table_to_range(1, 10_000_000).is_err());
    assert_eq!(book.to_json(), before);
    book.convert_table_to_range(0, 10_000_000).unwrap();
    assert!(book.filtered_rows(0, 100_000).unwrap().is_empty());
    assert!(book.sheets[0].rows[&2].hidden);
    assert_eq!(book.display(0, 4, 0, 100_000).unwrap(), "10");
    assert_eq!(book.display(0, 5, 0, 100_000).unwrap(), "7");
}

#[test]
fn table_conversion_reuses_structured_reference_sections_escaping_and_row_rules() {
    use super::{model::Table, table_to_range_references};
    // Section and escaped-column cases from IronCalc's structured-reference
    // grammar are resolved by the same AST code used during calculation.
    let table = Table {
        calculated_columns: Default::default(),
        name: "Sales".into(),
        sheet: 0,
        area: [0, 0, 4, 2],
        header: true,
        totals: true,
        columns: vec!["Item".into(), "Net]Revenue".into(), "#Tax".into()],
        filter: None,
    };
    for (source, expected) in [
        ("SUM(Sales)", "SUM($A$2:$C$4)"),
        ("Sales[#All]", "$A$1:$C$5"),
        ("Sales[#Totals]", "$A$5:$C$5"),
        ("Sales[[#Headers],[#Totals]]", "($A$1:$C$1,$A$5:$C$5)"),
        ("Sales[[#Headers],[#Data]]", "$A$1:$C$4"),
        ("Sales[Net']Revenue]", "$B$2:$B$4"),
        ("Sales['#Tax]", "$C$2:$C$4"),
        ("[@Net']Revenue]", "$B3"),
        ("Sales[[#This Row],[Item]:['#Tax]]", "$A3:$C3"),
        ("Sales[Missing]", "#REF!"),
        ("Sales[[#Headers],[#This Row]]", "#REF!"),
        (
            "SUM([Other.xlsx]Sheet1!Sales[Item])+Sales!A1+Sales(A1)",
            "SUM([Other.xlsx]Sheet1!Sales[Item])+Sales!A1+Sales(A1)",
        ),
        ("\"Sales[Item]\"&Sales[Item]", "\"Sales[Item]\"&$A$2:$A$4"),
    ] {
        assert_eq!(
            table_to_range_references(source, &table, "Data", (0, 2, 0), false, &mut 100_000)
                .unwrap(),
            expected,
            "{source}"
        );
    }
    assert_eq!(
        table_to_range_references("[@Item]", &table, "Data", (1, 2, 0), false, &mut 100_000)
            .unwrap(),
        "[@Item]"
    );
    assert_eq!(
        table_to_range_references(
            "Sales[@Item]",
            &table,
            "Data",
            (0, 0, 0),
            false,
            &mut 100_000
        )
        .unwrap(),
        "#REF!"
    );
    assert!(
        table_to_range_references("Sales[Item]", &table, "Data", (0, 2, 0), false, &mut 1)
            .is_none()
    );
}

#[test]
fn table_conversion_updates_named_expressions_array_formulas_and_totals() {
    use super::model::{ArrayFormula, NamedExpression};
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Amount"),
            (0, 1, 0, "7"),
            (0, 2, 0, "3"),
            (0, 3, 0, "=SUBTOTAL(109,Sales[Amount])"),
        ],
        10_000_000,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 0, 3, 0], 10_000_000)
        .unwrap();
    book.options.tables[0].totals = true;
    book.options.tables[0].filter.as_mut().unwrap().area[2] = 2;
    book.add_sheet("Summary").unwrap();
    book.options.names.push(NamedExpression {
        name: "Revenue".into(),
        sheet: None,
        expression: "SUM(Sales[Amount])".into(),
        openformula: Some("msoxl:=SUM(Sales[Amount])".into()),
        position: (0, 0, 0),
        compiled: None,
    });
    book.edit(
        &[
            (1, 0, 0, "=Revenue"),
            (1, 1, 0, "=SUM(Sales[Amount])*2"),
            (1, 2, 0, "=SUM(Sales[#Totals])"),
        ],
        10_000_000,
    )
    .unwrap();
    book.sheets[1].arrays.push(ArrayFormula {
        range: [1, 0, 1, 1],
        expression: "SUM(Sales[Amount])*2".into(),
        openformula: Some("msoxl:=SUM(Sales[Amount])*2".into()),
        formula_display: None,
    });
    book.convert_table_to_range(0, 10_000_000).unwrap();
    assert_eq!(book.options.names[0].expression, "SUM(Sheet1!$A$2:$A$3)");
    assert_eq!(
        book.sheets[1].arrays[0].expression,
        "SUM(Sheet1!$A$2:$A$3)*2"
    );
    for (row, expected) in [(0, "10"), (1, "20"), (2, "10")] {
        assert_eq!(book.display(1, row, 0, 100_000).unwrap(), expected);
    }
    let restored =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    for (row, expected) in [(0, "10"), (1, "20"), (2, "10")] {
        assert_eq!(restored.display(1, row, 0, 100_000).unwrap(), expected);
    }
}

#[test]
fn calculated_table_column_formulas_survive_excel_and_json_roundtrips() {
    // Univer 4767b3b calculated-column.spec.ts uses a relative formula and a
    // formal array formula as reusable column definitions (LICENSE.Univer).
    // Stored worksheet formulas alone cannot preserve that growing-table rule.
    const LIMIT: usize = 20_000_000;
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Name"),
            (0, 0, 1, "Amount"),
            (0, 0, 2, "Array"),
            (0, 1, 0, "7"),
            (0, 1, 1, "=A2*2"),
            (0, 1, 2, "=$A2"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Orders", [0, 0, 9, 2], LIMIT).unwrap();
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let mut entries = crate::commands::structured::read_office_archive(&bytes);
    let table = entries.get_mut("xl/tables/table1.xml").unwrap();
    let source = String::from_utf8(table.clone()).unwrap()
        .replace("<tableColumn id=\"2\" name=\"Amount\"/>", "<tableColumn id=\"2\" name=\"Amount\"><calculatedColumnFormula>A2*2</calculatedColumnFormula></tableColumn>")
        .replace("<tableColumn id=\"3\" name=\"Array\"/>", "<tableColumn id=\"3\" name=\"Array\"><calculatedColumnFormula array=\"1\">$A2</calculatedColumnFormula></tableColumn>");
    assert!(source.contains("<calculatedColumnFormula>A2*2"));
    assert!(source.contains("<calculatedColumnFormula array=\"1\">$A2"));
    *table = source.into_bytes();
    let bytes = office_package_rust::write_zip_stored(
        &entries
            .iter()
            .map(|(name, bytes)| (name.as_str(), bytes.as_slice()))
            .collect::<Vec<_>>(),
    );
    let imported = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    let json = Spreadsheet::from_json(&imported.to_json(), LIMIT).unwrap();
    for book in [&imported, &json] {
        assert_eq!(book.display(0, 1, 1, LIMIT).unwrap(), "14");
        assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "7");
        let output =
            crate::commands::structured::read_office_archive(&book.export_xlsx(LIMIT).unwrap());
        let table = std::str::from_utf8(output.get("xl/tables/table1.xml").unwrap()).unwrap();
        assert!(
            table.contains("<calculatedColumnFormula>A2*2</calculatedColumnFormula>"),
            "{table}"
        );
        assert!(
            table.contains("<calculatedColumnFormula array=\"1\">$A2</calculatedColumnFormula>"),
            "{table}"
        );
    }
}

fn calculated_table_book() -> Spreadsheet {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, "Price"), (0, 0, 1, "Amount"), (0, 1, 0, "7")],
        20_000_000,
    )
    .unwrap();
    book.add_table(0, "Orders", [0, 0, 9, 1], 20_000_000)
        .unwrap();
    book.options.tables[0].calculated_columns.insert(
        1,
        super::CalculatedColumn {
            formula: "Orders[@Price]+Sheet1!A2+\"Orders[Price]\"".into(),
            array: false,
            origin_row: None,
        },
    );
    book
}

#[test]
fn calculated_table_definitions_follow_sheet_table_and_header_renames() {
    let mut book = calculated_table_book();
    book.rename_sheet(0, "Sales data", 20_000_000).unwrap();
    book.rename_table(0, "Sales", 20_000_000).unwrap();
    book.edit(&[(0, 0, 0, "Cost")], 20_000_000).unwrap();
    assert_eq!(
        book.options.tables[0].calculated_columns[&1].formula,
        "Sales[@Cost]+'Sales data'!A2+\"Orders[Price]\""
    );
}

#[test]
fn calculated_table_definitions_follow_inserted_and_deleted_columns() {
    // Univer table.spec.ts keeps existing column definitions attached to their columns.
    let mut book = calculated_table_book();
    book.edit_axis(0, true, 1, 1, 20_000_000).unwrap();
    assert!(!book.options.tables[0].calculated_columns.contains_key(&1));
    assert!(book.options.tables[0].calculated_columns.contains_key(&2));
    book.edit_axis(0, false, 0, 2, 20_000_000).unwrap();
    assert_eq!(
        book.options.tables[0].calculated_columns[&2].formula,
        "Orders[@Price]+Sheet1!A4+\"Orders[Price]\""
    );
    book.edit_axis(0, true, 0, -1, 20_000_000).unwrap();
    assert_eq!(
        book.options.tables[0].calculated_columns[&1].formula,
        "#REF!+#REF!+\"Orders[Price]\""
    );
    book.edit_axis(0, true, 1, -1, 20_000_000).unwrap();
    assert!(book.options.tables[0].calculated_columns.is_empty());
}

#[test]
fn calculated_table_definitions_convert_references_to_other_tables() {
    let mut book = calculated_table_book();
    book.edit(&[(0, 0, 3, "Value"), (0, 1, 3, "4")], 20_000_000)
        .unwrap();
    book.add_table(0, "Other", [0, 3, 2, 3], 20_000_000)
        .unwrap();
    book.options.tables[0]
        .calculated_columns
        .get_mut(&1)
        .unwrap()
        .formula = "SUM(Other[Value])".into();
    book.convert_table_to_range(1, 20_000_000).unwrap();
    assert_eq!(
        book.options.tables[0].calculated_columns[&1].formula,
        "SUM($D$2:$D$3)"
    );
}

#[test]
fn calculated_table_definitions_validate_indexes_and_allocation_limits() {
    let mut book = calculated_table_book();
    let definition = book.options.tables[0]
        .calculated_columns
        .remove(&1)
        .unwrap();
    book.options.tables[0]
        .calculated_columns
        .insert(2, definition);
    assert!(Spreadsheet::from_json(&book.to_json(), 20_000_000).is_err());
    book.options.tables[0].calculated_columns.clear();
    book.options.tables[0].calculated_columns.insert(
        1,
        super::CalculatedColumn {
            formula: "x".repeat(100_000),
            array: false,
            origin_row: None,
        },
    );
    assert!(Spreadsheet::from_json(&book.to_json(), 50_000).is_err());
    assert!(book.export_xlsx(50_000).is_err());
}
#[test]
fn excel_import_rejects_missing_worksheet_data_instead_of_creating_blank_sheets() {
    const LIMIT: usize = 20_000_000;
    let mut book = Spreadsheet::new();
    book.add_sheet("Inputs").unwrap();
    book.edit(&[(0, 0, 0, "=Inputs!A1*2"), (1, 0, 0, "7")], LIMIT)
        .unwrap();
    let bytes = book.export_xlsx(LIMIT).unwrap();
    for replacement in [None, Some(b"".as_slice())] {
        let mut entries = crate::commands::structured::read_office_archive(&bytes);
        if let Some(value) = replacement {
            entries.insert("xl/worksheets/sheet2.xml".into(), value.to_vec());
        } else {
            entries.remove("xl/worksheets/sheet2.xml");
        }
        let broken = office_package_rust::write_zip_stored(
            &entries
                .iter()
                .map(|(n, b)| (n.as_str(), b.as_slice()))
                .collect::<Vec<_>>(),
        );
        assert!(
            Spreadsheet::import_xlsx(&broken, LIMIT).is_err(),
            "missing worksheet must not become zero in dependent formulas"
        );
    }
}

#[test]
fn excel_import_rejects_unresolved_shared_strings_but_preserves_empty_strings() {
    const LIMIT: usize = 20_000_000;
    let bytes = Spreadsheet::new().export_xlsx(LIMIT).unwrap();
    for index in ["0", "1", "-1", "text", ""] {
        let mut entries = crate::commands::structured::read_office_archive(&bytes);
        entries.insert("xl/worksheets/sheet1.xml".into(), format!(r#"<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>{index}</v></c></row></sheetData></worksheet>"#).into_bytes());
        entries.insert(
            "xl/sharedStrings.xml".into(),
            b"<sst><si><t></t></si></sst>".to_vec(),
        );
        let rels = entries.get_mut("xl/_rels/workbook.xml.rels").unwrap();
        *rels = String::from_utf8(rels.clone()).unwrap().replace("</Relationships>", r#"<Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>"#).into_bytes();
        for missing in [false, true] {
            if missing {
                entries.remove("xl/sharedStrings.xml");
            }
            let input = office_package_rust::write_zip_stored(
                &entries
                    .iter()
                    .map(|(n, b)| (n.as_str(), b.as_slice()))
                    .collect::<Vec<_>>(),
            );
            let result = Spreadsheet::import_xlsx(&input, LIMIT);
            // A cell with no value is allowed even when its type is shared
            // string. An actual index must resolve to an existing entry.
            if index.is_empty() || !missing && index == "0" {
                let imported = result.unwrap();
                assert!(imported.cell(0,0,0).is_some_and(|c| matches!(c.value.as_ref(), Some(super::Value::Text(value)) if value.is_empty())));
            } else {
                assert!(
                    result.is_err(),
                    "unresolved shared string {index:?}, missing={missing}"
                );
            }
        }
    }
}

#[test]
fn cell_xfs_without_xf_id_preserve_alignment_and_wrapping() {
    // IronCalc f936620, xlsx/tests/optional_xf_id_import.rs (LICENSE.IronCalc).
    // Retain its original workbook and A2 top-alignment/wrapping expectations.
    // Full-column formatting uses the same calculation budget as the editor.
    const LIMIT: usize = 128 * 1024 * 1024;
    let bytes = include_bytes!("fixtures/ironcalc_optional_xf_id.xlsx");
    let imported = Spreadsheet::import_xlsx(bytes, LIMIT).unwrap();
    let json = Spreadsheet::from_json(&imported.to_json(), LIMIT).unwrap();
    let excel = Spreadsheet::import_xlsx(&imported.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for book in [&imported, &json, &excel] {
        let cell = book.cell(0, 1, 0).unwrap();
        let style = cell.style.as_ref().unwrap();
        assert!(style.attributes.contains(&("VAlign", "top".into())));
        assert!(style.attributes.contains(&("WrapText", "1".into())));
    }
}

#[test]
fn copied_dates_convert_epochs_without_changing_times_numbers_or_formulas() {
    use crate::commands::spreadsheet::Value;
    for (format, number, calendar) in [
        ("yyyy-mm-dd", 46348., true),
        ("yyyy-mm-dd hh:mm:ss", 46348.75, true),
        ("mmm-yy", 46348., true),
        ("[$-409]m/d/yy", 46348., true),
        ("[>=40000]yyyy-mm-dd;0", 46348., true),
        ("[>=50000]yyyy-mm-dd;0", 46348., false),
        ("General", 46348., false),
        ("0.00", 2.5, false),
        (r#"0 "days""#, 2., false),
        (r"0\d", 2., false),
        ("[h]:mm:ss", 2.5, false),
        ("hh:mm:ss", 0.75, false),
        ("mm:ss", 0.75, false),
    ] {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, &number.to_string())], 1_000_000)
            .unwrap();
        let cell = book.sheets[0].cells.get_mut(&(0, 0)).unwrap();
        cell.format = Some(format.into());
        let original = cell.to_json();
        cell.convert_date_system(false, false, &mut 1_000_000)
            .unwrap();
        assert_eq!(cell.to_json(), original);
        cell.convert_date_system(false, true, &mut 1_000_000)
            .unwrap();
        let Some(Value::Number(actual)) = cell.value else {
            panic!("number")
        };
        assert_eq!(
            actual,
            number - if calendar { 1462. } else { 0. },
            "{format}"
        );
        cell.convert_date_system(true, false, &mut 1_000_000)
            .unwrap();
        assert_eq!(cell.to_json(), original, "{format}");
    }
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, "=DATE(2026,11,22)"), (0, 0, 1, "'2026-11-22")],
        1_000_000,
    )
    .unwrap();
    for cell in book.sheets[0].cells.values_mut() {
        cell.format = Some("yyyy-mm-dd".into());
        let original = cell.to_json();
        cell.convert_date_system(false, true, &mut 1_000_000)
            .unwrap();
        assert_eq!(cell.to_json(), original);
    }
}

#[test]
fn date_epoch_conversion_handles_early_dates_and_rejects_unrepresentable_days() {
    let mut book = Spreadsheet::new();
    for (serial, expected) in [(1., -1460.), (59.5, -1401.5), (61., -1401.), (1462., 0.)] {
        book.edit(&[(0, 0, 0, &serial.to_string())], 1_000_000)
            .unwrap();
        let cell = book.sheets[0].cells.get_mut(&(0, 0)).unwrap();
        cell.format = Some("yyyy-mm-dd hh:mm:ss".into());
        let original = cell.to_json();
        cell.convert_date_system(false, true, &mut 1_000_000)
            .unwrap();
        assert!(
            matches!(cell.value, Some(crate::commands::spreadsheet::Value::Number(n)) if n == expected)
        );
        cell.convert_date_system(true, false, &mut 1_000_000)
            .unwrap();
        assert_eq!(cell.to_json(), original);
    }
    for serial in [0., 60., 60.5] {
        book.edit(&[(0, 0, 0, &serial.to_string())], 1_000_000)
            .unwrap();
        let cell = book.sheets[0].cells.get_mut(&(0, 0)).unwrap();
        cell.format = Some("yyyy-mm-dd".into());
        let original = cell.to_json();
        assert!(
            cell.convert_date_system(false, true, &mut 1_000_000)
                .is_err()
        );
        assert_eq!(cell.to_json(), original);
    }
    book.edit(&[(0, 0, 0, "46348")], 1_000_000).unwrap();
    let cell = book.sheets[0].cells.get_mut(&(0, 0)).unwrap();
    cell.format = Some("yyyy-mm-dd".into());
    let original = cell.to_json();
    assert!(cell.convert_date_system(false, true, &mut 0).is_err());
    assert_eq!(cell.to_json(), original);
}

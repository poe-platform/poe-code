// Row/column, merge and array cases adapted from IronCalc's
// test_merged_cells.rs and array_formulas/test_array_insert_delete.rs.
// See LICENSE.IronCalc for the pinned upstream license.
use super::{
    Spreadsheet,
    model::{ArrayFormula, Axis, Comment, NamedExpression},
};
const LIMIT: usize = 10_000_000;

#[test]
fn qualified_deleted_references_remain_catchable_through_edits_and_reopening() {
    let mut book = Spreadsheet::new();
    book.add_sheet("O'Brien").unwrap();
    let cases = [
        ("=Sheet1!#REF!", "#REF!"),
        ("=Missing!#REF!", "#REF!"),
        ("='O''Brien'!#ref!", "#REF!"),
        ("=IFERROR(Sheet1!#REF!,\"caught\")", "caught"),
        ("=ISERROR(Sheet1!#REF!)", "TRUE"),
        ("=ERROR.TYPE(Sheet1!#REF!)", "4"),
        ("=SUM(Sheet1!#REF!,1)", "#REF!"),
        ("=IFNA(Sheet1!#REF!,7)", "#REF!"),
        ("=ISREF(Sheet1!#REF!)", "FALSE"),
        ("=\"Sheet1!#REF!\"", "Sheet1!#REF!"),
    ];
    let inputs: Vec<_> = cases
        .iter()
        .enumerate()
        .map(|(row, (formula, _))| (0, row, 0, *formula))
        .collect();
    book.edit(&inputs, LIMIT).unwrap();
    for restored in [
        &book,
        &Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        &Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (row, (formula, expected)) in cases.iter().enumerate() {
            assert_eq!(
                restored.display(0, row, 0, LIMIT).unwrap(),
                *expected,
                "{formula}"
            );
            // Excel exports canonical uppercase error names.
            assert_eq!(
                restored.input(0, row, 0).replace("#ref!", "#REF!"),
                formula.replace("#ref!", "#REF!")
            );
        }
    }
    book.edit(
        &[(0, 0, 2, "7"), (0, 1, 2, "=IFERROR('O''Brien'!#REF!,$C$1)")],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "7");
    book.edit(&[(0, 0, 2, "12")], LIMIT).unwrap();
    assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "12");
    book.rename_sheet(1, "Renamed", LIMIT).unwrap();
    assert_eq!(book.input(0, 1, 2), "=IFERROR(Renamed!#REF!,$C$1)");
    assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "12");
    let moved = book
        .relocate_cell(&book.cell(0, 1, 2).unwrap(), (1, 2), (2, 3), 0, LIMIT)
        .unwrap();
    assert_eq!(
        moved.formula.as_deref(),
        Some("IFERROR(Renamed!#REF!,$C$1)")
    );
    book.edit_axis(0, false, 0, 1, LIMIT).unwrap();
    assert_eq!(book.input(0, 2, 2), "=IFERROR(Renamed!#REF!,$C$2)");
    assert_eq!(book.display(0, 2, 2, LIMIT).unwrap(), "12");
    book.edit(&[(0, 3, 2, "=IFERROR(Renamed!#REF!junk,7)")], LIMIT)
        .unwrap();
    assert_ne!(book.display(0, 3, 2, LIMIT).unwrap(), "7");
}

#[test]
fn reference_visitor_binds_cells_ranges_and_whole_axes_without_changing_spelling() {
    use super::{GridReferenceKind, map_grid_references};
    let sheets = vec!["Sheet1".into(), "Other".into()];
    let source = r#"SUM(Sheet1!$A$2:B4,$C:$D,2:$5,A1#,"A1",Table[A1])+Other!C7"#;
    let mut seen = Vec::new();
    let unchanged = map_grid_references(source, &sheets, 0, &mut { LIMIT }, |reference, _| {
        seen.push((reference.kind, reference.sheets, reference.area));
        Ok(Some(reference.area))
    })
    .unwrap();
    assert_eq!(unchanged, source);
    assert_eq!(
        seen,
        vec![
            (GridReferenceKind::Range, [0, 0], [1, 0, 3, 1]),
            (GridReferenceKind::Columns, [0, 0], [0, 2, 1_048_575, 3]),
            (GridReferenceKind::Rows, [0, 0], [1, 0, 4, 16_383]),
            (GridReferenceKind::Cell, [0, 0], [0, 0, 0, 0]),
            (GridReferenceKind::Cell, [1, 1], [6, 2, 6, 2]),
        ]
    );
    let moved = map_grid_references(source, &sheets, 0, &mut { LIMIT }, |reference, _| {
        let mut area = reference.area;
        if reference.sheets[0] == 0 && reference.kind != GridReferenceKind::Columns {
            area[0] += 2;
            area[2] += 2;
        }
        if reference.sheets[0] == 1 {
            area[1] += 1;
            area[3] += 1;
        }
        Ok(Some(area))
    })
    .unwrap();
    assert_eq!(
        moved,
        r#"SUM(Sheet1!$A$4:B6,$C:$D,4:$7,A3#,"A1",Table[A1])+Other!D7"#
    );
}

#[test]
fn reference_visitor_handles_deleted_bindings_and_stays_bounded() {
    use super::map_grid_references;
    let sheets = vec!["Sheet1".into(), "Other".into()];
    let source = "SUM(A1 : A5)+Other!A2+[book]Sheet1!A1 : B5";
    let mut count = 0;
    let deleted = map_grid_references(source, &sheets, 0, &mut { LIMIT }, |reference, _| {
        count += 1;
        Ok((reference.sheets[0] == 0).then_some(reference.area))
    })
    .unwrap();
    assert_eq!(count, 2);
    assert_eq!(deleted, "SUM(A1 : A5)+#REF!+[book]Sheet1!A1 : B5");
    assert!(
        map_grid_references(source, &sheets, 0, &mut 1, |reference, _| Ok(Some(
            reference.area
        )))
        .is_err()
    );
    let invalid = "SUM(A1:#REF!2)+B3";
    let mut seen = Vec::new();
    assert_eq!(
        map_grid_references(invalid, &sheets, 0, &mut { LIMIT }, |reference, _| {
            seen.push(reference.area);
            Ok(Some(reference.area))
        })
        .unwrap(),
        invalid
    );
    assert_eq!(seen, vec![[2, 1, 2, 1]]);
}

#[test]
fn structural_edits_move_absolute_and_relative_references_across_sheets() {
    let mut book = Spreadsheet::new();
    book.add_sheet("O'Brien").unwrap();
    book.edit(
        &[
            (0, 1, 0, "5"),
            (0, 4, 2, "=$A$2+A$2+$A2+A2"),
            (1, 0, 0, "=Sheet1!A2"),
            (1, 1, 0, "=A1"),
            (0, 0, 3, "='O''Brien'!A1"),
        ],
        LIMIT,
    )
    .unwrap();
    book.edit_axis(0, false, 1, 2, LIMIT).unwrap();
    assert_eq!(book.input(0, 6, 2), "=$A$4+A$4+$A4+A4");
    assert_eq!(book.input(1, 0, 0), "=Sheet1!A4");
    assert_eq!(book.input(1, 1, 0), "=A1");
    assert_eq!(book.input(0, 0, 3), "='O''Brien'!A1");
    assert_eq!(book.display(0, 6, 2, LIMIT).unwrap(), "20");
    book.edit_axis(0, true, 0, 1, LIMIT).unwrap();
    assert_eq!(book.input(0, 6, 3), "=$B$4+B$4+$B4+B4");
    book.edit_axis(0, false, 3, -1, LIMIT).unwrap();
    assert_eq!(book.input(1, 0, 0), "=#REF!");
    assert_eq!(book.display(0, 5, 3, LIMIT).unwrap(), "#REF!");
}

#[test]
fn structural_ranges_shrink_at_either_end_and_expand_only_inside() {
    for (start, delta, expected) in [
        (0, 2, "=SUM($A$4:A8)"),
        (1, 2, "=SUM($A$4:A8)"),
        (2, 2, "=SUM($A$2:A8)"),
        (6, 2, "=SUM($A$2:A6)"),
        (0, -2, "=SUM($A$1:A4)"),
        (2, -2, "=SUM($A$2:A4)"),
        (4, -3, "=SUM($A$2:A4)"),
        (1, -5, "=SUM(#REF!)"),
    ] {
        let mut book = Spreadsheet::new();
        book.add_sheet("Results").unwrap();
        book.edit(
            &[
                (0, 1, 0, "1"),
                (0, 5, 0, "2"),
                (1, 0, 0, "=SUM(Sheet1!$A$2:A6)"),
            ],
            LIMIT,
        )
        .unwrap();
        book.edit_axis(0, false, start, delta, LIMIT).unwrap();
        let expected = if expected.contains("#REF!") {
            expected.to_owned()
        } else {
            expected.replace("SUM(", "SUM(Sheet1!")
        };
        assert_eq!(book.input(1, 0, 0), expected, "{start}, {delta}");
    }
}

#[test]
fn structural_rewrite_preserves_strings_tables_names_and_external_books() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "A1"), (0, 1, 0, "7")], LIMIT)
        .unwrap();
    book.add_table(0, "Data", [0, 0, 1, 0], LIMIT).unwrap();
    let formula = "=IF(TRUE(),SUM(Data[A1]),LEN(\"A1\"))+LOG10(100)";
    book.edit(&[(0, 0, 3, formula)], LIMIT).unwrap();
    book.edit_axis(0, false, 0, 1, LIMIT).unwrap();
    assert_eq!(book.input(0, 1, 3), formula);
    let external = "[book.xlsx]Sheet1!A1+'[other.xlsx]Sheet1'!A1+A1";
    let rewritten = super::xlsx_references::map_axis_references(
        external,
        &["Sheet1".into()],
        0,
        super::editor_structure::AxisEdit {
            sheet: 0,
            columns: false,
            start: 0,
            delta: 1,
        },
        &mut { LIMIT },
    )
    .unwrap();
    assert_eq!(rewritten, "[book.xlsx]Sheet1!A1+'[other.xlsx]Sheet1'!A1+A2");
}

#[test]
fn structural_whole_axis_ranges_keep_the_unedited_dimension() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Results").unwrap();
    book.edit(&[(1, 0, 0, "=SUM(Sheet1!$A:C)+SUM(Sheet1!$2:6)")], LIMIT)
        .unwrap();
    book.edit_axis(0, false, 2, 2, LIMIT).unwrap();
    assert_eq!(book.input(1, 0, 0), "=SUM(Sheet1!$A:C)+SUM(Sheet1!$2:8)");
    book.edit_axis(0, true, 0, -1, LIMIT).unwrap();
    assert_eq!(book.input(1, 0, 0), "=SUM(Sheet1!$A:B)+SUM(Sheet1!$2:8)");
}

#[test]
fn ironcalc_insert_rows_displaces_merges() {
    for (at, expected) in [
        (0, [2, 1, 2, 3]),
        (1, [2, 1, 2, 3]),
        (2, [1, 1, 2, 4]),
        (3, [1, 1, 2, 4]),
        (4, [1, 1, 2, 3]),
    ] {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 1, 1, "5")], LIMIT).unwrap();
        book.merge_cells(0, &[[1, 1, 2, 3]], false, LIMIT).unwrap();
        book.edit_axis(0, false, at, 1, LIMIT).unwrap();
        assert_eq!(book.sheets[0].merges, vec![expected]);
    }
}

#[test]
fn ironcalc_delete_rows_displaces_merges() {
    for (at, count, expected) in [
        (0, 1, vec![[0, 1, 2, 3]]),
        (0, 2, vec![[0, 1, 2, 2]]),
        (2, 1, vec![[1, 1, 2, 2]]),
        (3, 2, vec![[1, 1, 2, 2]]),
        (1, 3, vec![]),
        (0, 5, vec![]),
        (4, 1, vec![[1, 1, 2, 3]]),
    ] {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 1, 1, "5")], LIMIT).unwrap();
        book.merge_cells(0, &[[1, 1, 2, 3]], false, LIMIT).unwrap();
        book.edit_axis(0, false, at, -count, LIMIT).unwrap();
        assert_eq!(book.sheets[0].merges, expected);
    }
}

fn array_book() -> Spreadsheet {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 2, 1, "=1+1"),
            (0, 2, 2, "2"),
            (0, 3, 1, "2"),
            (0, 3, 2, "2"),
            (0, 4, 1, "2"),
            (0, 4, 2, "2"),
        ],
        LIMIT,
    )
    .unwrap();
    book.sheets[0].arrays.push(ArrayFormula {
        range: [2, 1, 2, 3],
        expression: "1+1".into(),
        openformula: Some("msoxl:=1+1".into()),
        formula_display: None,
    });
    book
}

#[test]
fn ironcalc_static_arrays_cannot_be_split_by_row_or_column_edits() {
    for (columns, start, delta, valid) in [
        (false, 0, 1, true),
        (false, 2, 1, true),
        (false, 5, 1, true),
        (false, 3, 1, false),
        (false, 4, 1, false),
        (true, 0, 1, true),
        (true, 1, 1, true),
        (true, 3, 1, true),
        (true, 2, 1, false),
        (false, 0, -1, true),
        (false, 5, -2, true),
        (false, 2, -3, true),
        (false, 1, -5, true),
        (false, 2, -1, false),
        (false, 3, -1, false),
        (false, 4, -2, false),
        (true, 0, -1, true),
        (true, 3, -1, true),
        (true, 1, -2, true),
        (true, 2, -1, false),
    ] {
        let mut book = array_book();
        let before = book.to_json();
        let result = book.edit_axis(0, columns, start, delta, LIMIT);
        assert_eq!(
            result.is_ok(),
            valid,
            "{columns}, {start}, {delta}: {result:?}"
        );
        if !valid {
            assert_eq!(book.to_json(), before);
        }
    }
}

#[test]
fn structural_dynamic_spills_recalculate_after_interior_insertion() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 1, "10"),
            (0, 1, 1, "20"),
            (0, 2, 1, "30"),
            (0, 0, 0, "=B1:B3"),
        ],
        LIMIT,
    )
    .unwrap();
    book.edit_axis(0, false, 1, 1, LIMIT).unwrap();
    assert_eq!(book.input(0, 0, 0), "=B1:B4");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "0");
    assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), "20");
    assert_eq!(book.display(0, 3, 0, LIMIT).unwrap(), "30");
}

#[test]
fn structural_edits_preserve_styles_comments_and_named_expressions() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 2, 1, "12"), (0, 0, 0, "=Total")], LIMIT)
        .unwrap();
    book.sheets[0].cells.get_mut(&(2, 1)).unwrap().format = Some("$0.00".into());
    book.sheets[0].rows.insert(
        2,
        Axis {
            size: Some(40.),
            hidden: true,
            ..Default::default()
        },
    );
    book.sheets[0].comments.push(Comment {
        row: 2,
        column: 1,
        author: "Ada".into(),
        runs: Vec::new(),
    });
    book.options.names.push(NamedExpression {
        name: "Total".into(),
        sheet: None,
        expression: "Sheet1!$B$3".into(),
        openformula: Some("msoxl:=Sheet1!$B$3".into()),
        position: (0, 0, 0),
        compiled: None,
    });
    book.edit_axis(0, false, 1, 2, LIMIT).unwrap();
    assert_eq!(book.display(0, 4, 1, LIMIT).unwrap(), "$12.00");
    assert_eq!(book.sheets[0].rows[&4].size, Some(40.));
    assert!(book.sheets[0].rows[&4].hidden);
    assert_eq!(book.sheets[0].comments[0].row, 4);
    assert_eq!(book.options.names[0].expression, "Sheet1!$B$5");
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "$12.00");
    book.edit_axis(0, false, 4, -1, LIMIT).unwrap();
    assert!(book.sheets[0].rows.is_empty());
    assert!(book.sheets[0].comments.is_empty());
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#REF!");
}

#[test]
fn structural_edits_are_atomic_at_sheet_edges_and_resource_limits() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 1_048_575, 0, "keep"), (0, 0, 16_383, "keep")], LIMIT)
        .unwrap();
    let before = book.to_json();
    for (sheet, columns, start, delta, limit) in [
        (0, false, 0, 1, LIMIT),
        (0, true, 0, 1, LIMIT),
        (0, false, 0, 1, 1),
        (1, false, 0, -1, LIMIT),
        (0, false, 1_048_576, -1, LIMIT),
        (0, false, 1_048_575, -2, LIMIT),
        (0, true, 0, i32::MIN, LIMIT),
    ] {
        assert!(book.edit_axis(sheet, columns, start, delta, limit).is_err());
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn structural_table_columns_filters_and_exports_follow_the_data() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Product"),
            (0, 0, 1, "Amount"),
            (0, 0, 2, "Tax"),
            (0, 1, 0, "Pens"),
            (0, 1, 1, "7"),
            (0, 2, 0, "Paper"),
            (0, 2, 1, "3"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 0, 2, 2], LIMIT).unwrap();
    book.edit(
        &[
            (0, 1, 2, "=[@Amount]*2"),
            (0, 2, 2, "=[@Amount]*2"),
            (0, 5, 0, "=SUM(Sales[Amount])"),
        ],
        LIMIT,
    )
    .unwrap();
    book.filter_table(
        0,
        1,
        Some(super::FilterField {
            custom: true,
            conditions: vec![("greaterThan", "5".into())],
            conjunction: false,
            hidden_rows: None,
        }),
        LIMIT,
    )
    .unwrap();
    book.edit_axis(0, true, 1, 1, LIMIT).unwrap();
    assert_eq!(
        book.options.tables[0].columns,
        vec!["Product", "Column1", "Amount", "Tax"]
    );
    assert_eq!(book.input(0, 0, 1), "Column1");
    assert_eq!(book.display(0, 1, 3, LIMIT).unwrap(), "14");
    assert_eq!(book.display(0, 5, 0, LIMIT).unwrap(), "10");
    assert!(
        book.options.tables[0]
            .filter
            .as_ref()
            .unwrap()
            .fields
            .as_ref()
            .unwrap()
            .contains_key(&2)
    );
    assert_eq!(
        book.filtered_rows(0, LIMIT)
            .unwrap()
            .into_iter()
            .collect::<Vec<_>>(),
        vec![2]
    );
    book.edit_axis(0, false, 1, 1, LIMIT).unwrap();
    assert_eq!(book.options.tables[0].area, [0, 0, 3, 3]);
    assert_eq!(
        book.filtered_rows(0, LIMIT)
            .unwrap()
            .into_iter()
            .collect::<Vec<_>>(),
        vec![3]
    );
    for restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.display(0, 2, 3, LIMIT).unwrap(), "14");
        assert_eq!(restored.display(0, 6, 0, LIMIT).unwrap(), "10");
        assert_eq!(
            restored.options.tables[0].columns,
            vec!["Product", "Column1", "Amount", "Tax"]
        );
    }
    book.edit_axis(0, true, 2, -1, LIMIT).unwrap();
    assert_eq!(book.display(0, 6, 0, LIMIT).unwrap(), "#REF!");
    assert_eq!(book.display(0, 2, 2, LIMIT).unwrap(), "#REF!");
    assert!(book.filtered_rows(0, LIMIT).unwrap().is_empty());
    book.edit_axis(0, false, 0, -1, LIMIT).unwrap();
    assert!(!book.options.tables[0].header);
    Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    book.edit_axis(0, true, 0, -3, LIMIT).unwrap();
    assert!(book.options.tables.is_empty());
}

#[test]
fn structural_reference_scanner_handles_whitespace_reversed_ranges_and_unknown_sheets() {
    let sheets = vec!["Sheet1".into(), "Other".into()];
    let edit = super::editor_structure::AxisEdit {
        sheet: 0,
        columns: false,
        start: 1,
        delta: -2,
    };
    for (source, expected) in [
        ("SUM(A1 : A5)", "SUM(A1:A3)"),
        ("SUM($A$5 : $A$1)", "SUM($A$3:$A$1)"),
        ("A2+A4+Other!A2+Unknown!A2", "#REF!+A2+Other!A2+Unknown!A2"),
        ("SUM(Unknown!1:5)+SUM(1:5)", "SUM(Unknown!1:5)+SUM(1:3)"),
        (
            r#"IF(A2,"A2 ""quoted""",1E5)"#,
            r#"IF(#REF!,"A2 ""quoted""",1E5)"#,
        ),
        ("[book.xlsx]Sheet1!A1:B5+A4", "[book.xlsx]Sheet1!A1:B5+A2"),
        (
            "[book.xlsx]Sheet1!A1 : B5+A4",
            "[book.xlsx]Sheet1!A1 : B5+A2",
        ),
        (
            "'C:\\files\\[book.xlsx]Sheet1'!A1:B5+A4",
            "'C:\\files\\[book.xlsx]Sheet1'!A1:B5+A2",
        ),
    ] {
        assert_eq!(
            super::xlsx_references::map_axis_references(source, &sheets, 0, edit, &mut { LIMIT })
                .unwrap(),
            expected
        );
    }
}

#[test]
fn structural_deleted_filter_header_leaves_valid_metadata() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, "Amount"), (0, 1, 0, "3"), (0, 2, 0, "7")],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 0, 2, 0], LIMIT).unwrap();
    book.filter_table(
        0,
        0,
        Some(super::FilterField {
            custom: true,
            conditions: vec![("greaterThan", "5".into())],
            conjunction: false,
            hidden_rows: None,
        }),
        LIMIT,
    )
    .unwrap();
    book.edit_axis(0, false, 0, -1, LIMIT).unwrap();
    assert!(!book.options.tables[0].header);
    assert_eq!(book.input(0, 0, 0), "3");
    Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
}

#[test]
fn structural_unsupported_reference_edits_leave_original_workbook_untouched() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Other").unwrap();
    book.add_sheet("Summary").unwrap();
    book.edit(
        &[
            (0, 0, 0, "1"),
            (1, 0, 0, "2"),
            (2, 0, 0, "=SUM(Sheet1:Other!A1)"),
        ],
        LIMIT,
    )
    .unwrap();
    let before = book.to_json();
    assert!(
        book.edit_axis(0, false, 0, 1, LIMIT)
            .unwrap_err()
            .contains("3D")
    );
    assert_eq!(book.to_json(), before);
}

#[test]
fn structural_malformed_native_array_fails_without_panicking() {
    let mut book = array_book();
    book.sheets[0].arrays[0].range = [0, 0, 1, 0];
    let before = book.to_json();
    assert!(book.edit_axis(0, false, 0, 1, LIMIT).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn ironcalc_merge_shrunk_to_single_cell_is_removed_and_empty_edge_merge_clamps() {
    let mut book = Spreadsheet::new();
    book.merge_cells(0, &[[1, 1, 1, 2]], false, LIMIT).unwrap();
    book.edit_axis(0, false, 2, -1, LIMIT).unwrap();
    assert!(book.sheets[0].merges.is_empty());
    book.merge_cells(0, &[[1, 1, 2, 1]], false, LIMIT).unwrap();
    book.edit_axis(0, true, 2, -1, LIMIT).unwrap();
    assert!(book.sheets[0].merges.is_empty());
    book.merge_cells(0, &[[1_048_574, 1, 1, 2]], false, LIMIT)
        .unwrap();
    book.edit_axis(0, false, 0, 1, LIMIT).unwrap();
    assert!(book.sheets[0].merges.is_empty());
}

#[test]
fn structural_deletion_retains_every_surviving_cell_in_referenced_ranges() {
    for columns in [false, true] {
        for start in 0..8 {
            for count in 1..4 {
                let mut book = Spreadsheet::new();
                book.add_sheet("Results").unwrap();
                let owned: Vec<_> = (0..8).map(|i| (i, (i + 1).to_string())).collect();
                let edits: Vec<_> = owned
                    .iter()
                    .map(|(i, s)| {
                        (
                            0,
                            if columns { 0 } else { *i },
                            if columns { *i } else { 0 },
                            s.as_str(),
                        )
                    })
                    .collect();
                book.edit(&edits, LIMIT).unwrap();
                book.edit(
                    &[(
                        1,
                        0,
                        0,
                        if columns {
                            "=SUM(Sheet1!B1:F1)"
                        } else {
                            "=SUM(Sheet1!A2:A6)"
                        },
                    )],
                    LIMIT,
                )
                .unwrap();
                book.edit_axis(0, columns, start, -count, LIMIT).unwrap();
                let expected: usize = (1..6)
                    .filter(|i| *i < start || *i >= start + count as usize)
                    .map(|i| i + 1)
                    .sum();
                assert_eq!(
                    book.display(1, 0, 0, LIMIT).unwrap(),
                    expected.to_string(),
                    "{columns} {start} {count}"
                );
            }
        }
    }
}

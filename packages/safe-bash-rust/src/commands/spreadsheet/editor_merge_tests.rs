// Merge cases adapted from IronCalc's base/src/test/test_merged_cells.rs,
// commit f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT; see LICENSE.IronCalc).
use super::{Spreadsheet, Style, model};
use std::sync::Arc;

const LIMIT: usize = 10_000_000;

#[test]
fn merge_moves_single_content_and_formula_text_unchanged() {
    for value in ["heading", "42", "false", "=D1+1", "=SUM(D1;D2)"] {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 3, "8"), (0, 1, 1, value)], LIMIT)
            .unwrap();
        let input = book.input(0, 1, 1);
        book.merge_cells(0, &[[0, 0, 3, 2]], false, LIMIT).unwrap();
        assert_eq!(book.input(0, 0, 0), input);
        assert_eq!(book.input(0, 1, 1), "");
        assert_eq!(book.sheets[0].merges, vec![[0, 0, 3, 2]]);
        book.edit(&[(0, 3, 0, "=B2"), (0, 4, 0, "=SUM(A1:C2)")], LIMIT)
            .unwrap();
        assert_eq!(book.display(0, 3, 0, LIMIT).unwrap(), "0");
        if value == "=D1+1" {
            assert_eq!(book.display(0, 4, 0, LIMIT).unwrap(), "9");
        }
    }
}

#[test]
fn merge_rejects_multiple_contents_and_rolls_back_whole_batch() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 1, "first"), (0, 1, 0, "second"), (0, 1, 1, "third")],
        LIMIT,
    )
    .unwrap();
    let before = book.to_json();
    let error = book
        .merge_cells(0, &[[0, 0, 2, 1], [1, 0, 2, 1]], true, LIMIT)
        .unwrap_err();
    assert!(error.contains("more than one cell has content"));
    assert_eq!(book.to_json(), before);
}

#[test]
fn merge_rejects_invalid_ranges_overlaps_arrays_and_tables() {
    let mut book = Spreadsheet::new();
    for range in [
        [0, 0, 0, 2],
        [0, 0, 2, 0],
        [0, 0, 1, 1],
        [1_048_575, 0, 1, 2],
        [0, 16_383, 2, 1],
        [usize::MAX, 0, 2, 2],
    ] {
        assert!(book.merge_cells(0, &[range], false, LIMIT).is_err());
        assert!(book.sheets[0].merges.is_empty());
    }
    assert!(book.merge_cells(2, &[[0, 0, 2, 2]], false, LIMIT).is_err());
    book.merge_cells(0, &[[1, 1, 2, 2]], false, LIMIT).unwrap();
    let before = book.to_json();
    for range in [[1, 1, 2, 2], [0, 0, 5, 5], [2, 2, 2, 2]] {
        assert!(book.merge_cells(0, &[range], false, LIMIT).is_err());
        assert_eq!(book.to_json(), before);
    }
    assert!(
        book.merge_cells(0, &[[5, 5, 3, 1], [5, 7, 2, 1]], false, LIMIT)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
    book.sheets[0].arrays.push(model::ArrayFormula {
        range: [8, 0, 2, 2],
        expression: "1".into(),
        openformula: None,
        formula_display: None,
    });
    assert!(book.merge_cells(0, &[[9, 1, 2, 2]], false, LIMIT).is_err());
    book.sheets[0].arrays.clear();
    book.add_table(0, "Sales", [10, 0, 12, 1], LIMIT).unwrap();
    assert!(book.merge_cells(0, &[[12, 1, 2, 2]], false, LIMIT).is_err());
}

#[test]
fn merge_without_styles_stays_sparse_even_for_whole_sheet() {
    let mut book = Spreadsheet::new();
    book.merge_cells(0, &[[0, 0, 16_384, 1_048_576]], false, LIMIT)
        .unwrap();
    assert!(book.sheets[0].cells.is_empty());
    assert_eq!(book.sheets[0].merges.len(), 1);
}

#[test]
fn merge_copies_source_style_and_moves_outline_to_perimeter() {
    for (r, c) in [(1, 1), (2, 2), (3, 3)] {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, r, c, "heading")], LIMIT).unwrap();
        let cell = book.sheets[0].cells.get_mut(&(r, c)).unwrap();
        cell.format = Some("0.00".into());
        cell.style = Some(Arc::new(Style {
            attributes: vec![
                ("Back", "FF112233".into()),
                ("HAlign", "right".into()),
                ("WrapText", "1".into()),
            ],
            font: vec![("Bold", "1".into())],
            borders: ["Left", "Right", "Top", "Bottom"]
                .map(|k| (k, 1, "FF123456".into()))
                .into(),
            ..Default::default()
        }));
        book.merge_cells(0, &[[1, 1, 3, 3]], true, LIMIT).unwrap();
        for row in 1..=3 {
            for col in 1..=3 {
                let cell = &book.sheets[0].cells[&(row, col)];
                assert_eq!(cell.format.as_deref(), Some("0.00"));
                let style = cell.style.as_ref().unwrap();
                assert!(style.attributes.contains(&("HAlign", "center".into())));
                assert!(style.attributes.contains(&("WrapText", "1".into())));
                for (key, expected) in [
                    ("Left", col == 1),
                    ("Right", col == 3),
                    ("Top", row == 1),
                    ("Bottom", row == 3),
                ] {
                    assert_eq!(style.borders.iter().any(|(k, _, _)| *k == key), expected);
                }
            }
        }
        assert_eq!(book.input(0, 1, 1), "heading");
    }
}

#[test]
fn merge_empty_range_uses_anchor_style_and_clears_other_styles() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 1, 1, "1%")], LIMIT).unwrap();
    book.edit(&[(0, 1, 1, "")], LIMIT).unwrap();
    book.merge_cells(0, &[[0, 0, 2, 2]], false, LIMIT).unwrap();
    assert!(book.sheets[0].cells.is_empty());
    book.unmerge_cells(0, [0, 0, 2, 2], LIMIT).unwrap();
    book.edit(&[(0, 0, 0, "1%")], LIMIT).unwrap();
    book.edit(&[(0, 0, 0, "")], LIMIT).unwrap();
    book.merge_cells(0, &[[0, 0, 2, 2]], false, LIMIT).unwrap();
    assert_eq!(book.sheets[0].cells.len(), 4);
    assert!(
        book.sheets[0]
            .cells
            .values()
            .all(|c| c.format.as_deref() == Some("0.##########%"))
    );
}

#[test]
fn merge_style_expansion_is_bounded_and_atomic() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "1%")], LIMIT).unwrap();
    let before = book.to_json();
    assert!(
        book.merge_cells(0, &[[0, 0, 16_384, 1_048_576]], false, LIMIT)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
    assert!(book.merge_cells(0, &[[0, 0, 2, 2]], true, 1).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn unmerge_removes_all_intersections_and_preserves_content() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "a"), (0, 0, 3, "b"), (0, 8, 0, "c")], LIMIT)
        .unwrap();
    book.merge_cells(0, &[[0, 0, 2, 2], [0, 3, 2, 2], [8, 0, 2, 2]], false, LIMIT)
        .unwrap();
    book.unmerge_cells(0, [1, 1, 3, 1], LIMIT).unwrap();
    assert_eq!(book.sheets[0].merges, vec![[8, 0, 2, 2]]);
    assert_eq!(book.input(0, 0, 0), "a");
    assert_eq!(book.input(0, 0, 3), "b");
    let before = book.to_json();
    book.unmerge_cells(0, [0, 0, 1, 1], LIMIT).unwrap();
    assert_eq!(book.to_json(), before);
    assert!(book.unmerge_cells(0, [usize::MAX, 0, 2, 2], LIMIT).is_err());
}

#[test]
fn merge_across_and_down_are_atomic_batches() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 1, "a"),
            (0, 1, 1, "b"),
            (0, 4, 0, "c"),
            (0, 4, 1, "d"),
        ],
        LIMIT,
    )
    .unwrap();
    book.merge_cells(0, &[[0, 0, 2, 1], [1, 0, 2, 1]], false, LIMIT)
        .unwrap();
    book.merge_cells(0, &[[3, 0, 1, 2], [3, 1, 1, 2]], false, LIMIT)
        .unwrap();
    assert_eq!(book.input(0, 0, 0), "a");
    assert_eq!(book.input(0, 1, 0), "b");
    assert_eq!(book.input(0, 3, 0), "c");
    assert_eq!(book.input(0, 3, 1), "d");
}

#[test]
fn merged_cells_survive_json_and_excel_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 1, 1, "heading")], LIMIT).unwrap();
    book.merge_cells(0, &[[0, 0, 3, 2]], true, LIMIT).unwrap();
    let restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    assert_eq!(restored.to_json(), book.to_json());
    let imported = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(imported.sheets[0].merges, book.sheets[0].merges);
    assert_eq!(imported.input(0, 0, 0), "heading");
    assert!(
        imported.sheets[0].cells[&(0, 0)]
            .style
            .as_ref()
            .unwrap()
            .attributes
            .contains(&("HAlign", "center".into()))
    );
}

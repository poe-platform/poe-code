use super::{PivotFilter, Spreadsheet, Value};
const LIMIT: usize = 128 * 1024 * 1024;
fn book() -> Spreadsheet {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Group"),
            (0, 0, 1, "Amount"),
            (0, 1, 0, "1"),
            (0, 2, 0, "'1"),
            (0, 3, 0, "TRUE"),
            (0, 4, 0, "'TRUE"),
            (0, 5, 0, "=NA()"),
            (0, 6, 0, ""),
            (0, 7, 0, "East"),
            (0, 8, 0, "EAST"),
            (0, 9, 0, "=1"),
        ],
        LIMIT,
    )
    .unwrap();
    book
}
#[test]
fn pivot_checklist_groups_typed_values_like_the_calculation_engine() {
    let book = book();
    let filter = PivotFilter {
        field: 0,
        selected: Some(vec![
            Value::Number(1.),
            Value::Bool(true),
            Value::Error("#N/A".into()),
            Value::Text("east".into()),
        ]),
    };
    let items = book
        .pivot_filter_values(0, [0, 0, 9, 1], &filter, LIMIT)
        .unwrap();
    assert_eq!(items.len(), 7);
    assert!(
        items
            .iter()
            .any(|(v, _, n, s)| matches!(v, Value::Number(1.)) && *n == 2 && *s)
    );
    assert!(
        items
            .iter()
            .any(|(v, _, n, s)| matches!(v,Value::Text(t) if t=="1") && *n == 1 && !*s)
    );
    assert!(
        items
            .iter()
            .any(|(v, _, _, s)| matches!(v, Value::Bool(true)) && *s)
    );
    assert!(
        items
            .iter()
            .any(|(v, _, _, s)| matches!(v,Value::Text(t) if t=="TRUE") && !*s)
    );
    assert!(
        items
            .iter()
            .any(|(v, _, _, s)| matches!(v,Value::Error(t) if t=="#N/A") && *s)
    );
    assert!(
        items
            .iter()
            .any(|(v, _, n, s)| matches!(v,Value::Text(t) if t=="East") && *n == 2 && *s)
    );
    assert!(
        items
            .iter()
            .any(|(v, label, _, s)| matches!(v, Value::Empty) && label == "(blank)" && !*s)
    );
}
#[test]
fn pivot_checklist_batches_keep_absent_values_and_resolve_case_insensitively() {
    let book = book();
    let filter = PivotFilter {
        field: 0,
        selected: Some(vec![
            Value::Text("missing".into()),
            Value::Text("east".into()),
        ]),
    };
    let items = book
        .pivot_filter_values(0, [0, 0, 9, 1], &filter, LIMIT)
        .unwrap();
    assert!(
        items
            .iter()
            .any(|(v, _, n, s)| matches!(v,Value::Text(t) if t=="missing") && *n == 0 && *s)
    );
    let edited = book
        .pivot_filter_selection(
            0,
            [0, 0, 9, 1],
            &filter,
            &[
                (Value::Text("EAST".into()), false),
                (Value::Bool(true), true),
            ],
            LIMIT,
        )
        .unwrap();
    assert!(
        matches!(edited.selected.as_deref(),Some([Value::Text(t),Value::Bool(true)]) if t=="missing")
    );
    let all = PivotFilter {
        field: 0,
        selected: None,
    };
    assert!(
        book.pivot_filter_selection(0, [0, 0, 9, 1], &all, &[], LIMIT)
            .unwrap()
            .selected
            .is_none()
    );
    let edited = book
        .pivot_filter_selection(
            0,
            [0, 0, 9, 1],
            &all,
            &[
                (Value::Text("eAsT".into()), false),
                (Value::Bool(true), false),
                (Value::Bool(true), true),
            ],
            LIMIT,
        )
        .unwrap();
    assert_eq!(edited.selected.as_ref().unwrap().len(), 6);
    assert!(
        !edited
            .selected
            .as_ref()
            .unwrap()
            .iter()
            .any(|v| matches!(v,Value::Text(t) if t.eq_ignore_ascii_case("east")))
    );
}
#[test]
fn pivot_checklist_reports_formatted_labels_without_merging_distinct_numbers() {
    let mut book = book();
    book.edit(&[(0, 1, 0, "1.1"), (0, 2, 0, "1.2")], LIMIT)
        .unwrap();
    for row in [1, 2] {
        book.sheets[0].cells.get_mut(&(row, 0)).unwrap().format = Some("0".into());
    }
    let items = book
        .pivot_filter_values(
            0,
            [0, 0, 2, 1],
            &PivotFilter {
                field: 0,
                selected: None,
            },
            LIMIT,
        )
        .unwrap();
    assert_eq!(items.len(), 2);
    assert!(
        items
            .iter()
            .all(|(_, label, n, s)| label == "1" && *n == 1 && *s)
    );
}
#[test]
fn pivot_checklist_rejects_invalid_ranges_and_exhausted_work_without_mutation() {
    let book = book();
    let before = book.to_json();
    let filter = PivotFilter {
        field: 0,
        selected: None,
    };
    for (sheet, area) in [
        (1, [0, 0, 9, 1]),
        (0, [0, 0, 0, 1]),
        (0, [0, 2, 9, 1]),
        (0, [0, 0, 1_048_576, 1]),
    ] {
        assert!(
            book.pivot_filter_values(sheet, area, &filter, LIMIT)
                .is_err()
        );
    }
    assert!(
        book.pivot_filter_values(
            0,
            [0, 0, 9, 1],
            &PivotFilter {
                field: 2,
                selected: None
            },
            LIMIT
        )
        .is_err()
    );
    assert!(
        book.pivot_filter_values(0, [0, 0, 9, 1], &filter, 1)
            .is_err()
    );
    assert!(
        book.pivot_filter_selection(
            0,
            [0, 0, 9, 1],
            &filter,
            &[(Value::Number(f64::NAN), true)],
            LIMIT
        )
        .is_err()
    );
    assert_eq!(book.to_json(), before);
}
#[test]
fn xlsxwriter_pivot_filter_authoring_recalculates_and_round_trips() {
    // Original XlsxWriter 238e935a fixture 04 (BSD-2-Clause, LICENSE.XlsxWriter).
    let mut book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/xlsxwriter-pivot-table04.xlsx"),
        LIMIT,
    )
    .unwrap();
    let (id, mut pivot) = book
        .options
        .pivots
        .iter()
        .next()
        .map(|(id, p)| (id.clone(), p.clone()))
        .unwrap();
    let items = book
        .pivot_filter_values(pivot.source_sheet, pivot.source, &pivot.filters[0], LIMIT)
        .unwrap();
    assert!(
        items
            .iter()
            .any(|(v, _, _, s)| matches!(v,Value::Text(t) if t=="August") && *s)
    );
    pivot.filters[0] = book
        .pivot_filter_selection(
            pivot.source_sheet,
            pivot.source,
            &pivot.filters[0],
            &[(Value::Text("August".into()), false)],
            LIMIT,
        )
        .unwrap();
    let total = (pivot.sheet, pivot.row + 5, pivot.column + 1);
    book.set_pivot(&id, Some(pivot), LIMIT).unwrap();
    assert_eq!(
        book.display(total.0, total.1, total.2, LIMIT).unwrap(),
        "263000"
    );
    let restored = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(
        restored.display(total.0, total.1, total.2, LIMIT).unwrap(),
        "263000"
    );
    let pivot = restored.options.pivots.values().next().unwrap();
    let items = restored
        .pivot_filter_values(pivot.source_sheet, pivot.source, &pivot.filters[0], LIMIT)
        .unwrap();
    assert!(
        items
            .iter()
            .any(|(v, _, _, s)| matches!(v,Value::Text(t) if t=="August") && !*s)
    );
}

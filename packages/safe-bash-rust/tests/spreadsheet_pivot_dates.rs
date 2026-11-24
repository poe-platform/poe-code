use safe_bash_rust::commands::spreadsheet::{Spreadsheet, Value};

const LIMIT: usize = 128 * 1024 * 1024;

#[test]
fn date_cache_selections_import_recalculate_and_survive_json_and_excel() {
    let mut book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/pivot-cache-date-selection.xlsx"),
        LIMIT,
    )
    .unwrap();
    let pivot = book.options.pivots.values().next().unwrap().clone();
    assert!(
        matches!(pivot.filters[0].selected.as_deref(), Some([Value::Number(n)]) if *n == 46023.)
    );
    let values = |book: &Spreadsheet| {
        (pivot.row..pivot.row + 6)
            .filter_map(|row| {
                book.display(pivot.sheet, row, pivot.column + 1, LIMIT)
                    .unwrap()
                    .parse::<f64>()
                    .ok()
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(values(&book), vec![10., 10.]);
    book.edit(&[(pivot.source_sheet, 1, 1, "40")], LIMIT)
        .unwrap();
    assert_eq!(values(&book), vec![40., 40.]);
    let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for restored in [&json, &excel] {
        assert_eq!(values(restored), vec![40., 40.]);
    }
}

use super::Spreadsheet;
use mcp_protocol_rust::json::{self, Value as Json};

const LIMIT: usize = 128 * 1024 * 1024;

#[test]
fn pivot_groups_recalculate_source_formulas_and_keep_results_out_of_json() {
    // XlsxWriter 238e935a6980b648f7d7d09832f52e6b0565c2e8,
    // working_with_pivot_tables.rst example (BSD-2-Clause, LICENSE.XlsxWriter).
    let source = "Region\tItem\tVolume\tMonth\nEast\tApple\t=SUM(1000,8000)\tJuly\nWest\tPear\t5000\tJuly\nNorth\tApple\t3000\tAugust\nEast\tGrape\t8000\tAugust\nWest\tApple\t6000\tSeptember\nNorth\tPear\t4000\tSeptember\nEast\tPear\t7000\tOctober\nSouth\tGrape\t2000\tOctober";
    let mut book = Spreadsheet::new();
    book.add_sheet("Pivot").unwrap();
    let edits: Vec<_> = source
        .lines()
        .enumerate()
        .flat_map(|(r, line)| {
            line.split('\t')
                .enumerate()
                .map(move |(c, value)| (0, r, c, value))
        })
        .collect();
    book.edit(&edits, LIMIT).unwrap();
    let mut document = book.to_json();
    let Json::Object(root) = &mut document else {
        panic!()
    };
    let (_, Json::Object(options)) = root
        .iter_mut()
        .find(|(k, _)| k == &"options".encode_utf16().collect::<Vec<_>>())
        .unwrap()
    else {
        panic!()
    };
    options.retain(|(key, _)| key != &"pivots".encode_utf16().collect::<Vec<_>>());
    options.push((
        "pivots".encode_utf16().collect(),
        json::parse(
            br#"{
        "sales":{"name":"Sales","sheet":1,"row":0,"column":0,
        "source_sheet":0,"source":[0,0,8,3],"rows":[0],"columns":[1],
        "values":[{"field":2,"aggregate":"sum","name":"Total Volume"}],
        "filters":[],"row_totals":true,"column_totals":true}
    }"#,
            json::Limits::default(),
        )
        .unwrap(),
    ));
    let mut book = Spreadsheet::from_json(&document, LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 0, LIMIT).unwrap(), "East");
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "9000");
    assert_eq!(book.display(1, 5, 1, LIMIT).unwrap(), "18000");
    assert_eq!(book.display(1, 5, 4, LIMIT).unwrap(), "44000");
    assert!(
        book.sheets[1].cells.is_empty(),
        "Derived pivot output must not become authored cells"
    );
    book.edit(&[(0, 1, 2, "10000"), (0, 10, 0, "=Pivot!E6")], LIMIT)
        .unwrap();
    assert_eq!(book.display(1, 5, 4, LIMIT).unwrap(), "45000");
    assert_eq!(book.display(0, 10, 0, LIMIT).unwrap(), "45000");
    let restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    assert_eq!(restored.display(1, 5, 4, LIMIT).unwrap(), "45000");
    assert!(restored.sheets[1].cells.is_empty());
}

#[test]
fn pivot_output_is_protected_and_failed_edits_are_atomic() {
    use super::{PivotTable, PivotValue};
    let mut book = Spreadsheet::new();
    book.add_sheet("Pivot").unwrap();
    book.edit(
        &[
            (0, 0, 0, "Group"),
            (0, 0, 1, "Value"),
            (0, 1, 0, "a"),
            (0, 1, 1, "10"),
        ],
        LIMIT,
    )
    .unwrap();
    book.set_pivot(
        "pivot",
        Some(PivotTable {
            name: "Summary".into(),
            sheet: 1,
            row: 0,
            column: 0,
            source_sheet: 0,
            source: [0, 0, 1, 1],
            rows: vec![0],
            columns: vec![],
            values: vec![PivotValue {
                field: 1,
                aggregate: "sum".into(),
                name: "Total".into(),
            }],
            filters: vec![],
            row_totals: true,
            column_totals: true,
        }),
        LIMIT,
    )
    .unwrap();
    let before = book.to_json();
    for (r, c) in [(0, 0), (1, 0), (1, 1), (2, 1)] {
        assert!(
            book.edit(&[(1, r, c, "overwrite")], LIMIT).is_err(),
            "Pivot cell {r},{c} was editable"
        );
        assert_eq!(book.to_json(), before);
    }
    assert!(book.edit(&[(0, 1, 1, "20")], 256).is_err());
    assert_eq!(book.to_json(), before);
    assert_eq!(book.display(1, 2, 1, LIMIT).unwrap(), "10");
    book.set_pivot("pivot", None, LIMIT).unwrap();
    book.edit(&[(1, 1, 1, "now editable")], LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "now editable");
}

#[test]
fn pivot_aggregates_use_records_for_totals_and_preserve_types_and_errors() {
    use super::{PivotTable, PivotValue};
    let mut book = Spreadsheet::new();
    book.add_sheet("Pivot").unwrap();
    book.edit(
        &[
            (0, 0, 0, "Group"),
            (0, 0, 1, "Value"),
            (0, 1, 0, "b"),
            (0, 1, 1, "100"),
            (0, 2, 0, "a"),
            (0, 2, 1, "10"),
            (0, 3, 0, "A"),
            (0, 3, 1, "20"),
        ],
        LIMIT,
    )
    .unwrap();
    let aggregates = [
        "sum",
        "count",
        "countNums",
        "average",
        "min",
        "max",
        "product",
        "stdDev",
        "stdDevp",
        "var",
        "varp",
    ];
    book.set_pivot(
        "pivot",
        Some(PivotTable {
            name: "Summary".into(),
            sheet: 1,
            row: 0,
            column: 0,
            source_sheet: 0,
            source: [0, 0, 3, 1],
            rows: vec![0],
            columns: vec![],
            values: aggregates
                .iter()
                .map(|name| PivotValue {
                    field: 1,
                    aggregate: (*name).into(),
                    name: (*name).into(),
                })
                .collect(),
            filters: vec![],
            row_totals: true,
            column_totals: true,
        }),
        LIMIT,
    )
    .unwrap();
    for (column, expected) in [
        (1, "30"),
        (2, "2"),
        (3, "2"),
        (4, "15"),
        (5, "10"),
        (6, "20"),
        (7, "200"),
        (9, "5"),
        (10, "50"),
        (11, "25"),
    ] {
        assert_eq!(
            book.display(1, 1, column, LIMIT).unwrap(),
            expected,
            "column {column}"
        );
    }
    assert_eq!(book.display(1, 1, 0, LIMIT).unwrap(), "a");
    let Some(super::Value::Number(deviation)) = book.cell(1, 1, 8).and_then(|c| c.value.clone())
    else {
        panic!()
    };
    assert!((deviation - 50_f64.sqrt()).abs() < 1e-12);
    let Some(super::Value::Number(average)) = book.cell(1, 3, 4).and_then(|c| c.value.clone())
    else {
        panic!()
    };
    assert!((average - 130. / 3.).abs() < 1e-12);
    book.edit(&[(0, 2, 1, "TRUE"), (0, 3, 1, "'20")], LIMIT)
        .unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "0");
    assert_eq!(book.display(1, 1, 2, LIMIT).unwrap(), "2");
    assert_eq!(book.display(1, 1, 3, LIMIT).unwrap(), "0");
    assert_eq!(book.display(1, 1, 4, LIMIT).unwrap(), "#DIV/0!");
    book.edit(&[(0, 2, 1, "=#N/A")], LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "#N/A");
    assert_eq!(book.display(1, 1, 2, LIMIT).unwrap(), "2");
    assert_eq!(book.display(1, 1, 3, LIMIT).unwrap(), "0");
}

#[test]
fn closedxml_pivot_definition_survives_import_and_reopening() {
    // Original ClosedXML 057f5976c788d97e8eac86d1a528bd5411d9386e
    // Resource/Other/PivotTable/Create/Add_one_column_and_one_value.xlsx (MIT).
    let book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/closedxml-pivot-column.xlsx"),
        LIMIT,
    )
    .unwrap();
    let document = book.to_json();
    let pivots = document.get("options").unwrap().get("pivots");
    assert!(
        matches!(pivots, Some(Json::Object(values)) if values.len() == 1),
        "Import discarded the editable pivot definition"
    );
}

#[test]
fn pivot_xlsx_export_keeps_real_definitions_and_recalculates_after_import() {
    let book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/closedxml-pivot-column.xlsx"),
        LIMIT,
    )
    .unwrap();
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let parts = crate::commands::structured::read_office_archive(&bytes);
    assert!(
        parts
            .keys()
            .any(|name| name.starts_with("xl/pivotTables/") && name.ends_with(".xml")),
        "Export flattened the pivot"
    );
    let mut restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(restored.options.pivots.len(), 1);
    assert_eq!(restored.display(1, 1, 1, LIMIT).unwrap(), "2");
    restored.edit(&[(0, 1, 1, "7")], LIMIT).unwrap();
    assert_eq!(restored.display(1, 1, 1, LIMIT).unwrap(), "7");
    let restored = Spreadsheet::from_json(&restored.to_json(), LIMIT).unwrap();
    assert_eq!(restored.display(1, 1, 1, LIMIT).unwrap(), "7");
}

#[test]
fn pivot_structural_edits_follow_sources_and_protect_results() {
    let mut book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/closedxml-pivot-column.xlsx"),
        LIMIT,
    )
    .unwrap();
    book.edit_axis(0, false, 0, 2, LIMIT).unwrap();
    assert_eq!(
        book.options.pivots.values().next().unwrap().source,
        [2, 0, 3, 1]
    );
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "2");
    book.edit_axis(0, true, 0, 1, LIMIT).unwrap();
    assert_eq!(
        book.options.pivots.values().next().unwrap().source,
        [2, 1, 3, 2]
    );
    book.edit_axis(1, false, 0, 2, LIMIT).unwrap();
    assert_eq!(book.display(1, 3, 1, LIMIT).unwrap(), "2");
    let before = book.to_json();
    assert!(
        book.edit_axis(1, false, 3, 1, LIMIT).is_err(),
        "Inserted inside a pivot result"
    );
    assert_eq!(book.to_json(), before);
    book.rename_sheet(0, "Renamed", LIMIT).unwrap();
    book.edit(&[(0, 3, 2, "9")], LIMIT).unwrap();
    assert_eq!(book.display(1, 3, 1, LIMIT).unwrap(), "9");
    book.add_sheet("Survivor").unwrap();
    let before = book.to_json();
    assert!(
        book.delete_sheet(0, LIMIT).is_err(),
        "Deleting a source silently discarded its pivot"
    );
    assert_eq!(book.to_json(), before);
    book.delete_sheet(1, LIMIT).unwrap();
    assert!(book.options.pivots.is_empty());
    Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
}

#[test]
fn xlsxwriter_pivots_import_grouping_filters_and_multiple_aggregates() {
    // XlsxWriter 238e935a comparison fixtures 03, 04, 06 (LICENSE.XlsxWriter).
    for (bytes, columns, filters, measures) in [
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table03.xlsx").as_slice(),
            1,
            0,
            1,
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table04.xlsx").as_slice(),
            0,
            1,
            1,
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table06.xlsx").as_slice(),
            0,
            0,
            3,
        ),
    ] {
        let book = Spreadsheet::import_xlsx(bytes, LIMIT).unwrap();
        assert_eq!(book.options.pivots.len(), 1);
        let pivot = book.options.pivots.values().next().unwrap();
        assert_eq!(pivot.rows, vec![0]);
        assert_eq!(pivot.columns.len(), columns);
        assert_eq!(pivot.filters.len(), filters);
        assert_eq!(pivot.values.len(), measures);
        assert_eq!(
            book.display(pivot.sheet, pivot.row + 1, pivot.column, LIMIT)
                .unwrap(),
            "East"
        );
        assert!(
            book.spills
                .pivot_ranges
                .contains_key(&(pivot.sheet, pivot.row, pivot.column))
        );
    }
}

#[test]
fn pivot_filters_and_disabled_totals_round_trip_with_typed_selections() {
    use super::{PivotFilter, PivotTable, PivotValue, Value};
    let mut book = Spreadsheet::new();
    book.add_sheet("Pivot").unwrap();
    book.edit(
        &[
            (0, 0, 0, "Group"),
            (0, 0, 1, "Value"),
            (0, 1, 0, "a"),
            (0, 1, 1, "10"),
            (0, 2, 0, "A"),
            (0, 2, 1, "20"),
            (0, 3, 0, "b"),
            (0, 3, 1, "100"),
        ],
        LIMIT,
    )
    .unwrap();
    book.set_pivot(
        "pivot",
        Some(PivotTable {
            name: "Filtered".into(),
            sheet: 1,
            row: 0,
            column: 0,
            source_sheet: 0,
            source: [0, 0, 3, 1],
            rows: vec![0],
            columns: vec![],
            values: vec![PivotValue {
                field: 1,
                aggregate: "sum".into(),
                name: "Total".into(),
            }],
            filters: vec![PivotFilter {
                field: 0,
                selected: Some(vec![Value::Text("a".into())]),
            }],
            row_totals: false,
            column_totals: false,
        }),
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "30");
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let mut restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    let pivot = restored.options.pivots.values().next().unwrap();
    assert!(
        !pivot.row_totals && !pivot.column_totals,
        "Grand totals were re-enabled"
    );
    assert_eq!(restored.display(1, 1, 1, LIMIT).unwrap(), "30");
    assert_eq!(restored.display(1, 2, 1, LIMIT).unwrap(), "");
    restored.edit(&[(0, 3, 0, "a")], LIMIT).unwrap();
    assert_eq!(restored.display(1, 1, 1, LIMIT).unwrap(), "130");
}

#[test]
fn pivot_outputs_reject_typed_paste_clear_merge_and_tables_but_allow_formats() {
    let mut book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/closedxml-pivot-column.xlsx"),
        LIMIT,
    )
    .unwrap();
    let before = book.to_json();
    let cell = book.cell(0, 1, 1).unwrap().into_owned();
    assert!(
        book.replace_cells(vec![(1, 1, 1, Some(cell))], LIMIT)
            .is_err()
    );
    assert!(book.replace_cells(vec![(1, 1, 1, None)], LIMIT).is_err());
    assert!(book.merge_cells(1, &[[0, 0, 2, 2]], false, LIMIT).is_err());
    assert!(book.add_table(1, "OverPivot", [0, 0, 1, 2], LIMIT).is_err());
    assert_eq!(book.to_json(), before);
    let mut style = book.cell(0, 1, 1).unwrap().into_owned();
    style.value = None;
    style.formula = None;
    style.format = Some("0.00".into());
    book.replace_cells(vec![(1, 1, 1, Some(style))], LIMIT)
        .unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "2.00");
}

#[test]
fn pivot_import_page_selection_uses_pivot_item_then_shared_item() {
    use crate::commands::structured::{read_office_archive, write_zip_stored};
    let mut parts = read_office_archive(include_bytes!("fixtures/xlsxwriter-pivot-table04.xlsx"));
    let pivot=String::from_utf8(parts["xl/pivotTables/pivotTable1.xml"].clone()).unwrap()
        .replace("<pageField fld=\"3\" hier=\"-1\"/>","<pageField fld=\"3\" hier=\"-1\" item=\"0\"/>")
        .replace("<pivotField axis=\"axisPage\" showAll=\"0\"><items count=\"1\"><item t=\"default\"/></items></pivotField>","<pivotField axis=\"axisPage\" showAll=\"0\"><items count=\"2\"><item x=\"1\"/><item x=\"0\"/></items></pivotField>");
    assert!(pivot.contains("item=\"0\""));
    assert!(pivot.contains("<item x=\"1\"/>"));
    parts.insert("xl/pivotTables/pivotTable1.xml".into(), pivot.into_bytes());
    let cache=String::from_utf8(parts["xl/pivotCache/pivotCacheDefinition1.xml"].clone()).unwrap()
        .replace("<cacheField name=\"Month\" numFmtId=\"0\"><sharedItems/>","<cacheField name=\"Month\" numFmtId=\"0\"><sharedItems count=\"2\"><s v=\"July\"/><s v=\"August\"/></sharedItems>");
    assert!(cache.contains("v=\"August\""));
    parts.insert(
        "xl/pivotCache/pivotCacheDefinition1.xml".into(),
        cache.into_bytes(),
    );
    let bytes = write_zip_stored(
        &parts
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect::<Vec<_>>(),
    );
    let book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    let pivot = book.options.pivots.values().next().unwrap();
    let selected = pivot.filters[0].selected.as_ref().unwrap();
    assert!(matches!(&selected[..],[super::Value::Text(s)] if s=="August"));
    let expected: f64 = book.sheets[pivot.source_sheet]
        .cells
        .iter()
        .filter(|&(&(r, c), cell)| {
            r > 0
                && c == 3
                && matches!(cell.value.as_ref(),Some(super::Value::Text(s)) if s=="August")
        })
        .map(|(&(r, _), _)| match book.cell(pivot.source_sheet, r, 2).unwrap().value {
            Some(super::Value::Number(n)) => n,
            _ => panic!(),
        })
        .sum();
    let [_, height] = book.spills.pivot_ranges[&(pivot.sheet, pivot.row, pivot.column)];
    assert!(
        matches!(book.cell(pivot.sheet,pivot.row+height-1,pivot.column+1).unwrap().value,Some(super::Value::Number(n)) if n==expected)
    );
}

#[test]
fn pivot_sheet_deletion_shifts_both_bindings_and_column_deletion_shifts_fields() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Source").unwrap();
    book.add_sheet("Pivot").unwrap();
    book.edit(
        &[
            (1, 0, 0, "Unused"),
            (1, 0, 1, "Group"),
            (1, 0, 2, "Value"),
            (1, 1, 0, "x"),
            (1, 1, 1, "a"),
            (1, 1, 2, "10"),
        ],
        LIMIT,
    )
    .unwrap();
    book.set_pivot(
        "pivot",
        Some(super::PivotTable {
            name: "Summary".into(),
            sheet: 2,
            row: 0,
            column: 0,
            source_sheet: 1,
            source: [0, 0, 1, 2],
            rows: vec![1],
            columns: vec![],
            values: vec![super::PivotValue {
                field: 2,
                aggregate: "sum".into(),
                name: "Total".into(),
            }],
            filters: vec![],
            row_totals: true,
            column_totals: true,
        }),
        LIMIT,
    )
    .unwrap();
    book.delete_sheet(0, LIMIT).unwrap();
    assert_eq!(book.options.pivots["pivot"].sheet, 1);
    assert_eq!(book.options.pivots["pivot"].source_sheet, 0);
    book.edit_axis(0, true, 0, -1, LIMIT).unwrap();
    assert_eq!(book.options.pivots["pivot"].rows, vec![0]);
    assert_eq!(book.options.pivots["pivot"].values[0].field, 1);
    assert_eq!(book.display(1, 2, 1, LIMIT).unwrap(), "10");
    book.edit_axis(1, false, 0, -3, LIMIT).unwrap();
    assert!(book.options.pivots.is_empty());
    book.edit(&[(1, 0, 0, "editable")], LIMIT).unwrap();
}

#[test]
fn pivot_failed_definition_change_is_atomic_and_collisions_preserve_cells() {
    let mut book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/closedxml-pivot-column.xlsx"),
        LIMIT,
    )
    .unwrap();
    let (id, pivot) = book
        .options
        .pivots
        .iter()
        .next()
        .map(|(id, p)| (id.clone(), p.clone()))
        .unwrap();
    let before = book.to_json();
    let mut invalid = pivot.clone();
    invalid.values[0].field = 2;
    assert!(book.set_pivot(&id, Some(invalid), LIMIT).is_err());
    assert_eq!(book.to_json(), before);
    assert!(book.set_pivot(&id, Some(pivot.clone()), 300).is_err());
    assert_eq!(book.to_json(), before);
    let mut shifted = pivot.clone();
    shifted.column = 5;
    book.edit(&[(1, 1, 6, "Protected")], LIMIT).unwrap();
    book.set_pivot(&id, Some(shifted), LIMIT).unwrap();
    assert_eq!(book.display(1, 0, 5, LIMIT).unwrap(), "#SPILL!");
    assert_eq!(book.display(1, 1, 6, LIMIT).unwrap(), "Protected");
    book.edit(&[(1, 1, 6, "")], LIMIT).unwrap();
    assert_eq!(book.display(1, 1, 6, LIMIT).unwrap(), "2");
}

#[test]
fn pivot_formula_headers_and_formula_results_preserve_dynamic_dependencies() {
    let mut book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/closedxml-pivot-column.xlsx"),
        LIMIT,
    )
    .unwrap();
    book.edit(
        &[
            (0, 0, 0, "=CHAR(65)"),
            (0, 0, 1, "=CHAR(66)"),
            (0, 1, 1, "=SUM(2,3)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(1, 1, 1, LIMIT).unwrap(), "5");
    book.edit(&[(0, 1, 1, "=Sheet2!B2")], LIMIT).unwrap();
    assert_eq!(book.display(1, 0, 0, LIMIT).unwrap(), "#CIRC!");
}

#[test]
fn pivot_typed_filter_items_survive_excel_string_escaping() {
    use super::{PivotFilter, PivotTable, PivotValue, Value};
    for (input, selected) in [
        ("'_x0041_", Value::Text("_x0041_".into())),
        ("'a\nb\tc", Value::Text("a\nb\tc".into())),
        ("TRUE", Value::Bool(true)),
        ("1", Value::Number(1.)),
        ("", Value::Empty),
    ] {
        let mut book = Spreadsheet::new();
        book.add_sheet("Pivot").unwrap();
        book.edit(
            &[
                (0, 0, 0, "Group"),
                (0, 0, 1, "Value"),
                (0, 1, 0, input),
                (0, 1, 1, "10"),
                (0, 2, 0, "Excluded"),
                (0, 2, 1, "20"),
            ],
            LIMIT,
        )
        .unwrap();
        book.set_pivot(
            "pivot",
            Some(PivotTable {
                name: "Typed".into(),
                sheet: 1,
                row: 0,
                column: 0,
                source_sheet: 0,
                source: [0, 0, 2, 1],
                rows: vec![0],
                columns: vec![],
                values: vec![PivotValue {
                    field: 1,
                    aggregate: "sum".into(),
                    name: "Total".into(),
                }],
                filters: vec![PivotFilter {
                    field: 0,
                    selected: Some(vec![selected]),
                }],
                row_totals: true,
                column_totals: true,
            }),
            LIMIT,
        )
        .unwrap();
        let bytes = book.export_xlsx(LIMIT).unwrap();
        let restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        assert_eq!(restored.display(1, 1, 1, LIMIT).unwrap(), "10", "{input:?}");
    }
}

#[test]
fn pivot_worksheet_relationships_can_live_at_the_package_root() {
    use crate::commands::structured::{read_office_archive, write_zip_stored};
    let mut parts = read_office_archive(include_bytes!("fixtures/xlsxwriter-pivot-table03.xlsx"));
    let worksheet = parts.remove("xl/worksheets/sheet2.xml").unwrap();
    parts.insert("sheet2.xml".into(), worksheet);
    let relationships =
        String::from_utf8(parts.remove("xl/worksheets/_rels/sheet2.xml.rels").unwrap())
            .unwrap()
            .replace("../pivotTables/", "/xl/pivotTables/");
    parts.insert("_rels/sheet2.xml.rels".into(), relationships.into_bytes());
    let relationships = String::from_utf8(parts["xl/_rels/workbook.xml.rels"].clone())
        .unwrap()
        .replace("worksheets/sheet2.xml", "/sheet2.xml");
    parts.insert(
        "xl/_rels/workbook.xml.rels".into(),
        relationships.into_bytes(),
    );
    let bytes = write_zip_stored(
        &parts
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect::<Vec<_>>(),
    );
    let book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(book.options.pivots.len(), 1);
    assert_eq!(book.display(1, 3, 0, LIMIT).unwrap(), "East");
}

#[test]
fn all_xlsxwriter_pivot_comparison_fixtures_keep_their_editable_fields() {
    // All 23 original comparison workbooks from XlsxWriter 238e935a.
    // Expected definitions independently read with OpenPyXL; ordering is by
    // pivot name because OOXML relationship order is not a stable identity.
    let cases = [
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table01.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![], vec![], vec![], vec![])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table02.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![0], vec![], vec![(2, "sum")], vec![])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table03.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![0], vec![1], vec![(2, "sum")], vec![])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table04.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![0], vec![], vec![(2, "sum")], vec![3])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table05.xlsx").as_slice(),
            vec![(
                "PivotTable1",
                1,
                vec![0, 1],
                vec![],
                vec![(2, "sum")],
                vec![],
            )],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table06.xlsx").as_slice(),
            vec![(
                "PivotTable1",
                1,
                vec![0],
                vec![],
                vec![(2, "sum"), (2, "count"), (2, "average")],
                vec![],
            )],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table07.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![0], vec![], vec![(2, "sum")], vec![])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table08.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![0], vec![1], vec![(2, "sum")], vec![])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table09.xlsx").as_slice(),
            vec![(
                "PivotTable1",
                1,
                vec![0, 1],
                vec![],
                vec![(2, "sum")],
                vec![],
            )],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table10.xlsx").as_slice(),
            vec![
                ("PivotTable2", 1, vec![1], vec![], vec![(2, "sum")], vec![]),
                ("PivotTable1", 1, vec![0], vec![], vec![(2, "sum")], vec![]),
            ],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table11.xlsx").as_slice(),
            vec![("PivotTable1", 0, vec![0], vec![], vec![(2, "sum")], vec![])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table12.xlsx").as_slice(),
            vec![
                ("PivotTable2", 1, vec![1], vec![], vec![(2, "sum")], vec![]),
                ("PivotTable1", 1, vec![0], vec![], vec![(2, "sum")], vec![]),
            ],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table13.xlsx").as_slice(),
            vec![(
                "PivotTable1",
                1,
                vec![0, 1],
                vec![],
                vec![(2, "sum")],
                vec![],
            )],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table14.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![0], vec![], vec![(2, "sum")], vec![])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table15.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![], vec![1], vec![(2, "sum")], vec![])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table16.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![], vec![], vec![(2, "sum")], vec![])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table17.xlsx").as_slice(),
            vec![(
                "PivotTable1",
                1,
                vec![0],
                vec![],
                vec![(2, "sum")],
                vec![3, 1],
            )],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table18.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![], vec![], vec![], vec![3])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table19.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![0], vec![], vec![], vec![])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table20.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![0], vec![], vec![(2, "sum")], vec![])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table21.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![0], vec![], vec![(2, "sum")], vec![])],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table22.xlsx").as_slice(),
            vec![(
                "PivotTable1",
                1,
                vec![0],
                vec![1],
                vec![(2, "sum"), (2, "count")],
                vec![],
            )],
        ),
        (
            include_bytes!("fixtures/xlsxwriter-pivot-table23.xlsx").as_slice(),
            vec![("PivotTable1", 1, vec![0], vec![], vec![(2, "sum")], vec![])],
        ),
    ];
    for (case, (bytes, expected)) in cases.into_iter().enumerate() {
        let book = Spreadsheet::import_xlsx(bytes, LIMIT).unwrap();
        for book in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            assert_eq!(
                book.options.pivots.len(),
                expected.len(),
                "fixture {}",
                case + 1
            );
            for (name, sheet, rows, columns, values, filters) in &expected {
                let pivot = book
                    .options
                    .pivots
                    .values()
                    .find(|p| &p.name == name)
                    .unwrap();
                assert_eq!(pivot.sheet, *sheet);
                assert_eq!(&pivot.rows, rows);
                assert_eq!(&pivot.columns, columns);
                assert_eq!(
                    pivot
                        .values
                        .iter()
                        .map(|v| (v.field, v.aggregate.as_str()))
                        .collect::<Vec<_>>(),
                    *values
                );
                assert_eq!(
                    pivot.filters.iter().map(|f| f.field).collect::<Vec<_>>(),
                    *filters
                );
                assert!(
                    book.spills
                        .pivot_ranges
                        .contains_key(&(pivot.sheet, pivot.row, pivot.column)),
                    "fixture {} pivot {name} did not calculate",
                    case + 1
                );
            }
        }
    }
}

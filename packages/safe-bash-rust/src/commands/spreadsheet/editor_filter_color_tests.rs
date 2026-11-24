//! Original LibreOffice color-filter regression workbooks (MPL-2.0).
use super::*;
const LIMIT: usize = 128 * 1024 * 1024;
#[test]
fn libreoffice_color_filter_workbooks_import_and_roundtrip() {
    for (name, bytes) in [
        (
            "tdf142579",
            include_bytes!("fixtures/libreoffice-color-filters/tdf142579.xlsx").as_slice(),
        ),
        (
            "tdf142580",
            include_bytes!("fixtures/libreoffice-color-filters/tdf142580.xlsx").as_slice(),
        ),
        (
            "autofilter-colors",
            include_bytes!("fixtures/libreoffice-color-filters/autofilter-colors.xlsx").as_slice(),
        ),
        (
            "autofilter-colors-fg",
            include_bytes!("fixtures/libreoffice-color-filters/autofilter-colors-fg.xlsx")
                .as_slice(),
        ),
        (
            "tdf145057",
            include_bytes!("fixtures/libreoffice-color-filters/tdf145057.xlsx").as_slice(),
        ),
    ] {
        let book = Spreadsheet::import_xlsx(bytes, LIMIT).unwrap_or_else(|e| panic!("{name}: {e}"));
        let hidden = book.filtered_rows(0, LIMIT).unwrap();
        let (font, color) = match name {
            "tdf142579" => (false, "FF5A8AC6"),
            "tdf142580" => (true, "FF70AD47"),
            "autofilter-colors" => (false, "FFFFD7D7"),
            "autofilter-colors-fg" => (true, "FF3465A4"),
            "tdf145057" => (false, "FF70AD47"),
            _ => unreachable!(),
        };
        assert_eq!(
            criterion(&book),
            &ColorFilter {
                font,
                color: Some(color.into())
            }
        );
        for mut restored in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            assert_eq!(criterion(&restored), criterion(&book), "{name}");
            assert_eq!(restored.filtered_rows(0, LIMIT).unwrap(), hidden, "{name}");
            if !restored.options.tables.is_empty() {
                restored.reapply_table_filter(0, LIMIT).unwrap();
                assert_eq!(
                    restored.filtered_rows(0, LIMIT).unwrap(),
                    hidden,
                    "{name} after reapply"
                );
            }
        }
    }
}

fn field(font: bool, color: Option<&str>) -> FilterField {
    FilterField {
        color: Some(ColorFilter {
            font,
            color: color.map(str::to_owned),
        }),
        dynamic: None,
        top: None,
        date_groups: vec![],
        hidden_rows: None,
        custom: false,
        conditions: vec![],
        conjunction: false,
    }
}
fn criterion(book: &Spreadsheet) -> &ColorFilter {
    book.sheets[0]
        .filter
        .iter()
        .chain(book.options.tables.iter().filter_map(|t| t.filter.as_ref()))
        .flat_map(|f| f.fields.iter().flat_map(|fields| fields.values()))
        .find_map(|f| f.color.as_ref())
        .unwrap()
}
#[test]
fn libreoffice_color_filter_conditional_palette_and_reapply() {
    // colorfilter.py: test_tdf142579 and test_tdf142580, unchanged expected rows.
    for (bytes, font, original, changed, count, hidden, after) in [
        (
            include_bytes!("fixtures/libreoffice-color-filters/tdf142579.xlsx").as_slice(),
            false,
            "FF5A8AC6",
            "FFF8696B",
            7,
            vec![2, 3, 4, 5, 6, 7],
            vec![1, 2, 3, 4, 5, 6],
        ),
        (
            include_bytes!("fixtures/libreoffice-color-filters/tdf142580.xlsx").as_slice(),
            true,
            "FF70AD47",
            "FFED7D31",
            3,
            vec![4, 5, 6, 7, 8],
            vec![1, 2, 3, 7, 8],
        ),
    ] {
        let mut book = Spreadsheet::import_xlsx(bytes, LIMIT).unwrap();
        assert_eq!(
            criterion(&book),
            &ColorFilter {
                font,
                color: Some(original.into())
            }
        );
        assert_eq!(
            book.filtered_rows(0, LIMIT).unwrap(),
            hidden.iter().copied().collect()
        );
        // The editor promotes worksheet autofilters to editable tables.
        let filter = book.sheets[0].filter.take().unwrap();
        book.add_table(0, "Colors", filter.area, LIMIT).unwrap();
        book.options.tables[0].filter = Some(filter);
        assert_eq!(
            book.table_filter_colors(0, 0, font, LIMIT).unwrap().len(),
            count
        );
        book.reapply_table_filter(0, LIMIT).unwrap();
        assert_eq!(
            book.filtered_rows(0, LIMIT).unwrap(),
            hidden.iter().copied().collect()
        );
        book.filter_table(0, 0, Some(field(font, Some(changed))), LIMIT)
            .unwrap();
        assert_eq!(
            book.filtered_rows(0, LIMIT).unwrap(),
            after.iter().copied().collect()
        );
        for mut restored in [
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            assert_eq!(
                criterion(&restored),
                &ColorFilter {
                    font,
                    color: Some(changed.into())
                }
            );
            assert_eq!(
                restored.options.conditional_formats.len(),
                book.options.conditional_formats.len()
            );
            restored.reapply_table_filter(0, LIMIT).unwrap();
            assert_eq!(
                restored.filtered_rows(0, LIMIT).unwrap(),
                after.iter().copied().collect()
            );
        }
    }
}
fn blanks() -> Spreadsheet {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 1, 0, "1"),
            (0, 2, 0, "1"),
            (0, 3, 0, "1"),
            (0, 4, 0, "1"),
            (0, 5, 0, "1"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Colors", [0, 0, 5, 1], LIMIT).unwrap();
    for row in 1..=5 {
        let cell = book.sheets[0].cells.get_mut(&(row, 0)).unwrap();
        cell.value = None;
        cell.style = Some(std::sync::Arc::new(Style {
            attributes: vec![
                ("Shade", "1".into()),
                (
                    "Back",
                    if row <= 2 { "FFC99C00" } else { "FF0369A3" }.into(),
                ),
            ],
            ..Style::default()
        }));
    }
    book
}
#[test]
fn libreoffice_color_filter_styled_empty_cells_and_independent_columns() {
    // subsequent_filters_test2.cxx testBackColorFilter: two gold and three blue empty cells.
    let mut book = blanks();
    assert_eq!(
        book.table_filter_colors(0, 0, false, LIMIT).unwrap(),
        vec![(Some("FF0369A3".into()), 3), (Some("FFC99C00".into()), 2)]
    );
    assert!((1..=5).all(|row| book.input(0, row, 0).is_empty()));
    book.filter_table(0, 0, Some(field(false, Some("00c99c00"))), LIMIT)
        .unwrap();
    assert_eq!(book.filtered_rows(0, LIMIT).unwrap(), [3, 4, 5].into());
    assert!(
        book.table_filter_values(0, 0, LIMIT)
            .unwrap()
            .iter()
            .all(|(_, _, selected)| *selected)
    );
    book.edit(
        &[(0, 1, 1, "keep"), (0, 2, 1, "drop"), (0, 3, 1, "keep")],
        LIMIT,
    )
    .unwrap();
    book.filter_table_selection(0, 1, false, &["keep".into()], &[], LIMIT)
        .unwrap();
    assert_eq!(book.filtered_rows(0, LIMIT).unwrap(), [2, 3, 4, 5].into());
    book.filter_table(0, 0, None, LIMIT).unwrap();
    assert_eq!(book.filtered_rows(0, LIMIT).unwrap(), [2, 4, 5].into());
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        restored.reapply_table_filter(0, LIMIT).unwrap();
        assert_eq!(restored.filtered_rows(0, LIMIT).unwrap(), [2, 4, 5].into());
    }
}
#[test]
fn color_filter_limits_validation_and_saved_snapshot_are_atomic() {
    let mut book = blanks();
    for (candidate, budget) in [
        (field(false, Some("bogus")), LIMIT),
        (field(true, None), LIMIT),
        (
            FilterField {
                custom: true,
                ..field(false, Some("FF0369A3"))
            },
            LIMIT,
        ),
        (
            FilterField {
                dynamic: Some(DynamicFilter {
                    kind: "today".into(),
                    value: None,
                    max_value: None,
                }),
                ..field(false, Some("FF0369A3"))
            },
            LIMIT,
        ),
        (field(false, Some("FF0369A3")), 1),
    ] {
        let before = book.to_json();
        assert!(book.filter_table(0, 0, Some(candidate), budget).is_err());
        assert_eq!(book.to_json(), before);
    }
    assert!(book.table_filter_colors(0, 0, false, 1).is_err());
    assert!(book.table_filter_colors(0, 2, false, LIMIT).is_err());
    book.filter_table(0, 0, Some(field(false, Some("FF0369A3"))), LIMIT)
        .unwrap();
    book.sheets[0].cells.get_mut(&(1, 0)).unwrap().style =
        book.sheets[0].cells[&(3, 0)].style.clone();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.filtered_rows(0, LIMIT).unwrap(), [1, 2].into());
        restored.reapply_table_filter(0, LIMIT).unwrap();
        assert_eq!(restored.filtered_rows(0, LIMIT).unwrap(), [2].into());
    }
}
#[test]
fn color_filter_no_fill_white_default_font_axis_styles_and_conditional_overlay() {
    use std::sync::Arc;
    let mut book = Spreadsheet::new();
    book.add_table(0, "Colors", [0, 0, 5, 0], LIMIT).unwrap();
    let style = |attributes: Vec<(&'static str, String)>| {
        Some(Arc::new(Style {
            attributes,
            ..Style::default()
        }))
    };
    book.sheets[0].columns.insert(
        0,
        Axis {
            style: style(vec![("Shade", "0".into())]),
            ..Axis::default()
        },
    );
    book.sheets[0].rows.insert(
        2,
        Axis {
            style: style(vec![("Back", "FFFFFFFF".into()), ("Shade", "1".into())]),
            ..Axis::default()
        },
    );
    book.sheets[0].rows.insert(
        3,
        Axis {
            style: style(vec![
                ("Back", "FFFF0000".into()),
                ("Shade", "0".into()),
                ("Fore", "00000000".into()),
            ]),
            ..Axis::default()
        },
    );
    book.set_conditional_formats(
        vec![ConditionalFormat {
            sheet: 0,
            ranges: vec![[4, 0, 4, 0]],
            priority: 1,
            stop_if_true: false,
            rule: ConditionalRule::Formula("TRUE".into()),
            style: Style {
                attributes: vec![("Back", "FFFF0000".into())],
                ..Style::default()
            },
            format: None,
        }],
        LIMIT,
    )
    .unwrap();
    let expected = vec![
        (None, 3),
        (Some("FFFF0000".into()), 1),
        (Some("FFFFFFFF".into()), 1),
    ];
    assert_eq!(
        book.table_filter_colors(0, 0, false, LIMIT).unwrap(),
        expected
    );
    assert_eq!(
        book.table_filter_colors(0, 0, true, LIMIT).unwrap(),
        vec![(Some("FF000000".into()), 5)]
    );
    book.filter_table(0, 0, Some(field(false, None)), LIMIT)
        .unwrap();
    assert_eq!(book.filtered_rows(0, LIMIT).unwrap(), [2, 4].into());
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(
            restored.table_filter_colors(0, 0, false, LIMIT).unwrap(),
            expected
        );
        restored.reapply_table_filter(0, LIMIT).unwrap();
        assert_eq!(restored.filtered_rows(0, LIMIT).unwrap(), [2, 4].into());
    }
}
#[test]
fn color_filter_differential_ids_follow_conditional_styles_and_keep_multiple_columns() {
    use crate::commands::structured::read_office_archive;
    let mut book = blanks();
    book.set_conditional_formats(
        vec![ConditionalFormat {
            sheet: 0,
            ranges: vec![[8, 0, 8, 0]],
            priority: 1,
            stop_if_true: false,
            rule: ConditionalRule::Formula("TRUE".into()),
            style: Style {
                attributes: vec![("Back", "FFFFCCCC".into())],
                ..Style::default()
            },
            format: None,
        }],
        LIMIT,
    )
    .unwrap();
    book.filter_table(0, 0, Some(field(false, Some("FFC99C00"))), LIMIT)
        .unwrap();
    book.filter_table(0, 1, Some(field(true, Some("FF000000"))), LIMIT)
        .unwrap();
    let parts = read_office_archive(&book.export_xlsx(LIMIT).unwrap());
    let styles = String::from_utf8(parts["xl/styles.xml"].clone()).unwrap();
    assert!(styles.contains("<dxfs count=\"3\">"));
    let table = String::from_utf8(parts["xl/tables/table1.xml"].clone()).unwrap();
    assert!(table.contains("<colorFilter dxfId=\"1\" cellColor=\"1\"/>"));
    assert!(table.contains("<colorFilter dxfId=\"2\" cellColor=\"0\"/>"));
    let mut restored = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    restored.reapply_table_filter(0, LIMIT).unwrap();
    assert_eq!(restored.filtered_rows(0, LIMIT).unwrap(), [3, 4, 5].into());
    assert!(
        restored.options.conditional_formats[0]
            .style
            .attributes
            .contains(&("Back", "FFFFCCCC".into()))
    );
}

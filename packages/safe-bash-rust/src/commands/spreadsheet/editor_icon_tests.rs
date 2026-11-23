//! SpreadsheetML icon sets, including the Excel 2010 extension forms.
use super::Spreadsheet;
use crate::commands::structured::{read_office_archive, write_zip_stored};
const LIMIT: usize = 20_000_000;
fn workbook(values: &[&str], extra: &str) -> Vec<u8> {
    let mut book = Spreadsheet::new();
    let edits: Vec<_> = values
        .iter()
        .enumerate()
        .map(|(r, v)| (0, r, 0, *v))
        .collect();
    book.edit(&edits, LIMIT).unwrap();
    let mut parts = read_office_archive(&book.export_xlsx(LIMIT).unwrap());
    let xml = String::from_utf8(parts["xl/worksheets/sheet1.xml"].clone()).unwrap();
    parts.insert(
        "xl/worksheets/sheet1.xml".into(),
        xml.replace("</worksheet>", &format!("{extra}</worksheet>"))
            .into_bytes(),
    );
    write_zip_stored(
        &parts
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect::<Vec<_>>(),
    )
}
#[test]
fn standard_icon_sets_open_and_keep_their_rules_when_reopened() {
    let bytes = workbook(
        &["0", "33", "67", "100"],
        r#"<conditionalFormatting sqref="A1:A4"><cfRule type="iconSet" priority="1"><iconSet iconSet="3Arrows"><cfvo type="percent" val="0"/><cfvo type="percent" val="33"/><cfvo type="percent" val="67"/></iconSet></cfRule></conditionalFormatting>"#,
    );
    let book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(book.options.conditional_formats.len(), 1);
    let exported = book.export_xlsx(LIMIT).unwrap();
    let xml = String::from_utf8(read_office_archive(&exported)["xl/worksheets/sheet1.xml"].clone())
        .unwrap();
    assert!(!xml.contains("custom="), "custom is an x14-only attribute");
    let reopened = Spreadsheet::import_xlsx(&exported, LIMIT).unwrap();
    assert_eq!(
        book.options.conditional_formats[0].to_json(),
        reopened.options.conditional_formats[0].to_json()
    );
}

use super::{
    ConditionalFormat, ConditionalIcon, ConditionalRule, ConditionalValue as V, IconSet,
    IconThreshold, Style,
};
fn rule(name: &str, thresholds: Vec<IconThreshold>) -> ConditionalFormat {
    ConditionalFormat {
        sheet: 0,
        ranges: vec![[0, 0, 1_048_575, 16_383]],
        priority: 1,
        stop_if_true: false,
        rule: ConditionalRule::IconSet(IconSet {
            name: name.into(),
            thresholds,
            reverse: false,
            show_value: true,
            custom: vec![],
        }),
        style: Style::default(),
        format: None,
    }
}
fn icons(book: &Spreadsheet, points: &[(usize, usize)]) -> Vec<Option<(String, usize, bool)>> {
    let styles = book.conditional_styles(0, points, LIMIT).unwrap();
    points
        .iter()
        .map(|p| {
            styles
                .get(p)
                .and_then(|a| a.icon.as_ref())
                .map(|i| (i.icon.set.clone(), i.icon.index, i.show_value))
        })
        .collect()
}
fn stops(values: Vec<V>) -> Vec<IconThreshold> {
    values
        .into_iter()
        .map(|value| IconThreshold {
            value,
            greater_equal: true,
        })
        .collect()
}
#[test]
fn icon_threshold_equality_reverse_and_non_numeric_cells() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "-1"),
            (0, 1, 0, "0"),
            (0, 2, 0, "50"),
            (0, 3, 0, "100"),
            (0, 4, 0, "hello"),
            (0, 5, 0, "TRUE"),
            (0, 6, 0, "=1/0"),
            (0, 7, 0, "=\"\""),
        ],
        LIMIT,
    )
    .unwrap();
    let mut format = rule(
        "3Arrows",
        stops(vec![V::Number(0.), V::Number(50.), V::Number(100.)]),
    );
    let points = (0..9).map(|r| (r, 0)).collect::<Vec<_>>();
    for (strict, reverse, expected) in [
        (false, false, [0, 0, 1, 2]),
        (true, false, [0, 0, 0, 1]),
        (true, true, [2, 2, 2, 1]),
    ] {
        let ConditionalRule::IconSet(set) = &mut format.rule else {
            unreachable!()
        };
        for threshold in &mut set.thresholds {
            threshold.greater_equal = !strict;
        }
        set.reverse = reverse;
        set.show_value = false;
        book.set_conditional_formats(vec![format.clone()], LIMIT)
            .unwrap();
        let before = book.to_json();
        for book in [
            &book,
            &Spreadsheet::from_json(&before, LIMIT).unwrap(),
            &Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            let result = icons(book, &points);
            assert_eq!(
                &result[..4],
                &expected.map(|i| Some(("3Arrows".into(), i, false)))
            );
            assert!(result[4..].iter().all(Option::is_none));
        }
        assert_eq!(book.to_json(), before);
    }
    assert!(book.conditional_styles(0, &[(0, 0)], 10).is_err());
}
#[test]
fn icons_use_sparse_statistics_and_rebase_formula_thresholds() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "0"),
            (0, 1, 0, "10"),
            (0, 2, 0, "20"),
            (0, 3, 0, "100"),
        ],
        LIMIT,
    )
    .unwrap();
    let mut format = rule(
        "3Flags",
        stops(vec![V::Min, V::Percentile(50.), V::Formula("$A$3".into())]),
    );
    format.ranges.push([0, 0, 3, 0]); // An overlapping area must not duplicate observations.
    book.set_conditional_formats(vec![format], LIMIT).unwrap();
    assert_eq!(
        icons(&book, &[(0, 0), (1, 0), (2, 0), (3, 0)]),
        [0, 0, 2, 2].map(|i| Some(("3Flags".into(), i, true)))
    );
    book.edit_axis(0, false, 0, 1, LIMIT).unwrap();
    let ConditionalRule::IconSet(set) = &book.options.conditional_formats[0].rule else {
        panic!()
    };
    assert!(matches!(&set.thresholds[2].value,V::Formula(s) if s=="$A$4"));
    book.edit(&[(0, 3, 0, "200")], LIMIT).unwrap();
    assert_eq!(
        icons(&book, &[(1, 0), (2, 0), (3, 0), (4, 0)]),
        [0, 0, 2, 1].map(|i| Some(("3Flags".into(), i, true)))
    );
}
#[test]
fn every_preset_and_custom_icons_roundtrip_through_excel() {
    for name in [
        "3Arrows",
        "3ArrowsGray",
        "3Flags",
        "3TrafficLights1",
        "3TrafficLights2",
        "3Signs",
        "3Symbols",
        "3Symbols2",
        "3Stars",
        "3Triangles",
        "4Arrows",
        "4ArrowsGray",
        "4RedToBlack",
        "4Rating",
        "4TrafficLights",
        "5Arrows",
        "5ArrowsGray",
        "5Rating",
        "5Quarters",
        "5Boxes",
    ] {
        let count = super::icon_set_size(name).unwrap();
        let mut book = Spreadsheet::new();
        let values = (0..count).map(|n| n.to_string()).collect::<Vec<_>>();
        book.edit(
            &values
                .iter()
                .enumerate()
                .map(|(r, s)| (0, r, 0, s.as_str()))
                .collect::<Vec<_>>(),
            LIMIT,
        )
        .unwrap();
        let mut format = rule(
            name,
            stops((0..count).map(|i| V::Number(i as f64)).collect()),
        );
        for custom in [false, true] {
            let ConditionalRule::IconSet(set) = &mut format.rule else {
                panic!()
            };
            if custom {
                set.custom = (0..count)
                    .map(|i| ConditionalIcon {
                        set: if i == 0 {
                            "NoIcons".into()
                        } else {
                            "3Stars".into()
                        },
                        index: i % 3,
                    })
                    .collect();
            }
            book.set_conditional_formats(vec![format.clone()], LIMIT)
                .unwrap();
            let bytes = book.export_xlsx(LIMIT).unwrap();
            let restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
            assert_eq!(
                format.to_json(),
                restored.options.conditional_formats[0].to_json(),
                "{name}"
            );
            let points = (0..count).map(|r| (r, 0)).collect::<Vec<_>>();
            assert_eq!(icons(&book, &points), icons(&restored, &points));
        }
    }
}
#[test]
fn icons_reject_malformed_presets_counts_flags_and_custom_indices() {
    for details in [
        r#"iconSet="Unknown""#,
        r#"iconSet="5Arrows""#,
        r#"reverse="wrong""#,
        r#"showValue="wrong""#,
        r#"custom="1""#,
    ] {
        let xml = format!(
            r#"<conditionalFormatting sqref="A1"><cfRule type="iconSet" priority="1"><iconSet {details}><cfvo type="num" val="0"/><cfvo type="num" val="1"/><cfvo type="num" val="2"/></iconSet></cfRule></conditionalFormatting>"#
        );
        assert!(
            Spreadsheet::import_xlsx(&workbook(&["1"], &xml), LIMIT).is_err(),
            "{details}"
        );
    }
    let mut book = Spreadsheet::new();
    let before = book.to_json();
    let mut format = rule(
        "3Arrows",
        stops(vec![V::Min, V::Percent(33.), V::Percent(67.)]),
    );
    let ConditionalRule::IconSet(set) = &mut format.rule else {
        panic!()
    };
    set.custom = vec![
        ConditionalIcon {
            set: "3Stars".into(),
            index: 3
        };
        3
    ];
    assert!(book.set_conditional_formats(vec![format], LIMIT).is_err());
    assert_eq!(book.to_json(), before);
}
// Original, unmodified IronCalc f936620 cf_tests.xlsx and its worksheet counts.
fn ironcalc_fixture() -> Spreadsheet {
    Spreadsheet::import_xlsx(
        include_bytes!("fixtures/ironcalc-conditional-icons.xlsx"),
        LIMIT,
    )
    .unwrap()
}
#[test]
fn ironcalc_icon_fixture_preserves_all_twenty_sets_including_custom_extensions() {
    let book = ironcalc_fixture();
    assert!(
        book.options
            .conditional_formats
            .iter()
            .any(|r| matches!(&r.rule,ConditionalRule::TimePeriod {period} if period=="yesterday"))
    );
    assert_eq!(
        book.options
            .conditional_formats
            .iter()
            .filter(|r| r.sheet == 0)
            .count(),
        18
    );
    assert_eq!(
        book.options
            .conditional_formats
            .iter()
            .filter(|r| r.sheet == 1)
            .count(),
        20
    );
    for restored in [
        &book,
        &Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        &Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert!(book.options.conditional_formats == restored.options.conditional_formats);
        let book = restored;
        // IronCalc test_cf_lists and test_cf_file retain their counts, positions and colors.
        for (sheet, count) in [18, 20, 3, 4, 3, 2, 4].into_iter().enumerate() {
            assert_eq!(
                book.options
                    .conditional_formats
                    .iter()
                    .filter(|r| r.sheet == sheet)
                    .count(),
                count
            );
        }
        let styles = book
            .conditional_styles(0, &[(3, 0), (4, 0), (5, 0), (6, 0)], LIMIT)
            .unwrap();
        for row in 3..=6 {
            assert!(
                styles[&(row, 0)]
                    .style
                    .attributes
                    .contains(&("Fore", "FF9C0006".into()))
            );
            assert!(
                styles[&(row, 0)]
                    .style
                    .attributes
                    .contains(&("Back", "FFFFC7CE".into()))
            );
        }
        let appearance = book
            .conditional_styles(0, &[(16, 0), (18, 0)], LIMIT)
            .unwrap();
        assert_eq!(
            appearance[&(16, 0)].icon.as_ref().unwrap().icon,
            ConditionalIcon {
                set: "5Arrows".into(),
                index: 0
            }
        );
        assert_eq!(
            appearance[&(18, 0)].icon.as_ref().unwrap().icon,
            ConditionalIcon {
                set: "5Arrows".into(),
                index: 1
            }
        );
        let appearance = book.conditional_styles(1, &[(15, 3)], LIMIT).unwrap();
        assert_eq!(
            appearance[&(15, 3)].icon.as_ref().unwrap().icon,
            ConditionalIcon {
                set: "3Flags".into(),
                index: 0
            }
        );
        assert_eq!(
            book.options
                .conditional_formats
                .iter()
                .filter(|r| r.sheet == 1)
                .count(),
            20
        );
    }
}

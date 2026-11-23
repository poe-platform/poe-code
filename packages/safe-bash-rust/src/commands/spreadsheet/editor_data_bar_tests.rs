//! IronCalc f936620 data-bar semantics (MIT, LICENSE.IronCalc), exercised
//! through actual SpreadsheetML packages and the shared Rust evaluator.
use super::{
    ConditionalFormat, ConditionalRule, ConditionalValue, DataBar, DataBarAppearance, Spreadsheet,
    Style,
};
use crate::commands::structured::{read_office_archive, write_zip_stored};
const LIMIT: usize = 20_000_000;

fn workbook(values: &[&str], range: &str, body: &str) -> Vec<u8> {
    let mut book = Spreadsheet::new();
    let edits: Vec<_> = values
        .iter()
        .enumerate()
        .map(|(r, v)| (0, r, 0, *v))
        .collect();
    book.edit(&edits, LIMIT).unwrap();
    let mut parts = read_office_archive(&book.export_xlsx(LIMIT).unwrap());
    let xml = String::from_utf8(parts["xl/worksheets/sheet1.xml"].clone()).unwrap();
    let xml = xml.replace("</worksheet>", &format!(r#"<conditionalFormatting sqref="{range}"><cfRule type="dataBar" priority="1">{body}</cfRule></conditionalFormatting></worksheet>"#));
    parts.insert("xl/worksheets/sheet1.xml".into(), xml.into_bytes());
    write_zip_stored(
        &parts
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect::<Vec<_>>(),
    )
}

#[test]
fn data_bars_import_standard_excel_rules_and_roundtrip_without_changing_cells() {
    let body = r#"<dataBar showValue="0" minLength="10" maxLength="90"><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar>"#;
    let bytes = workbook(&["1", "2", "3", "4", "5"], "A1:A5", body);
    let book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(book.options.conditional_formats.len(), 1);
    let bars = bars(&book, &[(0, 0), (2, 0), (4, 0)]);
    for ((bar, value), number) in bars.into_iter().zip([0., 0.5, 1.]).zip([1., 3., 5.]) {
        let bar = bar.unwrap();
        assert_eq!(bar.value, value);
        assert_eq!(
            bar.number, number,
            "retain the sign and zero distinction after clamping thresholds"
        );
        assert_eq!(bar.axis_position, 0.);
        assert!(!bar.show_value);
        assert_eq!((bar.min_length, bar.max_length), (10, 90));
    }
    assert_eq!(book.sheets[0].cells.len(), 5);
    let json = book.to_json();
    let restored = Spreadsheet::from_json(&json, LIMIT).unwrap();
    let exported = restored.export_xlsx(LIMIT).unwrap();
    let reopened = Spreadsheet::import_xlsx(&exported, LIMIT).unwrap();
    assert_eq!(reopened.options.conditional_formats.len(), 1);
    assert!(book.options.conditional_formats == reopened.options.conditional_formats);
    assert_eq!(reopened.display(0, 4, 0, LIMIT).unwrap(), "5");
    assert_eq!(book.to_json(), json);
}

fn bars(book: &Spreadsheet, positions: &[(usize, usize)]) -> Vec<Option<DataBarAppearance>> {
    let appearance = book.conditional_styles(0, positions, LIMIT).unwrap();
    positions
        .iter()
        .map(|p| appearance.get(p).and_then(|v| v.data_bar.clone()))
        .collect()
}
fn bar(min: Option<ConditionalValue>, max: Option<ConditionalValue>) -> ConditionalFormat {
    ConditionalFormat {
        sheet: 0,
        ranges: vec![[0, 0, 1_048_575, 16_383]],
        priority: 1,
        stop_if_true: false,
        rule: ConditionalRule::DataBar(DataBar {
            direction: "context".into(),
            axis: "automatic".into(),
            min,
            max,
            positive_color: "FF638EC6".into(),
            negative_color: Some("FFFF0000".into()),
            is_gradient: false,
            show_value: true,
            min_length: 0,
            max_length: 100,
            border_color: None,
            negative_border_color: None,
            axis_color: "FF000000".into(),
        }),
        style: Style::default(),
        format: None,
    }
}
fn with_values(values: &[&str], rule: ConditionalFormat) -> Spreadsheet {
    let mut book = Spreadsheet::new();
    let edits: Vec<_> = values
        .iter()
        .enumerate()
        .map(|(r, v)| (0, r, 0, *v))
        .collect();
    book.edit(&edits, LIMIT).unwrap();
    book.set_conditional_formats(vec![rule], LIMIT).unwrap();
    book
}

#[test]
fn data_bar_automatic_axes_include_zero_for_positive_negative_and_mixed_inputs() {
    for (values, expected, axis) in [
        (["1", "2", "4"], [0.25, 0.5, 1.], 0.),
        (["-4", "-2", "-1"], [0., 0.5, 0.75], 1.),
        (["-2", "0", "2"], [0., 0.5, 1.], 0.5),
    ] {
        let book = with_values(&values, bar(None, None));
        let before = book.to_json();
        for reopened in [
            &book,
            &Spreadsheet::from_json(&before, LIMIT).unwrap(),
            &Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            assert!(book.options.conditional_formats == reopened.options.conditional_formats);
            for (value, expected) in bars(reopened, &[(0, 0), (1, 0), (2, 0)])
                .into_iter()
                .zip(expected)
            {
                let value = value.unwrap();
                assert_eq!(value.value, expected);
                assert_eq!(value.axis_position, axis);
                assert_eq!(value.positive_color, "FF638EC6");
                assert_eq!(value.negative_color, "FFFF0000");
                assert!(!value.is_gradient);
            }
        }
        assert_eq!(book.to_json(), before);
        let parts = read_office_archive(&book.export_xlsx(LIMIT).unwrap());
        let xml = String::from_utf8(parts["xl/worksheets/sheet1.xml"].clone()).unwrap();
        for value in [
            "<x14:id>",
            "type=\"autoMin\"",
            "type=\"autoMax\"",
            "gradient=\"0\"",
            "<x14:negativeFillColor rgb=\"FFFF0000\"",
        ] {
            assert!(xml.contains(value), "{value}");
        }
    }
}

#[test]
fn data_bar_percentiles_reversed_bounds_and_sparse_spills_share_formula_values() {
    use ConditionalValue::*;
    let book = with_values(
        &["0", "10", "20", "100", "hello", "TRUE", "=1/0", "=\"\""],
        bar(Some(Number(0.)), Some(Percentile(50.))),
    );
    let positions = (0..8)
        .map(|r| (r, 0))
        .chain([(1_048_575, 16_383)])
        .collect::<Vec<_>>();
    let result = bars(&book, &positions);
    assert_eq!(
        result[..4]
            .iter()
            .map(|b| b.as_ref().unwrap().value)
            .collect::<Vec<_>>(),
        vec![0., 2. / 3., 1., 1.]
    );
    assert!(result[4..].iter().all(Option::is_none));
    assert_eq!(book.sheets[0].cells.len(), 8);
    let mut book = with_values(&["=SEQUENCE(7)"], bar(Some(Number(7.)), Some(Number(1.))));
    assert_eq!(
        bars(&book, &[(0, 0), (3, 0), (6, 0)])
            .into_iter()
            .map(|b| b.unwrap().value)
            .collect::<Vec<_>>(),
        vec![0., 0.5, 1.]
    );
    assert_eq!(book.sheets[0].cells.len(), 1);
    assert!(book.conditional_styles(0, &[(0, 0)], 100).is_err());
    let before = book.to_json();
    assert!(
        book.set_conditional_formats(vec![bar(None, None)], 1)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
}

#[test]
fn data_bars_keep_extreme_spans_finite_and_equal_bounds_empty() {
    use ConditionalValue::*;
    for values in [
        ["-1e308", "0", "1e308"],
        ["0", "1e-300", "2e-300"],
        ["0", "5e-324", "1e-323"],
    ] {
        let book = with_values(&values, bar(Some(Min), Some(Max)));
        assert_eq!(
            bars(&book, &[(0, 0), (1, 0), (2, 0)])
                .into_iter()
                .map(|b| b.unwrap().value)
                .collect::<Vec<_>>(),
            vec![0., 0.5, 1.]
        );
    }
    let book = with_values(&["7", "7"], bar(Some(Min), Some(Max)));
    assert!(bars(&book, &[(0, 0), (1, 0)]).iter().all(Option::is_none));
    let book = with_values(&["0", "0"], bar(None, None));
    assert!(bars(&book, &[(0, 0), (1, 0)]).iter().all(Option::is_none));
}

#[test]
fn data_bar_threshold_formulas_follow_sheet_and_axis_edits() {
    let mut book = with_values(
        &["1", "2", "3"],
        bar(
            Some(ConditionalValue::Formula("Sheet1!$A$1".into())),
            Some(ConditionalValue::Formula("SUM(Sheet1!$A$1:$A$2)".into())),
        ),
    );
    let expected = bars(&book, &[(0, 0), (1, 0), (2, 0)]);
    book.rename_sheet(0, "Source data", LIMIT).unwrap();
    book.edit_axis(0, false, 0, 1, LIMIT).unwrap();
    assert_eq!(bars(&book, &[(1, 0), (2, 0), (3, 0)]), expected);
    let exported = book.export_xlsx(LIMIT).unwrap();
    let xml = String::from_utf8(read_office_archive(&exported)["xl/worksheets/sheet1.xml"].clone())
        .unwrap();
    assert!(xml.contains("$A$2:$A$3"));
    assert!(xml.contains("Source data"));
    let reopened = Spreadsheet::import_xlsx(&exported, LIMIT).unwrap();
    assert_eq!(bars(&reopened, &[(1, 0), (2, 0), (3, 0)]), expected);
    book.edit(&[(0, 3, 0, "2")], LIMIT).unwrap();
    assert_eq!(bars(&book, &[(3, 0)])[0].as_ref().unwrap().value, 0.5);
}

#[test]
fn data_bars_merge_with_fills_and_respect_priority_and_stop_if_true() {
    let mut book = with_values(&["1", "2", "3", "4", "5"], bar(None, None));
    let mut low = book.options.conditional_formats[0].clone();
    low.priority = 2;
    let high = ConditionalFormat {
        rule: ConditionalRule::Formula("A1>3".into()),
        style: Style {
            attributes: vec![("Back", "FF0000FF".into())],
            ..Style::default()
        },
        stop_if_true: true,
        priority: 1,
        ..low.clone()
    };
    book.set_conditional_formats(vec![low.clone(), high.clone()], LIMIT)
        .unwrap();
    assert!(bars(&book, &[(3, 0), (4, 0)]).iter().all(Option::is_none));
    assert!(
        bars(&book, &[(0, 0), (1, 0), (2, 0)])
            .iter()
            .all(Option::is_some)
    );
    let mut high = high;
    high.stop_if_true = false;
    book.set_conditional_formats(vec![low.clone(), high], LIMIT)
        .unwrap();
    let value = &book.conditional_styles(0, &[(3, 0)], LIMIT).unwrap()[&(3, 0)];
    assert!(value.data_bar.is_some());
    assert!(
        value
            .style
            .attributes
            .contains(&("Back", "FF0000FF".into()))
    );
    let mut upper = low.clone();
    upper.priority = 1;
    let ConditionalRule::DataBar(data) = &mut upper.rule else {
        unreachable!()
    };
    data.positive_color = "FF00FF00".into();
    book.set_conditional_formats(vec![low, upper], LIMIT)
        .unwrap();
    assert_eq!(
        bars(&book, &[(0, 0)])[0].as_ref().unwrap().positive_color,
        "FF00FF00"
    );
}

#[test]
fn data_bar_invalid_models_and_imports_fail_without_mutation_or_invalid_exports() {
    let mut book = with_values(&["1", "2"], bar(None, None));
    let before = book.to_json();
    for invalid in 0..6 {
        let mut rule = bar(None, None);
        let ConditionalRule::DataBar(data) = &mut rule.rule else {
            unreachable!()
        };
        match invalid {
            0 => data.min_length = 101,
            1 => {
                data.min_length = 90;
                data.max_length = 50;
            }
            2 => data.negative_color = Some("no color".into()),
            3 => data.max = Some(ConditionalValue::Number(f64::NAN)),
            4 => data.min = Some(ConditionalValue::Percent(-1.)),
            _ => data.min = Some(ConditionalValue::Formula("=".into())),
        }
        assert!(
            book.set_conditional_formats(vec![rule.clone()], LIMIT)
                .is_err()
        );
        assert_eq!(book.to_json(), before);
        let mut invalid_book = Spreadsheet::from_json(&before, LIMIT).unwrap();
        invalid_book.options.conditional_formats = vec![rule];
        assert!(
            invalid_book
                .conditional_styles(0, &[(0, 0)], LIMIT)
                .is_err()
        );
        assert!(invalid_book.export_xlsx(LIMIT).is_err());
    }
    for body in [
        r#"<dataBar><cfvo type="min"/><color rgb="FF123456"/></dataBar>"#,
        r#"<dataBar><cfvo type="min"/><cfvo type="max"/></dataBar>"#,
        r#"<dataBar minLength="101"><cfvo type="min"/><cfvo type="max"/><color rgb="FF123456"/></dataBar>"#,
        r#"<dataBar showValue="invalid"><cfvo type="min"/><cfvo type="max"/><color rgb="FF123456"/></dataBar>"#,
        r#"<dataBar><cfvo type="percentile" val="101"/><cfvo type="max"/><color rgb="FF123456"/></dataBar>"#,
    ] {
        assert!(
            Spreadsheet::import_xlsx(&workbook(&["1"], "A1", body), LIMIT).is_err(),
            "{body}"
        );
    }
}

fn rewrite_sheet(bytes: &[u8], change: impl FnOnce(&str) -> String) -> Vec<u8> {
    let mut parts = read_office_archive(bytes);
    let xml = String::from_utf8(parts["xl/worksheets/sheet1.xml"].clone()).unwrap();
    parts.insert("xl/worksheets/sheet1.xml".into(), change(&xml).into_bytes());
    write_zip_stored(
        &parts
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect::<Vec<_>>(),
    )
}

#[test]
fn data_bar_extensions_use_linked_ids_thresholds_colors_and_ranges() {
    let book = with_values(&["-4", "2"], bar(None, None));
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let bytes = rewrite_sheet(&bytes, |xml| {
        xml.replace(
            "negativeBarColorSameAsPositive=\"0\"",
            "negativeBarColorSameAsPositive=\"1\"",
        )
        .replace("<color rgb=\"FF638EC6\"/>", "<color indexed=\"5\"/>")
        .replace("x14:", "extended:")
        .replace("xmlns:x14=", "xmlns:extended=")
    });
    let restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    let value = bars(&restored, &[(0, 0)])[0].clone().unwrap();
    assert_eq!(value.positive_color, "FFFFFF00");
    assert_eq!(value.negative_color, "FFFFFF00");
    let ConditionalRule::DataBar(data) = &restored.options.conditional_formats[0].rule else {
        unreachable!()
    };
    assert!(
        data.negative_color.is_none(),
        "preserve the same-as-positive setting"
    );
    let mut recolored = Spreadsheet::from_json(&restored.to_json(), LIMIT).unwrap();
    let ConditionalRule::DataBar(data) = &mut recolored.options.conditional_formats[0].rule else {
        unreachable!()
    };
    data.positive_color = "FF112233".into();
    assert_eq!(
        bars(&recolored, &[(0, 0)])[0]
            .as_ref()
            .unwrap()
            .negative_color,
        "FF112233"
    );
    let reopened = Spreadsheet::import_xlsx(&recolored.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert!(recolored.options.conditional_formats == reopened.options.conditional_formats);
    assert!(!value.is_gradient);
    let bytes = rewrite_sheet(&bytes, |xml| {
        xml.replace(
            "<xm:sqref>A1:XFD1048576</xm:sqref>",
            "<xm:sqref>B1:B2</xm:sqref>",
        )
    });
    let restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(
        restored.options.conditional_formats[0].ranges,
        vec![[0, 1, 1, 1]]
    );
    assert!(
        bars(&restored, &[(0, 0), (1, 0)])
            .iter()
            .all(Option::is_none)
    );
}

#[test]
fn data_bar_extensions_reject_broken_links_and_invalid_appearance() {
    let bytes = with_values(&["1", "2"], bar(None, None))
        .export_xlsx(LIMIT)
        .unwrap();
    for (before, after) in [
        ("<x14:id>", "<x14:id>missing"),
        ("border=\"0\"", "border=\"1\""),
        ("axisPosition=\"automatic\"", "axisPosition=\"invalid\""),
        ("direction=\"context\"", "direction=\"invalid\""),
        (
            "<x14:axisColor rgb=\"FF000000\"/>",
            "<x14:axisColor rgb=\"invalid\"/>",
        ),
        ("type=\"autoMin\"", "type=\"invalid\""),
        (
            "<xm:sqref>A1:XFD1048576</xm:sqref>",
            "<xm:sqref>not a range</xm:sqref>",
        ),
    ] {
        let changed = rewrite_sheet(&bytes, |xml| {
            assert!(xml.contains(before));
            xml.replace(before, after)
        });
        assert!(
            Spreadsheet::import_xlsx(&changed, LIMIT).is_err(),
            "{after}"
        );
    }
    let changed = rewrite_sheet(&bytes, |xml| {
        let start = xml.find("<x14:conditionalFormatting xmlns").unwrap();
        let end = xml.find("</x14:conditionalFormatting>").unwrap()
            + "</x14:conditionalFormatting>".len();
        xml.replace(
            "</x14:conditionalFormattings>",
            &format!("{}</x14:conditionalFormattings>", &xml[start..end]),
        )
    });
    assert!(Spreadsheet::import_xlsx(&changed, LIMIT).is_err());
}

#[test]
fn data_bar_thresholds_follow_table_rename_header_edits_and_conversion() {
    use ConditionalValue::*;
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Amount"),
            (0, 1, 0, "10"),
            (0, 2, 0, "20"),
            (0, 0, 2, "15"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 0, 2, 0], LIMIT).unwrap();
    let mut rule = bar(
        Some(Formula("MIN(Sales[Amount])".into())),
        Some(Formula("MAX(Sales[Amount])".into())),
    );
    rule.ranges = vec![[0, 2, 0, 2]];
    book.set_conditional_formats(vec![rule], LIMIT).unwrap();
    let expected = bars(&book, &[(0, 2)]);
    assert_eq!(expected[0].as_ref().unwrap().value, 0.5);
    book.rename_table(0, "Revenue", LIMIT).unwrap();
    book.edit(&[(0, 0, 0, "Value")], LIMIT).unwrap();
    assert_eq!(bars(&book, &[(0, 2)]), expected);
    book.convert_table_to_range(0, LIMIT).unwrap();
    assert_eq!(bars(&book, &[(0, 2)]), expected);
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(bars(&restored, &[(0, 2)]), expected);
}

#[test]
fn data_bar_real_excel_theme_borders_survive_json_and_excel() {
    // IronCalc f936620 xlsx/tests/conditional_formatting/cf_tests.xlsx, MIT.
    // Keep its workbook/cells/themes and all four data bars; other conditional
    // rule types are removed to isolate this import feature until they are ported.
    let book = Spreadsheet::import_xlsx(include_bytes!("fixtures/ironcalc_data_bars.xlsx"), LIMIT)
        .unwrap();
    assert_eq!(book.options.conditional_formats.len(), 4);
    let json = book.to_json();
    for restored in [
        &book,
        &Spreadsheet::from_json(&json, LIMIT).unwrap(),
        &Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert!(book.options.conditional_formats == restored.options.conditional_formats);
        let values = bars(restored, &[(1, 7), (1, 8), (3, 9)]);
        let yellow = values[0].as_ref().unwrap();
        assert_eq!(yellow.value, 3. / 8.);
        assert_eq!(yellow.axis_position, 0.);
        assert_eq!(yellow.positive_color, "FFFFB628");
        assert!(yellow.is_gradient);
        assert_eq!(yellow.border_color.as_deref(), Some("FFFFB628"));
        assert_eq!(yellow.negative_border_color.as_deref(), Some("FFFF0000"));
        let red = values[1].as_ref().unwrap();
        assert_eq!(red.positive_color, "FFFF555A");
        assert!(!red.is_gradient);
        assert!(red.border_color.is_none());
        let negative = values[2].as_ref().unwrap();
        assert_eq!(negative.value, 0.2);
        assert_eq!(negative.axis_position, 1. / 3.);
        assert_eq!(negative.positive_color, "FF638EC6");
        assert!(!negative.is_gradient);
        assert!(!negative.show_value);
        assert_eq!(negative.border_color.as_deref(), Some("FF000000"));
        assert_eq!(negative.negative_border_color.as_deref(), Some("FFE97132"));
    }
}

#[test]
fn data_bar_custom_axis_color_and_matching_negative_borders_are_preserved() {
    let mut rule = bar(None, None);
    let ConditionalRule::DataBar(data) = &mut rule.rule else {
        unreachable!()
    };
    data.border_color = Some("FF112233".into());
    data.negative_border_color = Some("FF112233".into());
    data.axis_color = "FF223344".into();
    let book = with_values(&["-2", "2"], rule);
    let bytes = rewrite_sheet(&book.export_xlsx(LIMIT).unwrap(), |xml| {
        xml.replace(
            "negativeBarBorderColorSameAsPositive=\"0\"",
            "negativeBarBorderColorSameAsPositive=\"1\"",
        )
        .replace("<x14:negativeBorderColor rgb=\"FF112233\"/>", "")
    });
    let restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(
        bars(&book, &[(0, 0), (1, 0)]),
        bars(&restored, &[(0, 0), (1, 0)])
    );
    assert_eq!(
        bars(&restored, &[(0, 0)])[0].as_ref().unwrap().axis_color,
        "FF223344"
    );
    let mut restored = restored;
    let ConditionalRule::DataBar(data) = &mut restored.options.conditional_formats[0].rule else {
        unreachable!()
    };
    assert!(data.negative_border_color.is_none());
    data.border_color = Some("FF445566".into());
    assert_eq!(
        bars(&restored, &[(0, 0)])[0]
            .as_ref()
            .unwrap()
            .negative_border_color
            .as_deref(),
        Some("FF445566")
    );
    let reopened = Spreadsheet::import_xlsx(&restored.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert!(restored.options.conditional_formats == reopened.options.conditional_formats);
}

// All 13 expected worksheet fixtures from XlsxWriter 238e935 (BSD-2-Clause,
// LICENSE.XlsxWriter). The XML literals are retained without modifications.
#[test]
fn xlsxwriter_data_bar_worksheet_fixtures_preserve_rules() {
    let base = Spreadsheet::new().export_xlsx(LIMIT).unwrap();
    let fixtures = [
        include_str!("fixtures/xlsxwriter_data_bar01.xml"),
        include_str!("fixtures/xlsxwriter_data_bar02.xml"),
        include_str!("fixtures/xlsxwriter_data_bar03.xml"),
        include_str!("fixtures/xlsxwriter_data_bar04.xml"),
        include_str!("fixtures/xlsxwriter_data_bar05.xml"),
        include_str!("fixtures/xlsxwriter_data_bar06.xml"),
        include_str!("fixtures/xlsxwriter_data_bar07.xml"),
        include_str!("fixtures/xlsxwriter_data_bar08.xml"),
        include_str!("fixtures/xlsxwriter_data_bar09.xml"),
        include_str!("fixtures/xlsxwriter_data_bar10.xml"),
        include_str!("fixtures/xlsxwriter_data_bar11.xml"),
        include_str!("fixtures/xlsxwriter_data_bar12.xml"),
        include_str!("fixtures/xlsxwriter_data_bar13.xml"),
    ];
    for (index, xml) in fixtures.into_iter().enumerate() {
        let bytes = rewrite_sheet(&base, |_| xml.trim().to_owned());
        let book = Spreadsheet::import_xlsx(&bytes, LIMIT)
            .unwrap_or_else(|e| panic!("XlsxWriter data_bar{:02}: {e}", index + 1));
        let count = if (2..=6).contains(&index) || (9..=10).contains(&index) {
            3
        } else {
            1
        };
        assert_eq!(
            book.options.conditional_formats.len(),
            count,
            "fixture {}",
            index + 1
        );
        for (i, rule) in book.options.conditional_formats.iter().enumerate() {
            let ConditionalRule::DataBar(b) = &rule.rule else {
                panic!("Expected a data bar")
            };
            assert_eq!(rule.ranges, vec![[i, 0, i, i]]);
            assert_eq!(rule.priority, i + 1);
            assert_eq!(b.positive_color, ["FF638EC6", "FF63C384", "FFFF555A"][i]);
            assert_eq!(
                b.direction,
                if index == 4 {
                    ["leftToRight", "rightToLeft", "context"][i]
                } else {
                    "context"
                }
            );
            assert_eq!(
                b.axis,
                if index == 6 {
                    ["middle", "none", "automatic"][i]
                } else {
                    "automatic"
                }
            );
            assert_eq!(b.show_value, !matches!(index, 7 | 8));
            assert_eq!(b.is_gradient, !(index == 3 && i == 0));
            if index == 4 && i == 2 {
                assert_eq!(b.negative_color.as_deref(), Some("FFFFFF00"));
            }
            if index == 5 && i == 0 {
                assert!(b.negative_color.is_none());
            }
            if index == 6 && i == 2 {
                assert_eq!(b.axis_color, "FF0070C0");
            }
        }
        let json = book.to_json();
        let restored = Spreadsheet::from_json(&json, LIMIT).unwrap();
        assert_eq!(restored.to_json(), json);
        let reopened =
            Spreadsheet::import_xlsx(&restored.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert!(
            book.options.conditional_formats == reopened.options.conditional_formats,
            "fixture {}",
            index + 1
        );
    }
}

#[test]
fn data_bar_axes_directions_and_context_preserve_numeric_geometry() {
    for direction in ["context", "leftToRight", "rightToLeft"] {
        for (axis, expected, zero) in [
            ("automatic", [0., 0.25, 1. / 3., 0.5, 1.], 1. / 3.),
            ("middle", [0.25, 0.4375, 0.5, 0.625, 1.], 0.5),
            ("none", [0., 0.25, 1. / 3., 0.5, 1.], 0.),
        ] {
            let mut rule = bar(None, None);
            let ConditionalRule::DataBar(b) = &mut rule.rule else {
                unreachable!()
            };
            b.direction = direction.into();
            b.axis = axis.into();
            let mut book = with_values(&["-4", "-1", "0", "2", "8"], rule);
            for rtl in [false, true] {
                book.sheets[0].view = vec![("rightToLeft", rtl)];
                let json = book.to_json();
                for restored in [
                    &book,
                    &Spreadsheet::from_json(&json, LIMIT).unwrap(),
                    &Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
                ] {
                    assert!(
                        book.options.conditional_formats == restored.options.conditional_formats
                    );
                    for (appearance, want) in
                        bars(restored, &[(0, 0), (1, 0), (2, 0), (3, 0), (4, 0)])
                            .into_iter()
                            .zip(expected)
                    {
                        let a = appearance.unwrap();
                        assert!(
                            (a.value - want).abs() < 1e-14,
                            "{axis}: {} != {want}",
                            a.value
                        );
                        assert_eq!(a.axis_position, zero);
                        assert_eq!(a.axis_hidden, axis == "none");
                        assert_eq!(
                            a.right_to_left,
                            direction == "rightToLeft" || (direction == "context" && rtl)
                        );
                    }
                }
                assert_eq!(book.to_json(), json);
            }
        }
    }
}

#[test]
fn data_bar_centered_extremes_and_invalid_appearance_are_atomic() {
    for values in [["-1e308", "0", "1e308"], ["-5e-324", "0", "5e-324"]] {
        let mut rule = bar(None, None);
        let ConditionalRule::DataBar(b) = &mut rule.rule else {
            unreachable!()
        };
        b.axis = "middle".into();
        let book = with_values(&values, rule);
        assert_eq!(
            bars(&book, &[(0, 0), (1, 0), (2, 0)])
                .into_iter()
                .map(|a| a.unwrap().value)
                .collect::<Vec<_>>(),
            vec![0., 0.5, 1.]
        );
    }
    let mut book = with_values(&["-4", "0", "8"], bar(None, None));
    let before = book.to_json();
    // Existing JSON omits the newly introduced default fields.
    let json = mcp_protocol_rust::json::stringify(&before);
    assert!(!json.contains("direction"));
    assert!(!json.contains("\"axis\""));
    assert_eq!(
        Spreadsheet::from_json(&before, LIMIT).unwrap().to_json(),
        before
    );
    for field in ["direction", "axis"] {
        let mut rule = book.options.conditional_formats[0].clone();
        let ConditionalRule::DataBar(b) = &mut rule.rule else {
            unreachable!()
        };
        if field == "direction" {
            b.direction = "invalid".into();
        } else {
            b.axis = "invalid".into();
        }
        let decoded = ConditionalFormat::from_json(&rule.to_json()).unwrap();
        assert!(book.set_conditional_formats(vec![decoded], LIMIT).is_err());
        assert_eq!(book.to_json(), before);
        let mut invalid = Spreadsheet::from_json(&before, LIMIT).unwrap();
        invalid.options.conditional_formats = vec![rule];
        assert!(Spreadsheet::from_json(&invalid.to_json(), LIMIT).is_err());
    }
}

#[test]
fn data_bar_excel_fallback_lengths_and_hidden_axis_follow_spreadsheetml() {
    for axis in ["automatic", "middle", "none"] {
        let mut rule = bar(None, None);
        let ConditionalRule::DataBar(b) = &mut rule.rule else {
            unreachable!()
        };
        b.axis = axis.into();
        let book = with_values(&["-2", "1"], rule);
        let xml =
            read_office_archive(&book.export_xlsx(LIMIT).unwrap())["xl/worksheets/sheet1.xml"]
                .clone();
        let xml = String::from_utf8(xml).unwrap();
        assert!(xml.contains("<dataBar showValue=\"1\" minLength=\"10\" maxLength=\"90\">"));
        assert!(xml.contains("<x14:dataBar showValue=\"1\" minLength=\"0\" maxLength=\"100\""));
        assert_eq!(xml.contains("<x14:axisColor"), axis != "none");
        assert!(
            !xml.contains("<x14:fillColor"),
            "linked rules inherit their positive fill from the legacy rule"
        );
    }
}

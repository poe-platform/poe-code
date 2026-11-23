//! Univer 4767b3b309467c283bbd52b725536ca73861e0fc,
//! sheets-conditional-formatting/calculate-unit-v2/__tests__/calculate.color.spec.ts.
//! Copyright 2023-present DreamNum Co., Ltd.; Apache-2.0, LICENSE.Univer.
//! Both original datasets/configurations and every expected RGB value are retained.
use super::{
    ColorScaleThreshold, ConditionalFormat, ConditionalRule, ConditionalValue, Spreadsheet, Style,
};
const LIMIT: usize = 20_000_000;
fn workbook() -> Spreadsheet {
    // test.util.ts: full fixture, including values outside the rule range.
    let mut book = Spreadsheet::new();
    let values: Vec<_> = [9, 7, 7, 7, 7, 7, 1, 10]
        .into_iter()
        .enumerate()
        .flat_map(|(row, count)| {
            (0..count).map(move |column| {
                (
                    row,
                    column,
                    if row == 6 {
                        "0".into()
                    } else {
                        (column + 1).to_string()
                    },
                )
            })
        })
        .collect();
    let edits: Vec<_> = values
        .iter()
        .map(|(r, c, v)| (0, *r, *c, v.as_str()))
        .collect();
    book.edit(&edits, LIMIT).unwrap();
    book
}
fn apply(book: &mut Spreadsheet, thresholds: Vec<ColorScaleThreshold>) {
    book.set_conditional_formats(
        vec![ConditionalFormat {
            sheet: 0,
            ranges: vec![[0, 0, 5, 6]],
            priority: 1,
            stop_if_true: false,
            rule: ConditionalRule::ColorScale { thresholds },
            style: Style::default(),
            format: None,
        }],
        LIMIT,
    )
    .unwrap();
}
fn rgb(book: &Spreadsheet, column: usize) -> String {
    let styles = book.conditional_styles(0, &[(1, column)], LIMIT).unwrap();
    let color = &styles[&(1, column)]
        .style
        .attributes
        .iter()
        .find(|(k, _)| *k == "Back")
        .unwrap()
        .1;
    let [r, g, b] =
        [2, 4, 6].map(|offset| u8::from_str_radix(&color[offset..offset + 2], 16).unwrap());
    format!("rgb({r},{g},{b})")
}
#[test]
fn color_scale_normal_test() {
    let mut book = workbook();
    apply(
        &mut book,
        vec![
            ColorScaleThreshold {
                value: ConditionalValue::Min,
                color: "FFD0D9FB".into(),
            },
            ColorScaleThreshold {
                value: ConditionalValue::Max,
                color: "FF2E55EF".into(),
            },
        ],
    );
    assert_eq!(rgb(&book, 0), "rgb(208,217,251)");
    assert_eq!(rgb(&book, 1), "rgb(181,195,249)");
    assert_eq!(rgb(&book, 2), "rgb(154,173,247)");
    assert_eq!(rgb(&book, 3), "rgb(127,151,245)");
    assert_eq!(rgb(&book, 4), "rgb(100,129,243)");
}
#[test]
fn colors_are_consistent_but_values_are_interchangeable() {
    let mut book = workbook();
    apply(
        &mut book,
        vec![
            ColorScaleThreshold {
                value: ConditionalValue::Number(1.),
                color: "FFD0D9FB".into(),
            },
            ColorScaleThreshold {
                value: ConditionalValue::Number(-5.),
                color: "FF2E55EF".into(),
            },
            ColorScaleThreshold {
                value: ConditionalValue::Number(3.),
                color: "FFE7258F".into(),
            },
        ],
    );
    assert_eq!(rgb(&book, 0), "rgb(46,85,239)");
    assert_eq!(rgb(&book, 1), "rgb(139,61,191)");
    assert_eq!(rgb(&book, 2), "rgb(231,37,143)");
    assert_eq!(rgb(&book, 3), "rgb(231,37,143)");
    assert_eq!(rgb(&book, 6), "rgb(231,37,143)");
}

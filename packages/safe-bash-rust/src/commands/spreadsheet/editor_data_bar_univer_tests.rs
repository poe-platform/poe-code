//! Both Univer 4767b3b3 calculate.databar.spec.ts cases (Apache-2.0,
//! LICENSE.Univer). Original fixtures and expectations; percentage comparisons
//! allow 1e-12 for equivalent floating-point evaluation orders.
use super::{ConditionalFormat, ConditionalRule, ConditionalValue, DataBar, Spreadsheet, Style};
const LIMIT: usize = 20_000_000;
fn workbook(min: f64, max: f64, gradient: bool, show: bool) -> Spreadsheet {
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
    book.set_conditional_formats(
        vec![ConditionalFormat {
            sheet: 0,
            ranges: vec![[0, 0, if min > max { 0 } else { 6 }, 6]],
            priority: 1,
            stop_if_true: false,
            rule: ConditionalRule::DataBar(DataBar {
                direction: "context".into(),
                axis: "automatic".into(),
                min: Some(ConditionalValue::Number(min)),
                max: Some(ConditionalValue::Number(max)),
                is_gradient: gradient,
                show_value: show,
                positive_color: "FFabd91a".into(),
                negative_color: Some("FFffbe38".into()),
                min_length: 0,
                max_length: 100,
                border_color: None,
                negative_border_color: None,
                axis_color: "FF000000".into(),
            }),
            style: Style::default(),
            format: None,
        }],
        LIMIT,
    )
    .unwrap();
    book
}
fn check(book: &Spreadsheet, row: usize, column: usize, expected: Option<(f64, bool, bool)>) {
    let appearance = book.conditional_styles(0, &[(row, column)], LIMIT).unwrap();
    let bar = appearance
        .get(&(row, column))
        .and_then(|v| v.data_bar.as_ref())
        .filter(|b| b.value != b.axis_position);
    if let Some((percent, gradient, show)) = expected {
        let bar = bar.unwrap();
        assert!((bar.value * 100. - percent).abs() < 1e-12);
        assert_eq!(bar.axis_position, 0.);
        assert_eq!(bar.positive_color, "FFabd91a");
        assert_eq!(bar.is_gradient, gradient);
        assert_eq!(bar.show_value, show);
    } else {
        assert!(bar.is_none());
    }
}
#[test]
fn maximum_and_minimum_values_are_corrected_when_minimum_is_greater_than_maximum() {
    let book = workbook(7., 1., false, false);
    check(&book, 0, 0, None);
    check(&book, 0, 6, Some((100., false, false)));
}
#[test]
fn data_bar_normal() {
    let book = workbook(2., 5., true, true);
    check(&book, 1, 0, None);
    check(&book, 1, 1, None);
    check(&book, 1, 2, Some((33.333333333333336, true, true)));
    check(&book, 1, 3, Some((66.66666666666667, true, true)));
    check(&book, 1, 4, Some((100., true, true)));
    check(&book, 6, 0, None);
}

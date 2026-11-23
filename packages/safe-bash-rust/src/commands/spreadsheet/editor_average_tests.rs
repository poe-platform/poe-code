//! SpreadsheetML standard-deviation rules. Apache POI c94ee8ad's
//! EvaluationConditionalFormatRule evaluates them with sample STDEV, using zero
//! deviation for one numeric cell. These boundary regressions independently
//! distinguish that behavior from population deviation and strict comparisons.
use super::{ConditionalFormat, ConditionalRule, Spreadsheet, Style};
use crate::commands::structured::{read_office_archive, write_zip_stored};

const LIMIT: usize = 20_000_000;

fn fixture(values: &[&str], above: bool, equal: bool, deviations: &str) -> Vec<u8> {
    let mut book = Spreadsheet::new();
    for (row, value) in values.iter().enumerate() {
        book.edit(&[(0, row, 0, value)], LIMIT).unwrap();
    }
    book.set_conditional_formats(
        vec![ConditionalFormat {
            sheet: 0,
            ranges: vec![[0, 0, 1_048_575, 16_383], [0, 0, 1, 0]],
            priority: 1,
            stop_if_true: true,
            rule: if above {
                ConditionalRule::AboveAverage
            } else {
                ConditionalRule::BelowAverage
            },
            style: Style {
                attributes: vec![("Back", "FFE2EFDA".into()), ("Shade", "1".into())],
                ..Style::default()
            },
            format: Some("0.0".into()),
        }],
        LIMIT,
    )
    .unwrap();
    let mut parts = read_office_archive(&book.export_xlsx(LIMIT).unwrap());
    let sheet = String::from_utf8(parts["xl/worksheets/sheet1.xml"].clone()).unwrap();
    parts.insert(
        "xl/worksheets/sheet1.xml".into(),
        sheet
            .replace(
                "type=\"aboveAverage\"",
                &format!(
                    "type=\"aboveAverage\" equalAverage=\"{}\" stdDev=\"{deviations}\"",
                    usize::from(equal)
                ),
            )
            .into_bytes(),
    );
    write_zip_stored(
        &parts
            .iter()
            .map(|(name, data)| (name.as_str(), data.as_slice()))
            .collect::<Vec<_>>(),
    )
}
fn matches(book: &Spreadsheet, count: usize) -> Vec<usize> {
    let before = book.to_json();
    let cells: Vec<_> = (0..count).map(|row| (row, 0)).collect();
    let styles = book.conditional_styles(0, &cells, LIMIT).unwrap();
    assert_eq!(book.to_json(), before);
    styles.keys().map(|&(row, _)| row).collect()
}

#[test]
fn conditional_deviation_uses_sample_variance_and_inclusive_boundaries() {
    for above in [true, false] {
        for equal in [true, false] {
            let book =
                Spreadsheet::import_xlsx(&fixture(&["1", "3"], above, equal, "1"), LIMIT).unwrap();
            assert!(
                matches(&book, 2).is_empty(),
                "sample deviation exceeds either distance from the mean"
            );
            let book = Spreadsheet::import_xlsx(
                &fixture(
                    &["10", "30", "50", "'30", "TRUE", "=1/0"],
                    above,
                    equal,
                    "1",
                ),
                LIMIT,
            )
            .unwrap();
            assert_eq!(
                matches(&book, 7),
                if equal {
                    vec![if above { 2 } else { 0 }]
                } else {
                    vec![]
                }
            );
        }
    }
}

#[test]
fn conditional_deviation_multiples_and_zero_variance() {
    for above in [true, false] {
        let values = [
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            if above { "100" } else { "-100" },
        ];
        for (deviations, expected) in [
            ("1", vec![9]),
            ("2", vec![9]),
            ("3", vec![]),
            ("2147483647", vec![]),
        ] {
            let book = Spreadsheet::import_xlsx(&fixture(&values, above, false, deviations), LIMIT)
                .unwrap();
            assert_eq!(matches(&book, 10), expected, "{deviations}");
        }
        for values in [vec![], vec!["5"], vec!["5", "5", "5"], vec!["-0", "0"]] {
            for equal in [true, false] {
                let book =
                    Spreadsheet::import_xlsx(&fixture(&values, above, equal, "2"), LIMIT).unwrap();
                assert_eq!(
                    matches(&book, values.len() + 1),
                    if equal {
                        (0..values.len()).collect::<Vec<_>>()
                    } else {
                        vec![]
                    }
                );
            }
        }
    }
}

#[test]
fn conditional_deviation_retains_extreme_numeric_ranges() {
    for values in [
        ["-1e308", "0", "1e308"],
        ["-1e-300", "0", "1e-300"],
        ["-5e-324", "0", "5e-324"],
        [
            "10000000000000000",
            "10000000000000002",
            "10000000000000004",
        ],
    ] {
        for above in [true, false] {
            let book =
                Spreadsheet::import_xlsx(&fixture(&values, above, true, "1"), LIMIT).unwrap();
            assert_eq!(
                matches(&book, 3),
                vec![if above { 2 } else { 0 }],
                "{values:?}"
            );
        }
    }
}

#[test]
fn conditional_deviation_roundtrips_and_recalculates_without_changing_cells() {
    for above in [true, false] {
        let imported =
            Spreadsheet::import_xlsx(&fixture(&["10", "30", "50"], above, true, "1"), LIMIT)
                .unwrap();
        let json = imported.to_json();
        let restored = Spreadsheet::from_json(&json, LIMIT).unwrap();
        let exported =
            Spreadsheet::import_xlsx(&restored.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        for mut book in [imported, restored, exported] {
            assert_eq!(book.to_json(), json);
            assert_eq!(matches(&book, 3), vec![if above { 2 } else { 0 }]);
            book.edit(&[(0, 1, 0, "50")], LIMIT).unwrap();
            assert_eq!(matches(&book, 3), if above { vec![] } else { vec![0] });
            assert!(book.sheets[0].cells.values().all(|c| c.style.is_none()));
        }
    }
}

#[test]
fn conditional_deviation_validates_spreadsheetml_integer_values() {
    for value in ["1", "+1", " 1 "] {
        let book =
            Spreadsheet::import_xlsx(&fixture(&["10", "30", "50"], true, true, value), LIMIT)
                .unwrap();
        assert_eq!(matches(&book, 3), vec![2]);
    }
    for value in ["0", "00", "+0", " 0 "] {
        let book =
            Spreadsheet::import_xlsx(&fixture(&["10", "30", "50"], true, true, value), LIMIT)
                .unwrap();
        assert_eq!(matches(&book, 3), vec![1, 2]);
    }
    for value in ["-1", "1.5", "2147483648", "garbage", ""] {
        assert!(
            Spreadsheet::import_xlsx(&fixture(&["10", "30", "50"], true, true, value), LIMIT)
                .is_err(),
            "{value}"
        );
    }
}

// Adapted from IronCalc f936620 conditional_formatting/{cell_is,priority,
// stop_if_true}.rs, MIT, LICENSE.IronCalc. Expected matches are unchanged.
use super::{ConditionalFormat, ConditionalRule, Spreadsheet, Style, ValueOperator};
const LIMIT: usize = 20_000_000;
#[test]
fn authored_ranges_use_excel_reference_grammar_and_reject_expressions() {
    let sheets = vec!["First".into(), "Q1, Q2's".into()];
    for (source, scope, expected) in [
        ("$B$4 : A2, D7", 0, vec![[1, 0, 3, 1], [6, 3, 6, 3]]),
        ("'Q1, Q2''s'!B2:C3", 1, vec![[1, 1, 2, 2]]),
        ("B:A, 4:2", 0, vec![[0, 0, 1_048_575, 1], [1, 0, 3, 16_383]]),
        (
            "XFD1048576",
            0,
            vec![[1_048_575, 16_383, 1_048_575, 16_383]],
        ),
    ] {
        assert_eq!(
            super::parse_cell_ranges(source, &sheets, scope, LIMIT).unwrap(),
            expected
        );
    }
    for source in [
        "",
        "A0",
        "XFE1",
        "A1048577",
        "A1+1",
        "A1 B2",
        "A1,",
        ",A1",
        "A1,,B2",
        "Unknown!A1",
        "First!A1",
        "First:'Q1, Q2''s'!A1",
        "SUM(A1)",
        "[other.xlsx]First!A1",
        "#REF!1",
    ] {
        assert!(
            super::parse_cell_ranges(source, &sheets, 1, LIMIT).is_err(),
            "{source}"
        );
    }
    assert!(super::parse_cell_ranges("A1", &sheets, 0, 1).is_err());
}
#[test]
fn conditional_number_display_overrides_formula_formats_without_mutation() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=1/4"), (0, 1, 0, "0.5")], LIMIT)
        .unwrap();
    let mut condition = rule(ValueOperator::GreaterThan, "0", None);
    condition.format = Some("0.0%".into());
    book.set_conditional_formats(vec![condition], LIMIT)
        .unwrap();
    let before = book.to_json();
    let styles = book
        .conditional_styles(0, &[(0, 0), (1, 0)], LIMIT)
        .unwrap();
    assert_eq!(
        book.conditional_display(0, 0, 0, &styles[&(0, 0)], LIMIT)
            .unwrap(),
        "25.0%"
    );
    assert_eq!(
        book.conditional_display(0, 1, 0, &styles[&(1, 0)], LIMIT)
            .unwrap(),
        "50.0%"
    );
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "0.25");
    assert_eq!(book.to_json(), before);
}
fn fill(color: &str) -> Style {
    Style {
        attributes: vec![("Back", format!("FF{color}")), ("Shade", "1".into())],
        ..Style::default()
    }
}

fn import_equal_average(book: &Spreadsheet, above: bool) -> Spreadsheet {
    use crate::commands::structured::{read_office_archive, write_zip_stored};
    let mut parts = read_office_archive(&book.export_xlsx(LIMIT).unwrap());
    let sheet = String::from_utf8(parts["xl/worksheets/sheet1.xml"].clone()).unwrap();
    let marker = format!(
        "type=\"aboveAverage\" aboveAverage=\"{}\"",
        usize::from(above)
    );
    assert!(sheet.contains(&marker));
    parts.insert(
        "xl/worksheets/sheet1.xml".into(),
        sheet
            .replace(&marker, &format!("{marker} equalAverage=\"1\""))
            .into_bytes(),
    );
    let bytes = write_zip_stored(
        &parts
            .iter()
            .map(|(name, data)| (name.as_str(), data.as_slice()))
            .collect::<Vec<_>>(),
    );
    Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap()
}

// Complete two-case average group from Univer's calculate.highlight.spec.ts,
// with its test.util.ts numeric grid and unchanged queried cells/styles.
// Univer 4767b3b309467c283bbd52b725536ca73861e0fc, Apache-2.0, LICENSE.Univer.
// The native adapter imports the equivalent XLSX rule.
#[test]
fn conditional_univer_greater_than_or_equal_average() {
    univer_equal_average(true, (1, 1));
}
#[test]
fn conditional_univer_less_than_or_equal_average() {
    univer_equal_average(false, (1, 0));
}
fn univer_equal_average(above: bool, query: (usize, usize)) {
    let mut book = Spreadsheet::new();
    for (r, columns) in [9, 7, 7, 7, 7, 7, 1, 10].into_iter().enumerate() {
        for c in 0..columns {
            book.edit(
                &[(0, r, c, &if r == 6 { 0 } else { c + 1 }.to_string())],
                LIMIT,
            )
            .unwrap();
        }
    }
    let mut condition = rule(ValueOperator::Equal, "0", None);
    condition.rule = if above {
        ConditionalRule::AboveAverage
    } else {
        ConditionalRule::BelowAverage
    };
    condition.ranges = vec![[0, 0, 2, 2]];
    condition.style = fill("2AEAEA");
    book.set_conditional_formats(vec![condition], LIMIT)
        .unwrap();
    let imported = import_equal_average(&book, above);
    let styles = imported.conditional_styles(0, &[query], LIMIT).unwrap();
    assert!(
        styles[&query]
            .style
            .attributes
            .contains(&("Back", "FF2AEAEA".into()))
    );
}

#[test]
fn conditional_equal_average_sparse_ranges_roundtrip_and_recalculation() {
    for above in [true, false] {
        let mut book = Spreadsheet::new();
        book.edit(
            &[
                (0, 0, 0, "10"),
                (0, 1, 0, "30"),
                (0, 2, 0, "50"),
                (0, 3, 0, "'30"),
                (0, 4, 0, "TRUE"),
                (0, 5, 0, "=1/0"),
            ],
            LIMIT,
        )
        .unwrap();
        let mut condition = rule(ValueOperator::Equal, "0", None);
        condition.rule = if above {
            ConditionalRule::AboveAverage
        } else {
            ConditionalRule::BelowAverage
        };
        condition.ranges = vec![[0, 0, 1_048_575, 16_383], [0, 0, 1, 0]];
        book.set_conditional_formats(vec![condition], LIMIT)
            .unwrap();
        let imported = import_equal_average(&book, above);
        let json = imported.to_json();
        let restored = Spreadsheet::from_json(&json, LIMIT).unwrap();
        let excel = Spreadsheet::import_xlsx(&restored.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        let cells: Vec<_> = (0..7).map(|r| (r, 0)).collect();
        for mut book in [imported, restored, excel] {
            let styles = book.conditional_styles(0, &cells, LIMIT).unwrap();
            assert_eq!(
                styles.keys().copied().collect::<Vec<_>>(),
                if above {
                    vec![(1, 0), (2, 0)]
                } else {
                    vec![(0, 0), (1, 0)]
                }
            );
            assert_eq!(book.to_json(), json);
            book.edit(&[(0, 2, 0, "80")], LIMIT).unwrap();
            let styles = book.conditional_styles(0, &cells, LIMIT).unwrap();
            assert_eq!(
                styles.keys().copied().collect::<Vec<_>>(),
                if above {
                    vec![(2, 0)]
                } else {
                    vec![(0, 0), (1, 0)]
                }
            );
        }
    }
}

fn rule(operator: ValueOperator, first: &str, second: Option<&str>) -> ConditionalFormat {
    ConditionalFormat {
        sheet: 0,
        ranges: vec![[0, 0, 6, 0]],
        priority: 1,
        stop_if_true: false,
        rule: ConditionalRule::CellIs {
            operator,
            formula: first.into(),
            formula2: second.map(str::to_owned),
        },
        style: fill("FF0000"),
        format: None,
    }
}
#[test]
fn conditional_comparisons_preserve_upstream_matches() {
    use ValueOperator::*;
    let mut book = Spreadsheet::new();
    for (row, value) in [1, 2, 4, 8, 16, 32, 64].into_iter().enumerate() {
        book.edit(&[(0, row, 0, &value.to_string())], LIMIT)
            .unwrap();
    }
    let cells: Vec<_> = (0..7).map(|r| (r, 0)).collect();
    for (op, first, second, expected) in [
        (Equal, "8", None, vec![3]),
        (NotEqual, "8", None, vec![0, 1, 2, 4, 5, 6]),
        (GreaterThan, "8", None, vec![4, 5, 6]),
        (GreaterThanOrEqual, "8", None, vec![3, 4, 5, 6]),
        (LessThan, "8", None, vec![0, 1, 2]),
        (LessThanOrEqual, "8", None, vec![0, 1, 2, 3]),
        (Between, "4", Some("16"), vec![2, 3, 4]),
        (NotBetween, "4", Some("16"), vec![0, 1, 5, 6]),
    ] {
        book.set_conditional_formats(vec![rule(op, first, second)], LIMIT)
            .unwrap();
        let styles = book.conditional_styles(0, &cells, LIMIT).unwrap();
        assert_eq!(styles.keys().map(|&(r, _)| r).collect::<Vec<_>>(), expected);
        assert!(styles.values().all(|s| {
            s.style
                .attributes
                .iter()
                .any(|(k, v)| *k == "Back" && v == "FFFF0000")
        }));
        assert!(book.sheets[0].cells.values().all(|c| c.style.is_none()));
    }
}
#[test]
fn conditional_priority_merges_properties_and_stop_if_true() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "10")], LIMIT).unwrap();
    let high = rule(ValueOperator::GreaterThan, "5", None);
    let mut low = high.clone();
    low.priority = 2;
    low.style = fill("00FF00");
    low.style.font.push(("Bold", "1".into()));
    book.set_conditional_formats(vec![low.clone(), high.clone()], LIMIT)
        .unwrap();
    let styles = book.conditional_styles(0, &[(0, 0)], LIMIT).unwrap();
    let s = &styles[&(0, 0)].style;
    assert!(
        s.attributes
            .iter()
            .any(|(k, v)| *k == "Back" && v == "FFFF0000")
    );
    assert!(s.font.iter().any(|(k, v)| *k == "Bold" && v == "1"));
    let mut high = high;
    high.stop_if_true = true;
    book.set_conditional_formats(vec![low, high], LIMIT)
        .unwrap();
    assert!(
        book.conditional_styles(0, &[(0, 0)], LIMIT).unwrap()[&(0, 0)]
            .style
            .font
            .is_empty()
    );
}
#[test]
fn conditional_sparse_ranges_do_not_materialize_the_sheet() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 1_048_575, 0, "10")], LIMIT).unwrap();
    let mut r = rule(ValueOperator::GreaterThan, "5", None);
    r.ranges = vec![[0, 0, 1_048_575, 16_383]];
    book.set_conditional_formats(vec![r], LIMIT).unwrap();
    let result = book
        .conditional_styles(0, &[(0, 0), (1_048_575, 0), (1_048_575, 16_383)], 100_000)
        .unwrap();
    assert_eq!(result.keys().copied().collect::<Vec<_>>(), [(1_048_575, 0)]);
    assert_eq!(book.sheets[0].cells.len(), 1);
}
#[test]
fn conditional_json_validation_and_failure_rollback() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "8")], LIMIT).unwrap();
    book.set_conditional_formats(vec![rule(ValueOperator::Equal, "8", None)], LIMIT)
        .unwrap();
    let snapshot = book.to_json();
    let restored = Spreadsheet::from_json(&snapshot, LIMIT).unwrap();
    assert!(
        restored
            .conditional_styles(0, &[(0, 0)], LIMIT)
            .unwrap()
            .contains_key(&(0, 0))
    );
    let mut invalid = rule(ValueOperator::Equal, "8", None);
    invalid.ranges = vec![[10, 0, 0, 0]];
    assert!(book.set_conditional_formats(vec![invalid], LIMIT).is_err());
    assert_eq!(book.to_json(), snapshot);
    assert!(
        book.set_conditional_formats(vec![rule(ValueOperator::Equal, "8", None)], 1)
            .is_err()
    );
    assert_eq!(book.to_json(), snapshot);
    assert!(book.conditional_styles(0, &[(0, 0)], 1).is_err());
    assert_eq!(book.to_json(), snapshot);
}

#[test]
fn conditional_formula_relative_absolute_and_multiple_areas() {
    let mut book = Spreadsheet::new();
    for r in 0..10 {
        book.edit(&[(0, r, 0, &(r + 1).to_string())], LIMIT)
            .unwrap();
    }
    let mut cf = rule(ValueOperator::Equal, "0", None);
    cf.ranges = vec![[0, 0, 9, 2]];
    cf.rule = ConditionalRule::Formula("=$A1>5".into());
    book.set_conditional_formats(vec![cf.clone()], LIMIT)
        .unwrap();
    let cells: Vec<_> = (0..10).flat_map(|r| (0..3).map(move |c| (r, c))).collect();
    assert_eq!(
        book.conditional_styles(0, &cells, LIMIT)
            .unwrap()
            .keys()
            .copied()
            .collect::<Vec<_>>(),
        (5..10)
            .flat_map(|r| (0..3).map(move |c| (r, c)))
            .collect::<Vec<_>>()
    );
    // IronCalc uses the bounding box's top-left across all areas, not the first area.
    cf.ranges = vec![[3, 3, 7, 3], [9, 1, 9, 3]];
    cf.rule = ConditionalRule::Formula("=$A4>5".into());
    book.set_conditional_formats(vec![cf.clone()], LIMIT)
        .unwrap();
    let cells = vec![(3, 3), (4, 3), (5, 3), (9, 1), (9, 2), (9, 3)];
    assert_eq!(
        book.conditional_styles(0, &cells, LIMIT)
            .unwrap()
            .keys()
            .copied()
            .collect::<Vec<_>>(),
        [(5, 3), (9, 1), (9, 2), (9, 3)]
    );
    cf.rule = ConditionalRule::Formula("=1/0".into());
    book.set_conditional_formats(vec![cf], LIMIT).unwrap();
    assert!(
        book.conditional_styles(0, &cells, LIMIT)
            .unwrap()
            .is_empty()
    );
}
#[test]
fn conditional_text_rules_ignore_case_and_keep_nonnumeric_types() {
    use super::TextOperator::*;
    let mut book = Spreadsheet::new();
    for (r, s) in ["Apple", "Pineapple", "apricot", "banana", "12", "TRUE"]
        .into_iter()
        .enumerate()
    {
        book.edit(&[(0, r, 0, s)], LIMIT).unwrap();
    }
    let cells: Vec<_> = (0..7).map(|r| (r, 0)).collect();
    for (operator, text, rows) in [
        (Contains, "APP", vec![0, 1]),
        (DoesNotContain, "APP", vec![2, 3]),
        (BeginsWith, "ap", vec![0, 2]),
        (EndsWith, "APPLE", vec![0, 1]),
        (Equals, "apple", vec![0]),
    ] {
        let mut cf = rule(ValueOperator::Equal, "0", None);
        cf.rule = ConditionalRule::Text {
            operator,
            value: text.into(),
        };
        book.set_conditional_formats(vec![cf], LIMIT).unwrap();
        assert_eq!(
            book.conditional_styles(0, &cells, LIMIT)
                .unwrap()
                .keys()
                .map(|p| p.0)
                .collect::<Vec<_>>(),
            rows
        );
    }
}
#[test]
fn conditional_duplicates_unique_average_and_top_values() {
    let mut book = Spreadsheet::new();
    let cells: Vec<_> = (0..6).map(|r| (r, 0)).collect();
    for (r, n) in [10, 20, 10, 30, 20, 40].into_iter().enumerate() {
        book.edit(&[(0, r, 0, &n.to_string())], LIMIT).unwrap();
    }
    for (kind, rows) in [
        (ConditionalRule::DuplicateValues, vec![0, 1, 2, 4]),
        (ConditionalRule::UniqueValues, vec![3, 5]),
        (ConditionalRule::AboveAverage, vec![3, 5]),
        (ConditionalRule::BelowAverage, vec![0, 1, 2, 4]),
        (
            ConditionalRule::Top {
                rank: 2,
                percent: false,
                bottom: false,
            },
            vec![3, 5],
        ),
        (
            ConditionalRule::Top {
                rank: 50,
                percent: true,
                bottom: true,
            },
            vec![0, 1, 2, 4],
        ),
    ] {
        let mut cf = rule(ValueOperator::Equal, "0", None);
        cf.rule = kind;
        book.set_conditional_formats(vec![cf], LIMIT).unwrap();
        assert_eq!(
            book.conditional_styles(0, &cells, LIMIT)
                .unwrap()
                .keys()
                .map(|p| p.0)
                .collect::<Vec<_>>(),
            rows
        );
    }
    // Mixed-case text duplicates follow IronCalc's case-insensitive matching.
    for (r, s) in ["rust", "go", "RUST", "python"].into_iter().enumerate() {
        book.edit(&[(0, r, 1, s)], LIMIT).unwrap();
    }
    let mut cf = rule(ValueOperator::Equal, "0", None);
    cf.ranges = vec![[0, 1, 3, 1]];
    cf.rule = ConditionalRule::DuplicateValues;
    book.set_conditional_formats(vec![cf], LIMIT).unwrap();
    assert_eq!(
        book.conditional_styles(0, &[(0, 1), (1, 1), (2, 1), (3, 1)], LIMIT)
            .unwrap()
            .keys()
            .copied()
            .collect::<Vec<_>>(),
        [(0, 1), (2, 1)]
    );
}
#[test]
fn conditional_blank_and_error_rules_include_unstored_cells() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, "0"), (0, 1, 0, "=1/0"), (0, 2, 0, "TRUE")],
        LIMIT,
    )
    .unwrap();
    let cells: Vec<_> = (0..4).map(|r| (r, 0)).collect();
    for (kind, rows) in [
        (ConditionalRule::Blanks, vec![3]),
        (ConditionalRule::NotBlanks, vec![0, 1, 2]),
        (ConditionalRule::Errors, vec![1]),
        (ConditionalRule::NoErrors, vec![0, 2, 3]),
    ] {
        let mut cf = rule(ValueOperator::Equal, "0", None);
        cf.rule = kind;
        book.set_conditional_formats(vec![cf], LIMIT).unwrap();
        assert_eq!(
            book.conditional_styles(0, &cells, LIMIT)
                .unwrap()
                .keys()
                .map(|p| p.0)
                .collect::<Vec<_>>(),
            rows
        );
        let restored = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
        assert_eq!(
            restored.conditional_styles(0, &cells, LIMIT).unwrap().len(),
            rows.len()
        );
    }
}

#[test]
fn conditional_rules_follow_sheet_renames_deletions_and_sheet_indexes() {
    let mut b = Spreadsheet::new();
    b.add_sheet("Inputs").unwrap();
    b.add_sheet("Results").unwrap();
    b.edit(&[(1, 0, 0, "10")], LIMIT).unwrap();
    let mut cf = rule(ValueOperator::Equal, "0", None);
    cf.sheet = 2;
    cf.ranges = vec![[0, 0, 1, 0]];
    cf.rule = ConditionalRule::Formula("=Inputs!$A$1>5".into());
    b.set_conditional_formats(vec![cf], LIMIT).unwrap();
    b.rename_sheet(1, "Source data", LIMIT).unwrap();
    assert!(
        b.conditional_styles(2, &[(0, 0), (1, 0)], LIMIT)
            .unwrap()
            .len()
            == 2
    );
    b.delete_sheet(0, LIMIT).unwrap();
    assert_eq!(b.options.conditional_formats[0].sheet, 1);
    assert!(
        b.conditional_styles(1, &[(0, 0), (1, 0)], LIMIT)
            .unwrap()
            .len()
            == 2
    );
    b.delete_sheet(0, LIMIT).unwrap();
    assert!(
        b.conditional_styles(0, &[(0, 0)], LIMIT)
            .unwrap()
            .is_empty()
    );
    b.add_sheet("Survivor").unwrap();
    b.delete_sheet(0, LIMIT).unwrap();
    assert!(b.options.conditional_formats.is_empty());
}
#[test]
fn conditional_axis_edits_rebase_deleted_origins_and_preserve_absolute_references() {
    for columns in [false, true] {
        let mut b = Spreadsheet::new();
        b.add_sheet("Other").unwrap();
        for i in 0..6 {
            let (r, c) = if columns { (0, i) } else { (i, 0) };
            b.edit(
                &[(0, r, c, &i.to_string()), (1, r, c, &i.to_string())],
                LIMIT,
            )
            .unwrap();
        }
        let mut cf = rule(ValueOperator::Equal, "0", None);
        cf.ranges = if columns {
            vec![[0, 0, 0, 5]]
        } else {
            vec![[0, 0, 5, 0]]
        };
        cf.rule = ConditionalRule::Formula("=AND(A1=Other!A1,A1>2)".into());
        b.set_conditional_formats(vec![cf.clone()], LIMIT).unwrap();
        b.edit_axis(0, columns, 0, -1, LIMIT).unwrap();
        let cells: Vec<_> = (0..5)
            .map(|i| if columns { (0, i) } else { (i, 0) })
            .collect();
        // Cross-sheet relative references must shift to the deleted origin's successor.
        assert_eq!(
            b.conditional_styles(0, &cells, LIMIT)
                .unwrap()
                .keys()
                .copied()
                .collect::<Vec<_>>(),
            cells[2..].to_vec()
        );
        b.edit_axis(0, columns, 0, 2, LIMIT).unwrap();
        assert_eq!(
            b.options.conditional_formats[0].ranges,
            if columns {
                vec![[0, 2, 0, 6]]
            } else {
                vec![[2, 0, 6, 0]]
            }
        );
        b.edit_axis(0, columns, 2, -5, LIMIT).unwrap();
        assert!(b.options.conditional_formats.is_empty());
        // Absolute references into a deleted row/column must become #REF!, not silently move.
        let mut b = Spreadsheet::new();
        b.edit(&[(0, 0, 0, "10"), (0, 1, 1, "20")], LIMIT).unwrap();
        cf.ranges = vec![[0, 0, 3, 3]];
        cf.rule = ConditionalRule::Formula("=$A$1>5".into());
        b.set_conditional_formats(vec![cf], LIMIT).unwrap();
        b.edit_axis(0, columns, 0, -1, LIMIT).unwrap();
        assert!(
            b.conditional_styles(0, &[(0, 0), (1, 1)], LIMIT)
                .unwrap()
                .is_empty()
        );
    }
}
#[test]
fn conditional_multi_area_anchor_moves_after_an_entire_area_is_removed() {
    let mut b = Spreadsheet::new();
    b.add_sheet("Other").unwrap();
    b.edit(&[(1, 9, 2, "10"), (1, 10, 2, "0")], LIMIT).unwrap();
    let mut cf = rule(ValueOperator::Equal, "0", None);
    cf.ranges = vec![[0, 0, 1, 0], [9, 2, 10, 2]];
    cf.rule = ConditionalRule::Formula("=Other!A1>5".into());
    b.set_conditional_formats(vec![cf], LIMIT).unwrap();
    b.edit_axis(0, false, 0, -2, LIMIT).unwrap();
    assert_eq!(b.options.conditional_formats[0].ranges, vec![[7, 2, 8, 2]]);
    assert_eq!(
        b.conditional_styles(0, &[(7, 2), (8, 2)], LIMIT)
            .unwrap()
            .keys()
            .copied()
            .collect::<Vec<_>>(),
        [(7, 2)]
    );
}
#[test]
fn conditional_structured_references_follow_table_and_header_changes() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[(0, 0, 0, "Amount"), (0, 1, 0, "10"), (0, 2, 0, "20")],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Sales", [0, 0, 2, 0], LIMIT).unwrap();
    let mut cf = rule(ValueOperator::Equal, "0", None);
    cf.ranges = vec![[0, 2, 2, 2]];
    cf.rule = ConditionalRule::Formula("=SUM(Sales[Amount])=30".into());
    b.set_conditional_formats(vec![cf], LIMIT).unwrap();
    b.rename_table(0, "Revenue", LIMIT).unwrap();
    assert_eq!(
        b.conditional_styles(0, &[(0, 2), (1, 2)], LIMIT)
            .unwrap()
            .len(),
        2
    );
    b.edit(&[(0, 0, 0, "Value")], LIMIT).unwrap();
    assert_eq!(
        b.conditional_styles(0, &[(0, 2), (1, 2)], LIMIT)
            .unwrap()
            .len(),
        2
    );
    b.convert_table_to_range(0, LIMIT).unwrap();
    assert_eq!(
        b.conditional_styles(0, &[(0, 2), (1, 2)], LIMIT)
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn conditional_xlsx_roundtrip_preserves_rules_and_differential_properties() {
    use super::TextOperator;
    let mut b = Spreadsheet::new();
    b.add_sheet("Other").unwrap();
    b.edit(
        &[
            (0, 0, 0, "10"),
            (0, 1, 0, "20"),
            (0, 2, 0, "10"),
            (0, 3, 0, "Apple"),
            (0, 4, 0, "=1/0"),
        ],
        LIMIT,
    )
    .unwrap();
    let rules = vec![
        ConditionalRule::Formula("A1>15".into()),
        ConditionalRule::CellIs {
            operator: ValueOperator::Between,
            formula: "10".into(),
            formula2: Some("20".into()),
        },
        ConditionalRule::Text {
            operator: TextOperator::Contains,
            value: "APP".into(),
        },
        ConditionalRule::Text {
            operator: TextOperator::DoesNotContain,
            value: "APP".into(),
        },
        ConditionalRule::Text {
            operator: TextOperator::BeginsWith,
            value: "a".into(),
        },
        ConditionalRule::Text {
            operator: TextOperator::EndsWith,
            value: "E".into(),
        },
        ConditionalRule::Text {
            operator: TextOperator::Equals,
            value: "Apple".into(),
        },
        ConditionalRule::DuplicateValues,
        ConditionalRule::UniqueValues,
        ConditionalRule::AboveAverage,
        ConditionalRule::BelowAverage,
        ConditionalRule::AboveOrEqualAverage,
        ConditionalRule::BelowOrEqualAverage,
        ConditionalRule::AverageDeviation {
            above: true,
            equal: false,
            deviations: 2,
        },
        ConditionalRule::AverageDeviation {
            above: false,
            equal: true,
            deviations: 3,
        },
        ConditionalRule::Top {
            rank: 2,
            percent: false,
            bottom: false,
        },
        ConditionalRule::Top {
            rank: 50,
            percent: true,
            bottom: true,
        },
        ConditionalRule::Blanks,
        ConditionalRule::NotBlanks,
        ConditionalRule::Errors,
        ConditionalRule::NoErrors,
    ];
    let coords: Vec<_> = (0..7).map(|r| (r, 0)).collect();
    for (index, kind) in rules.into_iter().enumerate() {
        let mut cf = rule(ValueOperator::Equal, "0", None);
        cf.rule = kind;
        cf.priority = index + 2;
        cf.stop_if_true = true;
        cf.ranges.push([9, 2, 11, 2]);
        cf.style.font = vec![("Bold", "0".into()), ("Italic", "1".into())];
        cf.style.attributes.push(("Fore", "FF123456".into()));
        cf.format = Some("0.00\" & <units>\"".into());
        b.set_conditional_formats(vec![cf], LIMIT).unwrap();
        let bytes = b.export_xlsx(LIMIT).unwrap();
        let restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        assert_eq!(
            restored.options.conditional_formats.len(),
            1,
            "rule {index}"
        );
        let before = &b.options.conditional_formats[0];
        let after = &restored.options.conditional_formats[0];
        assert!(before.rule == after.rule, "rule {index}");
        assert_eq!(before.ranges, after.ranges);
        assert_eq!(before.priority, after.priority);
        assert_eq!(before.stop_if_true, after.stop_if_true);
        assert_eq!(before.format, after.format);
        let style = &after.style;
        assert_eq!(style.font, before.style.font);
        assert_eq!(style.family, "");
        assert!(style.borders.is_empty());
        assert_eq!(style.attributes.len(), before.style.attributes.len());
        for item in &before.style.attributes {
            assert!(style.attributes.contains(item));
        }
        assert_eq!(
            b.conditional_styles(0, &coords, LIMIT)
                .unwrap()
                .keys()
                .copied()
                .collect::<Vec<_>>(),
            restored
                .conditional_styles(0, &coords, LIMIT)
                .unwrap()
                .keys()
                .copied()
                .collect::<Vec<_>>()
        );
        assert!(
            restored.sheets[0]
                .cells
                .values()
                .all(|cell| cell.style.as_ref().is_none_or(|s| !s
                    .attributes
                    .iter()
                    .any(|(k, v)| *k == "Back" && v == "FFFF0000")))
        );
    }
}

#[test]
fn conditional_xlsx_writes_separate_differential_styles_and_escaped_formulas() {
    let mut b = Spreadsheet::new();
    b.edit(&[(0, 0, 0, "10")], LIMIT).unwrap();
    let mut first = rule(ValueOperator::LessThan, "20", None);
    first.style = Style::default();
    first.style.font.push(("Bold", "1".into()));
    let mut second = rule(ValueOperator::GreaterThan, "5", None);
    second.priority = 2;
    second.rule = ConditionalRule::Formula("AND(A1<20,A1>5)".into());
    b.set_conditional_formats(vec![first, second], LIMIT)
        .unwrap();
    let bytes = b.export_xlsx(LIMIT).unwrap();
    let parts = crate::commands::structured::read_office_archive(&bytes);
    let styles = String::from_utf8(parts["xl/styles.xml"].clone()).unwrap();
    let worksheet = String::from_utf8(parts["xl/worksheets/sheet1.xml"].clone()).unwrap();
    assert!(styles.contains("<dxfs count=\"2\">"));
    assert!(styles.contains("<dxf><font><b val=\"1\"/></font></dxf>"));
    assert!(worksheet.contains("dxfId=\"0\""));
    assert!(worksheet.contains("dxfId=\"1\""));
    assert!(worksheet.contains("AND(A1&lt;20,A1&gt;5)"));
    let restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    let styles = restored.conditional_styles(0, &[(0, 0)], LIMIT).unwrap();
    let style = &styles[&(0, 0)].style;
    assert!(style.font.contains(&("Bold", "1".into())));
    assert!(style.attributes.contains(&("Back", "FFFF0000".into())));
    assert!(b.export_xlsx(1).is_err());
}

#[test]
fn conditional_xlsx_reads_excel_background_only_dxf_without_defaulting_other_properties() {
    use crate::commands::structured::{read_office_archive, write_zip_stored};
    let mut b = Spreadsheet::new();
    b.edit(&[(0, 0, 0, "10"), (0, 1, 0, "3")], LIMIT).unwrap();
    let bytes = b.export_xlsx(LIMIT).unwrap();
    let mut parts = read_office_archive(&bytes);
    let styles=String::from_utf8(parts["xl/styles.xml"].clone()).unwrap().replace("</styleSheet>","<dxfs count=\"1\"><dxf><font><color rgb=\"FF006100\"/></font><fill><patternFill><bgColor rgb=\"FFC6EFCE\"/></patternFill></fill></dxf></dxfs></styleSheet>");
    parts.insert("xl/styles.xml".into(), styles.into_bytes());
    let sheet=String::from_utf8(parts["xl/worksheets/sheet1.xml"].clone()).unwrap().replace("<printOptions/>","<conditionalFormatting sqref=\"A1:A2 C9:C10\"><cfRule type=\"cellIs\" dxfId=\"0\" priority=\"1\" operator=\"greaterThan\" stopIfTrue=\"1\"><formula>5</formula></cfRule></conditionalFormatting><printOptions/>");
    parts.insert("xl/worksheets/sheet1.xml".into(), sheet.into_bytes());
    let bytes = write_zip_stored(
        &parts
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect::<Vec<_>>(),
    );
    let imported = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(imported.options.conditional_formats.len(), 1);
    let rule = &imported.options.conditional_formats[0];
    assert_eq!(rule.ranges, [[0, 0, 1, 0], [8, 2, 9, 2]]);
    assert!(rule.stop_if_true);
    assert!(rule.style.font.is_empty());
    assert!(rule.style.family.is_empty());
    assert!(rule.style.borders.is_empty());
    assert!(rule.style.attributes.contains(&("Fore", "FF006100".into())));
    assert!(rule.style.attributes.contains(&("Back", "FFC6EFCE".into())));
    assert!(rule.style.attributes.contains(&("Shade", "1".into())));
    assert_eq!(
        imported
            .conditional_styles(0, &[(0, 0), (1, 0)], LIMIT)
            .unwrap()
            .keys()
            .copied()
            .collect::<Vec<_>>(),
        [(0, 0)]
    );
}

#[test]
fn conditional_xlsx_preserves_explicit_font_border_alignment_and_protection() {
    let mut b = Spreadsheet::new();
    let mut cf = rule(ValueOperator::Equal, "1", None);
    cf.rule = ConditionalRule::Formula("TRUE".into());
    cf.style = Style {
        family: "A & B".into(),
        font: vec![
            ("Bold", "0".into()),
            ("Italic", "1".into()),
            ("StrikeThrough", "0".into()),
            ("Unit", "13".into()),
            ("Underline", "2".into()),
            ("Script", "-1".into()),
        ],
        attributes: vec![
            ("Fore", "FF123456".into()),
            ("Shade", "1".into()),
            ("Back", "FFEFEFEF".into()),
            ("HAlign", "right".into()),
            ("VAlign", "center".into()),
            ("WrapText", "1".into()),
            ("Rotation", "-30".into()),
            ("Locked", "0".into()),
            ("Hidden", "1".into()),
        ],
        borders: vec![
            ("Left", 1, "FF112233".into()),
            ("Bottom", 6, "FF334455".into()),
        ],
    };
    b.set_conditional_formats(vec![cf], LIMIT).unwrap();
    let restored = Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(restored.options.conditional_formats.len(), 1);
    let a = &b.options.conditional_formats[0].style;
    let z = &restored.options.conditional_formats[0].style;
    assert_eq!(a.family, z.family);
    assert_eq!(a.font, z.font);
    assert_eq!(a.borders, z.borders);
    assert_eq!(a.attributes.len(), z.attributes.len());
    for item in &a.attributes {
        assert!(z.attributes.contains(item));
    }
}

#[test]
fn conditional_xlsx_rejects_invalid_rules_before_exposing_a_workbook() {
    use crate::commands::structured::{read_office_archive, write_zip_stored};
    let mut b = Spreadsheet::new();
    b.set_conditional_formats(vec![rule(ValueOperator::Between, "1", Some("5"))], LIMIT)
        .unwrap();
    let parts = read_office_archive(&b.export_xlsx(LIMIT).unwrap());
    let source = String::from_utf8(parts["xl/worksheets/sheet1.xml"].clone()).unwrap();
    for (from, to) in [
        ("<formula>5</formula>", ""),
        ("priority=\"1\"", "priority=\"0\""),
        ("dxfId=\"0\"", "dxfId=\"999\""),
        ("A1:A7", "XFE1:XFE7"),
        (
            "type=\"cellIs\" operator=\"between\"",
            "type=\"top10\" rank=\"101\" percent=\"1\"",
        ),
    ] {
        assert!(source.contains(from));
        let mut broken = parts.clone();
        broken.insert(
            "xl/worksheets/sheet1.xml".into(),
            source.replace(from, to).into_bytes(),
        );
        let bytes = write_zip_stored(
            &broken
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_slice()))
                .collect::<Vec<_>>(),
        );
        assert!(
            Spreadsheet::import_xlsx(&bytes, LIMIT).is_err(),
            "accepted {to}"
        );
    }
}

#[test]
fn conditional_xlsx_operators_conform_to_spreadsheetml() {
    use crate::commands::structured::{read_office_archive, xml};
    let mut b = Spreadsheet::new();
    for operator in [
        super::TextOperator::Contains,
        super::TextOperator::DoesNotContain,
        super::TextOperator::BeginsWith,
        super::TextOperator::EndsWith,
        super::TextOperator::Equals,
    ] {
        let mut cf = rule(ValueOperator::Equal, "0", None);
        cf.rule = ConditionalRule::Text {
            operator,
            value: "a*?&\"<x>\nnext".into(),
        };
        b.set_conditional_formats(vec![cf], LIMIT).unwrap();
        let bytes = b.export_xlsx(LIMIT).unwrap();
        let restored = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        assert!(
            restored.options.conditional_formats[0].rule == b.options.conditional_formats[0].rule
        );
        let parts = read_office_archive(&bytes);
        let source = String::from_utf8(parts["xl/worksheets/sheet1.xml"].clone()).unwrap();
        let document = xml::parse(&source, None, None).unwrap();
        for rule in super::xml_elements(&document.nodes, "cfRule") {
            if let Some(operator) = super::xml_attribute(rule, "operator") {
                // OOXML ST_ConditionalFormattingOperator; type and operator have
                // different tokens for a negative text match.
                assert!(
                    [
                        "lessThan",
                        "lessThanOrEqual",
                        "equal",
                        "notEqual",
                        "greaterThanOrEqual",
                        "greaterThan",
                        "between",
                        "notBetween",
                        "containsText",
                        "notContains",
                        "beginsWith",
                        "endsWith"
                    ]
                    .contains(&operator)
                );
            }
        }
        assert!(!source.contains("<x>"));
        assert!(
            !source.contains("\nnext\""),
            "XML attribute newlines must survive standard parser normalization"
        );
    }
}

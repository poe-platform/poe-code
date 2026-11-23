// IronCalc f936620, xlsx/tests/test_conditional_formatting.rs::
// test_x14_expression_conditional_formatting. MIT, LICENSE.IronCalc.
// Original workbook and rule-count/range/fill assertions, with JSON coverage.
use super::{ConditionalRule, Spreadsheet};
const LIMIT: usize = 20_000_000;
const CROSSWORD: &[u8] = include_bytes!("fixtures/ironcalc-crossword-ranges.xlsx");

#[test]
fn extended_conditional_ironcalc_crossword_roundtrip() {
    let original = Spreadsheet::import_xlsx(CROSSWORD, LIMIT).unwrap();
    let json = Spreadsheet::from_json(&original.to_json(), LIMIT).unwrap();
    let excel = Spreadsheet::import_xlsx(&original.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for book in [&original, &json, &excel] {
        let rules = &book.options.conditional_formats;
        assert_eq!(rules.len(), 2);
        for rule in rules {
            assert_eq!(rule.sheet, 0);
            assert_eq!(rule.ranges.len(), 10);
            assert!(matches!(rule.rule, ConditionalRule::Formula(_)));
        }
        let mut fills: Vec<_> = rules
            .iter()
            .map(|rule| {
                rule.style
                    .attributes
                    .iter()
                    .find(|(key, _)| *key == "Back")
                    .unwrap()
                    .1
                    .as_str()
            })
            .collect();
        fills.sort();
        assert_eq!(fills, ["FFC6EFCE", "FFFFC7CE"]);
        assert!(rules == &original.options.conditional_formats);
    }
}

#[test]
fn extended_conditional_cross_sheet_edits_use_bounding_range_anchor() {
    let mut book = Spreadsheet::import_xlsx(CROSSWORD, LIMIT).unwrap();
    assert!(
        book.options.conditional_formats[0].rule
            == ConditionalRule::Formula("AND(B8<>\"\",UPPER(B8)=UPPER(Key!B3))".into())
    );
    // The bounding corner is B8, even though the first listed area is C9:F9.
    // These separated cells consequently compare to Key!C4 and Key!F6.
    book.edit(
        &[
            (0, 8, 2, "a"),
            (0, 10, 5, "b"),
            (1, 3, 2, "A"),
            (1, 5, 5, "C"),
        ],
        LIMIT,
    )
    .unwrap();
    let points = [(8, 2), (10, 5), (7, 1)];
    for stage in 0..3 {
        let styles = book.conditional_styles(0, &points, LIMIT).unwrap();
        assert!(
            styles[&(8, 2)]
                .style
                .attributes
                .contains(&("Back", "FFC6EFCE".into()))
        );
        assert!(
            styles[&(10, 5)]
                .style
                .attributes
                .contains(&("Back", "FFFFC7CE".into()))
        );
        assert!(
            !styles.contains_key(&(7, 1)),
            "bounding corner is outside the ranges"
        );
        book = if stage == 0 {
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap()
        } else {
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap()
        };
    }
    book.edit(&[(1, 5, 5, "B")], LIMIT).unwrap();
    assert!(
        book.conditional_styles(0, &points, LIMIT).unwrap()[&(10, 5)]
            .style
            .attributes
            .contains(&("Back", "FFC6EFCE".into()))
    );
    book.edit(&[(0, 8, 2, "")], LIMIT).unwrap();
    assert!(
        !book
            .conditional_styles(0, &points, LIMIT)
            .unwrap()
            .contains_key(&(8, 2))
    );
}

fn changed_part(bytes: &[u8], path: &str, change: impl FnOnce(String) -> String) -> Vec<u8> {
    use crate::commands::structured::{read_office_archive, write_zip_stored};
    let mut parts = read_office_archive(bytes);
    let source = String::from_utf8(parts[path].clone()).unwrap();
    parts.insert(path.into(), change(source).into_bytes());
    write_zip_stored(
        &parts
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect::<Vec<_>>(),
    )
}

#[test]
fn extended_conditional_rejects_ambiguous_or_missing_rule_data() {
    for (from, to) in [
        ("priority=\"1\"", "priority=\"0\""),
        ("priority=\"1\"", ""),
        (
            "<xm:f>AND(B8&lt;&gt;\"\",UPPER(B8)=UPPER(Key!B3))</xm:f>",
            "",
        ),
        (
            "<xm:f>AND(B8&lt;&gt;\"\",UPPER(B8)=UPPER(Key!B3))</xm:f>",
            "<xm:f/>",
        ),
        ("</xm:f>", "</xm:f><xm:f>TRUE</xm:f>"),
        ("</x14:dxf>", "</x14:dxf><x14:dxf/>"),
        (
            "{70022BBB-F407-2646-A2CE-6EED3685B997}",
            "{B7D9DC0D-C411-E949-B5C3-44D2A837D8AD}",
        ),
        ("id=\"{B7D9DC0D-C411-E949-B5C3-44D2A837D8AD}\"", ""),
        ("C9:F9 G8:G10", "XFE1 G8:G10"),
        ("priority=\"1\"", "priority=\"1\" stopIfTrue=\"maybe\""),
    ] {
        let bytes = changed_part(CROSSWORD, "xl/worksheets/sheet1.xml", |s| {
            assert!(s.contains(from));
            s.replacen(from, to, 1)
        });
        assert!(
            Spreadsheet::import_xlsx(&bytes, LIMIT).is_err(),
            "{from} -> {to}"
        );
    }
    assert!(Spreadsheet::import_xlsx(CROSSWORD, 1024).is_err());
}

#[test]
fn extended_conditional_automatic_and_explicit_differential_foregrounds() {
    for (foreground, color) in [
        ("", "FFC6EFCE"),
        ("<fgColor auto=\"1\"/>", "FFC6EFCE"),
        ("<fgColor indexed=\"65\"/>", "FFC6EFCE"),
        ("<fgColor rgb=\"FF123456\"/>", "FF123456"),
    ] {
        let bytes = changed_part(CROSSWORD, "xl/worksheets/sheet1.xml", |s| {
            s.replacen("<fgColor indexed=\"64\"/>", foreground, 1)
        });
        let book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        assert!(
            book.options.conditional_formats[0]
                .style
                .attributes
                .contains(&("Back", color.into()))
        );
    }
}

#[test]
fn extended_conditional_standard_differential_fill_uses_resolved_foreground() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "1")], LIMIT).unwrap();
    book.set_conditional_formats(
        vec![super::ConditionalFormat {
            sheet: 0,
            ranges: vec![[0, 0, 0, 0]],
            priority: 1,
            stop_if_true: false,
            rule: ConditionalRule::Formula("TRUE".into()),
            format: None,
            style: super::Style {
                attributes: vec![("Back", "FFC6EFCE".into()), ("Shade", "1".into())],
                ..Default::default()
            },
        }],
        LIMIT,
    )
    .unwrap();
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let bytes = changed_part(&bytes, "xl/styles.xml", |s| {
        let at = s.find("<dxfs").unwrap();
        let (before, after) = s.split_at(at);
        assert!(after.contains("<fgColor rgb=\"FFC6EFCE\"/>"));
        format!(
            "{before}{}",
            after.replace(
                "<fgColor rgb=\"FFC6EFCE\"/>",
                "<fgColor indexed=\"64\"/><bgColor rgb=\"FFC6EFCE\"/>"
            )
        )
    });
    let reopened = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert!(
        reopened.conditional_styles(0, &[(0, 0)], LIMIT).unwrap()[&(0, 0)]
            .style
            .attributes
            .contains(&("Back", "FFC6EFCE".into()))
    );
}

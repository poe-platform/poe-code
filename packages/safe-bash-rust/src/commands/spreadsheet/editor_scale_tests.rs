//! Color-scale semantics from IronCalc f936620 conditional_formatting.rs (MIT).
//! Exercise the public importer/evaluator, including real SpreadsheetML thresholds.
use super::Spreadsheet;
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
    let xml = xml.replace("</worksheet>", &format!(r#"<conditionalFormatting sqref="{range}"><cfRule type="colorScale" priority="1"><colorScale>{body}</colorScale></cfRule></conditionalFormatting></worksheet>"#));
    parts.insert("xl/worksheets/sheet1.xml".into(), xml.into_bytes());
    write_zip_stored(
        &parts
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect::<Vec<_>>(),
    )
}
fn colors(book: &Spreadsheet, positions: &[(usize, usize)]) -> Vec<Option<String>> {
    let styles = book.conditional_styles(0, positions, LIMIT).unwrap();
    positions
        .iter()
        .map(|p| {
            styles
                .get(p)
                .and_then(|s| s.style.attributes.iter().find(|(k, _)| *k == "Back"))
                .map(|(_, v)| v.clone())
        })
        .collect()
}
#[test]
fn scales_interpolate_two_and_three_colors_without_changing_cells() {
    for (body, expected) in [
        (
            r#"<cfvo type="min"/><cfvo type="max"/><color rgb="FFFF0000"/><color rgb="FF00FF00"/>"#,
            ["FFFF0000", "FFBF4000", "FF808000", "FF40BF00", "FF00FF00"],
        ),
        (
            r#"<cfvo type="min"/><cfvo type="percent" val="50"/><cfvo type="max"/><color rgb="FFFF0000"/><color rgb="FFFFFF00"/><color rgb="FF00FF00"/>"#,
            ["FFFF0000", "FFFF8000", "FFFFFF00", "FF80FF00", "FF00FF00"],
        ),
    ] {
        let book = Spreadsheet::import_xlsx(
            &workbook(&["0", "25", "50", "75", "100"], "A1:A5", body),
            LIMIT,
        )
        .unwrap();
        let before = book.to_json();
        let points = (0..5).map(|r| (r, 0)).collect::<Vec<_>>();
        for book in [
            &book,
            &Spreadsheet::from_json(&before, LIMIT).unwrap(),
            &Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ] {
            assert_eq!(colors(book, &points), expected.map(|s| Some(s.into())));
            assert_eq!(book.sheets[0].cells.len(), 5);
        }
        assert_eq!(book.to_json(), before);
    }
}
#[test]
fn scale_percentiles_match_percentile_inc_and_values_are_clamped() {
    let body = r#"<cfvo type="num" val="0"/><cfvo type="percentile" val="50"/><cfvo type="num" val="20"/><color rgb="FFFF0000"/><color rgb="FFFFFF00"/><color rgb="FF00FF00"/>"#;
    let mut book =
        Spreadsheet::import_xlsx(&workbook(&["0", "10", "20", "100"], "A1:A4", body), LIMIT)
            .unwrap();
    book.edit(&[(0, 0, 1, "=PERCENTILE.INC(A1:A4,0.5)")], LIMIT)
        .unwrap();
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "15");
    assert_eq!(
        colors(&book, &[(0, 0), (1, 0), (2, 0), (3, 0)]),
        ["FFFF0000", "FFFFAA00", "FF00FF00", "FF00FF00"].map(|s| Some(s.into()))
    );
}
#[test]
fn scale_formula_thresholds_use_the_shared_ast_and_rebase_after_sheet_edits() {
    let body = r#"<cfvo type="formula" val="SUM($A$1:$A$2)"/><cfvo type="formula" val="SUM($A$3:$A$4)"/><color rgb="FFFF0000"/><color rgb="FF00FF00"/>"#;
    let mut book =
        Spreadsheet::import_xlsx(&workbook(&["0", "1", "2", "3", "5"], "A1:A5", body), LIMIT)
            .unwrap();
    assert_eq!(
        colors(&book, &[(1, 0), (4, 0)]),
        ["FFFF0000", "FF00FF00"].map(|s| Some(s.into()))
    );
    book.edit_axis(0, false, 0, 1, LIMIT).unwrap();
    assert_eq!(
        colors(&book, &[(2, 0), (5, 0)]),
        ["FFFF0000", "FF00FF00"].map(|s| Some(s.into()))
    );
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let xml =
        String::from_utf8(read_office_archive(&bytes)["xl/worksheets/sheet1.xml"].clone()).unwrap();
    assert!(xml.contains("SUM($A$2:$A$3)"));
    let reopened = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    assert_eq!(
        colors(&reopened, &[(2, 0), (5, 0)]),
        ["FFFF0000", "FF00FF00"].map(|s| Some(s.into()))
    );
}
#[test]
fn scales_sort_threshold_values_keep_color_order_and_ignore_non_numbers() {
    let body = r#"<cfvo type="num" val="100"/><cfvo type="num" val="0"/><color rgb="FFFF0000"/><color rgb="FF00FF00"/>"#;
    let book = Spreadsheet::import_xlsx(
        &workbook(
            &["0", "100", "hello", "TRUE", "=1/0", "=\"\""],
            "A1:XFD1048576",
            body,
        ),
        LIMIT,
    )
    .unwrap();
    assert_eq!(
        colors(
            &book,
            &[
                (0, 0),
                (1, 0),
                (2, 0),
                (3, 0),
                (4, 0),
                (5, 0),
                (1_048_575, 16_383)
            ]
        ),
        vec![
            Some("FFFF0000".into()),
            Some("FF00FF00".into()),
            None,
            None,
            None,
            None,
            None
        ]
    );
    assert_eq!(book.sheets[0].cells.len(), 6);
    assert!(book.conditional_styles(0, &[(0, 0)], 10).is_err());
}
#[test]
fn scale_import_rejects_invalid_stop_counts_values_and_colors() {
    for body in [
        r#"<cfvo type="min"/><color rgb="FFFF0000"/>"#,
        r#"<cfvo type="min"/><cfvo type="max"/><color rgb="FFFF0000"/>"#,
        r#"<cfvo type="num" val="NaN"/><cfvo type="max"/><color rgb="FFFF0000"/><color rgb="FF00FF00"/>"#,
        r#"<cfvo type="percentile" val="101"/><cfvo type="max"/><color rgb="FFFF0000"/><color rgb="FF00FF00"/>"#,
        r#"<cfvo type="formula" val=""/><cfvo type="max"/><color rgb="FFFF0000"/><color rgb="FF00FF00"/>"#,
        r#"<cfvo type="min"/><cfvo type="max"/><color rgb="broken"/><color rgb="FF00FF00"/>"#,
    ] {
        assert!(
            Spreadsheet::import_xlsx(&workbook(&["1"], "A1", body), LIMIT).is_err(),
            "{body}"
        );
    }
}

#[test]
fn scale_interpolation_handles_large_and_tiny_finite_values() {
    let body =
        r#"<cfvo type="min"/><cfvo type="max"/><color rgb="FFFF0000"/><color rgb="FF00FF00"/>"#;
    for values in [["-1e308", "0", "1e308"], ["0", "1e-300", "2e-300"]] {
        let book = Spreadsheet::import_xlsx(&workbook(&values, "A1:A3", body), LIMIT).unwrap();
        assert_eq!(
            colors(&book, &[(0, 0), (1, 0), (2, 0)]),
            ["FFFF0000", "FF808000", "FF00FF00"].map(|s| Some(s.into()))
        );
    }
}
#[test]
fn scale_theme_indexed_colors_and_formula_spills_use_shared_engine_values() {
    let body =
        r#"<cfvo type="min"/><cfvo type="max"/><color theme="1" tint="1"/><color indexed="10"/>"#;
    let book =
        Spreadsheet::import_xlsx(&workbook(&["=SEQUENCE(5)"], "A1:A5", body), LIMIT).unwrap();
    assert_eq!(
        colors(&book, &[(0, 0), (2, 0), (4, 0)]),
        ["FFFFFFFF", "FFFF8080", "FFFF0000"].map(|s| Some(s.into()))
    );
    assert_eq!(book.sheets[0].cells.len(), 1);
}
#[test]
fn scale_priorities_merge_with_differential_styles_and_respect_stop_if_true() {
    use super::{ConditionalRule, Style};
    let body =
        r#"<cfvo type="min"/><cfvo type="max"/><color rgb="FFFF0000"/><color rgb="FF00FF00"/>"#;
    let mut book = Spreadsheet::import_xlsx(&workbook(&["1", "2"], "A1:A2", body), LIMIT).unwrap();
    let mut scale = book.options.conditional_formats[0].clone();
    let mut other = scale.clone();
    other.rule = ConditionalRule::Formula("TRUE".into());
    other.style = Style {
        attributes: vec![("Back", "FF0000FF".into()), ("Shade", "1".into())],
        font: vec![("Bold", "1".into())],
        ..Style::default()
    };
    scale.priority = 2;
    book.set_conditional_formats(vec![scale.clone(), other.clone()], LIMIT)
        .unwrap();
    assert_eq!(colors(&book, &[(0, 0)]), [Some("FF0000FF".into())]);
    scale.priority = 1;
    other.priority = 2;
    book.set_conditional_formats(vec![other.clone(), scale.clone()], LIMIT)
        .unwrap();
    assert_eq!(colors(&book, &[(0, 0)]), [Some("FFFF0000".into())]);
    assert_eq!(
        book.conditional_styles(0, &[(0, 0)], LIMIT).unwrap()[&(0, 0)]
            .style
            .font,
        vec![("Bold", "1".into())]
    );
    other.priority = 1;
    other.stop_if_true = true;
    other.style.attributes.clear();
    scale.priority = 2;
    book.set_conditional_formats(vec![scale, other], LIMIT)
        .unwrap();
    assert_eq!(colors(&book, &[(0, 0)]), [None]);
}
#[test]
fn scale_direct_invalid_models_are_errors_instead_of_panics() {
    use super::{ConditionalRule, ConditionalValue};
    let body =
        r#"<cfvo type="min"/><cfvo type="max"/><color rgb="FFFF0000"/><color rgb="FF00FF00"/>"#;
    let bytes = workbook(&["1", "2"], "A1:A2", body);
    for invalid in 0..4 {
        let mut book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        let ConditionalRule::ColorScale { thresholds } =
            &mut book.options.conditional_formats[0].rule
        else {
            panic!("scale")
        };
        match invalid {
            0 => thresholds.clear(),
            1 => thresholds[0].color = "x".into(),
            2 => thresholds[0].value = ConditionalValue::Percentile(101.),
            _ => thresholds[0].value = ConditionalValue::Number(f64::NAN),
        }
        assert!(book.conditional_styles(0, &[(0, 0)], LIMIT).is_err());
    }
}

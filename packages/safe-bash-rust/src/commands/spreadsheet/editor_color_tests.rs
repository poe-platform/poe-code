//! Theme/indexed-color cases use IronCalc f936620 (MIT, LICENSE.IronCalc)
//! palette ordering and tint expectations, exercised through editable XLSX import.
use super::{Spreadsheet, Style};
use crate::commands::structured::{read_office_archive, write_zip_stored};
const LIMIT: usize = 20_000_000;
const THEME: &str = r#"<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Custom"><a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FAFAFA"/></a:lt1><a:dk2><a:srgbClr val="AA5500"/></a:dk2><a:lt2><a:srgbClr val="EEEEDD"/></a:lt2><a:accent1><a:srgbClr val="8064A2"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme></a:themeElements></a:theme>"#;
fn workbook(styles: &str, body: &str, theme: Option<&str>) -> Vec<u8> {
    let bytes = Spreadsheet::new().export_xlsx(LIMIT).unwrap();
    let mut parts = read_office_archive(&bytes);
    parts.insert("xl/styles.xml".into(),format!(r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{styles}</styleSheet>"#).into_bytes());
    parts.insert("xl/worksheets/sheet1.xml".into(),format!(r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{body}</worksheet>"#).into_bytes());
    if let Some(theme) = theme {
        let rels = String::from_utf8(parts["xl/_rels/workbook.xml.rels"].clone()).unwrap().replace("</Relationships>",r#"<Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="palette/custom.xml"/></Relationships>"#);
        parts.insert("xl/_rels/workbook.xml.rels".into(), rels.into_bytes());
        parts.insert("xl/palette/custom.xml".into(), theme.as_bytes().to_vec());
    }
    write_zip_stored(
        &parts
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect::<Vec<_>>(),
    )
}
fn attribute<'a>(style: &'a Style, key: &str) -> Option<&'a str> {
    style
        .attributes
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v.as_str())
}
fn font_book(colors: &[&str], extra: &str, theme: Option<&str>) -> Spreadsheet {
    let fonts = colors
        .iter()
        .map(|color| format!("<font>{color}</font>"))
        .collect::<String>();
    let xfs = (0..colors.len())
        .map(|i| format!(r#"<xf fontId="{i}"/>"#))
        .collect::<String>();
    let rows = (0..colors.len())
        .map(|i| {
            format!(
                r#"<row r="{r}"><c r="A{r}" s="{i}"><v>1</v></c></row>"#,
                r = i + 1
            )
        })
        .collect::<String>();
    Spreadsheet::import_xlsx(
        &workbook(
            &format!("<fonts>{fonts}</fonts><cellXfs>{xfs}</cellXfs>{extra}"),
            &format!("<sheetData>{rows}</sheetData>"),
            theme,
        ),
        LIMIT,
    )
    .unwrap()
}
#[test]
fn xlsx_theme_slots_use_relationships_and_the_spreadsheet_light_dark_order() {
    let colors = (0..12)
        .map(|i| format!(r#"<color theme="{i}"/>"#))
        .collect::<Vec<_>>();
    let book = font_book(
        &colors.iter().map(String::as_str).collect::<Vec<_>>(),
        "",
        Some(THEME),
    );
    for (row, expected) in [
        "FFFAFAFA", "FF111111", "FFEEEEDD", "FFAA5500", "FF8064A2", "FFED7D31", "FFA5A5A5",
        "FFFFC000", "FF5B9BD5", "FF70AD47", "FF0563C1", "FF954F72",
    ]
    .iter()
    .enumerate()
    {
        assert_eq!(
            attribute(
                book.sheets[0].cells[&(row, 0)].style.as_ref().unwrap(),
                "Fore"
            ),
            Some(*expected),
            "theme slot {row}"
        );
    }
}
#[test]
fn xlsx_theme_tints_and_indexed_colors_apply_to_cells_and_differential_styles() {
    let styles = r#"<fonts><font><color theme="4" tint="0.8"/></font></fonts><fills><fill><patternFill patternType="solid"><fgColor indexed="10"/></patternFill></fill></fills><borders><border><bottom style="thin"><color theme="3"/></bottom></border></borders><cellXfs><xf fontId="0" fillId="0" borderId="0"/></cellXfs><dxfs><dxf><font><color theme="4" tint="0.8"/></font><fill><patternFill><bgColor indexed="10"/></patternFill></fill><border><bottom style="thin"><color theme="3"/></bottom></border></dxf></dxfs>"#;
    let sheet = r#"<sheetData><row r="1"><c r="A1" s="0"><v>1</v></c></row></sheetData><conditionalFormatting sqref="A1:A2"><cfRule type="expression" dxfId="0" priority="1"><formula>TRUE</formula></cfRule></conditionalFormatting>"#;
    let book = Spreadsheet::import_xlsx(&workbook(styles, sheet, Some(THEME)), LIMIT).unwrap();
    for book in [
        book.to_json(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT)
            .unwrap()
            .to_json(),
    ] {
        let book = Spreadsheet::from_json(&book, LIMIT).unwrap();
        for style in [
            book.sheets[0].cells[&(0, 0)]
                .style
                .as_ref()
                .unwrap()
                .as_ref(),
            &book.options.conditional_formats[0].style,
        ] {
            assert_eq!(attribute(style, "Fore"), Some("FFE5DFEC"));
            assert_eq!(attribute(style, "Back"), Some("FFFF0000"));
            assert_eq!(attribute(style, "Shade"), Some("1"));
            assert_eq!(
                style
                    .borders
                    .iter()
                    .filter(|(_, line, _)| *line != 0)
                    .cloned()
                    .collect::<Vec<_>>(),
                [("Bottom", 1, "FFAA5500".into())]
            );
        }
    }
}
#[test]
fn xlsx_indexed_palettes_preserve_indexes_and_automatic_colors_stay_automatic() {
    let colors = [
        r#"<color indexed="0"/>"#,
        r#"<color indexed="1"/>"#,
        r#"<color indexed="2"/>"#,
        r#"<color indexed="63"/>"#,
        r#"<color indexed="64"/>"#,
        r#"<color auto="1"/>"#,
        "",
        r#"<color indexed="-1"/>"#,
        r#"<color theme="99"/>"#,
    ];
    for (extra, expected) in [
        (
            "",
            [
                Some("FF000000"),
                Some("FFFFFFFF"),
                Some("FFFF0000"),
                Some("FF333333"),
            ],
        ),
        (
            r#"<colors><indexedColors><rgbColor rgb="bad"/><rgbColor rgb="445566"/></indexedColors></colors>"#,
            [
                Some("FF000000"),
                Some("FF445566"),
                Some("FFFF0000"),
                Some("FF333333"),
            ],
        ),
    ] {
        let book = font_book(&colors, extra, None);
        for row in 0..colors.len() {
            assert_eq!(
                attribute(
                    book.sheets[0].cells[&(row, 0)].style.as_ref().unwrap(),
                    "Fore"
                ),
                expected.get(row).copied().flatten(),
                "palette index {row}"
            );
        }
    }
}
#[test]
fn xlsx_missing_or_invalid_theme_uses_the_default_palette_and_bounds_tints() {
    let colors = [
        r#"<color theme="0"/>"#,
        r#"<color theme="1"/>"#,
        r#"<color theme="4"/>"#,
        r#"<color rgb="123456" tint="1"/>"#,
        r#"<color rgb="FF123456" tint="-1"/>"#,
        r#"<color rgb="FF123456" tint="NaN"/>"#,
        r#"<color rgb="FF123456" tint="2"/>"#,
    ];
    for theme in [None, Some("broken theme"), Some("<theme/>")] {
        let book = font_book(&colors, "", theme);
        for (row, expected) in [
            "FFFFFFFF", "FF000000", "FF4472C4", "FFFFFFFF", "FF000000", "FF123456", "FF123456",
        ]
        .iter()
        .enumerate()
        {
            assert_eq!(
                attribute(
                    book.sheets[0].cells[&(row, 0)].style.as_ref().unwrap(),
                    "Fore"
                ),
                Some(*expected)
            );
        }
    }
}

#[test]
fn xlsx_automatic_font_colors_survive_reopening_without_becoming_explicit_black() {
    // IronCalc's font_color_import.rs distinguishes absent/automatic color from
    // explicit black. Exercise that distinction through Poe's used-cell styles.
    let colors = [
        "",
        r#"<color auto="1"/>"#,
        r#"<color rgb="FF000000"/>"#,
        r#"<color theme="1"/>"#,
    ];
    let book = font_book(&colors, "", None);
    let restored = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for book in [&book, &restored] {
        for (row, expected) in [None, None, Some("FF000000"), Some("FF000000")]
            .into_iter()
            .enumerate()
        {
            assert_eq!(
                attribute(
                    book.sheets[0].cells[&(row, 0)].style.as_ref().unwrap(),
                    "Fore"
                ),
                expected,
                "font {row}"
            );
        }
    }
}

#[test]
fn xlsx_colors_follow_explicit_row_column_and_default_styles_without_dense_cells() {
    let styles = r#"<fonts><font><color theme="4"/></font><font><color indexed="10"/></font><font><color rgb="FF112233"/></font></fonts><cellXfs><xf fontId="0"/><xf fontId="1"/><xf fontId="2"/></cellXfs>"#;
    let sheet = r#"<cols><col min="1" max="2" style="2"/></cols><sheetData><row r="1" s="1" customFormat="1"><c r="A1"><v>1</v></c><c r="B1" s="0"><v>2</v></c></row><row r="2"><c r="A2"><v>3</v></c></row><row r="3"><c r="C3"><v>4</v></c></row><row r="10" s="1" customFormat="1"/></sheetData>"#;
    let book = Spreadsheet::import_xlsx(&workbook(styles, sheet, Some(THEME)), LIMIT).unwrap();
    let restored = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    for book in [&book, &restored, &json] {
        for (pos, expected) in [
            ((0, 0), "FFFF0000"),
            ((0, 1), "FF8064A2"),
            ((1, 0), "FF112233"),
            ((2, 2), "FF8064A2"),
            ((9, 3), "FFFF0000"),
            ((8, 0), "FF112233"),
            ((8, 4), "FF8064A2"),
        ] {
            let color = book
                .cell_style(0, pos.0, pos.1)
                .and_then(|s| attribute(s, "Fore"));
            assert_eq!(color, Some(expected), "cell {pos:?}");
        }
        assert_eq!(book.sheets[0].cells.len(), 4);
        assert!(book.cell_style(1, 0, 0).is_none());
        assert!(book.cell_style(0, 1_048_576, 0).is_none());
        assert!(book.cell_style(0, 0, 16_384).is_none());
        assert_eq!(
            attribute(book.sheets[0].rows[&9].style.as_ref().unwrap(), "Fore"),
            Some("FFFF0000")
        );
        assert!(!book.sheets[0].cells.contains_key(&(9, 0)));
    }
}

#[test]
fn xlsx_number_formats_preserve_inherited_colors_when_export_requires_a_cell_xf() {
    let styles = r#"<fonts><font><color theme="4"/></font><font><color indexed="10"/></font><font><color rgb="FF112233"/></font></fonts><cellXfs><xf fontId="0"/><xf fontId="1"/><xf fontId="2"/></cellXfs>"#;
    let sheet = r#"<cols><col min="1" max="1" style="2"/></cols><sheetData><row r="1" s="1" customFormat="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2"><v>2</v></c><c r="B2"><v>3</v></c></row></sheetData>"#;
    let mut book = Spreadsheet::import_xlsx(&workbook(styles, sheet, Some(THEME)), LIMIT).unwrap();
    for cell in book.sheets[0].cells.values_mut() {
        cell.format = Some("0.00".into());
        assert!(cell.style.is_none());
    }
    let restored = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for (row, col, color, text) in [
        (0, 0, "FFFF0000", "1.00"),
        (1, 0, "FF112233", "2.00"),
        (1, 1, "FF8064A2", "3.00"),
    ] {
        assert_eq!(restored.display(0, row, col, LIMIT).unwrap(), text);
        assert_eq!(
            restored
                .cell_style(0, row, col)
                .and_then(|s| attribute(s, "Fore")),
            Some(color)
        );
    }
    assert_eq!(restored.sheets[0].cells.len(), 3);
    assert!(
        book.sheets[0]
            .cells
            .values()
            .all(|cell| cell.style.is_none())
    );
}

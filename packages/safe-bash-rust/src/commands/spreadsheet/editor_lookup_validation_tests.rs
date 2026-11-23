// IronCalc lookup/logical regressions; MATCH's non-vector #N/A follows Univer.
use super::Spreadsheet;
const LIMIT: usize = 32 * 1024 * 1024;
#[test]
fn excel_lookup_and_not_preserve_text_number_and_boolean_types() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "13"),
            (0, 1, 0, "0"),
            (0, 2, 0, "'"),
            (0, 3, 0, "'13"),
        ],
        LIMIT,
    )
    .unwrap();
    for (formula, want) in [
        ("=NOT(\"1\")", "#VALUE!"),
        ("=NOT(\"0\")", "#VALUE!"),
        ("=NOT(\"true\")", "FALSE"),
        ("=NOT(\"FALSE\")", "TRUE"),
        ("=NOT(A4)", "#VALUE!"),
        ("=NOT(0)", "TRUE"),
        ("=MATCH(\"13\",A1:A2,0)", "#N/A"),
        ("=MATCH(FALSE,A1:A2,0)", "#N/A"),
        ("=MATCH(\"\",A1:A4,0)", "3"),
        ("=MATCH(\"13\",A1:A4,0)", "4"),
        ("=VLOOKUP(\"13\",A1:A2,1,FALSE)", "#N/A"),
        ("=VLOOKUP(\"Aranda\",3,1)", "#N/A"),
        ("=VLOOKUP(3,3,1,FALSE)", "3"),
        ("=HLOOKUP(TRUE,TRUE,1,FALSE)", "TRUE"),
        ("=VLOOKUP(\"Aranda\",\"Nothing\",1)", "#VALUE!"),
    ] {
        b.edit(&[(0, 0, 5, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 5, LIMIT).unwrap(), want, "{formula}");
    }
}
#[test]
fn logical_arity_errors_are_catchable_and_do_not_hide_valid_arrays() {
    let mut b = Spreadsheet::new();
    for formula in [
        "=NOT()",
        "=NOT(TRUE,FALSE)",
        "=IFERROR()",
        "=IFERROR(1)",
        "=IFERROR(1,2,3)",
        "=IFNA()",
        "=IFNA(1)",
        "=IFNA(1,2,3)",
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "#ERROR!", "{formula}");
    }
    b.edit(
        &[
            (0, 0, 0, "=IFERROR(NOT(1,2),99)"),
            (0, 2, 0, "=IFNA({1,#N/A;#VALUE!,2},{7;8})"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "99");
    for (r, c, want) in [(2, 0, "1"), (2, 1, "7"), (3, 0, "#VALUE!"), (3, 1, "2")] {
        assert_eq!(b.display(0, r, c, LIMIT).unwrap(), want);
    }
}
#[test]
fn row_column_counts_accept_scalars_and_preserve_errors_and_reference_shapes() {
    let mut b = Spreadsheet::new();
    for name in ["ROWS", "COLUMNS"] {
        for (arg, want) in [
            ("42", "1"),
            ("TRUE", "1"),
            ("\"text\"", "1"),
            ("Z1", "1"),
            ("#N/A", "#N/A"),
            ("1/0", "#DIV/0!"),
            ("", "#ERROR!"),
            ("A1,B1", "#ERROR!"),
        ] {
            let formula = format!("={name}({arg})");
            b.edit(&[(0, 0, 4, &formula)], LIMIT).unwrap();
            assert_eq!(b.display(0, 0, 4, LIMIT).unwrap(), want, "{formula}");
        }
    }
    b.edit(
        &[
            (0, 0, 0, "=ROWS(A:A)"),
            (0, 1, 0, "=COLUMNS(1:1)"),
            (0, 2, 0, "=COLUMNS({#N/A,2;3,4})"),
            (0, 3, 0, "=ROWS({#N/A,2;3,4})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, want) in [(0, "1048576"), (1, "16384"), (2, "2"), (3, "2")] {
        assert_eq!(b.display(0, r, 0, LIMIT).unwrap(), want);
    }
}
#[test]
fn lookup_indices_and_patterns_work_for_array_tables() {
    let mut b = Spreadsheet::new();
    for (formula, want) in [
        ("=VLOOKUP(\"ba?*\",{\"apple\",1;\"BANANA\",2},2,FALSE)", "2"),
        ("=HLOOKUP(\"ba?*\",{\"apple\",\"BANANA\";1,2},2,FALSE)", "2"),
        ("=VLOOKUP(\"a~*\",{\"ab\",1;\"a*\",2},2,FALSE)", "2"),
        ("=HLOOKUP(\"a~~\",{\"ab\",\"a~\";1,2},2,FALSE)", "2"),
        ("=VLOOKUP(1,{1,2},0,FALSE)", "#VALUE!"),
        ("=VLOOKUP(1,{1,2},0.5,FALSE)", "#VALUE!"),
        ("=VLOOKUP(1,{1,2},3,FALSE)", "#REF!"),
        ("=VLOOKUP(1,{1,2},2.9,FALSE)", "2"),
        ("=HLOOKUP(1,{1;2},-1,FALSE)", "#VALUE!"),
        ("=HLOOKUP(1,{1;2},3,FALSE)", "#REF!"),
        ("=HLOOKUP(1,{1;2},#N/A,FALSE)", "#N/A"),
        ("=INDEX({1,2;3,4},-0.1,1)", "#VALUE!"),
        ("=INDEX({1,2;3,4},1,-1)", "#VALUE!"),
        ("=INDEX({1,2;3,4},1,65536)", "#REF!"),
        ("=INDEX({1,2;3,4},2147483648,1)", "#REF!"),
        ("=MATCH(1,{1,2;3,4},0)", "#N/A"),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}
#[test]
fn lookup_array_selectors_roundtrip_and_wildcard_work_is_bounded() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (
                0,
                0,
                0,
                "=VLOOKUP({\"a*\";\"b*\"},{\"apple\",10;\"banana\",20},{2,0,3},FALSE)",
            ),
            (0, 4, 0, "=INDEX({1,2;3,4},0,2)"),
        ],
        LIMIT,
    )
    .unwrap();
    let before = b.to_json();
    let pattern = format!(
        "=VLOOKUP(\"{}\",{{\"{}\",1}},2,FALSE)",
        "*a".repeat(1000),
        "a".repeat(3000)
    );
    assert!(b.edit(&[(0, 0, 0, &pattern)], 100_000).is_err());
    assert_eq!(b.to_json(), before);
    for b in [
        Spreadsheet::from_json(&before, LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        b,
    ] {
        for (r, c, want) in [
            (0, 0, "10"),
            (1, 0, "20"),
            (0, 1, "#VALUE!"),
            (1, 2, "#REF!"),
            (4, 0, "2"),
            (5, 0, "4"),
        ] {
            assert_eq!(b.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
        }
    }
}

#[test]
fn excel_empty_strings_remain_text_through_lookup_and_roundtrips() {
    let input=crate::commands::structured::write_zip_stored(&[
        ("xl/workbook.xml",br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
        ("xl/_rels/workbook.xml.rels",br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>"#),
        ("_rels/.rels",include_bytes!("xlsx/root.rels")),
        ("[Content_Types].xml",br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
        ("xl/sharedStrings.xml",br#"<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t></t></si></sst>"#),
        ("xl/worksheets/sheet1.xml",br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t/></is></c><c r="C1" t="str"><v/></c><c r="D1"/><c r="E1" s="0"/><c r="F1" t="s" s="0"><v>0</v></c></row></sheetData></worksheet>"#),
    ]);
    let mut b = Spreadsheet::import_xlsx(&input, LIMIT).unwrap();
    b.edit(
        &[
            (0, 2, 0, "=ISTEXT(A1:F1)"),
            (0, 3, 0, "=ISBLANK(A1:F1)"),
            (0, 4, 0, "=MATCH(\"\",A1:F1,0)"),
        ],
        LIMIT,
    )
    .unwrap();
    for b in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        b,
    ] {
        for c in 0..6 {
            assert_eq!(
                b.display(0, 2, c, LIMIT).unwrap(),
                if matches!(c, 3 | 4) { "FALSE" } else { "TRUE" },
                "ISTEXT {c}"
            );
            assert_eq!(
                b.display(0, 3, c, LIMIT).unwrap(),
                if matches!(c, 3 | 4) { "TRUE" } else { "FALSE" },
                "ISBLANK {c}"
            );
        }
        assert_eq!(b.display(0, 4, 0, LIMIT).unwrap(), "1");
    }
}

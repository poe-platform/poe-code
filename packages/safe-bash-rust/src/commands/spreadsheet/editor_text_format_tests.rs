// TEXT cases adapted from IronCalc test_format_case.rs, test_arrays_and_errors.rs
// (MIT, f93662006b8fb1c401dc870bbda26c5d60ac6037), and Univer text/text tests
// (Apache-2.0, 4767b3b309467c283bbd52b725536ca73861e0fc). See LICENSE files.
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn text_formats_numbers_sections_and_typed_values() {
    let mut book = Spreadsheet::new();
    let mut failures = Vec::new();
    for (formula, want) in [
        (r##"=TEXT(111,"$#,##0.00")"##, "$111.00"),
        (r##"=TEXT(12345.678,"#,##0.00")"##, "12,345.68"),
        (r##"=TEXT(0.125,"0.0%")"##, "12.5%"),
        (r##"=TEXT(12345,"0.00E+00")"##, "1.23E+04"),
        (r##"=TEXT(2.675,"0.00")"##, "2.68"),
        (r##"=TEXT(-12.3,"0.00;(0.00);""zero""")"##, "(12.30)"),
        (r##"=TEXT(0,"0.00;(0.00);""zero""")"##, "zero"),
        (r##"=TEXT("007","0000")"##, "0007"),
        (r##"=TEXT("a","0;;;\0")"##, "0"),
        (r##"=TEXT("","0;;;\0")"##, "0"),
        (r##"=TEXT("hello","0")"##, "hello"),
        (r##"=TEXT(TRUE,"0")"##, "TRUE"),
        (r##"=TYPE(TEXT(TRUE,"0"))"##, "4"),
        (r##"=TYPE(TEXT(7,"0"))"##, "2"),
        (r##"=TEXT(B1,"0.00")"##, "0.00"),
        (r##"=TEXT(5,"[>10]0.0;0")"##, "5"),
        (r##"=TEXT(1,TRUE)"##, "#VALUE!"),
        (r##"=TEXT(1,"[bogus]0")"##, "#VALUE!"),
        (r##"=TEXT(1,"[>1e400]0")"##, "#VALUE!"),
        (r##"=TEXT("x",NA())"##, "#N/A"),
        (r##"=TEXT(TRUE,1/0)"##, "#DIV/0!"),
        (r##"=TEXT(NA(),1/0)"##, "#N/A"),
        (r##"=TEXT(5,)"##, ""),
        (r##"=TEXT(5,"")"##, ""),
        (r##"=TEXT(5,"general")"##, "5"),
        (r##"=TEXT("TRUE ","0")"##, "TRUE "),
        (r##"=TEXT("1900-01-01","yyyy-mm-dd")"##, "1900-01-01"),
        (r##"=TEXT("2/28/1900","yyyy-mm-dd")"##, "1900-02-28"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let actual = book.display(0, 0, 0, LIMIT).unwrap();
        if actual != want {
            failures.push(format!("{formula}: {actual:?} != {want:?}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn text_formats_excel_calendar_tokens_and_both_date_systems() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        (r##"=TEXT(45000,"M/D/YYYY")"##, "3/15/2023"),
        (r##"=TEXT(45000,"MMM-YY")"##, "Mar-23"),
        (
            r##"=TEXT(45000.526,"MM/DD/YYYY hh:MM:SS")"##,
            "03/15/2023 12:37:26",
        ),
        (r##"=TEXT(45000.526,"h:mm AM/PM")"##, "12:37 PM"),
        (r##"=TEXT(1.5,"[h]:mm")"##, "36:00"),
        (r##"=TEXT(0,"yyyy-mm-dd")"##, "1900-01-00"),
        (r##"=TEXT(1,"yyyy-mm-dd")"##, "1900-01-01"),
        (r##"=TEXT(60,"mmmm d, dddd")"##, "February 29, Wednesday"),
        (r##"=TEXT(61,"yyyy-mm-dd")"##, "1900-03-01"),
        (r##"=TEXT(-3,"yyyy-mm-dd")"##, "######"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
    book.options.date1904 = true;
    for (formula, want) in [
        (r##"=TEXT(0,"yyyy-mm-dd")"##, "1904-01-01"),
        (r##"=TEXT("1904-1-1","yyyy-mm-dd")"##, "1904-01-01"),
        (r##"=TEXT(-2,"yyyy-mm-dd")"##, "1903-12-30"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn text_broadcasts_formats_and_preserves_per_element_errors() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "1.25"),
            (0, 1, 0, "2.5"),
            (0, 0, 2, r##"=TEXT(A1:A2,{"0","0.00"})"##),
            (0, 3, 2, r##"=TEXT({1,#DIV/0!,"x",TRUE},NA())"##),
            (0, 5, 2, r##"=TEXT({"x",TRUE,1},{"0";TRUE})"##),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, want) in [
        (0, 2, "1"),
        (0, 3, "1.25"),
        (1, 2, "3"),
        (1, 3, "2.50"),
        (3, 2, "#N/A"),
        (3, 3, "#DIV/0!"),
        (3, 4, "#N/A"),
        (3, 5, "#N/A"),
        (5, 2, "x"),
        (5, 3, "TRUE"),
        (5, 4, "1"),
        (6, 2, "#VALUE!"),
        (6, 3, "#VALUE!"),
        (6, 4, "#VALUE!"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
    }
    for restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.display(0, 1, 3, LIMIT).unwrap(), "2.50");
        assert_eq!(restored.display(0, 3, 3, LIMIT).unwrap(), "#DIV/0!");
    }
}

#[test]
fn text_format_work_is_bounded_and_failed_edits_are_atomic() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "kept")], LIMIT).unwrap();
    let original = book.to_json();
    for formula in [
        r##"=TEXT(SEQUENCE(10000),"0.00")"##.to_owned(),
        format!("=TEXT(1,\"{}\")", "0".repeat(40000)),
    ] {
        assert!(book.edit(&[(0, 0, 0, &formula)], 50_000).is_err());
        assert_eq!(book.to_json(), original);
    }
}

#[test]
fn text_preserves_embedded_literals_and_normalizes_weekdays() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        (r##"=TEXT("12345","0000年00月00日")"##, "0001年23月45日"),
        (r##"=TEXT(44926,"ÅÅÅÅ-MM-DD")"##, "Saturday-12-31"),
        (r##"=TEXT(44926,"""ÅÅÅÅ""-MM-DD")"##, "ÅÅÅÅ-12-31"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn text_matches_univer_typed_value_and_format_cross_product() {
    let mut book = Spreadsheet::new();
    let values = [
        "1", "' ", "1.23", "TRUE", "FALSE", "", "0", "'100", "'2.34", "test", "-3", "=#NAME?",
    ];
    let formats = [
        "1",
        "YYYY-MM-DD",
        "TRUE",
        "FALSE",
        "",
        "0",
        "'100",
        "test",
        "-3",
        "=#NAME?",
    ];
    let mut edits = Vec::new();
    for (c, text) in values.iter().enumerate() {
        edits.push((0, 0, c, *text));
    }
    for (r, text) in formats.iter().enumerate() {
        edits.push((0, r, 13, *text));
    }
    edits.push((0, 14, 0, "=TEXT(A1:L1,N1:N10)"));
    book.edit(&edits, LIMIT).unwrap();
    let expected = [
        [
            "1", " ", "1", "TRUE", "FALSE", "1", "1", "1", "1", "test", "-1", "#NAME?",
        ],
        [
            "1900-01-01",
            " ",
            "1900-01-01",
            "TRUE",
            "FALSE",
            "1900-01-00",
            "1900-01-00",
            "1900-04-09",
            "1900-01-02",
            "test",
            "######",
            "#NAME?",
        ],
        [
            "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!",
            "#VALUE!", "#VALUE!", "#VALUE!", "#NAME?",
        ],
        [
            "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!",
            "#VALUE!", "#VALUE!", "#VALUE!", "#NAME?",
        ],
        [
            "", "", "", "TRUE", "FALSE", "", "", "", "", "test", "-", "#NAME?",
        ],
        [
            "1", " ", "1", "TRUE", "FALSE", "0", "0", "100", "2", "test", "-3", "#NAME?",
        ],
        [
            "101", " ", "101", "TRUE", "FALSE", "100", "100", "1100", "102", "test", "-103",
            "#NAME?",
        ],
        [
            "t19000t", " ", "t190012t", "TRUE", "FALSE", "t19000t", "t19000t", "t19000t",
            "t190036t", "test", "######", "#NAME?",
        ],
        [
            "-3", " ", "-3", "TRUE", "FALSE", "-3", "-3", "-3", "-3", "test", "--3", "#NAME?",
        ],
        [
            "#NAME?", "#NAME?", "#NAME?", "#NAME?", "#NAME?", "#NAME?", "#NAME?", "#NAME?",
            "#NAME?", "#NAME?", "#NAME?", "#NAME?",
        ],
    ];
    let mut failures = Vec::new();
    for (r, row) in expected.iter().enumerate() {
        for (c, want) in row.iter().enumerate() {
            let actual = book.display(0, 14 + r, c, LIMIT).unwrap();
            if actual != *want {
                failures.push(format!(
                    "value {:?}, format {:?}: {actual:?} != {want:?}",
                    values[c], formats[r]
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn text_section_expansion_respects_excel_text_limits_and_work_limits() {
    let mut book = Spreadsheet::new();
    let text = "😀".repeat(1000);
    book.edit(&[(0, 0, 0, &text)], LIMIT).unwrap();
    let formula = format!("=TEXT(A1,\"0;;;{}\")", "@".repeat(17));
    book.edit(&[(0, 0, 1, &formula)], LIMIT).unwrap();
    let result = book.display(0, 0, 1, LIMIT).unwrap();
    assert!(
        result == "#VALUE!",
        "expected text length error, got {} UTF-16 units",
        result.encode_utf16().count()
    );
    let formula = format!("=TEXT(A1,\"0;;;{}\")", "@".repeat(16));
    book.edit(&[(0, 0, 1, &formula)], LIMIT).unwrap();
    assert_eq!(
        book.display(0, 0, 1, LIMIT).unwrap().encode_utf16().count(),
        32000
    );
    let saved = book.to_json();
    assert!(book.edit(&[(0, 1, 1, &formula)], 20_000).is_err());
    assert_eq!(book.to_json(), saved);
}

#[test]
fn text_imports_plain_excel_formulas_and_preserves_result_types() {
    let input=crate::commands::structured::write_zip_stored(&[
        ("xl/workbook.xml",br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
        ("xl/_rels/workbook.xml.rels",br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
        ("_rels/.rels",include_bytes!("xlsx/root.rels")),
        ("[Content_Types].xml",br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
        ("xl/worksheets/sheet1.xml",br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>12.5</v></c><c r="B1"><f>TEXT(A1,&quot;0000.00&quot;)</f></c><c r="C1"><f>ISTEXT(B1)</f></c></row><row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2"><f>TEXT(A2,&quot;0&quot;)</f></c><c r="C2"><f>TYPE(B2)</f></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>FALSE</t></is></c><c r="B3"><f>TEXT(A3,&quot;0&quot;)</f></c><c r="C3"><f>ISTEXT(B3)</f></c></row></sheetData></worksheet>"#),
    ]);
    let mut book = Spreadsheet::import_xlsx(&input, LIMIT).unwrap();
    for (r, c, want) in [
        (0, 1, "0012.50"),
        (0, 2, "TRUE"),
        (1, 1, "TRUE"),
        (1, 2, "4"),
        (2, 1, "FALSE"),
        (2, 2, "TRUE"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
    }
    book.edit(&[(0, 0, 0, "123")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "0123.00");
}

#[test]
fn text_grouping_handles_unicode_masks_and_large_zero_padding() {
    let mut book = Spreadsheet::new();
    for pattern in ["0年0,0", "0😀0,0", "000年0,00"] {
        let formula = format!("=TEXT(12345,\"{pattern}\")");
        book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
        let result = book.display(0, 0, 0, LIMIT).unwrap();
        assert!(
            result.contains(if pattern.contains('年') {
                "年"
            } else {
                "😀"
            }),
            "{pattern}: {result}"
        );
    }
    let formula = format!("=TEXT(1,\"#,{}\")", "0".repeat(12000));
    book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
    let result = book.display(0, 0, 0, LIMIT).unwrap();
    assert_eq!(result.len(), 15999);
    assert_eq!(result.chars().filter(|c| *c == ',').count(), 3999);
    assert!(result.ends_with(",001"));
}

#[test]
fn scientific_format_preserves_subnormal_mantissas_and_decimal_rounding() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=1E-300/2E23"),
            (0, 1, 0, "=HARMEAN({1E-300,2E-300,4E-300}/1E23)"),
            (0, 0, 1, "=TEXT(A1,\"0.00E+00\")"),
            (0, 1, 1, "=TEXT(A2,\"0.00E+00\")"),
            (0, 2, 1, "=TEXT(-A2,\"0.00E+00\")"),
            (0, 3, 1, "=TEXT(A1,\"0.0000E+00\")"),
            (0, 4, 1, "=TEXT(A1,\"0E+00\")"),
            (0, 5, 1, "=TEXT(1.005,\"0.00E+00\")"),
            (0, 6, 1, "=TEXT(2.675,\"0.00E+00\")"),
            (0, 7, 1, "=TEXT(9.995,\"0.00E+00\")"),
        ],
        LIMIT,
    )
    .unwrap();
    for r in 0..2 {
        b.sheets[0].cells.get_mut(&(r, 0)).unwrap().format = Some("0.00E+00".into());
    }
    let json = Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap();
    let excel = Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for restored in [&b, &json, &excel] {
        assert_eq!(restored.display(0, 0, 0, LIMIT).unwrap(), "4.94E-324");
        assert_eq!(restored.display(0, 1, 0, LIMIT).unwrap(), "1.48E-323");
        for (r, want) in [
            "4.94E-324",
            "1.48E-323",
            "-1.48E-323",
            "4.9407E-324",
            "5E-324",
            "1.01E+00",
            "2.68E+00",
            "1.00E+01",
        ]
        .into_iter()
        .enumerate()
        {
            assert_eq!(restored.display(0, r, 1, LIMIT).unwrap(), want);
        }
    }
}

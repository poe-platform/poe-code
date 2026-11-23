// Cases adapted from IronCalc's text_functions tests (MIT, LICENSE.IronCalc,
// f93662006b8fb1c401dc870bbda26c5d60ac6037). Arrays are consumed by enclosing
// formulas here; the unchanged upstream audit still checks unsupported spills.
use super::Spreadsheet;

fn check(cases: &[(&str, &str)]) {
    let mut book = Spreadsheet::new();
    let edits: Vec<_> = cases
        .iter()
        .enumerate()
        .map(|(row, (input, _))| (0, row, 0, *input))
        .collect();
    book.edit(&edits, 10_000_000).unwrap();
    for (row, (input, expected)) in cases.iter().enumerate() {
        assert_eq!(
            book.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "{input}"
        );
    }
    let imported =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    for (row, (input, expected)) in cases.iter().enumerate() {
        assert_eq!(
            imported.display(0, row, 0, 1_000_000).unwrap(),
            *expected,
            "Excel: {input}"
        );
    }
}

#[test]
fn text_cleanup_preserves_unicode_and_non_ascii_spaces() {
    check(&[
        ("=CLEAN(\"hello\tworld\")", "helloworld"),
        (
            "=CLEAN(\"é\u{1f}😀\u{7f}\u{85}\u{a0}\")",
            "é😀\u{7f}\u{85}\u{a0}",
        ),
        ("=CLEAN(TRUE)", "TRUE"),
        ("=CLEAN(B1)", ""),
        ("=PROPER(\"it's a TEST\")", "It'S A Test"),
        ("=PROPER(\"élÈVE 2ND-PLACE\")", "Élève 2Nd-Place"),
        ("=PROPER(FALSE)", "False"),
        ("=TRIM(\"a\"&CHAR(9)&CHAR(9)&\"b\")", "a\t\tb"),
        ("=TRIM(CHAR(160)&\"x\"&CHAR(160))", "\u{a0}x\u{a0}"),
        ("=CLEAN(#N/A)", "#N/A"),
        ("=PROPER(#DIV/0!)", "#DIV/0!"),
        ("=CONCAT(PROPER({\"hello\",\"WORLD\"}))", "HelloWorld"),
        ("=CONCAT(CLEAN({\"a\tb\",\"c\nd\"}))", "abcd"),
    ]);
}

#[test]
fn text_character_codes_use_windows1252_and_unicode() {
    check(&[
        ("=CHAR(65)", "A"),
        ("=CHAR(128)", "€"),
        ("=CHAR(255.9)", "ÿ"),
        ("=CHAR(0)", "#VALUE!"),
        ("=CHAR(256)", "#VALUE!"),
        ("=CHAR(-1)", "#VALUE!"),
        ("=CODE(\"€uro\")", "128"),
        ("=CODE(\"ABC\")", "65"),
        ("=CODE(\"☺\")", "#VALUE!"),
        ("=CODE(\"\")", "#VALUE!"),
        ("=CODE(TRUE)", "84"),
        ("=CODE(FALSE)", "70"),
        ("=UNICODE(\"の\")", "12398"),
        ("=UNICODE(\"😀x\")", "128512"),
        ("=_xlfn.UNICODE(\"T\")", "84"),
        ("=UNICODE(TRUE)", "84"),
        ("=UNICODE(12)", "49"),
        ("=UNICODE(\"\")", "#VALUE!"),
        ("=UNICHAR(9786)", "☺"),
        ("=_xlfn.UNICHAR(128512)", "😀"),
        ("=UNICHAR(55296)", "#VALUE!"),
        ("=UNICHAR(57343)", "#VALUE!"),
        ("=UNICHAR(0)", "#VALUE!"),
        ("=UNICHAR(1114112)", "#VALUE!"),
        ("=UNICHAR(1E100)", "#VALUE!"),
        ("=CHAR(\"66\")", "B"),
        ("=CLEAN(CHAR(TRUE))", ""),
        ("=CHAR(B1)", "#VALUE!"),
        ("=UNICODE(B1)", "#VALUE!"),
        ("=UNICODE(#REF!)", "#REF!"),
        ("=SUM(UNICODE({\"H\",\"☺\"}))", "9858"),
        (
            "=CONCAT(IFERROR(CHAR({65,0,300,\"B\",\"66\"}),\"!\"))",
            "A!!!B",
        ),
        (
            "=CONCAT(IFERROR(UNICHAR({66,0,55296,\"x\",\"67\"}),\"!\"))",
            "B!!!C",
        ),
    ]);
}

#[test]
fn text_replace_uses_character_positions_and_bounded_lengths() {
    check(&[
        ("=REPLACEB(\"hello\",2,2,\"XY\")", "hXYlo"),
        ("=REPLACEB(\"a😀éz\",2,2,\"☺\")", "a☺z"),
        ("=REPLACE(\"abcdef\",2,3,\"XY\")", "aXYef"),
        ("=REPLACE(\"hello\",1,0,\"start-\")", "start-hello"),
        ("=REPLACE(\"hello\",6,0,\"-end\")", "hello-end"),
        ("=REPLACE(\"a😀éz\",2,2,\"☺\")", "a☺z"),
        ("=REPLACE(\"abc\",2.9,1.9,\"X\")", "aXc"),
        ("=REPLACE(\"abc\",1E100,1E100,\"!\")", "abc!"),
        ("=REPLACE(\"abc\",2,1E100,\"!\")", "a!"),
        ("=REPLACE(12345,2,2,TRUE)", "1TRUE45"),
        ("=REPLACE(\"abc\",0,1,\"!\")", "#VALUE!"),
        ("=REPLACE(\"abc\",2,-1,\"!\")", "#VALUE!"),
        ("=REPLACE(\"abc\",2,-0.5,\"!\")", "#VALUE!"),
        ("=REPLACE(\"abc\",#N/A,1,\"!\")", "#N/A"),
        ("=REPLACE(\"abc\",2,1,#DIV/0!)", "#DIV/0!"),
        ("=CONCAT(REPLACE({\"abc\",\"def\"},2,1,\"X\"))", "aXcdXf"),
    ]);
}

#[test]
fn text_functions_broadcast_references_without_hiding_empty_or_error_elements() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 1, "Hello"),
            (0, 1, 1, "€"),
            (0, 3, 1, "=NA()"),
            (0, 0, 0, "=SUM(IFERROR(CODE(B1:B4),0))"),
            (0, 1, 0, "=CONCAT(IFERROR(PROPER(B1:B4),\"!\"))"),
            (0, 2, 0, "=SUM(IFERROR(UNICODE(B1:B4),0))"),
        ],
        1_000_000,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, 1_000_000).unwrap(), "200");
    assert_eq!(book.display(0, 1, 0, 1_000_000).unwrap(), "Hello€!");
    assert_eq!(book.display(0, 2, 0, 1_000_000).unwrap(), "8436");
}

#[test]
fn excel_formula_strings_distinguish_controls_from_literal_escape_sequences() {
    check(&[
        ("=CLEAN(\"a\u{1f}b\")", "ab"),
        ("=CLEAN(\"a_x001F_b\")", "a_x001F_b"),
        ("=CLEAN(\"_x005F_x001F_\")", "_x005F_x001F_"),
        ("=CLEAN(\"_xD83D__xDE00_\")", "_xD83D__xDE00_"),
        ("=CLEAN(\"_xFFFF_\")", "_xFFFF_"),
        ("=UNICODE(\"\u{1}\")", "1"),
    ]);
}

#[test]
fn all_windows1252_codes_roundtrip_and_invalid_codes_stay_errors() {
    let mut book = Spreadsheet::new();
    let formulas: Vec<_> = (1..=255).map(|n| format!("=CODE(CHAR({n}))")).collect();
    let edits: Vec<_> = formulas
        .iter()
        .enumerate()
        .map(|(r, f)| (0, r, 0, f.as_str()))
        .collect();
    book.edit(&edits, 10_000_000).unwrap();
    for n in 1..=255 {
        assert_eq!(book.display(0, n - 1, 0, 1_000_000).unwrap(), n.to_string());
    }
    check(&[
        ("=CODE(UNICHAR(128))", "#VALUE!"),
        ("=UNICODE(UNICHAR(1114111))", "1114111"),
        ("=UNICODE(UNICHAR(55295))", "55295"),
        ("=UNICODE(UNICHAR(57344))", "57344"),
        ("=UNICODE(\"\u{0}\")", "0"),
    ]);
}

#[test]
fn text_output_growth_and_large_arrays_obey_limits_and_edits_are_atomic() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "keep")], 10_000).unwrap();
    for formula in [
        "=SUM(CODE(B:B))",
        "=CONCAT(PROPER(B:B))",
        "=CONCAT(REPLACE(B:B,1,0,\"x\"))",
    ] {
        assert!(
            book.edit(&[(0, 0, 0, formula)], 10_000).is_err(),
            "{formula}"
        );
        assert_eq!(book.input(0, 0, 0), "keep");
    }
}

#[test]
fn imported_excel_shared_and_named_formulas_decode_strings_once() {
    let entries: &[(&str, &[u8])] = &[
        ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
        ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="Control">"a_x001F_b"</definedName><definedName name="Literal">"a_x005F_x001F_b"</definedName></definedNames></workbook>"#),
        ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
        ("xl/worksheets/sheet1.xml", br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="str"><f t="shared" ref="A1:A2" si="0">CLEAN("a_x001F_b")&amp;ROW()</f><v>ab1</v></c><c r="B1"><f>CLEAN(Control)</f></c><c r="C1"><f>CLEAN(Literal)</f></c><c r="D1"><f t="array" ref="D1:D2">CODE({"_x005F_x001F_";"B"})</f></c><c r="E1" t="str"><f>"a_x0001_b"</f><v>a_x0001_b</v></c></row><row r="2"><c r="A2" t="str"><f t="shared" si="0"/><v>ab2</v></c><c r="D2"><v>66</v></c></row></sheetData></worksheet>"#),
    ];
    let book =
        Spreadsheet::import_xlsx(&office_package_rust::write_zip_stored(entries), 10_000_000)
            .unwrap();
    let reopened =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    for book in [&book, &reopened] {
        for (r, c, expected) in [
            (0, 0, "ab1"),
            (1, 0, "ab2"),
            (0, 1, "ab"),
            (0, 2, "a_x001F_b"),
            (0, 3, "95"),
            (1, 3, "66"),
            (0, 4, "a\u{1}b"),
        ] {
            assert_eq!(
                book.display(0, r, c, 1_000_000).unwrap(),
                expected,
                "{r},{c}"
            );
        }
    }
}

#[test]
fn repetition_handles_unicode_arrays_and_output_limits() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=REPT(\"ab\",2.9)", "abab"),
        ("=REPT(TRUE,2)", "TRUETRUE"),
        ("=REPT(\"🙂\",2)", "🙂🙂"),
        ("=REPT(\"\",1E100)", ""),
        ("=REPT(\"a\",-0.5)", "#VALUE!"),
        ("=REPT(\"a\",1E100)", "#VALUE!"),
        ("=LEN(REPT(\"a\",32767))", "32767"),
        ("=REPT(\"a\",32768)", "#VALUE!"),
        ("=REPT(\"🙂\",16384)", "#VALUE!"),
        ("=REPT(\"a\",\"abc\")", "#VALUE!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], 10_000_000).unwrap();
        assert_eq!(
            book.display(0, 0, 0, 10_000_000).unwrap(),
            expected,
            "{formula}"
        );
    }
    book.edit(&[(0, 0, 0, "=REPT({\"a\",\"b\"},{2;3})")], 10_000_000)
        .unwrap();
    assert_eq!(book.display(0, 0, 0, 10_000_000).unwrap(), "aa");
    assert_eq!(book.display(0, 1, 1, 10_000_000).unwrap(), "bbb");
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 0, "=REPT(\"a\",32767)")], 30_000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
}

// IronCalc formatter/test_parse_formatted_number.rs (MIT) and Univer
// text/value/__tests__/index.spec.ts (Apache-2.0), plus typed/roundtrip edges.
#[test]
fn value_converts_formatted_text_and_retains_types() {
    check(&[
        (r#"=VALUE("123")"#, "123"),
        ("=VALUE(123)", "123"),
        ("=VALUE(B1)", "0"),
        ("=VALUE(TRUE)", "#VALUE!"),
        ("=VALUE(FALSE)", "#VALUE!"),
        (r#"=VALUE("TRUE")"#, "#VALUE!"),
        (r#"=VALUE("")"#, "#VALUE!"),
        (r#"=VALUE(" ")"#, "#VALUE!"),
        ("=VALUE(#N/A)", "#N/A"),
        ("=VALUE(#DIV/0!)", "#DIV/0!"),
        ("=VALUE()", "#ERROR!"),
        ("=VALUE(1,2)", "#ERROR!"),
        (r#"=VALUE(" 400 ")"#, "400"),
        (r#"=VALUE("20%")"#, "0.2"),
        (r#"=VALUE("2.3E4%")"#, "230"),
        (r#"=VALUE("$1000")"#, "1000"),
        (r#"=VALUE("23€")"#, "23"),
        (r#"=VALUE("-$400")"#, "-400"),
        (r#"=VALUE("$-400")"#, "-400"),
        (r#"=VALUE("-400$")"#, "-400"),
        (r#"=VALUE("-€2.3e4")"#, "-23000"),
        (r#"=VALUE("(5)")"#, "-5"),
        (r#"=VALUE("($1,000)")"#, "-1000"),
        (r#"=VALUE("(1,000)")"#, "-1000"),
        (r#"=VALUE("(5")"#, "#VALUE!"),
        (r#"=VALUE("5)")"#, "#VALUE!"),
        (r#"=VALUE("(+5)")"#, "#VALUE!"),
        (r#"=VALUE("( +5 )")"#, "#VALUE!"),
        (r#"=VALUE("($-5)")"#, "#VALUE!"),
        (r#"=VALUE("(1,00)")"#, "#VALUE!"),
        (r#"=VALUE("123,456.67")"#, "123456.67"),
        (r#"=VALUE("12,34")"#, "#VALUE!"),
        (r#"=VALUE("1,,000")"#, "#VALUE!"),
        (r#"=VALUE("1,000,")"#, "#VALUE!"),
        (r#"=VALUE("1.00,0")"#, "#VALUE!"),
        (r#"=VALUE("23 Hello")"#, "#VALUE!"),
        (r#"=VALUE("2 3")"#, "#VALUE!"),
        (r#"=VALUE("- 23")"#, "#VALUE!"),
        (r#"=VALUE("NaN")"#, "#VALUE!"),
        (r#"=VALUE("inf")"#, "#VALUE!"),
        (r#"=VALUE("1e309")"#, "#VALUE!"),
        (r#"=VALUE("16:48:00")"#, "0.7"),
        (r#"=VALUE("2012-12-12")"#, "41255"),
        (r#"=VALUE("2-Feb-2026")"#, "46055"),
        (r#"=VALUE("1900-01-01")"#, "1"),
        (r#"=VALUE("1900-02-29")"#, "60"),
        (r#"=VALUE("1900-03-01")"#, "61"),
        (r#"=VALUE("2023-02-30")"#, "#VALUE!"),
        (r#"=VALUE("2/3/2023")"#, "44960"),
        (r#"=VALUE("10-12-1999")"#, "36445"),
        (r#"=SUM(VALUE({"1","2.34";"20%","($1,000)"}))"#, "-996.46"),
        (
            r#"=SUM(IFERROR(VALUE({1," ","中文",TRUE,FALSE;0,"100","2.34","ÿ",-3}),0))"#,
            "100.34",
        ),
        (r#"=SUM(VALUE(B1:B3))"#, "0"),
    ]);
}

#[test]
fn value_dates_use_workbook_epoch_after_json_and_excel_roundtrip() {
    let mut book = Spreadsheet::new();
    book.options.date1904 = true;
    book.edit(
        &[
            (0, 0, 0, r#"=VALUE("1904-1-1")"#),
            (0, 1, 0, r#"=VALUE("1904-1-1 12:00")"#),
        ],
        10_000_000,
    )
    .unwrap();
    let json = Spreadsheet::from_json(&book.to_json(), 10_000_000).unwrap();
    let excel =
        Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
    for copy in [&book, &json, &excel] {
        assert_eq!(copy.display(0, 0, 0, 1_000_000).unwrap(), "0");
        assert_eq!(copy.display(0, 1, 0, 1_000_000).unwrap(), "0.5");
    }
}

#[test]
fn value_arrays_preserve_each_upstream_typed_result() {
    // Univer's complete 2x6 VALUE array, including its null/blank cell.
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=VALUE(H1:M2)"),
            (0, 0, 7, "1"),
            (0, 0, 8, "' "),
            (0, 0, 9, "中文"),
            (0, 0, 10, "TRUE"),
            (0, 0, 11, "FALSE"),
            (0, 1, 7, "0"),
            (0, 1, 8, "'100"),
            (0, 1, 9, "'2.34"),
            (0, 1, 10, "ÿ"),
            (0, 1, 11, "-3"),
            (0, 1, 12, "=#NAME?"),
            (0, 3, 0, r#"=VALUE({"2.34"})"#),
        ],
        10_000_000,
    )
    .unwrap();
    for (row, expected) in [
        ["1", "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!", "0"],
        ["0", "100", "2.34", "#VALUE!", "-3", "#NAME?"],
    ]
    .iter()
    .enumerate()
    {
        for (column, expected) in expected.iter().enumerate() {
            assert_eq!(
                book.display(0, row, column, 1_000_000).unwrap(),
                *expected,
                "{row},{column}"
            );
        }
    }
    assert_eq!(book.display(0, 3, 0, 1_000_000).unwrap(), "2.34");
    book.edit(&[(0, 1, 8, "'20%")], 10_000_000).unwrap();
    assert_eq!(book.display(0, 1, 1, 1_000_000).unwrap(), "0.2");
}

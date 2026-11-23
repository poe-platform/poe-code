// IronCalc text/{textsplit,common}.rs and Univer TEXTBEFORE/TEXTAFTER/TEXTSPLIT
// edge cases. See LICENSE.IronCalc and LICENSE.Univer beside this file.
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn split_delimiter_arrays_pad_with_typed_values_and_preserve_numeric_text() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (
                0,
                0,
                0,
                "=TEXTSPLIT(\"001,002;003|004,005\",{\",\",\";\"},\"|\",,,FALSE)",
            ),
            (0, 4, 0, "=TEXTSPLIT(\"a,,b||c\",\",\",\"|\",TRUE,,NA())"),
            (0, 8, 0, "=TEXTSPLIT(\"a|b\",,\"|\")"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, v) in [
        (0, 0, "001"),
        (0, 2, "003"),
        (1, 1, "005"),
        (1, 2, "FALSE"),
        (4, 1, "b"),
        (5, 0, "c"),
        (5, 1, "#N/A"),
        (8, 0, "a"),
        (9, 0, "b"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), v);
    }
    assert_eq!(book.input(0, 0, 1), "'002");
}

#[test]
fn text_delimiter_matching_keeps_original_unicode_byte_boundaries() {
    for (formula, expected) in [
        ("=TEXTSPLIT(\"İaXb\",\"x\",,FALSE,1)", vec!["İa", "b"]),
        (
            "=TEXTSPLIT(\"🌷KÉxKy\",\"k\",,FALSE,1)",
            vec!["🌷", "Éx", "y"],
        ),
        ("=TEXTSPLIT(\"aİb\",\"i̇\",,FALSE,1)", vec!["a", "b"]),
        ("=TEXTBEFORE(\"İaXb\",\"x\",1,1)", vec!["İa"]),
        ("=TEXTAFTER(\"🌷KÉxKy\",\"k\",-1,1)", vec!["y"]),
        ("=TEXTBEFORE(\"150克.*8袋\",\".*\")", vec!["150克"]),
    ] {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        for (c, v) in expected.into_iter().enumerate() {
            assert_eq!(book.display(0, 0, c, LIMIT).unwrap(), v, "{formula}");
        }
    }
}

#[test]
fn before_after_search_reverse_occurrences_and_count_the_end_boundary() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=TEXTAFTER(\"a-b-c\",\"-\",-2)", "b-c"),
        ("=TEXTBEFORE(\"a-b-c\",\"-\",-2)", "a"),
        ("=TEXTAFTER(\"a-b-c\",\"-\",3,0,1)", ""),
        ("=TEXTBEFORE(\"a-b-c\",\"-\",3,0,1)", "a-b-c"),
        ("=TEXTAFTER(\"a-b-c\",\"-\",-3,0,1)", "a-b-c"),
        ("=TEXTBEFORE(\"a-b-c\",\"-\",-3,0,1)", ""),
        ("=TEXTAFTER(\"abc\",\"\",100)", "abc"),
        ("=TEXTBEFORE(\"abc\",\"\",-100)", "abc"),
        ("=TEXTAFTER(\"a-b\",\"-\",,,0,NA())", "b"),
        ("=TEXTAFTER(\"abc\",\"-\",1,0,0,FALSE)", "FALSE"),
        ("=TEXTAFTER(\"abc\",\"-\",1,0,0,Z99)", ""),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn before_after_broadcast_options_and_treat_delimiter_arrays_as_alternatives() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (
                0,
                0,
                0,
                "=TEXTAFTER({\"a:b\";\"c/d\";\"plain\"},{\":\",\"/\"},1,0,0,\"missing\")",
            ),
            (0, 5, 0, "=TEXTBEFORE(\"a-b-c\",\"-\",{1,2;-1,-2})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, v) in [
        (0, 0, "b"),
        (1, 0, "d"),
        (2, 0, "missing"),
        (5, 0, "a"),
        (5, 1, "a-b"),
        (6, 0, "a-b"),
        (6, 1, "a"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), v);
    }
}

#[test]
fn text_split_argument_errors_and_padding_work_limits_are_atomic() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=TEXTSPLIT(\"abc\")", "#ERROR!"),
        ("=TEXTSPLIT(\"abc\",\"\")", "#VALUE!"),
        ("=TEXTSPLIT(\"abc\",\",\",\"\")", "#VALUE!"),
        ("=TEXTSPLIT(\"abc\",\",\",,FALSE,2)", "#VALUE!"),
        ("=TEXTBEFORE(\"abc\",\"a\",0)", "#VALUE!"),
        ("=TEXTAFTER(\"abc\",\"a\",1,-1)", "#VALUE!"),
        ("=TEXTAFTER(\"abc\",\"a\",1,0,2)", "#VALUE!"),
        ("=TEXTAFTER(\"abc\",\"a\",1E300)", "#VALUE!"),
        ("=TEXTBEFORE(NA(),\"a\")", "#N/A"),
        ("=TEXTSPLIT(\"abc\",NA())", "#N/A"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
    book.edit(&[(0, 0, 0, "=TEXTSPLIT(\"a,b\",\",\")")], LIMIT)
        .unwrap();
    let before = book.to_json();
    let text = format!("{}|{}", vec!["a"; 200].join(","), vec!["b"; 200].join("|"));
    let formula = format!("=TEXTSPLIT(\"{text}\",\",\",\"|\",,,REPT(\"x\",1000))");
    assert!(book.edit(&[(0, 0, 0, &formula)], 100_000).is_err());
    assert_eq!(book.to_json(), before);
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "b");
}

#[test]
fn delimiter_functions_roundtrip_as_editable_excel_formulas() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=TEXTSPLIT(\"Ada:94|Lin:91\",\":\",\"|\")"),
            (0, 4, 0, "=TEXTBEFORE(\"Grace:87\",\":\")"),
            (0, 5, 0, "=TEXTAFTER(\"Mina:85\",\":\")"),
        ],
        LIMIT,
    )
    .unwrap();
    let json = book.to_json();
    let book = Spreadsheet::from_json(&json, LIMIT).unwrap();
    let book = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for (r, c, v) in [
        (0, 0, "Ada"),
        (1, 0, "Lin"),
        (1, 1, "91"),
        (4, 0, "Grace"),
        (5, 0, "85"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), v);
    }
    assert!(book.input(0, 0, 0).starts_with("=TEXTSPLIT("));
}

#[test]
fn text_boundary_errors_stay_elementwise_and_source_errors_take_precedence() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=TEXTBEFORE({#N/A;\"abc\"},1/0)"),
            (0, 4, 0, "=TEXTAFTER(NA(),1/0)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#N/A");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "#DIV/0!");
    assert_eq!(book.display(0, 4, 0, LIMIT).unwrap(), "#N/A");
}

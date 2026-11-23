use super::{Spreadsheet, Value};
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn character_functions_coerce_text_and_validate_positions() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        (r#"=LEN(TRUE)"#, "4"),
        (r#"=LEN(FALSE)"#, "5"),
        (r#"=LEN("é😀é")"#, "4"),
        (r#"=LEN(B100)"#, "0"),
        (r#"=LEFT(TRUE,3)"#, "TRU"),
        (r#"=RIGHT(FALSE,3)"#, "LSE"),
        (r#"=MID(TRUE,2,2)"#, "RU"),
        (r#"=TRIM(TRUE)"#, "TRUE"),
        (r#"=LEFT("é😀x",2)"#, "é😀"),
        (r#"=RIGHT("é😀x",2)"#, "😀x"),
        (r#"=MID("é😀x",2,1)"#, "😀"),
        (r#"=LEFT("abc",TRUE)"#, "a"),
        (r#"=RIGHT("abc",FALSE)"#, ""),
        (r#"=MID("abc","2","2")"#, "bc"),
        (r#"=LEFT("abc",1E100)"#, "abc"),
        (r#"=RIGHT("abc",1E100)"#, "abc"),
        (r#"=MID("abc",1E100,1E100)"#, ""),
        (r#"=MID("abc",2,1E100)"#, "bc"),
        (r#"=MID("abc",0,1)"#, "#VALUE!"),
        (r#"=LEFT("abc",-0.5)"#, "#VALUE!"),
        (r#"=LEFT("abc","NaN")"#, "#VALUE!"),
        (r#"=MID("abc","inf",1)"#, "#VALUE!"),
        (r#"=LEFT("abc",)"#, ""),
        (r#"=RIGHT("abc",B100)"#, ""),
        (r#"=LENB("é😀")"#, "2"),
        (r#"=LEFTB("é😀x",2)"#, "é😀"),
        (r#"=RIGHTB("é😀x",2)"#, "😀x"),
        (r#"=MIDB("é😀x",2,1)"#, "😀"),
        (r#"=LEFT(#DIV/0!,#N/A)"#, "#DIV/0!"),
        (r#"=RIGHT(#N/A,#DIV/0!)"#, "#N/A"),
        (r#"=MID(#DIV/0!,#N/A,#REF!)"#, "#DIV/0!"),
        (r#"=TRIM("  a   b  ")"#, "a b"),
        (r#"=TRIM(" a "&CHAR(9)&" b ")"#, "a \t b"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}

#[test]
fn character_functions_preserve_array_shape_and_error_order() {
    let mut b = Spreadsheet::new();
    for f in [
        r#"=LEFT({#DIV/0!,"ab","c"},NA())"#,
        r#"=RIGHT({#DIV/0!,"ab","c"},NA())"#,
        r#"=MID({#DIV/0!,"ab","c"},1,NA())"#,
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        for (c, e) in [(0, "#DIV/0!"), (1, "#N/A"), (2, "#N/A")] {
            assert_eq!(b.display(0, 0, c, LIMIT).unwrap(), e, "{f} at {c}");
        }
    }
    b.edit(&[(0, 0, 0, r#"=TRIM({" a  b ",TRUE,#CALC!})"#)], LIMIT)
        .unwrap();
    for (c, e) in [(0, "a b"), (1, "TRUE"), (2, "#CALC!")] {
        assert_eq!(b.display(0, 0, c, LIMIT).unwrap(), e);
    }
    assert!(matches!(
        b.cell(0, 0, 1).unwrap().value,
        Some(Value::Text(_))
    ));
}

#[test]
fn character_function_arity_is_a_formula_error() {
    let mut b = Spreadsheet::new();
    for f in [
        "=LEN()",
        "=LEN(1,2)",
        "=TRIM()",
        "=TRIM(1,2)",
        "=LEFT()",
        "=LEFT(1,2,3)",
        "=RIGHT()",
        "=MID(1,2)",
        "=MID(1,2,3,4)",
        "=CLEAN()",
        "=PROPER()",
        "=REPLACE(1,2,3)",
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), "#ERROR!", "{f}");
    }
}

#[test]
fn character_function_arrays_survive_tables_edits_and_reopening() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Label"),
            (0, 1, 0, "  Rust  fast  "),
            (0, 2, 0, "  é😀 small  "),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Labels", [0, 0, 2, 0], LIMIT).unwrap();
    b.edit(
        &[
            (0, 1, 2, "=TRIM(Labels[Label])"),
            (0, 1, 3, "=LEN(C2:C3)"),
            (0, 1, 4, "=LEFT(C2:C3,2)"),
            (0, 1, 5, "=MID(C2:C3,2,2)"),
            (0, 1, 6, "=RIGHT(C2:C3,4)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut book in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (c, e) in [
            (2, "é😀 small"),
            (3, "8"),
            (4, "é😀"),
            (5, "😀 "),
            (6, "mall"),
        ] {
            assert_eq!(book.display(0, 2, c, LIMIT).unwrap(), e);
        }
        book.edit(&[(0, 2, 0, "  Rust  compact ")], LIMIT).unwrap();
        for (c, e) in [
            (2, "Rust compact"),
            (3, "12"),
            (4, "Ru"),
            (5, "us"),
            (6, "pact"),
        ] {
            assert_eq!(book.display(0, 2, c, LIMIT).unwrap(), e);
        }
    }
}

#[test]
fn character_function_array_budget_failure_restores_document() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[(0, 0, 0, "=SEQUENCE(20)"), (0, 0, 2, &"a".repeat(5000))],
        LIMIT,
    )
    .unwrap();
    let before = b.to_json();
    for f in [
        r#"=LEFT(IF(A1:A20>0,$C$1,""),5000)"#,
        r#"=RIGHT(IF(A1:A20>0,$C$1,""),5000)"#,
        r#"=MID(IF(A1:A20>0,$C$1,""),1,5000)"#,
        r#"=TRIM(IF(A1:A20>0,$C$1,""))"#,
    ] {
        assert!(b.edit(&[(0, 0, 1, f)], 200_000).is_err());
        assert_eq!(b.to_json(), before);
    }
}

#[test]
fn trim_preserves_non_space_unicode_and_the_first_space_of_each_run() {
    let mut b = Spreadsheet::new();
    for (source, expected) in [
        ("　张三　", "张三"),
        ("　a　　b　", "a　b"),
        (" a 　b ", "a b"),
        (" a　 b ", "a　b"),
        ("a\t\r\nb", "a\t\r\nb"),
        ("\u{a0}a\u{a0}", "\u{a0}a\u{a0}"),
        (
            "\u{2002}\u{2003}\u{2009}\u{200a}\u{202f}\u{2028}\u{2029}\u{feff}",
            "\u{2002}\u{2003}\u{2009}\u{200a}\u{202f}\u{2028}\u{2029}\u{feff}",
        ),
    ] {
        b.edit(&[(0, 0, 0, source), (0, 0, 1, "=TRIM(A1)")], LIMIT)
            .unwrap();
        assert_eq!(b.display(0, 0, 1, LIMIT).unwrap(), expected);
    }
}

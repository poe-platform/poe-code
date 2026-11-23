use super::{Spreadsheet, Value};
const LIMIT: usize = 32 * 1024 * 1024;
fn text(b: &Spreadsheet, r: usize, c: usize, want: &str) {
    let cell = b.cell(0, r, c).unwrap();
    assert!(
        matches!(&cell.value,Some(Value::Text(s)) if s==want),
        "{r},{c}: {} != text {want:?}",
        b.display(0, r, c, LIMIT).unwrap()
    );
}
#[test]
fn to_text_typed_values_and_excel_numeric_spelling() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=VALUETOTEXT(123)"),
            (0, 1, 0, "=VALUETOTEXT(TRUE)"),
            (0, 2, 0, "=VALUETOTEXT(1/0)"),
            (0, 3, 0, "=VALUETOTEXT(Z99)"),
            (0, 4, 0, "=VALUETOTEXT(0.000000007123456)"),
            (0, 5, 0, "=VALUETOTEXT(1/3)"),
            (0, 6, 0, "=VALUETOTEXT(\"100\",1)"),
            (0, 7, 0, "=VALUETOTEXT(\"a\"\"b\",1)"),
            (0, 8, 0, "=ARRAYTOTEXT({1,\"hello\";2,\"world\"})"),
            (0, 9, 0, "=ARRAYTOTEXT({1,\"hello\";2,\"world\"},1)"),
            (0, 10, 0, "=ARRAYTOTEXT({TRUE,#N/A;1,\"a\"\"b\"},1)"),
            (0, 11, 0, "=ARRAYTOTEXT(7,1)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, want) in [
        (0, "123"),
        (1, "TRUE"),
        (2, "#DIV/0!"),
        (3, ""),
        (4, "0.000000007123456"),
        (5, "0.333333333333333"),
        (6, "\"100\""),
        (7, "\"a\"\"b\""),
        (8, "1, hello, 2, world"),
        (9, "{1,\"hello\";2,\"world\"}"),
        (10, "{TRUE,#N/A;1,\"a\"\"b\"}"),
        (11, "{7}"),
    ] {
        text(&b, r, 0, want);
    }
}
#[test]
fn to_text_validates_formats_and_preserves_local_errors() {
    let mut b = Spreadsheet::new();
    for f in ["ARRAYTOTEXT", "VALUETOTEXT"] {
        for (args, want) in [
            ("", "#ERROR!"),
            ("1,0,0", "#ERROR!"),
            ("1,2", "#VALUE!"),
            ("1,-0.1", "#VALUE!"),
            ("1,\"x\"", "#VALUE!"),
            ("1,#N/A", "#N/A"),
        ] {
            let formula = format!("={f}({args})");
            b.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
            assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
        }
        b.edit(&[(0, 0, 0, &format!("=IFERROR({f}(),\"caught\")"))], LIMIT)
            .unwrap();
        text(&b, 0, 0, "caught");
    }
    b.edit(
        &[
            (0, 0, 0, "=ARRAYTOTEXT({1,\"x\"},{0;1;2;#N/A})"),
            (0, 0, 3, "=VALUETOTEXT({TRUE;1;#DIV/0!},{0,1})"),
        ],
        LIMIT,
    )
    .unwrap();
    text(&b, 0, 0, "1, x");
    text(&b, 1, 0, "{1,\"x\"}");
    assert_eq!(b.display(0, 2, 0, LIMIT).unwrap(), "#VALUE!");
    for (r, want) in [(0, "TRUE"), (1, "1"), (2, "#DIV/0!")] {
        text(&b, r, 3, want);
        text(&b, r, 4, want);
    }
}
#[test]
fn to_text_bounds_unicode_output_and_sparse_ranges() {
    let mut b = Spreadsheet::new();
    for (formula, want) in [
        ("=LEN(ARRAYTOTEXT(REPT(\"a\",32763),1))", "32767"),
        ("=ARRAYTOTEXT(REPT(\"a\",32764),1)", "#CALC!"),
        ("=LEN(VALUETOTEXT(REPT(\"a\",32765),1))", "32767"),
        ("=VALUETOTEXT(REPT(\"a\",32766),1)", "#VALUE!"),
        ("=ARRAYTOTEXT(REPT(\"😀\",16383),1)", "#CALC!"),
        ("=ARRAYTOTEXT(B:XFD)", "#CALC!"),
        ("=ARRAYTOTEXT(Z:Z)", "#CALC!"),
        ("=ARRAYTOTEXT(Z:Z,1)", "#CALC!"),
    ] {
        b.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
    b.edit(
        &[(0, 0, 0, "=ARRAYTOTEXT({1,2},SEQUENCE(100,1,0,0))")],
        LIMIT,
    )
    .unwrap();
    text(&b, 99, 0, "1, 2");
    let before = b.to_json();
    assert!(
        b.edit(&[(0, 0, 0, "=VALUETOTEXT(SEQUENCE(100000))")], 100_000)
            .is_err()
    );
    assert_eq!(b.to_json(), before);
}
#[test]
fn to_text_json_excel_roundtrips_and_blank_reference_cells() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Label"),
            (0, 0, 1, "Count"),
            (0, 1, 0, "a\"b"),
            (0, 1, 1, "7"),
            (0, 2, 1, "TRUE"),
            (0, 0, 3, "=ARRAYTOTEXT(A2:B3,1)"),
            (0, 2, 3, "=VALUETOTEXT(A2:B3,1)"),
            (0, 5, 3, "=TYPE(VALUETOTEXT(7))"),
        ],
        LIMIT,
    )
    .unwrap();
    for b in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        b,
    ] {
        text(&b, 0, 3, "{\"a\"\"b\",7;,TRUE}");
        text(&b, 2, 3, "\"a\"\"b\"");
        text(&b, 2, 4, "7");
        text(&b, 3, 3, "");
        text(&b, 3, 4, "TRUE");
        assert_eq!(b.display(0, 5, 3, LIMIT).unwrap(), "2");
    }
}

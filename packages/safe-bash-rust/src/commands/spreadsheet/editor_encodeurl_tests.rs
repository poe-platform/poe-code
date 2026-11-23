// Adapted from IronCalc f936620 test_fn_encodeurl.rs and Univer 4767b3b
// web/encodeurl. See LICENSE.IronCalc and LICENSE.Univer. Excel/Univer encode
// tilde as %7E; IronCalc deliberately leaves it unescaped.
use super::{Spreadsheet, Value};
const LIMIT: usize = 128 * 1024 * 1024;
fn text(b: &Spreadsheet, r: usize, c: usize) -> String {
    match b.cell(0, r, c).and_then(|c| c.value.clone()) {
        Some(Value::Text(s)) => s,
        _ => panic!("{r},{c}: {}", b.display(0, r, c, LIMIT).unwrap()),
    }
}
#[test]
fn encodeurl_upstream_strings_utf8_coercion_and_errors() {
    let mut b = Spreadsheet::new();
    for (f, expected) in [
        (
            r#"=ENCODEURL("https://univer.ai/")"#,
            "https%3A%2F%2Funiver.ai%2F",
        ),
        (r#"=ENCODEURL("AZaz09-._")"#, "AZaz09-._"),
        (r#"=ENCODEURL("~!*'()")"#, "%7E%21%2A%27%28%29"),
        (
            r#"=ENCODEURL("a b+c&d=e?f/g:h")"#,
            "a%20b%2Bc%26d%3De%3Ff%2Fg%3Ah",
        ),
        (
            r#"=ENCODEURL("ü€日本😀")"#,
            "%C3%BC%E2%82%AC%E6%97%A5%E6%9C%AC%F0%9F%98%80",
        ),
        (r#"=ENCODEURL("100% ""sure""")"#, "100%25%20%22sure%22"),
        (r#"=ENCODEURL(CHAR(9)&CHAR(10)&CHAR(13))"#, "%09%0A%0D"),
        (r#"=ENCODEURL("")"#, ""),
        ("=ENCODEURL(B100)", ""),
        ("=ENCODEURL(TRUE)", "TRUE"),
        ("=ENCODEURL(FALSE)", "FALSE"),
        ("=ENCODEURL(12.5)", "12.5"),
        ("=ENCODEURL(1/3)", "0.333333333333333"),
        ("=ENCODEURL(1E20)", "1E%2B20"),
        ("=ENCODEURL(0.0000001)", "0.0000001"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(text(&b, 0, 0), expected, "{f}");
    }
    for (f, e) in [
        ("=ENCODEURL()", "#ERROR!"),
        ("=ENCODEURL(1,2)", "#ERROR!"),
        ("=ENCODEURL(#NAME?)", "#NAME?"),
        ("=ENCODEURL(1/0)", "#DIV/0!"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}
#[test]
fn encodeurl_arrays_preserve_typed_results_and_source_errors() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "a b"),
            (0, 1, 0, "hello world"),
            (0, 2, 0, "=1/0"),
            (0, 0, 1, "=ENCODEURL(A1:A3)"),
            (0, 0, 2, "=INDEX(ENCODEURL(A1:A3),2)"),
            (0, 0, 3, r#"=ENCODEURL({"x y",1.5;FALSE,#N/A})"#),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, e) in [
        (0, 1, "a%20b"),
        (1, 1, "hello%20world"),
        (0, 2, "hello%20world"),
        (0, 3, "x%20y"),
        (0, 4, "1.5"),
        (1, 3, "FALSE"),
    ] {
        assert_eq!(text(&b, r, c), e);
    }
    assert_eq!(b.display(0, 2, 1, LIMIT).unwrap(), "#DIV/0!");
    assert_eq!(b.display(0, 1, 4, LIMIT).unwrap(), "#N/A");
}
#[test]
fn encodeurl_size_limits_and_budget_rollback() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        (r#"=LEN(ENCODEURL(REPT(" ",10922)))"#, "32766"),
        (r#"=ENCODEURL(REPT(" ",10923))"#, "#VALUE!"),
        (r#"=LEN(ENCODEURL(REPT("a",32766)))"#, "32766"),
        (r#"=ENCODEURL(REPT("a",32767))"#, "#VALUE!"),
        (r#"=LEN(ENCODEURL(REPT("ü",5461)))"#, "32766"),
        (r#"=ENCODEURL(REPT("ü",5462))"#, "#VALUE!"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
    b.edit(
        &[(0, 0, 0, "=SEQUENCE(20)"), (0, 0, 2, &" ".repeat(5000))],
        LIMIT,
    )
    .unwrap();
    let before = b.to_json();
    assert!(
        b.edit(&[(0, 0, 1, r#"=ENCODEURL(IF(A1:A20>0,$C$1,""))"#)], 200_000)
            .is_err()
    );
    assert_eq!(b.to_json(), before);
}
#[test]
fn encodeurl_tables_edits_and_json_excel_reopening() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Search"),
            (0, 1, 0, "red & blue"),
            (0, 2, 0, "日本"),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Queries", [0, 0, 2, 0], LIMIT).unwrap();
    b.edit(&[(0, 1, 2, "=ENCODEURL(Queries[Search])")], LIMIT)
        .unwrap();
    for mut x in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(text(&x, 1, 2), "red%20%26%20blue");
        assert_eq!(text(&x, 2, 2), "%E6%97%A5%E6%9C%AC");
        x.edit(&[(0, 1, 0, "C++ ~ Rust")], LIMIT).unwrap();
        assert_eq!(text(&x, 1, 2), "C%2B%2B%20%7E%20Rust");
    }
}

#[test]
fn encodeurl_all_ascii_bytes_and_combining_unicode() {
    let mut b = Spreadsheet::new();
    b.edit(&[(0,0,0," !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"),(0,0,1,"=ENCODEURL(A1)")],LIMIT).unwrap();
    assert_eq!(
        text(&b, 0, 1),
        "%20%21%22%23%24%25%26%27%28%29%2A%2B%2C-.%2F0123456789%3A%3B%3C%3D%3E%3F%40ABCDEFGHIJKLMNOPQRSTUVWXYZ%5B%5C%5D%5E_%60abcdefghijklmnopqrstuvwxyz%7B%7C%7D%7E"
    );
    b.edit(&[(0, 0, 0, "mañaná ñ"), (0, 0, 1, "=ENCODEURL(A1)")], LIMIT)
        .unwrap();
    assert_eq!(text(&b, 0, 1), "ma%C3%B1ana%CC%81%20%C3%B1");
    b.edit(
        &[(0, 0, 0, "\u{0}\u{1f}\u{7f}"), (0, 0, 1, "=ENCODEURL(A1)")],
        LIMIT,
    )
    .unwrap();
    assert_eq!(text(&b, 0, 1), "%00%1F%7F");
}

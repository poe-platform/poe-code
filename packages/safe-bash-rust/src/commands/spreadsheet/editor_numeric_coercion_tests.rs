// Numeric text conversion adapts IronCalc f936620 number_format.rs and its
// test_fn_concatenate.rs (MIT; LICENSE.IronCalc).
use super::{Spreadsheet, Value};
const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn numeric_text_uses_excel_precision_and_decimal_window() {
    let mut book = Spreadsheet::new();
    let cases = [
        ("0.1+0.2", "0.3"),
        ("1/3", "0.333333333333333"),
        ("1E15", "1000000000000000"),
        ("1E19", "10000000000000000000"),
        ("1E20", "1E+20"),
        ("1E-7", "0.0000001"),
        ("1E-15", "0.000000000000001"),
        ("1E-20", "1E-20"),
        ("1.23456789012346E17", "123456789012346000"),
        ("1E-18", "0.000000000000000001"),
        ("1E-19", "1E-19"),
        ("1.5E-18", "1.5E-18"),
        ("-1E-19", "-1E-19"),
        ("1.23456789012345E19", "12345678901234500000"),
        ("1.23456789012346E21", "1.23456789012346E+21"),
        ("0", "0"),
        ("-0", "0"),
        ("9007199254740991", "9007199254740990"),
        ("1.7976931348623157E308", "1.79769313486232E+308"),
        ("2.2250738585072014E-308", "2.2250738585072E-308"),
    ];
    for (n, expected) in cases {
        for source in [
            format!("=CONCAT({n})"),
            format!("=CONCATENATE({n})"),
            format!("={n}&\"\""),
            format!("=TRIM({n})"),
            format!("=UPPER({n})"),
        ] {
            book.edit(&[(0, 0, 0, &source)], LIMIT).unwrap();
            assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{source}");
            assert!(matches!(
                book.cell(0, 0, 0).unwrap().value,
                Some(Value::Text(_))
            ));
        }
    }
}

#[test]
fn text_consumers_share_numeric_coercion_and_keep_booleans() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=LEN(1E15)", "16"),
        ("=LEFT(1E20,3)", "1E+"),
        ("=RIGHT(1E20,2)", "20"),
        ("=MID(1E15,2,3)", "000"),
        ("=EXACT(1E20,\"1E+20\")", "TRUE"),
        ("=SUBSTITUTE(1E20,\"E+\",\" × 10^\")", "1 × 10^20"),
        ("=TEXTBEFORE(1E20,\"E\")", "1"),
        ("=TEXTAFTER(1E20,\"E\")", "+20"),
        ("=REGEXREPLACE(1E20,\"E[+]\",\"e\")", "1e20"),
        ("=LOWER(1E20)", "1e+20"),
        ("=TRUE&FALSE", "TRUEFALSE"),
        ("=UPPER(TRUE)", "TRUE"),
        ("=LOWER(FALSE)", "false"),
        (
            "=CONCAT(1E-18,\" / \",1.5E-18)",
            "0.000000000000000001 / 1.5E-18",
        ),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn numeric_text_arrays_and_table_sources_survive_reopening() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[(0, 0, 0, "Amount"), (0, 1, 0, "1E20"), (0, 2, 0, "1E-18")],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Values", [0, 0, 2, 0], LIMIT).unwrap();
    book.edit(
        &[
            (0, 1, 2, "=CONCATENATE(Values[Amount],\" USD\")"),
            (0, 4, 2, "=Values[Amount]&\" USD\""),
            (0, 7, 2, "=LEN(Values[Amount])"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut reopened in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, e) in [
            (1, "1E+20 USD"),
            (2, "0.000000000000000001 USD"),
            (4, "1E+20 USD"),
            (5, "0.000000000000000001 USD"),
            (7, "5"),
            (8, "20"),
        ] {
            assert_eq!(reopened.display(0, r, 2, LIMIT).unwrap(), e);
        }
        reopened.edit(&[(0, 1, 0, "1.5E-18")], LIMIT).unwrap();
        assert_eq!(reopened.display(0, 1, 2, LIMIT).unwrap(), "1.5E-18 USD");
        reopened.rename_table(0, "Costs", LIMIT).unwrap();
        assert_eq!(reopened.display(0, 4, 2, LIMIT).unwrap(), "1.5E-18 USD");
    }
}

#[test]
fn concatenation_truncates_at_excel_limit_and_rolls_back_exhausted_edits() {
    let mut book = Spreadsheet::new();
    for (f, e) in [
        ("=LEN(REPT(\"a\",32766)&\"b\")", "32767"),
        ("=LEN(REPT(\"a\",32767)&\"b\")", "32767"),
        ("={#DIV/0!,1E20}&NA()", "#DIV/0!"),
    ] {
        book.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
    let before = book.to_json();
    assert!(
        book.edit(
            &[
                (0, 2, 0, "changed"),
                (0, 0, 0, "=CONCATENATE(SEQUENCE(10000),1E20)")
            ],
            100000
        )
        .is_err()
    );
    assert_eq!(book.to_json(), before);
}

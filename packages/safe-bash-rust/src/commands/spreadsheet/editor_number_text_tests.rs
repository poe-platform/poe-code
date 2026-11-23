// Adapted from IronCalc f936620 text/string_format.rs and Univer 4767b3b
// text/{numbervalue,fixed,dollar}; see LICENSE.IronCalc and LICENSE.Univer.
use super::{Spreadsheet, Value};
const LIMIT: usize = 128 * 1024 * 1024;
fn number(b: &Spreadsheet, r: usize, c: usize) -> f64 {
    match b.cell(0, r, c).and_then(|c| c.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!("{r},{c}: {}", b.display(0, r, c, LIMIT).unwrap()),
    }
}
fn text(b: &Spreadsheet, r: usize, c: usize) -> String {
    match b.cell(0, r, c).and_then(|c| c.value.clone()) {
        Some(Value::Text(s)) => s,
        _ => panic!("{r},{c}: {}", b.display(0, r, c, LIMIT).unwrap()),
    }
}
#[test]
fn numbervalue_separators_percent_whitespace_and_scientific_notation() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=NUMBERVALUE(\"1234.56\")", 1234.56),
        ("=NUMBERVALUE(\"1.234,56\",\",\",\".\")", 1234.56),
        ("=NUMBERVALUE(\"3.5%\")", 0.035),
        ("=NUMBERVALUE(\"9%%\")", 0.0009),
        ("=NUMBERVALUE(\"\")", 0.),
        ("=NUMBERVALUE(\"   \")", 0.),
        ("=NUMBERVALUE(B100)", 0.),
        ("=NUMBERVALUE(\" 3 000 \")", 3000.),
        ("=NUMBERVALUE(\"- 5 %\")", -0.05),
        ("=NUMBERVALUE(\"3\"&CHAR(9)&\"000\")", 3000.),
        ("=NUMBERVALUE(\"3\"&CHAR(10)&\"000\")", 3000.),
        ("=NUMBERVALUE(\"1.234,5\",\",;\",\".;\")", 1234.5),
        ("=NUMBERVALUE(\"1,2,3.5\")", 123.5),
        ("=NUMBERVALUE(\" 5.5 \",\".\",\"\")", 5.5),
        ("=NUMBERVALUE(\"%\")", 0.),
        ("=NUMBERVALUE(\" % \")", 0.),
        ("=NUMBERVALUE(\"12T34\",TRUE,\",\")", 12.34),
        ("=NUMBERVALUE(\"1F234.5\",\".\",FALSE)", 1234.5),
        ("=NUMBERVALUE(\".5\")", 0.5),
        ("=NUMBERVALUE(\"5.\")", 5.),
        ("=NUMBERVALUE(\"1e3\")", 1000.),
        ("=NUMBERVALUE(\"1.25e2%%\")", 0.0125),
        ("=NUMBERVALUE(\"1٬234٫5\",\"٫\",\"٬\")", 1234.5),
        ("=NUMBERVALUE(\"1🟢234🔴5\",\"🔴\",\"🟢\")", 1234.5),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        let n = number(&b, 0, 0);
        assert!((n - e).abs() <= e.abs() * 1e-14, "{f}: {n} != {e}");
    }
}
#[test]
fn number_text_type_domain_and_arity_errors() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=NUMBERVALUE()", "#ERROR!"),
        ("=NUMBERVALUE(1,2,3,4)", "#ERROR!"),
        ("=FIXED()", "#ERROR!"),
        ("=DOLLAR(1,2,3)", "#ERROR!"),
        ("=NUMBERVALUE(\"bad\")", "#VALUE!"),
        ("=NUMBERVALUE(TRUE)", "#VALUE!"),
        ("=NUMBERVALUE(\"1.000,5\")", "#VALUE!"),
        ("=NUMBERVALUE(\"1,000.5,0\")", "#VALUE!"),
        ("=NUMBERVALUE(\"1.2.3\")", "#VALUE!"),
        ("=NUMBERVALUE(\"1,5\",\",\",\",\")", "#VALUE!"),
        ("=NUMBERVALUE(\"1,5\",\"\",\"\")", "#VALUE!"),
        ("=NUMBERVALUE(\"1 000\",\".\",\"\")", "#VALUE!"),
        ("=NUMBERVALUE(\"1,000\",\".\",\"\")", "#VALUE!"),
        ("=NUMBERVALUE(\"3\"&CHAR(160)&\"000\")", "#VALUE!"),
        ("=NUMBERVALUE(\"1e309\")", "#VALUE!"),
        ("=NUMBERVALUE(\"NaN\")", "#VALUE!"),
        ("=NUMBERVALUE(\"inf\")", "#VALUE!"),
        ("=NUMBERVALUE(\"123\",#REF!)", "#REF!"),
        ("=FIXED(\"bad\")", "#VALUE!"),
        ("=FIXED(\" \")", "#VALUE!"),
        ("=FIXED(\"TRUE\")", "#VALUE!"),
        ("=FIXED(1,128)", "#VALUE!"),
        ("=DOLLAR(1,1E100)", "#VALUE!"),
        ("=FIXED(1,2,\"bad\")", "#VALUE!"),
        ("=DOLLAR(1,#N/A)", "#N/A"),
        ("=FIXED(1,2,#REF!)", "#REF!"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}
#[test]
fn fixed_dollar_decimal_rounding_signs_and_defaults() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=DOLLAR(1234.567)", "$1,234.57"),
        ("=DOLLAR(1234.567,0)", "$1,235"),
        ("=DOLLAR(-1234.5,2)", "($1,234.50)"),
        ("=DOLLAR(1234.5,-2)", "$1,200"),
        ("=FIXED(1234.567)", "1,234.57"),
        ("=FIXED(1234.567,0)", "1,235"),
        ("=FIXED(1234.567,2,TRUE)", "1234.57"),
        ("=FIXED(-1234.5,2)", "-1,234.50"),
        ("=FIXED(1234.567,4)", "1,234.5670"),
        ("=FIXED(1234.567,-4)", "0"),
        ("=FIXED(1234.567,-10)", "0"),
        ("=FIXED(1234.567,-1.9)", "1,230"),
        ("=FIXED(TRUE)", "1.00"),
        ("=DOLLAR(FALSE)", "$0.00"),
        ("=FIXED(\"12.345\",2,\"TRUE\")", "12.35"),
        ("=FIXED(1234.567,,TRUE)", "1234.57"),
        ("=FIXED(1234.567,B100,TRUE)", "1235"),
        ("=DOLLAR(1234.567,)", "$1,234.57"),
        ("=DOLLAR(1234.567,B100)", "$1,235"),
        ("=FIXED(1.005,2)", "1.01"),
        ("=FIXED(2.675,2)", "2.68"),
        ("=FIXED(999.995,2)", "1,000.00"),
        ("=FIXED(994.9,-1)", "990"),
        ("=FIXED(995,-1)", "1,000"),
        ("=FIXED(-995,-1)", "-1,000"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(text(&b, 0, 0), e, "{f}");
    }
}
#[test]
fn number_text_upstream_arrays_and_broadcasting() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[(
            0,
            0,
            0,
            "=FIXED({1,\" \",1.23,TRUE,FALSE,0;0,\"100\",\"2.34\",\"test\",-3,#NAME?})",
        )],
        LIMIT,
    )
    .unwrap();
    for (r, expected) in [
        ["1.00", "#VALUE!", "1.23", "1.00", "0.00", "0.00"],
        ["0.00", "100.00", "2.34", "#VALUE!", "-3.00", "#NAME?"],
    ]
    .into_iter()
    .enumerate()
    {
        for (c, e) in expected.into_iter().enumerate() {
            assert_eq!(b.display(0, r, c, LIMIT).unwrap(), e);
        }
    }
    b.edit(
        &[(
            0,
            4,
            0,
            "=DOLLAR({1,\" \",1.23,TRUE,FALSE,0;0,\"100\",\"2.34\",\"test\",-3,#NAME?})",
        )],
        LIMIT,
    )
    .unwrap();
    for (r, expected) in [
        ["$1.00", "#VALUE!", "$1.23", "$1.00", "$0.00", "$0.00"],
        ["$0.00", "$100.00", "$2.34", "#VALUE!", "($3.00)", "#NAME?"],
    ]
    .into_iter()
    .enumerate()
    {
        for (c, e) in expected.into_iter().enumerate() {
            assert_eq!(b.display(0, r + 4, c, LIMIT).unwrap(), e);
        }
    }
    b.edit(
        &[(
            0,
            12,
            0,
            "=NUMBERVALUE({1,\" \",1.23,TRUE,FALSE,0;0,\"2,500.27\",\"20%\",\"test\",-3,#NAME?})",
        )],
        LIMIT,
    )
    .unwrap();
    for (r, expected) in [
        ["1", "0", "1.23", "#VALUE!", "#VALUE!", "0"],
        ["0", "2500.27", "0.2", "#VALUE!", "-3", "#NAME?"],
    ]
    .into_iter()
    .enumerate()
    {
        for (c, e) in expected.into_iter().enumerate() {
            assert_eq!(b.display(0, r + 12, c, LIMIT).unwrap(), e);
        }
    }
    b.edit(
        &[(
            0,
            8,
            0,
            "=NUMBERVALUE({\"1,234.5\";\"1.234,5\"},{\".\",\",\"},{\",\",\".\"})",
        )],
        LIMIT,
    )
    .unwrap();
    assert_eq!(number(&b, 8, 0), 1234.5);
    assert_eq!(number(&b, 9, 1), 1234.5);
    assert_eq!(b.display(0, 8, 1, LIMIT).unwrap(), "#VALUE!");
    assert_eq!(b.display(0, 9, 0, LIMIT).unwrap(), "#VALUE!");
}
#[test]
fn number_text_large_values_precision_bounds_and_budget_rollback() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        (
            "=FIXED(1E30,2,TRUE)".to_string(),
            format!("1{}.00", "0".repeat(30)),
        ),
        (
            "=FIXED(1.7E308,-308,TRUE)".to_string(),
            format!("2{}", "0".repeat(308)),
        ),
        ("=FIXED(1E308,-309,TRUE)".to_string(), "0".into()),
        (
            "=FIXED(1.25,127,TRUE)".to_string(),
            format!("1.25{}", "0".repeat(125)),
        ),
        ("=FIXED(1,-1E100,TRUE)".to_string(), "0".into()),
    ] {
        b.edit(&[(0, 0, 0, &f)], LIMIT).unwrap();
        assert_eq!(text(&b, 0, 0), e, "{f}");
    }
    b.edit(
        &[(0, 0, 0, "=NUMBERVALUE(\"1E308\"&REPT(\"%\",154))")],
        LIMIT,
    )
    .unwrap();
    assert!((number(&b, 0, 0) - 1.).abs() < 1e-13);
    let before = b.to_json();
    assert!(
        b.edit(&[(0, 0, 0, "=FIXED(SEQUENCE(100),127)")], 1000)
            .is_err()
    );
    assert_eq!(b.to_json(), before);
}
#[test]
fn number_text_tables_and_json_excel_reopening() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Imported"),
            (0, 1, 0, "'1.234,5"),
            (0, 2, 0, "'-12,345"),
            (0, 3, 0, "'9%%"),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Inputs", [0, 0, 3, 0], LIMIT).unwrap();
    b.edit(
        &[
            (0, 1, 2, "=NUMBERVALUE(Inputs[Imported],\",\",\".\")"),
            (0, 1, 4, "=FIXED(C2:C4)"),
            (0, 1, 6, "=DOLLAR(C2:C4)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut x in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(number(&x, 1, 2), 1234.5);
        assert_eq!(text(&x, 1, 4), "1,234.50");
        assert_eq!(text(&x, 2, 6), "($12.35)");
        x.edit(&[(0, 1, 0, "'2.500,75")], LIMIT).unwrap();
        assert_eq!(number(&x, 1, 2), 2500.75);
        assert_eq!(text(&x, 1, 6), "$2,500.75");
    }
}

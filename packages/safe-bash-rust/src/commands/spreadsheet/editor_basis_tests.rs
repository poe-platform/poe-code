// Cases adapted from IronCalc engineering/test_number_basis.rs and
// test_base_decimal.rs (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT,
// LICENSE.IronCalc), plus Univer engineering/{bin2dec,hex2bin,dec2hex}/__tests__
// (4767b3b309467c283bbd52b725536ca73861e0fc, Apache-2.0, LICENSE.Univer).
use super::Spreadsheet;
const LIMIT: usize = 10_000_000;

#[test]
fn roman_conversions_preserve_types_arrays_and_bounds() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=ROMAN(0)", ""),
        ("=TYPE(ROMAN(0))", "2"),
        ("=ROMAN(-0.1)", "#VALUE!"),
        ("=ROMAN(3999.9,4.9)", "MMMIM"),
        ("=ROMAN(4000)", "#VALUE!"),
        ("=ROMAN(0,NA())", "#N/A"),
        ("=ROMAN(0,5)", "#VALUE!"),
        ("=ROMAN(499,TRUE)", "CDXCIX"),
        ("=ROMAN(499,FALSE)", "ID"),
        ("=ARABIC(\"\")", "0"),
        ("=TYPE(ARABIC(\"\"))", "1"),
        ("=ARABIC(\"-IM\")", "-999"),
        ("=ARABIC(\"CMM\")", "1900"),
        ("=ARABIC(\"Ｍ\")", "#VALUE!"),
        ("=ARABIC(\" I\")", "#VALUE!"),
        ("=ARABIC(REPT(\"IV\",128))", "#VALUE!"),
        ("=IFERROR(ROMAN(),42)", "42"),
        ("=IFERROR(ARABIC(1,2),42)", "42"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
    book.edit(
        &[
            (0, 0, 0, "=ROMAN({49;499},{0,1,2,3,4})"),
            (0, 3, 0, "=ARABIC({\"I\",\"bad\",#N/A})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, row) in [
        ["XLIX", "VLIV", "IL", "IL", "IL"],
        ["CDXCIX", "LDVLIV", "XDIX", "VDIV", "ID"],
    ]
    .iter()
    .enumerate()
    {
        for (c, want) in row.iter().enumerate() {
            assert_eq!(book.display(0, r, c, LIMIT).unwrap(), *want);
        }
    }
    for (c, want) in ["1", "#VALUE!", "#N/A"].iter().enumerate() {
        assert_eq!(book.display(0, 3, c, LIMIT).unwrap(), *want);
    }
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 0, "=ROMAN(SEQUENCE(10000))")], 30_000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
}

#[test]
fn roman_conversions_recalculate_and_keep_styled_blank_references() {
    use super::{Style, Value};
    use std::sync::Arc;
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 3, "1")], LIMIT).unwrap();
    let blank = book.sheets[0].cells.get_mut(&(0, 3)).unwrap();
    blank.value = Some(Value::Empty);
    blank.style = Some(Arc::new(Style {
        family: "Calibri".into(),
        ..Style::default()
    }));
    book.edit(
        &[
            (0, 0, 0, "499"),
            (0, 0, 1, "=ROMAN(A1,4)"),
            (0, 0, 2, "=ARABIC(B1)"),
            (0, 0, 4, "=ARABIC(D1)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (stage, mut book) in [
        (
            "JSON",
            Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        ),
        (
            "Excel",
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        ),
        ("original", book),
    ] {
        assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "ID");
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "499");
        assert_eq!(book.display(0, 0, 4, LIMIT).unwrap(), "0", "{stage}");
        book.edit(&[(0, 0, 0, "1999")], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "MIM");
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "1999");
        assert_eq!(book.display(0, 0, 4, LIMIT).unwrap(), "0");
    }
}

#[test]
fn signed_base_conversions_validate_digits_bounds_and_padding() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=BIN2DEC(1100100000)", "-224"),
        ("=BIN2HEX(11111011,4)", "00FB"),
        ("=BIN2OCT(1111111111)", "7777777777"),
        ("=DEC2BIN(-512)", "1000000000"),
        ("=DEC2HEX(-549755813888)", "8000000000"),
        ("=DEC2OCT(536870911)", "3777777777"),
        ("=HEX2BIN(\"FFFFFFFFF0\",1)", "1111110000"),
        ("=HEX2DEC(\"8000000000\")", "-549755813888"),
        ("=HEX2OCT(\"FFFFFFFF00\",1)", "7777777400"),
        ("=OCT2BIN(7777777000,1)", "1000000000"),
        ("=OCT2DEC(4000000000)", "-536870912"),
        ("=OCT2HEX(7777777533)", "FFFFFFFF5B"),
        ("=DEC2HEX(-0.5,4)", "0000"),
        ("=DEC2BIN(5.9,4.9)", "0101"),
        ("=BIN2DEC(\"0000000010\")", "2"),
        ("=BIN2DEC(\"00000000010\")", "#NUM!"),
        ("=OCT2DEC(\"00000000000\")", "#NUM!"),
        ("=HEX2DEC(\"00000000000\")", "#NUM!"),
        ("=BIN2DEC(\"+10\")", "#NUM!"),
        ("=HEX2DEC(\"-1\")", "#NUM!"),
        ("=HEX2DEC(\"1G\")", "#NUM!"),
        ("=HEX2DEC(\"ＦＦ\")", "#NUM!"),
        ("=BIN2DEC(1.1)", "#NUM!"),
        ("=BIN2DEC(\"\")", "#NUM!"),
        ("=BIN2DEC(Z1)", "0"),
        ("=OCT2DEC(778)", "#NUM!"),
        ("=DEC2BIN(512)", "#NUM!"),
        ("=DEC2HEX(549755813888)", "#NUM!"),
        ("=DEC2OCT(-536870913)", "#NUM!"),
        ("=HEX2BIN(\"200\")", "#NUM!"),
        ("=DEC2HEX(64,1)", "#NUM!"),
        ("=DEC2HEX(64,0)", "#NUM!"),
        ("=DEC2HEX(-1,11)", "#NUM!"),
        ("=DEC2HEX(-1,-1)", "#NUM!"),
        ("=HEX2BIN(TRUE,4)", "#VALUE!"),
        ("=BIN2DEC(TRUE)", "#VALUE!"),
        ("=DEC2HEX(10,TRUE)", "#VALUE!"),
        ("=HEX2DEC(1,2)", "#ERROR!"),
        ("=OCT2DEC(1,2)", "#ERROR!"),
        ("=DEC2BIN()", "#ERROR!"),
        ("=HEX2DEC(NA())", "#N/A"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn general_bases_preserve_empty_arguments_and_support_long_decimal_results() {
    let mut book = Spreadsheet::new();
    for (formula, want) in [
        ("=BASE(9007199254740991,16)", "1FFFFFFFFFFFFF"),
        ("=BASE(9007199254740992,16)", "#NUM!"),
        ("=BASE(-0.5,2)", "#NUM!"),
        ("=BASE(0,2)", "0"),
        ("=BASE(0,2,)", "0"),
        ("=BASE(0,2,0)", ""),
        ("=BASE(0,2,Z1)", ""),
        ("=BASE(0,2,\"\")", "#VALUE!"),
        ("=BASE(\"12:30\",16,0)", ""),
        ("=BASE(TRUE,2)", "1"),
        ("=BASE(0,2,3)", "000"),
        ("=BASE(5,36.9)", "5"),
        ("=BASE(5,1)", "#NUM!"),
        ("=BASE(5,37)", "#NUM!"),
        ("=LEN(BASE(5,2,255.9))", "255"),
        ("=BASE(5,2,256)", "#NUM!"),
        ("=BASE(5,2,-0.5)", "#NUM!"),
        ("=DECIMAL(\"\",2)", "0"),
        ("=DECIMAL(Z1,2)", "0"),
        ("=DECIMAL(\"  ff\",16)", "255"),
        ("=DECIMAL(\"+10\",2)", "#NUM!"),
        ("=DECIMAL(\"-10\",2)", "#NUM!"),
        ("=DECIMAL(\"10 \" ,2)", "#NUM!"),
        ("=DECIMAL(\"Ｇ\",36)", "#NUM!"),
        ("=DECIMAL(REPT(\"0\",254)&\"1\",2)", "1"),
        ("=DECIMAL(REPT(\"0\",255)&\"1\",2)", "#VALUE!"),
        ("=DECIMAL(\"8000000000000000\",16)=2^63", "TRUE"),
        ("=DECIMAL(\"1\"&REPT(\"0\",200),2)=2^200", "TRUE"),
        ("=DECIMAL(REPT(\"Z\",255),36)", "#NUM!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), want, "{formula}");
    }
}

#[test]
fn conversions_spill_typed_text_and_recalculate_after_json_and_excel_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "15"),
            (0, 1, 0, "255"),
            (0, 2, 0, "-1"),
            (0, 0, 2, "=DEC2HEX(A1:A3,4)"),
            (0, 0, 4, "=HEX2DEC(C1:C3)"),
            (0, 4, 0, "=BASE({0;10;35},{2,16,36},4)"),
            (0, 8, 0, "=HEX2DEC({\"FF\",\"G\",#N/A})"),
            (0, 10, 0, "=ISTEXT(DEC2BIN(2,4))"),
            (0, 11, 0, "=ISNUMBER(HEX2DEC(\"FF\"))"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut book in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, c, want) in [
            (0, 2, "000F"),
            (1, 2, "00FF"),
            (2, 2, "FFFFFFFFFF"),
            (0, 4, "15"),
            (1, 4, "255"),
            (2, 4, "-1"),
            (4, 0, "0000"),
            (5, 0, "1010"),
            (5, 1, "000A"),
            (6, 2, "000Z"),
            (8, 0, "255"),
            (8, 1, "#NUM!"),
            (8, 2, "#N/A"),
            (10, 0, "TRUE"),
            (11, 0, "TRUE"),
        ] {
            assert_eq!(book.display(0, r, c, LIMIT).unwrap(), want, "{r},{c}");
        }
        book.edit(&[(0, 0, 0, "31")], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "001F");
        assert_eq!(book.display(0, 0, 4, LIMIT).unwrap(), "31");
    }
}

#[test]
fn signed_conversions_roundtrip_every_ten_bit_value() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=SEQUENCE(1024,1,-512)"),
            (0, 0, 1, "=BIN2DEC(DEC2BIN(A1:A1024))"),
            (0, 0, 2, "=HEX2DEC(BIN2HEX(DEC2BIN(A1:A1024)))"),
            (0, 0, 3, "=OCT2DEC(HEX2OCT(DEC2HEX(A1:A1024)))"),
        ],
        LIMIT,
    )
    .unwrap();
    for row in 0..1024 {
        for col in 1..4 {
            assert_eq!(
                book.display(0, row, col, LIMIT).unwrap(),
                (row as i32 - 512).to_string(),
                "{row},{col}"
            );
        }
    }
}

#[test]
fn conversion_array_limits_roll_back_failed_edits() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "42")], LIMIT).unwrap();
    let before = book.to_json();
    for formula in [
        "=BASE(SEQUENCE(10000),2,255)",
        "=DEC2HEX(D:D)",
        "=DECIMAL(REPT(\"0\",32767),2)",
    ] {
        assert!(
            book.edit(&[(0, 0, 0, formula)], 30_000).is_err(),
            "{formula}"
        );
        assert_eq!(book.to_json(), before);
    }
}

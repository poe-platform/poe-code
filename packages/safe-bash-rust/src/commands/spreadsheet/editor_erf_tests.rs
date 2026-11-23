use super::{Spreadsheet, Value};
const LIMIT: usize = 128 * 1024 * 1024;

fn near(book: &Spreadsheet, row: usize, column: usize, expected: f64) {
    let actual = match book.cell(0, row, column).and_then(|c| c.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!(
            "{}: {}",
            book.input(0, row, column),
            book.display(0, row, column, LIMIT).unwrap()
        ),
    };
    assert!(
        (actual - expected).abs() <= expected.abs() * 3e-14,
        "{}: {actual} != {expected}",
        book.input(0, row, column)
    );
}

#[test]
fn error_functions_retain_small_arguments_and_complementary_tails() {
    let mut book = Spreadsheet::new();
    // Python libm references; relative checks catch cancellation to zero.
    for (formula, expected) in [
        ("=ERF(1E-20)", 1.1283791670955125e-20),
        ("=ERF.PRECISE(-1E-100)", -1.1283791670955126e-100),
        ("=ERF(0.25)", 0.2763263901682369),
        ("=ERF(0.84375)", 0.7672256612323416),
        ("=ERF(1.25)", 0.9229001282564582),
        ("=ERFC(6)", 2.1519736712498916e-17),
        ("=ERFC.PRECISE(20)", 5.3958656116079005e-176),
        ("=ERF(1E308)", 1.),
        ("=ERFC(1E308)", 0.),
        ("=ERFC.PRECISE(-1E308)", 2.),
        ("=ERF(-1E308,1E308)", 2.),
        ("=ERF(1,1)", 0.),
        // Excel computes the two-limit function by subtracting the ERFs.
        ("=ERF(5,4)", -1.541572047791817e-8),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(&book, 0, 0, expected);
    }
}

#[test]
fn error_functions_validate_types_arities_and_arrays() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=ERF()", "#ERROR!"),
        ("=ERF(1,2,3)", "#ERROR!"),
        ("=ERFC(1,2)", "#ERROR!"),
        ("=ERF.PRECISE(1,2)", "#ERROR!"),
        ("=ERFC.PRECISE()", "#ERROR!"),
        ("=ERF(TRUE)", "#VALUE!"),
        ("=ERFC(FALSE)", "#VALUE!"),
        ("=ERF.PRECISE(\"TRUE\")", "#VALUE!"),
        ("=ERFC.PRECISE(\"\")", "#VALUE!"),
        ("=ERF(1,#N/A)", "#N/A"),
        ("=ERFC(#REF!)", "#REF!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
    book.edit(&[(0, 0, 0, "=ERFC({0,TRUE;1,#N/A})")], LIMIT)
        .unwrap();
    near(&book, 0, 0, 1.);
    near(&book, 1, 0, 0.15729920705028513);
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "#VALUE!");
    assert_eq!(book.display(0, 1, 1, LIMIT).unwrap(), "#N/A");
    let before = book.to_json();
    assert!(book.edit(&[(0, 0, 3, "=ERFC(A:A)")], 10_000).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn error_functions_recalculate_dependencies_and_roundtrip() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "1"),
            (0, 0, 1, "=ERF(A1)"),
            (0, 1, 1, "=ERFC.PRECISE(A1)"),
            (0, 2, 1, "=ERF.PRECISE(A1)"),
            (0, 3, 1, "=ERF(A1,0)"),
        ],
        LIMIT,
    )
    .unwrap();
    near(&book, 0, 1, 0.8427007929497149);
    book.edit(&[(0, 0, 0, "2")], LIMIT).unwrap();
    let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for book in [&book, &json, &excel] {
        near(book, 0, 1, 0.9953222650189527);
        near(book, 1, 1, 0.004677734981047265);
        near(book, 2, 1, 0.9953222650189527);
        near(book, 3, 1, -0.9953222650189527);
        assert_eq!(book.input(0, 1, 1), "=ERFC.PRECISE(A1)");
    }
}

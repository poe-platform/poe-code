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
        (actual - expected).abs() <= expected.abs() * 2e-14,
        "{}: {actual} != {expected}",
        book.input(0, row, column)
    );
}

#[test]
fn convert_units_prefixes_and_temperature_offsets() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=CONVERT(1,\"pc\",\"m\")", 30856775812815500.),
        ("=CONVERT(1,\"kpc\",\"m\")", 30856775812815500000.),
        ("=CONVERT(1,\"mm2\",\"m2\")", 1e-6),
        ("=CONVERT(1,\"km^3\",\"m3\")", 1e9),
        ("=CONVERT(1,\"har\",\"m2\")", 10000.),
        ("=CONVERT(1,\"Mibyte\",\"bit\")", 8388608.),
        ("=CONVERT(1,\"Yibit\",\"Zibit\")", 1024.),
        ("=CONVERT(1,\"Eibit\",\"Pibit\")", 1024.),
        ("=CONVERT(1,\"hPa\",\"Pa\")", 100.),
        ("=CONVERT(1,\"dag\",\"g\")", 10.),
        ("=CONVERT(1,\"eg\",\"g\")", 10.),
        ("=CONVERT(100,\"C\",\"F\")", 212.),
        ("=CONVERT(273.15,\"K\",\"C\")", 0.),
        ("=CONVERT(1,\"kK\",\"C\")", 726.85),
        ("=CONVERT(0.00075,\"C\",\"C\")", 0.00075),
        ("=CONVERT(80,\"Reau\",\"C\")", 100.),
        ("=CONVERT(491.67,\"Rank\",\"K\")", 273.15),
        ("=CONVERT(\"2\",\"m\",\"cm\")", 200.),
        ("=CONVERT(Z99,\"m\",\"cm\")", 0.),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(&book, 0, 0, expected);
    }
}

#[test]
fn convert_rejects_invalid_units_and_propagates_array_errors() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=CONVERT()", "#ERROR!"),
        ("=CONVERT(1,\"m\")", "#ERROR!"),
        ("=CONVERT(1,\"m\",\"s\")", "#N/A"),
        ("=CONVERT(1,\"unknown\",\"unknown\")", "#N/A"),
        ("=CONVERT(1,\" m\",\"m\")", "#N/A"),
        ("=CONVERT(1,\"M\",\"m\")", "#N/A"),
        ("=CONVERT(1,\"kC\",\"K\")", "#N/A"),
        ("=CONVERT(1,\"kft\",\"m\")", "#N/A"),
        ("=CONVERT(1,\"Kibyte\",\"byte\")", "#N/A"),
        ("=CONVERT(1,\"雪\",\"m\")", "#N/A"),
        ("=CONVERT(\"bad\",\"m\",\"cm\")", "#VALUE!"),
        ("=CONVERT(1,#REF!,\"cm\")", "#REF!"),
        ("=CONVERT(1,\"m\",#N/A)", "#N/A"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
    book.edit(
        &[(0, 0, 0, "=CONVERT({1;2},{\"m\",\"km\",\"bad\"},\"cm\")")],
        LIMIT,
    )
    .unwrap();
    near(&book, 0, 0, 100.);
    near(&book, 1, 0, 200.);
    near(&book, 0, 1, 100000.);
    near(&book, 1, 1, 200000.);
    assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "#N/A");
    assert_eq!(book.display(0, 1, 2, LIMIT).unwrap(), "#N/A");
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 4, "=CONVERT(A:A,\"m\",\"cm\")")], 10_000)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
}

#[test]
fn convert_recalculates_unit_dependencies_and_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "2"),
            (0, 0, 1, "m"),
            (0, 0, 2, "cm"),
            (0, 0, 3, "=CONVERT(A1,B1,C1)"),
        ],
        LIMIT,
    )
    .unwrap();
    near(&book, 0, 3, 200.);
    book.edit(&[(0, 0, 2, "mm")], LIMIT).unwrap();
    let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
    let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    for book in [&book, &json, &excel] {
        near(book, 0, 3, 2000.);
        assert_eq!(book.input(0, 0, 3), "=CONVERT(A1,B1,C1)");
    }
}

// Cases adapted from IronCalc f936620 test_fn_bond_functions.rs (MIT)
// and Univer 4767b3b logical/percentof (Apache-2.0).
// See LICENSE.IronCalc and LICENSE.Univer.
use super::{Spreadsheet, Value};
const LIMIT: usize = 20_000_000;

fn near(book: &Spreadsheet, row: usize, col: usize, expected: f64) {
    let Some(Value::Number(value)) = book.cell(0, row, col).and_then(|c| c.value.clone()) else {
        panic!("{row},{col}: {}", book.display(0, row, col, LIMIT).unwrap());
    };
    assert!((value - expected).abs() < 1e-14, "{value} != {expected}");
}

#[test]
fn percentof_upstream_scalars_arrays_and_direct_coercion() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=PERCENTOF(2,10)", 0.2),
        ("=PERCENTOF(185980,229829)", 0.8092103259379799),
        ("=PERCENTOF({10;5},{10;20;5})", 15. / 35.),
        ("=PERCENTOF({1,2;3,4},20)", 0.5),
        ("=PERCENTOF(\"2\",TRUE)", 2.),
        ("=PERCENTOF({1,TRUE,\"2\"},2)", 0.5),
        ("=PERCENTOF(,5)", 0.),
        ("=PERCENTOF(-2,10)", -0.2),
        ("=PERCENTOF(20,10)", 2.),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(&book, 0, 0, expected);
        let mut restored =
            Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        restored.edit(&[], LIMIT).unwrap();
        near(&restored, 0, 0, expected);
    }
}

#[test]
fn percentof_arity_errors_and_zero_totals() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=PERCENTOF()", "#ERROR!"),
        ("=PERCENTOF(1)", "#ERROR!"),
        ("=PERCENTOF(1,2,3)", "#ERROR!"),
        ("=PERCENTOF(5,0)", "#DIV/0!"),
        ("=PERCENTOF(0,{2,-2})", "#DIV/0!"),
        ("=PERCENTOF(1,Z1)", "#DIV/0!"),
        ("=PERCENTOF(1,)", "#DIV/0!"),
        ("=PERCENTOF(\"text\",2)", "#VALUE!"),
        ("=PERCENTOF(2,\"text\")", "#VALUE!"),
        ("=PERCENTOF(#N/A,0)", "#N/A"),
        ("=PERCENTOF({1;#REF!},#N/A)", "#REF!"),
        ("=PERCENTOF(2,{1;#N/A})", "#N/A"),
        ("=PERCENTOF(1E308,1E-300)", "#NUM!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn percentof_sparse_ranges_spills_and_tables_recalculate_after_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Count"),
            (0, 1, 0, "1"),
            (0, 2, 0, "2"),
            (0, 3, 0, "3"),
            (0, 4, 0, "TRUE"),
            (0, 5, 0, "'4"),
            (0, 0, 2, "=PERCENTOF(A2:A3,A:A)"),
            (0, 0, 4, "=SEQUENCE(3)"),
            (0, 4, 4, "=PERCENTOF(E1#,12)"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Counts", [0, 0, 3, 0], LIMIT).unwrap();
    book.edit(&[(0, 1, 2, "=PERCENTOF(A2,Counts[Count])")], LIMIT)
        .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        restored.edit(&[], LIMIT).unwrap();
        near(&restored, 0, 2, 0.5);
        near(&restored, 1, 2, 1. / 6.);
        near(&restored, 4, 4, 0.5);
        restored.edit(&[(0, 1, 0, "4")], LIMIT).unwrap();
        near(&restored, 0, 2, 6. / 9.);
        near(&restored, 1, 2, 4. / 9.);
        restored.edit_axis(0, false, 0, 1, LIMIT).unwrap();
        near(&restored, 1, 2, 6. / 9.);
        near(&restored, 2, 2, 4. / 9.);
        restored.edit(&[(0, 3, 0, "=NA()")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 1, 2, LIMIT).unwrap(), "#N/A");
    }
}

#[test]
fn percentof_limits_restore_saved_content() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "saved")], LIMIT).unwrap();
    let before = book.to_json();
    assert!(
        book.edit(&[(0, 0, 2, "=PERCENTOF(SEQUENCE(100000),1)")], 300)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
}

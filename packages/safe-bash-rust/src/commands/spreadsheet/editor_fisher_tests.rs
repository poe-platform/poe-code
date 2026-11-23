// Adapted from IronCalc f936620 statistical/test_fn_fisher.rs (MIT) and
// Univer 4767b3b statistical/{fisher,fisherinv} (Apache-2.0).
// See LICENSE.IronCalc and LICENSE.Univer. Extreme cases use analytic limits.
use super::{Spreadsheet, Value};
const LIMIT: usize = 20_000_000;

fn near(book: &Spreadsheet, row: usize, col: usize, expected: f64) {
    let Some(Value::Number(n)) = book.cell(0, row, col).and_then(|c| c.value.clone()) else {
        panic!("{row},{col}: {}", book.display(0, row, col, LIMIT).unwrap());
    };
    assert!(
        (n - expected).abs() <= expected.abs() * 2e-12,
        "{n} != {expected}"
    );
}

#[test]
fn fisher_upstream_values_and_extreme_limits() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=FISHER(0.1)", 0.10033534773107558),
        ("=FISHER(-0.5)", -0.5493061443340548),
        ("=FISHER(0.8)", 1.0986122886681098),
        ("=FISHER(0.75)", 0.9729550745276566),
        ("=FISHER(\"0.5\")", 0.5493061443340548),
        ("=FISHER(FALSE)", 0.),
        ("=FISHER(1E-300)", 1e-300),
        ("=FISHER(1E-10)", 1e-10),
        ("=FISHER(-1E-300)", -1e-300),
        ("=FISHER(0.9999999999999999)", 18.714973875118524),
        ("=FISHERINV(-1.5)", -0.9051482536448664),
        ("=FISHERINV(0.5)", 0.46211715726000974),
        ("=FISHERINV(2)", 0.9640275800758169),
        ("=FISHERINV(0.75)", 0.6351489523872873),
        ("=FISHERINV(9999999.23658)", 1.),
        ("=FISHERINV(-1E308)", -1.),
        ("=FISHERINV(1E-300)", 1e-300),
        ("=FISHERINV(1E-7)", 9.999999999999966e-8),
        ("=FISHERINV(-1E-7)", -9.999999999999966e-8),
        ("=FISHERINV(\"0.5\")", 0.46211715726000974),
        ("=FISHERINV(TRUE)", 0.7615941559557649),
        ("=FISHERINV(FALSE)", 0.),
        ("=FISHER(Z1)", 0.),
        ("=FISHERINV(Z1)", 0.),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        near(&book, 0, 0, expected);
        let reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        near(&reopened, 0, 0, expected);
    }
}

#[test]
fn fisher_errors_keep_arity_domains_and_types_distinct() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=FISHER()", "#ERROR!"),
        ("=FISHER(0.1,2)", "#ERROR!"),
        ("=FISHERINV()", "#ERROR!"),
        ("=FISHERINV(0.5,1)", "#ERROR!"),
        ("=FISHER(1)", "#NUM!"),
        ("=FISHER(-1)", "#NUM!"),
        ("=FISHER(2)", "#NUM!"),
        ("=FISHER(TRUE)", "#NUM!"),
        ("=FISHER(\"test\")", "#VALUE!"),
        ("=FISHERINV(\"test\")", "#VALUE!"),
        ("=FISHER(\"TRUE\")", "#VALUE!"),
        ("=FISHERINV(\"FALSE\")", "#VALUE!"),
        ("=FISHER(\" \")", "#VALUE!"),
        ("=FISHERINV(\" \")", "#VALUE!"),
        ("=FISHER(NA())", "#N/A"),
        ("=FISHERINV(1/0)", "#DIV/0!"),
        ("=FISHER(#NAME?)", "#NAME?"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
    }
}

#[test]
fn fisher_upstream_arrays_convert_each_value_and_keep_each_error() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "1"),
            (0, 0, 1, "' "),
            (0, 0, 2, "1.23"),
            (0, 0, 3, "TRUE"),
            (0, 0, 4, "FALSE"),
            (0, 1, 0, "0"),
            (0, 1, 1, "'100"),
            (0, 1, 2, "'2.34"),
            (0, 1, 3, "test"),
            (0, 1, 4, "-3"),
            (0, 4, 0, "=FISHER(A1:F2)"),
            (0, 8, 0, "=FISHERINV(A1:F2)"),
            (0, 12, 0, "=FISHER({0.5;#N/A;-0.5})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, c, e) in [
        (4, 0, "#NUM!"),
        (4, 1, "#VALUE!"),
        (4, 2, "#NUM!"),
        (4, 3, "#NUM!"),
        (5, 1, "#NUM!"),
        (5, 2, "#NUM!"),
        (5, 3, "#VALUE!"),
        (5, 4, "#NUM!"),
        (8, 1, "#VALUE!"),
        (9, 3, "#VALUE!"),
        (13, 0, "#N/A"),
    ] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), e);
    }
    for (r, c, n) in [
        (4, 4, 0.),
        (4, 5, 0.),
        (5, 0, 0.),
        (5, 5, 0.),
        (8, 0, 0.7615941559557649),
        (8, 2, 0.8425793256589295),
        (8, 3, 0.7615941559557649),
        (8, 4, 0.),
        (8, 5, 0.),
        (9, 0, 0.),
        (9, 1, 1.),
        (9, 2, 0.9816125892654238),
        (9, 4, -0.9950547536867305),
        (9, 5, 0.),
        (12, 0, 0.5493061443340548),
        (14, 0, -0.5493061443340548),
    ] {
        near(&book, r, c, n);
    }
}

#[test]
fn fisher_table_formulas_roundtrip_and_recalculate() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Correlation"),
            (0, 1, 0, "0.5"),
            (0, 2, 0, "-0.5"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Pairs", [0, 0, 2, 0], LIMIT).unwrap();
    book.edit(
        &[
            (0, 1, 2, "=FISHER(Pairs[Correlation])"),
            (0, 1, 4, "=FISHERINV(C2#)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&restored, 1, 2, 0.5493061443340548);
        near(&restored, 2, 4, -0.5);
        restored.edit(&[(0, 1, 0, "0.75")], LIMIT).unwrap();
        near(&restored, 1, 2, 0.9729550745276566);
        near(&restored, 1, 4, 0.75);
    }
}

#[test]
fn fisher_numeric_tokens_survive_copies_arrays_and_spill_export() {
    let mut book = Spreadsheet::new();
    book.options.names.push(super::NamedExpression {
        name: "Edge".into(),
        expression: "0.9999999999999999".into(),
        sheet: None,
        openformula: None,
        position: (0, 0, 0),
        compiled: None,
    });
    book.edit(
        &[
            (0, 0, 0, "=FISHER(0.9999999999999999)+SUM($C$1#)"),
            (0, 0, 2, "=SEQUENCE(1,1,0)"),
            (0, 2, 0, "=FISHER({0.9999999999999999;1E-300})"),
            (0, 0, 6, "=FISHER(0.9999999999999999)"),
            (0, 1, 6, "=FISHER(1)"),
            (0, 5, 0, "=FISHER(Edge)"),
        ],
        LIMIT,
    )
    .unwrap();
    let copied = book
        .relocate_cell(&book.sheets[0].cells[&(0, 0)], (0, 0), (0, 3), 0, LIMIT)
        .unwrap();
    assert!(
        copied
            .formula
            .as_ref()
            .unwrap()
            .contains("0.9999999999999999")
    );
    book.replace_cells(vec![(0, 0, 3, Some(copied))], LIMIT)
        .unwrap();
    for mut reopened in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&reopened, 0, 0, 18.714973875118524);
        near(&reopened, 2, 0, 18.714973875118524);
        near(&reopened, 3, 0, 1e-300);
        near(&reopened, 0, 6, 18.714973875118524);
        assert_eq!(reopened.display(0, 1, 6, LIMIT).unwrap(), "#NUM!");
        near(&reopened, 5, 0, 18.714973875118524);
        near(&reopened, 0, 3, 18.714973875118524);
        reopened.edit_axis(0, false, 0, 1, LIMIT).unwrap();
        near(&reopened, 1, 0, 18.714973875118524);
        near(&reopened, 1, 3, 18.714973875118524);
        near(&reopened, 6, 0, 18.714973875118524);
    }
}

#[test]
fn fisher_large_arrays_respect_limits_and_restore_saved_content() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "saved")], LIMIT).unwrap();
    let before = book.to_json();
    for formula in ["=FISHER(SEQUENCE(100000)/100001)", "=FISHERINV(A:A)"] {
        assert!(book.edit(&[(0, 0, 2, formula)], 1000).is_err());
        assert_eq!(book.to_json(), before);
    }
}

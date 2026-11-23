// PROB contracts from IronCalc f936620 (MIT) and Univer 4767b3b (Apache-2.0).
// See LICENSE.IronCalc and LICENSE.Univer. Additional cases cover sparse data,
// numerical stability, legacy intersection, persistence, and work limits.
use super::{Spreadsheet, Value};
const LIMIT: usize = 20_000_000;
fn near(b: &Spreadsheet, r: usize, c: usize, expected: f64) {
    let Some(Value::Number(n)) = b.cell(0, r, c).and_then(|c| c.value.clone()) else {
        panic!(
            "{}: {}",
            b.input(0, r, c),
            b.display(0, r, c, LIMIT).unwrap()
        );
    };
    assert!(
        (n - expected).abs() <= expected.abs().max(1e-310) * 2e-12,
        "{n} != {expected}"
    );
}
#[test]
fn probability_intervals_omissions_and_shapes() {
    let mut b = Spreadsheet::new();
    for (f, n) in [
        ("=PROB({1,2,3,4},{0.1,0.2,0.3,0.4},2,3)", 0.5),
        ("=PROB({0,1,2,3},{0.2,0.3,0.1,0.4},2)", 0.1),
        ("=PROB({0,1,2,3},{0.2,0.3,0.1,0.4},2,)", 0.1),
        ("=PROB({0,1,2,3},{0.2,0.3,0.1,0.4},2,1)", 0.),
        ("=PROB({0,1,2,3},{0.2,0.3,0.1,0.4},TRUE,1)", 0.3),
        ("=PROB({0,1,2,3},{0.2,0.3,0.1,0.4},,1)", 0.5),
        ("=PROB({0,1,2,3},{0.2,0.3,0.1,0.4},\"100%\",\"2\")", 0.4),
        ("=PROB({0,1,2,3},{0.2,0.3,0.1,0.4},0,Z1)", 0.2),
        ("=PROB({0,1,2,3},{0,0,1,0},2)", 1.),
        ("=PROB({2,2,3},{0.2,0.3,0.5},2)", 0.5),
        ("=PROB({0,1;2,3},{0.2;0.3;0.1;0.4},1,2)", 0.4),
        ("=PROB(TRANSPOSE({0,2;1,3}),{0.2,0.3,0.1,0.4},1,2)", 0.4),
        ("=PROB(2,1,2)", 1.),
        ("=PROB({1,\"2\",3},{0.5,0.7,0.5},1,3)", 1.),
        ("=PROB({1,2,3},{0.5,TRUE,0.5},1,3)", 1.),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, n);
    }
}
#[test]
fn probability_rejects_bad_distributions_and_arguments() {
    let mut b = Spreadsheet::new();
    for (f, e) in [
        ("=PROB()", "#ERROR!"),
        ("=PROB(1,1)", "#ERROR!"),
        ("=PROB(1,1,1,1,1)", "#ERROR!"),
        ("=PROB({1,2},{-0.1,1.1},1,2)", "#NUM!"),
        ("=PROB({1,2},{0.2,0.3},1,2)", "#NUM!"),
        ("=PROB({1,2},{0.5,0.500000001},1,2)", "#NUM!"),
        ("=PROB(1,1.000000000000001,1)", "#NUM!"),
        ("=PROB({1,2},{0.2,0.3,0.5},1)", "#N/A"),
        ("=PROB(Z1,Z2,1)", "#VALUE!"),
        ("=PROB(,1,1)", "#VALUE!"),
        ("=PROB({TRUE,\"x\"},{0.2,0.8},1)", "#DIV/0!"),
        ("=PROB({1,2},{0.5,0.5},\"bad\")", "#VALUE!"),
        ("=PROB({1,2},{0.5,0.5},\"TRUE\")", "#VALUE!"),
        ("=PROB({1,#N/A},{#REF!,0.5},1)", "#REF!"),
        ("=PROB({#N/A,2},{#REF!,0.5},1)", "#N/A"),
        ("=PROB({\"x\",2},{#REF!,0.5},1)", "#REF!"),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        assert_eq!(b.display(0, 0, 0, LIMIT).unwrap(), e, "{f}");
    }
}
#[test]
fn probability_broadcasts_limits_and_preserves_error_positions() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (
                0,
                0,
                0,
                "=PROB({0,1,2,3},{0.2,0.3,0.1,0.4},{0;1;2},{1,2,#N/A,\"bad\"})",
            ),
            (0, 4, 0, "=PROB(#REF!,{1},{1,#N/A})"),
            (0, 6, 0, "=PROB({1,2},{0.1,0.2},{#N/A,\"bad\",1})"),
            (0, 8, 0, "=PROB({0,1,2,3},{0.2,0.3,0.1,0.4},{0,1},{1,2,3})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, values) in [[0.5, 0.6], [0.3, 0.4], [0., 0.1]].into_iter().enumerate() {
        for (c, n) in values.into_iter().enumerate() {
            near(&b, r, c, n);
        }
        assert_eq!(b.display(0, r, 2, LIMIT).unwrap(), "#N/A");
        assert_eq!(b.display(0, r, 3, LIMIT).unwrap(), "#VALUE!");
    }
    for (r, c, e) in [
        (4, 0, "#REF!"),
        (4, 1, "#REF!"),
        (6, 0, "#N/A"),
        (6, 1, "#NUM!"),
        (6, 2, "#NUM!"),
        (8, 2, "#N/A"),
    ] {
        assert_eq!(b.display(0, r, c, LIMIT).unwrap(), e);
    }
    near(&b, 8, 0, 0.5);
    near(&b, 8, 1, 0.4);
}
#[test]
fn probability_whole_axes_remain_sparse_and_recalculate() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "1"),
            (0, 0, 1, "0.25"),
            (0, 1_048_575, 0, "3"),
            (0, 1_048_575, 1, "0.75"),
            (0, 0, 3, "=PROB(A:A,B:B,3)"),
            (0, 2, 0, "1"),
            (0, 2, 16_383, "3"),
            (0, 3, 0, "0.25"),
            (0, 3, 16_383, "0.75"),
            (0, 4, 3, "=PROB(3:3,4:4,3)"),
        ],
        100_000,
    )
    .unwrap();
    near(&b, 0, 3, 0.75);
    near(&b, 4, 3, 0.75);
    b.edit(&[(0, 1_048_575, 0, "2")], 100_000).unwrap();
    near(&b, 0, 3, 0.);
}
#[test]
fn probability_compensated_totals_and_tiny_selected_mass() {
    let mut b = Spreadsheet::new();
    for (f, n) in [
        ("=PROB(SEQUENCE(10),SEQUENCE(10,1,0.1,0),1,10)", 1.),
        ("=PROB(SEQUENCE(1000),SEQUENCE(1000,1,0.001,0),1,1000)", 1.),
        ("=PROB({0,1},{1,1E-300},1)", 1e-300),
        ("=PROB({0,1},{1E-300,1},0)", 1e-300),
    ] {
        b.edit(&[(0, 0, 0, f)], LIMIT).unwrap();
        near(&b, 0, 0, n);
    }
}
#[test]
fn probability_tables_roundtrip_and_spill_regrowth() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Outcome"),
            (0, 0, 1, "Probability"),
            (0, 1, 0, "1"),
            (0, 1, 1, "0.2"),
            (0, 2, 0, "2"),
            (0, 2, 1, "0.3"),
            (0, 3, 0, "3"),
            (0, 3, 1, "0.5"),
            (0, 0, 3, "=SEQUENCE(1)"),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Outcomes", [0, 0, 3, 1], LIMIT).unwrap();
    b.edit(
        &[(
            0,
            0,
            5,
            "=PROB(Outcomes[Outcome],Outcomes[Probability],D1#)",
        )],
        LIMIT,
    )
    .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&restored, 0, 5, 0.2);
        restored.edit(&[(0, 0, 3, "=SEQUENCE(3)")], LIMIT).unwrap();
        for (r, n) in [0.2, 0.3, 0.5].into_iter().enumerate() {
            near(&restored, r, 5, n);
        }
        restored.edit(&[(0, 2, 0, "1")], LIMIT).unwrap();
        near(&restored, 0, 5, 0.5);
        near(&restored, 1, 5, 0.);
    }
}
#[test]
fn probability_legacy_bounds_keep_scalar_intersection() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 2, "0"),
            (0, 1, 2, "2"),
            (0, 2, 2, "3"),
            (0, 1, 3, "=PROB({0,1,2,3},{0.2,0.3,0.1,0.4},C1)"),
        ],
        LIMIT,
    )
    .unwrap();
    let mut cell = b.sheets[0].cells[&(1, 3)].clone();
    cell.legacy_formula = true;
    cell.openformula = None;
    cell.formula_display = None;
    cell.formula = Some("PROB({0,1,2,3},{0.2,0.3,0.1,0.4},C:C)".into());
    b.replace_cells(vec![(0, 1, 3, Some(cell))], LIMIT).unwrap();
    for mut restored in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(&restored, 1, 3, 0.1);
        restored.edit(&[(0, 1, 2, "3")], LIMIT).unwrap();
        near(&restored, 1, 3, 0.4);
        restored
            .edit(
                &[(0, 1, 3, "=PROB({0,1,2,3},{0.2,0.3,0.1,0.4},C1:C3)")],
                LIMIT,
            )
            .unwrap();
        near(&restored, 1, 3, 0.2);
        near(&restored, 2, 3, 0.4);
        near(&restored, 3, 3, 0.4);
    }
}
#[test]
fn probability_work_and_output_limits_roll_back_atomically() {
    let mut b = Spreadsheet::new();
    b.edit(&[(0, 0, 0, "kept")], LIMIT).unwrap();
    let before = b.to_json();
    for f in [
        "=PROB({1,2},{0.5,0.5},SEQUENCE(999999))",
        "=PROB(SEQUENCE(1000),SEQUENCE(1000,1,0.001,0),SEQUENCE(1000))",
    ] {
        assert!(b.edit(&[(0, 0, 1, f)], 100_000).is_err());
        assert_eq!(b.to_json(), before);
    }
}

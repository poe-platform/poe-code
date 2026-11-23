// Adapted from IronCalc f936620 statistical tests (MIT) and Univer 4767b3b
// descriptive statistics tests (Apache-2.0). See adjacent license files.
use super::{Spreadsheet, Value};
const LIMIT: usize = 20_000_000;
fn number(b: &Spreadsheet, r: usize, c: usize) -> f64 {
    match b.cell(0, r, c).and_then(|cell| cell.value.clone()) {
        Some(Value::Number(n)) => n,
        _ => panic!(
            "{}: {}",
            b.input(0, r, c),
            b.display(0, r, c, LIMIT).unwrap()
        ),
    }
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() <= b.abs().max(1e-300) * 1e-10, "{a} != {b}");
}
#[test]
fn descriptive_upstream_values_and_legacy_aliases() {
    let cases = [
        ("=STDEV.P(10,12,23,23,16,23,21)", 5.174505793106863),
        ("=STDEV.S(10,12,23,23,16,23,21)", 5.589105047673135),
        ("=STDEV({1,2,3})", 1.),
        ("=STDEVP({1,2,3})", (2_f64 / 3.).sqrt()),
        ("=VAR({1,2,3})", 1.),
        ("=VARP({1,2,3})", 2. / 3.),
        ("=VAR.S({1,2,3})", 1.),
        ("=VAR.P({1,2,3})", 2. / 3.),
        ("=DEVSQ({1,2,3})", 2.),
        ("=AVEDEV(1,2,3)", 2. / 3.),
        ("=SKEW(1,2,10)", 1.6523167403329908),
        ("=SKEW.P(1,2,10)", 0.6745554845457659),
        ("=KURT({1,2,3,4,5})", -1.2),
        ("=HARMEAN(1,2,4)", 12. / 7.),
        ("=GEOMEAN(1,2,\"5\",TRUE)", 10_f64.powf(0.25)),
    ];
    let mut b = Spreadsheet::new();
    b.edit(
        &cases
            .iter()
            .enumerate()
            .map(|(r, (f, _))| (0, r, 0, *f))
            .collect::<Vec<_>>(),
        LIMIT,
    )
    .unwrap();
    for (r, (_, n)) in cases.into_iter().enumerate() {
        near(number(&b, r, 0), n);
    }
}
#[test]
fn descriptive_reference_and_array_text_coercion() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "24"),
            (0, 1, 0, "25"),
            (0, 2, 0, "27"),
            (0, 3, 0, "23"),
            (0, 4, 0, "45"),
            (0, 5, 0, "23.5"),
            (0, 6, 0, "34"),
            (0, 7, 0, "23"),
            (0, 8, 0, "23"),
            (0, 9, 0, "TRUE"),
            (0, 10, 0, "'23"),
            (0, 11, 0, "Text"),
            (0, 12, 0, "FALSE"),
            (0, 13, 0, "45"),
            (0, 0, 2, "=VAR.P(A1:A15)"),
            (0, 1, 2, "=VAR.S(A1:A15)"),
            (0, 2, 2, "=VARA(A1:A15)"),
            (0, 3, 2, "=VARPA(A1:A15)"),
            (0, 4, 2, "=STDEVA(A1:A15)"),
            (0, 5, 2, "=STDEVPA(A1:A15)"),
            (0, 6, 2, "=AVEDEV(A1:A15)"),
            (0, 7, 2, "=VAR.P({1,TRUE,\"3\",5})"),
            (0, 8, 2, "=VARPA({1,TRUE,\"3\",5})"),
            (0, 9, 2, "=VAR.P(1,TRUE,\"3\",5)"),
            (0, 10, 2, "=VAR.P(,2)"),
            (0, 11, 2, "=VAR.P(A15,2)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, n) in [
        71.9625,
        79.95833333333333,
        240.24862637362637,
        223.08801020408163,
        240.24862637362637_f64.sqrt(),
        223.08801020408163_f64.sqrt(),
        7.25,
        4.,
        3.6875,
        2.75,
        1.,
        0.,
    ]
    .into_iter()
    .enumerate()
    {
        near(number(&b, r, 2), n);
    }
}
#[test]
fn descriptive_errors_empty_data_and_minimum_observations() {
    let cases = [
        ("=STDEV.P()", "#ERROR!"),
        ("=GEOMEAN()", "#ERROR!"),
        ("=AVEDEV()", "#ERROR!"),
        ("=VAR.S(1)", "#DIV/0!"),
        ("=STDEV.S({1})", "#DIV/0!"),
        ("=DEVSQ(A1:A2)", "#DIV/0!"),
        ("=SKEW.P(1,2)", "#DIV/0!"),
        ("=SKEW(1,1,1)", "#DIV/0!"),
        ("=KURT(1,2,3)", "#DIV/0!"),
        ("=KURT(1,1,1,1)", "#DIV/0!"),
        ("=GEOMEAN(A1:A2)", "#NUM!"),
        ("=HARMEAN(A1:A2)", "#DIV/0!"),
        ("=GEOMEAN(0,1)", "#NUM!"),
        ("=HARMEAN(0,1)", "#NUM!"),
        ("=GEOMEAN(-1,1)", "#NUM!"),
        ("=VAR.P(1,\"bad\")", "#VALUE!"),
        ("=VARPA(1,\"bad\")", "#VALUE!"),
        ("=STDEV.S({1,#N/A,3})", "#N/A"),
        ("=SKEW(1,2,#REF!)", "#REF!"),
    ];
    let mut b = Spreadsheet::new();
    b.edit(
        &cases
            .iter()
            .enumerate()
            .map(|(r, (f, _))| (0, r, 2, *f))
            .collect::<Vec<_>>(),
        LIMIT,
    )
    .unwrap();
    for (r, (f, e)) in cases.into_iter().enumerate() {
        assert_eq!(b.display(0, r, 2, LIMIT).unwrap(), e, "{f}");
    }
    for f in ["=VAR.P(1)", "=STDEV.P(1)", "=AVEDEV(1)", "=DEVSQ(1)"] {
        b.edit(&[(0, 0, 3, f)], LIMIT).unwrap();
        near(number(&b, 0, 3), 0.);
    }
}
#[test]
fn descriptive_extreme_scales_and_large_offsets_stay_finite() {
    let cases = [
        (
            "=STDEV.P({-1.7976931348623157E308,1.7976931348623157E308})",
            f64::MAX,
        ),
        (
            "=AVEDEV({-1.7976931348623157E308,1.7976931348623157E308})",
            f64::MAX,
        ),
        ("=STDEV.S({1E200,2E200,3E200})", 1e200),
        (
            "=STDEV.P({1E-200,2E-200,3E-200})",
            (2_f64 / 3.).sqrt() * 1e-200,
        ),
        ("=VAR.S({1E150,2E150,3E150})", 1e300),
        ("=VAR.S({1E-150,2E-150,3E-150})", 1e-300),
        (
            "=VAR.P({1000000000000,1000000000001,1000000000002})",
            2. / 3.,
        ),
        (
            "=AVEDEV({1000000000000,1000000000001,1000000000002})",
            2. / 3.,
        ),
        ("=DEVSQ({1000000000000,1000000000001,1000000000002})", 2.),
        ("=SKEW({1E200,2E200,1E201})", 1.6523167403329908),
        ("=SKEW.P({1E-200,2E-200,1E-199})", 0.6745554845457659),
        ("=KURT({1E200,2E200,3E200,4E200,5E200})", -1.2),
        ("=GEOMEAN(1E-300,1E300)", 1.),
        ("=GEOMEAN(1E300,1E300)", 1e300),
        ("=HARMEAN(1E-300,2E-300,4E-300)", 12. / 7. * 1e-300),
        (
            "=HARMEAN(1.7976931348623157E308,1.7976931348623157E308)",
            f64::MAX,
        ),
    ];
    let mut b = Spreadsheet::new();
    b.edit(
        &cases
            .iter()
            .enumerate()
            .map(|(r, (f, _))| (0, r, 0, *f))
            .collect::<Vec<_>>(),
        LIMIT,
    )
    .unwrap();
    for (r, (_, n)) in cases.into_iter().enumerate() {
        near(number(&b, r, 0), n);
    }
}
#[test]
fn descriptive_sparse_columns_see_spill_children_and_recalculate() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=SEQUENCE(5)"),
            (0, 0, 2, "=VAR.P(A:A)"),
            (0, 1, 2, "=STDEV.S(A:A)"),
            (0, 2, 2, "=AVEDEV(A:A)"),
            (0, 3, 2, "=DEVSQ(A:A)"),
            (0, 4, 2, "=SKEW(A:A)"),
            (0, 5, 2, "=KURT(A:A)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, n) in [2., 2.5_f64.sqrt(), 1.2, 10., 0., -1.2]
        .into_iter()
        .enumerate()
    {
        near(number(&b, r, 2), n);
    }
    b.edit(&[(0, 0, 0, "=SEQUENCE(3)")], LIMIT).unwrap();
    near(number(&b, 0, 2), 2. / 3.);
    near(number(&b, 1, 2), 1.);
    assert_eq!(b.display(0, 5, 2, LIMIT).unwrap(), "#DIV/0!");
}
#[test]
fn descriptive_subtotals_use_stable_variance_and_skip_hidden_and_nested_rows() {
    let mut b = Spreadsheet::new();
    b.sheets[0].rows.insert(
        1,
        super::Axis {
            hidden: true,
            ..Default::default()
        },
    );
    b.edit(
        &[
            (0, 0, 0, "1E200"),
            (0, 1, 0, "2E200"),
            (0, 2, 0, "3E200"),
            (0, 3, 0, "=SUBTOTAL(9,A1:A3)"),
            (0, 0, 2, "=SUBTOTAL(7,A1:A4)"),
            (0, 1, 2, "=SUBTOTAL(107,A1:A4)"),
            (0, 2, 2, "=SUBTOTAL(8,A1:A4)"),
            (0, 3, 2, "=SUBTOTAL(108,A1:A4)"),
            (0, 4, 2, "=SUBTOTAL(10,A1:A4)"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, n) in [
        1e200,
        2_f64.sqrt() * 1e200,
        (2_f64 / 3.).sqrt() * 1e200,
        1e200,
    ]
    .into_iter()
    .enumerate()
    {
        near(number(&b, r, 2), n);
    }
    assert_eq!(b.display(0, 4, 2, LIMIT).unwrap(), "#NUM!");
}
#[test]
fn descriptive_work_limit_failure_does_not_mutate_workbook() {
    let mut b = Spreadsheet::new();
    b.edit(&[(0, 0, 0, "42")], LIMIT).unwrap();
    let before = b.to_json();
    for f in [
        "=VAR.P(SEQUENCE(1000000))",
        "=KURT(SEQUENCE(1000000))",
        "=GEOMEAN(SEQUENCE(1000000))",
    ] {
        assert!(b.edit(&[(0, 0, 0, f)], 10000).is_err(), "{f}");
        assert_eq!(b.to_json(), before);
    }
}

#[test]
fn descriptive_subnormal_inputs_and_variance_keep_representable_results() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "=HARMEAN({1E-300,2E-300,4E-300}/1E23)"),
            (0, 1, 0, "=STDEV.S({1E-300,2E-300,3E-300}/1E23)"),
            (0, 2, 0, "=GEOMEAN({1E-300,1E-300}/1E23)"),
            (0, 3, 0, "=VAR.P({0,4E-162})"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, bits) in [(0, 3), (1, 2), (2, 2), (3, 1)] {
        assert_eq!(number(&b, r, 0), f64::from_bits(bits));
    }
}
#[test]
fn descriptive_table_filters_and_manual_hiding_survive_json_and_excel() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "Group"),
            (0, 0, 1, "Amount"),
            (0, 1, 0, "Keep"),
            (0, 1, 1, "1"),
            (0, 2, 0, "Skip"),
            (0, 2, 1, "2"),
            (0, 3, 0, "Keep"),
            (0, 3, 1, "3"),
            (0, 4, 0, "Keep"),
            (0, 4, 1, "4"),
        ],
        LIMIT,
    )
    .unwrap();
    b.add_table(0, "Samples", [0, 0, 4, 1], LIMIT).unwrap();
    b.sheets[0].rows.insert(
        4,
        super::Axis {
            hidden: true,
            ..Default::default()
        },
    );
    b.filter_table(
        0,
        0,
        Some(super::model::FilterField {
            top: None,
            custom: true,
            conditions: vec![("equal", "Keep".into())],
            conjunction: false,
            hidden_rows: None,
        }),
        LIMIT,
    )
    .unwrap();
    b.edit(
        &[
            (0, 0, 3, "=STDEV.S(Samples[Amount])"),
            (0, 1, 3, "=SUBTOTAL(7,Samples[Amount])"),
            (0, 2, 3, "=SUBTOTAL(107,Samples[Amount])"),
            (0, 3, 3, "=VAR.S(Samples[Amount])"),
            (0, 4, 3, "=SUBTOTAL(110,Samples[Amount])"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut restored in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, n) in [
            (0, (5_f64 / 3.).sqrt()),
            (1, (7_f64 / 3.).sqrt()),
            (2, 2_f64.sqrt()),
            (3, 5. / 3.),
            (4, 2.),
        ] {
            near(number(&restored, r, 3), n);
        }
        restored.edit(&[(0, 2, 1, "=NA()")], LIMIT).unwrap();
        assert_eq!(restored.display(0, 0, 3, LIMIT).unwrap(), "#N/A");
        near(number(&restored, 1, 3), (7_f64 / 3.).sqrt());
        near(number(&restored, 2, 3), 2_f64.sqrt());
    }
}

#[test]
fn descriptive_skew_population_editor_name_relocates_and_roundtrips() {
    let mut b = Spreadsheet::new();
    b.edit(
        &[
            (0, 0, 0, "1"),
            (0, 1, 0, "2"),
            (0, 2, 0, "10"),
            (0, 3, 0, "20"),
            (0, 0, 2, "=skew.p(A1:A3)"),
            (0, 0, 3, "=\"SKEW.P(A1:A3)\""),
        ],
        LIMIT,
    )
    .unwrap();
    let copied = b
        .relocate_cell(&b.sheets[0].cells[&(0, 2)], (0, 2), (1, 2), 0, LIMIT)
        .unwrap();
    b.replace_cells(vec![(0, 1, 2, Some(copied))], LIMIT)
        .unwrap();
    near(number(&b, 0, 2), 0.6745554845457659);
    for restored in [
        Spreadsheet::from_json(&b.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&b.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        near(number(&restored, 0, 2), number(&b, 0, 2));
        near(number(&restored, 1, 2), number(&b, 1, 2));
        assert!(restored.input(0, 1, 2).contains("A2:A4"));
        assert_eq!(restored.display(0, 0, 3, LIMIT).unwrap(), "SKEW.P(A1:A3)");
    }
}

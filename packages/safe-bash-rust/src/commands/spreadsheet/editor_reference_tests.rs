use super::{NamedExpression, Spreadsheet};

const LIMIT: usize = 32 * 1024 * 1024;

#[test]
fn reference_batches_resolve_names_tables_and_dynamic_reference_formulas() {
    // Names and scopes follow IronCalc f936620 test_defined_names.rs;
    // OFFSET range semantics follow its lookup/reference tests (LICENSE.IronCalc).
    let mut book = Spreadsheet::new();
    book.add_sheet("Other").unwrap();
    book.edit(
        &[
            (0, 0, 0, "Group"),
            (0, 0, 1, "Value"),
            (0, 1, 0, "a"),
            (0, 1, 1, "10"),
            (0, 2, 0, "b"),
            (0, 2, 1, "20"),
            (0, 0, 3, "=1+2"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 0, 2, 1], LIMIT).unwrap();
    for (name, expression, sheet) in [
        ("Data", "Sheet1!$A$1:$B$3", None),
        ("Data", "Other!$C$2:$D$4", Some(1)),
        ("Growing", "OFFSET(Sheet1!$A$1,0,0,Sheet1!$D$1,2)", None),
        ("Alias", "Growing", None),
    ] {
        book.set_named_expression(
            None,
            NamedExpression {
                name: name.into(),
                expression: expression.into(),
                sheet,
                position: (sheet.unwrap_or(0), 0, 0),
                openformula: None,
                compiled: None,
            },
            LIMIT,
        )
        .unwrap();
    }
    let before = book.to_json();
    let requests = [
        ("Data", (0, 0, 0)),
        ("Data", (1, 0, 0)),
        ("Sales[#All]", (1, 0, 0)),
        ("Sales[Value]", (0, 0, 0)),
        ("Alias", (0, 0, 0)),
        ("'Other'!A1:B2", (0, 0, 0)),
    ];
    assert_eq!(
        book.resolve_ranges(&requests, LIMIT).unwrap(),
        vec![
            (0, [0, 0, 2, 1]),
            (1, [1, 2, 3, 3]),
            (0, [0, 0, 2, 1]),
            (0, [1, 1, 2, 1]),
            (0, [0, 0, 2, 1]),
            (1, [0, 0, 1, 1])
        ]
    );
    assert_eq!(
        book.to_json(),
        before,
        "Resolving references must not edit or resample the saved workbook"
    );
    book.edit(&[(0, 0, 3, "2")], LIMIT).unwrap();
    assert_eq!(
        book.resolve_ranges(&[("Growing", (0, 0, 0))], LIMIT)
            .unwrap(),
        vec![(0, [0, 0, 1, 1])]
    );
}

#[test]
fn reference_batches_reject_scalars_disjoint_ranges_errors_and_invalid_positions() {
    let book = Spreadsheet::new();
    let before = book.to_json();
    for source in [
        "1",
        "SUM(A1:B3)",
        "{1,2}",
        "A1:A2,C1:C2",
        "Missing",
        "#REF!",
        "SUM(",
    ] {
        assert!(
            book.resolve_ranges(&[(source, (0, 0, 0))], LIMIT).is_err(),
            "{source}"
        );
    }
    for position in [(1, 0, 0), (0, 1_048_576, 0), (0, 0, 16_384)] {
        assert!(book.resolve_ranges(&[("A1", position)], LIMIT).is_err());
    }
    assert!(book.resolve_ranges(&[("A1", (0, 0, 0)); 20], 128).is_err());
    assert_eq!(
        book.resolve_ranges(&[("A1", (0, 0, 0)), ("B2:C3", (0, 0, 0))], LIMIT)
            .unwrap(),
        vec![(0, [0, 0, 0, 0]), (0, [1, 1, 2, 2])]
    );
    assert_eq!(book.to_json(), before);
}

#[test]
fn reference_batches_follow_dynamic_spills_without_freezing_formula_results() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "=SEQUENCE(D1,2)"), (0, 0, 3, "3")], LIMIT)
        .unwrap();
    assert_eq!(
        book.resolve_ranges(
            &[("A1#", (0, 4, 0)), ("INDEX(A1:B3,0,2)", (0, 4, 0))],
            LIMIT
        )
        .unwrap(),
        vec![(0, [0, 0, 2, 1]), (0, [0, 1, 2, 1])]
    );
    book.edit(&[(0, 0, 3, "2")], LIMIT).unwrap();
    assert_eq!(
        book.resolve_ranges(&[("A1#", (0, 4, 0))], LIMIT).unwrap(),
        vec![(0, [0, 0, 1, 1])]
    );
    assert_eq!(book.input(0, 0, 0), "=SEQUENCE(D1,2)");
}

#[test]
fn reference_batches_use_the_existing_volatile_result() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 3, "=RAND()")], LIMIT).unwrap();
    let super::Value::Number(sample) = book.cell(0, 0, 3).unwrap().value.clone().unwrap() else {
        panic!("Numeric random result");
    };
    let before = book.to_json();
    let requests = [("OFFSET(A1,0,0,1+INT(D1*100),1)", (0, 0, 0)); 20];
    for _ in 0..3 {
        assert_eq!(
            book.resolve_ranges(&requests, LIMIT).unwrap(),
            vec![(0, [0, 0, (sample * 100.).floor() as usize, 0]); requests.len()]
        );
    }
    assert_eq!(book.to_json(), before);
}

#[test]
fn pivot_source_batches_resolve_exact_identities_without_name_shadowing() {
    use super::PivotSource;
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "Group"),
            (0, 0, 1, "Value"),
            (0, 1, 0, "a"),
            (0, 1, 1, "10"),
            (0, 2, 0, "b"),
            (0, 2, 1, "20"),
            (0, 0, 3, "=RAND()"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Sales", [0, 0, 2, 1], LIMIT).unwrap();
    for (expression, sheet) in [("Sheet1!$A$1:$B$2", None), ("Sheet1!$A$1:$B$3", Some(0))] {
        book.set_named_expression(
            None,
            NamedExpression {
                name: "Data".into(),
                expression: expression.into(),
                sheet,
                position: (0, 0, 0),
                openformula: None,
                compiled: None,
            },
            LIMIT,
        )
        .unwrap();
    }
    let before = book.to_json();
    assert_eq!(
        book.resolve_pivot_sources(
            &[
                PivotSource::Name(0),
                PivotSource::Name(1),
                PivotSource::Table(0)
            ],
            LIMIT
        )
        .unwrap(),
        vec![(0, [0, 0, 1, 1]), (0, [0, 0, 2, 1]), (0, [0, 0, 2, 1])]
    );
    assert!(
        book.resolve_pivot_sources(&[PivotSource::Missing], LIMIT)
            .is_err()
    );
    assert!(
        book.resolve_pivot_sources(&[PivotSource::Name(9)], LIMIT)
            .is_err()
    );
    assert!(
        book.resolve_pivot_sources(&[PivotSource::Table(0); 20], 128)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
}

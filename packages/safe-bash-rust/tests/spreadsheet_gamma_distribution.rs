// IronCalc f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT, LICENSE.IronCalc):
// statistical/{test_fn_gamma,test_fn_poisson}.rs and unchanged GAMMA/POISSON.xlsx.
use mcp_protocol_rust::json::{self, Value as Json};
use safe_bash_rust::commands::spreadsheet::{Spreadsheet, Value};

const LIMIT: usize = 128 * 1024 * 1024;

#[test]
fn original_excel_gamma_and_poisson_results_survive_json_and_excel() {
    let mut failures = Vec::new();
    for (name, source, caches, count) in [
        (
            "gamma",
            include_bytes!("fixtures/gamma-distribution.xlsx").as_slice(),
            include_bytes!("fixtures/gamma-distribution.json").as_slice(),
            167,
        ),
        (
            "poisson",
            include_bytes!("fixtures/poisson-distribution.xlsx").as_slice(),
            include_bytes!("fixtures/poisson-distribution.json").as_slice(),
            63,
        ),
    ] {
        let Json::Array(cases) = json::parse(caches, Default::default()).unwrap() else {
            panic!()
        };
        assert_eq!(cases.len(), count);
        let book = Spreadsheet::import_xlsx(source, LIMIT).unwrap();
        let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
        let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        for (stage, book) in [("import", book), ("JSON", json), ("Excel", excel)] {
            for case in &cases {
                let index = |key| match case.get(key).unwrap() {
                    Json::Number(n) => *n as usize,
                    _ => panic!(),
                };
                let (sheet, row, column) = (index("sheet"), index("row"), index("column"));
                let value = book
                    .cell(sheet, row, column)
                    .and_then(|cell| cell.value.clone());
                let expected = case.get("expected").unwrap();
                let valid = match (&value, expected) {
                    (Some(Value::Number(a)), Json::Number(b)) => (a - b).abs() <= b.abs() * 2e-12,
                    (Some(Value::Bool(a)), Json::Bool(b)) => a == b,
                    (Some(Value::Text(a)), Json::String(b))
                        if case.get("type")
                            == Some(&Json::String("str".encode_utf16().collect())) =>
                    {
                        a.encode_utf16().eq(b.iter().copied())
                    }
                    (Some(Value::Error(a)), Json::String(b))
                        if case.get("type")
                            == Some(&Json::String("e".encode_utf16().collect())) =>
                    {
                        a.encode_utf16().eq(b.iter().copied())
                    }
                    _ => false,
                };
                if !valid {
                    failures.push(format!(
                        "{name} {stage} {sheet}:{row},{column}: {} != {}",
                        book.display(sheet, row, column, LIMIT).unwrap(),
                        json::stringify(expected)
                    ));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn excel_distribution_arguments_domains_and_aliases() {
    let mut book = Spreadsheet::new();
    let mut failures = Vec::new();
    for (names, cases) in [
        (
            ["GAMMADIST", "GAMMA.DIST"],
            vec![
                ("", "#ERROR!"),
                ("1,2,3", "#ERROR!"),
                ("1,2,3,TRUE,1", "#ERROR!"),
                ("-1,9,2,TRUE", "#NUM!"),
                ("0,0.5,1,FALSE", "#NUM!"),
                ("0,0.5,1,TRUE", "0"),
                ("0,1,2,FALSE", "0.5"),
                ("0,2,2,FALSE", "0"),
                ("1,0,2,TRUE", "#NUM!"),
                ("1,2,0,TRUE", "#NUM!"),
                ("0,9,2,\"TRUE\"", "0"),
                ("0,9,2,\"FALSE\"", "0"),
                ("\"TRUE\",9,2,TRUE", "#VALUE!"),
                ("1,\"TRUE\",2,TRUE", "#VALUE!"),
                ("1,9,\"TRUE\",TRUE", "#VALUE!"),
                ("1,9,2,\"bad\"", "#VALUE!"),
                ("#N/A,9,2,#REF!", "#N/A"),
                ("0,0.5,1,1/0", "#DIV/0!"),
            ],
        ),
        (
            ["GAMMAINV", "GAMMA.INV"],
            vec![
                ("", "#ERROR!"),
                ("0.5,2", "#ERROR!"),
                ("0.5,2,1,1", "#ERROR!"),
                ("0,9,2", "0"),
                ("1,9,2", "#NUM!"),
                ("-0.1,9,2", "#NUM!"),
                ("0.5,0,2", "#NUM!"),
                ("0.5,9,0", "#NUM!"),
                ("\"TRUE\",9,2", "#VALUE!"),
                ("FALSE,9,2", "0"),
                ("#N/A,#REF!,1", "#N/A"),
                ("1/0,9,2", "#DIV/0!"),
            ],
        ),
        (
            ["POISSON", "POISSON.DIST"],
            vec![
                ("", "#ERROR!"),
                ("1,2", "#ERROR!"),
                ("1,2,TRUE,1", "#ERROR!"),
                ("-0.1,2,TRUE", "#NUM!"),
                ("2,-1,TRUE", "#NUM!"),
                ("0,0,FALSE", "1"),
                ("0.25,0,FALSE", "1"),
                ("1,0,FALSE", "0"),
                ("5,0,TRUE", "1"),
                ("5,0,\"TRUE\"", "1"),
                ("5,0,\"FALSE\"", "0"),
                ("\"TRUE\",2,TRUE", "#VALUE!"),
                ("1,\"TRUE\",TRUE", "#VALUE!"),
                ("1,2,\"bad\"", "#VALUE!"),
                ("#N/A,2,#REF!", "#N/A"),
            ],
        ),
    ] {
        for name in names {
            for (args, expected) in &cases {
                let formula = format!("={name}({args})");
                book.edit(&[(0, 0, 0, &formula)], LIMIT).unwrap();
                let actual = book.display(0, 0, 0, LIMIT).unwrap();
                if actual != *expected {
                    failures.push(format!("{formula}: {actual} != {expected}"));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn check(book: &Spreadsheet, row: usize, column: usize, expected: &str) {
    let value = book
        .cell(0, row, column)
        .and_then(|cell| cell.value.clone());
    if let Ok(expected) = expected.parse::<f64>() {
        let Some(Value::Number(actual)) = value else {
            panic!(
                "{} != {expected}",
                book.display(0, row, column, LIMIT).unwrap()
            );
        };
        // Univer's getObjectValue(..., true) rounds to 12 significant digits.
        assert_eq!(format!("{actual:.11e}").parse::<f64>().unwrap(), expected);
    } else {
        assert!(
            matches!(value, Some(Value::Error(error)) if error == expected),
            "{} != {expected}",
            book.display(0, row, column, LIMIT).unwrap()
        );
    }
}

#[test]
fn univer_distribution_scalar_groups() {
    // All scalar groups in Univer 4767b3b309467c283bbd52b725536ca73861e0fc
    // statistical/{gamma-dist,gamma-inv,poisson-dist} (Apache-2.0, LICENSE.Univer).
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=GAMMA.DIST(10,8,2,TRUE)", "0.13337167407"),
        ("=GAMMA.DIST(10,0,2,TRUE)", "#NUM!"),
        ("=GAMMA.DIST(10,8,0,TRUE)", "#NUM!"),
        ("=GAMMA.DIST(10,1,1,TRUE)", "0.99995460007"),
        ("=GAMMA.DIST(10,5,2,TRUE)", "0.559506714935"),
        ("=GAMMA.DIST(0,8,2,TRUE)", "0"),
        ("=GAMMA.DIST(-1,8,2,TRUE)", "#NUM!"),
        ("=GAMMA.DIST(10,8,2,FALSE)", "0.0522224314785"),
        ("=GAMMA.DIST(10,1,1,FALSE)", "0.0000453999297625"),
        ("=GAMMA.DIST(3,1,1,FALSE)", "0.0497870683679"),
        ("=GAMMA.DIST(10,520,520,FALSE)", "0"),
        ("=GAMMA.DIST(10,350,350,FALSE)", "0"),
        ("=GAMMA.DIST(10,0.1,0.1,FALSE)", "6.19742294491e-46"),
        ("=GAMMA.DIST(\"test\",8,2,TRUE)", "#VALUE!"),
        ("=GAMMA.DIST(TRUE,8,2,TRUE)", "6.21969086373e-8"),
        ("=GAMMA.DIST(Z1,8,2,TRUE)", "0"),
        ("=GAMMA.DIST(#NAME?,8,2,TRUE)", "#NAME?"),
        ("=GAMMA.DIST(10,#NAME?,2,TRUE)", "#NAME?"),
        ("=GAMMA.DIST(10,8,#NAME?,TRUE)", "#NAME?"),
        ("=GAMMA.DIST(10,8,2,#NAME?)", "#NAME?"),
        ("=GAMMA.INV(0.068094,9,2)", "10.0000111914"),
        ("=GAMMA.INV(0.068094,0,2)", "#NUM!"),
        ("=GAMMA.INV(0.068094,9,0)", "#NUM!"),
        ("=GAMMA.INV(0.068094,1,1)", "0.0705233277522"),
        ("=GAMMA.INV(0,9,2)", "0"),
        ("=GAMMA.INV(1,9,2)", "#NUM!"),
        ("=GAMMA.INV(\"test\",9,2)", "#VALUE!"),
        ("=GAMMA.INV(TRUE,9,2)", "#NUM!"),
        ("=GAMMA.INV(Z1,9,2)", "0"),
        ("=GAMMA.INV(#NAME?,9,2)", "#NAME?"),
        ("=GAMMA.INV(0.068094,#NAME?,2)", "#NAME?"),
        ("=GAMMA.INV(0.068094,9,#NAME?)", "#NAME?"),
        ("=POISSON.DIST(2,5,TRUE)", "0.124652019483"),
        ("=POISSON.DIST(-2,5,TRUE)", "#NUM!"),
        ("=POISSON.DIST(2,-5,TRUE)", "#NUM!"),
        ("=POISSON.DIST(2,5,FALSE)", "0.0842243374886"),
        ("=POISSON.DIST(\"test\",5,TRUE)", "#VALUE!"),
        ("=POISSON.DIST(TRUE,5,TRUE)", "0.0404276819945"),
        ("=POISSON.DIST(Z1,5,TRUE)", "0.00673794699909"),
        ("=POISSON.DIST(#NAME?,5,TRUE)", "#NAME?"),
        ("=POISSON.DIST(2,#NAME?,TRUE)", "#NAME?"),
        ("=POISSON.DIST(2,5,#NAME?)", "#NAME?"),
        ("=POISSON.DIST(17.16017,0.1,FALSE)", "2.54391172294e-32"),
        ("=POISSON.DIST(17.16017,2,FALSE)", "4.98715018952e-11"),
        ("=POISSON.DIST(0.25,0,FALSE)", "1"),
        ("=POISSON.DIST(139.7316,161,FALSE)", "0.00698880992304"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        check(&book, 0, 0, expected);
    }
}

#[test]
fn univer_distribution_array_groups_recalculate_and_roundtrip() {
    let mut book = Spreadsheet::new();
    for (row, cells) in [
        ["1", "' ", "1.23", "TRUE", "FALSE", ""],
        ["0", "'100", "'2.34", "test", "-3", "=#NAME?"],
    ]
    .iter()
    .enumerate()
    {
        let edits: Vec<_> = cells
            .iter()
            .enumerate()
            .map(|(column, text)| (0, row, column, *text))
            .collect();
        book.edit(&edits, LIMIT).unwrap();
    }
    book.edit(
        &[
            (0, 0, 7, "=GAMMA.DIST(A1:F2,8,2,TRUE)"),
            (0, 4, 7, "=GAMMA.INV(A1:F2,9,2)"),
            (0, 8, 7, "=POISSON.DIST(A1:F2,5,TRUE)"),
        ],
        LIMIT,
    )
    .unwrap();
    for mut book in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
        book,
    ] {
        for (start, expected) in [
            (
                0,
                [
                    [
                        "6.21969086373e-8",
                        "#VALUE!",
                        "2.9437529027e-7",
                        "6.21969086373e-8",
                        "0",
                        "0",
                    ],
                    ["0", "1", "0.0000310031360574", "#VALUE!", "#NUM!", "#NAME?"],
                ],
            ),
            (
                4,
                [
                    ["#NUM!", "#VALUE!", "#NUM!", "#NUM!", "0", "0"],
                    ["0", "#NUM!", "#NUM!", "#VALUE!", "#NUM!", "#NAME?"],
                ],
            ),
            (
                8,
                [
                    [
                        "0.0404276819945",
                        "#VALUE!",
                        "0.0404276819945",
                        "0.0404276819945",
                        "0.00673794699909",
                        "0.00673794699909",
                    ],
                    [
                        "0.00673794699909",
                        "1",
                        "0.124652019483",
                        "#VALUE!",
                        "#NUM!",
                        "#NAME?",
                    ],
                ],
            ),
        ] {
            for (row, values) in expected.iter().enumerate() {
                for (column, value) in values.iter().enumerate() {
                    check(&book, start + row, 7 + column, value);
                }
            }
        }
        book.edit(&[(0, 0, 0, "2")], LIMIT).unwrap();
        check(&book, 8, 7, "0.124652019483");
    }
}

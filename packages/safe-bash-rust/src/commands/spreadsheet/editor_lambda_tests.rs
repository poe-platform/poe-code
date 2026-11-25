// Adapted from IronCalc test_fn_lambda.rs, test_fn_isomitted.rs and logical/lambda.rs
// (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc).
use super::{
    Spreadsheet,
    model::{NamedExpression, Table},
};
const LIMIT: usize = 10_000_000;
#[test]
fn lambda_calls_capture_lexical_bindings_and_keep_parameters_local() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=LAMBDA(x,y,x+y)(1,2)", "3"),
        ("=LET(x,1,y,LAMBDA(a,b,a+b),y(x,22))", "23"),
        ("=LET(a,1,f,LAMBDA(x,x+a),f(2))", "3"),
        ("=LET(a,1,f,LAMBDA(x,x+a),LET(a,9,f(2)))", "3"),
        ("=LAMBDA(x,LAMBDA(y,x+y))(2)(3)", "5"),
        ("=LAMBDA(r,c,r+c)(3,4)", "7"),
        ("=LAMBDA(Σ,σ+Σ)(3)", "6"),
        ("=LET(x,7,LAMBDA(x,x+1)(2)+x)", "10"),
        ("=LAMBDA(x,y,x+y)(1)", "#VALUE!"),
        ("=LAMBDA(x,x)(1,2)", "#VALUE!"),
        ("=LAMBDA(x,x)", "#CALC!"),
        ("=LAMBDA(42)()", "42"),
        ("=LAMBDA(A1,A1)(2)", "#VALUE!"),
        ("=LAMBDA(x,X,x)(1,2)", "#VALUE!"),
        ("=LAMBDA(x,x)(2)+x", "#NAME?"),
        ("=LET(f,3,f(2))", "#VALUE!"),
        ("=LET(SEQUENCE,LAMBDA(x,x*2),SEQUENCE(3))", "6"),
        ("=LET(ROUND,LAMBDA(x,x+1),ROUND(3))", "4"),
        ("=LAMBDA(x,IF(x,TRUE,FALSE))(1)", "TRUE"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
        let reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert_eq!(
            reopened.display(0, 0, 0, LIMIT).unwrap(),
            expected,
            "Excel: {formula}"
        );
    }
}
#[test]
fn lambda_optional_parameters_distinguish_missing_values_from_blank_cells() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=LAMBDA(a,[b],IF(ISOMITTED(b),a/2,a*b))(12)", "6"),
        ("=LAMBDA(a,[b],IF(ISOMITTED(b),a/2,a*b))(12,3)", "36"),
        ("=LAMBDA(a,[b],ISOMITTED(b))(12,\"\")", "FALSE"),
        ("=LAMBDA(a,[b],ISOMITTED(b))(12,0)", "FALSE"),
        ("=LAMBDA(a,[b],ISOMITTED(b))(12,D1)", "FALSE"),
        ("=LAMBDA(a,b,ISOMITTED(b))(12,)", "TRUE"),
        ("=LAMBDA(a,[b],a+1)()", "#VALUE!"),
        ("=LAMBDA(a,[b],a+1)(1,2,3)", "#VALUE!"),
        ("=ISOMITTED()", "#ERROR!"),
        ("=ISOMITTED(1,2)", "#ERROR!"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
        let reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert_eq!(
            reopened.display(0, 0, 0, LIMIT).unwrap(),
            expected,
            "Excel: {formula}"
        );
    }
}
#[test]
fn lambda_reference_arguments_are_sparse_and_array_results_spill() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 3, "text"),
            (0, 1, 3, "7"),
            (0, 1_048_575, 3, "9"),
            (0, 0, 0, "=LAMBDA(x,MAX(x))(D1)"),
            (0, 1, 0, "=LAMBDA(x,MAX(x))(D2)"),
            (0, 2, 0, "=LAMBDA(x,ROW(x))(D2)"),
            (0, 3, 0, "=LAMBDA(x,COLUMN(x))(D2)"),
            (0, 4, 0, "=LAMBDA(x,OFFSET(x,1,0))(D1)"),
            (0, 5, 0, "=LAMBDA(x,SUM(x))(D:D)"),
            (0, 7, 0, "=LAMBDA(n,SEQUENCE(n)*2)(3)"),
            (0, 11, 0, "=LET(f,LAMBDA(x,x+1),g,LAMBDA(h,h(4)),g(f))"),
            (0, 12, 0, "=LET(f,LAMBDA(x,x*2),f(3)+f(4))"),
        ],
        100_000,
    )
    .unwrap();
    for book in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (row, expected) in [
            (0, "0"),
            (1, "7"),
            (2, "2"),
            (3, "4"),
            (4, "7"),
            (5, "16"),
            (7, "2"),
            (8, "4"),
            (9, "6"),
            (11, "5"),
            (12, "14"),
        ] {
            assert_eq!(
                book.display(0, row, 0, LIMIT).unwrap(),
                expected,
                "row {row}"
            );
        }
    }
}
#[test]
fn named_lambdas_follow_sheet_scope_allow_recursion_and_do_not_capture_callers() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Other").unwrap();
    for (name, expression, sheet) in [
        ("MyFn", "LAMBDA(x,x*2)", None),
        ("MyFn", "LAMBDA(x,x*3)", Some(1)),
        ("Factorial", "LAMBDA(n,IF(n<=1,1,n*Factorial(n-1)))", None),
        ("Global", "LAMBDA(x,x+Amount)", None),
        ("Amount", "7", None),
        ("MySeq", "LAMBDA(n,SEQUENCE(n))", None),
    ] {
        book.options.names.push(NamedExpression {
            name: name.into(),
            expression: expression.into(),
            sheet,
            openformula: None,
            position: (sheet.unwrap_or(0), 0, 0),
            compiled: None,
        });
    }
    book.edit(
        &[
            (0, 0, 0, "=MyFn(5)"),
            (1, 0, 0, "=MyFn(5)"),
            (0, 1, 0, "=Factorial(5)"),
            (0, 2, 0, "=LET(Amount,100,Global(3))"),
            (0, 4, 0, "=MySeq(3)"),
        ],
        LIMIT,
    )
    .unwrap();
    for book in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (s, r, expected) in [
            (0, 0, "10"),
            (1, 0, "15"),
            (0, 1, "120"),
            (0, 2, "10"),
            (0, 4, "1"),
            (0, 5, "2"),
            (0, 6, "3"),
        ] {
            assert_eq!(book.display(s, r, 0, LIMIT).unwrap(), expected, "{s},{r}");
        }
    }
}
#[test]
fn lambda_table_bindings_preserve_parameters_through_rename_and_conversion() {
    let mut book = Spreadsheet::new();
    book.options.tables.push(Table {
        style: None,
        calculated_columns: Default::default(),
        name: "Sales".into(),
        sheet: 0,
        area: [0, 0, 2, 0],
        header: true,
        totals: false,
        columns: vec!["Amount".into()],
        filter: None,
    });
    book.edit(
        &[
            (0, 0, 0, "Amount"),
            (0, 1, 0, "2"),
            (0, 2, 0, "3"),
            (0, 0, 2, "=LAMBDA(Sales,Sales+SUM(Sales[Amount]))(7)"),
        ],
        LIMIT,
    )
    .unwrap();
    book.rename_table(0, "Orders", LIMIT).unwrap();
    assert_eq!(
        book.input(0, 0, 2),
        "=LAMBDA(Sales,Sales+SUM(Orders[Amount]))(7)"
    );
    assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "12");
    book.convert_table_to_range(0, LIMIT).unwrap();
    assert_eq!(
        book.input(0, 0, 2),
        "=LAMBDA(Sales,Sales+SUM($A$2:$A$3))(7)"
    );
    assert_eq!(book.display(0, 0, 2, LIMIT).unwrap(), "12");
}

#[test]
fn lambda_resource_failures_do_not_mutate_documents_and_recursion_is_bounded() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "42")], LIMIT).unwrap();
    let before = book.to_json();
    assert!(
        book.edit(
            &[(
                0,
                0,
                0,
                "=LET(data,SEQUENCE(10000),f,LAMBDA(x,data*x),f(2))"
            )],
            20_000
        )
        .is_err()
    );
    assert_eq!(book.to_json(), before);
    book.options.names.push(NamedExpression {
        name: "Forever".into(),
        expression: "LAMBDA(x,Forever(x))".into(),
        sheet: None,
        openformula: None,
        position: (0, 0, 0),
        compiled: None,
    });
    book.edit(&[(0, 0, 0, "=Forever(1)")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#NUM!");
}
#[test]
fn lambda_does_not_capture_cell_locals_and_preserves_reference_intersections() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 0, "=LET(x,5,LAMBDA(y,B1+y)(2))"),
            (0, 0, 1, "=x"),
            (0, 0, 3, "2"),
            (0, 1, 3, "4"),
            (0, 0, 5, "=SUM(LAMBDA(x,x)(D:D) D1:D2)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "#NAME?");
    assert_eq!(book.display(0, 0, 5, LIMIT).unwrap(), "6");
    for (formula, input) in [
        ("=LAMBDA(", "=LAMBDA("),
        ("=LAMBDA(x,", "=LAMBDA(x,"),
        // An empty invocation parses after entry correction; evaluation still
        // reports its missing required parameter.
        ("=LAMBDA(x,x)(", "=LAMBDA(x,x)()"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let json = Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap();
        assert_eq!(json.input(0, 0, 0), input);
        let excel = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert!(excel.display(0, 0, 0, LIMIT).unwrap().starts_with('#'));
    }
}

// Excel namespace expectations from IronCalc test_excel_export_lambda_let.rs.
#[test]
fn excel_exports_bound_variables_with_parameter_namespaces() {
    let mut book = Spreadsheet::new();
    book.options.names.push(NamedExpression {
        name: "MySum".into(),
        expression: "LAMBDA(x,x+1)".into(),
        sheet: None,
        openformula: None,
        position: (0, 0, 0),
        compiled: None,
    });
    book.edit(
        &[
            (0, 0, 0, "=LET(f,LAMBDA(x,x*x),f(2))"),
            (0, 1, 0, "=LAMBDA(a,[b],IF(ISOMITTED(b),a/2,a*b))(12)"),
        ],
        LIMIT,
    )
    .unwrap();
    let bytes = book.export_xlsx(LIMIT).unwrap();
    let archive = crate::commands::structured::read_office_archive(&bytes);
    let sheet = std::str::from_utf8(&archive["xl/worksheets/sheet1.xml"]).unwrap();
    assert!(
        sheet.contains("_xlfn.LET(_xlpm.f,_xlfn.LAMBDA(_xlpm.x,_xlpm.x*_xlpm.x),_xlpm.f(2))"),
        "{sheet}"
    );
    assert!(sheet.contains("_xlfn.LAMBDA(_xlpm.a,_xlop.b,IF(_xlfn.ISOMITTED(_xlpm.b),_xlpm.a/2,_xlpm.a*_xlpm.b))(12)"),"{sheet}");
    let workbook = std::str::from_utf8(&archive["xl/workbook.xml"]).unwrap();
    assert!(
        workbook.contains("_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1)"),
        "{workbook}"
    );
}

#[test]
fn excel_parameter_namespaces_import_without_private_extensions() {
    let entries: &[(&str, &[u8])] = &[
        ("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#),
        ("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="MySum">_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1)</definedName></definedNames></workbook>"#),
        ("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#),
        ("xl/worksheets/sheet1.xml", br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>_xlfn.LAMBDA(_xlpm.a,_xlop.b,IF(_xlfn.ISOMITTED(_xlpm.b),_xlpm.a/2,_xlpm.a*_xlpm.b))(12)</f></c></row><row r="2"><c r="A2"><f>MySum(3)</f></c></row></sheetData></worksheet>"#),
    ];
    let bytes = office_package_rust::write_zip_stored(entries);
    let book = Spreadsheet::import_xlsx(&bytes, LIMIT)
        .unwrap()
        .materialize_formulas(LIMIT)
        .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "6");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "4");
    assert_eq!(
        book.input(0, 0, 0),
        "=LAMBDA(a,[b],IF(ISOMITTED(b),a/2,a*b))(12)"
    );
    let reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(reopened.display(0, 0, 0, LIMIT).unwrap(), "6");
    assert_eq!(reopened.display(0, 1, 0, LIMIT).unwrap(), "4");
}

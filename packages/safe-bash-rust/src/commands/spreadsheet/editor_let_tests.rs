// LET examples and lexical-scope rules adapted from IronCalc logical/let.rs and
// test_fn_let.rs (f93662006b8fb1c401dc870bbda26c5d60ac6037, MIT, LICENSE.IronCalc).
use super::{
    Spreadsheet,
    model::{NamedExpression, Table},
};
const LIMIT: usize = 10_000_000;

#[test]
fn let_names_follow_lexical_scope_and_keep_outer_bindings_available() {
    let mut book = Spreadsheet::new();
    for (formula, expected) in [
        ("=LET(x,2,y,4,x+y)", "6"),
        ("=LET(x,3,LET(x,4,x*5)*x)", "60"),
        ("=LET(x,1,LET(x,x+1,x))", "2"),
        ("=LET(r,3,c,4,r+c)", "7"),
        ("=LET(Amount,3,amount+AMOUNT)", "6"),
        ("=LET(Σ,3,σ+Σ)", "6"),
        ("=LET(_xlpm.item,3,_xlpm.item+1)", "4"),
        ("=LET(x,3,LET(y,4,x+y)+x)", "10"),
        ("=LET(x,1/0,5)", "5"),
        ("=LET(value,NA(),IFERROR(value,7))", "7"),
        ("=IF(FALSE,LET(value,1/0,value),5)", "5"),
        ("=LET(value,TRUE,value)", "TRUE"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), expected, "{formula}");
        let reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert_eq!(
            reopened.display(0, 0, 0, LIMIT).unwrap(),
            expected,
            "Excel roundtrip: {formula}"
        );
    }
}

#[test]
fn let_rejects_invalid_declarations_and_does_not_leak_names() {
    let mut book = Spreadsheet::new();
    for (formula, error) in [
        ("=LET()", "#ERROR!"),
        ("=LET(x,1)", "#ERROR!"),
        ("=LET(x,1,y,2)", "#ERROR!"),
        ("=LET(x,1,x,2,x)", "#ERROR!"),
        ("=LET(x,1,X,2,x)", "#ERROR!"),
        ("=LET(A1,1,A1)", "#VALUE!"),
        ("=LET(\"x\",1,x)", "#VALUE!"),
        ("=LET(TRUE,1,TRUE)", "#VALUE!"),
        ("=LET(x,y,y,2,x)", "#NAME?"),
        ("=LET(x,3,x)+x", "#NAME?"),
        ("=LET(x,3,LET(y,4,y))+y", "#NAME?"),
    ] {
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), error, "{formula}");
        let reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert_eq!(
            reopened.display(0, 0, 0, LIMIT).unwrap(),
            error,
            "Excel roundtrip: {formula} became {}",
            reopened.input(0, 0, 0)
        );
    }
}

#[test]
fn cell_and_workbook_names_do_not_capture_the_callers_let_bindings() {
    let mut book = Spreadsheet::new();
    book.options.names.push(NamedExpression {
        name: "Global".into(),
        sheet: None,
        expression: "LET(inner,7,inner)".into(),
        openformula: None,
        position: (0, 0, 0),
        compiled: None,
    });
    book.options.names.push(NamedExpression {
        name: "Amount".into(),
        sheet: None,
        expression: "9".into(),
        openformula: None,
        position: (0, 0, 0),
        compiled: None,
    });
    book.options.names.push(NamedExpression {
        name: "Broken".into(),
        sheet: None,
        expression: "1+".into(),
        openformula: None,
        position: (0, 0, 0),
        compiled: None,
    });
    book.edit(
        &[
            (0, 0, 0, "=LET(x,3,C1+Global+x)"),
            (0, 0, 2, "=LET(y,5,y)"),
            (0, 1, 0, "=LET(Amount,Amount+1,Amount)+Amount"),
            (0, 2, 0, "=LET(Broken,4,Broken)"),
            (0, 3, 0, "=LET(Amount,3,C5)"),
            (0, 4, 2, "=Amount"),
        ],
        LIMIT,
    )
    .unwrap();
    for (r, expected) in [(0, "15"), (1, "19"), (2, "4"), (3, "9")] {
        assert_eq!(book.display(0, r, 0, LIMIT).unwrap(), expected);
    }
}

#[test]
fn let_preserves_sparse_references_and_spilled_arrays_across_roundtrips() {
    let mut book = Spreadsheet::new();
    book.edit(
        &[
            (0, 0, 3, "5"),
            (0, 1_048_575, 3, "9"),
            (0, 0, 0, "=LET(data,D:D,SUM(data))"),
            (0, 1, 0, "=LET(data,D1,SUM(data*3,data))"),
            (0, 3, 0, "=LET(data,SEQUENCE(3),data*data)"),
            (0, 7, 0, "=LET(data,D1:D3,ROWS(data))"),
            (0, 8, 0, "=LET(data,D1,ISREF(data))"),
            (0, 9, 0, "=LET(data,D1:INDEX(D:D,3),ROWS(data))"),
            (0, 10, 0, "=LET(data,D:D,INDEX(data,1048576))"),
            (0, 11, 0, "=LET(data,{1,2;3,4},INDEX(data,2,2))"),
            (0, 12, 0, "=LET(data,D:D,SUM(data D1:D3))"),
        ],
        100_000,
    )
    .unwrap();
    for mut book in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        for (r, expected) in [
            (0, "14"),
            (1, "20"),
            (3, "1"),
            (4, "4"),
            (5, "9"),
            (7, "3"),
            (8, "TRUE"),
            (9, "3"),
            (10, "9"),
            (11, "4"),
            (12, "5"),
        ] {
            assert_eq!(book.display(0, r, 0, LIMIT).unwrap(), expected);
        }
        book.edit(&[(0, 0, 3, "10")], 100_000).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "19");
        assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "40");
    }
}

#[test]
fn table_renames_and_conversion_preserve_let_declarations_and_scopes() {
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
            (0, 0, 2, "=LET(Orders,2,Sales,3,Orders+Sales)"),
            (0, 1, 2, "=LET(Sales,Sales,SUM(Sales))"),
            (0, 2, 2, "=LET(Sales,7,Sales+SUM(Sales[Amount]))"),
        ],
        LIMIT,
    )
    .unwrap();
    let cell = &book.sheets[0].cells[&(0, 2)];
    for source in [&cell.formula, &cell.openformula, &cell.formula_display]
        .into_iter()
        .flatten()
    {
        let mapped = super::map_table_references(
            source,
            &[super::TableReferenceMap {
                name: "Sales",
                replacement: Some("Orders"),
                columns: Vec::new(),
                local: false,
            }],
            &mut LIMIT.clone(),
        )
        .unwrap()
        .0;
        assert_eq!(&mapped, source, "local variable rewritten in {source}");
    }
    book.rename_table(0, "Orders", LIMIT).unwrap();
    for (r, expected) in [(0, "5"), (1, "5"), (2, "12")] {
        assert_eq!(book.display(0, r, 2, LIMIT).unwrap(), expected);
    }
    assert_eq!(book.input(0, 0, 2), "=LET(Orders,2,Sales,3,Orders+Sales)");
    assert_eq!(book.input(0, 1, 2), "=LET(Sales,Orders,SUM(Sales))");
    book.convert_table_to_range(0, LIMIT).unwrap();
    assert_eq!(book.input(0, 2, 2), "=LET(Sales,7,Sales+SUM($A$2:$A$3))");
    for (r, expected) in [(0, "5"), (1, "5"), (2, "12")] {
        assert_eq!(book.display(0, r, 2, LIMIT).unwrap(), expected);
    }
}

#[test]
fn let_resource_failures_leave_the_workbook_unchanged() {
    let mut book = Spreadsheet::new();
    book.edit(&[(0, 0, 0, "keep me")], LIMIT).unwrap();
    let before = book.to_json();
    for formula in [
        "=LET(data,SEQUENCE(10000),SUM(data))".to_owned(),
        format!("=LET({},1,2)", "x".repeat(5000)),
        format!("={}1{}", "LET(x,1,".repeat(100), ")".repeat(100)),
    ] {
        assert!(
            book.edit(&[(0, 0, 0, &formula)], 10_000).is_err(),
            "{formula}"
        );
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn incomplete_let_formulas_can_still_be_saved_and_reopened() {
    for formula in ["=LET(", "=LET(Name,1,", "=LET(Name,1,Name+"] {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, formula)], LIMIT).unwrap();
        let output = book.export_xlsx(LIMIT).expect(formula);
        let reopened = Spreadsheet::import_xlsx(&output, LIMIT).expect(formula);
        assert!(reopened.input(0, 0, 0).to_uppercase().starts_with("=LET("));
    }
}

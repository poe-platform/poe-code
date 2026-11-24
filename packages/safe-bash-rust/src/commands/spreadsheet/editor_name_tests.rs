use super::{NamedExpression, Spreadsheet};

const LIMIT: usize = 32 * 1024 * 1024;
fn definition(name: &str, expression: &str, sheet: Option<usize>) -> NamedExpression {
    NamedExpression {
        name: name.into(),
        expression: expression.into(),
        sheet,
        openformula: None,
        position: (sheet.unwrap_or(0), 0, 0),
        compiled: None,
    }
}

#[test]
fn named_expression_lifecycle_and_scopes_follow_ironcalc() {
    // IronCalc f936620, base/src/test/user_model/test_defined_names.rs
    // create_defined_name and scopes (MIT, LICENSE.IronCalc).
    let mut book = Spreadsheet::new();
    book.add_sheet("Sheet2").unwrap();
    book.add_sheet("Sheet3").unwrap();
    book.edit(
        &[
            (0, 0, 0, "42"),
            (1, 1, 0, "145"),
            (0, 4, 6, "=myName"),
            (1, 7, 7, "=myName"),
            (2, 1, 1, "=myName"),
        ],
        LIMIT,
    )
    .unwrap();
    let global = book
        .set_named_expression(None, definition("myName", "Sheet1!$A$1", None), LIMIT)
        .unwrap();
    let local = book
        .set_named_expression(None, definition("myName", "Sheet2!$A$2", Some(1)), LIMIT)
        .unwrap();
    for (s, r, c, expected) in [(0, 4, 6, "42"), (1, 7, 7, "145"), (2, 1, 1, "42")] {
        assert_eq!(book.display(s, r, c, LIMIT).unwrap(), expected);
    }
    book.remove_named_expression(global, LIMIT).unwrap();
    assert_eq!(book.display(0, 4, 6, LIMIT).unwrap(), "#NAME?");
    assert_eq!(book.display(1, 7, 7, LIMIT).unwrap(), "145");
    assert_eq!(book.options.names[local - 1].name, "myName");
}

#[test]
fn renaming_a_name_preserves_scopes_local_variables_and_text() {
    let mut book = Spreadsheet::new();
    book.add_sheet("Local Sheet").unwrap();
    let global = book
        .set_named_expression(None, definition("answer", "42", None), LIMIT)
        .unwrap();
    book.set_named_expression(None, definition("answer", "78", Some(1)), LIMIT)
        .unwrap();
    book.set_named_expression(None, definition("Twice", "answer*2", None), LIMIT)
        .unwrap();
    book.edit(
        &[
            (0, 0, 0, "=IF(answer<2,answer*2,answer^2)"),
            (0, 1, 0, "=LET(answer,7,answer)+answer"),
            (0, 2, 0, "=LAMBDA(answer,answer+1)(3)+answer"),
            (0, 3, 0, "=\"answer\"&answer"),
            (0, 4, 0, "='Local Sheet'!answer"),
            (1, 0, 0, "=answer"),
            (0, 5, 0, "=Twice"),
        ],
        LIMIT,
    )
    .unwrap();
    book.set_named_expression(Some(global), definition("respuesta", "42", None), LIMIT)
        .unwrap();
    assert_eq!(
        book.input(0, 0, 0),
        "=IF(respuesta<2,respuesta*2,respuesta^2)"
    );
    assert_eq!(book.input(0, 1, 0), "=LET(answer,7,answer)+respuesta");
    assert_eq!(book.input(0, 2, 0), "=LAMBDA(answer,answer+1)(3)+respuesta");
    assert_eq!(book.input(0, 3, 0), "=\"answer\"&respuesta");
    assert_eq!(book.input(0, 4, 0), "='Local Sheet'!answer");
    assert_eq!(book.input(1, 0, 0), "=answer");
    for (row, expected) in [
        (0, "1764"),
        (1, "49"),
        (2, "46"),
        (3, "answer42"),
        (4, "78"),
        (5, "84"),
    ] {
        assert_eq!(book.display(0, row, 0, LIMIT).unwrap(), expected);
    }
    book.set_named_expression(Some(1), definition("localAnswer", "78", Some(1)), LIMIT)
        .unwrap();
    assert_eq!(book.input(0, 4, 0), "='Local Sheet'!localAnswer");
    assert_eq!(book.input(1, 0, 0), "=localAnswer");
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.display(0, 5, 0, LIMIT).unwrap(), "84");
        let global = restored
            .options
            .names
            .iter()
            .position(|n| n.name == "respuesta")
            .unwrap();
        restored
            .set_named_expression(Some(global), definition("respuesta", "100", None), LIMIT)
            .unwrap();
        assert_eq!(restored.display(0, 5, 0, LIMIT).unwrap(), "200");
    }
}

#[test]
fn name_scope_changes_follow_ironcalc() {
    // IronCalc f936620, user_model/test_defined_names.rs change_scope.
    let mut book = Spreadsheet::new();
    book.add_sheet("Sheet2").unwrap();
    book.edit(
        &[
            (0, 0, 0, "Hello"),
            (0, 1, 0, "=CONCATENATE(MyName,\" world!\")"),
        ],
        LIMIT,
    )
    .unwrap();
    let index = book
        .set_named_expression(None, definition("myName", "Sheet1!$A$1", Some(1)), LIMIT)
        .unwrap();
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "#NAME?");
    book.set_named_expression(
        Some(index),
        definition("myName", "Sheet1!$A$1", None),
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "Hello world!");
}

#[test]
fn named_functions_and_relative_references_survive_renames() {
    let mut book = Spreadsheet::new();
    let mut previous = definition("previous", "A1", None);
    previous.position = (0, 1, 0);
    book.set_named_expression(None, previous.clone(), LIMIT)
        .unwrap();
    let function = definition("factorial", "LAMBDA(n,IF(n<2,1,n*factorial(n-1)))", None);
    book.set_named_expression(None, function.clone(), LIMIT)
        .unwrap();
    book.edit(
        &[
            (0, 0, 0, "7"),
            (0, 1, 0, "=previous+1"),
            (0, 2, 0, "=previous+1"),
            (0, 0, 1, "=factorial(5)"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), "9");
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "120");
    previous.name = "above".into();
    book.set_named_expression(Some(0), previous, LIMIT).unwrap();
    let mut renamed = function;
    renamed.name = "permutations".into();
    book.set_named_expression(Some(1), renamed, LIMIT).unwrap();
    assert_eq!(book.input(0, 1, 0), "=above+1");
    assert_eq!(book.input(0, 0, 1), "=permutations(5)");
    assert!(
        book.options.names[1]
            .expression
            .contains("permutations(n-1)")
    );
    assert_eq!(book.display(0, 2, 0, LIMIT).unwrap(), "9");
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "120");
}

#[test]
fn name_renames_reach_arrays_calculated_columns_and_conditional_rules() {
    use super::{ArrayFormula, ConditionalFormat, ConditionalRule, Style};
    let mut book = Spreadsheet::new();
    book.set_named_expression(None, definition("price", "3", None), LIMIT)
        .unwrap();
    book.edit(
        &[
            (0, 0, 0, "Quantity"),
            (0, 0, 1, "Amount"),
            (0, 1, 0, "2"),
            (0, 2, 0, "4"),
        ],
        LIMIT,
    )
    .unwrap();
    book.add_table(0, "Orders", [0, 0, 2, 1], LIMIT).unwrap();
    book.set_calculated_column(0, 1, "[@Quantity]*price", false, LIMIT)
        .unwrap();
    book.edit(&[(0, 0, 3, "3"), (0, 1, 3, "6")], LIMIT).unwrap();
    book.sheets[0].arrays.push(ArrayFormula {
        range: [0, 3, 1, 2],
        expression: "price*{1;2}".into(),
        openformula: None,
        formula_display: None,
    });
    book.set_conditional_formats(
        vec![ConditionalFormat {
            sheet: 0,
            ranges: vec![[1, 0, 2, 0]],
            priority: 1,
            stop_if_true: false,
            rule: ConditionalRule::Formula("A2>price".into()),
            style: Style {
                attributes: vec![("Back", "FFFF0000".into()), ("Shade", "1".into())],
                ..Style::default()
            },
            format: None,
        }],
        LIMIT,
    )
    .unwrap();
    book.set_named_expression(Some(0), definition("unit_price", "3", None), LIMIT)
        .unwrap();
    assert_eq!(
        book.options.tables[0].calculated_columns[&1].formula,
        "Orders[@Quantity]*unit_price"
    );
    assert_eq!(book.sheets[0].arrays[0].expression, "unit_price*{1;2}");
    assert!(
        matches!(&book.options.conditional_formats[0].rule, ConditionalRule::Formula(f) if f == "A2>unit_price")
    );
    for (r, c, expected) in [(1, 1, "6"), (2, 1, "12"), (0, 3, "3"), (1, 3, "6")] {
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), expected);
    }
}

#[test]
fn imported_name_bindings_survive_shadowing_renames_and_deletions() {
    use super::model::CompiledName;
    use std::collections::BTreeMap;
    let mut book = Spreadsheet::new();
    book.set_named_expression(None, definition("unrelated", "1", None), LIMIT)
        .unwrap();
    book.set_named_expression(None, definition("shared", "42", None), LIMIT)
        .unwrap();
    let mut bound = definition("bound", "shared*2", Some(0));
    bound.compiled = Some(CompiledName {
        expression: "shared*2".into(),
        bindings: BTreeMap::from([("shared".into(), Some(1))]),
    });
    book.options.names.push(bound);
    book.set_named_expression(None, definition("shared", "7", Some(0)), LIMIT)
        .unwrap();
    book.edit(&[(0, 0, 0, "=bound"), (0, 1, 0, "=shared")], LIMIT)
        .unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "84");
    assert_eq!(book.display(0, 1, 0, LIMIT).unwrap(), "7");
    let mut renamed = book.options.names[2].clone();
    renamed.name = "bound_value".into();
    book.set_named_expression(Some(2), renamed, LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "84");
    assert_eq!(book.input(0, 0, 0), "=bound_value");
    book.set_named_expression(Some(1), definition("global_value", "42", None), LIMIT)
        .unwrap();
    assert_eq!(book.options.names[2].expression, "global_value*2");
    let compiled = book.options.names[2].compiled.as_ref().unwrap();
    assert_eq!(compiled.expression, "global_value*2");
    assert_eq!(compiled.bindings.get("global_value"), Some(&Some(1)));
    assert!(!compiled.bindings.contains_key("shared"));
    assert_eq!(book.input(0, 1, 0), "=shared");
    book.remove_named_expression(0, LIMIT).unwrap();
    for mut restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.display(0, 0, 0, LIMIT).unwrap(), "84");
        assert_eq!(restored.display(0, 1, 0, LIMIT).unwrap(), "7");
        let index = restored
            .options
            .names
            .iter()
            .position(|n| n.name == "global_value")
            .unwrap();
        restored.remove_named_expression(index, LIMIT).unwrap();
        assert_eq!(restored.display(0, 0, 0, LIMIT).unwrap(), "#NAME?");
    }
}

#[test]
fn ironcalc_xlsx_named_ranges_remain_editable() {
    // Original IronCalc f936620 fixture and test_defined_names_casing cases,
    // xlsx/tests/test.rs, MIT, LICENSE.IronCalc.
    let mut book = Spreadsheet::import_xlsx(
        include_bytes!("fixtures/ironcalc-defined-names.xlsx"),
        LIMIT,
    )
    .unwrap();
    for (source, expected) in [
        ("=named1", "11"),
        ("=NAMED1", "11"),
        ("=NaMeD1", "11"),
        ("=named2", "22"),
        ("=NAMED2", "22"),
        ("=NaMeD2", "22"),
        ("=named3", "33"),
        ("=NAMED3", "33"),
        ("=NaMeD3", "33"),
    ] {
        book.edit(&[(0, 1, 12, source)], LIMIT).unwrap();
        assert_eq!(book.display(0, 1, 12, LIMIT).unwrap(), expected);
    }
    let index = book
        .options
        .names
        .iter()
        .position(|n| n.name.eq_ignore_ascii_case("named3"))
        .unwrap();
    let mut renamed = book.options.names[index].clone();
    renamed.name = "third_value".into();
    book.set_named_expression(Some(index), renamed, LIMIT)
        .unwrap();
    assert_eq!(book.input(0, 1, 12), "=third_value");
    let restored = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(restored.display(0, 1, 12, LIMIT).unwrap(), "33");
}

#[test]
fn invalid_name_edits_leave_the_workbook_unchanged() {
    let mut book = Spreadsheet::new();
    book.set_named_expression(None, definition("Total", "10", None), LIMIT)
        .unwrap();
    book.edit(&[(0, 0, 0, "=Total")], LIMIT).unwrap();
    let before = book.to_json();
    for bad in [
        definition("A1", "2", None),
        definition("R1C1", "2", None),
        definition("bad name", "2", None),
        definition("TOTAL", "2", None),
        definition("Good", "SUM(", None),
        definition("Good", "1", Some(9)),
    ] {
        assert!(book.set_named_expression(None, bad, LIMIT).is_err());
        assert_eq!(book.to_json(), before);
    }
    assert!(
        book.set_named_expression(Some(0), definition("Renamed", "20", None), 1)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
    assert!(book.remove_named_expression(9, LIMIT).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn rename_rejects_capturing_a_local_variable_or_a_scoped_name() {
    for source in [
        "=LET(captured,7,original+captured)",
        "=LAMBDA(captured,original+captured)(7)",
        "=original+captured",
    ] {
        let mut book = Spreadsheet::new();
        book.set_named_expression(None, definition("original", "42", None), LIMIT)
            .unwrap();
        book.set_named_expression(None, definition("captured", "7", Some(0)), LIMIT)
            .unwrap();
        book.edit(&[(0, 0, 0, source)], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 0, LIMIT).unwrap(), "49");
        let before = book.to_json();
        assert!(
            book.set_named_expression(Some(0), definition("captured", "42", None), LIMIT)
                .is_err()
        );
        assert_eq!(book.to_json(), before);
    }
}

fn imported_binding_book() -> Spreadsheet {
    use super::model::CompiledName;
    let mut book = Spreadsheet::new();
    book.add_sheet("Unused").unwrap();
    book.options.names = vec![
        definition("unused", "1", Some(1)),
        definition("shared", "42", None),
        definition("shared", "7", Some(0)),
        definition("bound", "shared+Sheet1!$A$1", Some(0)),
    ];
    book.options.names[3].compiled = Some(CompiledName {
        expression: "msoxl:=shared+Sheet1!$A$1".into(),
        bindings: std::collections::BTreeMap::from([("shared".into(), Some(1))]),
    });
    book.edit(&[(0, 0, 0, "3"), (0, 0, 1, "=bound")], LIMIT)
        .unwrap();
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "45");
    book
}

#[test]
fn imported_bindings_survive_structural_sheet_changes() {
    let mut book = imported_binding_book();
    book.rename_sheet(0, "Renamed", LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "45");
    book.delete_sheet(1, LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "45");
    assert_eq!(
        book.options.names[2].compiled.as_ref().unwrap().bindings["shared"],
        Some(0)
    );
    for restored in [
        Spreadsheet::from_json(&book.to_json(), LIMIT).unwrap(),
        Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap(),
    ] {
        assert_eq!(restored.display(0, 0, 1, LIMIT).unwrap(), "45");
    }
}

#[test]
fn imported_bindings_survive_structural_axis_changes() {
    for columns in [false, true] {
        let mut book = imported_binding_book();
        book.edit_axis(0, columns, 0, 1, LIMIT).unwrap();
        let (r, c) = if columns { (0, 2) } else { (1, 1) };
        assert_eq!(book.display(0, r, c, LIMIT).unwrap(), "45");
        book.edit_axis(0, columns, 0, -1, LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "45");
    }
}

#[test]
fn deleted_scoped_bindings_do_not_capture_other_names() {
    let mut book = imported_binding_book();
    book.options.names[0] = definition("shared", "100", Some(1));
    book.options.names[3]
        .compiled
        .as_mut()
        .unwrap()
        .bindings
        .insert("shared".into(), Some(0));
    book.edit(&[(0, 0, 0, "3")], LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "103");
    book.delete_sheet(1, LIMIT).unwrap();
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "#NAME?");
    assert_eq!(
        book.options.names[2].compiled.as_ref().unwrap().bindings["shared"],
        None
    );
}

#[test]
fn imported_bindings_survive_table_changes() {
    for action in ["rename", "header", "convert", "resize"] {
        let mut book = imported_binding_book();
        book.edit(&[(0, 0, 3, "Value"), (0, 1, 3, "3"), (0, 2, 3, "4")], LIMIT)
            .unwrap();
        book.add_table(0, "Data", [0, 3, 2, 3], LIMIT).unwrap();
        let bound = &mut book.options.names[3];
        bound.expression = "shared+SUM(Data[Value])".into();
        bound.position = (0, 2, 3);
        bound.openformula = Some(format!("msoxl:={}", bound.expression));
        bound.compiled.as_mut().unwrap().expression = bound.openformula.clone().unwrap();
        book.edit(&[(0, 0, 1, "=bound")], LIMIT).unwrap();
        assert_eq!(
            book.display(0, 0, 1, LIMIT).unwrap(),
            "49",
            "{action} before"
        );
        match action {
            "rename" => book.rename_table(0, "Records", LIMIT).unwrap(),
            "header" => book.edit(&[(0, 0, 3, "Renamed")], LIMIT).unwrap(),
            "convert" => book.convert_table_to_range(0, LIMIT).unwrap(),
            "resize" => book.resize_table(0, 1, 3, LIMIT).unwrap(),
            _ => unreachable!(),
        }
        assert_eq!(
            book.display(0, 0, 1, LIMIT).unwrap(),
            if action == "resize" { "45" } else { "49" },
            "{action} after"
        );
        assert_eq!(
            book.options.names[3].compiled.as_ref().unwrap().bindings["shared"],
            Some(1)
        );
    }
}

#[test]
fn compiled_bindings_export_global_local_missing_and_lexical_names() {
    let mut book = imported_binding_book();
    let bound = &mut book.options.names[3];
    bound.compiled.as_mut().unwrap().expression =
        "msoxl:=_xlfn.LET(shared,3,shared)+shared+Sheet1!shared".into();
    bound.compiled.as_mut().unwrap().bindings =
        std::collections::BTreeMap::from([("shared".into(), Some(1))]);
    book.edit(
        &[
            (0, 0, 1, "=bound"),
            (0, 1, 1, "=[0]!shared"),
            (0, 2, 1, "='[0]'!shared"),
        ],
        LIMIT,
    )
    .unwrap();
    assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "52");
    let exported = book.export_xlsx(LIMIT).unwrap();
    let restored = Spreadsheet::import_xlsx(&exported, LIMIT).unwrap();
    assert_eq!(restored.display(0, 0, 1, LIMIT).unwrap(), "52");
    assert_eq!(restored.display(0, 1, 1, LIMIT).unwrap(), "42");
    assert_eq!(restored.display(0, 2, 1, LIMIT).unwrap(), "42");
    book.options.names[3]
        .compiled
        .as_mut()
        .unwrap()
        .bindings
        .insert("shared".into(), None);
    book.edit(&[(0, 0, 1, "=bound")], LIMIT).unwrap();
    let restored = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert_eq!(restored.display(0, 0, 1, LIMIT).unwrap(), "#NAME?");
}

#[test]
fn structural_changes_preserve_compiled_symbol_spelling() {
    for action in ["sheet", "row", "convert"] {
        let mut book = imported_binding_book();
        book.edit(&[(0, 0, 3, "Value"), (0, 1, 3, "3")], LIMIT)
            .unwrap();
        book.add_table(0, "Data", [0, 3, 1, 3], LIMIT).unwrap();
        book.options.names[3].compiled.as_mut().unwrap().expression =
            "msoxl:=SHARED+SUM(Data[Value])".into();
        book.options.names[3].compiled.as_mut().unwrap().bindings =
            std::collections::BTreeMap::from([("SHARED".into(), Some(1))]);
        book.edit(&[(0, 0, 1, "=bound")], LIMIT).unwrap();
        assert_eq!(book.display(0, 0, 1, LIMIT).unwrap(), "45");
        match action {
            "sheet" => book.rename_sheet(0, "Renamed", LIMIT).unwrap(),
            "row" => book.edit_axis(0, false, 0, 1, LIMIT).unwrap(),
            "convert" => book.convert_table_to_range(0, LIMIT).unwrap(),
            _ => unreachable!(),
        }
        assert_eq!(
            book.display(0, usize::from(action == "row"), 1, LIMIT)
                .unwrap(),
            "45",
            "{action}"
        );
    }
}

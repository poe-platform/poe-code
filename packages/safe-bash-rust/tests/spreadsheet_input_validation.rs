use safe_bash_rust::commands::{
    codecs::{parse_zip_archive, serialize_zip_archive},
    spreadsheet::Spreadsheet,
};
const LIMIT: usize = 64 * 1024 * 1024;
const SOURCE: &[u8] = include_bytes!("fixtures/spreadsheet-input-validation.xlsx");

fn worksheet(bytes: &[u8]) -> String {
    String::from_utf8(
        parse_zip_archive(bytes)
            .unwrap()
            .into_iter()
            .find(|e| e.name == "xl/worksheets/sheet1.xml")
            .unwrap()
            .content,
    )
    .unwrap()
}
fn with_rule(rule: &str) -> Vec<u8> {
    let mut entries = parse_zip_archive(SOURCE).unwrap();
    let entry = entries
        .iter_mut()
        .find(|e| e.name == "xl/worksheets/sheet1.xml")
        .unwrap();
    let mut xml = String::from_utf8(entry.content.clone()).unwrap();
    let start = xml.find("<dataValidations").unwrap();
    let end = xml[start..].find("</dataValidations>").unwrap() + start + "</dataValidations>".len();
    xml.replace_range(
        start..end,
        &format!("<dataValidations count=\"1\">{rule}</dataValidations>"),
    );
    entry.content = xml.into_bytes();
    serialize_zip_archive(&entries)
}
#[test]
fn original_rules_survive_native_and_excel_roundtrips_and_reject_invalid_input() {
    let mut book = Spreadsheet::import_xlsx(SOURCE, LIMIT).unwrap();
    for _ in 0..3 {
        for (column, text) in [(1, "-2"), (1, "11"), (1, "2.5"), (1, "'2"), (2, "Released")] {
            let before = book.to_json();
            assert!(
                book.edit(&[(0, 1, column, text)], LIMIT).is_err(),
                "{column}: {text}"
            );
            assert_eq!(book.to_json(), before);
        }
        book.edit(&[(0, 1, 1, "10"), (0, 1, 2, "Approved")], LIMIT)
            .unwrap();
        assert_eq!(book.input(0, 1, 1), "10");
        let saved = book.to_json();
        book = Spreadsheet::from_json(&saved, LIMIT).unwrap();
        assert_eq!(book.to_json(), saved);
        let bytes = book.export_xlsx(LIMIT).unwrap();
        let xml = worksheet(&bytes);
        assert!(xml.contains("<dataValidations count=\"2\">"));
        assert!(xml.contains("<formula1>1</formula1><formula2>10</formula2>"));
        assert!(xml.contains("Pending,Approved"));
        book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    }
}

#[test]
fn batch_validation_uses_final_values_and_preserves_all_cells_on_failure() {
    let bytes = with_rule(
        r#"<dataValidation type="whole" operator="lessThanOrEqual" showErrorMessage="1" sqref="B2"><formula1>D2</formula1></dataValidation>"#,
    );
    let mut book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    let before = book.to_json();
    assert!(book.edit(&[(0, 1, 3, "4"), (0, 1, 1, "5")], LIMIT).is_err());
    assert_eq!(book.to_json(), before);
    book.edit(&[(0, 1, 1, "15"), (0, 1, 3, "20")], LIMIT)
        .unwrap();
    book.edit(&[(0, 1, 1, "=D2-1")], LIMIT).unwrap();
    let before = book.to_json();
    assert!(book.edit(&[(0, 1, 1, "=D2+1")], LIMIT).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn malformed_or_extended_rules_fail_explicitly_instead_of_disappearing() {
    for rule in [
        r#"<dataValidation type="whole" sqref="B2"><formula1>1</formula1></dataValidation>"#,
        r#"<dataValidation type="whole" sqref="B5:B2"><formula1>1</formula1><formula2>10</formula2></dataValidation>"#,
        r#"<dataValidation type="unsupported" sqref="B2"/>"#,
        r#"<dataValidation type="list" sqref="XFE1"><formula1>"a,b"</formula1></dataValidation>"#,
        r#"<x14:dataValidation xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" type="list"><x14:formula1>"a,b"</x14:formula1></x14:dataValidation>"#,
    ] {
        assert!(
            Spreadsheet::import_xlsx(&with_rule(rule), LIMIT).is_err(),
            "{rule}"
        );
    }
}

#[test]
fn blank_flags_and_error_suppression_survive_roundtrip() {
    for (allow, show, accepted) in [
        (false, true, false),
        (true, true, true),
        (false, false, true),
    ] {
        let bytes = with_rule(&format!(
            r#"<dataValidation type="whole" operator="equal" showErrorMessage="{}" allowBlank="{}" sqref="B2"><formula1>2</formula1></dataValidation>"#,
            u8::from(show),
            u8::from(allow)
        ));
        let mut book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        assert_eq!(book.edit(&[(0, 1, 1, "")], LIMIT).is_ok(), accepted);
        let reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert_eq!(reopened.sheets[0].validations[0].allow_blank, allow);
        assert_eq!(reopened.sheets[0].validations[0].show_error, show);
    }
}

#[test]
fn numeric_text_length_and_custom_rules_use_the_shared_formula_engine() {
    for (kind, operator, first, second, valid, invalid) in [
        ("decimal", "between", "1", "2", "1.5", "3"),
        (
            "date",
            "between",
            "DATE(2026,1,1)",
            "DATE(2026,12,31)",
            "2026-05-20",
            "2027-01-01",
        ),
        (
            "time",
            "lessThan",
            "TIME(12,0,0)",
            "",
            "=TIME(9,0,0)",
            "=TIME(13,0,0)",
        ),
        ("textLength", "equal", "3", "", "yes", "no"),
        (
            "custom",
            "between",
            "AND(B2&gt;0,MOD(B2,2)=0)",
            "",
            "4",
            "3",
        ),
    ] {
        let second = if second.is_empty() {
            String::new()
        } else {
            format!("<formula2>{second}</formula2>")
        };
        let bytes = with_rule(&format!(
            r#"<dataValidation type="{kind}" operator="{operator}" showErrorMessage="1" sqref="B2"><formula1>{first}</formula1>{second}</dataValidation>"#
        ));
        let mut book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        book.edit(&[(0, 1, 1, valid)], LIMIT)
            .unwrap_or_else(|e| panic!("{kind}: {e}"));
        let before = book.to_json();
        assert!(book.edit(&[(0, 1, 1, invalid)], LIMIT).is_err(), "{kind}");
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn unsupported_confirmation_alerts_are_disclosed_without_changing_the_workbook() {
    for style in ["warning", "information"] {
        let bytes = with_rule(&format!(
            r#"<dataValidation type="whole" operator="equal" showErrorMessage="1" errorStyle="{style}" sqref="B2"><formula1>2</formula1></dataValidation>"#
        ));
        let error = match Spreadsheet::import_xlsx(&bytes, LIMIT) {
            Ok(_) => panic!("confirmation rule was silently treated as stop"),
            Err(e) => e,
        };
        assert!(error.contains("confirmation dialog") && error.contains("not imported"));
        let bytes = with_rule(&format!(
            r#"<dataValidation type="whole" operator="equal" showErrorMessage="0" errorStyle="{style}" sqref="B2"><formula1>2</formula1></dataValidation>"#
        ));
        let mut book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        book.edit(&[(0, 1, 1, "3")], LIMIT).unwrap();
        let reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
        assert_eq!(reopened.sheets[0].validations[0].error_style, style);
    }
}

#[test]
fn referenced_lists_and_formula_limits_follow_sheet_renames() {
    let bytes = with_rule(
        r#"<dataValidation type="list" showErrorMessage="1" sqref="C2"><formula1>Instructions!$D$1:$D$2</formula1></dataValidation>"#,
    );
    let mut book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    book.edit(&[(1, 0, 3, "Pending"), (1, 1, 3, "Approved")], LIMIT)
        .unwrap();
    book.edit(&[(0, 1, 2, "approved")], LIMIT).unwrap();
    assert!(book.edit(&[(0, 1, 2, "Released")], LIMIT).is_err());
    book.rename_sheet(1, "Status choices", LIMIT).unwrap();
    assert!(
        book.sheets[0].validations[0]
            .formula
            .as_ref()
            .unwrap()
            .contains("Status choices")
    );
    book.edit(&[(0, 1, 2, "Pending")], LIMIT).unwrap();
}

#[test]
fn relative_limits_rebase_when_the_first_validated_row_is_deleted() {
    let bytes = with_rule(
        r#"<dataValidation type="whole" operator="lessThanOrEqual" showErrorMessage="1" sqref="B2:B4"><formula1>D2</formula1></dataValidation>"#,
    );
    let mut book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    book.edit(&[(0, 2, 3, "5"), (0, 3, 3, "8")], LIMIT).unwrap();
    book.edit(&[(0, 2, 1, "5"), (0, 3, 1, "8")], LIMIT).unwrap();
    assert!(book.edit(&[(0, 2, 1, "6")], LIMIT).is_err());
    book.edit_axis(0, false, 1, -1, LIMIT).unwrap();
    book.edit(&[(0, 1, 1, "5")], LIMIT).unwrap();
    assert!(book.edit(&[(0, 1, 1, "6")], LIMIT).is_err());
}

#[test]
fn prompts_errors_and_disjoint_ranges_are_retained() {
    let bytes = with_rule(
        r#"<dataValidation type="whole" operator="between" showErrorMessage="1" showInputMessage="1" showDropDown="1" allowBlank="1" errorStyle="stop" errorTitle="Quantity &amp; stock" error="Use 1–10_x000A_units" promptTitle="Order" prompt="Choose &quot;units&quot;" sqref="B2 B5:B8"><formula1>1</formula1><formula2>10</formula2></dataValidation>"#,
    );
    let mut book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    let rule = &book.sheets[0].validations[0];
    assert_eq!(rule.error.as_deref(), Some("Use 1–10\nunits"));
    assert_eq!(rule.ranges, vec![[1, 1, 1, 1], [4, 1, 7, 1]]);
    assert!(rule.show_input && rule.show_dropdown && rule.allow_blank);
    assert!(
        book.edit(&[(0, 4, 1, "11")], LIMIT)
            .unwrap_err()
            .contains("Use 1–10\nunits")
    );
    book.edit(&[(0, 3, 1, "11")], LIMIT).unwrap();
    let reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    let a = book.to_json();
    let b = reopened.to_json();
    let mcp_protocol_rust::json::Value::Array(a) = a.get("sheets").unwrap() else {
        panic!()
    };
    let mcp_protocol_rust::json::Value::Array(b) = b.get("sheets").unwrap() else {
        panic!()
    };
    assert_eq!(a[0].get("validations"), b[0].get("validations"));
}

#[test]
fn row_column_changes_retain_rules_and_refuse_to_push_them_off_sheet() {
    let mut book = Spreadsheet::import_xlsx(SOURCE, LIMIT).unwrap();
    book.edit_axis(0, false, 1, 1, LIMIT).unwrap();
    book.edit_axis(0, true, 1, 1, LIMIT).unwrap();
    assert!(book.edit(&[(0, 2, 2, "11")], LIMIT).is_err());
    book.edit(&[(0, 1, 1, "11"), (0, 2, 2, "7")], LIMIT)
        .unwrap();
    let mut reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    assert!(reopened.edit(&[(0, 2, 2, "-2")], LIMIT).is_err());
    reopened.edit_axis(0, false, 2, -1, LIMIT).unwrap();
    assert!(reopened.sheets[0].validations.is_empty());
    for (columns, reference) in [(false, "B1048576"), (true, "XFD2")] {
        let bytes = with_rule(&format!(
            r#"<dataValidation type="whole" operator="equal" showErrorMessage="1" sqref="{reference}"><formula1>2</formula1></dataValidation>"#
        ));
        let mut book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
        let before = book.to_json();
        assert!(book.edit_axis(0, columns, 0, 1, LIMIT).is_err());
        assert_eq!(book.to_json(), before);
    }
}

#[test]
fn typed_input_validates_atomically_while_history_can_restore_existing_values() {
    use safe_bash_rust::commands::spreadsheet::Value;
    let mut book = Spreadsheet::import_xlsx(SOURCE, LIMIT).unwrap();
    let before = book.to_json();
    let mut cell = book.sheets[0].cells[&(1, 1)].clone();
    cell.value = Some(Value::Number(-2.));
    assert!(
        book.replace_validated_cells(vec![(0, 1, 1, Some(cell.clone()))], LIMIT)
            .is_err()
    );
    assert_eq!(book.to_json(), before);
    book.replace_cells(vec![(0, 1, 1, Some(cell))], LIMIT)
        .unwrap();
    assert_eq!(book.input(0, 1, 1), "-2");
    assert_eq!(book.sheets[0].validations.len(), 2);
    let before = book.to_json();
    assert!(book.edit(&[(0, 1, 1, "5")], 1).is_err());
    assert_eq!(book.to_json(), before);
}

#[test]
fn legacy_documents_without_rules_and_invalid_native_rules_are_distinguished() {
    use mcp_protocol_rust::json::Value;
    let book = Spreadsheet::new();
    let saved = book.to_json();
    let Value::Array(sheets) = saved.get("sheets").unwrap() else {
        panic!()
    };
    assert!(sheets[0].get("validations").is_none());
    assert_eq!(
        Spreadsheet::from_json(&saved, LIMIT).unwrap().to_json(),
        saved
    );
    let mut book = Spreadsheet::import_xlsx(SOURCE, LIMIT).unwrap();
    book.sheets[0].validations[0].ranges = vec![[5, 0, 1, 0]];
    assert!(Spreadsheet::from_json(&book.to_json(), LIMIT).is_err());
}

#[test]
fn named_list_renames_keep_validation_bound_to_the_same_definition() {
    use safe_bash_rust::commands::spreadsheet::NamedExpression;
    let bytes = with_rule(
        r#"<dataValidation type="list" showErrorMessage="1" sqref="C2"><formula1>StatusChoices</formula1></dataValidation>"#,
    );
    let mut book = Spreadsheet::import_xlsx(&bytes, LIMIT).unwrap();
    book.edit(&[(1, 0, 3, "Pending"), (1, 1, 3, "Approved")], LIMIT)
        .unwrap();
    let id = book
        .set_named_expression(
            None,
            NamedExpression {
                name: "StatusChoices".into(),
                expression: "Instructions!$D$1:$D$2".into(),
                sheet: None,
                openformula: None,
                position: (0, 0, 0),
                compiled: None,
            },
            LIMIT,
        )
        .unwrap();
    book.edit(&[(0, 1, 2, "Approved")], LIMIT).unwrap();
    let mut name = book.options.names[id].clone();
    name.name = "AllowedStatuses".into();
    book.set_named_expression(Some(id), name, LIMIT).unwrap();
    book.edit(&[(0, 1, 2, "Pending")], LIMIT).unwrap();
    assert!(book.edit(&[(0, 1, 2, "Released")], LIMIT).is_err());
    assert_eq!(
        book.sheets[0].validations[0].formula.as_deref(),
        Some("AllowedStatuses")
    );
    let mut reopened = Spreadsheet::import_xlsx(&book.export_xlsx(LIMIT).unwrap(), LIMIT).unwrap();
    reopened.edit(&[(0, 1, 2, "Approved")], LIMIT).unwrap();
}

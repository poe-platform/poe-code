use super::{Element, Node, Sheet, Workbook, child_mut, elements, set, text};
use crate::commands::{
    archive::office_ods::formula,
    structured::{JVal, parse_json_stream, xlsx::NamedExpression},
};

fn attribute<'a>(node: &'a Element, key: &str) -> Option<&'a str> {
    node.attrs
        .iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.as_str())
}

pub(super) fn read(
    source: &mut [Node],
    sheets: &[Sheet<String>],
    book: &mut Workbook,
    work: &mut usize,
    diagnostics: &mut String,
) -> Result<(), String> {
    use std::fmt::Write;
    let Some(root) = child_mut(source, "workbook") else {
        return Ok(());
    };
    let root_attrs = root.attrs.clone();
    let Some(container) = child_mut(&mut root.children, "definedNames") else {
        return Ok(());
    };
    for mut node in std::mem::take(&mut container.children) {
        let Node::Element(name) = &mut node else {
            continue;
        };
        let Some(imported) = attribute(name, "name").filter(|n| !n.is_empty()) else {
            continue;
        };
        let label = imported
            .strip_prefix("_xlnm.")
            .unwrap_or(imported)
            .to_owned();
        let raw = text(name);
        if imported == "_xlnm.Print_Area" && raw == "!#REF!" {
            continue;
        }
        let sheet = attribute(name, "localSheetId")
            .map(|value| {
                let number = crate::commands::js_number(value, 0.);
                if !number.is_finite() {
                    return Err(format!(
                        "Error: conversion failed: E Invalid XLSX: invalid number '{value}'\n"
                    ));
                }
                if number < 0. || number.fract() != 0. || number > 9_007_199_254_740_991. {
                    return Err(
                        "Error: conversion failed: E Invalid XLSX: invalid nonnegative integer\n"
                            .into(),
                    );
                }
                Ok(number as usize)
            })
            .transpose()?
            .filter(|i| *i < sheets.len());
        let extension = |key| {
            name.attrs.iter().find_map(|(field, value)| {
                let (prefix, local) = field.split_once(':')?;
                if local != key {
                    return None;
                }
                let namespace = [&name.attrs, &container.attrs, &root_attrs]
                    .into_iter()
                    .find_map(|attrs| {
                        attrs
                            .iter()
                            .find(|(key, _)| key.strip_prefix("xmlns:") == Some(prefix))
                            .map(|(_, value)| value.as_str())
                    });
                (namespace == Some("urn:poe-code:ssconvert:formulas:1")).then_some(value.as_str())
            })
        };
        let array_strings = extension("array-string-literals");
        let raw = super::super::xlsx_string::decode(&raw);
        let expression = if raw.is_empty() {
            "#REF!".into()
        } else if let Some(value) =
            formula::xlsx_name(&raw, array_strings == Some("1"), work).map_err(str::to_owned)?
        {
            value
        } else {
            writeln!(diagnostics, "At A1: '{raw}' Invalid expression").unwrap();
            continue;
        };
        if array_strings.is_some_and(|v| !matches!(v, "0" | "1")) {
            return Err("Invalid ssconvert formula array string semantics\n".into());
        }
        let array_strings = array_strings == Some("1");
        let openformula = extension("openformula").map(str::to_owned);
        let mut position = (sheet.unwrap_or(0), 0, 0);
        let mut origin = None;
        if let Some(source) = &openformula {
            if !source.starts_with("of:=") {
                return Err("Invalid ssconvert OpenFormula expression\n".into());
            }
            if let Some(anchor) = extension("openformula-origin") {
                let error = "Invalid ssconvert OpenFormula origin\n";
                let values = parse_json_stream(anchor).map_err(|_| error)?;
                let [JVal::Array(values)] = values.as_slice() else {
                    return Err(error.into());
                };
                let [
                    JVal::Str(sheet),
                    JVal::Number(row, _),
                    JVal::Number(column, _),
                ] = values.as_slice()
                else {
                    return Err(error.into());
                };
                if sheet.is_empty()
                    || [row, column].into_iter().any(|n| {
                        !n.is_finite() || *n < 0. || n.fract() != 0. || *n > 9_007_199_254_740_991.
                    })
                {
                    return Err(error.into());
                }
                let sheet_index = sheets
                    .iter()
                    .position(|s| s.name == *sheet)
                    .ok_or("Invalid named expression position\n")?;
                position = (sheet_index, *row as i64, *column as i64);
                origin = Some(format!(
                    "[{},{},{}]",
                    JVal::Str(sheet.clone()).to_json_string(true, false, 0),
                    position.1,
                    position.2
                ));
            }
        }
        let index = book
            .names
            .iter()
            .position(|n| n.name == label && n.sheet == sheet)
            .unwrap_or(book.names.len());
        let record = NamedExpression {
            name: label.clone(),
            sheet,
            expression,
            openformula: openformula.clone(),
            position,
            compiled: None,
        };
        if index == book.names.len() {
            book.names.push(record);
        } else {
            book.names[index] = record;
        }
        if array_strings {
            book.array_string_names.insert(index);
        } else {
            book.array_string_names.remove(&index);
        }
        // Keep only the recognized metadata for restoring the original extension
        // after export normalizes the fallback expression.
        name.attrs = vec![("name".into(), label)];
        if let Some(sheet) = sheet {
            set(name, "localSheetId", sheet.to_string());
        }
        if array_strings || openformula.is_some() {
            set(
                name,
                "xmlns:ssc",
                "urn:poe-code:ssconvert:formulas:1".into(),
            );
            if array_strings {
                set(name, "ssc:array-string-literals", "1".into());
            }
            if let Some(source) = openformula {
                set(name, "ssc:openformula", source);
            }
            if let Some(origin) = origin {
                set(name, "ssc:openformula-origin", origin);
            }
            set(
                name,
                "xmlns:mc",
                "http://schemas.openxmlformats.org/markup-compatibility/2006".into(),
            );
            set(name, "mc:Ignorable", "ssc".into());
        }
        container.children.push(node);
    }
    Ok(())
}

pub(super) fn restore(source: &[Node], target: &mut [Node]) {
    let containers = elements(source, "definedNames");
    let originals = containers
        .first()
        .map(|n| elements(&n.children, "definedName"))
        .unwrap_or_default();
    let Some(container) = child_mut(target, "definedNames") else {
        return;
    };
    for node in &mut container.children {
        let Node::Element(node) = node else { continue };
        let Some(name) = attribute(node, "name") else {
            continue;
        };
        let label = match name {
            "_xlnm.Print_Area" => "Print_Area",
            "_xlnm.Sheet_Title" => "Sheet_Title",
            _ => name,
        };
        if let Some(original) = originals.iter().rev().find(|n| {
            attribute(n, "name") == Some(label)
                && attribute(n, "localSheetId") == attribute(node, "localSheetId")
        }) {
            node.attrs.retain(|(name, _)| !name.contains(':'));
            node.attrs.extend(
                original
                    .attrs
                    .iter()
                    .filter(|(name, _)| name.contains(':'))
                    .cloned(),
            );
        }
    }
}

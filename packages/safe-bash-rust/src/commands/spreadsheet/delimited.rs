//! Shared Poe Code office delimited-text parser.
pub fn delimited(source: &str, separator: char) -> Result<Vec<Vec<String>>, &'static str> {
    let mut input = source
        .strip_prefix('\u{feff}')
        .unwrap_or(source)
        .chars()
        .peekable();
    let (mut rows, mut row, mut field) = (Vec::new(), Vec::new(), String::new());
    let mut quoted = false;
    let mut active = false;
    while let Some(c) = input.next() {
        active = true;
        if c == '"' {
            if quoted && input.next_if_eq(&'"').is_some() {
                field.push('"');
            } else if quoted || field.is_empty() {
                quoted = !quoted;
            } else {
                field.push(c);
            }
        } else if !quoted && c == separator {
            row.push(std::mem::take(&mut field));
        } else if !quoted && matches!(c, '\r' | '\n') {
            if c == '\r' {
                input.next_if_eq(&'\n');
            }
            row.push(std::mem::take(&mut field));
            rows.push(std::mem::take(&mut row));
            active = false;
        } else {
            field.push(c);
        }
    }
    if quoted {
        return Err("Error: conversion failed: Invalid CSV: unterminated quoted field\n");
    }
    if active {
        row.push(field);
        rows.push(row);
    }
    Ok(rows)
}

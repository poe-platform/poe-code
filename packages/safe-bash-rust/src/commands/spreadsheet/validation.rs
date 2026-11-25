//! Worksheet input rules survive native saves and Excel round trips.
use super::{Spreadsheet, model, xml_attribute as attr, xml_elements as elements, xml_text};
use crate::commands::structured::xml;
use std::fmt::Write;

#[derive(Clone)]
pub struct DataValidation {
    /// Inclusive zero-based rectangles, in the source's order.
    pub ranges: Vec<[usize; 4]>,
    pub kind: String,
    pub operator: String,
    pub allow_blank: bool,
    pub show_error: bool,
    pub show_input: bool,
    pub show_dropdown: bool,
    pub error_style: String,
    pub ime_mode: String,
    pub error_title: Option<String>,
    pub error: Option<String>,
    pub prompt_title: Option<String>,
    pub prompt: Option<String>,
    pub formula: Option<String>,
    pub formula2: Option<String>,
}

impl DataValidation {
    pub(super) fn valid(&self) -> bool {
        !self.ranges.is_empty()
            && self
                .ranges
                .iter()
                .all(|&[r, c, b, d]| r <= b && c <= d && b < 1_048_576 && d < 16_384)
            && matches!(
                self.kind.as_str(),
                "none" | "whole" | "decimal" | "list" | "date" | "time" | "textLength" | "custom"
            )
            && matches!(
                self.operator.as_str(),
                "between"
                    | "notBetween"
                    | "equal"
                    | "notEqual"
                    | "lessThan"
                    | "lessThanOrEqual"
                    | "greaterThan"
                    | "greaterThanOrEqual"
            )
            && matches!(
                self.error_style.as_str(),
                "stop" | "warning" | "information"
            )
            && (!self.show_error || self.error_style == "stop")
            && matches!(
                self.ime_mode.as_str(),
                "noControl"
                    | "off"
                    | "on"
                    | "disabled"
                    | "hiragana"
                    | "fullKatakana"
                    | "halfKatakana"
                    | "fullAlpha"
                    | "halfAlpha"
                    | "fullHangul"
                    | "halfHangul"
            )
            && (self.kind == "none" || self.formula.as_ref().is_some_and(|s| !s.trim().is_empty()))
            && (matches!(self.kind.as_str(), "none" | "list" | "custom")
                || !matches!(self.operator.as_str(), "between" | "notBetween")
                || self.formula2.as_ref().is_some_and(|s| !s.trim().is_empty()))
    }
    pub(super) fn covers(&self, row: usize, column: usize) -> bool {
        self.ranges
            .iter()
            .any(|&[r, c, b, d]| (r..=b).contains(&row) && (c..=d).contains(&column))
    }
}

pub(super) fn read(nodes: &[xml::Node], work: &mut usize) -> Result<Vec<DataValidation>, String> {
    let mut rules = Vec::new();
    for el in elements(nodes, "dataValidation") {
        // Extended x14 rules use a different formula/sqref representation.
        // Refuse those explicitly until they can be preserved and evaluated.
        let reference =
            attr(el, "sqref").ok_or("Unsupported extended Excel input-validation rule")?;
        *work = work
            .checked_sub(reference.len().saturating_mul(32).saturating_add(512))
            .ok_or("Input validation exceeds its limit")?;
        let mut ranges = Vec::new();
        for source in reference.split_whitespace() {
            let (a, b) = source.split_once(':').unwrap_or((source, source));
            let (r, c) = super::coordinate(a).ok_or("Invalid input-validation range")?;
            let (b, d) = super::coordinate(b).ok_or("Invalid input-validation range")?;
            ranges.push([r, c, b, d]);
        }
        let flag = |name| match attr(el, name) {
            None | Some("0" | "false") => Ok(false),
            Some("1" | "true") => Ok(true),
            _ => Err("Invalid input-validation flag"),
        };
        let mut property = |name| -> Result<Option<String>, String> {
            attr(el, name)
                .map(|s| {
                    *work = work
                        .checked_sub(s.len().saturating_mul(4).saturating_add(32))
                        .ok_or("Input validation exceeds its limit")?;
                    Ok(super::xlsx_string::decode(s))
                })
                .transpose()
        };
        let mut rule = DataValidation {
            ranges,
            kind: attr(el, "type").unwrap_or("none").into(),
            operator: attr(el, "operator").unwrap_or("between").into(),
            allow_blank: flag("allowBlank")?,
            show_error: flag("showErrorMessage")?,
            show_input: flag("showInputMessage")?,
            show_dropdown: flag("showDropDown")?,
            error_style: attr(el, "errorStyle").unwrap_or("stop").into(),
            ime_mode: attr(el, "imeMode").unwrap_or("noControl").into(),
            error_title: property("errorTitle")?,
            error: property("error")?,
            prompt_title: property("promptTitle")?,
            prompt: property("prompt")?,
            formula: None,
            formula2: None,
        };
        for (name, dest) in [
            ("formula1", &mut rule.formula),
            ("formula2", &mut rule.formula2),
        ] {
            let values = elements(&el.children, name);
            if values.len() > 1 {
                return Err("Duplicate input-validation formula".into());
            }
            if let Some(value) = values.first() {
                let text = xml_text(value);
                *work = work
                    .checked_sub(text.len().saturating_mul(4).saturating_add(32))
                    .ok_or("Input validation exceeds its limit")?;
                *dest = Some(super::xlsx_string::decode(&text));
            }
        }
        if rule.show_error && rule.error_style != "stop" {
            return Err("Excel warning/information input rules require a confirmation dialog that is not supported yet; this workbook was not imported".into());
        }
        if !rule.valid() {
            return Err("Invalid Excel input-validation rule".into());
        }
        rules.push(rule);
    }
    Ok(rules)
}

pub(super) fn write(rules: &[DataValidation], work: &mut usize) -> Option<String> {
    if rules.is_empty() {
        return Some(String::new());
    }
    let mut xml = format!("<dataValidations count=\"{}\">", rules.len());
    for rule in rules {
        if !rule.valid() {
            return None;
        }
        let start = xml.len();
        write!(xml, "<dataValidation type=\"{}\" operator=\"{}\" allowBlank=\"{}\" showErrorMessage=\"{}\" showInputMessage=\"{}\" showDropDown=\"{}\" errorStyle=\"{}\" imeMode=\"{}\" sqref=\"",
            rule.kind, rule.operator, u8::from(rule.allow_blank), u8::from(rule.show_error),
            u8::from(rule.show_input), u8::from(rule.show_dropdown), rule.error_style, rule.ime_mode).ok()?;
        for (i, &[r, c, b, d]) in rule.ranges.iter().enumerate() {
            if i != 0 {
                xml.push(' ');
            }
            write!(
                xml,
                "{}{}",
                crate::commands::structured::xlsx_idx_to_col_ref(c),
                r + 1
            )
            .ok()?;
            if (r, c) != (b, d) {
                write!(
                    xml,
                    ":{}{}",
                    crate::commands::structured::xlsx_idx_to_col_ref(d),
                    b + 1
                )
                .ok()?;
            }
        }
        xml.push('"');
        for (name, value) in [
            ("errorTitle", &rule.error_title),
            ("error", &rule.error),
            ("promptTitle", &rule.prompt_title),
            ("prompt", &rule.prompt),
        ] {
            if let Some(value) = value {
                let value = model::escaped(value)
                    .replace('\n', "&#10;")
                    .replace('\t', "&#9;");
                write!(xml, " {name}=\"{value}\"").ok()?;
            }
        }
        xml.push('>');
        for (name, value) in [("formula1", &rule.formula), ("formula2", &rule.formula2)] {
            if let Some(value) = value {
                write!(xml, "<{name}>{}</{name}>", model::escaped(value)).ok()?;
            }
        }
        xml.push_str("</dataValidation>");
        *work = work.checked_sub(xml.len() - start)?;
    }
    xml.push_str("</dataValidations>");
    Some(xml)
}

impl Spreadsheet {
    /// User input/paste checks rules atomically. History and remote replay use
    /// replace_cells so previously stored values remain recoverable.
    pub fn replace_validated_cells(
        &mut self,
        edits: Vec<(usize, usize, usize, Option<model::TypedCell<String>>)>,
        limit: usize,
    ) -> Result<(), String> {
        let affected = edits.iter().any(|(s, r, c, _)| {
            self.sheets.get(*s).is_some_and(|sheet| {
                sheet
                    .validations
                    .iter()
                    .any(|rule| rule.show_error && rule.kind != "none" && rule.covers(*r, *c))
            })
        });
        if !affected {
            return self.replace_cells(edits, limit);
        }
        let positions: Vec<_> = edits.iter().map(|&(s, r, c, _)| (s, r, c)).collect();
        let mut next = Self::from_json(&self.to_json(), limit / 3)?;
        next.replace_cells(edits, limit / 3)?;
        super::formulas::validation::check(&next, &positions, limit / 3)?;
        *self = next;
        Ok(())
    }
}

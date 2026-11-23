//! Poe Code spreadsheet calculation and editable workbook API.
// Preserve upstream numerical coefficients and regression literals verbatim.
#![allow(clippy::excessive_precision)]
#[path = "spreadsheet/delimited.rs"]
mod delimited;
pub use delimited::delimited as parse_delimited;
#[path = "spreadsheet/office_ods_case_fold.rs"]
mod case_fold;
pub use case_fold::sheet_key as sheet_name_key;
#[path = "spreadsheet/office_collation.rs"]
mod collation;
#[path = "spreadsheet/office_csv.rs"]
mod csv;
#[path = "spreadsheet/office_dates.rs"]
mod dates;
#[path = "spreadsheet/office_formula_arguments.rs"]
mod formula_arguments;
#[path = "spreadsheet/office_formulas.rs"]
mod formulas;
pub use formulas::{TableReferenceMap, map_table_references, table_to_range_references};
#[path = "spreadsheet/office_function_names.rs"]
mod function_names;
#[path = "spreadsheet/xlsx.rs"]
mod model;
#[cfg(test)]
#[path = "spreadsheet/office_name_order.rs"]
mod name_order;
#[path = "spreadsheet/office_number_format.rs"]
mod number_format;
#[path = "spreadsheet/office_ods_formula.rs"]
mod ods_formula;
#[path = "spreadsheet/office_xml.rs"]
mod office_xml;
#[path = "spreadsheet/office_formula_sheet_name.rs"]
mod sheet_name;
#[path = "spreadsheet/office_xlsx_value_metadata.rs"]
mod value_metadata;
#[path = "spreadsheet/office_xlsx.rs"]
mod xlsx_import;
#[path = "spreadsheet/office_xlsx_references.rs"]
mod xlsx_references;
pub use xlsx_references::{
    GridReference, GridReferenceKind, map_grid_references, map_sheet_references, parse_cell_ranges,
};
#[path = "spreadsheet/office_xlsx_string.rs"]
mod xlsx_string;
pub(super) fn coordinate(reference: &str) -> Option<(usize, usize)> {
    let reference = reference.strip_prefix('$').unwrap_or(reference);
    let letters = reference
        .bytes()
        .take_while(u8::is_ascii_alphabetic)
        .count();
    let column = reference[..letters].bytes().try_fold(0usize, |n, b| {
        n.checked_mul(26)?
            .checked_add(usize::from(b.to_ascii_uppercase() - b'A' + 1))
    })?;
    let row = reference[letters..]
        .strip_prefix('$')
        .unwrap_or(&reference[letters..])
        .parse::<usize>()
        .ok()?;
    ((1..=1_048_576).contains(&row) && (1..=16_384).contains(&column))
        .then(|| (row - 1, column - 1))
}

pub(super) fn valid_sheet_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('\'')
        && !name.ends_with('\'')
        && !name.contains(['\\', '/', ':', '?', '*', '[', ']'])
}
fn decimal(source: &str) -> Option<f64> {
    let mut chars = source.bytes().peekable();
    if chars.peek().is_some_and(|b| matches!(b, b'+' | b'-')) {
        chars.next();
    }
    let mut digits = 0;
    while chars.peek().is_some_and(u8::is_ascii_digit) {
        chars.next();
        digits += 1;
    }
    if chars.next_if_eq(&b'.').is_some() {
        while chars.peek().is_some_and(u8::is_ascii_digit) {
            chars.next();
            digits += 1;
        }
    }
    if digits == 0 {
        return None;
    }
    if chars.peek().is_some_and(|b| matches!(b, b'e' | b'E')) {
        chars.next();
        if chars.peek().is_some_and(|b| matches!(b, b'+' | b'-')) {
            chars.next();
        }
        digits = 0;
        while chars.peek().is_some_and(u8::is_ascii_digit) {
            chars.next();
            digits += 1;
        }
        if digits == 0 {
            return None;
        }
    }
    if chars.next().is_some() {
        return None;
    }
    source.parse::<f64>().ok().filter(|n| n.is_finite())
}

fn date_serial(source: &str) -> Option<i64> {
    if source.len() != 10
        || !source.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 4 | 7) {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
    {
        return None;
    }
    let year = source[..4].parse::<i64>().ok()?;
    let month = source[5..7].parse::<i64>().ok()?;
    let day = source[8..].parse::<i64>().ok()?;
    if year < 1900 || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let days = crate::commands::coreutils::days_from_civil(year, month, day);
    if crate::commands::coreutils::civil_from_days(days) != (year, month as u32, day as u32) {
        return None;
    }
    Some(
        days - crate::commands::coreutils::days_from_civil(1899, 12, 31)
            + i64::from(source >= "1900-03-01"),
    )
}

fn xml_elements<'a>(
    nodes: &'a [crate::commands::structured::xml::Node],
    name: &str,
) -> Vec<&'a crate::commands::structured::xml::Element> {
    use crate::commands::structured::xml::Node;
    let mut result = Vec::new();
    let mut pending: Vec<_> = nodes.iter().rev().collect();
    while let Some(node) = pending.pop() {
        if let Node::Element(el) = node {
            if el.tag.rsplit(':').next() == Some(name) {
                result.push(el);
            }
            pending.extend(el.children.iter().rev());
        }
    }
    result
}

fn xml_attribute<'a>(
    el: &'a crate::commands::structured::xml::Element,
    name: &str,
) -> Option<&'a str> {
    el.attrs
        .iter()
        .find(|(key, _)| key.rsplit(':').next() == Some(name))
        .map(|(_, v)| v.as_str())
}

fn xml_text(el: &crate::commands::structured::xml::Element) -> String {
    use crate::commands::structured::xml::Node;
    let mut text = String::new();
    let mut pending: Vec<_> = el.children.iter().rev().collect();
    while let Some(node) = pending.pop() {
        match node {
            Node::Text(t, _) | Node::Cdata(t) => text.push_str(t),
            Node::Element(e) => pending.extend(e.children.iter().rev()),
            _ => {}
        }
    }
    text
}

pub(super) use xlsx_import::number_token;
fn xml_escape_text(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

const SOURCE_LOAD_ERROR: &str = "Error: source file could not be loaded\n";
const LIMIT: &str = "document exceeds byte limit";

#[path = "spreadsheet/editor.rs"]
mod editor;
pub use editor::Spreadsheet;
#[path = "spreadsheet/editor_calculated.rs"]
mod editor_calculated;
#[path = "spreadsheet/editor_filter.rs"]
mod editor_filter;
#[path = "spreadsheet/editor_merge.rs"]
mod editor_merge;
#[path = "spreadsheet/editor_sheets.rs"]
mod editor_sheets;
#[path = "spreadsheet/editor_size.rs"]
mod editor_size;
#[path = "spreadsheet/editor_sort.rs"]
mod editor_sort;
#[path = "spreadsheet/editor_structure.rs"]
mod editor_structure;
#[path = "spreadsheet/editor_tables.rs"]
mod editor_tables;
#[path = "spreadsheet/office_wildcard.rs"]
mod wildcard;
pub use model::{
    ArrayFormula, Axis, CalculatedColumn, Filter, FilterField, NamedExpression, Sheet, Style,
    Table, TopFilter, TypedCell, Value, Workbook as WorkbookOptions,
};

#[path = "spreadsheet/json.rs"]
mod json;

#[cfg(test)]
#[path = "spreadsheet/editor_calculated_tests.rs"]
mod editor_calculated_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_merge_tests.rs"]
mod editor_merge_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_tests.rs"]
mod editor_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_spill_tests.rs"]
mod editor_spill_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_text_tests.rs"]
mod editor_text_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_workday_tests.rs"]
mod editor_workday_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_array_tests.rs"]
mod editor_array_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_text_split_tests.rs"]
mod editor_text_split_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_cashflow_tests.rs"]
mod editor_cashflow_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_depreciation_tests.rs"]
mod editor_depreciation_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_finance_tests.rs"]
mod editor_finance_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_structure_tests.rs"]
mod editor_structure_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_matrix_tests.rs"]
mod editor_matrix_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_let_tests.rs"]
mod editor_let_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_lambda_tests.rs"]
mod editor_lambda_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_higher_order_tests.rs"]
mod editor_higher_order_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_basis_tests.rs"]
mod editor_basis_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_size_tests.rs"]
mod editor_size_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_expand_tests.rs"]
mod editor_expand_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_logical_tests.rs"]
mod editor_logical_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_reshape_tests.rs"]
mod editor_reshape_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_text_format_tests.rs"]
mod editor_text_format_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_date_text_tests.rs"]
mod editor_date_text_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_datedif_tests.rs"]
mod editor_datedif_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_yearfrac_tests.rs"]
mod editor_yearfrac_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_day_count_tests.rs"]
mod editor_day_count_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_clock_tests.rs"]
mod editor_clock_tests;

#[cfg(test)]
mod editor_calendar_tests;

#[cfg(test)]
mod editor_cell_tests;

#[cfg(test)]
mod editor_gamma_tests;

#[cfg(test)]
mod editor_month_shift_tests;

#[cfg(test)]
mod editor_bit_tests;

#[cfg(test)]
mod editor_formula_entry_tests;

#[cfg(test)]
mod editor_bond_tests;

#[cfg(test)]
mod editor_accrint_tests;
#[cfg(test)]
mod editor_descriptive_tests;
#[cfg(test)]
mod editor_fisher_tests;
#[cfg(test)]
mod editor_legacy_formula_tests;
#[cfg(test)]
mod editor_lifetime_tests;
#[cfg(test)]
mod editor_multinomial_tests;
#[cfg(test)]
mod editor_normal_tests;
#[cfg(test)]
mod editor_odd_bond_tests;
#[cfg(test)]
mod editor_order_statistics_tests;
#[cfg(test)]
mod editor_paired_statistics_tests;
#[cfg(test)]
mod editor_percentof_tests;
#[cfg(test)]
mod editor_regression_tests;
#[cfg(test)]
mod editor_security_tests;
#[cfg(test)]
mod editor_series_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_regex_tests.rs"]
mod editor_regex_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_binomial_tests.rs"]
mod editor_binomial_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_chisquare_tests.rs"]
mod editor_chisquare_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_beta_tests.rs"]
mod editor_beta_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_f_distribution_tests.rs"]
mod editor_f_distribution_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_number_text_tests.rs"]
mod editor_number_text_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_t_distribution_tests.rs"]
mod editor_t_distribution_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_inference_tests.rs"]
mod editor_inference_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_integer_math_tests.rs"]
mod editor_integer_math_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_encodeurl_tests.rs"]
mod editor_encodeurl_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_error_tests.rs"]
mod editor_error_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_search_tests.rs"]
mod editor_search_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_character_tests.rs"]
mod editor_character_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_intersection_tests.rs"]
mod editor_intersection_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_formulatext_tests.rs"]
mod editor_formulatext_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_numeric_coercion_tests.rs"]
mod editor_numeric_coercion_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_textjoin_tests.rs"]
mod editor_textjoin_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_complex_tests.rs"]
mod editor_complex_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_address_tests.rs"]
mod editor_address_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_step_tests.rs"]
mod editor_step_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_bessel_tests.rs"]
mod editor_bessel_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_randarray_tests.rs"]
mod editor_randarray_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_lookup_validation_tests.rs"]
mod editor_lookup_validation_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_boolean_reduce_tests.rs"]
mod editor_boolean_reduce_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_choose_tests.rs"]
mod editor_choose_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_to_text_tests.rs"]
mod editor_to_text_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_modern_lookup_tests.rs"]
mod editor_modern_lookup_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_width_tests.rs"]
mod editor_width_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_sign_tests.rs"]
mod editor_sign_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_sparse_aggregate_tests.rs"]
mod editor_sparse_aggregate_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_freeze_tests.rs"]
mod editor_freeze_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_probability_tests.rs"]
mod editor_probability_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_scale_univer_tests.rs"]
mod editor_scale_univer_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_average_tests.rs"]
mod editor_average_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_conditional_tests.rs"]
mod editor_conditional_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_extended_conditional_tests.rs"]
mod editor_extended_conditional_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_icon_tests.rs"]
mod editor_icon_tests;
#[cfg(test)]
#[path = "spreadsheet/editor_scale_tests.rs"]
mod editor_scale_tests;

#[path = "spreadsheet/conditional.rs"]
mod conditional;
#[path = "spreadsheet/conditional_xlsx.rs"]
mod conditional_xlsx;
pub use conditional::{
    ColorScaleThreshold, ConditionalAppearance, ConditionalFormat, ConditionalIcon,
    ConditionalRule, ConditionalValue, DataBar, DataBarAppearance, IconAppearance, IconSet,
    IconThreshold, TextOperator, ValueOperator, icon_set_size,
};

#[cfg(test)]
#[path = "spreadsheet/editor_data_bar_tests.rs"]
mod editor_data_bar_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_data_bar_univer_tests.rs"]
mod editor_data_bar_univer_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_color_tests.rs"]
mod editor_color_tests;

#[path = "spreadsheet/office_colors.rs"]
mod colors;

#[cfg(test)]
#[path = "spreadsheet/editor_current_time_tests.rs"]
mod editor_current_time_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_relationship_tests.rs"]
mod editor_relationship_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_erf_tests.rs"]
mod editor_erf_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_convert_tests.rs"]
mod editor_convert_tests;

#[cfg(test)]
#[path = "spreadsheet/editor_database_tests.rs"]
mod editor_database_tests;

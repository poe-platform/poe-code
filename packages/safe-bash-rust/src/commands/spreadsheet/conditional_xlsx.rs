//! SpreadsheetML conditional rules. Differential styles are stored separately.
use super::{
    ColorScaleThreshold, ConditionalFormat, ConditionalIcon, ConditionalRule, ConditionalValue,
    DataBar, IconSet, IconThreshold, Style, TextOperator, ValueOperator,
    formula_arguments::{self, Syntax},
    model, xml_attribute as attr, xml_elements as elements, xml_escape_text as escaped,
    xml_text as text,
};
use crate::commands::structured::{xlsx_idx_to_col_ref, xml};
use std::fmt::Write;

fn literal(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
fn read_literal(source: &str) -> Option<String> {
    let source = source.strip_prefix('"')?.strip_suffix('"')?;
    let mut out = String::new();
    let mut chars = source.chars();
    while let Some(c) = chars.next() {
        if c == '"' && chars.next() != Some('"') {
            return None;
        }
        out.push(c);
    }
    Some(out)
}
fn operator_name(operator: ValueOperator) -> &'static str {
    use ValueOperator::*;
    match operator {
        Equal => "equal",
        NotEqual => "notEqual",
        GreaterThan => "greaterThan",
        GreaterThanOrEqual => "greaterThanOrEqual",
        LessThan => "lessThan",
        LessThanOrEqual => "lessThanOrEqual",
        Between => "between",
        NotBetween => "notBetween",
    }
}
fn operator(value: &str) -> Option<ValueOperator> {
    use ValueOperator::*;
    Some(match value {
        "equal" => Equal,
        "notEqual" => NotEqual,
        "greaterThan" => GreaterThan,
        "greaterThanOrEqual" => GreaterThanOrEqual,
        "lessThan" => LessThan,
        "lessThanOrEqual" => LessThanOrEqual,
        "between" => Between,
        "notBetween" => NotBetween,
        _ => return None,
    })
}

fn formula(
    source: &str,
    workbook: &model::Workbook,
    sheets: &[(String, String)],
    sheet: usize,
    work: &mut usize,
) -> Option<String> {
    let source = source.trim().strip_prefix('=').unwrap_or(source.trim());
    let source = super::xlsx_import::formula_tokens(
        source,
        &workbook.names,
        sheets,
        (Some(sheet), Some(sheet)),
        (0, 0),
        Syntax::EditorXlsx,
        work,
    )?
    .text;
    let source = super::formulas::xlsx_variables(&source, work)?;
    Some(source.into_owned())
}

fn threshold_xml(
    value: &ConditionalValue,
    rule: &ConditionalFormat,
    workbook: &model::Workbook,
    sheets: &[(String, String)],
    extended: bool,
    work: &mut usize,
) -> Option<String> {
    let (kind, value) = match value {
        ConditionalValue::Min => ("min", None),
        ConditionalValue::Max => ("max", None),
        ConditionalValue::Number(n) => ("num", Some(n.to_string())),
        ConditionalValue::Percent(n) => ("percent", Some(n.to_string())),
        ConditionalValue::Percentile(n) => ("percentile", Some(n.to_string())),
        ConditionalValue::Formula(source) => (
            "formula",
            Some(formula(source, workbook, sheets, rule.sheet, work)?),
        ),
    };
    *work = work.checked_sub(128 + value.as_ref().map_or(0, |s| s.len().saturating_mul(6)))?;
    Some(if extended {
        if let Some(value) = value {
            format!(
                "<x14:cfvo type=\"{kind}\"><xm:f>{}</xm:f></x14:cfvo>",
                escaped(&value)
            )
        } else {
            format!("<x14:cfvo type=\"{kind}\"/>")
        }
    } else {
        if let Some(value) = value {
            let value = escaped(&value)
                .replace('\t', "&#9;")
                .replace('\n', "&#10;")
                .replace('\r', "&#13;");
            format!("<cfvo type=\"{kind}\" val=\"{value}\"/>")
        } else {
            format!("<cfvo type=\"{kind}\"/>")
        }
    })
}

fn icon_details(
    set: &IconSet,
    rule: &ConditionalFormat,
    workbook: &model::Workbook,
    sheets: &[(String, String)],
    extended: bool,
    work: &mut usize,
) -> Option<String> {
    let prefix = if extended { "x14:" } else { "" };
    let mut out = format!(
        r#"<{prefix}iconSet iconSet="{}" showValue="{}" reverse="{}"{}>"#,
        escaped(&set.name),
        usize::from(set.show_value),
        usize::from(set.reverse),
        if extended {
            format!(" custom=\"{}\"", usize::from(!set.custom.is_empty()))
        } else {
            String::new()
        }
    );
    for threshold in &set.thresholds {
        let value = threshold_xml(&threshold.value, rule, workbook, sheets, extended, work)?;
        out.push_str(&value.replacen(
            "cfvo ",
            &format!("cfvo gte=\"{}\" ", usize::from(threshold.greater_equal)),
            1,
        ));
    }
    for icon in &set.custom {
        write!(
            out,
            r#"<x14:cfIcon iconSet="{}" iconId="{}"/>"#,
            escaped(&icon.set),
            icon.index
        )
        .ok()?;
    }
    write!(out, "</{prefix}iconSet>").ok()?;
    *work = work.checked_sub(out.len())?;
    Some(out)
}
fn read_icons(node: &xml::Element, work: &mut usize) -> Result<ConditionalRule, String> {
    let name = attr(node, "iconSet")
        .unwrap_or("3TrafficLights1")
        .to_owned();
    *work = work
        .checked_sub(128 + name.len())
        .ok_or("Conditional formatting exceeds its limit")?;
    let mut thresholds = Vec::new();
    for value in children(&node.children, "cfvo") {
        thresholds.push(IconThreshold {
            value: read_threshold(value, work)?,
            greater_equal: boolean(value, "gte", true)?,
        });
    }
    let custom_enabled = boolean(node, "custom", false)?;
    let mut custom = Vec::new();
    for icon in children(&node.children, "cfIcon") {
        if !custom_enabled {
            return Err("Custom conditional icons require the custom flag".into());
        }
        let set = attr(icon, "iconSet")
            .ok_or("Missing conditional icon name")?
            .to_owned();
        *work = work
            .checked_sub(64 + set.len())
            .ok_or("Conditional formatting exceeds its limit")?;
        let index = attr(icon, "iconId")
            .and_then(|s| s.trim().parse().ok())
            .ok_or("Invalid conditional icon index")?;
        custom.push(ConditionalIcon { set, index });
    }
    if custom_enabled && custom.is_empty() {
        return Err("Missing custom conditional icons".into());
    }
    Ok(ConditionalRule::IconSet(IconSet {
        name,
        thresholds,
        custom,
        reverse: boolean(node, "reverse", false)?,
        show_value: boolean(node, "showValue", true)?,
    }))
}

pub(super) fn write(
    rule: &ConditionalFormat,
    id: usize,
    workbook: &model::Workbook,
    sheets: &[(String, String)],
    extensions: &mut String,
    work: &mut usize,
) -> Option<String> {
    *work = work.checked_sub(rule.ranges.len().checked_mul(128)?.checked_add(512)?)?;
    if let ConditionalRule::IconSet(set) = &rule.rule {
        if !set.custom.is_empty() || matches!(set.name.as_str(), "3Stars" | "3Triangles" | "5Boxes")
        {
            let mut ext = format!(
                r#"<x14:conditionalFormatting xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:cfRule type="iconSet" priority="{}" stopIfTrue="{}" id="{{00000000-0000-0000-0000-{:012X}}}">"#,
                rule.priority,
                usize::from(rule.stop_if_true),
                id + 1
            );
            ext.push_str(&icon_details(set, rule, workbook, sheets, true, work)?);
            ext.push_str("</x14:cfRule><xm:sqref>");
            for (i, &[top, left, bottom, right]) in rule.ranges.iter().enumerate() {
                if i > 0 {
                    ext.push(' ');
                }
                write!(
                    ext,
                    "{}{}:{}{}",
                    xlsx_idx_to_col_ref(left),
                    top + 1,
                    xlsx_idx_to_col_ref(right),
                    bottom + 1
                )
                .ok()?;
            }
            ext.push_str("</xm:sqref></x14:conditionalFormatting>");
            *work = work.checked_sub(ext.len())?;
            extensions.push_str(&ext);
            return Some(String::new());
        }
    }
    let (r, c) = rule.anchor()?;
    let cell = format!("{}{}", xlsx_idx_to_col_ref(c), r + 1);
    let mut formulas = Vec::new();
    let mut details = String::new();
    let attrs = match &rule.rule {
        ConditionalRule::TimePeriod { period } => {
            let (start, end) = match period.as_str() {
                "yesterday" => ("TODAY()-1".into(), "TODAY()".into()),
                "today" => ("TODAY()".into(), "TODAY()+1".into()),
                "tomorrow" => ("TODAY()+1".into(), "TODAY()+2".into()),
                "last7Days" => ("TODAY()-6".into(), "TODAY()+1".into()),
                "lastWeek" | "thisWeek" | "nextWeek" => {
                    let offset = match period.as_str() {
                        "lastWeek" => -6,
                        "nextWeek" => 8,
                        _ => 1,
                    };
                    (
                        format!("TODAY()-WEEKDAY(TODAY())+({offset})"),
                        format!("TODAY()-WEEKDAY(TODAY())+({})", offset + 7),
                    )
                }
                "lastMonth" | "thisMonth" | "nextMonth" => {
                    let offset = match period.as_str() {
                        "lastMonth" => -1,
                        "nextMonth" => 1,
                        _ => 0,
                    };
                    (
                        format!("DATE(YEAR(TODAY()),MONTH(TODAY())+({offset}),1)"),
                        format!("DATE(YEAR(TODAY()),MONTH(TODAY())+({}),1)", offset + 1),
                    )
                }
                _ => return None,
            };
            formulas.push(format!(
                "AND(ISNUMBER({cell}),{cell}>={start},{cell}<{end})"
            ));
            format!("type=\"timePeriod\" timePeriod=\"{}\"", escaped(period))
        }
        ConditionalRule::IconSet(set) => {
            details = icon_details(set, rule, workbook, sheets, false, work)?;
            "type=\"iconSet\"".into()
        }
        ConditionalRule::ColorScale { thresholds } => {
            details.push_str("<colorScale>");
            for threshold in thresholds {
                details.push_str(&threshold_xml(
                    &threshold.value,
                    rule,
                    workbook,
                    sheets,
                    false,
                    work,
                )?);
            }
            for threshold in thresholds {
                write!(details, "<color rgb=\"{}\"/>", escaped(&threshold.color)).ok()?;
            }
            details.push_str("</colorScale>");
            "type=\"colorScale\"".into()
        }

        ConditionalRule::DataBar(bar) => {
            let guid = format!("{{00000000-0000-0000-0000-{:012X}}}", id + 1);
            // MS-XLSX 2.6.30: the 0/100 extended range uses 10/90 in its legacy fallback.
            let (min_length, max_length) = if (bar.min_length, bar.max_length) == (0, 100) {
                (10, 90)
            } else {
                (bar.min_length, bar.max_length)
            };
            write!(
                details,
                "<dataBar showValue=\"{}\" minLength=\"{}\" maxLength=\"{}\">",
                usize::from(bar.show_value),
                min_length,
                max_length
            )
            .ok()?;
            for (value, default) in [
                (&bar.min, ConditionalValue::Min),
                (&bar.max, ConditionalValue::Max),
            ] {
                details.push_str(&threshold_xml(
                    value.as_ref().unwrap_or(&default),
                    rule,
                    workbook,
                    sheets,
                    false,
                    work,
                )?);
            }
            write!(details,r#"<color rgb="{}"/></dataBar><extLst><ext uri="{{B025F937-C7B1-47D3-B67F-A62EFF666E3E}}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:id>{guid}</x14:id></ext></extLst>"#,escaped(&bar.positive_color)).ok()?;
            let mut ext = format!(
                r#"<x14:conditionalFormatting xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:cfRule type="dataBar" id="{guid}"><x14:dataBar showValue="{}" minLength="{}" maxLength="{}" gradient="{}" border="{}" negativeBarColorSameAsPositive="{}" negativeBarBorderColorSameAsPositive="{}" direction="{}" axisPosition="{}">"#,
                usize::from(bar.show_value),
                bar.min_length,
                bar.max_length,
                usize::from(bar.is_gradient),
                usize::from(bar.border_color.is_some()),
                usize::from(bar.negative_color.is_none()),
                usize::from(bar.negative_border_color.is_none()),
                escaped(&bar.direction),
                escaped(&bar.axis)
            );
            for (value, auto) in [(&bar.min, "autoMin"), (&bar.max, "autoMax")] {
                if let Some(value) = value {
                    ext.push_str(&threshold_xml(value, rule, workbook, sheets, true, work)?);
                } else {
                    write!(ext, r#"<x14:cfvo type="{auto}"/>"#).ok()?;
                }
            }
            // Linked extensions inherit the legacy fill. An x14 fillColor is
            // reserved for standalone rules carrying their own priority.
            if let Some(color) = &bar.border_color {
                write!(ext, r#"<x14:borderColor rgb="{}"/>"#, escaped(color)).ok()?;
            }
            if let Some(color) = &bar.negative_color {
                write!(ext, r#"<x14:negativeFillColor rgb="{}"/>"#, escaped(color)).ok()?;
            }
            if let Some(color) = &bar.negative_border_color {
                write!(
                    ext,
                    r#"<x14:negativeBorderColor rgb="{}"/>"#,
                    escaped(color)
                )
                .ok()?;
            }
            if bar.axis != "none" {
                write!(
                    ext,
                    r#"<x14:axisColor rgb="{}"/>"#,
                    escaped(&bar.axis_color)
                )
                .ok()?;
            }
            ext.push_str("</x14:dataBar></x14:cfRule><xm:sqref>");
            for (i, &[top, left, bottom, right]) in rule.ranges.iter().enumerate() {
                if i > 0 {
                    ext.push(' ');
                }
                write!(
                    ext,
                    "{}{}:{}{}",
                    xlsx_idx_to_col_ref(left),
                    top + 1,
                    xlsx_idx_to_col_ref(right),
                    bottom + 1
                )
                .ok()?;
            }
            ext.push_str("</xm:sqref></x14:conditionalFormatting>");
            *work = work.checked_sub(ext.len())?;
            extensions.push_str(&ext);
            "type=\"dataBar\"".into()
        }

        ConditionalRule::Formula(source) => {
            formulas.push(source.clone());
            "type=\"expression\"".into()
        }
        ConditionalRule::CellIs {
            operator,
            formula,
            formula2,
        } => {
            formulas.push(formula.clone());
            formulas.extend(formula2.iter().cloned());
            format!("type=\"cellIs\" operator=\"{}\"", operator_name(*operator))
        }
        ConditionalRule::Text { operator, value } => {
            let value_literal = literal(value);
            let (kind, formula) = match operator {
                TextOperator::Equals => {
                    formulas.push(value_literal);
                    ("cellIs", None)
                }
                TextOperator::BeginsWith => (
                    "beginsWith",
                    Some(format!(
                        "AND(ISTEXT({cell}),LEFT({cell},LEN({value_literal}))={value_literal})"
                    )),
                ),
                TextOperator::EndsWith => (
                    "endsWith",
                    Some(format!(
                        "AND(ISTEXT({cell}),RIGHT({cell},LEN({value_literal}))={value_literal})"
                    )),
                ),
                TextOperator::Contains | TextOperator::DoesNotContain => {
                    let search = literal(
                        &value
                            .replace('~', "~~")
                            .replace('*', "~*")
                            .replace('?', "~?"),
                    );
                    if matches!(operator, TextOperator::Contains) {
                        (
                            "containsText",
                            Some(format!(
                                "AND(ISTEXT({cell}),ISNUMBER(SEARCH({search},{cell})))"
                            )),
                        )
                    } else {
                        (
                            "notContainsText",
                            Some(format!(
                                "AND(ISTEXT({cell}),ISERROR(SEARCH({search},{cell})))"
                            )),
                        )
                    }
                }
            };
            formulas.extend(formula);
            if matches!(operator, TextOperator::Equals) {
                "type=\"cellIs\" operator=\"equal\"".into()
            } else {
                format!(
                    "type=\"{kind}\" text=\"{}\"",
                    escaped(value)
                        .replace('\t', "&#9;")
                        .replace('\n', "&#10;")
                        .replace('\r', "&#13;")
                )
            }
        }
        ConditionalRule::DuplicateValues => "type=\"duplicateValues\"".into(),
        ConditionalRule::UniqueValues => "type=\"uniqueValues\"".into(),
        ConditionalRule::AverageDeviation {
            above,
            equal,
            deviations,
        } => format!(
            "type=\"aboveAverage\" aboveAverage=\"{}\" equalAverage=\"{}\" stdDev=\"{deviations}\"",
            usize::from(*above),
            usize::from(*equal)
        ),
        ConditionalRule::AboveAverage => "type=\"aboveAverage\" aboveAverage=\"1\"".into(),
        ConditionalRule::BelowAverage => "type=\"aboveAverage\" aboveAverage=\"0\"".into(),
        ConditionalRule::AboveOrEqualAverage => {
            "type=\"aboveAverage\" aboveAverage=\"1\" equalAverage=\"1\"".into()
        }
        ConditionalRule::BelowOrEqualAverage => {
            "type=\"aboveAverage\" aboveAverage=\"0\" equalAverage=\"1\"".into()
        }
        ConditionalRule::Top {
            rank,
            percent,
            bottom,
        } => format!(
            "type=\"top10\" rank=\"{rank}\" percent=\"{}\" bottom=\"{}\"",
            usize::from(*percent),
            usize::from(*bottom)
        ),
        ConditionalRule::Blanks => {
            formulas.push(format!("ISBLANK({cell})"));
            "type=\"containsBlanks\"".into()
        }
        ConditionalRule::NotBlanks => {
            formulas.push(format!("NOT(ISBLANK({cell}))"));
            "type=\"notContainsBlanks\"".into()
        }
        ConditionalRule::Errors => {
            formulas.push(format!("ISERROR({cell})"));
            "type=\"containsErrors\"".into()
        }
        ConditionalRule::NoErrors => {
            formulas.push(format!("NOT(ISERROR({cell}))"));
            "type=\"notContainsErrors\"".into()
        }
    };
    let mut ranges = String::new();
    for &[top, left, bottom, right] in &rule.ranges {
        if !ranges.is_empty() {
            ranges.push(' ');
        }
        write!(
            ranges,
            "{}{}:{}{}",
            xlsx_idx_to_col_ref(left),
            top + 1,
            xlsx_idx_to_col_ref(right),
            bottom + 1
        )
        .ok()?;
    }
    let dxf = if matches!(
        rule.rule,
        ConditionalRule::ColorScale { .. } | ConditionalRule::DataBar(_)
    ) {
        String::new()
    } else {
        format!(" dxfId=\"{id}\"")
    };
    let mut out = format!(
        "<conditionalFormatting sqref=\"{ranges}\"><cfRule {attrs}{dxf} priority=\"{}\" stopIfTrue=\"{}\">",
        rule.priority,
        usize::from(rule.stop_if_true)
    );
    out.push_str(&details);
    for source in formulas {
        let source = formula(&source, workbook, sheets, rule.sheet, work)?;
        *work = work.checked_sub(source.len().checked_mul(6)?)?;
        write!(out, "<formula>{}</formula>", escaped(&source)).ok()?;
    }
    out.push_str("</cfRule></conditionalFormatting>");
    *work = work.checked_sub(out.len())?;
    Some(out)
}

fn children<'a>(nodes: &'a [xml::Node], name: &'a str) -> impl Iterator<Item = &'a xml::Element> {
    nodes.iter().filter_map(move |node| match node {
        xml::Node::Element(el) if el.tag.rsplit(':').next() == Some(name) => Some(el),
        _ => None,
    })
}
fn boolean(el: &xml::Element, name: &str, default: bool) -> Result<bool, String> {
    match attr(el, name) {
        None => Ok(default),
        Some("0" | "false") => Ok(false),
        Some("1" | "true") => Ok(true),
        _ => Err("Invalid conditional formatting flag".into()),
    }
}
fn read_threshold(el: &xml::Element, work: &mut usize) -> Result<ConditionalValue, String> {
    *work = work
        .checked_sub(128)
        .ok_or("Conditional threshold exceeds its limit")?;
    let source = if let Some(value) = attr(el, "val") {
        value.to_owned()
    } else {
        children(&el.children, "f")
            .next()
            .map(text)
            .unwrap_or_default()
    };
    *work = work
        .checked_sub(source.len().saturating_mul(4))
        .ok_or("Conditional threshold exceeds its limit")?;
    let number = || {
        source
            .parse::<f64>()
            .ok()
            .filter(|n| n.is_finite())
            .ok_or("Invalid conditional threshold value")
    };
    Ok(match attr(el, "type") {
        Some("min") => ConditionalValue::Min,
        Some("max") => ConditionalValue::Max,
        Some("num") => ConditionalValue::Number(number()?),
        Some("percent") => ConditionalValue::Percent(number()?),
        Some("percentile") => ConditionalValue::Percentile(number()?),
        Some("formula") => ConditionalValue::Formula(
            formula_arguments::rewrite(&source, Syntax::EditorDisplay, &[], work)
                .ok_or("Conditional threshold exceeds its limit")?
                .into_owned(),
        ),
        _ => return Err("Invalid conditional threshold type".into()),
    })
}
fn read_ranges(source: &str, work: &mut usize) -> Result<Vec<[usize; 4]>, String> {
    let mut ranges = Vec::new();
    for source in source.split_whitespace() {
        *work = work
            .checked_sub(64)
            .ok_or("Conditional formatting exceeds its limit")?;
        let (a, b) = source.split_once(':').unwrap_or((source, source));
        let (r, c) = super::coordinate(a).ok_or("Invalid conditional formatting range")?;
        let (er, ec) = super::coordinate(b).ok_or("Invalid conditional formatting range")?;
        ranges.push([r.min(er), c.min(ec), r.max(er), c.max(ec)]);
    }
    if ranges.is_empty() {
        return Err("Missing conditional formatting range".into());
    }
    Ok(ranges)
}

pub(super) fn read(
    nodes: &[xml::Node],
    sheet: usize,
    styles: &[(Style, Option<String>)],
    colors: &super::xlsx_import::colors::Palette,
    work: &mut usize,
) -> Result<Vec<ConditionalFormat>, String> {
    let mut out = Vec::new();
    let Some(worksheet) = children(nodes, "worksheet").next() else {
        return Ok(out);
    };
    let mut extended = std::collections::BTreeMap::new();
    let mut extended_rules = Vec::new();
    let mut extended_ids = std::collections::BTreeSet::new();
    for list in children(&worksheet.children, "extLst") {
        for area in elements(&list.children, "conditionalFormatting") {
            let ranges = children(&area.children, "sqref")
                .next()
                .ok_or("Missing extended conditional range")?;
            let ranges = read_ranges(&text(ranges), work)?;
            for rule in children(&area.children, "cfRule") {
                *work = work
                    .checked_sub(512 + ranges.len().saturating_mul(64))
                    .ok_or("Conditional formatting exceeds its limit")?;
                let id = attr(rule, "id")
                    .filter(|id| !id.is_empty())
                    .ok_or("Missing extended conditional ID")?;
                if !extended_ids.insert(id) {
                    return Err("Duplicate extended conditional ID".into());
                }
                if attr(rule, "type") == Some("expression") {
                    let formulas: Vec<_> = children(&rule.children, "f").collect();
                    if formulas.len() != 1 {
                        return Err("Expected one extended conditional formula".into());
                    }
                    let source = text(formulas[0]);
                    if source.trim().is_empty() {
                        return Err("Missing extended conditional formula".into());
                    }
                    *work = work
                        .checked_sub(source.len().saturating_mul(4))
                        .ok_or("Conditional formula exceeds its limit")?;
                    let source =
                        formula_arguments::rewrite(&source, Syntax::EditorDisplay, &[], work)
                            .ok_or("Conditional formula exceeds its limit")?
                            .into_owned();
                    let dxfs: Vec<_> = children(&rule.children, "dxf").collect();
                    if dxfs.len() > 1 {
                        return Err("Duplicate extended conditional style".into());
                    }
                    let (style, format) = if let Some(dxf) = dxfs.first() {
                        super::xlsx_import::layout::differential_style(dxf, colors, work)?
                    } else {
                        (Style::default(), None)
                    };
                    extended_rules.push((
                        id,
                        ConditionalFormat {
                            sheet,
                            ranges: ranges.clone(),
                            priority: attr(rule, "priority")
                                .and_then(|s| s.parse().ok())
                                .filter(|p| *p > 0)
                                .ok_or("Invalid conditional formatting priority")?,
                            stop_if_true: boolean(rule, "stopIfTrue", false)?,
                            rule: ConditionalRule::Formula(source),
                            style,
                            format,
                        },
                    ));
                    continue;
                }
                if attr(rule, "type") == Some("iconSet") {
                    let icons: Vec<_> = children(&rule.children, "iconSet").collect();
                    if icons.len() != 1 {
                        return Err("Missing extended icon set".into());
                    }
                    extended_rules.push((
                        id,
                        ConditionalFormat {
                            sheet,
                            ranges: ranges.clone(),
                            priority: attr(rule, "priority")
                                .and_then(|s| s.parse().ok())
                                .filter(|p| *p > 0)
                                .ok_or("Invalid conditional formatting priority")?,
                            stop_if_true: boolean(rule, "stopIfTrue", false)?,
                            rule: read_icons(icons[0], work)?,
                            style: Style::default(),
                            format: None,
                        },
                    ));
                    continue;
                }
                if attr(rule, "type") != Some("dataBar") {
                    return Err("This extended conditional rule is not supported yet".into());
                }
                let bars: Vec<_> = children(&rule.children, "dataBar").collect();
                if bars.len() != 1 {
                    return Err("Missing extended data bar".into());
                }
                if extended.insert(id, (bars[0], ranges.clone())).is_some() {
                    return Err("Duplicate extended data bar ID".into());
                }
            }
        }
    }
    for area in children(&worksheet.children, "conditionalFormatting") {
        let ranges = read_ranges(
            attr(area, "sqref").ok_or("Missing conditional formatting range")?,
            work,
        )?;
        for item in children(&area.children, "cfRule") {
            if let Some(id) = elements(&item.children, "id").first() {
                let id = text(id);
                if let Some(index) = extended_rules.iter().position(|(key, _)| *key == id) {
                    out.push(extended_rules.remove(index).1);
                    continue;
                }
            }
            let mut ranges = ranges.clone();
            *work = work
                .checked_sub(512 + ranges.len().saturating_mul(64))
                .ok_or("Conditional formatting exceeds its limit")?;
            let flag = |name| matches!(attr(item, name), Some("1" | "true"));
            let mut formulas = Vec::new();
            for formula in elements(&item.children, "formula") {
                let source = text(formula);
                *work = work
                    .checked_sub(source.len().saturating_mul(4))
                    .ok_or("Conditional formula exceeds its limit")?;
                formulas.push(
                    formula_arguments::rewrite(&source, Syntax::EditorDisplay, &[], work)
                        .ok_or("Conditional formula exceeds its limit")?
                        .into_owned(),
                );
            }
            let formula = || {
                formulas
                    .first()
                    .cloned()
                    .ok_or("Missing conditional formatting formula")
            };
            let rule = match attr(item, "type").ok_or("Missing conditional formatting type")? {
                "iconSet" => {
                    let icons: Vec<_> = children(&item.children, "iconSet").collect();
                    if icons.len() != 1 {
                        return Err("Missing conditional icon set".into());
                    }
                    read_icons(icons[0], work)?
                }
                "colorScale" => {
                    let scales = elements(&item.children, "colorScale");
                    if scales.len() != 1 {
                        return Err("Missing color scale".into());
                    }
                    let values = elements(&scales[0].children, "cfvo");
                    let palette = elements(&scales[0].children, "color");
                    if !(2..=3).contains(&values.len()) || palette.len() != values.len() {
                        return Err(
                            "Color scales need two or three matching thresholds and colors".into(),
                        );
                    }
                    let mut thresholds = Vec::new();
                    for (value, color) in values.into_iter().zip(palette) {
                        *work = work
                            .checked_sub(128)
                            .ok_or("Color scale exceeds its limit")?;
                        let value = read_threshold(value, work)?;
                        let color = colors.resolve(color).ok_or("Invalid color scale color")?;
                        thresholds.push(ColorScaleThreshold { value, color });
                    }
                    ConditionalRule::ColorScale { thresholds }
                }

                "dataBar" => {
                    let bars: Vec<_> = children(&item.children, "dataBar").collect();
                    if bars.len() != 1 {
                        return Err("Missing data bar".into());
                    }
                    let node = bars[0];
                    let values: Vec<_> = children(&node.children, "cfvo").collect();
                    let palette: Vec<_> = children(&node.children, "color").collect();
                    if values.len() != 2 || palette.len() != 1 {
                        return Err("Data bar needs two thresholds and one color".into());
                    }
                    let length =
                        |el: &xml::Element, name: &str, default: usize| -> Result<usize, String> {
                            attr(el, name)
                                .map(|s| s.parse().map_err(|_| "Invalid data bar length".into()))
                                .unwrap_or(Ok(default))
                        };
                    let mut bar = DataBar {
                        direction: "context".into(),
                        axis: "automatic".into(),
                        min: Some(read_threshold(values[0], work)?),
                        max: Some(read_threshold(values[1], work)?),
                        positive_color: colors
                            .resolve(palette[0])
                            .ok_or("Invalid data bar color")?,
                        negative_color: Some("FFFF0000".into()),
                        border_color: None,
                        negative_border_color: None,
                        axis_color: "FF000000".into(),
                        is_gradient: true,
                        show_value: boolean(node, "showValue", true)?,
                        min_length: length(node, "minLength", 10)?,
                        max_length: length(node, "maxLength", 90)?,
                    };
                    if let Some(id) = elements(&item.children, "id").first() {
                        let id = text(id);
                        let (ext, extended_ranges) = extended
                            .remove(id.as_str())
                            .ok_or("Missing linked data bar extension")?;
                        ranges = extended_ranges;
                        bar.direction = attr(ext, "direction").unwrap_or("context").into();
                        bar.axis = attr(ext, "axisPosition").unwrap_or("automatic").into();
                        let values: Vec<_> = children(&ext.children, "cfvo").collect();
                        if values.len() != 2 {
                            return Err("Data bar needs two extended thresholds".into());
                        }
                        bar.min = if attr(values[0], "type") == Some("autoMin") {
                            None
                        } else {
                            Some(read_threshold(values[0], work)?)
                        };
                        bar.max = if attr(values[1], "type") == Some("autoMax") {
                            None
                        } else {
                            Some(read_threshold(values[1], work)?)
                        };
                        bar.is_gradient = boolean(ext, "gradient", true)?;
                        bar.show_value = boolean(ext, "showValue", bar.show_value)?;
                        bar.min_length = length(ext, "minLength", bar.min_length)?;
                        bar.max_length = length(ext, "maxLength", bar.max_length)?;
                        if let Some(color) = children(&ext.children, "fillColor").next() {
                            bar.positive_color =
                                colors.resolve(color).ok_or("Invalid data bar color")?;
                        }
                        if boolean(ext, "negativeBarColorSameAsPositive", false)? {
                            bar.negative_color = None;
                        } else if let Some(color) =
                            children(&ext.children, "negativeFillColor").next()
                        {
                            bar.negative_color = Some(
                                colors
                                    .resolve(color)
                                    .ok_or("Invalid negative data bar color")?,
                            );
                        }
                        if boolean(ext, "border", false)? {
                            let node = children(&ext.children, "borderColor")
                                .next()
                                .ok_or("Missing data bar border color")?;
                            bar.border_color = Some(
                                colors
                                    .resolve(node)
                                    .ok_or("Invalid data bar border color")?,
                            );
                            bar.negative_border_color =
                                if boolean(ext, "negativeBarBorderColorSameAsPositive", true)? {
                                    None
                                } else {
                                    Some(
                                        colors
                                            .resolve(
                                                children(&ext.children, "negativeBorderColor")
                                                    .next()
                                                    .ok_or(
                                                        "Missing negative data bar border color",
                                                    )?,
                                            )
                                            .ok_or("Invalid negative data bar border color")?,
                                    )
                                };
                        }
                        if let Some(color) = children(&ext.children, "axisColor").next() {
                            bar.axis_color =
                                colors.resolve(color).ok_or("Invalid data bar axis color")?;
                        }
                    }
                    ConditionalRule::DataBar(bar)
                }

                "expression" => ConditionalRule::Formula(formula()?),
                "cellIs" => {
                    let operator = attr(item, "operator")
                        .and_then(operator)
                        .ok_or("Invalid conditional comparison")?;
                    let source = formula()?;
                    if let Some(value) =
                        read_literal(&source).filter(|_| operator == ValueOperator::Equal)
                    {
                        ConditionalRule::Text {
                            operator: TextOperator::Equals,
                            value,
                        }
                    } else {
                        ConditionalRule::CellIs {
                            operator,
                            formula: source,
                            formula2: formulas.get(1).cloned(),
                        }
                    }
                }
                kind @ ("containsText" | "notContainsText" | "beginsWith" | "endsWith") => {
                    let operator = match kind {
                        "containsText" => TextOperator::Contains,
                        "notContainsText" => TextOperator::DoesNotContain,
                        "beginsWith" => TextOperator::BeginsWith,
                        _ => TextOperator::EndsWith,
                    };
                    ConditionalRule::Text {
                        operator,
                        value: attr(item, "text")
                            .ok_or("Missing conditional formatting text")?
                            .into(),
                    }
                }
                "duplicateValues" => ConditionalRule::DuplicateValues,
                "uniqueValues" => ConditionalRule::UniqueValues,
                "aboveAverage" => {
                    let deviations = attr(item, "stdDev")
                        .unwrap_or("0")
                        .trim()
                        .parse::<usize>()
                        .ok()
                        .filter(|n| *n <= i32::MAX as usize)
                        .ok_or("Invalid conditional standard deviations")?;
                    let above = !matches!(attr(item, "aboveAverage"), Some("0" | "false"));
                    let equal = flag("equalAverage");
                    if deviations > 0 {
                        ConditionalRule::AverageDeviation {
                            above,
                            equal,
                            deviations,
                        }
                    } else {
                        match (above, equal) {
                            (true, false) => ConditionalRule::AboveAverage,
                            (false, false) => ConditionalRule::BelowAverage,
                            (true, true) => ConditionalRule::AboveOrEqualAverage,
                            (false, true) => ConditionalRule::BelowOrEqualAverage,
                        }
                    }
                }
                "top10" => ConditionalRule::Top {
                    rank: attr(item, "rank")
                        .unwrap_or("10")
                        .parse()
                        .map_err(|_| "Invalid conditional rank")?,
                    percent: flag("percent"),
                    bottom: flag("bottom"),
                },
                "timePeriod" => ConditionalRule::TimePeriod {
                    period: attr(item, "timePeriod")
                        .ok_or("Missing conditional date period")?
                        .to_owned(),
                },
                "containsBlanks" => ConditionalRule::Blanks,
                "notContainsBlanks" => ConditionalRule::NotBlanks,
                "containsErrors" => ConditionalRule::Errors,
                "notContainsErrors" => ConditionalRule::NoErrors,
                _ => {
                    return Err(
                        "This Excel conditional formatting type is not supported yet".into(),
                    );
                }
            };
            let (style, format) = if let Some(id) = attr(item, "dxfId") {
                let id = id
                    .parse::<usize>()
                    .map_err(|_| "Invalid conditional style index")?;
                let (style, format) = styles
                    .get(id)
                    .ok_or("Missing conditional formatting style")?;
                *work = work
                    .checked_sub(style.retained_bytes() + format.as_ref().map_or(0, String::len))
                    .ok_or("Conditional style exceeds its limit")?;
                (style.clone(), format.clone())
            } else {
                (Style::default(), None)
            };
            let priority = attr(item, "priority")
                .and_then(|s| s.parse().ok())
                .filter(|n| *n > 0)
                .ok_or("Invalid conditional formatting priority")?;
            out.push(ConditionalFormat {
                sheet,
                ranges: ranges.clone(),
                priority,
                stop_if_true: flag("stopIfTrue"),
                rule,
                style,
                format,
            });
        }
    }
    if !extended.is_empty() {
        return Err("Unlinked extended data bar".into());
    }
    out.extend(extended_rules.into_iter().map(|(_, rule)| rule));
    Ok(out)
}

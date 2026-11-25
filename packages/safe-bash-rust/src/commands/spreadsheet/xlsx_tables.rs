use super::{Filter, SS, Sheet, Table, Value, XML, escaped, xlsx_idx_to_col_ref};
use std::fmt::Write;

pub(super) fn area([r1, c1, r2, c2]: [usize; 4], absolute: bool) -> String {
    let dollar = if absolute { "$" } else { "" };
    if (r1, r2) == (0, 1048575) {
        return format!(
            "{dollar}{}:{dollar}{}",
            xlsx_idx_to_col_ref(c1),
            xlsx_idx_to_col_ref(c2)
        );
    }
    if (c1, c2) == (0, 16383) {
        return format!("{dollar}{}:{dollar}{}", r1 + 1, r2 + 1);
    }
    let first = format!("{dollar}{}{dollar}{}", xlsx_idx_to_col_ref(c1), r1 + 1);
    if (r1, c1) == (r2, c2) {
        first
    } else {
        format!(
            "{first}:{dollar}{}{dollar}{}",
            xlsx_idx_to_col_ref(c2),
            r2 + 1
        )
    }
}

fn attribute(source: &str, remaining: &mut usize) -> Option<String> {
    *remaining = remaining.checked_sub(source.len().checked_mul(7)?)?;
    Some(escaped(source).replace('\t', "&#9;").replace('\n', "&#10;"))
}

pub(super) fn filter(
    source: &Filter,
    colors: &std::collections::BTreeMap<&super::ColorFilter, usize>,
    limit: usize,
) -> Option<String> {
    let Some(fields) = &source.fields else {
        return Some(String::new());
    };
    let mut remaining = limit.checked_sub(128)?;
    let visibility = if source.column_visibility {
        r#" xmlns:ssc="urn:poe-code:spreadsheet:filters:1" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="ssc" ssc:columnVisibility="1""#
    } else {
        ""
    };
    let mut output = format!(
        r#"<autoFilter ref="{}"{visibility}>"#,
        area(source.area, false)
    );
    let hidden = if source.show_buttons {
        0
    } else {
        source.area[3].checked_sub(source.area[1])?.checked_add(1)?
    };
    remaining = remaining.checked_sub(fields.len().checked_add(hidden)?.checked_mul(64)?)?;
    let indices: std::collections::BTreeSet<_> = fields
        .keys()
        .copied()
        .chain((0..=source.area[3].checked_sub(source.area[1])?).filter(|_| !source.show_buttons))
        .collect();
    for index in indices {
        let field = fields.get(&index);
        if field.is_none() && source.show_buttons {
            continue;
        }
        remaining = remaining.checked_sub(128)?;
        let mut snapshot = String::new();
        if source.column_visibility {
            if let Some(field) = field {
                for (i, row) in field.hidden_rows.as_ref()?.iter().enumerate() {
                    remaining = remaining.checked_sub(16)?;
                    if i > 0 {
                        snapshot.push(',');
                    }
                    write!(snapshot, "{row}").ok()?;
                }
                snapshot = format!(r#" ssc:hiddenRows="{snapshot}""#);
            }
        }
        write!(
            output,
            r#"<filterColumn colId="{index}"{snapshot}{}>"#,
            if source.show_buttons {
                ""
            } else {
                r#" hiddenButton="1""#
            }
        )
        .ok()?;
        if let Some(field) = field {
            if let Some(color) = &field.color {
                write!(
                    output,
                    r#"<colorFilter dxfId="{}" cellColor="{}"/>"#,
                    colors.get(color)?,
                    u8::from(!color.font)
                )
                .ok()?;
            } else if let Some(dynamic) = &field.dynamic {
                write!(
                    output,
                    r#"<dynamicFilter type="{}""#,
                    attribute(&dynamic.kind, &mut remaining)?
                )
                .ok()?;
                if let Some(value) = dynamic.value {
                    write!(output, r#" val="{value}""#).ok()?;
                }
                if let Some(value) = dynamic.max_value {
                    write!(output, r#" maxVal="{value}""#).ok()?;
                }
                output.push_str("/>");
            } else if let Some(top) = &field.top {
                write!(
                    output,
                    r#"<top10 top="{}" percent="{}" val="{}"/>"#,
                    u8::from(!top.bottom),
                    u8::from(top.percent),
                    top.rank
                )
                .ok()?;
            } else if !field.custom
                && field.conditions.iter().all(|(op, _)| *op == "equal")
                && !field.conjunction
            {
                write!(
                    output,
                    "<filters{}>",
                    if field
                        .conditions
                        .iter()
                        .any(|(op, value)| *op == "equal" && value.is_empty())
                    {
                        r#" blank="1""#
                    } else {
                        ""
                    }
                )
                .ok()?;
                for (_, value) in field
                    .conditions
                    .iter()
                    .filter(|(op, value)| *op == "equal" && !value.is_empty())
                {
                    remaining = remaining.checked_sub(32)?;
                    write!(
                        output,
                        r#"<filter val="{}"/>"#,
                        attribute(value, &mut remaining)?
                    )
                    .ok()?;
                }
                for group in &field.date_groups {
                    remaining = remaining.checked_sub(256)?;
                    let names = ["year", "month", "day", "hour", "minute", "second"];
                    write!(
                        output,
                        r#"<dateGroupItem dateTimeGrouping="{}""#,
                        names.get(group.len().checked_sub(1)?)?
                    )
                    .ok()?;
                    for (name, value) in names.iter().zip(group) {
                        write!(output, r#" {name}="{value}""#).ok()?;
                    }
                    output.push_str("/>");
                }
                output.push_str("</filters>");
            } else {
                write!(output, r#"<customFilters and="{}">"#, field.conjunction).ok()?;
                for (operator, value) in &field.conditions {
                    remaining = remaining.checked_sub(96)?;
                    write!(
                        output,
                        r#"<customFilter operator="{operator}" val="{}"/>"#,
                        attribute(value, &mut remaining)?
                    )
                    .ok()?;
                }
                output.push_str("</customFilters>");
            }
        }
        output.push_str("</filterColumn>");
    }
    output.push_str("</autoFilter>");
    Some(output)
}

pub(super) fn write<S: AsRef<str>>(
    table: &Table,
    sheets: &[Sheet<S>],
    workbook: &super::Workbook,
    colors: &std::collections::BTreeMap<&super::ColorFilter, usize>,
    id: usize,
    limit: usize,
) -> Option<String> {
    let sheet = sheets.get(table.sheet)?;
    let mut remaining = limit.checked_sub(256)?;
    let name = attribute(&table.name, &mut remaining)?;
    let mut output = format!(
        r#"{XML}<table xmlns="{SS}" id="{id}" name="{name}" displayName="{name}" ref="{}" headerRowCount="{}" totalsRowCount="{}" totalsRowShown="{}">"#,
        area(table.area, false),
        u8::from(table.header),
        u8::from(table.totals),
        u8::from(table.totals)
    );
    if let Some(source) = &table.filter {
        let filter = filter(source, colors, remaining)?;
        remaining = remaining.checked_sub(filter.len())?;
        output.push_str(&filter);
    }
    let count = table.area[3].checked_sub(table.area[1])?.checked_add(1)?;
    remaining = remaining.checked_sub(count.checked_mul(128)?)?;
    write!(output, r#"<tableColumns count="{count}">"#).ok()?;
    let mut used = std::collections::BTreeSet::new();
    for index in 0..count {
        let value = if table.header {
            sheet
                .cells
                .get(&(table.area[0], table.area[1] + index))
                .and_then(|cell| cell.value.as_ref())
        } else {
            None
        };
        let original = table
            .columns
            .get(index)
            .cloned()
            .unwrap_or_else(|| match value {
                Some(Value::Text(s)) if !s.as_ref().is_empty() => s.as_ref().to_owned(),
                _ => format!("Column{}", index + 1),
            });
        remaining = remaining.checked_sub(original.len().checked_mul(4)?)?;
        let mut name = original.clone();
        for suffix in 2..=index + 2 {
            remaining = remaining.checked_sub(name.len() + 1)?;
            if used.insert(name.to_lowercase()) {
                break;
            }
            name = format!("{original}{suffix}");
        }
        write!(
            output,
            r#"<tableColumn id="{}" name="{}""#,
            index + 1,
            attribute(&name, &mut remaining)?
        )
        .ok()?;
        if let Some(column) = table.calculated_columns.get(&index) {
            let formula = super::super::formula_arguments::rewrite(
                &column.formula,
                super::super::formula_arguments::Syntax::Editor,
                &[],
                &mut remaining,
            )?;
            let formula = if formula.contains('#') {
                let sheets = sheets
                    .iter()
                    .map(|s| (s.name.as_ref().to_owned(), String::new()))
                    .collect::<Vec<_>>();
                super::super::xlsx_import::formula_tokens(
                    &formula,
                    &workbook.names,
                    &sheets,
                    (Some(table.sheet), Some(table.sheet)),
                    (0, 0),
                    super::super::formula_arguments::Syntax::EditorXlsx,
                    &mut remaining,
                )?
                .text
                .into_owned()
            } else {
                formula.into_owned()
            };
            let formula = super::super::formulas::xlsx_variables(&formula, &mut remaining)?;
            let array = if column.array { r#" array="1""# } else { "" };
            write!(
                output,
                "><calculatedColumnFormula{array}>{}</calculatedColumnFormula></tableColumn>",
                attribute(&formula, &mut remaining)?
            )
            .ok()?;
        } else {
            output.push_str("/>");
        }
    }
    output.push_str("</tableColumns>");
    if let Some(style) = &table.style {
        remaining = remaining.checked_sub(160)?;
        output.push_str("<tableStyleInfo");
        if let Some(name) = &style.name {
            write!(output, r#" name="{}""#, attribute(name, &mut remaining)?).ok()?;
        }
        write!(
            output,
            r#" showFirstColumn="{}" showLastColumn="{}" showRowStripes="{}" showColumnStripes="{}"/>"#,
            u8::from(style.show_first_column),
            u8::from(style.show_last_column),
            u8::from(style.show_row_stripes),
            u8::from(style.show_column_stripes)
        )
        .ok()?;
    }
    output.push_str("</table>");
    Some(output)
}

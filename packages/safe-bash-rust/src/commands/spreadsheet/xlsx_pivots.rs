//! Real OOXML pivot definitions and refreshable caches. Like XlsxWriter
//! 238e935a (LICENSE.XlsxWriter), Excel rebuilds axis items on refresh.
//! Calculated worksheet cells remain available to readers before that refresh.
use super::super::{PivotTable, formulas::SpillCache};
use super::{REL, SS, Sheet, Value, XML, escaped, tables};
use std::{collections::BTreeMap, fmt::Write};

fn item(value: &Value<String>, work: &mut usize) -> Option<String> {
    *work = work.checked_sub(
        128 + match value {
            Value::Text(s) | Value::Error(s) => s.len().checked_mul(8)?,
            _ => 0,
        },
    )?;
    Some(match value {
        Value::Empty => "<m/>".into(),
        Value::Text(s) => format!(
            r#"<s v="{}"/>"#,
            escaped(s).replace('\n', "&#10;").replace('\t', "&#9;")
        ),
        Value::Error(s) => format!(r#"<e v="{}"/>"#, escaped(s)),
        Value::Number(n) if n.is_finite() => format!(r#"<n v="{}"/>"#, super::attribute_number(*n)),
        Value::Bool(b) => format!(r#"<b v="{}"/>"#, u8::from(*b)),
        _ => return None,
    })
}

pub(super) fn write(
    pivot: &PivotTable,
    id: usize,
    sheets: &[Sheet<String>],
    spills: Option<&SpillCache>,
    work: &mut usize,
) -> Option<(String, String)> {
    let [top, left, bottom, right] = pivot.source;
    let source = sheets.get(pivot.source_sheet)?;
    let value = |row, column| {
        spills
            .and_then(|s| s.values.get(&(pivot.source_sheet, row, column)))
            .or_else(|| {
                source
                    .cells
                    .get(&(row, column))
                    .and_then(|c| c.value.as_ref())
            })
            .unwrap_or(&Value::Empty)
    };
    let field_count = right.checked_sub(left)?.checked_add(1)?;
    *work = work.checked_sub(field_count.checked_mul(512)?)?;
    let mut cache_fields = String::new();
    let mut pivot_fields = String::new();
    let mut pages = String::new();
    let mut page_count = 0;
    for field in 0..field_count {
        let Value::Text(name) = value(top, left + field) else {
            return None;
        };
        *work = work.checked_sub(name.len().checked_mul(8)?)?;
        let filter = pivot.filters.iter().find(|filter| filter.field == field);
        // Shared items are needed for filter selections, including selected
        // values absent from today's source data. Unfiltered caches need none.
        let mut shared = BTreeMap::<String, (usize, bool)>::new();
        if let Some(selected) = filter.and_then(|f| f.selected.as_ref()) {
            let mut selected_items = std::collections::BTreeSet::new();
            let mut selected_text = std::collections::BTreeSet::new();
            for v in selected {
                selected_items.insert(item(v, work)?);
                if let Value::Text(s) = v {
                    selected_text.insert(super::super::collation::key(s, false, work)?);
                }
            }
            for row in top + 1..=bottom {
                let v = value(row, left + field);
                let xml = item(v, work)?;
                let selected = selected_items.contains(&xml)
                    || if let Value::Text(s) = v {
                        selected_text.contains(&super::super::collation::key(s, false, work)?)
                    } else {
                        false
                    };
                let index = shared.len();
                shared.entry(xml).or_insert((index, selected));
            }
            for xml in selected_items {
                let index = shared.len();
                shared.entry(xml).or_insert((index, true));
            }
        }
        let mut ordered: Vec<_> = shared
            .into_iter()
            .map(|(xml, (index, selected))| (index, xml, selected))
            .collect();
        ordered.sort_by_key(|(index, _, _)| *index);
        let mut shared_xml = String::new();
        let mut items = String::new();
        for (index, xml, selected) in &ordered {
            shared_xml.push_str(xml);
            write!(
                items,
                r#"<item x="{index}"{} />"#,
                if *selected { "" } else { r#" h="1""# }
            )
            .ok()?;
        }
        write!(cache_fields, r#"<cacheField name="{}" numFmtId="0"><sharedItems count="{}" containsMixedTypes="1" containsNonDate="1" containsString="1" containsBlank="1" containsNumber="1">{shared_xml}</sharedItems></cacheField>"#, escaped(name), ordered.len()).ok()?;
        let axis = if pivot.rows.contains(&field) {
            "axisRow"
        } else if pivot.columns.contains(&field) {
            "axisCol"
        } else if filter.is_some() {
            "axisPage"
        } else {
            ""
        };
        let data = pivot.values.iter().any(|v| v.field == field);
        let mut attributes = format!(
            r#" compact="0" outline="0" defaultSubtotal="0" showAll="0" dataField="{}""#,
            u8::from(data)
        );
        if !axis.is_empty() {
            write!(attributes, r#" axis="{axis}""#).ok()?;
        }
        if filter.is_some() {
            attributes.push_str(r#" multipleItemSelectionAllowed="1""#);
        }
        if axis.is_empty() {
            write!(pivot_fields, "<pivotField{attributes}/>").ok()?;
        } else if ordered.is_empty() {
            write!(pivot_fields, "<pivotField{attributes}><items count=\"1\"><item t=\"default\"/></items></pivotField>").ok()?;
        } else {
            write!(
                pivot_fields,
                "<pivotField{attributes}><items count=\"{}\">{items}</items></pivotField>",
                ordered.len()
            )
            .ok()?;
        }
    }
    for filter in &pivot.filters {
        if !pivot.rows.contains(&filter.field) && !pivot.columns.contains(&filter.field) {
            write!(pages, r#"<pageField fld="{}" hier="-1"/>"#, filter.field).ok()?;
            page_count += 1;
        }
    }
    let cache = format!(
        r#"{XML}<pivotCacheDefinition xmlns="{SS}" xmlns:r="{REL}" saveData="0" refreshOnLoad="1" createdVersion="3" refreshedVersion="3" minRefreshableVersion="3" recordCount="{}"><cacheSource type="worksheet"><worksheetSource ref="{}" sheet="{}"/></cacheSource><cacheFields count="{field_count}">{cache_fields}</cacheFields></pivotCacheDefinition>"#,
        bottom - top,
        tables::area(pivot.source, false),
        escaped(&source.name)
    );
    let mut axes = String::new();
    for (fields, tag, items_tag, measures) in [
        (&pivot.rows, "rowFields", "rowItems", false),
        (
            &pivot.columns,
            "colFields",
            "colItems",
            pivot.values.len() > 1,
        ),
    ] {
        if !fields.is_empty() || measures {
            write!(
                axes,
                "<{tag} count=\"{}\">",
                fields.len() + usize::from(measures)
            )
            .ok()?;
            for field in fields {
                write!(axes, r#"<field x="{field}"/>"#).ok()?;
            }
            if measures {
                axes.push_str(r#"<field x="-2"/>"#);
            }
            write!(axes, "</{tag}>").ok()?;
            let count = if measures { pivot.values.len() } else { 1 };
            write!(axes, "<{items_tag} count=\"{count}\">").ok()?;
            for i in 0..count {
                write!(
                    axes,
                    r#"<i i="{i}"{}><x v="0"/></i>"#,
                    if fields.is_empty() {
                        ""
                    } else {
                        r#" t="grand""#
                    }
                )
                .ok()?;
            }
            write!(axes, "</{items_tag}>").ok()?;
        }
    }
    if page_count > 0 {
        write!(
            axes,
            "<pageFields count=\"{page_count}\">{pages}</pageFields>"
        )
        .ok()?;
    }
    let mut values = String::new();
    for value in &pivot.values {
        *work = work.checked_sub(value.name.len().checked_mul(8)?.checked_add(256)?)?;
        write!(
            values,
            r#"<dataField name="{}" fld="{}" subtotal="{}" baseField="0" baseItem="0"/>"#,
            escaped(&value.name),
            value.field,
            escaped(&value.aggregate)
        )
        .ok()?;
    }
    if !values.is_empty() {
        write!(
            axes,
            "<dataFields count=\"{}\">{values}</dataFields>",
            pivot.values.len()
        )
        .ok()?;
    }
    let [width, height] = spills
        .and_then(|s| s.pivot_ranges.get(&(pivot.sheet, pivot.row, pivot.column)))
        .copied()
        .unwrap_or([1, 1]);
    let location = tables::area(
        [
            pivot.row,
            pivot.column,
            pivot.row + height - 1,
            pivot.column + width - 1,
        ],
        false,
    );
    let header_rows = pivot.columns.len().max(1)
        + usize::from(pivot.values.len() > 1 && !pivot.columns.is_empty());
    let definition = format!(
        r#"{XML}<pivotTableDefinition xmlns="{SS}" name="{}" cacheId="{id}" dataCaption="Values" compact="0" compactData="0" outline="0" outlineData="0" rowGrandTotals="{}" colGrandTotals="{}" updatedVersion="3" minRefreshableVersion="3" createdVersion="3"><location ref="{location}" firstHeaderRow="0" firstDataRow="{header_rows}" firstDataCol="{}"/><pivotFields count="{field_count}">{pivot_fields}</pivotFields>{axes}<pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>"#,
        escaped(&pivot.name),
        u8::from(pivot.row_totals),
        u8::from(pivot.column_totals),
        pivot.rows.len().max(1)
    );
    *work = work.checked_sub(cache.len().checked_add(definition.len())?)?;
    Some((definition, cache))
}

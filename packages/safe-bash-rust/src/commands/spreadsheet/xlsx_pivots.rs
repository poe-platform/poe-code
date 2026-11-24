//! Real OOXML pivot definitions and refreshable caches. Like XlsxWriter
//! 238e935a (LICENSE.XlsxWriter), Excel rebuilds axis items on refresh.
//! Calculated worksheet cells remain available to readers before that refresh.
use super::super::{PivotSource, PivotTable, formulas::SpillCache, model::Workbook};
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
    book: &Workbook,
    spills: Option<&SpillCache>,
    work: &mut usize,
) -> Option<(String, String)> {
    let (source_sheet, area) = if pivot.source_binding.is_some() {
        if let Some(source) =
            spills.and_then(|s| s.pivot_sources.get(&(pivot.sheet, pivot.row, pivot.column)))
        {
            *source
        } else {
            super::super::formulas::resolve_pivot_source(sheets, book, pivot.source_binding?, work)
                .ok()?
        }
    } else {
        (pivot.source_sheet, pivot.source)
    };
    let [top, left, bottom, right] = area;
    let source = sheets.get(source_sheet)?;
    let value = |row, column| {
        spills
            .and_then(|s| s.values.get(&(source_sheet, row, column)))
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
        let subtotal = pivot.subtotals.iter().find(|s| s.field == field);
        let layout = pivot.layout.as_ref().map(|l| l.field(field));
        let mut attributes = format!(
            r#" compact="{}" outline="{}" insertBlankRow="{}" defaultSubtotal="{}" showAll="0" dataField="{}""#,
            u8::from(layout.as_ref().is_some_and(|l| l.compact)),
            u8::from(
                layout
                    .as_ref()
                    .map_or(subtotal.is_some_and(|s| s.at_top), |l| l.outline)
            ),
            u8::from(layout.as_ref().is_some_and(|l| l.blank_row)),
            u8::from(subtotal.is_some_and(|s| s.aggregates.iter().any(|a| a == "automatic"))),
            u8::from(data)
        );
        let mut subtotal_count = 0;
        if let Some(subtotal) = subtotal {
            write!(
                attributes,
                r#" subtotalTop="{}""#,
                u8::from(subtotal.at_top)
            )
            .ok()?;
            for aggregate in &subtotal.aggregates {
                let (_, attribute, item, _) = super::super::pivot::SUBTOTALS
                    .iter()
                    .find(|s| s.0 == aggregate)?;
                if aggregate != "automatic" {
                    write!(attributes, r#" {attribute}="1""#).ok()?;
                }
                write!(items, r#"<item t="{item}"/>"#).ok()?;
                subtotal_count += 1;
            }
        }
        if !axis.is_empty() {
            write!(attributes, r#" axis="{axis}""#).ok()?;
        }
        if filter.is_some() {
            attributes.push_str(r#" multipleItemSelectionAllowed="1""#);
        }
        let extension = if layout.as_ref().is_none_or(|l| l.repeat_labels) {
            r#"<extLst><ext uri="{2946ED86-A175-432a-8AC1-64E0C546D7DE}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:pivotField fillDownLabels="1"/></ext></extLst>"#
        } else {
            ""
        };
        write!(pivot_fields, "<pivotField{attributes}>").ok()?;
        if !axis.is_empty() {
            if ordered.is_empty() && subtotal_count == 0 {
                pivot_fields.push_str("<items count=\"1\"><item t=\"default\"/></items>");
            } else {
                write!(
                    pivot_fields,
                    "<items count=\"{}\">{items}</items>",
                    ordered.len() + subtotal_count
                )
                .ok()?;
            }
        }
        write!(pivot_fields, "{extension}</pivotField>").ok()?;
    }
    for filter in &pivot.filters {
        if !pivot.rows.contains(&filter.field) && !pivot.columns.contains(&filter.field) {
            write!(pages, r#"<pageField fld="{}" hier="-1"/>"#, filter.field).ok()?;
            page_count += 1;
        }
    }
    let worksheet_source = match pivot.source_binding {
        None => format!(
            r#"ref="{}" sheet="{}""#,
            tables::area(area, false),
            escaped(&source.name)
        ),
        Some(PivotSource::Table(index)) => {
            format!(r#"name="{}""#, escaped(&book.tables.get(index)?.name))
        }
        Some(PivotSource::Name(index)) => {
            let name = book.names.get(index)?;
            let scope = match name.sheet {
                Some(s) => Some(format!(r#" sheet="{}""#, escaped(&sheets.get(s)?.name))),
                None => None,
            };
            format!(
                r#"name="{}"{}"#,
                escaped(&name.name),
                scope.unwrap_or_default()
            )
        }
        Some(PivotSource::Missing) => return None,
    };
    *work = work.checked_sub(worksheet_source.len())?;
    let cache = format!(
        r#"{XML}<pivotCacheDefinition xmlns="{SS}" xmlns:r="{REL}" saveData="0" refreshOnLoad="1" createdVersion="3" refreshedVersion="3" minRefreshableVersion="3" recordCount="{}"><cacheSource type="worksheet"><worksheetSource {worksheet_source}/></cacheSource><cacheFields count="{field_count}">{cache_fields}</cacheFields></pivotCacheDefinition>"#,
        bottom - top
    );
    let mut axes = String::new();
    let data_axis = pivot.data_axis();
    for (fields, tag, items_tag, rows) in [
        (&pivot.rows, "rowFields", "rowItems", true),
        (&pivot.columns, "colFields", "colItems", false),
    ] {
        let position = data_axis.filter(|a| a.rows == rows).map(|a| a.position);
        let measures = position.is_some();
        if !fields.is_empty() || measures {
            write!(
                axes,
                "<{tag} count=\"{}\">",
                fields.len() + usize::from(measures)
            )
            .ok()?;
            for i in 0..=fields.len() {
                if position == Some(i) {
                    axes.push_str(r#"<field x="-2"/>"#);
                }
                if let Some(field) = fields.get(i) {
                    write!(axes, r#"<field x="{field}"/>"#).ok()?;
                }
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
    let (header_rows, label_columns) = pivot.header_size();
    let first_header_row = usize::from(pivot.layout.is_some() && header_rows > 1);
    let data_attributes = pivot
        .data_axis
        .or(data_axis)
        .map(|axis| {
            format!(
                r#" dataOnRows="{}" dataPosition="{}""#,
                u8::from(axis.rows),
                axis.position
            )
        })
        .unwrap_or_default();
    let layout_attributes = if let Some(layout) = &pivot.layout {
        format!(
            r#"compact="{}" outline="{}" compactData="{}" outlineData="{}" indent="{}""#,
            u8::from(layout.compact),
            u8::from(layout.outline),
            u8::from(layout.compact_data),
            u8::from(layout.outline_data),
            layout.indent
        )
    } else {
        // Keep the old JSON grid stable across our own round trips. Excel can
        // ignore this attribute and use the explicit per-field flags above.
        r#"compact="0" compactData="0" outline="0" outlineData="0" xmlns:ssc="urn:poe-code:spreadsheet:pivots:1" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="ssc" ssc:legacyLayout="1""#.into()
    };
    let definition = format!(
        r#"{XML}<pivotTableDefinition xmlns="{SS}" name="{}" cacheId="{id}" dataCaption="Values"{data_attributes} {layout_attributes} rowGrandTotals="{}" colGrandTotals="{}" updatedVersion="3" minRefreshableVersion="3" createdVersion="3"><location ref="{location}" firstHeaderRow="{first_header_row}" firstDataRow="{header_rows}" firstDataCol="{}"/><pivotFields count="{field_count}">{pivot_fields}</pivotFields>{axes}<pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>"#,
        escaped(&pivot.name),
        u8::from(pivot.column_totals),
        u8::from(pivot.row_totals),
        label_columns
    );
    *work = work.checked_sub(cache.len().checked_add(definition.len())?)?;
    Some((definition, cache))
}

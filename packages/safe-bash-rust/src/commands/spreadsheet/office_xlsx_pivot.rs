//! Read pivot definitions through OPC relationships, including caches outside xl/.
//! Contracts and fixtures: ClosedXML 057f5976 (LICENSE.ClosedXML) and
//! XlsxWriter 238e935a (LICENSE.XlsxWriter).
use super::super::{
    PivotDataAxis, PivotFieldLayout, PivotFilter, PivotLayout, PivotSource, PivotSubtotal,
    PivotTable, PivotValue, model::Value,
};
use super::{Imported, attr, elements, xml};
use std::collections::{BTreeMap, BTreeSet};

fn load(
    entries: &BTreeMap<String, Vec<u8>>,
    path: &str,
    work: &mut usize,
) -> Result<Vec<xml::Node>, String> {
    let bytes = entries
        .get(path.trim_start_matches('/'))
        .ok_or("Missing XLSX pivot part")?;
    *work = work
        .checked_sub(
            bytes
                .len()
                .checked_mul(2)
                .ok_or("Pivot part exceeds limit")?,
        )
        .ok_or("Pivot part exceeds limit")?;
    let text = super::super::office_xml::decode(bytes)?;
    xml::parse(&text, None, None).map(|document| document.nodes)
}

fn related(
    entries: &BTreeMap<String, Vec<u8>>,
    owner: &str,
    kind: &str,
    work: &mut usize,
) -> Result<Vec<String>, String> {
    let owner = owner.trim_start_matches('/');
    let (directory, name) = owner.rsplit_once('/').unwrap_or(("", owner));
    let path = if directory.is_empty() {
        format!("_rels/{name}.rels")
    } else {
        format!("{directory}/_rels/{name}.rels")
    };
    if !entries.contains_key(&path) {
        return Ok(Vec::new());
    }
    let nodes = load(entries, &path, work)?;
    let mut result = Vec::new();
    for relation in elements(&nodes, "Relationship") {
        if attr(relation, "Type").and_then(|t| t.rsplit('/').next()) != Some(kind) {
            continue;
        }
        if attr(relation, "TargetMode") == Some("External") {
            return Err("External pivot parts are not supported".into());
        }
        let target = attr(relation, "Target").ok_or("Missing XLSX pivot relationship target")?;
        *work = work
            .checked_sub(target.len() + directory.len() + 128)
            .ok_or("Pivot relationships exceed limit")?;
        result.push(crate::vfs::resolve_posix_path(
            &format!("/{directory}"),
            target,
        ));
    }
    Ok(result)
}

fn index(element: &xml::Element, name: &str) -> Result<usize, String> {
    attr(element, name)
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| format!("Invalid XLSX pivot {name}"))
}
fn flag(element: &xml::Element, name: &str, default: bool) -> Result<bool, String> {
    match attr(element, name) {
        Some("1" | "true") => Ok(true),
        Some("0" | "false") => Ok(false),
        None => Ok(default),
        _ => Err(format!("Invalid XLSX pivot {name}")),
    }
}

fn area(source: &str) -> Result<[usize; 4], String> {
    if source.len() > 128 {
        return Err("Invalid XLSX pivot range".into());
    }
    let normalized = source.replace('$', "");
    let (first, last) = normalized
        .split_once(':')
        .unwrap_or((&normalized, &normalized));
    let (r, c) = super::coordinate(first).ok_or("Invalid XLSX pivot range")?;
    let (bottom, right) = super::coordinate(last).ok_or("Invalid XLSX pivot range")?;
    if bottom < r || right < c {
        return Err("Invalid XLSX pivot range".into());
    }
    Ok([r, c, bottom, right])
}
fn fields(root: &xml::Element, tag: &str) -> Result<(Vec<usize>, Option<usize>), String> {
    let Some(list) = elements(&root.children, tag).first().copied() else {
        return Ok((Vec::new(), None));
    };
    let mut fields = Vec::new();
    let mut data = None;
    for field in elements(&list.children, "field") {
        if attr(field, "x") == Some("-2") {
            if data.replace(fields.len()).is_some() {
                return Err("Duplicate XLSX pivot values field".into());
            }
        } else {
            fields.push(index(field, "x")?);
        }
    }
    Ok((fields, data))
}

fn axes(root: &xml::Element) -> Result<(Vec<usize>, Vec<usize>, Option<PivotDataAxis>), String> {
    let (rows, row_data) = fields(root, "rowFields")?;
    let (columns, column_data) = fields(root, "colFields")?;
    let on_rows = match attr(root, "dataOnRows") {
        Some("1" | "true") => Some(true),
        Some("0" | "false") => Some(false),
        None => None,
        _ => return Err("Invalid XLSX pivot dataOnRows".into()),
    };
    let position = attr(root, "dataPosition")
        .filter(|p| *p != "-1")
        .map(|p| {
            p.parse::<usize>()
                .map_err(|_| "Invalid XLSX pivot dataPosition")
        })
        .transpose()?;
    let data = match (row_data, column_data) {
        (Some(_), Some(_)) => return Err("Conflicting XLSX pivot values axes".into()),
        (Some(position), None) => Some(PivotDataAxis {
            rows: true,
            position,
        }),
        (None, Some(position)) => Some(PivotDataAxis {
            rows: false,
            position,
        }),
        (None, None) if position.is_some() || on_rows == Some(true) => {
            let is_row = on_rows.unwrap_or(false);
            Some(PivotDataAxis {
                rows: is_row,
                position: position.unwrap_or(if is_row { rows.len() } else { columns.len() }),
            })
        }
        _ => None,
    };
    if data.is_some_and(|data| {
        on_rows.is_some_and(|rows| rows != data.rows)
            || position.is_some_and(|p| p != data.position)
            || data.position > if data.rows { rows.len() } else { columns.len() }
    }) {
        return Err("Inconsistent XLSX pivot values placement".into());
    }
    Ok((rows, columns, data))
}
fn shared_value(node: &xml::Element) -> Result<Value<String>, String> {
    Ok(match node.tag.rsplit(':').next() {
        Some("m") => Value::Empty,
        Some("s") => Value::Text(super::super::xlsx_string::decode(
            attr(node, "v").ok_or("Missing pivot item text")?,
        )),
        Some("e") => Value::Error(attr(node, "v").ok_or("Missing pivot item error")?.into()),
        Some("n") => Value::Number(
            attr(node, "v")
                .and_then(|v| v.parse::<f64>().ok())
                .filter(|v| v.is_finite())
                .ok_or("Invalid pivot item number")?,
        ),
        Some("b") => Value::Bool(match attr(node, "v") {
            Some("1" | "true") => true,
            Some("0" | "false") => false,
            _ => return Err("Invalid pivot item boolean".into()),
        }),
        _ => return Err("This pivot filter item type is not supported yet".into()),
    })
}

pub(super) fn retain(
    imported: &mut Imported,
    entries: &BTreeMap<String, Vec<u8>>,
) -> Result<(), String> {
    for (sheet, (_, path)) in imported.sources.iter().enumerate() {
        for target in related(entries, path, "pivotTable", &mut imported.remaining)? {
            let nodes = load(entries, &target, &mut imported.remaining)?;
            let root = elements(&nodes, "pivotTableDefinition")
                .first()
                .copied()
                .ok_or("Missing XLSX pivot definition")?;
            let (rows, columns, data_axis) = axes(root)?;
            let caches = related(
                entries,
                &target,
                "pivotCacheDefinition",
                &mut imported.remaining,
            )?;
            if caches.len() != 1 {
                return Err("Missing or ambiguous XLSX pivot cache".into());
            }
            let cache = load(entries, &caches[0], &mut imported.remaining)?;
            let source_type = elements(&cache, "cacheSource")
                .first()
                .copied()
                .ok_or("Missing pivot cache source")?;
            if attr(source_type, "type") != Some("worksheet") {
                return Err("External pivot sources are not supported yet".into());
            }
            let source = elements(&source_type.children, "worksheetSource")
                .first()
                .copied()
                .ok_or("Missing pivot worksheet source")?;
            let scope = attr(source, "sheet")
                .map(|source_name| {
                    imported
                        .sources
                        .iter()
                        .position(|(name, _)| super::super::case_fold::same_name(name, source_name))
                        .ok_or("Missing pivot source worksheet")
                })
                .transpose()?;
            let (source_sheet, source, source_binding) = if let Some(label) = attr(source, "name") {
                let tables: Vec<_> = imported
                    .book
                    .tables
                    .iter()
                    .enumerate()
                    .filter(|(_, table)| super::super::case_fold::same_name(&table.name, label))
                    .map(|(i, _)| PivotSource::Table(i))
                    .collect();
                let local: Vec<_> = imported
                    .book
                    .names
                    .iter()
                    .enumerate()
                    .filter(|(_, name)| {
                        name.sheet == scope && super::super::case_fold::same_name(&name.name, label)
                    })
                    .map(|(i, _)| PivotSource::Name(i))
                    .collect();
                let candidates = if local.is_empty() && scope.is_some() {
                    imported
                        .book
                        .names
                        .iter()
                        .enumerate()
                        .filter(|(_, name)| {
                            name.sheet.is_none()
                                && super::super::case_fold::same_name(&name.name, label)
                        })
                        .map(|(i, _)| PivotSource::Name(i))
                        .collect::<Vec<_>>()
                } else {
                    local
                };
                let candidates: Vec<_> = candidates.into_iter().chain(tables).collect();
                let [binding] = candidates.as_slice() else {
                    return Err("Missing or ambiguous named pivot source".into());
                };
                let (sheet, area) = super::super::formulas::resolve_pivot_source(
                    &imported.sheets,
                    &imported.book,
                    *binding,
                    &mut imported.remaining,
                )?;
                (sheet, area, Some(*binding))
            } else {
                (
                    scope.ok_or("Missing pivot source worksheet")?,
                    area(attr(source, "ref").ok_or("Missing pivot source range")?)?,
                    None,
                )
            };
            let location = elements(&root.children, "location")
                .first()
                .copied()
                .ok_or("Missing pivot location")?;
            let location = area(attr(location, "ref").ok_or("Missing pivot location range")?)?;
            let name = attr(root, "name").ok_or("Missing pivot name")?.to_owned();
            let cache_fields = elements(&cache, "cacheField");
            if cache_fields.len() != source[3] - source[1] + 1
                || cache_fields.iter().any(|f| {
                    attr(f, "formula").is_some() || !elements(&f.children, "fieldGroup").is_empty()
                })
            {
                return Err("Calculated or grouped pivot fields are not supported yet".into());
            }
            let mut values = Vec::new();
            for field in elements(&root.children, "dataField") {
                if attr(field, "showDataAs").is_some_and(|v| v != "normal") {
                    return Err("Relative pivot aggregates are not supported yet".into());
                }
                let aggregate = attr(field, "subtotal").unwrap_or("sum");
                if super::super::pivot::aggregate(aggregate).is_none() {
                    return Err("Invalid pivot aggregate".into());
                }
                let field_index = index(field, "fld")?;
                let cache_field = cache_fields
                    .get(field_index)
                    .ok_or("Invalid pivot value field")?;
                let name = attr(field, "name")
                    .or_else(|| attr(cache_field, "name"))
                    .ok_or("Missing pivot value name")?;
                imported.remaining = imported
                    .remaining
                    .checked_sub(name.len() + 128)
                    .ok_or("Pivot values exceed limit")?;
                values.push(PivotValue {
                    field: field_index,
                    aggregate: aggregate.into(),
                    name: name.into(),
                });
            }
            let pivot_fields = elements(&root.children, "pivotFields")
                .first()
                .copied()
                .ok_or("Missing pivot fields")?;
            let pivot_fields: Vec<_> = pivot_fields
                .children
                .iter()
                .filter_map(|node| match node {
                    xml::Node::Element(element)
                        if element.tag.rsplit(':').next() == Some("pivotField") =>
                    {
                        Some(element)
                    }
                    _ => None,
                })
                .collect();
            if pivot_fields.len() != cache_fields.len() {
                return Err("Invalid pivot field count".into());
            }
            let layout_fields = pivot_fields
                .iter()
                .enumerate()
                .map(|(field, definition)| {
                    imported.remaining = imported
                        .remaining
                        .checked_sub(128)
                        .ok_or("Pivot layout exceeds limit")?;
                    let repeat_labels = elements(&definition.children, "pivotField")
                        .into_iter()
                        .map(|extension| flag(extension, "fillDownLabels", false))
                        .collect::<Result<Vec<_>, _>>()?
                        .into_iter()
                        .any(|value| value);
                    Ok(PivotFieldLayout {
                        field,
                        compact: flag(definition, "compact", true)?,
                        outline: flag(definition, "outline", true)?,
                        repeat_labels,
                        blank_row: flag(definition, "insertBlankRow", false)?,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
            let legacy_layout = root.attrs.iter().any(|(key, value)| {
                let Some((prefix, local)) = key.split_once(':') else {
                    return false;
                };
                local == "legacyLayout"
                    && value == "1"
                    && root.attrs.iter().any(|(key, value)| {
                        key == &format!("xmlns:{prefix}")
                            && value == "urn:poe-code:spreadsheet:pivots:1"
                    })
            });
            let layout = (!legacy_layout).then_some(PivotLayout {
                compact: flag(root, "compact", true)?,
                outline: flag(root, "outline", false)?,
                compact_data: flag(root, "compactData", true)?,
                outline_data: flag(root, "outlineData", false)?,
                indent: attr(root, "indent")
                    .map(|value| value.parse::<u8>())
                    .transpose()
                    .map_err(|_| "Invalid XLSX pivot indent")?
                    .unwrap_or(1),
                fields: layout_fields,
            });
            let mut subtotals = Vec::new();
            for &field in rows.iter().chain(&columns) {
                let definition = pivot_fields
                    .get(field)
                    .ok_or("Invalid pivot subtotal field")?;
                let flag = |name, default| match attr(definition, name) {
                    Some("1" | "true") => Ok(true),
                    Some("0" | "false") => Ok(false),
                    None => Ok(default),
                    _ => Err("Invalid XLSX pivot subtotal flag"),
                };
                let mut aggregates = Vec::new();
                for (name, attribute, _, _) in super::super::pivot::SUBTOTALS {
                    if flag(attribute, name == "automatic")? {
                        aggregates.push(name.into());
                    }
                }
                if !aggregates.is_empty() {
                    imported.remaining = imported
                        .remaining
                        .checked_sub(512)
                        .ok_or("Pivot subtotals exceed limit")?;
                    subtotals.push(PivotSubtotal {
                        field,
                        aggregates,
                        at_top: flag("subtotalTop", true)?,
                    });
                }
            }
            let mut selections = BTreeMap::<usize, Option<BTreeSet<usize>>>::new();
            for (field, definition) in pivot_fields.iter().enumerate() {
                let items = elements(&definition.children, "item");
                if items
                    .iter()
                    .any(|item| matches!(attr(item, "h"), Some("1" | "true")))
                {
                    let mut selected = BTreeSet::new();
                    for item in items {
                        if matches!(attr(item, "h"), Some("1" | "true"))
                            || attr(item, "t").is_some_and(|t| t != "data")
                        {
                            continue;
                        }
                        imported.remaining = imported
                            .remaining
                            .checked_sub(64)
                            .ok_or("Pivot selection exceeds limit")?;
                        selected.insert(index(item, "x")?);
                    }
                    selections.insert(field, Some(selected));
                }
            }
            let mut filter_order = Vec::new();
            for field in elements(&root.children, "pageField") {
                let field_index = index(field, "fld")?;
                imported.remaining = imported
                    .remaining
                    .checked_sub(filter_order.len() + 64)
                    .ok_or("Pivot filter order exceeds limit")?;
                if filter_order.contains(&field_index) {
                    return Err("Duplicate pivot page field".into());
                }
                filter_order.push(field_index);
                let definition = pivot_fields
                    .get(field_index)
                    .ok_or("Invalid pivot filter field")?;
                if let Some(item) = attr(field, "item") {
                    let item = item
                        .parse::<usize>()
                        .map_err(|_| "Invalid selected pivot item")?;
                    // pageField.item indexes the pivot field's items; each
                    // item's x then indexes the cache's shared values.
                    let items = elements(&definition.children, "item");
                    let value_index = index(
                        items
                            .get(item)
                            .copied()
                            .ok_or("Missing selected pivot item")?,
                        "x",
                    )?;
                    let selected = selections.entry(field_index).or_insert(None);
                    let allowed = selected
                        .as_ref()
                        .is_none_or(|items| items.contains(&value_index));
                    *selected = Some(if allowed {
                        BTreeSet::from([value_index])
                    } else {
                        BTreeSet::new()
                    });
                } else {
                    selections.entry(field_index).or_insert(None);
                }
            }
            let mut filters = Vec::new();
            let pages: Vec<_> = filter_order
                .into_iter()
                .map(|field| (field, selections.remove(&field).expect("page selection")))
                .collect();
            for (field, selected) in pages.into_iter().chain(selections) {
                let selected = selected
                    .map(|selected| {
                        let shared = elements(&cache_fields[field].children, "sharedItems")
                            .first()
                            .copied()
                            .ok_or("Missing pivot filter values")?;
                        let items: Vec<_> = shared
                            .children
                            .iter()
                            .filter_map(|node| {
                                if let xml::Node::Element(element) = node {
                                    Some(element)
                                } else {
                                    None
                                }
                            })
                            .collect();
                        imported.remaining = imported
                            .remaining
                            .checked_sub(items.len().saturating_mul(32))
                            .ok_or("Pivot selection exceeds limit")?;
                        selected
                            .into_iter()
                            .map(|item| {
                                shared_value(
                                    items
                                        .get(item)
                                        .copied()
                                        .ok_or("Missing selected pivot value")?,
                                )
                            })
                            .collect::<Result<Vec<_>, String>>()
                    })
                    .transpose()?;
                filters.push(PivotFilter { field, selected });
            }
            imported.remaining = imported
                .remaining
                .checked_sub(name.len().saturating_mul(2) + 512)
                .ok_or("Pivot definitions exceed limit")?;
            let pivot = PivotTable {
                name: name.clone(),
                sheet,
                row: location[0],
                column: location[1],
                source_binding,
                source_sheet,
                source,
                rows,
                columns,
                data_axis,
                subtotals,
                layout,
                values,
                filters,
                row_totals: !matches!(attr(root, "colGrandTotals"), Some("0" | "false")),
                column_totals: !matches!(attr(root, "rowGrandTotals"), Some("0" | "false")),
            };
            if sheet == source_sheet
                && source[0] <= location[2]
                && location[0] <= source[2]
                && source[1] <= location[3]
                && location[1] <= source[3]
            {
                return Err("Pivot results overlap their source data".into());
            }
            if imported.book.pivots.insert(name, pivot).is_some() {
                return Err("Duplicate pivot name".into());
            }
            // Existing Excel result cells are caches. Keep their appearance,
            // but recalculate their values from the persisted definition.
            // Merged pivot labels are cached layout too. Retaining them as
            // authored merges would obstruct the recalculated result.
            imported.remaining = imported
                .remaining
                .checked_sub(imported.sheets[sheet].merges.len().saturating_mul(32))
                .ok_or("Pivot result area exceeds limit")?;
            imported.sheets[sheet]
                .merges
                .retain(|&[r, c, width, height]| {
                    !(r >= location[0]
                        && c >= location[1]
                        && r <= location[2]
                        && c <= location[3]
                        && height <= location[2] - r + 1
                        && width <= location[3] - c + 1)
                });
            for (&(r, c), cell) in imported.sheets[sheet]
                .cells
                .range_mut((location[0], location[1])..=(location[2], location[3]))
            {
                if (location[1]..=location[3]).contains(&c)
                    && (location[0]..=location[2]).contains(&r)
                {
                    imported.remaining = imported
                        .remaining
                        .checked_sub(64)
                        .ok_or("Pivot result area exceeds limit")?;
                    cell.value = None;
                    cell.formula = None;
                    cell.openformula = None;
                    cell.formula_display = None;
                    cell.rich_text = None;
                }
            }
        }
    }
    Ok(())
}

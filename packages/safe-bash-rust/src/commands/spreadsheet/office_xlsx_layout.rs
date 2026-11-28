//! Appearance and worksheet metadata for editable XLSX workbooks.
use super::super::model::{
    Axis, CalculatedColumn, ColorFilter, DynamicFilter, Filter, FilterField, Style, Table,
    TableStyle, TopFilter,
};
use super::{Imported, LIMIT, attr, coordinate, elements, xml};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

fn load(entries: &BTreeMap<String, Vec<u8>>, path: &str) -> Result<Vec<xml::Node>, String> {
    let bytes = entries
        .get(path.trim_start_matches('/'))
        .ok_or("Missing worksheet metadata part")?;
    let source = super::super::office_xml::decode(bytes)?;
    xml::parse(&source, None, None).map(|d| d.nodes)
}
fn number(el: &xml::Element, key: &str) -> Option<f64> {
    attr(el, key)?.parse::<f64>().ok().filter(|n| n.is_finite())
}
fn flag(el: &xml::Element, key: &str) -> bool {
    matches!(attr(el, key), Some("1" | "true"))
}
fn child<'a>(el: &'a xml::Element, name: &str) -> Option<&'a xml::Element> {
    el.children.iter().find_map(|n| {
        if let xml::Node::Element(e) = n {
            (e.tag.rsplit(':').next() == Some(name)).then_some(e)
        } else {
            None
        }
    })
}
fn area(source: &str) -> Option<[usize; 4]> {
    let (a, b) = source.split_once(':').unwrap_or((source, source));
    let (r, c) = coordinate(a)?;
    let (end_r, end_c) = coordinate(b)?;
    (end_r >= r && end_c >= c).then_some([r, c, end_r, end_c])
}
fn auto_filter(
    nodes: &[xml::Node],
    differential: &[(Style, Option<String>)],
    work: &mut usize,
) -> Result<Option<Filter>, String> {
    let Some(filter) = elements(nodes, "autoFilter").first().copied() else {
        return Ok(None);
    };
    *work = work.checked_sub(128).ok_or(LIMIT)?;
    let area = attr(filter, "ref")
        .and_then(area)
        .ok_or("Invalid XLSX filter range")?;
    let mut fields = BTreeMap::new();
    let mut show_buttons = true;
    for column in elements(&filter.children, "filterColumn") {
        *work = work.checked_sub(128).ok_or(LIMIT)?;
        let index = attr(column, "colId")
            .and_then(|s| s.parse::<usize>().ok())
            .filter(|&i| i <= area[3] - area[1])
            .ok_or("Invalid XLSX filter column")?;
        show_buttons &= !flag(column, "hiddenButton")
            && !matches!(attr(column, "showButton"), Some("0" | "false"));
        let mut field = FilterField {
            color: None,
            dynamic: None,
            date_groups: Vec::new(),
            top: None,
            hidden_rows: None,
            custom: false,
            conditions: Vec::new(),
            conjunction: false,
        };
        if child(column, "colorFilter").is_some()
            && [
                "filters",
                "customFilters",
                "dynamicFilter",
                "top10",
                "iconFilter",
            ]
            .iter()
            .any(|name| child(column, name).is_some())
        {
            return Err("Conflicting XLSX color filter criteria".into());
        }
        if let Some(color) = child(column, "colorFilter") {
            let id = attr(color, "dxfId")
                .and_then(|id| id.parse::<usize>().ok())
                .ok_or("Invalid XLSX color filter style")?;
            let (style, _) = differential
                .get(id)
                .ok_or("Missing XLSX color filter style")?;
            let font = match attr(color, "cellColor") {
                None | Some("1" | "true") => false,
                Some("0" | "false") => true,
                _ => return Err("Invalid XLSX color filter type".into()),
            };
            // Excel/LibreOffice filter dxfs store the criterion in the fill,
            // including font filters (LibreOffice ColorFilter::finalizeImport).
            // Also accept producers using the dxf font color directly.
            let no_fill = !font
                && style
                    .attributes
                    .iter()
                    .any(|(key, value)| *key == "Shade" && value == "0");
            let value = style
                .attributes
                .iter()
                .find(|(key, _)| *key == "Back" && !no_fill)
                .or_else(|| {
                    style
                        .attributes
                        .iter()
                        .find(|(key, _)| font && *key == "Fore")
                })
                .map(|(_, value)| value.clone())
                .or_else(|| font.then(|| "FF000000".into()));
            field.color = Some(ColorFilter { font, color: value });
        } else if let Some(list) = child(column, "filters") {
            if flag(list, "blank") {
                field.conditions.push(("equal", String::new()));
            }
            for item in elements(&list.children, "filter") {
                let value = attr(item, "val").ok_or("Missing XLSX filter value")?;
                *work = work.checked_sub(value.len() + 32).ok_or(LIMIT)?;
                field.conditions.push(("equal", value.into()));
            }
            for item in elements(&list.children, "dateGroupItem") {
                if !matches!(attr(list, "calendarType"), None | Some("gregorian")) {
                    return Err("Non-Gregorian Excel date filters are not supported".into());
                }
                let depth = match attr(item, "dateTimeGrouping") {
                    Some("year") => 1,
                    Some("month") => 2,
                    Some("day") => 3,
                    Some("hour") => 4,
                    Some("minute") => 5,
                    Some("second") => 6,
                    _ => return Err("Invalid XLSX date grouping".into()),
                };
                *work = work.checked_sub(128).ok_or(LIMIT)?;
                let group = ["year", "month", "day", "hour", "minute", "second"]
                    .into_iter()
                    .take(depth)
                    .map(|name| {
                        attr(item, name)
                            .and_then(|s| s.parse::<usize>().ok())
                            .ok_or("Invalid XLSX date group")
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                field.date_groups.push(group);
            }
        } else if let Some(custom) = child(column, "customFilters") {
            field.custom = true;
            field.conjunction = flag(custom, "and");
            for item in elements(&custom.children, "customFilter") {
                let operator = match attr(item, "operator").unwrap_or("equal") {
                    "equal" => "equal",
                    "notEqual" => "notEqual",
                    "lessThan" => "lessThan",
                    "lessThanOrEqual" => "lessThanOrEqual",
                    "greaterThan" => "greaterThan",
                    "greaterThanOrEqual" => "greaterThanOrEqual",
                    _ => return Err("Invalid XLSX filter operator".into()),
                };
                let value = attr(item, "val").ok_or("Missing XLSX filter value")?;
                *work = work.checked_sub(value.len() + 32).ok_or(LIMIT)?;
                field.conditions.push((operator, value.into()));
            }
        } else if let Some(dynamic) = child(column, "dynamicFilter") {
            let cached = |name| {
                attr(dynamic, name)
                    .map(|source| {
                        source
                            .parse::<f64>()
                            .ok()
                            .filter(|n| n.is_finite())
                            .ok_or("Invalid XLSX dynamic filter threshold")
                    })
                    .transpose()
            };
            field.dynamic = Some(DynamicFilter {
                kind: attr(dynamic, "type")
                    .ok_or("Missing XLSX dynamic filter type")?
                    .into(),
                value: cached("val")?,
                max_value: cached("maxVal")?,
            });
        } else if let Some(top) = child(column, "top10") {
            field.top = Some(TopFilter {
                rank: attr(top, "val")
                    .and_then(|s| s.parse().ok())
                    .ok_or("Invalid XLSX top/bottom filter rank")?,
                percent: flag(top, "percent"),
                bottom: matches!(attr(top, "top"), Some("0" | "false")),
            });
        } else if column
            .children
            .iter()
            .any(|n| matches!(n, xml::Node::Element(_)))
        {
            return Err("This Excel filter type is not supported yet".into());
        }
        if flag(filter, "columnVisibility") {
            if let Some(rows) = attr(column, "hiddenRows") {
                let mut hidden = Vec::new();
                for row in rows.split(',').filter(|row| !row.is_empty()) {
                    *work = work.checked_sub(32).ok_or(LIMIT)?;
                    let row = row
                        .parse::<usize>()
                        .map_err(|_| "Invalid saved filter visibility")?;
                    if row <= area[0]
                        || row > area[2]
                        || hidden.last().is_some_and(|previous| *previous >= row)
                    {
                        return Err("Invalid saved filter visibility".into());
                    }
                    hidden.push(row);
                }
                field.hidden_rows = Some(hidden);
            }
        }
        if child(column, "filters").is_some()
            || !field.conditions.is_empty()
            || field.top.is_some()
            || field.dynamic.is_some()
            || field.color.is_some()
        {
            fields.insert(index, field);
        }
    }
    Ok(Some(Filter {
        column_visibility: flag(filter, "columnVisibility"),
        area,
        fields: Some(fields),
        show_buttons,
    }))
}

fn styles(
    nodes: &[xml::Node],
    colors: &super::colors::Palette,
    work: &mut usize,
) -> Result<Vec<Arc<Style>>, String> {
    let collect = |name: &str, item: &str| {
        elements(nodes, name)
            .first()
            .map(|e| elements(&e.children, item))
            .unwrap_or_default()
    };
    let fonts = collect("fonts", "font");
    let fills = collect("fills", "fill");
    let borders = collect("borders", "border");
    let mut result = Vec::new();
    for xf in collect("cellXfs", "xf") {
        *work = work.checked_sub(512).ok_or(LIMIT)?;
        let id = |name: &str| {
            attr(xf, name)
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(0)
        };
        let mut style = style_parts(
            fonts.get(id("fontId")).copied(),
            fills.get(id("fillId")).copied(),
            borders.get(id("borderId")).copied(),
            xf,
            colors,
            work,
        )?;
        // Complete styles replace inherited appearance. Default empty edges
        // add no information but can multiply across all 16,384 columns.
        // Differential styles below keep explicit removals for their overlay.
        style
            .borders
            .retain(|(_, line, color)| *line != 0 || color != "FF000000");
        result.push(Arc::new(style));
    }
    Ok(result)
}

fn style_parts(
    font: Option<&xml::Element>,
    fill: Option<&xml::Element>,
    border: Option<&xml::Element>,
    xf: &xml::Element,
    colors: &super::colors::Palette,
    work: &mut usize,
) -> Result<Style, String> {
    let mut style = Style::default();
    if let Some(font) = font {
        style.family = child(font, "name")
            .and_then(|e| attr(e, "val"))
            .unwrap_or("")
            .into();
        for (tag, key) in [("b", "Bold"), ("i", "Italic"), ("strike", "StrikeThrough")] {
            if let Some(el) = child(font, tag) {
                style.font.push((
                    key,
                    if matches!(attr(el, "val"), Some("0" | "false")) {
                        "0"
                    } else {
                        "1"
                    }
                    .into(),
                ));
            }
        }
        if let Some(size) = child(font, "sz").and_then(|e| number(e, "val")) {
            style.font.push(("Unit", size.to_string()));
        }
        if let Some(color) = child(font, "color").and_then(|el| colors.resolve(el)) {
            style.attributes.push(("Fore", color));
        }
        if let Some(underline) = child(font, "u") {
            let value = match attr(underline, "val").unwrap_or("single") {
                "single" => "1",
                "double" => "2",
                "singleAccounting" => "3",
                "doubleAccounting" => "4",
                _ => "0",
            };
            style.font.push(("Underline", value.into()));
        }
        if let Some(script) = child(font, "vertAlign").and_then(|e| attr(e, "val")) {
            style.font.push((
                "Script",
                match script {
                    "superscript" => "1",
                    "subscript" => "-1",
                    _ => "0",
                }
                .into(),
            ));
        }
    }
    if let Some(fill) = fill.and_then(|e| child(e, "patternFill")) {
        let patterns = [
            "none",
            "solid",
            "darkGray",
            "mediumGray",
            "lightGray",
            "gray125",
            "gray0625",
            "darkHorizontal",
            "darkVertical",
            "darkUp",
            "darkDown",
            "darkGrid",
            "darkTrellis",
            "lightHorizontal",
            "lightVertical",
            "lightDown",
            "lightUp",
            "lightGrid",
            "lightTrellis",
        ];
        if let Some(shade) =
            attr(fill, "patternType").and_then(|p| patterns.iter().position(|s| *s == p))
        {
            style.attributes.push(("Shade", shade.to_string()));
        }
        for (tag, key) in [("fgColor", "Back"), ("bgColor", "PatternColor")] {
            if let Some(color) = child(fill, tag).and_then(|el| colors.resolve(el)) {
                style.attributes.push((key, color));
            }
        }
    }
    if let Some(border) = border {
        let lines = [
            "none",
            "thin",
            "medium",
            "dashed",
            "dotted",
            "thick",
            "double",
            "hair",
            "mediumDashed",
            "dashDot",
            "mediumDashDot",
            "dashDotDot",
            "mediumDashDotDot",
            "slantDashDot",
        ];
        for (tag, alias, key) in [
            ("left", "start", "Left"),
            ("right", "end", "Right"),
            ("top", "top", "Top"),
            ("bottom", "bottom", "Bottom"),
        ] {
            if let Some(edge) = child(border, tag).or_else(|| child(border, alias)) {
                let line = attr(edge, "style")
                    .and_then(|s| lines.iter().position(|p| *p == s))
                    .unwrap_or(0) as u8;
                let color = child(edge, "color")
                    .and_then(|el| colors.resolve(el))
                    .unwrap_or_else(|| "FF000000".into());
                style.borders.push((key, line, color));
            }
        }
    }
    if let Some(alignment) = child(xf, "alignment") {
        for (name, key) in [
            ("horizontal", "HAlign"),
            ("vertical", "VAlign"),
            ("wrapText", "WrapText"),
            ("shrinkToFit", "ShrinkToFit"),
            ("indent", "Indent"),
        ] {
            if let Some(value) = attr(alignment, name) {
                style.attributes.push((key, value.into()));
            }
        }
        if let Some(rotation) = number(alignment, "textRotation") {
            style.attributes.push((
                "Rotation",
                if rotation > 90. && rotation <= 180. {
                    90. - rotation
                } else {
                    rotation
                }
                .to_string(),
            ));
        }
    }
    if let Some(protection) = child(xf, "protection") {
        for (name, key) in [("locked", "Locked"), ("hidden", "Hidden")] {
            if let Some(value) = attr(protection, name) {
                style.attributes.push((key, value.into()));
            }
        }
    }
    *work = work.checked_sub(style.retained_bytes()).ok_or(LIMIT)?;
    Ok(style)
}

pub(in super::super) fn differential_style(
    dxf: &xml::Element,
    colors: &super::colors::Palette,
    work: &mut usize,
) -> Result<(Style, Option<String>), String> {
    *work = work.checked_sub(512).ok_or(LIMIT)?;
    let mut style = style_parts(
        child(dxf, "font"),
        child(dxf, "fill"),
        child(dxf, "border"),
        dxf,
        colors,
        work,
    )?;
    // Excel preset differential fills use bgColor when fgColor is absent or automatic.
    // Unlike a regular pattern fill, that means the visible solid background.
    if let Some(fill) = child(dxf, "fill").and_then(|f| child(f, "patternFill")) {
        if child(fill, "fgColor")
            .and_then(|el| colors.resolve(el))
            .is_none()
            && attr(fill, "patternType").is_none_or(|s| s == "solid")
        {
            if let Some(color) = child(fill, "bgColor").and_then(|el| colors.resolve(el)) {
                style
                    .attributes
                    .retain(|(k, _)| !matches!(*k, "Shade" | "PatternColor"));
                style.attributes.push(("Shade", "1".into()));
                style.attributes.push(("Back", color));
            }
        }
    }
    let format = child(dxf, "numFmt")
        .and_then(|f| attr(f, "formatCode"))
        .map(str::to_owned);
    *work = work
        .checked_sub(format.as_ref().map_or(0, String::len))
        .ok_or(LIMIT)?;
    Ok((style, format))
}

fn differential_styles(
    nodes: &[xml::Node],
    colors: &super::colors::Palette,
    work: &mut usize,
) -> Result<Vec<(Style, Option<String>)>, String> {
    let mut result = Vec::new();
    for dxf in elements(nodes, "dxf") {
        result.push(differential_style(dxf, colors, work)?);
    }
    Ok(result)
}

pub(super) fn retain(
    imported: &mut Imported,
    entries: &BTreeMap<String, Vec<u8>>,
) -> Result<(), String> {
    let style_nodes = if let Some(path) = &imported.style_path {
        load(entries, path)?
    } else {
        Vec::new()
    };
    let theme_nodes = imported
        .theme_path
        .as_ref()
        .and_then(|path| load(entries, path).ok())
        .unwrap_or_default();
    let colors = super::colors::Palette::read(&theme_nodes, &style_nodes, &mut imported.remaining)?;
    let styles = styles(&style_nodes, &colors, &mut imported.remaining)?;
    imported.book.default_style = styles.first().cloned();
    let differential = differential_styles(&style_nodes, &colors, &mut imported.remaining)?;
    for (index, (_, path)) in imported.sources.iter().enumerate() {
        let nodes = load(entries, path)?;
        imported
            .book
            .conditional_formats
            .extend(super::super::conditional_xlsx::read(
                &nodes,
                index,
                &differential,
                &colors,
                &mut imported.remaining,
            )?);
        let sheet = &mut imported.sheets[index];
        sheet.filter = auto_filter(&nodes, &differential, &mut imported.remaining)?;
        if let Some(format) = elements(&nodes, "sheetFormatPr").first() {
            sheet.default_row_height = number(format, "defaultRowHeight").filter(|n| *n > 0.);
            sheet.default_column_width = number(format, "defaultColWidth")
                .filter(|n| *n > 0.)
                .map(|n| n * ((130. / 18.5703125) * (72. / 96.)))
                .filter(|n| n.is_finite());
        }
        let mut manual_rows = BTreeSet::new();
        let mut row_index = -1;
        for row in elements(&nodes, "row") {
            row_index = super::row_position(row, row_index);
            if !(0..1_048_576).contains(&row_index) {
                continue;
            }
            if flag(row, "manualHidden") {
                manual_rows.insert(row_index as usize);
            }
            let row_style = if flag(row, "customFormat") {
                attr(row, "s")
                    .and_then(|s| s.parse::<usize>().ok())
                    .and_then(|i| styles.get(i))
                    .cloned()
            } else {
                None
            };
            if attr(row, "ht").is_some()
                || flag(row, "hidden")
                || attr(row, "outlineLevel").is_some()
                || row_style.is_some()
            {
                imported.remaining = imported.remaining.checked_sub(128).ok_or(LIMIT)?;
                sheet.rows.insert(
                    row_index as usize,
                    Axis {
                        size: number(row, "ht").filter(|n| *n >= 0.),
                        hidden: flag(row, "hidden"),
                        level: number(row, "outlineLevel").unwrap_or(0.).clamp(0., 7.) as usize,
                        style: row_style,
                    },
                );
            }
            let mut column = -1;
            for cell in elements(&row.children, "c") {
                if let Some(position) = super::cell_position(cell, row_index, &mut column) {
                    let style = attr(cell, "s")
                        .and_then(|s| s.parse::<usize>().ok())
                        .and_then(|s| styles.get(s))
                        .cloned();
                    if let Some(typed) = sheet.cells.get_mut(&position) {
                        typed.style = style;
                    }
                }
            }
        }
        for col in elements(&nodes, "col") {
            let min = number(col, "min").unwrap_or(0.) as usize;
            let max = number(col, "max").unwrap_or(0.) as usize;
            if min == 0 || max < min || max > 16_384 {
                return Err("Invalid XLSX column range".into());
            }
            // The shared typed model stores points; XLSX stores character widths.
            let size = number(col, "width")
                .filter(|n| *n >= 0.)
                .map(|n| n * ((130. / 18.5703125) * (72. / 96.)));
            let axis = Axis {
                size,
                hidden: flag(col, "hidden"),
                level: number(col, "outlineLevel").unwrap_or(0.).clamp(0., 7.) as usize,
                style: attr(col, "style")
                    .and_then(|s| s.parse::<usize>().ok())
                    .and_then(|s| styles.get(s))
                    .cloned(),
            };
            for c in min - 1..max {
                imported.remaining = imported.remaining.checked_sub(128).ok_or(LIMIT)?;
                sheet.columns.insert(c, axis.clone());
            }
        }
        for merge in elements(&nodes, "mergeCell") {
            let [r, c, end_r, end_c] = attr(merge, "ref")
                .and_then(area)
                .ok_or("Invalid XLSX merged range")?;
            imported.remaining = imported.remaining.checked_sub(32).ok_or(LIMIT)?;
            sheet.merges.push([r, c, end_c - c + 1, end_r - r + 1]);
        }
        if let Some(view) = elements(&nodes, "sheetView").first() {
            if let Some(pane) = child(view, "pane")
                && matches!(attr(pane, "state"), Some("frozen" | "frozenSplit"))
            {
                // Excel and Google Sheets can write integer cell counts as
                // xsd:double (e.g. "2.0"). IronCalc rounds fractional splits.
                let split = |name, maximum: usize| {
                    number(pane, name)
                        .filter(|n| *n >= 0. && n.round() < maximum as f64)
                        .map_or(0, |n| n.round() as usize)
                };
                sheet.frozen_rows = split("ySplit", 1_048_576);
                sheet.frozen_columns = split("xSplit", 16_384);
            }
            for name in [
                "showGridLines",
                "showRowColHeaders",
                "showFormulas",
                "showZeros",
                "rightToLeft",
            ] {
                if attr(view, name).is_some() {
                    sheet.view.push((name, flag(view, name)));
                }
            }
        }
        sheet.validations = super::super::validation::read(&nodes, &mut imported.remaining)?;
        let (directory, name) = path.rsplit_once('/').unwrap_or(("", path));
        let rel_path = if directory.is_empty() {
            format!("_rels/{name}.rels")
        } else {
            format!("{directory}/_rels/{name}.rels")
        };
        let rels = if entries.contains_key(&rel_path) {
            load(entries, &rel_path)?
        } else {
            Vec::new()
        };
        let relationships: BTreeMap<_, _> = elements(&rels, "Relationship")
            .into_iter()
            .filter_map(|rel| attr(rel, "Id").map(|id| (id, rel)))
            .collect();
        for link in elements(&nodes, "hyperlink") {
            let reference = attr(link, "ref").ok_or("Missing XLSX hyperlink reference")?;
            area(reference).ok_or("Invalid XLSX hyperlink range")?;
            let relation = attr(link, "id")
                .map(|id| {
                    relationships
                        .get(id)
                        .copied()
                        .filter(|rel| attr(rel, "Type").is_some_and(|t| t.ends_with("/hyperlink")))
                        .ok_or("Missing XLSX hyperlink relationship")
                })
                .transpose()?;
            let target = relation
                .map(|rel| attr(rel, "Target").ok_or("Missing XLSX hyperlink target"))
                .transpose()?;
            let target_mode = relation.and_then(|rel| attr(rel, "TargetMode"));
            let location = attr(link, "location");
            if target.is_none() && location.is_none() {
                return Err("Missing XLSX hyperlink destination".into());
            }
            let display = attr(link, "display");
            let tooltip = attr(link, "tooltip");
            imported.remaining = imported
                .remaining
                .checked_sub(
                    256 + reference.len()
                        + [target, target_mode, location, display, tooltip]
                            .into_iter()
                            .flatten()
                            .map(str::len)
                            .sum::<usize>(),
                )
                .ok_or(LIMIT)?;
            sheet.hyperlinks.push(super::super::model::Hyperlink {
                reference: reference.into(),
                target: target.map(str::to_owned),
                target_mode: target_mode.map(str::to_owned),
                location: location.map(str::to_owned),
                display: display.map(str::to_owned),
                tooltip: tooltip.map(str::to_owned),
            });
        }
        for relation in elements(&rels, "Relationship") {
            if attr(relation, "TargetMode") == Some("External") {
                continue;
            }
            if !attr(relation, "Type").is_some_and(|s| s.ends_with("/table")) {
                continue;
            }
            let Some(target) = attr(relation, "Target") else {
                continue;
            };
            let target = crate::vfs::resolve_posix_path(&format!("/{directory}"), target);
            let nodes = load(entries, &target)?;
            let table = elements(&nodes, "table")
                .first()
                .copied()
                .ok_or("Missing XLSX table")?;
            let area = attr(table, "ref")
                .and_then(area)
                .ok_or("Invalid XLSX table range")?;
            let name = attr(table, "displayName")
                .or_else(|| attr(table, "name"))
                .ok_or("Missing XLSX table name")?;
            imported.remaining = imported
                .remaining
                .checked_sub(name.len() + 256)
                .ok_or(LIMIT)?;
            let mut calculated_columns = BTreeMap::new();
            for (index, column) in elements(&table.children, "tableColumn")
                .into_iter()
                .enumerate()
            {
                if let Some(formula) = child(column, "calculatedColumnFormula") {
                    let source = super::text(formula);
                    imported.remaining = imported
                        .remaining
                        .checked_sub(source.len() + 128)
                        .ok_or(LIMIT)?;
                    calculated_columns.insert(
                        index,
                        CalculatedColumn {
                            formula: source,
                            array: flag(formula, "array"),
                            origin_row: None,
                        },
                    );
                }
            }
            let style = child(table, "tableStyleInfo")
                .map(|style| {
                    let name = attr(style, "name");
                    imported.remaining = imported
                        .remaining
                        .checked_sub(name.map_or(0, str::len) + 128)
                        .ok_or(LIMIT)?;
                    Ok::<_, String>(TableStyle {
                        name: name.map(str::to_owned),
                        show_first_column: flag(style, "showFirstColumn"),
                        show_last_column: flag(style, "showLastColumn"),
                        show_row_stripes: flag(style, "showRowStripes"),
                        show_column_stripes: flag(style, "showColumnStripes"),
                    })
                })
                .transpose()?;
            imported.book.tables.push(Table {
                style,
                calculated_columns,
                columns: elements(&table.children, "tableColumn")
                    .into_iter()
                    .map(|column| {
                        attr(column, "name")
                            .map(str::to_owned)
                            .ok_or("Missing XLSX table column name".to_owned())
                    })
                    .collect::<Result<_, _>>()?,
                totals: attr(table, "totalsRowCount").is_some_and(|v| v != "0"),
                name: name.into(),
                sheet: index,
                area,
                header: attr(table, "headerRowCount") != Some("0"),
                filter: auto_filter(&table.children, &differential, &mut imported.remaining)?,
            });
        }
        // The standard row flag remains readable by Excel. Our ignorable
        // snapshots preserve manual hiding when this editor reopens the file.
        for filter in sheet
            .filter
            .iter()
            .chain(
                imported
                    .book
                    .tables
                    .iter()
                    .filter(|t| t.sheet == index)
                    .filter_map(|t| t.filter.as_ref()),
            )
            .filter(|filter| filter.column_visibility)
        {
            for field in filter.fields.iter().flat_map(|fields| fields.values()) {
                for row in field.hidden_rows.iter().flatten() {
                    if !manual_rows.contains(row) {
                        if let Some(axis) = sheet.rows.get_mut(row) {
                            axis.hidden = false;
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn date_group_attributes_roundtrip_and_invalid_dates_fail_import() {
        for (attributes, parts) in [
            (r#"dateTimeGrouping="year" year="2024""#, vec![2024]),
            (
                r#"dateTimeGrouping="month" year="2024" month="2""#,
                vec![2024, 2],
            ),
            (
                r#"dateTimeGrouping="day" year="1900" month="2" day="29""#,
                vec![1900, 2, 29],
            ),
            (
                r#"dateTimeGrouping="hour" year="2024" month="2" day="29" hour="12""#,
                vec![2024, 2, 29, 12],
            ),
            (
                r#"dateTimeGrouping="minute" year="2024" month="2" day="29" hour="12" minute="34""#,
                vec![2024, 2, 29, 12, 34],
            ),
            (
                r#"dateTimeGrouping="second" year="2024" month="2" day="29" hour="12" minute="34" second="56""#,
                vec![2024, 2, 29, 12, 34, 56],
            ),
        ] {
            let source = format!(
                r#"<autoFilter ref="A1:A5"><filterColumn colId="0"><filters blank="1"><filter val="keep"/><dateGroupItem {attributes}/></filters></filterColumn></autoFilter>"#
            );
            let nodes = xml::parse(&source, None, None).unwrap().nodes;
            let parsed = auto_filter(&nodes, &[], &mut 1_000_000).unwrap().unwrap();
            assert_eq!(parsed.fields.as_ref().unwrap()[&0].date_groups, vec![parts]);
            let expected = parsed.fields.as_ref().unwrap()[&0].date_groups.clone();
            let mut book = super::super::super::Spreadsheet::new();
            book.sheets[0].filter = Some(parsed);
            let book =
                super::super::super::Spreadsheet::from_json(&book.to_json(), 1_000_000).unwrap();
            let book = super::super::super::Spreadsheet::import_xlsx(
                &book.export_xlsx(1_000_000).unwrap(),
                1_000_000,
            )
            .unwrap();
            let restored = book.sheets[0].filter.as_ref().unwrap();
            assert_eq!(restored.fields.as_ref().unwrap()[&0].date_groups, expected);
            assert_eq!(
                restored.fields.as_ref().unwrap()[&0].conditions,
                vec![("equal", "".into()), ("equal", "keep".into())]
            );
        }
        for attributes in [
            r#"year="2024""#,
            r#"dateTimeGrouping="quarter" year="2024""#,
            r#"dateTimeGrouping="month" year="2024""#,
            r#"dateTimeGrouping="day" year="2023" month="2" day="29""#,
            r#"dateTimeGrouping="day" year="2024" month="2" day="30""#,
            r#"dateTimeGrouping="year" year="NaN""#,
            r#"dateTimeGrouping="year" year="10000""#,
            r#"dateTimeGrouping="hour" year="2024" month="2" day="29" hour="24""#,
        ] {
            let source = format!(
                r#"<autoFilter ref="A1:A5"><filterColumn colId="0"><filters><dateGroupItem {attributes}/></filters></filterColumn></autoFilter>"#
            );
            let nodes = xml::parse(&source, None, None).unwrap().nodes;
            if let Ok(Some(parsed)) = auto_filter(&nodes, &[], &mut 1_000_000) {
                assert!(
                    !super::super::super::editor_filter::valid(&parsed),
                    "{source}"
                );
            }
        }
    }

    #[test]
    fn top_filter_attributes_roundtrip_and_invalid_ranks_fail_import() {
        for (attributes, rank, percent, bottom) in [
            (r#"val="4""#, 4., false, false),
            (r#"val="25" top="0" percent="1""#, 25., true, true),
            (r#"val="2.5" top="true" percent="false""#, 2.5, false, false),
        ] {
            let source = format!(
                r#"<autoFilter ref="A1:A5"><filterColumn colId="0"><top10 {attributes}/></filterColumn></autoFilter>"#
            );
            let nodes = xml::parse(&source, None, None).unwrap().nodes;
            let filter = auto_filter(&nodes, &[], &mut 100_000).unwrap().unwrap();
            let mut book = super::super::super::Spreadsheet::new();
            book.sheets[0].filter = Some(filter);
            let book =
                super::super::super::Spreadsheet::from_json(&book.to_json(), 1_000_000).unwrap();
            let book = super::super::super::Spreadsheet::import_xlsx(
                &book.export_xlsx(1_000_000).unwrap(),
                1_000_000,
            )
            .unwrap();
            let top = book.sheets[0]
                .filter
                .as_ref()
                .unwrap()
                .fields
                .as_ref()
                .unwrap()[&0]
                .top
                .as_ref()
                .unwrap();
            assert_eq!((top.rank, top.percent, top.bottom), (rank, percent, bottom));
        }
        for rank in ["", "NaN", "inf", "0", "-1", "501", "text"] {
            let source = format!(
                r#"<autoFilter ref="A1:A5"><filterColumn colId="0"><top10 val="{rank}"/></filterColumn></autoFilter>"#
            );
            let nodes = xml::parse(&source, None, None).unwrap().nodes;
            if let Ok(Some(filter)) = auto_filter(&nodes, &[], &mut 100_000) {
                assert!(
                    !super::super::super::editor_filter::valid(&filter),
                    "{rank}"
                );
            }
        }
    }
    #[test]
    fn dynamic_filter_import_validates_types_and_numeric_thresholds() {
        for attributes in [
            r#"type="today""#,
            r#"type="aboveAverage" val="2.5""#,
            r#"type="thisMonth" val="46000" maxVal="46031""#,
            r#"type="M12""#,
            r#"type="Q4""#,
            r#"type="null""#,
        ] {
            let source = format!(
                r#"<autoFilter ref="A1:A5"><filterColumn colId="0"><dynamicFilter {attributes}/></filterColumn></autoFilter>"#
            );
            let nodes = xml::parse(&source, None, None).unwrap().nodes;
            let filter = auto_filter(&nodes, &[], &mut 100_000).unwrap().unwrap();
            assert!(
                super::super::super::editor_filter::valid(&filter),
                "{attributes}"
            );
            assert!(filter.fields.as_ref().unwrap()[&0].dynamic.is_some());
        }
        for attributes in [
            "",
            r#"type="missing""#,
            r#"type="M13""#,
            r#"type="Q0""#,
            r#"type="today" val="NaN""#,
            r#"type="today" maxVal="inf""#,
            r#"type="aboveAverage" val="text""#,
        ] {
            let source = format!(
                r#"<autoFilter ref="A1:A5"><filterColumn colId="0"><dynamicFilter {attributes}/></filterColumn></autoFilter>"#
            );
            let nodes = xml::parse(&source, None, None).unwrap().nodes;
            if let Ok(Some(filter)) = auto_filter(&nodes, &[], &mut 100_000) {
                assert!(
                    !super::super::super::editor_filter::valid(&filter),
                    "{attributes}"
                );
            }
        }
    }
    #[test]
    fn custom_equal_filter_keeps_wildcards_and_conjunction() {
        let nodes=xml::parse(r#"<autoFilter ref="B1:B5"><filterColumn colId="0"><customFilters><customFilter operator="equal" val="a*"/></customFilters></filterColumn></autoFilter>"#,None,None).unwrap().nodes;
        let filter = auto_filter(&nodes, &[], &mut 100_000).unwrap().unwrap();
        let mut book = super::super::super::Spreadsheet::new();
        book.sheets[0].filter = Some(filter);
        let source = book.to_json();
        let book = super::super::super::Spreadsheet::from_json(&source, 1_000_000).unwrap();
        let bytes = book.export_xlsx(1_000_000).unwrap();
        let parts = crate::commands::structured::read_office_archive(&bytes);
        let output = std::str::from_utf8(&parts["xl/worksheets/sheet1.xml"]).unwrap();
        assert!(output.contains("<customFilters"), "{output}");
        assert!(output.contains(r#"operator="equal" val="a*""#));
    }
    #[test]
    fn saved_filter_rows_reject_invalid_geometry_and_exhausted_budget() {
        for rows in ["0", "5", "2,2", "3,2", "-1", "not-a-row"] {
            let source = format!(
                r#"<autoFilter ref="A1:A5" xmlns:ssc="urn:poe-code:spreadsheet:filters:1" ssc:columnVisibility="1"><filterColumn colId="0" ssc:hiddenRows="{rows}"><filters/></filterColumn></autoFilter>"#
            );
            let nodes = xml::parse(&source, None, None).unwrap().nodes;
            assert!(auto_filter(&nodes, &[], &mut 100_000).is_err(), "{rows}");
        }
        let nodes = xml::parse(r#"<autoFilter ref="A1:A5" xmlns:ssc="urn:poe-code:spreadsheet:filters:1" ssc:columnVisibility="1"><filterColumn colId="0" ssc:hiddenRows="1,3"><filters/></filterColumn></autoFilter>"#, None, None).unwrap().nodes;
        assert!(auto_filter(&nodes, &[], &mut 280).is_err());
        let filter = auto_filter(&nodes, &[], &mut 100_000).unwrap().unwrap();
        assert!(filter.column_visibility);
        assert_eq!(
            filter.fields.unwrap()[&0].hidden_rows.as_deref(),
            Some([1, 3].as_slice())
        );
    }
    #[test]
    fn color_filters_resolve_differential_colors_and_reject_invalid_references() {
        let styles = xml::parse(r#"<styleSheet><dxfs>
            <dxf><fill><patternFill><bgColor rgb="FF81D41A"/></patternFill></fill></dxf>
            <dxf><font><color theme="9"/></font></dxf>
            <dxf><fill><patternFill patternType="none"><fgColor rgb="FFFF0000"/></patternFill></fill></dxf>
        </dxfs></styleSheet>"#, None, None).unwrap().nodes;
        let colors = super::super::colors::Palette::read(&[], &[], &mut 100_000).unwrap();
        let differential = differential_styles(&styles, &colors, &mut 100_000).unwrap();
        for (attributes, font, expected) in [
            (r#"dxfId="0""#, false, Some("FF81D41A")),
            (r#"dxfId="0" cellColor="0""#, true, Some("FF81D41A")),
            (r#"dxfId="1" cellColor="false""#, true, Some("FF70AD47")),
            (r#"dxfId="2" cellColor="true""#, false, None),
        ] {
            let nodes = xml::parse(&format!(r#"<autoFilter ref="A1:A3"><filterColumn colId="0"><colorFilter {attributes}/></filterColumn></autoFilter>"#),None,None).unwrap().nodes;
            let filter = auto_filter(&nodes, &differential, &mut 100_000)
                .unwrap()
                .unwrap();
            assert_eq!(
                filter.fields.unwrap()[&0].color,
                Some(ColorFilter {
                    font,
                    color: expected.map(str::to_owned)
                })
            );
        }
        for criteria in [
            r#"<colorFilter/>"#,
            r#"<colorFilter dxfId="-1"/>"#,
            r#"<colorFilter dxfId="3"/>"#,
            r#"<colorFilter dxfId="0" cellColor="yes"/>"#,
            r#"<colorFilter dxfId="0"/><filters/>"#,
        ] {
            let nodes=xml::parse(&format!(r#"<autoFilter ref="A1:A3"><filterColumn colId="0">{criteria}</filterColumn></autoFilter>"#),None,None).unwrap().nodes;
            assert!(
                auto_filter(&nodes, &differential, &mut 100_000).is_err(),
                "{criteria}"
            );
        }
    }
}

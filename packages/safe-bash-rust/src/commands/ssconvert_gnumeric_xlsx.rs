use super::{element, precision, xlsx};
use crate::commands::{
    archive::office::{
        coordinate, xml_attribute as attr, xml_elements as elements, xml_text as text,
    },
    structured::xml::Node,
};

pub(super) fn hyperlinks(raw: &[Node], relations: &[Node]) -> Vec<([usize; 4], String)> {
    let mut links = Vec::new();
    for link in elements(raw, "hyperlink") {
        let Some(reference) = attr(link, "ref") else {
            continue;
        };
        let (start, end) = reference.split_once(':').unwrap_or((reference, reference));
        let (Some((row, col)), Some((end_row, end_col))) = (coordinate(start), coordinate(end))
        else {
            continue;
        };
        let id = attr(link, "id");
        let location = attr(link, "location");
        let external = elements(relations, "Relationship").into_iter().find(|r| {
            id.is_some() && attr(r, "Id") == id && attr(r, "TargetMode") == Some("External")
                && attr(r, "Type") == Some("http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink")
        });
        let (kind, target) = if let Some(target) = external.and_then(|r| attr(r, "Target")) {
            let lower = target.to_ascii_lowercase();
            let kind = if lower.starts_with("mailto:") {
                "GnmHLinkEMail"
            } else if lower.starts_with("http:") || lower.starts_with("https:") {
                "GnmHLinkURL"
            } else {
                "GnmHLinkExternal"
            };
            (
                kind,
                format!(
                    "{target}{}",
                    location.map_or(String::new(), |s| format!("#{s}"))
                ),
            )
        } else if let Some(location) = location.filter(|s| !s.is_empty() && id.is_none()) {
            ("GnmHLinkCurWB", location.into())
        } else {
            continue;
        };
        let mut attrs = vec![("type", kind.into()), ("target", target)];
        if let Some(tip) = attr(link, "tooltip") {
            attrs.push(("tip", tip.into()));
        }
        links.push((
            [row, col, end_row, end_col],
            element("HyperLink", &attrs, "", "", 6),
        ));
    }
    links
}

pub(super) fn view(raw: &[Node], attrs: &mut Vec<(&str, String)>) {
    if let Some(view) = crate::commands::archive::office::xlsx_gnumeric::sheet_view(raw) {
        for (source, target, invert) in [
            ("showFormulas", "DisplayFormulas", false),
            ("showZeros", "HideZero", true),
            ("showGridLines", "HideGrid", true),
            ("showRowColHeaders", "HideColHeader", true),
            ("showRowColHeaders", "HideRowHeader", true),
            ("showOutlineSymbols", "DisplayOutlines", false),
            ("rightToLeft", "RTL_Layout", false),
        ] {
            if let Some(value) = super::super::gnumeric_read::attr(view, source) {
                let value = u8::from(matches!(value, "1" | "true") != invert).to_string();
                if let Some((_, old)) = attrs.iter_mut().find(|(k, _)| *k == target) {
                    *old = value;
                } else {
                    attrs.push((target, value));
                }
            }
        }
    }
    if let Some(protection) = elements(raw, "sheetProtection").first() {
        attrs.push((
            "Protected",
            u8::from(matches!(attr(protection, "sheet"), Some("1" | "true"))).to_string(),
        ));
    }
}
pub(super) fn print(raw: &[Node]) -> String {
    use crate::commands::structured::ssconvert::gnumeric_read::attr;
    let mut body = String::new();
    if let Some(options) = elements(raw, "printOptions").first() {
        for (source, target) in [
            ("headings", "titles"),
            ("gridLines", "grid"),
            ("horizontalCentered", "hcenter"),
            ("verticalCentered", "vcenter"),
        ] {
            if let Some(value) = attr(options, source) {
                body.push_str(&element(
                    target,
                    &[("value", u8::from(matches!(value, "1" | "true")).to_string())],
                    "",
                    "",
                    4,
                ));
            }
        }
    }
    if let Some(margins) = elements(raw, "pageMargins").first() {
        let mut fields = String::new();
        for name in ["top", "bottom", "left", "right", "header", "footer"] {
            if let Some(value) = attr(margins, name).map(|s| crate::commands::js_number(s, 0.)) {
                fields.push_str(&element(
                    name,
                    &[
                        ("Points", precision(value * 72.)),
                        ("PrefUnit", "mm".into()),
                    ],
                    "",
                    "",
                    5,
                ));
            }
        }
        body.push_str(&element("Margins", &[], "", &fields, 4));
    }
    if let Some(setup) = elements(raw, "pageSetup").first() {
        if let Some(copies) = attr(setup, "copies") {
            body.push_str(&element(
                "copies",
                &[(
                    "value",
                    xlsx::attribute_number(crate::commands::js_number(copies, 0.)),
                )],
                "",
                "",
                4,
            ));
        }
        let first = matches!(attr(setup, "useFirstPageNumber"), Some("1" | "true"));
        body.push_str(&element(
            "use_first_page_number",
            &[("value", u8::from(first).to_string())],
            "",
            "",
            4,
        ));
        if first || attr(setup, "firstPageNumber").is_some() {
            body.push_str(&element(
                "first_page_number",
                &[(
                    "value",
                    xlsx::attribute_number(crate::commands::js_number(
                        attr(setup, "firstPageNumber").unwrap_or("1"),
                        0.,
                    )),
                )],
                "",
                "",
                4,
            ));
        }
        let fit = elements(raw, "pageSetUpPr")
            .first()
            .is_some_and(|e| matches!(attr(e, "fitToPage"), Some("1" | "true")));
        let scale = if fit {
            vec![
                ("type", "fit".into()),
                (
                    "rows",
                    xlsx::attribute_number(crate::commands::js_number(
                        attr(setup, "fitToHeight").unwrap_or("1"),
                        0.,
                    )),
                ),
                (
                    "cols",
                    xlsx::attribute_number(crate::commands::js_number(
                        attr(setup, "fitToWidth").unwrap_or("1"),
                        0.,
                    )),
                ),
            ]
        } else {
            vec![
                ("type", "percentage".into()),
                (
                    "percentage",
                    xlsx::attribute_number(crate::commands::js_number(
                        attr(setup, "scale").unwrap_or("100"),
                        0.,
                    )),
                ),
            ]
        };
        body.push_str(&element("Scale", &scale, "", "", 4));
        for (source, target) in [("blackAndWhite", "monochrome"), ("draft", "draft")] {
            if let Some(value) = attr(setup, source) {
                body.push_str(&element(
                    target,
                    &[("value", u8::from(matches!(value, "1" | "true")).to_string())],
                    "",
                    "",
                    4,
                ));
            }
        }
        body.push_str(&element(
            "order",
            &[],
            if attr(setup, "pageOrder") == Some("overThenDown") {
                "r_then_d"
            } else {
                "d_then_r"
            },
            "",
            4,
        ));
        if let Some(value) = attr(setup, "orientation") {
            if matches!(value, "portrait" | "landscape" | "default") {
                body.push_str(&element(
                    "orientation",
                    &[],
                    if value == "default" {
                        "portrait"
                    } else {
                        value
                    },
                    "",
                    4,
                ));
            }
        }
        if let Some(paper) = match attr(setup, "paperSize") {
            Some("9") => Some("iso_a4"),
            Some("1") => Some("na_letter"),
            _ => None,
        } {
            body.push_str(&element("paper", &[], paper, "", 4));
        }
        if let Some(mode) = match attr(setup, "cellComments") {
            Some("asDisplayed") => Some("GNM_PRINT_COMMENTS_IN_PLACE"),
            Some("atEnd") => Some("GNM_PRINT_COMMENTS_AT_END"),
            Some("none") => Some("GNM_PRINT_COMMENTS_NONE"),
            _ => None,
        } {
            body.push_str(&element(
                "comments",
                &[("placement", mode.into())],
                "",
                "",
                4,
            ));
        }
        if let Some(mode) = match attr(setup, "errors") {
            Some("blank") => Some("GNM_PRINT_ERRORS_AS_BLANK"),
            Some("dash") => Some("GNM_PRINT_ERRORS_AS_DASHES"),
            Some("NA") => Some("GNM_PRINT_ERRORS_AS_NA"),
            Some("displayed") => Some("GNM_PRINT_ERRORS_AS_DISPLAYED"),
            _ => None,
        } {
            body.push_str(&element(
                "errors",
                &[("PrintErrorsAs", mode.into())],
                "",
                "",
                4,
            ));
        }
    }
    for (source, target) in [("oddHeader", "Header"), ("oddFooter", "Footer")] {
        let value = elements(raw, source)
            .first()
            .map(|e| crate::commands::archive::office::xlsx_string::decode(&text(e)))
            .unwrap_or_default();
        let mut sections = [String::new(), String::new(), String::new()];
        let mut current = 0;
        let mut chars = value.chars();
        while let Some(c) = chars.next() {
            if c != '&' {
                sections[current].push(c);
                continue;
            }
            match chars.next() {
                Some('L') => current = 0,
                Some('C') => current = 1,
                Some('R') => current = 2,
                Some('&') => sections[current].push('&'),
                Some(c) => {
                    if let Some(key) = match c {
                        'P' => Some("PAGE"),
                        'N' => Some("PAGES"),
                        'D' => Some("DATE"),
                        'T' => Some("TIME"),
                        'A' => Some("TAB"),
                        'F' => Some("FILE"),
                        'Z' => Some("PATH"),
                        _ => None,
                    } {
                        sections[current].push_str(&format!("&[{key}]"));
                    } else {
                        sections[current].push('&');
                        sections[current].push(c);
                    }
                }
                None => sections[current].push('&'),
            }
        }
        body.push_str(&element(
            target,
            &["Left", "Middle", "Right"]
                .into_iter()
                .zip(sections)
                .collect::<Vec<_>>(),
            "",
            "",
            4,
        ));
    }
    for (source, target) in [("rowBreaks", "hPageBreaks"), ("colBreaks", "vPageBreaks")] {
        if let Some(node) = elements(raw, source).first() {
            let nodes = elements(&node.children, "brk");
            let parts = nodes
                .iter()
                .map(|e| {
                    element(
                        "break",
                        &[
                            (
                                "pos",
                                xlsx::attribute_number(crate::commands::js_number(
                                    attr(e, "id").unwrap_or("0"),
                                    0.,
                                )),
                            ),
                            (
                                "type",
                                if matches!(attr(e, "pt"), Some("1" | "true")) {
                                    "data-slice"
                                } else if matches!(attr(e, "man"), Some("1" | "true")) {
                                    "manual"
                                } else {
                                    "auto"
                                }
                                .into(),
                            ),
                        ],
                        "",
                        "",
                        5,
                    )
                })
                .collect::<String>();
            body.push_str(&element(
                target,
                &[("count", nodes.len().to_string())],
                "",
                &parts,
                4,
            ));
        }
    }
    element("PrintInformation", &[], "", &body, 3)
}
pub(super) fn axes(sheet: &xlsx::Sheet<String>, raw: &[Node]) -> Result<String, String> {
    let defaults = crate::commands::archive::office::xlsx_gnumeric::default_dimensions(raw)?;
    let mut result = String::new();
    for (name, info, axes) in [
        ("Cols", "ColInfo", &sheet.columns),
        ("Rows", "RowInfo", &sheet.rows),
    ] {
        let mut attrs = Vec::new();
        let size = defaults[usize::from(name == "Rows")];
        if let Some(size) = size {
            attrs.push(("DefaultSizePts", precision(size)));
        }
        let mut parts = String::new();
        for (&index, axis) in axes {
            let raw_axis = if name == "Cols" {
                elements(raw, "col").into_iter().rev().find(|e| {
                    attr(e, "min")
                        .and_then(|s| s.parse::<usize>().ok())
                        .is_some_and(|n| index + 1 >= n)
                        && attr(e, "max")
                            .and_then(|s| s.parse::<usize>().ok())
                            .is_some_and(|n| index < n)
                })
            } else {
                elements(raw, "row")
                    .into_iter()
                    .find(|e| attr(e, "r").and_then(|s| s.parse::<usize>().ok()) == Some(index + 1))
            };
            let collapsed =
                raw_axis.is_some_and(|e| matches!(attr(e, "collapsed"), Some("1" | "true")));
            if axis.size.is_none() && !axis.hidden && axis.level == 0 && !collapsed {
                continue;
            }
            let mut fields = Vec::new();
            if let Some(axis) = raw_axis.filter(|_| axis.size.is_some()) {
                fields.push((
                    "HardSize",
                    u8::from(matches!(
                        attr(
                            axis,
                            if name == "Cols" {
                                "customWidth"
                            } else {
                                "customHeight"
                            }
                        ),
                        Some("1" | "true")
                    ))
                    .to_string(),
                ));
            }
            let size =
                axis.size
                    .unwrap_or(size.unwrap_or(if name == "Cols" { 48. } else { 12.75 }));
            if !size.is_finite() || size <= 0. {
                return Err("Unsupported ssconvert feature: Gnumeric XML axis size must be positive and finite\n".into());
            }
            fields.extend([("No", index.to_string()), ("Unit", precision(size))]);
            if axis.hidden {
                fields.push(("Hidden", "1".into()));
            }
            if collapsed {
                fields.push(("Collapsed", "1".into()));
            }
            if axis.level != 0 {
                fields.push(("OutlineLevel", axis.level.to_string()));
            }
            parts.push_str(&element(info, &fields, "", "", 4));
        }
        result.push_str(&element(name, &attrs, "", &parts, 3));
    }
    Ok(result)
}
pub(super) fn layout(raw: &[Node]) -> String {
    let Some(view) = crate::commands::archive::office::xlsx_gnumeric::sheet_view(raw) else {
        return String::new();
    };
    let top = attr(view, "topLeftCell").unwrap_or("A1");
    let mut visible_top = top;
    let mut parts = String::new();
    if let Some(pane) = elements(&view.children, "pane")
        .first()
        .filter(|p| attr(p, "state") == Some("frozen"))
    {
        visible_top = attr(pane, "topLeftCell").unwrap_or(top);
        if let Some((row, col)) = crate::commands::archive::office::coordinate(top) {
            let y = attr(pane, "ySplit")
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(0);
            let x = attr(pane, "xSplit")
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(0);
            parts = element(
                "FreezePanes",
                &[
                    ("FrozenTopLeft", top.into()),
                    (
                        "UnfrozenTopLeft",
                        format!(
                            "{}{}",
                            super::super::xlsx_idx_to_col_ref(col + x),
                            row + y + 1
                        ),
                    ),
                ],
                "",
                "",
                4,
            );
        }
    }
    element(
        "SheetLayout",
        &[("TopLeft", visible_top.into())],
        "",
        &parts,
        3,
    )
}

pub(super) fn filters(raw: &[Node]) -> String {
    let filters = elements(raw, "autoFilter");
    let Some(filter) = filters.first() else {
        return String::new();
    };
    let Some(area) = attr(filter, "ref") else {
        return String::new();
    };
    let mut fields = String::new();
    for column in elements(&filter.children, "filterColumn") {
        let index = attr(column, "colId").unwrap_or("0");
        let mut field = None;
        for node in &column.children {
            let Node::Element(node) = node else { continue };
            match node.tag.rsplit(':').next().unwrap() {
                "customFilters" => {
                    for custom in elements(&node.children, "customFilter") {
                        let value = attr(custom, "val").unwrap_or("");
                        let parsed = if value.trim().is_empty() {
                            f64::NAN
                        } else {
                            crate::commands::js_number(value, f64::NAN)
                        };
                        let op = match attr(custom, "operator").unwrap_or("equal") {
                            "notEqual" => "ne",
                            "greaterThan" => "gt",
                            "greaterThanOrEqual" => "gte",
                            "lessThan" => "lt",
                            "lessThanOrEqual" => "lte",
                            _ => "eq",
                        };
                        field = Some(vec![
                            ("Index", index.into()),
                            ("Type", "expr".into()),
                            ("Op0", op.into()),
                            (
                                "Value0",
                                if parsed.is_finite() { "40" } else { "60" }.into(),
                            ),
                            (
                                "ValueType0",
                                if parsed.is_finite() {
                                    super::formulas::Value::Number(parsed).cached()
                                } else {
                                    value.into()
                                },
                            ),
                        ]);
                    }
                }
                "top10" => {
                    field = Some(vec![
                        ("Index", index.into()),
                        ("Type", "bucket".into()),
                        (
                            "top",
                            u8::from(!matches!(attr(node, "top"), Some("0" | "false"))).to_string(),
                        ),
                        (
                            "items",
                            u8::from(!matches!(attr(node, "percent"), Some("1" | "true")))
                                .to_string(),
                        ),
                        ("rel_range", "0".into()),
                        ("count", attr(node, "val").unwrap_or("-1").into()),
                    ])
                }
                _ => {}
            }
        }
        if let Some(attrs) = field {
            fields.push_str(&element("Field", &attrs, "", "", 5));
        }
    }
    element(
        "Filters",
        &[],
        "",
        &element("Filter", &[("Area", area.into())], "", &fields, 4),
        3,
    )
}

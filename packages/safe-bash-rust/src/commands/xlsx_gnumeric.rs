use super::{escaped, number};
use crate::commands::structured::{
    ssconvert::gnumeric_read::{attr, children},
    xml::Element,
};
use std::{collections::BTreeMap, fmt::Write};

pub(in super::super) fn print(
    sheet: Option<&Element>,
    settings: &super::Print,
    empty_headers: bool,
) -> Result<(u8, String), String> {
    let pi = sheet.and_then(|n| children(n, "PrintInformation").next());
    let child = |name| pi.and_then(|n| children(n, name).next());
    let field = |name, key| child(name).and_then(|n| attr(n, key));
    let numeric = |name, key, fallback| {
        field(name, key).map_or(fallback, |value| crate::commands::js_number(value, 0.))
    };
    let first = field("first_page_number", "value");
    let start = first.map(|value| crate::commands::js_number(value, 0.));
    if start.is_some_and(|value| {
        !value.is_finite() || value.fract() != 0. || !(-1. ..=4294967295.).contains(&value)
    }) {
        return Err("Invalid XLSX first page number\n".into());
    }
    let (fit, width, height, scale) = if pi.is_some() {
        let fit = matches!(field("Scale", "type"), Some("fit" | "size_fit"));
        (
            u8::from(fit),
            if fit {
                numeric("Scale", "cols", 0.)
            } else {
                0.
            },
            if fit {
                numeric("Scale", "rows", 0.)
            } else {
                0.
            },
            numeric("Scale", "percentage", 100.),
        )
    } else {
        match settings.scale {
            Some(super::Scale::Fit(w, h)) => (1, w, h, 100.),
            Some(super::Scale::Percentage(s)) => (0, 0., 0., s),
            None => (0, 0., 0., 100.),
        }
    };
    let mut output = String::from("<printOptions");
    for (source, target) in [
        ("titles", "headings"),
        ("grid", "gridLines"),
        ("hcenter", "horizontalCentered"),
        ("vcenter", "verticalCentered"),
    ] {
        let value = numeric(source, "value", 0.);
        if value != 0. && !value.is_nan() {
            write!(output, r#" {target}="1""#).unwrap();
        }
    }
    output.push_str("/><pageMargins");
    let mut margins = [72., 72., 120., 120., 72., 72.];
    let names = ["left", "right", "top", "bottom", "header", "footer"];
    if let Some(source) = child("Margins") {
        for (index, name) in names.iter().enumerate() {
            for margin in children(source, name) {
                margins[index] =
                    attr(margin, "Points").map_or(f64::NAN, |v| crate::commands::js_number(v, 0.));
            }
        }
    } else if pi.is_none()
        && let Some(source) = settings.margins
    {
        for (index, value) in source.iter().enumerate() {
            if let Some(value) = value {
                margins[index] = *value;
            }
        }
    }
    for (name, value) in names.into_iter().zip(margins) {
        write!(
            output,
            r#" {name}="{}""#,
            super::attribute_number(value / 72.)
        )
        .unwrap();
    }
    output.push_str("/><pageSetup");
    let mut setup = vec![
        (
            "blackAndWhite",
            super::attribute_number(numeric("monochrome", "value", 0.)),
        ),
        (
            "cellComments",
            match field("comments", "placement") {
                Some("GNM_PRINT_COMMENTS_AT_END") => "atEnd",
                Some("GNM_PRINT_COMMENTS_NONE") => "none",
                _ => "asDisplayed",
            }
            .into(),
        ),
        (
            "draft",
            super::attribute_number(numeric("draft", "value", 0.)),
        ),
        (
            "errors",
            match field("errors", "PrintErrorsAs") {
                Some("GNM_PRINT_ERRORS_AS_BLANK") => "blank",
                Some("GNM_PRINT_ERRORS_AS_DASHES") => "dash",
                Some("GNM_PRINT_ERRORS_AS_NA") => "NA",
                _ => "displayed",
            }
            .into(),
        ),
        ("fitToHeight", super::attribute_number(height)),
        ("fitToWidth", super::attribute_number(width)),
        (
            "orientation",
            child("orientation").map_or_else(
                || settings.orientation.unwrap_or("portrait").into(),
                crate::commands::archive::office::xml_text,
            ),
        ),
        (
            "pageOrder",
            if child("order")
                .is_some_and(|n| crate::commands::archive::office::xml_text(n) == "r_then_d")
            {
                "overThenDown"
            } else {
                "downThenOver"
            }
            .into(),
        ),
        (
            "paperSize",
            if child("paper")
                .is_some_and(|n| crate::commands::archive::office::xml_text(n) == "na_letter")
            {
                "1"
            } else {
                "9"
            }
            .into(),
        ),
        ("scale", super::attribute_number(scale)),
    ];
    if let Some(first) = first
        && start.is_some_and(|n| n >= 0.)
    {
        setup.push(("firstPageNumber", first.into()));
    }
    setup.push((
        "useFirstPageNumber",
        u8::from(start.is_some_and(|n| n >= 0.)).to_string(),
    ));
    for (name, value) in setup {
        write!(
            output,
            r#" {name}="{}""#,
            super::xml_escape_text(&value)
                .replace("&apos;", "'")
                .replace('\r', "&#13;")
                .replace('\n', "&#10;")
                .replace('\t', "&#9;")
        )
        .unwrap();
    }
    output.push_str("/><headerFooter>");
    output.push_str(&sheet.and_then(headers).unwrap_or_else(|| {
        if empty_headers {
            "<oddHeader/><oddFooter/>"
        } else {
            "<oddHeader>&amp;C&amp;A</oddHeader><oddFooter>&amp;CPage &amp;P</oddFooter>"
        }
        .into()
    }));
    output.push_str("</headerFooter>");
    if let Some(sheet) = sheet {
        output.push_str(&page_breaks(sheet));
    }
    Ok((fit, output))
}

fn headers(sheet: &Element) -> Option<String> {
    let print = children(sheet, "PrintInformation").next()?;
    let mut output = String::new();
    for (source, target, fallback) in [
        ("Header", "oddHeader", "&C&A"),
        ("Footer", "oddFooter", "&CPage &P"),
    ] {
        let mut value = String::new();
        if let Some(node) = children(print, source).next() {
            for (part, prefix) in [("Left", "&L"), ("Middle", "&C"), ("Right", "&R")] {
                let Some(mut source) = attr(node, part).filter(|s| !s.is_empty()) else {
                    continue;
                };
                value.push_str(prefix);
                while !source.is_empty() {
                    if let Some(token) = source.strip_prefix("&[")
                        && let Some((key, rest)) = token.split_once(']')
                        && let Some(code) = match key {
                            "PAGE" => Some("&P"),
                            "PAGES" => Some("&N"),
                            "DATE" => Some("&D"),
                            "TIME" => Some("&T"),
                            "TAB" => Some("&A"),
                            "FILE" => Some("&F"),
                            "PATH" => Some("&Z"),
                            _ => None,
                        }
                    {
                        value.push_str(code);
                        source = rest;
                        continue;
                    }
                    let ch = source.chars().next().unwrap();
                    value.push(ch);
                    if ch == '&' {
                        value.push('&');
                    }
                    source = &source[ch.len_utf8()..];
                }
            }
        } else {
            value.push_str(fallback);
        }
        if value.is_empty() {
            write!(output, "<{target}/>").unwrap();
        } else {
            write!(output, "<{target}>{}</{target}>", escaped(&value)).unwrap();
        }
    }
    Some(output)
}

fn page_breaks(sheet: &Element) -> String {
    let mut output = String::new();
    let Some(print) = children(sheet, "PrintInformation").next() else {
        return output;
    };
    for (source, target, max) in [
        ("hPageBreaks", "rowBreaks", 16383),
        ("vPageBreaks", "colBreaks", 1048575),
    ] {
        let Some(list) = children(print, source).next() else {
            continue;
        };
        let count = children(list, "break").count();
        if count == 0 {
            continue;
        }
        write!(output, r#"<{target} count="{count}">"#).unwrap();
        for node in children(list, "break") {
            let pos =
                attr(node, "pos").map_or(f64::NAN, |value| crate::commands::js_number(value, 0.));
            write!(
                output,
                r#"<brk id="{}" max="{max}"{}/>"#,
                super::attribute_number(pos),
                match attr(node, "type") {
                    Some("manual") => r#" man="1""#,
                    Some("data-slice") => r#" pt="1""#,
                    _ => "",
                }
            )
            .unwrap();
        }
        write!(output, "</{target}>").unwrap();
    }
    output
}

pub(in super::super) fn filter(sheet: &Element, name: &str) -> Option<(String, String)> {
    let mut output = String::new();
    let mut diagnostics = String::new();
    let mut selected = false;
    for filter in children(sheet, "Filters").flat_map(|n| children(n, "Filter")) {
        let area = attr(filter, "Area").unwrap_or("");
        if selected {
            writeln!(
                diagnostics,
                "XLSX writer does not export sheet '{name}' additional filter '{area}'"
            )
            .ok()?;
            continue;
        }
        selected = true;
        let (first, last) = area.split_once(':').unwrap_or((area, area));
        let first = crate::commands::archive::office::coordinate(first)?;
        let last = crate::commands::archive::office::coordinate(last)?;
        let width = first.1.abs_diff(last.1) + 1;
        let fields: BTreeMap<_, _> = children(filter, "Field")
            .map(|n| {
                (
                    attr(n, "Index")
                        .unwrap_or("0")
                        .parse::<usize>()
                        .unwrap_or(usize::MAX),
                    n,
                )
            })
            .collect();
        let mut columns = String::new();
        for (index, field) in fields {
            let kind = attr(field, "Type").unwrap_or("");
            let mut content = String::new();
            let mut warned = false;
            if index < width {
                match kind.to_ascii_lowercase().as_str() {
                    "bucket" => {
                        let flag = |key| attr(field, key).is_none_or(|v| v != "0" && !v.eq_ignore_ascii_case("false"));
                        let items = flag("items"); let relative = flag("rel_range");
                        let count = attr(field, "count").unwrap_or("10").parse::<f64>().ok()?;
                        if count.is_finite() && (items || relative) {
                            let count = if items { count.floor().clamp(0., 1e9) } else { count.clamp(0., 100.) };
                            content = format!(r#"<top10 val="{}"{}{}/>"#, number(count), if flag("top") { "" } else { r#" top="0""# }, if items { "" } else { r#" percent="1""# });
                        }
                    }
                    "blanks" => content = r#"<filters blank="1"/>"#.into(),
                    "noblanks" => content = r#"<customFilters><customFilter operator="notEqual" val=" "/></customFilters>"#.into(),
                    "expr" => {
                        let mut expressions = Vec::new();
                        for suffix in ["0", "1"] {
                            let op = attr(field, &format!("Op{suffix}"));
                            let operator = match op.map(str::to_ascii_lowercase).as_deref() {
                                Some("eq") => Some("equal"), Some("ne") => Some("notEqual"),
                                Some("gt") => Some("greaterThan"), Some("gte") => Some("greaterThanOrEqual"),
                                Some("lt") => Some("lessThan"), Some("lte") => Some("lessThanOrEqual"), _ => None,
                            };
                            let code = attr(field, &format!("Value{suffix}"));
                            let source = attr(field, &format!("ValueType{suffix}"));
                            let value = source.and_then(|s| match code {
                                Some("60") => Some(s.to_owned()),
                                Some("30" | "40") => s.parse::<f64>().ok().filter(|n| n.is_finite()).map(number),
                                Some("20") if s.eq_ignore_ascii_case("true") || s.eq_ignore_ascii_case("false") => Some(s.to_ascii_uppercase()),
                                Some("50") if matches!(s, "#NULL!" | "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A") => Some(s.to_owned()),
                                _ => None,
                            });
                            if let (Some(operator), Some(value)) = (operator, value) {
                                expressions.push(format!(r#"<customFilter operator="{operator}" val="{}"/>"#, escaped(&value)));
                            } else if suffix == "0" || op.is_some() || code.is_some() || source.is_some() {
                                writeln!(diagnostics, "XLSX writer does not export sheet '{name}' filter field '{index}' expression '{suffix}'").ok()?;
                                warned = true;
                                if suffix == "0" { break; }
                            }
                        }
                        if !expressions.is_empty() { content = format!("<customFilters{}>{}</customFilters>", if expressions.len() > 1 { r#" and="true""# } else { "" }, expressions.join("")); }
                    }
                    _ => {}
                }
            }
            if !content.is_empty() {
                write!(
                    columns,
                    r#"<filterColumn colId="{index}">{content}</filterColumn>"#
                )
                .ok()?;
            } else if !warned {
                writeln!(
                    diagnostics,
                    "XLSX writer does not export sheet '{name}' filter field '{}' type '{kind}'",
                    attr(field, "Index").unwrap_or("0")
                )
                .ok()?;
            }
        }
        output = if columns.is_empty() {
            format!(r#"<autoFilter ref="{}"/>"#, escaped(area))
        } else {
            format!(
                r#"<autoFilter ref="{}">{columns}</autoFilter>"#,
                escaped(area)
            )
        };
    }
    Some((output, diagnostics))
}

pub(in super::super) fn rules<'a>(
    sheet: &'a Element,
    name: &str,
    sheets: &[String],
    mut remaining: usize,
    diagnostics: &mut String,
    differentials: &mut Vec<&'a Element>,
) -> Result<String, String> {
    let mut output = String::new();
    let mut count = 0;
    let mut conditional = String::new();
    for region in children(sheet, "Styles")
        .next()
        .into_iter()
        .flat_map(|n| children(n, "StyleRegion"))
    {
        let Some(style) = children(region, "Style").next() else {
            continue;
        };
        let validation = children(style, "Validation").next();
        let input = children(style, "InputMessage").next();
        let coordinate = |row, col| {
            let row = attr(region, row)
                .unwrap_or("0")
                .parse::<usize>()
                .unwrap_or(0);
            let col = attr(region, col)
                .unwrap_or("0")
                .parse::<usize>()
                .unwrap_or(0);
            format!("{}{}", super::xlsx_idx_to_col_ref(col), row + 1)
        };
        let mut reference = coordinate("startRow", "startCol");
        if attr(region, "startRow") != attr(region, "endRow")
            || attr(region, "startCol") != attr(region, "endCol")
        {
            reference.push(':');
            reference.push_str(&coordinate("endRow", "endCol"));
        }
        if validation.is_some() || input.is_some() {
            let v = |key| validation.and_then(|n| attr(n, key));
            // The production enum decoder discards a fixed number of UTF-16 units.
            let suffix = |value: &str, length| {
                String::from_utf16_lossy(&value.encode_utf16().skip(length).collect::<Vec<_>>())
            };
            let kind = suffix(v("Type").unwrap_or(""), "GNM_VALIDATION_TYPE_".len());
            let op = suffix(v("Operator").unwrap_or(""), "GNM_VALIDATION_OP_".len());
            let kind_name = match kind.as_str() {
                "AS_INT" => Some("whole"),
                "AS_NUMBER" => Some("decimal"),
                "IN_LIST" => Some("list"),
                "AS_DATE" => Some("date"),
                "AS_TIME" => Some("time"),
                "TEXT_LENGTH" => Some("textLength"),
                "CUSTOM" => Some("custom"),
                _ => None,
            };
            let op_name = match op.as_str() {
                "NOT_BETWEEN" => Some("notBetween"),
                "EQUAL" => Some("equal"),
                "NOT_EQUAL" => Some("notEqual"),
                "LT" => Some("lessThan"),
                "GT" => Some("greaterThan"),
                "LTE" => Some("lessThanOrEqual"),
                "GTE" => Some("greaterThanOrEqual"),
                _ => None,
            };
            if validation.is_some()
                && (kind_name.is_none() && kind != "ANY"
                    || op_name.is_none() && !matches!(op.as_str(), "" | "BETWEEN" | "NONE"))
            {
                writeln!(
                diagnostics,
                "XLSX writer does not export sheet '{name}' validation type/operator '{kind}/{op}'"
            )
            .unwrap();
            }
            let mut content = String::new();
            for (source, target) in [("Expression0", "formula1"), ("Expression1", "formula2")] {
                if let Some(expr) = validation.and_then(|n| children(n, source).next()) {
                    let expression = expression(expr, sheets, &mut remaining)?;
                    write!(content, "<{target}>{}</{target}>", escaped(&expression)).unwrap();
                }
            }
            output.push_str("<dataValidation");
            for (key, value) in [
                ("type", kind_name),
                ("operator", op_name),
                (
                    "errorStyle",
                    v("Style").and_then(|s| {
                        if s.ends_with("WARNING") {
                            Some("warning")
                        } else if s.ends_with("INFO") {
                            Some("information")
                        } else {
                            None
                        }
                    }),
                ),
                ("allowBlank", (v("AllowBlank") == Some("1")).then_some("1")),
                (
                    "showDropDown",
                    validation.map(|_| {
                        if v("UseDropdown") == Some("1") {
                            "0"
                        } else {
                            "1"
                        }
                    }),
                ),
                ("errorTitle", v("Title")),
                ("error", v("Message")),
                ("showInputMessage", Some("1")),
                ("showErrorMessage", Some("1")),
                ("promptTitle", input.and_then(|n| attr(n, "Title"))),
                ("prompt", input.and_then(|n| attr(n, "Message"))),
                ("sqref", Some(reference.as_str())),
            ] {
                if let Some(value) = value {
                    write!(
                        output,
                        " {key}=\"{}\"",
                        super::xml_escape_text(value)
                            .replace("&apos;", "'")
                            .replace('\t', "&#9;")
                            .replace('\n', "&#10;")
                            .replace('\r', "&#13;")
                    )
                    .unwrap();
                }
            }
            if content.is_empty() {
                output.push_str("/>");
            } else {
                write!(output, ">{content}</dataValidation>").unwrap();
            }
            count += 1;
        }
        let mut cf = String::new();
        for condition in children(style, "Condition") {
            let op = crate::commands::js_number(attr(condition, "Operator").unwrap_or("NaN"), 0.);
            let overlay = children(condition, "Style").next();
            if !op.is_nan() && !(0. ..=8.).contains(&op) || overlay.is_none() {
                writeln!(
                    diagnostics,
                    "XLSX writer does not export sheet '{name}' conditional operator '{}'",
                    super::attribute_number(op)
                )
                .unwrap();
                continue;
            }
            let overlay = overlay.unwrap();
            let mut missing: Vec<_> = overlay
                .attrs
                .iter()
                .filter(|(k, _)| {
                    !matches!(k.as_str(), "Back" | "PatternColor" | "Shade" | "Fore")
                        && style_attribute(overlay, k)
                })
                .map(|(k, _)| k.clone())
                .collect();
            for child in &overlay.children {
                let crate::commands::structured::xml::Node::Element(child) = child else {
                    continue;
                };
                let kind = child.tag.rsplit(':').next().unwrap();
                if kind != "Font" {
                    missing.push(kind.into());
                } else {
                    missing.extend(
                        child
                            .attrs
                            .iter()
                            .filter(|(k, _)| {
                                !matches!(k.as_str(), "Bold" | "Italic" | "Unit")
                                    && style_attribute(child, k)
                            })
                            .map(|(k, _)| format!("Font.{k}")),
                    );
                }
            }
            if !missing.is_empty() {
                writeln!(
                    diagnostics,
                    "XLSX writer does not export sheet '{name}' differential style fields '{}'",
                    missing.join(", ")
                )
                .unwrap();
            }
            let mut content = String::new();
            for source in if op < 2. {
                &["Expression0", "Expression1"][..]
            } else {
                &["Expression0"][..]
            } {
                if let Some(expr) = children(condition, source).next() {
                    write!(
                        content,
                        "<formula>{}</formula>",
                        escaped(&expression(expr, sheets, &mut remaining)?)
                    )
                    .unwrap();
                }
            }
            let id = if let Some(id) = differentials
                .iter()
                .position(|prior| same_style(prior, overlay))
            {
                id
            } else {
                differentials.push(overlay);
                differentials.len() - 1
            };
            write!(
                cf,
                "<cfRule type=\"{}\" dxfId=\"{id}\" priority=\"1\" stopIfTrue=\"1\"",
                if op == 8. { "expression" } else { "cellIs" }
            )
            .unwrap();
            if op.is_finite()
                && op.fract() == 0.
                && let Some(operator) = [
                    "between",
                    "notBetween",
                    "equal",
                    "notEqual",
                    "greaterThan",
                    "lessThan",
                    "greaterThanOrEqual",
                    "lessThanOrEqual",
                ]
                .get(op as usize)
            {
                write!(cf, " operator=\"{operator}\"").unwrap();
            }
            if content.is_empty() {
                cf.push_str("/>");
            } else {
                write!(cf, ">{content}</cfRule>").unwrap();
            }
        }
        if !cf.is_empty() {
            write!(
                conditional,
                "<conditionalFormatting sqref=\"{reference}\">{cf}</conditionalFormatting>"
            )
            .unwrap();
        }
    }
    let validations = if count == 0 {
        output
    } else {
        format!("<dataValidations count=\"{count}\">{output}</dataValidations>")
    };
    Ok(conditional + &validations)
}

fn expression(node: &Element, sheets: &[String], remaining: &mut usize) -> Result<String, String> {
    use crate::commands::archive::{office::xml_text, office_ods::formula};
    let source = xml_text(node);
    let source = if source.starts_with('=') || source.starts_with("of:=") {
        source
    } else {
        format!("={source}")
    };
    let parsed = formula::convert(true, &source, false, *remaining, true)
        .map_err(|e| format!("{e}\n"))?
        .ok_or("Unsupported ssconvert feature: unparsed XLSX formula\n")?;
    if parsed.error.is_some() {
        return Err("Unsupported ssconvert feature: unparsed XLSX formula\n".into());
    }
    parsed
        .native_xlsx(sheets, remaining)
        .map_err(|e| format!("{e}\n"))
}

fn same_style(a: &Element, b: &Element) -> bool {
    use crate::commands::structured::xml::Node;
    let text = |n: &Element| {
        n.children
            .iter()
            .filter_map(|c| match c {
                Node::Text(t, _) | Node::Cdata(t) => Some(t.as_str()),
                _ => None,
            })
            .collect::<String>()
    };
    let elements = |n: &Element| {
        n.children
            .iter()
            .filter(|n| matches!(n, Node::Element(_)))
            .count()
    };
    a.tag.rsplit(':').next() == b.tag.rsplit(':').next()
        && a.namespace == b.namespace
        && a.attrs
            .iter()
            .filter(|(k, _)| style_attribute(a, k))
            .eq(b.attrs.iter().filter(|(k, _)| style_attribute(b, k)))
        && text(a) == text(b)
        && elements(a) == elements(b)
        && a.children
            .iter()
            .filter_map(|n| {
                if let Node::Element(e) = n {
                    Some(e)
                } else {
                    None
                }
            })
            .zip(b.children.iter().filter_map(|n| {
                if let Node::Element(e) = n {
                    Some(e)
                } else {
                    None
                }
            }))
            .all(|(a, b)| same_style(a, b))
}

pub(in super::super) fn differentials(nodes: &[&Element]) -> Result<String, String> {
    use crate::commands::archive::office::xml_text;
    let rgb = |source: &str, fallback: &str| {
        if source.is_empty() {
            return fallback.to_owned();
        }
        let mut result = "FF".to_owned();
        for component in source.split(':') {
            let component = component
                .trim_start()
                .strip_prefix("0x")
                .unwrap_or(component.trim_start());
            let end = component.bytes().take_while(u8::is_ascii_hexdigit).count();
            if let Ok(value) = u64::from_str_radix(&component[..end], 16) {
                write!(result, "{:02X}", (value as f64 / 257.).round() as u64).unwrap();
            } else {
                result.push_str("NAN");
            }
        }
        result
    };
    let mut output = String::new();
    for node in nodes {
        let mut content = String::new();
        if ["Back", "PatternColor", "Shade"]
            .iter()
            .any(|key| attr(node, key).is_some())
        {
            let shade = attr(node, "Shade").map(|s| crate::commands::js_number(s, 0.));
            content.push_str("<fill><patternFill");
            if let Some(shade) = shade {
                let pattern = (shade.is_finite() && shade >= 0. && shade.fract() == 0.)
                    .then(|| super::styles::FILL_PATTERNS.get(shade as usize))
                    .flatten()
                    .ok_or("Unsupported XLSX fill pattern\n")?;
                write!(content, " patternType=\"{pattern}\"").unwrap();
            }
            let (foreground, background) = if shade == Some(1.) {
                ("PatternColor", "Back")
            } else {
                ("Back", "PatternColor")
            };
            let mut colors = String::new();
            for (key, target, fallback) in [
                (foreground, "fgColor", "FFFFFFFF"),
                (background, "bgColor", "FF000000"),
            ] {
                if let Some(value) = attr(node, key) {
                    write!(
                        colors,
                        "<{target} rgb=\"{}\"/>",
                        escaped(&rgb(value, fallback))
                    )
                    .unwrap();
                }
            }
            if colors.is_empty() {
                content.push_str("/></fill>");
            } else {
                write!(content, ">{colors}</patternFill></fill>").unwrap();
            }
        }
        let font = children(node, "Font").next();
        if font.is_some() || attr(node, "Fore").is_some() {
            let mut data = String::new();
            if let Some(font) = font {
                let family = xml_text(font);
                if !family.is_empty() {
                    write!(data, "<name val=\"{}\"/>", escaped(&family)).unwrap();
                }
                for (key, tag) in [("Bold", "b"), ("Italic", "i"), ("Unit", "sz")] {
                    if let Some(value) = attr(font, key) {
                        write!(
                            data,
                            "<{tag} val=\"{}\"/>",
                            super::attribute_number(crate::commands::js_number(value, 0.))
                        )
                        .unwrap();
                    }
                }
            }
            if let Some(value) = attr(node, "Fore") {
                write!(
                    data,
                    "<color rgb=\"{}\"/>",
                    escaped(&rgb(value, "FF000000"))
                )
                .unwrap();
            }
            if data.is_empty() {
                content.push_str("<font/>");
            } else {
                write!(content, "<font>{data}</font>").unwrap();
            }
        }
        if content.is_empty() {
            output.push_str("<dxf/>");
        } else {
            write!(output, "<dxf>{content}</dxf>").unwrap();
        }
    }
    Ok(if nodes.is_empty() {
        output
    } else {
        format!("<dxfs count=\"{}\">{output}</dxfs>", nodes.len())
    })
}

fn style_attribute(node: &Element, key: &str) -> bool {
    match node.tag.rsplit(':').next().unwrap() {
        "Style" => matches!(
            key,
            "Back"
                | "Fit"
                | "Fore"
                | "Format"
                | "HAlign"
                | "Hidden"
                | "Indent"
                | "Locked"
                | "PatternColor"
                | "Rotation"
                | "Shade"
                | "ShrinkToFit"
                | "VAlign"
                | "WrapText"
        ),
        "Font" => matches!(
            key,
            "Bold" | "Italic" | "Script" | "StrikeThrough" | "Underline" | "Unit"
        ),
        _ => key != "xmlns" && !key.starts_with("xmlns:"),
    }
}

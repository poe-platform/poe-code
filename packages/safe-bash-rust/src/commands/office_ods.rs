use super::office_xml;
#[path = "office_ods_appearance.rs"]
mod appearance;
#[path = "office_ods_csv.rs"]
mod csv;
#[path = "office_ods_filters.rs"]
mod filters;
#[path = "office_ods_formula.rs"]
pub(in crate::commands) mod formula;
#[path = "office_ods_labels.rs"]
mod labels;
#[path = "office_ods_print.rs"]
mod print;
#[path = "office_ods_schema.rs"]
mod schema;
#[path = "office_ods_styles.rs"]
mod styles;
#[path = "office_ods_text.rs"]
mod text;
#[path = "office_ods_workbook.rs"]
mod workbook;
use crate::commands::{
    codecs::zip_directory,
    structured::{
        xlsx::{self, ArrayFormula, Axis, Comment, Sheet, TypedCell, Value, Workbook},
        xml::{self, Element, Node},
    },
};
use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
const INVALID: &str = "E Invalid OpenDocument: ";
const LIMIT: &str = "document exceeds byte limit";
use super::office::valid_sheet_name;

fn attr<'a>(el: &'a Element, name: &str) -> Option<&'a str> {
    el.attrs
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.as_str())
}
fn children<'a>(el: &'a Element, name: &'a str) -> impl Iterator<Item = &'a Element> {
    el.children.iter().filter_map(move |n| match n {
        Node::Element(e) if e.tag == name => Some(e),
        _ => None,
    })
}
fn namespace_family(uri: &str) -> &str {
    match uri {
        "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
        | "http://openoffice.org/2000/office" => "office",
        "urn:oasis:names:tc:opendocument:xmlns:table:1.0" | "http://openoffice.org/2000/table" => {
            "table"
        }
        "urn:oasis:names:tc:opendocument:xmlns:text:1.0" | "http://openoffice.org/2000/text" => {
            "text"
        }
        "urn:oasis:names:tc:opendocument:xmlns:style:1.0" | "http://openoffice.org/2000/style" => {
            "style"
        }
        "urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"
        | "http://openoffice.org/2000/datastyle" => "number",
        "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
        | "http://www.w3.org/1999/XSL/Format" => "fo",
        "http://www.gnumeric.org/odf-extension/1.0" => "gnm",
        "http://purl.org/dc/elements/1.1/" => "dc",
        "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
        | "http://openoffice.org/2000/drawing" => "draw",
        "http://www.w3.org/1999/xlink" => "xlink",
        "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
        | "http://www.w3.org/2000/svg" => "svg",
        "urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0" => "calcext",
        "urn:oasis:names:tc:opendocument:xmlns:config:1.0"
        | "http://openoffice.org/2001/config" => "config",
        _ => "?",
    }
}
fn canonical(name: &str, ns: &BTreeMap<String, String>, attribute: bool) -> String {
    let (prefix, local) = name.split_once(':').unwrap_or(("", name));
    let uri = if attribute && prefix.is_empty() {
        ""
    } else {
        ns.get(prefix).map_or("", String::as_str)
    };
    if !attribute && uri.is_empty() {
        return local.to_string();
    }
    // View properties distinguish the legacy style namespace from ODF 1.0.
    if uri == "http://openoffice.org/2000/style"
        && matches!(local, "table-properties" | "writing-mode")
    {
        return format!("{{{uri}}}{local}");
    }
    let family = namespace_family(uri);
    format!("{family}:{local}")
}
fn document(
    source: &str,
    native_formulas: bool,
    grammar: &str,
    diagnostics: &mut String,
) -> Result<Element, String> {
    let mut doc = xml::parse(source, None, None).map_err(|error| {
        let line = source.chars().filter(|&c| c == '\n').count() + 1;
        let column = source.rsplit('\n').next().unwrap().encode_utf16().count();
        if error == "Invalid XML: incomplete document"
            && let Ok(tokens) = office_xml::tokens(source)
        {
            let mut open = Vec::new();
            for token in tokens {
                match token {
                    office_xml::Token::Start {
                        name, empty: false, ..
                    } => open.push(name),
                    office_xml::Token::End(..) => {
                        open.pop();
                    }
                    _ => {}
                }
            }
            let message = open.last().map_or_else(
                || "document must contain a root element.".to_string(),
                |name| format!("unclosed tag: {name}"),
            );
            return format!("{INVALID}Invalid XML: {line}:{column}: {message}");
        }
        if !source.ends_with('>') {
            let message = if source.contains('>') {
                "unexpected end."
            } else {
                "document must contain a root element."
            };
            format!("{INVALID}Invalid XML: {line}:{column}: {message}")
        } else {
            format!("{INVALID}{error}")
        }
    })?;
    let root = doc
        .nodes
        .iter_mut()
        .find_map(|n| {
            if let Node::Element(e) = n {
                Some(e)
            } else {
                None
            }
        })
        .ok_or_else(|| format!("{INVALID}missing spreadsheet body"))?;
    diagnostics.push_str(&schema::diagnostics(root, grammar));
    let mut pending = vec![(root, BTreeMap::new(), BTreeMap::new())];
    while let Some((el, mut namespaces, mut formula_namespaces)) = pending.pop() {
        for (k, v) in &el.attrs {
            if k == "xmlns" {
                namespaces.insert(String::new(), v.clone());
            } else if let Some(k) = k.strip_prefix("xmlns:") {
                namespaces.insert(k.into(), v.clone());
                // Calc replaces registered ODF bindings, but retains an existing
                // binding when an unknown namespace reuses its prefix.
                if !formula_namespaces.contains_key(k)
                    || !matches!(namespace_family(v), "?" | "gnm")
                    || matches!(
                        v.as_str(),
                        "urn:oasis:names:tc:opendocument:xmlns:of:1.2"
                            | "http://openoffice.org/2004/calc"
                    )
                {
                    formula_namespaces.insert(k.to_string(), v.clone());
                }
            }
        }
        el.tag = canonical(&el.tag, &namespaces, false);
        for (k, v) in &mut el.attrs {
            *k = canonical(k, &namespaces, true);
            if native_formulas
                && matches!(k.as_str(), "table:formula" | "table:expression")
                && let Some((prefix, expression)) = v.split_once(':')
                && let Some(uri) = formula_namespaces.get(prefix)
                && matches!(
                    uri.as_str(),
                    "urn:oasis:names:tc:opendocument:xmlns:of:1.2"
                        | "http://openoffice.org/2004/calc"
                        | "http://schemas.microsoft.com/office/excel/formula"
                )
            {
                *v = format!("{{{uri}}}{expression}");
            }
        }
        for n in &mut el.children {
            if let Node::Element(e) = n {
                pending.push((e, namespaces.clone(), formula_namespaces.clone()));
            }
        }
    }
    doc.nodes
        .into_iter()
        .find_map(|n| {
            if let Node::Element(e) = n {
                Some(e)
            } else {
                None
            }
        })
        .ok_or_else(|| format!("{INVALID}missing spreadsheet body"))
}
fn js_number(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() {
        return Some(0.);
    }
    let radix = [
        ("0x", 16),
        ("0X", 16),
        ("0b", 2),
        ("0B", 2),
        ("0o", 8),
        ("0O", 8),
    ]
    .into_iter()
    .find_map(|(prefix, radix)| s.strip_prefix(prefix).map(|digits| (digits, radix)));
    let n = if let Some((digits, radix)) = radix {
        if digits.is_empty() {
            return None;
        }
        digits.chars().try_fold(0., |n, c| {
            c.to_digit(radix)
                .map(|digit| n * f64::from(radix) + f64::from(digit))
        })?
    } else {
        s.parse().ok()?
    };
    n.is_finite().then_some(n)
}
fn count(s: Option<&str>) -> Result<usize, String> {
    let n = s
        .map_or(Some(1.), js_number)
        .filter(|n| *n >= 0. && *n <= 9007199254740991. && n.fract() == 0.)
        .ok_or_else(|| format!("{INVALID}invalid repeat/span count"))?;
    usize::try_from(n as u64).map_err(|_| LIMIT.into())
}
fn duration(s: &str) -> Option<f64> {
    let negative = s.starts_with('-');
    let s = s.strip_prefix('-').unwrap_or(s).strip_prefix('P')?;
    let mut rest = s;
    let mut time = false;
    let mut previous = None;
    let mut seconds = 0.;
    let mut components = 0;
    while !rest.is_empty() {
        if let Some(t) = rest.strip_prefix('T') {
            if time || t.is_empty() {
                return None;
            }
            time = true;
            rest = t;
            continue;
        }
        let digits = rest.bytes().take_while(|b| b.is_ascii_digit()).count();
        if digits == 0 {
            return None;
        }
        let mut end = digits;
        let fractional = rest.as_bytes().get(end) == Some(&b'.');
        if fractional {
            end += 1;
            let n = rest[end..]
                .bytes()
                .take_while(|b| b.is_ascii_digit())
                .count();
            if n == 0 {
                return None;
            }
            end += n;
        }
        let amount = js_number(&rest[..end])?;
        let unit = *rest.as_bytes().get(end)?;
        let order = b"DHMS".iter().position(|&b| b == unit)?;
        if previous.is_some_and(|p| order <= p)
            || (time && unit == b'D')
            || (!time && unit != b'D')
            || (fractional && unit != b'S')
        {
            return None;
        }
        previous = Some(order);
        seconds += amount * [86400., 3600., 60., 1.][order];
        components += 1;
        rest = &rest[end + 1..];
    }
    (components > 0 && seconds.is_finite()).then_some(if negative {
        -seconds / 86400.
    } else {
        seconds / 86400.
    })
}
#[derive(Default)]
pub(in crate::commands) struct Source {
    pub records: Vec<(bool, Element)>,
    pub print: BTreeMap<String, Element>,
    pub diagnostics: String,
    pub unparsed_formulas: Vec<usize>,
    pub cell_styles: BTreeMap<(usize, usize, usize), String>,
}

pub(in crate::commands) fn read(
    gnumeric: bool,
    bytes: &[u8],
    filename: &str,
    target: &str,
    limit: usize,
) -> Result<(Vec<Sheet<String>>, Workbook), String> {
    let unsupported = || {
        format!(
            "E Unsupported file format for file \"{}\"",
            filename.rsplit('/').next().unwrap_or(filename)
        )
    };
    let (members, _) =
        zip_directory(bytes.len(), |r| Ok(Cow::Borrowed(&bytes[r]))).map_err(|_| unsupported())?;
    let mut entries = BTreeMap::new();
    let mut remaining = limit;
    for m in members {
        remaining = remaining.checked_sub(m.size).ok_or(LIMIT)?;
        if !matches!(m.method, 0 | 8) {
            return Err(unsupported());
        }
        let v = m
            .decode(Cow::Borrowed(&bytes[m.payload.clone()]), None)
            .map_err(|e| format!("{INVALID}{e}"))?;
        entries.insert(m.name, v);
    }
    let mime = entries.get("mimetype").map(|v| String::from_utf8_lossy(v));
    let recognized = match mime.as_deref() {
        Some(
            "application/vnd.oasis.opendocument.spreadsheet"
            | "application/vnd.oasis.opendocument.spreadsheet-template"
            | "application/vnd.sun.xml.calc"
            | "application/vnd.sun.xml.calc.template",
        ) => true,
        Some(_) => false,
        None => entries.get("content.xml").is_some_and(|bytes| {
            String::from_utf8_lossy(&bytes[..bytes.len().min(512)])
                .contains("urn:oasis:names:tc:opendocument:xmlns:office:1.0")
        }),
    };
    if !recognized {
        return Err(unsupported());
    }
    let legacy = matches!(
        mime.as_deref(),
        Some("application/vnd.sun.xml.calc" | "application/vnd.sun.xml.calc.template")
    );
    let content = entries
        .get("content.xml")
        .ok_or_else(|| format!("{INVALID}No stream named content.xml found."))?;
    if let Some(bytes) = entries.get("META-INF/manifest.xml") {
        let manifest = document(&office_xml::decode(bytes)?, false, "", &mut String::new())?;
        if manifest.tag.rsplit(':').next() != Some("manifest")
            || !matches!(
                manifest.namespace.as_str(),
                "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
                    | "http://openoffice.org/2001/manifest"
            )
        {
            return Err(format!("{INVALID}invalid manifest"));
        }
    }
    let mut content_diagnostics = String::new();
    let mut style_diagnostics = String::new();
    let mut root = document(
        &office_xml::decode(content)?,
        target == "csv",
        if legacy {
            "ooo1_content_dtd"
        } else {
            "opendoc_content_dtd"
        },
        &mut content_diagnostics,
    )?;
    if root.tag != "office:document-content" {
        let schema = if legacy {
            "ooo1_content_dtd"
        } else {
            "opendoc_content_dtd"
        };
        return Err(format!("{INVALID}unrecognized {schema} root"));
    }
    if legacy {
        for container in &mut root.children {
            if let Node::Element(container) = container
                && container.tag == "office:automatic-styles"
            {
                for style in &mut container.children {
                    if let Node::Element(style) = style
                        && style.tag == "style:style"
                    {
                        // The old content schema recognizes only the combined property node.
                        style.children.retain(|node| {
                            !matches!(node, Node::Element(el) if el.tag != "style:properties")
                        });
                    }
                }
            }
        }
    }
    let style_root = entries
        .get("styles.xml")
        .map(|b| {
            office_xml::decode(b)
                .and_then(|s| document(&s, false, "styles_dtd", &mut style_diagnostics))
        })
        .transpose()?;
    if style_root
        .as_ref()
        .is_some_and(|r| r.tag != "office:document-styles")
    {
        return Err(format!("{INVALID}unrecognized styles_dtd root"));
    }
    let mut roots: Vec<_> = style_root.iter().collect();
    roots.push(&root);
    let mut styles = styles::Styles::read(&roots, legacy, limit)?;
    let body = children(&root, "office:body").next();
    let spreadsheet = if legacy {
        body
    } else {
        body.and_then(|body| children(body, "office:spreadsheet").next())
    }
    .ok_or_else(|| format!("{INVALID}missing spreadsheet body"))?;
    let date1904 = children(spreadsheet, "table:calculation-settings")
        .next()
        .and_then(|e| children(e, "table:null-date").next())
        .and_then(|e| attr(e, "table:date-value"))
        .is_some_and(|v| v.starts_with("1904"));
    let mut sheet_names = Vec::new();
    let mut names = BTreeSet::new();
    let mut remaining = limit;
    for (index, table) in children(spreadsheet, "table:table").enumerate() {
        let name =
            attr(table, "table:name").map_or_else(|| format!("Sheet{}", index + 1), str::to_owned);
        if name.is_empty() {
            return Err("Invalid sheet name".into());
        }
        if sheet_names.contains(&name) {
            return Err(format!("{INVALID}duplicate sheet name"));
        }
        sheet_names.push(name);
    }
    for name in &sheet_names {
        if !names.insert(super::office::case_fold::fold(name)) {
            return Err("Conflicting sheet name".into());
        }
    }
    if sheet_names.is_empty() {
        return Err(format!("{INVALID}no sheets"));
    }
    let changes = BTreeMap::new();
    let export = (target == "xlsx").then_some((sheet_names.as_slice(), &changes));
    let mut label_cells = Vec::new();
    let (mut workbook, label_names, name_diagnostics) = workbook::read(
        gnumeric,
        spreadsheet,
        &sheet_names,
        legacy,
        date1904,
        target,
        &mut remaining,
    )?;
    let mut source = Source {
        diagnostics: format!(
            "{content_diagnostics}{style_diagnostics}{content_diagnostics}{name_diagnostics}"
        ),
        ..Source::default()
    };
    for root in &roots {
        for node in &root.children {
            if let Node::Element(el) = node {
                if matches!(
                    el.tag.as_str(),
                    "office:styles"
                        | "office:automatic-styles"
                        | "office:master-styles"
                        | "office:font-face-decls"
                        | "office:font-decls"
                ) {
                    source
                        .records
                        .push((root.tag == "office:document-content", el.clone()));
                }
            }
        }
    }
    for path in ["META-INF/manifest.xml", "meta.xml", "settings.xml"] {
        if let Some(bytes) = entries.get(path) {
            source.records.push((
                false,
                document(&office_xml::decode(bytes)?, false, "", &mut String::new())?,
            ));
        }
    }
    for node in children(spreadsheet, "table:calculation-settings") {
        source.records.push((false, node.clone()));
    }
    workbook.odf = Some(source);
    let mut formula_names = BTreeMap::new();
    for name in &workbook.names {
        let key = super::office::collation::uppercase(&name.name, &mut remaining).ok_or(LIMIT)?;
        remaining = remaining
            .checked_sub(std::mem::size_of::<((Option<usize>, String), &str)>() + 32)
            .ok_or(LIMIT)?;
        formula_names
            .entry((name.sheet, key))
            .or_insert(name.name.as_str());
    }
    let mut sheets = Vec::new();
    let mut explicit_formula_styles = BTreeSet::new();
    let mut text_styles = text::TextStyles::read(&roots, legacy, &mut remaining)?;
    let print_styles = print::Styles::read(&roots, legacy, &mut remaining)?;
    for (table, name) in children(spreadsheet, "table:table").zip(&sheet_names) {
        let name = name.clone();
        if let Some(print) = print_styles.gnumeric(table, legacy, &mut remaining)? {
            workbook
                .odf
                .as_mut()
                .unwrap()
                .print
                .insert(name.clone(), print);
        }
        let view = styles.view(attr(table, "table:style-name"))?;
        remaining = remaining
            .checked_sub(view.len() * std::mem::size_of::<(&str, bool)>())
            .ok_or(LIMIT)?;
        let mut columns = BTreeMap::new();
        let column_defaults =
            styles::column_defaults(table, &mut styles, &mut columns, &mut remaining, legacy)?;
        let column_style = |col| {
            column_defaults
                .get(column_defaults.partition_point(|(_, end, _)| *end <= col))
                .filter(|(start, _, _)| *start <= col)
                .map(|(_, _, name)| *name)
        };
        let mut sheet = Sheet {
            style_regions: vec![],
            filter: None,
            name,
            view,
            sylk_r1c1: None,
            sylk_hide_zero: false,
            print: print_styles.sheet(attr(table, "table:style-name")),
            cells: BTreeMap::new(),
            rows: BTreeMap::new(),
            columns,
            merges: Vec::new(),
            arrays: Vec::new(),
            comments: Vec::new(),
            empty_headers: true,
        };
        let mut header_rows = false;
        let mut formula_groups = BTreeMap::new();
        let mut row = 0usize;
        let mut size = (0usize, 0usize);
        let mut pending: Vec<_> = table
            .children
            .iter()
            .rev()
            .map(|n| (n, 0usize, table.tag.as_str()))
            .collect();
        while let Some((node, level, parent)) = pending.pop() {
            let Node::Element(el) = node else { continue };
            if !styles::axis_child(parent, &el.tag, legacy) {
                continue;
            }
            if matches!(
                el.tag.as_str(),
                "table:table-row-group" | "table:table-header-rows" | "table:table-rows"
            ) {
                let level = level + usize::from(el.tag == "table:table-row-group");
                pending.extend(
                    el.children
                        .iter()
                        .rev()
                        .map(|n| (n, level, el.tag.as_str())),
                );
                continue;
            }
            if el.tag != "table:table-row" {
                continue;
            }
            let repeat = count(attr(el, "table:number-rows-repeated"))?;
            if repeat > 16777216 - row {
                return Err("ssconvert OpenDocument row extent limit exceeded".into());
            }
            header_rows |= parent == "table:table-header-rows";
            if let Some(axis) = styles.axis(el, "table-row", level)? {
                if repeat != 0 && axis.size.is_some_and(|n| !n.is_finite()) {
                    return Err("Invalid axis size".into());
                }
                let charge = repeat
                    .checked_mul(std::mem::size_of::<Axis>() + 32)
                    .ok_or(LIMIT)?;
                remaining = remaining.checked_sub(charge).ok_or(LIMIT)?;
                for i in row..row + repeat {
                    sheet.rows.insert(i, axis.clone());
                }
            }
            let mut column = 0usize;
            for n in &el.children {
                let Node::Element(c) = n else { continue };
                if !matches!(
                    c.tag.as_str(),
                    "table:table-cell" | "table:covered-table-cell"
                ) {
                    continue;
                }
                let n = count(attr(c, "table:number-columns-repeated"))?;
                if n > 16384 - column {
                    return Err("ssconvert OpenDocument column extent limit exceeded".into());
                }
                for annotation in children(c, "office:annotation") {
                    let author = if let Some(creator) = children(annotation, "dc:creator").next() {
                        Some(
                            creator
                                .children
                                .iter()
                                .filter_map(|node| match node {
                                    Node::Text(value, _) | Node::Cdata(value) => {
                                        Some(value.as_str())
                                    }
                                    _ => None,
                                })
                                .collect::<String>(),
                        )
                    } else {
                        attr(annotation, "office:author").map(str::to_owned)
                    };
                    let runs = text_styles.text(annotation, &mut remaining)?;
                    if c.tag != "table:covered-table-cell" {
                        remaining = remaining
                            .checked_sub(
                                std::mem::size_of::<Comment>()
                                    + author.as_ref().map_or(0, String::len),
                            )
                            .ok_or(LIMIT)?;
                        sheet.comments.push(Comment {
                            print: true,
                            row,
                            column,
                            author,
                            runs,
                        });
                    }
                }
                if c.tag == "table:covered-table-cell" {
                    column += n;
                    continue;
                }
                let mut value = csv::cell(c, legacy, date1904, remaining)?;
                if repeat > 0
                    && n > 0
                    && (value.value.is_some()
                        || attr(c, "table:formula").is_some_and(|source| !source.is_empty()))
                {
                    size.0 = size.0.max(row + repeat);
                    size.1 = size.1.max(column + n);
                }
                if let Some(Value::Text(value_text)) = &value.value {
                    let runs = text_styles.text(c, &mut remaining)?;
                    if runs
                        .iter()
                        .flat_map(|r| r.text.chars())
                        .eq(value_text.chars())
                        && runs.iter().any(|r| !r.attributes.is_empty())
                    {
                        if runs.iter().any(|r| {
                            r.attributes.iter().any(|(k, v)| {
                                *k == "size" && v.parse::<f64>().is_ok_and(|n| !n.is_finite())
                            })
                        }) {
                            return Err("Nonfinite workbook number".into());
                        }
                        value.rich_text = Some(Arc::new(runs));
                    }
                }
                let style_name = attr(c, "table:style-name")
                    .or_else(|| attr(el, "table:default-cell-style-name"));
                // Resolve even empty cells so invalid inheritance cannot be hidden in a blank cell.
                styles.resolve(style_name.or_else(|| column_style(column)))?;
                let width = count(attr(c, "table:number-columns-spanned"))?;
                let height = count(attr(c, "table:number-rows-spanned"))?;
                let array_width =
                    count(attr(c, "table:number-matrix-columns-spanned").or(Some("0")))?;
                let array_height =
                    count(attr(c, "table:number-matrix-rows-spanned").or(Some("0")))?;
                let array = if target == "csv" {
                    array_width > 0 && array_height > 0
                } else {
                    array_width > 0 || array_height > 0
                };
                if let Some(source) = attr(c, "table:formula").filter(|s| !s.is_empty()) {
                    let parsed = formula::convert(gnumeric, source, legacy, remaining, false)?;
                    if gnumeric && parsed.is_none() {
                        let retained = workbook.odf.as_mut().unwrap();
                        retained.diagnostics.push_str(&formula::parse_warning(
                            source,
                            &sheet.name,
                            row,
                            column,
                        ));
                        retained.unparsed_formulas.push(sheets.len());
                    }
                    if let Some(mut parsed) = parsed
                        && (target == "csv" || parsed.public_expression(&mut remaining)?)
                    {
                        if gnumeric && parsed.has_live_references(&mut remaining)? {
                            label_cells.push((sheets.len(), row, column));
                        }
                        if parsed.external {
                            remaining = remaining.checked_sub(64).ok_or(LIMIT)?;
                            workbook
                                .uninterned_arrays
                                .insert((sheets.len(), row, column));
                        }
                        let mut group_work = remaining;
                        parsed.bind_names(
                            target != "csv",
                            &formula_names,
                            sheets.len(),
                            &sheet_names,
                            &mut group_work,
                        )?;
                        parsed.compile_separators(
                            &workbook.names,
                            &sheet_names,
                            sheets.len(),
                            None,
                            &mut group_work,
                        )?;
                        if let Some(group) = parsed.group(
                            source,
                            row,
                            array,
                            formula_groups.get(&column),
                            &mut group_work,
                        )? {
                            if let Some((names, changes)) = export {
                                parsed.export(Some(&group), names, changes, &mut group_work)?;
                            }
                            remaining = remaining.checked_sub(group.retained).ok_or(LIMIT)?;
                            if let Some(previous) = formula_groups.insert(column, group) {
                                remaining += previous.retained;
                            }
                        }
                        if let Some((names, changes)) = export {
                            parsed.export(None, names, changes, &mut group_work)?;
                        }
                        value.formula_display = parsed.display;
                        if target != "csv"
                            && let Some(error) = parsed.error
                        {
                            value.value = Some(Value::Error(error.into()));
                        }
                        value.formula = (!parsed.excel.is_empty()).then_some(parsed.excel);
                        value.openformula = parsed
                            .error
                            .map(|error| format!("of:={error}"))
                            .or(parsed.openformula);
                    }
                }
                if array && let Some(expression) = &value.formula {
                    let (width, height) = (array_width.max(1), array_height.max(1));
                    if column.checked_add(width).is_none_or(|n| n > 16384)
                        || row.checked_add(height).is_none_or(|n| n > 16777216)
                    {
                        return Err("ssconvert OpenDocument array extent limit exceeded".into());
                    }
                    remaining = remaining
                        .checked_sub(
                            width
                                .checked_mul(height)
                                .and_then(|n| {
                                    n.checked_mul(std::mem::size_of::<TypedCell<String>>() + 32)
                                })
                                .ok_or(LIMIT)?,
                        )
                        .ok_or(LIMIT)?;
                    remaining = remaining
                        .checked_sub(
                            expression.len()
                                + value.openformula.as_ref().map_or(0, String::len)
                                + value.formula_display.as_ref().map_or(0, String::len),
                        )
                        .ok_or(LIMIT)?;
                    sheet.arrays.push(ArrayFormula {
                        range: [row, column, width, height],
                        expression: expression.clone(),
                        openformula: value.openformula.clone(),
                        formula_display: value.formula_display.clone(),
                    });
                }
                if value.value.is_some() || value.formula.is_some() {
                    let bytes = std::mem::size_of::<TypedCell<String>>()
                        + 32
                        + value.formula.as_ref().map_or(0, String::len)
                        + value.openformula.as_ref().map_or(0, String::len)
                        + value.formula_display.as_ref().map_or(0, String::len)
                        + value.format.as_ref().map_or(0, String::len)
                        + value.value_format.as_ref().map_or(0, String::len)
                        + match &value.value {
                            Some(Value::Text(s) | Value::Error(s)) => s.len(),
                            _ => 0,
                        };
                    remaining = remaining
                        .checked_sub(
                            bytes
                                .checked_mul(n)
                                .and_then(|v| v.checked_mul(repeat))
                                .ok_or(LIMIT)?,
                        )
                        .ok_or(LIMIT)?;
                    for i in row..row + repeat {
                        for j in column..column + n {
                            let mut copied = value.clone();
                            if let Some((format, style)) =
                                styles.resolve(style_name.or_else(|| column_style(j)))?
                            {
                                remaining = remaining.checked_sub(format.len()).ok_or(LIMIT)?;
                                copied.format = Some(format.into());
                                copied.style = Some(style);
                            }
                            if i != row || j != column {
                                copied.formula = None;
                                copied.openformula = None;
                                copied.formula_display = None;
                            }
                            if copied.formula.is_some() && attr(c, "table:style-name").is_some() {
                                remaining = remaining.checked_sub(64).ok_or(LIMIT)?;
                                explicit_formula_styles.insert((sheets.len(), i, j));
                                if copied.value_format.is_none()
                                    && copied.format.as_deref().is_none_or(|f| f == "General")
                                {
                                    copied.value_format = Some("General".into());
                                }
                            }
                            if let Some(name) = style_name.or_else(|| column_style(j)) {
                                workbook
                                    .odf
                                    .as_mut()
                                    .unwrap()
                                    .cell_styles
                                    .insert((sheets.len(), i, j), name.into());
                            }
                            sheet.cells.insert((i, j), copied);
                        }
                    }
                }
                if width > 1 || height > 1 {
                    sheet
                        .merges
                        .push([row, column, width.max(1), height.max(1)]);
                }
                column += n;
            }
            row += repeat;
        }
        for group in &sheet.arrays {
            let [row, column, width, height] = group.range;
            size.0 = size.0.max(row + height);
            size.1 = size.1.max(column + width);
            for r in row..row + height {
                for c in column..column + width {
                    sheet.cells.entry((r, c)).or_insert_with(|| TypedCell {
                        value: None,
                        formula: None,
                        openformula: None,
                        formula_display: None,
                        format: None,
                        value_format: None,
                        style: None,
                        rich_text: None,
                    });
                }
            }
        }
        size.0 = size
            .0
            .max(sheet.rows.last_key_value().map_or(0, |(&row, _)| row + 1));
        size.1 = size.1.max(
            sheet
                .columns
                .last_key_value()
                .map_or(0, |(&column, _)| column + 1),
        );
        remaining = remaining
            .checked_sub(std::mem::size_of_val(&size))
            .ok_or(LIMIT)?;
        workbook.sheet_sizes.push((
            size.0.next_power_of_two().max(65536),
            size.1.next_power_of_two().max(256),
        ));
        sheet.empty_headers = !header_rows
            && sheet.print.orientation.is_none()
            && sheet.print.margins.is_none()
            && sheet.print.scale.is_none();
        remaining += formula_groups
            .values()
            .map(|group| group.retained)
            .sum::<usize>();
        sheets.push(sheet);
    }
    workbook::labels(spreadsheet, &sheet_names, &mut workbook, &mut remaining)?;
    if gnumeric {
        labels::bind(
            &mut sheets,
            &mut workbook,
            &label_cells,
            &label_names,
            &mut remaining,
        )?;
    }
    workbook.explicit_formula_styles = explicit_formula_styles;
    if let Some(bytes) = entries.get("settings.xml") {
        use crate::commands::structured::xlsx::StringRefSyntax;
        remaining = remaining.checked_sub(bytes.len()).ok_or(LIMIT)?;
        let settings = document(&office_xml::decode(bytes)?, false, "", &mut String::new())?;
        let item = children(&settings, "office:settings")
            .flat_map(|e| children(e, "config:config-item-set"))
            .filter(|e| attr(e, "config:name") == Some("ooo:configuration-settings"))
            .flat_map(|e| children(e, "config:config-item"))
            .find(|e| attr(e, "config:name") == Some("SyntaxStringRef"));
        if let Some(item) = item.filter(|e| attr(e, "config:type") == Some("short")) {
            let value: String = item
                .children
                .iter()
                .filter_map(|n| match n {
                    Node::Text(s, _) => Some(s.as_str()),
                    _ => None,
                })
                .collect();
            workbook.string_ref_syntax = match value.trim() {
                "2" => StringRefSyntax::ExcelA1,
                "3" => StringRefSyntax::ExcelR1C1,
                "7" => StringRefSyntax::CalcExcelA1,
                _ => StringRefSyntax::CalcA1,
            };
        }
    }
    filters::read(spreadsheet, &mut sheets, &mut remaining)?;
    Ok((sheets, workbook))
}
pub(in crate::commands) fn prepare_xlsx(
    sheets: &mut [Sheet<String>],
    workbook: &mut Workbook,
    mut remaining: usize,
) -> Result<(), String> {
    let sheet_names: Vec<_> = sheets.iter().map(|sheet| sheet.name.clone()).collect();
    remaining = sheets
        .iter()
        .try_fold(remaining, |work, sheet| {
            work.checked_sub(sheet.name.len() + std::mem::size_of::<String>())
        })
        .ok_or(LIMIT)?;
    for source in sheets
        .iter_mut()
        .flat_map(|sheet| {
            sheet
                .cells
                .values_mut()
                .filter_map(|cell| cell.formula.as_mut())
                .chain(sheet.arrays.iter_mut().map(|group| &mut group.expression))
        })
        .chain(workbook.names.iter_mut().map(|name| &mut name.expression))
    {
        if let std::borrow::Cow::Owned(output) = super::office::formula_arguments::rewrite(
            source,
            super::office::formula_arguments::Syntax::Ods,
            &[],
            &mut remaining,
        )
        .ok_or(LIMIT)?
        {
            *source = output;
        }
    }
    if sheets
        .iter()
        .flat_map(|s| {
            s.cells
                .values()
                .filter_map(|c| c.style.as_ref())
                .chain(s.columns.values().filter_map(|a| a.style.as_ref()))
        })
        .any(|s| s.fill_pattern().is_none())
    {
        return Err("Unsupported XLSX fill pattern".into());
    }
    for cell in sheets.iter_mut().flat_map(|sheet| sheet.cells.values_mut()) {
        if cell.formula.is_none() {
            let format = cell
                .format
                .as_deref()
                .filter(|f| *f != "General")
                .or(cell.value_format.as_deref());
            if format.is_some_and(super::office::number_format::logical) {
                if let Some(Value::Number(value @ (0. | 1.))) = cell.value {
                    cell.value = Some(Value::Bool(value != 0.));
                }
                cell.format = Some(r#""TRUE";"TRUE";"FALSE""#.into());
                cell.value_format = None;
            }
        }
        // Logical formula formats export as General; literals retain their display format.
        if cell.format.as_deref() == Some("BOOLEAN") {
            cell.format = Some("General".into());
        }
    }
    for (index, source, openformula) in sheets
        .iter_mut()
        .enumerate()
        .flat_map(|(index, sheet)| {
            sheet
                .cells
                .values_mut()
                .filter_map(move |cell| {
                    cell.formula
                        .as_mut()
                        .map(|source| (index, source, &mut cell.openformula))
                })
                .chain(
                    sheet
                        .arrays
                        .iter_mut()
                        .map(move |group| (index, &mut group.expression, &mut group.openformula)),
                )
        })
        .chain(
            workbook
                .names
                .iter_mut()
                .map(|name| (name.position.0, &mut name.expression, &mut name.openformula)),
        )
    {
        formula::export_public_xlsx(
            source,
            openformula,
            &sheet_names,
            index,
            &mut workbook.external_links,
            false,
            &mut remaining,
        )?;
    }
    if sheets.iter().any(|sheet| {
        sheet
            .cells
            .keys()
            .any(|&(row, column)| row >= 1048576 || column >= 16384)
    }) {
        return Err("Unsupported ssconvert feature: XLSX cell outside writer sheet limits".into());
    }
    Ok(())
}

pub(super) fn convert(
    bytes: &[u8],
    filename: &str,
    target: &str,
    filter: Option<&str>,
    limit: usize,
) -> Result<Vec<super::office::csv::Output>, String> {
    let convert = || {
        let (mut sheets, mut workbook) = read(true, bytes, filename, target, limit)?;
        if target == "csv" {
            return csv::export(&sheets, filter, limit);
        }
        let remaining = limit;
        super::office::formulas::cache(
            xlsx::Dialect::Gnumeric,
            &mut sheets,
            &workbook,
            None,
            remaining,
        )
        .map_err(|failure| match failure {
            super::office::formulas::Failure::Limit => LIMIT.to_owned(),
            super::office::formulas::Failure::Unsupported(message) => message,
        })?;
        if target == "xlsx" {
            prepare_xlsx(&mut sheets, &mut workbook, remaining)?;
            xlsx::write_cells(xlsx::Dialect::Gnumeric, &sheets, &workbook, limit)
                .map(|bytes| vec![super::office::csv::Output { sheet: None, bytes }])
                .ok_or_else(|| LIMIT.into())
        } else {
            super::office::csv::workbook(&sheets, filter, workbook.date1904, &[], limit)
        }
    };
    convert().map_err(|e: String| {
        if e == super::office::SOURCE_LOAD_ERROR {
            e
        } else {
            format!("Error: conversion failed: {e}\n")
        }
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn empty_string_database_headers_remain_strings() {
        let document = crate::commands::structured::xml::parse(
            r#"<table:table-cell xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:value-type="string" office:string-value=""/>"#,
            None,
            None,
        ).unwrap();
        let super::Node::Element(cell) = &document.nodes[0] else {
            panic!("cell")
        };
        assert!(
            matches!(super::csv::cell(cell, false, false, 65536).unwrap().value, Some(super::Value::Text(s)) if s.is_empty())
        );
    }

    use super::*;
    use crate::commands::structured::write_zip_stored;

    fn archive(rows: &str) -> Vec<u8> {
        let content = format!(
            r#"<office:document-content xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table>{rows}</table:table></office:spreadsheet></office:body></office:document-content>"#
        );
        write_zip_stored(&[
            (
                "mimetype",
                b"application/vnd.oasis.opendocument.spreadsheet",
            ),
            ("content.xml", content.as_bytes()),
            ("META-INF/manifest.xml", br#"<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/></manifest:manifest>"#),
        ])
    }

    #[test]
    fn gnumeric_option_names_evaluate_in_openformula_imports() {
        // Public soffice ODS exports retain these Gnumeric-prefixed formulas.
        for (formula, expected) in [
            ("CUM_BIV_NORM_DIST(0.1;0.2;0.3)", 0.3601084540357551),
            (
                "OPT_EXTENDIBLE_WRITER(&quot;c&quot;;100;100;105;0.5;1;0.05;0.03;0.2)",
                56.07037821954924,
            ),
        ] {
            let input = archive(&format!(
                r#"<table:table-row><table:table-cell table:formula="of:=ORG.GNUMERIC.{formula}" office:value-type="float" office:value="{expected}"/></table:table-row>"#
            ));
            let output = convert(&input, "input.ods", "csv", None, 1_000_000).unwrap();
            let text = std::str::from_utf8(&output[0].bytes).unwrap();
            assert!(
                text.trim()
                    .parse::<f64>()
                    .is_ok_and(|actual| (actual - expected).abs() <= 2e-12 * expected.abs()),
                "{formula}: {text}"
            );
        }
    }

    #[test]
    fn xlsx_exports_match_complete_public_packages() {
        use crate::commands::structured::{JVal, parse_json_stream, read_office_archive};
        use crate::{MemoryVfs, SafeBashFs};
        fn field<'a>(value: &'a JVal, key: &str) -> &'a JVal {
            let JVal::Object(fields) = value else {
                panic!("object")
            };
            &fields.iter().find(|(k, _)| k == key).unwrap().1
        }
        fn string(value: &JVal) -> &str {
            let JVal::Str(value) = value else {
                panic!("string")
            };
            value
        }
        let mut failures = Vec::new();
        for source in [
            include_str!("../../tests/fixtures/soffice-ods-xlsx-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-names-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-qualified-names-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-filters-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-references-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-reference-functions-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-reference-arrays-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-empty-consumers-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-numeric-export-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-numeric-import-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-broadcast-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-marked-names-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-name-cycles-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-indirect-omission-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-dates-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-calendar-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-comparisons-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-financial-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-cashflows-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-euroconvert-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-rounding-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-case-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-string-slices-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-arity-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-information-errors-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-xlookup-empty-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-formula-cache-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-name-adjacency-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-rounding-aliases-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-sumproduct-aliases-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-formula-metadata-production.json"),
            include_str!("../../tests/fixtures/soffice-negative-zero-production.json"),
            include_str!("../../tests/fixtures/soffice-value-production.json"),
            include_str!("../../tests/fixtures/soffice-chisq-quantile-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-sheet-extents-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-address-quotes-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-address-coercion-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-text-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-union-import-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-arrays-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-database-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-formula-import-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-lookup-search-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-lookup-shapes-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-indirect-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-information-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-public-function-names.json"),
            include_str!("../../tests/fixtures/soffice-ods-statistical-aliases-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-normal-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-boolean-statistics-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-statistical-names-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-log-gamma-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-gamma-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-factorial-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-combinatorial-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-comment-rich-production.json"),
        ] {
            let fixture = parse_json_stream(source).unwrap().remove(0);
            let inputs = field(&fixture, "inputs");
            let JVal::Array(cases) = field(&fixture, "cases") else {
                panic!("cases")
            };
            for case in cases {
                let name = string(field(case, "input"));
                let input = match field(inputs, name) {
                    JVal::Str(source) => source.as_bytes().to_vec(),
                    JVal::Object(parts) => write_zip_stored(
                        &parts
                            .iter()
                            .map(|(k, v)| (k.as_str(), string(v).as_bytes()))
                            .collect::<Vec<_>>(),
                    ),
                    _ => panic!("input source or archive parts"),
                };
                let fs = MemoryVfs::new();
                fs.mkdir_all("/output").unwrap();
                let path = format!("/{name}");
                let dest = format!("/output/{}.xlsx", name.rsplit_once('.').unwrap().0);
                fs.write_file(&path, &input).unwrap();
                fs.write_file(&dest, b"existing output").unwrap();
                let result = super::super::cmd_soffice(
                    &["--convert-to", "xlsx", "--outdir", "/output", &path].map(String::from),
                    "/",
                    &fs,
                );
                assert_eq!(fs.read_file(&path).unwrap(), input, "{name}");
                let JVal::Number(code, _) = field(case, "exitCode") else {
                    panic!("exitCode")
                };
                if result.exit_code != *code as i32
                    || result.stdout != string(field(case, "stdout"))
                    || result.stderr != string(field(case, "stderr"))
                {
                    failures.push(format!(
                        "{name}: status/stdout/stderr differ: {} {:?} {:?}",
                        result.exit_code, result.stdout, result.stderr
                    ));
                    continue;
                }
                if result.exit_code != 0 {
                    assert_eq!(fs.read_file(&dest).unwrap(), b"existing output", "{name}");
                    continue;
                }
                let output = read_office_archive(&fs.read_file(&dest).unwrap());
                let JVal::Object(parts) = field(case, "parts") else {
                    panic!("output parts")
                };
                if output.len() != parts.len() {
                    failures.push(format!(
                        "{name}: package member count {} != {}",
                        output.len(),
                        parts.len()
                    ));
                }
                for (part, bytes) in parts {
                    if output.get(part).map(Vec::as_slice) != Some(string(bytes).as_bytes()) {
                        failures.push(format!(
                            "{name}: {part}\nactual: {}\nexpected: {}",
                            String::from_utf8_lossy(
                                output.get(part).map(Vec::as_slice).unwrap_or_default()
                            ),
                            string(bytes)
                        ));
                    }
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn empty_documents_match_production_and_preserve_rejected_outputs() {
        use crate::commands::structured::{JVal, parse_json_stream, read_office_archive};
        use crate::{MemoryVfs, SafeBashFs};
        fn field<'a>(value: &'a JVal, key: &str) -> &'a JVal {
            let JVal::Object(fields) = value else {
                panic!("object")
            };
            &fields.iter().find(|(k, _)| k == key).unwrap().1
        }
        fn string(value: &JVal) -> &str {
            let JVal::Str(value) = value else {
                panic!("string")
            };
            value
        }
        let fixture = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-ods-empty-production.json"
        ))
        .unwrap()
        .remove(0);
        let inputs = field(&fixture, "inputs");
        let JVal::Array(cases) = field(&fixture, "cases") else {
            panic!("cases")
        };
        let mut failures = Vec::new();
        for case in cases {
            let name = string(field(case, "input"));
            let target = string(field(case, "target"));
            let input = match field(inputs, name) {
                JVal::Object(parts) => write_zip_stored(
                    &parts
                        .iter()
                        .map(|(k, v)| (k.as_str(), string(v).as_bytes()))
                        .collect::<Vec<_>>(),
                ),
                JVal::Str(text) => text.as_bytes().to_vec(),
                _ => panic!("input"),
            };
            let fs = MemoryVfs::new();
            fs.mkdir_all("/output").unwrap();
            let path = format!("/{name}");
            let dest = format!(
                "/output/{}.{}",
                name.rsplit_once('.').unwrap().0,
                target.split(':').next().unwrap()
            );
            fs.write_file(&path, &input).unwrap();
            fs.write_file(&dest, b"destination sentinel").unwrap();
            fs.write_file("/unrelated", b"keep").unwrap();
            let result = super::super::cmd_soffice(
                &["--convert-to", target, "--outdir", "/output", &path].map(String::from),
                "/",
                &fs,
            );
            assert_eq!(fs.read_file(&path).unwrap(), input);
            assert_eq!(fs.read_file("/unrelated").unwrap(), b"keep");
            let JVal::Number(code, _) = field(case, "exitCode") else {
                panic!("code")
            };
            let expected: Vec<_> = string(field(case, "hex"))
                .as_bytes()
                .chunks_exact(2)
                .map(|c| u8::from_str_radix(std::str::from_utf8(c).unwrap(), 16).unwrap())
                .collect();
            let output = fs.read_file(&dest).unwrap();
            let JVal::Object(fields) = case else {
                unreachable!()
            };
            let same = if let Some((_, JVal::Str(roundtrip))) =
                fields.iter().find(|(k, _)| k == "roundtrip")
            {
                fs.write_file("/reopened.xlsx", &output).unwrap();
                let result = super::super::cmd_soffice(
                    &["--convert-to", "csv", "/reopened.xlsx"].map(String::from),
                    "/",
                    &fs,
                );
                result.exit_code == 0
                    && result.stderr.is_empty()
                    && fs.read_file("/reopened.csv").ok().is_some_and(|bytes| {
                        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>() == *roundtrip
                    })
            } else if *code == 0. && target.split(':').next() == Some("xlsx") {
                let output = read_office_archive(&output);
                let expected = read_office_archive(&expected);
                let names = |bytes: &[u8]| {
                    let doc = xml::parse(std::str::from_utf8(bytes).unwrap(), None, None).unwrap();
                    let Node::Element(root) = &doc.nodes[0] else {
                        panic!("workbook")
                    };
                    children(root, "sheets")
                        .flat_map(|s| children(s, "sheet"))
                        .map(|s| attr(s, "name").unwrap().to_string())
                        .collect::<Vec<_>>()
                };
                output
                    .iter()
                    .filter(|(k, _)| k.starts_with("xl/worksheets/sheet"))
                    .eq(expected
                        .iter()
                        .filter(|(k, _)| k.starts_with("xl/worksheets/sheet")))
                    && output
                        .get("xl/workbook.xml")
                        .is_some_and(|bytes| names(bytes) == names(&expected["xl/workbook.xml"]))
            } else {
                output == expected
            };
            if result.exit_code != *code as i32
                || result.stdout != string(field(case, "stdout"))
                || result.stderr != string(field(case, "stderr"))
                || !same
            {
                failures.push(format!(
                    "{name} {target}: code {}, stdout {:?}, stderr {:?}, output matches {same}",
                    result.exit_code, result.stdout, result.stderr
                ));
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn repeated_array_without_names_reaches_the_import_budget() {
        let input = archive(
            r#"<table:table-row table:number-rows-repeated="1048576"><table:table-cell table:number-columns-repeated="16384" table:formula="of:=1" table:number-matrix-columns-spanned="1" table:number-matrix-rows-spanned="1"/></table:table-row>"#,
        );
        let error = convert(&input, "repeat.ods", "xlsx", None, 65_536)
            .err()
            .unwrap();
        assert!(error.contains("byte limit"), "{error}");
    }

    #[test]
    fn comments_and_repeated_cells_match_production() {
        use crate::commands::structured::{JVal, parse_json_stream, read_office_archive};
        use crate::{MemoryVfs, SafeBashFs};
        fn text_content(el: &Element) -> String {
            let mut content = String::new();
            let mut pending = vec![el];
            while let Some(el) = pending.pop() {
                if el.tag == "t" {
                    for node in &el.children {
                        if let Node::Text(s, _) = node {
                            content.push_str(s);
                        }
                    }
                } else {
                    pending.extend(el.children.iter().rev().filter_map(|n| match n {
                        Node::Element(e) => Some(e),
                        _ => None,
                    }));
                }
            }
            content
        }
        let field = |v: &JVal, key: &str| {
            let JVal::Object(fields) = v else {
                panic!("object")
            };
            fields.iter().find(|(k, _)| k == key).unwrap().1.clone()
        };
        let string = |v: JVal| {
            let JVal::Str(s) = v else { panic!("string") };
            s
        };
        let fixture = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-ods-comment-authors-native.json"
        ))
        .unwrap()
        .remove(0);
        let JVal::Array(cases) = field(&fixture, "cases") else {
            panic!("cases")
        };
        let mut failures = Vec::new();
        for case in cases {
            let name = string(field(&case, "name"));
            let JVal::Object(parts) = field(&case, "parts") else {
                panic!("parts")
            };
            let entries: Vec<_> = parts
                .iter()
                .map(|(name, v)| {
                    let JVal::Str(v) = v else { panic!("part") };
                    (name.as_str(), v.as_bytes())
                })
                .collect();
            let input = write_zip_stored(&entries);
            let fs = MemoryVfs::new();
            fs.write_file("/input.ods", &input).unwrap();
            fs.write_file("/input.xlsx", b"existing output").unwrap();
            let result = super::super::try_run_archive_command(
                "soffice",
                &["--convert-to", "xlsx", "/input.ods"].map(String::from),
                "",
                "/",
                &Default::default(),
                &fs,
            )
            .unwrap();
            let JVal::Number(expected_code, _) = field(&case, "exitCode") else {
                panic!("exitCode")
            };
            assert_eq!(
                result.exit_code, expected_code as i32,
                "{name}: {}",
                result.stderr
            );
            assert_eq!(result.stderr, string(field(&case, "stderr")), "{name}");
            assert_eq!(fs.read_file("/input.ods").unwrap(), input);
            if result.exit_code != 0 {
                assert_eq!(fs.read_file("/input.xlsx").unwrap(), b"existing output");
                continue;
            }
            let parts = read_office_archive(&fs.read_file("/input.xlsx").unwrap());
            let strings = parts
                .get("xl/sharedStrings.xml")
                .map_or(Vec::new(), |source| {
                    let doc = xml::parse(std::str::from_utf8(source).unwrap(), None, None).unwrap();
                    let Node::Element(root) = &doc.nodes[0] else {
                        panic!("strings")
                    };
                    children(root, "si").map(text_content).collect::<Vec<_>>()
                });
            let JVal::Array(sheets) = field(&case, "sheets") else {
                panic!("sheets")
            };
            for (index, sheet) in sheets.iter().enumerate() {
                let JVal::Array(expected_authors) = field(sheet, "authors") else {
                    panic!("authors")
                };
                let expected_authors: Vec<_> = expected_authors.into_iter().map(&string).collect();
                let JVal::Array(expected_comments) = field(sheet, "comments") else {
                    panic!("comments")
                };
                let expected_comments: Vec<_> = expected_comments
                    .iter()
                    .map(|c| {
                        (
                            string(field(c, "cell")),
                            match field(c, "authorId") {
                                JVal::Str(id) => Some(id),
                                _ => None,
                            },
                            string(field(c, "text")),
                        )
                    })
                    .collect();
                let mut authors = Vec::new();
                let mut comments = Vec::new();
                if let Some(source) = parts.get(&format!("xl/comments{}.xml", index + 1)) {
                    let document =
                        xml::parse(std::str::from_utf8(source).unwrap(), None, None).unwrap();
                    let Node::Element(root) = &document.nodes[0] else {
                        panic!("comments")
                    };
                    for group in children(root, "authors") {
                        for author in children(group, "author") {
                            authors.push(
                                author
                                    .children
                                    .iter()
                                    .filter_map(|n| match n {
                                        Node::Text(s, _) => Some(s.as_str()),
                                        _ => None,
                                    })
                                    .collect::<String>(),
                            );
                        }
                    }
                    for group in children(root, "commentList") {
                        for comment in children(group, "comment") {
                            comments.push((
                                attr(comment, "ref").unwrap().to_string(),
                                attr(comment, "authorId").map(str::to_owned),
                                text_content(children(comment, "text").next().unwrap()),
                            ));
                        }
                    }
                }
                if matches!(field(&case, "verifyCells"), JVal::Bool(true)) {
                    let doc = xml::parse(
                        std::str::from_utf8(
                            &parts[&format!("xl/worksheets/sheet{}.xml", index + 1)],
                        )
                        .unwrap(),
                        None,
                        None,
                    )
                    .unwrap();
                    let Node::Element(root) = &doc.nodes[0] else {
                        panic!("sheet")
                    };
                    let mut cells = BTreeMap::new();
                    for data in children(root, "sheetData") {
                        for row in children(data, "row") {
                            for cell in children(row, "c") {
                                if let Some(inline) = children(cell, "is").next() {
                                    cells.insert(
                                        attr(cell, "r").unwrap().to_string(),
                                        text_content(inline),
                                    );
                                }
                                if let Some(value) = children(cell, "v").next() {
                                    let text: String = value
                                        .children
                                        .iter()
                                        .filter_map(|n| match n {
                                            Node::Text(s, _) => Some(s.as_str()),
                                            _ => None,
                                        })
                                        .collect();
                                    let text = if attr(cell, "t") == Some("s") {
                                        strings[text.parse::<usize>().unwrap()].clone()
                                    } else {
                                        text
                                    };
                                    cells.insert(attr(cell, "r").unwrap().to_string(), text);
                                }
                            }
                        }
                    }
                    let JVal::Object(expected) = field(sheet, "cells") else {
                        panic!("cells")
                    };
                    let expected: BTreeMap<_, _> =
                        expected.into_iter().map(|(k, v)| (k, string(v))).collect();
                    if cells != expected {
                        failures.push(format!(
                            "{name} sheet {index} cells: {cells:?} expected {expected:?}"
                        ));
                    }
                    if name == "column-zero-styles" {
                        let (sheets, _) = read(false, &input, "input.ods", "csv", 1 << 24).unwrap();
                        assert_eq!(sheets[0].cells[&(0, 0)].format.as_deref(), Some("0.00"));
                        assert_eq!(sheets[0].cells[&(0, 1)].format, None);
                    }
                }
                if authors != expected_authors || comments != expected_comments {
                    failures.push(format!("{name} sheet {index}: {authors:?} {comments:?}, expected {expected_authors:?} {expected_comments:?}"));
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn comment_formatting_matches_production() {
        use crate::commands::structured::{JVal, parse_json_stream, read_office_archive};
        use crate::{MemoryVfs, SafeBashFs};
        fn field<'a>(value: &'a JVal, key: &str) -> &'a JVal {
            let JVal::Object(fields) = value else {
                panic!("object")
            };
            &fields.iter().find(|(k, _)| k == key).unwrap().1
        }
        fn string(value: &JVal) -> &str {
            let JVal::Str(s) = value else {
                panic!("string")
            };
            s
        }
        let fixture = parse_json_stream(include_str!(
            "../../tests/fixtures/soffice-ods-comment-format-native.json"
        ))
        .unwrap()
        .remove(0);
        let JVal::Array(cases) = field(&fixture, "cases") else {
            panic!("cases")
        };
        let mut failures = Vec::new();
        for case in cases {
            let JVal::Object(parts) = field(case, "parts") else {
                panic!("parts")
            };
            let entries: Vec<_> = parts
                .iter()
                .map(|(k, v)| (k.as_str(), string(v).as_bytes()))
                .collect();
            let input = write_zip_stored(&entries);
            let fs = MemoryVfs::new();
            fs.write_file("/input.ods", &input).unwrap();
            fs.write_file("/input.xlsx", b"existing output").unwrap();
            let result = super::super::try_run_archive_command(
                "soffice",
                &["--convert-to", "xlsx", "/input.ods"].map(String::from),
                "",
                "/",
                &Default::default(),
                &fs,
            )
            .unwrap();
            let JVal::Number(expected_code, _) = field(case, "exitCode") else {
                panic!("exitCode")
            };
            assert_eq!(
                result.exit_code,
                *expected_code as i32,
                "{}: {}",
                string(field(case, "name")),
                result.stderr
            );
            assert_eq!(result.stderr, string(field(case, "stderr")));
            assert_eq!(fs.read_file("/input.ods").unwrap(), input);
            if result.exit_code != 0 {
                assert_eq!(fs.read_file("/input.xlsx").unwrap(), b"existing output");
                continue;
            }
            let parts = read_office_archive(&fs.read_file("/input.xlsx").unwrap());
            let doc = xml::parse(
                std::str::from_utf8(&parts["xl/comments1.xml"]).unwrap(),
                None,
                None,
            )
            .unwrap();
            let Node::Element(root) = &doc.nodes[0] else {
                panic!("root")
            };
            let list = children(root, "commentList").next().unwrap();
            let actual: Vec<_> = children(list, "comment").collect();
            let JVal::Array(expected) = field(case, "comments") else {
                panic!("comments")
            };
            assert_eq!(actual.len(), expected.len());
            for (actual, expected) in actual.into_iter().zip(expected) {
                assert_eq!(attr(actual, "ref"), Some(string(field(expected, "cell"))));
                let mut runs: Vec<(String, BTreeMap<String, String>)> = Vec::new();
                for node in &children(actual, "text").next().unwrap().children {
                    let Node::Element(run) = node else { continue };
                    let text_nodes: Vec<_> = if run.tag == "t" {
                        run.children.iter().collect()
                    } else {
                        children(run, "t").flat_map(|t| &t.children).collect()
                    };
                    let text = text_nodes
                        .into_iter()
                        .filter_map(|n| {
                            if let Node::Text(s, _) = n {
                                Some(s.as_str())
                            } else {
                                None
                            }
                        })
                        .collect::<String>();
                    if text.is_empty() {
                        continue;
                    }
                    let mut props = BTreeMap::new();
                    for p in children(run, "rPr").flat_map(|p| &p.children) {
                        let Node::Element(p) = p else { continue };
                        for (k, v) in &p.attrs {
                            if p.tag == "u" && k == "val" && v == "none" {
                                continue;
                            }
                            let mut v = v.clone();
                            if matches!(p.tag.as_str(), "b" | "i" | "strike" | "outline" | "shadow")
                                && k == "val"
                            {
                                if matches!(v.as_str(), "0" | "false") {
                                    continue;
                                }
                                if v == "1" {
                                    v = "true".into();
                                }
                            }
                            props.insert(format!("{}.{}", p.tag, k), v);
                        }
                    }
                    if let Some(previous) = runs.last_mut().filter(|r| r.1 == props) {
                        previous.0.push_str(&text);
                    } else {
                        runs.push((text, props));
                    }
                }
                let JVal::Array(expected_runs) = field(expected, "runs") else {
                    panic!("runs")
                };
                let expected_runs: Vec<_> = expected_runs
                    .iter()
                    .map(|r| {
                        let JVal::Object(properties) = field(r, "properties") else {
                            panic!("properties")
                        };
                        (
                            string(field(r, "text")).to_string(),
                            properties
                                .iter()
                                .map(|(k, v)| (k.clone(), string(v).to_string()))
                                .collect::<BTreeMap<_, _>>(),
                        )
                    })
                    .collect();
                if runs != expected_runs {
                    failures.push(format!(
                        "{} / {}: actual {runs:?}, expected {expected_runs:?}",
                        string(field(case, "name")),
                        string(field(expected, "name"))
                    ));
                }
            }
        }
        assert!(
            failures.is_empty(),
            "comment formatting differs: {}",
            failures.join(", ")
        );
    }

    #[test]
    fn ordinary_scalars_and_number_formats_match_production() {
        use crate::commands::structured::{JVal, parse_json_stream, read_office_archive};
        use crate::{MemoryVfs, SafeBashFs};
        fn field<'a>(value: &'a JVal, key: &str) -> &'a JVal {
            let JVal::Object(fields) = value else {
                panic!("object")
            };
            &fields.iter().find(|(k, _)| k == key).unwrap().1
        }
        fn string(value: &JVal) -> &str {
            let JVal::Str(s) = value else {
                panic!("string")
            };
            s
        }
        fn root(bytes: &[u8]) -> Element {
            let mut doc = xml::parse(std::str::from_utf8(bytes).unwrap(), None, None).unwrap();
            let Node::Element(root) = doc.nodes.remove(0) else {
                panic!("root")
            };
            root
        }
        fn text(element: &Element) -> String {
            element
                .children
                .iter()
                .filter_map(|n| match n {
                    Node::Text(s, _) | Node::Cdata(s) => Some(s.as_str()),
                    _ => None,
                })
                .collect()
        }
        for source in [
            include_str!("../../tests/fixtures/soffice-ods-scalars-production.json"),
            include_str!("../../tests/fixtures/soffice-ods-style-formats-production.json"),
        ] {
            let fixture = parse_json_stream(source).unwrap().remove(0);
            let JVal::Array(cases) = field(&fixture, "cases") else {
                panic!("cases")
            };
            for case in cases {
                let JVal::Object(parts) = field(case, "parts") else {
                    panic!("parts")
                };
                let entries: Vec<_> = parts
                    .iter()
                    .map(|(k, v)| (k.as_str(), string(v).as_bytes()))
                    .collect();
                let input = write_zip_stored(&entries);
                let fs = MemoryVfs::new();
                fs.write_file("/input.ods", &input).unwrap();
                let result = super::super::try_run_archive_command(
                    "soffice",
                    &["--convert-to", "xlsx", "/input.ods"].map(String::from),
                    "",
                    "/",
                    &Default::default(),
                    &fs,
                )
                .unwrap();
                assert_eq!(
                    result.exit_code,
                    0,
                    "{}: {}",
                    string(field(case, "name")),
                    result.stderr
                );
                assert_eq!(result.stdout, string(field(case, "stdout")));
                assert_eq!(result.stderr, string(field(case, "stderr")));
                assert_eq!(fs.read_file("/input.ods").unwrap(), input);
                let output = read_office_archive(&fs.read_file("/input.xlsx").unwrap());
                let strings = output.get("xl/sharedStrings.xml").map(|b| root(b));
                let strings: Vec<_> = strings
                    .as_ref()
                    .map(|r| {
                        children(r, "si")
                            .map(|si| children(si, "t").map(text).collect::<String>())
                            .collect()
                    })
                    .unwrap_or_default();
                let styles = root(&output["xl/styles.xml"]);
                let mut formats = BTreeMap::from([
                    ("0".to_string(), "General".to_string()),
                    ("1".to_string(), "0".to_string()),
                    ("2".to_string(), "0.00".to_string()),
                    ("10".to_string(), "0.00%".to_string()),
                ]);
                for f in children(&styles, "numFmts").flat_map(|e| children(e, "numFmt")) {
                    formats.insert(
                        attr(f, "numFmtId").unwrap().to_string(),
                        attr(f, "formatCode").unwrap().to_string(),
                    );
                }
                let xfs: Vec<_> = children(children(&styles, "cellXfs").next().unwrap(), "xf")
                    .map(|e| formats[attr(e, "numFmtId").unwrap()].clone())
                    .collect();
                let sheet = root(&output["xl/worksheets/sheet1.xml"]);
                let mut actual = BTreeMap::new();
                for cell in children(children(&sheet, "sheetData").next().unwrap(), "row")
                    .flat_map(|r| children(r, "c"))
                {
                    let mut kind = attr(cell, "t").unwrap_or("n");
                    let mut value = children(cell, "v").next().map(text);
                    if kind == "s" {
                        value = value.map(|s| strings[s.parse::<usize>().unwrap()].clone());
                        kind = "text";
                    }
                    if kind == "inlineStr" {
                        value = children(cell, "is")
                            .next()
                            .map(|e| children(e, "t").map(text).collect());
                        kind = "text";
                    }
                    if let Some(value) = value {
                        actual.insert(
                            attr(cell, "r").unwrap().to_string(),
                            (
                                kind.to_string(),
                                value,
                                xfs[attr(cell, "s").unwrap_or("0").parse::<usize>().unwrap()]
                                    .clone(),
                            ),
                        );
                    }
                }
                let JVal::Array(expected) = field(case, "cells") else {
                    panic!("cells")
                };
                for cell in expected {
                    let address = string(field(cell, "cell"));
                    let value = actual.remove(address).unwrap_or_else(|| {
                        panic!("{}: missing {address}", string(field(case, "name")))
                    });
                    assert_eq!(value.0, string(field(cell, "type")), "{address}");
                    if value.0 == "n" {
                        assert_eq!(
                            value.1.parse::<f64>().unwrap(),
                            string(field(cell, "value")).parse::<f64>().unwrap(),
                            "{address}"
                        );
                    } else {
                        assert_eq!(value.1, string(field(cell, "value")), "{address}");
                    }
                    assert_eq!(value.2, string(field(cell, "format")), "{address}");
                }
                assert!(actual.is_empty(), "unexpected cells: {actual:?}");
            }
        }
    }

    #[test]
    fn cell_imports_match_public_packages_and_csv() {
        use crate::commands::structured::{JVal, parse_json_stream, read_office_archive};
        use crate::{MemoryVfs, SafeBashFs};
        for source in [
            include_str!("../../tests/fixtures/soffice-ods-cell-types-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-formula-import-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-lookup-validation-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-lookup-errors-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-empty-values-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-numbers-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-match-settings-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-lookup-values-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-lookup-ranges-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-lookup-tables-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-lookup-unicode-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-broadcast-native.json"),
            include_str!("../../tests/fixtures/soffice-ods-empty-arrays-native.json"),
        ] {
            let JVal::Object(fixture) = parse_json_stream(source).unwrap().remove(0) else {
                panic!("fixture")
            };
            let JVal::Array(cases) = &fixture.iter().find(|(k, _)| k == "cases").unwrap().1 else {
                panic!("cases")
            };
            for case in cases {
                let JVal::Object(fields) = case else {
                    panic!("case")
                };
                let field = |key| &fields.iter().find(|(k, _)| k == key).unwrap().1;
                let JVal::Str(name) = field("name") else {
                    panic!("name")
                };
                let JVal::Object(parts) = field("parts") else {
                    panic!("parts")
                };
                let input = write_zip_stored(
                    &parts
                        .iter()
                        .map(|(key, value)| {
                            let JVal::Str(value) = value else {
                                panic!("part")
                            };
                            (key.as_str(), value.as_bytes())
                        })
                        .collect::<Vec<_>>(),
                );
                let JVal::Array(checks) = field("checks") else {
                    panic!("checks")
                };
                for check in checks {
                    let JVal::Object(fields) = check else {
                        panic!("check")
                    };
                    let field = |key| &fields.iter().find(|(k, _)| k == key).unwrap().1;
                    let text = |key| match field(key) {
                        JVal::Str(value) => value.as_str(),
                        _ => panic!("text"),
                    };
                    let target = text("target");
                    let context = format!("{name} {target}");
                    let fs = MemoryVfs::new();
                    fs.mkdir_all("/out").unwrap();
                    fs.write_file("/input.ods", &input).unwrap();
                    let dest = format!("/out/input.{target}");
                    fs.write_file(&dest, b"existing output").unwrap();
                    let result = super::super::cmd_soffice(
                        &["--convert-to", target, "--outdir", "/out", "/input.ods"]
                            .map(String::from),
                        "/",
                        &fs,
                    );
                    let JVal::Number(code, _) = field("exitCode") else {
                        panic!("exitCode")
                    };
                    assert_eq!(
                        result.exit_code, *code as i32,
                        "{context}: {}",
                        result.stderr
                    );
                    assert_eq!(result.stdout, text("stdout"), "{context}");
                    assert_eq!(result.stderr, text("stderr"), "{context}");
                    assert_eq!(fs.read_file("/input.ods").unwrap(), input);
                    let actual = fs.read_file(&dest).unwrap();
                    if let Some((_, JVal::Object(parts))) =
                        fields.iter().find(|(k, _)| k == "parts")
                    {
                        let expected = parts
                            .iter()
                            .map(|(key, value)| {
                                let JVal::Str(value) = value else {
                                    panic!("part")
                                };
                                (key.clone(), value.as_bytes().to_vec())
                            })
                            .collect();
                        assert_eq!(read_office_archive(&actual), expected, "{context}");
                    } else {
                        assert_eq!(actual, text("output").as_bytes(), "{context}");
                    }
                }
            }
        }
    }

    #[test]
    fn export_recalculation_preserves_caches_when_its_second_phase_exceeds_the_budget() {
        let bytes = archive(&format!("<table:table-row>{}</table:table-row>",
            r#"<table:table-cell table:formula="of:=IF(0;INDIRECT(&quot;Sheet1!B1&quot;);2)" office:value-type="float" table:style-name="" office:value="91"/>"#.repeat(16)));
        let (mut sheets, mut book) = read(false, &bytes, "cached.ods", "csv", 100_000).unwrap();
        book.recalculate = true;
        let (mut low, mut high) = (0, 65536);
        while low + 1 < high {
            let budget = (low + high) / 2;
            if super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &book,
                None,
                budget,
            )
            .is_ok()
            {
                high = budget;
            } else {
                low = budget;
            }
        }
        assert!(
            super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &book,
                None,
                high
            )
            .is_ok()
        );
        assert!(matches!(
            sheets[0].cells[&(0, 0)].value,
            Some(Value::Number(2.))
        ));
        for cell in sheets[0].cells.values_mut() {
            cell.value = Some(Value::Number(91.));
        }
        assert!(
            super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &book,
                Some(&["Renamed".into()]),
                high
            )
            .is_err()
        );
        assert!(matches!(
            sheets[0].cells[&(0, 0)].value,
            Some(Value::Number(91.))
        ));
        assert!(
            super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &book,
                Some(&["Renamed".into()]),
                65536
            )
            .is_ok()
        );
        assert!(matches!(
            sheets[0].cells[&(0, 0)].value,
            Some(Value::Number(2.))
        ));
    }

    #[test]
    fn formula_recalculation_preserves_caches_on_work_limit() {
        let bytes = archive(
            r#"<table:table-row><table:table-cell table:formula="of:=1+2" office:value-type="float" table:style-name="" office:value="91"/></table:table-row>"#,
        );
        let (mut sheets, mut book) = read(false, &bytes, "cached.ods", "xlsx", 100_000).unwrap();
        book.recalculate = true;
        assert!(
            super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &book,
                None,
                1
            )
            .is_err()
        );
        assert!(matches!(
            sheets[0].cells[&(0, 0)].value,
            Some(Value::Number(91.))
        ));
        assert!(
            super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &book,
                None,
                100_000
            )
            .is_ok()
        );
        assert!(matches!(
            sheets[0].cells[&(0, 0)].value,
            Some(Value::Number(3.))
        ));
    }

    #[test]
    fn deep_formula_rename_analysis_preserves_caches_on_work_limit() {
        let chain = "+1".repeat(4095);
        let rows = format!(
            r#"<table:table-row><table:table-cell table:formula="of:=1{chain}" table:style-name="" office:value-type="float" office:value="91"/></table:table-row><table:table-row><table:table-cell table:formula="of:=INDIRECT(&quot;A1&quot;)+1"/></table:table-row><table:table-row><table:table-cell table:formula="of:=[.A2]{chain}"/></table:table-row>"#
        );
        let (mut sheets, book) =
            read(false, &archive(&rows), "deep.ods", "csv", 1_000_000).unwrap();
        let names = vec!["renamed".into()];
        assert!(
            super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &book,
                Some(&names),
                4096
            )
            .is_err()
        );
        assert!(matches!(
            sheets[0].cells[&(0, 0)].value,
            Some(Value::Number(91.))
        ));
        assert!(sheets[0].cells[&(1, 0)].value.is_none());
        assert!(sheets[0].cells[&(2, 0)].value.is_none());
        assert!(
            super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &book,
                Some(&names),
                8_000_000
            )
            .is_ok()
        );
        for (row, expected) in [(0, 4096.), (1, 4097.), (2, 8192.)] {
            assert!(
                matches!(sheets[0].cells[&(row, 0)].value, Some(Value::Number(n)) if n == expected)
            );
        }
    }

    #[test]
    fn matrix_extents_and_calculation_are_bounded_before_cache_mutation() {
        let oversized = archive(
            r#"<table:table-row><table:table-cell table:formula="of:=1" table:number-matrix-columns-spanned="1000" table:number-matrix-rows-spanned="1000"/></table:table-row>"#,
        );
        assert_eq!(
            read(false, &oversized, "matrix.ods", "csv", 4096)
                .err()
                .as_deref(),
            Some(LIMIT)
        );

        let columns = std::iter::repeat_n("&quot;text&quot;", 64)
            .collect::<Vec<_>>()
            .join(";");
        let rows = std::iter::repeat_n("1", 64).collect::<Vec<_>>().join("|");
        let source = archive(&format!(
            r#"<table:table-row><table:table-cell table:formula="of:=1+2"/><table:table-cell table:formula="of:={{{columns}}}&amp;{{{rows}}}" table:number-matrix-columns-spanned="1" table:number-matrix-rows-spanned="1"/></table:table-row>"#
        ));
        let (mut sheets, workbook) = read(false, &source, "matrix.ods", "csv", 100_000).unwrap();
        assert!(
            super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &workbook,
                None,
                16_384
            )
            .is_err()
        );
        assert!(sheets[0].cells.values().all(|c| c.value.is_none()));
        assert!(
            super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &workbook,
                None,
                1_000_000
            )
            .is_ok()
        );
        assert!(matches!(&sheets[0].cells[&(0, 1)].value, Some(Value::Text(s)) if s == "text1"));
    }

    #[test]
    fn index_and_union_work_limits_preserve_all_formula_caches() {
        let text = "x".repeat(256);
        for (formula, expected) in [
            ("INDEX({{&quot;{}&quot;}};1;1)", Value::Text(text.clone())),
            ("INDEX(([.A1]~[.A2]);1;1;2)", Value::Text(text.clone())),
            (
                "INDEX((([.A1]~[.A2])![.A2]);1;1)",
                Value::Error("#VALUE!".into()),
            ),
            (
                "INDEX(([.A1]~([.A2]~[.A1]));1;1;2)",
                Value::Text(text.clone()),
            ),
        ] {
            let mut rows = format!(
                r#"<table:table-row><table:table-cell table:formula="of:=1+2" table:style-name="" office:value="91"/></table:table-row><table:table-row><table:table-cell office:value-type="string" office:string-value="{text}"/></table:table-row>"#
            );
            let formula = formula
                .replace("{{", "{")
                .replace("}}", "}")
                .replace("{}", &text);
            for _ in 0..32 {
                rows.push_str(&format!(r#"<table:table-row><table:table-cell table:formula="of:={formula}"/></table:table-row>"#));
            }
            let (mut sheets, book) =
                read(false, &archive(&rows), "index.ods", "csv", 100_000).unwrap();
            assert!(
                super::super::office::formulas::cache(
                    xlsx::Dialect::Gnumeric,
                    &mut sheets,
                    &book,
                    None,
                    4096
                )
                .is_err()
            );
            assert!(matches!(
                sheets[0].cells[&(0, 0)].value,
                Some(Value::Number(91.))
            ));
            assert!(sheets[0].cells[&(33, 0)].value.is_none());
            assert!(
                super::super::office::formulas::cache(
                    xlsx::Dialect::Gnumeric,
                    &mut sheets,
                    &book,
                    None,
                    1_000_000
                )
                .is_ok()
            );
            match (&sheets[0].cells[&(33, 0)].value, expected) {
                (Some(Value::Text(actual)), Value::Text(expected))
                | (Some(Value::Error(actual)), Value::Error(expected)) => {
                    assert_eq!(actual, &expected, "{formula}")
                }
                _ => panic!("unexpected result for {formula}"),
            }
        }
    }

    #[test]
    fn failed_lookup_retains_stored_and_missing_caches() {
        let source = archive(
            r#"<table:table-row><table:table-cell table:formula="of:=1+2" table:style-name="" office:value="91"/><table:table-cell table:formula="of:=1+2"/><table:table-cell table:formula="of:=MATCH(91;[.A1:.A65536];0)"/></table:table-row>"#,
        );
        let (mut sheets, book) = read(false, &source, "lookup.ods", "csv", 100_000).unwrap();
        assert!(
            super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &book,
                None,
                4096
            )
            .is_err()
        );
        assert!(matches!(
            sheets[0].cells[&(0, 0)].value,
            Some(Value::Number(91.))
        ));
        assert!(sheets[0].cells[&(0, 1)].value.is_none());
        assert!(sheets[0].cells[&(0, 2)].value.is_none());
        assert!(
            super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &book,
                None,
                8_000_000
            )
            .is_ok()
        );
        assert!(matches!(
            sheets[0].cells[&(0, 1)].value,
            Some(Value::Number(3.))
        ));
        assert!(matches!(
            sheets[0].cells[&(0, 2)].value,
            Some(Value::Number(1.))
        ));
    }

    #[test]
    fn workbook_names_and_formula_cache_respect_memory_limits() {
        let mut names = String::from("<table:named-expressions>");
        for i in 0..100 {
            names.push_str(&format!(r#"<table:named-expression table:name="Name{i}" table:expression="of:=[Sheet1.A1]" table:base-cell-address="Sheet1.B3"/>"#));
        }
        names.push_str("</table:named-expressions>");
        let bytes = archive(&names);
        assert_eq!(
            read(false, &bytes, "names.ods", "csv", 4096)
                .err()
                .as_deref(),
            Some(LIMIT)
        );
        let (sheets, workbook) = read(false, &bytes, "names.ods", "csv", 100_000).unwrap();
        assert_eq!(workbook.names.len(), 100);
        assert_eq!(workbook.names[99].position, (0, 2, 1));
        assert!(xlsx::write_cells(xlsx::Dialect::LibreOffice, &sheets, &workbook, 4096).is_none());
        assert!(
            xlsx::write_cells(xlsx::Dialect::LibreOffice, &sheets, &workbook, 100_000).is_some()
        );

        let sparse = archive(
            r#"<table:table-row table:number-rows-repeated="10000"/><table:table-row><table:table-cell table:formula="of:=1+2"/></table:table-row>"#,
        );
        let (mut sheets, _) = read(false, &sparse, "sparse.ods", "csv", 4096).unwrap();
        assert_eq!(
            super::super::office::csv::spreadsheet(
                &sheets[0],
                None,
                false,
                &BTreeMap::new(),
                4096,
                &mut 4096
            )
            .unwrap(),
            b"\n"
        );
        assert!(
            super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &Workbook::default(),
                None,
                4096
            )
            .is_ok()
        );
        assert!(matches!(
            sheets[0].cells[&(10000, 0)].value,
            Some(Value::Number(3.))
        ));

        let mut source = String::from(
            r#"<table:table-row><table:table-cell table:formula="of:=BudgetName_20"/></table:table-row><table:named-expressions><table:named-expression table:name="BudgetName_0" table:expression="of:=&quot;x&quot;"/>"#,
        );
        for i in 1..=20 {
            source.push_str(&format!(r#"<table:named-expression table:name="BudgetName_{i}" table:expression="of:=BudgetName_{}&amp;BudgetName_{}"/>"#, i - 1, i - 1));
        }
        source.push_str("</table:named-expressions>");
        let (mut sheets, workbook) =
            read(false, &archive(&source), "expansion.ods", "csv", 100_000).unwrap();
        assert!(
            super::super::office::formulas::cache(
                xlsx::Dialect::Gnumeric,
                &mut sheets,
                &workbook,
                None,
                4096
            )
            .is_err()
        );
        assert!(sheets[0].cells[&(0, 0)].value.is_none());
    }

    #[test]
    fn repeated_cells_and_text_are_bounded_before_expansion() {
        for rows in [
            r#"<table:table-row table:number-rows-repeated="1048576"><table:table-cell office:value-type="float" office:value="1"/></table:table-row>"#,
            r#"<table:table-row><table:table-cell table:number-columns-repeated="16384" office:value-type="string"><text:p>value</text:p></table:table-cell></table:table-row>"#,
            r#"<table:table-row><table:table-cell office:value-type="string"><text:p><text:s text:c="9007199254740991"/></text:p></table:table-cell></table:table-row>"#,
        ] {
            assert_eq!(
                read(false, &archive(rows), "input.ods", "csv", 4096)
                    .err()
                    .as_deref(),
                Some(LIMIT)
            );
        }
        let empty = archive(
            r#"<table:table-row table:number-rows-repeated="1048576"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>"#,
        );
        let (sheets, _) = read(false, &empty, "empty.ods", "csv", 4096).unwrap();
        assert!(sheets[0].cells.is_empty());
        assert_eq!(
            super::super::office::csv::spreadsheet(
                &sheets[0],
                None,
                false,
                &BTreeMap::new(),
                1,
                &mut 1
            )
            .unwrap(),
            b"\n"
        );
    }

    #[test]
    fn repeated_axis_metadata_is_bounded_before_expansion() {
        for rows in [
            r#"<table:table-row table:visibility="collapse" table:number-rows-repeated="1048576"/>"#,
            r#"<table:table-column table:visibility="collapse" table:number-columns-repeated="16384"/>"#,
        ] {
            assert_eq!(
                read(false, &archive(rows), "input.ods", "csv", 4096)
                    .err()
                    .as_deref(),
                Some(LIMIT)
            );
        }
        let source = archive(
            r#"<table:table-row table:visibility="collapse" table:number-rows-repeated="200"/>"#,
        );
        let (sheets, _) = read(false, &source, "input.ods", "csv", 40_000).unwrap();
        assert_eq!(sheets[0].rows.len(), 200);
        assert!(
            xlsx::write_cells(
                xlsx::Dialect::LibreOffice,
                &sheets,
                &Workbook::default(),
                4096
            )
            .is_none()
        );
        let bytes = xlsx::write_cells(
            xlsx::Dialect::LibreOffice,
            &sheets,
            &Workbook::default(),
            40_000,
        )
        .unwrap();
        let parts = crate::commands::structured::read_office_archive(&bytes);
        let xml = String::from_utf8(parts["xl/worksheets/sheet1.xml"].clone()).unwrap();
        assert!(xml.contains(r#"<row r="200" spans="1:1" hidden="1"/>"#));
    }

    #[test]
    fn retained_formula_metadata_is_charged() {
        let name = "s".repeat(150);
        let source = archive(&format!(
            r#"<table:table-row><table:table-cell table:number-columns-repeated="12" table:formula="of:=['{name}'.A1]" office:value="1"/></table:table-row>"#
        ));
        assert_eq!(
            read(false, &source, "input.ods", "csv", 4096)
                .err()
                .as_deref(),
            Some(LIMIT)
        );
    }

    #[test]
    fn repeated_cells_keep_one_source_annotation() {
        let input = archive(
            r#"<table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="3"><office:annotation><text:p>note</text:p></office:annotation></table:table-cell></table:table-row>"#,
        );
        let (sheets, _) = read(false, &input, "input.ods", "xlsx", 4096).unwrap();
        assert_eq!(sheets[0].comments.len(), 1);
        assert_eq!(
            (sheets[0].comments[0].row, sheets[0].comments[0].column),
            (0, 0)
        );
        assert_eq!(sheets[0].comments[0].runs[0].text, "note");
    }

    #[test]
    fn long_annotations_preserve_production_text() {
        use crate::{MemoryVfs, SafeBashFs};
        for text in [
            "a".repeat(16_368),
            "a".repeat(16_367) + "<text:line-break/>Z",
            r#"<text:s text:c="65535"/>"#.into(),
        ] {
            let input = archive(&format!(
                "<table:table-row><table:table-cell><office:annotation><text:p>{text}</text:p></office:annotation></table:table-cell></table:table-row>"
            ));
            let (sheets, _) = read(false, &input, "input.ods", "csv", 8 * 1024 * 1024).unwrap();
            assert_eq!(sheets[0].comments.len(), 1);
        }
        let text = r#"<text:s text:c="65535"/>"#.repeat(12);
        let input = archive(&format!(
            "<table:table-row><table:table-cell><office:annotation><text:p>{text}</text:p></office:annotation></table:table-cell></table:table-row>"
        ));
        let fs = MemoryVfs::new();
        fs.write_file("/input.ods", &input).unwrap();
        fs.write_file("/input.xlsx", b"preserved output").unwrap();
        let result = super::super::try_run_archive_command(
            "soffice",
            &["--convert-to", "xlsx", "/input.ods"].map(String::from),
            "",
            "/",
            &Default::default(),
            &fs,
        )
        .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let parts =
            crate::commands::structured::read_office_archive(&fs.read_file("/input.xlsx").unwrap());
        let comments = std::str::from_utf8(&parts["xl/comments1.xml"]).unwrap();
        assert!(comments.contains(&" ".repeat(65535 * 12)));
        assert_eq!(fs.read_file("/input.ods").unwrap(), input);
    }

    #[test]
    fn annotation_links_and_nested_styles_match_production() {
        use crate::{MemoryVfs, SafeBashFs};
        let styles = r#"<office:automatic-styles><style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles>"#;
        let source = |text: &str| {
            let content = format!(
                r#"<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink">{styles}<office:body><office:spreadsheet><table:table><table:table-row><table:table-cell><office:annotation><text:p>{text}</text:p></office:annotation></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>"#
            );
            write_zip_stored(&[
                (
                    "mimetype",
                    b"application/vnd.oasis.opendocument.spreadsheet",
                ),
                ("content.xml", content.as_bytes()),
            ("META-INF/manifest.xml", br#"<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/></manifest:manifest>"#),
            ])
        };
        let input = source(&format!(
            r#"<text:a xlink:href="https://example.com">{}</text:a>"#,
            "a".repeat(40_000)
        ));
        let (sheets, _) = read(false, &input, "input.ods", "csv", 2 * 1024 * 1024).unwrap();
        assert_eq!(
            sheets[0].comments[0]
                .runs
                .iter()
                .map(|r| r.text.len())
                .sum::<usize>(),
            0
        );
        let input = source(
            &(r#"<text:span text:style-name="B">"#.repeat(64)
                + &"a".repeat(500_000)
                + &"</text:span>".repeat(64)),
        );
        let fs = MemoryVfs::new();
        fs.write_file("/input.ods", &input).unwrap();
        fs.write_file("/input.xlsx", b"preserved output").unwrap();
        let result = super::super::try_run_archive_command(
            "soffice",
            &["--convert-to", "xlsx", "/input.ods"].map(String::from),
            "",
            "/",
            &Default::default(),
            &fs,
        )
        .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let parts =
            crate::commands::structured::read_office_archive(&fs.read_file("/input.xlsx").unwrap());
        let comments = std::str::from_utf8(&parts["xl/comments1.xml"]).unwrap();
        assert!(comments.contains(&"a".repeat(500_000)));
        assert!(comments.contains(r#"<b val="1"/>"#));
        assert_eq!(fs.read_file("/input.ods").unwrap(), input);
    }

    #[test]
    fn repeated_rich_cells_share_one_bounded_string_record() {
        let font = "x".repeat(4096);
        let xml = format!(
            r#"<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"><office:automatic-styles><style:style style:name="T" style:family="text"><style:text-properties fo:font-family="{font}"/></style:style></office:automatic-styles><office:body><office:spreadsheet><table:table><table:table-row><table:table-cell office:value-type="string" table:number-columns-repeated="200"><text:p><text:span text:style-name="T">a</text:span></text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>"#
        );
        let source = write_zip_stored(&[
            (
                "mimetype",
                b"application/vnd.oasis.opendocument.spreadsheet",
            ),
            ("content.xml", xml.as_bytes()),
        ]);
        let (sheets, _) = read(false, &source, "input.ods", "csv", 80_000).unwrap();
        assert_eq!(sheets[0].cells.len(), 200);
        let output = xlsx::write_cells(
            xlsx::Dialect::LibreOffice,
            &sheets,
            &Workbook::default(),
            80_000,
        )
        .unwrap();
        let parts = crate::commands::structured::read_office_archive(&output);
        let shared = String::from_utf8(parts["xl/sharedStrings.xml"].clone()).unwrap();
        assert!(shared.contains(r#"uniqueCount="1" count="200""#));
        assert!(shared.contains(&format!(r#"<rFont val="{font}"/>"#)));
        assert_eq!(
            read(false, &source, "input.ods", "csv", 8192)
                .err()
                .as_deref(),
            Some(LIMIT)
        );
    }

    #[test]
    fn filter_fields_and_escaped_output_are_bounded() {
        let mut source = String::from(
            r#"<table:sheet xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><table:database-ranges><table:database-range table:target-range-address="Sheet1.A1:XFD3" table:display-filter-buttons="true"><table:filter><table:filter-and>"#,
        );
        for i in 0..128 {
            source.push_str(&format!(
                r#"<table:filter-condition table:field-number="{i}" table:value="{}"/>"#,
                "&amp;".repeat(256)
            ));
        }
        source.push_str(
            "</table:filter-and></table:filter></table:database-range></table:database-ranges></table:sheet>",
        );
        let document = xml::parse(&source, None, None).unwrap();
        let Node::Element(root) = &document.nodes[0] else {
            panic!("root")
        };
        let (mut sheets, _) = read(false, &archive(""), "input.ods", "csv", 4096).unwrap();
        assert_eq!(
            filters::read(root, &mut sheets, &mut 4096).err().as_deref(),
            Some(LIMIT)
        );
        filters::read(root, &mut sheets, &mut 1_000_000).unwrap();
        assert_eq!(
            sheets[0]
                .filter
                .as_ref()
                .unwrap()
                .fields
                .as_ref()
                .unwrap()
                .len(),
            128
        );
        assert!(
            xlsx::write_cells(
                xlsx::Dialect::LibreOffice,
                &sheets,
                &Workbook::default(),
                4096
            )
            .is_none()
        );
        let bytes = xlsx::write_cells(
            xlsx::Dialect::LibreOffice,
            &sheets,
            &Workbook::default(),
            1_000_000,
        )
        .unwrap();
        let parts = crate::commands::structured::read_office_archive(&bytes);
        let xml = String::from_utf8(parts["xl/worksheets/sheet1.xml"].clone()).unwrap();
        assert!(xml.contains(r#"<filterColumn colId="127">"#));
        assert!(xml.contains(&format!(r#"val="{}""#, "&amp;".repeat(256))));
    }

    #[test]
    fn csv_budget_includes_record_terminators() {
        let source = archive(
            r#"<table:table-row><table:table-cell office:string-value="a"/></table:table-row>"#,
        );
        let (sheets, _) = read(false, &source, "input.ods", "csv", 4096).unwrap();
        assert_eq!(
            super::super::office::csv::spreadsheet(
                &sheets[0],
                None,
                false,
                &BTreeMap::new(),
                1,
                &mut 1
            )
            .err(),
            Some(LIMIT)
        );
        assert_eq!(
            super::super::office::csv::spreadsheet(
                &sheets[0],
                None,
                false,
                &BTreeMap::new(),
                2,
                &mut 2
            )
            .unwrap(),
            b"a\n"
        );
    }
}
